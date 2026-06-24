import { postPublishUploadImage } from "@/lib/contentProduction/publishUploadImage";
import { WP_TOOL_SCOPE } from "@/lib/wpSites";

export const maxDuration = 60;

export async function POST(request: Request) {
  return postPublishUploadImage(request, WP_TOOL_SCOPE.weedComContentProduction);
}
