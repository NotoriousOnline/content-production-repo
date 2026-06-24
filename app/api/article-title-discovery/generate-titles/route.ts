import { NextResponse } from "next/server";
import { generateDiscoveryTitles } from "@/lib/articleDiscoveryGenerateTitles";

export async function POST(request: Request) {
  let body: { articles?: { title: string; url: string; source: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const articles = Array.isArray(body.articles) ? body.articles : [];
  if (articles.length === 0) {
    return NextResponse.json(
      { error: "articles array is required and must not be empty" },
      { status: 400 }
    );
  }

  const outcome = await generateDiscoveryTitles(articles);

  if (outcome.results.length === 0) {
    return NextResponse.json(
      {
        error: outcome.error ?? "No titles could be generated",
        provider: outcome.provider,
        results: [],
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    results: outcome.results,
    provider: outcome.provider,
    ...(outcome.warning ? { warning: outcome.warning } : {}),
  });
}
