/**
 * Fetches all post categories from green.org public REST API and writes
 * lib/data/greenorgWpCategories.json (id, name, slug, parent).
 *
 * Usage: node scripts/sync-greenorg-wp-categories.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "lib", "data", "greenorgWpCategories.json");

const BASE = "https://green.org/wp-json/wp/v2/categories";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fetchPage(page) {
  const url = `${BASE}?per_page=100&page=${page}&_fields=id,name,slug,parent`;
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 400)}`);
  }
  return res.json();
}

async function main() {
  const all = [];
  let page = 1;
  for (;;) {
    const rows = await fetchPage(page);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      all.push({
        id: r.id,
        name: String(r.name ?? "").trim(),
        slug: String(r.slug ?? "").trim(),
        parent: typeof r.parent === "number" ? r.parent : 0,
      });
    }
    if (rows.length < 100) break;
    page += 1;
    if (page > 60) throw new Error("Too many pages — abort");
  }
  all.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`, "utf8");
  console.log(`Wrote ${all.length} categories to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
