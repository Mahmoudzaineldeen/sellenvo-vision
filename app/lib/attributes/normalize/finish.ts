/** Finish vocabulary for EXPERIMENTAL attribute (confirm-only). */

export const FINISH_KEYWORDS = [
  "matte",
  "glossy",
  "polished",
  "brushed",
  "satin",
  "metallic",
  "textured",
] as const;

export type FinishKeyword = (typeof FINISH_KEYWORDS)[number];

const FINISH_ALIASES: Record<string, string> = {
  gloss: "glossy",
  shiny: "glossy",
  shine: "glossy",
  dull: "matte",
  flat: "matte",
  brushed: "brushed",
  polish: "polished",
  metal: "metallic",
  texture: "textured",
};

export function normalizeFinishName(raw: string): string {
  const key = raw.toLowerCase().trim();
  return FINISH_ALIASES[key] ?? key;
}

export function finishesMatch(a: string, b: string): boolean {
  return normalizeFinishName(a) === normalizeFinishName(b);
}

export function isRecognizedFinish(raw: string): boolean {
  const n = normalizeFinishName(raw);
  return (FINISH_KEYWORDS as readonly string[]).includes(n);
}
