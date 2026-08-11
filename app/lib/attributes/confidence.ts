import type { AttributeKey, ConfidenceBand } from "./types";
import { getAttribute } from "./registry";

/**
 * Map numeric confidence to High/Medium/Low using attribute-aware thresholds.
 * Never present LLM % as empirical accuracy — bands only in UX.
 */
export function confidenceBand(
  confidence: number,
  attributeKey?: AttributeKey,
): ConfidenceBand {
  const threshold = attributeKey
    ? (getAttribute(attributeKey)?.confidenceThreshold ?? 0.7)
    : 0.7;
  if (confidence >= Math.max(threshold, 0.85)) return "high";
  if (confidence >= Math.max(threshold - 0.2, 0.5)) return "medium";
  return "low";
}

export function confidenceBandLabel(band: ConfidenceBand): string {
  if (band === "high") return "High confidence";
  if (band === "medium") return "Medium confidence";
  return "Low confidence";
}
