import { NextResponse } from "next/server";
import {
  articleSlackSigningSecret,
  handleDiscoverySlackInteraction,
  verifySlackRequestSignature,
  type SlackInteractionPayload,
} from "@/lib/articleDiscoverySlack";
import { errorMessage, serverLog } from "@/lib/serverLog";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "article-title-discovery-slack-interact",
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = articleSlackSigningSecret();
  if (!secret) {
    return NextResponse.json({ error: "SLACK_SIGNING_SECRET is not set" }, { status: 500 });
  }

  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";
  if (
    !verifySlackRequestSignature({
      signingSecret: secret,
      timestamp,
      rawBody,
      signature,
    })
  ) {
    return NextResponse.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  let payload: SlackInteractionPayload;
  try {
    const params = new URLSearchParams(rawBody);
    const encoded = params.get("payload");
    payload = JSON.parse(encoded || rawBody) as SlackInteractionPayload;
  } catch {
    return NextResponse.json({ error: "Invalid Slack payload" }, { status: 400 });
  }

  if (payload.type !== "block_actions") {
    return new NextResponse(null, { status: 200 });
  }

  try {
    const updated = await handleDiscoverySlackInteraction(payload);
    return NextResponse.json({
      replace_original: true,
      text: updated.text,
      blocks: updated.blocks,
    });
  } catch (err) {
    console.error("[slack-interact] Failed to update shared checklist:", err);
    void serverLog({
      level: "error",
      source: "article-title-discovery/slack-interact",
      message: errorMessage(err),
    });
    return NextResponse.json({ error: "Could not update Slack message" }, { status: 500 });
  }
}
