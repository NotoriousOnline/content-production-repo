/**
 * Ahrefs API v3 – Keywords Explorer + Site Explorer (server-side only).
 * Docs: https://docs.ahrefs.com/api/reference/keywords-explorer/get-matching-terms
 * Auth: Bearer token from Account → API keys.
 *
 * Matching terms needs a short search-like seed (2–4 words). Full article titles
 * usually return empty or only long-tail variants.
 */

const AHREFS_API_BASE = "https://api.ahrefs.com/v3";

export type AhrefsKeywordMetric = {
  keyword: string;
  volume: number | null;
};

export type AhrefsMatchingTermsResult =
  | { ok: true; rows: AhrefsKeywordMetric[] }
  | { ok: false; error: string };

export type AhrefsUrlMetrics = {
  orgTraffic: number;
  orgKeywords: number;
  orgKeywordsTop3: number;
};

export type AhrefsUrlMetricsResult =
  | { ok: true; metrics: AhrefsUrlMetrics }
  | { ok: false; error: string };

type AhrefsJsonResult = { ok: true; data: unknown } | { ok: false; error: string };

function parseRows(data: unknown): AhrefsKeywordMetric[] {
  const root = data as { keywords?: unknown };
  const arr = root.keywords;
  if (!Array.isArray(arr)) return [];

  const rows: AhrefsKeywordMetric[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const keyword = typeof o.keyword === "string" ? o.keyword.trim() : "";
    if (!keyword) continue;
    let volume: number | null = null;
    if (typeof o.volume === "number" && Number.isFinite(o.volume)) volume = o.volume;
    else if (typeof o.volume === "string" && o.volume !== "") {
      const n = Number(o.volume);
      if (Number.isFinite(n)) volume = n;
    }
    rows.push({ keyword, volume });
  }
  return rows;
}

function authErrorMessage(): string {
  return "Ahrefs rejected the key (401/403). Use an API key from app.ahrefs.com → Account → API keys (REST API). MCP-only tokens will not work.";
}

async function ahrefsRequest(
  apiKey: string,
  path: string,
  params: URLSearchParams
): Promise<AhrefsJsonResult> {
  const url = `${AHREFS_API_BASE}${path}?${params.toString()}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return {
        ok: false,
        error: `Invalid JSON from Ahrefs (HTTP ${res.status}). ${text.slice(0, 160)}`,
      };
    }

    if (!res.ok) {
      const msg =
        typeof (data as { error?: string }).error === "string"
          ? (data as { error: string }).error
          : text.slice(0, 240);
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: authErrorMessage() };
      }
      if (res.status === 429) {
        return { ok: false, error: "Ahrefs rate limit (429). Wait a minute and try again." };
      }
      return { ok: false, error: `Ahrefs HTTP ${res.status}: ${msg}` };
    }

    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Ahrefs request failed: ${msg}` };
  }
}

