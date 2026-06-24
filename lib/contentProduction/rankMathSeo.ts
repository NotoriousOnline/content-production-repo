import { callClaude } from "@/lib/anthropic";

/** Rank Math focus keyword from post title (Weed.com convention). */
export function rankMathFocusKeywordFromTitle(postTitle: string): string {
  const t = typeof postTitle === "string" ? postTitle.trim() : "";
  return t.length > 0 ? t.slice(0, 191) : "";
}

export function buildMetaDescriptionFromPlainText(text: string, maxLen = 156): string {
  const plain = text.replace(/\s+/g, " ").trim();
  if (plain.length <= maxLen) return plain;
  const cut = plain.slice(0, maxLen - 3);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}...`;
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

export type ProposedRankMathSeo = {
  focusKeyword: string;
  metaDescription: string;
};

/** Claude proposes a SERP meta description; focus keyword defaults to post title. */
export async function proposeRankMathSeoForWeedPost(input: {
  title: string;
  url: string;
  excerptPlain: string;
  contentPlain: string;
}): Promise<ProposedRankMathSeo> {
  const focusKeyword = rankMathFocusKeywordFromTitle(input.title);
  const context = [input.excerptPlain, input.contentPlain].filter(Boolean).join("\n\n").slice(0, 3500);

  const fallback = buildMetaDescriptionFromPlainText(
    context || input.title,
    156
  );

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return { focusKeyword, metaDescription: fallback };
  }

  const system = `You write Rank Math SEO snippets for Weed.com (cannabis education, strains, products).
Return ONLY valid JSON: {"metaDescription":"..."}
Rules:
- metaDescription: 140-156 characters, compelling SERP snippet, informational tone, adults 21+, no medical claims, no em dash (U+2014)
- Do not include focusKeyword in JSON (caller sets it from the post title)`;

  const user = `Post title: ${input.title}
URL: ${input.url}

Content excerpt:
${context || "(no body text — use title only)"}`;

  try {
    const raw = await callClaude(system, user, { maxTokens: 512 });
    const parsed = extractJson(raw) as { metaDescription?: string };
    const metaDescription =
      typeof parsed.metaDescription === "string" && parsed.metaDescription.trim().length > 20
        ? parsed.metaDescription.trim().slice(0, 320)
        : fallback;
    return { focusKeyword, metaDescription };
  } catch {
    return { focusKeyword, metaDescription: fallback };
  }
}
