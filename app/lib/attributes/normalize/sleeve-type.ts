/** Sleeve type vocabulary — EXPERIMENTAL (apparel). */

export const SLEEVE_TYPE_KEYWORDS = [
  "short",
  "long",
  "sleeveless",
  "three-quarter",
  "cap",
  "raglan",
] as const;

const ALIASES: Record<string, string> = {
  "short sleeve": "short",
  "short-sleeve": "short",
  shortsleeve: "short",
  "long sleeve": "long",
  "long-sleeve": "long",
  longsleeve: "long",
  "3/4": "three-quarter",
  "3/4 sleeve": "three-quarter",
  "three quarter": "three-quarter",
  "cap sleeve": "cap",
  tank: "sleeveless",
  vest: "sleeveless",
};

export function normalizeSleeveTypeName(raw: string): string {
  const key = raw.toLowerCase().trim();
  return ALIASES[key] ?? key;
}

export function sleeveTypesMatch(a: string, b: string): boolean {
  return normalizeSleeveTypeName(a) === normalizeSleeveTypeName(b);
}

export function isRecognizedSleeveType(raw: string): boolean {
  const n = normalizeSleeveTypeName(raw);
  return (SLEEVE_TYPE_KEYWORDS as readonly string[]).includes(n);
}
