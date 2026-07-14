import { NextResponse } from "next/server";
import { getSiteById, type WPToolScope } from "@/lib/wpSites";
import { uploadShopifyFile } from "@/lib/shopifyClient";
import { compressImageForUpload } from "@/lib/contentProduction/wpImageCompress";
import { errorMessage, serverLog } from "@/lib/serverLog";

/** One base64 image per request — stays under Vercel function payload limits. */
const MAX_UPLOAD_IMAGE_BODY_BYTES = 3_500_000;

export async function postShopifyPublishUploadImage(request: Request, toolScope: WPToolScope) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_UPLOAD_IMAGE_BODY_BYTES) {
      return NextResponse.json(
        {
          error:
            "This image is too large for a single upload on Vercel. Regenerate a smaller image or exclude it and try again.",
        },
        { status: 413 }
      );
    }

    let body: {
      siteId?: string;
      type?: string;
      index?: number;
      base64?: string;
      mimeType?: string;
      altText?: string;
      fileSlug?: string;
      title?: string;
    };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { siteId, type, index, base64, mimeType, altText, fileSlug, title: postTitle } = body;
    if (!siteId || typeof base64 !== "string" || !base64) {
      return NextResponse.json(
        { error: "Missing or invalid fields: siteId, base64" },
        { status: 400 }
      );
    }
    if (type !== "featured" && type !== "in-content") {
      return NextResponse.json({ error: 'type must be "featured" or "in-content"' }, { status: 400 });
    }
    const idx = typeof index === "number" ? index : 0;

    const site = await getSiteById(siteId, toolScope);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const buf = Buffer.from(base64, "base64");
    const { buffer, mimeType: mt, ext } = await compressImageForUpload(buf, mimeType ?? "image/png");
    const slugBase =
      (fileSlug ?? (type === "featured" ? "featured" : `in-content-${idx}`))
        .replace(/[^a-z0-9-]/gi, "-")
        .slice(0, 60) || (type === "featured" ? "featured" : `in-content-${idx}`);
    const titleFallback = typeof postTitle === "string" ? postTitle : "Post";
    const alt =
      altText ??
      (type === "featured" ? titleFallback.slice(0, 125) : `Illustration for section ${idx}`);

    const { id, url } = await uploadShopifyFile(site, buffer, `${slugBase}.${ext}`, mt, alt);

    return NextResponse.json({
      id,
      url,
      type,
      index: idx,
    });
  } catch (err) {
    const msg = errorMessage(err);
    console.error("[shopify-publish/upload-image] Error:", msg);
    void serverLog({
      level: "error",
      source: "farm-com-content-production/publish/upload-image",
      message: msg || "Failed to upload image to Shopify",
    });
    return NextResponse.json({ error: msg || "Failed to upload image to Shopify" }, { status: 500 });
  }
}
