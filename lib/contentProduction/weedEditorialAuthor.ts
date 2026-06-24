import type { WPSite } from "@/lib/wordpressClient";
import { resolveWpUserIdBySlug } from "@/lib/wordpressClient";

const authorIdCache = new Map<string, number>();

/** WordPress user ID for Weed.com "Editorial Team" byline (default slug: editorial-team). */
export async function resolveWeedEditorialAuthorId(site: WPSite): Promise<number | null> {
  const explicitId = process.env.WEED_COM_EDITORIAL_AUTHOR_ID?.trim();
  if (explicitId && /^\d+$/.test(explicitId)) {
    return parseInt(explicitId, 10);
  }

  const slug = (process.env.WEED_COM_EDITORIAL_AUTHOR_SLUG ?? "editorial-team").trim();
  if (!slug) return null;

  const cacheKey = `${site.url}|${slug}`;
  const cached = authorIdCache.get(cacheKey);
  if (cached) return cached;

  const id = await resolveWpUserIdBySlug(site, slug);
  if (id) authorIdCache.set(cacheKey, id);
  return id;
}
