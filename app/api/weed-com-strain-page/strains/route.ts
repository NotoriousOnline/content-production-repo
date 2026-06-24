import { getStrainPageList } from "@/lib/contentProduction/strainPageList";

export async function GET(request: Request) {
  return getStrainPageList(request);
}
