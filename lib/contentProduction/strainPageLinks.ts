import { slugifyStrainName, stripStrainWordSuffix } from "@/lib/contentProduction/strainComparison";
import {
  defaultStrainPageUrl,
  formatStrainDisplayName,
  type StrainPageCustomFields,
} from "@/lib/contentProduction/strainPage";
import { filterVerifiedUrls, verifyPublicUrl } from "@/lib/contentProduction/verifyPublicUrl";
import { errorMessage } from "@/lib/serverLog";
import { resolvePostByPublicUrl, type WPSite } from "@/lib/wordpressClient";

export type VerifiedStrainPageLink = {
  label: string;
  url: string;
  kind: "strain" | "hub" | "shop" | "related";
};

export function normalizeLinkUrl(url: string, siteOrigin: string): string {
  try {
    const raw = url.trim();
    const withProtocol = /^https?:\/\//i.test(raw)
      ? raw
      : `${siteOrigin.replace(/\/$/, "")}${raw.startsWith("/") ? raw : `/${raw}`}`;
    const u = new URL(withProtocol);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.origin}${path}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

async function resolveVerifiedStrainUrl(
  site: WPSite,
  strainName: string,
  userUrl?: string
): Promise<string | null> {
  const siteOrigin = (site.url ?? "").replace(/\/$/, "");
  const slug = slugifyStrainName(strainName);
  const candidates = [
    userUrl?.trim(),
    defaultStrainPageUrl(siteOrigin, strainName),
    `${siteOrigin}/strains/${slug}-strain/`,
    `${siteOrigin}/strains/${slug}/`,
  ].filter((u): u is string => !!u);

  const seen = new Set<string>();
  for (const url of candidates) {
    const key = normalizeLinkUrl(url, siteOrigin);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const resolved = await resolvePostByPublicUrl(site, url);
      if (resolved?.link?.trim()) return resolved.link.trim();
    } catch {
      /* REST blocked */
    }
    if (await verifyPublicUrl(url)) return url;
  }
  return null;
}

const HUB_CANDIDATES: Array<{ label: string; path: string; anchor: string; kind: VerifiedStrainPageLink["kind"] }> =
  [
    { label: "Strains hub", path: "/strains/", anchor: "cannabis strains", kind: "hub" },
    { label: "Cannabis seeds", path: "/seeds/", anchor: "buy cannabis seeds", kind: "shop" },
    { label: "Flower & prerolls", path: "/flower-prerolls/", anchor: "flower and prerolls", kind: "shop" },
    { label: "Vapes & carts", path: "/vapes-carts/", anchor: "vapes and carts", kind: "shop" },
  ];

/** Search WP for related strain pages by slug prefix / strain type keywords. */
async function findRelatedStrainUrls(
  site: WPSite,
  strainName: string,
  fields: StrainPageCustomFields,
  excludeUrl: string | null,
  limit = 2
): Promise<VerifiedStrainPageLink[]> {
  const siteOrigin = (site.url ?? "").replace(/\/$/, "");
  const excludeNorm = excludeUrl ? normalizeLinkUrl(excludeUrl, siteOrigin) : "";
  const base = siteOrigin;
  const searchTerms = [
    fields.strainType.split("-")[0].trim(),
    fields.primaryEffects[0],
    fields.terpene1,
  ].filter(Boolean);

  const candidatePaths = new Set<string>();
  for (const collection of ["strains", "strain"] as const) {
    for (const term of searchTerms) {
      try {
        const res = await fetch(
          `${base}/wp-json/wp/v2/${collection}?search=${encodeURIComponent(term)}&per_page=10&context=view`,
          { headers: { Accept: "application/json" } }
        );
        if (!res.ok) continue;
        const rows = (await res.json()) as Array<{ link?: string; slug?: string }>;
        for (const row of rows) {
          if (!row.link?.includes("/strains/")) continue;
          const norm = normalizeLinkUrl(row.link, siteOrigin);
          if (norm === excludeNorm) continue;
          if (row.slug && slugifyStrainName(strainName) === row.slug.replace(/-strain$/, "")) continue;
          candidatePaths.add(row.link);
        }
      } catch {
        /* skip */
      }
    }
  }

  const verified = await filterVerifiedUrls(Array.from(candidatePaths), 8);
  return verified.slice(0, limit).map((url) => ({
    label: url.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ?? "Related strain",
    url,
    kind: "related" as const,
  }));
}

