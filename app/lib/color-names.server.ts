/**
 * Map an RGB hex color to a simple named color via nearest Euclidean distance.
 * Used by optional colorthief pixel analysis.
 */

const NAMED_COLORS: Array<{ name: string; r: number; g: number; b: number }> = [
  { name: "black", r: 26, g: 26, b: 26 },
  { name: "white", r: 245, g: 245, b: 245 },
  { name: "red", r: 200, g: 40, b: 40 },
  { name: "blue", r: 40, g: 80, b: 200 },
  { name: "green", r: 40, g: 160, b: 60 },
  { name: "yellow", r: 230, g: 210, b: 40 },
  { name: "orange", r: 230, g: 130, b: 30 },
  { name: "purple", r: 120, g: 50, b: 180 },
  { name: "pink", r: 230, g: 120, b: 160 },
  { name: "brown", r: 120, g: 70, b: 40 },
  { name: "grey", r: 140, g: 140, b: 140 },
  { name: "navy", r: 20, g: 40, b: 100 },
  { name: "beige", r: 210, g: 190, b: 160 },
  { name: "gold", r: 200, g: 170, b: 50 },
  { name: "silver", r: 180, g: 180, b: 190 },
  { name: "maroon", r: 110, g: 20, b: 40 },
  { name: "teal", r: 30, g: 140, b: 140 },
];

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace("#", "").trim();
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function distance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Map hex to nearest named color. Returns null for invalid hex input.
 */
export function mapHexToColorName(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  let best = NAMED_COLORS[0];
  let bestDist = Infinity;
  for (const named of NAMED_COLORS) {
    const d = distance(rgb, named);
    if (d < bestDist) {
      bestDist = d;
      best = named;
    }
  }
  return best.name;
}
