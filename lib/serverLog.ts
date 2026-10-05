import { getSupabaseAdmin } from "@/lib/supabase";

export type ServerLogLevel = "error" | "warn" | "info";

const MAX_MESSAGE = 8000;
let appLogsTableUnavailable = false;

/**
 * Persists a log row to Supabase (app_logs) for the /logs dashboard.
 * Never throws; failures only go to console so API handlers keep working.
 */
export async function serverLog(input: {
  level: ServerLogLevel;
  source: string;
  message: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  if (appLogsTableUnavailable) return;
  const message = input.message.slice(0, MAX_MESSAGE);
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("app_logs").insert({
      level: input.level,
      source: input.source.slice(0, 256),
      message,
      meta: input.meta ?? null,
    });
    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      const missingTable =
        error.code === "PGRST205" ||
        msg.includes("could not find the table") ||
        (msg.includes("app_logs") && msg.includes("schema cache"));
      if (missingTable) {
        appLogsTableUnavailable = true;
        console.warn(
          '[serverLog] "app_logs" table missing. Skipping log writes. Run supabase/migrations/004_app_logs.sql.'
        );
        return;
      }
      console.error("[serverLog] Supabase insert failed:", error.message, input.source);
    }
  } catch (e) {
    console.error("[serverLog] skipped (Supabase unavailable or misconfigured):", errorMessage(e));
  }
}

/**
 * Human-readable error text for logging and API JSON responses.
 * SDKs often throw plain objects (not Error), which would otherwise become "[object Object]".
 */
function networkHintFromCause(err: unknown): string | null {
  const walk = (e: unknown, depth: number): string | null => {
    if (depth > 4 || e == null) return null;
    if (typeof e === "object") {
      const o = e as Record<string, unknown>;
      const code = typeof o.code === "string" ? o.code : "";
      const hostname = typeof o.hostname === "string" ? o.hostname : "";
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
        return hostname
          ? `DNS lookup failed for ${hostname}. Check your network DNS (router DNS may be down; try 8.8.8.8 or 1.1.1.1).`
          : "DNS lookup failed. Check your network DNS (router DNS may be down; try 8.8.8.8 or 1.1.1.1).";
      }
      if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED") {
        return `Network error (${code}${hostname ? ` contacting ${hostname}` : ""}). Check your internet connection and retry.`;
      }
      if ("cause" in o) return walk(o.cause, depth + 1);
    }
    return null;
  };
  return walk(err, 0);
}

export function errorMessage(err: unknown): string {
  if (err == null) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const hint = networkHintFromCause(err);
    if (hint && (/^fetch failed$/i.test(err.message) || /getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(err.message))) {
      return hint;
    }
    const base = err.message?.trim() || err.name || "Error";
    if (err.cause !== undefined) {
      const c = errorMessage(err.cause);
      if (c && c !== "Unknown error") return `${base} (${c})`;
    }
    return hint && base === "fetch failed" ? hint : base;
  }
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.length > 0) return o.message;
    const nested = o.error;
    if (typeof nested === "string" && nested.length > 0) return nested;
    if (nested && typeof nested === "object") {
      const e = nested as Record<string, unknown>;
      if (typeof e.message === "string" && e.message.length > 0) return e.message;
      if (typeof e.detail === "string") return e.detail;
    }
    try {
      const s = JSON.stringify(err);
      if (s && s !== "{}") return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
    } catch {
      /* circular or non-serializable */
    }
  }
  return String(err);
}
