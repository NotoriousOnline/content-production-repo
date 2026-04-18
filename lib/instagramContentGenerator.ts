import { callClaude } from "@/lib/anthropic";

const SYSTEM_PROMPT = `You are a social media creative director for green.org, an authoritative
sustainability platform. Your outputs are sharp, punchy, and visually driven.`;

function buildUserPrompt(title: string, excerpt: string | undefined): string {
  const excerptLine =
    excerpt != null && excerpt.trim().length > 0 ? excerpt.trim() : "Not provided";

  return `Given this article, generate three things:

1. SHORT TITLE: A 3-6 word punchy headline for an Instagram image overlay.
   Uppercase. Impactful. Max 6 words. Can end with !
   Example: 'Hainan Province leads China's clean energy transition'
   → 'HAINAN LEADS CHINA'S CLEAN FUTURE CHARGE!'

2. INSTAGRAM CAPTION: 100-150 words. Hook first line. 2-3 short paragraphs.
   End with 3-5 relevant hashtags on a new line. Do NOT include any URL.

3. BACKGROUND IMAGE PROMPT: A photorealistic Gemini image generation prompt
   DIRECTLY and SPECIFICALLY about the article topic. Name the exact location,
   technology, or environment from the title. No text, no logos, no faces.
   Cinematic lighting (golden hour, sunrise, dramatic sky). 40-60 words.

   Examples:
   Title: 'Hainan leads China's clean energy future'
   → 'Aerial view of Hainan Island coastline at golden hour with offshore
      wind turbines and solar panel arrays, lush tropical greenery, cinematic
      wide shot, photorealistic'

   Title: 'Ocean plastic pollution reaches record levels'
   → 'Wide angle underwater shot looking up at ocean surface with plastic
      debris floating above, deep blue water, dramatic light rays,
      photorealistic'

Article title: ${title}
Excerpt: ${excerptLine}

Return ONLY valid JSON, no markdown, no explanation:
{
  "shortTitle": "...",
  "caption": "...",
  "backgroundPrompt": "..."
}`;
}

function stripJsonCodeFences(text: string): string {
  let s = text.trim();
  if (s.startsWith("```")) {
    const nl = s.indexOf("\n");
    if (nl !== -1) {
      s = s.slice(nl + 1);
    } else {
      s = s.replace(/^```\w*\s*/, "");
    }
  }
  s = s.trimEnd();
  if (s.endsWith("```")) {
    s = s.slice(0, s.lastIndexOf("```")).trimEnd();
  }
  return s.trim();
}

function parseJsonPayload(raw: string): unknown {
  const cleaned = stripJsonCodeFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function firstWordsUppercased(title: string, maxWords: number): string {
  const words = title
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);
  return words.join(" ").toUpperCase();
}

function fallbackCaption(title: string): string {
  const t = title.trim();
  return `${t}

#Sustainability #ClimateAction #CleanEnergy #GreenOrg #Environment`;
}

function titleKeywordsForPrompt(title: string, max: number): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .filter((w, i, a) => a.indexOf(w) === i)
    .slice(0, max);
  return words.length > 0 ? words.join(", ") : "sustainability and climate";
}

function fallbackBackgroundPrompt(title: string): string {
  const themes = titleKeywordsForPrompt(title, 6);
  return `Photorealistic wide establishing shot of renewable energy and thriving natural landscape at golden hour, wind turbines or solar arrays on horizon, lush vegetation, dramatic sky with warm light rays, cinematic depth, no people, no text, no logos, no faces, editorial environmental mood, themes: ${themes}.`;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export async function generateInstagramContent({
  title,
  excerpt,
}: {
  title: string;
  excerpt?: string;
}): Promise<{ shortTitle: string; caption: string; backgroundPrompt: string }> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return {
      shortTitle: "GREEN.ORG",
      caption: fallbackCaption("Green.org"),
      backgroundPrompt: fallbackBackgroundPrompt("sustainability"),
    };
  }

  const userMessage = buildUserPrompt(trimmedTitle, excerpt);

  const raw = await callClaude(SYSTEM_PROMPT, userMessage, { maxTokens: 2048 });

  const parsed = parseJsonPayload(raw);
  if (!parsed || typeof parsed !== "object") {
    return {
      shortTitle: firstWordsUppercased(trimmedTitle, 6),
      caption: fallbackCaption(trimmedTitle),
      backgroundPrompt: fallbackBackgroundPrompt(trimmedTitle),
    };
  }

  const o = parsed as Record<string, unknown>;
  const shortTitle = o.shortTitle;
  const caption = o.caption;
  const backgroundPrompt = o.backgroundPrompt;

  if (!isNonEmptyString(shortTitle) || !isNonEmptyString(caption) || !isNonEmptyString(backgroundPrompt)) {
    return {
      shortTitle: firstWordsUppercased(trimmedTitle, 6),
      caption: fallbackCaption(trimmedTitle),
      backgroundPrompt: fallbackBackgroundPrompt(trimmedTitle),
    };
  }

  return {
    shortTitle: shortTitle.trim(),
    caption: caption.trim(),
    backgroundPrompt: backgroundPrompt.trim(),
  };
}
