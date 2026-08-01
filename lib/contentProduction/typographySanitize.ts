/**
 * Strip em dashes and spaced-hyphen pauses ("word - word") from generated tool content.
 * Prefer commas for asides; keep tight hyphens in compounds/ranges (e.g. THC-A, 21+).
 */
export function sanitizeContentDashes(text: string): string {
  return text
    .replace(/\s*\u2014\s*/g, ", ")
    .replace(/\u2013/g, "-")
    .replace(/([A-Za-z0-9)])\s+-\s+([A-Za-z(])/g, "$1, $2")
    .replace(/,\s*,+/g, ",")
    .replace(/,\s{2,}/g, ", ");
}

/** Prompt line shared by content generators. */
export const NO_DASH_PAUSE_TYPOGRAPHY =
  'Never use the em dash (Unicode U+2014) or a spaced hyphen " - " as a pause or aside. Use commas, semicolons, or parentheses instead.';
