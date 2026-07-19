import bannedPhrases from "@/lib/contentProduction/banned_phrases.json";
import {
  detectWinstonAiText,
  getWinstonApiKey,
  toPlainTextForWinston,
  type EdenWinstonOutput,
} from "@/lib/winstonAiClient";

export type BannedPhrasesConfig = {
  block: string[];
  warn: string[];
};

export type PhraseHit = {
  level: "block" | "warn";
  pattern: string;
  match: string;
  paragraphPreview: string;
};

export type HumanisationCodeFail = {
  kind: "banned_phrase" | "long_paragraph";
  level: "block" | "warn";
  sectionHint: string;
  reason: string;
  fix: string;
  snippet: string;
};

function compilePatterns(patterns: string[]): Array<{ source: string; re: RegExp }> {
  return patterns
    .map((source) => source.trim())
    .filter(Boolean)
    .map((source) => {
      try {
        return { source, re: new RegExp(source, "gi") };
      } catch {
        console.warn(`[banned_phrases] invalid regex skipped: ${source}`);
        return null;
      }
    })
    .filter((x): x is { source: string; re: RegExp } => x != null);
}

const BLOCK_PATTERNS = compilePatterns((bannedPhrases as BannedPhrasesConfig).block ?? []);
const WARN_PATTERNS = compilePatterns((bannedPhrases as BannedPhrasesConfig).warn ?? []);

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function looksLikeHtml(text: string): boolean {
  return /<\/?(?:p|h[1-6]|div|section|article|ul|ol|li)\b/i.test(text);
}

/** Split markdown into prose blocks (skip headings-only / empty). */
export function splitMarkdownParagraphs(md: string): string[] {
  return md
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Split article into prose blocks for code guards.
 * Supports HTML (<p>, <li>) and markdown.
 */
export function splitArticleParagraphs(article: string): string[] {
  if (looksLikeHtml(article)) {
    const blocks: string[] = [];
    const re = /<(p|li|blockquote|td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(article)) !== null) {
      const full = m[0].trim();
      const plain = stripTags(m[2] ?? "");
      if (plain.length >= 40) blocks.push(full);
    }
    if (blocks.length > 0) return blocks;
  }
  return splitMarkdownParagraphs(article);
}

function blockPlainText(block: string): string {
  if (looksLikeHtml(block) || /<[^>]+>/.test(block)) {
    return stripTags(block);
  }
  return block.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`>#-]/g, " ").trim();
}

/**
 * Code-only paragraph shape check (no LLM).
 * Non-empty = paragraphs with 5+ sentences → send back to voice-pass to split.
 */
export function paragraphCheck(md: string): string[] {
  const fails: string[] = [];
  for (const para of splitArticleParagraphs(md)) {
    if (/^#{1,6}\s/.test(para)) continue;
    if (/^\|/.test(para) || para.includes("| ---")) continue;
    const plain = blockPlainText(para);
    if (!plain) continue;
    const sentences = plain
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (sentences.length >= 5) {
      fails.push(para.slice(0, 120));
    }
  }
  return fails;
}

export function findBannedPhraseHits(md: string): PhraseHit[] {
  const hits: PhraseHit[] = [];
  for (const para of splitArticleParagraphs(md)) {
    if (/^#{1,6}\s/.test(para)) continue;
    const haystack = blockPlainText(para) || para;
    for (const { source, re } of BLOCK_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(haystack);
      if (m) {
        hits.push({
          level: "block",
          pattern: source,
          match: m[0],
          paragraphPreview: para.slice(0, 120),
        });
      }
    }
    for (const { source, re } of WARN_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(haystack);
      if (m) {
        hits.push({
          level: "warn",
          pattern: source,
          match: m[0],
          paragraphPreview: para.slice(0, 120),
        });
      }
    }
  }
  return hits;
}

function inferSectionHint(article: string, snippet: string): string {
  const idx = article.indexOf(snippet);
  if (idx < 0) return "intro";
  const before = article.slice(0, idx);
  const mdHeadings = Array.from(before.matchAll(/(?:^|\n)##\s+([^\n]+)/g));
  const htmlHeadings = Array.from(before.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi));
  if (htmlHeadings.length > 0) {
    return stripTags(htmlHeadings[htmlHeadings.length - 1][1]).trim() || "intro";
  }
  if (mdHeadings.length === 0) return "intro";
  return mdHeadings[mdHeadings.length - 1][1].trim() || "intro";
}

/**
 * Code-side humanisation enforcement. Block/long-paragraph fails become send_backs.
 * Warn hits are reported but do not force send_back by themselves.
 */
export function enforceHumanisationInCode(md: string): {
  blockHits: PhraseHit[];
  warnHits: PhraseHit[];
  longParagraphs: string[];
  sendBacks: Array<{ section: string; reason: string; fix: string }>;
} {
  const phraseHits = findBannedPhraseHits(md);
  const blockHits = phraseHits.filter((h) => h.level === "block");
  const warnHits = phraseHits.filter((h) => h.level === "warn");
  const longParagraphs = paragraphCheck(md);

  const sendBacks: Array<{ section: string; reason: string; fix: string }> = [];
  const seen = new Set<string>();

  for (const hit of blockHits) {
    const section = inferSectionHint(md, hit.paragraphPreview);
    const key = `${section}::block::${hit.pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sendBacks.push({
      section,
      reason: `Blocked phrase matched: "${hit.match}"`,
      fix: `Remove/replace banned filler matching /${hit.pattern}/. Keep meaning, numbers, names, and links identical. Split voice if needed.`,
    });
  }

  for (const preview of longParagraphs) {
    const section = inferSectionHint(md, preview);
    const key = `${section}::para`;
    if (seen.has(key)) continue;
    seen.add(key);
    sendBacks.push({
      section,
      reason: "Paragraph has 5+ sentences (code paragraph_check)",
      fix: "Split into shorter uneven paragraphs. Keep all facts/numbers/links. Vary sentence length hard.",
    });
  }

  return { blockHits, warnHits, longParagraphs, sendBacks };
}

