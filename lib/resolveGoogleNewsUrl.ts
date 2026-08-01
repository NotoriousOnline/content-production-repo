/**
 * Resolve news.google.com/rss/articles/... redirects to publisher URLs.
 * Post-2024 Google News IDs are opaque; we fetch the splash page for a
 * signature/timestamp, then call Google's batchexecute Fbv4je RPC.
 */

const BATCH_EXECUTE_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function isGoogleNewsArticleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "news.google.com" &&
      /\/articles\//i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

function extractArticleId(articleUrl: string): string | null {
  try {
    const u = new URL(articleUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    // path like /rss/articles/CBMi... or /articles/CBMi...
    const artIdx = parts.lastIndexOf("articles");
    if (artIdx < 0 || artIdx >= parts.length - 1) return null;
    return parts[artIdx + 1].split("?")[0] || null;
  } catch {
    return null;
  }
}

/** Try legacy base64 protobuf embedding (pre–mid-2024). */
function tryDecodeEmbeddedUrl(articleId: string): string | null {
  try {
    const buf = Buffer.from(articleId, "base64");
    const text = buf.toString("utf8");
    const m = text.match(/https?:\/\/[^\s\x00-\x1f"<>]+/);
    if (!m) return null;
    const candidate = m[0].replace(/[\x00-\x1f]+$/g, "");
    if (!/^https?:\/\//i.test(candidate)) return null;
    // Reject if still google news
    if (/news\.google\.com/i.test(candidate)) return null;
    return candidate;
  } catch {
    return null;
  }
}

function parseBatchexecuteUrl(body: string): string | null {
  let text = body;
  if (text.startsWith(")]}'")) {
    text = text.split("\n").slice(1).join("\n");
  }
  text = text.trim();
  // Sometimes length-prefixed lines
  const firstNl = text.indexOf("\n");
  if (firstNl > 0 && /^\d+$/.test(text.slice(0, firstNl).trim())) {
    text = text.slice(firstNl + 1);
  }

  try {
    const envelopes = JSON.parse(text) as unknown;
    if (!Array.isArray(envelopes)) return null;
    for (const env of envelopes) {
      if (
        Array.isArray(env) &&
        env.length >= 3 &&
        env[0] === "wrb.fr" &&
        env[1] === "Fbv4je" &&
        typeof env[2] === "string"
      ) {
        const payload = JSON.parse(env[2]) as unknown;
        if (Array.isArray(payload) && payload[0] === "garturlres" && typeof payload[1] === "string") {
          return payload[1];
        }
      }
    }
  } catch {
    // fall through to string scrape
  }

  const header = '["garturlres","';
  const start = text.indexOf(header);
  if (start >= 0) {
    const from = start + header.length;
    const end = text.indexOf('"', from);
    if (end > from) {
      try {
        return JSON.parse(`"${text.slice(from, end)}"`) as string;
      } catch {
        return text.slice(from, end);
      }
    }
  }
  return null;
}

async function resolveViaBatchexecute(articleId: string): Promise<string | null> {
  // Prefer /articles/{id} with US locale — /rss/articles/... is less reliable for sig/ts.
  const splashUrl = `https://news.google.com/articles/${articleId}?hl=en-US&gl=US&ceid=US:en`;
  const pageRes = await fetch(splashUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!pageRes.ok) return null;

  // If Google already redirected to the publisher, use that.
  const finalUrl = pageRes.url;
  if (finalUrl && !/news\.google\.com/i.test(finalUrl) && /^https?:\/\//i.test(finalUrl)) {
    return finalUrl;
  }

  const pageText = await pageRes.text();
  const sig = pageText.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = pageText.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sig || !ts) return null;

  const rpcInner = JSON.stringify([
    "garturlreq",
    [
      ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
      "X",
      "X",
      1,
      [1, 1, 1],
      1,
      1,
      null,
      0,
      0,
      null,
      0,
    ],
    articleId,
    Number(ts),
    sig,
  ]);
  const fReq = JSON.stringify([[["Fbv4je", rpcInner, null, "generic"]]]);

  const postRes = await fetch(BATCH_EXECUTE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Referer: splashUrl,
      "User-Agent": USER_AGENT,
    },
    body: `f.req=${encodeURIComponent(fReq)}`,
    cache: "no-store",
  });
  if (!postRes.ok) return null;
  return parseBatchexecuteUrl(await postRes.text());
}

/**
 * Resolve a Google News article URL to the publisher URL.
 * Non-Google URLs are returned unchanged. On failure, returns the original URL.
 */
export async function resolveGoogleNewsUrl(rawUrl: string): Promise<string> {
  const url = rawUrl.trim();
  if (!isGoogleNewsArticleUrl(url)) return url;

  const articleId = extractArticleId(url);
  if (!articleId) return url;

  const embedded = tryDecodeEmbeddedUrl(articleId);
  if (embedded) return embedded;

  try {
    const resolved = await resolveViaBatchexecute(articleId);
    if (resolved && /^https?:\/\//i.test(resolved) && !/news\.google\.com/i.test(resolved)) {
      return resolved;
    }
  } catch (err) {
    console.error("[resolveGoogleNewsUrl] failed:", err);
  }
  return url;
}

/** Resolve many URLs with limited concurrency. */
export async function resolveGoogleNewsUrls(
  urls: string[],
  concurrency = 4
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)));
  let i = 0;
  async function worker() {
    while (i < unique.length) {
      const idx = i++;
      const u = unique[idx];
      out.set(u, await resolveGoogleNewsUrl(u));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, () => worker()));
  return out;
}