export async function gatherVerifiedStrainPageLinks(args: {
  site: WPSite;
  strainName: string;
  strainUrl?: string;
  customFields?: StrainPageCustomFields;
}): Promise<{
  links: VerifiedStrainPageLink[];
  strainUrl: string | null;
  allowlist: string[];
}> {
  const siteOrigin = (args.site.url ?? "").replace(/\/$/, "");
  const links: VerifiedStrainPageLink[] = [];

  const strainUrl = await resolveVerifiedStrainUrl(args.site, args.strainName, args.strainUrl);
  if (strainUrl) {
    links.push({
      label: `${formatStrainDisplayName(args.strainName)} strain page`,
      url: strainUrl,
      kind: "strain",
    });
  }

  for (const hub of HUB_CANDIDATES) {
    const url = `${siteOrigin}${hub.path}`;
    if (await verifyPublicUrl(url)) {
      links.push({ label: hub.label, url, kind: hub.kind });
    }
  }

  if (args.customFields) {
    try {
      const related = await findRelatedStrainUrls(
        args.site,
        args.strainName,
        args.customFields,
        strainUrl,
        2
      );
      for (const r of related) {
        if (!links.some((l) => normalizeLinkUrl(l.url, siteOrigin) === normalizeLinkUrl(r.url, siteOrigin))) {
          links.push(r);
        }
      }
    } catch (e) {
      console.warn("[strain-page] related strains skipped:", errorMessage(e));
    }
  }

  const allowlist = links.map((l) => l.url);
  return { links, strainUrl, allowlist };
}

export function formatVerifiedStrainPageLinksForPrompt(links: VerifiedStrainPageLink[]): string {
  if (links.length === 0) {
    return "(none verified — do NOT add any internal <a> links; use plain text only)";
  }
  return links.map((l) => `- [${l.kind}] ${l.label}: ${l.url}`).join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LINK_FONT = "font-family: Inter,system-ui,sans-serif;";

function sectionAfterH2(html: string, h2Pattern: RegExp): string | null {
  const m = html.match(h2Pattern);
  if (m?.index == null) return null;
  const start = m.index + m[0].length;
  const rest = html.slice(start);
  const nextH2 = rest.search(/<h2\b/i);
  return nextH2 >= 0 ? rest.slice(0, nextH2) : rest;
}

function sectionHasLinkTo(section: string, url: string, siteOrigin: string): boolean {
  const target = normalizeLinkUrl(url, siteOrigin);
  const hrefRe = /\bhref\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(section)) !== null) {
    if (normalizeLinkUrl(m[1], siteOrigin) === target) return true;
  }
  return false;
}

function appendToFirstParagraph(sectionHtml: string, suffix: string): string {
  const pMatch = sectionHtml.match(/<p[^>]*>[\s\S]*?<\/p>/i);
  if (!pMatch) return `${sectionHtml}\n<p style="${LINK_FONT}">${suffix}</p>`;
  const updated = pMatch[0].replace(/<\/p>\s*$/i, ` ${suffix}</p>`);
  return sectionHtml.replace(pMatch[0], updated);
}

function replaceSectionAfterH2(html: string, h2Pattern: RegExp, newSection: string): string {
  const m = html.match(h2Pattern);
  if (m?.index == null) return html;
  const start = m.index + m[0].length;
  const rest = html.slice(start);
  const nextH2 = rest.search(/<h2\b/i);
  const end = nextH2 >= 0 ? start + nextH2 : html.length;
  return html.slice(0, start) + newSection + html.slice(end);
}

function replaceIntro(html: string, newIntro: string): string {
  const m = html.match(/^([\s\S]*?)(?=<h2\b)/i);
  if (!m) return html;
  return newIntro + html.slice(m[1].length);
}