export type DetectResult = {
  score: number;
  flagged: string[];
};

/**
 * Code detector used by detectLoop. Higher score = more AI-tell risk.
 * score weights: block phrase 18, long paragraph 22, warn 4 (warns don't go into flagged).
 */
export function detectAiCadence(article: string): DetectResult {
  const { blockHits, warnHits, longParagraphs } = enforceHumanisationInCode(article);
  const flaggedSet = new Set<string>();

  for (const hit of blockHits) {
    const full =
      splitArticleParagraphs(article).find((p) => p.startsWith(hit.paragraphPreview)) ??
      hit.paragraphPreview;
    flaggedSet.add(full);
  }
  for (const preview of longParagraphs) {
    const full =
      splitArticleParagraphs(article).find(
        (p) => p.startsWith(preview) || preview.startsWith(p.slice(0, 40))
      ) ?? preview;
    flaggedSet.add(full);
  }

  const flagged = Array.from(flaggedSet);
  const score = Math.min(
    100,
    blockHits.length * 18 + longParagraphs.length * 22 + warnHits.length * 4
  );

  return { score, flagged };
}

export type DetectLoopResult = {
  article: string;
  score: number;
  passed: boolean;
  attempts: number;
  humanScore?: number;
  source?: "winston" | "code";
  creditsRemaining?: number;
  fallbackReason?: string;
  /** Raw Eden playground ai_score (0–1). */
  edenAiScore?: number;
  /** Eden winstonai output card payload. */
  edenOutput?: EdenWinstonOutput;
  provider?: string;
  cost?: string;
};

/**
 * Retry voice-pass on flagged passages until detector score is under threshold.
 * Escalates (passed=false) after maxRetries instead of looping forever.
 */
export async function detectLoop(args: {
  article: string;
  voicePassFn: (article: string, flagged: string[]) => Promise<string>;
  detectFn?: (article: string) => DetectResult | Promise<DetectResult>;
  threshold?: number;
  maxRetries?: number;
}): Promise<DetectLoopResult> {
  const detectFn = args.detectFn ?? detectAiCadence;
  const threshold = args.threshold ?? 30;
  const maxRetries = args.maxRetries ?? 2;

  let article = args.article;
  let attempts = 0;
  let last: DetectResult & {
    humanScore?: number;
    source?: "winston" | "code";
    creditsRemaining?: number;
    fallbackReason?: string;
    edenAiScore?: number;
    edenOutput?: EdenWinstonOutput;
    provider?: string;
    cost?: string;
  } = { score: 100, flagged: [] };

  const toLoop = (passed: boolean): DetectLoopResult => ({
    article,
    score: last.score,
    passed,
    attempts,
    humanScore: last.humanScore,
    source: last.source,
    creditsRemaining: last.creditsRemaining,
    fallbackReason: last.fallbackReason,
    edenAiScore: last.edenAiScore,
    edenOutput: last.edenOutput,
    provider: last.provider,
    cost: last.cost,
  });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    last = await detectFn(article);
    if (last.score < threshold) {
      return toLoop(true);
    }
    if (attempt === maxRetries) {
      return toLoop(false);
    }
    article = await args.voicePassFn(article, last.flagged);
  }

  last = await detectFn(article);
  return toLoop(last.score < threshold);
}

