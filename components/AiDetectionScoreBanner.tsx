"use client";

import { useState } from "react";

export type EdenWinstonItemInfo = {
  text: string;
  prediction: string;
  ai_score: number;
  ai_score_detail: number;
};

export type EdenWinstonOutputInfo = {
  ai_score: number;
  items: EdenWinstonItemInfo[];
};

export type HumanizationReviewInfo = {
  applied?: boolean;
  aiScoreBefore?: number | null;
  humanScoreBefore?: number | null;
  aiScoreAfter?: number | null;
  humanScoreAfter?: number | null;
  passedAfter?: boolean;
};

export type AiDetectionScoreInfo = {
  source?: "winston" | "code" | string;
  /** Internal AI-risk 0–100. */
  score?: number;
  aiScore?: number | null;
  /** Eden playground ai_score 0–1. */
  edenAiScore?: number | null;
  edenOutput?: EdenWinstonOutputInfo | null;
  provider?: string | null;
  cost?: string | null;
  humanScore?: number | null;
  attempts?: number;
  passed?: boolean;
  threshold?: number;
  escalateToHuman?: boolean;
  humanizationReviewApplied?: boolean;
  aiScoreBeforeHumanization?: number | null;
  humanizationReview?: HumanizationReviewInfo | null;
  fallbackReason?: string | null;
};

type Props = {
  detect?: AiDetectionScoreInfo | null;
  className?: string;
};

function formatEdenAiScore(n: number): string {
  // Match Eden playground precision style (e.g. 0.8888888888888889)
  return String(n);
}

/**
 * Shows Winston/Eden AI detection in the same shape as the Eden Universal AI playground card.
 */
