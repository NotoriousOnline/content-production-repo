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
  strainComparisonOutlineArchitectPrompt,
  buildStrainComparisonOutlineUserMessage,
  parseStrainComparisonOutline,
  strainComparisonSectionSubstancePrompt,
  buildStrainComparisonSectionMaterial,
  strainComparisonIntroPrompt,
  strainComparisonIntroPattern,
  buildStrainComparisonIntroUserMessage,
  strainComparisonConclusionPrompt,
  strainComparisonConclusionPattern,
  buildStrainComparisonConclusionUserMessage,
  strainComparisonFaqPrompt,
  buildStrainComparisonFaqUserMessage,
  formatStrainComparisonPaaList,
  formatStrainComparisonOutlineGaps,
  parseStrainComparisonFaqJson,
  strainComparisonFaqItemsToMarkdown,
  STRAIN_COMPARISON_FAQ_MIN,
  STRAIN_COMPARISON_FAQ_MAX,
  strainComparisonAssembleMarkdownPrompt,
  buildStrainComparisonAssembleUserMessage,
  strainComparisonManagingEditorPrompt,
  buildStrainComparisonManagingEditorUserMessage,
  parseStrainComparisonEditorReview,
  extractMarkdownSection,
  replaceMarkdownSection,
  strainComparisonHumanizePrompt,
  flagLikelyAiPassages,
  buildHardAiRewriteUserMessage,
  pickEarmarkedLinksForSection,
  buildStrainComparisonVoiceUserMessage,
  ensureStrainComparisonSeedsSection,
  stripRoyLayer3Signoff,
  stripStrainWordSuffix,
  type StrainComparisonOutline,
  type StrainComparisonOutlineH2,
} from "@/lib/contentProduction/strainComparison";
import { resolveStrainComparisonVoiceGuide } from "@/lib/contentProduction/strainComparisonVoiceGuide";
import { enforceHumanisationInCode, detectLoop, detectArticleAiScore } from "@/lib/contentProduction/humanisationGuards";
import { getSiteById, WP_TOOL_SCOPE } from "@/lib/wpSites";

