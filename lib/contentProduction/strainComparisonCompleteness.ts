import { callClaude } from "@/lib/anthropic";
import { errorMessage } from "@/lib/serverLog";
import {
  STRAIN_COMPARISON_FAQ_MAX,
  STRAIN_COMPARISON_FAQ_MIN,
  STRAIN_COMPARISON_WORD_MAX,
  STRAIN_COMPARISON_WORD_MIN,
  formatStrainLabel,
  strainComparisonSystemPrompt,
  type StrainComparisonOutline,
} from "@/lib/contentProduction/strainComparison";
import { countCompleteWeedFaqPairs, extractWeedFaqSection } from "@/lib/contentProduction/weedLearnCompleteness";
import { countAllowlistedLinks } from "@/lib/contentProduction/strainComparisonLinks";

export const STRAIN_COMPARISON_MIN_INTERNAL_LINKS = 3;

export type StrainComparisonAudit = {
  needsRepair: boolean;
  reasons: string[];
  wordCount: number;
  faqPairs: number;
  hasComparisonTable: boolean;
  internalLinkCount: number;
};

function countWordsFromHtml(html: string): number {
  const plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-zA-Z0-9#]+;/g, " ");
  return plain.split(/\s+/).filter(Boolean).length;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countH2(html: string): number {
  return (html.match(/<h2\b/gi) ?? []).length;
}

/** Soft checks — do not force stock "What Is / Effects Comparison" template headings. */
function hasCoreStructuralGaps(html: string, strainA: string, strainB: string): string[] {
  const missing: string[] = [];
  const labelA = formatStrainLabel(strainA);
  const labelB = formatStrainLabel(strainB);
  const plain = html.replace(/<[^>]+>/g, " ");

  if (countH2(html) < 3) missing.push("too few H2 sections");
  if (!new RegExp(escapeRegex(labelA), "i").test(plain)) missing.push(`missing ${labelA} in body`);
  if (!new RegExp(escapeRegex(labelB), "i").test(plain)) missing.push(`missing ${labelB} in body`);
  if (!/<h2[^>]*>\s*Frequently asked questions\s*<\/h2>/i.test(html)) missing.push("FAQ");
  if (!/where to buy|shop|buy .{0,80}strain/i.test(plain)) missing.push("buy/CTA section");
  return missing;
}

function missingOutlineHeadings(html: string, outline?: StrainComparisonOutline | null): string[] {
  if (!outline?.structure?.length) return [];
  const missing: string[] = [];
  for (const section of outline.structure.slice(0, 6)) {
    const heading = section.heading.trim();
    if (heading.length < 4) continue;
    // Allow minor punctuation/spacing drift; require core heading words.
    const core = heading
      .replace(/[—–-]/g, " ")
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 5);
    if (core.length === 0) continue;
    const re = new RegExp(core.map(escapeRegex).join("[\\s\\S]{0,40}"), "i");
    if (!re.test(html)) missing.push(heading);
  }
  return missing;
}

export function auditStrainComparisonHtml(
  html: string,
  strainA: string,
  strainB: string,
  allowlist: string[] = [],
  siteOrigin = "",
  outline?: StrainComparisonOutline | null
): StrainComparisonAudit {
  const reasons: string[] = [];
  const wordCount = countWordsFromHtml(html);
  if (wordCount < STRAIN_COMPARISON_WORD_MIN) {
    reasons.push(`word count ${wordCount} below minimum ${STRAIN_COMPARISON_WORD_MIN}`);
  }
  if (wordCount > STRAIN_COMPARISON_WORD_MAX + 80) {
    reasons.push(`word count ${wordCount} above maximum ~${STRAIN_COMPARISON_WORD_MAX}`);
  }

  const structuralGaps = hasCoreStructuralGaps(html, strainA, strainB);
  if (structuralGaps.length > 0) {
    reasons.push(`missing core pieces: ${structuralGaps.join(", ")}`);
  }

  const outlineGaps = missingOutlineHeadings(html, outline);
  if (outlineGaps.length > 0) {
    reasons.push(`outline H2 drift (missing/weak): ${outlineGaps.slice(0, 3).join("; ")}`);
  }

  const hasComparisonTable = /<table\b/i.test(html);
  if (!hasComparisonTable) reasons.push("missing comparison <table>");

  const faqSection = extractWeedFaqSection(html);
  const faqPairs = faqSection ? countCompleteWeedFaqPairs(faqSection) : 0;
  if (faqPairs < STRAIN_COMPARISON_FAQ_MIN) {
    reasons.push(`only ${faqPairs} complete FAQ pair(s), need ${STRAIN_COMPARISON_FAQ_MIN}-${STRAIN_COMPARISON_FAQ_MAX}`);
  }

  const internalLinkCount =
    allowlist.length > 0 && siteOrigin
      ? countAllowlistedLinks(html, allowlist, siteOrigin)
      : (html.match(/\bhref\s*=\s*["'][^"']+["']/gi) ?? []).length;
  const minLinks = Math.min(STRAIN_COMPARISON_MIN_INTERNAL_LINKS, allowlist.length);
  if (allowlist.length > 0 && internalLinkCount < minLinks) {
    reasons.push(
      `only ${internalLinkCount} verified internal link(s) in body, need at least ${minLinks}`
    );
  }

  return {
    needsRepair: reasons.length > 0,
    reasons,
    wordCount,
    faqPairs,
    hasComparisonTable,
    internalLinkCount,
  };
}

export async function ensureStrainComparisonComplete(
  html: string,
  strainA: string,
  strainB: string,
  allowlist: string[] = [],
  siteOrigin = "",
  outline?: StrainComparisonOutline | null
): Promise<string> {
  let current = html.replace(/\u2014/g, " - ");
  for (let pass = 0; pass < 2; pass++) {
    const audit = auditStrainComparisonHtml(current, strainA, strainB, allowlist, siteOrigin, outline);
    if (!audit.needsRepair) return current;

    const outlineBlock = outline
      ? `\n\nOUTLINE JSON (preserve persona + section intents; do not collapse into a stock template):\n${JSON.stringify(outline, null, 2)}`
      : "";

    const repairSystem = `${strainComparisonSystemPrompt()}

REPAIR PASS: Fix ONLY the issues listed. Return the FULL revised HTML article. Do not shorten working sections. Do not invent filler "What Is" sections unless the outline requires them. Do not invent numbers, dates, studies, or quotes that are not already in the article.`;
    const repairUser = `Issues to fix:\n${audit.reasons.map((r) => `- ${r}`).join("\n")}\n\nStrain A: ${strainA}\nStrain B: ${strainB}${outlineBlock}\n\nCURRENT HTML:\n${current}`;

    try {
      const repaired = await callClaude(repairSystem, repairUser, { maxTokens: 8192 });
      const cleaned = repaired.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
      if (cleaned.length > 400) current = cleaned;
    } catch (e) {
      console.warn("[strain-comparison] repair pass failed:", errorMessage(e));
      break;
    }
  }
  return current;
}
