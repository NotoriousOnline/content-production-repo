import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeApplicationPassword, type WPSite } from "@/lib/wordpressClient";

/** Which content tool owns this row (separate site lists per product). */
export type WPToolScope =
  | "content-production"
  | "weed-com-content-production"
  | "farm-com-content-production";

export const WP_TOOL_SCOPE = {
  contentProduction: "content-production",
  weedComContentProduction: "weed-com-content-production",
  farmComContentProduction: "farm-com-content-production",
} as const satisfies Record<string, WPToolScope>;

export type WPSiteRow = WPSite & {
  id: string;
  name: string;
  tone_prompt?: string;
  created_at?: string;
};

/** PostgREST / Postgres when `tool_scope` has not been migrated yet. */
function isMissingToolScopeColumnError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  const msg = (e.message ?? "").toLowerCase();
  if (e.code === "42703") return true;
  if (msg.includes("tool_scope") && (msg.includes("does not exist") || msg.includes("undefined"))) return true;
  return false;
}

function rowToWPSite(row: Record<string, unknown>): WPSite & { id: string; name: string; tone_prompt?: string } {
  return {
    id: String(row.id ?? "").trim(),
    name: String(row.name ?? "").trim(),
    url: String(row.url ?? "").trim().replace(/\/+$/, ""),
    username: String(row.username ?? "").trim(),
    app_password: String(row.app_password ?? "").trim(),
    tone_prompt: row.tone_prompt != null ? String(row.tone_prompt).trim() : undefined,
  };
}

export async function getSites(
  toolScope: WPToolScope
): Promise<(WPSite & { id: string; name: string; tone_prompt?: string })[]> {
  const supabase = getSupabaseAdmin();
  const scoped = await supabase
    .from("wp_sites")
    .select("id, name, url, username, app_password, tone_prompt")
    .eq("tool_scope", toolScope);

  if (scoped.error && isMissingToolScopeColumnError(scoped.error)) {
    if (toolScope === WP_TOOL_SCOPE.contentProduction) {
      const legacy = await supabase
        .from("wp_sites")
        .select("id, name, url, username, app_password, tone_prompt");
      if (legacy.error) throw legacy.error;
      return (legacy.data ?? []).map(rowToWPSite);
    }
    return [];
  }

  if (scoped.error) throw scoped.error;
  return (scoped.data ?? []).map(rowToWPSite);
}

export async function getSiteById(
  id: string,
  toolScope?: WPToolScope
): Promise<(WPSite & { id: string; name: string; tone_prompt?: string }) | null> {
  const supabase = getSupabaseAdmin();

  const withScope = async (useScope: boolean) => {
    let q = supabase
      .from("wp_sites")
      .select("id, name, url, username, app_password, tone_prompt")
      .eq("id", id);
    if (useScope && toolScope) q = q.eq("tool_scope", toolScope);
    return q.single();
  };

  let { data, error } = await withScope(true);

  if (error) {
    if (error.code === "PGRST116") return null;
    if (toolScope && isMissingToolScopeColumnError(error)) {
      ({ data, error } = await withScope(false));
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data ? rowToWPSite(data) : null;
    }
    throw error;
  }
  return data ? rowToWPSite(data) : null;
}

export type CreateSiteData = {
  name: string;
  url: string;
  username: string;
  app_password: string;
  tone_prompt?: string;
};

export async function createSite(data: CreateSiteData, toolScope: WPToolScope): Promise<WPSiteRow> {
  const supabase = getSupabaseAdmin();
  const app_password = normalizeApplicationPassword(data.app_password);
  const withScope = {
    name: data.name,
    url: data.url,
    username: data.username,
    app_password,
    tone_prompt: data.tone_prompt ?? "Write in a clear, authoritative, and engaging editorial tone.",
    tool_scope: toolScope,
  };
  const withoutScope = {
    name: data.name,
    url: data.url,
    username: data.username,
    app_password,
    tone_prompt: data.tone_prompt ?? "Write in a clear, authoritative, and engaging editorial tone.",
  };

  let { data: rows, error } = await supabase
    .from("wp_sites")
    .insert(withScope)
    .select("id, name, url, username, app_password, tone_prompt, created_at");

  if (error && isMissingToolScopeColumnError(error)) {
    if (toolScope !== WP_TOOL_SCOPE.contentProduction) {
      throw new Error(
        'Column wp_sites.tool_scope is missing. Open Supabase → SQL Editor and run: alter table wp_sites add column if not exists tool_scope text not null default \'content-production\';'
      );
    }
    ({ data: rows, error } = await supabase
      .from("wp_sites")
      .insert(withoutScope)
      .select("id, name, url, username, app_password, tone_prompt, created_at"));
  }

  if (error) throw error;
  const row = rows?.[0];
  if (!row) {
    throw new Error(
      "Insert into wp_sites returned no row. Confirm the wp_sites table exists and SUPABASE_SERVICE_ROLE_KEY is set (service role bypasses RLS)."
    );
  }
  return row as WPSiteRow;
}

export type UpdateSiteData = Partial<{
  name: string;
  url: string;
  username: string;
  app_password: string;
  tone_prompt: string;
}>;

async function runUpdateOrDelete(
  mode: "update" | "delete",
  id: string,
  data: UpdateSiteData | undefined,
  toolScope: WPToolScope | undefined
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const exec = (useScope: boolean) => {
    if (mode === "update" && data) {
      let q = supabase.from("wp_sites").update(data).eq("id", id);
      if (useScope && toolScope) q = q.eq("tool_scope", toolScope);
      return q;
    }
    let q = supabase.from("wp_sites").delete().eq("id", id);
    if (useScope && toolScope) q = q.eq("tool_scope", toolScope);
    return q;
  };

  let { error } = await exec(true);
  if (error && toolScope && isMissingToolScopeColumnError(error)) {
    ({ error } = await exec(false));
  }
  if (error) throw error;
}

export async function updateSite(id: string, data: UpdateSiteData, toolScope?: WPToolScope): Promise<void> {
  const payload: UpdateSiteData = { ...data };
  if (payload.app_password != null) {
    payload.app_password = normalizeApplicationPassword(payload.app_password);
  }
  await runUpdateOrDelete("update", id, payload, toolScope);
}

export async function deleteSite(id: string, toolScope?: WPToolScope): Promise<void> {
  await runUpdateOrDelete("delete", id, undefined, toolScope);
}
