/**
 * Shopify Admin GraphQL helpers for Farm.com blog publishing.
 * Site credentials are stored in wp_sites for farm-com-content-production scope:
 * - url: https://store.myshopify.com
 * - username: numeric Blog ID
 * - app_password: Admin API access token
 */

export type ShopifySiteCreds = {
  url: string;
  username: string;
  app_password: string;
};

const SHOPIFY_API_VERSION = "2024-10";

export function normalizeShopifyShopHost(urlOrHost: string): string {
  let s = (urlOrHost ?? "").trim().replace(/\/+$/, "");
  s = s.replace(/^https?:\/\//i, "");
  s = s.split("/")[0] ?? s;
  return s.toLowerCase();
}

export function shopifyAdminGraphqlUrl(shopHost: string): string {
  const host = normalizeShopifyShopHost(shopHost);
  return `https://${host}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
}

export function blogGidFromId(blogId: string | number): string {
  const raw = String(blogId).trim();
  if (raw.startsWith("gid://")) return raw;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid Shopify Blog ID: ${raw}. Use the numeric ID from Online Store → Blog.`);
  }
  return `gid://shopify/Blog/${raw}`;
}

export function articleGidFromId(articleId: string | number): string {
  const raw = String(articleId).trim();
  if (raw.startsWith("gid://")) return raw;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid Shopify Article ID: ${raw}`);
  }
  return `gid://shopify/Article/${raw}`;
}

export function numericIdFromGid(gid: string): number {
  const m = /\/(\d+)\s*$/.exec(gid.trim());
  if (!m) throw new Error(`Could not parse numeric id from Shopify GID: ${gid}`);
  return parseInt(m[1], 10);
}

type GraphqlError = { message?: string };

type GraphqlEnvelope<T> = {
  data?: T;
  errors?: GraphqlError[];
};

export async function shopifyGraphql<T>(
  site: ShopifySiteCreds,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const host = normalizeShopifyShopHost(site.url);
  const token = (site.app_password ?? "").replace(/\s+/g, "").trim();
  if (!host || !token) {
    throw new Error("Missing Shopify shop host or Admin API access token.");
  }

  const res = await fetch(shopifyAdminGraphqlUrl(host), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json: GraphqlEnvelope<T>;
  try {
    json = JSON.parse(text) as GraphqlEnvelope<T>;
  } catch {
    throw new Error(
      `Shopify GraphQL returned non-JSON (HTTP ${res.status}): ${text.slice(0, 280)}`
    );
  }

  if (!res.ok) {
    const top = json.errors?.map((e) => e.message).filter(Boolean).join("; ");
    throw new Error(top || `Shopify GraphQL HTTP ${res.status}: ${text.slice(0, 280)}`);
  }

  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message ?? "Unknown GraphQL error").join("; "));
  }

  if (!json.data) {
    throw new Error("Shopify GraphQL returned empty data.");
  }

  return json.data;
}

export async function testShopifyConnection(
  url: string,
  blogId: string,
  accessToken: string
): Promise<{ ok: boolean; detail?: string; shopName?: string }> {
  try {
    const site: ShopifySiteCreds = { url, username: blogId, app_password: accessToken };
    const data = await shopifyGraphql<{
      shop: { name: string };
      blog: { id: string; title: string } | null;
    }>(
      site,
      `query TestShopify($blogId: ID!) {
        shop { name }
        blog(id: $blogId) { id title }
      }`,
      { blogId: blogGidFromId(blogId) }
    );

    if (!data.blog?.id) {
      return {
        ok: false,
        detail: `Shop connected (${data.shop?.name ?? "ok"}) but Blog ID ${blogId} was not found. Check Online Store → Blog.`,
      };
    }

    return { ok: true, shopName: data.shop?.name, detail: data.blog.title };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Upload an image via staged upload + fileCreate; return CDN URL and numeric file id.
 */
export async function uploadShopifyFile(
  site: ShopifySiteCreds,
  buffer: Buffer,
  filename: string,
  mimeType: string,
  altText?: string
): Promise<{ id: number; url: string; gid: string }> {
  const staged = await shopifyGraphql<{
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }> | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    site,
    `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }`,
    {
      input: [
        {
          filename,
          mimeType,
          httpMethod: "POST",
          resource: "IMAGE",
          fileSize: String(buffer.length),
        },
      ],
    }
  );

  const errs = staged.stagedUploadsCreate.userErrors ?? [];
  if (errs.length) {
    throw new Error(`Shopify staged upload failed: ${errs.map((e) => e.message).join("; ")}`);
  }
  const target = staged.stagedUploadsCreate.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) {
    throw new Error("Shopify stagedUploadsCreate did not return an upload target.");
  }

  const form = new FormData();
  for (const p of target.parameters ?? []) {
    form.append(p.name, p.value);
  }
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);

  const uploadRes = await fetch(target.url, { method: "POST", body: form });
  if (!uploadRes.ok && uploadRes.status !== 201) {
    const t = await uploadRes.text().catch(() => "");
    throw new Error(
      `Shopify file binary upload failed (HTTP ${uploadRes.status}): ${t.slice(0, 280)}`
    );
  }

  const created = await shopifyGraphql<{
    fileCreate: {
      files: Array<{
        id?: string;
        fileStatus?: string;
        alt?: string | null;
      }> | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    site,
    `mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          alt
          ... on MediaImage {
            image { url }
          }
          ... on GenericFile {
            url
          }
        }
        userErrors { field message }
      }
    }`,
    {
      files: [
        {
          alt: altText ?? filename,
          contentType: "IMAGE",
          originalSource: target.resourceUrl,
        },
      ],
    }
  );

  const createErrs = created.fileCreate.userErrors ?? [];
  if (createErrs.length) {
    throw new Error(`Shopify fileCreate failed: ${createErrs.map((e) => e.message).join("; ")}`);
  }

  const file = created.fileCreate.files?.[0];
  if (!file?.id) {
    throw new Error("Shopify fileCreate returned no file id.");
  }

  const { url } = await waitForShopifyFileUrl(site, file.id);
  return { id: numericIdFromGid(file.id), url, gid: file.id };
}

