import type { AttributeKey, EvaluationRecord } from "./types";

/**
 * Attribute evaluation gate records.
 * An attribute MUST NOT become PRODUCTION without a completed record
 * and acceptable False Auto-Fix Rate.
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
      "PRODUCTION via existing hardened path. Multi-variant color still limited to option value[0].",
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
      "PRODUCTION with metafield-first dual-read. Title rewrite default OFF.",
    lastReviewedAt: "2026-08-11",
  },
  pattern: {
    attributeKey: "pattern",
    businessValue: "Apparel/bags filter facets; integrity when claimed",
    supportedCategories: ["apparel", "footwear", "bags"],
    detectability: "medium",
    groundTruthDataset: "pending labeled set",
    falseAutoFixRisk: "high",
    evaluationScore: null,
    notes: "EXPERIMENTAL. Confirm-only.",
    lastReviewedAt: "2026-08-11",
  },
  finish: {
    attributeKey: "finish",
    businessValue: "Surface finish claims (jewelry, bags, apparel)",
    supportedCategories: ["apparel", "footwear", "bags", "jewelry"],
    detectability: "medium",
    groundTruthDataset: "pending labeled set",
    falseAutoFixRisk: "high",
    evaluationScore: null,
    notes: "EXPERIMENTAL. Confirm-only.",
    lastReviewedAt: "2026-08-11",
  },
  sleeveType: {
    attributeKey: "sleeveType",
    businessValue: "Apparel filter facet; high visual detectability",
    supportedCategories: ["apparel"],
    detectability: "high",
    groundTruthDataset: "pending labeled set",
    falseAutoFixRisk: "medium",
    evaluationScore: null,
    notes: "EXPERIMENTAL. Confirm-only. Category pack: apparel.",
    lastReviewedAt: "2026-08-11",
  },
  neckline: {
    attributeKey: "neckline",
    businessValue: "Apparel discovery + listing integrity",
    supportedCategories: ["apparel"],
    detectability: "high",
    groundTruthDataset: "pending labeled set",
    falseAutoFixRisk: "medium",
    evaluationScore: null,
    notes: "EXPERIMENTAL. Confirm-only. Category pack: apparel.",
    lastReviewedAt: "2026-08-11",
  },
  closureType: {
    attributeKey: "closureType",
    businessValue: "Cross-category practical filter (zip/lace/button)",
    supportedCategories: ["apparel", "footwear", "bags"],
    detectability: "high",
    groundTruthDataset: "pending labeled set",
    falseAutoFixRisk: "medium",
    evaluationScore: null,
    notes: "EXPERIMENTAL. Confirm-only.",
    lastReviewedAt: "2026-08-11",
  },
  shoeStyle: {
    attributeKey: "shoeStyle",
    businessValue: "Footwear taxonomy beyond productType",
    supportedCategories: ["footwear"],
    detectability: "high",
    groundTruthDataset: "pending labeled set",
    falseAutoFixRisk: "medium",
    evaluationScore: null,
    notes: "EXPERIMENTAL. Confirm-only. Category pack: footwear.",
    lastReviewedAt: "2026-08-11",
  },
  strapType: {
    attributeKey: "strapType",
    businessValue: "Bag carry-style filter; high shopper relevance",
    supportedCategories: ["bags"],
    detectability: "high",
    groundTruthDataset: "pending labeled set",
    falseAutoFixRisk: "medium",
    evaluationScore: null,
    notes: "EXPERIMENTAL. Confirm-only. Category pack: bags.",
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
