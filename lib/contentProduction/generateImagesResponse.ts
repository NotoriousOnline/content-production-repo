export type GenerateImagesResponse = {
  images: GeneratedImageApiItem[];
  warnings?: string[];
  imageBriefSource?: "claude" | "deterministic";
};

export type GeneratedImageApiItem = {
  type: "featured" | "in-content";
  index: number;
  prompt: string;
  base64: string;
  mimeType: string;
  altText: string;
  fileSlug: string;
  h2Index?: number;
  sectionHeading?: string;
};

/** Normalize legacy array responses and new `{ images, warnings }` payloads. */
export function parseGenerateImagesResponse(data: unknown): {
  images: GeneratedImageApiItem[];
  warnings: string[];
  imageBriefSource?: "claude" | "deterministic";
} {
  if (Array.isArray(data)) {
    return { images: data as GeneratedImageApiItem[], warnings: [] };
  }
  if (data && typeof data === "object") {
    const d = data as {
      images?: GeneratedImageApiItem[];
      warnings?: string[];
      imageBriefSource?: "claude" | "deterministic";
      error?: string;
    };
    if (Array.isArray(d.images)) {
      return {
        images: d.images,
        warnings: d.warnings ?? [],
        imageBriefSource: d.imageBriefSource,
      };
    }
  }
  return { images: [], warnings: [] };
}
