/**
 * Shared post-generate Winston detectLoop + humanization review for article pipelines.
 * When AI score exceeds threshold, runs flagged voice-pass, then a full humanization review.
 */
import { callClaude } from "@/lib/anthropic";
import {
  detectArticleAiScore,
  detectLoop,
  enforceHumanisationInCode,
  type DetectLoopResult,
} from "@/lib/contentProduction/humanisationGuards";
import type { EdenWinstonOutput } from "@/lib/winstonAiClient";

function stripModelFences(raw: string): string {
  return raw
    .replace(/^```(?:html|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function looksLikeHtml(article: string): boolean {
  return /<\/?(?:p|h[1-6]|div|section|article|ul|ol|li|table)\b/i.test(article);
}

const FLAGGED_VOICE_PASS_SYSTEM = `You are editing an existing article to reduce AI cadence.

Rewrite ONLY the flagged passages harder: shorter uneven paragraphs, kill filler/cliches, vary sentence length.
Preserve every number, name, date, URL, claim, inline style, class, and HTML structure elsewhere.
Do not invent facts. Do not add or remove sections. Do not use em dashes (U+2014); use " - " instead.
Output the complete revised article only (raw HTML or markdown matching the input format). No code fences.`;

const HUMANIZATION_REVIEW_SYSTEM = `You are a senior editorial humanizer doing a REVIEW HUMANIZATION PASS on an article that failed an AI-detection threshold.

Goal: lower AI-detection score while keeping meaning identical.

Hard rules:
- Preserve every number, name, date, URL, product claim, citation, PMID, and factual assertion.
- Preserve document structure: same headings, sections, lists, FAQ items, tables, and (for HTML) tags/classes/inline styles.
- Do not add or remove sections, links, images, Expert Insight boxes, Sources, or legal footers.
- Do not invent facts, studies, or quotes.
- Never use em dashes (U+2014). Use a spaced hyphen " - " instead.

Rewrite the prose so it sounds like a real editor, not a model:
- Uneven paragraph lengths; some short punches; avoid 3+ medium-length sentences in a row.
- Kill AI filler: delve, landscape, robust, comprehensive, unlock, harness, pivotal, "in today's world", "when it comes to", "it's important to note", "not only… but also", "in conclusion", "ultimately,", "elevate your".
- Prefer contractions (you'll, don't, it's) when natural.
- Vary openings; avoid parallel list-y cadence.
- Keep technical accuracy; hedge only where the draft already hedges.

Output the COMPLETE revised article only (same format as input: raw HTML or markdown). No code fences. No commentary.`;

/**
 * Voice-pass: Claude rewrites flagged passages inside the full article.
 * If nothing is flagged but score is high, caller should use runHumanizationReviewLayer instead.
 */
export async function voicePassFlaggedArticle(
  article: string,
  flagged: string[],
  opts?: { toneHint?: string }
): Promise<string> {
  if (!flagged.length) return article;
  const format = looksLikeHtml(article) ? "HTML" : "markdown";
  const tone = opts?.toneHint?.trim()
    ? `\nTone hint: ${opts.toneHint.trim().slice(0, 800)}`
    : "";
  const rewritten = stripModelFences(
    await callClaude(
      `${FLAGGED_VOICE_PASS_SYSTEM}${tone}`,
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

/**
 * Full-article humanization review when AI score is above threshold.
 */
export async function runHumanizationReviewLayer(
  article: string,
  opts?: {
    toneHint?: string;
    aiScore?: number;
    threshold?: number;
    humanScore?: number | null;
  }
): Promise<string> {
  const format = looksLikeHtml(article) ? "HTML" : "markdown";
  const tone = opts?.toneHint?.trim()
    ? `\nTone / voice guide:\n${opts.toneHint.trim().slice(0, 2500)}`
    : "";
  const scoreLine =
    opts?.aiScore != null
      ? `Current AI score: ${opts.aiScore}/100 (must get below ${opts.threshold ?? 30}).${
          opts.humanScore != null ? ` Human score: ${opts.humanScore}/100.` : ""
        }`
      : `AI detection score is too high. Humanize until the article would pass a strict AI detector.`;

  const rewritten = stripModelFences(
    await callClaude(
      `${HUMANIZATION_REVIEW_SYSTEM}${tone}`,
      [
        `Article format: ${format}`,
        scoreLine,
        "This is a REVIEW HUMANIZATION LAYER — rewrite body copy throughout where it still sounds templated, not only isolated sentences.",
        "Keep tags, links, and facts intact. Return the full article.",
        "",
        `FULL ARTICLE (${format}):`,
        article,
      ].join("\n"),
      { maxTokens: 8192 }
    )
  );
  return rewritten || article;
}

export type HumanizationReviewMeta = {
  applied: boolean;
  aiScoreBefore: number | null;
  humanScoreBefore: number | null;
  aiScoreAfter: number | null;
  humanScoreAfter: number | null;
  passedAfter: boolean;
};

export type ArticleDetectPassMeta = {
  detectLoop: {
    source: "winston" | "code";
    /** Internal AI-risk 0–100 (higher = more AI). */
    score: number;
    /** AI score 0–100. */
    aiScore: number;
    /** Eden playground ai_score (0–1), same as Winston card. */
    edenAiScore: number | null;
    /** Eden winstonai output — same shape as Universal AI playground. */
    edenOutput: EdenWinstonOutput | null;
    provider: string | null;
    cost: string | null;
    humanScore: number | null;
    attempts: number;
    passed: boolean;
    threshold: number;
    escalateToHuman: boolean;
    creditsRemaining: number | null;
    humanizationReviewApplied?: boolean;
    aiScoreBeforeHumanization?: number | null;
    /** Present when Eden/Winston was unreachable and local scoring was used. */
    fallbackReason?: string | null;
  };
  humanizationReview: HumanizationReviewMeta | null;
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

function humanizeReviewEnabled(): boolean {
  const raw = (process.env.WINSTON_AI_HUMANIZE_ON_FAIL ?? "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

/**
 * Run Winston (or code fallback) detectLoop.
 * If AI score still fails threshold, run a full humanization review and re-score.
 */
export async function runArticleAiDetectPass(
  article: string,
  opts?: {
    toneHint?: string;
    voicePassFn?: (article: string, flagged: string[]) => Promise<string>;
    humanizeReviewFn?: (article: string, ctx: {
      aiScore: number;
      humanScore?: number | null;
      threshold: number;
    }) => Promise<string>;
  }
): Promise<ArticleDetectPassResult> {
  const threshold = Number(process.env.WINSTON_AI_RISK_THRESHOLD ?? "30");
  const maxRetries = Number(process.env.WINSTON_AI_MAX_RETRIES ?? "2") || 2;
  const safeThreshold = Number.isFinite(threshold) ? threshold : 30;

  const defaultVoicePass = async (text: string, flagged: string[]) => {
    if (flagged.length > 0) {
      return voicePassFlaggedArticle(text, flagged, { toneHint: opts?.toneHint });
    }
    // High AI score with no sentence flags → still humanize (full review-style pass)
    return runHumanizationReviewLayer(text, {
      toneHint: opts?.toneHint,
      threshold: safeThreshold,
    });
  };

  let loop = await detectLoop({
    article,
    threshold: safeThreshold,
    maxRetries,
    detectFn: detectArticleAiScore,
    voicePassFn: opts?.voicePassFn ?? defaultVoicePass,
  });

  let humanizationReview: HumanizationReviewMeta | null = null;

  if (!loop.passed && humanizeReviewEnabled()) {
    const aiScoreBefore = loop.score;
    const humanScoreBefore = loop.humanScore ?? null;
    console.warn(
      `[ai-detect] AI score ${aiScoreBefore} >= threshold ${safeThreshold}; running humanization review layer`
    );

    const reviewed = opts?.humanizeReviewFn
      ? await opts.humanizeReviewFn(loop.article, {
          aiScore: aiScoreBefore,
          humanScore: humanScoreBefore,
          threshold: safeThreshold,
        })
      : await runHumanizationReviewLayer(loop.article, {
          toneHint: opts?.toneHint,
          aiScore: aiScoreBefore,
          humanScore: humanScoreBefore,
          threshold: safeThreshold,
        });

    const after = await detectArticleAiScore(reviewed);
    loop = {
      article: reviewed,
      score: after.score,
      passed: after.score < safeThreshold,
      attempts: loop.attempts + 1,
      humanScore: after.humanScore,
      source: after.source,
      creditsRemaining: after.creditsRemaining,
      fallbackReason: after.fallbackReason ?? loop.fallbackReason,
      edenAiScore: after.edenAiScore,
      edenOutput: after.edenOutput,
      provider: after.provider,
      cost: after.cost,
    };

    humanizationReview = {
      applied: true,
      aiScoreBefore,
      humanScoreBefore,
      aiScoreAfter: loop.score,
      humanScoreAfter: loop.humanScore ?? null,
      passedAfter: loop.passed,
    };
  }

  const finalGuard = enforceHumanisationInCode(loop.article);

  return {
    article: loop.article,
    loop,
    codeGuards: {
      detectLoop: {
        source: loop.source ?? "code",
        score: loop.score,
        aiScore: loop.edenAiScore != null ? Math.round(loop.edenAiScore * 100) : loop.score,
        edenAiScore: loop.edenAiScore ?? null,
        edenOutput: loop.edenOutput ?? null,
        provider: loop.provider ?? (loop.source === "winston" ? "winstonai" : null),
        cost: loop.cost ?? null,
        humanScore: loop.humanScore ?? null,
        attempts: loop.attempts,
        passed: loop.passed,
        threshold: safeThreshold,
        escalateToHuman: !loop.passed,
        creditsRemaining: loop.creditsRemaining ?? null,
        humanizationReviewApplied: humanizationReview?.applied ?? false,
        aiScoreBeforeHumanization: humanizationReview?.aiScoreBefore ?? null,
        fallbackReason: loop.fallbackReason ?? null,
      },
      humanizationReview,
      blockedPhraseCount: finalGuard.blockHits.length,
      warnPhraseCount: finalGuard.warnHits.length,
      longParagraphCount: finalGuard.longParagraphs.length,
      remainingSendBacks: finalGuard.sendBacks,
    },
  };
}
