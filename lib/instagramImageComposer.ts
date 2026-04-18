import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const CANVAS = 1080;
const MAX_LINE_CHARS = 13;
const TITLE_X = 70;
const TITLE_BASE_Y = 700;
const LINE_HEIGHT = 118;
const FONT_SIZE = 105;
const LOGO_TARGET_WIDTH = 200;
/** 1080 - 200 - 55 (spec) */
const LOGO_LEFT = CANVAS - 200 - 55;
const LOGO_MARGIN_BOTTOM = 50;

const GRADIENT_SVG = `<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="35%" stop-color="black" stop-opacity="0"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect width="${CANVAS}" height="${CANVAS}" fill="url(#g)"/>
</svg>`;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lineCharLength(words: string[]): number {
  if (words.length === 0) return 0;
  return words.reduce((len, w, i) => len + w.length + (i > 0 ? 1 : 0), 0);
}

/** Break title into lines of at most `maxChars` characters, preferring word boundaries. */
function breakWordsIntoLines(words: string[], maxChars: number): string[][] {
  const lines: string[][] = [];
  let cur: string[] = [];

  for (const w of words) {
    if (w.length > maxChars) {
      if (cur.length) {
        lines.push(cur);
        cur = [];
      }
      for (let i = 0; i < w.length; i += maxChars) {
        lines.push([w.slice(i, i + maxChars)]);
      }
      continue;
    }
    const tentative = [...cur, w];
    if (lineCharLength(tentative) <= maxChars) {
      cur = tentative;
    } else {
      if (cur.length) lines.push(cur);
      cur = [w];
    }
  }
  if (cur.length) lines.push(cur);
  return lines.length ? lines : [[]];
}

function buildTitleSvgBuffer(lines: string[][], firstGreenWordIndex: number): Buffer {
  const nonEmptyLines = lines.filter((l) => l.length > 0);
  const lineCount = nonEmptyLines.length;
  const startY = TITLE_BASE_Y - Math.max(0, lineCount - 1) * LINE_HEIGHT;

  let globalWord = 0;
  const textBlocks: string[] = [];

  for (let li = 0; li < lineCount; li++) {
    const lineWords = nonEmptyLines[li];
    const y = startY + li * LINE_HEIGHT;
    const tspans: string[] = [];
    for (let wi = 0; wi < lineWords.length; wi++) {
      const w = lineWords[wi];
      const isGreen = globalWord >= firstGreenWordIndex;
      globalWord += 1;
      const fill = isGreen ? "#3DBA6F" : "#FFFFFF";
      const prefix = wi > 0 ? " " : "";
      tspans.push(`<tspan fill="${fill}">${escapeXml(prefix + w)}</tspan>`);
    }
    textBlocks.push(
      `<text xml:space="preserve" x="${TITLE_X}" y="${y}" font-family="Arial Black, Impact, sans-serif" font-size="${FONT_SIZE}" font-weight="900" style="filter: drop-shadow(2px 2px 8px rgba(0,0,0,0.8));">${tspans.join("")}</text>`
    );
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">
  ${textBlocks.join("\n  ")}
</svg>`;
  return Buffer.from(svg, "utf-8");
}

function logoPath(): string {
  return path.join(process.cwd(), "public", "assets", "greenorg-logo.png");
}

/** Sharp requires each overlay ≤ base size; SVG + high DPI can exceed 1080 — normalize to canvas. */
async function overlayFullCanvas(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize(CANVAS, CANVAS, { fit: "cover", position: "center" })
    .png()
    .toBuffer();
}

export async function composeInstagramImage({
  shortTitle,
  backgroundBase64,
  backgroundMimeType,
}: {
  shortTitle: string;
  backgroundBase64: string;
  backgroundMimeType: string;
}): Promise<Buffer> {
  void backgroundMimeType;

  const bgBuffer = Buffer.from(backgroundBase64, "base64");
  const base = sharp(bgBuffer)
    .resize(CANVAS, CANVAS, { fit: "cover", position: "center" })
    .ensureAlpha();

  const gradientBuf = Buffer.from(GRADIENT_SVG, "utf-8");
  const gradientRaster = await overlayFullCanvas(gradientBuf);

  const words = shortTitle.trim().split(/\s+/).filter(Boolean);
  const n = words.length;
  const highlightWordCount = n >= 2 ? 2 : n >= 1 ? 1 : 0;
  const firstGreenWordIndex = highlightWordCount > 0 ? n - highlightWordCount : 0;
  const lines = n > 0 ? breakWordsIntoLines(words, MAX_LINE_CHARS) : [];

  const composite: sharp.OverlayOptions[] = [{ input: gradientRaster, top: 0, left: 0 }];

  if (lines.length > 0 && lines.some((l) => l.length > 0)) {
    const titleSvg = buildTitleSvgBuffer(lines, firstGreenWordIndex);
    const titleRaster = await overlayFullCanvas(titleSvg);
    composite.push({ input: titleRaster, top: 0, left: 0 });
  }

  const logoFile = logoPath();
  await fs.access(logoFile).catch(() => {
    throw new Error(`Green.org logo not found at ${logoFile}. Add public/assets/greenorg-logo.png.`);
  });

  const logoResized = await sharp(logoFile)
    .resize(LOGO_TARGET_WIDTH, LOGO_TARGET_WIDTH, { fit: "inside" })
    .toBuffer();
  const logoMeta = await sharp(logoResized).metadata();
  const logoH = logoMeta.height ?? LOGO_TARGET_WIDTH;
  const logoTop = CANVAS - logoH - LOGO_MARGIN_BOTTOM;

  composite.push({ input: logoResized, left: LOGO_LEFT, top: logoTop });

  return base.composite(composite).png().toBuffer();
}
