import { NextResponse } from "next/server";
import {
  articleSlackSigningSecret,
  handleDiscoverySlackInteraction,
  type SlackInteractionPayload,
} from "@/lib/articleDiscoverySlack";
import { errorMessage, serverLog } from "@/lib/serverLog";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = articleSlackSigningSecret();
  const provided = request.headers.get("x-article-socket-key") ?? "";
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: SlackInteractionPayload;
  try {
    payload = (await request.json()) as SlackInteractionPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.type !== "block_actions") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    await handleDiscoverySlackInteraction(payload);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[slack-socket-event] Failed to update shared checklist:", err);
    void serverLog({
      level: "error",
      source: "article-title-discovery/slack-socket-event",
      message: errorMessage(err),
    });
    return NextResponse.json({ error: "Could not update Slack message" }, { status: 500 });
  }
}
