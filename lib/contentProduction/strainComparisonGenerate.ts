import { NextResponse } from "next/server";

import { callClaude, isClaudeServiceUnavailableError } from "@/lib/anthropic";

import { errorMessage, serverLog } from "@/lib/serverLog";

import { stripLeadingPostTitleH1 } from "@/lib/postHtml";

import { ensureStrainComparisonComplete } from "@/lib/contentProduction/strainComparisonCompleteness";

import {

  formatVerifiedLinksForPrompt,

  gatherVerifiedStrainComparisonLinks,

  ensureStrainComparisonInternalLinks,

  sanitizeStrainComparisonLinks,

  countAllowlistedLinks,

} from "@/lib/contentProduction/strainComparisonLinks";

import {

  strainComparisonFocusKeyword,

  strainComparisonMetaDescription,

  strainComparisonMetaTitle,

  strainComparisonPostTitle,

  strainComparisonSlug,

  strainComparisonSystemPrompt,

  buildStrainComparisonUserMessage,

  ensureStrainComparisonSeedsSection,

  stripRoyLayer3Signoff,

  stripStrainWordSuffix,

} from "@/lib/contentProduction/strainComparison";

import { getSiteById, WP_TOOL_SCOPE } from "@/lib/wpSites";



export async function postStrainComparisonGenerate(request: Request) {

  try {

    const body = await request.json();

    const {

      siteId,

      strainA,

      strainB,

      strainAUrl,

      strainBUrl,

      primaryUseCase,

    } = body as {

      siteId?: string;

      strainA?: string;

      strainB?: string;

      strainAUrl?: string;

      strainBUrl?: string;

      primaryUseCase?: string;

    };



    const a = stripStrainWordSuffix(typeof strainA === "string" ? strainA.trim() : "");

    const b = stripStrainWordSuffix(typeof strainB === "string" ? strainB.trim() : "");

    if (!siteId || !a || !b) {

      return NextResponse.json({ error: "Missing required fields: siteId, strainA, strainB" }, { status: 400 });

    }

    if (a.toLowerCase() === b.toLowerCase()) {

      return NextResponse.json({ error: "strainA and strainB must be different" }, { status: 400 });

    }



    const site = await getSiteById(siteId, WP_TOOL_SCOPE.weedComContentProduction);

    if (!site) {

      return NextResponse.json({ error: "Site not found" }, { status: 404 });

    }



    const siteOrigin = (site.url ?? "").replace(/\/$/, "");

    const title = strainComparisonPostTitle(a, b);

    const keywords = [strainComparisonFocusKeyword(a, b)];



    const verified = await gatherVerifiedStrainComparisonLinks({

      site,

      siteId,

      strainA: a,

      strainB: b,

      strainAUrl: typeof strainAUrl === "string" ? strainAUrl : undefined,

      strainBUrl: typeof strainBUrl === "string" ? strainBUrl : undefined,

      keywords,

      title,

    });



    const userMessage = buildStrainComparisonUserMessage({

      strainA: a,

      strainB: b,

      strainAUrl: verified.strainAUrl,

      strainBUrl: verified.strainBUrl,

      primaryUseCase: typeof primaryUseCase === "string" ? primaryUseCase : undefined,

      verifiedLinks: formatVerifiedLinksForPrompt(verified.links),

    });



    const tone = site.tone_prompt ?? "Write in a clear, authoritative, and engaging editorial tone.";

    const raw = await callClaude(`${tone}\n\n${strainComparisonSystemPrompt()}`, userMessage, {

      maxTokens: 8192,

    });



    let html = stripLeadingPostTitleH1(

      raw.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").replace(/\u2014/g, " - ").trim()

    );

    html = await ensureStrainComparisonComplete(html, a, b, verified.allowlist, siteOrigin);

    html = ensureStrainComparisonInternalLinks(html, a, b, verified.links, siteOrigin);

    html = sanitizeStrainComparisonLinks(html, verified.allowlist, siteOrigin);

    html = ensureStrainComparisonSeedsSection(html, a, b, siteOrigin);

    html = stripRoyLayer3Signoff(html);

    const internalLinkCount = countAllowlistedLinks(html, verified.allowlist, siteOrigin);



    return NextResponse.json({

      title,

      content: html,

      keywords,

      slug: strainComparisonSlug(a, b),

      suggestedPath: `/learn/${strainComparisonSlug(a, b)}/`,

      seo: {

        focusKeyword: strainComparisonFocusKeyword(a, b),

        metaTitle: strainComparisonMetaTitle(a, b),

        metaDescription: strainComparisonMetaDescription(a, b),

      },

      strains: {

        a,

        b,

        strainAUrl: verified.strainAUrl,

        strainBUrl: verified.strainBUrl,

      },

      verifiedInternalLinks: verified.links.map((l) => ({

        label: l.label,

        url: l.url,

        kind: l.kind,

      })),

      linkWarnings: [

        ...(!verified.strainAUrl ? [`No verified page for ${a} — strain A is not linked.`] : []),

        ...(!verified.strainBUrl ? [`No verified page for ${b} — strain B is not linked.`] : []),

        ...(verified.links.length === 0

          ? ["No internal links verified — article has no weed.com hyperlinks."]

          : internalLinkCount < Math.min(3, verified.links.length)

            ? [`Only ${internalLinkCount} verified internal link(s) in draft — expected at least ${Math.min(3, verified.links.length)}.`]

            : []),

      ],

    });

  } catch (err) {

    const msg = errorMessage(err);

    console.error("[strain-comparison/generate] Error:", msg);

    void serverLog({ level: "error", source: "weed-com-strain-comparison/generate", message: msg });

    const status = isClaudeServiceUnavailableError(err) ? 503 : 500;

    return NextResponse.json({ error: msg || "Failed to generate strain comparison" }, { status });

  }

}


