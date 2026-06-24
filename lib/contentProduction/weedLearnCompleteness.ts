import { callClaude } from "@/lib/anthropic";
import { errorMessage } from "@/lib/serverLog";

export type WeedLearnAudit = {
  needsRepair: boolean;
  reasons: string[];
  faqPairsComplete: number;
  faqPairsExpected: number;
  wordCount: number;
  wordCountMin: number;
  hasLegalFooter: boolean;
  hasFaqHeading: boolean;
};

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function countWordsFromHtml(html: string): number {
  const plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-zA-Z0-9#]+;/g, " ");
  return plain.split(/\s+/).filter(Boolean).length;
}

function wordCountBounds(target: number, toleranceRatio = 0.08): { min: number; max: number } {
  const min = Math.floor(target * (1 - toleranceRatio));
  const max = Math.ceil(target * (1 + toleranceRatio));
  return { min, max };
}

/** Slice from FAQ heading through foot (Sources / legal footer), excluding tail compliance blocks. */
export function extractWeedFaqSection(html: string): string | null {
  const heading = html.match(/<h2[^>]*>\s*Frequently asked questions\s*<\/h2>/i);
  if (!heading || heading.index === undefined) return null;
  const start = heading.index;
  const rest = html.slice(start);
  const endCandidates: number[] = [];
  for (const re of [
    /<!-- tabibi-sources-footer:start -->/i,
    /<div[^>]*>\s*Sources\s*<\/div>/i,
    /<p[^>]*>\s*For adults 21\+ only/i,
    /Important Notice/i,
  ]) {
    const idx = rest.search(re);
    if (idx > 40) endCandidates.push(idx);
  }
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : rest.length;
  return rest.slice(0, end);
}

/** Count complete FAQ Q&A pairs (h3+p or Bible div question+answer pattern). */
export function countCompleteWeedFaqPairs(faqSection: string): number {
  let pairs = 0;

  const h3Regex = /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi;
  let m: RegExpExecArray | null;
  while ((m = h3Regex.exec(faqSection)) !== null) {
    const after = faqSection.slice(m.index + m[0].length, m.index + m[0].length + 1200);
    const pMatch = after.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    if (pMatch && stripTags(pMatch[1]).length >= 12) pairs++;
  }
  if (pairs > 0) return pairs;

  const wrapperRegex =
    /<div style="margin:0 0 1\.5rem;">\s*<div style="[^"]*margin:0 0 0\.45rem[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div style="[^"]*line-height:1\.65[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  while ((m = wrapperRegex.exec(faqSection)) !== null) {
    if (stripTags(m[1]).length >= 8 && stripTags(m[2]).length >= 12) pairs++;
  }
  return pairs;
}

export function faqSectionHasTrailingQuestionWithoutAnswer(faqSection: string): boolean {
  const tail = faqSection.trimEnd().slice(-1500);
  if (/<h3\b[^>]*>[\s\S]+?<\/h3>\s*$/i.test(tail)) return true;
  const lastQ = tail.lastIndexOf("margin:0 0 0.45rem");
  if (lastQ === -1) return false;
  const afterQ = tail.slice(lastQ);
  const firstClose = afterQ.indexOf("</div>");
  if (firstClose === -1) return true;
  const questionChunk = afterQ.slice(0, firstClose);
  if (!/\?/.test(stripTags(questionChunk))) return false;
  return !/line-height:1\.65/i.test(afterQ.slice(firstClose));
}

function hasBibleLegalFooter(html: string): boolean {
  return (
    /For adults 21\+ only/i.test(html) &&
    (/call 911|call\s+911|nearest emergency room/i.test(html) || /emergency room immediately/i.test(html))
  );
}

export function auditWeedLearnHtml(
  html: string,
  expectedFaqCount: number,
  targetWordCount: number
): WeedLearnAudit {
  const { min } = wordCountBounds(targetWordCount);
  const wordCount = countWordsFromHtml(html);
  const hasFaqHeading = /Frequently asked questions/i.test(html);
  const faqSection = extractWeedFaqSection(html);
  const faqPairsComplete = faqSection ? countCompleteWeedFaqPairs(faqSection) : 0;
  const hasLegalFooter = hasBibleLegalFooter(html);
  const reasons: string[] = [];

  if (!hasFaqHeading) reasons.push("missing FAQ heading");
  if (!hasLegalFooter) reasons.push("missing or incomplete legal footer (911/ER routing)");
  if (faqPairsComplete < expectedFaqCount) {
    reasons.push(`only ${faqPairsComplete} complete FAQ pair(s), need ${expectedFaqCount}`);
  }
  if (faqSection && faqSectionHasTrailingQuestionWithoutAnswer(faqSection)) {
    reasons.push("FAQ ends with an unanswered question");
  }
  if (wordCount < Math.floor(min * 0.92)) {
    reasons.push(`article too short (${wordCount} words, minimum ~${min})`);
  }

  return {
    needsRepair: reasons.length > 0,
    reasons,
    faqPairsComplete,
    faqPairsExpected: expectedFaqCount,
    wordCount,
    wordCountMin: min,
    hasLegalFooter,
    hasFaqHeading,
  };
}

