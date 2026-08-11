/**
 * Attribute registry types — single source of truth for Catalog Integrity.
 */

export type AttributeStatus =
  | "PRODUCTION"
  | "EXPERIMENTAL"
  | "DISABLED"
  | "REJECTED";

export type FixPolicy = "safe" | "confirm" | "never";

export type AttributeVerdict =
  | "MATCH"
  | "MISMATCH"
  | "UNCERTAIN"
  | "NOT_DETECTABLE"
  | "NOT_APPLICABLE";

export type Detectability = "high" | "medium" | "low";

export type ObservationType = "observed" | "inferred" | "unknown";

export type ConfidenceBand = "high" | "medium" | "low";

export type AttributeKey =
  | "color"
  | "productType"
  | "material"
  | "pattern"
  | "finish"
  | "sleeveType"
  | "neckline"
  | "closureType"
  | "shoeStyle"
  | "strapType";

export type VisualAttribute = {
  value: string | null;
  confidence: number;
  evidence: string;
  detectability: Detectability;
  observation: ObservationType;
};

export type StorageKind =
  | "option_color"
  | "product_type"
  | "metafield"
  | "title_keyword";

export type AttributeStorage = {
  kind: StorageKind;
  namespace?: string;
  key?: string;
};

export type AttributeDefinition = {
  key: AttributeKey;
  label: string;
  status: AttributeStatus;
  /** Category keys this attribute applies to; ["*"] = all */
  applicableCategories: string[];
  detectability: Detectability;
  confidenceThreshold: number;
  fixPolicy: FixPolicy;
  storage: AttributeStorage;
  normalize: (raw: string) => string;
  match: (claimed: string, detected: string) => boolean;
  /** Optional recognizer — unrecognized → NOT_DETECTABLE */
  isRecognized?: (raw: string) => boolean;
};

export type CategoryPackId =
  | "core"
  | "apparel"
  | "footwear"
  | "bags"
  | "jewelry";

export type CategoryPack = {
  id: CategoryPackId;
  label: string;
  attributeKeys: AttributeKey[];
};

export type EvaluationRecord = {
  attributeKey: AttributeKey;
  businessValue: string;
  supportedCategories: string[];
  detectability: Detectability;
  groundTruthDataset: string;
  falseAutoFixRisk: "low" | "medium" | "high";
  evaluationScore: number | null;
  notes: string;
  lastReviewedAt: string | null;
};
