import { callClaude } from "@/lib/anthropic";
import { errorMessage } from "@/lib/serverLog";
import {
  STRAIN_PAGE_FAQ_MAX,
  STRAIN_PAGE_FAQ_MIN,
  STRAIN_PAGE_WORD_MAX,
  STRAIN_PAGE_WORD_MIN,
  formatStrainDisplayName,
  strainPageSystemPrompt,
} from "@/lib/contentProduction/strainPage";
import { countAllowlistedStrainPageLinks } from "@/lib/contentProduction/strainPageLinks";
import { countCompleteWeedFaqPairs, extractWeedFaqSection } from "@/lib/contentProduction/weedLearnCompleteness";

export const STRAIN_PAGE_MIN_INTERNAL_LINKS = 4;

export type StrainPageAudit = {
  needsRepair: boolean;
  reasons: string[];
  wordCount: number;
  faqPairs: number;
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

function hasRequiredSections(html: string, strainName: string): string[] {
  const name = formatStrainDisplayName(strainName);
  const missing: string[] = [];
  const checks: Array<{ re: RegExp; label: string }> = [
    { re: /<h2[^>]*>\s*Effects\s*<\/h2>/i, label: "Effects" },
    { re: /<h2[^>]*>\s*Negative effects\s*<\/h2>/i, label: "Negative effects" },
    { re: /<h2[^>]*>\s*Help with\s*<\/h2>/i, label: "Help with" },
    { re: /<h2[^>]*>\s*Flavours\s*<\/h2>/i, label: "Flavours" },
    { re: /<h2[^>]*>\s*Terpenes\s*<\/h2>/i, label: "Terpenes" },
    { re: /<h2[^>]*>\s*THC level\s*<\/h2>/i, label: "THC level" },
    { re: /<h2[^>]*>\s*CBD level\s*<\/h2>/i, label: "CBD level" },
    {
      re: new RegExp(`<h2[^>]*>\\s*Buy\\s+${escapeRegex(name)}\\s+Seeds\\s*</h2>`, "i"),
      label: "Buy Seeds",
    },
    {
      re: new RegExp(`<h2[^>]*>\\s*${escapeRegex(name)}\\s+Clones\\s*</h2>`, "i"),
      label: "Clones",
    },
    { re: /<h2[^>]*>\s*Frequently asked questions\s*<\/h2>/i, label: "FAQ" },
  ];
  for (const { re, label } of checks) {
    if (!re.test(html)) missing.push(label);
  }
  return missing;
}

export function auditStrainPageHtml(
  html: string,
  strainName: string,
  allowlist: string[] = [],
  siteOrigin = ""
): StrainPageAudit {
  const reasons: string[] = [];
  const wordCount = countWordsFromHtml(html);
  if (wordCount < STRAIN_PAGE_WORD_MIN) {
    reasons.push(`word count ${wordCount} below minimum ${STRAIN_PAGE_WORD_MIN}`);
  }
  if (wordCount > STRAIN_PAGE_WORD_MAX + 60) {
    reasons.push(`word count ${wordCount} above maximum ~${STRAIN_PAGE_WORD_MAX}`);
  }

  const missing = hasRequiredSections(html, strainName);
  if (missing.length > 0) reasons.push(`missing sections: ${missing.join(", ")}`);

  const introOnly = html.match(/^([\s\S]*?)(?=<h2\b)/i)?.[1] ?? "";
  if (countWordsFromHtml(introOnly) < 40) {
    reasons.push("intro paragraph too short (target 50–80 words)");
  }

  const faqSection = extractWeedFaqSection(html);
  const faqPairs = faqSection ? countCompleteWeedFaqPairs(faqSection) : 0;
  if (faqPairs < STRAIN_PAGE_FAQ_MIN) {
    reasons.push(`only ${faqPairs} complete FAQ pair(s), need ${STRAIN_PAGE_FAQ_MIN}-${STRAIN_PAGE_FAQ_MAX}`);
  }

  const internalLinkCount =
    allowlist.length > 0 && siteOrigin
      ? countAllowlistedStrainPageLinks(html, allowlist, siteOrigin)
      : (html.match(/\bhref\s*=\s*["'][^"']+["']/gi) ?? []).length;
  const minLinks = Math.min(STRAIN_PAGE_MIN_INTERNAL_LINKS, allowlist.length);
  if (allowlist.length > 0 && internalLinkCount < minLinks) {
    reasons.push(`only ${internalLinkCount} verified internal link(s), need at least ${minLinks}`);
  }

  if (/\u2014/.test(html)) reasons.push("contains em dash (U+2014)");

  return { needsRepair: reasons.length > 0, reasons, wordCount, faqPairs, internalLinkCount };
}

export async function ensureStrainPageComplete(
  html: string,
  strainName: string,
  allowlist: string[] = [],
  siteOrigin = ""
): Promise<string> {
  let current = html.replace(/\u2014/g, " - ");
  for (let pass = 0; pass < 2; pass++) {
    const audit = auditStrainPageHtml(current, strainName, allowlist, siteOrigin);
    if (!audit.needsRepair) return current;

    const repairSystem = `${strainPageSystemPrompt()}

REPAIR PASS: Fix ONLY the issues listed. Return the FULL revised JSON with customFields unchanged and html fixed.`;
    const repairUser = `Issues to fix:\n${audit.reasons.map((r) => `- ${r}`).join("\n")}\n\nStrain: ${formatStrainDisplayName(strainName)}\n\nCURRENT HTML:\n${current}\n\nReturn JSON: { "customFields": {}, "html": "..." } — you may omit customFields if unchanged.`;

    try {
      const repaired = await callClaude(repairSystem, repairUser, { maxTokens: 8192 });
      let cleaned = repaired.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const objMatch = cleaned.match(/\{[\s\S]*\}/);
      if (objMatch) cleaned = objMatch[0];
      const parsed = JSON.parse(cleaned) as { html?: string };
      if (typeof parsed.html === "string" && parsed.html.length > 200) {
        current = parsed.html.replace(/\u2014/g, " - ").trim();
      }
    } catch (e) {
      console.warn("[strain-page] repair pass failed:", errorMessage(e));
      break;
    }
  }
  return current;
}
