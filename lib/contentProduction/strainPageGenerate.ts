import { NextResponse } from "next/server";
import { callClaude, isClaudeServiceUnavailableError } from "@/lib/anthropic";
import { stripLeadingPostTitleH1 } from "@/lib/postHtml";
import { ensureStrainPageComplete } from "@/lib/contentProduction/strainPageCompleteness";
import {
  countAllowlistedStrainPageLinks,
  ensureStrainPageInternalLinks,
  formatVerifiedStrainPageLinksForPrompt,
  gatherVerifiedStrainPageLinks,
  sanitizeStrainPageLinks,
} from "@/lib/contentProduction/strainPageLinks";
import { stripStrainWordSuffix } from "@/lib/contentProduction/strainComparison";
import {
  buildStrainPageUserMessage,
  ensureStrainPageClonesSection,
  ensureStrainPageSeedsSection,
  formatStrainDisplayName,
  parseStrainPageModelResponse,
  strainPageFocusKeyword,
  strainPageMetaDescription,
  strainPageMetaTitle,
  strainPagePostTitle,
  strainPageSlug,
  strainPageSuggestedPath,
  strainPageSystemPrompt,
} from "@/lib/contentProduction/strainPage";
import { errorMessage, serverLog } from "@/lib/serverLog";
import { getSiteById, WP_TOOL_SCOPE } from "@/lib/wpSites";

export async function postStrainPageGenerate(request: Request) {
  try {
    const body = await request.json();
    const { siteId, strainName, strainUrl, lineageNotes } = body as {
      siteId?: string;
      strainName?: string;
      strainUrl?: string;
      lineageNotes?: string;
    };

    const name = stripStrainWordSuffix(typeof strainName === "string" ? strainName.trim() : "");
    if (!siteId || !name) {
      return NextResponse.json({ error: "Missing required fields: siteId, strainName" }, { status: 400 });
    }

    const site = await getSiteById(siteId, WP_TOOL_SCOPE.weedComContentProduction);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const siteOrigin = (site.url ?? "").replace(/\/$/, "");
    const title = strainPagePostTitle(name);
    const keywords = [strainPageFocusKeyword(name)];

    const verified = await gatherVerifiedStrainPageLinks({
      site,
      strainName: name,
      strainUrl: typeof strainUrl === "string" ? strainUrl : undefined,
    });

    const userMessage = buildStrainPageUserMessage({
      strainName: name,
      lineageNotes: typeof lineageNotes === "string" ? lineageNotes : undefined,
      verifiedLinks: formatVerifiedStrainPageLinksForPrompt(verified.links),
    });

    const tone = site.tone_prompt ?? "Write in a clear, authoritative, and engaging editorial tone.";
    const raw = await callClaude(`${tone}\n\n${strainPageSystemPrompt()}`, userMessage, {
      maxTokens: 8192,
    });

    const { customFields, html: rawHtml } = parseStrainPageModelResponse(raw);

    const verifiedWithFields = await gatherVerifiedStrainPageLinks({
      site,
      strainName: name,
      strainUrl: typeof strainUrl === "string" ? strainUrl : undefined,
      customFields,
    });

    let html = stripLeadingPostTitleH1(rawHtml);
    html = await ensureStrainPageComplete(html, name, verifiedWithFields.allowlist, siteOrigin);
    html = ensureStrainPageInternalLinks(html, name, verifiedWithFields.links, siteOrigin);
    html = sanitizeStrainPageLinks(html, verifiedWithFields.allowlist, siteOrigin);
    html = ensureStrainPageSeedsSection(html, name, siteOrigin);
    html = ensureStrainPageClonesSection(html, name, siteOrigin);

    const internalLinkCount = countAllowlistedStrainPageLinks(
      html,
      verifiedWithFields.allowlist,
      siteOrigin
    );

    return NextResponse.json({
      title,
      content: html,
      keywords,
      slug: strainPageSlug(name),
      suggestedPath: strainPageSuggestedPath(name),
      customFields,
      seo: {
        focusKeyword: strainPageFocusKeyword(name),
        metaTitle: strainPageMetaTitle(name),
        metaDescription: strainPageMetaDescription(name, customFields),
      },
      strain: {
        name: formatStrainDisplayName(name),
        strainUrl: verifiedWithFields.strainUrl,
      },
      verifiedInternalLinks: verifiedWithFields.links.map((l) => ({
        label: l.label,
        url: l.url,
        kind: l.kind,
      })),
      linkWarnings: [
        ...(!verifiedWithFields.strainUrl
          ? [`No verified existing page for ${name} — publish will create a new draft.`]
          : []),
        ...(verifiedWithFields.links.length === 0
          ? ["No internal links verified — article has no weed.com hyperlinks."]
          : internalLinkCount < Math.min(4, verifiedWithFields.links.length)
            ? [
                `Only ${internalLinkCount} verified internal link(s) in draft — expected at least ${Math.min(4, verifiedWithFields.links.length)}.`,
              ]
            : []),
      ],
    });
  } catch (err) {
    const msg = errorMessage(err);
    console.error("[strain-page/generate] Error:", msg);
    void serverLog({ level: "error", source: "weed-com-strain-page/generate", message: msg });
    const status = isClaudeServiceUnavailableError(err) ? 503 : 500;
    return NextResponse.json({ error: msg || "Failed to generate strain page" }, { status });
  }
}
