"use client";

import { useCallback, useEffect, useState } from "react";
import { parseGenerateImagesResponse } from "@/lib/contentProduction/generateImagesResponse";
import { config } from "./config";

type Site = { id: string; name: string; url: string };

type GenerateResult = {
  title: string;
  content: string;
  keywords: string[];
  slug: string;
  suggestedPath: string;
  seo: { focusKeyword: string; metaTitle: string; metaDescription: string };
  strains: { a: string; b: string; strainAUrl: string | null; strainBUrl: string | null };
  verifiedInternalLinks?: { label: string; url: string; kind: string }[];
  linkWarnings?: string[];
};

type ImageItem = {
  type: "featured" | "in-content";
  index: number;
  prompt: string;
  base64: string;
  mimeType: string;
  altText?: string;
  fileSlug?: string;
  h2Index?: number;
  sectionHeading?: string;
};

type PublishResult = {
  postId: number;
  postUrl: string;
  editUrl: string;
  status: string;
  rankMath?: { metaDescriptionSet: boolean; focusKeyphrase: string };
};

const USE_CASES = ["", "sleep", "anxiety", "pain", "energy", "focus", "relaxation"];
const WORD_COUNT = 1350;

function imageDataUrl(img: ImageItem): string {
  return `data:${img.mimeType || "image/png"};base64,${img.base64}`;
}

