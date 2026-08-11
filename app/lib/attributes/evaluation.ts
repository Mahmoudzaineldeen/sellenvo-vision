import type { AttributeKey, EvaluationRecord } from "./types";

/**
 * Attribute evaluation gate records.
 * An attribute MUST NOT become PRODUCTION without a completed record
 * and acceptable False Auto-Fix Rate. Synthetic consistency tests alone
 * are insufficient evidence of vision accuracy.
 */
const EVALUATION_RECORDS: Record<AttributeKey, EvaluationRecord> = {
  color: {
    attributeKey: "color",
    businessValue: "Primary listing integrity signal; high merchant impact",
    supportedCategories: ["*"],
    detectability: "high",
    groundTruthDataset: "scripts/test-consistency.ts + docs/EVALUATION.md",
    falseAutoFixRisk: "medium",
    evaluationScore: null,
    notes:
      "PRODUCTION via existing hardened path. Multi-variant color still limited to option value[0]. Real-image False Auto-Fix Rate not yet measured at scale.",
    lastReviewedAt: "2026-08-11",
  },
  productType: {
    attributeKey: "productType",
    businessValue: "Catalog taxonomy consistency",
    supportedCategories: ["*"],
    detectability: "high",
    groundTruthDataset: "scripts/test-consistency.ts",
    falseAutoFixRisk: "medium",
    evaluationScore: null,
    notes: "PRODUCTION. Alias + category containment matching.",
    lastReviewedAt: "2026-08-11",
  },
  material: {
    attributeKey: "material",
    businessValue: "Material claim accuracy; metafield-first storage",
    supportedCategories: ["*"],
    detectability: "medium",
    groundTruthDataset: "scripts/test-consistency.ts + material dual-read tests",
    falseAutoFixRisk: "high",
    evaluationScore: null,
    notes:
      "PRODUCTION with metafield-first dual-read. Title rewrite default OFF. Ambiguous materials (gold vs yellow metal) remain high risk.",
    lastReviewedAt: "2026-08-11",
  },
  pattern: {
    attributeKey: "pattern",
    businessValue: "Useful for apparel/bags filters; integrity when claimed",
    supportedCategories: ["apparel", "footwear", "bags"],
    detectability: "medium",
    groundTruthDataset: "pending labeled set",
    falseAutoFixRisk: "high",
    evaluationScore: null,
    notes: "EXPERIMENTAL. Confirm-only. Not production-enabled until gate passes.",
    lastReviewedAt: "2026-08-11",
  },
  finish: {
    attributeKey: "finish",
    businessValue: "Useful for jewelry/bags surface claims",
    supportedCategories: ["apparel", "footwear", "bags", "jewelry"],
    detectability: "medium",
    groundTruthDataset: "pending labeled set",
    falseAutoFixRisk: "high",
    evaluationScore: null,
    notes: "EXPERIMENTAL. Confirm-only. Not production-enabled until gate passes.",
    lastReviewedAt: "2026-08-11",
  },
};

export function getEvaluationRecord(
  key: AttributeKey,
): EvaluationRecord | undefined {
  return EVALUATION_RECORDS[key];
}

export function listEvaluationRecords(): EvaluationRecord[] {
  return Object.values(EVALUATION_RECORDS);
}

/**
 * Gate check — PRODUCTION promotion requires documented eval + score.
 * Returns false for experimental/disabled until evidence exists.
 */
export function canPromoteToProduction(key: AttributeKey): {
  ok: boolean;
  reasons: string[];
} {
  const record = EVALUATION_RECORDS[key];
  const reasons: string[] = [];
  if (!record) {
    return { ok: false, reasons: ["No evaluation record"] };
  }
  if (!record.groundTruthDataset || record.groundTruthDataset.includes("pending")) {
    reasons.push("Ground-truth dataset incomplete");
  }
  if (record.evaluationScore === null) {
    reasons.push("Evaluation score not recorded");
  }
  if (record.falseAutoFixRisk === "high" && record.evaluationScore === null) {
    reasons.push("High false-auto-fix risk without measured rate");
  }
  return { ok: reasons.length === 0, reasons };
}
