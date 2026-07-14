import { WP_TOOL_SCOPE } from "@/lib/wpSites";
import { handleSitesGET, handleSitesPOST } from "@/lib/contentProduction/wpSitesRoutes";

export async function GET() {
  return handleSitesGET(WP_TOOL_SCOPE.farmComContentProduction);
}

export async function POST(request: Request) {
  return handleSitesPOST(request, WP_TOOL_SCOPE.farmComContentProduction);
}
