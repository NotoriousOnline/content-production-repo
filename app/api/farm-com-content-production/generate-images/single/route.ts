import { postGenerateImageSingle } from "@/lib/contentProduction/generateImageSinglePost";
import { WP_TOOL_SCOPE } from "@/lib/wpSites";

export const maxDuration = 120;

export async function POST(request: Request) {
  return postGenerateImageSingle(request, WP_TOOL_SCOPE.farmComContentProduction);
}
