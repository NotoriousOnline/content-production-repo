import { ApiError, GoogleGenAI, Modality, PersonGeneration, SafetyFilterLevel } from "@google/genai";
import { errorMessage } from "@/lib/serverLog";

/** Thrown when retryable Imagen errors persist after all attempts (client should show 503-style guidance). */
export const IMAGE_GENERATION_OVERLOAD_USER_MESSAGE =
  "Image generation is temporarily overloaded. Wait a minute and try again, or generate fewer images at once.";

/** Daily / billing quota hit — retries will not help until the quota resets or the plan changes. */
export const IMAGE_GENERATION_QUOTA_EXCEEDED_USER_MESSAGE =
  "Google Imagen daily quota is used up (or billing limits apply). Wait until tomorrow, reduce how many images you generate at once, or raise limits in Google AI Studio / Google Cloud billing for this API key.";

/** HTTP 200 but no image bytes after retries (transient or prompt/model issue). */
export const IMAGE_GENERATION_EMPTY_USER_MESSAGE =
  "Image generation did not return image data. Wait a moment and try again, or simplify the image prompt.";

/** Internal marker for empty-body responses we should retry. */
const IMAGEN_NO_BYTES_TRANSIENT = "__IMAGEN_NO_BYTES_TRANSIENT__";

/**
 * If Imagen returns a paid-plan error, `generateImage` falls back to `gemini-2.5-flash-image` automatically.
 * Exported for tests or callers that document Imagen billing requirements.
 */
export const IMAGE_GENERATION_IMAGEN_REQUIRES_PAID_PLAN_MESSAGE =
  "Imagen (imagen-3/4) requires a paid Google AI plan on this API key; use gemini-2.5-flash-image or rely on automatic fallback.";

type GeneratedImageEntry = {
  image?: { imageBytes?: string; mimeType?: string };
  raiFilteredReason?: string;
};

function pickImageFromResult(result: { generatedImages?: GeneratedImageEntry[] }): {
  base64: string;
  mimeType: string;
} | null {
  const imgs = result.generatedImages ?? [];
  const raiReasons: string[] = [];
  for (const gi of imgs) {
    const bytes = gi.image?.imageBytes;
    if (typeof bytes === "string" && bytes.length > 0) {
      return {
        base64: bytes,
        mimeType: gi.image?.mimeType ?? "image/png",
      };
    }
    if (gi.raiFilteredReason) raiReasons.push(gi.raiFilteredReason);
  }
  if (raiReasons.length > 0) {
    throw new Error(`Imagen content policy: ${raiReasons[0]}`);
  }
  return null;
}

function pickImageFromGeminiContent(response: {
  candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
}): { base64: string; mimeType: string } | null {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const bytes = p.inlineData?.data;
    if (typeof bytes === "string" && bytes.length > 0) {
      return {
        base64: bytes,
        mimeType: p.inlineData?.mimeType ?? "image/png",
      };
    }
  }
  return null;
}

function usesImagenGenerateImagesApi(modelId: string): boolean {
  return modelId.toLowerCase().startsWith("imagen");
}

function isImagenPaidPlanError(err: unknown): boolean {
  const m = errorMessage(err).toLowerCase();
  if (m.includes("only available on paid plans")) return true;
  if (m.includes("upgrade your account") && m.includes("imagen")) return true;
  return false;
}

function geminiHttpStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "status" in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === "number" && Number.isFinite(s)) return s;
  }
  return undefined;
}

/** Daily or per-model quota (not the same as short-lived rate limits that sometimes recover on retry). */
function isDailyQuotaExceededError(err: unknown): boolean {
  const raw = errorMessage(err);
  const m = raw.toLowerCase();
  if (m.includes("exceeded your current quota")) return true;
  if (m.includes("check your plan and billing")) return true;
  if (m.includes("predict_requests_per_model_per_day") || m.includes("requests_per_model_per_day")) return true;
  if (m.includes("quota metric") && m.includes("limit")) return true;
  if (m.includes("resource_exhausted") && m.includes("quota")) return true;
  return false;
}

/** JSON body on ApiError.message (Google GenAI SDK stringifies errors). */
function parseOverloadedFromApiErrorMessage(err: unknown): boolean {
  if (isDailyQuotaExceededError(err)) return false;
  const msg = errorMessage(err);
  try {
    const parsed = JSON.parse(msg) as unknown;
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      const inner = o.error;
      if (inner && typeof inner === "object") {
        const t = (inner as { type?: string }).type;
        const im = String((inner as { message?: string }).message ?? "").toLowerCase();
        if (im.includes("quota") && im.includes("exceeded")) return false;
        if (t === "overloaded_error" || t === "RESOURCE_EXHAUSTED") return true;
        if (im.includes("overloaded") || im.includes("resource exhausted")) return true;
      }
    }
  } catch {
    /* not JSON */
  }
  return false;
}

