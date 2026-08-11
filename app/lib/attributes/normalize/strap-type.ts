/** Strap type vocabulary — EXPERIMENTAL (bags). */

export const STRAP_TYPE_KEYWORDS = [
  "shoulder",
  "crossbody",
  "top-handle",
  "backpack",
  "wrist",
  "none",
] as const;

const ALIASES: Record<string, string> = {
  "shoulder strap": "shoulder",
  "cross body": "crossbody",
  "cross-body": "crossbody",
  messenger: "crossbody",
  "top handle": "top-handle",
  "top handles": "top-handle",
  handle: "top-handle",
  handles: "top-handle",
  "double handle": "top-handle",
  backpacks: "backpack",
  "two straps": "backpack",
  clutch: "none",
  "no strap": "none",
  strapless: "none",
};

export function normalizeStrapTypeName(raw: string): string {
  const key = raw.toLowerCase().trim();
  return ALIASES[key] ?? key;
}

export function strapTypesMatch(a: string, b: string): boolean {
  return normalizeStrapTypeName(a) === normalizeStrapTypeName(b);
}

export function isRecognizedStrapType(raw: string): boolean {
  const n = normalizeStrapTypeName(raw);
  return (STRAP_TYPE_KEYWORDS as readonly string[]).includes(n);
}
