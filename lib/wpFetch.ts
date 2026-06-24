/**
 * WordPress REST calls use a dedicated Undici Agent with DNS-over-HTTPS fallback.
 * Vercel/serverless sometimes returns getaddrinfo ENOTFOUND for hostnames that resolve
 * fine in public DNS; resolving A records via DoH fixes uploads without changing Site URL.
 */
import dns from "node:dns";
import Undici, { Agent, fetch as undiciFetch, interceptors } from "undici";
import type { Agent as AgentType } from "undici";
import { errorMessage } from "@/lib/serverLog";

if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

function envMs(key: string, fallback: number): number {
  const raw = (process.env[key] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Undici default connect timeout is 10s — too short for Cloudflare/WAF handshakes. */
const WP_CONNECT_TIMEOUT_MS = envMs("WORDPRESS_REST_CONNECT_TIMEOUT_MS", 60_000);
const WP_HEADERS_TIMEOUT_MS = envMs("WORDPRESS_REST_HEADERS_TIMEOUT_MS", 120_000);
const WP_BODY_TIMEOUT_MS = envMs("WORDPRESS_REST_BODY_TIMEOUT_MS", 300_000);
const WP_FETCH_MAX_ATTEMPTS = envMs("WORDPRESS_REST_FETCH_RETRIES", 3);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function isTransientWpNetworkError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return (
    msg.includes("connect timeout") ||
    msg.includes("und_err_connect_timeout") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("network socket disconnected") ||
    (msg.includes("fetch failed") && msg.includes("timeout"))
  );
}

export function formatWpNetworkErrorHint(err: unknown): string {
  const msg = errorMessage(err);
  if (!isTransientWpNetworkError(err)) return msg;
  const waf =
    (process.env.WORDPRESS_WAF_BYPASS_COOKIE ?? "").trim() ||
    (process.env.WORDPRESS_WAF_BYPASS_QUERY ?? "").trim()
      ? " WAF bypass env is set but the host still timed out — confirm the rule matches this site and /wp-json/."
      : " If the site uses Cloudflare, set WORDPRESS_WAF_BYPASS_COOKIE or allowlist this server in the WAF.";
  return `${msg} WordPress REST connection timed out after retries.${waf}`;
}

function dnsDohFallbackEnabled(): boolean {
  return (process.env.WORDPRESS_DNS_DOH_FALLBACK ?? "true").trim().toLowerCase() !== "false";
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

async function resolveIPv4ViaDoh(hostname: string): Promise<string | null> {
  const urls = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
  ];
  for (const url of urls) {
    try {
      const res = await globalThis.fetch(url, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        Status?: number;
        Answer?: Array<{ type: number; data: string }>;
      };
      if (json.Status !== undefined && json.Status !== 0) continue;
      const a = json.Answer?.find((x) => x.type === 1);
      const data = a?.data?.trim();
      if (data && IPV4.test(data)) return data;
    } catch {
      /* try next provider */
    }
  }
  return null;
}

type DnsOpts = {
  dualStack?: boolean;
  affinity?: number | null;
};

/**
 * Undici DNS interceptor calls this with (origin, opts, cb) — see lib/interceptor/dns.js.
 * Package typings describe a different signature; runtime matches this implementation.
 */
function wordpressDnsLookup(
  origin: URL,
  opts: DnsOpts,
  cb: (
    err: NodeJS.ErrnoException | null,
    addresses: Array<{ address: string; family: 4 | 6; ttl: number }> | null
  ) => void
): void {
  const hostname = origin.hostname;
  const dualStack = opts.dualStack !== false;
  const affinity = opts.affinity;

  dns.lookup(
    hostname,
    {
      all: true,
      family: dualStack ? 0 : affinity ?? 4,
      order: "ipv4first",
    } as dns.LookupAllOptions,
    (err, addresses) => {
      if (!err && addresses && addresses.length > 0) {
        const mapped = addresses.map((a) => ({
          address: a.address,
          family: a.family as 4 | 6,
          ttl: 60_000,
        }));
        return cb(null, mapped);
      }
      const primary = err as NodeJS.ErrnoException | undefined;
      if (!dnsDohFallbackEnabled() || primary?.code !== "ENOTFOUND") {
        return cb(primary ?? new Error("DNS lookup failed"), null);
      }
      resolveIPv4ViaDoh(hostname)
        .then((ip) => {
          if (!ip) return cb(primary, null);
          cb(null, [{ address: ip, family: 4, ttl: 60_000 }]);
        })
        .catch(() => cb(primary, null));
    }
  );
}

let wpAgent: AgentType | undefined;

export function getWpFetchDispatcher(): AgentType {
  if (!wpAgent) {
    wpAgent = new Agent({
      maxRedirections: 5,
      connectTimeout: WP_CONNECT_TIMEOUT_MS,
      headersTimeout: WP_HEADERS_TIMEOUT_MS,
      bodyTimeout: WP_BODY_TIMEOUT_MS,
      interceptors: {
        Agent: [
          Undici.createRedirectInterceptor({ maxRedirections: 5 }),
          interceptors.dns({
            dualStack: true,
            lookup: wordpressDnsLookup as never,
          }),
        ],
      },
    } as unknown as ConstructorParameters<typeof Agent>[0]);
  }
  return wpAgent;
}

export async function wpFetch(
  input: Parameters<typeof undiciFetch>[0],
  init?: Parameters<typeof undiciFetch>[1]
): Promise<Awaited<ReturnType<typeof undiciFetch>>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < WP_FETCH_MAX_ATTEMPTS; attempt++) {
    try {
      return await undiciFetch(input, {
        ...init,
        dispatcher: getWpFetchDispatcher(),
      });
    } catch (err) {
      lastErr = err;
      if (!isTransientWpNetworkError(err) || attempt >= WP_FETCH_MAX_ATTEMPTS - 1) {
        throw err;
      }
      const wait = Math.min(30_000, 2500 * 2 ** attempt);
      console.warn(
        `[wpFetch] transient error (attempt ${attempt + 1}/${WP_FETCH_MAX_ATTEMPTS}), retry in ${wait}ms:`,
        errorMessage(err)
      );
      await sleep(wait);
    }
  }
  throw lastErr;
}
