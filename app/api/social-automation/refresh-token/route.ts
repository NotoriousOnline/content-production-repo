import { NextResponse } from "next/server";
import { refreshLongLivedToken } from "@/lib/instagramTokenRefresh";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    const { accessToken, expiresIn } = await refreshLongLivedToken();
    console.log(
      "[social-automation/refresh-token] New FACEBOOK_PAGE_ACCESS_TOKEN (copy into Vercel env):",
      accessToken
    );
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    return NextResponse.json({
      expiresIn,
      expiresAt,
      message: "Token refreshed — update FACEBOOK_PAGE_ACCESS_TOKEN in Vercel env vars with the new token",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
