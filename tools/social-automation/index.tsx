"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

type LogRow = {
  id: string;
  created_at: string;
  wp_post_title: string;
  short_title: string | null;
  instagram_status: string | null;
  instagram_permalink: string | null;
};

type PublishSuccess = {
  shortTitle: string;
  caption: string;
  imageBase64: string;
  permalink: string | null;
};

type DraftPreview = {
  socialPostId: string;
  shortTitle: string;
  caption: string;
  imageBase64: string;
  /** Gemini / Imagen background prompt; edit and regenerate without changing caption. */
  backgroundPrompt: string;
};

const PREVIEW_STEPS = [
  "Generating caption and image prompt...",
  "Creating background image with Gemini...",
  "Composing Instagram graphic...",
] as const;

function statusPillClass(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (s === "success") {
    return "bg-emerald-100 text-emerald-900 ring-emerald-200";
  }
  if (s === "failed") {
    return "bg-red-100 text-red-900 ring-red-200";
  }
  if (s === "pending") {
    return "bg-amber-100 text-amber-950 ring-amber-200";
  }
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function downloadSlug(s: string): string {
  const t = s.trim().slice(0, 60).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return t || "instagram-post";
}

export default function SocialAutomationTool() {
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");

  const [previewLoading, setPreviewLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [stepsDone, setStepsDone] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<PublishSuccess | null>(null);
  const [draft, setDraft] = useState<DraftPreview | null>(null);
  const [copyCaptionDone, setCopyCaptionDone] = useState(false);
  const [imageRegenerateLoading, setImageRegenerateLoading] = useState(false);

  const [logs, setLogs] = useState<LogRow[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  const [retryingId, setRetryingId] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [tokenExpiryLabel, setTokenExpiryLabel] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const res = await fetch("/api/social-automation/logs");
      const data = (await res.json()) as { rows?: LogRow[]; error?: string };
      if (!res.ok) {
        setLogsError(data.error ?? "Failed to load activity log");
        return;
      }
      setLogs(data.rows ?? []);
    } catch (e) {
      setLogsError(e instanceof Error ? e.message : "Failed to load activity log");
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!previewLoading) return;
    setStepsDone(0);
    const id = window.setInterval(() => {
      setStepsDone((d) => (d >= 2 ? 2 : d + 1));
    }, 6000);
    return () => window.clearInterval(id);
  }, [previewLoading]);

  const resetAll = () => {
    setTitle("");
    setExcerpt("");
    setError(null);
    setSuccess(null);
    setDraft(null);
    setStepsDone(0);
    setPreviewLoading(false);
    setPublishing(false);
    setCopyCaptionDone(false);
    setImageRegenerateLoading(false);
  };

  const handleGeneratePreview = async () => {
    const t = title.trim();
    if (!t) {
      setError("Post title is required.");
      return;
    }
    setError(null);
    setSuccess(null);
    setDraft(null);
    setCopyCaptionDone(false);
    setPreviewLoading(true);
    setStepsDone(0);

    try {
      const res = await fetch("/api/social-automation/generate-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t,
          excerpt: excerpt.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        socialPostId?: string;
        shortTitle?: string;
        caption?: string;
        imageBase64?: string;
        backgroundPrompt?: string;
      };

      if (!res.ok || !data.success || !data.socialPostId) {
        setError(data.error ?? "Preview generation failed");
        return;
      }

      setStepsDone(2);
      setDraft({
        socialPostId: data.socialPostId,
        shortTitle: data.shortTitle ?? "",
        caption: data.caption ?? "",
        imageBase64: data.imageBase64 ?? "",
        backgroundPrompt: data.backgroundPrompt ?? "",
      });
      void fetchLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!draft?.socialPostId) return;
    setError(null);
    setPublishing(true);
    try {
      const res = await fetch("/api/social-automation/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ socialPostId: draft.socialPostId }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        shortTitle?: string;
        caption?: string;
        imageBase64?: string;
        permalink?: string | null;
      };

      if (!res.ok || !data.success) {
        setError(data.error ?? "Publish failed");
        void fetchLogs();
        return;
      }

      setDraft(null);
      setSuccess({
        shortTitle: data.shortTitle ?? "",
        caption: data.caption ?? "",
        imageBase64: data.imageBase64 ?? "",
        permalink: data.permalink ?? null,
      });
      void fetchLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      void fetchLogs();
    } finally {
      setPublishing(false);
    }
  };

  const handleCopyCaption = async () => {
    if (!draft?.caption) return;
    try {
      await navigator.clipboard.writeText(draft.caption);
      setCopyCaptionDone(true);
      window.setTimeout(() => setCopyCaptionDone(false), 2000);
    } catch {
      setError("Could not copy caption (clipboard permission).");
    }
  };

  const handleRegenerateImage = async (useFreshClaudePrompt: boolean) => {
    if (!draft?.socialPostId) return;
    setError(null);
    setImageRegenerateLoading(true);
    try {
      const trimmed = draft.backgroundPrompt.trim();
      const payload: { socialPostId: string; backgroundPrompt?: string } = {
        socialPostId: draft.socialPostId,
      };
      if (!useFreshClaudePrompt && trimmed.length > 0) {
        payload.backgroundPrompt = trimmed;
      }

      const res = await fetch("/api/social-automation/regenerate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        imageBase64?: string;
        backgroundPrompt?: string;
      };

      if (!res.ok || !data.success) {
        setError(data.error ?? "Image regeneration failed");
        void fetchLogs();
        return;
      }

      setDraft((prev) =>
        prev
          ? {
              ...prev,
              imageBase64: data.imageBase64 ?? prev.imageBase64,
              backgroundPrompt: data.backgroundPrompt ?? prev.backgroundPrompt,
            }
          : prev
      );
      void fetchLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      void fetchLogs();
    } finally {
      setImageRegenerateLoading(false);
    }
  };

  const handleRetry = async (socialPostId: string) => {
    setRetryingId(socialPostId);
    setError(null);
    try {
      const res = await fetch("/api/social-automation/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ socialPostId }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        shortTitle?: string;
        caption?: string;
        imageBase64?: string;
        permalink?: string | null;
      };

      if (!res.ok || !data.success) {
        setSuccess(null);
        setError(data.error ?? "Retry failed");
        void fetchLogs();
        return;
      }

      setDraft(null);
      setSuccess({
        shortTitle: data.shortTitle ?? "",
        caption: data.caption ?? "",
        imageBase64: data.imageBase64 ?? "",
        permalink: data.permalink ?? null,
      });
      void fetchLogs();
    } catch (err) {
      setSuccess(null);
      setError(err instanceof Error ? err.message : String(err));
      void fetchLogs();
    } finally {
      setRetryingId(null);
    }
  };

  const handleRefreshToken = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/social-automation/refresh-token", { method: "POST" });
      const data = (await res.json()) as {
        error?: string;
        expiresIn?: number;
        expiresAt?: string;
        message?: string;
      };
      if (!res.ok) {
        setRefreshError(data.error ?? "Token refresh failed");
        setTokenExpiryLabel(null);
        return;
      }
      const expiresAt = data.expiresAt;
      if (typeof expiresAt === "string" && expiresAt.length > 0) {
        const d = new Date(expiresAt);
        setTokenExpiryLabel(
          Number.isNaN(d.getTime()) ? expiresAt : d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })
        );
      } else if (typeof data.expiresIn === "number") {
        const d = new Date(Date.now() + data.expiresIn * 1000);
        setTokenExpiryLabel(d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }));
      } else {
        setTokenExpiryLabel(null);
      }
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : "Request failed");
      setTokenExpiryLabel(null);
    } finally {
      setRefreshing(false);
    }
  };

  const showPreviewProgress = previewLoading;
  const previewStepLit = (index: number) => index <= stepsDone;
  const downloadHref = draft?.imageBase64 ? `data:image/png;base64,${draft.imageBase64}` : "";
  const downloadName = `greenorg-instagram-${downloadSlug(title)}.png`;

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Create post</h2>
        <p className="mt-1 text-sm text-slate-600">
          Generate a caption and square graphic, review and download for manual posting, then publish to Instagram when
          you are ready.
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="sa-title" className="block text-sm font-medium text-slate-800">
              Post title <span className="text-red-600">*</span>
            </label>
            <input
              id="sa-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              disabled={previewLoading || publishing || imageRegenerateLoading}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:bg-slate-50"
              placeholder="e.g. How urban heat islands affect health"
            />
          </div>

          <div>
            <label htmlFor="sa-excerpt" className="block text-sm font-medium text-slate-800">
              Excerpt / summary <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <textarea
              id="sa-excerpt"
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              rows={3}
              disabled={previewLoading || publishing || imageRegenerateLoading}
              className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:bg-slate-50"
              placeholder="Optional context for caption generation"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleGeneratePreview()}
            disabled={previewLoading || publishing || imageRegenerateLoading}
            className="w-full rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {previewLoading ? "Generating preview…" : "Generate preview"}
          </button>
        </div>

        {showPreviewProgress ? (
          <div className="mt-6 rounded-lg border border-slate-100 bg-slate-50/80 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Progress</p>
            <ul className="mt-3 space-y-2">
              {PREVIEW_STEPS.map((label, i) => (
                <li
                  key={label}
                  className={`flex items-start gap-2 text-sm transition-colors ${
                    previewStepLit(i) ? "font-medium text-emerald-800" : "text-slate-400"
                  }`}
                >
                  <span className="select-none" aria-hidden>
                    ✦
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-900">Something went wrong</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-red-800">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="mt-4 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100"
            >
              Try Again
            </button>
          </div>
        ) : null}
      </section>

      {draft && !success ? (
        <section className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Preview — review before publishing</h2>
          <p className="mt-1 text-sm text-slate-600">
            Download the graphic and copy the caption to post manually on Instagram, or use Publish when you want this
            app to post via the API.
          </p>

          <div className="mt-5 rounded-lg border border-indigo-200/80 bg-white/80 p-4">
            <label htmlFor="sa-image-prompt" className="block text-sm font-medium text-slate-800">
              Background image prompt <span className="font-normal text-slate-500">(Gemini)</span>
            </label>
            <textarea
              id="sa-image-prompt"
              value={draft.backgroundPrompt}
              onChange={(e) => setDraft((prev) => (prev ? { ...prev, backgroundPrompt: e.target.value } : prev))}
              rows={5}
              disabled={imageRegenerateLoading || publishing}
              className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 disabled:bg-slate-50"
              placeholder="Photorealistic scene description…"
            />
            <p className="mt-1 text-xs text-slate-600">
              Tweak lighting, location, or mood. Regenerate image uses this text. Clear the box or use New prompt from
              Claude to ask for a fresh prompt from the post title, then run Regenerate image.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleRegenerateImage(false)}
                disabled={imageRegenerateLoading || publishing}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {imageRegenerateLoading ? "Regenerating…" : "Regenerate image"}
              </button>
              <button
                type="button"
                onClick={() => void handleRegenerateImage(true)}
                disabled={imageRegenerateLoading || publishing}
                className="rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                New prompt from Claude
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Graphic (1080×1080)</p>
              {draft.imageBase64 ? (
                <Image
                  src={`data:image/png;base64,${draft.imageBase64}`}
                  alt="Instagram graphic preview"
                  width={400}
                  height={400}
                  unoptimized
                  className="mt-2 h-auto max-w-full rounded-lg border border-slate-200 bg-white shadow"
                  style={{ width: 400, maxWidth: "100%", height: "auto" }}
                />
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={downloadHref}
                  download={downloadName}
                  className="inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                >
                  Download image
                </a>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Short title on graphic</p>
              <p className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
                {draft.shortTitle || "—"}
              </p>

              <div className="mt-4">
                <label className="text-xs font-medium uppercase tracking-wide text-slate-600">Caption</label>
                <div className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 whitespace-pre-wrap">
                  {draft.caption}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyCaption()}
                  className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  {copyCaptionDone ? "Copied!" : "Copy caption"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t border-indigo-200/60 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => void handlePublish()}
              disabled={publishing || imageRegenerateLoading}
              className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {publishing ? "Publishing…" : "Publish to Instagram"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setCopyCaptionDone(false);
                setImageRegenerateLoading(false);
              }}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Discard preview
            </button>
          </div>
        </section>
      ) : null}

      {success ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-6 shadow-sm">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span
                className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-2xl text-white"
                aria-hidden
              >
                ✓
              </span>
              <div>
                <h2 className="text-lg font-semibold text-emerald-950">Posted to Instagram!</h2>
                {success.permalink ? (
                  <a
                    href={success.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700"
                  >
                    View post
                  </a>
                ) : (
                  <p className="mt-1 text-sm text-emerald-900">Published — permalink not returned.</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={resetAll}
              className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-50"
            >
              Post another
            </button>
          </div>

          {success.imageBase64 ? (
            <div className="mt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Preview</p>
              <Image
                src={`data:image/png;base64,${success.imageBase64}`}
                alt="Generated Instagram graphic"
                width={400}
                height={400}
                unoptimized
                className="mt-2 h-auto max-w-full rounded-lg border border-slate-200 shadow"
                style={{ width: 400, maxWidth: "100%", height: "auto" }}
              />
            </div>
          ) : null}

          <div className="mt-6">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-600">Caption</label>
            <div className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 whitespace-pre-wrap">
              {success.caption}
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Activity log</h2>
            <p className="mt-1 text-sm text-slate-600">
              Recent posts (newest first). Retry re-generates the image and publishes again.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            <button
              type="button"
              onClick={() => void handleRefreshToken()}
              disabled={refreshing}
              className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? "Refreshing…" : "Refresh token"}
            </button>
            {tokenExpiryLabel ? (
              <p className="text-right text-xs text-emerald-800">
                New token expires: <span className="font-medium">{tokenExpiryLabel}</span>
              </p>
            ) : null}
            {refreshError ? <p className="text-right text-xs text-red-700">{refreshError}</p> : null}
          </div>
        </div>

        <p className="mt-3 text-xs text-amber-900/80">
          Long-lived tokens expire about every 60 days. After refresh, copy the new token from Vercel function logs and
          update <code className="rounded bg-amber-100 px-1">FACEBOOK_PAGE_ACCESS_TOKEN</code> in your environment.
        </p>

        {logsError ? <p className="mt-4 text-sm text-red-700">{logsError}</p> : null}

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Short title</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">View post</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {logsLoading && logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : null}
              {!logsLoading && logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    No rows yet. Publish a post to see history here.
                  </td>
                </tr>
              ) : null}
              {logs.map((row) => {
                const failed = (row.instagram_status ?? "").toLowerCase() === "failed";
                return (
                  <tr key={row.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{formatDate(row.created_at)}</td>
                    <td className="max-w-[220px] px-3 py-2 text-slate-900">
                      <span className="line-clamp-2" title={row.wp_post_title}>
                        {row.wp_post_title}
                      </span>
                    </td>
                    <td className="max-w-[160px] px-3 py-2 text-slate-700">
                      <span className="line-clamp-2" title={row.short_title ?? ""}>
                        {row.short_title?.trim() ? row.short_title : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${statusPillClass(
                          row.instagram_status
                        )}`}
                      >
                        {(row.instagram_status ?? "unknown").toLowerCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {row.instagram_permalink ? (
                        <a
                          href={row.instagram_permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:text-emerald-900"
                        >
                          View post
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {failed ? (
                        <button
                          type="button"
                          disabled={retryingId === row.id}
                          onClick={() => void handleRetry(row.id)}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {retryingId === row.id ? "Retrying…" : "Retry"}
                        </button>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void fetchLogs()}
            disabled={logsLoading}
            className="text-sm font-medium text-emerald-700 hover:text-emerald-900 disabled:opacity-50"
          >
            {logsLoading ? "Refreshing…" : "Reload log"}
          </button>
        </div>
      </section>
    </div>
  );
}
