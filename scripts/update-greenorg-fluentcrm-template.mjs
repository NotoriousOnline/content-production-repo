/**
 * Push the local Green.org FluentCRM HTML template (id 71572).
 * Usage: node scripts/update-greenorg-fluentcrm-template.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML_FILE = join(ROOT, "wordpress", "fluentcrm", "green-org-latest-stories.html");
const TEMPLATE_ID = 71572;
const TEMPLATE_TITLE = "Green.org — Latest Stories";
const TEMPLATE_SUBJECT = "The Latest from Green.org";
const PREHEADER =
  "The latest stories, insights and updates from Green.org — five new reads on climate, energy and cleantech.";

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

const html = readFileSync(HTML_FILE, "utf8");
const payload = {
  template: {
    post_title: TEMPLATE_TITLE,
    post_content: html,
    post_excerpt: PREHEADER,
    email_subject: TEMPLATE_SUBJECT,
    edit_type: "html",
    design_template: "raw_html",
  },
};

const res = await fetch(`${base}/wp-json/fluent-crm/v2/templates/${TEMPLATE_ID}`, {
  method: "PUT",
  headers,
  body: JSON.stringify(payload),
});
const text = await res.text();
console.log("PUT template", res.status, text.slice(0, 400));
if (!res.ok) process.exit(1);
if (/facebook|instagram|linkedin|twitter/i.test(html)) {
  console.error("Local HTML still contains social links");
  process.exit(1);
}
console.log("Social links removed from template", TEMPLATE_ID);
