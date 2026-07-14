import { NextResponse } from "next/server";
import { describeFetchError, explainSupabaseReachabilityError } from "@/lib/serverFetch";
import { errorMessage, serverLog } from "@/lib/serverLog";
import { normalizeShopifyShopHost, testShopifyConnection } from "@/lib/shopifyClient";
import { wpRestHeaders, wpRestUrl } from "@/lib/wordpressClient";
import { wpFetch } from "@/lib/wpFetch";
import { createSite, getSites, WP_TOOL_SCOPE, type CreateSiteData, type WPToolScope } from "@/lib/wpSites";

const MASKED_PASSWORD = "••••••••";

function normalizeSiteUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function normalizeShopifySiteUrl(url: string): string {
  const host = normalizeShopifyShopHost(url);
  return `https://${host}`;
}

function maskSite<T extends { app_password?: string }>(site: T): Omit<T, "app_password"> & { app_password: string } {
  return { ...site, app_password: MASKED_PASSWORD };
}

function isShopifyScope(scope: WPToolScope): boolean {
  return scope === WP_TOOL_SCOPE.farmComContentProduction;
}

async function testWordPressConnection(
  url: string,
  username: string,
  app_password: string
): Promise<{ ok: boolean; detail?: string }> {
  const base = url.replace(/\/$/, "");
  try {
    const res = await wpFetch(wpRestUrl(base, "wp/v2/users/me"), {
      headers: wpRestHeaders({ url, username, app_password }),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as { code?: string; message?: string };
        if (typeof j?.message === "string" && j.message.length > 0) {
          detail = `HTTP ${res.status}: ${j.message}`;
        } else if (typeof j?.code === "string") {
          detail = `HTTP ${res.status}: ${j.code}`;
        }
      } catch {
        const t = text.trim();
        if (t.length > 0) detail = `HTTP ${res.status} ${t.slice(0, 280)}`;
      }
      return { ok: false, detail };
    }
    return { ok: true };
  } catch (err) {
    const detail = describeFetchError(err);
    console.error("[sites] WordPress fetch:", detail);
    return { ok: false, detail };
  }
}

export async function handleSitesGET(scope: WPToolScope) {
  try {
    const sites = await getSites(scope);
    return NextResponse.json(sites.map(maskSite));
  } catch (err) {
    console.error("[sites] GET error:", err);
    void serverLog({
      level: "error",
      source: "wp_sites/GET",
      message: errorMessage(err),
    });
    const supabaseHint = explainSupabaseReachabilityError(err);
    if (supabaseHint) {
      return NextResponse.json({ error: supabaseHint }, { status: 503 });
    }
    return NextResponse.json({ error: "Failed to fetch sites" }, { status: 500 });
  }
}

