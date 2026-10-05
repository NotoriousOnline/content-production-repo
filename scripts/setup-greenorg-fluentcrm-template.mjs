/**
 * Push the Green.org FluentCRM latest-stories HTML template and smart-code PHP
 * to https://green.org using stored wp_sites credentials.
 *
 * Usage: node scripts/setup-greenorg-fluentcrm-template.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TEMPLATE_TXT = "C:\\Users\\daniy\\OneDrive\\Desktop\\email template.txt";
const TEMPLATE_TITLE = "Green.org — Latest Stories";
const TEMPLATE_SUBJECT = "The Latest from Green.org";
const PREHEADER =
  "The latest stories, insights and updates from Green.org — five new reads on climate, energy and cleantech.";

const envText = readFileSync(join(ROOT, ".env.local"), "utf8").replace(/^\uFEFF/, "");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

function parseSharedTemplate(raw) {
  const phpStart = raw.search(/<\?php/);
  if (phpStart < 0) throw new Error("PHP snippet not found in email template.txt");
  const html = raw.slice(0, phpStart).replace(/2\.\s+green-latest-posts-smartcode\.php[\s\S]*$/i, "").trim() + "\n";
  let php = raw.slice(phpStart).trim();
  if (!php.endsWith("\n")) php += "\n";
  return { html, php };
}

function loadEnvSite() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return supabase
    .from("wp_sites")
    .select("id, name, url, username, app_password, tool_scope")
    .order("created_at", { ascending: true });
}

function isGreenOrg(url) {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
    return host === "green.org";
  } catch {
    return /green\.org/i.test(url);
  }
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function main() {
  const { html, php } = parseSharedTemplate(readFileSync(TEMPLATE_TXT, "utf8"));
  mkdirSync(join(ROOT, "wordpress", "fluentcrm"), { recursive: true });
  mkdirSync(join(ROOT, "wordpress", "mu-plugins"), { recursive: true });
  writeFileSync(join(ROOT, "wordpress", "fluentcrm", "green-org-latest-stories.html"), html, "utf8");
  const pluginPhp = php.replace(
    " * Green.org — FluentCRM SmartCodes for the 5 most recent published posts.",
    " * Plugin Name: Green.org FluentCRM Latest Posts\n * Description: FluentCRM SmartCodes for the 5 most recent published posts.\n * Green.org — FluentCRM SmartCodes for the 5 most recent published posts."
  );
  writeFileSync(join(ROOT, "wordpress", "mu-plugins", "green-org-fluentcrm-latest-posts.php"), pluginPhp, "utf8");

  const { data: sites, error } = await loadEnvSite();
  if (error) throw error;
  const site = (sites ?? []).find((s) => isGreenOrg(s.url ?? ""));
  if (!site) throw new Error("No green.org row in wp_sites");

  const base = String(site.url).replace(/\/$/, "");
  const pass = String(site.app_password).replace(/\s+/g, "").trim();
  const auth = `Basic ${Buffer.from(`${site.username}:${pass}`).toString("base64")}`;
  const wafCookie = (process.env.WORDPRESS_WAF_BYPASS_COOKIE ?? "").trim();
  const headers = {
    Authorization: auth,
    Accept: "application/json",
    "User-Agent": UA,
    Referer: `${base}/`,
    Origin: base,
    ...(wafCookie ? { Cookie: wafCookie } : {}),
  };

  async function wp(path, opts = {}) {
    const url = `${base}/wp-json/${path.replace(/^\//, "")}`;
    const res = await fetch(url, {
      ...opts,
      headers: {
        ...headers,
        ...(opts.body && typeof opts.body === "string" && !opts.headers?.["Content-Type"]
          ? { "Content-Type": "application/json" }
          : {}),
        ...opts.headers,
      },
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    return { ok: res.ok, status: res.status, text, json, url };
  }

  console.log("Site:", site.name, base, "user:", site.username);

  const routes = await wp("");
  const namespaces = routes.json?.namespaces ?? [];
  console.log("REST namespaces:", Array.isArray(namespaces) ? namespaces.join(", ") : routes.status);

  const plugins = await wp("wp/v2/plugins?per_page=100");
  if (plugins.ok && Array.isArray(plugins.json)) {
    const names = plugins.json.map((p) => `${p.plugin} [${p.status}]`);
    console.log("Plugins:", names.filter((n) => /fluent|code.?snippet|wpcode|insert.?headers/i.test(n)).join(" | ") || "(no matching snippet plugins listed)");
    console.log("FluentCRM plugin:", names.find((n) => /fluent.?crm/i.test(n)) ?? "not listed");
  } else {
    console.log("Plugins list:", plugins.status, plugins.text.slice(0, 240));
  }

  const templates = await wp("fluent-crm/v2/templates?per_page=50&search=" + encodeURIComponent("Latest Stories"));
  console.log("FluentCRM templates search:", templates.status);
  if (!templates.ok) {
    const all = await wp("fluent-crm/v2/templates?per_page=15");
    console.log("FluentCRM templates list:", all.status, all.text.slice(0, 400));
  } else {
    const rows = templates.json?.templates?.data ?? templates.json?.data ?? templates.json?.templates ?? [];
    const list = Array.isArray(rows) ? rows : [];
    console.log(
      "Matching templates:",
      list.map((t) => `${t.ID ?? t.id}: ${t.post_title ?? t.title}`).join(" | ") || "(none)"
    );
  }

  const existing = await wp("fluent-crm/v2/templates?per_page=50&search=" + encodeURIComponent(TEMPLATE_TITLE));
  const existingRows = existing.json?.templates?.data ?? existing.json?.data ?? existing.json?.templates ?? [];
  const found = Array.isArray(existingRows)
    ? existingRows.find((t) => String(t.post_title ?? t.title ?? "") === TEMPLATE_TITLE)
    : null;

  const payload = {
    template: {
      post_title: TEMPLATE_TITLE,
      post_content: html,
      post_excerpt: PREHEADER,
      email_subject: TEMPLATE_SUBJECT,
      edit_type: "html",
      design_template: "raw_html",
      settings: {
        template_config: {
          content_width: 600,
          content_padding: 0,
          content_background: "#ffffff",
        },
        footer_settings: {
          custom_footer: "no",
        },
      },
    },
  };

  let saved;
  if (found?.ID || found?.id) {
    const id = found.ID ?? found.id;
    console.log("Updating existing template id", id);
    saved = await wp(`fluent-crm/v2/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  } else {
    console.log("Creating FluentCRM template");
    saved = await wp("fluent-crm/v2/templates", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  console.log("Template save:", saved.status, saved.text.slice(0, 500));
  if (!saved.ok) {
    const form = new URLSearchParams();
    form.set("template[post_title]", TEMPLATE_TITLE);
    form.set("template[post_content]", html);
    form.set("template[post_excerpt]", PREHEADER);
    form.set("template[email_subject]", TEMPLATE_SUBJECT);
    form.set("template[edit_type]", "html");
    form.set("template[design_template]", "raw_html");
    saved = await wp("fluent-crm/v2/templates", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    console.log("Template form save:", saved.status, saved.text.slice(0, 500));
  }

  const snippetApis = [
    "wpcode/v1/snippets",
    "code-snippets/v1/snippets",
    "wp/v2/code-snippets",
  ];
  for (const path of snippetApis) {
    const r = await wp(path);
    console.log("Snippet API", path, r.status, r.text.slice(0, 160).replace(/\s+/g, " "));
  }

  const codeSnippetsPlugin = plugins.ok && Array.isArray(plugins.json)
    ? plugins.json.find((p) => /code-snippets/i.test(p.plugin ?? "") || /code snippets/i.test(p.name ?? ""))
    : null;
  if (!codeSnippetsPlugin) {
    console.log("Attempting to install Code Snippets from wordpress.org");
    const inst = await wp("wp/v2/plugins", {
      method: "POST",
      body: JSON.stringify({ slug: "code-snippets", status: "active" }),
    });
    console.log("Install code-snippets:", inst.status, inst.text.slice(0, 400));
  } else if (codeSnippetsPlugin.status !== "active") {
    const act = await wp(`wp/v2/plugins/${encodeURIComponent(codeSnippetsPlugin.plugin)}`, {
      method: "POST",
      body: JSON.stringify({ status: "active" }),
    });
    console.log("Activate code-snippets:", act.status, act.text.slice(0, 300));
  }

  const snippetBody = {
    name: "Green.org FluentCRM Latest Posts",
    title: "Green.org FluentCRM Latest Posts",
    code: php.replace(/^<\?php\s*/, ""),
    scope: "global",
    active: true,
    priority: 10,
  };
  const snippetCreate = await wp("code-snippets/v1/snippets", {
    method: "POST",
    body: JSON.stringify(snippetBody),
  });
  console.log("Create code snippet:", snippetCreate.status, snippetCreate.text.slice(0, 400));
  if (!snippetCreate.ok) {
    const wpcode = await wp("wpcode/v1/snippets", {
      method: "POST",
      body: JSON.stringify({
        title: "Green.org FluentCRM Latest Posts",
        code: php,
        code_type: "php",
        location: "everywhere",
        auto_insert: true,
        active: true,
      }),
    });
    console.log("Create WPCode snippet:", wpcode.status, wpcode.text.slice(0, 400));
  }

  const verify = await wp("fluent-crm/v2/templates?per_page=20&search=" + encodeURIComponent("Latest Stories"));
  const verifyRows = verify.json?.templates?.data ?? verify.json?.data ?? [];
  if (Array.isArray(verifyRows)) {
    for (const t of verifyRows) {
      console.log("Template now:", t.ID ?? t.id, t.post_title ?? t.title, t.design_template ?? "");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
