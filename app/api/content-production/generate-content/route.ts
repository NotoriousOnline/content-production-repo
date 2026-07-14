import { postGenerateContent } from "@/lib/contentProduction/generateContentPost";
import { WP_TOOL_SCOPE } from "@/lib/wpSites";

export const maxDuration = 300;

export async function POST(request: Request) {
  return postGenerateContent(request, WP_TOOL_SCOPE.contentProduction);
}
