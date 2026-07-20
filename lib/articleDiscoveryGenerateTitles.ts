import { callClaude, isAnthropicBillingError } from "@/lib/anthropic";
import type {
  ArticleDiscoveryPayload,
  DiscoveryCandidate,
  TitleDiscoveryOutputItem,
} from "@/lib/articleDiscoveryTypes";
import { GREEN_ORG_CATEGORIES, type GreenOrgCategory } from "@/lib/rssFeeds";

const SYSTEM_PROMPT = `You are the news discovery agent for Green.org. Every morning you scan a fixed set of six sources, filter the day's stories against our editorial categories and freshness window, and return a clean shortlist of candidates. You do not pick the final two. You surface everything that qualifies so a human can choose.

## SOURCES (already fetched for you — do not invent outlets outside this list)

1. ENN (Environmental News Network)
2. Bloomberg Green
3. Reuters Environment — treat Reuters timestamps as the break-time of record when present
4. Carbon Brief
5. Canary Media
6. The Guardian Environment

## CATEGORIES

A story only qualifies if it maps cleanly to one of: Energy, Tech, Climate, Transportation.
Discard anything that does not map cleanly. Tag every survivor with its category.

## FRESHNESS RULE (hard filter)

News articles must be live on Green.org within 24 hours of the original story breaking to be eligible for Google News pickup. Only surface stories that can still be briefed, written, and published before the 24-hour mark from now.

- Find the earliest publish timestamp for the story across the provided items. Reuters is usually the truest break time when present.
- Calculate hours elapsed since that break time using the "now" timestamp supplied in the user message.
- Drop anything that cannot realistically be briefed, written, and published before break + 24h.
- Prefer stories that broke in the last few hours over ones already near the deadline.
- Never invent a timestamp. If you cannot confirm when a story broke, set freshness_risk true, put broke_at as "unconfirmed", hours_ago as null, and only keep the story if the source pubDate is missing but the item still looks same-day / urgent — otherwise drop it.

## SELECTION LOGIC

1. Cluster duplicate coverage of the same underlying story so it appears once, not per outlet.
2. Keep only stories that fit a category and pass the freshness rule.
3. Return every survivor as a shortlist, ordered strongest first. Do not trim to two. Do not choose the final two for the human.
4. Aim for 5–10 candidates on a busy day; on a slow day return whatever passes (even 2–3).

## WORKING TITLES

Keep working titles specific and factual. No health claims, no overstated superlatives.

## OUTPUT

Return ONLY valid JSON (no markdown fences, no preamble) in this exact shape:
{
  "candidates": [
    {
      "working_title": string,
      "category": "Energy" | "Tech" | "Climate" | "Transportation",
      "source_name": string,
      "source_url": string,
      "also_covered_by": string,
      "broke_at": string,
      "hours_ago": number | null,
      "deadline": string,
      "freshness_risk": boolean,
      "angle": string,
      "distribution_fit": string
    }
  ]
}

also_covered_by: "None" or a short comma-separated list of other outlets from the six that covered the same story.
distribution_fit: one of "LinkedIn", "social", "Saturday email", or a combination like "LinkedIn / social".
angle: one line on why this could work and how Green.org would frame it.
deadline: break time + 24h as a readable UTC string, or "unknown — freshness risk" when unconfirmed.
If a source_url is a news.google.com redirect, still use it, set source_name to the outlet (e.g. Reuters Environment), and prefer a direct outlet URL from another clustered item when available.`;

function buildUserPrompt(articles: ArticleDiscoveryPayload[], nowIso: string): string {
  const lines = articles.map((a, i) => {
    const pub = a.pubDate?.trim() ? a.pubDate.trim() : "unknown";
    return `${i + 1}. [${a.source}] ${a.title}
   URL: ${a.url}
   pubDate: ${pub}`;
  });

  return `Now (UTC): ${nowIso}

Scan these fetched items from the six Green.org sources. Apply category + freshness filters, cluster duplicates, and return the shortlist JSON.

Fetched items:
${lines.join("\n\n")}

IMPORTANT: Reply with a single JSON object only. No preamble, no markdown, no explanation. First character must be {`;
}

function stripCodeFences(content: string): string {
  return content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

/** Pull the first JSON object/array out of model prose (Claude often adds a preamble). */
function extractJsonPayload(content: string): string {
  const stripped = stripCodeFences(content.trim());
  if (stripped.startsWith("{") || stripped.startsWith("[")) return stripped;

  const objStart = stripped.indexOf("{");
  const objEnd = stripped.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    return stripped.slice(objStart, objEnd + 1);
  }

  const arrStart = stripped.indexOf("[");
  const arrEnd = stripped.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    return stripped.slice(arrStart, arrEnd + 1);
  }

  return stripped;
}

