/**
 * Apply Rank Math meta for one weed.com URL.
 * Usage: node scripts/apply-rank-math-url.mjs "https://weed.com/strains/sherbet-cake-strain/"
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const targetUrl = process.argv[2];
if (!targetUrl) {
  console.error("Usage: node scripts/apply-rank-math-url.mjs <url>");
  process.exit(1);
}

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

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
const slug = targetUrl.split("/").filter(Boolean).pop();
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

async function fetchJson(path, hdrs = authedHeaders) {
  const res = await fetch(`${base}/wp-json/${path}`, { headers: hdrs });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, json: res.ok ? JSON.parse(text) : null };
}

async function wpPost(path, body) {
  const res = await fetch(`${base}/wp-json/${path}`, {
    method: "POST",
    headers: authedHeaders,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function buildMetaDescription(text, title) {
  const plain = text.replace(/\s+/g, " ").trim();
  if (plain.length <= 156) return plain || title;
  const cut = plain.slice(0, 153);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trim()}...`;
}

const norm = (u) => u.replace(/\/$/, "").toLowerCase();
const targetPath = norm(targetUrl);

async function findPost() {
  const queries = [
    `wp/v2/posts?slug=${encodeURIComponent(slug)}&context=view&per_page=10`,
    `wp/v2/posts?search=${encodeURIComponent(slug.replace(/-/g, " "))}&per_page=20&context=view`,
    `wp/v2/posts?search=${encodeURIComponent("sherbet cake")}&per_page=20&context=view`,
  ];
  for (const q of queries) {
    for (const hdrs of [{ Accept: "application/json", "User-Agent": ua }, authedHeaders]) {
      const { ok, json } = await fetchJson(q, hdrs);
      if (!ok || !Array.isArray(json)) continue;
      const exact = json.find((r) => r.link && norm(r.link) === targetPath);
      if (exact) return exact;
      const bySlug = json.find((r) => r.slug === slug);
      if (bySlug) return bySlug;
    }
  }
  return null;
}

const post = await findPost();
if (!post?.id) {
  console.error("Post not found for", targetUrl);
  process.exit(1);
}

const detailRes = await fetchJson(`wp/v2/posts/${post.id}?context=view`);
const detail = detailRes.json ?? post;

const title = stripHtml(detail.title?.rendered ?? post.title?.rendered ?? slug);
const plain = stripHtml(detail.content?.rendered ?? detail.excerpt?.rendered ?? "").slice(0, 3500);
const focusKeyword = title.slice(0, 191);
const metaDescription = buildMetaDescription(plain || title, title);

const meta = {
  rank_math_focus_keyword: focusKeyword,
  rank_math_description: metaDescription,
};

console.log("Post:", post.id, title);
console.log("Focus:", focusKeyword);
console.log("Description:", metaDescription);

const attempts = [
  ["weed-com-tools", `weed-com-tools/v1/rank-math/${post.id}`, meta],
  [
    "updateMetaBulk",
    "rankmath/v1/updateMetaBulk",
    { rows: [{ objectType: "post", objectID: post.id, meta }] },
  ],
  ["updateMeta", "rankmath/v1/updateMeta", { objectType: "post", objectID: post.id, meta }],
  ["wp/v2 meta", `wp/v2/posts/${post.id}`, { meta }],
];

let persistOk = false;
for (const [label, path, body] of attempts) {
  const { status, text } = await wpPost(path, body);
  console.log(`${label}:`, status, text.slice(0, 300));
  if (status >= 200 && status < 300 && (text.includes('"success":true') || text.includes('"updated"'))) {
    persistOk = true;
    break;
  }
}

console.log("persistOk:", persistOk);
console.log("edit:", `${base}/wp-admin/post.php?post=${post.id}&action=edit`);
console.log("live:", post.link || targetUrl);
