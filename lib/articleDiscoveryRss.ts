import type { ArticleDiscoveryPayload } from "@/lib/articleDiscoveryTypes";
import { HTML_DISCOVERY_SOURCES, RSS_FEEDS } from "@/lib/rssFeeds";

type DiscoveryArticle = {
  title: string;
  url: string;
  source: string;
  pubDate: string;
};

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

function parseItemsFromXml(xml: string, source: string): DiscoveryArticle[] {
  const articles: DiscoveryArticle[] = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = extractTagContent(itemXml, "title");
    const url = extractLink(itemXml);
    const pubDate = extractTagContent(itemXml, "pubDate");
    if (title && url) {
      articles.push({
        title,
        url: canonicalizeUrl(url),
        source,
        pubDate: pubDate ?? "",
      });
    }
  }
  // Atom support (<entry>) for feeds that aren't RSS <item>.
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1];
    const title = extractTagContent(entryXml, "title");
    const url = extractLink(entryXml);
    const pubDate =
      extractTagContent(entryXml, "updated") ??
      extractTagContent(entryXml, "published") ??
      extractTagContent(entryXml, "pubDate");
    if (title && url) {
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
  for (const [url, title] of byUrl) {
    out.push({
      title: title || titleFromEnnArticleUrl(url),
      url,
      source,
      pubDate: "",
    });
  }
  return out.slice(0, 40);
}

function parseCnnHtmlArticles(html: string, source: string): DiscoveryArticle[] {
  const out: DiscoveryArticle[] = [];
  const seen = new Set<string>();
  const anchorRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRegex.exec(html)) !== null) {
    const hrefRaw = m[1] ?? "";
    const textRaw = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!hrefRaw || !textRaw) continue;
    let href = hrefRaw.trim();
    if (href.startsWith("/")) href = `https://www.cnn.com${href}`;
    if (!/^https?:\/\/(www\.)?cnn\.com\//i.test(href)) continue;
    // Keep real article URLs and avoid navigation/index pages.
    if (!/\/\d{4}\/\d{2}\/\d{2}\//.test(href)) continue;
    if (textRaw.length < 24) continue;
    const url = canonicalizeUrl(href);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ title: textRaw, url, source, pubDate: "" });
    if (out.length >= 30) break;
  }
  return out;
}

const PRIORITY_FEEDS = [
  "ENN",
  "ENN Climate",
  "ENN Energy",
  "ENN Pollution",
  "ENN Ecosystems",
  "ENN Wildlife",
  "ENN Policy",
  "The Guardian Environment",
  "CNN Climate",
  "CNN Energy",
];

/** Same pool logic as the original Article Title Discovery RSS fetcher. */
export async function fetchDiscoveryArticlesFromRss(): Promise<ArticleDiscoveryPayload[]> {
  const bySource: Record<string, DiscoveryArticle[]> = {};
  const now = Date.now();
  const maxAgeMs = 1000 * 60 * 60 * 24 * 10; // keep articles from the last 10 days

  const fetchOrder = [
    ...RSS_FEEDS.filter((f) => PRIORITY_FEEDS.includes(f.name)),
    ...RSS_FEEDS.filter((f) => !PRIORITY_FEEDS.includes(f.name)),
  ];

  for (const feed of fetchOrder) {
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "SEO-Tools-Platform/1.0" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const articles = parseItemsFromXml(xml, feed.name);
      bySource[feed.name] = articles
        .filter((a) => {
          const t = parseTime(a.pubDate);
          if (t <= 0) return true;
          return now - t <= maxAgeMs;
        })
        .sort((a, b) => parseTime(b.pubDate) - parseTime(a.pubDate));
    } catch (err) {
      console.error(`[article-discovery-rss] Feed ${feed.name} failed:`, err);
    }
  }
  for (const src of HTML_DISCOVERY_SOURCES) {
    try {
      const res = await fetch(src.url, {
        headers: { "User-Agent": "SEO-Tools-Platform/1.0", Accept: "text/html" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      bySource[src.name] =
        (src as { parser?: string }).parser === "enn"
          ? parseEnnHtmlArticles(html, src.name)
          : parseCnnHtmlArticles(html, src.name);
    } catch (err) {
      console.error(`[article-discovery-rss] HTML source ${src.name} failed:`, err);
    }
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
  const addFrom = (source: string, max: number) => {
    const articles = bySource[source] ?? [];
    for (let i = 0; i < Math.min(max, articles.length) && result.length < 20; i++) {
      pushUnique(articles[i]);
    }
  };

  // ENN is the priority site: take more from ENN section pages first.
  addFrom("ENN Climate", 4);
  addFrom("ENN Energy", 4);
  addFrom("ENN Pollution", 3);
  addFrom("ENN Ecosystems", 2);
  addFrom("ENN Wildlife", 2);
  addFrom("ENN Policy", 2);
  addFrom("ENN", 6);
  addFrom("CNN Climate", 6);
  addFrom("CNN Energy", 6);
  addFrom("The Guardian Environment", 10);
  const others = Object.entries(bySource)
    .filter(([name]) => !PRIORITY_FEEDS.includes(name))
    .flatMap(([, articles]) => articles)
    .sort((a, b) => {
      const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return dateB - dateA;
    });
  for (const a of others) {
    if (result.length >= 20) break;
    pushUnique(a);
  }

  return result.slice(0, 20).map(({ title, url, source }) => ({ title, url, source }));
}
