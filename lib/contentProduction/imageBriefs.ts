import { isAnthropicBillingError } from "@/lib/anthropic";
import { callClaude } from "@/lib/anthropic";
import { errorMessage } from "@/lib/serverLog";

export type ImageBriefH2 = { h2Index: number; heading: string; contextSnippet: string };

export type ImageBriefPlan = {
  featured: { imagePrompt: string; altText: string; fileSlug: string };
  inContent: Array<{
    h2Index: number;
    imagePrompt: string;
    altText: string;
    fileSlug: string;
  }>;
  source: "claude" | "deterministic";
};

function sanitizeFileSlug(s: string): string {
  const t = s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 55);
  return t || "section-image";
}

function extractJson(text: string): unknown {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) cleaned = objMatch[0];
  cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(cleaned);
}

/** Build image prompts locally when Claude is unavailable (billing, overload, etc.). */
export function buildDeterministicImageBriefs(args: {
  title: string;
  keywords: string[];
  candidates: ImageBriefH2[];
  inContentTarget: number;
  styleGuideline: string;
  strainComparison?: boolean;
  strainPage?: boolean;
}): ImageBriefPlan {
  const { title, keywords, candidates, inContentTarget, styleGuideline, strainComparison, strainPage } = args;
  const kw = keywords.filter(Boolean).join(", ") || title;

  const featuredPrompt = strainPage
    ? `Strain-specific dried cannabis bud close-up for "${title}", rich trichomes and natural colour, warm ambient light, square composition, no white studio background, no smoke, no generic leaf graphics. ${styleGuideline}`
    : strainComparison
    ? `Editorial cannabis strain comparison for "${title}": two distinct dried flower samples side by side on a neutral surface, contrasting colors and textures, soft studio light, no text, no logos. ${styleGuideline}`
    : `Editorial hero photograph for "${title}" (${kw}), botanical still-life, professional lighting, no text overlays. ${styleGuideline}`;

  const scoreSection = (h: string) => {
    if (/key difference|vs|comparison/i.test(h)) return 0;
    if (/effect/i.test(h)) return 1;
    if (/what is/i.test(h)) return 2;
    if (/where to buy/i.test(h)) return 4;
    if (/buy.*seeds/i.test(h)) return 4.5;
    if (/better for/i.test(h)) return 3;
    return 5;
  };
  const sorted = [...candidates].sort((a, b) => scoreSection(a.heading) - scoreSection(b.heading));
  const terpeneSection = candidates.find((c) => /terpene/i.test(c.heading));
  const picked = strainPage && terpeneSection
    ? [terpeneSection]
    : sorted.slice(0, inContentTarget);

  return {
    source: "deterministic",
    featured: {
      imagePrompt: featuredPrompt,
      altText: `${title} featured image`.slice(0, 125),
      fileSlug: sanitizeFileSlug(title),
    },
    inContent: picked.map((sec) => ({
      h2Index: sec.h2Index,
      imagePrompt: strainPage
        ? `Terpene profile infographic for "${title}" section "${sec.heading}": three colour-coded terpene zones (green, red, yellow or blue, orange, purple per canonical system), clean flat graphic, no white studio background. ${styleGuideline}`
        : `Editorial photograph for section "${sec.heading}" in article "${title}". ${sec.contextSnippet.slice(0, 220)}. ${styleGuideline}`,
      altText: sec.heading.slice(0, 125),
      fileSlug: sanitizeFileSlug(sec.heading),
    })),
  };
}

function normalizeClaudeBriefs(
  parsed: {
    featured?: string | { imagePrompt?: string; altText?: string; fileSlug?: string };
    inContent?: Array<{
      h2Index?: number;
      imagePrompt?: string;
      altText?: string;
      fileSlug?: string;
    }>;
  },
  title: string,
  candidates: ImageBriefH2[],
  inContentTarget: number
): ImageBriefPlan {
  const featuredRaw = parsed.featured;
  let featuredPrompt: string;
  let featuredAlt: string;
  let featuredSlug: string;
  if (typeof featuredRaw === "string") {
    featuredPrompt = featuredRaw;
    featuredAlt = `${title.slice(0, 100)} featured image`.slice(0, 125);
    featuredSlug = sanitizeFileSlug(title);
  } else {
    featuredPrompt = featuredRaw?.imagePrompt ?? "Professional photograph representing the article theme.";
    featuredAlt = (featuredRaw?.altText ?? title).slice(0, 125);
    featuredSlug = sanitizeFileSlug(featuredRaw?.fileSlug ?? title);
  }

  const allowedIndices = new Set(candidates.map((c) => c.h2Index));
  const sectionByIndex = new Map(candidates.map((c) => [c.h2Index, c]));

  let inRows = Array.isArray(parsed.inContent) ? parsed.inContent : [];
  inRows = inRows.filter(
    (row) =>
      typeof row.h2Index === "number" &&
      allowedIndices.has(row.h2Index) &&
      typeof row.imagePrompt === "string"
  );
  const seen = new Set<number>();
  inRows = inRows.filter((row) => {
    if (seen.has(row.h2Index!)) return false;
    seen.add(row.h2Index!);
    return true;
  });
  inRows = inRows.slice(0, inContentTarget);

  return {
    source: "claude",
    featured: {
      imagePrompt: featuredPrompt,
      altText: featuredAlt,
      fileSlug: featuredSlug,
    },
    inContent: inRows.map((row) => {
      const sec = sectionByIndex.get(row.h2Index!);
      return {
        h2Index: row.h2Index!,
        imagePrompt: row.imagePrompt!,
        altText: (row.altText ?? sec?.heading ?? "Section illustration").slice(0, 125),
        fileSlug: sanitizeFileSlug(row.fileSlug ?? sec?.heading ?? `section-${row.h2Index}`),
      };
    }),
  };
}

/** Claude image briefs with automatic deterministic fallback (no extra API cost on billing errors). */
export async function resolveImageBriefs(args: {
  systemPrompt: string;
  userMessage: string;
  title: string;
  keywords: string[];
  candidates: ImageBriefH2[];
  inContentTarget: number;
  styleGuideline: string;
  strainComparison?: boolean;
  strainPage?: boolean;
}): Promise<ImageBriefPlan> {
  const fallback = () =>
    buildDeterministicImageBriefs({
      title: args.title,
      keywords: args.keywords,
      candidates: args.candidates,
      inContentTarget: args.inContentTarget,
      styleGuideline: args.styleGuideline,
      strainComparison: args.strainComparison,
      strainPage: args.strainPage,
    });

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.warn("[image-briefs] ANTHROPIC_API_KEY not set; using deterministic image prompts.");
    return fallback();
  }

  try {
    const raw = await callClaude(args.systemPrompt, args.userMessage, { maxTokens: 2048 });
    const parsed = extractJson(raw) as Parameters<typeof normalizeClaudeBriefs>[0];
    return normalizeClaudeBriefs(parsed, args.title, args.candidates, args.inContentTarget);
  } catch (err) {
    const reason = isAnthropicBillingError(err)
      ? "Anthropic billing/credits"
      : errorMessage(err);
    console.warn(`[image-briefs] Claude unavailable (${reason}); using deterministic image prompts.`);
    return fallback();
  }
}

