import { NextResponse } from "next/server";
import { createPendingPostAndGenerateAssets, markSocialPostFailed } from "@/lib/socialAutomation/createPostAssets";
import { publishToInstagram } from "@/lib/instagramPublisher";
import { errorMessage } from "@/lib/serverLog";
import { getSupabaseAdmin } from "@/lib/supabase";

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

  let socialPostIdForPublishError: string | undefined;
  try {
    const assets = await createPendingPostAndGenerateAssets(title, excerpt);
    socialPostIdForPublishError = assets.socialPostId;

    const { instagramPostId, permalink } = await publishToInstagram({
      imageBuffer: assets.imageBuffer,
      caption: assets.caption,
    });

    const supabase = getSupabaseAdmin();
    const { error: u3 } = await supabase
      .from("social_posts")
      .update({
        instagram_status: "success",
        instagram_post_id: instagramPostId,
        instagram_permalink: permalink,
        error_message: null,
      })
      .eq("id", assets.socialPostId);
    if (u3) {
      throw new Error(`Failed to save Instagram result: ${u3.message}`);
    }

    return NextResponse.json({
      success: true,
      shortTitle: assets.shortTitle,
      caption: assets.caption,
      imageBase64: assets.imageBase64,
      instagramPostId,
      permalink,
    });
  } catch (err) {
    if (socialPostIdForPublishError) {
      await markSocialPostFailed(socialPostIdForPublishError, err);
    }
    return NextResponse.json(
      { error: errorMessage(err), socialPostId: socialPostIdForPublishError },
      { status: 500 }
    );
  }
}
