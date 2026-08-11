/** Pattern vocabulary for EXPERIMENTAL attribute (confirm-only). */

export const PATTERN_KEYWORDS = [
  "solid",
  "striped",
  "plaid",
  "floral",
  "geometric",
  "polka dot",
  "camouflage",
  "checked",
  "printed",
] as const;

export type PatternKeyword = (typeof PATTERN_KEYWORDS)[number];

const PATTERN_ALIASES: Record<string, string> = {
  stripe: "striped",
  stripes: "striped",
  "polka-dot": "polka dot",
  polkadot: "polka dot",
  "polka dots": "polka dot",
  check: "checked",
  checks: "checked",
  camouflage: "camouflage",
  camo: "camouflage",
  plain: "solid",
};

export function normalizePatternName(raw: string): string {
  const key = raw.toLowerCase().trim();
  return PATTERN_ALIASES[key] ?? key;
}

export function patternsMatch(a: string, b: string): boolean {
  return normalizePatternName(a) === normalizePatternName(b);
}

export function isRecognizedPattern(raw: string): boolean {
  const n = normalizePatternName(raw);
  return (PATTERN_KEYWORDS as readonly string[]).includes(n);
}
