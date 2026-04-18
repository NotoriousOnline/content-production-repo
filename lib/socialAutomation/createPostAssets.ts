import { generateImage } from "@/lib/geminiClient";
import { generateInstagramContent } from "@/lib/instagramContentGenerator";
import { composeInstagramImage } from "@/lib/instagramImageComposer";
import { errorMessage } from "@/lib/serverLog";
import { getSupabaseAdmin } from "@/lib/supabase";

export type CreatedPostAssets = {
  socialPostId: string;
  shortTitle: string;
  caption: string;
  imageBase64: string;
  imageBuffer: Buffer;
  backgroundPrompt: string;
};

export async function markSocialPostFailed(socialPostId: string, err: unknown): Promise<void> {
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

/**
 * Inserts a pending `social_posts` row, generates caption + square graphic, saves `image_base64`.
 * Does not call Instagram.
 */
export async function createPendingPostAndGenerateAssets(
  title: string,
  excerpt: string | undefined
): Promise<CreatedPostAssets> {
  const supabase = getSupabaseAdmin();
  const { data: inserted, error: insertError } = await supabase
    .from("social_posts")
    .insert({ wp_post_title: title, instagram_status: "pending" })
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    throw new Error(insertError?.message ?? "Failed to create social_posts row");
  }

  const socialPostId = String(inserted.id);

  try {
    const { shortTitle, caption, backgroundPrompt } = await generateInstagramContent({
      title,
      excerpt,
    });

    const { error: u1 } = await supabase
      .from("social_posts")
      .update({ short_title: shortTitle, instagram_caption: caption })
      .eq("id", socialPostId);
    if (u1) {
      throw new Error(`Failed to save caption fields: ${u1.message}`);
    }

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

    return { socialPostId, shortTitle, caption, imageBase64, imageBuffer, backgroundPrompt };
  } catch (e) {
    await markSocialPostFailed(socialPostId, e);
    throw e;
  }
}

export type RegeneratedImage = {
  imageBase64: string;
  imageBuffer: Buffer;
  backgroundPrompt: string;
};

/**
 * Re-runs Gemini + compose using `backgroundPromptOverride` when non-empty; otherwise asks Claude for a new background prompt from `wp_post_title`.
 */
export async function regenerateComposedImageForPost(
  socialPostId: string,
  backgroundPromptOverride?: string | undefined
): Promise<RegeneratedImage> {
  const supabase = getSupabaseAdmin();
  const { data: row, error: fetchError } = await supabase
    .from("social_posts")
    .select("wp_post_title, short_title")
    .eq("id", socialPostId)
    .single();

  if (fetchError || !row) {
    throw new Error(fetchError?.message ?? "Post not found");
  }

  const rec = row as { wp_post_title: string; short_title: string | null };
  const title = (rec.wp_post_title ?? "").trim();
  const shortTitle = (rec.short_title ?? "").trim();
  if (!shortTitle) {
    throw new Error("Draft is missing overlay title. Generate a preview first.");
  }

  let backgroundPrompt = (backgroundPromptOverride ?? "").trim();
  if (!backgroundPrompt) {
    const gen = await generateInstagramContent({ title: title || "Article" });
    backgroundPrompt = gen.backgroundPrompt;
  }

  const { base64, mimeType } = await generateImage(backgroundPrompt, { aspectRatio: "1:1" });

  const imageBuffer = await composeInstagramImage({
    shortTitle,
    backgroundBase64: base64,
    backgroundMimeType: mimeType,
  });

  const imageBase64 = imageBuffer.toString("base64");

  const { error: u2 } = await supabase.from("social_posts").update({ image_base64: imageBase64 }).eq("id", socialPostId);
  if (u2) {
    throw new Error(`Failed to save image: ${u2.message}`);
  }

  return { imageBase64, imageBuffer, backgroundPrompt };
}
