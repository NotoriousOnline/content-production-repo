import { wpFetch, formatWpNetworkErrorHint, isTransientWpNetworkError } from "@/lib/wpFetch";

export type WPSite = {
  url: string;
  username: string;
  app_password: string;
};

/** Many CDNs/WAFs return 403 for Node/undici default User-Agent on /wp-json/. */
const WP_REST_USER_AGENT_BASE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function wpRestUserAgent(): string {
  const full = (process.env.WORDPRESS_REST_USER_AGENT ?? "").trim();
  if (full) return full;
  const suffix = (process.env.WORDPRESS_REST_USER_AGENT_SUFFIX ?? "").trim();
  return suffix ? `${WP_REST_USER_AGENT_BASE} ${suffix}` : WP_REST_USER_AGENT_BASE;
}

/**
 * Optional hard override for REST base URL (useful when site.url is proxied by WAF but
 * a separate unproxied origin/subdomain is available for /wp-json/).
 */
function resolveWpRestBase(base: string): string {
  const override = (process.env.WORDPRESS_REST_BASE_URL ?? "").trim();
  return override || base;
}

/** Absolute origin for Referer/Origin (handles URLs stored without https://). */
function siteRestOrigin(site: WPSite): string {
  const raw = resolveWpRestBase((site.url ?? "").trim()).replace(/\/$/, "");
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).origin;
  } catch {
    return withProtocol.startsWith("http") ? withProtocol : `https://${raw}`;
  }
}

function looksLikeCloudflareBlock(body: string): boolean {
  return /just a moment|__cf_chl|cf-chl-|challenge-platform|cloudflare/i.test(body);
}

function wafBypassEnvConfigured(): boolean {
  const c = (process.env.WORDPRESS_WAF_BYPASS_COOKIE ?? "").trim();
  const q = (process.env.WORDPRESS_WAF_BYPASS_QUERY ?? "").trim();
  const hn = (process.env.WORDPRESS_WAF_BYPASS_HEADER_NAME ?? "").trim();
  const hv = (process.env.WORDPRESS_WAF_BYPASS_HEADER_VALUE ?? "").trim();
  return !!(c || q || (hn && hv));
}

function cloudflareExtraHint(): string {
  if (!wafBypassEnvConfigured()) {
    return " Runtime check: no WORDPRESS_WAF_* bypass vars detected—add them in the Vercel project (Production), not only .env.local, then redeploy.";
  }
  return " Runtime check: WAF bypass env is set, but Cloudflare still blocked the request. Ask infra to confirm the rule matches this host, URI path /wp-json/, method POST, and the exact cookie name/value; try adding WORDPRESS_WAF_BYPASS_QUERY if the rule also expects a query string.";
}

function formatWordPressHttpError(status: number, body: string): string {
  const trimmed = body.trim();
  if (looksLikeCloudflareBlock(trimmed)) {
    return `${status} WordPress REST is blocked by Cloudflare (challenge HTML, not JSON). On Vercel set WORDPRESS_WAF_BYPASS_QUERY, WORDPRESS_WAF_BYPASS_COOKIE, and/or WORDPRESS_WAF_BYPASS_HEADER_* to match your WAF allowlist, or allowlist this app’s egress IPs. See .env.example.${cloudflareExtraHint()}`;
  }
  const max = 400;
  return trimmed.length > max ? `${status} ${trimmed.slice(0, max)}…` : `${status} ${trimmed}`;
}

/**
 * WordPress REST URL with optional WAF bypass query (e.g. bypass_key=secret) for Cloudflare allowlists.
 */
