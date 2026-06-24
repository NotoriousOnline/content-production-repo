import Anthropic from "@anthropic-ai/sdk";
import { errorMessage } from "@/lib/serverLog";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

/** After retries, thrown so API routes can return 503 with a clear message. */
export const CLAUDE_OVERLOAD_USER_MESSAGE =
  "The AI service is temporarily overloaded. Wait a minute and try again.";

const MAX_ATTEMPTS = 7;
const DEFAULT_RETRY_MS = 15_000;
const BASE_OVERLOAD_BACKOFF_MS = 3000;
const MAX_BACKOFF_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function anthropicHttpStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === "number" && Number.isFinite(s)) return s;
  }
  return undefined;
}

function parseOverloadedFromMessage(err: unknown): boolean {
  const msg = errorMessage(err);
  try {
    const parsed = JSON.parse(msg) as unknown;
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      const inner = o.error;
      if (inner && typeof inner === "object") {
        const t = (inner as { type?: string }).type;
        const m = String((inner as { message?: string }).message ?? "").toLowerCase();
        if (t === "overloaded_error" || t === "RESOURCE_EXHAUSTED") return true;
        if (m.includes("overloaded") || m.includes("over capacity")) return true;
      }
    }
  } catch {
    /* not JSON */
  }
  return false;
}

/** Billing / credit errors — retries will not help; callers should use a non-Claude fallback. */
export function isAnthropicBillingError(err: unknown): boolean {
  const status = anthropicHttpStatus(err);
  if (status === 402 || status === 403) return true;
  const lower = errorMessage(err).toLowerCase();
  return (
    lower.includes("credit balance") ||
    lower.includes("insufficient credit") ||
    lower.includes("purchase credits") ||
    lower.includes("plans & billing")
  );
}

/** True when a route should use HTTP 503 instead of 500. */
export function isClaudeServiceUnavailableError(err: unknown): boolean {
  if (errorMessage(err) === CLAUDE_OVERLOAD_USER_MESSAGE) return true;
  const status = anthropicHttpStatus(err);
  if (status === 429 || status === 503 || status === 529) return true;
  if (parseOverloadedFromMessage(err)) return true;
  const lower = errorMessage(err).toLowerCase();
  return lower.includes("overloaded") || lower.includes("resource_exhausted");
}

function isRetryableAnthropicError(err: unknown): boolean {
  const status = anthropicHttpStatus(err);
  if (status !== undefined && (status === 429 || status === 502 || status === 503 || status === 529)) {
    return true;
  }
  if (parseOverloadedFromMessage(err)) return true;
  const msg = errorMessage(err).toLowerCase();
  return (
    /rate.?limit|429/.test(msg) ||
    msg.includes("overloaded") ||
    msg.includes("resource_exhausted") ||
    msg.includes("529") ||
    msg.includes("503") ||
    msg.includes("502")
  );
}

function retryDelayMsFromError(err: unknown): number {
  if (err && typeof err === "object") {
    const o = err as { status?: number; headers?: Headers | Record<string, string> };
    if (o.status !== 429) return DEFAULT_RETRY_MS;
    const h = o.headers;
    if (h && typeof (h as Headers).get === "function") {
      const ra = (h as Headers).get("retry-after");
      if (ra) {
        const sec = parseInt(ra, 10);
        if (!Number.isNaN(sec) && sec > 0) return Math.min(sec * 1000, 120_000);
      }
    }
    if (h && typeof h === "object" && !(h instanceof Headers)) {
      const rec = h as Record<string, string>;
      const ra = rec["retry-after"] ?? rec["Retry-After"];
      if (ra) {
        const sec = parseInt(String(ra), 10);
        if (!Number.isNaN(sec) && sec > 0) return Math.min(sec * 1000, 120_000);
      }
    }
  }
  return DEFAULT_RETRY_MS;
}

function backoffForOverload(attemptIndex: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_OVERLOAD_BACKOFF_MS * 2 ** attemptIndex);
  const jitter = Math.floor(Math.random() * 2000);
  return Math.min(MAX_BACKOFF_MS, exp + jitter);
}

function computeRetryWaitMs(err: unknown, attemptIndex: number): number {
  if (anthropicHttpStatus(err) === 429) {
    return retryDelayMsFromError(err);
  }
  return backoffForOverload(attemptIndex);
}

/**
 * Calls Claude with a system prompt and user message.
 * SERVER-SIDE ONLY — import only from /app/api/
 *
 * Retries on rate limits (429), overload (529), and common transient errors with backoff.
 */
export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  opts?: { maxTokens?: number }
): Promise<string> {
  const maxTokens = opts?.maxTokens ?? 2048;
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      const firstBlock = response.content[0];
      if (firstBlock?.type === "text") {
        return firstBlock.text;
      }
      return "";
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableAnthropicError(err);
      const hasMore = attempt < MAX_ATTEMPTS - 1;
      if (!retryable || !hasMore) {
        break;
      }
      const wait = computeRetryWaitMs(err, attempt);
      const st = anthropicHttpStatus(err);
      console.warn(
        `[anthropic] Retryable error${st != null ? ` (${st})` : ""}, attempt ${attempt + 1}/${MAX_ATTEMPTS}, waiting ${Math.round(wait / 1000)}s`
      );
      await sleep(wait);
    }
  }

  if (lastErr instanceof Error) {
    if (isRetryableAnthropicError(lastErr)) {
      throw new Error(CLAUDE_OVERLOAD_USER_MESSAGE, { cause: lastErr });
    }
    throw lastErr;
  }
  // SDK may reject with a plain object; normalize so callers get a real message and stack.
  throw new Error(errorMessage(lastErr), { cause: lastErr });
}
