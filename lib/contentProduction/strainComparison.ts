/** Weed.com strain comparison pages: /learn/[strain-a]-vs-[strain-b]/ */

import { findBannedPhraseHits, paragraphCheck } from "@/lib/contentProduction/humanisationGuards";

export const STRAIN_COMPARISON_WORD_TARGET = 1350;
export const STRAIN_COMPARISON_WORD_MIN = 1200;
export const STRAIN_COMPARISON_WORD_MAX = 1500;
export const STRAIN_COMPARISON_FAQ_MIN = 4;
export const STRAIN_COMPARISON_FAQ_MAX = 5;

export type StrainComparisonInput = {
  strainA: string;
  strainB: string;
  strainAUrl?: string;
  strainBUrl?: string;
  primaryUseCase?: string;
};

export function stripStrainWordSuffix(name: string): string {
  return name.trim().replace(/\s+strain\s*$/i, "").trim();
}

/** Display label for titles and headings, e.g. "Remedy strain". */
export function formatStrainLabel(name: string): string {
  const base = stripStrainWordSuffix(name);
  return base ? `${base} strain` : "";
}

export function slugifyStrainName(name: string): string {
  return stripStrainWordSuffix(name)
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function strainComparisonSlug(strainA: string, strainB: string): string {
  return `${slugifyStrainName(strainA)}-vs-${slugifyStrainName(strainB)}`;
}

export function strainComparisonPostTitle(strainA: string, strainB: string): string {
  const a = formatStrainLabel(strainA);
  const b = formatStrainLabel(strainB);
  return `${a} vs ${b} — Which Is Right for You?`;
}

export function strainComparisonFocusKeyword(strainA: string, strainB: string): string {
  return `${formatStrainLabel(strainA)} vs ${formatStrainLabel(strainB)}`.toLowerCase().slice(0, 191);
}

export function strainComparisonMetaTitle(strainA: string, strainB: string): string {
  return `${formatStrainLabel(strainA)} vs ${formatStrainLabel(strainB)} — Effects, Differences & Which Is Better | Weed.com`.slice(
    0,
    200
  );
}

export function strainComparisonMetaDescription(strainA: string, strainB: string): string {
  const text = `Comparing ${formatStrainLabel(strainA)} vs ${formatStrainLabel(strainB)}? See effects, THC%, terpenes, and which strain wins for sleep, anxiety, and relaxation. Full guide at Weed.com.`;
  return text.length <= 156 ? text : `${text.slice(0, 153).trim()}...`;
}

export function defaultStrainPageUrl(siteOrigin: string, strainName: string): string {
  const base = siteOrigin.replace(/\/$/, "");
  return `${base}/strains/${slugifyStrainName(strainName)}-strain/`;
}

/** Remove Roy Layer 3 sign-off footer from article body if present. */
export function stripRoyLayer3Signoff(html: string): string {
  return html
    .replace(/<p[^>]*>[\s\S]*?Roy \(Layer 3 editorial sign-off\)[\s\S]*?<\/p>\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function parseStrainsFromComparisonTitle(title: string): { strainA: string; strainB: string } | null {
  const m = title.trim().match(/^(.+?)\s+vs\s+(.+?)(?:\s+[—-]\s+|\s*$)/i);
  if (!m) return null;
  const strainA = stripStrainWordSuffix(m[1].trim());
  const strainB = stripStrainWordSuffix(m[2].trim());
  if (!strainA || !strainB) return null;
  return { strainA, strainB };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasStrainComparisonSeedsSection(html: string, strainA: string, strainB: string): boolean {
  const a = escapeRegex(formatStrainLabel(strainA));
  const b = escapeRegex(formatStrainLabel(strainB));
  return new RegExp(
    `<h2[^>]*>[\\s\\S]*?Buy[^<]*${a}[^<]*and[^<]*${b}[^<]*Seeds`,
    "i"
  ).test(html);
}

export function buildStrainComparisonSeedsSection(
  strainA: string,
  strainB: string,
  siteOrigin: string
): string {
  const a = formatStrainLabel(strainA);
  const b = formatStrainLabel(strainB);
  const seedsUrl = `${siteOrigin.replace(/\/$/, "")}/seeds/`;
  const font = "font-family: Inter,system-ui,sans-serif;";
  return `<h2 style="${font}">Buy ${a} and ${b} Seeds</h2>
<p style="${font}">Home growers comparing ${a} and ${b} can browse verified seed genetics at Weed.com. <a href="${seedsUrl}">Shop cannabis seeds</a> to find cultivars suited to your grow setup and experience level.</p>`;
}

/** Insert seeds CTA before FAQ (or before Roy sign-off / end) when missing. Idempotent. */
export function ensureStrainComparisonSeedsSection(
  html: string,
  strainA: string,
  strainB: string,
  siteOrigin: string
): string {
  if (hasStrainComparisonSeedsSection(html, strainA, strainB)) return html;
  const section = buildStrainComparisonSeedsSection(strainA, strainB, siteOrigin);
  const faqMatch = html.match(/<h2[^>]*>\s*Frequently asked questions\s*<\/h2>/i);
  if (faqMatch?.index != null) {
    return `${html.slice(0, faqMatch.index).trimEnd()}\n\n${section}\n\n${html.slice(faqMatch.index)}`;
  }
  const royIdx = html.search(/Roy \(Layer 3 editorial sign-off\)/i);
  if (royIdx >= 0) {
    const beforeRoy = html.slice(0, royIdx);
    const insertAt = beforeRoy.lastIndexOf("<p");
    const at = insertAt >= 0 ? insertAt : royIdx;
    return `${html.slice(0, at).trimEnd()}\n\n${section}\n\n${html.slice(at)}`;
  }
  return `${html.trimEnd()}\n\n${section}`;
}

export type StrainComparisonOutlinePersona = {
  role: string;
  context: string;
  frustration: string;
  already_knows: string;
};

export type StrainComparisonOutlineH3 = {
  heading: string;
  intent: string;
  word_budget: number;
};

export type StrainComparisonOutlineH2 = {
  level: "h2";
  heading: string;
  intent: string;
  covers: string[];
  word_budget: number;
  h3s: StrainComparisonOutlineH3[];
};

export type StrainComparisonOutline = {
  title: string;
  slug: string;
  angle: string;
  persona: StrainComparisonOutlinePersona;
  structure: StrainComparisonOutlineH2[];
  intro: { word_budget: number; opening_rule: string };
  conclusion: { word_budget: number; approach: string };
  faq_topics: string[];
};

const SITE_NAME = "Weed.com";
const TOPIC_DOMAIN = "cannabis strains, effects, and cultivar comparisons";
const CONTENT_TYPE = "comparison";

/** Step 1: structural outline only — reduces templated, high-AI-score drafts. */
export function strainComparisonOutlineArchitectPrompt(): string {
  return `You are an outline architect for ${SITE_NAME}, a blog about ${TOPIC_DOMAIN}.
Build a structural outline for one article. Return ONLY valid JSON, no prose, no
markdown fences.

Rules:
- Match the content type: ${CONTENT_TYPE} (howto | tactical | comparison | best_of).
- Every H2 must earn its place. No filler sections, no "Introduction to X" headings.
- Give each H2 an explicit intent (what the reader should be able to do after it) and
  a word budget. Total should land in ${STRAIN_COMPARISON_WORD_MIN}–${STRAIN_COMPARISON_WORD_MAX} words.
- Assign the article ONE specific persona (role, context, what frustrates them, what
  they already know). Write for that person, not a generic reader.
- Do NOT write body prose. Structure only.

Weed.com comparison constraints (still structure-only):
- Cultivar names in headings use the "[Name] strain" form (e.g. "Remedy strain").
- One H2 must set up a side-by-side differences table (THC, CBD, terpenes, effects, timing, use-case fit, flavour, grow difficulty).
- One H2 must help the persona choose a winner for a concrete use case.
- One H2 (or late section) must cover where to buy / shop these strains on Weed.com (CTA intent, not prose).
- Do not use stock "What Is [Strain]?" headings unless the intent is genuinely non-filler for this persona.
- faq_topics: 4–5 specific PAA-style topics for this pair (not generic).
- intro.opening_rule must force a concrete comparison verdict in the first ~60 words.
- conclusion.approach should close for the persona without fluff or "in conclusion".

Output schema:
{
  "title": string,
  "slug": string,
  "angle": string,
  "persona": { "role": string, "context": string, "frustration": string, "already_knows": string },
  "structure": [
    { "level": "h2", "heading": string, "intent": string, "covers": string[], "word_budget": number,
      "h3s": [ { "heading": string, "intent": string, "word_budget": number } ] }
  ],
  "intro": { "word_budget": number, "opening_rule": string },
  "conclusion": { "word_budget": number, "approach": string },
  "faq_topics": string[]
}`;
}

export function buildStrainComparisonOutlineUserMessage(args: {
  strainA: string;
  strainB: string;
  primaryUseCase?: string;
}): string {
  const useCase =
    args.primaryUseCase?.trim() ||
    "Pick the highest-intent use case for this pair (sleep, anxiety, pain, energy, or focus).";
  const labelA = formatStrainLabel(args.strainA);
  const labelB = formatStrainLabel(args.strainB);
  return `Article pair:
- Strain A: ${args.strainA} (display as "${labelA}")
- Strain B: ${args.strainB} (display as "${labelB}")
- Preferred use-case focus: ${useCase}
- Suggested slug: ${strainComparisonSlug(args.strainA, args.strainB)}
- CMS title reference (may refine angle/title): ${strainComparisonPostTitle(args.strainA, args.strainB)}

Build the outline JSON now.`;
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

export function parseStrainComparisonOutline(raw: string): StrainComparisonOutline {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) cleaned = objMatch[0];
  cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  const personaRaw = (parsed.persona ?? {}) as Record<string, unknown>;
  const introRaw = (parsed.intro ?? {}) as Record<string, unknown>;
  const conclusionRaw = (parsed.conclusion ?? {}) as Record<string, unknown>;
  const structureRaw = Array.isArray(parsed.structure) ? parsed.structure : [];

  const structure: StrainComparisonOutlineH2[] = structureRaw.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    const h3sRaw = Array.isArray(r.h3s) ? r.h3s : [];
    return {
      level: "h2",
      heading: asString(r.heading, "Untitled section"),
      intent: asString(r.intent),
      covers: asStringArray(r.covers),
      word_budget: asNumber(r.word_budget, 150),
      h3s: h3sRaw.map((h) => {
        const hh = (h ?? {}) as Record<string, unknown>;
        return {
          heading: asString(hh.heading, "Untitled"),
          intent: asString(hh.intent),
          word_budget: asNumber(hh.word_budget, 60),
        };
      }),
    };
  });

  if (structure.length < 3) {
    throw new Error("Outline is missing required H2 structure (need at least 3 sections).");
  }

  const faq_topics = asStringArray(parsed.faq_topics);
  if (faq_topics.length < STRAIN_COMPARISON_FAQ_MIN) {
    throw new Error(
      `Outline faq_topics needs ${STRAIN_COMPARISON_FAQ_MIN}–${STRAIN_COMPARISON_FAQ_MAX} topics.`
    );
  }

  return {
    title: asString(parsed.title, "Untitled comparison"),
    slug: asString(parsed.slug),
    angle: asString(parsed.angle),
    persona: {
      role: asString(personaRaw.role, "curious cannabis consumer"),
      context: asString(personaRaw.context),
      frustration: asString(personaRaw.frustration),
      already_knows: asString(personaRaw.already_knows),
    },
    structure,
    intro: {
      word_budget: asNumber(introRaw.word_budget, 100),
      opening_rule: asString(introRaw.opening_rule, "Lead with a concrete comparison verdict."),
    },
    conclusion: {
      word_budget: asNumber(conclusionRaw.word_budget, 80),
      approach: asString(conclusionRaw.approach, "Close with a clear pick for the persona."),
    },
    faq_topics: faq_topics.slice(0, STRAIN_COMPARISON_FAQ_MAX),
  };
}

/**
 * Step 2: body writer / repair / voice assembly.
 * Prefer section substance drafts first; this prompt stitches or repairs into final HTML.
 */
export function strainComparisonSystemPrompt(): string {
  return `You write Weed.com strain comparison articles for /learn/[strain-a]-vs-[strain-b]/ URLs.

OUTPUT: Raw HTML only. No markdown fences. No <!DOCTYPE>, <html>, or <h1> (CMS sets title separately).
Typography: Never use the em dash (U+2014). Use " - " or commas instead.
Font: Inter, system-ui, sans-serif on all text blocks via inline style where you open text tags.

TARGET LENGTH: ${STRAIN_COMPARISON_WORD_MIN}–${STRAIN_COMPARISON_WORD_MAX} words (aim ~${STRAIN_COMPARISON_WORD_TARGET}).

WHEN SUBSTANCE DRAFTS ARE PROVIDED:
- Drafts are already humanized and may already include light transitions. Convert markdown to HTML with MINIMAL prose changes.
- Preserve wording, claims, links, headings, paragraph order, and any existing transition sentences. Do not re-paraphrase for style.
- Do not invent new numbers, studies, quotes, or dates.
- If a comparison table is present in markdown, convert it to a real HTML <table>. If missing but a differences section exists, build a qualitative comparison table from substance already written (still no invented numeric ranges).
- You may fix only broken markdown/HTML structure and weed.com link formatting.

FOLLOW THE OUTLINE:
- Write for the outline persona only.
- Intro obeys intro.opening_rule.
- End with conclusion.approach before FAQ (short; no "In conclusion").
- FAQ: <h2>Frequently asked questions</h2> with exactly 4 or 5 Q&A pairs. Each question <h3>, answer <p>.

HUMAN / LOW-AI PROSE (critical):
- Sound like a sharp editor, not a content mill.
- Vary sentence length. Avoid stock AI openers and glue: "In today's world", "When it comes to", "Whether you're looking for", "It's important to note", "Ultimately,", "In conclusion", "delve into", "landscape", "robust", "comprehensive guide", "unlock", "elevate your".
- Do not restate the H2 in the first sentence of every section.
- Prefer specific contrasts over vague symmetry ("both offer unique benefits").

TONE & CLAIMS (T2 only):
- Hedged language: "evidence suggests", "many users report", "may help", "is often chosen for"
- NO health claims, NO "proven to", NO medical advice, NO specific pricing
- NO blanket US legal statements or long compliance disclaimers
- NO Dr. Tabibi Expert Insight blocks, NO PubMed citations, NO Sources section
- Always write cultivar names as "[Name] strain" in headings and body (no duplicate "strain").

HARD REQUIREMENTS:
- Include one HTML <table> with <thead> and <tbody> for side-by-side differences. Use <th> row labels and <td> per strain. Inline border-collapse + readable padding OK.
- Include a late buy/CTA section for both strains (shop links only if verified).
- Do NOT write a Seeds H2 yourself; seeds CTA is inserted after generation.

INTERNAL LINKS (when VERIFIED INTERNAL LINKS is non-empty):
- Include at least 4 internal <a> links when 4+ verified URLs are listed (otherwise use every verified URL at least once).
- ONLY use <a href="..."> for URLs listed under VERIFIED INTERNAL LINKS.
- Do NOT invent weed.com URLs. Descriptive anchor text; no links inside table headers.`;
}

/** Step 2a: draft ONE body section as substance-only markdown. Voice comes later. */
export function strainComparisonSectionSubstancePrompt(args: {
  sectionHeading: string;
  sectionIntent: string;
  wordBudget: number;
}): string {
  return `You draft ONE body section of an article. Substance only — voice comes later.

Write the section under this heading: "${args.sectionHeading}"
Section intent: ${args.sectionIntent}
Word budget: ${args.wordBudget} (±20%).

You MUST NOT:
- Write an introduction, conclusion, FAQ, summary, or key-takeaways block.
- Write transitions INTO or OUT of this section ("Now that we've covered…",
  "In the next section…"). The section stands alone.
- Add any claim, statistic, or example that is not in the material provided below.
- Invent numbers, dates, studies, or quotes. If you don't have a number, don't use one.

You MUST:
- Cover exactly what the intent asks for, nothing more.
- Be concrete and specific. Prefer real mechanics over generalities.
- Use the earmarked facts/links below where they fit naturally.
- Prefer "[Name] strain" wording for cultivars.
- For differences/table sections, you may use a markdown table with qualitative cells when numeric ranges are not provided.

Return only the section body as plain markdown (no H1, start at the given H2).`;
}

export function buildStrainComparisonSectionMaterial(args: {
  strainA: string;
  strainB: string;
  outline: StrainComparisonOutline;
  section: StrainComparisonOutlineH2;
  earmarkedLinks: string;
  primaryUseCase?: string;
}): string {
  const labelA = formatStrainLabel(args.strainA);
  const labelB = formatStrainLabel(args.strainB);
  const useCase =
    args.primaryUseCase?.trim() ||
    "Use the outline angle / persona to decide the decision criteria.";
  const h3Block =
    args.section.h3s.length > 0
      ? args.section.h3s
          .map((h) => `- H3 "${h.heading}" — intent: ${h.intent} (budget ~${h.word_budget})`)
          .join("\n")
      : "(none)";
  const covers =
    args.section.covers.length > 0
      ? args.section.covers.map((c) => `- ${c}`).join("\n")
      : "(none beyond the intent)";

  return `ARTICLE CONTEXT (facts you may use — invent nothing else):
- Site: ${SITE_NAME}
- Pair: ${labelA} vs ${labelB}
- Angle: ${args.outline.angle || "(none)"}
- Persona role: ${args.outline.persona.role}
- Persona context: ${args.outline.persona.context}
- Persona frustration: ${args.outline.persona.frustration}
- Persona already knows: ${args.outline.persona.already_knows}
- Use-case hint: ${useCase}
- This section covers:
${covers}
- Nested H3 plan:
${h3Block}

EARMARKED LINKS (optional; only use these URLs if you include a link):
${args.earmarkedLinks || "(none)"}

T2 CONSTRAINTS: hedge experience claims; no medical advice; no invented THC%/CBD% or study citations.

Draft the markdown section now.`;
}

/** Comparison opening pattern used when drafting intros with full body context. */
export function strainComparisonIntroPattern(openingRule?: string): string {
  const rule = (openingRule ?? "").trim();
  return `comparison: hook with the reader's friction (which strain fits their job) → give the headline comparison verdict in the first ~50 words → preview what this comparison settles (feel, timing, use-case winner). Don't bury the answer.${
    rule ? ` Extra opening rule from the outline: ${rule}` : ""
  }`;
}

/**
 * Write the introduction AFTER the body exists (full body for context).
 * Voice + humanisation are applied in this pass.
 */
export function strainComparisonIntroPrompt(args: {
  introPattern: string;
  wordBudget: number;
  voiceGuide: string;
}): string {
  return `Write the introduction for this article. You have the full body for context.

Rules:
- Follow this opening pattern: ${args.introPattern}
  (e.g. howto: hook with the reader's friction → give the headline answer in the first
   ~50 words → preview the steps. Don't bury the answer.)
- ${args.wordBudget} words.
- Do not re-summarise the whole article. Do not write "In this article, we will…".
- Match this voice: ${args.voiceGuide}
- Apply the same humanisation rules as the voice pass (vary sentence length, no filler
  openers, contractions, concrete specifics).
- No H2/H3 headings in the intro.
- Preserve any numbers, names, and URLs already present in the body when you reference them.
- Prefer "[Name] strain" wording for cultivars.

Return only the intro as markdown.`;
}

export function buildStrainComparisonIntroUserMessage(args: {
  strainA: string;
  strainB: string;
  outline: StrainComparisonOutline;
  earmarkedLinks: string;
  bodyMarkdown: string;
}): string {
  const labelA = formatStrainLabel(args.strainA);
  const labelB = formatStrainLabel(args.strainB);
  return `ARTICLE CONTEXT:
- Site: ${SITE_NAME}
- Pair: ${labelA} vs ${labelB}
- Angle: ${args.outline.angle || "(none)"}
- Persona role: ${args.outline.persona.role}
- Persona context: ${args.outline.persona.context}
- Persona frustration: ${args.outline.persona.frustration}
- Persona already knows: ${args.outline.persona.already_knows}

EARMARKED LINKS (optional; only these URLs if you link):
${args.earmarkedLinks || "(none)"}

FULL BODY MARKDOWN (context only — do not repeat it; write the intro only):
${args.bodyMarkdown}

Write the introduction markdown now.`;
}

/** @deprecated Prefer strainComparisonIntroPrompt + buildStrainComparisonIntroUserMessage */
export function strainComparisonIntroSubstancePrompt(wordBudget: number): string {
  return strainComparisonIntroPrompt({
    introPattern: strainComparisonIntroPattern(),
    wordBudget,
    voiceGuide: "Write like a sharp human cannabis editor. Direct, contracted, concrete.",
  });
}

/** @deprecated Prefer buildStrainComparisonIntroUserMessage */
export function buildStrainComparisonIntroMaterial(args: {
  strainA: string;
  strainB: string;
  outline: StrainComparisonOutline;
  earmarkedLinks: string;
  bodyMarkdown?: string;
}): string {
  return buildStrainComparisonIntroUserMessage({
    ...args,
    bodyMarkdown: args.bodyMarkdown ?? "(body not provided)",
  });
}

/** Comparison closing pattern used when drafting conclusions with full body context. */
export function strainComparisonConclusionPattern(approach?: string): string {
  const extra = (approach ?? "").trim();
  return `comparison: recap the one decision that matters for this persona → name the clearer pick (or when to flip) → next step / soft CTA to shop or dig into the strain pages. Do NOT restate the intro.${
    extra ? ` Extra approach from the outline: ${extra}` : ""
  }`;
}

/**
 * Write the conclusion AFTER body sections exist (full body for context).
 * Voice + humanisation are applied in this pass.
 */
export function strainComparisonConclusionPrompt(args: {
  conclusionPattern: string;
  wordBudget: number;
  voiceGuide: string;
}): string {
  return `Write the conclusion. You have the full body for context.

Rules:
- Pattern: ${args.conclusionPattern} (e.g. recap the one thing that matters → next step →
  soft CTA). Do NOT restate the intro.
- ${args.wordBudget} words.
- No "In conclusion" / "To sum up" openers.
- Voice: ${args.voiceGuide}. Apply humanisation rules.
- Use heading "## Closing pick" (or keep a short H2 if already present).
- Prefer "[Name] strain" wording for cultivars.
- Preserve any numbers, names, and URLs already present in the body when you reference them.
- Soft CTA only; no hard sell or invented pricing.

Return only the conclusion as markdown.`;
}

export function buildStrainComparisonConclusionUserMessage(args: {
  strainA: string;
  strainB: string;
  outline: StrainComparisonOutline;
  bodyMarkdown: string;
  earmarkedLinks?: string;
}): string {
  const labelA = formatStrainLabel(args.strainA);
  const labelB = formatStrainLabel(args.strainB);
  return `ARTICLE CONTEXT:
- Site: ${SITE_NAME}
- Pair: ${labelA} vs ${labelB}
- Angle: ${args.outline.angle || "(none)"}
- Persona role: ${args.outline.persona.role}
- Persona context: ${args.outline.persona.context}
- Persona frustration: ${args.outline.persona.frustration}
- Persona already knows: ${args.outline.persona.already_knows}

EARMARKED LINKS (optional soft CTA; only these URLs if you link):
${args.earmarkedLinks || "(none)"}

FULL BODY MARKDOWN (context only — do not restate the whole article; write the conclusion only):
${args.bodyMarkdown}

Write the conclusion markdown now.`;
}

/** @deprecated Prefer strainComparisonConclusionPrompt + buildStrainComparisonConclusionUserMessage */
export function strainComparisonConclusionSubstancePrompt(wordBudget: number): string {
  return strainComparisonConclusionPrompt({
    conclusionPattern: strainComparisonConclusionPattern(),
    wordBudget,
    voiceGuide: "Write like a sharp human cannabis editor. Direct, contracted, concrete.",
  });
}

/** @deprecated Prefer buildStrainComparisonConclusionUserMessage */
export function buildStrainComparisonConclusionMaterial(args: {
  strainA: string;
  strainB: string;
  outline: StrainComparisonOutline;
  bodyMarkdown?: string;
}): string {
  return buildStrainComparisonConclusionUserMessage({
    ...args,
    bodyMarkdown: args.bodyMarkdown ?? "(body not provided)",
  });
}

export function formatStrainComparisonPaaList(args: {
  strainA: string;
  strainB: string;
  faqTopics: string[];
}): string[] {
  const labelA = formatStrainLabel(args.strainA);
  const labelB = formatStrainLabel(args.strainB);
  const fromOutline = args.faqTopics.map((t) => t.trim()).filter(Boolean);
  const defaults = [
    `Is ${labelA} stronger than ${labelB}?`,
    `What are the effects of ${labelA} vs ${labelB}?`,
    `Which is better for sleep — ${labelA} or ${labelB}?`,
    `What does ${labelA} taste like compared to ${labelB}?`,
    `Can you mix ${labelA} and ${labelB}?`,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of [...fromOutline, ...defaults]) {
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out.slice(0, 8);
}

export function formatStrainComparisonOutlineGaps(outline: StrainComparisonOutline): string[] {
  return outline.structure
    .map((s) => {
      const covers = s.covers?.length ? ` (covers: ${s.covers.join("; ")})` : "";
      return `${s.heading} — ${s.intent}${covers}`;
    })
    .filter(Boolean);
}

/**
 * Write FAQs AFTER body exists so answers do not repeat body content.
 * Returns JSON array only.
 */
export function strainComparisonFaqPrompt(args: {
  faqMin: number;
  faqMax: number;
  paaList: string[];
  faqTopics: string[];
  outlineGaps: string[];
  voiceGuide: string;
}): string {
  const paa = args.paaList.map((q) => `- ${q}`).join("\n") || "- (none)";
  const topics = args.faqTopics.map((t) => `- ${t}`).join("\n") || "- (none)";
  const gaps = args.outlineGaps.map((g) => `- ${g}`).join("\n") || "- (none)";
  return `Write ${args.faqMin}–${args.faqMax} FAQs for this article.

Rules:
- Base questions on: outline gaps, real "People Also Ask" queries (${paa}), and
  must-cover gaps (${topics}).
- Also consider these outline section gaps if unanswered in the body:
${gaps}
- Do NOT repeat anything already answered in the body. Check the body first.
- Each answer 40–90 words, direct, front-loaded with the answer.
- Voice: ${args.voiceGuide}. Apply humanisation rules.
- Prefer "[Name] strain" wording for cultivars.
- No invented numbers, studies, dates, or quotes.
- T2 hedging for effects (many users report / evidence suggests / may help).

Return valid JSON: [ { "question": string, "answer": string } ]. No prose, no fences.`;
}

export function buildStrainComparisonFaqUserMessage(args: {
  strainA: string;
  strainB: string;
  outline: StrainComparisonOutline;
  bodyMarkdown: string;
}): string {
  const labelA = formatStrainLabel(args.strainA);
  const labelB = formatStrainLabel(args.strainB);
  return `ARTICLE CONTEXT:
- Site: ${SITE_NAME}
- Pair: ${labelA} vs ${labelB}
- Angle: ${args.outline.angle || "(none)"}
- Persona: ${args.outline.persona.role} / ${args.outline.persona.context}

FULL BODY + CONCLUSION MARKDOWN (check this first — do not repeat answered points):
${args.bodyMarkdown}

Return the FAQ JSON array now.`;
}

export type StrainComparisonFaqItem = { question: string; answer: string };

export function parseStrainComparisonFaqJson(raw: string): StrainComparisonFaqItem[] {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) cleaned = arrMatch[0];
  cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");
  const parsed = JSON.parse(cleaned) as unknown;
  if (!Array.isArray(parsed)) throw new Error("FAQ response was not a JSON array.");
  const items: StrainComparisonFaqItem[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const q = String((row as { question?: unknown }).question ?? "").trim();
    const a = String((row as { answer?: unknown }).answer ?? "").trim();
    if (q && a) items.push({ question: q, answer: a });
  }
  if (items.length < STRAIN_COMPARISON_FAQ_MIN) {
    throw new Error(
      `FAQ JSON returned ${items.length} items; need ${STRAIN_COMPARISON_FAQ_MIN}–${STRAIN_COMPARISON_FAQ_MAX}.`
    );
  }
  return items.slice(0, STRAIN_COMPARISON_FAQ_MAX);
}

export function strainComparisonFaqItemsToMarkdown(items: StrainComparisonFaqItem[]): string {
  const blocks = items.map((item) => `### ${item.question}\n\n${item.answer}`);
  return `## Frequently asked questions\n\n${blocks.join("\n\n")}`;
}

/** @deprecated Prefer strainComparisonFaqPrompt + JSON parse */
export function strainComparisonFaqSubstancePrompt(): string {
  return strainComparisonFaqPrompt({
    faqMin: STRAIN_COMPARISON_FAQ_MIN,
    faqMax: STRAIN_COMPARISON_FAQ_MAX,
    paaList: [],
    faqTopics: [],
    outlineGaps: [],
    voiceGuide: "Write like a sharp human cannabis editor. Direct, contracted, concrete.",
  });
}

/** @deprecated Prefer buildStrainComparisonFaqUserMessage */
export function buildStrainComparisonFaqMaterial(args: {
  strainA: string;
  strainB: string;
  outline: StrainComparisonOutline;
  bodyMarkdown?: string;
}): string {
  return buildStrainComparisonFaqUserMessage({
    ...args,
    bodyMarkdown: args.bodyMarkdown ?? "(body not provided)",
  });
}

/** Step 2b: sentence-level humanization. Does not change what the text says. */
export function strainComparisonHumanizePrompt(voiceGuide: string): string {
  return `You rewrite a section of prose to sound like it was written by a specific human expert.
You do sentence-level rewriting. You do NOT change what the text says.

VOICE GUIDE (follow exactly):
${voiceGuide}
# ^ your voice.md: tone, rhythm rules, idioms, 3–5 before/after "neutral → our voice"
#   examples. This is the most important input — invest here.

HARD CONSTRAINTS — never violate:
- Preserve every number, name, date, URL, product name, and quoted phrase EXACTLY.
- Do not add or remove information. Do not merge, split, or reorder paragraphs.
- Same length (±10%). This is a rewrite, not an expansion.
- Keep markdown headings (# / ## / ###), lists, tables, and link targets unchanged.

HUMANISATION (this is what lowers AI-detection scores — apply all):
- Vary sentence length hard. Follow a 25-word sentence with a 4-word one. Uniform
  medium-length sentences are the #1 AI tell.
- Use contractions. Occasional sentence fragments are fine for emphasis.
- Cut hedging stacks ("it's worth noting that it may potentially…") to one clear claim.
- Kill signpost filler: "In today's fast-paced world", "It's important to note",
  "delve", "navigate the landscape", "when it comes to", "in conclusion",
  "unlock/unleash/harness", "not only… but also", "plays a crucial/vital/pivotal role".
- Break the tricolon habit — don't list three parallel items every paragraph.
- Prefer concrete verbs and specifics over abstract nouns. Show the mechanic.
- Let paragraphs be uneven. Real writing isn't rhythmically perfect.
- Don't over-explain the obvious or add summary sentences at the end of paragraphs.

Return only the rewritten section as markdown. No commentary.`;
}

/** Step 3: lightly stitch voiced sections into one continuous markdown article. */
export function strainComparisonAssembleMarkdownPrompt(): string {
  return `You are assembling voiced sections into one article. Add only the connective tissue
needed so it reads as a single continuous piece.

You MAY: add or adjust a transition sentence between sections; fix a jarring jump.
You MUST NOT: change any facts, numbers, links, or the substance of any section; rewrite
whole paragraphs; add new claims.

Keep transitions light — one sentence at most, and only where a real gap exists. Do not
add a transition to every boundary. Return the full article as markdown.`;
}

export function buildStrainComparisonAssembleUserMessage(args: {
  strainA: string;
  strainB: string;
  outline: StrainComparisonOutline;
  sectionsMarkdown: string;
}): string {
  const labelA = formatStrainLabel(args.strainA);
  const labelB = formatStrainLabel(args.strainB);
  return `ARTICLE CONTEXT:
- Site: ${SITE_NAME}
- Pair: ${labelA} vs ${labelB}
- Angle: ${args.outline.angle || "(none)"}
- Persona: ${args.outline.persona.role}

VOICED SECTIONS (already final substance — stitch lightly only):
${args.sectionsMarkdown}

Return the full continuous article markdown now.`;
}

export type StrainComparisonEditorSendBack = {
  section: string;
  reason: string;
  fix: string;
};

export type StrainComparisonEditorReview = {
  verdict: "approve" | "send_back";
  light_edits_applied: string[];
  send_back: StrainComparisonEditorSendBack[];
  article_markdown: string;
};

/** Step 5: managing editor — flag + light edits only; no section rewrites. */
export function strainComparisonManagingEditorPrompt(voiceGuide: string): string {
  return `You are the managing editor. Review the assembled article against the brief, the voice
guide, and the humanisation standard. You FLAG and make only light edits — you do not
rewrite sections.

VOICE GUIDE:
${voiceGuide}

Check:
- Does it deliver the stated angle for the stated persona?
- Voice consistency across sections (any section that reverts to flat/AI cadence?).
- Any 5+ sentence paragraph, any uniform sentence rhythm, any surviving filler phrases.
- Any claim/number that reads invented or unsupported.
- Intro answers fast; conclusion doesn't restate the intro.
- Blocked AI fillers (e.g. "when it comes to", "in conclusion", "delve into", "elevate your") must be cut.

Return JSON:
{
  "verdict": "approve" | "send_back",
  "light_edits_applied": string[],
  "send_back": [ { "section": string, "reason": string, "fix": string } ],
  "article_markdown": string
}
If verdict is "send_back", list each section that needs a voice-pass redo.
Keep light_edits_applied to tiny inline fixes you already applied in article_markdown
(word swaps, cutting one filler clause, breaking one overlong sentence). Do not rewrite sections here.
No prose outside the JSON.`;
}

export function buildStrainComparisonManagingEditorUserMessage(args: {
  strainA: string;
  strainB: string;
  outline: StrainComparisonOutline;
  articleMarkdown: string;
}): string {
  const labelA = formatStrainLabel(args.strainA);
  const labelB = formatStrainLabel(args.strainB);
  return `BRIEF:
- Site: ${SITE_NAME}
- Pair: ${labelA} vs ${labelB}
- Angle: ${args.outline.angle || "(none)"}
- Persona role: ${args.outline.persona.role}
- Persona context: ${args.outline.persona.context}
- Persona frustration: ${args.outline.persona.frustration}
- Persona already knows: ${args.outline.persona.already_knows}
- Intro opening rule: ${args.outline.intro.opening_rule}
- Conclusion approach: ${args.outline.conclusion.approach}
- Structure headings: ${args.outline.structure.map((s) => s.heading).join(" | ")}

ASSEMBLED ARTICLE MARKDOWN:
${args.articleMarkdown}

Return the review JSON now.`;
}

export function parseStrainComparisonEditorReview(raw: string): StrainComparisonEditorReview {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) cleaned = objMatch[0];
  cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  const verdict = parsed.verdict === "send_back" ? "send_back" : "approve";
  const light =
    Array.isArray(parsed.light_edits_applied)
      ? parsed.light_edits_applied.map((x) => String(x).trim()).filter(Boolean)
      : [];
  const sendBackRaw = Array.isArray(parsed.send_back) ? parsed.send_back : [];
  const send_back: StrainComparisonEditorSendBack[] = sendBackRaw
    .map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        section: String(r.section ?? "").trim(),
        reason: String(r.reason ?? "").trim(),
        fix: String(r.fix ?? "").trim(),
      };
    })
    .filter((r) => r.section.length > 0);

  const article_markdown = String(parsed.article_markdown ?? "").trim();
  if (!article_markdown || article_markdown.length < 200) {
    throw new Error("Managing editor review missing article_markdown.");
  }

  return {
    verdict: send_back.length > 0 ? "send_back" : verdict,
    light_edits_applied: light,
    send_back,
    article_markdown,
  };
}

