import { NextResponse } from "next/server";
import { callClaude, isClaudeServiceUnavailableError } from "@/lib/anthropic";
import { errorMessage, serverLog } from "@/lib/serverLog";
import { lockExpertBoxTypography, stripLeadingPostTitleH1 } from "@/lib/postHtml";
import {
  filterLinkCandidatesToSiteOrigin,
  getCandidatesFromLibrary,
  pickCandidatesFromLivePosts,
  pickCandidatesFromLivePostsAndProducts,
  syncInternalLinksFromWordPress,
  syncProductInternalLinksFromWordPress,
  type LinkCandidate,
} from "@/lib/siteLinkLibrary";
import {
  buildTabibiLibraryUserBlock,
  selectRelevantTabibiEntries,
  type TabibiPmidEntry,
} from "@/lib/tabibiPmidDatabase";
import { appendTabibiSourcesFooter, pickTabibiSourcesForFooter } from "@/lib/tabibiSourcesFooter";
import { getSiteById, WP_TOOL_SCOPE, type WPToolScope } from "@/lib/wpSites";
import { fetchAllProductsForLinkLibrary, getPosts } from "@/lib/wordpressClient";

/** Richer pool for the model + Supabase library when synced. */
const INTERNAL_LINK_CANDIDATES_FOR_PROMPT = 14;
const LIBRARY_USE_MIN = 3;
const ALLOWED_WORD_COUNTS = new Set([1500, 2000, 2500, 3000]);
const WORD_COUNT_TOLERANCE_RATIO = 0.08;

/** Max characters of existing HTML accepted for refinement (existingHtml + refinementInstructions). */
const MAX_REFINEMENT_HTML_CHARS = 120_000;

const CONTENT_REFINEMENT_SYSTEM_TAIL = `You are editing existing article HTML (refinement pass). The user message contains CURRENT HTML and EDITOR INSTRUCTIONS.

Apply the instructions. Output the full revised article as raw HTML only (no markdown code fences, no triple backticks). Do not output <!DOCTYPE>, <html>, or <h1> (the CMS sets the post title separately).
Never use the em dash character (Unicode U+2014). Use a spaced hyphen " - " instead.

Preserve valid structure, inline styles, and classes (e.g. expert-box, Inter font rules) unless the instructions require changes. When adding or changing internal links, use only URLs from the Editorial posts and pages / Products lists in the user message when those lists are non-empty.

For Weed.com Learn: keep Expert Insight, FAQ, Sources, and legal footer consistent with the Bible when instructions touch those sections; do not introduce fabricated or mismatched PubMed PMIDs.
When the user message includes "TABIBI GOLD STANDARD CITATION LIBRARY", every PubMed PMID in Expert Insight must be from that list only. Do not add a Sources block; the server may append Sources from that library.

If instructions would violate citation safety or the Bible, prefer the smallest safe edit (hedge claims, omit unsafe citations) over inventing sources.`;

function replaceEmDashes(html: string): string {
  return html.replace(/\u2014/g, " - ").replace(/\u2013/g, "-");
}

const WEED_IMPORTANT_NOTICE_HTML = `<div style="margin: 2rem 0; padding: 1.25rem 1.5rem; border-radius: 0.75rem; background-color: #fffbeb; border: 1px solid #f59e0b; font-family: Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<p style="margin: 0 0 0.5rem; font-size: 0.875rem; font-weight: bold; color: #92400e; text-transform: uppercase; letter-spacing: 0.08em;">Important Notice</p>
<p style="margin: 0; font-size: 0.9375rem; line-height: 1.6; color: #78350f;">Cannabis affects individuals differently. If you have a history of anxiety, panic disorder, or other mental health conditions, consult a qualified healthcare provider before using any cannabis product. This article is for informational purposes only and does not constitute medical advice. If you experience severe anxiety, chest pain, difficulty breathing, or feel you are in crisis, call 911 or go to your nearest emergency room immediately.</p>
</div>
<p style="font-family: Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size: 0.875rem; line-height: 1.6; color: #64748b; margin: 2rem 0 0; padding-top: 1.25rem; border-top: 1px solid #e2e8f0;">For adults 21+ only. Cannabis laws vary by state. This content is intended for informational purposes only and does not constitute medical or legal advice. If you are experiencing a medical emergency, call 911 or go to your nearest emergency room immediately.</p>`;

function appendWeedImportantNoticeIfRequested(html: string, enabled: boolean): string {
  if (!enabled) return html;
  if (/Important Notice/i.test(html) && /Cannabis affects individuals differently/i.test(html)) return html;
  return `${html.trimEnd()}\n\n${WEED_IMPORTANT_NOTICE_HTML}`;
}

/**
 * Remove ad-hoc in-body "Important Notice" inserts so we only keep the canonical
 * bottom notice configured in this tool.
 */
