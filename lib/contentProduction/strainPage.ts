/** Weed.com individual strain pages: /strains/[strain-slug]/ */

import { slugifyStrainName, stripStrainWordSuffix } from "@/lib/contentProduction/strainComparison";

export const STRAIN_PAGE_WORD_TARGET = 700;
export const STRAIN_PAGE_WORD_MIN = 600;
export const STRAIN_PAGE_WORD_MAX = 800;
export const STRAIN_PAGE_FAQ_MIN = 4;
export const STRAIN_PAGE_FAQ_MAX = 5;

export const STRAIN_TYPES = [
  "Sativa",
  "Indica",
  "Hybrid",
  "Sativa-dominant Hybrid",
  "Indica-dominant Hybrid",
  "Balanced Hybrid",
] as const;

export const TERPENES = [
  "Myrcene",
  "Caryophyllene",
  "Limonene",
  "Pinene",
  "Terpinolene",
  "Linalool",
  "Ocimene",
  "Humulene",
] as const;

export const TERPENE_COLORS: Record<(typeof TERPENES)[number], string> = {
  Myrcene: "Green",
  Caryophyllene: "Red",
  Limonene: "Yellow",
  Pinene: "Blue",
  Terpinolene: "Orange",
  Linalool: "Purple",
  Humulene: "Brown",
  Ocimene: "Teal",
};

export const PRIMARY_EFFECTS = [
  "Relaxed",
  "Uplifting",
  "Euphoric",
  "Sleepy",
  "Creative",
  "Focused",
  "Happy",
  "Energetic",
  "Calm",
  "Talkative",
] as const;

export const NEGATIVE_EFFECTS = [
  "Dry mouth",
  "Dry eyes",
  "Paranoia",
  "Anxiety",
  "Dizziness",
  "Headache",
  "Insomnia",
] as const;

export const FLAVOURS = [
  "Earthy",
  "Sweet",
  "Citrus",
  "Berry",
  "Pine",
  "Diesel",
  "Floral",
  "Spicy",
  "Tropical",
  "Grape",
  "Vanilla",
  "Coffee",
  "Chocolate",
  "Mint",
  "Blueberry",
  "Lemon",
  "Mango",
] as const;

export const HELP_WITH = [
  "Anxiety",
  "Sleep",
  "Body Relief",
  "Stress",
  "Depression",
  "Fatigue",
  "Focus",
  "Appetite",
] as const;

export type StrainPageCustomFields = {
  strainType: (typeof STRAIN_TYPES)[number];
  thcRange: string;
  cbdRange: string;
  thcaPercent?: string;
  terpene1: (typeof TERPENES)[number];
  terpene2: (typeof TERPENES)[number];
  terpene3: (typeof TERPENES)[number];
  primaryEffects: Array<(typeof PRIMARY_EFFECTS)[number]>;
  negativeEffects: Array<(typeof NEGATIVE_EFFECTS)[number]>;
  flavours: Array<(typeof FLAVOURS)[number]>;
  helpWith: Array<(typeof HELP_WITH)[number]>;
};

export type StrainPageInput = {
  strainName: string;
  strainUrl?: string;
  /** When updating an existing WordPress strain post */
  postId?: number;
  /** Optional lineage or breeder notes for the model */
  lineageNotes?: string;
};

const LINK_FONT = "font-family: Inter,system-ui,sans-serif;";

export function formatStrainDisplayName(name: string): string {
  return stripStrainWordSuffix(name.trim());
}

export function strainPageSlug(strainName: string): string {
  return slugifyStrainName(strainName);
}

export function strainPagePostTitle(strainName: string): string {
  return `${formatStrainDisplayName(strainName)} Strain`;
}

export function strainPageSuggestedPath(strainName: string): string {
  return `/strains/${strainPageSlug(strainName)}/`;
}

export function strainPageFocusKeyword(strainName: string): string {
  return `${formatStrainDisplayName(strainName).toLowerCase()} strain`.slice(0, 191);
}

export function strainPageMetaTitle(strainName: string): string {
  return `${formatStrainDisplayName(strainName)} Strain — Effects, Terpenes & Products | Weed.com`.slice(0, 200);
}

