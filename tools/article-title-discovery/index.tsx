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

type SlackSetup = {
  keysSet: boolean;
  botOk: boolean;
  botName: string | null;
  channel: string | null;
  error: string | null;
  nextStep: string | null;
  interactPath: string;
  socketConfigured?: boolean;
  socketConnected?: boolean;
  ticksReady?: boolean;
};

type DiscoveryInfo = {
  primarySource: "six-sources" | "inoreader+six-sources";
  sourceCount: number;
  sourceNames: string[];
  inoreaderReady: boolean;
  inoreaderDisplayLabel: string | null;
  ahrefsReady?: boolean;
  slackInteractive?: boolean;
  slackSetup?: SlackSetup;
};

export default function ArticleTitleDiscoveryTool() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TitleDiscoveryOutputItem[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState("");
  const [discoveryInfo, setDiscoveryInfo] = useState<DiscoveryInfo | null>(null);
  const [slackTestLoading, setSlackTestLoading] = useState(false);

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
    const load = async () => {
      try {
        const res = await fetch("/api/article-title-discovery/info");
        const data = (await res.json()) as DiscoveryInfo;
        if (!cancelled && res.ok && data?.primarySource) {
          setDiscoveryInfo(data);
        }
        return data;
      } catch {
        return null;
      }
    };
    void load();
    const id = setInterval(() => {
      void (async () => {
        const data = await load();
        if (data?.slackSetup?.ticksReady) clearInterval(id);
      })();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
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
      setSelectedUrls(new Set());
      setLastRun(new Date());
      if (data.warning) setWarning(data.warning);
      setSuccess(
        Boolean(data.interactive)
          ? `Done — ${data.count ?? 0} candidates posted to Slack. Anyone in the channel can tick Select; everyone else sees the pick.`
          : `Done — ${data.count ?? 0} candidates sent to Slack${data.provider ? ` (via ${data.provider})` : ""}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSlackTest = async () => {
    setSlackTestLoading(true);
    setSuccess(null);
    setWarning(null);
    setError(null);
    try {
      const res = await fetch("/api/article-title-discovery/slack-test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Slack test post failed");
        return;
      }
      setSuccess(
        "Test checklist posted to Slack. Tick Select — everyone else in the channel should see it."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Slack test failed");
    } finally {
      setSlackTestLoading(false);
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
          24h news + 2–3 week traffic
        </span>
        {discoveryInfo?.inoreaderReady ? (
          <span className="inline-flex items-center rounded-full bg-sky-100 px-3 py-0.5 text-xs font-medium text-sky-900">
            Inoreader merge
            {discoveryInfo.inoreaderDisplayLabel ? ` · ${discoveryInfo.inoreaderDisplayLabel}` : ""}
          </span>
        ) : null}
        {discoveryInfo?.ahrefsReady ? (
          <span className="inline-flex items-center rounded-full bg-orange-100 px-3 py-0.5 text-xs font-medium text-orange-900">
            Ahrefs traffic ranking
          </span>
        ) : null}
        {discoveryInfo?.slackInteractive ? (
          <span className="inline-flex items-center rounded-full bg-pink-100 px-3 py-0.5 text-xs font-medium text-pink-900">
            Slack live shared picks
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
          Scans these outlets, keeps 24-hour news plus 2–3 week articles that already have Ahrefs organic
          traffic, then posts a shared Slack checklist. When anyone ticks Select, the whole channel sees
          who picked it.
        </p>
        {discoveryInfo?.slackSetup ? (
          <div
            className={`mt-3 rounded-lg border p-3 text-sm ${
              discoveryInfo.slackSetup.ticksReady
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : "border-pink-200 bg-pink-50 text-pink-950"
            }`}
          >
            <p className="font-medium">
              Slack bot {discoveryInfo.slackSetup.botOk ? "connected" : "not connected"}
              {discoveryInfo.slackSetup.botName ? ` as @${discoveryInfo.slackSetup.botName}` : ""}.
              {discoveryInfo.slackSetup.ticksReady
                ? " Shared ticks are live."
                : " Shared ticks are not live yet."}
            </p>
            {discoveryInfo.slackSetup.nextStep ? (
              <p className="mt-1">{discoveryInfo.slackSetup.nextStep}</p>
            ) : null}
            {!discoveryInfo.slackSetup.ticksReady ? (
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Slack app → Socket Mode → Enable Socket Mode</li>
                <li>
                  Interactivity &amp; Shortcuts → On. Leave Request URL empty while Socket Mode is on.
                </li>
                <li>
                  Basic Information → App-Level Tokens → Generate Token and Scopes → add{" "}
                  <span className="font-mono text-xs">connections:write</span> on the same app as the bot
                </li>
                <li>
                  Put the <span className="font-mono text-xs">xapp-</span> token in{" "}
                  <span className="font-mono text-xs">.env.local</span> as{" "}
                  <span className="font-mono text-xs">SLACK_APP_TOKEN</span>, then restart{" "}
                  <span className="font-mono text-xs">npm run dev</span>
                </li>
                <li>Click Test Slack ticks and tick Select on that new message</li>
              </ol>
            ) : null}
          </div>
        ) : null}
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
              Scanning sources, ranking with Ahrefs, and building shortlist...
            </>
          ) : (
            "Run Now"
          )}
        </button>
        <button
          type="button"
          onClick={handleSlackTest}
          disabled={loading || slackTestLoading}
          className="ml-2 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {slackTestLoading ? "Posting Slack test..." : "Test Slack ticks"}
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
        <ChecklistPreview
          results={results}
          selectedUrls={selectedUrls}
          onToggle={(url) => {
            setSelectedUrls((prev) => {
              const next = new Set(prev);
              if (next.has(url)) next.delete(url);
              else next.add(url);
              return next;
            });
          }}
        />
      )}

      <div className="text-sm text-slate-500">
        Last run: {lastRun ? lastRun.toLocaleString() : "never"}
      </div>
    </div>
  );
}

function formatCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return Math.round(n).toLocaleString("en-US");
}

function trafficSummary(r: TitleDiscoveryOutputItem): string {
  const visits = r.ahrefs?.orgTraffic;
  const volume = r.ahrefs?.topicVolume;
  if (visits != null && visits > 0) return `${formatCompact(visits)} org visits/mo`;
  if (volume != null && volume > 0) return `${formatCompact(volume)} topic vol/mo`;
  return "traffic n/a";
}

function ChecklistPreview({
  results,
  selectedUrls,
  onToggle,
}: {
  results: TitleDiscoveryOutputItem[];
  selectedUrls: Set<string>;
  onToggle: (url: string) => void;
}) {
  const fresh = results.filter((r) => r.lane !== "organic");
  const organic = results.filter((r) => r.lane === "organic");

  return (
    <div>
      <h2 className="text-sm font-medium text-slate-500">
        Checklist preview ({results.length}) — {selectedUrls.size} selected · Slack ticks are shared with the channel
      </h2>
      <ChecklistGroup
        heading="24h news"
        items={fresh}
        selectedUrls={selectedUrls}
        onToggle={onToggle}
      />
      <ChecklistGroup
        heading="2–3 weeks · Ahrefs organic traffic"
        items={organic}
        selectedUrls={selectedUrls}
        onToggle={onToggle}
      />
    </div>
  );
}

function ChecklistGroup({
  heading,
  items,
  selectedUrls,
  onToggle,
}: {
  heading: string;
  items: TitleDiscoveryOutputItem[];
  selectedUrls: Set<string>;
  onToggle: (url: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{heading}</h3>
      <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {items.map((r) => {
          const checked = selectedUrls.has(r.source_url);
          return (
            <li key={r.source_url}>
              <label
                className={`flex cursor-pointer items-start gap-3 px-4 py-3 ${
                  checked ? "bg-violet-50" : "bg-white hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(r.source_url)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">{r.suggested_title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span>{r.source_name || "Source"}</span>
                    {r.category ? <span>· {r.category}</span> : null}
                    <span>· {trafficSummary(r)}</span>
                    <a
                      href={r.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-violet-600 hover:underline"
                    >
                      Open
                    </a>
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