function stripInBodyImportantNotice(html: string): string {
  let out = html;
  // Remove any div block explicitly labeled "Important Notice".
  out = out.replace(
    /<div\b[^>]*>[\s\S]*?<p\b[^>]*>\s*Important Notice\s*<\/p>[\s\S]*?<\/div>/gi,
    ""
  );
  // Remove the specific middle paragraph variant that was appearing in drafts.
  out = out.replace(
    /<p\b[^>]*>\s*THC gummies are not a substitute for medical care\.[\s\S]*?does not constitute medical advice\.\s*<\/p>/gi,
    ""
  );
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** HTML + inline styles use more tokens than plain text; cap at Anthropic output limit. */
const ANTHROPIC_MAX_OUTPUT_TOKENS = 8192;

function maxTokensForArticleHtml(wordCount: number): number {
  const estimated = Math.ceil(wordCount * 3.8);
  return Math.min(ANTHROPIC_MAX_OUTPUT_TOKENS, Math.max(4096, estimated));
}

function countWordsFromHtml(html: string): number {
  const plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-zA-Z0-9#]+;/g, " ");
  return plain.split(/\s+/).filter(Boolean).length;
}

function wordCountBounds(target: number): { min: number; max: number } {
  const min = Math.floor(target * (1 - WORD_COUNT_TOLERANCE_RATIO));
  const max = Math.ceil(target * (1 + WORD_COUNT_TOLERANCE_RATIO));
  return { min, max };
}

async function normalizeWordCountIfNeeded(
  html: string,
  title: string,
  keywords: string[],
  targetWordCount: number,
  toolScope: WPToolScope
): Promise<string> {
  const current = countWordsFromHtml(html);
  const { min, max } = wordCountBounds(targetWordCount);
  if (current >= min && current <= max) return html;

  const direction = current < min ? "expand" : "trim";
  const weedSafety =
    toolScope === WP_TOOL_SCOPE.weedComContentProduction
      ? " Keep Weed.com Learn compliance sections intact: Expert Insight blocks, FAQ, optional amber disclaimer when relevant, Sources, and legal footer."
      : "";
  const instructions = `Adjust only the article length to approximately ${targetWordCount} words (acceptable range ${min}-${max}). Current count is ${current}, so ${direction} where needed. Preserve the same structure, links, sections, and meaning.${weedSafety}`;

  const user = `Title: ${title}

Keywords: ${keywords.join(", ")}

----- EXISTING HTML -----
${html}
----- END EXISTING HTML -----

Editor instructions:
${instructions}

Output the complete revised HTML only. No markdown code fences.`;

  try {
    const revised = await callClaude(CONTENT_REFINEMENT_SYSTEM_TAIL, user, {
      maxTokens: maxTokensForArticleHtml(targetWordCount),
    });
    const cleaned = stripLeadingPostTitleH1(replaceEmDashes(stripHtmlCodeFences(revised)));
    return cleaned || html;
  } catch (e) {
    console.warn("[generate-content] Word-count normalization skipped:", errorMessage(e));
    return html;
  }
}

/** Second pass when the first response hits max_tokens before FAQ/footer (common with long body + inline HTML). */
const WEED_LEARN_APPEND_SYSTEM = `You complete truncated Weed.com Learn blog HTML. Output raw HTML only (no markdown fences, no em dash U+2014).

The user message has TITLE, KEYWORDS, and the TAIL of an article that stopped before the FAQ block or mid-sentence.

Output ONLY the continuation to append (do not repeat earlier paragraphs):
1) If the tail ends inside an open <p> without </p>, write the minimal words to finish the sentence, then </p>.
2) Then append FAQ (Bible outer div with Inter font-family, <h2>Frequently asked questions</h2>, then each <h3> + <p>) + amber disclaimer when relevant + legal footer only. Do NOT add a Sources HTML block (the server appends Sources from the Tabibi JSON). Amber box, FAQ wrapper, and footer: Bible inline style= templates with Inter for all text; copy style attributes exactly.
3) 3 to 5 FAQ pairs (exact count will be specified by caller); answers ~24-45 words each (concise, relevant, practical).
4) Legal footer: REQUIRED — must include verbatim "For adults 21+ only. Cannabis laws vary by state." plus 911/emergency room routing in the Bible <p> template. Never omit the legal footer.`;

async function finalizeWeedLearnHtml(
  html: string,
  title: string,
  keywords: string[]
): Promise<string> {
  const hasFaq = /Frequently asked questions/i.test(html);
  const hasFooter = /For adults 21\+ only/i.test(html);
  if (hasFaq && hasFooter) return html;

  const tail = html.length > 20000 ? html.slice(-20000) : html;
  const user = `Title: ${title}\nKeywords: ${keywords.join(", ")}\n\n----- TRUNCATED HTML (append after this) -----\n${tail}`;
  try {
    const extra = await callClaude(WEED_LEARN_APPEND_SYSTEM, user, { maxTokens: 6144 });
    const cleaned = replaceEmDashes(stripHtmlCodeFences(extra.trim()));
    if (!cleaned) return html;
    console.warn(
      "[generate-content] Weed Learn: first pass missing FAQ heading or legal footer; appended continuation pass"
    );
    return `${html.trimEnd()}\n${cleaned}`;
  } catch (e) {
    console.error("[generate-content] Weed Learn continuation failed:", errorMessage(e));
    return html;
  }
}

function stripHtmlCodeFences(text: string): string {
  let s = text.trim();
  if (s.startsWith("```")) {
    const nl = s.indexOf("\n");
    if (nl !== -1) {
      s = s.slice(nl + 1);
    } else {
      s = s.replace(/^```\w*\s*/, "");
    }
  }
  s = s.trimEnd();
  if (s.endsWith("```")) {
    s = s.slice(0, s.lastIndexOf("```")).trimEnd();
  }
  return s.trim();
}

function brandAddendumForScope(toolScope: WPToolScope): string {
  if (toolScope === WP_TOOL_SCOPE.weedComContentProduction) {
    return `

Weed.com editorial context: Audience is adults seeking cannabis education and culture content. Use a credible, approachable editorial voice. Where law, health, or dosage appear, stay informational and avoid medical claims; laws vary by jurisdiction - encourage readers to verify local rules. No marketing to minors. Align imagery-related sections with brand-safe, non-explicit phrasing.

Internal linking (editorial / Bible-style): Anchor text must be deliberate and descriptive. The reader should understand what they are navigating to before they click. Do not use vague anchors such as "this guide," "this breakdown," "this piece," "this article," "read more," "click here," or "learn more" unless immediately paired with clear topic words (prefer: drop those phrases entirely). Base anchors on the destination's subject matter; you may compress a long title but must keep the meaning. Match phrasing to the surrounding sentence so links feel earned, not bolted on.

Product mentions and editorial commerce: When citing a specific product or brand from the internal link list, weave it into the section's argument. Briefly set up why the example matters (reader goal, comparison, formulation type, use case) before the name or link. Avoid abrupt one-line product drops that read like affiliate widgets or interrupt a science/education block without transition. Prefer framing such as how readers weigh options in that category, then name the product as one concrete example. Stay factual; no unsubstantiated superiority claims.

Partner product priority: When the topic supports a commerce example, prefer Shop Now blocks for products from these brands when they appear in the internal link list: Binoid, Bloomz, Hometown Hero, Blazed, Cookies, and products sourced from Binoid or Blazed warehouses when catalog copy or URLs indicate that. Still only use links from the candidate list; do not invent URLs.

Layer 1 Expert Insight / YMYL (Contentenator): Before final output, enforce internal consistency on every Dr. Tabibi Expert Insight box — (1) study-type wording matches the PubMed record type (trial vs review vs meta-analysis, etc.), (2) every PMID is real and matches the cited paper (no fabricated or unrelated IDs), (3) specific claims trace to that same PMID, not to a primary study only mentioned inside a cited review. This gate is required before Layer 2 (human / Dr. Tabibi) review.`;
  }
  return "";
}

function isGardenSiteUrl(rawUrl: string): boolean {
  const raw = rawUrl.trim();
  if (!raw) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    return host === "garden.com" || host.endsWith(".garden.com");
  } catch {
    return /garden\.com/i.test(raw);
  }
}

function gardenComLayerPrompt(siteUrl: string): string {
  if (!isGardenSiteUrl(siteUrl)) return "";
  return `

GARDEN.COM CONTENTENATOR CONTEXT (Site Bible v4sm, April 2026) — apply to this article.

Brand identity and voice:
- Garden.com tone is specific, evidence-led, and useful. Never vague, salesy, or lifestyle-blog filler.
- Every practical care instruction must include a measurable detail (depth, unit, timeframe, or named cause).
- Use professional, accessible horticultural language. Do not use unattributed claims like "some gardeners say".

Evidence and citation requirements:
- Use primary horticultural authorities (RHS, Kew, ASPCA, NHS, or peer-reviewed sources) for factual claims.
- Include a Sources section at the article foot with live URLs for major claims.
- If a claim or citation is uncertain, keep the claim conservative and mark it with [VERIFY].

YMYL and safety guardrails:
- For toxicity, pet safety, or diagnostic safety content: add an amber warning/disclaimer near the top.
- For pet-ingestion emergency context, explicitly route to vet / ASPCA Poison Control (888-426-4435) immediately.
- Do not guess toxicity classification when uncertain; prefer "unknown" + professional escalation.

Formatting and style:
- Use locale-aware spelling from brief context (UK for EN-GB, US for EN-US). If locale is not provided, default to UK spelling.
- For temperature and care ranges, include both units when relevant (e.g. 16-24 C and 61-75 F).
- Keep structure scannable with clear <h2>/<h3>, practical steps, and actionable FAQ.

Internal linking standards:
- First internal link should appear within the first ~400 words when relevant links are available.
- Use specific, destination-descriptive anchor text (never "click here" style anchors).
- Include at least 2 related internal links plus the most relevant hub/pillar-style page when available in provided candidates.
- Do not place internal links in headings or table headers.

Commercial integrity:
- Recommend products only when contextually useful; keep recommendations honest and specific.
- When mentioning products, include at least one clear drawback for each recommendation.
- Keep commerce content inline and contextual, not dumped at the end.

Layering expectation:
- This output is Layer 1 draft material for reviewer and SEO lead refinement; keep it accurate, concise, and reviewer-friendly.`;
}

function gardenPerContentTypePrompt(args: {
  siteUrl: string;
  title: string;
  editorialBrief: string;
  contentAngle: string;
}): string {
  if (!isGardenSiteUrl(args.siteUrl)) return "";
  const hay = `${args.title}\n${args.editorialBrief}\n${args.contentAngle}`.toLowerCase();

  if (/\b(toxic|toxicity|poison|pet safe|cat|dog|ingest|ingestion)\b/.test(hay)) {
    return `Garden type focus: YMYL / Toxicity Page.
- Start with an amber emergency disclaimer at top.
- Cover symptoms, mechanism, immediate actions, what to tell vet, timeline, prevention.
- Include a Reviewer Insight box and primary citations (ASPCA/NHS/peer-reviewed).
- Include legal informational footer language for toxicity emergencies.`;
  }
  if (/\b(best|buying guide|comparison|vs\.?|review|top \d+)\b/.test(hay)) {
    return `Garden type focus: L2 Buying Guide.
- Include quick verdict table and "how we evaluated" section.
- Max 7 products; each product needs pros + honest drawbacks + contextual recommendation.
- Keep product recommendations inline and include relevant internal links early.`;
  }
  if (/\b(hire|designer|landscaper|professional|contractor|near me|city)\b/.test(hay)) {
    return `Garden type focus: L3 Decision Guide.
- Cover scope, cost ranges, vetting checklist, questions to ask, red flags, timelines.
- Primary CTA should direct to verified professional directory flow.
- Keep tone trust-building and practical; avoid affiliate-style content.`;
  }
  if (/\b(why|yellow|brown|droop|wilting|problem|diagnos|fix|how to)\b/.test(hay)) {
    return `Garden type focus: Diagnostic / How-To.
- Use Symptom -> Cause -> Fix structure with specific measurements and thresholds.
- Include "when to call a professional" and "prevent recurrence" sections.
- Add practical FAQ (3-5 questions).`;
  }
  if (/\b(care guide|plant care|watering|light requirements|repot|soil|humidity|species)\b/.test(hay)) {
    return `Garden type focus: Species Care Power Page.
- Include quick care summary plus sections for light, watering, soil, humidity/temperature, feeding, repotting, common problems, toxicity (if relevant), and FAQ.
- Use numeric ranges and measurable instructions throughout.`;
  }
  if (/\b(season|monthly|planting calendar|spring|summer|fall|autumn|winter)\b/.test(hay)) {
    return `Garden type focus: Seasonal / Planting Guide.
- Use specific month/date ranges (no vague season-only guidance).
- Include climate/zone notes where relevant.`;
  }
  if (/\b(glossary|what is|definition|meaning)\b/.test(hay)) {
    return `Garden type focus: Glossary Term.
- Provide concise plain-language definition with botanical accuracy.
- Add relevant internal links where the term is applied in context.`;
  }
  return "";
}

function weedLayer1BiblePrompt(toolScope: WPToolScope): string {
  if (toolScope !== WP_TOOL_SCOPE.weedComContentProduction) return "";
  return `

WEED.COM CONTENT GENERATION PROMPT - LAYER 1 (AI DRAFT)
Version: Bible v7 | April 2026
This is Layer 1 only and must be edited by a human expert before publish (Layer 2 — including Dr. Tabibi editorial review).

SYSTEM ROLE
You are a professional cannabis content writer producing Layer 1 first drafts for Weed.com Learn.
Follow Bible v7 strictly. Drafts are structured, evidence-referenced, and brief-compliant.

MANDATORY RULES
- Typography (article — outside Expert Insight): Inter leads the stack. Every text element, block, and heading outside the expert-box class (CSS selector .expert-box) must use font-family beginning with Inter exactly: Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif (copy verbatim from the Bible templates). That includes intro, all body <p> and section <h2>/<h3>/<h4>, lists, FAQ, product card, Sources, amber disclaimer, and legal footer. Do not rely on WordPress theme fonts: either wrap the entire article body in one outer <div style="font-family: Inter,..."> … </div> (same stack) so all children inherit, or put that font-family inline on every body <p>, heading, and <li>. Bible templates already include Inter on their elements — match that for all other body copy.
- Typography (Expert Insight only — hard rule): Inside the entire expert-box block (class expert-box), every element that displays text MUST use exactly font-family:Inter,sans-serif!important (include !important on every inline style so pasted Word spans and theme link fonts cannot override). Inter plus the generic sans-serif keyword only. Do not use system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, or any other named font in that subtree. Apply on the outer expert-box div, the header row, pill, name, both body <p> tags, the expert-cite line container, and the PMID <a>.
- Voice: knowledgeable, warm, direct, never condescending, never hype/fear, honest on evidence limits.
- Use second person ("you") throughout.
- No em dash character.
- Intro must open with a real tension/question, no generic scene-setting.
- Keyword placement: do not stuff or force the primary target keyword at the very start of the first paragraph, and do not place it inside any heading (<h2>, <h3>, <h4>). Use natural wording; the topic may appear later in body copy where it reads normally.
- Paragraphs max 4 sentences, one idea per paragraph.
- Use bullets only for true lists.
- No disease-treatment claims.
- No specific drug interaction advice.
- Drug interaction disclaimer (amber box): When prescription medications, CNS-active drugs, sleep meds, alcohol with cannabis, or other medication-interaction topics are relevant, you MUST include the Bible amber disclaimer box once (Unicode medical symbol ⚕ U+2695 as the icon — not optional when that content appears). Do not rely on a plain sentence alone; use the inline-styled template.
- For mental health/sleep/pain risk contexts, the closing legal footer must still include emergency routing (911 / ER) as in the Bible footer template.

EXPERT INSIGHT — Dr. Alexander Tabibi (final Weed.com Learn layout)
Target output matches the production article shape (see project reference: expert insight boxes, not generic pull quotes).
Positioning: Dr. Alexander Tabibi is a former physician and independent science writer who interrogates evidence critically. He is not a practising clinician. He does not advise patients. His voice appears only inside Expert Insight boxes below — not as inline "according to Dr. Tabibi" in every paragraph, and never as practising-clinic or patient-specific advice.
Hard rules — never write: "in his clinical practice"; that he tells patients what to take; "Reviewed by a medical professional" without his full name; any implication he currently practises medicine or treats patients.

Expert Insight blocks MUST use INLINE CSS ONLY (no reliance on WordPress theme). Copy the template below verbatim and preserve every style="..." attribute, class="expert-box", and Inter-only font rules (always font-family:Inter,sans-serif!important). Only replace the paragraph text, citation text, PMID digits in the URL, and the PMID link label.

Template (Expert Insight):

<div class="expert-box" style="margin:1.75rem 0;padding:1.35rem 1.5rem 1.4rem 1.35rem;border-radius:0.75rem;background-color:#f0fdf4;border:1px solid rgba(22,101,52,0.22);border-left:6px solid #166534;box-shadow:0 1px 3px rgba(22,101,52,0.08);font-family:Inter,sans-serif!important;">
<div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.65rem 0.85rem;margin-bottom:1rem;font-family:Inter,sans-serif!important;">
<span style="display:inline-block;padding:0.35rem 0.75rem;border-radius:9999px;background-color:#166534;color:#fff;font-family:Inter,sans-serif!important;font-size:0.625rem;font-weight:700;letter-spacing:0.11em;text-transform:uppercase;line-height:1.25;">Expert Insight</span>
<span style="font-family:Inter,sans-serif!important;font-weight:600;font-size:1rem;color:#15803d;">Dr. Alexander Tabibi</span>
</div>
<p style="margin:0 0 0.9rem;font-family:Inter,sans-serif!important;font-size:1rem;line-height:1.65;color:#1c1917;">First paragraph: evidence summary or short-term picture in science-writer voice.</p>
<p style="margin:0 0 0.9rem;font-family:Inter,sans-serif!important;font-size:1rem;line-height:1.65;color:#1c1917;">Second paragraph: complication, limits of studies, or longer-term pattern — still measured, not alarmist.</p>
<div style="margin-top:1rem;padding-top:0.9rem;border-top:1px solid rgba(22,101,52,0.28);font-family:Inter,sans-serif!important;font-size:0.875rem;line-height:1.55;font-style:italic;color:#57534e;">LeadAuthor et al. (Year). Full article title. <em>Journal Name</em>, vol(issue):pages. <a href="https://pubmed.ncbi.nlm.nih.gov/NNNNNN/" style="font-family:Inter,sans-serif!important;color:#0f766e;font-style:normal;text-decoration:underline;">PMID: NNNNNN</a></div>
</div>

Expert-cite format: one bibliographic line — authors, year, full title, italic journal, volume/issue/pages, then PMID. Hyperlink only the PMID using the PubMed record URL (digits path only). The <a> must include font-family:Inter,sans-serif!important and keep color, font-style, and text-decoration as in the template.
- PubMed PMID links may appear ONLY inside Dr. Alexander Tabibi Expert Insight boxes (the expert-cite line at the bottom of each block). Do not place PubMed links in the intro, body paragraphs, FAQ, or elsewhere outside Expert Insight.

Placement rhythm (typical long article): first Expert Insight after the opening <h2> section or early in the piece; additional boxes after major mechanistic or dose/evidence sections (often 3 boxes total). Each box should stand near the health, sleep, dose, pharmacology, or risk content it supports.

CONTENTENATOR — LAYER 1 EXPERT INSIGHT CONSISTENCY (YMYL; internal gate before Layer 2 / Dr. Tabibi)
Run this mental checklist on every Expert Insight box before you finish the draft. Output must pass these gates so Layer 2 never receives drafts with citation integrity failures. Applies to all Expert Insight blocks on cannabis health, medical or dosing-adjacent claims, sleep, pain, mental health, pharmacology, drug–drug interaction context, or other YMYL-adjacent topics.

1) Study-type accuracy
- If the box (or tightly coupled sentences that the box supports) describes evidence using terms such as "trial," "study," "RCT," "randomized," "clinical trial," "meta-analysis," "systematic review," "review," "cohort," "case series," "observational study," or similar, that description MUST match the publication type shown on the PubMed record for the PMID you cite.
- Do not label a narrative review or meta-analysis as if it were a single primary RCT, or vice versa. If the PubMed record is a review or meta-analysis that synthesizes other work, say so clearly in the Expert Insight prose (e.g. "a 2020 systematic review of…") and do not imply the box cites a direct primary trial unless the cited PMID is that trial.

2) PMID verification (no fabricated or mismatched IDs)
- Every PMID used in an Expert Insight expert-cite href (https://pubmed.ncbi.nlm.nih.gov/<digits>/) MUST correspond to a real PubMed entry that matches the bibliographic line in the same box (authors, title, journal, year).
- Do not invent, guess, transpose digits, or reuse a PMID from an unrelated paper you remember. If you cannot verify the exact PMID for the specific paper supporting the claim, omit that expert-cite line and PMID link; soften the claim without naming a paper.
- A PMID that resolves to a completely unrelated article is a critical failure — treat it like fabrication.

3) Claim-to-citation match (primary source; no review misattribution)
- A specific quantitative, dose-level, or named-outcome claim in or supported by an Expert Insight box (e.g. "15 mg THC reduced sleep onset latency") must be supported by the **same PMID** in that box's expert-cite — the cited record must actually contain or directly report that finding.
- Do not cite review PMID "A" while the specific numeric or intervention detail appears only in a primary study mentioned inside that review: either cite the primary paper's PMID (if verified) or restrict the claim to what the review itself states.
- If only a review's summary conclusion is verifiable, write only to that level; do not attribute trial-level detail to a review PMID alone.

Before returning HTML, re-read each Expert Insight block: (a) study-type wording matches the PubMed record type; (b) each PMID matches the paper named in the expert-cite line; (c) each concrete claim traces to that cited record, not to a different paper.

CITATIONS (strict — one paper, one PMID link; must satisfy Contentenator rules above)
- Include at most 3 PubMed citations total across the article, all in Dr. Tabibi Expert Insight expert-cite lines only. Use them only for the strongest mechanistic or clinical claims.
- A real citation is a specific peer-reviewed paper (known authors, journal, year), not a keyword search. PubMed search URLs are forbidden: any href containing pubmed.ncbi.nlm.nih.gov/?term= (or other query-string search) is unacceptable — it is not stable, not verifiable, and useless to readers and fact-checkers.
- Required link pattern only: a single PubMed record page using the numeric PMID in the path — https://pubmed.ncbi.nlm.nih.gov/31860793/ style (digits only; no ?term=, no /pubmed/ search, no invented paths).
- In the same sentence or the immediately following sentence, name the source in readable bibliographic form: lead author et al., journal, year (e.g. Blount et al., N Engl J Med, 2020). You may add a DOI in plain text beside it when you know it; the clickable href must still be the PubMed PMID URL above.
- Anchor text must be specific (e.g. "Blount et al. (NEJM, 2020)" or the study's identifiable short label), never vague ("a study," "research shows," "read more").
- Never invent PMIDs, journals, volumes, or pages. If you cannot confirm an exact PMID for the paper you mean, do not substitute a search URL: omit that citation and hedge the claim without naming a specific paper.
- Keep a plain-language clause on study design where it helps (RCT, cohort, case series, review, etc.).
- No bare [CITE: ...] placeholders without a live PMID article URL. Optional brief editor note in parentheses after the link is fine.
- No other external links or domains in the article (internal links from the candidate list only, plus at most these 3 PubMed PMID links total, each only in Expert Insight expert-cite lines and repeated in Sources as specified below).
- TABIBI LIBRARY: When the user message includes a "TABIBI GOLD STANDARD CITATION LIBRARY" block, every PubMed PMID in Expert Insight expert-cite lines and in Sources MUST be taken from that block only — do not cite any PMID that is not listed there.

INTERNAL LINKING (strict)
- Use only the provided internal links/candidates.
- Editorial posts/pages: in the main body, include at least one and at most three <a> links to post or page URLs from the "Editorial posts and pages" list in the user message (when that list is not empty). Pick the most relevant URLs for nearby sentences; do not substitute product/Shop Now links for this requirement.
- Anchor text must be specific and destination-descriptive.
- Do not use vague anchors like "this guide", "this breakdown", "this article", "read more", "learn more", "click here".
- If a long title is shortened, preserve meaning and topic fidelity.

PRODUCT/COMMERCE INTEGRATION
- Prefer partner products when they fit the section and appear in the internal link list: Binoid, Bloomz, Hometown Hero, Blazed, Cookies, and Binoid/Blazed warehouse inventory (same candidate list rules). If multiple products match, favor these brands before other catalog items.
- When the candidate list includes any partner-brand product URL and the topic can naturally mention shopping or product choice, you MUST include at least one full Shop Now card (Bible HTML) for a relevant partner product—not only editorial post links. If the list has no product URLs at all, skip product cards.
- Use the product card pattern below when featuring shoppable items (often 1-2 cards in a commerce-focused subsection). Products must be context-led; no abrupt affiliate drops.
- When the internal link candidate list includes a line "Product image URL (Shop Now card only):" for that product, you MUST place the linked thumbnail first (same product URL as Shop Now). Use that exact image URL as img src; set img alt to a short plain version of the product name. The Shop Now thumbnail is a square (not wide rectangle) — copy the Bible img dimensions and object-fit:contain. If no image URL is listed for that product, omit the entire leading <a>...</a> image block and use the text+button-only layout (same outer div; first child is then the text column).
- HTML pattern — INLINE CSS ONLY (copy style attributes verbatim; replace product name, descriptor, href, image src/alt when applicable):

<div style="display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem 1.25rem;margin:1.5rem 0;padding:1.35rem 1.5rem;border-radius:0.875rem;background-color:#f4f1e8;border:1px solid rgba(45,90,69,0.14);">
<a href="INTERNAL_LINK_URL" target="_blank" rel="noopener noreferrer" style="flex-shrink:0;display:block;line-height:0;text-decoration:none;"><img src="PRODUCT_IMAGE_URL" alt="Short product name" width="88" height="88" style="display:block;width:5.5rem;height:5.5rem;object-fit:contain;object-position:center;border-radius:0.5rem;background-color:#ffffff;border:1px solid rgba(45,90,69,0.12);" loading="lazy" decoding="async" /></a>
<div style="flex:1;min-width:min(100%,220px);">
<div style="font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-weight:700;font-size:1.125rem;line-height:1.3;color:#0f172a;margin-bottom:0.35rem;">Product name</div>
<div style="font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:0.9375rem;line-height:1.45;color:#666666;">Short factual descriptor line</div>
</div>
<a href="INTERNAL_LINK_URL" target="_blank" rel="noopener noreferrer" style="flex-shrink:0;display:inline-block;padding:0.65rem 1.35rem;border-radius:0.5rem;background-color:#2d5a45;color:#ffffff!important;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-weight:600;font-size:0.9375rem;text-decoration:none!important;white-space:nowrap;">Shop Now →</a>
</div>

- Place product blocks only after editorial setup in the section; not in the intro or the final sign-off. Prefer one commerce subsection; two cards are allowed when comparing distinct products (per production articles).

FAQ + SOURCES + FOOTER — INLINE CSS ONLY (same rule as Expert/product: WordPress has no custom CSS; copy every style=\"...\" exactly; only change text and links)

Visual: clean editorial layout — Inter for all text, headings, and styled blocks, charcoal (#334155 / #1e293b for heading), comfortable line-height, generous vertical spacing. No bordered boxes, no tinted backgrounds on FAQ or Sources (plain white page look).

FAQ RULES (required for every Weed.com Learn article — never omit)
- The HTML MUST include the FAQ wrapper with inline styles below (outer div with margin:2.5rem and h2 "Frequently asked questions"). Mandatory block.
- 3 to 5 FAQs (exact count will be specified by caller). Questions mirror real search phrasing. Each answer ~24-45 words (clear, useful, concise). Question and answer use the same font weight (readable, not heavy marketing bold on questions).
- Template — copy style attributes verbatim per item:

<div style="margin:2.5rem 0 0;padding:0;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<h2 style="font-size:1.125rem;font-weight:600;color:#1e293b;margin:0 0 1.25rem;line-height:1.35;">Frequently asked questions</h2>
<div style="margin:0 0 1.5rem;">
<div style="font-size:1rem;font-weight:400;color:#334155;line-height:1.5;margin:0 0 0.45rem;">Question text in natural search phrasing?</div>
<div style="font-size:1rem;font-weight:400;color:#334155;line-height:1.65;margin:0;">Answer text. Internal links allowed when relevant.</div>
</div>
(repeat the inner <div style="margin:0 0 1.5rem;"> block for each Q&A pair)
</div>

DRUG INTERACTION DISCLAIMER — AMBER BOX (required when medication interactions are relevant)
- Trigger: any discussion of prescription drugs, sedatives, SSRIs, blood thinners, CNS depressants, sleep meds, alcohol+cannabis, or similar interaction-relevant context.
- REQUIRED: include exactly one inline-styled amber box using the template below (⚕ medical symbol + icon row). Do not omit when triggers apply; do not substitute a plain unboxed paragraph only.
- Placement: once per article — typically after the FAQ block and immediately before the Sources block, or the first time interaction-heavy content appears (pick one; do not duplicate).

Template (drug interaction — copy style attributes verbatim):

<div style="margin:1.75rem 0;padding:1rem 1.15rem 1.1rem 1rem;border-radius:0.65rem;background-color:#fffbeb;border:1px solid rgba(217,119,6,0.38);border-left:5px solid #d97706;box-shadow:0 1px 2px rgba(180,83,9,0.07);">
<div style="display:flex;align-items:flex-start;gap:0.65rem;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:0.9375rem;line-height:1.55;color:#78350f;">
<span style="flex-shrink:0;font-size:1.2rem;line-height:1.25;" aria-hidden="true">⚕</span>
<p style="margin:0;">If you take prescription medications, speak with your pharmacist or physician before using cannabis products, especially if those medications affect your central nervous system or sleep cycle.</p>
</div>
</div>

SOURCES + LEGAL FOOTER — ARTICLE FOOT (order is fixed: FAQ → [amber disclaimer if required] → Sources → legal footer)
- Sources block (hard rule): List ONLY the papers that appear in Dr. Alexander Tabibi Expert Insight expert-cite lines (same PMIDs, same papers). One Sources line per distinct PMID used in those blocks. Do NOT add extra references, review papers, or PMIDs that did not appear in an Expert Insight expert-cite line. If no Expert Insight box includes a PMID (or you used zero expert-cites), omit the entire Sources wrapper — do not substitute a generic or topical source line.
- For each listed paper, full formatted bibliographic lines (lead author et al., year, full title, italic journal, volume/issue/pages where known). Each line MUST end with a PubMed PMID link using the Bible pattern (digits path only), same link styling as Expert-cite: <a href="https://pubmed.ncbi.nlm.nih.gov/NNNNNN/" style="color:#0f766e;text-decoration:underline;">PMID: NNNNNN</a>. No PubMed search URLs. Never invent PMIDs.

Sources template — copy structure; replace citation text and PMID digits:

<div style="margin:2rem 0 0;padding:0;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="font-size:1rem;font-weight:400;color:#334155;margin:0 0 0.85rem;line-height:1.4;">Sources</div>
<div style="font-size:1rem;font-weight:400;color:#334155;line-height:1.55;margin:0 0 0.65rem;">LeadAuthor et al. (Year). Full article title in sentence case. <em>Journal Name</em>, vol(issue):pp–pp. <a href="https://pubmed.ncbi.nlm.nih.gov/NNNNNN/" style="color:#0f766e;text-decoration:underline;">PMID: NNNNNN</a></div>
</div>

LEGAL FOOTER — HARD REQUIREMENT (never omit; always last substantive block of the article)
- The closing paragraph MUST include this exact opening wording: "For adults 21+ only. Cannabis laws vary by state."
- It MUST also include emergency routing: direct readers to call 911 or go to the nearest emergency room for a medical emergency.
- Use only the Bible inline template below (verbatim wording inside <p>).

<div style="margin:2rem 0 0;padding:0;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:0.9375rem;line-height:1.55;color:#64748b;">
<p style="margin:0;">For adults 21+ only. Cannabis laws vary by state. If you are experiencing a medical emergency, call 911 or go to your nearest emergency room.</p>
</div>

OUTPUT CONTRACT FOR THIS TOOL
- Return ARTICLE BODY FRAGMENT in valid HTML only (no markdown/code fences). Do not output a full HTML document, no <!DOCTYPE>, no <html>, no <head>, no site-wide stylesheet.
- FAQ block: use the Bible FAQ wrapper so Inter applies (inherited from the outer div font-family). Product, amber drug-interaction disclaimer (when triggered), Sources, and legal footer: use inline style=\"...\" so WordPress does not need theme CSS; font-family uses the full Inter-led stack from their templates. Expert Insight: class=\"expert-box\" on the outer wrapper; inside that subtree every element MUST use font-family:Inter,sans-serif!important (see Bible template) — no system-ui, Roboto, or other named fonts.
- Completeness (critical): Always finish the last sentence, close all open tags, complete every FAQ answer. Article foot order: FAQ → optional amber drug-interaction box if interaction topics apply → Sources (only Expert Insight expert-cite PMIDs, full citations) or omit Sources if none → legal footer with the exact required opening sentence plus 911/ER routing. Never omit the legal footer. Never stop mid-word or mid-sentence. If you are tight on length, shorten FAQ answers or body sections — never omit the legal footer or truncate the closing paragraph.
- Do not output separate SEO BLOCK, EDITOR NOTES, or SEO LEAD NOTES sections in this API response.

QUALITY SELF-CHECK BEFORE RETURN
- Intro opens with real tension/question.
- Expert Insight: every Tabibi block uses the EXACT template from the Bible (outer div with class=\"expert-box\" plus margin/padding/green panel styles; pill + name row; two <p> with inline styles; expert-cite with inline styles and PMID <a>); every node inside class expert-box uses font-family:Inter,sans-serif!important — no other named fonts; voice follows Tabibi positioning rules.
- Contentenator (Expert Insight / YMYL): study-type language matches each cited paper's actual publication type on PubMed; every PMID is verified against that paper (no invented, guessed, or unrelated PMIDs); every specific finding cited traces to the same PMID in that box, not to a different paper or only to a review's discussion of another study.
- At most 3 PubMed PMID links total; each appears only in Expert Insight expert-cite lines and again in Sources (same set — no extra Sources); each href uses https://pubmed.ncbi.nlm.nih.gov/ digits path only; no pubmed search URLs; no other external domains besides those PMIDs and internal links from the candidate list.
- Primary keyword is not forced into the first sentence of the intro or into any heading.
- Internal links use precise anchors and real URLs from the provided list.
- Sources lists only Expert Insight expert-cite papers; FAQ and legal footer follow the Bible (Inter everywhere; FAQ uses Bible wrapper + h2/h3/p; Expert Insight uses Bible template with Inter,sans-serif!important on every line/element in the box).
- No disease-treatment claims.
If any check fails, revise before returning output.`;
}

export async function postGenerateContent(request: Request, toolScope: WPToolScope) {
  try {
    const body = await request.json();
    const { siteId, title, keywords, wordCount, editorialBrief, contentAngle, productTypeForLinks } = body;
    const bodyRecord = body as Record<string, unknown>;
    const expertInsightCountRaw = bodyRecord.expertInsightCount;
    const expertInsightCount =
      typeof expertInsightCountRaw === "number" &&
      Number.isInteger(expertInsightCountRaw) &&
      expertInsightCountRaw >= 1 &&
      expertInsightCountRaw <= 3
        ? expertInsightCountRaw
        : undefined;
    const includeImportantNotice = bodyRecord.includeImportantNotice === true;
    const faqCountRaw = bodyRecord.faqCount;
    const faqCount =
      typeof faqCountRaw === "number" &&
      Number.isInteger(faqCountRaw) &&
      faqCountRaw >= 3 &&
      faqCountRaw <= 5
        ? faqCountRaw
        : undefined;

    const refinementInstructions =
      typeof bodyRecord.refinementInstructions === "string" ? bodyRecord.refinementInstructions.trim() : "";
    const existingHtmlRaw =
      typeof bodyRecord.existingHtml === "string" ? bodyRecord.existingHtml.trim() : "";
    const isRefinement = refinementInstructions.length > 0 && existingHtmlRaw.length > 0;

    if (isRefinement && existingHtmlRaw.length > MAX_REFINEMENT_HTML_CHARS) {
      return NextResponse.json(
        { error: `existingHtml exceeds ${MAX_REFINEMENT_HTML_CHARS} characters` },
        { status: 400 }
      );
    }

    if (!siteId || !title || !Array.isArray(keywords) || typeof wordCount !== "number") {
      return NextResponse.json(
        { error: "Missing or invalid fields: siteId, title, keywords (array), wordCount (number)" },
        { status: 400 }
      );
    }
    if (!ALLOWED_WORD_COUNTS.has(wordCount)) {
      return NextResponse.json({ error: "wordCount must be one of 1500, 2000, 2500, or 3000" }, { status: 400 });
    }
    if (expertInsightCountRaw != null && expertInsightCount == null) {
      return NextResponse.json({ error: "expertInsightCount must be an integer between 1 and 3" }, { status: 400 });
    }
    if (faqCountRaw != null && faqCount == null) {
      return NextResponse.json({ error: "faqCount must be an integer between 3 and 5" }, { status: 400 });
    }

    const site = await getSiteById(siteId, toolScope);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const productHint =
      typeof productTypeForLinks === "string" && productTypeForLinks.trim().length > 0
        ? productTypeForLinks.trim()
        : "";
    const siteOrigin = (site.url ?? "").replace(/\/$/, "");
    const isWeed = toolScope === WP_TOOL_SCOPE.weedComContentProduction;
    const linkLibraryOpts = {
      minPostPageSlots: isWeed ? 3 : 1,
      maxPostPageSlots: 3 as const,
      ...(siteOrigin ? { siteOriginForProductImages: siteOrigin } : {}),
    };
    const candidateOpts =
      toolScope === WP_TOOL_SCOPE.weedComContentProduction
        ? productHint
          ? {
              ...linkLibraryOpts,
              productTypeHint: productHint,
              productLinkSlots: 2,
              boostWeedPreferredProductBrands: true,
            }
          : { ...linkLibraryOpts, boostWeedPreferredProductBrands: true }
        : productHint
          ? { ...linkLibraryOpts, productTypeHint: productHint, productLinkSlots: 2 }
          : linkLibraryOpts;

    const siteUrlForOriginFilter = site.url ?? "";

    const loadInternalLinksFromLibrary = () =>
      getCandidatesFromLibrary(site.id, keywords, title, INTERNAL_LINK_CANDIDATES_FOR_PROMPT, {
        ...candidateOpts,
        siteUrlForOriginFilter,
      });

    let internalLinks = await loadInternalLinksFromLibrary();

    if (internalLinks.length < LIBRARY_USE_MIN) {
      try {
        await syncInternalLinksFromWordPress(site.id, toolScope);
        if (toolScope === WP_TOOL_SCOPE.weedComContentProduction) {
          try {
            await syncProductInternalLinksFromWordPress(site.id, toolScope);
          } catch (e) {
            console.warn("[generate-content] Product link library sync skipped:", errorMessage(e));
          }
        }
        internalLinks = await loadInternalLinksFromLibrary();
      } catch (e) {
        console.warn("[generate-content] Internal link library sync failed:", errorMessage(e));
      }
    }

    if (internalLinks.length < LIBRARY_USE_MIN) {
      const posts = await getPosts(site, 100);
      if (toolScope === WP_TOOL_SCOPE.weedComContentProduction) {
        try {
          const products = await fetchAllProductsForLinkLibrary(site);
          internalLinks = filterLinkCandidatesToSiteOrigin(
            pickCandidatesFromLivePostsAndProducts(
              posts,
              products,
              keywords,
              title,
              INTERNAL_LINK_CANDIDATES_FOR_PROMPT,
              candidateOpts
            ),
            siteUrlForOriginFilter
          );
        } catch {
          internalLinks = filterLinkCandidatesToSiteOrigin(
            pickCandidatesFromLivePosts(posts, keywords, title, INTERNAL_LINK_CANDIDATES_FOR_PROMPT),
            siteUrlForOriginFilter
          );
        }
      } else {
        internalLinks = filterLinkCandidatesToSiteOrigin(
          pickCandidatesFromLivePosts(posts, keywords, title, INTERNAL_LINK_CANDIDATES_FOR_PROMPT),
          siteUrlForOriginFilter
        );
      }
    }

    const tonePrompt = site.tone_prompt ?? "Write in a clear, authoritative, and engaging editorial tone.";
    const gardenPrompt = gardenComLayerPrompt(site.url ?? "");
    const gardenTypePrompt = gardenPerContentTypePrompt({
      siteUrl: site.url ?? "",
      title,
      editorialBrief: typeof editorialBrief === "string" ? editorialBrief : "",
      contentAngle: typeof contentAngle === "string" ? contentAngle : "",
    });
    const initialDraftSystemTail = `You are an expert SEO content writer. Write a complete blog post in valid HTML (not markdown).
Never wrap the output in code fences: do not use triple backticks, do not write \`\`\`html or \`\`\` before or after the HTML. Return raw HTML only.
Do NOT put the article title in the body: no <h1> and no title heading. The CMS sets the post title separately.
Start the body with an introduction using <p>, or the first <h2> section heading. Use <h2> and <h3> only inside the article. Target ${wordCount} words with tight control: keep visible text in ${wordCountBounds(wordCount).min}-${wordCountBounds(wordCount).max} words (HTML tags do not count). In the main body, include editorial internal links (<a>) to post/page URLs from the **Editorial posts and pages** list, chosen for maximum relevance to nearby copy. ${toolScope === WP_TOOL_SCOPE.weedComContentProduction ? "For Weed.com, include exactly 3 editorial links when 3+ are available (otherwise use all available)." : "Use 1 to 3 editorial links when available."} You may add separate product/Shop Now usage from the **Products** list; editorial links are not optional when the editorial list is non-empty. Use descriptive anchor text. Do not add external links${toolScope === WP_TOOL_SCOPE.weedComContentProduction ? " except up to three PubMed PMID links, only inside Dr. Tabibi Expert Insight expert-cite lines (and duplicated in Sources per Bible)" : ""}.

Typography: Never use the em dash character (Unicode U+2014). Do not type "—". Use commas,
semicolons, parentheses, or a spaced hyphen " - " instead when you need a pause or aside.

Structure: Near the end, include FAQs before Sources/footer:
${ 
  toolScope === WP_TOOL_SCOPE.weedComContentProduction
    ? `- Weed.com Learn article foot order: FAQ block (Bible wrapper with Inter; <h2> Frequently asked questions, <h3> + <p> per item) → amber drug-interaction disclaimer (Bible template with ⚕) when meds/interactions are relevant → Sources with full formatted citations and PMID links for cited papers → legal footer with exact opening "For adults 21+ only. Cannabis laws vary by state." plus 911/ER sentence (hard requirement; never omit). All text, headings, and blocks use Inter per Bible. FAQ count must be exactly 5; each answer should be concise and useful (roughly 24-45 words).`
    : `- One <h2> for the FAQ block (e.g. "Frequently asked questions" or a topic-specific label).
- Either ONE set of questions (each question is an <h3>, answer in <p> and/or <ul><li> bullets
  when several points apply), OR TWO thematic <h3> subsections when the topic clearly splits
  (e.g. overview vs. practical steps); under each <h3> subsection use <h4> for each question.
- Use bullet lists where answers have multiple distinct facts or steps; use prose where one
  short paragraph is enough.
- 4 to 8 Q&A pairs total, all on-topic for the title and keywords.`
}`;

    const systemPrompt = `${tonePrompt}
${brandAddendumForScope(toolScope)}
${gardenPrompt}
${gardenTypePrompt}
${weedLayer1BiblePrompt(toolScope)}

${isRefinement ? CONTENT_REFINEMENT_SYSTEM_TAIL : initialDraftSystemTail}`;

    const isProductCandidate = (l: LinkCandidate) => l.linkKind === "product";
    const editorialCandidates = internalLinks.filter((l) => !isProductCandidate(l));
    const productCandidates = internalLinks.filter(isProductCandidate);
    const formatEditorialLine = (l: LinkCandidate) => `- ${l.title}: ${l.url}`;
    const formatProductLine = (l: LinkCandidate) => {
      const line = `- ${l.title}: ${l.url}`;
      const img = l.imageUrl?.trim();
      if (img) {
        return `${line}\n  Product image URL (Shop Now card only): ${img}`;
      }
      return line;
    };
    const editorialBlock =
      editorialCandidates.length > 0
        ? editorialCandidates.map(formatEditorialLine).join("\n")
        : "(none — do not invent internal URLs. In Site manager, run **Sync internal links** (and product sync if needed), then regenerate.)";
    const productBlock =
      productCandidates.length > 0
        ? productCandidates.map(formatProductLine).join("\n")
        : "(none — product cards only when URLs appear here.)";
    const linksText = `Linking rules:
- **URLs are canonical:** copy every href **exactly** from the lists below (full URL including https:// and path). Do not invent paths, guess slugs, or "fix" URLs — only use strings that appear under Editorial posts and pages / Products.
- Main body: embed **editorial** post/page links from "Editorial posts and pages" (most relevant first). For Weed.com: use exactly 3 editorial links when 3+ are available; if fewer are available, use all available. Do not skip editorial links in favor of product links only.
- Products: use "Products" for Shop Now cards and commerce-style mentions per scope rules; product links do not replace required editorial post/page links.

Editorial posts and pages (from your site link library — these URLs are live on the site):
${editorialBlock}

Products (Shop Now / commerce):
${productBlock}`;
    const sheetBrief =
      typeof editorialBrief === "string" && editorialBrief.trim().length > 0
        ? editorialBrief.trim().slice(0, 12000)
        : "";
    const angleBrief =
      typeof contentAngle === "string" && contentAngle.trim().length > 0
        ? `Content angle:\n${contentAngle.trim().slice(0, 4000)}`
        : "";
    const productBrief = productHint
      ? `Product type focus: still include **at least one editorial post/page link** from the editorial list (1–3 total editorial links). Separately, include 1–2 relevant **product** internal links when they fit. The candidate list favors products matching: "${productHint}". Introduce each product with a short editorial setup (why this example fits the section) so it reads as a recommendation in context, not a sudden plug. If the list is thin, sync product links in Site manager.`
      : "";
    const weedProductVariationInstruction =
      toolScope === WP_TOOL_SCOPE.weedComContentProduction
        ? `\n\nProduct selection rule: when multiple relevant product URLs are available, prefer priority brands (Binoid, Bloomz, Hometown Hero, Blazed, Cookies) but vary picks across articles instead of repeating the same product URLs each time.`
        : "";
    const briefExtra = [sheetBrief, angleBrief, productBrief].filter(Boolean).join("\n\n");

    const tabibiForArticle =
      toolScope === WP_TOOL_SCOPE.weedComContentProduction
        ? selectRelevantTabibiEntries(title, keywords, {
            editorialBrief: sheetBrief,
            contentAngle:
              typeof contentAngle === "string" && contentAngle.trim().length > 0
                ? contentAngle.trim()
                : undefined,
            productTypeForLinks: productHint || undefined,
          })
        : [];
    const tabibiLibraryBlock =
      toolScope === WP_TOOL_SCOPE.weedComContentProduction
        ? buildTabibiLibraryUserBlock(tabibiForArticle)
        : "";
    const weedExpertInsightCountInstruction =
      toolScope === WP_TOOL_SCOPE.weedComContentProduction && typeof expertInsightCount === "number"
        ? `\n\nExpert Insight count requirement: include exactly ${expertInsightCount} Dr. Alexander Tabibi Expert Insight block${expertInsightCount === 1 ? "" : "s"} in the article body.`
        : "";
    const weedFaqCountInstruction =
      toolScope === WP_TOOL_SCOPE.weedComContentProduction
        ? `\n\nFAQ requirement: include exactly ${faqCount ?? 5} relevant FAQs. Keep each answer concise (around 24-45 words), not too short and not too long.`
        : "";
    const wordCountInstruction = `\n\nWord count requirement: target ${wordCount} visible words (exclude HTML tags). Keep final output in ${wordCountBounds(wordCount).min}-${wordCountBounds(wordCount).max}.`;

    const initialDraftUserMessage = `Title: ${title}

Keywords: ${keywords.join(", ")}${briefExtra ? `\n\n${briefExtra}` : ""}${weedProductVariationInstruction}

Internal link candidates (editorial: for Weed.com pick exactly 3 most-relevant post/page URLs when possible; products: separate Shop Now / commerce usage; each URL at most once):
${linksText}${tabibiLibraryBlock}
${weedExpertInsightCountInstruction}
${weedFaqCountInstruction}
${wordCountInstruction}

Write the full HTML blog post.${toolScope === WP_TOOL_SCOPE.weedComContentProduction ? "" : " Include the FAQ block as specified (1 or 2 FAQ subsections by topic fit, bullets in answers where it helps)."} Remember: no em dash character anywhere in the HTML. Do not output an <h1>; the post title is set only in WordPress. Start with <p> or <h2>.${toolScope === WP_TOOL_SCOPE.weedComContentProduction ? ` Body, FAQ, cards, footers: Inter-led font stack per Bible. Expert Insight (.expert-box): every opening tag in that block must include font-family:Inter,sans-serif!important (including PMID <a>) so paste/theme cannot override. FAQ: Bible outer wrapper + <h2>Frequently asked questions</h2> + <h3>/<p> pairs. Double-check every internal link: when the Editorial posts and pages list is non-empty, include exactly 3 most-relevant <a> links to those post/page URLs in the main body when 3+ are available (otherwise include all available); Shop Now product blocks are separate and do not satisfy the editorial link requirement. In all Shop Now product blocks, both the image link and the "Shop Now →" button link must include target="_blank" and rel="noopener noreferrer". Anchor text must be specific (never rely on 'this guide' / 'this breakdown' style phrasing). Product names must follow a clear contextual lead-in. Do not force the primary keyword into the opening of the first paragraph or into headings. Before finalizing: run Contentenator on every Expert Insight box (Bible v7) — study-type labels match the PubMed record type; each PMID matches that paper (no unrelated or fabricated IDs); specific numeric or outcome claims trace to that same PMID, not a different paper or a review-only mention of another study. At most 3 PubMed citations total; PMIDs only in Expert Insight expert-cite lines; each must use a verified PMID article URL (https://pubmed.ncbi.nlm.nih.gov/<digits>/) — never PubMed ?term= search links — with author/journal/year in adjacent text. Do not output a Sources HTML block: the server appends Sources using only PMIDs cited in Expert Insight expert-cite lines (no additional PMIDs). Every Dr. Tabibi Expert Insight block and every product card must use the Bible templates with full inline style=\"...\" attributes (WordPress will not load custom CSS for these). When medication interactions are relevant, include the amber drug-interaction disclaimer box (⚕ icon) from the Bible. End with the legal footer only — required verbatim opening \"For adults 21+ only. Cannabis laws vary by state.\" plus emergency routing; never omit. The article must end completely — never stop mid-sentence.` : ""}`;

    const refinementUserMessage = `Title: ${title}

Keywords: ${keywords.join(", ")}${briefExtra ? `\n\n${briefExtra}` : ""}${weedProductVariationInstruction}

Internal link candidates (use only these URLs when adding or changing links):
${linksText}${tabibiLibraryBlock}
${weedExpertInsightCountInstruction}
${weedFaqCountInstruction}
${wordCountInstruction}

----- EXISTING HTML -----
${existingHtmlRaw}
----- END EXISTING HTML -----

Editor instructions:
${refinementInstructions}

Output the complete revised HTML only. No markdown code fences.`;

    const userMessage = isRefinement ? refinementUserMessage : initialDraftUserMessage;

    const raw = await callClaude(systemPrompt, userMessage, {
      maxTokens: maxTokensForArticleHtml(wordCount),
    });
    let content = stripLeadingPostTitleH1(replaceEmDashes(stripHtmlCodeFences(raw)));

    if (toolScope === WP_TOOL_SCOPE.weedComContentProduction) {
      content = await finalizeWeedLearnHtml(content, title, keywords);
      content = lockExpertBoxTypography(content);
      if (tabibiForArticle.length > 0) {
        content = appendTabibiSourcesFooter(content, tabibiForArticle);
      }
    }

    content = await normalizeWordCountIfNeeded(content, title, keywords, wordCount, toolScope);
    if (toolScope === WP_TOOL_SCOPE.weedComContentProduction) {
      content = lockExpertBoxTypography(content);
      if (tabibiForArticle.length > 0) {
        content = appendTabibiSourcesFooter(content, tabibiForArticle);
      }
      content = stripInBodyImportantNotice(content);
      content = appendWeedImportantNoticeIfRequested(content, includeImportantNotice);
    }
    const tabibiSourcesPicked: TabibiPmidEntry[] =
      toolScope === WP_TOOL_SCOPE.weedComContentProduction && tabibiForArticle.length > 0
        ? pickTabibiSourcesForFooter(content, tabibiForArticle)
        : [];

    const used: { title: string; url: string }[] = [];
    for (const link of internalLinks) {
      if (content.includes(link.url)) {
        used.push(link);
      }
    }

    const wordCountActual = countWordsFromHtml(content);

    return NextResponse.json({
      content,
      internalLinksUsed: used,
      wordCount: wordCountActual,
      refinement: isRefinement,
      ...(toolScope === WP_TOOL_SCOPE.weedComContentProduction && tabibiForArticle.length > 0
        ? {
            tabibiExpertInsightPmidsSuggested: tabibiForArticle.map((e) => e.pmid),
            ...(tabibiSourcesPicked.length > 0
              ? { tabibiSourcesFooterPmids: tabibiSourcesPicked.map((e) => e.pmid) }
              : {}),
          }
        : {}),
    });
  } catch (err) {
    const msg = errorMessage(err);
    console.error("[generate-content] Error:", msg);
    void serverLog({ level: "error", source: "content-production/generate-content", message: msg });
    const status = isClaudeServiceUnavailableError(err) ? 503 : 500;
    return NextResponse.json({ error: msg || "Failed to generate content" }, { status });
  }
}
