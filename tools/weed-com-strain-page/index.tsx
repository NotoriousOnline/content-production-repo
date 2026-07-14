"use client";

import { useCallback, useEffect, useState } from "react";
import { parseGenerateImagesResponse } from "@/lib/contentProduction/generateImagesResponse";
import type { StrainPageCustomFields } from "@/lib/contentProduction/strainPage";
import {
  AiDetectionScoreBanner,
  detectInfoFromCodeGuards,
  type AiDetectionScoreInfo,
} from "@/components/AiDetectionScoreBanner";
import { config } from "./config";

type Site = { id: string; name: string; url: string };

const REST_COLLECTION_OPTIONS = ["strains", "strain", "posts", "pages"] as const;

type GenerateResult = {
  title: string;
  content: string;
  keywords: string[];
  slug: string;
  suggestedPath: string;
  customFields: StrainPageCustomFields;
  seo: { focusKeyword: string; metaTitle: string; metaDescription: string };
  strain: { name: string; strainUrl: string | null };
  verifiedInternalLinks?: { label: string; url: string; kind: string }[];
  linkWarnings?: string[];
  codeGuards?: unknown;
  aiDetection?: AiDetectionScoreInfo | null;
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
  customFieldsSet?: boolean;
  author?: { id: number; slug: string } | { warning: string };
  publishDateRefreshed?: boolean;
};

const WORD_COUNT = 700;
type WorkflowMode = "new" | "update";

function imageDataUrl(img: ImageItem): string {
  return `data:${img.mimeType || "image/png"};base64,${img.base64}`;
}

