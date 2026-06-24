import { postStrainPagePublish } from "@/lib/contentProduction/strainPagePublish";

export const maxDuration = 120;

export async function POST(request: Request) {
  return postStrainPagePublish(request);
}
