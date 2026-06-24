import { NextResponse } from "next/server";
import { errorMessage, serverLog } from "@/lib/serverLog";
import { generateImage, httpStatusForImageGenerationError } from "@/lib/geminiClient";
import { isPrefabSite } from "@/lib/contentProduction/greenOrgCategoryPicker";
import { resolveImageBriefs, type ImageBriefH2 } from "@/lib/contentProduction/imageBriefs";
import type { GenerateImagesResponse } from "@/lib/contentProduction/generateImagesResponse";
import { getSiteById, WP_TOOL_SCOPE, type WPToolScope } from "@/lib/wpSites";

/** Featured + in-content article images only (Shop Now product thumbnails are separate HTML). */
export const STYLE_GUIDELINE =
  "Photorealistic, high quality, professional photography style. No text overlays, no logos, no watermarks. Wide horizontal landscape rectangle (approximately 16:9 or 2:1), not square. The scene must fill the frame edge-to-edge: no large empty bands of sky, flat white, or unused space above or below the subject — avoid letterboxed, poster, or tall compositions with blank margins; compose so the image reads as one clear rectangular photo.";

const WEED_IMAGE_ADDENDUM = `

Weed.com: Keep imagery editorial and brand-safe—legal-age, educational or lifestyle context; no explicit consumption, no targeting minors, no medical claims in visuals; avoid gratuitous imagery. Hero and section images: landscape rectangle, subject fills the frame (no empty vertical bands).`;

const STRAIN_COMPARISON_IMAGE_ADDENDUM = `

Strain comparison (/learn/...-vs-.../): Featured image should evoke both strains in one editorial composition (split still-life, contrasting bud colors/textures, or balanced side-by-side arrangement)—no text overlays. In-content images should illustrate the specific H2 topic (lineage/effects, key differences, use case)—not generic stock cannabis.`;

const STRAIN_PAGE_IMAGE_ADDENDUM = `

Individual strain page (/strains/[slug]/): Featured image must be a strain-specific dried bud close-up, minimum 600x600px feel, square composition. No white studio backgrounds, no smoke photography, no generic cannabis leaf graphics. In-content image (1 only): terpene profile graphic showing the 3 dominant terpenes using the canonical colour system (Myrcene=Green, Caryophyllene=Red, Limonene=Yellow, Pinene=Blue, Terpinolene=Orange, Linalool=Purple, Humulene=Brown, Ocimene=Teal). Clean infographic style, no text labels required if colours are distinct.`;

