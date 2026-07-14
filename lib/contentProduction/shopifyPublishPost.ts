import { NextResponse } from "next/server";
import { getSiteById, type WPToolScope } from "@/lib/wpSites";
import { stripLeadingPostTitleH1 } from "@/lib/postHtml";
import { createShopifyArticle, updateShopifyArticle, uploadShopifyFile } from "@/lib/shopifyClient";
import { compressImageForUpload } from "@/lib/contentProduction/wpImageCompress";
import { errorMessage, serverLog } from "@/lib/serverLog";

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

const EDITORIAL_FIGURE_STYLE =
  "margin:1.75rem auto;max-width:100%;width:100%;box-sizing:border-box;";
const EDITORIAL_IMG_STYLE =
  "width:100%;max-width:100%;height:auto;display:block;border-radius:0.375rem;";

function editorialArticleFigureHtml(imageUrl: string, alt: string): string {
  return `<figure class="article-editorial-image" style="${EDITORIAL_FIGURE_STYLE}"><img src="${escapeHtmlAttr(imageUrl)}" alt="${escapeHtmlAttr(alt)}" style="${EDITORIAL_IMG_STYLE}" width="1200" height="675" loading="lazy" decoding="async" /></figure>`;
}

type InContentPlacement = { url: string; alt: string; h2Index: number; order: number };

function injectInContentImages(html: string, placements: InContentPlacement[]): string {
  if (placements.length === 0) return html;

  const insertions: { pos: number; order: number; html: string }[] = [];
  for (const p of placements) {
    const pos = findH2EndPositionByIndex(html, p.h2Index);
    if (pos == null) continue;
    insertions.push({ pos, order: p.order, html: editorialArticleFigureHtml(p.url, p.alt) });
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

export async function postShopifyPublish(request: Request, toolScope: WPToolScope) {
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
      postId?: unknown;
    };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { siteId, title, content, images, referenceUrl } = body;
    const existingPostId =
      typeof body.postId === "number" && Number.isFinite(body.postId) && body.postId > 0
        ? Math.floor(body.postId)
        : typeof body.postId === "string" && body.postId.trim()
          ? body.postId.trim()
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

    let featuredUrl: string | undefined;
    let featuredAlt: string | undefined;

    if (featuredImg) {
      if (isPreUploaded(featuredImg)) {
        featuredUrl = featuredImg.url;
        featuredAlt = featuredImg.altText ?? title.slice(0, 125);
      } else if ("base64" in featuredImg && featuredImg.base64) {
        const buf = Buffer.from(featuredImg.base64, "base64");
        const { buffer, mimeType, ext } = await compressImageForUpload(
          buf,
          featuredImg.mimeType ?? "image/png"
        );
        const slug = (featuredImg.fileSlug ?? "featured").replace(/[^a-z0-9-]/gi, "-").slice(0, 60);
        const alt = featuredImg.altText ?? title.slice(0, 125);
        const uploaded = await uploadShopifyFile(site, buffer, `${slug}.${ext}`, mimeType, alt);
        featuredUrl = uploaded.url;
        featuredAlt = alt;
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
        const alt = img.altText ?? `Illustration for section ${img.index}`;
        const uploaded = await uploadShopifyFile(site, buffer, `${slug}.${ext}`, mimeType, alt);
        const h2Index = typeof img.h2Index === "number" ? img.h2Index : img.index - 1;
        placements.push({
          url: uploaded.url,
          alt,
          h2Index: Math.max(0, h2Index),
          order: order++,
        });
      }
    }

    const bodyHtml = stripLeadingPostTitleH1(typeof content === "string" ? content : "");
    const withImages = injectInContentImages(bodyHtml, placements);
    const finalContent = appendReferenceDisclaimer(withImages, referenceUrl);
    const summary = buildMetaDescription(finalContent);

    const articleInput = {
      title,
      bodyHtml: finalContent,
      authorName: site.name || "Farm.com",
      summary,
      imageUrl: featuredUrl,
      imageAlt: featuredAlt,
    };

    const result =
      existingPostId != null
        ? await updateShopifyArticle(site, existingPostId, articleInput)
        : await createShopifyArticle(site, articleInput);

    if (result.status !== "draft") {
      console.warn(
        `[shopify-publish] Article ${existingPostId != null ? "updated" : "created"} with status "${result.status}" (expected draft)`
      );
    }

    return NextResponse.json({
      postId: result.id,
      postUrl: result.postUrl,
      editUrl: result.editUrl,
      status: result.status,
      updated: existingPostId != null,
      site: { name: site.name, url: site.url },
    });
  } catch (err) {
    const msg = errorMessage(err);
    console.error("[shopify-publish] Error:", msg);
    void serverLog({
      level: "error",
      source: "farm-com-content-production/publish",
      message: msg || "Failed to publish",
    });
    return NextResponse.json({ error: msg || "Failed to publish" }, { status: 500 });
  }
}
