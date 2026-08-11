/**
 * Deterministic text-based color name normalization and comparison.
 *
 * Note: color-names.server.ts uses "grey" for pixel analysis (hex-to-name).
 * This normalization is for TEXT comparison only. They are independent layers.
 */

const COLOR_ALIASES: Record<string, string> = {
  grey: "gray",
  "light gray": "gray",
  "light grey": "gray",
  "dark gray": "gray",
  "dark grey": "gray",
  "off-white": "white",
  offwhite: "white",
  burgundy: "maroon",
  "navy blue": "navy",
};

/**
 * Lowercase + trim + conservative alias table.
 * Unknown colors pass through unchanged.
 * Does NOT normalize "dark red" → "red" or "light blue" → "blue".
 */
export function normalizeColorName(raw: string): string {
  const key = raw.toLowerCase().trim();
  return COLOR_ALIASES[key] ?? key;
}

/**
 * Exact equality after normalization.
 * No substring matching. No fuzzy matching.
 */
export function colorsMatch(a: string, b: string): boolean {
  return normalizeColorName(a) === normalizeColorName(b);
}
