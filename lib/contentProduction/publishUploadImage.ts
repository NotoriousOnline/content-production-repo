import { NextResponse } from "next/server";
import { getSiteById, type WPToolScope } from "@/lib/wpSites";
import { uploadMedia, updateMediaDetails } from "@/lib/wordpressClient";
import { compressImageForUpload } from "@/lib/contentProduction/wpImageCompress";
import { errorMessage, serverLog } from "@/lib/serverLog";
import { formatWpNetworkErrorHint, isTransientWpNetworkError } from "@/lib/wpFetch";

/** One base64 image per request — stays under Vercel function payload limits. */
const MAX_UPLOAD_IMAGE_BODY_BYTES = 3_500_000;

export async function postPublishUploadImage(request: Request, toolScope: WPToolScope) {
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
    const { id, url } = await uploadMedia(site, buffer, `${slugBase}.${ext}`, mt);

    const titleFallback = typeof postTitle === "string" ? postTitle : "Post";
    await updateMediaDetails(site, id, {
      alt_text:
        altText ??
        (type === "featured" ? titleFallback.slice(0, 125) : `Illustration for section ${idx}`),
      title: slugBase.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    });

    return NextResponse.json({
      id,
      url,
      type,
      index: idx,
    });
  } catch (err) {
    const msg = isTransientWpNetworkError(err) ? formatWpNetworkErrorHint(err) : errorMessage(err);
    console.error("[publish/upload-image] Error:", msg);
    void serverLog({
      level: "error",
      source: "content-production/publish-upload-image",
      message: msg || "Upload failed",
    });
    return NextResponse.json(
      { error: msg || "Failed to upload image" },
      { status: isTransientWpNetworkError(err) ? 503 : 500 }
    );
  }
}
