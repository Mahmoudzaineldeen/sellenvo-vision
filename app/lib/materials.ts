/** Shared material vocabulary used by listing extraction + edit UI. */
export const MATERIAL_KEYWORDS = [
  "leather",
  "fabric",
  "cotton",
  "metal",
  "plastic",
  "wood",
  "glass",
  "rubber",
  "denim",
  "synthetic",
] as const;

export type MaterialKeyword = (typeof MATERIAL_KEYWORDS)[number];

/**
 * Conservative material aliases for comparison only.
 * Unknown materials pass through unchanged (exact match required).
 * Does NOT equate canvas→fabric or suede→leather (too aggressive).
 */
const MATERIAL_ALIASES: Record<string, string> = {
  "genuine leather": "leather",
  "real leather": "leather",
  "faux leather": "synthetic",
  "vegan leather": "synthetic",
  "stainless steel": "metal",
  steel: "metal",
  aluminum: "metal",
  aluminium: "metal",
  brass: "metal",
  gold: "metal",
  silver: "metal",
  polyester: "synthetic",
  nylon: "synthetic",
  acrylic: "synthetic",
};

/**
 * Lowercase + trim + conservative alias table.
 * Unknown materials pass through unchanged.
 */
export function normalizeMaterialName(raw: string): string {
  const key = raw.toLowerCase().trim();
  return MATERIAL_ALIASES[key] ?? key;
}

/**
 * Exact equality after normalization.
 * No substring matching. No fuzzy matching.
 */
export function materialsMatch(a: string, b: string): boolean {
  return normalizeMaterialName(a) === normalizeMaterialName(b);
}
