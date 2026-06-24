import { NextResponse } from "next/server";
import { proposeRankMathSeoForWeedPost } from "@/lib/contentProduction/rankMathSeo";
import { errorMessage, serverLog } from "@/lib/serverLog";
import {
  enrichResolvedPostContent,
  explainPostLookupFailure,
  getPostRankMathFields,
  resolvePostById,
  resolvePostByPublicUrl,
  updatePostRankMathMeta,
} from "@/lib/wordpressClient";
import { getSiteById, WP_TOOL_SCOPE } from "@/lib/wpSites";

export async function postRankMathUpdateByUrl(request: Request) {
  try {
    const body = await request.json();
    const { siteId, url, postId, apply } = body as {
      siteId?: string;
      url?: string;
      postId?: number | string;
      apply?: boolean;
    };

    const numericPostId =
      postId != null && postId !== "" ? Number(postId) : Number.NaN;
    const hasPostId = Number.isFinite(numericPostId) && numericPostId > 0;
    const publicUrl = typeof url === "string" ? url.trim() : "";

    if (!siteId || (!hasPostId && !publicUrl)) {
      return NextResponse.json(
        { error: "Missing required fields: siteId and either url or postId" },
        { status: 400 }
      );
    }

    const site = await getSiteById(siteId, WP_TOOL_SCOPE.weedComContentProduction);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    let resolved = hasPostId
      ? await resolvePostById(site, numericPostId)
      : await resolvePostByPublicUrl(site, publicUrl);
    if (!resolved) {
      const detail = await explainPostLookupFailure(site, hasPostId ? { postId: numericPostId } : {});
      return NextResponse.json(
        {
          error: hasPostId
            ? `Could not load post ID ${numericPostId}. ${detail}`
            : `Could not resolve URL. ${detail}`,
        },
        { status: 502 }
      );
    }

    resolved = await enrichResolvedPostContent(site, resolved);

    const current = await getPostRankMathFields(site, resolved.id, resolved.restCollection);
    const proposed = await proposeRankMathSeoForWeedPost({
      title: resolved.title,
      url: resolved.link || publicUrl || `${site.url.replace(/\/$/, "")}/?p=${resolved.id}`,
      excerptPlain: resolved.excerptPlain,
      contentPlain: resolved.contentPlain,
    });

    let applied = false;
    let persistOk: boolean | undefined;
    let currentAfterApply = current;

    if (apply === true) {
      persistOk = await updatePostRankMathMeta(
        site,
        resolved.id,
        {
          focuskw: proposed.focusKeyword,
          metadesc: proposed.metaDescription,
        },
        { restCollection: resolved.restCollection }
      );
      applied = true;
      if (persistOk) {
        try {
          currentAfterApply = await getPostRankMathFields(site, resolved.id, resolved.restCollection);
        } catch {
          /* read-back optional */
        }
      }
    }

    const setupHint =
      apply === true && persistOk === false
        ? "Rank Math meta may not be writable via REST on this site. Install wordpress/mu-plugins/weed-com-rank-math-rest.php into wp-content/mu-plugins/ on weed.com, enable Rank Math → Settings → General → REST API, and allowlist /wp-json/rankmath/v1/updateMetaBulk through Cloudflare/WAF."
        : undefined;

    return NextResponse.json({
      applied,
      persistOk,
      setupHint,
      verified:
        apply === true && persistOk === true
          ? currentAfterApply.focusKeyword === proposed.focusKeyword &&
            currentAfterApply.metaDescription === proposed.metaDescription
          : undefined,
      post: {
        id: resolved.id,
        title: resolved.title,
        link: resolved.link,
        slug: resolved.slug,
        restCollection: resolved.restCollection,
        editUrl: `${site.url.replace(/\/$/, "")}/wp-admin/post.php?post=${resolved.id}&action=edit`,
      },
      current: {
        focusKeyword: (applied ? currentAfterApply : current).focusKeyword,
        metaDescription: (applied ? currentAfterApply : current).metaDescription,
      },
      proposed: {
        focusKeyword: proposed.focusKeyword,
        metaDescription: proposed.metaDescription,
      },
    });
  } catch (err) {
    const msg = errorMessage(err);
    console.error("[rank-math-update] Error:", msg);
    void serverLog({ level: "error", source: "weed-com-rank-math/update", message: msg });
    return NextResponse.json({ error: msg || "Failed to update Rank Math meta" }, { status: 500 });
  }
}
