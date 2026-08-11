/** Neckline vocabulary — EXPERIMENTAL (apparel). */

export const NECKLINE_KEYWORDS = [
  "crew",
  "v-neck",
  "scoop",
  "turtleneck",
  "hoodie",
  "collar",
  "boat",
  "square",
  "halter",
] as const;

const ALIASES: Record<string, string> = {
  "crew neck": "crew",
  crewneck: "crew",
  round: "crew",
  "v neck": "v-neck",
  vneck: "v-neck",
  "scoop neck": "scoop",
  turtle: "turtleneck",
  "turtle neck": "turtleneck",
  mock: "turtleneck",
  "mock neck": "turtleneck",
  hooded: "hoodie",
  hood: "hoodie",
  collared: "collar",
  "button-down": "collar",
  "boat neck": "boat",
  "square neck": "square",
};

export function normalizeNecklineName(raw: string): string {
  const key = raw.toLowerCase().trim();
  return ALIASES[key] ?? key;
}

export function necklinesMatch(a: string, b: string): boolean {
  return normalizeNecklineName(a) === normalizeNecklineName(b);
}

export function isRecognizedNeckline(raw: string): boolean {
  const n = normalizeNecklineName(raw);
  return (NECKLINE_KEYWORDS as readonly string[]).includes(n);
}
