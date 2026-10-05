import {
  fetchKeywordOverview,
  fetchMatchingTermsByVolume,
  fetchUrlOrganicMetrics,
  isAhrefsConfigured,
  type AhrefsKeywordMetric,
} from "@/lib/ahrefsClient";
import { deriveAhrefsSeedQueue } from "@/lib/contentProduction/ahrefsHighVolumeKeywords";
import type {
  ArticleDiscoveryAhrefsData,
  ArticleDiscoveryPayload,
  TitleDiscoveryOutputItem,
} from "@/lib/articleDiscoveryTypes";

const COUNTRY = () =>
  (process.env.AHREFS_KEYWORD_COUNTRY ?? "us").trim().toLowerCase().slice(0, 2) || "us";

const MAX_TERMS = 6;
const PREFETCH_BATCH = 8;
const ENRICH_CONCURRENCY = 2;
const WEAK_VOLUME = 50;

function emptyAhrefs(error: string | null, enabled: boolean): ArticleDiscoveryAhrefsData {
  return {
    enabled,
    country: COUNTRY(),
    orgTraffic: null,
    orgKeywords: null,
    orgKeywordsTop3: null,
    topicVolume: null,
    seed: null,
    terms: [],
    error,
  };
}

export function formatAhrefsCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return Math.round(n).toLocaleString("en-US");
}

export function ahrefsTrafficScore(data: ArticleDiscoveryAhrefsData | undefined): number {
  if (!data) return 0;
  return (data.orgTraffic ?? 0) * 50 + (data.topicVolume ?? 0);
}

