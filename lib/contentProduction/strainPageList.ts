import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/serverLog";
import { getSiteById, WP_TOOL_SCOPE } from "@/lib/wpSites";
import {
  wpRestHeaders,
  wpRestUrl,
  type WPSite,
} from "@/lib/wordpressClient";

export type StrainListItem = {
  id: number;
  title: string;
  slug: string;
  link: string;
  status: string;
  restCollection: string;
};

type WPRestRow = {
  id: number;
  title?: { rendered?: string };
  slug?: string;
  link?: string;
  status?: string;
};

function rowToItem(row: WPRestRow, restCollection: string): StrainListItem | null {
  if (!row.id) return null;
  const link = String(row.link ?? "").trim();
  return {
    id: row.id,
    title: (row.title?.rendered ?? "").replace(/<[^>]+>/g, "").trim(),
    slug: String(row.slug ?? ""),
    link,
    status: String(row.status ?? "publish"),
    restCollection,
  };
}

function isStrainPageUrl(link: string): boolean {
  return /\/strains\/[^/]+\/?$/i.test(link);
}

async function fetchCollectionRows(
  site: WPSite,
  collection: string,
  page: number,
  perPage: number
): Promise<WPRestRow[]> {
  const base = site.url.replace(/\/$/, "");
  const path = `wp/v2/${collection}?per_page=${perPage}&page=${page}&context=edit&status=any`;
  const res = await fetch(wpRestUrl(base, path), { headers: wpRestHeaders(site) });
  if (!res.ok) return [];
  const rows = (await res.json()) as WPRestRow[];
  return Array.isArray(rows) ? rows : [];
}

async function listFromCollection(
  site: WPSite,
  collection: string,
  filterStrainUrls: boolean
): Promise<StrainListItem[]> {
  const items: StrainListItem[] = [];
  const perPage = 100;
  for (let page = 1; page <= 5; page++) {
    const rows = await fetchCollectionRows(site, collection, page, perPage);
    if (rows.length === 0) break;
    for (const row of rows) {
      const item = rowToItem(row, collection);
      if (!item) continue;
      if (filterStrainUrls && !isStrainPageUrl(item.link)) continue;
      items.push(item);
    }
    if (rows.length < perPage) break;
  }
  return items;
}

/** List existing strain pages from WordPress (CPT or posts/pages under /strains/). */
export async function getStrainPageList(request: Request) {
  try {
    const url = new URL(request.url);
    const siteId = url.searchParams.get("siteId")?.trim();
    if (!siteId) {
      return NextResponse.json({ error: "Missing siteId query parameter" }, { status: 400 });
    }

    const site = await getSiteById(siteId, WP_TOOL_SCOPE.weedComContentProduction);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    let items: StrainListItem[] = [];
    let collection = "posts";

    // Prefer dedicated strain CPT when it exists and has entries.
    for (const col of ["strains", "strain"] as const) {
      const batch = await listFromCollection(site, col, false);
      if (batch.length > 0) {
        items = batch;
        collection = col;
        break;
      }
    }

    // Fall back: regular posts/pages whose permalink is /strains/[slug]/.
    if (items.length === 0) {
      for (const col of ["posts", "pages"] as const) {
        const batch = await listFromCollection(site, col, true);
        if (batch.length > 0) {
          items = batch;
          collection = col;
          break;
        }
      }
    }

    items.sort((a, b) => a.title.localeCompare(b.title));

    return NextResponse.json({
      strains: items,
      count: items.length,
      restCollection: collection,
      note:
        items.length > 0 && items[0].restCollection !== "strains" && items[0].restCollection !== "strain"
          ? `Strain pages are stored as WordPress ${items[0].restCollection} (not a strains CPT).`
          : undefined,
    });
  } catch (err) {
    const msg = errorMessage(err);
    return NextResponse.json({ error: msg || "Failed to list strains" }, { status: 500 });
  }
}
