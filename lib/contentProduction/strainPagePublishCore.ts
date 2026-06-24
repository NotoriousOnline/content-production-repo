import { NextResponse } from "next/server";
import { stripLeadingPostTitleH1 } from "@/lib/postHtml";
import { compressImageForUpload } from "@/lib/contentProduction/wpImageCompress";
import {
  resolveWeedEditorialAuthorId,
} from "@/lib/contentProduction/weedEditorialAuthor";
import { errorMessage, serverLog } from "@/lib/serverLog";
import { formatWpNetworkErrorHint, isTransientWpNetworkError } from "@/lib/wpFetch";
import { getSiteById, WP_TOOL_SCOPE } from "@/lib/wpSites";
import {
  createStrainPost,
  setPostFeaturedMedia,
  updatePostRankMathMeta,
  updateStrainPost,
  uploadMedia,
  updateMediaDetails,
} from "@/lib/wordpressClient";

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
    typeof (img as PreUploadedImageItem).url === "string"
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

const STRAIN_FIGURE_STYLE = "margin:1.75rem auto;max-width:600px;width:100%;box-sizing:border-box;";
const STRAIN_IMG_STYLE =
  "width:100%;max-width:600px;height:auto;display:block;border-radius:0.375rem;";

function strainFigureHtml(imageUrl: string, alt: string): string {
  return `<figure class="wp-block-image weed-strain-image" style="${STRAIN_FIGURE_STYLE}"><img src="${escapeHtmlAttr(imageUrl)}" alt="${escapeHtmlAttr(alt)}" style="${STRAIN_IMG_STYLE}" width="600" height="600" loading="lazy" decoding="async" /></figure>`;
}

function injectInContentImages(
  html: string,
  placements: { url: string; alt: string; h2Index: number; order: number }[]
): string {
  if (placements.length === 0) return html;
  const insertions: { pos: number; order: number; html: string }[] = [];
  for (const p of placements) {
    const pos = findH2EndPositionByIndex(html, p.h2Index);
    if (pos == null) continue;
    insertions.push({ pos, order: p.order, html: strainFigureHtml(p.url, p.alt) });
  }
  insertions.sort((a, b) => (a.pos !== b.pos ? b.pos - a.pos : b.order - a.order));
  let result = html;
  for (const ins of insertions) {
    result = result.slice(0, ins.pos) + ins.html + result.slice(ins.pos);
  }
  return result;
}

