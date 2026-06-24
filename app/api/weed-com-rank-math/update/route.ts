import { postRankMathUpdateByUrl } from "@/lib/contentProduction/rankMathUpdateByUrl";

export async function POST(request: Request) {
  return postRankMathUpdateByUrl(request);
}
