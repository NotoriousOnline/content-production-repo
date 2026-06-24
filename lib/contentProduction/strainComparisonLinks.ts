import {
  defaultStrainPageUrl,
  formatStrainLabel,
  slugifyStrainName,
  stripStrainWordSuffix,
} from "@/lib/contentProduction/strainComparison";
import { filterVerifiedUrls, verifyPublicUrl } from "@/lib/contentProduction/verifyPublicUrl";
import {
  getCandidatesFromLibrary,
  type LinkCandidate,
} from "@/lib/siteLinkLibrary";
import { errorMessage } from "@/lib/serverLog";
import { resolvePostByPublicUrl, type WPSite } from "@/lib/wordpressClient";

export type VerifiedInternalLink = {
  label: string;
  url: string;
  kind: "strain" | "hub" | "shop" | "editorial" | "product" | "effect";
};

export function normalizeLinkUrl(url: string, siteOrigin: string): string {
  try {
    const raw = url.trim();
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `${siteOrigin.replace(/\/$/, "")}${raw.startsWith("/") ? raw : `/${raw}`}`;
    const u = new URL(withProtocol);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.origin}${path}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Resolve strain page via WordPress REST, then optional HTTP verify fallback. */
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
      /* REST blocked — try HTTP only */
    }

    if (await verifyPublicUrl(url)) return url;
  }
  return null;
}

const HUB_CANDIDATES: Array<{ label: string; path: string; kind: VerifiedInternalLink["kind"] }> = [
  { label: "Strains hub", path: "/strains/", kind: "hub" },
  { label: "Cannabis seeds", path: "/seeds/", kind: "shop" },
  { label: "Flower & prerolls", path: "/flower-prerolls/", kind: "shop" },
  { label: "Vapes & carts", path: "/vapes-carts/", kind: "shop" },
];

export async function gatherVerifiedStrainComparisonLinks(args: {
  site: WPSite;
  siteId: string;
  strainA: string;
  strainB: string;
  strainAUrl?: string;
  strainBUrl?: string;
  keywords: string[];
  title: string;
}): Promise<{
  links: VerifiedInternalLink[];
  strainAUrl: string | null;
  strainBUrl: string | null;
  allowlist: string[];
}> {
  const siteOrigin = (args.site.url ?? "").replace(/\/$/, "");
  const links: VerifiedInternalLink[] = [];

  const [strainAUrl, strainBUrl] = await Promise.all([
    resolveVerifiedStrainUrl(args.site, args.strainA, args.strainAUrl),
    resolveVerifiedStrainUrl(args.site, args.strainB, args.strainBUrl),
  ]);

  if (strainAUrl) {
    links.push({
      label: `${stripStrainWordSuffix(args.strainA)} strain page`,
      url: strainAUrl,
      kind: "strain",
    });
  }
  if (strainBUrl) {
    links.push({
      label: `${stripStrainWordSuffix(args.strainB)} strain page`,
      url: strainBUrl,
      kind: "strain",
    });
  }

  for (const hub of HUB_CANDIDATES) {
    const url = `${siteOrigin}${hub.path}`;
    if (await verifyPublicUrl(url)) {
      links.push({ label: hub.label, url, kind: hub.kind });
    }
  }

  let libraryCandidates: LinkCandidate[] = [];
  try {
    libraryCandidates = await getCandidatesFromLibrary(args.siteId, args.keywords, args.title, 24, {
      siteUrlForOriginFilter: args.site.url,
      minPostPageSlots: 3,
      maxPostPageSlots: 6,
      productLinkSlots: 4,
    });
  } catch (e) {
    console.warn("[strain-comparison] library links skipped:", errorMessage(e));
  }

  const editorial = libraryCandidates.filter((l) => l.linkKind !== "product").slice(0, 8);
  const products = libraryCandidates.filter((l) => l.linkKind === "product").slice(0, 4);

  const toVerify = [...editorial, ...products].map((l) => l.url);
  const verifiedUrls = await filterVerifiedUrls(toVerify, 6);
  const verifiedSet = new Set(verifiedUrls.map((u) => normalizeLinkUrl(u, siteOrigin)));

  for (const l of editorial) {
    if (!verifiedSet.has(normalizeLinkUrl(l.url, siteOrigin))) continue;
    const kind: VerifiedInternalLink["kind"] = /\/effects\//i.test(l.url) ? "effect" : "editorial";
    links.push({ label: l.title, url: l.url, kind });
  }
  for (const l of products) {
    if (!verifiedSet.has(normalizeLinkUrl(l.url, siteOrigin))) continue;
    links.push({ label: l.title, url: l.url, kind: "product" });
  }

  const allowlist = links.map((l) => l.url);
  return { links, strainAUrl, strainBUrl, allowlist };
}

