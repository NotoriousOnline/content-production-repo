import { NextResponse } from "next/server";
import { errorMessage, serverLog } from "@/lib/serverLog";
import type { TitleDiscoveryOutputItem } from "@/lib/articleDiscoveryTypes";

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatCandidate(r: TitleDiscoveryOutputItem, index: number): string[] {
  return [
    `${index}. ${r.suggested_title}`,
    `   Category: ${r.category ?? "—"}`,
    `   Link: ${r.source_name ? `${r.source_name} — ` : ""}${r.source_url}`,
    `   Angle: ${r.angle ?? "—"}`,
    "",
  ];
}

export async function POST(request: Request) {
  const webhookUrl = process.env.ARTICLE_SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    void serverLog({
      level: "error",
      source: "article-title-discovery/send-to-slack",
      message: "ARTICLE_SLACK_WEBHOOK_URL is not set",
    });
    return NextResponse.json(
      { success: false, error: "ARTICLE_SLACK_WEBHOOK_URL is not set" },
      { status: 500 }
    );
  }

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
    return NextResponse.json({ success: true, count: 0 });
  }

  const lines: string[] = [
    "*green.org — Daily News Discovery Shortlist*",
    formatDate(),
    "_Surface only — pick the final two yourself._",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
  ];

  results.forEach((r, i) => {
    lines.push(...formatCandidate(r, i + 1));
  });

  const text = lines.join("\n").trim();

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[send-to-slack] Slack webhook error:", res.status, errText);
      void serverLog({
        level: "error",
        source: "article-title-discovery/send-to-slack",
        message: `Slack webhook HTTP ${res.status}: ${errText.slice(0, 500)}`,
      });
      return NextResponse.json(
        { success: false, error: `Slack webhook failed: ${res.status}` },
        { status: 502 }
      );
    }
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

  return NextResponse.json({ success: true, count: results.length });
}
