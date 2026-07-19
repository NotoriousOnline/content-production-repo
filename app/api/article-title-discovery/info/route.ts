import { NextResponse } from "next/server";
import { isInoreaderConfigured } from "@/lib/inoreaderClient";
import { GREEN_ORG_DISCOVERY_SOURCES } from "@/lib/rssFeeds";

export const dynamic = "force-dynamic";

export type ArticleDiscoveryInfo = {
  primarySource: "six-sources" | "inoreader+six-sources";
  sourceCount: number;
  sourceNames: string[];
  inoreaderReady: boolean;
  /** Safe display label; set INOREADER_STREAM_LABEL to customize. */
  inoreaderDisplayLabel: string | null;
};

export async function GET(): Promise<NextResponse<ArticleDiscoveryInfo>> {
  const streamId = process.env.INOREADER_STREAM_ID?.trim();
  const customLabel = process.env.INOREADER_STREAM_LABEL?.trim();
  const inoreaderReady = isInoreaderConfigured() && Boolean(streamId);

  let inoreaderDisplayLabel: string | null = null;
  if (inoreaderReady) {
    inoreaderDisplayLabel =
      customLabel ??
      (streamId?.includes("/label/")
        ? decodeURIComponent(streamId.split("/label/").pop() ?? "Inoreader")
        : "Inoreader");
  }

  const body: ArticleDiscoveryInfo = {
    primarySource: inoreaderReady ? "inoreader+six-sources" : "six-sources",
    sourceCount: GREEN_ORG_DISCOVERY_SOURCES.length,
    sourceNames: GREEN_ORG_DISCOVERY_SOURCES.map((s) => s.name),
    inoreaderReady,
    inoreaderDisplayLabel,
  };
  return NextResponse.json(body);
}
