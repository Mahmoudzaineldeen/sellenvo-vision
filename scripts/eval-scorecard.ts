/**
 * Offline eval scorecard scaffold for False Auto-Fix Rate tracking.
 * Does NOT call Groq — records structure for manual / batch eval results.
 *
 * Usage:
 *   npx tsx scripts/eval-scorecard.ts
 *
 * Fill docs/eval-results.jsonl with lines like:
 * {"id":"E01","attribute":"color","claimed":"Red","detected":"Black","labelCorrect":true,"suggestedFix":"Black","fixCorrect":true,"verdict":"MISMATCH"}
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

console.log(`Loaded ${rows.length} eval rows\n`);

for (const [attr, list] of byAttr) {
  const withFix = list.filter((r) => r.suggestedFix);
  const incorrectFixes = withFix.filter((r) => r.fixCorrect === false);
  const fafr =
    withFix.length === 0
      ? null
      : incorrectFixes.length / withFix.length;
  const falseMismatch = list.filter(
    (r) => r.verdict === "MISMATCH" && r.labelCorrect === true,
  ).length;

  console.log(`Attribute: ${attr}`);
  console.log(`  samples: ${list.length}`);
  console.log(`  suggested fixes: ${withFix.length}`);
  console.log(
    `  False Auto-Fix Rate: ${fafr === null ? "N/A" : `${(fafr * 100).toFixed(1)}%`}`,
  );
  console.log(`  false mismatch count: ${falseMismatch}`);
  console.log("");
}