function ImageWithRegenerate({
  img,
  idx,
  label,
  compact,
  panelOpen,
  busy,
  extraNotes,
  regenerateError,
  onTogglePanel,
  onRegenerate,
  onExtraNotesChange,
  onClosePanel,
}: {
  img: ImageItem;
  idx: number;
  label: string;
  compact?: boolean;
  panelOpen: boolean;
  busy: boolean;
  extraNotes: string;
  regenerateError: { index: number; message: string } | null;
  onTogglePanel: (idx: number) => void;
  onRegenerate: (idx: number, extraNotes?: string) => void;
  onExtraNotesChange: (value: string) => void;
  onClosePanel: () => void;
}) {
  return (
    <div className={compact ? "rounded-lg border border-slate-200 p-2" : "max-w-3xl space-y-2"}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div
        className={
          compact
            ? "aspect-video w-full overflow-hidden rounded bg-slate-100"
            : "relative aspect-video w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
        }
      >
        <img
          src={imageDataUrl(img)}
          alt={img.altText ?? label}
          className="h-full w-full object-cover"
        />
      </div>
      {(img.altText || img.fileSlug) && (
        <div className="space-y-0.5 text-xs text-slate-500">
          {img.fileSlug && (
            <p>
              <span className="font-medium text-slate-600">File:</span> {img.fileSlug}.jpg
            </p>
          )}
          {img.altText && (
            <p>
              <span className="font-medium text-slate-600">Alt:</span> {img.altText}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onTogglePanel(idx)}
          disabled={busy}
          className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60"
        >
          {panelOpen ? "Hide prompt" : "Regenerate…"}
        </button>
        <button
          type="button"
          onClick={() => onRegenerate(idx)}
          disabled={busy}
          className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
        >
          {busy ? "Regenerating…" : "Quick regenerate"}
        </button>
      </div>
      {panelOpen && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-2">
          <label htmlFor={`regen-notes-${idx}`} className="block text-xs font-medium text-slate-600">
            Optional prompt details
          </label>
          <textarea
            id={`regen-notes-${idx}`}
            rows={3}
            value={extraNotes}
            onChange={(e) => onExtraNotesChange(e.target.value)}
            placeholder="e.g. warmer light, more product close-up, softer background, no text in frame…"
            className="w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <p className="text-[11px] text-slate-500">
            Appended to the original image prompt. Leave blank to match the original prompt only.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onRegenerate(idx, extraNotes)}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? "Generating…" : "Generate with details"}
            </button>
            <button
              type="button"
              onClick={onClosePanel}
              className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
          {regenerateError?.index === idx && (
            <p className="text-xs text-red-600">{regenerateError.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function WeedComStrainComparisonTool() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState("");
  const [strainA, setStrainA] = useState("Blue Dream");
  const [strainB, setStrainB] = useState("Gelato");
  const [strainAUrl, setStrainAUrl] = useState("");
  const [strainBUrl, setStrainBUrl] = useState("");
  const [primaryUseCase, setPrimaryUseCase] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imagesError, setImagesError] = useState<string | null>(null);
  const [imagesWarnings, setImagesWarnings] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [images, setImages] = useState<ImageItem[] | null>(null);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [publishStep, setPublishStep] = useState<string | null>(null);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [regeneratePanelIndex, setRegeneratePanelIndex] = useState<number | null>(null);
  const [regenerateExtraNotes, setRegenerateExtraNotes] = useState("");
  const [regenerateError, setRegenerateError] = useState<{ index: number; message: string } | null>(null);

  const busy = contentLoading || imagesLoading || publishStep != null || regeneratingIndex != null;

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/weed-com-content-production/sites");
        const data = await res.json();
        if (res.ok && Array.isArray(data)) {
          setSites(data);
          const preferred = data.find((s: Site) => /alex username/i.test(s.name)) ?? data[0];
          if (preferred?.id) setSiteId(preferred.id);
        }
      } catch {
        setSites([]);
      }
    })();
  }, []);

  const generateImages = async (contentResult: GenerateResult) => {
    setImagesLoading(true);
    setImagesError(null);
    try {
      const res = await fetch("/api/weed-com-strain-comparison/generate-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          title: contentResult.title,
          keywords: contentResult.keywords,
          content: contentResult.content,
          wordCount: WORD_COUNT,
          maxInContentImages: 3,
          imageContext: `Strain comparison: ${contentResult.strains.a} vs ${contentResult.strains.b}.`,
        }),
      });
      const data = await res.json();
      const { images: imageList, warnings } = parseGenerateImagesResponse(data);
      if (!res.ok || imageList.length === 0) {
        setImagesError((data as { error?: string }).error ?? "Image generation failed");
        setImages(null);
        return;
      }
      if (warnings.length > 0) {
        setImagesWarnings(warnings.join(" "));
      }
      setImages(
        imageList.map(
          (img: {
            type?: string;
            index?: number;
            prompt?: string;
            base64?: string;
            mimeType?: string;
            altText?: string;
            fileSlug?: string;
            h2Index?: number;
            sectionHeading?: string;
          }) => ({
            type: img.type === "featured" ? "featured" : "in-content",
            index: img.index ?? 0,
            prompt: img.prompt ?? "",
            base64: img.base64 ?? "",
            mimeType: img.mimeType ?? "image/png",
            altText: img.altText,
            fileSlug: img.fileSlug,
            h2Index: img.h2Index,
            sectionHeading: img.sectionHeading,
          })
        )
      );
    } catch (e) {
      setImagesError(e instanceof Error ? e.message : "Image generation failed");
      setImages(null);
    } finally {
      setImagesLoading(false);
    }
  };

  const generate = async () => {
    if (!siteId || !strainA.trim() || !strainB.trim()) return;
    setContentLoading(true);
    setImagesLoading(false);
    setError(null);
    setImagesError(null);
    setPublishResult(null);
    setImages(null);
    setRegeneratePanelIndex(null);
    setRegenerateExtraNotes("");
    setRegenerateError(null);
    let contentOk = false;
    try {
      const res = await fetch("/api/weed-com-strain-comparison/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          strainA: strainA.trim(),
          strainB: strainB.trim(),
          ...(strainAUrl.trim() ? { strainAUrl: strainAUrl.trim() } : {}),
          ...(strainBUrl.trim() ? { strainBUrl: strainBUrl.trim() } : {}),
          ...(primaryUseCase ? { primaryUseCase } : {}),
        }),
      });
      const data = (await res.json()) as GenerateResult & { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Generate failed (${res.status})`);
        return;
      }
      setResult(data);
      contentOk = true;
      setContentLoading(false);
      await generateImages(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generate failed");
    } finally {
      if (!contentOk) setContentLoading(false);
    }
  };

  const publish = async () => {
    if (!result || !siteId || !images?.length) return;
    setPublishStep("Starting…");
    setError(null);
    try {
      const uploadedRefs: Array<{
        type: "featured" | "in-content";
        index: number;
        mediaId: number;
        url: string;
        altText?: string;
        fileSlug?: string;
        h2Index?: number;
      }> = [];

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        setPublishStep(`Uploading image ${i + 1} of ${images.length} to WordPress…`);
        const upRes = await fetch("/api/weed-com-strain-comparison/publish/upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteId,
            type: img.type,
            index: img.index,
            base64: img.base64,
            mimeType: img.mimeType,
            altText: img.altText,
            fileSlug: img.fileSlug,
            title: result.title,
          }),
        });
        const upData = (await upRes.json()) as { id?: number; url?: string; error?: string };
        if (!upRes.ok || typeof upData.id !== "number" || typeof upData.url !== "string") {
          setError(upData.error ?? `Image upload failed (${upRes.status})`);
          return;
        }
        uploadedRefs.push({
          type: img.type,
          index: img.index,
          mediaId: upData.id,
          url: upData.url,
          altText: img.altText,
          fileSlug: img.fileSlug,
          h2Index: img.h2Index,
        });
      }

      setPublishStep("Creating WordPress draft…");
      const res = await fetch("/api/weed-com-strain-comparison/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          title: result.title,
          strainA: result.strains.a,
          strainB: result.strains.b,
          content: result.content,
          keywords: result.keywords,
          images: uploadedRefs,
          slug: result.slug,
          rankMath: {
            focuskw: result.seo.focusKeyword,
            seoTitle: result.seo.metaTitle,
            metadesc: result.seo.metaDescription,
          },
        }),
      });
      const data = (await res.json()) as PublishResult & { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Publish failed (${res.status})`);
        return;
      }
      setPublishResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setPublishStep(null);
    }
  };

  const handleRegenerateImage = useCallback(
    async (idx: number, extraNotes?: string) => {
      const img = images?.[idx];
      if (!img?.prompt) return;
      setRegeneratingIndex(idx);
      setRegenerateError(null);
      try {
        const trimmed = typeof extraNotes === "string" ? extraNotes.trim() : "";
        const prompt = trimmed ? `${img.prompt}\n\nAdditional direction: ${trimmed}` : img.prompt;
        const res = await fetch("/api/weed-com-strain-comparison/generate-images/single", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, siteId }),
        });
        const data = (await res.json().catch(() => ({}))) as { base64?: string; mimeType?: string; error?: string };
        if (res.ok && data.base64) {
          const mime = data.mimeType ?? "image/png";
          setImages((prev) => {
            if (!prev) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], base64: data.base64!, mimeType: mime };
            return next;
          });
          setRegeneratePanelIndex(null);
          setRegenerateExtraNotes("");
        } else {
          setRegenerateError({ index: idx, message: data.error ?? "Image generation failed" });
        }
      } catch (e) {
        setRegenerateError({
          index: idx,
          message: e instanceof Error ? e.message : "Network error",
        });
      } finally {
        setRegeneratingIndex(null);
      }
    },
    [images, siteId]
  );

  const toggleRegeneratePanel = useCallback((idx: number) => {
    setRegeneratePanelIndex((prev) => {
      if (prev === idx) {
        setRegenerateExtraNotes("");
        return null;
      }
      return idx;
    });
    setRegenerateError(null);
  }, []);

  const featuredImage = images?.find((i) => i.type === "featured");
  const inContentImages = images?.filter((i) => i.type === "in-content") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{config.name}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{config.description}</p>
        <p className="mt-2 text-xs text-slate-500">
          URL format: <code className="rounded bg-slate-100 px-1">/learn/[strain-a]-vs-[strain-b]/</code> · Only
          verified internal links (no guessed or 404 URLs)
        </p>
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
          <p className="mt-1 text-xs text-amber-700">Use <strong>weed.com ALEX username</strong> for working credentials.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Strain A</label>
            <input
              value={strainA}
              onChange={(e) => setStrainA(e.target.value)}
              placeholder="Blue Dream"
              className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Strain B</label>
            <input
              value={strainB}
              onChange={(e) => setStrainB(e.target.value)}
              placeholder="Gelato"
              className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Strain A URL (optional)</label>
            <input
              value={strainAUrl}
              onChange={(e) => setStrainAUrl(e.target.value)}
            placeholder="https://weed.com/strains/blue-dream-strain/"
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm font-mono"
          />
          <p className="mt-1 text-xs text-slate-500">Optional — verified before linking; guessed URLs are not used.</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Strain B URL (optional)</label>
          <input
            value={strainBUrl}
            onChange={(e) => setStrainBUrl(e.target.value)}
            placeholder="https://weed.com/strains/gelato-strain/"
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm font-mono"
          />
          <p className="mt-1 text-xs text-slate-500">Optional — verified before linking; guessed URLs are not used.</p>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Primary use case (optional)</label>
          <select
            value={primaryUseCase}
            onChange={(e) => setPrimaryUseCase(e.target.value)}
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Auto-pick best use case</option>
            {USE_CASES.filter(Boolean).map((u) => (
              <option key={u} value={u}>
                {u.charAt(0).toUpperCase() + u.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy || !siteId || !strainA.trim() || !strainB.trim()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {contentLoading
            ? "Generating article…"
            : imagesLoading
              ? "Generating images…"
              : result
                ? "Regenerate"
                : "Generate comparison + images"}
        </button>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
      </div>

      {result && (
        <div className="max-w-4xl space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div>
            <h2 className="text-sm font-medium text-slate-700">Generated draft</h2>
            <p className="mt-1 text-sm font-medium text-slate-900">{result.title}</p>
            <p className="text-xs text-slate-500">
              Path: {result.suggestedPath} · Slug: <code>{result.slug}</code>
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded border border-slate-100 bg-slate-50 p-3 text-xs">
              <p className="font-semibold text-slate-500">Focus keyword</p>
              <p className="mt-1 text-slate-800">{result.seo.focusKeyword}</p>
            </div>
            <div className="rounded border border-slate-100 bg-slate-50 p-3 text-xs sm:col-span-2">
              <p className="font-semibold text-slate-500">Meta title</p>
              <p className="mt-1 text-slate-800">{result.seo.metaTitle}</p>
            </div>
            <div className="rounded border border-slate-100 bg-slate-50 p-3 text-xs sm:col-span-3">
              <p className="font-semibold text-slate-500">Meta description</p>
              <p className="mt-1 text-slate-800">{result.seo.metaDescription}</p>
            </div>
          </div>

          {(result.linkWarnings?.length ?? 0) > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-medium">Link checks</p>
              <ul className="mt-1 list-inside list-disc">
                {result.linkWarnings!.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {result.verifiedInternalLinks && result.verifiedInternalLinks.length > 0 ? (
            <div className="rounded border border-emerald-100 bg-emerald-50/50 p-3">
              <h2 className="text-sm font-medium text-emerald-900">
                Verified internal links ({result.verifiedInternalLinks.length})
              </h2>
              <ul className="mt-2 space-y-1 text-xs text-slate-700">
                {result.verifiedInternalLinks.map((l) => (
                  <li key={l.url}>
                    <span className="text-slate-500">[{l.kind}]</span> {l.label} —{" "}
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">
                      {l.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              No weed.com internal links verified for this draft — the article uses plain text only (no broken links).
            </p>
          )}

          <div className="max-h-96 overflow-auto rounded border border-slate-100 bg-slate-50 p-3">
            <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: result.content }} />
          </div>

          <div>
            <h2 className="text-sm font-medium text-slate-700">Images (featured + in-content)</h2>
            <p className="mt-1 text-xs text-slate-500">
              1 featured image and up to 3 in-content images — uploaded to WordPress on publish.
            </p>
            {imagesLoading && (
              <p className="mt-2 text-sm text-slate-600">Generating images with Gemini…</p>
            )}
            {imagesWarnings && (
              <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                {imagesWarnings}
              </p>
            )}
            {imagesError && (
              <div className="mt-2 space-y-2">
                <p className="text-sm text-red-700">{imagesError}</p>
                <button
                  type="button"
                  onClick={() => void generateImages(result)}
                  disabled={imagesLoading}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Retry images
                </button>
              </div>
            )}
            {featuredImage && images && (
              <div className="mt-3">
                <ImageWithRegenerate
                  img={featuredImage}
                  idx={images.indexOf(featuredImage)}
                  label="Featured image"
                  panelOpen={regeneratePanelIndex === images.indexOf(featuredImage)}
                  busy={regeneratingIndex === images.indexOf(featuredImage)}
                  extraNotes={regenerateExtraNotes}
                  regenerateError={regenerateError}
                  onTogglePanel={toggleRegeneratePanel}
                  onRegenerate={handleRegenerateImage}
                  onExtraNotesChange={setRegenerateExtraNotes}
                  onClosePanel={() => setRegeneratePanelIndex(null)}
                />
              </div>
            )}
            {inContentImages.length > 0 && images && (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {inContentImages.map((img) => {
                  const idx = images.indexOf(img);
                  return (
                    <ImageWithRegenerate
                      key={`ic-${img.index}`}
                      img={img}
                      idx={idx}
                      compact
                      label={`In-content · ${img.sectionHeading ?? `section ${img.h2Index ?? img.index}`}`}
                      panelOpen={regeneratePanelIndex === idx}
                      busy={regeneratingIndex === idx}
                      extraNotes={regenerateExtraNotes}
                      regenerateError={regenerateError}
                      onTogglePanel={toggleRegeneratePanel}
                      onRegenerate={handleRegenerateImage}
                      onExtraNotesChange={setRegenerateExtraNotes}
                      onClosePanel={() => setRegeneratePanelIndex(null)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void publish()}
            disabled={busy || !images?.length}
            className="rounded-lg border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
          >
            {publishStep ?? "Publish draft + images to WordPress"}
          </button>
          {!images?.length && result && !imagesLoading && (
            <p className="text-xs text-amber-700">Generate or retry images before publishing.</p>
          )}

          {publishResult && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Draft published (ID {publishResult.postId}).{" "}
              <a href={publishResult.editUrl} target="_blank" rel="noopener noreferrer" className="underline">
                Edit in wp-admin
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
