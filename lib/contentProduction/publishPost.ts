import { NextResponse } from "next/server";
import { getSiteById, WP_TOOL_SCOPE, type WPToolScope } from "@/lib/wpSites";
import { lockExpertBoxTypography, stripLeadingPostTitleH1 } from "@/lib/postHtml";
import {
  categoriesForGreenOrgPublish,
  pickGreenOrgCategoryIds,
  isGreenOrgSite,
} from "@/lib/contentProduction/greenOrgCategoryPicker";
import {
  createPost,
  getCategoryIdByName,
  listAllCategories,
  setPostFeaturedMedia,
  updatePost,
  updatePostYoastMeta,
  uploadMedia,
  updateMediaDetails,
  updatePostRankMathMeta,
} from "@/lib/wordpressClient";
import { compressImageForUpload } from "@/lib/contentProduction/wpImageCompress";
import { errorMessage, serverLog } from "@/lib/serverLog";

/** Final publish payload is small (HTML + image URLs). Kept generous for long posts. */
const MAX_PUBLISH_BODY_BYTES = 4_200_000;

type PreUploadedImageItem = {
  type: "featured" | "in-content";
  index: number;
  mediaId: number;
  url: string;
  altText?: string;
  fileSlug?: string;
  h2Index?: number;
};

type RawBase64ImageItem = {
  type: "featured" | "in-content";
  index: number;
  base64: string;
  mimeType?: string;
  altText?: string;
  fileSlug?: string;
  h2Index?: number;
};

type ImageItem = PreUploadedImageItem | RawBase64ImageItem;

function isPreUploaded(img: ImageItem): img is PreUploadedImageItem {
  return (
    typeof (img as PreUploadedImageItem).mediaId === "number" &&
    typeof (img as PreUploadedImageItem).url === "string" &&
    !(
      "base64" in img &&
      typeof (img as RawBase64ImageItem).base64 === "string" &&
      (img as RawBase64ImageItem).base64.length > 0
    )
  );
}

