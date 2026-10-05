import { postExtractKeywords } from "@/lib/contentProduction/extractKeywordsPost";
import { WP_TOOL_SCOPE } from "@/lib/wpSites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return postExtractKeywords(request, WP_TOOL_SCOPE.contentProduction);
}
