/**
 * Winston AI text detection client.
 * Docs: https://docs.gowinston.ai/api-reference/v2/ai-content-detection/post
 *
 * score = human likelihood 0–100 (higher = more human).
 */

export type WinstonSentenceScore = {
  text: string;
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
};

const WINSTON_ENDPOINT = "https://api.gowinston.ai/v2/ai-content-detection";
const MIN_CHARS = 300;

export function getWinstonApiKey(): string {
  return (process.env.WINSTON_AI_API_KEY ?? process.env.WINSTONAI_API_KEY ?? "").trim();
}

/** Strip markdown/HTML to plain text for Winston (min 300 chars required by API). */
export function markdownToPlainTextForWinston(md: string): string {
  let text = md;
  // HTML articles: drop tags after keeping link/alt text hints lightly
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

export async function detectWinstonAiText(
  textOrMarkdown: string,
  opts?: { language?: string; version?: string; sentences?: boolean }
): Promise<WinstonAiDetectionResult> {
  const apiKey = getWinstonApiKey();
  if (!apiKey) {
    throw new Error("WINSTON_AI_API_KEY is not set");
  }

  let text = markdownToPlainTextForWinston(textOrMarkdown);
  if (text.length < MIN_CHARS) {
    throw new Error(
      `Winston AI needs at least ${MIN_CHARS} characters of text (got ${text.length}).`
    );
  }
  // API max 150_000 characters
  if (text.length > 150_000) {
    text = text.slice(0, 150_000);
  }

  const res = await fetch(WINSTON_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      text,
      sentences: opts?.sentences ?? true,
      language: opts?.language ?? "en",
      version: opts?.version ?? (process.env.WINSTON_AI_MODEL_VERSION?.trim() || "latest"),
    }),
  });

  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Winston AI returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 280)}`);
  }

  if (!res.ok) {
    const desc =
      typeof json.description === "string"
        ? json.description
        : typeof json.error === "string"
          ? json.error
          : raw.slice(0, 280);
    throw new Error(`Winston AI HTTP ${res.status}: ${desc}`);
  }

  const humanScore = Math.round(Number(json.score ?? 0));
  const sentencesRaw = Array.isArray(json.sentences) ? json.sentences : [];
  const sentences: WinstonSentenceScore[] = sentencesRaw
    .map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        text: String(r.text ?? "").trim(),
        score: Math.round(Number(r.score ?? 0)),
      };
    })
    .filter((s) => s.text.length > 0);

  return {
    status: typeof json.status === "number" ? json.status : res.status,
    humanScore: Math.max(0, Math.min(100, humanScore)),
    aiScore: Math.max(0, Math.min(100, 100 - humanScore)),
    sentences,
    creditsUsed: typeof json.credits_used === "number" ? json.credits_used : undefined,
    creditsRemaining: typeof json.credits_remaining === "number" ? json.credits_remaining : undefined,
    version: typeof json.version === "string" ? json.version : undefined,
    language: typeof json.language === "string" ? json.language : undefined,
  };
}
