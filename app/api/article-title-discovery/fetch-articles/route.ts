import { NextResponse } from "next/server";
import { fetchDiscoveryArticlesFromRss, isAllowedGreenOrgDiscoveryUrl } from "@/lib/articleDiscoveryRss";
import type { ArticleDiscoveryPayload, FetchArticlesResponse } from "@/lib/articleDiscoveryTypes";
import {
  fetchInoreaderStreamArticles,
  isInoreaderConfigured,
} from "@/lib/inoreaderClient";

/** Avoid prerendering at build time (RSS calls fail or churn and clutter CI logs). */
export const dynamic = "force-dynamic";

function readFallbackFlag(): boolean {
  const v = (process.env.INOREADER_FALLBACK_TO_RSS ?? "true").trim().toLowerCase();
  return v !== "false" && v !== "0";
}

/**
 * Optional Inoreader merge: only keep items whose URL matches the six Green.org sources.
 */
async function mergeInoreaderIfConfigured(): Promise<{
  articles: ArticleDiscoveryPayload[];
  source: FetchArticlesResponse["source"];
  inoreaderError?: string;
}> {
  const wantInoreader = isInoreaderConfigured();
  const streamId = process.env.INOREADER_STREAM_ID?.trim() ?? "";
  const fallbackRss = readFallbackFlag();

  const rss = await fetchDiscoveryArticlesFromRss();

  if (!wantInoreader || !streamId) {
    return { articles: rss, source: "rss" };
  }

  try {
    const raw = await fetchInoreaderStreamArticles(streamId, 40);
    const fromInoreader: ArticleDiscoveryPayload[] = raw
      .filter((a) => isAllowedGreenOrgDiscoveryUrl(a.url))
      .slice(0, 20)
      .map(({ title, url, source: src }) => ({
        title,
        url,
        source: src || "Inoreader",
      }));

    const merged = [...fromInoreader, ...rss];
    const seenUrl = new Set<string>();
    const seenTitle = new Set<string>();
    const deduped: ArticleDiscoveryPayload[] = [];
    for (const a of merged) {
      const u = a.url.trim().toLowerCase();
      const t = a.title.trim().toLowerCase();
      if (!u || seenUrl.has(u) || seenTitle.has(t)) continue;
      seenUrl.add(u);
      seenTitle.add(t);
      deduped.push(a);
      if (deduped.length >= 80) break;
    }

    const sidLog = streamId.length > 90 ? `${streamId.slice(0, 90)}…` : streamId;
    console.log(
      `[fetch-articles] Inoreader "${sidLog}" kept ${fromInoreader.length} (six-source hosts) + RSS → ${deduped.length}`
    );

    return { articles: deduped, source: "inoreader+rss" };
  } catch (err) {
    const inoreaderError = err instanceof Error ? err.message : String(err);
    console.error("[fetch-articles] Inoreader failed:", inoreaderError);
    if (!fallbackRss) {
      return { articles: [], source: "inoreader", inoreaderError };
    }
    return { articles: rss, source: "inoreader+rss", inoreaderError };
  }
}

export async function GET() {
  const { articles, source, inoreaderError } = await mergeInoreaderIfConfigured();

  if (source === "inoreader" && articles.length === 0 && inoreaderError) {
    return NextResponse.json(
      { articles: [], source, inoreaderError } satisfies FetchArticlesResponse,
      { status: 502 }
    );
  }

  console.log(`[fetch-articles] → ${articles.length} articles (source: ${source})`);

  return NextResponse.json({
    articles,
    source,
    ...(inoreaderError ? { inoreaderError } : {}),
  } satisfies FetchArticlesResponse);
}