function stripModelFences(raw: string): string {
  return raw
    .replace(/^```(?:markdown|md|html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/\u2014/g, " - ")
    .trim();
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function sectionKindHint(section: StrainComparisonOutlineH2): "buy" | "effects" | "body" {
  const blob = `${section.heading} ${section.intent}`.toLowerCase();
  if (/buy|shop|purchase|where to/.test(blob)) return "buy";
  if (/effect|feel|high|experience|onset/.test(blob)) return "effects";
  return "body";
}

async function humanizeSectionMarkdown(markdown: string, voiceGuide: string): Promise<string> {
  const trimmed = markdown.trim();
  if (!trimmed) return trimmed;
  const rewritten = stripModelFences(
    await callClaude(strainComparisonHumanizePrompt(voiceGuide), trimmed, { maxTokens: 3072 })
  );
  return rewritten || trimmed;
}

/** After humanize: if AI-tells remain, rewrite those passages harder. */
async function hardRewriteIfFlagged(markdown: string): Promise<string> {
  const trimmed = markdown.trim();
  if (!trimmed) return trimmed;
  const flagged = flagLikelyAiPassages(trimmed);
  if (flagged.length === 0) return trimmed;

  const rewritten = stripModelFences(
    await callClaude(
      "You rewrite AI-flagged prose harder while preserving meaning, names, numbers, and links.",
      buildHardAiRewriteUserMessage({ fullSectionMarkdown: trimmed, flaggedPassages: flagged }),
      { maxTokens: 3072 }
    )
  );
  return rewritten || trimmed;
}

async function polishSectionMarkdown(markdown: string, voiceGuide: string): Promise<string> {
  const humanized = await humanizeSectionMarkdown(markdown, voiceGuide);
  return hardRewriteIfFlagged(humanized);
}

/** Route send_back items through the voice-pass for that section, then re-splice. */
async function applyEditorSendBacks(args: {
  articleMarkdown: string;
  sendBack: Array<{ section: string; reason: string; fix: string }>;
  voiceGuide: string;
}): Promise<string> {
  let current = args.articleMarkdown;
  for (const item of args.sendBack.slice(0, 4)) {
    const found = extractMarkdownSection(current, item.section);
    if (!found) continue;
    const fixNote = [
      `Managing editor send-back for section "${item.section}".`,
      `Reason: ${item.reason || "(none)"}`,
      `Fix: ${item.fix || "Re-voice this section harder; keep facts/numbers/links identical."}`,
      "",
      "SECTION MARKDOWN TO RE-VOICE:",
      found.full,
    ].join("\n");
    const revoiced = stripModelFences(
      await callClaude(strainComparisonHumanizePrompt(args.voiceGuide), fixNote, { maxTokens: 3072 })
    );
    const polished = await hardRewriteIfFlagged(revoiced || found.full);
    // Re-locate after previous edits (positions may shift).
    const again = extractMarkdownSection(current, item.section);
    if (!again) {
      current = replaceMarkdownSection(current, found.start, found.end, polished);
    } else {
      current = replaceMarkdownSection(current, again.start, again.end, polished);
    }
  }
  return current;
}

/** Article-level voice pass for detectLoop — rewrite only flagged passages harder. */
async function voicePassFlaggedArticle(
  article: string,
  flagged: string[],
  voiceGuide: string
): Promise<string> {
  if (!flagged.length) return article;
  const rewritten = stripModelFences(
    await callClaude(
      strainComparisonHumanizePrompt(voiceGuide),
      [
        "Detector flagged the following passages as AI cadence / banned filler / oversized paragraphs.",
        "Rewrite ONLY those passages harder (split long paragraphs, kill filler, vary sentence length).",
        "Preserve every number, name, date, URL, and claim. Do not rewrite clean sections.",
        "",
        "FLAGGED PASSAGES:",
        flagged.map((p, i) => `--- flagged ${i + 1} ---\n${p}`).join("\n\n"),
        "",
        "FULL ARTICLE MARKDOWN (return complete article with only flagged passages rewritten):",
        article,
      ].join("\n"),
      { maxTokens: 8192 }
    )
  );
  const next = rewritten || article;
  // Second pass: hard AI rewrite helper when paragraphs still flagged by code
  return hardRewriteIfFlagged(next);
}

async function draftAndHumanizeMarkdown(args: {
  outline: StrainComparisonOutline;
  strainA: string;
  strainB: string;
  verifiedLinksText: string;
  primaryUseCase?: string;
  voiceGuide: string;
}): Promise<string> {
  const { outline, strainA, strainB, verifiedLinksText, primaryUseCase, voiceGuide } = args;

  // Body first so conclusion/intro can use full article context.
  const bodySections = await mapPool(outline.structure, 3, async (section) => {
    const kind = sectionKindHint(section);
    let markdown = stripModelFences(
      await callClaude(
        strainComparisonSectionSubstancePrompt({
          sectionHeading: `## ${section.heading}`,
          sectionIntent: section.intent,
          wordBudget: section.word_budget || 150,
        }),
        buildStrainComparisonSectionMaterial({
          strainA,
          strainB,
          outline,
          section,
          earmarkedLinks: pickEarmarkedLinksForSection(
            verifiedLinksText,
            section.heading,
            section.intent,
            kind
          ),
          primaryUseCase,
        }),
        { maxTokens: 3072 }
      )
    );
    if (!/^#+\s+/m.test(markdown)) {
      markdown = `## ${section.heading}\n\n${markdown}`;
    }
    return polishSectionMarkdown(markdown, voiceGuide);
  });

  const bodyOnlyMarkdown = bodySections.filter(Boolean).join("\n\n");

  // Conclusion after body: full body context + voice/humanisation in one pass.
  const closingRaw = stripModelFences(
    await callClaude(
      strainComparisonConclusionPrompt({
        conclusionPattern: strainComparisonConclusionPattern(outline.conclusion.approach),
        wordBudget: outline.conclusion.word_budget || 80,
        voiceGuide,
      }),
      buildStrainComparisonConclusionUserMessage({
        strainA,
        strainB,
        outline,
        bodyMarkdown: bodyOnlyMarkdown,
        earmarkedLinks: pickEarmarkedLinksForSection(
          verifiedLinksText,
          "Closing pick",
          outline.conclusion.approach,
          "buy"
        ),
      }),
      { maxTokens: 1536 }
    )
  );
  const closing = await hardRewriteIfFlagged(
    /^#+\s+/m.test(closingRaw) ? closingRaw : `## Closing pick\n\n${closingRaw}`
  );

  const bodyBeforeFaq = [bodyOnlyMarkdown, closing].filter(Boolean).join("\n\n");

  // FAQ after body+conclusion: JSON Q&A that avoids repeating body answers.
  const faqJsonRaw = stripModelFences(
    await callClaude(
      strainComparisonFaqPrompt({
        faqMin: STRAIN_COMPARISON_FAQ_MIN,
        faqMax: STRAIN_COMPARISON_FAQ_MAX,
        paaList: formatStrainComparisonPaaList({
          strainA,
          strainB,
          faqTopics: outline.faq_topics,
        }),
        faqTopics: outline.faq_topics,
        outlineGaps: formatStrainComparisonOutlineGaps(outline),
        voiceGuide,
      }),
      buildStrainComparisonFaqUserMessage({
        strainA,
        strainB,
        outline,
        bodyMarkdown: bodyBeforeFaq,
      }),
      { maxTokens: 3072 }
    )
  );
  const faqItems = parseStrainComparisonFaqJson(faqJsonRaw);
  const faq = await hardRewriteIfFlagged(strainComparisonFaqItemsToMarkdown(faqItems));

  const bodyMarkdown = [bodyBeforeFaq, faq].filter(Boolean).join("\n\n");

  // Intro last: full body for context + voice/humanisation in one pass.
  const introRaw = stripModelFences(
    await callClaude(
      strainComparisonIntroPrompt({
        introPattern: strainComparisonIntroPattern(outline.intro.opening_rule),
        wordBudget: outline.intro.word_budget || 100,
        voiceGuide,
      }),
      buildStrainComparisonIntroUserMessage({
        strainA,
        strainB,
        outline,
        earmarkedLinks: pickEarmarkedLinksForSection(
          verifiedLinksText,
          "Introduction",
          outline.intro.opening_rule,
          "intro"
        ),
        bodyMarkdown,
      }),
      { maxTokens: 2048 }
    )
  );
  const intro = await hardRewriteIfFlagged(introRaw);

  return [intro, ...bodySections, closing, faq].filter(Boolean).join("\n\n");
}