function ImageWithRegenerate({
  img,
  idx,
  label,
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
    <div className="max-w-md space-y-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div className="relative aspect-square w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
        <img src={imageDataUrl(img)} alt={img.altText ?? label} className="h-full w-full object-cover" />
      </div>
      {(img.altText || img.fileSlug) && (
        <div className="space-y-0.5 text-xs text-slate-500">
          {img.fileSlug && (
            <p>
              <span className="font-medium text-slate-600">File:</span> {img.fileSlug}.webp
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
          <textarea
            rows={3}
            value={extraNotes}
            onChange={(e) => onExtraNotesChange(e.target.value)}
            placeholder="Optional prompt details…"
            className="w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onRegenerate(idx, extraNotes)}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Generate with details
            </button>
            <button type="button" onClick={onClosePanel} className="rounded border border-slate-200 px-2 py-1 text-xs">
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

function CustomFieldsSummary({ fields }: { fields: StrainPageCustomFields }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 text-xs">
      <div className="rounded border border-slate-100 bg-slate-50 p-2">
        <p className="font-semibold text-slate-500">Type / cannabinoids</p>
        <p className="mt-1 text-slate-800">
          {fields.strainType} · THC {fields.thcRange} · CBD {fields.cbdRange}
          {fields.thcaPercent ? ` · THCA ${fields.thcaPercent}` : ""}
        </p>
      </div>
      <div className="rounded border border-slate-100 bg-slate-50 p-2">
        <p className="font-semibold text-slate-500">Terpenes</p>
        <p className="mt-1 text-slate-800">
          {fields.terpene1}, {fields.terpene2}, {fields.terpene3}
        </p>
      </div>
      <div className="rounded border border-slate-100 bg-slate-50 p-2">
        <p className="font-semibold text-slate-500">Effects</p>
        <p className="mt-1 text-slate-800">{fields.primaryEffects.join(", ")}</p>
        <p className="mt-0.5 text-slate-600">− {fields.negativeEffects.join(", ")}</p>
      </div>
      <div className="rounded border border-slate-100 bg-slate-50 p-2">
        <p className="font-semibold text-slate-500">Flavours / help with</p>
        <p className="mt-1 text-slate-800">{fields.flavours.join(", ")}</p>
        <p className="mt-0.5 text-slate-600">Help: {fields.helpWith.join(", ")}</p>
      </div>
    </div>
  );
}

export default function WeedComStrainPageTool() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState("");
  const [strainName, setStrainName] = useState("");
  const [strainUrl, setStrainUrl] = useState("");
  const [lineageNotes, setLineageNotes] = useState("");
  const [postId, setPostId] = useState<number | "">("");
  const [restCollection, setRestCollection] = useState("strains");
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("new");
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
  const isNewStrain = workflowMode === "new";
  const isUpdateMode = workflowMode === "update";
  const updateReady =
    isUpdateMode &&
    strainName.trim().length > 0 &&
    strainUrl.trim().length > 0 &&
    typeof postId === "number" &&
    postId > 0;

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

  useEffect(() => {
    if (!siteId) return;
    setWorkflowMode("new");
    setStrainName("");
    setStrainUrl("");
    setPostId("");
    setRestCollection("strains");
    setLineageNotes("");
    setResult(null);
    setImages(null);
    setPublishResult(null);
  }, [siteId]);

  const resetGeneratedOutput = () => {
    setResult(null);
    setImages(null);
    setPublishResult(null);
    setImagesError(null);
    setRegeneratePanelIndex(null);
    setRegenerateExtraNotes("");
    setRegenerateError(null);
  };

  const switchToNewMode = () => {
    setWorkflowMode("new");
    setStrainName("");
    setStrainUrl("");
    setPostId("");
    setRestCollection("strains");
    setLineageNotes("");
    resetGeneratedOutput();
    setError(null);
  };

  const switchToUpdateMode = () => {
    setWorkflowMode("update");
    setStrainName("");
    setStrainUrl("");
    setPostId("");
    setRestCollection("strains");
    setLineageNotes("");
    resetGeneratedOutput();
    setError(null);
  };

  const startNewStrain = () => {
    switchToNewMode();
  };

  const startUpdateAnother = () => {
    switchToUpdateMode();
  };

  const generateImages = async (contentResult: GenerateResult) => {
    setImagesLoading(true);
    setImagesError(null);
    try {
      const res = await fetch("/api/weed-com-strain-page/generate-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          title: contentResult.title,
          keywords: contentResult.keywords,
          content: contentResult.content,
          wordCount: WORD_COUNT,
          maxInContentImages: 1,
          imageContext: `Strain page: ${contentResult.strain.name}. Terpenes: ${contentResult.customFields.terpene1}, ${contentResult.customFields.terpene2}, ${contentResult.customFields.terpene3}.`,
        }),
      });
      const data = await res.json();
      const { images: imageList, warnings } = parseGenerateImagesResponse(data);
      if (!res.ok || imageList.length === 0) {
        setImagesError((data as { error?: string }).error ?? "Image generation failed");
        setImages(null);
        return;
      }
      if (warnings.length > 0) setImagesWarnings(warnings.join(" "));
      setImages(
        imageList.map((img) => ({
          type: img.type === "featured" ? "featured" : "in-content",
          index: img.index ?? 0,
          prompt: img.prompt ?? "",
          base64: img.base64 ?? "",
          mimeType: img.mimeType ?? "image/webp",
          altText: img.altText,
          fileSlug: img.fileSlug,
          h2Index: img.h2Index,
          sectionHeading: img.sectionHeading,
        }))
      );
    } catch (e) {
      setImagesError(e instanceof Error ? e.message : "Image generation failed");
      setImages(null);
    } finally {
      setImagesLoading(false);
    }
  };

  const generate = async () => {
    if (!siteId || !strainName.trim()) return;
    setContentLoading(true);
    setError(null);
    setImagesError(null);
    setPublishResult(null);
    setImages(null);
    let contentOk = false;
    try {
      const res = await fetch("/api/weed-com-strain-page/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          strainName: strainName.trim(),
          ...(strainUrl.trim() ? { strainUrl: strainUrl.trim() } : {}),
          ...(lineageNotes.trim() ? { lineageNotes: lineageNotes.trim() } : {}),
        }),
      });
      const data = (await res.json()) as GenerateResult & { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Generate failed (${res.status})`);
        return;
      }
      setResult({
        ...data,
        aiDetection: detectInfoFromCodeGuards(data.codeGuards),
      });
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
        setPublishStep(`Uploading image ${i + 1} of ${images.length}…`);
        const upRes = await fetch("/api/weed-com-strain-page/publish/upload-image", {
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

      setPublishStep("Publishing strain draft…");
      const res = await fetch("/api/weed-com-strain-page/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          title: result.title,
          strainName: result.strain.name,
          content: result.content,
          keywords: result.keywords,
          customFields: result.customFields,
          images: uploadedRefs,
          slug: result.slug,
          ...(!isNewStrain && postId ? { postId, restCollection } : {}),
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
      if (data.postId) {
        setPostId(data.postId);
        if (data.postUrl) setStrainUrl(data.postUrl);
        if (isNewStrain) setWorkflowMode("update");
      }
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
        const res = await fetch("/api/weed-com-strain-page/generate-images/single", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, siteId }),
        });
        const data = (await res.json().catch(() => ({}))) as { base64?: string; mimeType?: string; error?: string };
        if (res.ok && data.base64) {
          setImages((prev) => {
            if (!prev) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], base64: data.base64!, mimeType: data.mimeType ?? "image/webp" };
            return next;
          });
          setRegeneratePanelIndex(null);
          setRegenerateExtraNotes("");
        } else {
          setRegenerateError({ index: idx, message: data.error ?? "Image generation failed" });
        }
      } catch (e) {
        setRegenerateError({ index: idx, message: e instanceof Error ? e.message : "Network error" });
      } finally {
        setRegeneratingIndex(null);
      }
    },
    [images, siteId]
  );

  const featuredImage = images?.find((i) => i.type === "featured");
  const terpeneImage = images?.find((i) => i.type === "in-content");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{config.name}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{config.description}</p>
        <p className="mt-2 text-xs text-slate-500">
          URL format: <code className="rounded bg-slate-100 px-1">/strains/[strain-slug]/</code> · 600–800 words · No
          em-dashes · No Dr. Tabibi byline
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
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
          <p className="mb-2 text-xs font-medium text-slate-600">Workflow</p>
          <div className="flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
              <input
                type="radio"
                name="strain-workflow"
                checked={isNewStrain}
                onChange={() => switchToNewMode()}
                className="text-emerald-600"
              />
              Create new strain page
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
              <input
                type="radio"
                name="strain-workflow"
                checked={isUpdateMode}
                onChange={() => switchToUpdateMode()}
                className="text-emerald-600"
              />
              Update existing strain page
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {isNewStrain
              ? "For strains not on weed.com yet — creates a new /strains/[slug]/ draft."
              : "Enter the strain name, live page URL, and WordPress post ID — then regenerate and push to that post (status unchanged)."}
          </p>
        </div>

        {isNewStrain ? (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">New strain name</label>
            <input
              value={strainName}
              onChange={(e) => {
                setStrainName(e.target.value);
                resetGeneratedOutput();
              }}
              placeholder="e.g. Permanent Marker"
              className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/40 p-3">
            <p className="text-xs font-medium text-sky-900">Existing strain to update</p>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Strain name</label>
              <input
                value={strainName}
                onChange={(e) => {
                  setStrainName(e.target.value);
                  resetGeneratedOutput();
                }}
                placeholder="e.g. Blue Dream"
                className="w-full rounded border border-sky-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Page URL</label>
              <input
                value={strainUrl}
                onChange={(e) => {
                  setStrainUrl(e.target.value);
                  resetGeneratedOutput();
                }}
                placeholder="https://weed.com/strains/blue-dream/"
                className="w-full rounded border border-sky-200 bg-white px-3 py-2 text-sm font-mono"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">WordPress post ID</label>
                <input
                  value={postId}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setPostId(raw && /^\d+$/.test(raw) ? parseInt(raw, 10) : "");
                    resetGeneratedOutput();
                  }}
                  placeholder="e.g. 12345"
                  className="w-full rounded border border-sky-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">REST collection</label>
                <select
                  value={restCollection}
                  onChange={(e) => {
                    setRestCollection(e.target.value);
                    resetGeneratedOutput();
                  }}
                  className="w-full rounded border border-sky-200 bg-white px-3 py-2 text-sm"
                >
                  {REST_COLLECTION_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Lineage / breeder notes (optional)</label>
          <textarea
            value={lineageNotes}
            onChange={(e) => setLineageNotes(e.target.value)}
            rows={2}
            placeholder="e.g. Blueberry x Haze, Cookie Fam Genetics"
            className="w-full resize-y rounded border border-slate-200 px-3 py-2 text-sm"
          />
        </div>

        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy || !siteId || !strainName.trim() || (isUpdateMode && !updateReady)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {contentLoading
            ? "Generating content…"
            : imagesLoading
              ? "Generating images…"
              : isNewStrain
                ? "Generate new strain page + images"
                : "Regenerate strain page + images"}
        </button>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
      </div>

      {result && (
        <div className="max-w-4xl space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          {isUpdateMode && postId ? (
            <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
              Updating existing strain page <span className="font-mono">#{postId}</span>
              {strainUrl ? (
                <>
                  {" "}
                  ·{" "}
                  <a href={strainUrl} target="_blank" rel="noopener noreferrer" className="underline">
                    View live page
                  </a>
                </>
              ) : null}
            </div>
          ) : null}
          <div>
            <h2 className="text-sm font-medium text-slate-700">Generated draft</h2>
            <p className="mt-1 text-sm font-medium text-slate-900">{result.title}</p>
            <p className="text-xs text-slate-500">
              Path: {result.suggestedPath} · Slug: <code>{result.slug}</code>
            </p>
          </div>

          <AiDetectionScoreBanner detect={result.aiDetection} />

          <CustomFieldsSummary fields={result.customFields} />

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
              <ul className="list-inside list-disc">
                {result.linkWarnings!.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="max-h-96 overflow-auto rounded border border-slate-100 bg-slate-50 p-3">
            <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: result.content }} />
          </div>

          <div>
            <h2 className="text-sm font-medium text-slate-700">Images (hero + terpene graphic)</h2>
            {imagesLoading && <p className="mt-2 text-sm text-slate-600">Generating images…</p>}
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
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs"
                >
                  Retry images
                </button>
              </div>
            )}
            {images && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {featuredImage && (
                  <ImageWithRegenerate
                    img={featuredImage}
                    idx={images.indexOf(featuredImage)}
                    label="Hero bud photo (600×600)"
                    panelOpen={regeneratePanelIndex === images.indexOf(featuredImage)}
                    busy={regeneratingIndex === images.indexOf(featuredImage)}
                    extraNotes={regenerateExtraNotes}
                    regenerateError={regenerateError}
                    onTogglePanel={(idx) => {
                      setRegeneratePanelIndex((p) => (p === idx ? null : idx));
                      setRegenerateError(null);
                    }}
                    onRegenerate={handleRegenerateImage}
                    onExtraNotesChange={setRegenerateExtraNotes}
                    onClosePanel={() => setRegeneratePanelIndex(null)}
                  />
                )}
                {terpeneImage && (
                  <ImageWithRegenerate
                    img={terpeneImage}
                    idx={images.indexOf(terpeneImage)}
                    label="Terpene graphic"
                    panelOpen={regeneratePanelIndex === images.indexOf(terpeneImage)}
                    busy={regeneratingIndex === images.indexOf(terpeneImage)}
                    extraNotes={regenerateExtraNotes}
                    regenerateError={regenerateError}
                    onTogglePanel={(idx) => {
                      setRegeneratePanelIndex((p) => (p === idx ? null : idx));
                      setRegenerateError(null);
                    }}
                    onRegenerate={handleRegenerateImage}
                    onExtraNotesChange={setRegenerateExtraNotes}
                    onClosePanel={() => setRegeneratePanelIndex(null)}
                  />
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void publish()}
            disabled={busy || !images?.length}
            className="rounded-lg border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
          >
            {publishStep ?? (isNewStrain ? "Publish new strain draft" : "Update strain on WordPress (keeps live/draft status)")}
          </button>

          {publishResult && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Draft {publishResult.postId ? `saved (ID ${publishResult.postId})` : "published"}.
              {publishResult.customFieldsSet && " Custom fields written."}
              {publishResult.author && "id" in publishResult.author
                ? ` Author: Editorial Team (#${publishResult.author.id}).`
                : publishResult.author?.warning
                  ? ` ${publishResult.author.warning}.`
                  : ""}
              {publishResult.publishDateRefreshed && " Publish date refreshed."}{" "}
              <a href={publishResult.editUrl} target="_blank" rel="noopener noreferrer" className="underline">
                Edit in wp-admin
              </a>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={startNewStrain}
                  className="rounded-lg border border-emerald-400 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                >
                  Start new strain
                </button>
                <button
                  type="button"
                  onClick={startUpdateAnother}
                  className="rounded-lg border border-sky-400 bg-white px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100"
                >
                  Update another strain
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
