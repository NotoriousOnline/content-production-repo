"use client";

import { useEffect, useState } from "react";
import { config } from "./config";

type Site = { id: string; name: string; url: string };

type PreviewResult = {
  applied: boolean;
  persistOk?: boolean;
  setupHint?: string;
  verified?: boolean;
  post: {
    id: number;
    title: string;
    link: string;
    slug: string;
    restCollection: string;
    editUrl: string;
  };
  current: { focusKeyword: string; metaDescription: string };
  proposed: { focusKeyword: string; metaDescription: string };
};

export default function WeedComRankMathTool() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState("");
  const [url, setUrl] = useState("https://weed.com/strains/sherbet-cake-strain/");
  const [postId, setPostId] = useState("595366");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/weed-com-content-production/sites");
        const data = await res.json();
        if (res.ok && Array.isArray(data)) {
          setSites(data);
          if (data[0]?.id) setSiteId(data[0].id);
        }
      } catch {
        setSites([]);
      }
    })();
  }, []);

  const run = async (apply: boolean) => {
    const numericPostId = postId.trim() ? Number(postId.trim()) : Number.NaN;
    const hasPostId = Number.isFinite(numericPostId) && numericPostId > 0;
    if (!siteId || (!hasPostId && !url.trim())) return;
    setLoading(true);
    setError(null);
    if (!apply) setResult(null);
    try {
      const res = await fetch("/api/weed-com-rank-math/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          ...(hasPostId ? { postId: numericPostId } : {}),
          ...(url.trim() ? { url: url.trim() } : {}),
          apply,
        }),
      });
      const data = (await res.json()) as PreviewResult & { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{config.name}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{config.description}</p>
      </div>

      <div className="max-w-2xl space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">WordPress site</label>
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Select site…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.url}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-amber-700">
            Use <strong>weed.com ALEX username</strong> — the other saved site has an invalid application password.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Post ID (optional)</label>
          <input
            type="text"
            inputMode="numeric"
            value={postId}
            onChange={(e) => setPostId(e.target.value)}
            placeholder="595366"
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm font-mono"
          />
          <p className="mt-1 text-xs text-slate-500">
            Use when slug lookup fails (Cloudflare). Skips URL resolution and loads the post by ID directly.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Post URL (optional)</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://weed.com/strains/sherbet-cake-strain/"
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm font-mono"
          />
          <p className="mt-1 text-xs text-slate-500">
            Provide URL or Post ID (or both). Proposes focus keyword (post title) + meta description.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void run(false)}
            disabled={loading || !siteId || (!postId.trim() && !url.trim())}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {loading ? "Working…" : "Preview"}
          </button>
          <button
            type="button"
            onClick={() => void run(true)}
            disabled={loading || !siteId || (!postId.trim() && !url.trim()) || !result}
            className="rounded-lg border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
          >
            Apply to WordPress
          </button>
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
      </div>

      {result && (
        <div className="max-w-3xl space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div>
            <h2 className="text-sm font-medium text-slate-700">Resolved post</h2>
            <p className="mt-1 text-sm text-slate-900">{result.post.title}</p>
            <p className="text-xs text-slate-500">
              ID {result.post.id} · {result.post.restCollection} ·{" "}
              <a href={result.post.link} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">
                {result.post.link}
              </a>
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded border border-slate-100 bg-slate-50 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current</h3>
              <p className="mt-2 text-xs text-slate-500">Focus keyword</p>
              <p className="text-sm text-slate-800">{result.current.focusKeyword || "(empty)"}</p>
              <p className="mt-2 text-xs text-slate-500">Meta description</p>
              <p className="text-sm text-slate-800">{result.current.metaDescription || "(empty)"}</p>
            </div>
            <div className="rounded border border-emerald-100 bg-emerald-50/50 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Proposed</h3>
              <p className="mt-2 text-xs text-slate-500">Focus keyword</p>
              <p className="text-sm font-medium text-slate-900">{result.proposed.focusKeyword}</p>
              <p className="mt-2 text-xs text-slate-500">
                Meta description ({result.proposed.metaDescription.length} chars)
              </p>
              <p className="text-sm text-slate-800">{result.proposed.metaDescription}</p>
            </div>
          </div>

          {result.applied && (
            <div className="space-y-2">
              <p className={`text-sm ${result.persistOk ? "text-emerald-800" : "text-amber-800"}`}>
                {result.persistOk
                  ? result.verified
                    ? "Rank Math focus keyword and meta description were saved and read back successfully."
                    : "WordPress reported success — refresh the post editor in wp-admin to confirm focus keyword and snippet preview."
                  : "Rank Math fields did not persist. See setup note below."}
              </p>
              {result.setupHint ? (
                <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {result.setupHint}
                </p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
