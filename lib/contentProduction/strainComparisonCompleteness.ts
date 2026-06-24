import { callClaude } from "@/lib/anthropic";
import { errorMessage } from "@/lib/serverLog";
import {
  STRAIN_COMPARISON_FAQ_MAX,
  STRAIN_COMPARISON_FAQ_MIN,
  STRAIN_COMPARISON_WORD_MAX,
  STRAIN_COMPARISON_WORD_MIN,
  formatStrainLabel,
  strainComparisonSystemPrompt,
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

function hasRequiredH2(html: string, strainA: string, strainB: string): string[] {
  const missing: string[] = [];
  const labelA = formatStrainLabel(strainA);
  const labelB = formatStrainLabel(strainB);
  const checks = [
    new RegExp(`<h2[^>]*>\\s*What Is ${escapeRegex(labelA)}\\s*\\?\\s*</h2>`, "i"),
    new RegExp(`<h2[^>]*>\\s*What Is ${escapeRegex(labelB)}\\s*\\?\\s*</h2>`, "i"),
    new RegExp(`<h2[^>]*>[^<]*${escapeRegex(labelA)}[^<]*vs[^<]*${escapeRegex(labelB)}[^<]*Key Differences`, "i"),
    /<h2[^>]*>\s*Effects Comparison\s*<\/h2>/i,
    /<h2[^>]*>\s*Which Strain Is Better for/i,
    new RegExp(`<h2[^>]*>\\s*Where to Buy ${escapeRegex(labelA)} and ${escapeRegex(labelB)}`, "i"),
    new RegExp(
      `<h2[^>]*>[\\s\\S]*?Buy[^<]*${escapeRegex(labelA)}[^<]*and[^<]*${escapeRegex(labelB)}[^<]*Seeds`,
      "i"
    ),
    /<h2[^>]*>\s*Frequently asked questions\s*<\/h2>/i,
  ];
  const labels = [
    `What Is ${labelA}?`,
    `What Is ${labelB}?`,
    "Key Differences",
    "Effects Comparison",
    "Which Strain Is Better",
    "Where to Buy",
    "Buy Seeds",
    "FAQ",
  ];
  checks.forEach((re, i) => {
    if (!re.test(html)) missing.push(labels[i]);
  });
  return missing;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function auditStrainComparisonHtml(
  html: string,
  strainA: string,
  strainB: string,
  allowlist: string[] = [],
  siteOrigin = ""
): StrainComparisonAudit {
  const reasons: string[] = [];
  const wordCount = countWordsFromHtml(html);
  if (wordCount < STRAIN_COMPARISON_WORD_MIN) {
    reasons.push(`word count ${wordCount} below minimum ${STRAIN_COMPARISON_WORD_MIN}`);
  }
  if (wordCount > STRAIN_COMPARISON_WORD_MAX + 80) {
    reasons.push(`word count ${wordCount} above maximum ~${STRAIN_COMPARISON_WORD_MAX}`);
  }

  const missingH2 = hasRequiredH2(html, strainA, strainB);
  if (missingH2.length > 0) {
    reasons.push(`missing sections: ${missingH2.join(", ")}`);
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
  siteOrigin = ""
): Promise<string> {
  let current = html.replace(/\u2014/g, " - ");
  for (let pass = 0; pass < 2; pass++) {
    const audit = auditStrainComparisonHtml(current, strainA, strainB, allowlist, siteOrigin);
    if (!audit.needsRepair) return current;

    const repairSystem = `${strainComparisonSystemPrompt()}

REPAIR PASS: Fix ONLY the issues listed. Return the FULL revised HTML article. Do not shorten working sections.`;
    const repairUser = `Issues to fix:\n${audit.reasons.map((r) => `- ${r}`).join("\n")}\n\nStrain A: ${strainA}\nStrain B: ${strainB}\n\nCURRENT HTML:\n${current}`;

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