/** Extra pause between sequential Gemini calls when generating a batch (reduces 429 bursts). */
const BATCH_IMAGE_GAP_MS = 6000;

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractH2SectionsWithContext(html: string): ImageBriefH2[] {
  const h2Regex = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const sections: ImageBriefH2[] = [];
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

function placementCandidates(sections: ImageBriefH2[]): ImageBriefH2[] {
  return sections.filter((s) => s.heading && !isFaqSection(s.heading));
}

function targetInContentCount(candidates: ImageBriefH2[], maxOverride?: number): number {
  if (candidates.length === 0) return 0;
  let count: number;
  if (candidates.length < 3) count = candidates.length;
  else count = Math.min(4, candidates.length);
  if (maxOverride != null && Number.isFinite(maxOverride) && maxOverride > 0) {
    count = Math.min(count, Math.floor(maxOverride));
  }
  return count;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function postGenerateImages(request: Request, toolScope: WPToolScope) {
  try {
    const body = await request.json();
    const { title, keywords, content, wordCount, siteId, maxInContentImages, imageContext, strainComparison, strainPage } =
      body as {
        title?: string;
        keywords?: unknown;
        content?: string;
        wordCount?: number;
        siteId?: string;
        maxInContentImages?: number;
        imageContext?: string;
        strainComparison?: boolean;
        strainPage?: boolean;
      };

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
    const maxInContent =
      typeof maxInContentImages === "number" && Number.isFinite(maxInContentImages)
        ? Math.floor(maxInContentImages)
        : undefined;
    const inContentTarget =
      strainPage === true
        ? Math.min(1, targetInContentCount(candidates, maxInContent))
        : targetInContentCount(candidates, maxInContent);

    const candidatesBlock = candidates
      .map(
        (s) =>
          `- h2Index ${s.h2Index}: "${s.heading}"\n  Context: ${s.contextSnippet.slice(0, 320)}${s.contextSnippet.length > 320 ? "…" : ""}`
      )
      .join("\n\n");

    const weedExtra =
      toolScope === WP_TOOL_SCOPE.weedComContentProduction
        ? `${WEED_IMAGE_ADDENDUM}${strainComparison === true ? STRAIN_COMPARISON_IMAGE_ADDENDUM : ""}${strainPage === true ? STRAIN_PAGE_IMAGE_ADDENDUM : ""}`
        : "";
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

    const contextBlock =
      typeof imageContext === "string" && imageContext.trim() ? `\n\nAdditional context:\n${imageContext.trim()}` : "";

    const userMessage = `Article title: ${title}
Keywords: ${keywords.join(", ")}${contextBlock}

H2 sections eligible for in-content images (use these h2Index values only):
${candidatesBlock || "(none — return empty inContent array)"}

Target: 1 featured + ${inContentTarget} in-content images.`;

    const briefs = await resolveImageBriefs({
      systemPrompt,
      userMessage,
      title,
      keywords,
      candidates,
      inContentTarget,
      styleGuideline: STYLE_GUIDELINE,
      strainComparison: strainComparison === true,
      strainPage: strainPage === true,
    });

    const sectionByIndex = new Map(candidates.map((c) => [c.h2Index, c]));

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
        prompt: `${briefs.featured.imagePrompt} ${STYLE_GUIDELINE}`,
        altText: briefs.featured.altText,
        fileSlug: briefs.featured.fileSlug,
      },
      ...briefs.inContent.map((row, i) => {
        const sec = sectionByIndex.get(row.h2Index);
        return {
          type: "in-content" as const,
          index: i + 1,
          prompt: `${row.imagePrompt} ${STYLE_GUIDELINE}`,
          altText: row.altText,
          fileSlug: row.fileSlug,
          h2Index: row.h2Index,
          sectionHeading: sec?.heading,
        };
      }),
    ];

    const results: GenerateImagesResponse["images"] = [];
    const warnings: string[] = [];

    if (briefs.source === "deterministic") {
      warnings.push(
        "Image prompts were built locally (Claude unavailable or out of credits). Gemini will still generate the images."
      );
    }

    for (let i = 0; i < promptsToGenerate.length; i++) {
      const item = promptsToGenerate[i];
      if (i > 0) await sleep(BATCH_IMAGE_GAP_MS);
      try {
        const { base64, mimeType } = await generateImage(item.prompt, {
          aspectRatio: prefabSite ? "4:3" : strainPage === true && item.type === "featured" ? "1:1" : "16:9",
        });
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
      } catch (err) {
        const label =
          item.type === "featured"
            ? "Featured image"
            : `In-content image (${item.sectionHeading ?? item.index})`;
        warnings.push(`${label}: ${errorMessage(err)}`);
        console.warn(`[generate-images] ${label} failed:`, errorMessage(err));
      }
    }

    if (results.length === 0) {
      return NextResponse.json(
        {
          error:
            warnings.join(" ") ||
            "No images could be generated. Gemini may be rate-limited — wait a minute and retry, or set GEMINI_IMAGE_MODEL=gemini-2.5-flash-image in .env.local.",
        },
        { status: httpStatusForImageGenerationError(new Error(warnings[0] ?? "")) }
      );
    }

    const payload: GenerateImagesResponse = {
      images: results,
      imageBriefSource: briefs.source,
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    return NextResponse.json(
      warnings.length > 0 || briefs.source === "deterministic" ? payload : results
    );
  } catch (err) {
    const msg = errorMessage(err);
    console.error("[generate-images] Error:", msg);
    void serverLog({ level: "error", source: "content-production/generate-images", message: msg });
    const status = httpStatusForImageGenerationError(err);
    return NextResponse.json({ error: msg || "Failed to generate images" }, { status });
  }
}
