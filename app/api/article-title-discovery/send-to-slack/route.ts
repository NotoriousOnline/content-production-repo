import { NextResponse } from "next/server";
import { postDiscoveryChecklist } from "@/lib/articleDiscoverySlack";
import { startSlackSocketMode } from "@/lib/slackSocketMode";
import { errorMessage, serverLog } from "@/lib/serverLog";
import type { TitleDiscoveryOutputItem } from "@/lib/articleDiscoveryTypes";

export async function POST(request: Request) {
  let body: { results?: TitleDiscoveryOutputItem[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const results = Array.isArray(body.results) ? body.results : [];
  if (results.length === 0) {
    return NextResponse.json({ success: true, count: 0, interactive: false });
  }

  try {
    startSlackSocketMode();
    const posted = await postDiscoveryChecklist(results);
    if (!posted.ok) {
      void serverLog({
        level: "error",
        source: "article-title-discovery/send-to-slack",
        message: posted.error,
      });
      return NextResponse.json({ success: false, error: posted.error }, { status: 502 });
    }
    return NextResponse.json({
      success: true,
      count: posted.count,
      interactive: posted.interactive,
      ...(posted.warning ? { warning: posted.warning } : {}),
    });
  } catch (err) {
    console.error("[send-to-slack] Fetch error:", err);
    void serverLog({
      level: "error",
      source: "article-title-discovery/send-to-slack",
      message: errorMessage(err),
    });
    return NextResponse.json(
      { success: false, error: "Failed to send to Slack" },
      { status: 502 }
    );
  }
}