export function wpRestUrl(base: string, restPathAndQuery: string): string {
  const rawBase = resolveWpRestBase((base ?? "").trim());
  const withProtocol = /^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`;
  const parsed = new URL(withProtocol);
  const normalizedPath = parsed.pathname.replace(/\/$/, "");
  const trimmedBase = `${parsed.origin}${normalizedPath}`;
  const path = restPathAndQuery.replace(/^\//, "");
  const url = `${trimmedBase}/wp-json/${path}`;
  const bypass = (process.env.WORDPRESS_WAF_BYPASS_QUERY ?? "").trim();
  if (!bypass) return url;
  return url.includes("?") ? `${url}&${bypass}` : `${url}?${bypass}`;
}

function getWwwFallbackBase(base: string): string | null {
  try {
    const rawBase = (base ?? "").trim();
    const withProtocol = /^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`;
    const u = new URL(withProtocol);
    if (u.hostname.startsWith("www.")) return null;
    if (!u.hostname.includes(".")) return null;
    u.hostname = `www.${u.hostname}`;
    return `${u.origin}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** If hostname is www.example.com, return https://example.com (same path). Useful when www has no DNS from server egress. */
function getApexFromWwwBase(base: string): string | null {
  try {
    const rawBase = (base ?? "").trim();
    const withProtocol = /^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`;
    const u = new URL(withProtocol);
    if (!u.hostname.startsWith("www.")) return null;
    u.hostname = u.hostname.slice(4);
    if (!u.hostname) return null;
    return `${u.origin}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function dedupeRestBases(bases: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of bases) {
    const key = b.trim().replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b.trim().replace(/\/$/, ""));
  }
  return out;
}

/**
 * Hosts to try for media upload when Site URL alone fails.
 * - If WORDPRESS_REST_BASE_URL is set, only the site URL is used (wpRestUrl applies the override).
 * - If the site uses www., also try apex (strip www) — many sites only resolve apex from API hosts.
 * - Optional www retry for apex-only URLs: WORDPRESS_REST_TRY_WWW_FALLBACK=true (default off).
 *   Many domains have no www DNS record; automatic www retry caused ENOTFOUND on Vercel.
 */
function restBasesForMediaUpload(siteUrl: string): string[] {
  const trimmed = (siteUrl ?? "").trim().replace(/\/$/, "");
  const override = (process.env.WORDPRESS_REST_BASE_URL ?? "").trim();
  if (override) {
    return dedupeRestBases([trimmed]);
  }
  const bases: string[] = [trimmed];
  const apex = getApexFromWwwBase(trimmed);
  if (apex) bases.push(apex);
  const tryWww = (process.env.WORDPRESS_REST_TRY_WWW_FALLBACK ?? "").trim().toLowerCase() === "true";
  if (tryWww) {
    const www = getWwwFallbackBase(trimmed);
    if (www) bases.push(www);
  }
  return dedupeRestBases(bases);
}

/**
 * WordPress shows application passwords with spaces; Basic auth must use the raw 24-character string with no spaces.
 */
export function normalizeApplicationPassword(appPassword: string): string {
  return (appPassword ?? "").replace(/\s+/g, "").trim();
}

export function getAuthHeader(site: WPSite): string {
  const user = site.username.trim();
  const pass = normalizeApplicationPassword(site.app_password);
  const creds = `${user}:${pass}`;
  return `Basic ${Buffer.from(creds, "utf-8").toString("base64")}`;
}

function applyWafBypassHeaders(h: Record<string, string>): void {
  const wafCookie = (process.env.WORDPRESS_WAF_BYPASS_COOKIE ?? "").trim();
  if (wafCookie) {
    h.Cookie = wafCookie;
  }
  const bypassHeaderName = (process.env.WORDPRESS_WAF_BYPASS_HEADER_NAME ?? "").trim();
  const bypassHeaderValue = (process.env.WORDPRESS_WAF_BYPASS_HEADER_VALUE ?? "").trim();
  if (bypassHeaderName && bypassHeaderValue) {
    h[bypassHeaderName] = bypassHeaderValue;
  }
}

/** Standard headers for WordPress REST (auth + browser-like UA). */
export function wpRestHeaders(site: WPSite, opts?: { contentTypeJson?: boolean }): Record<string, string> {
  const originRoot = siteRestOrigin(site);
  const h: Record<string, string> = {
    Authorization: getAuthHeader(site),
    Accept: "application/json",
    "User-Agent": wpRestUserAgent(),
    Referer: `${originRoot}/`,
    Origin: originRoot,
    "Accept-Language": "en-US,en;q=0.9",
    /** Some Cloudflare rules expect browser-like fetch metadata (server-to-site API calls). */
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
  };
  applyWafBypassHeaders(h);
  if (opts?.contentTypeJson) {
    h["Content-Type"] = "application/json";
  }
  return h;
}

export type WPPostListItem = {
  id: number;
  title: { rendered: string };
  link: string;
  slug: string;
  excerpt?: { rendered?: string };
};

export async function getPosts(
  site: WPSite,
  limit: number
): Promise<{ id: number; title: { rendered: string }; link: string; slug: string }[]> {
  const base = site.url.replace(/\/$/, "");
  const res = await wpFetch(
    wpRestUrl(base, `wp/v2/posts?per_page=${limit}&_fields=id,title,link,slug`),
    { headers: wpRestHeaders(site) }
  );
  if (!res.ok) throw new Error(`WP getPosts failed: ${res.status}`);
  return (await res.json()) as {
    id: number;
    title: { rendered: string };
    link: string;
    slug: string;
  }[];
}

export type WPPostsPageHeaders = {
  posts: WPPostListItem[];
  /** From X-WP-Total; 0 if header missing. */
  total: number;
  /** From X-WP-TotalPages; 0 if header missing (caller should page until empty). */
  totalPages: number;
};

/**
 * One page of posts + WP REST total counts (for full-catalog sync without arbitrary caps).
 */
export async function getPostsPageWithHeaders(
  site: WPSite,
  page: number,
  perPage: number
): Promise<WPPostsPageHeaders> {
  const base = site.url.replace(/\/$/, "");
  const res = await wpFetch(
    wpRestUrl(base, `wp/v2/posts?per_page=${perPage}&page=${page}&_fields=id,title,link,slug,excerpt`),
    { headers: wpRestHeaders(site) }
  );
  if (res.status === 400) {
    return { posts: [], total: 0, totalPages: 0 };
  }
  if (!res.ok) throw new Error(`WP getPostsPage failed: ${res.status}`);
  const data = (await res.json()) as WPPostListItem[];
  const posts = Array.isArray(data) ? data : [];
  const total = parseInt(res.headers.get("x-wp-total") ?? "", 10);
  const totalPages = parseInt(res.headers.get("x-wp-totalpages") ?? "", 10);
  return {
    posts,
    total: Number.isFinite(total) ? total : 0,
    totalPages: Number.isFinite(totalPages) ? totalPages : 0,
  };
}

/** Paginated posts for building the internal link library (excerpt helps relevance). */
export async function getPostsPage(site: WPSite, page: number, perPage: number): Promise<WPPostListItem[]> {
  const { posts } = await getPostsPageWithHeaders(site, page, perPage);
  return posts;
}

const LINK_LIBRARY_PER_PAGE = 100;
const LINK_LIBRARY_MAX_PAGES_SAFETY = 500;

/**
 * All published posts visible to the REST user (up to 100 × 500 safety cap).
 * Uses X-WP-TotalPages when present; otherwise pages until an empty response (some CDNs strip headers).
 */
export async function fetchAllPostsForLinkLibrary(site: WPSite): Promise<WPPostListItem[]> {
  const perPage = LINK_LIBRARY_PER_PAGE;
  const first = await getPostsPageWithHeaders(site, 1, perPage);
  const all: WPPostListItem[] = [...first.posts];

  if (first.totalPages > 0) {
    const lastPage = Math.min(first.totalPages, LINK_LIBRARY_MAX_PAGES_SAFETY);
    for (let page = 2; page <= lastPage; page++) {
      const { posts } = await getPostsPageWithHeaders(site, page, perPage);
      if (posts.length === 0) break;
      all.push(...posts);
    }
  } else if (first.posts.length > 0) {
    for (let page = 2; page <= LINK_LIBRARY_MAX_PAGES_SAFETY; page++) {
      const { posts } = await getPostsPageWithHeaders(site, page, perPage);
      if (posts.length === 0) break;
      all.push(...posts);
    }
  }

  return all;
}

/** WooCommerce REST product row (wc/v3/products). */
export type WCProductListItem = {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  short_description?: string;
  /** First gallery image is typical for catalog cards. */
  images?: { id?: number; src?: string; alt?: string }[];
};

export type WCProductsPageHeaders = {
  products: WCProductListItem[];
  total: number;
  totalPages: number;
};

/**
 * One page of published WooCommerce products + total counts.
 * Uses Application Password auth (same as wp/v2); user needs permission to list products.
 */
export async function getProductsPageWithHeaders(
  site: WPSite,
  page: number,
  perPage: number
): Promise<WCProductsPageHeaders> {
  const base = site.url.replace(/\/$/, "");
  const res = await wpFetch(
    wpRestUrl(
      base,
      `wc/v3/products?per_page=${perPage}&page=${page}&status=publish&_fields=id,name,slug,permalink,short_description,images`
    ),
    { headers: wpRestHeaders(site) }
  );
  if (res.status === 404) {
    throw new Error(
      "WooCommerce REST not found (404). Install WooCommerce and ensure /wp-json/wc/v3 is available."
    );
  }
  if (res.status === 401 || res.status === 403) {
    const errText = await res.text();
    throw new Error(
      `WooCommerce products: ${res.status} — check that this WordPress user can access WooCommerce REST. ${errText.slice(0, 200)}`
    );
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WooCommerce getProductsPage failed: ${res.status} ${errText.slice(0, 400)}`);
  }
  const data = (await res.json()) as WCProductListItem[];
  const products = Array.isArray(data) ? data : [];
  const total = parseInt(res.headers.get("x-wp-total") ?? "", 10);
  const totalPages = parseInt(res.headers.get("x-wp-totalpages") ?? "", 10);
  return {
    products,
    total: Number.isFinite(total) ? total : 0,
    totalPages: Number.isFinite(totalPages) ? totalPages : 0,
  };
}

