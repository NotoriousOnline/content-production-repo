import { NextResponse } from "next/server";
import { createPendingPostAndGenerateAssets } from "@/lib/socialAutomation/createPostAssets";
import { errorMessage } from "@/lib/serverLog";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rec = body as Record<string, unknown>;
  const titleRaw = rec.title;
  const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Missing or empty title" }, { status: 400 });
  }

  const excerpt =
    typeof rec.excerpt === "string" && rec.excerpt.trim().length > 0 ? rec.excerpt.trim() : undefined;

  try {
    const assets = await createPendingPostAndGenerateAssets(title, excerpt);
    return NextResponse.json({
      success: true,
      socialPostId: assets.socialPostId,
      shortTitle: assets.shortTitle,
      caption: assets.caption,
      imageBase64: assets.imageBase64,
      backgroundPrompt: assets.backgroundPrompt,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