/** True when the route should return 503 (retry later) rather than 500. */
export function isImageGenerationOverloadExhausted(err: unknown): boolean {
  if (errorMessage(err) === IMAGE_GENERATION_OVERLOAD_USER_MESSAGE) return true;
  if (errorMessage(err) === IMAGE_GENERATION_QUOTA_EXCEEDED_USER_MESSAGE) return false;
  if (isDailyQuotaExceededError(err)) return false;
  const status = geminiHttpStatus(err);
  if (status === 429 || status === 503 || status === 529) return true;
  if (parseOverloadedFromApiErrorMessage(err)) return true;
  const lower = errorMessage(err).toLowerCase();
  return lower.includes("overloaded") || lower.includes("resource_exhausted");
}

/** Map handler errors to HTTP status (overload 503, safety 422, empty 503, else 500). */
export function httpStatusForImageGenerationError(err: unknown): number {
  const msg = errorMessage(err);
  if (msg.startsWith("Imagen content policy:")) return 422;
  if (msg === IMAGE_GENERATION_EMPTY_USER_MESSAGE) return 503;
  if (msg === IMAGE_GENERATION_QUOTA_EXCEEDED_USER_MESSAGE) return 429;
  if (isDailyQuotaExceededError(err)) return 429;
  if (isImageGenerationOverloadExhausted(err)) return 503;
  return 500;
}

let lastCallTime = 0;
/** Minimum gap between Imagen API calls to reduce burst overload. */
const DELAY_MS = 3000;

const MAX_IMAGE_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 3000;
const MAX_BACKOFF_MS = 120_000;
const MAX_POLICY_FALLBACKS = 1;

/**
 * Default: Gemini native image generation (works on free AI Studio tier).
 * Set GEMINI_IMAGE_MODEL to an `imagen-*` id only if your project has Imagen (paid) access.
 */
const DEFAULT_IMAGE_MODEL_ID = "gemini-2.5-flash-image";

function resolvedImageModelId(): string {
  const m = process.env.GEMINI_IMAGE_MODEL?.trim();
  return m && m.length > 0 ? m : DEFAULT_IMAGE_MODEL_ID;
}

async function delayIfNeeded(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < DELAY_MS && lastCallTime > 0) {
    await new Promise((r) => setTimeout(r, DELAY_MS - elapsed));
  }
  lastCallTime = Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attemptIndex: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attemptIndex);
  const jitter = Math.floor(Math.random() * 1500);
  return Math.min(MAX_BACKOFF_MS, exp + jitter);
}

function isRetryableImagenError(err: unknown): boolean {
  if (isDailyQuotaExceededError(err)) return false;
  const msg = errorMessage(err);
  if (msg === IMAGEN_NO_BYTES_TRANSIENT) return true;
  const byStatus = geminiHttpStatus(err);
  if (byStatus !== undefined && (byStatus === 429 || byStatus === 500 || byStatus === 502 || byStatus === 503 || byStatus === 529)) {
    return true;
  }
  if (err instanceof ApiError) {
    const s = err.status;
    if (s === 429 || s === 500 || s === 502 || s === 503 || s === 529) return true;
  }
  if (parseOverloadedFromApiErrorMessage(err)) return true;
  const lower = msg.toLowerCase();
  return (
    lower.includes("overloaded") ||
    lower.includes("resource_exhausted") ||
    lower.includes("unavailable") ||
    lower.includes("529") ||
    lower.includes("503") ||
    lower.includes("502")
  );
}

function buildPolicySafeFallbackPrompt(originalPrompt: string): string {
  const cleaned = originalPrompt
    // Remove common trigger words that often cause policy filtering.
    .replace(/\b(cannabis|marijuana|weed|thc|delta-?9|vape|vaping|smoking|joint|dab|bong)\b/gi, "botanical")
    .replace(/\s+/g, " ")
    .trim();
  return `${cleaned}. Keep it neutral and educational, non-explicit, no consumption, no smoke, no drug paraphernalia, no people, still photorealistic editorial style.`;
}

export type GenerateImageOptions = {
  /** Supported: "1:1", "3:4", "4:3", "9:16", "16:9", and "21:9" (Gemini image config). Editorial/blog images use landscape. */
  aspectRatio?: string;
};