const WEED_LEARN_APPEND_SYSTEM = `You complete truncated Weed.com Learn blog HTML. Output raw HTML only (no markdown fences, no em dash U+2014).

The user message has TITLE, KEYWORDS, FAQ COUNT, and the TAIL of an article that stopped early or has an incomplete FAQ.

Output ONLY the continuation to append (do not repeat earlier paragraphs):
1) If the tail ends inside an open tag or mid-sentence, finish it minimally, then close tags.
2) If the FAQ block is missing or incomplete, output the full FAQ block (Bible outer div with Inter; <h2>Frequently asked questions</h2>; each Q as <h3> or Bible question div + answer <p> or answer div). Include EXACTLY the FAQ count specified — every question MUST have a complete answer (~24-45 words). Never leave a question without an answer.
3) Then amber drug-interaction disclaimer if relevant + legal footer only. Do NOT add a Sources HTML block (server appends Sources). Never stop mid-FAQ.`;

const WEED_LEARN_FULL_REPAIR_SYSTEM = `You repair incomplete Weed.com Learn article HTML. Output the COMPLETE article body fragment as raw HTML only (no markdown fences, no em dash U+2014).

Fix every issue listed in the user message while preserving valid Expert Insight boxes (.expert-box), internal links, and main body sections unless they must expand to meet word count.

Requirements:
- Target visible word count in the range given (HTML tags do not count).
- FAQ: Bible wrapper with <h2>Frequently asked questions</h2>; EXACTLY the FAQ count specified; every question has a full answer (~24-45 words).
- End with legal footer containing verbatim "For adults 21+ only. Cannabis laws vary by state." plus 911/emergency room routing.
- Do not output Sources (server appends). No <h1>.`;

function stripHtmlCodeFences(text: string): string {
  let s = text.trim();
  if (s.startsWith("```")) {
    const nl = s.indexOf("\n");
    s = nl !== -1 ? s.slice(nl + 1) : s.replace(/^```\w*\s*/, "");
  }
  s = s.trimEnd();
  if (s.endsWith("```")) s = s.slice(0, s.lastIndexOf("```")).trimEnd();
  return s.trim();
}

function replaceEmDashes(html: string): string {
  return html.replace(/\u2014/g, " - ").replace(/\u2013/g, "-");
}

async function appendWeedLearnContinuation(
  html: string,
  title: string,
  keywords: string[],
  faqCount: number,
  issues: string[]
): Promise<string> {
  const tail = html.length > 20000 ? html.slice(-20000) : html;
  const user = `Title: ${title}
Keywords: ${keywords.join(", ")}
Required FAQ count: exactly ${faqCount}

Problems to fix in your continuation: ${issues.join("; ")}

----- TRUNCATED HTML (append after this) -----
${tail}`;
  const extra = await callClaude(WEED_LEARN_APPEND_SYSTEM, user, { maxTokens: 8192 });
  const cleaned = replaceEmDashes(stripHtmlCodeFences(extra.trim()));
  return cleaned ? `${html.trimEnd()}\n${cleaned}` : html;
}

async function fullWeedLearnRepair(
  html: string,
  title: string,
  keywords: string[],
  faqCount: number,
  targetWordCount: number,
  issues: string[]
): Promise<string> {
  const { min, max } = wordCountBounds(targetWordCount);
  const user = `Title: ${title}
Keywords: ${keywords.join(", ")}
Required FAQ count: exactly ${faqCount}
Target word count: ${targetWordCount} (acceptable ${min}-${max})

Issues to fix:
${issues.map((r) => `- ${r}`).join("\n")}

----- EXISTING HTML (repair and return complete article) -----
${html.length > 90000 ? `${html.slice(0, 45000)}\n\n<!-- truncated for repair prompt -->\n\n${html.slice(-45000)}` : html}
----- END -----`;

  const repaired = await callClaude(WEED_LEARN_FULL_REPAIR_SYSTEM, user, { maxTokens: 8192 });
  const cleaned = replaceEmDashes(stripHtmlCodeFences(repaired.trim()));
  return cleaned || html;
}

/** Higher token budget for Weed inline-HTML articles (capped at Anthropic max). */
export function maxTokensForWeedArticleHtml(wordCount: number): number {
  const estimated = Math.ceil(wordCount * 5.5);
  return Math.min(8192, Math.max(6144, estimated));
}

const MAX_REPAIR_PASSES = 2;

/**
 * Audit and repair Weed Learn HTML until FAQ pairs, footer, and word count pass — or pass limit hit.
 */
export async function ensureWeedLearnComplete(
  html: string,
  title: string,
  keywords: string[],
  faqCount: number,
  targetWordCount: number
): Promise<string> {
  let current = html;

  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
    const audit = auditWeedLearnHtml(current, faqCount, targetWordCount);
    if (!audit.needsRepair) return current;

    console.warn(
      `[generate-content] Weed Learn repair pass ${pass + 1}: ${audit.reasons.join("; ")} (${audit.wordCount} words, ${audit.faqPairsComplete}/${audit.faqPairsExpected} FAQs)`
    );

    try {
      const useFullRepair =
        audit.wordCount < Math.floor(audit.wordCountMin * 0.85) ||
        !audit.hasFaqHeading ||
        audit.faqPairsComplete < Math.max(1, faqCount - 2);

      current = useFullRepair
        ? await fullWeedLearnRepair(current, title, keywords, faqCount, targetWordCount, audit.reasons)
        : await appendWeedLearnContinuation(current, title, keywords, faqCount, audit.reasons);
    } catch (e) {
      console.error("[generate-content] Weed Learn repair failed:", errorMessage(e));
      break;
    }
  }

  const finalAudit = auditWeedLearnHtml(current, faqCount, targetWordCount);
  if (finalAudit.needsRepair) {
    console.warn(
      `[generate-content] Weed Learn still incomplete after repair: ${finalAudit.reasons.join("; ")}`
    );
  }
  return current;
}
