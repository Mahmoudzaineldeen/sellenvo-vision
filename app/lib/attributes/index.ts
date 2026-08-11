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
  EXPERIMENTAL_METAFIELD_KEYS,
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

export {
  SLEEVE_TYPE_KEYWORDS,
  normalizeSleeveTypeName,
  sleeveTypesMatch,
  isRecognizedSleeveType,
} from "./normalize/sleeve-type";

export {
  NECKLINE_KEYWORDS,
  normalizeNecklineName,
  necklinesMatch,
  isRecognizedNeckline,
} from "./normalize/neckline";

export {
  CLOSURE_TYPE_KEYWORDS,
  normalizeClosureTypeName,
  closureTypesMatch,
  isRecognizedClosureType,
} from "./normalize/closure-type";

export {
  SHOE_STYLE_KEYWORDS,
  normalizeShoeStyleName,
  shoeStylesMatch,
  isRecognizedShoeStyle,
} from "./normalize/shoe-style";

export {
  STRAP_TYPE_KEYWORDS,
  normalizeStrapTypeName,
  strapTypesMatch,
  isRecognizedStrapType,
} from "./normalize/strap-type";
