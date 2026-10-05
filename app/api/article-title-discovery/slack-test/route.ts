import { NextResponse } from "next/server";
import { attachSocketStatus, diagnoseSlackSetup, postSlackConnectionTest } from "@/lib/articleDiscoverySlack";
import { startSlackSocketMode } from "@/lib/slackSocketMode";

export const dynamic = "force-dynamic";

export async function POST() {
  const setup = attachSocketStatus(await diagnoseSlackSetup(), startSlackSocketMode());
  const posted = await postSlackConnectionTest();
  if (!posted.ok) {
    return NextResponse.json(
      { success: false, error: posted.error, setup },
      { status: 502 }
    );
  }
  return NextResponse.json({
    success: true,
    channel: posted.channel,
    ts: posted.ts,
    setup,
  });
}