function findH2EndPositionByIndex(html: string, h2Index: number): number | null {
  const regex = /<h2[^>]*>[\s\S]*?<\/h2>/gi;
  let match;
  let i = 0;
  while ((match = regex.exec(html)) !== null) {
    if (i === h2Index) return match.index + match[0].length;
    i++;
  }
  return null;
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Featured + in-content article images only. Inline styles override themes that force square crops.
 * Shop Now product thumbnails stay square in generated HTML (generateContentPost) — do not use this helper there.
 */
const EDITORIAL_FIGURE_STYLE =
  "margin:1.75rem auto;max-width:100%;width:100%;box-sizing:border-box;";
const EDITORIAL_IMG_STYLE =
  "width:100%;max-width:100%;height:auto;display:block;border-radius:0.375rem;";

function editorialArticleFigureHtml(imageUrl: string, alt: string): string {
  return `<figure class="wp-block-image weed-learn-editorial-image" style="${EDITORIAL_FIGURE_STYLE}"><img src="${escapeHtmlAttr(imageUrl)}" alt="${escapeHtmlAttr(alt)}" style="${EDITORIAL_IMG_STYLE}" width="1200" height="675" loading="lazy" decoding="async" /></figure>`;
}

/** Featured image at top of body HTML (in addition to WordPress featured_media). */
function prependFeaturedImageToBody(html: string, imageUrl: string, alt: string): string {
  const trimmed = html.trimStart();
  const head = trimmed.slice(0, 1200);
  if (/^<figure/i.test(trimmed) && head.includes(imageUrl)) {
    return html;
  }
  return `${editorialArticleFigureHtml(imageUrl, alt)}\n\n${trimmed}`;
}

type InContentPlacement = { url: string; alt: string; h2Index: number; order: number };

function injectInContentImages(html: string, placements: InContentPlacement[]): string {
  if (placements.length === 0) return html;

  const insertions: { pos: number; order: number; html: string }[] = [];
  for (const p of placements) {
    const pos = findH2EndPositionByIndex(html, p.h2Index);
    if (pos == null) continue;
    const imgHtml = editorialArticleFigureHtml(p.url, p.alt);
    insertions.push({ pos, order: p.order, html: imgHtml });
  }

  insertions.sort((a, b) => {
    if (a.pos !== b.pos) return b.pos - a.pos;
    return b.order - a.order;
  });

  let result = html;
  for (const ins of insertions) {
    result = result.slice(0, ins.pos) + ins.html + result.slice(ins.pos);
  }
  return result;
}

function buildMetaDescription(html: string, maxLen = 156): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen - 3);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}...`;
}

/**
 * Rank Math focus keyword from post title (Weed.com content production only at call site).
 * Rank Math allows up to ~191 chars. Falls back to first editorial keyword if title is empty.
 */
function rankMathFocusKeywordFromTitle(postTitle: string, keywords: unknown): string {
  const t = typeof postTitle === "string" ? postTitle.trim() : "";
  if (t.length > 0) return t.slice(0, 191);
  if (Array.isArray(keywords)) {
    const k = keywords.map((x) => String(x).trim()).find((x) => x.length > 0);
    if (k) return k.slice(0, 191);
  }
  return "";
}

/** Primary phrase for featured-image alt enrichment; prefers first keyword, then title snippet. */
function pickFocusKeyphrase(keywords: unknown, title: string): string {
  if (Array.isArray(keywords)) {
    const k = keywords.map((x) => String(x).trim()).find((x) => x.length > 0);
    if (k && k.length <= 191) return k;
  }
  return title.slice(0, 80).trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsKeyword(text: string, kw: string): boolean {
  if (!kw.trim()) return false;
  const re = new RegExp(`\\b${escapeRegex(kw.trim())}\\b`, "i");
  return re.test(text);
}

function ensureFeaturedAltIncludesKeyword(alt: string, kw: string): string {
  const safeAlt = alt.trim();
  if (!kw.trim()) return safeAlt;
  if (containsKeyword(safeAlt, kw)) return safeAlt;
  if (!safeAlt) return kw.trim().slice(0, 125);
  const joined = `${safeAlt} - ${kw.trim()}`;
  return joined.slice(0, 125);
}

function appendReferenceDisclaimer(html: string, referenceUrlRaw: unknown): string {
  if (typeof referenceUrlRaw !== "string") return html;
  const raw = referenceUrlRaw.trim();
  if (!raw) return html;
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return html;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return html;
  const href = parsed.href;
  const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const escText = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const footer = `<p><em>This article is for informational purposes only.</em></p><p>Reference: <a href="${escAttr(href)}" target="_blank" rel="nofollow noopener noreferrer">${escText(href)}</a></p>`;
  return `${html.trimEnd()}\n\n${footer}`;
}

export async function postPublish(request: Request, toolScope: WPToolScope) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_PUBLISH_BODY_BYTES) {
      return NextResponse.json(
        {
          error: `Publish request is too large (~${Math.round(raw.length / 1e6)}MB). Try shortening the article HTML.`,
        },
        { status: 413 }
      );
    }

    let body: {
      siteId?: string;
      title?: string;
      content?: string;
      images?: unknown;
      referenceUrl?: unknown;
      keywords?: unknown;
      /** When set, updates this draft instead of creating a new post. */
      postId?: unknown;
    };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { siteId, title, content, images, referenceUrl, keywords } = body;
    const existingPostId =
      typeof body.postId === "number" && Number.isFinite(body.postId) && body.postId > 0
        ? Math.floor(body.postId)
        : typeof body.postId === "string" && /^\d+$/.test(body.postId.trim())
          ? parseInt(body.postId.trim(), 10)
          : undefined;

    if (!siteId || !title || !content || !Array.isArray(images)) {
      return NextResponse.json(
        { error: "Missing or invalid fields: siteId, title, content, images (array)" },
        { status: 400 }
      );
    }

    const site = await getSiteById(siteId, toolScope);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const imageItems = images as ImageItem[];
    const featuredImg = imageItems.find((i) => i.type === "featured");
    const inContentImgs = imageItems
      .filter((i) => i.type === "in-content")
      .sort((a, b) => a.index - b.index);

    let featuredMediaId: number | undefined;
    let featuredImageUrlForBody: string | undefined;
    let featuredImageAltForBody: string | undefined;

    const rankMathFocusKw =
      toolScope === WP_TOOL_SCOPE.weedComContentProduction
        ? rankMathFocusKeywordFromTitle(title, keywords)
        : pickFocusKeyphrase(keywords, title);
    const focuskwForAlt = pickFocusKeyphrase(keywords, title);

    if (featuredImg) {
      if (isPreUploaded(featuredImg)) {
        featuredMediaId = featuredImg.mediaId;
        featuredImageUrlForBody = featuredImg.url;
        featuredImageAltForBody = ensureFeaturedAltIncludesKeyword(
          featuredImg.altText ?? title.slice(0, 125),
          focuskwForAlt
        );
      } else if ("base64" in featuredImg && featuredImg.base64) {
        const buf = Buffer.from(featuredImg.base64, "base64");
        const { buffer, mimeType, ext } = await compressImageForUpload(buf, featuredImg.mimeType ?? "image/png");
        const slug = (featuredImg.fileSlug ?? "featured").replace(/[^a-z0-9-]/gi, "-").slice(0, 60);
        const { id, url } = await uploadMedia(site, buffer, `${slug}.${ext}`, mimeType);
        featuredMediaId = id;
        featuredImageUrlForBody = url;
        featuredImageAltForBody = ensureFeaturedAltIncludesKeyword(
          featuredImg.altText ?? title.slice(0, 125),
          focuskwForAlt
        );
        await updateMediaDetails(site, id, {
          alt_text: featuredImageAltForBody,
          title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        });
      }
    }

    const placements: InContentPlacement[] = [];
    let order = 0;
    for (const img of inContentImgs) {
      if (isPreUploaded(img)) {
        const h2Index = typeof img.h2Index === "number" ? img.h2Index : img.index - 1;
        placements.push({
          url: img.url,
          alt: img.altText ?? "Article illustration",
          h2Index: Math.max(0, h2Index),
          order: order++,
        });
        continue;
      }
      if ("base64" in img && img.base64) {
        const buf = Buffer.from(img.base64, "base64");
        const { buffer, mimeType, ext } = await compressImageForUpload(buf, img.mimeType ?? "image/png");
        const slug =
          (img.fileSlug ?? `in-content-${img.index}`).replace(/[^a-z0-9-]/gi, "-").slice(0, 60) ||
          `in-content-${img.index}`;
        const { id, url } = await uploadMedia(site, buffer, `${slug}.${ext}`, mimeType);
        await updateMediaDetails(site, id, {
          alt_text: img.altText ?? `Illustration for section ${img.index}`,
          title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        });
        const h2Index = typeof img.h2Index === "number" ? img.h2Index : img.index - 1;
        placements.push({
          url,
          alt: img.altText ?? "Article illustration",
          h2Index: Math.max(0, h2Index),
          order: order++,
        });
      }
    }

    let bodyHtml = stripLeadingPostTitleH1(typeof content === "string" ? content : "");
    if (toolScope === WP_TOOL_SCOPE.weedComContentProduction) {
      bodyHtml = lockExpertBoxTypography(bodyHtml);
    }
    const prependFeaturedFigureInBody = toolScope !== WP_TOOL_SCOPE.weedComContentProduction;
    const withFeaturedAtStart =
      prependFeaturedFigureInBody &&
      featuredImageUrlForBody != null &&
      featuredImageUrlForBody.trim() !== ""
        ? prependFeaturedImageToBody(bodyHtml, featuredImageUrlForBody.trim(), featuredImageAltForBody ?? title.slice(0, 125))
        : bodyHtml;
    const withImages = injectInContentImages(withFeaturedAtStart, placements);
    const finalContent = appendReferenceDisclaimer(withImages, referenceUrl);
    const taxonomyOpts: { categories?: number[]; tags?: number[] } = {};
    let greenOrgCategoryIds: number[] | undefined;
    if (toolScope === WP_TOOL_SCOPE.weedComContentProduction) {
      const learnCategoryId = await getCategoryIdByName(site, "learn");
      if (learnCategoryId != null && learnCategoryId > 0) {
        taxonomyOpts.categories = [learnCategoryId];
      } else {
        console.warn('[publish] Could not resolve category "learn"; publishing without category assignment.');
      }
      taxonomyOpts.tags = [4337];
    } else if (toolScope === WP_TOOL_SCOPE.contentProduction && isGreenOrgSite(site)) {
      const wpCategories = await categoriesForGreenOrgPublish(() => listAllCategories(site));
      if (wpCategories.length > 0) {
        greenOrgCategoryIds = await pickGreenOrgCategoryIds({
          title,
          keywords,
          articleHtml: finalContent,
          categories: wpCategories,
        });
        if (greenOrgCategoryIds.length > 0) {
          taxonomyOpts.categories = greenOrgCategoryIds;
        } else {
          console.warn("[publish] Green.org: no category ids chosen; publishing without category assignment.");
        }
      } else {
        console.warn("[publish] Green.org: no categories available (REST and snapshot empty).");
      }
    }
    const { id: postId, link, editUrl, status } =
      existingPostId != null
        ? await updatePost(site, existingPostId, title, finalContent, undefined, taxonomyOpts)
        : await createPost(site, title, finalContent, undefined, taxonomyOpts);
    if (featuredMediaId != null && featuredMediaId > 0) {
      await setPostFeaturedMedia(site, postId, featuredMediaId);
    }

    const metadesc = buildMetaDescription(finalContent);
    const seoTitle = title.slice(0, 200);

    let yoastMetaOk: boolean | undefined;
    let rankMathOk: boolean | undefined;
    if (toolScope === WP_TOOL_SCOPE.contentProduction && isGreenOrgSite(site)) {
      yoastMetaOk = await updatePostYoastMeta(site, postId, {
        metadesc,
        focuskw: rankMathFocusKw,
        seoTitle,
      });
    } else if (toolScope === WP_TOOL_SCOPE.weedComContentProduction) {
      rankMathOk = await updatePostRankMathMeta(site, postId, {
        metadesc,
        focuskw: rankMathFocusKw,
        seoTitle,
      });
    } else {
      rankMathOk = await updatePostRankMathMeta(site, postId, {
        metadesc,
        focuskw: rankMathFocusKw,
        seoTitle,
      });
    }

    if (status !== "draft") {
      console.warn(
        `[publish] WordPress ${existingPostId != null ? "updated" : "created"} post with status "${status}" (expected "draft")`
      );
    }

    return NextResponse.json({
      postId,
      postUrl: link,
      editUrl,
      status,
      updated: existingPostId != null,
      site: { name: site.name, url: site.url },
      ...(yoastMetaOk !== undefined
        ? {
            yoast: {
              metaDescriptionSet: yoastMetaOk,
              focusKeyphrase: rankMathFocusKw,
              seoTitleSet: yoastMetaOk,
            },
          }
        : rankMathOk !== undefined
          ? {
              rankMath: { metaDescriptionSet: rankMathOk, focusKeyphrase: rankMathFocusKw },
            }
          : {}),
      ...(greenOrgCategoryIds != null && greenOrgCategoryIds.length > 0
        ? { wordPressCategoryIds: greenOrgCategoryIds }
        : {}),
    });
  } catch (err) {
    const msg = errorMessage(err);
    console.error("[publish] Error:", msg);
    void serverLog({
      level: "error",
      source: "content-production/publish",
      message: msg || "Failed to publish",
    });
    return NextResponse.json(
      { error: msg || "Failed to publish" },
      { status: 500 }
    );
  }
}