async function waitForShopifyFileUrl(
  site: ShopifySiteCreds,
  fileGid: string
): Promise<{ url: string }> {
  for (let attempt = 0; attempt < 24; attempt++) {
    const data = await shopifyGraphql<{
      node: {
        id: string;
        fileStatus?: string;
        image?: { url?: string | null } | null;
        url?: string | null;
      } | null;
    }>(
      site,
      `query FileStatus($id: ID!) {
        node(id: $id) {
          id
          ... on MediaImage {
            fileStatus
            image { url }
          }
          ... on GenericFile {
            fileStatus
            url
          }
        }
      }`,
      { id: fileGid }
    );

    const node = data.node;
    const status = node?.fileStatus;
    const url = node?.image?.url || node?.url || "";
    if (status === "FAILED") {
      throw new Error("Shopify file processing failed.");
    }
    if (url && (status === "READY" || status === "UPLOADED" || !status)) {
      return { url };
    }
    await sleep(500);
  }
  throw new Error("Timed out waiting for Shopify file CDN URL. Try again in a moment.");
}

export type ShopifyArticleResult = {
  id: number;
  gid: string;
  handle: string;
  postUrl: string;
  editUrl: string;
  status: "draft" | "published";
};

function articleEditUrl(shopHost: string, articleNumericId: number): string {
  const host = normalizeShopifyShopHost(shopHost);
  return `https://${host}/admin/articles/${articleNumericId}`;
}

export async function createShopifyArticle(
  site: ShopifySiteCreds,
  input: {
    title: string;
    bodyHtml: string;
    authorName?: string;
    summary?: string;
    tags?: string[];
    imageUrl?: string;
    imageAlt?: string;
    handle?: string;
  }
): Promise<ShopifyArticleResult> {
  const data = await shopifyGraphql<{
    articleCreate: {
      article: {
        id: string;
        handle: string;
        onlineStoreUrl?: string | null;
        isPublished?: boolean;
      } | null;
      userErrors: Array<{ message: string; field?: string[] }>;
    };
  }>(
    site,
    `mutation CreateArticle($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article {
          id
          handle
          onlineStoreUrl
          isPublished
        }
        userErrors { field message }
      }
    }`,
    {
      article: {
        blogId: blogGidFromId(site.username),
        title: input.title,
        body: input.bodyHtml,
        author: { name: input.authorName?.trim() || "Farm.com" },
        isPublished: false,
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.tags?.length ? { tags: input.tags } : {}),
        ...(input.handle ? { handle: input.handle } : {}),
        ...(input.imageUrl
          ? {
              image: {
                url: input.imageUrl,
                altText: input.imageAlt ?? input.title.slice(0, 125),
              },
            }
          : {}),
      },
    }
  );

  const errs = data.articleCreate.userErrors ?? [];
  if (errs.length) {
    throw new Error(`Shopify articleCreate failed: ${errs.map((e) => e.message).join("; ")}`);
  }
  const article = data.articleCreate.article;
  if (!article?.id) {
    throw new Error("Shopify articleCreate returned no article.");
  }

  const id = numericIdFromGid(article.id);
  return {
    id,
    gid: article.id,
    handle: article.handle,
    postUrl: article.onlineStoreUrl || `https://${normalizeShopifyShopHost(site.url)}/blogs/${article.handle}`,
    editUrl: articleEditUrl(site.url, id),
    status: article.isPublished ? "published" : "draft",
  };
}

export async function updateShopifyArticle(
  site: ShopifySiteCreds,
  articleId: string | number,
  input: {
    title: string;
    bodyHtml: string;
    authorName?: string;
    summary?: string;
    tags?: string[];
    imageUrl?: string;
    imageAlt?: string;
  }
): Promise<ShopifyArticleResult> {
  const gid = articleGidFromId(articleId);
  const data = await shopifyGraphql<{
    articleUpdate: {
      article: {
        id: string;
        handle: string;
        onlineStoreUrl?: string | null;
        isPublished?: boolean;
      } | null;
      userErrors: Array<{ message: string; field?: string[] }>;
    };
  }>(
    site,
    `mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article {
          id
          handle
          onlineStoreUrl
          isPublished
        }
        userErrors { field message }
      }
    }`,
    {
      id: gid,
      article: {
        title: input.title,
        body: input.bodyHtml,
        author: { name: input.authorName?.trim() || "Farm.com" },
        isPublished: false,
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.tags?.length ? { tags: input.tags } : {}),
        ...(input.imageUrl
          ? {
              image: {
                url: input.imageUrl,
                altText: input.imageAlt ?? input.title.slice(0, 125),
              },
            }
          : {}),
      },
    }
  );

  const errs = data.articleUpdate.userErrors ?? [];
  if (errs.length) {
    throw new Error(`Shopify articleUpdate failed: ${errs.map((e) => e.message).join("; ")}`);
  }
  const article = data.articleUpdate.article;
  if (!article?.id) {
    throw new Error("Shopify articleUpdate returned no article.");
  }

  const id = numericIdFromGid(article.id);
  return {
    id,
    gid: article.id,
    handle: article.handle,
    postUrl: article.onlineStoreUrl || `https://${normalizeShopifyShopHost(site.url)}/blogs/${article.handle}`,
    editUrl: articleEditUrl(site.url, id),
    status: article.isPublished ? "published" : "draft",
  };
}
