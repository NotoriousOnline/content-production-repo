import { uploadMedia, type WPSite } from "@/lib/wordpressClient";
import { getSites, WP_TOOL_SCOPE } from "@/lib/wpSites";

const GRAPH_VERSION = "v19.0";

const STEP_UPLOAD = "[Instagram → WordPress upload]";
const STEP_CREATE = "[Instagram → Create media container]";
const STEP_PUBLISH = "[Instagram → Publish media]";
const STEP_PERMALINK = "[Instagram → Fetch permalink]";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pick Green.org credentials from wp_sites (content-production scope). */
async function getGreenOrgWpSite(): Promise<WPSite & { id: string; name: string }> {
  const sites = await getSites(WP_TOOL_SCOPE.contentProduction);
  const match = sites.find((s) => {
    const raw = (s.url ?? "").trim();
    if (!raw) return false;
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const host = u.hostname.toLowerCase();
      return host === "green.org" || host.endsWith(".green.org");
    } catch {
      return /green\.org/i.test(raw);
    }
  });
  if (match) return match;

  const byName = sites.find((s) => /^green\.org$/i.test((s.name ?? "").trim()));
  if (byName) return byName;

  throw new Error(
    `${STEP_UPLOAD} No site found for green.org in wp_sites (tool_scope content-production). Add https://green.org in Site manager or seed wp_sites.`
  );
}

async function parseGraphJsonResponse(res: Response, stepLabel: string): Promise<unknown> {
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `${stepLabel} Graph API returned non-JSON (HTTP ${res.status}): ${text.slice(0, 400)}${text.length > 400 ? "…" : ""}`
    );
  }
  if (!res.ok) {
    const o = json as { error?: { message?: string; code?: number; type?: string } };
    const detail = [
      o.error?.message,
      o.error?.code != null ? `code ${o.error.code}` : null,
      o.error?.type ? `type ${o.error.type}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    throw new Error(
      `${stepLabel} ${detail || `HTTP ${res.status}`}: ${text.slice(0, 400)}${text.length > 400 ? "…" : ""}`
    );
  }
  return json;
}

export async function publishToInstagram({
  imageBuffer,
  caption,
}: {
  imageBuffer: Buffer;
  caption: string;
}): Promise<{ instagramPostId: string; permalink: string }> {
  const igAccountId = (process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "").trim();
  const accessToken = (process.env.FACEBOOK_PAGE_ACCESS_TOKEN ?? "").trim();

  if (!igAccountId) {
    throw new Error(`${STEP_CREATE} INSTAGRAM_BUSINESS_ACCOUNT_ID is not set.`);
  }
  if (!accessToken) {
    throw new Error(`${STEP_CREATE} FACEBOOK_PAGE_ACCESS_TOKEN is not set.`);
  }

  let imageUrl: string;
  try {
    const site = await getGreenOrgWpSite();
    const uploaded = await uploadMedia(
      site,
      imageBuffer,
      `instagram-post-${Date.now()}.png`,
      "image/png"
    );
    imageUrl = uploaded.url?.trim() ?? "";
    if (!imageUrl) {
      throw new Error("WordPress upload succeeded but returned an empty source_url.");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith(STEP_UPLOAD)) throw e;
    throw new Error(`${STEP_UPLOAD} ${msg}`);
  }

  if (!/^https:\/\//i.test(imageUrl)) {
    throw new Error(
      `${STEP_CREATE} WordPress media URL must be public HTTPS for Instagram. Got: ${imageUrl.slice(0, 200)}`
    );
  }

  const createForm = new URLSearchParams();
  createForm.set("image_url", imageUrl);
  createForm.set("caption", caption);
  createForm.set("access_token", accessToken);

  let creationId: string;
  try {
    const createRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(igAccountId)}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: createForm.toString(),
      }
    );
    const createJson = (await parseGraphJsonResponse(createRes, STEP_CREATE)) as { id?: string | number };
    const rawId = createJson.id;
    if (rawId == null || String(rawId).trim() === "") {
      throw new Error("Graph API response missing creation id.");
    }
    creationId = String(rawId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith(STEP_CREATE)) throw e;
    throw new Error(`${STEP_CREATE} ${msg}`);
  }

  await sleep(5000);

  const publishForm = new URLSearchParams();
  publishForm.set("creation_id", creationId);
  publishForm.set("access_token", accessToken);

  let instagramPostId: string;
  try {
    const publishRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(igAccountId)}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: publishForm.toString(),
      }
    );
    const publishJson = (await parseGraphJsonResponse(publishRes, STEP_PUBLISH)) as { id?: string | number };
    const rawPostId = publishJson.id;
    if (rawPostId == null || String(rawPostId).trim() === "") {
      throw new Error("Graph API response missing published media id.");
    }
    instagramPostId = String(rawPostId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith(STEP_PUBLISH)) throw e;
    throw new Error(`${STEP_PUBLISH} ${msg}`);
  }

  try {
    const permalinkUrl = new URL(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(instagramPostId)}`
    );
    permalinkUrl.searchParams.set("fields", "permalink");
    permalinkUrl.searchParams.set("access_token", accessToken);

    const permRes = await fetch(permalinkUrl.toString(), { method: "GET" });
    const permJson = (await parseGraphJsonResponse(permRes, STEP_PERMALINK)) as { permalink?: string };
    const permalink = permJson.permalink?.trim();
    if (!permalink) {
      throw new Error("Graph API response missing permalink field.");
    }
    return { instagramPostId, permalink };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith(STEP_PERMALINK)) throw e;
    throw new Error(`${STEP_PERMALINK} ${msg}`);
  }
}
