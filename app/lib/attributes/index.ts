export type {
  AttributeStatus,
  FixPolicy,
  AttributeVerdict,
  Detectability,
  ObservationType,
  ConfidenceBand,
  AttributeKey,
  VisualAttribute,
  AttributeStorage,
  AttributeDefinition,
  CategoryPackId,
  CategoryPack,
  EvaluationRecord,
} from "./types";

export {
  getAttribute,
  listAttributes,
  listProductionAttributes,
  listEnabledAttributes,
  isAttributeApplicable,
  getRegistrySnapshot,
} from "./registry";

export {
  evaluateFixPolicy,
  isSafeAutoFix,
  type ShopFixSettings,
  type PolicyDecision,
} from "./policy";

export {
  getEvaluationRecord,
  listEvaluationRecords,
  canPromoteToProduction,
} from "./evaluation";

export {
  confidenceBand,
  confidenceBandLabel,
} from "./confidence";

export {
  CATEGORY_PACKS,
  resolveCategoryPack,
  selectAttributeKeysForProduct,
  buildVisionAttributePromptSection,
} from "./packs";

export {
  PATTERN_KEYWORDS,
  normalizePatternName,
  patternsMatch,
  isRecognizedPattern,
} from "./normalize/pattern";

export {
  FINISH_KEYWORDS,
  normalizeFinishName,
  finishesMatch,
  isRecognizedFinish,
} from "./normalize/finish";
