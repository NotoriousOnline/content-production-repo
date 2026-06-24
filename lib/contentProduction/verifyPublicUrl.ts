import { wpFetch } from "@/lib/wpFetch";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function publicPageHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "User-Agent": UA,
    "Accept-Language": "en-US,en;q=0.9",
  };
  const cookie = (process.env.WORDPRESS_WAF_BYPASS_COOKIE ?? "").trim();
  if (cookie) h.Cookie = cookie;
  return h;
}

function looksLikeHardFailure(body: string): boolean {
  if (!body) return false;
  if (/just a moment|__cf_chl|challenge-platform/i.test(body)) return true;
  if (/<title>\s*404/i.test(body) || /page not found/i.test(body)) return true;
  return false;
}

/** True when the public URL responds without 404 / obvious not-found HTML. */
export async function verifyPublicUrl(url: string): Promise<boolean> {
  const headers = publicPageHeaders();
  try {
    let res = await wpFetch(url, {
      method: "HEAD",
      headers,
      redirect: "follow",
    });

    if (res.status === 404 || res.status === 410) return false;

    if (res.status === 405 || res.status === 501 || res.status === 403) {
      res = await wpFetch(url, {
        method: "GET",
        headers: { ...headers, Range: "bytes=0-2048" },
        redirect: "follow",
      });
    }

    if (res.status === 404 || res.status === 410) return false;

    const needsBody =
      res.status === 403 ||
      !res.ok ||
      res.headers.get("content-type")?.includes("text/html");
    if (needsBody) {
      const text = await res.text().catch(() => "");
      if (looksLikeHardFailure(text)) return false;
      if (res.status === 404 || res.status === 410) return false;
      return res.ok;
    }

    return res.ok || (res.status >= 300 && res.status < 400);
  } catch {
    return false;
  }
}

export async function filterVerifiedUrls(urls: string[], concurrency = 4): Promise<string[]> {
  const unique = Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)));
  const out: string[] = [];
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (url) => ({ url, ok: await verifyPublicUrl(url) }))
    );
    for (const r of results) {
      if (r.ok) out.push(r.url);
    }
  }
  return out;
}
