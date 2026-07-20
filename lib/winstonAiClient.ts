/**
 * AI content detection via Eden AI → Winston AI model.
 * Playground: https://app.edenai.run/playground/universal-ai?feature=text%2Fai_detection&models=text%2Fai_detection%2Fwinstonai
 * Docs: https://www.edenai.co/docs/v3/expert-models/features/text/ai-detection
 *
 * Eden Winston output (same as playground):
 * - ai_score: float 0–1 (AI likelihood; higher = more AI)
 * - items: sentence-level { text, prediction, ai_score, ai_score_detail }
 */

export type EdenWinstonItem = {
  text: string;
  prediction: string;
  ai_score: number;
  ai_score_detail: number;
};

/** Raw Eden Universal AI output shape for winstonai (matches playground card). */
export type EdenWinstonOutput = {
  ai_score: number;
  items: EdenWinstonItem[];
};

export type WinstonSentenceScore = {
  text: string;
  /** Human likelihood 0–100 (higher = more human). */
  score: number;
  prediction?: string;
  /** Raw Eden item ai_score 0–1. */
  aiScore01?: number;
};

export type WinstonAiDetectionResult = {
  status: number;
  /** Human score 0–100 (higher = more human). */
  humanScore: number;
  /** AI-risk score 0–100 (higher = more AI). */
  aiScore: number;
  /** Raw Eden ai_score 0–1 (same field as playground). */
  edenAiScore: number;
  /** Eden playground-shaped payload for UI. */
  edenOutput: EdenWinstonOutput;
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
const FETCH_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.EDEN_AI_FETCH_RETRIES ?? "3") || 3
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.message} ${String((err as Error & { cause?: unknown }).cause ?? "")}`
      : String(err);
  return /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|network|socket/i.test(
    msg
  );
}

async function fetchEdenWithRetry(init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
    try {
      return await fetch(EDEN_UNIVERSAL_ENDPOINT, init);
    } catch (err) {
      lastErr = err;
      if (!isTransientNetworkError(err) || attempt === FETCH_MAX_ATTEMPTS) {
        throw err;
      }
      const backoffMs = 400 * attempt;
      console.warn(
        `[eden-winston] network error (attempt ${attempt}/${FETCH_MAX_ATTEMPTS}); retrying in ${backoffMs}ms:`,
        err instanceof Error ? err.message : err
      );
      await sleep(backoffMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

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

/** Parse Eden ai_score float (usually 0–1). */
function toAiScore01(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n > 1 && n <= 100) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

function parseEdenItems(items: unknown): EdenWinstonItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      const ai01 = toAiScore01(r.ai_score);
      return {
        text: String(r.text ?? "").trim(),
        prediction: String(r.prediction ?? "").trim() || (ai01 >= 0.5 ? "ai-generated" : "original"),
        ai_score: ai01,
        ai_score_detail: toAiScore01(r.ai_score_detail ?? r.ai_score),
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

  const res = await fetchEdenWithRetry({
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

  // Prefer Eden-normalized playground field (ai_score 0–1 = AI likelihood)
  const edenAiScore = toAiScore01(output.ai_score);
  const items = parseEdenItems(output.items);
  // Cap payload size for API/UI (Eden playground also collapses long lists)
  const itemsForUi = items.slice(0, 80);
  const aiScore = Math.round(edenAiScore * 100);
  const humanScore = Math.max(0, Math.min(100, 100 - aiScore));

  const sentences: WinstonSentenceScore[] = items.map((item) => ({
    text: item.text,
    score: Math.max(0, Math.min(100, Math.round((1 - item.ai_score) * 100))),
    prediction: item.prediction,
    aiScore01: item.ai_score,
  }));

  return {
    status: res.status,
    humanScore,
    aiScore,
    edenAiScore,
    edenOutput: {
      ai_score: edenAiScore,
      items: itemsForUi,
    },
    sentences,
    creditsUsed: undefined,
    creditsRemaining: undefined,
    version: typeof original?.version === "string" ? original.version : undefined,
    language: typeof original?.language === "string" ? original.language : undefined,
    provider: typeof json.provider === "string" ? json.provider : "winstonai",
    cost: json.cost != null ? String(json.cost) : undefined,
  };
}
