"use client";

import { useState, useEffect } from "react";
import { GREEN_ORG_DISCOVERY_SOURCES } from "@/lib/rssFeeds";
import type { TitleDiscoveryOutputItem } from "@/lib/articleDiscoveryTypes";

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

type DiscoveryInfo = {
  primarySource: "six-sources" | "inoreader+six-sources";
  sourceCount: number;
  sourceNames: string[];
  inoreaderReady: boolean;
  inoreaderDisplayLabel: string | null;
};

export default function ArticleTitleDiscoveryTool() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TitleDiscoveryOutputItem[]>([]);
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
    setWarning(null);
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
      if (data.warning) setWarning(data.warning);
      setSuccess(
        `Done — ${data.count ?? 0} shortlist candidates sent to Slack${data.provider ? ` (via ${data.provider})` : ""}. Pick the final two yourself.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const sourceNames = discoveryInfo?.sourceNames?.length
    ? discoveryInfo.sourceNames
    : GREEN_ORG_DISCOVERY_SOURCES.map((s) => s.name);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-violet-100 px-3 py-0.5 text-xs font-medium text-violet-800">
          Daily 1 PM ET
        </span>
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-medium text-emerald-900">
          6 sources · Energy / Tech / Climate / Transportation
        </span>
        <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-0.5 text-xs font-medium text-amber-900">
          24h freshness window
        </span>
        {discoveryInfo?.inoreaderReady ? (
          <span className="inline-flex items-center rounded-full bg-sky-100 px-3 py-0.5 text-xs font-medium text-sky-900">
            Inoreader merge
            {discoveryInfo.inoreaderDisplayLabel ? ` · ${discoveryInfo.inoreaderDisplayLabel}` : ""}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-mono font-medium text-slate-700">
          <span className="text-slate-500">Next run in:</span>
          {countdown || "—"}
        </span>
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-500">Sources (all six, every run)</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {sourceNames.map((name) => (
            <span
              key={name}
              className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
            >
              {name}
            </span>
          ))}
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Scans these outlets only, clusters duplicate coverage, keeps stories that fit a category and
          can still publish inside 24 hours of break time, then returns a shortlist. You pick the final
          two.
        </p>
      </div>

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
              Scanning sources and building shortlist...
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
        {warning && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {warning}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-slate-500">
            Shortlist preview ({results.length}) — pick the final two yourself
          </h2>
          <div className="mt-4 space-y-4">
            {results.map((r, i) => (
              <div
                key={`${r.source_url}-${i}`}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-lg font-semibold text-slate-900">
                  {i + 1}. {r.suggested_title}
                </p>
                {r.category ? (
                  <p className="mt-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">Category:</span> {r.category}
                  </p>
                ) : null}
                {r.angle ? (
                  <p className="mt-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">Angle:</span> {r.angle}
                  </p>
                ) : null}
                <a
                  href={r.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm text-violet-600 hover:underline"
                >
                  {r.source_name ? `${r.source_name} — ${r.source_url}` : r.source_url}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-sm text-slate-500">
        Last run: {lastRun ? lastRun.toLocaleString() : "never"}
      </div>
    </div>
  );
}
