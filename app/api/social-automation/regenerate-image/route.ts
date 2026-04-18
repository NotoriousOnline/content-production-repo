import { NextResponse } from "next/server";
import { markSocialPostFailed, regenerateComposedImageForPost } from "@/lib/socialAutomation/createPostAssets";
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

  const socialPostId =
    typeof (body as { socialPostId?: unknown }).socialPostId === "string"
      ? (body as { socialPostId: string }).socialPostId.trim()
      : "";
  if (!socialPostId) {
    return NextResponse.json({ error: "Missing socialPostId" }, { status: 400 });
  }

  const rawPrompt = (body as { backgroundPrompt?: unknown }).backgroundPrompt;
  const backgroundPrompt =
    typeof rawPrompt === "string" && rawPrompt.trim().length > 0 ? rawPrompt.trim() : undefined;

  try {
    const out = await regenerateComposedImageForPost(socialPostId, backgroundPrompt);
    return NextResponse.json({
      success: true,
      imageBase64: out.imageBase64,
      backgroundPrompt: out.backgroundPrompt,
    });
  } catch (err) {
    await markSocialPostFailed(socialPostId, err);
    return NextResponse.json({ error: errorMessage(err), socialPostId }, { status: 500 });
  }
}
