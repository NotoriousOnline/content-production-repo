import { postGenerateImages } from "@/lib/contentProduction/generateImagesPost";
import { WP_TOOL_SCOPE } from "@/lib/wpSites";

export async function POST(request: Request) {
  const body = await request.json();
  const wrapped = new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      strainPage: true,
      maxInContentImages: body.maxInContentImages ?? 1,
    }),
  });
  return postGenerateImages(wrapped, WP_TOOL_SCOPE.weedComContentProduction);
}
