import { callClaude } from "@/lib/anthropic";
import type { WPCategoryRow, WPSite } from "@/lib/wordpressClient";
import { errorMessage } from "@/lib/serverLog";

import greenorgCategoriesSnapshot from "@/lib/data/greenorgWpCategories.json";

/** True when this site is green.org (content-production Green.org publishing). */
export function isGreenOrgSite(site: WPSite): boolean {
  const raw = (site.url ?? "").trim();
  if (!raw) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    return host === "green.org" || host.endsWith(".green.org");
  } catch {
    return /green\.org/i.test(raw);
  }
}

/** True when this site is the prefab site (content-production publishing). */
export function isPrefabSite(site: WPSite): boolean {
  const raw = (site.url ?? "").trim();
  if (!raw) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    return host === "prefab.com" || host.endsWith(".prefab.com");
  } catch {
    return /prefab/i.test(raw);
  }
}

/**
 * Canonical prefab category names provided by editorial.
 * Matching is case-insensitive and ignores extra spaces.
 */
export const PREFAB_CATEGORY_NAMES: readonly string[] = [
  "ADUs (Super-Cluster)",
  "ADU Financing & Economics",
  "California-Specific ADUs",
  "General ADU Knowledge",
  "Brands & Builders",
  "Brand Comparisons",
  "Company Profiles",
  "Case Studies & Inspiration",
  "Construction & Regulations",
  "Design & Lifestyle",
  "Financing & Costs",
  "Prefab & ADU Reviews",
  "Prefab Basics",
  "Prefab Construction Reality",
  "Prefab in California",
  "Prefab Living & Ownership",
  "Resources",
];

function normalizeCategoryName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Filters WordPress categories to a canonical name list.
 * Falls back to the original list when no preferred names are found on the site.
 */
export function restrictCategoriesToNames(
  categories: WPCategoryRow[],
  preferredNames: readonly string[]
): WPCategoryRow[] {
  if (categories.length === 0 || preferredNames.length === 0) return categories;
  const allowed = new Set(preferredNames.map(normalizeCategoryName));
  const picked = categories.filter((c) => allowed.has(normalizeCategoryName(c.name)));
  return picked.length > 0 ? picked : categories;
}

function snapshotCategories(): WPCategoryRow[] {
  const raw = greenorgCategoriesSnapshot as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (x): x is WPCategoryRow =>
        x != null &&
        typeof x === "object" &&
        typeof (x as { id?: unknown }).id === "number" &&
        typeof (x as { name?: unknown }).name === "string"
    )
    .map((x) => ({
      id: x.id,
      name: String(x.name).trim(),
      slug: typeof x.slug === "string" ? x.slug.trim() : "",
      parent: typeof x.parent === "number" ? x.parent : 0,
    }));
}

/**
 * Prefer live WordPress list; fall back to committed JSON if REST fails (e.g. WAF).
 */
export async function categoriesForGreenOrgPublish(
  fetchLive: () => Promise<WPCategoryRow[]>
): Promise<WPCategoryRow[]> {
  try {
    const live = await fetchLive();
    if (live.length > 0) return live;
  } catch (e) {
    console.warn("[greenOrgCategoryPicker] Live category list failed:", errorMessage(e));
  }
  const snap = snapshotCategories();
  if (snap.length > 0) {
    console.warn("[greenOrgCategoryPicker] Using lib/data/greenorgWpCategories.json snapshot.");
  }
  return snap;
}

function htmlToPlainSnippet(html: string, maxLen: number): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`;
}

function keywordsLine(keywords: unknown): string {
  if (Array.isArray(keywords)) {
    return keywords.map((x) => String(x).trim()).filter(Boolean).join(", ");
  }
  if (typeof keywords === "string") return keywords.trim();
  return "";
}

function stripJsonFence(s: string): string {
  let t = s.trim();
  if (t.startsWith("```")) {
    const nl = t.indexOf("\n");
    t = nl === -1 ? t.replace(/^```\w*\s*/, "") : t.slice(nl + 1);
  }
  t = t.trimEnd();
  if (t.endsWith("```")) t = t.slice(0, t.lastIndexOf("```")).trimEnd();
  return t.trim();
}

/**
 * Picks 1–2 WordPress category IDs from the allowed list using Claude.
 */
export async function pickGreenOrgCategoryIds(args: {
  title: string;
  keywords: unknown;
  articleHtml: string;
  categories: WPCategoryRow[];
}): Promise<number[]> {
  const { title, keywords, articleHtml, categories } = args;
  const allowed = new Set(categories.map((c) => c.id));
  if (allowed.size === 0) return [];

  const lines = categories
    .map((c) => `- id=${c.id} name="${c.name.replace(/"/g, '\\"')}" slug=${c.slug} parent=${c.parent}`)
    .join("\n");

  const user = `You assign Green.org WordPress categories for a new article draft.

Post title: ${title.trim()}

Keywords / phrases: ${keywordsLine(keywords) || "(none)"}

Article text (plain, excerpt): ${htmlToPlainSnippet(articleHtml, 3500)}

Allowed categories (you MUST only use numeric ids from this list):
${lines}

Rules:
- Pick 1 or 2 category ids that best match the primary topic. Prefer a single strong match when possible.
- If one parent and one child both fit, you may return both (max 2 ids).
- Do not invent ids. Every id must appear in the list above.

Return ONLY valid JSON, no markdown:
{"categoryIds":[123456]}`;

  try {
    const raw = await callClaude(
      "You output only JSON with a categoryIds array of integers. No commentary.",
      user,
      { maxTokens: 256 }
    );
    const cleaned = stripJsonFence(raw);
    const parsed = JSON.parse(cleaned) as { categoryIds?: unknown };
    const ids = parsed.categoryIds;
    if (!Array.isArray(ids)) return [];
    const out: number[] = [];
    for (const x of ids) {
      const n = typeof x === "number" ? x : parseInt(String(x), 10);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (!allowed.has(n)) continue;
      out.push(n);
      if (out.length >= 2) break;
    }
    return out;
  } catch (e) {
    console.warn("[greenOrgCategoryPicker] Claude category pick failed:", errorMessage(e));
    return [];
  }
}