export function sortByAhrefsTraffic(items: TitleDiscoveryOutputItem[]): TitleDiscoveryOutputItem[] {
  return [...items].sort((a, b) => ahrefsTrafficScore(b.ahrefs) - ahrefsTrafficScore(a.ahrefs));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function volumeFromRows(rows: AhrefsKeywordMetric[]): number | null {
  const top = rows[0]?.volume;
  return typeof top === "number" && Number.isFinite(top) ? top : null;
}

/**
 * Cheap volume ranking for the RSS/Inoreader pool so high-demand topics reach the shortlist first.
 */
export async function rankPoolByAhrefsVolume(
  articles: ArticleDiscoveryPayload[]
): Promise<{ articles: ArticleDiscoveryPayload[]; warning?: string }> {
  const apiKey = process.env.AHREFS_API_KEY?.trim() ?? "";
  if (!apiKey || articles.length === 0) return { articles };

  const country = COUNTRY();
  const seedByIndex = articles.map((a) => deriveAhrefsSeedQueue(a.title)[0] ?? "");
  const uniqueSeeds = [...new Set(seedByIndex.filter(Boolean))];
  const volumeBySeed = new Map<string, number>();
  let lastError: string | undefined;

  for (let i = 0; i < uniqueSeeds.length; i += PREFETCH_BATCH) {
    const batch = uniqueSeeds.slice(i, i + PREFETCH_BATCH);
    const overview = await fetchKeywordOverview(apiKey, { keywords: batch, country });
    if (!overview.ok) {
      lastError = overview.error;
      continue;
    }
    for (const row of overview.rows) {
      volumeBySeed.set(row.keyword.toLowerCase(), row.volume ?? 0);
    }
  }

  if (volumeBySeed.size === 0) {
    return lastError
      ? { articles, warning: `Ahrefs topic ranking skipped: ${lastError}` }
      : { articles };
  }

  const scored = articles.map((article, index) => {
    const seed = seedByIndex[index];
    const volume = seed ? (volumeBySeed.get(seed.toLowerCase()) ?? 0) : 0;
    const recency = article.pubDate ? Date.parse(article.pubDate) : 0;
    return { article, volume, recency: Number.isFinite(recency) ? recency : 0 };
  });
  scored.sort((a, b) => b.volume - a.volume || b.recency - a.recency);
  return { articles: scored.map((s) => s.article) };
}

async function fetchAhrefsForCandidate(
  title: string,
  url: string
): Promise<ArticleDiscoveryAhrefsData> {
  const apiKey = process.env.AHREFS_API_KEY?.trim() ?? "";
  const country = COUNTRY();
  if (!apiKey) return emptyAhrefs("AHREFS_API_KEY is not set", false);

  const seeds = deriveAhrefsSeedQueue(title).slice(0, 2);
  const terms: AhrefsKeywordMetric[] = [];
  let seedUsed: string | null = null;
  let lastError: string | null = null;

  for (const seed of seeds) {
    const matching = await fetchMatchingTermsByVolume(apiKey, {
      seedKeyword: seed,
      country,
      limit: 10,
    });
    if (!matching.ok) {
      lastError = matching.error;
      continue;
    }
    seedUsed = seedUsed ?? seed;
    terms.push(...matching.rows);
    if ((matching.rows[0]?.volume ?? 0) >= WEAK_VOLUME) {
      seedUsed = seed;
      break;
    }
  }

  const [urlMetrics] = await Promise.all([
    url.trim() ? fetchUrlOrganicMetrics(apiKey, { url, country }) : Promise.resolve({ ok: false as const, error: "Missing URL" }),
  ]);

  const uniqueTerms = new Map<string, AhrefsKeywordMetric>();
  for (const row of terms) {
    const key = row.keyword.toLowerCase();
    const prev = uniqueTerms.get(key);
    if (!prev || (row.volume ?? 0) > (prev.volume ?? 0)) uniqueTerms.set(key, row);
  }
  const rankedTerms = [...uniqueTerms.values()]
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, MAX_TERMS);

  const orgTraffic = urlMetrics.ok ? urlMetrics.metrics.orgTraffic : null;
  const orgKeywords = urlMetrics.ok ? urlMetrics.metrics.orgKeywords : null;
  const orgKeywordsTop3 = urlMetrics.ok ? urlMetrics.metrics.orgKeywordsTop3 : null;
  const topicVolume = volumeFromRows(rankedTerms);

  if (!urlMetrics.ok && rankedTerms.length === 0) {
    return emptyAhrefs(lastError ?? urlMetrics.error, true);
  }

  return {
    enabled: true,
    country,
    orgTraffic,
    orgKeywords,
    orgKeywordsTop3,
    topicVolume,
    seed: seedUsed,
    terms: rankedTerms,
    error: rankedTerms.length === 0 ? lastError : urlMetrics.ok ? null : urlMetrics.error,
  };
}

/** Attach Ahrefs traffic/volume to each shortlisted story and sort highest first. */
export async function enrichDiscoveryWithAhrefs(
  items: TitleDiscoveryOutputItem[]
): Promise<{ items: TitleDiscoveryOutputItem[]; warning?: string }> {
  if (items.length === 0) return { items };
  if (!isAhrefsConfigured()) {
    return {
      items: items.map((item) => ({ ...item, ahrefs: emptyAhrefs("AHREFS_API_KEY is not set", false) })),
    };
  }

  let failures = 0;
  const enriched = await mapWithConcurrency(items, ENRICH_CONCURRENCY, async (item) => {
    try {
      const ahrefs = await fetchAhrefsForCandidate(item.suggested_title || item.source_title, item.source_url);
      if (ahrefs.error && ahrefs.orgTraffic == null && ahrefs.terms.length === 0) failures += 1;
      return { ...item, ahrefs };
    } catch (err) {
      failures += 1;
      const message = err instanceof Error ? err.message : String(err);
      return { ...item, ahrefs: emptyAhrefs(message, true) };
    }
  });

  const sorted = sortByAhrefsTraffic(enriched);
  if (failures === items.length) {
    return {
      items: sorted,
      warning: sorted[0]?.ahrefs?.error
        ? `Ahrefs traffic data unavailable: ${sorted[0].ahrefs.error}`
        : "Ahrefs traffic data unavailable for this run.",
    };
  }
  return { items: sorted };
}
