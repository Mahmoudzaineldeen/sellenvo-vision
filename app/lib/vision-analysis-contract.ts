/**
 * Analysis contract versioning — cache / persist keys must invalidate when
 * prompt shape, attribute packs, or experimental inclusion changes.
 */

import { selectAttributeKeysForProduct } from "./attributes";

/** Bump when system prompt / response schema / pack selection rules change. */
export const VISION_ANALYSIS_CONTRACT_VERSION = "v2";

export type VisionContractOpts = {
  includeExperimental?: boolean;
  productType?: string | null;
};

/**
 * Stable key for vision cache + persisted analysis freshness.
 * Incorporates prompt/pack version and which attributes were in scope.
 */
export function visionAnalysisContract(opts?: VisionContractOpts): string {
  const includeExperimental = Boolean(opts?.includeExperimental);
  const productType = (opts?.productType ?? "").trim().toLowerCase() || "-";
  const keys = selectAttributeKeysForProduct({
    includeExperimental,
    productType: opts?.productType,
  })
    .slice()
    .sort()
    .join(",");
  return [
    VISION_ANALYSIS_CONTRACT_VERSION,
    `exp=${includeExperimental ? "1" : "0"}`,
    `pt=${productType}`,
    `keys=${keys || "core"}`,
  ].join("|");
}
