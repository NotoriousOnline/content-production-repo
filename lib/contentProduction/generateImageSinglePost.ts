import { NextResponse } from "next/server";
import { generateImage, httpStatusForImageGenerationError } from "@/lib/geminiClient";
import { isPrefabSite } from "@/lib/contentProduction/greenOrgCategoryPicker";
import { errorMessage, serverLog } from "@/lib/serverLog";
import { getSiteById, type WPToolScope } from "@/lib/wpSites";

export async function postGenerateImageSingle(request: Request, toolScope: WPToolScope) {
  try {
    const body = await request.json();
    const { prompt, siteId } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid field: prompt (string)" },
        { status: 400 }
      );
    }

    const site =
      typeof siteId === "string" && siteId.trim().length > 0 ? await getSiteById(siteId, toolScope) : null;
    const prefabSite = site != null && isPrefabSite(site);
    const landscapeHint = prefabSite
      ? "\n\nLandscape, but not extra-wide. Keep a balanced frame around 1200x850 feel (roughly 4:3-ish), with subject filling the scene."
      : "\n\nWide horizontal landscape (not square). Fill the frame edge-to-edge — no large empty sky or white bands above/below the subject.";
    const { base64, mimeType } = await generateImage(
      /\b(landscape|horizontal|16:9|2:1|fill the frame)\b/i.test(prompt) ? prompt : `${prompt.trim()}${landscapeHint}`,
      { aspectRatio: prefabSite ? "4:3" : "16:9" }
    );
    return NextResponse.json({ base64, mimeType });
  } catch (err) {
    const msg = errorMessage(err);
    console.error("[generate-images/single] Error:", msg);
    void serverLog({ level: "error", source: "content-production/generate-image-single", message: msg });
    const status = httpStatusForImageGenerationError(err);
    return NextResponse.json({ error: msg || "Failed to generate image" }, { status });
  }
}