export async function handleSitesPOST(request: Request, scope: WPToolScope) {
  try {
    const body = await request.json();
    const { name, url, username, app_password, tone_prompt } = body;

    if (!name || !url || !username || !app_password) {
      return NextResponse.json(
        {
          error: isShopifyScope(scope)
            ? "Missing required fields: name, shop URL, blog ID, Admin API access token"
            : "Missing required fields: name, url, username, app_password",
        },
        { status: 400 }
      );
    }

    if (isShopifyScope(scope)) {
      const normalizedUrl = normalizeShopifySiteUrl(String(url));
      const blogId = String(username).trim();
      if (!/^\d+$/.test(blogId) && !blogId.startsWith("gid://shopify/Blog/")) {
        return NextResponse.json(
          {
            error:
              "Blog ID must be the numeric Shopify blog id (from Online Store → Blog) or a gid://shopify/Blog/… value.",
          },
          { status: 400 }
        );
      }
      const conn = await testShopifyConnection(normalizedUrl, blogId, String(app_password));
      if (!conn.ok) {
        const hint = conn.detail ? ` (${conn.detail})` : "";
        return NextResponse.json(
          {
            error: `Could not connect to Shopify${hint}. Use your *.myshopify.com host, a custom app Admin API access token with write_content (or write_online_store_pages), and a valid Blog ID.`,
          },
          { status: 400 }
        );
      }

      const data: CreateSiteData = {
        name,
        url: normalizedUrl,
        username: blogId.replace(/^gid:\/\/shopify\/Blog\//, ""),
        app_password,
        tone_prompt: tone_prompt ?? undefined,
      };
      const site = await createSite(data, scope);
      return NextResponse.json(maskSite(site));
    }

    const normalizedUrl = normalizeSiteUrl(String(url));
    const conn = await testWordPressConnection(normalizedUrl, username, app_password);
    if (!conn.ok) {
      const hint = conn.detail ? ` (${conn.detail})` : "";
      const wafHint =
        /403/i.test(conn.detail ?? "")
          ? " HTTP 403 is often Cloudflare, Wordfence, or another WAF blocking your app server’s IP or “bot” requests—allowlist the server (e.g. Vercel egress IPs) or add a WAF rule to allow /wp-json/ for authenticated requests."
          : "";
      const detailLower = (conn.detail ?? "").toLowerCase();
      const invalidAppPass =
        detailLower.includes("invalid application password") || detailLower.includes("invalid_application_password");
      const authHint401 = invalidAppPass
        ? " WordPress is rejecting the username + app password pair. The username must be your account login (the “Username” field on Users → Profile, or the Username column in Users → All Users)—not your display name at the top of the profile (e.g. “First Last” with a space is never the login). Application passwords only work with the user they were created for; copy the login exactly, often lowercase with no spaces."
        : /401/i.test(conn.detail ?? "")
          ? " For HTTP 401: use the WordPress login username (not display name unless they match), and an Application Password from Users → Profile (not your normal login password). Paste the app password with or without spaces. If it still fails, revoke the app password and create a new one, and confirm the user role can use the REST API (Administrator/Editor; some security plugins block REST for other roles)."
          : "";
      return NextResponse.json(
        {
          error: `Could not connect to WordPress${hint}.${wafHint}${authHint401} Use https:// in the site URL (no trailing path after the domain unless your site lives in a subdirectory).`,
        },
        { status: 400 }
      );
    }

    const data: CreateSiteData = {
      name,
      url: normalizedUrl,
      username,
      app_password,
      tone_prompt: tone_prompt ?? undefined,
    };
    const site = await createSite(data, scope);
    return NextResponse.json(maskSite(site));
  } catch (err) {
    console.error("[sites] POST error:", err);
    void serverLog({
      level: "error",
      source: "wp_sites/POST",
      message: errorMessage(err),
    });
    const supabaseHint = explainSupabaseReachabilityError(err);
    if (supabaseHint) {
      return NextResponse.json({ error: supabaseHint }, { status: 503 });
    }
    const postgrest = err as { code?: string; message?: string };
    const msg =
      err instanceof Error
        ? err.message
        : typeof postgrest.message === "string"
          ? postgrest.message
          : String(err);
    if (msg.includes("NEXT_PUBLIC_SUPABASE_URL is required")) {
      return NextResponse.json(
        { error: "Server misconfiguration: set NEXT_PUBLIC_SUPABASE_URL in the environment." },
        { status: 503 }
      );
    }
    if (msg.includes("SUPABASE_SERVICE_ROLE_KEY is required")) {
      return NextResponse.json(
        {
          error:
            "Server misconfiguration: set SUPABASE_SERVICE_ROLE_KEY (trim any spaces from .env). Required to save WordPress sites.",
        },
        { status: 503 }
      );
    }
    if (postgrest.code === "PGRST205" || msg.includes("Could not find the table")) {
      return NextResponse.json(
        {
          error:
            'Table "wp_sites" was not found. Run supabase/migrations/001_wp_sites.sql in the Supabase SQL editor, then try again.',
        },
        { status: 500 }
      );
    }
    if (msg.includes("tool_scope") || msg.includes("column")) {
      return NextResponse.json(
        {
          error:
            'Column "tool_scope" is missing. Run supabase/migrations/003_wp_sites_tool_scope.sql in the Supabase SQL editor.',
        },
        { status: 500 }
      );
    }
    if (msg.length > 0 && msg.length < 400) {
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    return NextResponse.json({ error: "Failed to create site", details: msg }, { status: 500 });
  }
}
