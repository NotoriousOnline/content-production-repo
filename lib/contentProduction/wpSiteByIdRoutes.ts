import { NextResponse } from "next/server";
import { errorMessage, serverLog } from "@/lib/serverLog";
import { normalizeShopifyShopHost, testShopifyConnection } from "@/lib/shopifyClient";
import {
  deleteSite,
  getSiteById,
  updateSite,
  WP_TOOL_SCOPE,
  type UpdateSiteData,
  type WPToolScope,
} from "@/lib/wpSites";

const MASKED_PASSWORD = "••••••••";

function maskSite<T extends { app_password?: string }>(site: T): Omit<T, "app_password"> & { app_password: string } {
  return { ...site, app_password: MASKED_PASSWORD };
}

function isShopifyScope(scope: WPToolScope): boolean {
  return scope === WP_TOOL_SCOPE.farmComContentProduction;
}

export async function handleSiteDELETE(id: string, scope: WPToolScope) {
  try {
    await deleteSite(id, scope);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[sites] DELETE error:", err);
    void serverLog({ level: "error", source: "wp_sites/DELETE", message: errorMessage(err) });
    return NextResponse.json({ error: "Failed to delete site" }, { status: 500 });
  }
}

export async function handleSitePUT(request: Request, id: string, scope: WPToolScope) {
  try {
    const body = await request.json();

    const data: UpdateSiteData = {};
    if (body.name != null) data.name = body.name;
    if (body.url != null) data.url = body.url;
    if (body.username != null) data.username = body.username;
    if (body.app_password != null) data.app_password = body.app_password;
    if (body.tone_prompt != null) data.tone_prompt = body.tone_prompt;

    if (isShopifyScope(scope)) {
      const existing = await getSiteById(id, scope);
      if (!existing) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
      }

      const nextUrl =
        data.url != null
          ? `https://${normalizeShopifyShopHost(String(data.url))}`
          : existing.url;
      const nextBlogId = String(data.username ?? existing.username).trim();
      const nextToken =
        data.app_password != null && String(data.app_password).trim() && String(data.app_password) !== MASKED_PASSWORD
          ? String(data.app_password)
          : existing.app_password;

      if (data.url != null) data.url = nextUrl;
      if (data.username != null) {
        data.username = nextBlogId.replace(/^gid:\/\/shopify\/Blog\//, "");
      }
      if (data.app_password != null && String(data.app_password) === MASKED_PASSWORD) {
        delete data.app_password;
      }

      if (data.url != null || data.username != null || data.app_password != null) {
        const conn = await testShopifyConnection(nextUrl, nextBlogId, nextToken);
        if (!conn.ok) {
          const hint = conn.detail ? ` (${conn.detail})` : "";
          return NextResponse.json(
            {
              error: `Could not connect to Shopify${hint}. Check shop host, Blog ID, and Admin API token.`,
            },
            { status: 400 }
          );
        }
      }
    }

    await updateSite(id, data, scope);
    const site = await getSiteById(id, scope);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
    return NextResponse.json(maskSite(site));
  } catch (err) {
    console.error("[sites] PUT error:", err);
    void serverLog({ level: "error", source: "wp_sites/PUT", message: errorMessage(err) });
    return NextResponse.json({ error: "Failed to update site" }, { status: 500 });
  }
}
