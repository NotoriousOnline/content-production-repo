import {
  fetchKeywordOverview,
  fetchMatchingTermsByVolume,
  type AhrefsKeywordMetric,
} from "@/lib/ahrefsClient";

const MIN_VOLUME = 10;
const MAX_PHRASE_WORDS = 6;
const MAX_TERMS = 10;
const WEAK_TOP_VOLUME = 100;
const MAX_SEED_ATTEMPTS = 4;

const TITLE_FLUFF = [
  "what the research says",
  "according to experts",
  "according to science",
  "everything you need to know",
  "a complete guide",
  "the complete guide",
  "complete guide",
  "ultimate guide",
  "beginners guide",
  "beginner s guide",
  "explained simply",
  "explained",
];

const EDGE_STOP = new Set([
  "the",
  "a",
  "an",
  "in",
  "on",
  "of",
  "for",
  "to",
  "and",
  "or",
  "vs",
  "versus",
  "with",
  "from",
  "by",
  "about",
  "into",
  "after",
  "before",
  "during",
  "over",
  "under",
  "as",
  "at",
  "than",
  "then",
  "that",
  "this",
  "these",
  "those",
  "not",
  "just",
  "still",
  "also",
  "up",
  "out",
  "off",
  "down",
]);

const LEAD_QUESTION = new Set([
  "are",
  "is",
  "was",
  "were",
  "do",
  "does",
  "did",
  "can",
  "could",
  "should",
  "would",
  "will",
  "what",
  "why",
  "how",
  "when",
  "where",
  "which",
  "who",
]);

const SKIP_CONTENT_WORDS = new Set([
  "launch",
  "launches",
  "make",
  "get",
  "take",
  "give",
  "find",
  "use",
  "start",
  "create",
  "build",
  "help",
  "need",
  "want",
  "show",
  "know",
  "says",
  "say",
  "announce",
  "announces",
  "keep",
  "keeps",
  "kept",
  "stay",
  "stays",
  "remain",
  "remains",
  "going",
  "higher",
  "lower",
  "longer",
  "shorter",
  "more",
  "less",
]);

export type HighVolumeKeywordsResult =
  | {
      ok: true;
      enabled: boolean;
      terms: AhrefsKeywordMetric[];
      seedUsed: string | null;
      country: string;
    }
  | {
      ok: false;
      enabled: boolean;
      terms: AhrefsKeywordMetric[];
      seedUsed: string | null;
      country: string;
      error: string;
    };

function normalizeSeed(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/,/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function usableSeed(seed: string): boolean {
  if (seed.length < 3) return false;
  const words = seed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return seed.length >= 5;
  return words.length <= MAX_PHRASE_WORDS;
}

function seedsFromTitle(title: string): string[] {
  let t = normalizeSeed(title);
  t = t.replace(/\b(20\d{2}|19\d{2})\b/g, " ");
  for (const fluff of TITLE_FLUFF) {
    t = t.replace(new RegExp(`\\b${fluff}\\b`, "g"), " ");
  }
  t = t.replace(/\s+/g, " ").trim();

  const words = t
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !LEAD_QUESTION.has(w) && !SKIP_CONTENT_WORDS.has(w));

  const runs: string[][] = [];
  let current: string[] = [];
  for (const word of words) {
    if (EDGE_STOP.has(word) || word.length <= 1) {
      if (current.length >= 2) runs.push(current);
      current = [];
      continue;
    }
    current.push(word);
  }
  if (current.length >= 2) runs.push(current);

  const out: string[] = [];
  const add = (parts: string[]) => {
    const s = parts.join(" ").trim();
    if (usableSeed(s) && !out.includes(s)) out.push(s);
  };

  for (const run of runs) {
    for (let i = 0; i + 1 < run.length; i++) add(run.slice(i, i + 2));
  }
  for (const run of runs) {
    for (let i = 0; i + 2 < run.length; i++) add(run.slice(i, i + 3));
  }

  return out;
}

export function deriveAhrefsSeedQueue(title: string, existingKeywords: string[] = []): string[] {
  const queue: string[] = [];
  const add = (raw: string, requirePhrase: boolean) => {
    const seed = normalizeSeed(raw);
    if (!seed || queue.includes(seed)) return;
    const words = seed.split(/\s+/).filter(Boolean);
    if (words.length > MAX_PHRASE_WORDS) return;
    if (requirePhrase && words.length < 2) return;
    if (!requirePhrase && seed.length < 3) return;
    if (words.length === 1 && seed.length < 3) return;
    queue.push(seed);
  };

  for (const k of existingKeywords.slice(0, 3)) add(k, false);
  for (const seed of seedsFromTitle(title)) add(seed, true);
  return queue.slice(0, 6);
}