export function strainPageMetaDescription(
  strainName: string,
  fields: Pick<StrainPageCustomFields, "strainType" | "thcRange" | "primaryEffects">
): string {
  const name = formatStrainDisplayName(strainName);
  const effects = fields.primaryEffects.slice(0, 2).join(" and ").toLowerCase() || "distinct effects";
  const text = `Discover ${name}: ${fields.strainType.toLowerCase()}, THC ${fields.thcRange}, known for ${effects}. Explore terpenes, flavours, and shop ${name} products at Weed.com.`;
  return text.length <= 156 ? text : `${text.slice(0, 153).trim()}...`;
}

export function defaultStrainPageUrl(siteOrigin: string, strainName: string): string {
  const base = siteOrigin.replace(/\/$/, "");
  return `${base}/strains/${strainPageSlug(strainName)}/`;
}

/** Map custom fields to WordPress meta keys (ACF / REST). */
export function strainPageCustomFieldsToMeta(fields: StrainPageCustomFields): Record<string, string> {
  const join = (arr: string[]) => arr.join(", ");
  const meta: Record<string, string> = {
    strain_type: fields.strainType,
    thc_range: fields.thcRange,
    cbd_range: fields.cbdRange,
    terpene_1: fields.terpene1,
    terpene_2: fields.terpene2,
    terpene_3: fields.terpene3,
    primary_effects: join(fields.primaryEffects),
    negative_effects: join(fields.negativeEffects),
    flavours: join(fields.flavours),
    help_with: join(fields.helpWith),
  };
  if (fields.thcaPercent?.trim()) meta.thca_percent = fields.thcaPercent.trim();
  return meta;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildStrainPageSeedsSection(strainName: string, siteOrigin: string): string {
  const name = formatStrainDisplayName(strainName);
  const seedsUrl = `${siteOrigin.replace(/\/$/, "")}/seeds/`;
  return `<h2 style="${LINK_FONT}">Buy ${name} Seeds</h2>
<p style="${LINK_FONT}">Want to grow ${name} at home? ${name} seeds are available at Weed.com alongside 300+ other premium genetics. Whether you are a first-time grower or an experienced cultivator, quality genetics make the biggest difference.</p>
<p style="${LINK_FONT}"><a href="${seedsUrl}">Browse all cannabis seeds at Weed.com</a> — /seeds/</p>`;
}

export function buildStrainPageClonesSection(strainName: string, siteOrigin: string): string {
  const name = formatStrainDisplayName(strainName);
  const seedsUrl = `${siteOrigin.replace(/\/$/, "")}/seeds/`;
  return `<h2 style="${LINK_FONT}">${name} Clones</h2>
<p style="${LINK_FONT}">Prefer to start from a cutting rather than seed? ${name} clones offer a head start — you skip germination and start with a genetically identical plant to the mother. Check back for clone availability at Weed.com, or <a href="${seedsUrl}">browse seeds to start growing today</a> — /seeds/</p>`;
}

export function hasStrainPageSeedsSection(html: string, strainName: string): boolean {
  const name = escapeRegex(formatStrainDisplayName(strainName));
  return new RegExp(`<h2[^>]*>\\s*Buy\\s+${name}\\s+Seeds\\s*</h2>`, "i").test(html);
}

export function hasStrainPageClonesSection(html: string, strainName: string): boolean {
  const name = escapeRegex(formatStrainDisplayName(strainName));
  return new RegExp(`<h2[^>]*>\\s*${name}\\s+Clones\\s*</h2>`, "i").test(html);
}

export function ensureStrainPageSeedsSection(html: string, strainName: string, siteOrigin: string): string {
  if (hasStrainPageSeedsSection(html, strainName)) return html;
  const section = buildStrainPageSeedsSection(strainName, siteOrigin);
  const faqMatch = html.match(/<h2[^>]*>\s*Frequently asked questions\s*<\/h2>/i);
  if (faqMatch?.index != null) {
    return `${html.slice(0, faqMatch.index).trimEnd()}\n\n${section}\n\n${html.slice(faqMatch.index)}`;
  }
  return `${html.trimEnd()}\n\n${section}`;
}

export function ensureStrainPageClonesSection(html: string, strainName: string, siteOrigin: string): string {
  if (hasStrainPageClonesSection(html, strainName)) return html;
  const section = buildStrainPageClonesSection(strainName, siteOrigin);
  const faqMatch = html.match(/<h2[^>]*>\s*Frequently asked questions\s*<\/h2>/i);
  if (faqMatch?.index != null) {
    return `${html.slice(0, faqMatch.index).trimEnd()}\n\n${section}\n\n${html.slice(faqMatch.index)}`;
  }
  const seedsMatch = html.match(/<h2[^>]*>\s*Buy\s+[^<]+\s+Seeds\s*<\/h2>/i);
  if (seedsMatch?.index != null) {
    const afterSeeds = html.slice(seedsMatch.index);
    const nextH2 = afterSeeds.slice(seedsMatch[0].length).search(/<h2\b/i);
    const insertAt =
      nextH2 >= 0 ? seedsMatch.index + seedsMatch[0].length + nextH2 : html.length;
    return `${html.slice(0, insertAt).trimEnd()}\n\n${section}\n\n${html.slice(insertAt)}`;
  }
  return `${html.trimEnd()}\n\n${section}`;
}

function pickFromList<T extends string>(value: unknown, allowed: readonly T[], max: number): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const match = allowed.find((a) => a.toLowerCase() === item.trim().toLowerCase());
    if (match && !out.includes(match)) out.push(match);
    if (out.length >= max) break;
  }
  return out;
}

