/** Weed.com strain comparison pages: /learn/[strain-a]-vs-[strain-b]/ */

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

export function strainComparisonSystemPrompt(): string {
  return `You write Weed.com strain comparison articles for /learn/[strain-a]-vs-[strain-b]/ URLs.

OUTPUT: Raw HTML only. No markdown fences. No <!DOCTYPE>, <html>, or <h1> (CMS sets title separately).
Typography: Never use the em dash (U+2014). Use " - " or commas instead.
Font: Inter, system-ui, sans-serif on all text blocks.

TARGET LENGTH: ${STRAIN_COMPARISON_WORD_MIN}–${STRAIN_COMPARISON_WORD_MAX} words (aim ~${STRAIN_COMPARISON_WORD_TARGET}).

TONE & CLAIMS (T2 only):
- Use hedged language: "evidence suggests", "many users report", "may help", "is often chosen for"
- NO health claims, NO "proven to", NO medical advice, NO specific pricing
- NO blanket US legal statements or long compliance disclaimers
- NO Dr. Tabibi Expert Insight blocks, NO PubMed citations, NO Sources section

REQUIRED STRUCTURE (use exact H2 headings — always write cultivar names as "[Name] strain", e.g. "Remedy strain"):

1) Introduction (~100 words, first <p> only)
- Hook with the key difference between the two strains
- Who each is for
- First factual comparison verdict in the first 60 words (AI engines extract this)
- Example pattern: "[Strain A] strain is a sativa-dominant hybrid best for daytime energy, while [Strain B] strain is an indica-dominant hybrid better suited for evening relaxation."

2) <h2>What Is [Strain A] strain?</h2> (~150 words)
Lineage, typical THC% range, CBD% if known, dominant terpenes, primary effects, best use case.

3) <h2>What Is [Strain B] strain?</h2> (~150 words)
Same structure.

4) <h2>[Strain A] strain vs [Strain B] strain — Key Differences</h2>
Include an HTML <table> with <thead> and <tbody> covering rows for:
THC% range, CBD% range, Dominant terpenes, Primary effects, Best time of day, Best for (sleep/anxiety/pain/creativity/focus/relaxation), Flavour profile, Growing difficulty.
Use <th> for row labels and <td> for each strain column. Style table with border-collapse and readable padding inline if needed.

5) <h2>Effects Comparison</h2> (~200 words)
How each strain feels, onset, duration, intensity. T2 language only.

6) <h2>Which Strain Is Better for [Use Case]?</h2> (~150 words)
Pick the most relevant use case for this pair (sleep, anxiety, pain, energy, or focus) and declare which wins with evidence-suggests framing.

7) <h2>Where to Buy [Strain A] strain and [Strain B] strain</h2>
CTA section. Link only to verified shop/strain URLs from the list below. If no shop URLs are verified, write the CTA without product links.

8) <h2>Buy [Strain A] strain and [Strain B] strain Seeds</h2>
Short CTA (~60-80 words) for home growers. Link to the verified seeds hub URL from VERIFIED INTERNAL LINKS (/seeds/ when listed) in the body text only — not in the H2 heading. Mention both strain names with "strain" (e.g. "Remedy strain and Cannatonic strain").

9) <h2>Frequently asked questions</h2>
Exactly 4 or 5 Q&A pairs. Each question <h3>, answer <p>. PAA-style questions such as:
- Is [A] strain stronger than [B] strain?
- What are the effects of [A] strain vs [B] strain?
- Which is better for sleep/anxiety/pain — [A] strain or [B] strain?
- What does [A] strain taste like compared to [B] strain?
- Can you mix [A] strain and [B] strain?

INTERNAL LINKS (required when VERIFIED INTERNAL LINKS is non-empty):
- Include at least 4 internal <a> links when 4+ verified URLs are listed (otherwise use every verified URL at least once).
- Link [Strain A] strain to its verified strain page in section 2 (What Is [Strain A] strain?).
- Link [Strain B] strain to its verified strain page in section 3 (What Is [Strain B] strain?).
- Link the strains hub (/strains/) in the introduction or Key Differences section.
- Include at least 1 editorial or effect-page link in Effects Comparison or the use-case section.
- Use shop/product/hub links in sections 7-8 (Where to Buy and Seeds).
- ONLY use <a href="..."> for URLs listed under VERIFIED INTERNAL LINKS in the user message.
- Do NOT invent, guess, or construct weed.com URLs (no /effects/, /strains/, or shop paths unless explicitly listed).
- If a strain has no verified page URL in the list, mention the strain name as plain text without a link.
- Never link to pages that might 404. When in doubt, use plain text.
- Weave verified links naturally with descriptive anchor text; do not place links inside table headers.`;
}

export function buildStrainComparisonUserMessage(args: {
  strainA: string;
  strainB: string;
  strainAUrl: string | null;
  strainBUrl: string | null;
  primaryUseCase?: string;
  verifiedLinks: string;
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
Primary use case for section 6: ${useCase}

Naming: Always append the word "strain" after each cultivar name in headings and comparison copy (e.g. "Remedy strain vs Cannatonic strain"). Do not duplicate "strain" if the input already includes it.

Suggested URL path: /learn/${strainComparisonSlug(args.strainA, args.strainB)}/
Post title (CMS, not in body): ${strainComparisonPostTitle(args.strainA, args.strainB)}
Focus keyword: ${strainComparisonFocusKeyword(args.strainA, args.strainB)}

VERIFIED INTERNAL LINKS (only these may appear in <a href> — no other weed.com URLs):
${args.verifiedLinks}

Include every strain, hub, and editorial URL above at least once when listed. Use shop/product links in the buy and seeds sections.

Write the full comparison article HTML now.`;
}
