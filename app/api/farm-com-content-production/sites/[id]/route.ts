import { WP_TOOL_SCOPE } from "@/lib/wpSites";
import { handleSiteDELETE, handleSitePUT } from "@/lib/contentProduction/wpSiteByIdRoutes";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleSiteDELETE(id, WP_TOOL_SCOPE.farmComContentProduction);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleSitePUT(request, id, WP_TOOL_SCOPE.farmComContentProduction);
}
