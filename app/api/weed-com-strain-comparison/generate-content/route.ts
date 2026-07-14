import { postStrainComparisonGenerate } from "@/lib/contentProduction/strainComparisonGenerate";

export const maxDuration = 300;

export async function POST(request: Request) {
  return postStrainComparisonGenerate(request);
}
