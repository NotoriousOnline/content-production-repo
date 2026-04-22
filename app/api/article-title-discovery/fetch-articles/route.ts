import { NextResponse } from "next/server";
import { fetchDiscoveryArticlesFromRss } from "@/lib/articleDiscoveryRss";
import type { ArticleDiscoveryPayload, FetchArticlesResponse } from "@/lib/articleDiscoveryTypes";
import {
  fetchInoreaderStreamArticles,
  isInoreaderConfigured,
} from "@/lib/inoreaderClient";

/** Avoid prerendering at build time (RSS / Inoreader calls fail or churn and clutter CI logs). */
export const dynamic = "force-dynamic";

function readFallbackFlag(): boolean {
  const v = (process.env.INOREADER_FALLBACK_TO_RSS ?? "true").trim().toLowerCase();
  return v !== "false" && v !== "0";
}

export async function GET() {
  const wantInoreader = isInoreaderConfigured();
  const streamId = process.env.INOREADER_STREAM_ID?.trim() ?? "";
  const fallbackRss = readFallbackFlag();

  let articles: ArticleDiscoveryPayload[] = [];
  let source: FetchArticlesResponse["source"] = "rss";
  let inoreaderError: string | undefined;

  if (wantInoreader && streamId) {
    try {
      const raw = await fetchInoreaderStreamArticles(streamId, 40);
      articles = raw.slice(0, 20).map(({ title, url, source: src }) => ({
        title,
        url,
        source: src,
      }));
      source = "inoreader";
      const sidLog = streamId.length > 90 ? `${streamId.slice(0, 90)}…` : streamId;
      console.log(`[fetch-articles] Inoreader stream "${sidLog}" → ${articles.length} articles`);
      // Always merge recent RSS for freshness/source diversity (ENN/CNN/etc), then dedupe.
      const rss = await fetchDiscoveryArticlesFromRss();
      const merged = [...articles, ...rss];
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
        if (deduped.length >= 20) break;
      }
      articles = deduped;
      source = "inoreader+rss";
    } catch (err) {
      inoreaderError = err instanceof Error ? err.message : String(err);
      console.error("[fetch-articles] Inoreader failed:", inoreaderError);
      if (fallbackRss) {
        articles = await fetchDiscoveryArticlesFromRss();
        source = "inoreader+rss";
      } else {
        return NextResponse.json(
          {
            articles: [],
            source: "inoreader",
            inoreaderError,
          } satisfies FetchArticlesResponse,
          { status: 502 }
        );
      }
    }
  } else {
    articles = await fetchDiscoveryArticlesFromRss();
    source = "rss";
    console.log(`[fetch-articles] RSS → ${articles.length} articles`);
  }

  return NextResponse.json({
    articles,
    source,
    ...(inoreaderError ? { inoreaderError } : {}),
  } satisfies FetchArticlesResponse);
}
