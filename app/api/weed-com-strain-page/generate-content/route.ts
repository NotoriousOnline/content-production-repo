import { postStrainPageGenerate } from "@/lib/contentProduction/strainPageGenerate";

export async function POST(request: Request) {
  return postStrainPageGenerate(request);
}
