import { postShopifyPublishUploadImage } from "@/lib/contentProduction/shopifyPublishUploadImage";
import { WP_TOOL_SCOPE } from "@/lib/wpSites";

export const maxDuration = 120;

export async function POST(request: Request) {
  return postShopifyPublishUploadImage(request, WP_TOOL_SCOPE.farmComContentProduction);
}