export function formatVerifiedLinksForPrompt(links: VerifiedInternalLink[]): string {
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
  if (!pMatch) {
    return `${sectionHtml}\n<p style="${LINK_FONT}">${suffix}</p>`;
  }
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

export function countAllowlistedLinks(html: string, allowlist: string[], siteOrigin: string): number {
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

/** Inject verified internal links into key sections when the model omitted them. Idempotent. */
export function ensureStrainComparisonInternalLinks(
  html: string,
  strainA: string,
  strainB: string,
  links: VerifiedInternalLink[],
  siteOrigin: string
): string {
  if (links.length === 0) return html;

  const a = formatStrainLabel(strainA);
  const b = formatStrainLabel(strainB);
  const baseA = stripStrainWordSuffix(strainA);
  const baseB = stripStrainWordSuffix(strainB);
  let result = html;

  const strainALink = links.find((l) => l.kind === "strain" && l.label === `${baseA} strain page`);
  const strainBLink = links.find((l) => l.kind === "strain" && l.label === `${baseB} strain page`);
  const strainsHub = links.find((l) => l.kind === "hub" && /\/strains\/?$/i.test(l.url));
  const seedsHub = links.find((l) => l.kind === "shop" && /\/seeds\/?$/i.test(l.url));
  const editorial = links.filter((l) => l.kind === "editorial" || l.kind === "effect").slice(0, 3);
  const shopLinks = links.filter(
    (l) => l.kind === "product" || (l.kind === "shop" && !/\/seeds\/?$/i.test(l.url))
  );

  if (strainALink) {
    const h2 = new RegExp(`<h2[^>]*>\\s*What Is ${escapeRegex(a)}\\s*\\?\\s*</h2>`, "i");
    const section = sectionAfterH2(result, h2);
    if (section && !sectionHasLinkTo(section, strainALink.url, siteOrigin)) {
      const suffix = `For a deeper profile, see our <a href="${strainALink.url}">${a} guide</a>.`;
      result = replaceSectionAfterH2(result, h2, appendToFirstParagraph(section, suffix));
    }
  }

  if (strainBLink) {
    const h2 = new RegExp(`<h2[^>]*>\\s*What Is ${escapeRegex(b)}\\s*\\?\\s*</h2>`, "i");
    const section = sectionAfterH2(result, h2);
    if (section && !sectionHasLinkTo(section, strainBLink.url, siteOrigin)) {
      const suffix = `Explore effects and lineage on the <a href="${strainBLink.url}">${b} page</a>.`;
      result = replaceSectionAfterH2(result, h2, appendToFirstParagraph(section, suffix));
    }
  }

  const introMatch = result.match(/^([\s\S]*?)(?=<h2\b)/i);
  if (introMatch && strainsHub && !sectionHasLinkTo(introMatch[1], strainsHub.url, siteOrigin)) {
    const suffix = `Compare more cultivars on our <a href="${strainsHub.url}">strains hub</a>.`;
    result = replaceIntro(result, appendToFirstParagraph(introMatch[1], suffix));
  }

  const effectsH2 = /<h2[^>]*>\s*Effects Comparison\s*<\/h2>/i;
  const effectsSection = sectionAfterH2(result, effectsH2);
  if (effectsSection && editorial.length > 0) {
    const missingEditorial = editorial.filter((l) => !sectionHasLinkTo(effectsSection, l.url, siteOrigin));
    if (missingEditorial.length > 0) {
      const link = missingEditorial[0];
      const suffix = `Related reading: <a href="${link.url}">${link.label}</a>.`;
      result = replaceSectionAfterH2(result, effectsH2, appendToFirstParagraph(effectsSection, suffix));
    }
  }

  const useCaseH2 = /<h2[^>]*>\s*Which Strain Is Better for/i;
  const useCaseSection = sectionAfterH2(result, useCaseH2);
  if (useCaseSection && editorial.length > 1) {
    const linkedInEffects = editorial[0];
    const second = editorial.find((l) => l.url !== linkedInEffects.url);
    if (second && !sectionHasLinkTo(useCaseSection, second.url, siteOrigin)) {
      const suffix = `See also: <a href="${second.url}">${second.label}</a>.`;
      result = replaceSectionAfterH2(result, useCaseH2, appendToFirstParagraph(useCaseSection, suffix));
    }
  }

  const buyH2 = new RegExp(
    `<h2[^>]*>\\s*Where to Buy ${escapeRegex(a)} and ${escapeRegex(b)}`,
    "i"
  );
  const buySection = sectionAfterH2(result, buyH2);
  if (buySection && shopLinks.length > 0) {
    const missingShop = shopLinks.filter((l) => !sectionHasLinkTo(buySection, l.url, siteOrigin));
    if (missingShop.length > 0) {
      const shopSentence = missingShop
        .slice(0, 2)
        .map((l) => `<a href="${l.url}">${l.label}</a>`)
        .join(" and ");
      const suffix = `Shop ${a} and ${b} at Weed.com: ${shopSentence}.`;
      result = replaceSectionAfterH2(result, buyH2, appendToFirstParagraph(buySection, suffix));
    }
  } else if (buySection && seedsHub && !sectionHasLinkTo(buySection, seedsHub.url, siteOrigin)) {
    const suffix = `Home growers can also browse <a href="${seedsHub.url}">cannabis seeds</a> at Weed.com.`;
    result = replaceSectionAfterH2(result, buyH2, appendToFirstParagraph(buySection, suffix));
  }

  return result;
}

/** Remove <a> tags whose href is not on the verified allowlist (unwrap to plain text). */
export function sanitizeStrainComparisonLinks(
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
