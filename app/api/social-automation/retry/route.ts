import { NextResponse } from "next/server";
import { generateImage } from "@/lib/geminiClient";
import { generateInstagramContent } from "@/lib/instagramContentGenerator";
import { composeInstagramImage } from "@/lib/instagramImageComposer";
import { publishToInstagram } from "@/lib/instagramPublisher";
import { errorMessage } from "@/lib/serverLog";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function markSocialPostFailed(socialPostId: string, err: unknown): Promise<void> {
  const msg = errorMessage(err).slice(0, 12000);
  try {
    await getSupabaseAdmin()
      .from("social_posts")
      .update({ instagram_status: "failed", error_message: msg })
      .eq("id", socialPostId);
  } catch {
    /* best effort */
  }
}

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
    .select("wp_post_title, short_title, instagram_caption")
    .eq("id", socialPostId)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: fetchError?.message ?? "Post not found", socialPostId }, { status: 404 });
  }

  const rec = row as {
    wp_post_title: string;
    short_title: string | null;
    instagram_caption: string | null;
  };
  const shortTitle = (rec.short_title ?? "").trim();
  const caption = (rec.instagram_caption ?? "").trim();
  const title = (rec.wp_post_title ?? "").trim();

  if (!shortTitle || !caption || !title) {
    return NextResponse.json(
      {
        error:
          "Cannot retry: this row is missing saved short title or caption. Run a full generate from the form first.",
        socialPostId,
      },
      { status: 400 }
    );
  }

  try {
    const { backgroundPrompt } = await generateInstagramContent({ title });
    const { base64, mimeType } = await generateImage(backgroundPrompt, { aspectRatio: "1:1" });
    const imageBuffer = await composeInstagramImage({
      shortTitle,
      backgroundBase64: base64,
      backgroundMimeType: mimeType,
    });
    const imageBase64 = imageBuffer.toString("base64");

    const { error: u2 } = await supabase.from("social_posts").update({ image_base64: imageBase64 }).eq("id", socialPostId);
    if (u2) {
      throw new Error(`Failed to save image preview: ${u2.message}`);
    }

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
      shortTitle,
      caption,
      imageBase64,
      instagramPostId,
      permalink,
      socialPostId,
    });
  } catch (err) {
    await markSocialPostFailed(socialPostId, err);
    return NextResponse.json(
      { error: errorMessage(err), socialPostId },
      { status: 500 }
    );
  }
}