const PRODUCT_LINK_LIBRARY_PER_PAGE = 100;
const PRODUCT_LINK_LIBRARY_MAX_PAGES_SAFETY = 500;

/** All published products visible to the REST user (same paging pattern as posts). */
export async function fetchAllProductsForLinkLibrary(site: WPSite): Promise<WCProductListItem[]> {
  const perPage = PRODUCT_LINK_LIBRARY_PER_PAGE;
  const first = await getProductsPageWithHeaders(site, 1, perPage);
  const all: WCProductListItem[] = [...first.products];

  if (first.totalPages > 0) {
    const lastPage = Math.min(first.totalPages, PRODUCT_LINK_LIBRARY_MAX_PAGES_SAFETY);
    for (let page = 2; page <= lastPage; page++) {
      const { products } = await getProductsPageWithHeaders(site, page, perPage);
      if (products.length === 0) break;
      all.push(...products);
    }
  } else if (first.products.length > 0) {
    for (let page = 2; page <= PRODUCT_LINK_LIBRARY_MAX_PAGES_SAFETY; page++) {
      const { products } = await getProductsPageWithHeaders(site, page, perPage);
      if (products.length === 0) break;
      all.push(...products);
    }
  }

  return all;
}

export async function createPost(
  site: WPSite,
  title: string,
  content: string,
  featuredMediaId?: number,
  opts?: { categories?: number[]; tags?: number[]; slug?: string }
): Promise<{ id: number; link: string; editUrl: string; status: string }> {
  const base = site.url.replace(/\/$/, "");
  const body: Record<string, unknown> = {
    title,
    content,
    status: "draft",
  };
  if (featuredMediaId != null && featuredMediaId > 0) {
    body.featured_media = featuredMediaId;
  }
  if (typeof opts?.slug === "string" && opts.slug.trim()) {
    body.slug = opts.slug.trim().slice(0, 200);
  }
  if (Array.isArray(opts?.categories) && opts.categories.length > 0) {
    body.categories = opts.categories.filter((x) => Number.isFinite(x) && x > 0);
  }
  if (Array.isArray(opts?.tags) && opts.tags.length > 0) {
    body.tags = opts.tags.filter((x) => Number.isFinite(x) && x > 0);
  }

  const res = await wpFetch(wpRestUrl(base, "wp/v2/posts?context=edit"), {
    method: "POST",
    headers: wpRestHeaders(site, { contentTypeJson: true }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WP createPost failed: ${res.status} ${errText}`);
  }
  const data = (await res.json()) as { id: number; link: string; status?: string };
  const status = data.status ?? "draft";
  if (status !== "draft") {
    console.warn(`[createPost] WordPress returned status "${status}" instead of "draft"`);
  }
  return {
    id: data.id,
    link: data.link,
    editUrl: `${base}/wp-admin/post.php?post=${data.id}&action=edit`,
    status,
  };
}

/** Update an existing post and keep it as draft (same shape as createPost). */
export async function updatePost(
  site: WPSite,
  postId: number,
  title: string,
  content: string,
  featuredMediaId?: number,
  opts?: { categories?: number[]; tags?: number[]; slug?: string }
): Promise<{ id: number; link: string; editUrl: string; status: string }> {
  if (!Number.isFinite(postId) || postId <= 0) {
    throw new Error("updatePost: invalid postId");
  }
  const base = site.url.replace(/\/$/, "");
  const body: Record<string, unknown> = {
    title,
    content,
    status: "draft",
  };
  if (featuredMediaId != null && featuredMediaId > 0) {
    body.featured_media = featuredMediaId;
  }
  if (typeof opts?.slug === "string" && opts.slug.trim()) {
    body.slug = opts.slug.trim().slice(0, 200);
  }
  if (Array.isArray(opts?.categories) && opts.categories.length > 0) {
    body.categories = opts.categories.filter((x) => Number.isFinite(x) && x > 0);
  }
  if (Array.isArray(opts?.tags) && opts.tags.length > 0) {
    body.tags = opts.tags.filter((x) => Number.isFinite(x) && x > 0);
  }

  const res = await wpFetch(wpRestUrl(base, `wp/v2/posts/${postId}?context=edit`), {
    method: "POST",
    headers: wpRestHeaders(site, { contentTypeJson: true }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WP updatePost failed: ${res.status} ${errText}`);
  }
  const data = (await res.json()) as { id: number; link: string; status?: string };
  const status = data.status ?? "draft";
  if (status !== "draft") {
    console.warn(`[updatePost] WordPress returned status "${status}" instead of "draft"`);
  }
  return {
    id: data.id,
    link: data.link,
    editUrl: `${base}/wp-admin/post.php?post=${data.id}&action=edit`,
    status,
  };
}

const STRAIN_REST_COLLECTIONS = ["strains", "strain", "posts", "pages"] as const;

/** Which REST collections to probe for strain pages (CPT first, then posts/pages). */
export const STRAIN_PAGE_REST_COLLECTIONS = STRAIN_REST_COLLECTIONS;

async function restCollectionExists(site: WPSite, collection: string): Promise<boolean> {
  const base = site.url.replace(/\/$/, "");
  const res = await wpFetch(wpRestUrl(base, `wp/v2/${collection}?per_page=1`), {
    headers: wpRestHeaders(site),
  });
  return res.ok;
}

async function resolveStrainRestCollection(site: WPSite): Promise<string> {
  for (const col of STRAIN_REST_COLLECTIONS) {
    if (await restCollectionExists(site, col)) return col;
  }
  return "posts";
}

export type WPPostInCollection = {
  id: number;
  link: string;
  status: string;
  restCollection: string;
};

/** Find which REST collection owns a post ID (tries strains CPT, then posts/pages). */
export async function resolveRestCollectionForPostId(
  site: WPSite,
  postId: number
): Promise<WPPostInCollection | null> {
  if (!Number.isFinite(postId) || postId <= 0) return null;
  const base = site.url.replace(/\/$/, "");
  for (const col of STRAIN_REST_COLLECTIONS) {
    if (!(await restCollectionExists(site, col))) continue;
    const res = await wpFetch(wpRestUrl(base, `wp/v2/${col}/${postId}?context=edit`), {
      headers: wpRestHeaders(site),
    });
    if (!res.ok) continue;
    const data = (await res.json()) as { id?: number; link?: string; status?: string };
    if (data?.id === postId) {
      return {
        id: postId,
        link: String(data.link ?? "").trim(),
        status: String(data.status ?? "draft"),
        restCollection: col,
      };
    }
  }
  return null;
}

type WPUserRow = { id?: number };

/** Resolve a WordPress user ID by nicename/slug (requires edit context for some sites). */
export async function resolveWpUserIdBySlug(site: WPSite, slug: string): Promise<number | null> {
  const s = slug.trim();
  if (!s) return null;
  const base = site.url.replace(/\/$/, "");
  const path = `wp/v2/users?slug=${encodeURIComponent(s)}&context=edit&per_page=1`;
  const res = await wpFetch(wpRestUrl(base, path), {
    headers: wpRestHeaders(site),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as WPUserRow[];
  const id = Array.isArray(rows) ? rows[0]?.id : undefined;
  return typeof id === "number" && id > 0 ? id : null;
}

export type StrainPostWriteOpts = {
  slug?: string;
  meta?: Record<string, string>;
  restCollection?: string;
  preserveStatus?: boolean;
  authorId?: number;
  refreshPublishDate?: boolean;
};

function applyStrainPostAuthorAndDate(body: Record<string, unknown>, opts?: StrainPostWriteOpts): void {
  if (opts?.authorId != null && opts.authorId > 0) {
    body.author = opts.authorId;
  }
  if (opts?.refreshPublishDate) {
    const date_gmt = new Date().toISOString().slice(0, 19);
    body.date_gmt = date_gmt;
    body.modified_gmt = date_gmt;
  }
}

export async function createStrainPost(
  site: WPSite,
  title: string,
  content: string,
  opts?: StrainPostWriteOpts
): Promise<{ id: number; link: string; editUrl: string; status: string; restCollection: string }> {
  const base = site.url.replace(/\/$/, "");
  const restCollection =
    opts?.restCollection && (await restCollectionExists(site, opts.restCollection))
      ? opts.restCollection
      : await resolveStrainRestCollection(site);
  const body: Record<string, unknown> = {
    title,
    content,
    status: "draft",
  };
  if (typeof opts?.slug === "string" && opts.slug.trim()) {
    body.slug = opts.slug.trim().slice(0, 200);
  }
  if (opts?.meta && Object.keys(opts.meta).length > 0) {
    body.meta = opts.meta;
    body.meta_input = { ...opts.meta };
  }
  applyStrainPostAuthorAndDate(body, opts);

  const res = await wpFetch(wpRestUrl(base, `wp/v2/${restCollection}?context=edit`), {
    method: "POST",
    headers: wpRestHeaders(site, { contentTypeJson: true }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WP createStrainPost failed: ${res.status} ${errText}`);
  }
  const data = (await res.json()) as { id: number; link: string; status?: string };
  const status = data.status ?? "draft";
  return {
    id: data.id,
    link: data.link,
    editUrl: `${base}/wp-admin/post.php?post=${data.id}&action=edit`,
    status,
    restCollection,
  };
}

export async function updateStrainPost(
  site: WPSite,
  postId: number,
  title: string,
  content: string,
  opts?: StrainPostWriteOpts
): Promise<{ id: number; link: string; editUrl: string; status: string; restCollection: string }> {
  if (!Number.isFinite(postId) || postId <= 0) {
    throw new Error("updateStrainPost: invalid postId");
  }
  const base = site.url.replace(/\/$/, "");

  let resolved = await resolveRestCollectionForPostId(site, postId);
  if (
    !resolved &&
    opts?.restCollection &&
    (await restCollectionExists(site, opts.restCollection))
  ) {
    const col = opts.restCollection;
    const res = await wpFetch(wpRestUrl(base, `wp/v2/${col}/${postId}?context=edit`), {
      headers: wpRestHeaders(site),
    });
    if (res.ok) {
      const data = (await res.json()) as { id?: number; link?: string; status?: string };
      if (data?.id === postId) {
        resolved = {
          id: postId,
          link: String(data.link ?? "").trim(),
          status: String(data.status ?? "draft"),
          restCollection: col,
        };
      }
    }
  }

  if (!resolved) {
    throw new Error(
      `WP updateStrainPost: post ID ${postId} not found in REST collections (${STRAIN_REST_COLLECTIONS.join(", ")}). Check the post ID and that REST API is enabled.`
    );
  }

  const restCollection = resolved.restCollection;
  const body: Record<string, unknown> = {
    title,
    content,
  };
  // Preserve live/draft status unless explicitly creating a draft revision.
  if (opts?.preserveStatus !== false) {
    body.status = resolved.status;
  } else {
    body.status = "draft";
  }
  if (typeof opts?.slug === "string" && opts.slug.trim()) {
    body.slug = opts.slug.trim().slice(0, 200);
  }
  if (opts?.meta && Object.keys(opts.meta).length > 0) {
    body.meta = opts.meta;
    body.meta_input = { ...opts.meta };
  }
  applyStrainPostAuthorAndDate(body, opts);

  const res = await wpFetch(wpRestUrl(base, `wp/v2/${restCollection}/${postId}?context=edit`), {
    method: "POST",
    headers: wpRestHeaders(site, { contentTypeJson: true }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WP updateStrainPost failed: ${res.status} ${errText}`);
  }
  const data = (await res.json()) as { id: number; link: string; status?: string };
  const status = data.status ?? resolved.status;
  return {
    id: data.id,
    link: data.link,
    editUrl: `${base}/wp-admin/post.php?post=${data.id}&action=edit`,
    status,
    restCollection,
  };
}

export type WPCategoryRow = {
  id: number;
  name: string;
  slug: string;
  parent: number;
};

/**
 * Lists all post categories (paginated). Uses same auth as other REST reads.
 */
export async function listAllCategories(site: WPSite): Promise<WPCategoryRow[]> {
  const base = site.url.replace(/\/$/, "");
  const out: WPCategoryRow[] = [];
  let page = 1;
  const perPage = 100;

  for (;;) {
    const res = await wpFetch(
      wpRestUrl(
        base,
        `wp/v2/categories?per_page=${perPage}&page=${page}&_fields=id,name,slug,parent`
      ),
      { headers: wpRestHeaders(site) }
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`WP listAllCategories failed: ${res.status} ${errText}`);
    }
    const rows = (await res.json()) as Array<{ id: number; name?: string; slug?: string; parent?: number }>;
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      out.push({
        id: r.id,
        name: (r.name ?? "").trim(),
        slug: (r.slug ?? "").trim(),
        parent: typeof r.parent === "number" ? r.parent : 0,
      });
    }
    if (rows.length < perPage) break;
    page += 1;
    if (page > 50) break;
  }
  return out;
}

export async function getCategoryIdByName(site: WPSite, categoryName: string): Promise<number | null> {
  const base = site.url.replace(/\/$/, "");
  const needle = categoryName.trim().toLowerCase();
  if (!needle) return null;

  const res = await wpFetch(
    wpRestUrl(
      base,
      `wp/v2/categories?per_page=100&search=${encodeURIComponent(categoryName)}&_fields=id,name,slug`
    ),
    { headers: wpRestHeaders(site) }
  );
  if (!res.ok) {
    const errText = await res.text();
    console.warn(`[getCategoryIdByName] ${res.status} ${errText}`);
    return null;
  }

  const rows = (await res.json()) as Array<{ id: number; name?: string; slug?: string }>;
  const exact =
    rows.find((r) => (r.name ?? "").trim().toLowerCase() === needle) ??
    rows.find((r) => (r.slug ?? "").trim().toLowerCase() === needle);
  return exact?.id ?? null;
}

/** Set featured image after post exists (more reliable than only passing featured_media on create). */
export async function setPostFeaturedMedia(
  site: WPSite,
  postId: number,
  mediaId: number,
  restCollection = "posts"
): Promise<void> {
  if (!Number.isFinite(mediaId) || mediaId <= 0) return;
  const base = site.url.replace(/\/$/, "");
  const collection = restCollection.replace(/^\/+|\/+$/g, "") || "posts";
  const res = await wpFetch(wpRestUrl(base, `wp/v2/${collection}/${postId}`), {
    method: "POST",
    headers: wpRestHeaders(site, { contentTypeJson: true }),
    body: JSON.stringify({ featured_media: mediaId }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WP setPostFeaturedMedia failed: ${res.status} ${errText}`);
  }
}

export async function uploadMedia(
  site: WPSite,
  imageBuffer: Buffer,
  filename: string,
  mimeType: string
): Promise<{ id: number; url: string }> {
  const bases = restBasesForMediaUpload(site.url ?? "");

  const fetchErr = (e: unknown): string => {
    if (isTransientWpNetworkError(e)) return formatWpNetworkErrorHint(e);
    const msg = e instanceof Error ? e.message : String(e);
    const cause = e instanceof Error && e.cause ? String(e.cause) : "";
    return cause ? `${msg} | cause: ${cause}` : msg;
  };

  const tryMultipart = async (targetEndpoint: string): Promise<{ id: number; url: string }> => {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(imageBuffer)], { type: mimeType });
    formData.append("file", blob, filename);
    const res = await wpFetch(targetEndpoint, {
      method: "POST",
      headers: wpRestHeaders(site),
      body: formData as never,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`WP uploadMedia (multipart) failed: ${formatWordPressHttpError(res.status, errText)}`);
    }
    const data = (await res.json()) as { id: number; source_url: string };
    return { id: data.id, url: data.source_url };
  };

  const tryRawBinary = async (targetEndpoint: string): Promise<{ id: number; url: string }> => {
    const headers = {
      ...wpRestHeaders(site),
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    };
    const res = await wpFetch(targetEndpoint, {
      method: "POST",
      headers,
      body: new Uint8Array(imageBuffer) as never,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`WP uploadMedia (raw) failed: ${formatWordPressHttpError(res.status, errText)}`);
    }
    const data = (await res.json()) as { id: number; source_url: string };
    return { id: data.id, url: data.source_url };
  };

  const tryOneBase = async (base: string): Promise<{ id: number; url: string }> => {
    const endpoint = wpRestUrl(base, "wp/v2/media");
    try {
      return await tryMultipart(endpoint);
    } catch (multipartErr) {
      console.warn(`[uploadMedia] multipart failed for ${base}; retrying raw binary. ${fetchErr(multipartErr)}`);
    }
    return tryRawBinary(endpoint);
  };

  let lastErr: unknown;
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    try {
      return await tryOneBase(base);
    } catch (e) {
      lastErr = e;
      const msg = fetchErr(e);
      console.warn(`[uploadMedia] failed for base ${base} (${i + 1}/${bases.length}): ${msg}`);
      if (i < bases.length - 1) continue;
    }
  }

  const hint =
    /enotfound/i.test(fetchErr(lastErr)) && !(process.env.WORDPRESS_REST_BASE_URL ?? "").trim()
      ? " DNS lookup failed from this server after system DNS and DoH fallback. Set WORDPRESS_REST_BASE_URL to a hostname that resolves from Vercel (often an API/origin host), or set WORDPRESS_DNS_DOH_FALLBACK=false only if DoH is blocked. Do not enable WORDPRESS_REST_TRY_WWW_FALLBACK unless www exists in DNS."
      : "";
  throw new Error(
    `WP uploadMedia failed after trying ${bases.join(", ")} (multipart then raw per host): ${fetchErr(lastErr)}${hint}`
  );
}

export async function updateMediaDetails(
  site: WPSite,
  mediaId: number,
  fields: { alt_text?: string; title?: string; caption?: string }
): Promise<void> {
  const base = site.url.replace(/\/$/, "");
  const body: Record<string, string> = {};
  if (fields.alt_text != null) body.alt_text = fields.alt_text;
  if (fields.title != null) body.title = fields.title;
  if (fields.caption != null) body.caption = fields.caption;
  if (Object.keys(body).length === 0) return;

  const res = await wpFetch(wpRestUrl(base, `wp/v2/media/${mediaId}`), {
    method: "POST",
    headers: wpRestHeaders(site, { contentTypeJson: true }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.warn(`[updateMediaDetails] ${res.status} ${errText}`);
  }
}

/** Yoast SEO post meta (requires Yoast registering these keys for REST; common on recent Yoast). */
export async function updatePostYoastMeta(
  site: WPSite,
  postId: number,
  fields: {
    metadesc?: string;
    focuskw?: string;
    /** SEO title override (_yoast_wpseo_title) */
    seoTitle?: string;
  }
): Promise<boolean> {
  const base = site.url.replace(/\/$/, "");
  const meta: Record<string, string> = {};
  if (fields.metadesc != null && fields.metadesc !== "") {
    meta._yoast_wpseo_metadesc = fields.metadesc.slice(0, 320);
  }
  if (fields.focuskw != null && fields.focuskw !== "") {
    meta._yoast_wpseo_focuskw = fields.focuskw.slice(0, 191);
  }
  if (fields.seoTitle != null && fields.seoTitle !== "") {
    meta._yoast_wpseo_title = fields.seoTitle.slice(0, 200);
  }
  if (Object.keys(meta).length === 0) return true;

  const topLevel: Record<string, string> = {};
  if (meta._yoast_wpseo_metadesc) topLevel._yoast_wpseo_metadesc = meta._yoast_wpseo_metadesc;
  if (meta._yoast_wpseo_focuskw) topLevel._yoast_wpseo_focuskw = meta._yoast_wpseo_focuskw;
  if (meta._yoast_wpseo_title) topLevel._yoast_wpseo_title = meta._yoast_wpseo_title;

  const payloads: Array<Record<string, unknown>> = [{ meta }, { meta_input: { ...meta } }];
  if (Object.keys(topLevel).length > 0) {
    payloads.push(topLevel);
  }

  for (let i = 0; i < payloads.length; i++) {
    const res = await wpFetch(wpRestUrl(base, `wp/v2/posts/${postId}`), {
      method: "POST",
      headers: wpRestHeaders(site, { contentTypeJson: true }),
      body: JSON.stringify(payloads[i]),
    });
    if (res.ok) return true;
    const errText = await res.text();
    console.warn(`[updatePostYoastMeta] attempt ${i + 1} failed: ${res.status} ${errText.slice(0, 400)}`);
  }

  console.warn(
    "[updatePostYoastMeta] Yoast fields not persisted. Ensure _yoast_wpseo_* meta keys are registered for REST (Yoast SEO → REST API / show_in_rest)."
  );
  return false;
}

export type WPPostResolved = {
  id: number;
  title: string;
  link: string;
  slug: string;
  /** REST collection segment, e.g. posts | pages | strain */
  restCollection: string;
  excerptPlain: string;
  contentPlain: string;
};

export type WPRankMathFields = {
  focusKeyword: string;
  metaDescription: string;
  seoTitle: string;
};

function stripRenderedHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePublicPath(url: string): string {
  const withProtocol = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
  const parsed = new URL(withProtocol);
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  return `${parsed.origin}${path}`.toLowerCase();
}

function slugFromPublicUrl(url: string): string {
  const withProtocol = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
  const parts = new URL(withProtocol).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

const POST_LOOKUP_COLLECTIONS = ["posts", "pages", "strain", "strains", "learn"] as const;

type WPRestPostRow = {
  id: number;
  title?: { rendered?: string };
  link?: string;
  slug?: string;
  excerpt?: { rendered?: string };
  content?: { rendered?: string };
};

function publicRestHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": wpRestUserAgent(),
    "Accept-Language": "en-US,en;q=0.9",
  };
  applyWafBypassHeaders(h);
  return h;
}

async function fetchRestJsonRows(url: string, headers: Record<string, string>): Promise<WPRestPostRow[]> {
  const res = await wpFetch(url, { headers });
  if (res.status === 404) return [];
  if (!res.ok) return [];
  const rows = (await res.json()) as WPRestPostRow[];
  return Array.isArray(rows) ? rows : [];
}

async function fetchPostsBySlug(
  site: WPSite,
  restCollection: string,
  slug: string,
  opts?: { context?: "view" | "edit" }
): Promise<WPRestPostRow[]> {
  const base = site.url.replace(/\/$/, "");
  const context = opts?.context ?? "view";
  const path = `wp/v2/${restCollection}?slug=${encodeURIComponent(slug)}&context=${context}&per_page=10`;
  if (context === "view") {
    const pub = await fetchRestJsonRows(wpRestUrl(base, path), publicRestHeaders());
    if (pub.length > 0) return pub;
  }
  return fetchRestJsonRows(wpRestUrl(base, path), wpRestHeaders(site));
}

async function searchPostsByTerm(site: WPSite, term: string): Promise<WPRestPostRow[]> {
  const base = site.url.replace(/\/$/, "");
  const path = `wp/v2/posts?search=${encodeURIComponent(term)}&per_page=20&context=view`;
  const authed = await fetchRestJsonRows(wpRestUrl(base, path), wpRestHeaders(site));
  if (authed.length > 0) return authed;
  return fetchRestJsonRows(wpRestUrl(base, path), publicRestHeaders());
}

function rowToResolved(row: WPRestPostRow, restCollection: string): WPPostResolved {
  return {
    id: row.id,
    title: stripRenderedHtml(row.title?.rendered ?? ""),
    link: String(row.link ?? "").trim(),
    slug: String(row.slug ?? "").trim(),
    restCollection,
    excerptPlain: stripRenderedHtml(row.excerpt?.rendered ?? ""),
    contentPlain: stripRenderedHtml(row.content?.rendered ?? "").slice(0, 8000),
  };
}

/** Resolve a published Weed.com URL to a WordPress REST post (posts, pages, or common CPTs). */
export async function resolvePostByPublicUrl(site: WPSite, publicUrl: string): Promise<WPPostResolved | null> {
  const slug = slugFromPublicUrl(publicUrl);
  if (!slug) return null;
  const targetPath = normalizePublicPath(publicUrl);

  for (const collection of POST_LOOKUP_COLLECTIONS) {
    let rows = await fetchPostsBySlug(site, collection, slug, { context: "view" });
    if (rows.length === 0) {
      rows = await fetchPostsBySlug(site, collection, slug, { context: "edit" });
    }
    if (rows.length === 0) continue;
    const exact = rows.find((r) => r.link && normalizePublicPath(r.link) === targetPath);
    const pick = exact ?? rows[0];
    if (!pick?.id) continue;
    return rowToResolved(pick, collection);
  }

  const searchTerm = slug.replace(/-/g, " ");
  const searched = await searchPostsByTerm(site, searchTerm);
  const fromSearch = searched.find((r) => r.link && normalizePublicPath(r.link) === targetPath);
  if (fromSearch?.id) {
    return rowToResolved(fromSearch, "posts");
  }

  return null;
}

/** Human-readable reason when slug/ID lookup returns null (Cloudflare vs auth vs missing post). */
export async function explainPostLookupFailure(
  site: WPSite,
  opts: { postId?: number }
): Promise<string> {
  const base = site.url.replace(/\/$/, "");
  const path =
    opts.postId && opts.postId > 0
      ? `wp/v2/posts/${opts.postId}?context=view`
      : "wp/v2/posts?per_page=1&context=view";
  const res = await wpFetch(wpRestUrl(base, path), { headers: wpRestHeaders(site) });
  const text = await res.text();
  if (looksLikeCloudflareBlock(text)) {
    const cookieSet = !!(process.env.WORDPRESS_WAF_BYPASS_COOKIE ?? "").trim();
    const base = cookieSet
      ? "WORDPRESS_WAF_BYPASS_COOKIE is set and sent on every request, but Cloudflare still returned the browser challenge."
      : "WordPress REST is blocked by Cloudflare.";
    return `${base} The post may still exist. Ask weed.com infra to confirm the WAF skip rule matches host weed.com, URI /wp-json/*, cookie name cf_bypass, and this exact value — or add WORDPRESS_WAF_BYPASS_QUERY / WORDPRESS_WAF_BYPASS_HEADER_* if the rule requires them.${cloudflareExtraHint()}`;
  }
  if (res.status === 401) {
    return `WordPress rejected the application password (HTTP 401 invalid application password). Select the site "weed.com ALEX username" or regenerate the app password in wp-admin → Users → Application Passwords.`;
  }
  if (res.status === 403) {
    return `WordPress REST returned HTTP 403. Check site credentials and Cloudflare/WAF rules for /wp-json/.`;
  }
  if (opts.postId && res.status === 404) {
    return `WordPress returned HTTP 404 for post ID ${opts.postId} — that ID does not exist in the posts collection.`;
  }
  return `Could not load the post via WordPress REST (HTTP ${res.status}).`;
}

/** Resolve a WordPress post by numeric ID (skips slug lookup — use when WAF blocks list endpoints). */
export async function resolvePostById(
  site: WPSite,
  postId: number,
  preferredCollection = "posts"
): Promise<WPPostResolved | null> {
  if (!Number.isFinite(postId) || postId <= 0) return null;
  const base = site.url.replace(/\/$/, "");
  const collections = [
    preferredCollection,
    ...POST_LOOKUP_COLLECTIONS.filter((c) => c !== preferredCollection),
  ];
  for (const collection of collections) {
    const detailPath = `wp/v2/${collection}/${postId}?context=view`;
    let res = await wpFetch(wpRestUrl(base, detailPath), { headers: wpRestHeaders(site) });
    if (!res.ok) {
      res = await wpFetch(wpRestUrl(base, detailPath), { headers: publicRestHeaders() });
    }
    if (!res.ok) continue;
    const data = (await res.json()) as WPRestPostRow;
    if (!data?.id) continue;
    return rowToResolved(data, collection);
  }
  return null;
}

/** Load full body text when slug listing omits content. */
export async function enrichResolvedPostContent(
  site: WPSite,
  resolved: WPPostResolved
): Promise<WPPostResolved> {
  if (resolved.contentPlain.length >= 120) return resolved;
  const base = site.url.replace(/\/$/, "");
  const detailPath = `wp/v2/${resolved.restCollection}/${resolved.id}?context=view`;
  let res = await wpFetch(wpRestUrl(base, detailPath), { headers: wpRestHeaders(site) });
  if (!res.ok) {
    res = await wpFetch(wpRestUrl(base, detailPath), { headers: publicRestHeaders() });
  }
  if (!res.ok) return resolved;
  const data = (await res.json()) as WPRestPostRow;
  return {
    ...resolved,
    title: stripRenderedHtml(data.title?.rendered ?? resolved.title),
    excerptPlain: stripRenderedHtml(data.excerpt?.rendered ?? resolved.excerptPlain),
    contentPlain: stripRenderedHtml(data.content?.rendered ?? resolved.contentPlain).slice(0, 8000),
  };
}

function readRankMathFromMetaObject(meta: Record<string, unknown>): WPRankMathFields {
  const str = (k: string) => {
    const v = meta[k];
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    focusKeyword: str("rank_math_focus_keyword"),
    metaDescription: str("rank_math_description"),
    seoTitle: str("rank_math_title"),
  };
}

/** Read current Rank Math fields for a post (edit context). */
export async function getPostRankMathFields(
  site: WPSite,
  postId: number,
  restCollection = "posts"
): Promise<WPRankMathFields> {
  const base = site.url.replace(/\/$/, "");
  const res = await wpFetch(wpRestUrl(base, `wp/v2/${restCollection}/${postId}?context=edit`), {
    headers: wpRestHeaders(site),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WP getPostRankMathFields failed: ${res.status} ${errText.slice(0, 400)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const meta =
    data.meta && typeof data.meta === "object" ? (data.meta as Record<string, unknown>) : {};
  const fromMeta = readRankMathFromMetaObject(meta);
  return {
    focusKeyword: fromMeta.focusKeyword || String(data.rank_math_focus_keyword ?? "").trim(),
    metaDescription: fromMeta.metaDescription || String(data.rank_math_description ?? "").trim(),
    seoTitle: fromMeta.seoTitle || String(data.rank_math_title ?? "").trim(),
  };
}

function buildRankMathMetaPayload(fields: {
  metadesc?: string;
  focuskw?: string;
  seoTitle?: string;
}): Record<string, string> {
  const meta: Record<string, string> = {};
  if (fields.metadesc != null && fields.metadesc !== "") {
    meta.rank_math_description = fields.metadesc.slice(0, 320);
  }
  if (fields.focuskw != null && fields.focuskw !== "") {
    meta.rank_math_focus_keyword = fields.focuskw.slice(0, 191);
  }
  if (fields.seoTitle != null && fields.seoTitle !== "") {
    meta.rank_math_title = fields.seoTitle.slice(0, 200);
  }
  return meta;
}

function parseRankMathWriteResponse(
  status: number,
  body: string,
  expectedKeys: string[]
): { ok: boolean; detail?: string } {
  if (status < 200 || status >= 300) {
    return { ok: false, detail: body.trim().slice(0, 500) || `HTTP ${status}` };
  }
  const trimmed = body.trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.success === true) return { ok: true };
    const updated = parsed.updated;
    if (updated && typeof updated === "object") {
      const u = updated as Record<string, unknown>;
      const ok = expectedKeys.every((k) => typeof u[k] === "string" && String(u[k]).trim().length > 0);
      if (ok) return { ok: true };
    }
    // Rank Math updateMeta returns per-field booleans — require each expected field to be true.
    const fieldOk = expectedKeys.every((k) => parsed[k] === true);
    if (fieldOk) return { ok: true };
    if (parsed.slug === true && expectedKeys.length === 0) return { ok: true };
    return {
      ok: false,
      detail: `Rank Math did not confirm all fields (${expectedKeys.join(", ")}). Response: ${trimmed.slice(0, 400)}`,
    };
  } catch {
    if (trimmed === "true") return { ok: true };
    return { ok: false, detail: trimmed.slice(0, 400) };
  }
}

/** Content Studio mu-plugin on weed.com (update_post_meta server-side). */
async function updatePostRankMathViaWeedComTools(
  site: WPSite,
  postId: number,
  meta: Record<string, string>
): Promise<{ ok: boolean; detail?: string }> {
  const base = site.url.replace(/\/$/, "");
  const res = await wpFetch(wpRestUrl(base, `weed-com-tools/v1/rank-math/${postId}`), {
    method: "POST",
    headers: wpRestHeaders(site, { contentTypeJson: true }),
    body: JSON.stringify(meta),
  });
  const text = await res.text();
  return parseRankMathWriteResponse(res.status, text, Object.keys(meta));
}

/** Rank Math bulk endpoint — more reliable than updateMeta for focus keyword + description. */
async function updatePostRankMathViaBulk(
  site: WPSite,
  postId: number,
  meta: Record<string, string>
): Promise<{ ok: boolean; detail?: string }> {
  const base = site.url.replace(/\/$/, "");
  const res = await wpFetch(wpRestUrl(base, "rankmath/v1/updateMetaBulk"), {
    method: "POST",
    headers: wpRestHeaders(site, { contentTypeJson: true }),
    body: JSON.stringify({
      rows: [{ objectType: "post", objectID: postId, meta }],
    }),
  });
  const text = await res.text();
  return parseRankMathWriteResponse(res.status, text, Object.keys(meta));
}

/** Rank Math single-post endpoint (editor); often only confirms permalink unless fields are whitelisted. */
async function updatePostRankMathViaRankMathApi(
  site: WPSite,
  postId: number,
  meta: Record<string, string>
): Promise<{ ok: boolean; detail?: string }> {
  const base = site.url.replace(/\/$/, "");
  const res = await wpFetch(wpRestUrl(base, "rankmath/v1/updateMeta"), {
    method: "POST",
    headers: wpRestHeaders(site, { contentTypeJson: true }),
    body: JSON.stringify({
      objectType: "post",
      objectID: postId,
      meta,
    }),
  });
  const text = await res.text();
  return parseRankMathWriteResponse(res.status, text, Object.keys(meta));
}

/** Rank Math SEO post meta — prefers Rank Math /updateMeta, then WP REST fallbacks. */
export async function updatePostRankMathMeta(
  site: WPSite,
  postId: number,
  fields: {
    metadesc?: string;
    focuskw?: string;
    seoTitle?: string;
  },
  opts?: { restCollection?: string }
): Promise<boolean> {
  const base = site.url.replace(/\/$/, "");
  const collection = (opts?.restCollection ?? "posts").replace(/^\/+|\/+$/g, "");
  const meta = buildRankMathMetaPayload(fields);
  if (Object.keys(meta).length === 0) return true;

  const strategies: Array<{ name: string; run: () => Promise<{ ok: boolean; detail?: string }> }> = [
    { name: "weed-com-tools/v1/rank-math", run: () => updatePostRankMathViaWeedComTools(site, postId, meta) },
    { name: "rankmath/v1/updateMetaBulk", run: () => updatePostRankMathViaBulk(site, postId, meta) },
    { name: "rankmath/v1/updateMeta", run: () => updatePostRankMathViaRankMathApi(site, postId, meta) },
  ];

  for (const strategy of strategies) {
    const result = await strategy.run();
    if (result.ok) return true;
    if (result.detail) {
      console.warn(`[updatePostRankMathMeta] ${strategy.name} failed:`, result.detail);
    }
  }

  const payloads: Array<Record<string, unknown>> = [
    { meta },
    { meta_input: meta },
    {
      rank_math_title: meta.rank_math_title,
      rank_math_description: meta.rank_math_description,
      rank_math_focus_keyword: meta.rank_math_focus_keyword,
    },
  ];

  for (let i = 0; i < payloads.length; i++) {
    const res = await wpFetch(wpRestUrl(base, `wp/v2/${collection}/${postId}`), {
      method: "POST",
      headers: wpRestHeaders(site, { contentTypeJson: true }),
      body: JSON.stringify(payloads[i]),
    });
    const text = await res.text();
    if (res.ok) {
      const after = await getPostRankMathFields(site, postId, collection).catch(() => null);
      if (after) {
        const focusOk = !meta.rank_math_focus_keyword || after.focusKeyword === meta.rank_math_focus_keyword;
        const descOk = !meta.rank_math_description || after.metaDescription === meta.rank_math_description;
        if (focusOk && descOk) return true;
      }
      console.warn(
        `[updatePostRankMathMeta] wp/v2 attempt ${i + 1} returned ${res.status} but Rank Math fields were not readable back`
      );
      continue;
    }
    console.warn(`[updatePostRankMathMeta] wp/v2 attempt ${i + 1} failed: ${res.status} ${text.slice(0, 400)}`);
  }

  console.warn(
    "[updatePostRankMathMeta] Rank Math fields not persisted. Ensure /wp-json/rankmath/v1/updateMeta is allowed through Cloudflare/WAF."
  );
  return false;
}
