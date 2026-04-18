import { NextResponse } from "next/server";
import { markSocialPostFailed } from "@/lib/socialAutomation/createPostAssets";
import { publishToInstagram } from "@/lib/instagramPublisher";
import { errorMessage } from "@/lib/serverLog";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const socialPostId =
    typeof (body as { socialPostId?: unknown }).socialPostId === "string"
      ? (body as { socialPostId: string }).socialPostId.trim()
      : "";
  if (!socialPostId) {
    return NextResponse.json({ error: "Missing socialPostId" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: row, error: fetchError } = await supabase
    .from("social_posts")
    .select("short_title, instagram_caption, image_base64")
    .eq("id", socialPostId)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: fetchError?.message ?? "Post not found" }, { status: 404 });
  }

  const rec = row as {
    short_title: string | null;
    instagram_caption: string | null;
    image_base64: string | null;
  };

  const caption = (rec.instagram_caption ?? "").trim();
  const imageBase64 = rec.image_base64 ?? "";
  if (!caption || !imageBase64) {
    return NextResponse.json(
      { error: "This draft has no saved caption or image. Generate a preview first." },
      { status: 400 }
    );
  }

  let imageBuffer: Buffer;
  try {
    imageBuffer = Buffer.from(imageBase64, "base64");
  } catch {
    return NextResponse.json({ error: "Invalid stored image data" }, { status: 500 });
  }

  try {
    const { instagramPostId, permalink } = await publishToInstagram({ imageBuffer, caption });

    const { error: u3 } = await supabase
      .from("social_posts")
      .update({
        instagram_status: "success",
        instagram_post_id: instagramPostId,
        instagram_permalink: permalink,
        error_message: null,
      })
      .eq("id", socialPostId);
    if (u3) {
      throw new Error(`Failed to save Instagram result: ${u3.message}`);
    }

    return NextResponse.json({
      success: true,
      socialPostId,
      shortTitle: rec.short_title ?? "",
      caption,
      imageBase64,
      instagramPostId,
      permalink,
    });
  } catch (err) {
    await markSocialPostFailed(socialPostId, err);
    return NextResponse.json({ error: errorMessage(err), socialPostId }, { status: 500 });
  }
}
