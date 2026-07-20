import type { ArticleDiscoveryPayload } from "@/lib/articleDiscoveryTypes";
import { GREEN_ORG_DISCOVERY_SOURCES } from "@/lib/rssFeeds";

type DiscoveryArticle = {
  title: string;
  url: string;
  source: string;
  pubDate: string;
};

const USER_AGENT = "SEO-Tools-Platform/1.0 (Green.org News Discovery)";

/** Keep raw pool slightly wider than 24h so clustering can find earlier breaks. */
const MAX_POOL_AGE_MS = 1000 * 60 * 60 * 36;
const MAX_PER_SOURCE = 25;
const MAX_TOTAL = 80;

function stripCdata(text: string): string {
  return text
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .trim();
}

function extractTagContent(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xml.match(regex);
  if (!match) return null;
  return stripCdata(match[1].trim());
}

function extractLink(itemXml: string): string | null {
  const linkContent = extractTagContent(itemXml, "link");
  if (linkContent && linkContent.startsWith("http")) return linkContent;
  const hrefMatch = itemXml.match(/<link[^>]+href=["']([^"']+)["']/i);
  return hrefMatch ? hrefMatch[1] : linkContent;
}

function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    for (const k of Array.from(u.searchParams.keys())) {
      if (/^utm_/i.test(k) || /^fbclid$/i.test(k) || /^gclid$/i.test(k)) {
        u.searchParams.delete(k);
      }
    }
    const s = u.toString();
    return s.endsWith("/") ? s.slice(0, -1) : s;
  } catch {
    return raw.trim();
  }
}

function parseTime(pubDate: string): number {
  if (!pubDate) return 0;
  const t = Date.parse(pubDate);
  return Number.isFinite(t) ? t : 0;
}

/** Skip photo credits, JS fragments, and other non-headline text. */
export function isPlausibleArticleTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 20 || t.length > 220) return false;
  if (/function\s+\w+|=>|{\s*const|onerror|removeAttribute/i.test(t)) return false;
  if (/^[\w.]+\/(Reuters|AP|Getty|WHOI)/i.test(t)) return false;
  if (/^[\w.]+\s*\/\s*(Reuters|AP|Getty)/i.test(t)) return false;
  if (/^\d+:\d+$/.test(t)) return false;
  if ((t.match(/\//g) ?? []).length >= 3 && t.length < 80) return false;
  return true;
}

function parseItemsFromXml(xml: string, source: string): DiscoveryArticle[] {
  const articles: DiscoveryArticle[] = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = extractTagContent(itemXml, "title");
    const url = extractLink(itemXml);
    const pubDate =
      extractTagContent(itemXml, "pubDate") ??
      extractTagContent(itemXml, "dc:date") ??
      extractTagContent(itemXml, "updated");
    if (title && url && isPlausibleArticleTitle(title)) {
      articles.push({
        title,
        url: canonicalizeUrl(url),
        source,
        pubDate: pubDate ?? "",
      });
    }
  }
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1];
    const title = extractTagContent(entryXml, "title");
    const url = extractLink(entryXml);
    const pubDate =
      extractTagContent(entryXml, "updated") ??
      extractTagContent(entryXml, "published") ??
      extractTagContent(entryXml, "pubDate") ??
      extractTagContent(entryXml, "dc:date");
    if (title && url && isPlausibleArticleTitle(title)) {
      articles.push({
        title,
        url: canonicalizeUrl(url),
        source,
        pubDate: pubDate ?? "",
      });
    }
  }
  return articles;
}

function titleFromEnnArticleUrl(url: string): string {
  const m = url.match(/\/articles\/\d+-([^/?#]+)/i);
  if (!m) return "ENN Article";
  const slug = m[1].replace(/-/g, " ").trim();
  return slug
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function parseEnnHtmlArticles(html: string, source: string): DiscoveryArticle[] {
  const byUrl = new Map<string, string>();
  const anchorRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRegex.exec(html)) !== null) {
    const hrefRaw = m[1] ?? "";
    let href = hrefRaw.trim();
    if (href.startsWith("/")) href = `https://www.enn.com${href}`;
    if (!/^https?:\/\/www\.enn\.com\/articles\/\d+-/i.test(href)) continue;
    const url = canonicalizeUrl(href);
    const text = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const generic = /^>{0,2}\s*read the full article/i.test(text) || /^read more$/i.test(text);
    const current = byUrl.get(url) ?? "";
    if (!generic && text.length > current.length) {
      byUrl.set(url, text);
    } else if (!byUrl.has(url)) {
      byUrl.set(url, "");
    }
  }
  const out: DiscoveryArticle[] = [];
  byUrl.forEach((title, url) => {
    out.push({
      title: title || titleFromEnnArticleUrl(url),
      url,
      source,
      pubDate: "",
    });
  });
  return out.slice(0, 40);
}

/** Generic HTML headline scrape for section pages (Guardian-style / Canary cards). */
function parseGenericHtmlArticles(html: string, source: string, baseHost: string): DiscoveryArticle[] {
  const out: DiscoveryArticle[] = [];
  const seen = new Set<string>();
  const anchorRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRegex.exec(html)) !== null) {
    const textRaw = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!isPlausibleArticleTitle(textRaw)) continue;
    let href = (m[1] ?? "").trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    if (href.startsWith("/")) {
      try {
        href = new URL(href, `https://${baseHost}`).toString();
      } catch {
        continue;
      }
    }
    if (!href.includes(baseHost)) continue;
    const url = canonicalizeUrl(href);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ title: textRaw, url, source, pubDate: "" });
    if (out.length >= 30) break;
  }
  return out;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isAllowedGreenOrgDiscoveryUrl(url: string): boolean {
  const host = hostFromUrl(url).toLowerCase();
  if (!host) return false;
  return GREEN_ORG_DISCOVERY_SOURCES.some((s) =>
    s.hostMatchers.some((m) => host === m || host.endsWith(`.${m}`))
  );
}

