/**
 * Shared post-generate Winston detectLoop for HTML (and markdown) article pipelines.
 */
import { callClaude } from "@/lib/anthropic";
import {
  detectArticleAiScore,
  detectLoop,
  enforceHumanisationInCode,
  type DetectLoopResult,
} from "@/lib/contentProduction/humanisationGuards";

function stripModelFences(raw: string): string {
  return raw
    .replace(/^```(?:html|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function looksLikeHtml(article: string): boolean {
  return /<\/?(?:p|h[1-6]|div|section|article|ul|ol|li|table)\b/i.test(article);
}

const HTML_VOICE_PASS_SYSTEM = `You are editing an existing article to reduce AI cadence.

Rewrite ONLY the flagged passages harder: shorter uneven paragraphs, kill filler/cliches, vary sentence length.
Preserve every number, name, date, URL, claim, inline style, class, and HTML structure elsewhere.
Do not invent facts. Do not add or remove sections. Do not use em dashes (U+2014); use " - " instead.
Output the complete revised article only (raw HTML or markdown matching the input format). No code fences.`;

/**
 * Voice-pass: Claude rewrites flagged passages inside the full article.
 */
export async function voicePassFlaggedArticle(
  article: string,
  flagged: string[],
  opts?: { toneHint?: string }
): Promise<string> {
  if (!flagged.length) return article;
  const format = looksLikeHtml(article) ? "HTML" : "markdown";
  const tone = opts?.toneHint?.trim()
    ? `\nTone hint: ${opts.toneHint.trim().slice(0, 400)}`
    : "";
  const rewritten = stripModelFences(
    await callClaude(
      `${HTML_VOICE_PASS_SYSTEM}${tone}`,
      [
        `Article format: ${format}`,
        "Detector flagged the following passages as AI cadence / banned filler / oversized paragraphs.",
        "Rewrite ONLY those passages. Return the FULL article with only flagged passages changed.",
        "",
        "FLAGGED PASSAGES:",
        flagged.map((p, i) => `--- flagged ${i + 1} ---\n${p}`).join("\n\n"),
        "",
        `FULL ARTICLE (${format}):`,
        article,
      ].join("\n"),
      { maxTokens: 8192 }
    )
  );
  return rewritten || article;
}

export type ArticleDetectPassMeta = {
  detectLoop: {
    source: "winston" | "code";
    score: number;
    humanScore: number | null;
    attempts: number;
    passed: boolean;
    threshold: number;
    escalateToHuman: boolean;
    creditsRemaining: number | null;
  };
  blockedPhraseCount: number;
  warnPhraseCount: number;
  longParagraphCount: number;
  remainingSendBacks: Array<{ section: string; reason: string; fix: string }>;
};

export type ArticleDetectPassResult = {
  article: string;
  loop: DetectLoopResult;
  codeGuards: ArticleDetectPassMeta;
};

/**
 * Run Winston (or code fallback) detectLoop, then report remaining code-side issues.
 */
export async function runArticleAiDetectPass(
  article: string,
  opts?: { toneHint?: string }
): Promise<ArticleDetectPassResult> {
  const threshold = Number(process.env.WINSTON_AI_RISK_THRESHOLD ?? "30");
  const maxRetries = Number(process.env.WINSTON_AI_MAX_RETRIES ?? "2") || 2;
  const safeThreshold = Number.isFinite(threshold) ? threshold : 30;

  const loop = await detectLoop({
    article,
    threshold: safeThreshold,
    maxRetries,
    detectFn: detectArticleAiScore,
    voicePassFn: (text, flagged) =>
      voicePassFlaggedArticle(text, flagged, { toneHint: opts?.toneHint }),
  });

  const finalGuard = enforceHumanisationInCode(loop.article);

  return {
    article: loop.article,
    loop,
    codeGuards: {
      detectLoop: {
        source: loop.source ?? "code",
        score: loop.score,
        humanScore: loop.humanScore ?? null,
        attempts: loop.attempts,
        passed: loop.passed,
        threshold: safeThreshold,
        escalateToHuman: !loop.passed,
        creditsRemaining: loop.creditsRemaining ?? null,
      },
      blockedPhraseCount: finalGuard.blockHits.length,
      warnPhraseCount: finalGuard.warnHits.length,
      longParagraphCount: finalGuard.longParagraphs.length,
      remainingSendBacks: finalGuard.sendBacks,
    },
  };
}