function isCategory(value: unknown): value is GreenOrgCategory {
  return typeof value === "string" && (GREEN_ORG_CATEGORIES as readonly string[]).includes(value);
}

function coerceCategory(value: unknown): GreenOrgCategory | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  const map: Record<string, GreenOrgCategory> = {
    energy: "Energy",
    tech: "Tech",
    technology: "Tech",
    climate: "Climate",
    transportation: "Transportation",
    transport: "Transportation",
  };
  return map[key] ?? (isCategory(value.trim()) ? (value.trim() as GreenOrgCategory) : null);
}

function normalizeCandidate(raw: Record<string, unknown>): DiscoveryCandidate | null {
  const working_title =
    typeof raw.working_title === "string"
      ? raw.working_title.trim()
      : typeof raw.suggested_title === "string"
        ? raw.suggested_title.trim()
        : "";
  const source_url = typeof raw.source_url === "string" ? raw.source_url.trim() : "";
  const source_name = typeof raw.source_name === "string" ? raw.source_name.trim() : "";
  const category = coerceCategory(raw.category);
  if (!working_title || !source_url || !source_name || !category) return null;

  const hoursRaw = raw.hours_ago;
  let hours_ago: number | null = null;
  if (typeof hoursRaw === "number" && Number.isFinite(hoursRaw)) {
    hours_ago = Math.round(hoursRaw * 10) / 10;
  } else if (typeof hoursRaw === "string" && hoursRaw.trim() && Number.isFinite(Number(hoursRaw))) {
    hours_ago = Math.round(Number(hoursRaw) * 10) / 10;
  } else if (hoursRaw === null) {
    hours_ago = null;
  }

  return {
    working_title,
    category,
    source_name,
    source_url,
    also_covered_by:
      typeof raw.also_covered_by === "string" && raw.also_covered_by.trim()
        ? raw.also_covered_by.trim()
        : "None",
    broke_at: typeof raw.broke_at === "string" && raw.broke_at.trim() ? raw.broke_at.trim() : "unconfirmed",
    hours_ago,
    deadline:
      typeof raw.deadline === "string" && raw.deadline.trim()
        ? raw.deadline.trim()
        : "unknown — freshness risk",
    freshness_risk: Boolean(raw.freshness_risk) || hours_ago === null,
    angle: typeof raw.angle === "string" && raw.angle.trim() ? raw.angle.trim() : "No angle provided.",
    distribution_fit:
      typeof raw.distribution_fit === "string" && raw.distribution_fit.trim()
        ? raw.distribution_fit.trim()
        : "social",
  };
}

function parseCandidatesJson(content: string): DiscoveryCandidate[] {
  const attempts = [
    extractJsonPayload(content),
    extractJsonPayload(content.replace(/^[\s\S]*?(\{[\s\S]*)$/, "$1")),
  ];

  let lastErr: unknown;
  for (const jsonStr of attempts) {
    try {
      const parsed = JSON.parse(jsonStr) as { candidates?: unknown[] } | unknown[];
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { candidates?: unknown[] }).candidates)
          ? (parsed as { candidates: unknown[] }).candidates
          : [];
      const out: DiscoveryCandidate[] = [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const c = normalizeCandidate(item as Record<string, unknown>);
        if (c) out.push(c);
      }
      return out;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Failed to parse shortlist JSON");
}

/** Drop candidates that clearly cannot publish inside 24h (hours_ago >= 23). */
function applyHardFreshnessCut(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  return candidates.filter((c) => {
    if (c.hours_ago === null) return c.freshness_risk; // keep flagged risks for human review only if model kept them
    // Need buffer to brief/write/publish — drop if already past ~22h
    return c.hours_ago < 22;
  });
}

function toOutputItems(candidates: DiscoveryCandidate[]): TitleDiscoveryOutputItem[] {
  return candidates.map((c) => ({
    suggested_title: c.working_title,
    source_title: c.working_title,
    source_url: c.source_url,
    source_name: c.source_name,
    category: c.category,
    also_covered_by: c.also_covered_by,
    broke_at: c.broke_at,
    hours_ago: c.hours_ago,
    deadline: c.deadline,
    freshness_risk: c.freshness_risk,
    angle: c.angle,
    distribution_fit: c.distribution_fit,
  }));
}

function isOpenAIQuotaError(status: number, body: string): boolean {
  if (status !== 429) return false;
  const lower = body.toLowerCase();
  return lower.includes("insufficient_quota") || lower.includes("exceeded your current quota");
}

async function shortlistWithOpenAI(
  apiKey: string,
  articles: ArticleDiscoveryPayload[],
  nowIso: string
): Promise<{ candidates: DiscoveryCandidate[] | null; quotaExceeded: boolean }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(articles, nowIso) },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[discovery-shortlist] OpenAI error:", res.status, errText.slice(0, 400));
    return { candidates: null, quotaExceeded: isOpenAIQuotaError(res.status, errText) };
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) return { candidates: null, quotaExceeded: false };

  try {
    return { candidates: parseCandidatesJson(content), quotaExceeded: false };
  } catch (err) {
    console.error("[discovery-shortlist] OpenAI JSON parse failed:", err, content.slice(0, 300));
    return { candidates: null, quotaExceeded: false };
  }
}

