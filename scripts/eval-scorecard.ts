/**
 * Offline eval scorecard for Catalog Integrity.
 * Does NOT call Groq — aggregates docs/eval-results.jsonl.
 *
 * Usage:
 *   npx tsx scripts/eval-scorecard.ts
 *
 * Label all published figures as Internal evaluation until merchant field data exists.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

type EvalRow = {
  id: string;
  attribute: string;
  claimed?: string;
  detected?: string;
  labelCorrect: boolean;
  suggestedFix?: string | null;
  fixCorrect?: boolean | null;
  verdict: string;
};

const path = resolve("docs/eval-results.jsonl");

if (!existsSync(path)) {
  console.log(`No ${path} yet — create it from the EVALUATION.md template.`);
  console.log("False Auto-Fix Rate: N/A (no data)");
  process.exit(0);
}

const rows: EvalRow[] = readFileSync(path, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l) as EvalRow);

const byAttr = new Map<string, EvalRow[]>();
for (const row of rows) {
  const list = byAttr.get(row.attribute) ?? [];
  list.push(row);
  byAttr.set(row.attribute, list);
}

function pct(n: number, d: number): string {
  if (d === 0) return "N/A";
  return `${((n / d) * 100).toFixed(1)}%`;
}

console.log("=== Internal evaluation scorecard ===");
console.log(`Dataset: ${path}`);
console.log(`Samples: ${rows.length}`);
console.log("Label: INTERNAL EVALUATION / PROTOTYPE BENCHMARK — not merchant field study\n");

const actionable = rows.filter(
  (r) => r.verdict === "MATCH" || r.verdict === "MISMATCH",
);
const detectionCorrect = rows.filter((r) => r.labelCorrect).length;
const uncertain = rows.filter((r) => r.verdict === "UNCERTAIN").length;
const notDetectable = rows.filter((r) => r.verdict === "NOT_DETECTABLE").length;
const withFix = rows.filter((r) => r.suggestedFix);
const incorrectFixes = withFix.filter((r) => r.fixCorrect === false);
const correctFixes = withFix.filter((r) => r.fixCorrect === true);
const falseMismatch = rows.filter(
  (r) => r.verdict === "MISMATCH" && r.labelCorrect === false,
).length;

console.log("Overall");
console.log(`  samples: ${rows.length}`);
console.log(
  `  detection agreement (labelCorrect): ${pct(detectionCorrect, rows.length)} (${detectionCorrect}/${rows.length})`,
);
console.log(
  `  actionable MATCH/MISMATCH share: ${pct(actionable.length, rows.length)}`,
);
console.log(`  uncertain rate: ${pct(uncertain, rows.length)}`);
console.log(`  not-detectable rate: ${pct(notDetectable, rows.length)}`);
console.log(
  `  suggested-fix correctness: ${pct(correctFixes.length, withFix.length)} (${correctFixes.length}/${withFix.length})`,
);
console.log(
  `  False Auto-Fix Rate: ${pct(incorrectFixes.length, withFix.length)} (${incorrectFixes.length}/${withFix.length})`,
);
console.log(`  false mismatch count: ${falseMismatch}`);
console.log("");

for (const [attr, list] of byAttr) {
  const attrFix = list.filter((r) => r.suggestedFix);
  const attrBadFix = attrFix.filter((r) => r.fixCorrect === false);
  const attrOk = list.filter((r) => r.labelCorrect).length;
  const attrFalseMismatch = list.filter(
    (r) => r.verdict === "MISMATCH" && r.labelCorrect === false,
  ).length;

  console.log(`Attribute: ${attr}`);
  console.log(`  samples: ${list.length}`);
  console.log(`  detection agreement: ${pct(attrOk, list.length)}`);
  console.log(`  suggested fixes: ${attrFix.length}`);
  console.log(
    `  False Auto-Fix Rate: ${pct(attrBadFix.length, attrFix.length)}`,
  );
  console.log(`  false mismatch count: ${attrFalseMismatch}`);
  console.log("");
}

console.log(
  "Do not equate model confidence with empirical accuracy. See docs/EVALUATION.md.",
);
