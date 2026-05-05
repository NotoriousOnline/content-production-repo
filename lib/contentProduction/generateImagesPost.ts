import { NextResponse } from "next/server";
import { callClaude } from "@/lib/anthropic";
import { errorMessage, serverLog } from "@/lib/serverLog";
import { generateImage, httpStatusForImageGenerationError } from "@/lib/geminiClient";
import { isPrefabSite } from "@/lib/contentProduction/greenOrgCategoryPicker";
import { getSiteById, WP_TOOL_SCOPE, type WPToolScope } from "@/lib/wpSites";

/** Featured + in-content article images only (Shop Now product thumbnails are separate HTML). */
const STYLE_GUIDELINE =
  "Photorealistic, high quality, professional photography style. No text overlays, no logos, no watermarks. Wide horizontal landscape rectangle (approximately 16:9 or 2:1), not square. The scene must fill the frame edge-to-edge: no large empty bands of sky, flat white, or unused space above or below the subject — avoid letterboxed, poster, or tall compositions with blank margins; compose so the image reads as one clear rectangular photo.";

const WEED_IMAGE_ADDENDUM = `

Weed.com: Keep imagery editorial and brand-safe—legal-age, educational or lifestyle context; no explicit consumption, no targeting minors, no medical claims in visuals; avoid gratuitous imagery. Hero and section images: landscape rectangle, subject fills the frame (no empty vertical bands).`;

type H2Section = { h2Index: number; heading: string; contextSnippet: string };

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractH2SectionsWithContext(html: string): H2Section[] {
  const h2Regex = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const sections: H2Section[] = [];
  let match;
  let h2Index = 0;
  while ((match = h2Regex.exec(html)) !== null) {
    const start = match.index + match[0].length;
    const heading = stripTags(match[1]);
    const rest = html.slice(start);
    const nextH2 = rest.search(/<h2[\s>]/i);
    const block = nextH2 === -1 ? rest : rest.slice(0, nextH2);
    const contextSnippet = stripTags(block).slice(0, 450).trim();
    sections.push({ h2Index: h2Index++, heading, contextSnippet });
  }
  return sections;
}

function isFaqSection(heading: string): boolean {
  return /faq|frequently\s+asked|questions?\s+and\s+answers?/i.test(heading);
}

function placementCandidates(sections: H2Section[]): H2Section[] {
  return sections.filter((s) => s.heading && !isFaqSection(s.heading));
}

function targetInContentCount(candidates: H2Section[]): number {
  if (candidates.length === 0) return 0;
  if (candidates.length < 3) return candidates.length;
  return Math.min(4, candidates.length);
}

function extractJson(text: string): unknown {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) cleaned = objMatch[0];
  cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(cleaned);
}

function sanitizeFileSlug(s: string): string {
  const t = s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 55);
  return t || "section-image";
}

type GeneratedImagePayload = {
  type: "featured" | "in-content";
  index: number;
  prompt: string;
  base64: string;
  mimeType: string;
  altText: string;
  fileSlug: string;
  h2Index?: number;
  sectionHeading?: string;
};

