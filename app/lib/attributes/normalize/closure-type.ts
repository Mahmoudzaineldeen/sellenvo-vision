/** Closure type vocabulary — EXPERIMENTAL (apparel / footwear / bags). */

export const CLOSURE_TYPE_KEYWORDS = [
  "zipper",
  "button",
  "lace",
  "buckle",
  "magnetic",
  "slip-on",
  "drawstring",
  "velcro",
  "snap",
] as const;

const ALIASES: Record<string, string> = {
  zip: "zipper",
  zippered: "zipper",
  buttons: "button",
  laced: "lace",
  laces: "lace",
  tie: "lace",
  buckle: "buckle",
  clasps: "buckle",
  clasp: "buckle",
  magnet: "magnetic",
  "slip on": "slip-on",
  slipon: "slip-on",
  "pull-on": "slip-on",
  drawcord: "drawstring",
  "hook and loop": "velcro",
  snaps: "snap",
  press: "snap",
};

export function normalizeClosureTypeName(raw: string): string {
  const key = raw.toLowerCase().trim();
  return ALIASES[key] ?? key;
}

export function closureTypesMatch(a: string, b: string): boolean {
  return normalizeClosureTypeName(a) === normalizeClosureTypeName(b);
}

export function isRecognizedClosureType(raw: string): boolean {
  const n = normalizeClosureTypeName(raw);
  return (CLOSURE_TYPE_KEYWORDS as readonly string[]).includes(n);
}