export function AiDetectionScoreBanner({ detect, className = "" }: Props) {
  const [showItems, setShowItems] = useState(false);

  if (!detect || (detect.score == null && detect.aiScore == null && detect.edenAiScore == null && detect.humanScore == null)) {
    return null;
  }

  const edenAiScore =
    detect.edenAiScore ??
    detect.edenOutput?.ai_score ??
    (detect.aiScore != null ? detect.aiScore / 100 : null) ??
    (detect.score != null ? detect.score / 100 : null);

  const items = detect.edenOutput?.items ?? [];
  const passed = detect.passed;
  const hr = detect.humanizationReview;
  const humanized =
    detect.humanizationReviewApplied === true || hr?.applied === true;
  const isWinston = detect.source === "winston" && edenAiScore != null;

  const tone =
    passed === false
      ? "border-amber-300 bg-amber-50"
      : passed === true
        ? "border-emerald-200 bg-emerald-50"
        : "border-slate-200 bg-slate-50";

  const playgroundJson = {
    ai_score: edenAiScore,
    items: items.length > 0 ? `[...] ${items.length} items` : [],
  };

  return (
    <div className={`rounded-lg border ${tone} ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-black/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              isWinston ? "bg-emerald-500" : "bg-amber-500"
            }`}
          />
          <p className="text-sm font-semibold text-slate-900">
            {isWinston ? "Winstonai" : "Local cadence check"}
          </p>
          {isWinston ? (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800">
              Eden · text/ai_detection/winstonai
            </span>
          ) : null}
        </div>
        {passed != null ? (
          <p className="text-xs font-medium text-slate-700">
            {passed ? "Passed threshold" : "Above threshold"}
          </p>
        ) : null}
      </div>

      <div className="space-y-3 px-3 py-3">
        {isWinston && edenAiScore != null ? (
          <>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Text AI Content Detection
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Same field as Eden playground — <code className="text-slate-800">ai_score</code> (0–1, higher = more AI)
              </p>
            </div>

            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-800">
              <pre className="whitespace-pre-wrap break-all">{`{\n  "ai_score": ${formatEdenAiScore(edenAiScore)},\n  "items": ${
                items.length > 0 ? `[...] ${items.length} items` : "[]"
              }\n}`}</pre>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-slate-800">
              <p>
                <span className="text-xs uppercase tracking-wide text-slate-500">AI score</span>{" "}
                <span className="text-lg font-semibold tabular-nums text-slate-900">
                  {formatEdenAiScore(edenAiScore)}
                </span>
                <span className="text-slate-500">
                  {" "}
                  ({Math.round(edenAiScore * 100)}%)
                </span>
              </p>
              {detect.humanScore != null ? (
                <p>
                  <span className="text-xs uppercase tracking-wide text-slate-500">Human</span>{" "}
                  <span className="font-semibold tabular-nums">{detect.humanScore}%</span>
                </p>
              ) : null}
              {detect.cost ? (
                <p className="text-xs text-slate-500">Cost: ${detect.cost}</p>
              ) : null}
            </div>

            {items.length > 0 ? (
              <div>
                <button
                  type="button"
                  onClick={() => setShowItems((v) => !v)}
                  className="text-xs font-medium text-teal-700 underline hover:text-teal-800"
                >
                  {showItems ? "Hide" : "Show"} sentence items ({items.length})
                </button>
                {showItems ? (
                  <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded border border-slate-200 bg-white p-2">
                    {items.map((item, i) => (
                      <li key={`${i}-${item.text.slice(0, 24)}`} className="text-xs text-slate-700">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                            ai_score: {formatEdenAiScore(item.ai_score)}
                          </span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-600">
                            {item.prediction || "—"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-slate-600">{item.text}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="text-sm text-slate-800">
            <p className="font-medium">AI detection (fallback)</p>
            <p className="mt-1">
              AI score:{" "}
              <span className="font-semibold tabular-nums">
                {detect.aiScore ?? detect.score ?? "—"}
              </span>
              /100
              {detect.humanScore != null ? (
                <>
                  {" "}
                  · Human: <span className="font-semibold tabular-nums">{detect.humanScore}</span>/100
                </>
              ) : null}
            </p>
          </div>
        )}

        <p className="text-xs text-slate-500">
          {detect.threshold != null
            ? `Pass if AI risk < ${detect.threshold} (Eden ai_score < ${(detect.threshold / 100).toFixed(2)})`
            : null}
          {detect.attempts != null
            ? ` · ${detect.attempts} attempt${detect.attempts === 1 ? "" : "s"}`
            : null}
          {humanized ? " · humanization review applied" : null}
        </p>

        {detect.source === "code" && detect.fallbackReason ? (
          <p className="text-xs text-amber-800">
            Winston/Eden unavailable — used local check. {detect.fallbackReason}. Retry generate when
            network is stable.
          </p>
        ) : null}

        {/* Keep for copy/debug parity with Eden */}
        {isWinston ? (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer select-none font-medium text-slate-600">
              Raw Eden output summary
            </summary>
            <pre className="mt-1 overflow-x-auto rounded border border-slate-200 bg-white p-2 font-mono text-[11px] text-slate-700">
              {JSON.stringify(playgroundJson, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

/** Pull detectLoop payload from a generate-content `codeGuards` object. */
export function detectInfoFromCodeGuards(codeGuards: unknown): AiDetectionScoreInfo | null {
  if (!codeGuards || typeof codeGuards !== "object") return null;
  const guards = codeGuards as {
    detectLoop?: AiDetectionScoreInfo;
    humanizationReview?: HumanizationReviewInfo | null;
  };
  const loop = guards.detectLoop;
  if (!loop || typeof loop !== "object") return null;
  return {
    ...loop,
    aiScore: loop.aiScore ?? loop.score ?? null,
    edenAiScore: loop.edenAiScore ?? loop.edenOutput?.ai_score ?? null,
    edenOutput: loop.edenOutput ?? null,
    provider: loop.provider ?? null,
    cost: loop.cost ?? null,
    humanizationReview: guards.humanizationReview ?? loop.humanizationReview ?? null,
    humanizationReviewApplied:
      loop.humanizationReviewApplied ?? guards.humanizationReview?.applied ?? false,
    aiScoreBeforeHumanization:
      loop.aiScoreBeforeHumanization ?? guards.humanizationReview?.aiScoreBefore ?? null,
    fallbackReason: loop.fallbackReason ?? null,
  };
}