export async function generateImage(
  prompt: string,
  options?: GenerateImageOptions
): Promise<{ base64: string; mimeType: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const genAI = new GoogleGenAI({ apiKey });
  const requestedId = resolvedImageModelId();
  /** After a paid-plan Imagen error we switch to Gemini for the rest of the request / retries. */
  let mode: "imagen" | "gemini" = usesImagenGenerateImagesApi(requestedId) ? "imagen" : "gemini";
  let contentModelId = requestedId;
  let lastErr: unknown;
  let activePrompt = prompt;
  let policyFallbacksUsed = 0;

  for (let attempt = 0; attempt < MAX_IMAGE_ATTEMPTS; attempt++) {
    await delayIfNeeded();
    try {
      if (mode === "imagen") {
        try {
          const result = await genAI.models.generateImages({
            model: contentModelId,
            prompt: activePrompt,
            config: {
              numberOfImages: 1,
              includeRaiReason: true,
              aspectRatio: options?.aspectRatio ?? "16:9",
              safetyFilterLevel: SafetyFilterLevel.BLOCK_LOW_AND_ABOVE,
              personGeneration: PersonGeneration.ALLOW_ADULT,
            },
          });

          const picked = pickImageFromResult(result);
          if (picked) {
            return picked;
          }

          if (process.env.NODE_ENV === "development") {
            console.warn("[geminiClient] Imagen returned no image bytes", {
              count: result.generatedImages?.length ?? 0,
              rai: result.generatedImages?.map((g) => g.raiFilteredReason) ?? [],
            });
          }

          throw new Error(IMAGEN_NO_BYTES_TRANSIENT);
        } catch (imagenErr) {
          if (isImagenPaidPlanError(imagenErr)) {
            console.warn(
              "[geminiClient] Imagen is not available on this API key (paid plan required). Falling back to",
              DEFAULT_IMAGE_MODEL_ID
            );
            mode = "gemini";
            contentModelId = DEFAULT_IMAGE_MODEL_ID;
          } else {
            throw imagenErr;
          }
        }
      }

      if (mode === "gemini") {
        const response = await genAI.models.generateContent({
          model: contentModelId,
          contents: activePrompt,
          config: {
            responseModalities: [Modality.TEXT, Modality.IMAGE],
            imageConfig: {
              aspectRatio: options?.aspectRatio ?? "16:9",
            },
          },
        });

        const picked = pickImageFromGeminiContent(response);
        if (picked) {
          return picked;
        }

        if (process.env.NODE_ENV === "development") {
          console.warn("[geminiClient] Gemini image model returned no inline image bytes");
        }
        throw new Error(IMAGEN_NO_BYTES_TRANSIENT);
      }
    } catch (err) {
      lastErr = err;
      const msg = errorMessage(err);
      if (isDailyQuotaExceededError(err)) {
        console.warn("[geminiClient] Image generation quota or billing limit reached — not retrying.");
        break;
      }
      const isPolicyFiltered = mode === "imagen" && msg.startsWith("Imagen content policy:");
      if (isPolicyFiltered && policyFallbacksUsed < MAX_POLICY_FALLBACKS) {
        policyFallbacksUsed += 1;
        activePrompt = buildPolicySafeFallbackPrompt(prompt);
        console.warn("[geminiClient] Imagen filtered content; retrying with policy-safe fallback prompt");
        continue;
      }
      const retryable = isRetryableImagenError(err);
      const hasMore = attempt < MAX_IMAGE_ATTEMPTS - 1;
      if (!retryable || !hasMore) {
        break;
      }
      const wait = backoffMs(attempt);
      console.warn(
        `[geminiClient] Image generation failed (attempt ${attempt + 1}/${MAX_IMAGE_ATTEMPTS}), retrying in ${wait}ms:`,
        err instanceof Error ? err.message : err
      );
      await sleep(wait);
    }
  }

  if (lastErr != null && isDailyQuotaExceededError(lastErr)) {
    throw new Error(IMAGE_GENERATION_QUOTA_EXCEEDED_USER_MESSAGE, { cause: lastErr });
  }
  if (lastErr instanceof Error) {
    if (lastErr.message === IMAGEN_NO_BYTES_TRANSIENT) {
      throw new Error(IMAGE_GENERATION_EMPTY_USER_MESSAGE, { cause: lastErr });
    }
    if (isRetryableImagenError(lastErr)) {
      throw new Error(IMAGE_GENERATION_OVERLOAD_USER_MESSAGE, { cause: lastErr });
    }
    throw lastErr;
  }
  throw lastErr;
}
