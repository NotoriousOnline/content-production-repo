import { postShopifyPublish } from "@/lib/contentProduction/shopifyPublishPost";
import { WP_TOOL_SCOPE } from "@/lib/wpSites";

export const maxDuration = 120;

export async function POST(request: Request) {
  return postShopifyPublish(request, WP_TOOL_SCOPE.farmComContentProduction);
}