export async function postGenerateImages(request: Request, toolScope: WPToolScope) {
  try {
    const body = await request.json();
    const { title, keywords, content, wordCount, siteId } = body;

    if (!title || !Array.isArray(keywords) || !content || typeof wordCount !== "number") {
      return NextResponse.json(
        { error: "Missing or invalid fields: title, keywords (array), content, wordCount (number)" },
        { status: 400 }
      );
    }
    const site =
      typeof siteId === "string" && siteId.trim().length > 0 ? await getSiteById(siteId, toolScope) : null;
    const prefabSite = site != null && isPrefabSite(site);

    const allSections = extractH2SectionsWithContext(content);
    const candidates = placementCandidates(allSections);
    const inContentTarget = targetInContentCount(candidates);

    const candidatesBlock = candidates
      .map(
        (s) =>
          `- h2Index ${s.h2Index}: "${s.heading}"\n  Context: ${s.contextSnippet.slice(0, 320)}${s.contextSnippet.length > 320 ? "…" : ""}`
      )
      .join("\n\n");

    const weedExtra = toolScope === WP_TOOL_SCOPE.weedComContentProduction ? WEED_IMAGE_ADDENDUM : "";
    const prefabAspectExtra = prefabSite
      ? "\nPrefab.com: prefer a less-rectangular composition (roughly 1200x850 feel, around 4:3-ish) instead of extra-wide banners."
      : "";

    const systemPrompt = `You generate image briefs for a blog article. Return ONLY valid JSON, no markdown.
Style for every imagePrompt: "${STYLE_GUIDELINE}" (append this intent inside each imagePrompt string).${weedExtra}${prefabAspectExtra}

Return JSON shape:
{
  "featured": {
    "imagePrompt": "string (detailed scene for hero image matching the article title and theme)",
    "altText": "string (concise accessibility description, max 125 characters, no keyword stuffing)",
    "fileSlug": "string — kebab-case filename stem, lowercase a-z 0-9 hyphen only, max 50 chars"
  },
  "inContent": [
    {
      "h2Index": number — must match one of the provided h2Index values exactly,
      "imagePrompt": "string — scene that specifically illustrates THAT section's topic and context, not generic stock",
      "altText": "string — describes the image for screen readers in context of that section, max 125 chars",
      "fileSlug": "string — kebab-case tied to section topic"
    }
  ]
}

Rules:
- Featured and in-content images only (not product cards): wide landscape rectangle; fill the frame with subject and environment — no big empty vertical whitespace or letterboxing look.
- Generate exactly ${inContentTarget} objects in inContent (not more, not fewer).
- Each inContent.h2Index must be unique and must appear in the candidate list below.
- Choose sections where a visual adds the most value (skip FAQ-style headings; they are not listed).
- imagePrompt must be specific to the section content, not a repeat of the hero.`;

    const userMessage = `Article title: ${title}
Keywords: ${keywords.join(", ")}

H2 sections eligible for in-content images (use these h2Index values only):
${candidatesBlock || "(none — return empty inContent array)"}

Target: 1 featured + ${inContentTarget} in-content images.`;

    const raw = await callClaude(systemPrompt, userMessage);
    let parsed: {
      featured?: string | { imagePrompt?: string; altText?: string; fileSlug?: string };
      inContent?: Array<{
        h2Index?: number;
        imagePrompt?: string;
        altText?: string;
        fileSlug?: string;
      }>;
    };
    try {
      parsed = extractJson(raw) as typeof parsed;
    } catch {
      return NextResponse.json(
        { error: "Claude returned malformed JSON for image prompts" },
        { status: 500 }
      );
    }

    const featuredRaw = parsed.featured;
    let featuredPrompt: string;
    let featuredAlt: string;
    let featuredSlug: string;
    if (typeof featuredRaw === "string") {
      featuredPrompt = featuredRaw;
      featuredAlt = `${title.slice(0, 100)} featured image`.slice(0, 125);
      featuredSlug = sanitizeFileSlug(title);
    } else {
      featuredPrompt = featuredRaw?.imagePrompt ?? "Professional photograph representing the article theme.";
      featuredAlt = (featuredRaw?.altText ?? title).slice(0, 125);
      featuredSlug = sanitizeFileSlug(featuredRaw?.fileSlug ?? title);
    }

    const allowedIndices = new Set(candidates.map((c) => c.h2Index));
    const sectionByIndex = new Map(candidates.map((c) => [c.h2Index, c]));

    let inRows = Array.isArray(parsed.inContent) ? parsed.inContent : [];
    inRows = inRows.filter(
      (row) =>
        typeof row.h2Index === "number" &&
        allowedIndices.has(row.h2Index) &&
        typeof row.imagePrompt === "string"
    );
    const seen = new Set<number>();
    inRows = inRows.filter((row) => {
      if (seen.has(row.h2Index!)) return false;
      seen.add(row.h2Index!);
      return true;
    });
    inRows = inRows.slice(0, inContentTarget);

    const promptsToGenerate: {
      type: "featured" | "in-content";
      index: number;
      prompt: string;
      altText: string;
      fileSlug: string;
      h2Index?: number;
      sectionHeading?: string;
    }[] = [
      {
        type: "featured",
        index: 0,
        prompt: `${featuredPrompt} ${STYLE_GUIDELINE}`,
        altText: featuredAlt,
        fileSlug: featuredSlug,
      },
      ...inRows.map((row, i) => {
        const sec = sectionByIndex.get(row.h2Index!);
        return {
          type: "in-content" as const,
          index: i + 1,
          prompt: `${row.imagePrompt} ${STYLE_GUIDELINE}`,
          altText: (row.altText ?? sec?.heading ?? "Section illustration").slice(0, 125),
          fileSlug: sanitizeFileSlug(row.fileSlug ?? sec?.heading ?? `section-${i + 1}`),
          h2Index: row.h2Index,
          sectionHeading: sec?.heading,
        };
      }),
    ];

    const results: GeneratedImagePayload[] = [];

    for (const item of promptsToGenerate) {
      const { base64, mimeType } = await generateImage(item.prompt, { aspectRatio: prefabSite ? "4:3" : "16:9" });
      results.push({
        type: item.type,
        index: item.index,
        prompt: item.prompt,
        base64,
        mimeType,
        altText: item.altText,
        fileSlug: item.fileSlug,
        h2Index: item.h2Index,
        sectionHeading: item.sectionHeading,
      });
    }

    return NextResponse.json(results);
  } catch (err) {
    const msg = errorMessage(err);
    console.error("[generate-images] Error:", msg);
    void serverLog({ level: "error", source: "content-production/generate-images", message: msg });
    const status = httpStatusForImageGenerationError(err);
    return NextResponse.json({ error: msg || "Failed to generate images" }, { status });
  }
}
