/**
 * Add "Buy [Strain A] and [Strain B] Seeds" H2 with /seeds/ link in body text on all /learn/*-vs-* posts.
 *
 * Usage:
 *   node scripts/backfill-strain-comparison-seeds.mjs           # dry run
 *   node scripts/backfill-strain-comparison-seeds.mjs --apply   # update posts
 */
import { readFileSync } from "fs";

const apply = process.argv.includes("--apply");

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { createClient } = await import("@supabase/supabase-js");

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await supabase
  .from("wp_sites")
  .select("url, username, app_password")
  .eq("id", "4207d196-cd86-478e-a8da-160e57e1c861")
  .single();

if (error || !data) {
  console.error("Site load failed", error);
  process.exit(1);
}

const pass = String(data.app_password).replace(/\s+/g, "").trim();
const auth = `Basic ${Buffer.from(`${data.username}:${pass}`).toString("base64")}`;
const base = data.url.replace(/\/$/, "");
const seedsUrl = `${base}/seeds/`;
const ua =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const authedHeaders = {
  Authorization: auth,
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent": ua,
  Referer: `${base}/`,
  Origin: base,
};

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseStrainsFromTitle(title) {
  const m = title.trim().match(/^(.+?)\s+vs\s+(.+?)(?:\s+[—-]\s+|\s*$)/i);
  if (!m) return null;
  const stripStrain = (s) => s.trim().replace(/\s+strain\s*$/i, "").trim();
  const strainA = stripStrain(m[1]);
  const strainB = stripStrain(m[2]);
  if (!strainA || !strainB) return null;
  return { strainA, strainB };
}

function formatStrainLabel(name) {
  const base = name.trim().replace(/\s+strain\s*$/i, "").trim();
  return base ? `${base} strain` : "";
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSeedsSection(html, strainA, strainB) {
  const a = escapeRegex(formatStrainLabel(strainA));
  const b = escapeRegex(formatStrainLabel(strainB));
  return new RegExp(`<h2[^>]*>[\\s\\S]*?Buy[^<]*${a}[^<]*and[^<]*${b}[^<]*Seeds`, "i").test(html);
}

function buildSeedsSection(strainA, strainB) {
  const font = "font-family: Inter,system-ui,sans-serif;";
  const a = formatStrainLabel(strainA);
  const b = formatStrainLabel(strainB);
  return `<h2 style="${font}">Buy ${a} and ${b} Seeds</h2>
<p style="${font}">Home growers comparing ${a} and ${b} can browse verified seed genetics at Weed.com. <a href="${seedsUrl}">Shop cannabis seeds</a> to find cultivars suited to your grow setup and experience level.</p>`;
}

function stripRoySignoff(html) {
  return html
    .replace(/<p[^>]*>[\s\S]*?Roy \(Layer 3 editorial sign-off\)[\s\S]*?<\/p>\s*/gi, "")
    .trimEnd();
}

function ensureSeedsSection(html, strainA, strainB) {
  if (hasSeedsSection(html, strainA, strainB)) return html;
  const section = buildSeedsSection(strainA, strainB);
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

async function fetchJson(path) {
  const res = await fetch(`${base}/wp-json/${path}`, { headers: authedHeaders });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function listLearnComparisonPosts() {
  const out = [];
  for (let page = 1; page <= 30; page++) {
    const rows = await fetchJson(
      `wp/v2/posts?per_page=100&page=${page}&context=edit&status=any&orderby=date&order=desc`
    );
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      const slug = String(row.slug ?? "");
      const link = String(row.link ?? "");
      if (!slug.includes("-vs-")) continue;
      if (!link.includes("/learn/")) continue;
      out.push(row);
    }
    if (rows.length < 100) break;
  }
  return out;
}

async function updatePostContent(postId, content) {
  const res = await fetch(`${base}/wp-json/wp/v2/posts/${postId}?context=edit`, {
    method: "POST",
    headers: authedHeaders,
    body: JSON.stringify({ content }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text: text.slice(0, 300) };
}

const posts = await listLearnComparisonPosts();
console.log(`Found ${posts.length} learn strain comparison post(s). Mode: ${apply ? "APPLY" : "DRY RUN"}`);

let updated = 0;
let skipped = 0;
let failed = 0;

for (const post of posts) {
  const title = stripHtml(post.title?.rendered ?? post.slug ?? "");
  const strains = parseStrainsFromTitle(title);
  if (!strains) {
    console.warn("SKIP (title parse):", post.id, title);
    skipped++;
    continue;
  }

  const detail = await fetchJson(`wp/v2/posts/${post.id}?context=edit`);
  const html = detail.content?.raw ?? detail.content?.rendered ?? "";
  if (!html.trim()) {
    console.warn("SKIP (empty content):", post.id, title);
    skipped++;
    continue;
  }

  let next = stripRoySignoff(html);
  const needsSeeds = !hasSeedsSection(next, strains.strainA, strains.strainB);
  if (needsSeeds) {
    next = ensureSeedsSection(next, strains.strainA, strains.strainB);
  }

  if (next === html) {
    console.log("OK (no changes):", post.id, title);
    skipped++;
    continue;
  }

  console.log("UPDATE:", post.id, title, post.link, needsSeeds ? "+seeds" : "strip-roy");

  if (apply) {
    const result = await updatePostContent(post.id, next);
    if (result.ok) {
      updated++;
    } else {
      console.error("FAILED:", post.id, result.status, result.text);
      failed++;
    }
  } else {
    updated++;
  }
}

console.log(`Done. ${apply ? "Updated" : "Would update"}: ${updated}, skipped: ${skipped}, failed: ${failed}`);
if (!apply && updated > 0) {
  console.log("Re-run with --apply to write changes.");
}
