import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  fetchHighVolumeKeywordsForArticle,
  mergeKeywordLists,
} from "@/lib/contentProduction/ahrefsHighVolumeKeywords";
import { errorMessage, serverLog } from "@/lib/serverLog";
import { WP_TOOL_SCOPE, type WPToolScope } from "@/lib/wpSites";

function extractJsonObject(text: string): unknown {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) cleaned = objMatch[0];
  cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(cleaned);
}

function parseKeywordsFromModelText(text: string): string[] {
  const parsed = extractJsonObject(text) as unknown;
  if (!parsed || typeof parsed !== "object" || !("keywords" in parsed)) {
    throw new Error("Invalid response shape");
  }
  const arr = (parsed as { keywords: unknown }).keywords;
  if (!Array.isArray(arr)) throw new Error("keywords must be an array");
  return arr
    .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    .map((k) => k.trim())
    .slice(0, 18);
}

function ensureWordPressHighIntentPhrases(keywords: string[], title: string): string[] {
  const out = [...keywords];
  const wpCount = () => out.filter((k) => /\bwordpress\b/i.test(k)).length;
  const hasExact = (s: string) => out.some((k) => k.toLowerCase() === s.toLowerCase());

  const titleSnippet = title
    .replace(/\bwordpress\b/gi, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ")
    .slice(0, 50);

  const candidates: string[] = [];
  if (titleSnippet.length > 2) {
    candidates.push(`WordPress ${titleSnippet}`.replace(/\s+/g, " ").trim().slice(0, 72));
    candidates.push(`WordPress guide ${titleSnippet}`.replace(/\s+/g, " ").trim().slice(0, 72));
  }
  candidates.push("WordPress SEO tips", "WordPress website content");

  for (const c of candidates) {
    if (wpCount() >= 2) break;
    if (c.length < 8) continue;
    if (!hasExact(c)) out.push(c);
  }

  return out.slice(0, 18);
}

export async function postExtractKeywords(request: Request, toolScope: WPToolScope) {
  try {
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    const safeTitle = title.slice(0, 400);
    const existingKeywords = Array.isArray(body.keywords)
      ? (body.keywords as unknown[])
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];

    const ahrefsKey = process.env.AHREFS_API_KEY?.trim() ?? "";
    let ahrefsKeywords: string[] = [];
    let ahrefsError: string | undefined;
    let ahrefsMergedCount = 0;
    let ahrefsCountry: string | null = ahrefsKey ? (process.env.AHREFS_KEYWORD_COUNTRY ?? "us").trim().toLowerCase().slice(0, 2) || "us" : null;
    let ahrefsTerms: { keyword: string; volume: number | null }[] = [];
    let ahrefsSeed: string | null = null;

    if (ahrefsKey) {
      const ahrefsResult = await fetchHighVolumeKeywordsForArticle({
        title: safeTitle,
        existingKeywords,
      });
      ahrefsCountry = ahrefsResult.country;
      ahrefsSeed = ahrefsResult.seedUsed;
      if (ahrefsResult.ok) {
        ahrefsTerms = ahrefsResult.terms;
        ahrefsKeywords = ahrefsTerms.map((r) => r.keyword);
        ahrefsMergedCount = ahrefsKeywords.length;
      } else {
        ahrefsError = ahrefsResult.error;
        console.warn(
          "[extract-keywords] Ahrefs:",
          ahrefsError,
          "seed=",
          ahrefsResult.seedUsed,
          "country=",
          ahrefsResult.country
        );
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not set in .env.local (server restart required after editing)." },
        { status: 503 }
      );
    }

    const ahrefsContext =
      ahrefsKeywords.length > 0
        ? `\n\nThese high-volume matching terms already came from Ahrefs (do not repeat them verbatim; add complementary phrases): ${ahrefsKeywords.join(", ")}`
        : "";

    const isWeed = toolScope === WP_TOOL_SCOPE.weedComContentProduction;

    const systemWeed =
      "You respond with JSON only, no markdown fences or commentary. Keywords must be realistic SEO phrases (1–6 words) for cannabis education and culture content: mix head terms, mid-tail, strain or product categories where relevant, and informational variants (how-to, effects, laws, safety, consumption basics). Avoid keyword stuffing; stay factual and brand-safe. No medical claims as search terms.";

    const systemDefault =
      "You respond with JSON only, no markdown fences or commentary. Keywords must be realistic SEO phrases (1–6 words): mix head terms, mid-tail, and variants aligned with the title. Always include 1-2 phrases that contain the exact word WordPress (any casing in JSON strings use Title Case or lowercase consistently). Those WordPress phrases should read like high search-volume queries: how-to, best, guide, tips, website, blog, SEO, plugins, themes, performance, or security, tied to the article angle when possible.";

    const userWeed = `Article title: "${safeTitle.replace(/"/g, '\\"')}"${ahrefsContext}

Return JSON only in this exact shape:
{"keywords": ["keyword one", "keyword two", ...]}

Include 8–12 distinct phrases total (fewer overlaps if Ahrefs terms were listed above). Phrases should align with cannabis editorial and SEO intent for this title.`; 

    const userDefault = `Article title: "${safeTitle.replace(/"/g, '\\"')}"${ahrefsContext}

Return JSON only in this exact shape:
{"keywords": ["keyword one", "keyword two", ...]}

Include 8–12 distinct phrases total (fewer overlaps if Ahrefs terms were listed above). At least 1 and at most 2 entries must be WordPress-focused high-intent phrases (must include the word "WordPress") that could plausibly have strong search demand together with this topic.`;

    const client = new Anthropic({ apiKey });
    let response;
    try {
      response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: isWeed ? systemWeed : systemDefault,
        messages: [
          {
            role: "user",
            content: isWeed ? userWeed : userDefault,
          },
        ],
      });
    } catch (apiErr: unknown) {
      const e = apiErr as { status?: number; message?: string; error?: { message?: string } };
      const detail = e.error?.message ?? e.message ?? String(apiErr);
      console.error("[extract-keywords] Anthropic:", e.status, detail);
      if (ahrefsKeywords.length > 0) {
        return NextResponse.json({
          keywords: isWeed ? ahrefsKeywords : ensureWordPressHighIntentPhrases(ahrefsKeywords, safeTitle),
          sources: {
            ahrefs: {
              enabled: true,
              mergedCount: ahrefsMergedCount,
              error: ahrefsError ?? null,
              country: ahrefsCountry,
              seed: ahrefsSeed,
              terms: ahrefsTerms,
            },
          },
        });
      }
      return NextResponse.json(
        {
          error:
            e.status === 401
              ? "Anthropic API key rejected. Check ANTHROPIC_API_KEY in .env.local."
              : `Claude request failed (${e.status ?? "?"}): ${detail}`,
        },
        { status: 502 }
      );
    }

    const first = response.content[0];
    const text = first?.type === "text" ? first.text : "";
    if (!text) {
      return NextResponse.json({ error: "Empty model response" }, { status: 500 });
    }

    let claudeKeywords: string[];
    try {
      claudeKeywords = parseKeywordsFromModelText(text);
    } catch (parseErr) {
      console.error("[extract-keywords] Parse error:", parseErr, "Raw:", text.slice(0, 500));
      if (ahrefsKeywords.length > 0) {
        return NextResponse.json({
          keywords: isWeed ? ahrefsKeywords : ensureWordPressHighIntentPhrases(ahrefsKeywords, safeTitle),
          sources: {
            ahrefs: {
              enabled: true,
              mergedCount: ahrefsMergedCount,
              error: ahrefsError ?? null,
              country: ahrefsCountry,
              seed: ahrefsSeed,
              terms: ahrefsTerms,
            },
          },
        });
      }
      return NextResponse.json(
        { error: "Could not parse keywords from the model. Try again." },
        { status: 500 }
      );
    }

    if (claudeKeywords.length === 0 && ahrefsKeywords.length === 0) {
      return NextResponse.json({ error: "No keywords returned" }, { status: 500 });
    }

    let keywords = mergeKeywordLists(ahrefsKeywords, claudeKeywords, 22);
    if (keywords.length === 0) {
      keywords = [...ahrefsKeywords, ...claudeKeywords];
    }
    if (!isWeed) {
      keywords = ensureWordPressHighIntentPhrases(keywords, safeTitle);
    }

    return NextResponse.json({
      keywords,
      sources: {
        ahrefs: {
          enabled: Boolean(ahrefsKey),
          mergedCount: ahrefsMergedCount,
          error: ahrefsError ?? null,
          country: ahrefsKey ? ahrefsCountry : null,
          seed: ahrefsSeed,
          terms: ahrefsTerms,
        },
      },
    });
  } catch (err) {
    const msg = errorMessage(err);
    console.error("[extract-keywords]", msg);
    void serverLog({ level: "error", source: "content-production/extract-keywords", message: msg });
    return NextResponse.json({ error: msg || "Failed to extract keywords" }, { status: 500 });
  }
}
