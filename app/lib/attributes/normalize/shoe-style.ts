/** Shoe style vocabulary — EXPERIMENTAL (footwear). */

export const SHOE_STYLE_KEYWORDS = [
  "sneaker",
  "boot",
  "sandal",
  "loafer",
  "heel",
  "mule",
  "oxford",
  "slipper",
  "pump",
] as const;

const ALIASES: Record<string, string> = {
  sneakers: "sneaker",
  trainers: "sneaker",
  trainer: "sneaker",
  "running shoe": "sneaker",
  boots: "boot",
  ankle: "boot",
  "ankle boot": "boot",
  sandals: "sandal",
  flipflop: "sandal",
  "flip-flop": "sandal",
  loafers: "loafer",
  heels: "heel",
  "high heel": "heel",
  stilettos: "heel",
  stiletto: "heel",
  mules: "mule",
  oxfords: "oxford",
  slippers: "slipper",
  pumps: "pump",
};

export function normalizeShoeStyleName(raw: string): string {
  const key = raw.toLowerCase().trim();
  return ALIASES[key] ?? key;
}

export function shoeStylesMatch(a: string, b: string): boolean {
  return normalizeShoeStyleName(a) === normalizeShoeStyleName(b);
}

export function isRecognizedShoeStyle(raw: string): boolean {
  const n = normalizeShoeStyleName(raw);
  return (SHOE_STYLE_KEYWORDS as readonly string[]).includes(n);
}
