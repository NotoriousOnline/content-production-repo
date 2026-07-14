/**
 * AI content detection via Eden AI → Winston AI model.
 * Playground: https://app.edenai.run/playground/universal-ai?feature=text%2Fai_detection&models=text%2Fai_detection%2Fwinstonai
 * Docs: https://www.edenai.co/docs/v3/expert-models/features/text/ai-detection
 *
 * Internal convention (matches prior Winston direct client):
 * - humanScore 0–100 (higher = more human)
 * - aiScore 0–100 (higher = more AI) = 100 - humanScore
 */

export type WinstonSentenceScore = {
  text: string;
  /** Human likelihood 0–100 (higher = more human). */
  score: number;
};

export type WinstonAiDetectionResult = {
  status: number;
  /** Human score 0–100 (higher = more human). */
  humanScore: number;
  /** AI-risk score 0–100 (higher = more AI) = 100 - humanScore. */
  aiScore: number;
  sentences: WinstonSentenceScore[];
  creditsUsed?: number;
  creditsRemaining?: number;
  version?: string;
  language?: string;
  provider?: string;
  cost?: string;
};

const EDEN_UNIVERSAL_ENDPOINT = "https://api.edenai.run/v3/universal-ai";
const EDEN_WINSTON_MODEL =
  process.env.EDEN_AI_DETECTION_MODEL?.trim() || "text/ai_detection/winstonai";
const MIN_CHARS = 300;

export function getEdenAiApiKey(): string {
  return (process.env.EDEN_AI_API_KEY ?? process.env.EDENAI_API_KEY ?? "").trim();
}

/** @deprecated Prefer getEdenAiApiKey — kept for older call sites. */
export function getWinstonApiKey(): string {
  return getEdenAiApiKey();
}

/** Strip markdown/HTML to plain text for detection (min 300 chars required). */
export function markdownToPlainTextForWinston(md: string): string {
  let text = md;
  if (/<\/?[a-z][\s\S]*>/i.test(text)) {
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section)>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ");
  }
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_>`]/g, "")
    .replace(/\|/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export const toPlainTextForWinston = markdownToPlainTextForWinston;

/** Normalize Eden float (0–1 or 0–100) to integer 0–100. */
function toScore100(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n >= 0 && n <= 1) return Math.round(n * 100);
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Eden normalizes provider output as `ai_score` = AI-likelihood.
 * Winston's native `score` is human-likelihood — prefer that when original_response is present.
 */
function resolveScores(args: {
  outputAiScore: unknown;
  original?: Record<string, unknown> | null;
}): { humanScore: number; aiScore: number } {
  const original = args.original ?? null;
  if (original && original.score != null) {
    const humanScore = toScore100(original.score);
    return { humanScore, aiScore: Math.max(0, Math.min(100, 100 - humanScore)) };
  }
  const aiScore = toScore100(args.outputAiScore);
  return { humanScore: Math.max(0, Math.min(100, 100 - aiScore)), aiScore };
}

function parseSentences(
  items: unknown,
  originalSentences: unknown
): WinstonSentenceScore[] {
  const fromOriginal = Array.isArray(originalSentences) ? originalSentences : [];
  if (fromOriginal.length > 0) {
    return fromOriginal
      .map((row) => {
        const r = (row ?? {}) as Record<string, unknown>;
        // Winston original: score = human likelihood
        return {
          text: String(r.text ?? "").trim(),
          score: toScore100(r.score),
        };
      })
      .filter((s) => s.text.length > 0);
  }

  const fromItems = Array.isArray(items) ? items : [];
  return fromItems
    .map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      const aiScore = toScore100(r.ai_score);
      return {
        text: String(r.text ?? "").trim(),
        score: Math.max(0, Math.min(100, 100 - aiScore)),
      };
    })
    .filter((s) => s.text.length > 0);
}

/**
 * Run Winston AI detection through Eden AI Universal API.
 */
export async function detectWinstonAiText(
  textOrMarkdown: string,
  _opts?: { language?: string; version?: string; sentences?: boolean }
): Promise<WinstonAiDetectionResult> {
  const apiKey = getEdenAiApiKey();
  if (!apiKey) {
    throw new Error("EDEN_AI_API_KEY is not set");
  }

  let text = markdownToPlainTextForWinston(textOrMarkdown);
  if (text.length < MIN_CHARS) {
    throw new Error(
      `Eden/Winston AI detection needs at least ${MIN_CHARS} characters of text (got ${text.length}).`
    );
  }
  if (text.length > 150_000) {
    text = text.slice(0, 150_000);
  }

  const res = await fetch(EDEN_UNIVERSAL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: EDEN_WINSTON_MODEL,
      input: { text },
      show_original_response: true,
    }),
  });

  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Eden AI returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 280)}`);
  }

  if (!res.ok) {
    const desc =
      typeof json.error === "object" && json.error && "message" in (json.error as object)
        ? String((json.error as { message?: unknown }).message)
        : typeof json.error === "string"
          ? json.error
          : typeof json.detail === "string"
            ? json.detail
            : raw.slice(0, 280);
    throw new Error(`Eden AI HTTP ${res.status}: ${desc}`);
  }

  if (json.status === "fail") {
    const err =
      typeof json.error === "object" && json.error
        ? JSON.stringify(json.error).slice(0, 280)
        : String(json.error ?? "unknown failure");
    throw new Error(`Eden AI detection failed: ${err}`);
  }

  const output =
    json.output && typeof json.output === "object"
      ? (json.output as Record<string, unknown>)
      : json;
  const original =
    json.original_response && typeof json.original_response === "object"
      ? (json.original_response as Record<string, unknown>)
      : null;

  const { humanScore, aiScore } = resolveScores({
    outputAiScore: output.ai_score,
    original,
  });

  const sentences = parseSentences(output.items, original?.sentences);

  return {
    status: res.status,
    humanScore,
    aiScore,
    sentences,
    creditsUsed: undefined,
    creditsRemaining: undefined,
    version: typeof original?.version === "string" ? original.version : undefined,
    language: typeof original?.language === "string" ? original.language : undefined,
    provider: typeof json.provider === "string" ? json.provider : "winstonai",
    cost: json.cost != null ? String(json.cost) : undefined,
  };
}