async function ahrefsGet(
  apiKey: string,
  path: string,
  params: URLSearchParams
): Promise<AhrefsMatchingTermsResult> {
  const result = await ahrefsRequest(apiKey, path, params);
  if (!result.ok) return result;
  const rows = parseRows(result.data);
  rows.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  return { ok: true, rows };
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseUrlMetrics(data: unknown): AhrefsUrlMetrics | null {
  const root = data as { metrics?: unknown };
  const raw = root.metrics && typeof root.metrics === "object" ? root.metrics : data;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const orgTraffic = asFiniteNumber(o.org_traffic);
  const orgKeywords = asFiniteNumber(o.org_keywords);
  const orgKeywordsTop3 = asFiniteNumber(o.org_keywords_1_3);
  if (orgTraffic === null && orgKeywords === null) return null;
  return {
    orgTraffic: orgTraffic ?? 0,
    orgKeywords: orgKeywords ?? 0,
    orgKeywordsTop3: orgKeywordsTop3 ?? 0,
  };
}

function metricsDateUtc(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function requireKeyAndSeed(
  apiKey: string,
  seedKeyword: string
): { ok: true; key: string; seed: string } | { ok: false; error: string } {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: "Missing API key" };
  const seed = seedKeyword.trim().replace(/,/g, " ").replace(/\s+/g, " ").slice(0, 120);
  if (!seed) return { ok: false, error: "Empty seed keyword" };
  return { ok: true, key, seed };
}

/**
 * Matching terms for a seed keyword, highest estimated monthly volume first.
 * Consumes Ahrefs API units; keep `limit` small.
 */
export async function fetchMatchingTermsByVolume(
  apiKey: string,
  options: {
    seedKeyword: string;
    /** ISO 3166-1 alpha-2 */
    country?: string;
    limit?: number;
  }
): Promise<AhrefsMatchingTermsResult> {
  const ready = requireKeyAndSeed(apiKey, options.seedKeyword);
  if (!ready.ok) return ready;

  const country = (options.country ?? "us").toLowerCase().slice(0, 2);
  const limit = Math.min(Math.max(options.limit ?? 20, 5), 50);

  const params = new URLSearchParams({
    select: "keyword,volume",
    country,
    keywords: ready.seed,
    limit: String(limit),
    order_by: "volume:desc",
    match_mode: "terms",
    terms: "all",
    output: "json",
  });

  return ahrefsGet(ready.key, "/keywords-explorer/matching-terms", params);
}

/** Exact keyword metrics (volume) for one or more seeds. */
export async function fetchKeywordOverview(
  apiKey: string,
  options: {
    keywords: string[];
    country?: string;
  }
): Promise<AhrefsMatchingTermsResult> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: "Missing API key" };

  const cleaned = options.keywords
    .map((k) => k.trim().replace(/,/g, " ").replace(/\s+/g, " ").slice(0, 80))
    .filter((k) => k.length >= 2)
    .slice(0, 8);
  if (cleaned.length === 0) return { ok: false, error: "Empty keyword list" };

  const country = (options.country ?? "us").toLowerCase().slice(0, 2);
  const params = new URLSearchParams({
    select: "keyword,volume",
    country,
    keywords: cleaned.join(","),
    output: "json",
  });

  return ahrefsGet(key, "/keywords-explorer/overview", params);
}

/**
 * Estimated monthly organic traffic and ranking keyword counts for a URL.
 * Uses Site Explorer exact-URL mode. New pages often return 0 until they rank.
 */
export async function fetchUrlOrganicMetrics(
  apiKey: string,
  options: {
    url: string;
    country?: string;
  }
): Promise<AhrefsUrlMetricsResult> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: "Missing API key" };

  let target = options.url.trim();
  try {
    const parsed = new URL(target);
    parsed.hash = "";
    for (const k of Array.from(parsed.searchParams.keys())) {
      if (/^utm_/i.test(k) || /^fbclid$/i.test(k) || /^gclid$/i.test(k)) {
        parsed.searchParams.delete(k);
      }
    }
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    target = parsed.toString();
  } catch {
    return { ok: false, error: "Invalid article URL" };
  }

  const country = (options.country ?? "us").toLowerCase().slice(0, 2);
  const dates = [1, 2, 7].map(metricsDateUtc);
  let lastError = "Ahrefs returned no URL metrics";

  for (const date of dates) {
    const params = new URLSearchParams({
      target,
      date,
      mode: "exact",
      country,
      volume_mode: "monthly",
      traffic_mode: "adaptive",
      output: "json",
    });
    const result = await ahrefsRequest(key, "/site-explorer/metrics", params);
    if (!result.ok) {
      lastError = result.error;
      if (result.error.includes("401") || result.error.includes("403") || result.error.includes("rejected")) {
        return result;
      }
      continue;
    }
    const metrics = parseUrlMetrics(result.data);
    if (metrics) return { ok: true, metrics };
  }

  return { ok: false, error: lastError };
}

export function isAhrefsConfigured(): boolean {
  return Boolean(process.env.AHREFS_API_KEY?.trim());
}
