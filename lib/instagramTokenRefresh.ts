const GRAPH_VERSION = "v19.0";

/**
 * Exchanges the current long-lived Page access token for a new one (Facebook recommends
 * refreshing before the ~60 day expiry). Requires FACEBOOK_APP_ID, FACEBOOK_APP_SECRET,
 * and FACEBOOK_PAGE_ACCESS_TOKEN in the environment.
 */
export async function refreshLongLivedToken(): Promise<{ accessToken: string; expiresIn: number }> {
  const clientId = (process.env.FACEBOOK_APP_ID ?? "").trim();
  const clientSecret = (process.env.FACEBOOK_APP_SECRET ?? "").trim();
  const fbExchangeToken = (process.env.FACEBOOK_PAGE_ACCESS_TOKEN ?? "").trim();

  if (!clientId) {
    throw new Error("FACEBOOK_APP_ID is not set.");
  }
  if (!clientSecret) {
    throw new Error("FACEBOOK_APP_SECRET is not set.");
  }
  if (!fbExchangeToken) {
    throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN is not set.");
  }

  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("fb_exchange_token", fbExchangeToken);

  const res = await fetch(url.toString(), { method: "GET" });
  const text = await res.text();

  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Facebook token refresh returned non-JSON (HTTP ${res.status}): ${text.slice(0, 400)}${text.length > 400 ? "…" : ""}`
    );
  }

  if (!res.ok) {
    const o = json as { error?: { message?: string; code?: number; type?: string } };
    const detail = [o.error?.message, o.error?.code != null ? `code ${o.error.code}` : null]
      .filter(Boolean)
      .join(" | ");
    throw new Error(
      detail ||
        `Facebook token refresh failed (HTTP ${res.status}): ${text.slice(0, 400)}${text.length > 400 ? "…" : ""}`
    );
  }

  const data = json as { access_token?: string; expires_in?: number };
  const accessToken = data.access_token?.trim();
  if (!accessToken) {
    throw new Error("Facebook token refresh response missing access_token.");
  }

  const expiresIn =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in) ? data.expires_in : 0;

  return { accessToken, expiresIn };
}
