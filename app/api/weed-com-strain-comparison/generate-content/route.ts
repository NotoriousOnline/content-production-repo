import { postStrainComparisonGenerate } from "@/lib/contentProduction/strainComparisonGenerate";

export async function POST(request: Request) {
  return postStrainComparisonGenerate(request);
}
