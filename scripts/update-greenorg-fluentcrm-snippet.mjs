/**
 * Update the live Code Snippets PHP that powers FluentCRM {{green_posts.*}} tags.
 * Usage: node scripts/update-greenorg-fluentcrm-snippet.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PHP_FILE = join(ROOT, "wordpress", "mu-plugins", "green-org-fluentcrm-latest-posts.php");
const SNIPPET_ID = 5;

const envText = readFileSync(join(ROOT, ".env.local"), "utf8").replace(/^\uFEFF/, "");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: sites, error } = await supabase.from("wp_sites").select("url,username,app_password");
if (error) throw error;
const site = (sites ?? []).find((s) => /green\.org/i.test(s.url ?? ""));
if (!site) throw new Error("green.org site not found");

const base = String(site.url).replace(/\/$/, "");
const pass = String(site.app_password).replace(/\s+/g, "").trim();
const auth = "Basic " + Buffer.from(`${site.username}:${pass}`).toString("base64");
const headers = {
  Authorization: auth,
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: `${base}/`,
  Origin: base,
  ...(process.env.WORDPRESS_WAF_BYPASS_COOKIE
    ? { Cookie: process.env.WORDPRESS_WAF_BYPASS_COOKIE }
    : {}),
};

let php = readFileSync(PHP_FILE, "utf8").replace(/^\uFEFF/, "");
php = php.replace(/^<\?php\s*/, "");

const res = await fetch(`${base}/wp-json/code-snippets/v1/snippets/${SNIPPET_ID}`, {
  method: "PUT",
  headers,
  body: JSON.stringify({
    name: "Green.org FluentCRM Latest Posts",
    code: php,
    scope: "global",
    active: true,
    priority: 10,
  }),
});
const text = await res.text();
console.log("PUT snippet", res.status, text.slice(0, 400));
if (!res.ok) process.exit(1);

const check = await fetch(`${base}/wp-json/code-snippets/v1/snippets/${SNIPPET_ID}`, { headers });
const json = await check.json();
console.log({
  id: json.id,
  active: json.active,
  scope: json.scope,
  error: json.code_error,
  bytes: (json.code || "").length,
});