/** Publish strain page to WordPress strain CPT with custom field meta. */
export async function postStrainPagePublishCore(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_PUBLISH_BODY_BYTES) {
      return NextResponse.json(
        { error: `Publish request is too large (~${Math.round(raw.length / 1e6)}MB).` },
        { status: 413 }
      );
    }

    let body: {
      siteId?: string;
      title?: string;
      content?: string;
      images?: unknown;
      keywords?: unknown;
      postId?: unknown;
      postSlug?: unknown;
      rankMathOverrides?: { focuskw?: string; seoTitle?: string; metadesc?: string };
      customFieldsMeta?: Record<string, string>;
      restCollection?: string;
    };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { siteId, title, content, images, rankMathOverrides, customFieldsMeta } = body;
    const postSlug =
      typeof body.postSlug === "string" && body.postSlug.trim()
        ? body.postSlug.trim().slice(0, 200)
        : undefined;
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

    const site = await getSiteById(siteId, WP_TOOL_SCOPE.weedComContentProduction);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const imageItems = images as ImageItem[];
    const featuredImg = imageItems.find((i) => i.type === "featured");
    const inContentImgs = imageItems
      .filter((i) => i.type === "in-content")
      .sort((a, b) => a.index - b.index);

    let featuredMediaId: number | undefined;
    const focuskw = rankMathOverrides?.focuskw?.trim() ?? "";

    if (featuredImg) {
      if (isPreUploaded(featuredImg)) {
        featuredMediaId = featuredImg.mediaId;
      } else if ("base64" in featuredImg && featuredImg.base64) {
        const buf = Buffer.from(featuredImg.base64, "base64");
        const { buffer, mimeType, ext } = await compressImageForUpload(buf, featuredImg.mimeType ?? "image/webp");
        const slug = (featuredImg.fileSlug ?? "strain-hero").replace(/[^a-z0-9-]/gi, "-").slice(0, 60);
        const { id } = await uploadMedia(site, buffer, `${slug}.${ext}`, mimeType);
        featuredMediaId = id;
        await updateMediaDetails(site, id, {
          alt_text: featuredImg.altText ?? title.slice(0, 125),
          title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        });
      }
    }

    const placements: { url: string; alt: string; h2Index: number; order: number }[] = [];
    let order = 0;
    for (const img of inContentImgs) {
      if (isPreUploaded(img)) {
        placements.push({
          url: img.url,
          alt: img.altText ?? "Strain terpene graphic",
          h2Index: typeof img.h2Index === "number" ? img.h2Index : 4,
          order: order++,
        });
        continue;
      }
      if ("base64" in img && img.base64) {
        const buf = Buffer.from(img.base64, "base64");
        const { buffer, mimeType, ext } = await compressImageForUpload(buf, img.mimeType ?? "image/webp");
        const slug =
          (img.fileSlug ?? `strain-terpene-${img.index}`).replace(/[^a-z0-9-]/gi, "-").slice(0, 60) ||
          `strain-terpene-${img.index}`;
        const { id, url } = await uploadMedia(site, buffer, `${slug}.${ext}`, mimeType);
        await updateMediaDetails(site, id, {
          alt_text: img.altText ?? "Dominant terpene profile graphic",
          title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        });
        placements.push({
          url,
          alt: img.altText ?? "Dominant terpene profile graphic",
          h2Index: typeof img.h2Index === "number" ? img.h2Index : 4,
          order: order++,
        });
      }
    }

    let bodyHtml = stripLeadingPostTitleH1(typeof content === "string" ? content : "");
    const finalContent = injectInContentImages(bodyHtml, placements);

    const editorialAuthorId = await resolveWeedEditorialAuthorId(site);

    const publishOpts = {
      slug: postSlug,
      meta: customFieldsMeta,
      restCollection:
        typeof body.restCollection === "string" && body.restCollection.trim()
          ? body.restCollection.trim()
          : undefined,
      preserveStatus: true,
      refreshPublishDate: true,
      ...(editorialAuthorId ? { authorId: editorialAuthorId } : {}),
    };

    const { id: postId, link, editUrl, status, restCollection } =
      existingPostId != null
        ? await updateStrainPost(site, existingPostId, title, finalContent, publishOpts)
        : await createStrainPost(site, title, finalContent, publishOpts);

    if (featuredMediaId != null && featuredMediaId > 0) {
      await setPostFeaturedMedia(site, postId, featuredMediaId, restCollection);
    }

    const metadesc = rankMathOverrides?.metadesc?.trim() ?? "";
    const seoTitle = rankMathOverrides?.seoTitle?.trim() || title.slice(0, 200);

    const rankMathOk = await updatePostRankMathMeta(
      site,
      postId,
      { metadesc, focuskw, seoTitle },
      { restCollection }
    );

    return NextResponse.json({
      postId,
      postUrl: link,
      editUrl,
      status,
      updated: existingPostId != null,
      restCollection,
      site: { name: site.name, url: site.url },
      rankMath: { metaDescriptionSet: rankMathOk, focusKeyphrase: focuskw },
      customFieldsSet: !!customFieldsMeta && Object.keys(customFieldsMeta).length > 0,
      author: editorialAuthorId
        ? { id: editorialAuthorId, slug: process.env.WEED_COM_EDITORIAL_AUTHOR_SLUG ?? "editorial-team" }
        : { warning: "Editorial Team author not resolved — post author unchanged" },
      publishDateRefreshed: true,
    });
  } catch (err) {
    const msg = isTransientWpNetworkError(err) ? formatWpNetworkErrorHint(err) : errorMessage(err);
    console.error("[strain-page/publish] Error:", msg);
    void serverLog({ level: "error", source: "weed-com-strain-page/publish", message: msg });
    return NextResponse.json(
      { error: msg || "Failed to publish strain page" },
      { status: isTransientWpNetworkError(err) ? 503 : 500 }
    );
  }
}