function pickOne<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== "string") return fallback;
  const match = allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase());
  return match ?? fallback;
}

/** Normalize and validate model-produced custom fields. */
export function normalizeStrainPageCustomFields(raw: unknown): StrainPageCustomFields {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const primaryEffects = pickFromList(obj.primaryEffects ?? obj.primary_effects, PRIMARY_EFFECTS, 3);
  const negativeEffects = pickFromList(obj.negativeEffects ?? obj.negative_effects, NEGATIVE_EFFECTS, 3);
  const flavours = pickFromList(obj.flavours ?? obj.flavors, FLAVOURS, 4);
  const helpWith = pickFromList(obj.helpWith ?? obj.help_with, HELP_WITH, 2);

  return {
    strainType: pickOne(obj.strainType ?? obj.strain_type, STRAIN_TYPES, "Hybrid"),
    thcRange: typeof obj.thcRange === "string" ? obj.thcRange.trim() : typeof obj.thc_range === "string" ? obj.thc_range.trim() : "18–24%",
    cbdRange: typeof obj.cbdRange === "string" ? obj.cbdRange.trim() : typeof obj.cbd_range === "string" ? obj.cbd_range.trim() : "0–1%",
    thcaPercent:
      typeof obj.thcaPercent === "string"
        ? obj.thcaPercent.trim()
        : typeof obj.thca_percent === "string"
          ? obj.thca_percent.trim()
          : undefined,
    terpene1: pickOne(obj.terpene1 ?? obj.terpene_1, TERPENES, "Myrcene"),
    terpene2: pickOne(obj.terpene2 ?? obj.terpene_2, TERPENES, "Caryophyllene"),
    terpene3: pickOne(obj.terpene3 ?? obj.terpene_3, TERPENES, "Limonene"),
    primaryEffects: primaryEffects.length > 0 ? primaryEffects : ["Relaxed", "Happy"],
    negativeEffects: negativeEffects.length > 0 ? negativeEffects : ["Dry mouth", "Dry eyes"],
    flavours: flavours.length > 0 ? flavours : ["Earthy", "Sweet"],
    helpWith: helpWith.length > 0 ? helpWith : ["Stress"],
  };
}

