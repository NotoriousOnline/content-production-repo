import { NextResponse } from "next/server";
import {
  ensureStrainComparisonSeedsSection,
  parseStrainsFromComparisonTitle,
  strainComparisonFocusKeyword,
  strainComparisonPostTitle,
  stripRoyLayer3Signoff,
  stripStrainWordSuffix,
} from "@/lib/contentProduction/strainComparison";
import {
  ensureStrainComparisonInternalLinks,
  gatherVerifiedStrainComparisonLinks,
  sanitizeStrainComparisonLinks,
} from "@/lib/contentProduction/strainComparisonLinks";
import { postPublish } from "@/lib/contentProduction/publishPost";
import { getSiteById, WP_TOOL_SCOPE } from "@/lib/wpSites";

/** Publish strain comparison draft to WordPress. */
export async function postStrainComparisonPublish(request: Request) {
  const body = await request.json();
  const { rankMath, slug, ...rest } = body as {
    rankMath?: { focuskw?: string; seoTitle?: string; metadesc?: string };
    slug?: string;
    siteId?: string;
    title?: string;
    strainA?: string;
    strainB?: string;
    content?: string;
    keywords?: unknown;
    images?: unknown;
    postId?: unknown;
  };

  let content = typeof rest.content === "string" ? rest.content : "";
  const title = typeof rest.title === "string" ? rest.title.trim() : "";
  const strainA =
    typeof rest.strainA === "string" && rest.strainA.trim()
      ? stripStrainWordSuffix(rest.strainA.trim())
      : parseStrainsFromComparisonTitle(title)?.strainA;
  const strainB =
    typeof rest.strainB === "string" && rest.strainB.trim()
      ? stripStrainWordSuffix(rest.strainB.trim())
      : parseStrainsFromComparisonTitle(title)?.strainB;

  if (rest.siteId && strainA && strainB) {
    const site = await getSiteById(rest.siteId, WP_TOOL_SCOPE.weedComContentProduction);
    if (site?.url) {
      const siteOrigin = site.url.replace(/\/$/, "");
      const titleForLinks = title || strainComparisonPostTitle(strainA, strainB);
      const keywords = Array.isArray(rest.keywords)
        ? (rest.keywords as unknown[]).filter((k): k is string => typeof k === "string")
        : [strainComparisonFocusKeyword(strainA, strainB)];

      const verified = await gatherVerifiedStrainComparisonLinks({
        site,
        siteId: rest.siteId,
        strainA,
        strainB,
        keywords,
        title: titleForLinks,
      });

      content = ensureStrainComparisonInternalLinks(content, strainA, strainB, verified.links, siteOrigin);
      content = sanitizeStrainComparisonLinks(content, verified.allowlist, siteOrigin);
      content = ensureStrainComparisonSeedsSection(content, strainA, strainB, siteOrigin);
    }
  }

  content = stripRoyLayer3Signoff(content);

  const wrapped = new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...rest,
      content,
      images: Array.isArray(rest.images) ? rest.images : [],
      rankMathOverrides: rankMath,
      postSlug: typeof slug === "string" ? slug.trim() : undefined,
    }),
  });

  return postPublish(wrapped, WP_TOOL_SCOPE.weedComContentProduction);
}