function escapeRegexLocal(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract a markdown section by heading label (or intro / closing / FAQ aliases). */
export function extractMarkdownSection(article: string, sectionName: string): { full: string; start: number; end: number } | null {
  const name = sectionName.trim().toLowerCase();
  if (!name) return null;

  if (name === "intro" || name === "introduction") {
    const m = article.match(/^([\s\S]*?)(?=\n##\s|$)/);
    if (!m) return null;
    return { full: m[1].trimEnd(), start: 0, end: m[1].length };
  }

  const aliases: Record<string, RegExp> = {
    faq: /frequently asked questions/i,
    "frequently asked questions": /frequently asked questions/i,
    closing: /closing pick|conclusion|closing/i,
    conclusion: /closing pick|conclusion|closing/i,
    "closing pick": /closing pick/i,
  };

  const headingRe = aliases[name] ?? new RegExp(escapeRegexLocal(sectionName.trim()).replace(/\s+/g, "\\s+"), "i");
  const h2Global = /(?:^|\n)(##\s+[^\n]+)\n/g;
  const headings: Array<{ title: string; index: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = h2Global.exec(article)) !== null) {
    headings.push({
      title: m[1].replace(/^##\s+/, "").trim(),
      index: m.index + (m[0].startsWith("\n") ? 1 : 0),
      bodyStart: m.index + m[0].length,
    });
  }

  let hit = headings.findIndex((h) => headingRe.test(h.title));
  if (hit < 0) {
    hit = headings.findIndex((h) => h.title.toLowerCase().includes(name) || name.includes(h.title.toLowerCase()));
  }
  if (hit < 0) return null;

  const start = headings[hit].index;
  const end = hit + 1 < headings.length ? headings[hit + 1].index : article.length;
  return { full: article.slice(start, end).trim(), start, end };
}

export function replaceMarkdownSection(article: string, start: number, end: number, replacement: string): string {
  const before = article.slice(0, start).replace(/\s+$/, "");
  const after = article.slice(end).replace(/^\s+/, "");
  const mid = replacement.trim();
  return [before, mid, after].filter((p) => p.length > 0).join("\n\n");
}

const AI_FILLER_RE =
  /\b(in today's(?:\s+\w+)?\s+world|it's important to note|when it comes to|in conclusion|delve(?:s|d|ing)?(?:\s+into)?|navigate the landscape|unlock|unleash|harness|not only\b[\s\S]{0,80}\bbut also|plays a (?:crucial|vital|pivotal) role|comprehensive (?:guide|overview)|unique benefits|depending on your (?:goals|needs|preferences)|elevate your)\b/i;

function sentenceWordCounts(paragraph: string): number[] {
  const sentences = paragraph
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^#{1,6}\s/.test(s));
  return sentences.map((s) => s.split(/\s+/).filter(Boolean).length).filter((n) => n > 0);
}

function looksUniformMediumSentences(counts: number[]): boolean {
  if (counts.length < 3) return false;
  const medium = counts.filter((n) => n >= 12 && n <= 22);
  if (medium.length < Math.ceil(counts.length * 0.75)) return false;
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((a, n) => a + (n - avg) ** 2, 0) / counts.length;
  return variance < 18;
}

function looksTricolonHeavy(paragraph: string): boolean {
  // "X, Y, and Z" / "X, Y, or Z" patterns stacked
  const matches = paragraph.match(/\b[\w'-]+,\s+[\w'-]+,\s+(?:and|or)\s+[\w'-]+\b/gi) ?? [];
  return matches.length >= 2;
}

/**
 * Heuristic AI-tell flagger for post-humanize hard rewrite.
 * Returns prose paragraphs that still look detector-friendly.
 */
export function flagLikelyAiPassages(markdown: string): string[] {
  const blocks = markdown
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const flagged: string[] = [];
  const longParas = paragraphCheck(markdown);
  const bannedPreviews = new Set(
    findBannedPhraseHits(markdown)
      .filter((h) => h.level === "block")
      .map((h) => h.paragraphPreview)
  );

  for (const block of blocks) {
    if (/^#{1,6}\s/.test(block)) continue;
    if (/^\|/.test(block) || block.includes("| ---")) continue; // tables
    if (/^[-*]\s/m.test(block) && block.split("\n").every((l) => /^[-*]\s|^$/.test(l.trim()))) continue;
    const plain = block.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "");
    if (plain.split(/\s+/).filter(Boolean).length < 18) continue;

    const preview = block.slice(0, 80);
    if (
      bannedPreviews.has(preview) ||
      longParas.some((p) => p === preview || block.startsWith(p) || p.startsWith(preview.slice(0, 40)))
    ) {
      flagged.push(block);
      continue;
    }

    const counts = sentenceWordCounts(plain);
    const reasons =
      AI_FILLER_RE.test(plain) ||
      looksUniformMediumSentences(counts) ||
      looksTricolonHeavy(plain) ||
      /\b(both offer|offers? a (?:unique|perfect|ideal)|whether you(?:'re| are) looking)\b/i.test(plain);

    if (reasons) flagged.push(block);
  }
  return flagged;
}

/** Step 2c: harder rewrite for passages that still read as AI-generated. */
export function strainComparisonHardAiPassageRewritePrompt(flaggedPassages: string): string {
  return `The following passages scored as AI-generated. Rewrite them harder — more sentence-length
variation, more concrete specifics, fewer parallel structures — WITHOUT changing meaning
or any numbers/names/links:
${flaggedPassages}

HARD CONSTRAINTS:
- Preserve every number, name, date, URL, product name, and quoted phrase EXACTLY.
- Do not add or remove information. Do not invent facts.
- Keep markdown headings, lists, tables, and link targets intact.
- Same overall length (±10%) for each rewritten passage.
- Return the FULL section markdown with only the flagged passages rewritten.
- No commentary.`;
}

export function buildHardAiRewriteUserMessage(args: {
  fullSectionMarkdown: string;
  flaggedPassages: string[];
}): string {
  const flaggedBlock = args.flaggedPassages
    .map((p, i) => `--- flagged ${i + 1} ---\n${p}`)
    .join("\n\n");
  return `${strainComparisonHardAiPassageRewritePrompt(flaggedBlock)}

FULL SECTION MARKDOWN (return complete section; rewrite only the flagged passages more aggressively):
${args.fullSectionMarkdown}`;
}

export function pickEarmarkedLinksForSection(
  verifiedLinksText: string,
  sectionHeading: string,
  sectionIntent: string,
  kindHint: "intro" | "body" | "buy" | "effects" | "general" = "general"
): string {
  const lines = verifiedLinksText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"));
  if (lines.length === 0) return "(none)";

  const blob = `${sectionHeading} ${sectionIntent}`.toLowerCase();
  const prefer = (re: RegExp) => lines.filter((l) => re.test(l));

  let picked: string[] = [];
  if (kindHint === "intro" || /hub|compare more|overview/i.test(blob)) {
    picked = prefer(/\[hub\]/i);
  } else if (kindHint === "buy" || /buy|shop|purchase|where to/i.test(blob)) {
    picked = [...prefer(/\[shop\]/i), ...prefer(/\[product\]/i)];
  } else if (kindHint === "effects" || /effect|feel|high|experience/i.test(blob)) {
    picked = [...prefer(/\[editorial\]/i), ...prefer(/\[effect\]/i)];
  } else {
    picked = [...prefer(/\[strain\]/i), ...prefer(/\[editorial\]/i)];
  }

  if (picked.length === 0) picked = lines.slice(0, 3);
  return picked.slice(0, 4).join("\n");
}

export function buildStrainComparisonVoiceUserMessage(args: {
  strainA: string;
  strainB: string;
  strainAUrl: string | null;
  strainBUrl: string | null;
  primaryUseCase?: string;
  verifiedLinks: string;
  outline: StrainComparisonOutline;
  substanceMarkdown: string;
}): string {
  const useCase =
    args.primaryUseCase?.trim() ||
    "Choose the most searched use case for this pair (sleep, anxiety, pain, energy, or focus).";
  const strainALine = args.strainAUrl
    ? `Strain A verified page: ${args.strainAUrl}`
    : `Strain A: ${args.strainA} (NO verified page — do not link; plain text only)`;
  const strainBLine = args.strainBUrl
    ? `Strain B verified page: ${args.strainBUrl}`
    : `Strain B: ${args.strainB} (NO verified page — do not link; plain text only)`;
  return `Strain A: ${args.strainA} (display as "${formatStrainLabel(args.strainA)}" in headings and body)
Strain B: ${args.strainB} (display as "${formatStrainLabel(args.strainB)}" in headings and body)
${strainALine}
${strainBLine}
Primary use case hint: ${useCase}

OUTLINE JSON (keep persona + section intents):
${JSON.stringify(args.outline, null, 2)}

VERIFIED INTERNAL LINKS (only these may appear in <a href>):
${args.verifiedLinks}

SUBSTANCE DRAFTS (markdown, already humanized). Convert to polished HTML. Preserve wording. Do not invent new facts/numbers:
${args.substanceMarkdown}

Return the full comparison article HTML now.`;
}

export function buildStrainComparisonUserMessage(args: {
  strainA: string;
  strainB: string;
  strainAUrl: string | null;
  strainBUrl: string | null;
  primaryUseCase?: string;
  verifiedLinks: string;
  outline: StrainComparisonOutline;
}): string {
  return buildStrainComparisonVoiceUserMessage({ ...args, substanceMarkdown: "(none — write from outline)" });
}
