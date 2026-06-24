import { callClaude, isAnthropicBillingError } from "@/lib/anthropic";

const SYSTEM_PROMPT =
  "You are a content strategist for green.org, an environmental news and lifestyle website. Your job is to take inspiration from existing environmental news articles and suggest a fresh, engaging article title that would perform well on green.org. The title should feel original — not a rewrite — but inspired by the same topic or angle.";

export type TitleDiscoveryInputArticle = { title: string; url: string; source: string };

export type TitleDiscoveryOutputItem = {
  suggested_title: string;
  source_title: string;
  source_url: string;
  source_name: string;
};

function buildUserPrompt(title: string, url: string): string {
  return `Source article: ${title}
Source URL: ${url}

Suggest one compelling article title for green.org inspired by this topic. Return ONLY a JSON object in this exact format:
{ "suggested_title": "Your Title Here" }`;
}

function parseSuggestedTitle(content: string): string | null {
  const jsonStr = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(jsonStr) as { suggested_title?: string };
  const suggestedTitle = parsed?.suggested_title;
  if (typeof suggestedTitle !== "string" || !suggestedTitle.trim()) return null;
  return suggestedTitle.trim();
}

function isOpenAIQuotaError(status: number, body: string): boolean {
  if (status !== 429) return false;
  const lower = body.toLowerCase();
  return lower.includes("insufficient_quota") || lower.includes("exceeded your current quota");
}

async function generateWithOpenAI(
  apiKey: string,
  article: TitleDiscoveryInputArticle
): Promise<{ title: string | null; quotaExceeded: boolean }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(article.title, article.url) },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[generate-titles] OpenAI API error for "${article.title}":`, res.status, errText.slice(0, 300));
    return { title: null, quotaExceeded: isOpenAIQuotaError(res.status, errText) };
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) return { title: null, quotaExceeded: false };

  try {
    return { title: parseSuggestedTitle(content), quotaExceeded: false };
  } catch {
    console.error(`[generate-titles] OpenAI JSON parse failed for "${article.title}":`, content.slice(0, 200));
    return { title: null, quotaExceeded: false };
  }
}

async function generateWithClaude(article: TitleDiscoveryInputArticle): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;
  try {
    const raw = await callClaude(SYSTEM_PROMPT, buildUserPrompt(article.title, article.url), {
      maxTokens: 256,
    });
    return parseSuggestedTitle(raw);
  } catch (err) {
    if (isAnthropicBillingError(err)) {
      console.error("[generate-titles] Claude billing error — cannot generate titles");
    } else {
      console.error(`[generate-titles] Claude failed for "${article.title}":`, err);
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type GenerateDiscoveryTitlesResult = {
  results: TitleDiscoveryOutputItem[];
  provider: "openai" | "claude" | "none";
  warning?: string;
  error?: string;
};

/** Generate green.org title ideas — OpenAI first, Claude fallback on quota/billing errors. */
export async function generateDiscoveryTitles(
  articles: TitleDiscoveryInputArticle[]
): Promise<GenerateDiscoveryTitlesResult> {
  if (articles.length === 0) {
    return { results: [], provider: "none" };
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const results: TitleDiscoveryOutputItem[] = [];
  let useClaude = !openaiKey;
  let openaiQuotaHit = false;

  if (!openaiKey && !hasClaude) {
    return {
      results: [],
      provider: "none",
      error: "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env.local.",
    };
  }

  if (!openaiKey && hasClaude) {
    useClaude = true;
  }

  for (let i = 0; i < articles.length; i++) {
    if (i > 0) await sleep(300);
    const article = articles[i];
    let suggested: string | null = null;

    if (!useClaude && openaiKey) {
      const { title, quotaExceeded } = await generateWithOpenAI(openaiKey, article);
      if (quotaExceeded) {
        openaiQuotaHit = true;
        useClaude = hasClaude;
        if (useClaude) {
          suggested = await generateWithClaude(article);
        }
      } else {
        suggested = title;
      }
    } else if (useClaude) {
      suggested = await generateWithClaude(article);
    }

    if (suggested) {
      results.push({
        suggested_title: suggested,
        source_title: article.title,
        source_url: article.url,
        source_name: article.source,
      });
    }
  }

  if (results.length === 0) {
    if (openaiQuotaHit && !hasClaude) {
      return {
        results: [],
        provider: "none",
        error:
          "OpenAI quota exceeded. Add credits at platform.openai.com or set ANTHROPIC_API_KEY for Claude fallback.",
      };
    }
    if (openaiQuotaHit && hasClaude) {
      return {
        results: [],
        provider: "claude",
        error: "OpenAI quota exceeded and Claude could not generate titles. Check ANTHROPIC_API_KEY and billing.",
      };
    }
    return {
      results: [],
      provider: useClaude ? "claude" : "openai",
      error: "Title generation failed for all articles. Check API keys and billing.",
    };
  }

  const provider = useClaude ? "claude" : "openai";
  const warning = openaiQuotaHit
    ? "OpenAI quota exceeded — remaining titles used Claude (Anthropic)."
    : undefined;

  return { results, provider, warning };
}
