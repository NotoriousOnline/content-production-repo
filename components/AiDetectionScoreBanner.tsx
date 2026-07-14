"use client";

export type AiDetectionScoreInfo = {
  source?: "winston" | "code" | string;
  /** AI-risk 0–100 (higher = more AI). */
  score?: number;
  aiScore?: number | null;
  humanScore?: number | null;
  attempts?: number;
  passed?: boolean;
  threshold?: number;
  escalateToHuman?: boolean;
};

type Props = {
  detect?: AiDetectionScoreInfo | null;
  className?: string;
};

/**
 * Shows Winston/Eden AI detection score after content generation.
 */
export function AiDetectionScoreBanner({ detect, className = "" }: Props) {
  if (!detect || (detect.score == null && detect.aiScore == null && detect.humanScore == null)) {
    return null;
  }

  const aiScore = detect.aiScore ?? detect.score ?? null;
  const humanScore =
    detect.humanScore ?? (aiScore != null ? Math.max(0, Math.min(100, 100 - aiScore)) : null);
  const passed = detect.passed;
  const sourceLabel =
    detect.source === "winston"
      ? "Winston AI (via Eden)"
      : detect.source === "code"
        ? "Local cadence check"
        : detect.source ?? "Detector";

  const tone =
    passed === false
      ? "border-amber-300 bg-amber-50 text-amber-950"
      : passed === true
        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
        : "border-slate-200 bg-slate-50 text-slate-800";

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-sm ${tone} ${className}`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="font-medium">AI detection</p>
        {aiScore != null && (
          <p>
            <span className="text-xs uppercase tracking-wide opacity-70">AI score</span>{" "}
            <span className="text-base font-semibold tabular-nums">{aiScore}</span>
            <span className="opacity-70"> / 100</span>
          </p>
        )}
        {humanScore != null && (
          <p>
            <span className="text-xs uppercase tracking-wide opacity-70">Human score</span>{" "}
            <span className="font-semibold tabular-nums">{humanScore}</span>
            <span className="opacity-70"> / 100</span>
          </p>
        )}
        {passed != null && (
          <p className="text-xs font-medium">
            {passed ? "Passed threshold" : "Above threshold — review recommended"}
          </p>
        )}
      </div>
      <p className="mt-1 text-xs opacity-80">
        {sourceLabel}
        {detect.threshold != null ? ` · pass if AI score < ${detect.threshold}` : null}
        {detect.attempts != null ? ` · ${detect.attempts} attempt${detect.attempts === 1 ? "" : "s"}` : null}
      </p>
    </div>
  );
}

/** Pull detectLoop payload from a generate-content `codeGuards` object. */
export function detectInfoFromCodeGuards(codeGuards: unknown): AiDetectionScoreInfo | null {
  if (!codeGuards || typeof codeGuards !== "object") return null;
  const loop = (codeGuards as { detectLoop?: AiDetectionScoreInfo }).detectLoop;
  if (!loop || typeof loop !== "object") return null;
  return {
    ...loop,
    aiScore: loop.aiScore ?? loop.score ?? null,
  };
}
