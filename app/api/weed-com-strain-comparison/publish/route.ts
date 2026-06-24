import { postStrainComparisonPublish } from "@/lib/contentProduction/strainComparisonPublish";

export async function POST(request: Request) {
  return postStrainComparisonPublish(request);
}