const SKIP_PHRASE = /\b(near me|nearby|for sale|in stock|coupon|promo code|discount code)\b/i;

function mergeMetricRows(rows: AhrefsKeywordMetric[]): AhrefsKeywordMetric[] {
  const byKey = new Map<string, AhrefsKeywordMetric>();
  for (const row of rows) {
    const keyword = row.keyword.trim();
    if (!keyword) continue;
    if (SKIP_PHRASE.test(keyword)) continue;
    const words = keyword.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > MAX_PHRASE_WORDS) continue;
    const volume = row.volume ?? 0;
    if (volume < MIN_VOLUME) continue;
    const key = keyword.toLowerCase();
    const prev = byKey.get(key);
    if (!prev || volume > (prev.volume ?? 0)) {
      byKey.set(key, { keyword, volume });
    }
  }
  return [...byKey.values()].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, MAX_TERMS);
}

function isWeakMatching(rows: AhrefsKeywordMetric[]): boolean {
  if (rows.length === 0) return true;
  return (rows[0]?.volume ?? 0) < WEAK_TOP_VOLUME;
}

export function mergeKeywordLists(ahrefsList: string[], extraList: string[], maxTotal: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of [...ahrefsList, ...extraList]) {
    const t = k.trim();
    if (!t) continue;
    const low = t.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(t);
    if (out.length >= maxTotal) break;
  }
  return out;
}

export function formatAhrefsPromptBlock(terms: AhrefsKeywordMetric[], country: string): string {
  if (terms.length === 0) return "";
  const lines = terms
    .slice(0, 8)
    .map((t) => {
      const vol = typeof t.volume === "number" ? t.volume.toLocaleString("en-US") : "n/a";
      return `- ${t.keyword} (${vol}/mo)`;
    })
    .join("\n");
  const primary = terms[0]?.keyword ?? "";
  return `HIGH-VOLUME KEYWORDS from Ahrefs Keywords Explorer (${country.toUpperCase()} monthly search volume). Weave these naturally into body copy and FAQ answers. Do not keyword-stuff. Do not put these exact phrases in headings. Do not force the primary phrase into the first sentence of the intro.
Primary phrase (use once or twice naturally after the opening): ${primary}
Also include 2-4 of these where they fit:
${lines}`;
}

export async function fetchHighVolumeKeywordsForArticle(options: {
  title: string;
  existingKeywords?: string[];
}): Promise<HighVolumeKeywordsResult> {
  const country = (process.env.AHREFS_KEYWORD_COUNTRY ?? "us").trim().toLowerCase().slice(0, 2) || "us";
  const apiKey = process.env.AHREFS_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return { ok: false, enabled: false, terms: [], seedUsed: null, country, error: "AHREFS_API_KEY is not set" };
  }

  const seeds = deriveAhrefsSeedQueue(options.title, options.existingKeywords ?? []);
  if (seeds.length === 0) {
    return { ok: false, enabled: true, terms: [], seedUsed: null, country, error: "No usable seed keyword from title" };
  }

  const collected: AhrefsKeywordMetric[] = [];
  let seedUsed: string | null = null;
  let lastError: string | undefined;

  for (const seed of seeds.slice(0, MAX_SEED_ATTEMPTS)) {
    const matching = await fetchMatchingTermsByVolume(apiKey, {
      seedKeyword: seed,
      country,
      limit: 20,
    });
    if (!matching.ok) {
      lastError = matching.error;
      continue;
    }
    seedUsed = seedUsed ?? seed;
    collected.push(...matching.rows);
    if (!isWeakMatching(matching.rows)) {
      seedUsed = seed;
      break;
    }
  }

  const overviewSeeds = (seedUsed ? [seedUsed, ...seeds.filter((s) => s !== seedUsed)] : seeds).slice(0, 2);
  const overview = await fetchKeywordOverview(apiKey, { keywords: overviewSeeds, country });
  if (overview.ok) collected.push(...overview.rows);
  else if (!lastError) lastError = overview.error;

  const terms = mergeMetricRows(collected);
  if (terms.length > 0) {
    return { ok: true, enabled: true, terms, seedUsed, country };
  }

  return {
    ok: false,
    enabled: true,
    terms: [],
    seedUsed,
    country,
    error: lastError ?? "Ahrefs returned no high-volume terms for this title",
  };
}