export function countAllowlistedStrainPageLinks(
  html: string,
  allowlist: string[],
  siteOrigin: string
): number {
  if (allowlist.length === 0) return 0;
  const allowed = new Set(allowlist.map((u) => normalizeLinkUrl(u, siteOrigin)));
  const hrefRe = /\bhref\s*=\s*["']([^"']+)["']/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const norm = normalizeLinkUrl(m[1], siteOrigin);
    if (allowed.has(norm)) seen.add(norm);
  }
  return seen.size;
}

export function ensureStrainPageInternalLinks(
  html: string,
  strainName: string,
  links: VerifiedStrainPageLink[],
  siteOrigin: string
): string {
  if (links.length === 0) return html;
  let result = html;

  const strainsHub = links.find((l) => l.kind === "hub" && /\/strains\/?$/i.test(l.url));
  const seedsHub = links.find((l) => l.kind === "shop" && /\/seeds\/?$/i.test(l.url));
  const flowerShop = links.find((l) => l.kind === "shop" && /\/flower-prerolls\/?$/i.test(l.url));
  const vapesShop = links.find((l) => l.kind === "shop" && /\/vapes-carts\/?$/i.test(l.url));
  const productShop = flowerShop ?? vapesShop;
  const related = links.filter((l) => l.kind === "related");

  const introMatch = result.match(/^([\s\S]*?)(?=<h2\b)/i);
  if (introMatch && strainsHub && !sectionHasLinkTo(introMatch[1], strainsHub.url, siteOrigin)) {
    const suffix = `Browse more profiles on our <a href="${strainsHub.url}">cannabis strains</a> hub.`;
    result = replaceIntro(result, appendToFirstParagraph(introMatch[1], suffix));
  }

  const effectsH2 = /<h2[^>]*>\s*Effects\s*<\/h2>/i;
  const effectsSection = sectionAfterH2(result, effectsH2);
  if (effectsSection && productShop && !sectionHasLinkTo(effectsSection, productShop.url, siteOrigin)) {
    const anchor = /flower/i.test(productShop.url) ? "flower and prerolls" : "vapes and carts";
    const suffix = `Shop <a href="${productShop.url}">${anchor}</a> at Weed.com.`;
    result = replaceSectionAfterH2(result, effectsH2, appendToFirstParagraph(effectsSection, suffix));
  }

  const name = formatStrainDisplayName(strainName);
  const seedsH2 = new RegExp(`<h2[^>]*>\\s*Buy\\s+${escapeRegex(name)}\\s+Seeds\\s*</h2>`, "i");
  const seedsSection = sectionAfterH2(result, seedsH2);
  if (seedsSection && seedsHub && !sectionHasLinkTo(seedsSection, seedsHub.url, siteOrigin)) {
    const suffix = `<a href="${seedsHub.url}">Buy cannabis seeds</a> at Weed.com.`;
    result = replaceSectionAfterH2(result, seedsH2, appendToFirstParagraph(seedsSection, suffix));
  }

  if (related.length > 0) {
    const terpeneH2 = /<h2[^>]*>\s*Terpenes\s*<\/h2>/i;
    const terpeneSection = sectionAfterH2(result, terpeneH2);
    if (terpeneSection) {
      const missing = related.filter((l) => !sectionHasLinkTo(terpeneSection, l.url, siteOrigin));
      if (missing.length > 0) {
        const linkPhrase = missing
          .map((l) => `<a href="${l.url}">${stripStrainWordSuffix(l.label)}</a>`)
          .join(" and ");
        const suffix = `Fans of this profile often explore ${linkPhrase}.`;
        result = replaceSectionAfterH2(result, terpeneH2, appendToFirstParagraph(terpeneSection, suffix));
      }
    }
  }

  return result;
}

export function sanitizeStrainPageLinks(
  html: string,
  allowlist: string[],
  siteOrigin: string
): string {
  if (allowlist.length === 0) {
    return html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1");
  }
  const allowed = new Set(allowlist.map((u) => normalizeLinkUrl(u, siteOrigin)));
  return html.replace(/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi, (full, attrs: string, inner: string) => {
    const hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) return inner;
    const norm = normalizeLinkUrl(hrefMatch[1], siteOrigin);
    if (allowed.has(norm)) return full;
    return inner;
  });
}