export async function postStrainComparisonGenerate(request: Request) {
  try {
    const body = await request.json();
    const { siteId, strainA, strainB, strainAUrl, strainBUrl, primaryUseCase } = body as {
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
    const useCase = typeof primaryUseCase === "string" ? primaryUseCase : undefined;
    const voiceGuide = resolveStrainComparisonVoiceGuide(site.tone_prompt);

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
    const verifiedLinksText = formatVerifiedLinksForPrompt(verified.links);

    // Step 1 — outline architect
    const outlineRaw = await callClaude(
      strainComparisonOutlineArchitectPrompt(),
      buildStrainComparisonOutlineUserMessage({ strainA: a, strainB: b, primaryUseCase: useCase }),
      { maxTokens: 4096 }
    );
    const outline = parseStrainComparisonOutline(outlineRaw);

    // Step 2–3 — substance drafts + humanization (+ hard AI rewrite) per section
    const voicedSectionsMarkdown = await draftAndHumanizeMarkdown({
      outline,
      strainA: a,
      strainB: b,
      verifiedLinksText,
      primaryUseCase: useCase,
      voiceGuide,
    });

    // Step 4 — light connective tissue only (no substance changes)
    const assembledMarkdown = stripModelFences(
      await callClaude(
        strainComparisonAssembleMarkdownPrompt(),
        buildStrainComparisonAssembleUserMessage({
          strainA: a,
          strainB: b,
          outline,
          sectionsMarkdown: voicedSectionsMarkdown,
        }),
        { maxTokens: 8192 }
      )
    );
    const continuousMarkdown = assembledMarkdown || voicedSectionsMarkdown;

    // Step 5 — managing editor review (light edits + optional voice-pass send_backs)
    let editorReviewMeta: {
      verdict: "approve" | "send_back";
      light_edits_applied: string[];
      send_back: Array<{ section: string; reason: string; fix: string }>;
    } | null = null;
    let reviewedMarkdown = continuousMarkdown;
    try {
      const editorRaw = stripModelFences(
        await callClaude(
          strainComparisonManagingEditorPrompt(voiceGuide),
          buildStrainComparisonManagingEditorUserMessage({
            strainA: a,
            strainB: b,
            outline,
            articleMarkdown: continuousMarkdown,
          }),
          { maxTokens: 8192 }
        )
      );
      const review = parseStrainComparisonEditorReview(editorRaw);
      editorReviewMeta = {
        verdict: review.verdict,
        light_edits_applied: review.light_edits_applied,
        send_back: review.send_back,
      };
      reviewedMarkdown = review.article_markdown;
      if (review.verdict === "send_back" && review.send_back.length > 0) {
        reviewedMarkdown = await applyEditorSendBacks({
          articleMarkdown: review.article_markdown,
          sendBack: review.send_back,
          voiceGuide,
        });
        editorReviewMeta = { ...editorReviewMeta, verdict: "approve" };
      }
    } catch (e) {
      console.warn("[strain-comparison] managing editor review skipped:", errorMessage(e));
      reviewedMarkdown = continuousMarkdown;
    }

    // Step 5b — Winston AI detectLoop (fallback: local code detector)
    const winstonThreshold = Number(process.env.WINSTON_AI_RISK_THRESHOLD ?? "30");
    const loop = await detectLoop({
      article: reviewedMarkdown,
      threshold: Number.isFinite(winstonThreshold) ? winstonThreshold : 30,
      maxRetries: Number(process.env.WINSTON_AI_MAX_RETRIES ?? "2") || 2,
      detectFn: detectArticleAiScore,
      voicePassFn: (article, flagged) => voicePassFlaggedArticle(article, flagged, voiceGuide),
    });
    reviewedMarkdown = loop.article;
    const finalGuard = enforceHumanisationInCode(reviewedMarkdown);
    editorReviewMeta = {
      verdict: loop.passed ? "approve" : "send_back",
      light_edits_applied: [
        ...(editorReviewMeta?.light_edits_applied ?? []),
        `detectLoop(${loop.source ?? "unknown"}): aiRisk=${loop.score}${
          loop.humanScore != null ? ` humanScore=${loop.humanScore}` : ""
        } attempts=${loop.attempts} passed=${loop.passed}`,
        ...finalGuard.blockHits.map((h) => `code-block remaining: "${h.match}"`),
        ...finalGuard.longParagraphs.map(() => "code: long paragraph remaining after detectLoop"),
      ],
      send_back: loop.passed ? [] : finalGuard.sendBacks,
    };

    // Step 6 — HTML conversion only (preserve editor-reviewed wording)
    const raw = await callClaude(
      `Convert already-voiced, editor-reviewed markdown into Weed.com article HTML. Preserve wording and transitions; do not invent facts.\n\n${strainComparisonSystemPrompt()}`,
      buildStrainComparisonVoiceUserMessage({
        strainA: a,
        strainB: b,
        strainAUrl: verified.strainAUrl,
        strainBUrl: verified.strainBUrl,
        primaryUseCase: useCase,
        verifiedLinks: verifiedLinksText,
        outline,
        substanceMarkdown: reviewedMarkdown,
      }),
      { maxTokens: 8192 }
    );

    let html = stripLeadingPostTitleH1(stripModelFences(raw));
    html = await ensureStrainComparisonComplete(html, a, b, verified.allowlist, siteOrigin, outline);
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
      outline: {
        angle: outline.angle,
        persona: outline.persona,
        structureHeadings: outline.structure.map((s) => s.heading),
        faqTopics: outline.faq_topics,
      },
      ...(editorReviewMeta
        ? {
            editorReview: {
              verdict: editorReviewMeta.verdict,
              lightEditsApplied: editorReviewMeta.light_edits_applied,
              sendBack: editorReviewMeta.send_back,
            },
          }
        : {}),
      codeGuards: {
        detectLoop: {
          source: loop.source ?? "code",
          score: loop.score,
          humanScore: loop.humanScore ?? null,
          attempts: loop.attempts,
          passed: loop.passed,
          threshold: Number(process.env.WINSTON_AI_RISK_THRESHOLD ?? "30") || 30,
          escalateToHuman: !loop.passed,
          creditsRemaining: loop.creditsRemaining ?? null,
        },
        blockedPhraseCount: finalGuard.blockHits.length,
        warnPhraseCount: finalGuard.warnHits.length,
        longParagraphCount: finalGuard.longParagraphs.length,
        remainingSendBacks: finalGuard.sendBacks,
      },
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
