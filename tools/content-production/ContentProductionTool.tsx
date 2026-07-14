"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ToolConfig } from "@/lib/toolRegistry";
import {
  buildEditorialBriefFromRow,
  targetKeywordToKeywords,
  type ArticleSheetRow,
} from "@/lib/articleSheetCalendar";
import { parseGenerateImagesResponse } from "@/lib/contentProduction/generateImagesResponse";

type ImageItem = {
  type: "featured" | "in-content";
  index: number;
  prompt: string;
  base64: string;
  mimeType: string;
  included: boolean;
  altText?: string;
  fileSlug?: string;
  h2Index?: number;
  sectionHeading?: string;
};

type InternalLink = { title: string; url: string };

type Site = {
  id: string;
  name: string;
  url: string;
  username: string;
  app_password: string;
  tone_prompt?: string;
};

export function ContentProductionTool({
  config: _toolConfig,
  apiPrefix = "/api/content-production",
  showReferenceUrl = true,
  articleSheetFromGoogle = false,
  manualBriefFields = false,
  showExpertInsightCountSelector = false,
  cmsName = "WordPress",
  siteFields = "wordpress",
  showLinkSync = true,
}: {
  config: ToolConfig;
  /** Separate API namespace per product (e.g. Weed.com uses `/api/weed-com-content-production`). */
  apiPrefix?: string;
  /** When false, hide reference URL field and never append it on publish (e.g. Weed.com calendar workflow). */
  showReferenceUrl?: boolean;
  /** Weed.com: load article rows from Google Sheet API (`GET .../article-sheet`). */
  articleSheetFromGoogle?: boolean;
  /** Weed.com: manual Title, target keyword(s), product type for links, content angle (sheet paused). */
  manualBriefFields?: boolean;
  /** Weed.com: choose exactly how many Expert Insight boxes to generate. */
  showExpertInsightCountSelector?: boolean;
  /** CMS label used in publish / site-manager copy (e.g. WordPress or Shopify). */
  cmsName?: string;
  /** Site credential form layout. Shopify maps username→Blog ID, app_password→Admin API token. */
  siteFields?: "wordpress" | "shopify";
  /** When false, hide WordPress internal/product link sync controls. */
  showLinkSync?: boolean;
}) {
  const api = apiPrefix.replace(/\/$/, "");
  const isShopify = siteFields === "shopify";
  const [selectedSite, setSelectedSite] = useState<{ id: string; name: string; url: string } | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTonePrompt, setEditTonePrompt] = useState("");
  const [addForm, setAddForm] = useState({
    name: "",
    url: "",
    username: "",
    app_password: "",
    tone_prompt: "",
  });
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const [addSuccess, setAddSuccess] = useState(false);
  const [linkSyncBusy, setLinkSyncBusy] = useState<{ siteId: string; kind: "posts" | "products" } | null>(
    null
  );
  const [linkSyncNotice, setLinkSyncNotice] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordExtractLoading, setKeywordExtractLoading] = useState(false);
  const [keywordExtractError, setKeywordExtractError] = useState<string | null>(null);
  const [keywordExtractInfo, setKeywordExtractInfo] = useState<string | null>(null);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [editorialBrief, setEditorialBrief] = useState("");
  const [sheetRows, setSheetRows] = useState<ArticleSheetRow[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sheetLoadedLabel, setSheetLoadedLabel] = useState<string | null>(null);
  const [contentAngle, setContentAngle] = useState("");
  const [productTypeForLinks, setProductTypeForLinks] = useState("");
  const [expertInsightCount, setExpertInsightCount] = useState<1 | 2 | 3>(3);
  const [faqCount, setFaqCount] = useState<3 | 4 | 5>(5);
  const [includeImportantNotice, setIncludeImportantNotice] = useState(false);
  const [wordCount, setWordCount] = useState(1500);
  const [generating, setGenerating] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<ImageItem[] | null>(null);
  const [internalLinksUsed, setInternalLinksUsed] = useState<InternalLink[]>([]);
  const [contentRefinementInstructions, setContentRefinementInstructions] = useState("");
  const [contentRefining, setContentRefining] = useState(false);
  const [contentRefineError, setContentRefineError] = useState<string | null>(null);
  const [contentApproved, setContentApproved] = useState(false);
  const [imagesApproved, setImagesApproved] = useState(false);
  const [approvedContent, setApprovedContent] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishStep, setPublishStep] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<{
    postId: number | string;
    postUrl: string;
    editUrl: string;
    site: { name: string; url: string };
    rankMath?: { focusKeyphrase?: string; metaDescriptionSet?: boolean };
    yoast?: { focusKeyphrase?: string; metaDescriptionSet?: boolean };
    /** True when the last operation was an update to an existing draft, not a new post. */
    updated?: boolean;
  } | null>(null);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [regeneratePanelIndex, setRegeneratePanelIndex] = useState<number | null>(null);
  const [regenerateExtraNotes, setRegenerateExtraNotes] = useState("");
  const [regenerateError, setRegenerateError] = useState<{ index: number; message: string } | null>(null);
  const [imagesError, setImagesError] = useState<string | null>(null);
  const [contentGenerateError, setContentGenerateError] = useState<string | null>(null);
  const contentEditableRef = useRef<HTMLDivElement>(null);
  const publishCancelledRef = useRef(false);
  const publishAbortRef = useRef<AbortController | null>(null);

  const siteUnlocked = !!selectedSite;
  const contentWordCount = approvedContent
    ? approvedContent.split(/\s+/).filter(Boolean).length
    : generatedContent
      ? generatedContent.split(/\s+/).filter(Boolean).length
      : 0;

  const fetchSites = async () => {
    setSitesLoading(true);
    try {
      const res = await fetch(`${api}/sites`);
      const data = await res.json();
      if (res.ok) setSites(Array.isArray(data) ? data : []);
      else setSites([]);
    } catch {
      setSites([]);
    } finally {
      setSitesLoading(false);
    }
  };

  useEffect(() => {
    fetchSites();
  }, []);

  useEffect(() => {
    setRegenerateExtraNotes("");
  }, [regeneratePanelIndex]);

  const fetchArticleSheetRows = useCallback(async () => {
    if (!articleSheetFromGoogle) return;
    setSheetError(null);
    setSheetLoading(true);
    try {
      const res = await fetch(`${api}/article-sheet`);
      const data = (await res.json().catch(() => ({}))) as { rows?: ArticleSheetRow[]; error?: string };
      if (!res.ok) {
        setSheetError(data.error ?? "Failed to load sheet");
        setSheetRows([]);
        return;
      }
      setSheetRows(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      setSheetError("Network error loading sheet");
      setSheetRows([]);
    } finally {
      setSheetLoading(false);
    }
  }, [api, articleSheetFromGoogle]);

  useEffect(() => {
    if (!articleSheetFromGoogle || !selectedSite) return;
    void fetchArticleSheetRows();
  }, [articleSheetFromGoogle, selectedSite?.id, fetchArticleSheetRows]);

  const applySheetRowToForm = useCallback((row: ArticleSheetRow) => {
    setTitle(row.articleTitle);
    const kws = targetKeywordToKeywords(row.targetKeyword);
    setKeywords(kws);
    setEditorialBrief(buildEditorialBriefFromRow(row));
    setSheetLoadedLabel(`Row ${row.sheetRow}${row.id ? ` · ID ${row.id}` : ""}`);
    setKeywordExtractError(null);
    if (kws.length === 0) {
      setKeywordExtractInfo("This sheet row has no target keyword — add keywords below before generating.");
    } else {
      setKeywordExtractInfo(null);
    }
  }, []);

  const handleSaveEdit = async (id: string) => {
    try {
      const res = await fetch(`${api}/sites/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, tone_prompt: editTonePrompt }),
      });
      if (res.ok) {
        setEditingId(null);
        fetchSites();
      }
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: string) => {
    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      return;
    }
    try {
      const res = await fetch(`${api}/sites/${id}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteConfirmId(null);
        if (selectedSite?.id === id) setSelectedSite(null);
        fetchSites();
      }
    } catch {
      setDeleteConfirmId(null);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    setAddSuccess(false);
    if (!addForm.name.trim() || !addForm.url.trim() || !addForm.username.trim() || !addForm.app_password.trim()) {
      setAddError("All fields except Tone are required.");
      return;
    }
    setAddLoading(true);
    try {
      const res = await fetch(`${api}/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addForm.name.trim(),
          url: addForm.url.trim(),
          username: addForm.username.trim(),
          app_password: addForm.app_password,
          tone_prompt: addForm.tone_prompt.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? "Failed to add site");
        return;
      }
      setAddForm({ name: "", url: "", username: "", app_password: "", tone_prompt: "" });
      setAddSuccess(true);
      fetchSites();
    } catch {
      setAddError("Request failed");
    } finally {
      setAddLoading(false);
    }
  };

  const handleSyncInternalLinks = async (siteId: string) => {
    setLinkSyncNotice(null);
    setLinkSyncBusy({ siteId, kind: "posts" });
    try {
      const res = await fetch(`${api}/sites/${siteId}/sync-internal-links`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; count?: number };
      if (!res.ok) {
        setLinkSyncNotice(data.error ?? "Sync failed");
        return;
      }
      setLinkSyncNotice(`Post links updated for this site (${data.count ?? 0} URLs).`);
    } catch {
      setLinkSyncNotice("Network error while syncing post links");
    } finally {
      setLinkSyncBusy(null);
    }
  };

  const handleSyncProductLinks = async (siteId: string) => {
    setLinkSyncNotice(null);
    setLinkSyncBusy({ siteId, kind: "products" });
    try {
      const res = await fetch(`${api}/sites/${siteId}/sync-product-links`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; count?: number };
      if (!res.ok) {
        setLinkSyncNotice(data.error ?? "Product sync failed");
        return;
      }
      setLinkSyncNotice(`Product links updated for this site (${data.count ?? 0} URLs).`);
    } catch {
      setLinkSyncNotice("Network error while syncing product links");
    } finally {
      setLinkSyncBusy(null);
    }
  };

  const startEdit = (site: Site) => {
    setEditingId(site.id);
    setEditName(site.name);
    setEditTonePrompt(site.tone_prompt ?? "");
  };

  const addKeyword = () => {
    const val = keywordInput.trim().replace(/,/g, "");
    if (val && !keywords.includes(val)) {
      setKeywords((k) => [...k, val]);
      setKeywordInput("");
    }
  };

  const removeKeyword = (idx: number) => {
    setKeywords((k) => k.filter((_, i) => i !== idx));
  };

  const handleKeywordKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKeyword();
    }
  };

  const handleExtractKeywordsFromTitle = async () => {
    if (!title.trim()) {
      setKeywordExtractError("Enter a title first.");
      return;
    }
    setKeywordExtractError(null);
    setKeywordExtractInfo(null);
    setKeywordExtractLoading(true);
    const fileLockHint =
      " If the dev terminal shows EBUSY file-lock errors, stop the server, run npm run clean, then exclude the .next folder from OneDrive sync or move the project outside OneDrive.";

    const doFetch = () =>
      fetch(`${api}/extract-keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });

    try {
      let res = await doFetch();
      if (res.status >= 500 && res.status < 600) {
        await new Promise((r) => setTimeout(r, 500));
        res = await doFetch();
      }

      const rawText = await res.text();
      let data: {
        error?: string;
        keywords?: unknown;
        sources?: { ahrefs?: { enabled?: boolean; mergedCount?: number; error?: string | null; country?: string | null } };
      };
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        setKeywordExtractError(
          `Server returned a non-JSON response (HTTP ${res.status}).${fileLockHint}`
        );
        return;
      }

      if (!res.ok) {
        setKeywordExtractError(
          (data.error ?? "Could not extract keywords") + (res.status >= 500 ? fileLockHint : "")
        );
        return;
      }

      const list = Array.isArray(data.keywords) ? data.keywords : [];
      const ah = data.sources?.ahrefs;
      if (ah?.enabled && (ah.mergedCount ?? 0) > 0) {
        setKeywordExtractInfo(
          `Ahrefs: merged ${ah.mergedCount} matching term(s) by volume (${String(ah.country ?? "us").toUpperCase()}).`
        );
      } else if (ah?.enabled && ah.error) {
        setKeywordExtractInfo(`Ahrefs unavailable (${ah.error}). Keywords use Claude only.`);
      } else if (ah?.enabled && (ah.mergedCount ?? 0) === 0) {
        setKeywordExtractInfo("Ahrefs returned no matching terms for this title; list is Claude-only.");
      } else if (!ah?.enabled) {
        setKeywordExtractInfo("Optional: set AHREFS_API_KEY in .env.local to prepend volume-sorted matching terms from Ahrefs.");
      }

      setKeywords((prev) => {
        const next = [...prev];
        for (const k of list) {
          if (typeof k !== "string" || !k.trim()) continue;
          const t = k.trim();
          if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
        }
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setKeywordExtractError(
        `Request failed: ${msg}.${/load failed|fetch|network/i.test(msg) ? fileLockHint : ""}`
      );
    } finally {
      setKeywordExtractLoading(false);
    }
  };

  const cancelDraftPublishing = useCallback(() => {
    publishCancelledRef.current = true;
    publishAbortRef.current?.abort();
  }, []);

  const runDraftToWordPress = useCallback(
    async (contentHtml: string, images: ImageItem[], existingPostId?: number | string) => {
      if (!selectedSite || !title.trim() || !contentHtml) return;

      const isUpdate = existingPostId != null;

      publishCancelledRef.current = false;
      publishAbortRef.current?.abort();
      publishAbortRef.current = new AbortController();
      const signal = publishAbortRef.current.signal;

      setPublishing(true);
      setPublishError(null);
      if (existingPostId == null) {
        setPublishResult(null);
      }

      const wafHint = isShopify
        ? " Confirm the Admin API token has write_content / write_files scopes and the Blog ID is correct."
        : " If this works locally but not on Vercel, the site’s firewall (e.g. Cloudflare) may be blocking /wp-json from Vercel. Your team can allowlist the app — see WORDPRESS_WAF_* env vars in .env.example.";

      const parseApiError = (res: Response, text: string): string => {
        let data: Record<string, unknown> = {};
        try {
          if (text) data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          return res.status === 413
            ? "Request too large for the server (Vercel payload limit). Try a smaller image or fewer images."
            : (text || "").slice(0, 500) || `Server returned HTTP ${res.status}`;
        }
        let msg = typeof data.error === "string" ? data.error : `Request failed (HTTP ${res.status})`;
        if (res.status === 413) {
          msg =
            typeof data.error === "string"
              ? data.error
              : "Payload too large for Vercel. Try a smaller image or regenerate with lower resolution.";
        }
        if (res.status === 403 || /403/.test(msg) || /cloudflare|blocked|forbidden/i.test(msg)) {
          msg += wafHint;
        }
        return msg;
      };

      try {
        if (publishCancelledRef.current) return;

        const included = images.filter((i) => i.included);
        const titleTrim = title.trim();

        const uploadedRefs: Array<{
          type: "featured" | "in-content";
          index: number;
          mediaId: number;
          url: string;
          altText?: string;
          fileSlug?: string;
          h2Index?: number;
        }> = [];

        for (let i = 0; i < included.length; i++) {
          if (publishCancelledRef.current) return;
          const img = included[i];
          setPublishStep(`Uploading image ${i + 1} of ${included.length} to ${cmsName}…`);
          const upRes = await fetch(`${api}/publish/upload-image`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({
              siteId: selectedSite.id,
              type: img.type,
              index: img.index,
              base64: img.base64,
              mimeType: img.mimeType,
              altText: img.altText,
              fileSlug: img.fileSlug,
              title: titleTrim,
            }),
          });
          const upText = await upRes.text();
          if (!upRes.ok) {
            setPublishError(parseApiError(upRes, upText));
            if (!isUpdate) setPublishResult(null);
            return;
          }
          let upData: Record<string, unknown> = {};
          try {
            if (upText) upData = JSON.parse(upText) as Record<string, unknown>;
          } catch {
            setPublishError("Invalid response while uploading an image");
            if (!isUpdate) setPublishResult(null);
            return;
          }
          const id = upData.id as number;
          const url = upData.url as string;
          if (typeof id !== "number" || typeof url !== "string") {
            setPublishError(`${cmsName} did not return media id/url for an image`);
            if (!isUpdate) setPublishResult(null);
            return;
          }
          uploadedRefs.push({
            type: img.type,
            index: img.index,
            mediaId: id,
            url,
            altText: img.altText,
            fileSlug: img.fileSlug,
            h2Index: img.h2Index,
          });
        }

        if (publishCancelledRef.current) return;

        setPublishStep(existingPostId != null ? "Updating draft post…" : "Creating draft post…");
        const res = await fetch(`${api}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            siteId: selectedSite.id,
            title: titleTrim,
            content: contentHtml,
            images: uploadedRefs,
            ...(existingPostId != null ? { postId: existingPostId } : {}),
            referenceUrl: showReferenceUrl ? referenceUrl.trim() || undefined : undefined,
            keywords,
          }),
        });
        const text = await res.text();

        let data: Record<string, unknown> = {};
        try {
          if (text) data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          setPublishError(
            res.status === 413
              ? "Draft step payload too large (unusual). Try shortening the article HTML."
              : (text || "").slice(0, 500) || `Server returned HTTP ${res.status}`
          );
          if (!isUpdate) setPublishResult(null);
          return;
        }

        if (!res.ok) {
          let msg = typeof data.error === "string" ? data.error : `Publish failed (HTTP ${res.status})`;
          if (res.status === 403 || /403/.test(msg) || /cloudflare|blocked|forbidden/i.test(msg)) {
            msg += wafHint;
          }
          setPublishError(msg);
          if (!isUpdate) setPublishResult(null);
          return;
        }

        setPublishError(null);
        setPublishResult({
          postId: data.postId as number | string,
          postUrl: data.postUrl as string,
          editUrl: data.editUrl as string,
          site: (data.site as { name: string; url: string }) ?? { name: selectedSite.name, url: selectedSite.url },
          rankMath: data.rankMath as { focusKeyphrase?: string; metaDescriptionSet?: boolean } | undefined,
          yoast: data.yoast as { focusKeyphrase?: string; metaDescriptionSet?: boolean } | undefined,
          updated: data.updated === true,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          setPublishError(null);
          return;
        }
        if (existingPostId == null) setPublishResult(null);
        setPublishError(err instanceof Error ? err.message : String(err));
        console.error(err);
      } finally {
        setPublishing(false);
        setPublishStep(null);
        publishAbortRef.current = null;
      }
    },
    [selectedSite, title, referenceUrl, keywords, api, showReferenceUrl, cmsName, isShopify]
  );

  const handlePublish = useCallback(() => {
    if (!approvedContent || !generatedImages) return;
    void runDraftToWordPress(approvedContent, generatedImages);
  }, [approvedContent, generatedImages, runDraftToWordPress]);

  const handleRepublishDraft = useCallback(() => {
    if (!publishResult?.postId || !generatedImages || publishing) return;
    const html =
      contentEditableRef.current?.innerHTML?.trim() ||
      approvedContent ||
      generatedContent ||
      "";
    if (!html.trim()) return;
    void runDraftToWordPress(html, generatedImages, publishResult.postId);
  }, [
    publishResult?.postId,
    generatedImages,
    publishing,
    approvedContent,
    generatedContent,
    runDraftToWordPress,
  ]);

  const handleGenerate = async () => {
    if (!selectedSite || !title.trim() || keywords.length === 0) return;
    setGenerating(true);
    setContentLoading(true);
    setImagesLoading(false);
    setGeneratedContent(null);
    setGeneratedImages(null);
    setInternalLinksUsed([]);
    setContentApproved(false);
    setImagesApproved(false);
    setApprovedContent(null);
    setPublishResult(null);
    setImagesError(null);
    setContentGenerateError(null);

    let contentPhaseComplete = false;
    try {
      const contentRes = await fetch(`${api}/generate-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: selectedSite.id,
          title: title.trim(),
          keywords,
          wordCount,
          ...(transcript.trim() ? { transcript: transcript.trim() } : {}),
          ...(editorialBrief.trim() ? { editorialBrief: editorialBrief.trim() } : {}),
          ...(manualBriefFields && contentAngle.trim() ? { contentAngle: contentAngle.trim() } : {}),
          ...(manualBriefFields && productTypeForLinks.trim()
            ? { productTypeForLinks: productTypeForLinks.trim() }
            : {}),
          ...(showExpertInsightCountSelector ? { expertInsightCount } : {}),
          ...(showExpertInsightCountSelector ? { faqCount } : {}),
          ...(showExpertInsightCountSelector ? { includeImportantNotice } : {}),
        }),
      });
      const contentData = (await contentRes.json()) as { content?: string; error?: string; internalLinksUsed?: InternalLink[] };

      if (!contentRes.ok) {
        setContentLoading(false);
        setGenerating(false);
        setContentGenerateError(contentData.error ?? `Content generation failed (HTTP ${contentRes.status})`);
        return;
      }

      if (typeof contentData.content !== "string" || !contentData.content.trim()) {
        setContentLoading(false);
        setGenerating(false);
        setContentGenerateError("Server returned no article HTML. Try again.");
        return;
      }

      setContentLoading(false);
      setGeneratedContent(contentData.content);
      setInternalLinksUsed(contentData.internalLinksUsed ?? []);
      contentPhaseComplete = true;
      setImagesLoading(true);

      const imagesRes = await fetch(`${api}/generate-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: selectedSite.id,
          title: title.trim(),
          keywords,
          content: contentData.content,
          wordCount,
        }),
      });
      const imagesData = await imagesRes.json();

      setImagesLoading(false);
      setGenerating(false);
      const { images: imageList, warnings: imageWarnings } = parseGenerateImagesResponse(imagesData);
      if (imagesRes.ok && imageList.length > 0) {
        setImagesError(
          imageWarnings.length > 0 ? imageWarnings.join(" ") : null
        );
        const mapped: ImageItem[] = imageList.map(
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
            included: true,
            altText: typeof img.altText === "string" ? img.altText : undefined,
            fileSlug: typeof img.fileSlug === "string" ? img.fileSlug : undefined,
            h2Index: typeof img.h2Index === "number" ? img.h2Index : undefined,
            sectionHeading: typeof img.sectionHeading === "string" ? img.sectionHeading : undefined,
          })
        );
        setGeneratedImages(mapped);
      } else {
        setImagesError(imagesData?.error ?? "Image generation failed. You can retry below.");
      }
    } catch (err) {
      setContentLoading(false);
      setImagesLoading(false);
      setGenerating(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (!contentPhaseComplete) {
        setContentGenerateError(msg || "Content generation failed. Check the server terminal or logs, then try again.");
      } else {
        setImagesError(msg || "Image generation failed. You can retry below.");
      }
    }
  };

  const handleRegenerateWithInstructions = async () => {
    if (!selectedSite || !title.trim() || keywords.length === 0) return;
    const instructions = contentRefinementInstructions.trim();
    if (!instructions) return;

    const existingHtml =
      contentApproved && approvedContent
        ? approvedContent.trim()
        : (contentEditableRef.current?.innerHTML?.trim() ||
            generatedContent?.trim() ||
            "");

    if (!existingHtml) {
      setContentRefineError("No HTML to refine.");
      return;
    }

    setContentRefineError(null);
    setContentRefining(true);

    try {
      const contentRes = await fetch(`${api}/generate-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: selectedSite.id,
          title: title.trim(),
          keywords,
          wordCount,
          existingHtml,
          refinementInstructions: instructions,
          ...(transcript.trim() ? { transcript: transcript.trim() } : {}),
          ...(editorialBrief.trim() ? { editorialBrief: editorialBrief.trim() } : {}),
          ...(manualBriefFields && contentAngle.trim() ? { contentAngle: contentAngle.trim() } : {}),
          ...(manualBriefFields && productTypeForLinks.trim()
            ? { productTypeForLinks: productTypeForLinks.trim() }
            : {}),
          ...(showExpertInsightCountSelector ? { expertInsightCount } : {}),
          ...(showExpertInsightCountSelector ? { faqCount } : {}),
          ...(showExpertInsightCountSelector ? { includeImportantNotice } : {}),
        }),
      });
      const contentData = (await contentRes.json()) as {
        content?: string;
        internalLinksUsed?: InternalLink[];
        error?: string;
      };

      if (!contentRes.ok) {
        setContentRefineError(contentData.error ?? "Refinement failed");
        return;
      }

      if (typeof contentData.content !== "string") {
        setContentRefineError("Invalid response from server");
        return;
      }

      setGeneratedContent(contentData.content);
      setInternalLinksUsed(contentData.internalLinksUsed ?? []);
      setContentApproved(false);
      setApprovedContent(null);
      setContentRefinementInstructions("");
      setContentRefineError(null);
    } catch (err) {
      setContentRefineError(err instanceof Error ? err.message : "Refinement failed");
    } finally {
      setContentRefining(false);
    }
  };

  const handleGenerateImages = useCallback(async () => {
    const content = approvedContent ?? generatedContent;
    if (!content || !title.trim() || keywords.length === 0) return;
    setImagesError(null);
    setImagesLoading(true);
    try {
      const imagesRes = await fetch(`${api}/generate-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: selectedSite?.id,
          title: title.trim(),
          keywords,
          content,
          wordCount,
        }),
      });
      const imagesData = await imagesRes.json();
      setImagesLoading(false);
      const { images: imageList, warnings: imageWarnings } = parseGenerateImagesResponse(imagesData);
      if (imagesRes.ok && imageList.length > 0) {
        setImagesError(imageWarnings.length > 0 ? imageWarnings.join(" ") : null);
        const mapped: ImageItem[] = imageList.map(
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
            included: true,
            altText: typeof img.altText === "string" ? img.altText : undefined,
            fileSlug: typeof img.fileSlug === "string" ? img.fileSlug : undefined,
            h2Index: typeof img.h2Index === "number" ? img.h2Index : undefined,
            sectionHeading: typeof img.sectionHeading === "string" ? img.sectionHeading : undefined,
          })
        );
        setGeneratedImages(mapped);
        setImagesApproved(false);
      } else {
        setImagesError(imagesData?.error ?? "Image generation failed. Try again.");
      }
    } catch (err) {
      setImagesLoading(false);
      setImagesError(err instanceof Error ? err.message : "Image generation failed. Try again.");
    }
  }, [approvedContent, generatedContent, selectedSite?.id, title, keywords, wordCount]);

  const section2Unlocked = contentLoading || contentRefining || !!generatedContent || !!contentGenerateError;
  const hasContent = !!generatedContent || !!contentApproved;
  const section3Unlocked = hasContent;
  const section4Unlocked = (contentApproved && imagesApproved) || publishing;
  const includedImagesCount =
    generatedImages?.filter((i) => i.included).length ?? 0;

  useEffect(() => {
    if (contentEditableRef.current && generatedContent && !contentApproved) {
      contentEditableRef.current.innerHTML = generatedContent;
    }
  }, [generatedContent, contentApproved]);

  const handleContentInput = useCallback(() => {
    const html = contentEditableRef.current?.innerHTML ?? "";
    setGeneratedContent(html);
  }, []);

  const handleContentApprove = useCallback(() => {
    const html = contentEditableRef.current?.innerHTML ?? generatedContent ?? "";
    setApprovedContent(html);
    setContentApproved(true);
  }, [generatedContent]);

  const handleImagesApprove = useCallback(() => {
    setImagesApproved(true);
  }, []);

  const handleRegenerateImage = useCallback(
    async (idx: number, extraNotes?: string) => {
      const img = generatedImages?.[idx];
      if (!img?.prompt) return;
      setRegeneratingIndex(idx);
      setRegenerateError(null);
      try {
        const trimmed = typeof extraNotes === "string" ? extraNotes.trim() : "";
        const prompt = trimmed
          ? `${img.prompt}\n\nAdditional direction: ${trimmed}`
          : img.prompt;
        const res = await fetch(`${api}/generate-images/single`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, siteId: selectedSite?.id }),
        });
        const data = (await res.json().catch(() => ({}))) as { base64?: string; mimeType?: string; error?: string };
        const newBase64 = data.base64;
        if (res.ok && newBase64) {
          const mime = data.mimeType ?? "image/png";
          setGeneratedImages((prev) => {
            if (!prev) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], base64: newBase64, mimeType: mime };
            return next;
          });
          setRegeneratePanelIndex(null);
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
    [api, generatedImages, selectedSite?.id]
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

  const handleToggleInclude = useCallback((idx: number) => {
    setGeneratedImages((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], included: !next[idx].included };
      return next;
    });
  }, []);

  const handleStartNewPost = useCallback(() => {
    setTitle("");
    setKeywords([]);
    setKeywordInput("");
    setKeywordExtractError(null);
    setReferenceUrl("");
    setTranscript("");
    setEditorialBrief("");
    setSheetLoadedLabel(null);
    setContentAngle("");
    setProductTypeForLinks("");
    setExpertInsightCount(3);
    setFaqCount(5);
    setIncludeImportantNotice(false);
    setGeneratedContent(null);
    setGeneratedImages(null);
    setInternalLinksUsed([]);
    setContentApproved(false);
    setImagesApproved(false);
    setApprovedContent(null);
    setPublishResult(null);
    setPublishError(null);
    setRegeneratePanelIndex(null);
    setRegenerateExtraNotes("");
    setRegenerateError(null);
  }, []);

  return (
    <div className="space-y-8">
      {/* Title and description are rendered by ToolLayout */}
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setPanelOpen(!panelOpen)}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900"
          aria-expanded={panelOpen}
          aria-label={panelOpen ? "Close site manager" : "Open site manager"}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5 shrink-0 text-slate-500">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-sm font-semibold">Site manager</span>
          <span className="hidden text-xs font-normal text-slate-400 sm:inline">
            {panelOpen ? "Hide" : isShopify ? "Add Shopify stores" : "Add sites · Sync post & product links"}
          </span>
        </button>
        {!panelOpen ? (
          <p className="max-w-md text-right text-[11px] text-slate-400">
            {isShopify ? (
              <>
                Open Site manager to add your {cmsName} store (shop host, Blog ID, Admin API token).
              </>
            ) : (
              <>
                Open Site manager to add WordPress sites and use{" "}
                <strong className="font-medium text-slate-500">Sync post links</strong> and{" "}
                <strong className="font-medium text-slate-500">Sync product links</strong> per site.
              </>
            )}
          </p>
        ) : null}
      </div>

      {panelOpen && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">Site Manager</h2>
          {showLinkSync ? (
            <p className="mb-4 text-xs leading-relaxed text-slate-500">
              <strong className="font-medium text-slate-600">Internal links:</strong> Each WordPress site has its own rows
              in Supabase (keyed by site id; nothing mixes between sites). <strong>Sync post links</strong> pulls blog
              URLs from WordPress; <strong>Sync product links</strong> pulls WooCommerce catalog URLs (
              <code className="rounded bg-slate-200/80 px-1">wc/v3/products</code>, stored as{" "}
              <code className="rounded bg-slate-200/80 px-1">kind=product</code>). Run migrations{" "}
              <code className="rounded bg-slate-200/80 px-1">005</code> and{" "}
              <code className="rounded bg-slate-200/80 px-1">006_site_internal_links_kind_scope.sql</code>.
            </p>
          ) : (
            <p className="mb-4 text-xs leading-relaxed text-slate-500">
              Add your Farm.com Shopify store with the <strong className="font-medium text-slate-600">*.myshopify.com</strong>{" "}
              host, numeric <strong className="font-medium text-slate-600">Blog ID</strong>, and an Admin API access token
              with content/file write scopes. Drafts publish to that blog only.
            </p>
          )}
          {linkSyncNotice ? (
            <p className="mb-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-900">{linkSyncNotice}</p>
          ) : null}

          {/* List of sites */}
          <div className="mb-6 space-y-3">
            {sitesLoading ? (
              <p className="text-sm text-slate-500">Loading sites...</p>
            ) : sites.length === 0 ? (
              <p className="text-sm text-slate-500">No sites yet. Add one below.</p>
            ) : (
              sites.map((site) => (
                <div
                  key={site.id}
                  className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  {editingId === site.id ? (
                    <div className="flex flex-1 flex-col gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Site name"
                        className="rounded border border-slate-200 px-2 py-1.5 text-sm"
                      />
                      <textarea
                        value={editTonePrompt}
                        onChange={(e) => setEditTonePrompt(e.target.value)}
                        placeholder="Tone / writing style"
                        rows={2}
                        className="rounded border border-slate-200 px-2 py-1.5 text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(site.id)}
                          className="rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <p className="font-medium text-slate-900">{site.name}</p>
                        <p className="text-sm text-slate-500">{site.url}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(site)}
                          className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        {showLinkSync ? (
                          <>
                            <button
                              type="button"
                              disabled={linkSyncBusy?.siteId === site.id}
                              onClick={() => void handleSyncInternalLinks(site.id)}
                              className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                            >
                              {linkSyncBusy?.siteId === site.id && linkSyncBusy.kind === "posts"
                                ? "Syncing posts…"
                                : "Sync post links"}
                            </button>
                            <button
                              type="button"
                              disabled={linkSyncBusy?.siteId === site.id}
                              onClick={() => void handleSyncProductLinks(site.id)}
                              className="rounded border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-900 hover:bg-violet-100 disabled:opacity-50"
                            >
                              {linkSyncBusy?.siteId === site.id && linkSyncBusy.kind === "products"
                                ? "Syncing products…"
                                : "Sync product links"}
                            </button>
                          </>
                        ) : null}
                        {deleteConfirmId === site.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleDelete(site.id)}
                              className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                            >
                              Confirm delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleDelete(site.id)}
                            className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Add new site form */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-medium text-slate-700">Add new site</h3>
            <form onSubmit={handleAddSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Site name</label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={isShopify ? "e.g. Farm.com" : "e.g. Green.org"}
                  className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  {isShopify ? "Shopify shop host" : "WordPress URL"}
                </label>
                <input
                  type="text"
                  value={addForm.url}
                  onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder={isShopify ? "your-store.myshopify.com" : "https://example.com"}
                  className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  {isShopify ? "Blog ID" : "Username (login)"}
                </label>
                <input
                  type="text"
                  value={addForm.username}
                  onChange={(e) => setAddForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder={
                    isShopify
                      ? "Numeric ID from Online Store → Blog"
                      : "Exact value from Users → Profile → Username"
                  }
                  className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  autoComplete="username"
                />
                <p className="mt-1 text-xs text-slate-500">
                  {isShopify
                    ? "Open the blog in Shopify Admin; the URL usually ends with /blogs/NEWS_BLOG_ID or check the blog settings page."
                    : "Use the Username field on your profile (or the Username column under Users → All Users)—not the public display name at the top. WordPress logins cannot contain spaces; “alex weed” is a name, not the login."}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  {isShopify ? "Admin API access token" : "Application password"}
                </label>
                <input
                  type="password"
                  value={addForm.app_password}
                  onChange={(e) => setAddForm((f) => ({ ...f, app_password: e.target.value }))}
                  placeholder={
                    isShopify
                      ? "shpat_… from a custom app (write_content + write_files)"
                      : "From Users → Profile → Application Passwords"
                  }
                  className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-slate-500">
                  {isShopify
                    ? "Create a custom app in Shopify Admin → Settings → Apps → Develop apps. Grant write_content (or write_online_store_pages) and write_files."
                    : "Not your normal WordPress password. Paste the generated app password with or without spaces."}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Tone / writing style</label>
                <textarea
                  value={addForm.tone_prompt}
                  onChange={(e) => setAddForm((f) => ({ ...f, tone_prompt: e.target.value }))}
                  placeholder="Describe how Claude should write for this site..."
                  rows={3}
                  className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              {addError && (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{addError}</div>
              )}
              {addSuccess && (
                <div className="rounded border border-green-200 bg-green-50 p-2 text-sm text-green-700">
                  Site added successfully.
                </div>
              )}
              <button
                type="submit"
                disabled={addLoading}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
              >
                {addLoading ? "Testing..." : "Test & Save"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Section 0 — Site selector (always visible at top) */}
      <div>
        <h2 className="text-sm font-medium text-slate-500">Site</h2>
        <div className="mt-2">
          <select
            value={selectedSite?.id ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              const s = sites.find((x) => x.id === id);
              setSelectedSite(s ? { id: s.id, name: s.name, url: s.url } : null);
            }}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="">Select a site...</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.url}
              </option>
            ))}
          </select>
        </div>
      </div>

      {siteUnlocked && articleSheetFromGoogle ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-emerald-900">Article queue (Google Sheet)</h2>
            <button
              type="button"
              onClick={() => void fetchArticleSheetRows()}
              disabled={sheetLoading}
              className="rounded border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
            >
              {sheetLoading ? "Loading…" : "Refresh from sheet"}
            </button>
          </div>
          <p className="mb-3 text-xs text-emerald-800/90">
            Pick a row and load it into the form below, then generate — one article at a time. Calendar fields (cluster,
            angle, etc.) are sent to Claude as an editorial brief.
          </p>
          {sheetError ? (
            <p className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">{sheetError}</p>
          ) : null}
          {sheetRows.length > 0 ? (
            <div className="max-h-64 overflow-auto rounded border border-emerald-100 bg-white">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="sticky top-0 bg-emerald-100/80 text-emerald-950">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Row</th>
                    <th className="px-2 py-1.5 font-medium">ID</th>
                    <th className="px-2 py-1.5 font-medium">Title</th>
                    <th className="px-2 py-1.5 font-medium">Target keyword</th>
                    <th className="px-2 py-1.5 font-medium">Priority</th>
                    <th className="px-2 py-1.5 font-medium"> </th>
                  </tr>
                </thead>
                <tbody>
                  {sheetRows.map((row) => (
                    <tr key={`${row.sheetRow}-${row.id}-${row.articleTitle.slice(0, 24)}`} className="border-t border-emerald-50">
                      <td className="px-2 py-1.5 text-slate-600">{row.sheetRow}</td>
                      <td className="px-2 py-1.5 text-slate-600">{row.id}</td>
                      <td className="max-w-[220px] truncate px-2 py-1.5 text-slate-900" title={row.articleTitle}>
                        {row.articleTitle}
                      </td>
                      <td className="max-w-[160px] truncate px-2 py-1.5 text-slate-600" title={row.targetKeyword}>
                        {row.targetKeyword}
                      </td>
                      <td className="px-2 py-1.5 text-slate-600">{row.priority}</td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => applySheetRowToForm(row)}
                          className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-700"
                        >
                          Load
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !sheetLoading && !sheetError ? (
            <p className="text-xs text-emerald-800/80">No data rows yet. Check the sheet tab name in WEED_ARTICLE_SHEET_RANGE if this stays empty.</p>
          ) : null}
          {sheetLoadedLabel ? (
            <p className="mt-2 text-xs font-medium text-emerald-900">Loaded: {sheetLoadedLabel}</p>
          ) : null}
        </div>
      ) : null}

      {/* Section 1 — Input form (unlocks after site selected) */}
      <div className={siteUnlocked ? "" : "opacity-50 pointer-events-none"}>
        <h2 className="text-sm font-medium text-slate-500">Input</h2>
        {siteUnlocked ? (
          <div className="mt-2 space-y-4 rounded-lg border border-slate-200 bg-white p-4">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Article title"
                required
                className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            {manualBriefFields ? (
              <>
                <div>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <label className="block text-xs text-slate-500">Target keyword(s)</label>
                    <button
                      type="button"
                      onClick={handleExtractKeywordsFromTitle}
                      disabled={keywordExtractLoading || !title.trim()}
                      className="rounded border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {keywordExtractLoading ? "Extracting…" : "Extract from title"}
                    </button>
                  </div>
                  <p className="mb-2 text-xs text-slate-500">
                    Primary phrases for SEO and internal link matching; separate multiple with commas. Extract from title
                    merges suggestions into this field.
                  </p>
                  {keywordExtractError && (
                    <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                      {keywordExtractError}
                    </div>
                  )}
                  {keywordExtractInfo && !keywordExtractError && (
                    <div className="mb-2 rounded border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
                      {keywordExtractInfo}
                    </div>
                  )}
                  <input
                    type="text"
                    value={keywords.join(", ")}
                    onChange={(e) => setKeywords(targetKeywordToKeywords(e.target.value))}
                    placeholder="e.g. best cbd gummies for sleep"
                    className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Product type (for internal links)</label>
                  <input
                    type="text"
                    value={productTypeForLinks}
                    onChange={(e) => setProductTypeForLinks(e.target.value)}
                    placeholder="e.g. Gummies, Vapes, Carts"
                    className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    When set, up to two matching <strong>product</strong> URLs from your library are prioritized for
                    Claude (after <span className="font-medium">Sync product links</span>). The model is instructed to use
                    1–2 product links when they fit.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Content angle</label>
                  <textarea
                    value={contentAngle}
                    onChange={(e) => setContentAngle(e.target.value)}
                    placeholder="e.g. Educational buyer guide, FAQ / how-to, comparison…"
                    rows={3}
                    className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </>
            ) : (
              <div>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-xs text-slate-500">Keywords</label>
                  <button
                    type="button"
                    onClick={handleExtractKeywordsFromTitle}
                    disabled={keywordExtractLoading || !title.trim()}
                    className="rounded border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {keywordExtractLoading ? "Extracting…" : "Extract from title"}
                  </button>
                </div>
                <p className="mb-2 text-xs text-slate-500">
                  Claude proposes phrases (including 1–2 WordPress-focused terms). If{" "}
                  <span className="font-mono text-[11px]">AHREFS_API_KEY</span> is set server-side, Ahrefs matching
                  terms (sorted by estimated monthly volume) are merged first. Consumes Ahrefs API units.
                </p>
                {keywordExtractError && (
                  <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                    {keywordExtractError}
                  </div>
                )}
                {keywordExtractInfo && !keywordExtractError && (
                  <div className="mb-2 rounded border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
                    {keywordExtractInfo}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 rounded border border-slate-200 bg-white p-2">
                  {keywords.map((kw, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2.5 py-0.5 text-sm text-teal-800"
                    >
                      {kw}
                      <button
                        type="button"
                        onClick={() => removeKeyword(i)}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-teal-200"
                        aria-label="Remove"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={handleKeywordKeyDown}
                    onBlur={addKeyword}
                    placeholder="Type keyword + Enter or comma"
                    className="min-w-[180px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none"
                  />
                </div>
              </div>
            )}
            {showReferenceUrl ? (
              <div>
                <label className="mb-1 block text-xs text-slate-500">Source / reference URL (optional)</label>
                <input
                  type="url"
                  value={referenceUrl}
                  onChange={(e) => setReferenceUrl(e.target.value)}
                  placeholder="https://example.com/original-article"
                  className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-slate-500">
                  If set, this is appended at the <span className="font-medium">end of the post body</span> when you publish:
                  <span className="mt-1 block font-mono text-[11px] leading-relaxed text-slate-600">
                    This article is for informational purposes only.
                    <br />
                    Reference: [your URL]
                  </span>
                </p>
              </div>
            ) : null}
            <div>
              <label className="mb-1 block text-xs text-slate-500">Transcript (optional)</label>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Paste call/video/interview transcript. The model will use this as source context for drafting."
                rows={6}
                className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-slate-500">
                Optional source context used during generate and regenerate.
              </p>
            </div>
            {articleSheetFromGoogle && editorialBrief.trim() ? (
              <p className="rounded border border-sky-100 bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
                Editorial brief from the sheet will be included when you generate (cluster, angle, product type, notes).
              </p>
            ) : null}
            {manualBriefFields && (contentAngle.trim() || productTypeForLinks.trim()) ? (
              <p className="rounded border border-sky-100 bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
                Content angle and product type will be included in the generate request with your target keyword(s).
              </p>
            ) : null}
            <div>
              <label className="mb-2 block text-xs text-slate-500">Word count</label>
              <div className="flex gap-2">
                {[1500, 2000, 2500, 3000].map((n) => (
                  <label
                    key={n}
                    className={`flex cursor-pointer items-center rounded-lg border px-4 py-2 text-sm transition-colors ${
                      wordCount === n
                        ? "border-teal-500 bg-teal-50 text-teal-700"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="wordCount"
                      value={n}
                      checked={wordCount === n}
                      onChange={() => setWordCount(n)}
                      className="sr-only"
                    />
                    {n}
                  </label>
                ))}
              </div>
            </div>
            {showExpertInsightCountSelector ? (
              <div>
                <label className="mb-2 block text-xs text-slate-500">Expert Insight boxes</label>
                <div className="flex gap-2">
                  {[1, 2, 3].map((n) => (
                    <label
                      key={n}
                      className={`flex cursor-pointer items-center rounded-lg border px-4 py-2 text-sm transition-colors ${
                        expertInsightCount === n
                          ? "border-teal-500 bg-teal-50 text-teal-700"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="expertInsightCount"
                        value={n}
                        checked={expertInsightCount === n}
                        onChange={() => setExpertInsightCount(n as 1 | 2 | 3)}
                        className="sr-only"
                      />
                      {n}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Generates exactly the selected number of Dr. Tabibi Expert Insight boxes.
                </p>
              </div>
            ) : null}
            {showExpertInsightCountSelector ? (
              <div>
                <label className="mb-2 block text-xs text-slate-500">FAQ count</label>
                <div className="flex gap-2">
                  {[3, 4, 5].map((n) => (
                    <label
                      key={n}
                      className={`flex cursor-pointer items-center rounded-lg border px-4 py-2 text-sm transition-colors ${
                        faqCount === n
                          ? "border-teal-500 bg-teal-50 text-teal-700"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="faqCount"
                        value={n}
                        checked={faqCount === n}
                        onChange={() => setFaqCount(n as 3 | 4 | 5)}
                        className="sr-only"
                      />
                      {n}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Generates exactly the selected number of FAQs.
                </p>
              </div>
            ) : null}
            {showExpertInsightCountSelector ? (
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-900">
                <input
                  type="checkbox"
                  checked={includeImportantNotice}
                  onChange={(e) => setIncludeImportantNotice(e.target.checked)}
                  className="mt-0.5 rounded border-amber-300"
                />
                <span>
                  Include the <strong>Important Notice</strong> block at the bottom of the article.
                </span>
              </label>
            ) : null}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !title.trim() || keywords.length === 0}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Generate Content
            </button>
          </div>
        ) : (
          <div className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-slate-500">
            Select a site above to continue
          </div>
        )}
      </div>

      {/* Section 2 — Content review */}
      <div className={section2Unlocked ? "" : "opacity-50 pointer-events-none"}>
        <h2 className="text-sm font-medium text-slate-500">Content review</h2>
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-4">
          {contentLoading ? (
            <p className="text-sm text-slate-500">
              Writing content with Claude for {selectedSite?.name ?? "..."}...
            </p>
          ) : generatedContent || contentApproved ? (
            <div className="space-y-4">
              {contentRefining && (
                <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Revising article HTML with your instructions…
                </p>
              )}
              {contentApproved ? (
                <div
                  className={`space-y-4 text-sm [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-medium [&_p]:leading-relaxed ${
                    contentRefining ? "pointer-events-none opacity-60" : ""
                  }`}
                  dangerouslySetInnerHTML={{ __html: approvedContent ?? "" }}
                />
              ) : (
                <div
                  ref={contentEditableRef}
                  contentEditable={!contentRefining}
                  suppressContentEditableWarning
                  onInput={handleContentInput}
                  className={`min-h-[200px] space-y-4 text-sm outline-none [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-medium [&_p]:leading-relaxed ${
                    contentRefining ? "pointer-events-none opacity-60" : ""
                  }`}
                />
              )}
              <p className="text-xs text-slate-500">Word count: {contentWordCount}</p>
              {internalLinksUsed.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                  <p className="mb-2 text-xs font-medium text-slate-600">Internal links used</p>
                  <ul className="flex flex-wrap gap-2">
                    {internalLinksUsed.map((link, i) => (
                      <li key={i}>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-teal-600 underline hover:text-teal-700"
                        >
                          {link.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3">
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Regenerate with instructions
                </label>
                <p className="mb-2 text-xs text-slate-600">
                  After the draft exists, describe edits (tone, sections, links, FAQ, Expert Insight). The model
                  revises the HTML above; images are not regenerated automatically.
                </p>
                <textarea
                  value={contentRefinementInstructions}
                  onChange={(e) => setContentRefinementInstructions(e.target.value)}
                  rows={3}
                  placeholder="e.g. Shorten the intro; add one FAQ about dosage; keep internal links."
                  disabled={contentRefining || contentLoading}
                  className="mb-2 w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={handleRegenerateWithInstructions}
                  disabled={
                    contentRefining ||
                    contentLoading ||
                    !contentRefinementInstructions.trim() ||
                    !title.trim() ||
                    keywords.length === 0
                  }
                  className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {contentRefining ? "Regenerating…" : "Regenerate HTML"}
                </button>
                {contentRefineError && (
                  <p className="mt-2 text-xs text-red-600">{contentRefineError}</p>
                )}
              </div>
              {!contentApproved && (
                <button
                  type="button"
                  onClick={handleContentApprove}
                  disabled={contentRefining}
                  className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Content approved
                </button>
              )}
            </div>
          ) : contentGenerateError ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {contentGenerateError}
              </div>
              <p className="text-sm text-slate-600">
                Fix the issue above (API keys, site config, or server logs), then click Generate Content again.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-slate-500">
              Content review — locked
            </div>
          )}
        </div>
      </div>

      {/* Section 3 — Images review */}
      <div className={section3Unlocked ? "" : "opacity-50 pointer-events-none"}>
        <h2 className="text-sm font-medium text-slate-500">Images review</h2>
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-4">
          {imagesLoading ? (
            <p className="text-sm text-slate-500">Generating images with Gemini...</p>
          ) : !generatedImages || generatedImages.length === 0 ? (
            <div className="space-y-3">
              {imagesError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {imagesError}
                </div>
              )}
              <p className="text-sm text-slate-600">
                {imagesError
                  ? "Click below to retry image generation."
                  : "Generates a featured image plus 3–4 in-content images placed after the matching H2 sections, with SEO filenames and alt text. FAQ sections are skipped."}
              </p>
              <button
                type="button"
                onClick={handleGenerateImages}
                disabled={imagesLoading || publishing}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
              >
                {imagesError ? "Retry image generation" : "Generate images"}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {generatedImages
                .filter((img) => img.type === "featured")
                .map((img, i) => {
                  const idx = generatedImages!.indexOf(img);
                  const panelOpen = regeneratePanelIndex === idx;
                  const busy = regeneratingIndex === idx;
                  return (
                    <div key={`f-${i}`} className="max-w-3xl space-y-2">
                      <p className="text-xs font-medium text-slate-600">Featured image</p>
                      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                        <img
                          src={`data:${img.mimeType};base64,${img.base64}`}
                          alt={img.altText ?? ""}
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
                          onClick={() => toggleRegeneratePanel(idx)}
                          disabled={busy}
                          className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {panelOpen ? "Hide prompt" : "Regenerate…"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRegenerateImage(idx)}
                          disabled={busy}
                          className="rounded border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-60"
                        >
                          {busy ? "Regenerating…" : "Quick regenerate"}
                        </button>
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={img.included}
                            onChange={() => handleToggleInclude(idx)}
                            className="rounded border-slate-300"
                          />
                          Include this image
                        </label>
                      </div>
                      {panelOpen && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-2">
                          <label htmlFor={`regen-notes-${idx}`} className="block text-xs font-medium text-slate-600">
                            Optional prompt details
                          </label>
                          <textarea
                            id={`regen-notes-${idx}`}
                            rows={3}
                            value={regenerateExtraNotes}
                            onChange={(e) => setRegenerateExtraNotes(e.target.value)}
                            placeholder="e.g. warmer light, more product close-up, softer background, no text in frame…"
                            className="w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                          <p className="text-[11px] text-slate-500">
                            Appended to the original image prompt. Leave blank to match the original prompt only.
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleRegenerateImage(idx, regenerateExtraNotes)}
                              disabled={busy}
                              className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-60"
                            >
                              {busy ? "Generating…" : "Generate with details"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setRegeneratePanelIndex(null)}
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
                })}
              {generatedImages.filter((img) => img.type === "in-content").length > 0 && (
                <>
                  <p className="text-xs font-medium text-slate-600">In-content images</p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {generatedImages
                      .filter((img) => img.type === "in-content")
                      .sort((a, b) => a.index - b.index)
                      .map((img, i) => {
                        const idx = generatedImages!.indexOf(img);
                        const panelOpen = regeneratePanelIndex === idx;
                        const busy = regeneratingIndex === idx;
                        return (
                          <div key={`ic-${img.index}`} className="rounded-lg border border-slate-200 p-2">
                            <div className="aspect-video w-full overflow-hidden rounded bg-slate-100">
                              <img
                                src={`data:${img.mimeType};base64,${img.base64}`}
                                alt={img.altText ?? ""}
                                className="h-full w-full object-cover"
                              />
                            </div>
                            <p className="mt-1 text-xs font-medium text-slate-700">
                              {img.sectionHeading ? `Section: ${img.sectionHeading}` : `In-content ${i + 1}`}
                            </p>
                            <div className="mt-1 space-y-0.5 text-[11px] text-slate-500">
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
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => toggleRegeneratePanel(idx)}
                                disabled={busy}
                                className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                              >
                                {panelOpen ? "Hide prompt" : "Regenerate…"}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRegenerateImage(idx)}
                                disabled={busy}
                                className="rounded border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-60"
                              >
                                {busy ? "Regenerating…" : "Quick regenerate"}
                              </button>
                              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                                <input
                                  type="checkbox"
                                  checked={img.included}
                                  onChange={() => handleToggleInclude(idx)}
                                  className="rounded border-slate-300"
                                />
                                Include this image
                              </label>
                            </div>
                            {panelOpen && (
                              <div className="mt-2 rounded-md border border-slate-200 bg-slate-50/80 p-2 space-y-2">
                                <label htmlFor={`regen-notes-ic-${idx}`} className="block text-[11px] font-medium text-slate-600">
                                  Optional prompt details
                                </label>
                                <textarea
                                  id={`regen-notes-ic-${idx}`}
                                  rows={3}
                                  value={regenerateExtraNotes}
                                  onChange={(e) => setRegenerateExtraNotes(e.target.value)}
                                  placeholder="e.g. warmer light, different angle, more contrast…"
                                  className="w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                                />
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleRegenerateImage(idx, regenerateExtraNotes)}
                                    disabled={busy}
                                    className="rounded bg-teal-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-700 disabled:opacity-60"
                                  >
                                    {busy ? "Generating…" : "Generate with details"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRegeneratePanelIndex(null)}
                                    className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                                  >
                                    Cancel
                                  </button>
                                </div>
                                {regenerateError?.index === idx && (
                                  <p className="text-[11px] text-red-600">{regenerateError.message}</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </>
              )}
              {!imagesApproved && (
                <button
                  type="button"
                  onClick={handleImagesApprove}
                  className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
                >
                  Images approved
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Section 4 — Publish */}
      <div className={section4Unlocked ? "" : "opacity-50 pointer-events-none"}>
        <h2 className="text-sm font-medium text-slate-500">Publish</h2>
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-4">
          {publishResult ? (
            <>
              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="font-medium text-green-800">
                {publishing
                  ? `Sending to ${cmsName}…`
                  : publishResult.updated
                    ? "Draft updated successfully"
                    : "Draft published successfully"}
              </p>
              <p className="mt-1 text-sm text-green-700">
                {publishResult.site.name} – {title}
                {!publishing && publishResult.postId ? (
                  <span className="ml-2 font-mono text-xs text-green-600/90">(post #{publishResult.postId})</span>
                ) : null}
              </p>
              {(() => {
                const seo = publishResult.rankMath ?? publishResult.yoast;
                const label = publishResult.rankMath ? "Rank Math" : "Yoast SEO";
                if (seo?.focusKeyphrase == null) return null;
                const rejected = seo.metaDescriptionSet === false;
                const persistHint = publishResult.yoast
                  ? "Yoast SEO may need _yoast_wpseo_* meta keys registered for the REST API on the site."
                  : "Rank Math may need REST meta registration on the site.";
                return (
                  <p className="mt-2 text-sm text-green-800">
                    {label}: set SEO title, meta description, and focus keyphrase via REST (focus:{" "}
                    <span className="font-mono">{seo.focusKeyphrase}</span>
                    {rejected ? `. WordPress did not persist meta fields; ${persistHint}` : "."}
                  </p>
                );
              })()}
              <p className="mt-2 text-xs text-green-800/90">
                After you edit the article or images above, you can push changes to the same {cmsName} draft without creating a duplicate post.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={publishResult.editUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  View draft in {cmsName}
                </a>
                <button
                  type="button"
                  onClick={handleRepublishDraft}
                  disabled={publishing || !generatedImages}
                  className="rounded-lg border border-green-600 bg-white px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {publishing ? "Updating draft…" : `Update draft in ${cmsName}`}
                </button>
                <button
                  type="button"
                  onClick={handleStartNewPost}
                  className="rounded-lg border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
                >
                  Start new post
                </button>
              </div>
              </div>
              {publishError ? (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                  <p className="font-semibold text-rose-800">Could not update draft</p>
                  <p className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{publishError}</p>
                </div>
              ) : null}
            </>
          ) : section4Unlocked ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-sm">
                <p><span className="font-medium text-slate-600">Site:</span> {selectedSite?.name}</p>
                <p><span className="font-medium text-slate-600">Post title:</span> {title}</p>
                <p><span className="font-medium text-slate-600">Word count:</span> {contentWordCount}</p>
                <p><span className="font-medium text-slate-600">Images:</span> {includedImagesCount}</p>
                {showReferenceUrl && referenceUrl.trim() ? (
                  <p>
                    <span className="font-medium text-slate-600">Reference footer:</span>{" "}
                    <span className="text-teal-700">Yes — disclaimer + link at end of post</span>
                  </p>
                ) : null}
              </div>
              {publishing && publishStep && (
                <ol className="space-y-1 text-sm text-slate-600">
                  <li className={publishStep === "Uploading featured image..." ? "font-medium text-teal-600" : "text-slate-400"}>
                    1. Uploading featured image...
                  </li>
                  <li className={publishStep === "Uploading in-content images..." ? "font-medium text-teal-600" : publishStep === "Creating draft post..." ? "text-slate-400" : ""}>
                    2. Uploading in-content images...
                  </li>
                  <li
                    className={
                      publishStep === "Creating draft post…" || publishStep === "Updating draft post…"
                        ? "font-medium text-teal-600"
                        : ""
                    }
                  >
                    3. {publishStep === "Updating draft post…" ? "Updating draft post…" : "Creating draft post…"}
                  </li>
                </ol>
              )}
              {publishError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                  <p className="font-semibold text-rose-800">Could not publish draft</p>
                  <p className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{publishError}</p>
                  <p className="mt-3 text-xs text-rose-700/90">
                    Check <strong>Server logs</strong> in the sidebar (if configured), Vercel → Deployment → Functions logs, and{" "}
                    {isShopify
                      ? "Shopify Admin API token / shop host / Blog ID in Site settings."
                      : "WordPress application password / site URL in Site settings."}
                  </p>
                </div>
              ) : null}
              <p className="text-xs text-slate-500">
                Nothing is sent to {cmsName} until you click <span className="font-medium">Publish as Draft</span>. Edit
                content or images above first if needed.
              </p>
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
              >
                {publishing ? `Sending to ${cmsName}…` : `Publish as Draft to ${selectedSite?.name ?? ""}`}
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-slate-500">
              {publishing
                ? `Sending draft to ${cmsName}…`
                : `Approve content and images above, then click Publish as Draft to send to ${cmsName}.`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