/**
 * Winston-backed detector for detectLoop.
 * Internal score = AI risk (100 - Winston human score). Higher = worse.
 * Flagged = low-humanity sentences (human score below sentence threshold).
 */
export async function detectWithWinston(articleText: string): Promise<
  DetectResult & {
    humanScore: number;
    creditsUsed?: number;
    creditsRemaining?: number;
    source: "winston";
    edenAiScore: number;
    edenOutput: EdenWinstonOutput;
    provider?: string;
    cost?: string;
  }
> {
  const sentenceHumanFloor = Number(process.env.WINSTON_AI_SENTENCE_HUMAN_FLOOR ?? "50");
  const winston = await detectWinstonAiText(articleText, { sentences: true, language: "en" });

  const flagged = winston.sentences
    .filter((s) => s.score < sentenceHumanFloor)
    .map((s) => s.text)
    .filter((t) => t.length >= 20);

  const code = enforceHumanisationInCode(articleText);
  for (const hit of code.blockHits) {
    const full =
      splitArticleParagraphs(articleText).find((p) => p.startsWith(hit.paragraphPreview)) ??
      hit.paragraphPreview;
    if (!flagged.some((f) => f.includes(hit.match) || full.includes(f))) {
      flagged.push(full);
    }
  }
  for (const preview of code.longParagraphs) {
    const full =
      splitArticleParagraphs(articleText).find((p) => p.startsWith(preview)) ?? preview;
    if (!flagged.includes(full)) flagged.push(full);
  }

  // Threshold/score uses pure Eden Winston AI likelihood (0–100), matching playground.
  // Small code penalty keeps banned phrases actionable without changing displayed eden ai_score.
  const codePenalty = Math.min(15, code.blockHits.length * 6 + code.longParagraphs.length * 8);
  const score = Math.min(100, winston.aiScore + codePenalty);

  return {
    score,
    flagged: flagged.slice(0, 12),
    humanScore: winston.humanScore,
    creditsUsed: winston.creditsUsed,
    creditsRemaining: winston.creditsRemaining,
    source: "winston",
    edenAiScore: winston.edenAiScore,
    edenOutput: winston.edenOutput,
    provider: winston.provider,
    cost: winston.cost,
  };
}

export type ArticleAiDetectResult = DetectResult & {
  humanScore?: number;
  creditsUsed?: number;
  creditsRemaining?: number;
  source: "winston" | "code";
  /** Set when Eden/Winston failed and local detector was used. */
  fallbackReason?: string;
  edenAiScore?: number;
  edenOutput?: EdenWinstonOutput;
  provider?: string;
  cost?: string;
};

/** Winston preferred; falls back to local banned-phrase / paragraph cadence detector. */
export async function detectArticleAiScore(articleText: string): Promise<ArticleAiDetectResult> {
  if (getWinstonApiKey()) {
    try {
      const plainLen = toPlainTextForWinston(articleText).length;
      if (plainLen >= 300) {
        return await detectWithWinston(articleText);
      }
      const reason = `text too short (${plainLen} chars; need 300+)`;
      console.warn(`[eden-winston] ${reason}; falling back to code detector`);
      const code = detectAiCadence(articleText);
      return { ...code, source: "code", fallbackReason: reason };
    } catch (e) {
      const reason =
        e instanceof Error
          ? e.message.includes("ENOTFOUND")
            ? "DNS failed for api.edenai.run (network/DNS blip)"
            : e.message.slice(0, 220)
          : "Eden/Winston request failed";
      console.warn("[eden-winston] detection failed; falling back to code detector:", e);
      const code = detectAiCadence(articleText);
      return { ...code, source: "code", fallbackReason: reason };
    }
  }
  const code = detectAiCadence(articleText);
  return { ...code, source: "code", fallbackReason: "EDEN_AI_API_KEY not set" };
}

/** @deprecated Prefer detectArticleAiScore — same implementation. */
export const detectForStrainComparison = detectArticleAiScore;

export function getBannedPhrasesConfig(): BannedPhrasesConfig {
  return bannedPhrases as BannedPhrasesConfig;
}