async function fetchFeed(feedUrl: string, source: string): Promise<DiscoveryArticle[]> {
  const res = await fetch(feedUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parseItemsFromXml(xml, source);
}

async function fetchHtmlFallback(
  htmlUrl: string,
  source: string
): Promise<DiscoveryArticle[]> {
  const res = await fetch(htmlUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (source === "ENN") return parseEnnHtmlArticles(html, source);
  const host = hostFromUrl(htmlUrl) || "example.com";
  return parseGenericHtmlArticles(html, source, host);
}

/** Google News RSS scoped to an outlet — used when native feeds are paywalled/blocked. */
async function fetchGoogleNewsFallback(
  query: string,
  source: string
): Promise<DiscoveryArticle[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const items = await fetchFeed(url, source);
  return items
    .map((a) => ({
      ...a,
      // Google News links redirect; keep title + pubDate for shortlist clustering.
      source,
    }))
    .filter((a) => isPlausibleArticleTitle(a.title));
}

/**
 * Pull recent headlines from the six Green.org discovery sources only.
 * Returns a raw pool (with pubDate when available) for the shortlist agent.
 */
export async function fetchDiscoveryArticlesFromRss(): Promise<ArticleDiscoveryPayload[]> {
  const bySource: Record<string, DiscoveryArticle[]> = {};
  const now = Date.now();

  for (const src of GREEN_ORG_DISCOVERY_SOURCES) {
    let articles: DiscoveryArticle[] = [];
    if (src.feedUrl) {
      try {
        articles = await fetchFeed(src.feedUrl, src.name);
      } catch (err) {
        console.error(`[article-discovery-rss] Feed ${src.name} failed:`, err);
      }
    }
    if (articles.length === 0 && src.googleNewsQuery) {
      try {
        articles = await fetchGoogleNewsFallback(src.googleNewsQuery, src.name);
      } catch (err) {
        console.error(`[article-discovery-rss] Google News ${src.name} failed:`, err);
      }
    }
    if (articles.length === 0 && src.htmlUrl) {
      try {
        articles = await fetchHtmlFallback(src.htmlUrl, src.name);
      } catch (err) {
        console.error(`[article-discovery-rss] HTML ${src.name} failed:`, err);
      }
    }

    bySource[src.name] = articles
      .filter((a) => {
        // Google News redirect URLs won't match hostMatchers — allow those from named fallbacks.
        const isGoogleNews = /news\.google\.com/i.test(a.url);
        if (a.url && !isGoogleNews && !isAllowedGreenOrgDiscoveryUrl(a.url)) return false;
        const t = parseTime(a.pubDate);
        if (t <= 0) return true;
        return now - t <= MAX_POOL_AGE_MS;
      })
      .sort((a, b) => parseTime(b.pubDate) - parseTime(a.pubDate))
      .slice(0, MAX_PER_SOURCE);
  }

  const result: DiscoveryArticle[] = [];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const pushUnique = (a: DiscoveryArticle) => {
    const u = canonicalizeUrl(a.url);
    const t = a.title.trim().toLowerCase();
    if (!u || seenUrls.has(u) || seenTitles.has(t)) return;
    seenUrls.add(u);
    seenTitles.add(t);
    result.push({ ...a, url: u });
  };

  // Round-robin so one outlet cannot dominate the pool.
  let added = true;
  let round = 0;
  while (added && result.length < MAX_TOTAL) {
    added = false;
    for (const src of GREEN_ORG_DISCOVERY_SOURCES) {
      const list = bySource[src.name] ?? [];
      if (round < list.length) {
        pushUnique(list[round]);
        added = true;
        if (result.length >= MAX_TOTAL) break;
      }
    }
    round += 1;
  }

  console.log(
    `[article-discovery-rss] Pool ${result.length} from six sources:`,
    GREEN_ORG_DISCOVERY_SOURCES.map((s) => `${s.name}=${(bySource[s.name] ?? []).length}`).join(", ")
  );

  return result.map(({ title, url, source, pubDate }) => ({
    title,
    url,
    source,
    pubDate: pubDate || undefined,
  }));
}
