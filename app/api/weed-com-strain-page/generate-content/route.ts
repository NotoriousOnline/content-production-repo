import { postStrainPageGenerate } from "@/lib/contentProduction/strainPageGenerate";

export const maxDuration = 300;

export async function POST(request: Request) {
  return postStrainPageGenerate(request);
}
