import type { AttributeKey, FixPolicy } from "./types";
import { getAttribute } from "./registry";

export type ShopFixSettings = {
  /** When true, attributes with registry fixPolicy "safe" may auto-apply. */
  safeAutoFixEnabled: boolean;
  /** Material write target. */
  materialWriteMode: "metafield" | "title" | "both";
  showExperimentalAttributes: boolean;
};

export type PolicyDecision = {
  allowed: boolean;
  requiresConfirmation: boolean;
  policy: FixPolicy;
  reason: string;
};

/**
 * Server-side fix policy. Never trust client safeToApply.
 */
export function evaluateFixPolicy(
  attributeKey: AttributeKey,
  settings: ShopFixSettings,
  opts?: {
    observation?: "observed" | "inferred" | "unknown";
    confidence?: number;
  },
): PolicyDecision {
  const def = getAttribute(attributeKey);
  if (!def) {
    return {
      allowed: false,
      requiresConfirmation: true,
      policy: "never",
      reason: `Unknown attribute: ${attributeKey}`,
    };
  }

  if (def.status === "DISABLED" || def.status === "REJECTED") {
    return {
      allowed: false,
      requiresConfirmation: true,
      policy: "never",
      reason: `Attribute ${attributeKey} is ${def.status}`,
    };
  }

  if (def.status === "EXPERIMENTAL" && !settings.showExperimentalAttributes) {
    return {
      allowed: false,
      requiresConfirmation: true,
      policy: "never",
      reason: "Experimental attributes are disabled for this shop",
    };
  }

  if (def.fixPolicy === "never") {
    return {
      allowed: false,
      requiresConfirmation: true,
      policy: "never",
      reason: `${def.label} cannot be auto-mutated`,
    };
  }

  if (opts?.observation === "inferred" || opts?.observation === "unknown") {
    return {
      allowed: false,
      requiresConfirmation: true,
      policy: "confirm",
      reason: "Inferred/unknown observations require merchant confirmation and are not auto-applied",
    };
  }

  if (
    opts?.confidence !== undefined &&
    opts.confidence < def.confidenceThreshold
  ) {
    return {
      allowed: false,
      requiresConfirmation: true,
      policy: "confirm",
      reason: `Confidence below threshold (${def.confidenceThreshold})`,
    };
  }

  if (def.fixPolicy === "safe") {
    if (!settings.safeAutoFixEnabled) {
      return {
        allowed: true,
        requiresConfirmation: true,
        policy: "confirm",
        reason: "Safe auto-fix is disabled; confirmation required",
      };
    }
    return {
      allowed: true,
      requiresConfirmation: false,
      policy: "safe",
      reason: "Safe auto-fix enabled for this attribute",
    };
  }

  // confirm
  return {
    allowed: true,
    requiresConfirmation: true,
    policy: "confirm",
    reason: "Merchant confirmation required",
  };
}

/**
 * Which fixes may be applied without per-item confirmation (Apply All Safe).
 */
export function isSafeAutoFix(
  attributeKey: AttributeKey,
  settings: ShopFixSettings,
): boolean {
  const decision = evaluateFixPolicy(attributeKey, settings);
  return decision.allowed && !decision.requiresConfirmation;
}