export function strainPageSystemPrompt(): string {
  const terpeneColorBlock = TERPENES.map((t) => `${t} — ${TERPENE_COLORS[t]}`).join("\n");

  return `You write Weed.com individual strain profile pages for /strains/[strain-slug]/ URLs.

OUTPUT: Return ONLY valid JSON (no markdown fences) with this shape:
{
  "customFields": {
    "strainType": "one of: ${STRAIN_TYPES.join(" | ")}",
    "thcRange": "e.g. 18–24%",
    "cbdRange": "e.g. 0–1%",
    "thcaPercent": "optional, e.g. 22% or empty string",
    "terpene1": "one of: ${TERPENES.join(" | ")}",
    "terpene2": "different terpene from list",
    "terpene3": "different terpene from list",
    "primaryEffects": ["max 3 from: ${PRIMARY_EFFECTS.join(", ")}"],
    "negativeEffects": ["max 3 from: ${NEGATIVE_EFFECTS.join(", ")}"],
    "flavours": ["max 4 from: ${FLAVOURS.join(", ")}"],
    "helpWith": ["max 2 from: ${HELP_WITH.join(", ")}"]
  },
  "html": "raw HTML article body string"
}

HTML RULES:
- Raw HTML only inside the html string. No <!DOCTYPE>, <html>, or <h1> (CMS sets title separately).
- Never use the em dash (U+2014). Use " - " or commas instead.
- Font: Inter, system-ui, sans-serif on all text blocks via inline style.
- NO Dr. Tabibi byline, NO Expert Insight blocks, NO PubMed citations, NO Sources section, NO YMYL medical claims.
- Total word count across all HTML: ${STRAIN_PAGE_WORD_MIN}–${STRAIN_PAGE_WORD_MAX} words.

TONE & CLAIMS (T2 only):
- Use hedged language: "evidence suggests", "many users report", "may help", "is often chosen for"
- NO health claims, NO "proven to", NO medical advice
- Help-with copy: phrase as what users report, not what it treats

REQUIRED HTML STRUCTURE:

1) Intro <p> only (50–80 words, ABOVE all H2s)
- First sentence states the key characteristic.
- What makes this strain distinctive. Who it is for. No health claims.
- Mention strain type, THC range, dominant terpene, and primary use context.

2) Details tab sections (exact H2 headings):
<h2>Effects</h2> (~60 words) — onset, duration, intensity. T2 language only.
<h2>Negative effects</h2> (~40 words) — honest, common at higher doses.
<h2>Help with</h2> (~60 words) — user-reported experiences only.
<h2>Flavours</h2> (~40 words) — tasting notes; inhale vs exhale if notable.
<h2>Terpenes</h2> (~80 words) — one sentence per dominant terpene minimum; tie to effects and flavour.
<h2>THC level</h2> (~40 words) — practical meaning; beginner/intermediate/experienced.
<h2>CBD level</h2> (~30 words) — contribution to overall experience.

3) <h2>Buy [Strain Name] Seeds</h2> — required seeds CTA (link to verified /seeds/ URL from list).
4) <h2>[Strain Name] Clones</h2> — required clones CTA (link to /seeds/ when no clone URL verified).

5) <h2>Frequently asked questions</h2>
Exactly 4 or 5 Q&A pairs. Each question <h3>, answer <p> (40–60 words each).
Standard questions to include:
- What are the effects of [Strain Name]?
- Is [Strain Name] indica or sativa?
- How strong is [Strain Name]?
- What terpenes does [Strain Name] have?
- Where can I buy [Strain Name] seeds?

TERPENE COLOUR SYSTEM (reference in terpene copy when relevant):
${terpeneColorBlock}

INTERNAL LINKS (required when VERIFIED INTERNAL LINKS is non-empty):
- Link /strains/ hub with anchor text "cannabis strains" in intro or Effects section.
- Link /seeds/ with anchor "buy cannabis seeds" in Buy Seeds section.
- Link one shop category (/flower-prerolls/ or /vapes-carts/) with anchor matching product type.
- Link 2 related strain pages (same type or similar effects).
- ONLY use <a href="..."> for URLs listed under VERIFIED INTERNAL LINKS.
- Do NOT invent weed.com URLs.

customFields must align with the prose (THC/CBD ranges, terpenes, effects, flavours, help-with).`;
}

export function buildStrainPageUserMessage(args: {
  strainName: string;
  lineageNotes?: string;
  verifiedLinks: string;
}): string {
  const name = formatStrainDisplayName(args.strainName);
  const lineage =
    args.lineageNotes?.trim() ? `\nLineage / breeder notes: ${args.lineageNotes.trim()}` : "";
  return `Strain name: ${name}
Display title (CMS, not in body): ${strainPagePostTitle(args.strainName)}
Suggested URL path: ${strainPageSuggestedPath(args.strainName)}
Focus keyword: ${strainPageFocusKeyword(args.strainName)}
Meta title: ${strainPageMetaTitle(args.strainName)}${lineage}

VERIFIED INTERNAL LINKS (only these may appear in <a href> — no other weed.com URLs):
${args.verifiedLinks}

Write the full strain page JSON now (customFields + html).`;
}

export function parseStrainPageModelResponse(raw: string): { customFields: StrainPageCustomFields; html: string } {
  let cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) cleaned = objMatch[0];
  cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");
  const parsed = JSON.parse(cleaned) as { customFields?: unknown; html?: unknown };
  const html = typeof parsed.html === "string" ? parsed.html.replace(/\u2014/g, " - ").trim() : "";
  if (!html) throw new Error("Model response missing html field");
  return {
    customFields: normalizeStrainPageCustomFields(parsed.customFields),
    html,
  };
}
