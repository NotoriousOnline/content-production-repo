import { NextResponse } from "next/server";
import {
  ensureStrainPageClonesSection,
  ensureStrainPageSeedsSection,
  formatStrainDisplayName,
  normalizeStrainPageCustomFields,
  strainPageCustomFieldsToMeta,
  strainPageFocusKeyword,
  strainPageMetaDescription,
  strainPageMetaTitle,
  strainPagePostTitle,
  strainPageSlug,
  type StrainPageCustomFields,
} from "@/lib/contentProduction/strainPage";
import {
  ensureStrainPageInternalLinks,
  gatherVerifiedStrainPageLinks,
  sanitizeStrainPageLinks,
} from "@/lib/contentProduction/strainPageLinks";
import { postStrainPagePublishCore } from "@/lib/contentProduction/strainPagePublishCore";
import { getSiteById, WP_TOOL_SCOPE } from "@/lib/wpSites";

/** Publish individual strain page draft to WordPress (strain CPT + custom fields). */
export async function postStrainPagePublish(request: Request) {
  const body = await request.json();
  const {
    rankMath,
    slug,
    customFields: rawFields,
    strainName,
    postId,
    restCollection,
    ...rest
  } = body as {
    rankMath?: { focuskw?: string; seoTitle?: string; metadesc?: string };
    slug?: string;
    customFields?: unknown;
    strainName?: string;
    postId?: unknown;
    restCollection?: string;
    siteId?: string;
    title?: string;
    content?: string;
    keywords?: unknown;
    images?: unknown;
  };

  let content = typeof rest.content === "string" ? rest.content : "";
  const title = typeof rest.title === "string" ? rest.title.trim() : "";
  const name =
    typeof strainName === "string" && strainName.trim()
      ? formatStrainDisplayName(strainName.trim())
      : title.replace(/\s+strain\s*$/i, "").trim();

  let customFields: StrainPageCustomFields | undefined;
  if (rawFields) {
    customFields = normalizeStrainPageCustomFields(rawFields);
  }

  if (rest.siteId && name) {
    const site = await getSiteById(rest.siteId, WP_TOOL_SCOPE.weedComContentProduction);
    if (site?.url) {
      const siteOrigin = site.url.replace(/\/$/, "");
      const keywords = Array.isArray(rest.keywords)
        ? (rest.keywords as unknown[]).filter((k): k is string => typeof k === "string")
        : [strainPageFocusKeyword(name)];

      const verified = await gatherVerifiedStrainPageLinks({
        site,
        strainName: name,
        customFields,
      });

      content = ensureStrainPageInternalLinks(content, name, verified.links, siteOrigin);
      content = sanitizeStrainPageLinks(content, verified.allowlist, siteOrigin);
      content = ensureStrainPageSeedsSection(content, name, siteOrigin);
      content = ensureStrainPageClonesSection(content, name, siteOrigin);

      if (!customFields && verified.links.length > 0) {
        customFields = normalizeStrainPageCustomFields({});
      }
    }
  }

  const seoName = name || "Strain";
  const rankMathResolved = rankMath ?? {
    focuskw: strainPageFocusKeyword(seoName),
    seoTitle: strainPageMetaTitle(seoName),
    metadesc: customFields
      ? strainPageMetaDescription(seoName, customFields)
      : undefined,
  };

  const wrapped = new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...rest,
      content,
      strainName: seoName,
      images: Array.isArray(rest.images) ? rest.images : [],
      rankMathOverrides: rankMathResolved,
      postSlug: typeof slug === "string" ? slug.trim() : strainPageSlug(seoName),
      postId,
      restCollection: typeof restCollection === "string" ? restCollection : undefined,
      customFieldsMeta: customFields ? strainPageCustomFieldsToMeta(customFields) : undefined,
      title: title || strainPagePostTitle(seoName),
    }),
  });

  return postStrainPagePublishCore(wrapped);
}
