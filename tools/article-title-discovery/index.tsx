"use client";

import { useState, useEffect } from "react";
import { RSS_FEEDS } from "@/lib/rssFeeds";

function getNextRunAt(): Date {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const utcSec = now.getUTCSeconds();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18, 0, 0));
  if (utcHour > 18 || (utcHour === 18 && (utcMin > 0 || utcSec > 0))) {
    today.setUTCDate(today.getUTCDate() + 1);
  }
  return today;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0h 0m 0s";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s}s`;
}

const SOURCE_PILL_NAMES: Record<string, string> = {
  ENN: "ENN",
  "ENN Climate": "ENN Climate",
  "ENN Energy": "ENN Energy",
  "ENN Pollution": "ENN Pollution",
  "ENN Ecosystems": "ENN Ecosystems",
  "ENN Wildlife": "ENN Wildlife",
  "ENN Policy": "ENN Policy",
  "CNN Climate": "CNN Climate",
  "CNN Energy": "CNN Energy",
  Treehugger: "Treehugger",
  "The Guardian Environment": "The Guardian",
  "Earth Day": "Earth Day",
  "Yale E360": "Yale E360",
  Inoreader: "Inoreader",
};

type ResultItem = {
  suggested_title: string;
  source_title: string;
  source_url: string;
  source_name: string;
};

type DiscoveryInfo = {
  primarySource: "inoreader" | "rss";
  rssFeedCount: number;
  inoreaderReady: boolean;
  inoreaderDisplayLabel: string | null;
};

export default function ArticleTitleDiscoveryTool() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState("");
  const [discoveryInfo, setDiscoveryInfo] = useState<DiscoveryInfo | null>(null);

  useEffect(() => {
    const tick = () => {
      const next = getNextRunAt();
      const ms = next.getTime() - Date.now();
      setCountdown(formatCountdown(ms));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/article-title-discovery/info");
        const data = (await res.json()) as DiscoveryInfo;
        if (!cancelled && res.ok && data?.primarySource) {
          setDiscoveryInfo(data);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRun = async () => {
    setLoading(true);
    setSuccess(null);
    setError(null);
    try {
      const res = await fetch("/api/article-title-discovery/run");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Run failed");
        return;
      }
      setResults(data.results ?? []);
      setLastRun(new Date());
      setSuccess(`Done — ${data.count ?? 0} title ideas sent to Slack`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Title/description live in ToolLayout via config — only tool-specific status here */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-violet-100 px-3 py-0.5 text-xs font-medium text-violet-800">
          Daily 1 PM ET
        </span>
        {discoveryInfo?.primarySource === "inoreader" ? (
          <span className="inline-flex items-center rounded-full bg-sky-100 px-3 py-0.5 text-xs font-medium text-sky-900">
            Inoreader
            {discoveryInfo?.inoreaderDisplayLabel ? ` · ${discoveryInfo.inoreaderDisplayLabel}` : ""}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-0.5 text-xs font-medium text-slate-700">
            {discoveryInfo?.rssFeedCount ?? RSS_FEEDS.length} RSS sources
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-mono font-medium text-slate-700">
          <span className="text-slate-500">Next run in:</span>
          {countdown || "—"}
        </span>
      </div>

      {/* Sources list */}
      <div>
        <h2 className="text-sm font-medium text-slate-500">
          {discoveryInfo?.primarySource === "inoreader" ? "Article sources" : "RSS sources"}
        </h2>
        {discoveryInfo?.primarySource === "inoreader" ? (
          <div className="mt-2 space-y-2 text-sm text-slate-600">
            <p>
              Articles are loaded from your{" "}
              <strong className="font-medium text-slate-800">Inoreader</strong> folder/stream (
              {discoveryInfo?.inoreaderDisplayLabel ?? "configured stream"}). Add or remove blogs in
              Inoreader; the next run picks up the newest items from that stream.
            </p>
            <p className="text-xs text-slate-500">
              If Inoreader fails, the app can fall back to built-in RSS feeds (see{" "}
              <code className="rounded bg-slate-100 px-1">INOREADER_FALLBACK_TO_RSS</code> in{" "}
              <code className="rounded bg-slate-100 px-1">.env.example</code>).
            </p>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {RSS_FEEDS.map((feed) => (
              <span
                key={feed.name}
                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
              >
                {SOURCE_PILL_NAMES[feed.name] ?? feed.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Manual run */}
      <div>
        <button
          type="button"
          onClick={handleRun}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <svg
                className="h-4 w-4 animate-spin text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Fetching articles and generating titles...
            </>
          ) : (
            "Run Now"
          )}
        </button>

        {success && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            {success}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}
      </div>

      {/* Section 4 — Results Preview */}
      {results.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-slate-500">Results Preview</h2>
          <div className="mt-4 space-y-4">
            {results.map((r, i) => (
              <div
                key={i}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-lg font-semibold text-slate-900">{r.suggested_title}</p>
                <p className="mt-1 text-sm text-slate-500">Inspired by: {r.source_title}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {SOURCE_PILL_NAMES[r.source_name] ?? r.source_name}
                  </span>
                  <a
                    href={r.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-violet-600 hover:underline"
                  >
                    {r.source_url}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last run */}
      <div className="text-sm text-slate-500">
        Last run: {lastRun ? lastRun.toLocaleString() : "never"}
      </div>
    </div>
  );
}