async function shortlistWithClaude(
  articles: ArticleDiscoveryPayload[],
  nowIso: string
): Promise<DiscoveryCandidate[] | null> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;
  const claudeSystem = `${SYSTEM_PROMPT}

CRITICAL OUTPUT RULE: Your entire response must be one JSON object matching the schema above. Do not say "I'll work through this" or any other prose. Do not use markdown fences. Start with { and end with }.`;
  try {
    const raw = await callClaude(claudeSystem, buildUserPrompt(articles, nowIso), {
      maxTokens: 8192,
    });
    const candidates = parseCandidatesJson(raw);
    if (candidates.length === 0) {
      console.error(
        "[discovery-shortlist] Claude returned parseable JSON but 0 candidates. Raw head:",
        raw.slice(0, 400)
      );
    }
    return candidates;
  } catch (err) {
    if (isAnthropicBillingError(err)) {
      console.error("[discovery-shortlist] Claude billing error");
    } else {
      console.error("[discovery-shortlist] Claude failed:", err);
    }
    return null;
  }
}

/** Prefer dated, fresher items so the model stays inside the 24h window. */
function prioritizeArticlesForShortlist(
  articles: ArticleDiscoveryPayload[],
  limit = 40
): ArticleDiscoveryPayload[] {
  const scored = articles.map((a) => {
    const t = a.pubDate ? Date.parse(a.pubDate) : 0;
    return { a, t: Number.isFinite(t) ? t : 0 };
  });
  scored.sort((x, y) => y.t - x.t);
  return scored.slice(0, limit).map((s) => s.a);
}

export type GenerateDiscoveryTitlesResult = {
  results: TitleDiscoveryOutputItem[];
  provider: "openai" | "claude" | "none";
  warning?: string;
  error?: string;
};

/**
 * Green.org news discovery shortlist — category + 24h freshness + duplicate clustering.
 * Returns candidates for a human to pick the final two (does not pick for them).
 */
export async function generateDiscoveryTitles(
  articles: ArticleDiscoveryPayload[]
): Promise<GenerateDiscoveryTitlesResult> {
  if (articles.length === 0) {
    return { results: [], provider: "none" };
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  if (!openaiKey && !hasClaude) {
    return {
      results: [],
      provider: "none",
      error: "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env.local.",
    };
  }

  const nowIso = new Date().toISOString();
  const pool = prioritizeArticlesForShortlist(articles, 40);
  let candidates: DiscoveryCandidate[] | null = null;
  let provider: "openai" | "claude" | "none" = "none";
  let openaiQuotaHit = false;
  let warning: string | undefined;

  // Prefer Claude for batch shortlist — OpenAI is often quota-limited in this project.
  if (hasClaude) {
    candidates = await shortlistWithClaude(pool, nowIso);
    if (candidates && candidates.length > 0) provider = "claude";
  }

  if ((!candidates || candidates.length === 0) && openaiKey) {
    const { candidates: fromOpenAI, quotaExceeded } = await shortlistWithOpenAI(
      openaiKey,
      pool,
      nowIso
    );
    if (quotaExceeded) {
      openaiQuotaHit = true;
    } else if (fromOpenAI && fromOpenAI.length > 0) {
      candidates = fromOpenAI;
      provider = "openai";
    }
  }

  if (!candidates || candidates.length === 0) {
    if (openaiQuotaHit && !hasClaude) {
      return {
        results: [],
        provider: "none",
        error:
          "OpenAI quota exceeded. Add credits at platform.openai.com or set ANTHROPIC_API_KEY for Claude fallback.",
      };
    }
    return {
      results: [],
      provider: hasClaude ? "claude" : openaiKey ? "openai" : "none",
      error:
        "No qualifying stories found (or shortlist generation failed). Check feeds, freshness window, and API keys.",
    };
  }

  const filtered = applyHardFreshnessCut(candidates);
  if (filtered.length === 0) {
    return {
      results: [],
      provider,
      error: "Stories were found but none remain publishable inside the 24-hour Google News window.",
    };
  }

  if (openaiQuotaHit && provider === "claude") {
    warning = "OpenAI quota exceeded — shortlist used Claude (Anthropic).";
  }

  return {
    results: toOutputItems(filtered),
    provider,
    ...(warning ? { warning } : {}),
  };
}
