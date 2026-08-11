import type {
  AttributeDefinition,
  AttributeKey,
  AttributeStatus,
} from "./types";
import { colorsMatch, normalizeColorName } from "../color-normalize";
import {
  normalizeProductType,
  productTypesMatch,
} from "../product-type-normalize";
import { materialsMatch, normalizeMaterialName } from "../materials";
import {
  normalizePatternName,
  patternsMatch,
  isRecognizedPattern,
} from "./normalize/pattern";
import {
  normalizeFinishName,
  finishesMatch,
  isRecognizedFinish,
} from "./normalize/finish";
import {
  normalizeSleeveTypeName,
  sleeveTypesMatch,
  isRecognizedSleeveType,
} from "./normalize/sleeve-type";
import {
  normalizeNecklineName,
  necklinesMatch,
  isRecognizedNeckline,
} from "./normalize/neckline";
import {
  normalizeClosureTypeName,
  closureTypesMatch,
  isRecognizedClosureType,
} from "./normalize/closure-type";
import {
  normalizeShoeStyleName,
  shoeStylesMatch,
  isRecognizedShoeStyle,
} from "./normalize/shoe-style";
import {
  normalizeStrapTypeName,
  strapTypesMatch,
  isRecognizedStrapType,
} from "./normalize/strap-type";

const COLOR_DEF: AttributeDefinition = {
  key: "color",
  label: "Color",
  status: "PRODUCTION",
  applicableCategories: ["*"],
  detectability: "high",
  confidenceThreshold: 0.7,
  fixPolicy: "safe",
  storage: { kind: "option_color" },
  normalize: normalizeColorName,
  match: colorsMatch,
};

const PRODUCT_TYPE_DEF: AttributeDefinition = {
  key: "productType",
  label: "Product type",
  status: "PRODUCTION",
  applicableCategories: ["*"],
  detectability: "high",
  confidenceThreshold: 0.7,
  fixPolicy: "confirm",
  storage: { kind: "product_type" },
  normalize: normalizeProductType,
  match: productTypesMatch,
};

const MATERIAL_DEF: AttributeDefinition = {
  key: "material",
  label: "Material",
  status: "PRODUCTION",
  applicableCategories: ["*"],
  detectability: "medium",
  confidenceThreshold: 0.7,
  fixPolicy: "confirm",
  storage: {
    kind: "metafield",
    namespace: "sellenvo",
    key: "material",
  },
  normalize: normalizeMaterialName,
  match: materialsMatch,
};

const PATTERN_DEF: AttributeDefinition = {
  key: "pattern",
  label: "Pattern",
  status: "EXPERIMENTAL",
  applicableCategories: ["apparel", "footwear", "bags"],
  detectability: "medium",
  confidenceThreshold: 0.75,
  fixPolicy: "confirm",
  storage: {
    kind: "metafield",
    namespace: "sellenvo",
    key: "pattern",
  },
  normalize: normalizePatternName,
  match: patternsMatch,
  isRecognized: isRecognizedPattern,
};

const FINISH_DEF: AttributeDefinition = {
  key: "finish",
  label: "Finish",
  status: "EXPERIMENTAL",
  applicableCategories: ["apparel", "footwear", "bags", "jewelry"],
  detectability: "medium",
  confidenceThreshold: 0.75,
  fixPolicy: "confirm",
  storage: {
    kind: "metafield",
    namespace: "sellenvo",
    key: "finish",
  },
  normalize: normalizeFinishName,
  match: finishesMatch,
  isRecognized: isRecognizedFinish,
};

const SLEEVE_TYPE_DEF: AttributeDefinition = {
  key: "sleeveType",
  label: "Sleeve type",
  status: "EXPERIMENTAL",
  applicableCategories: ["apparel"],
  detectability: "high",
  confidenceThreshold: 0.75,
  fixPolicy: "confirm",
  storage: {
    kind: "metafield",
    namespace: "sellenvo",
    key: "sleeveType",
  },
  normalize: normalizeSleeveTypeName,
  match: sleeveTypesMatch,
  isRecognized: isRecognizedSleeveType,
};

const NECKLINE_DEF: AttributeDefinition = {
  key: "neckline",
  label: "Neckline",
  status: "EXPERIMENTAL",
  applicableCategories: ["apparel"],
  detectability: "high",
  confidenceThreshold: 0.75,
  fixPolicy: "confirm",
  storage: {
    kind: "metafield",
    namespace: "sellenvo",
    key: "neckline",
  },
  normalize: normalizeNecklineName,
  match: necklinesMatch,
  isRecognized: isRecognizedNeckline,
};

const CLOSURE_TYPE_DEF: AttributeDefinition = {
  key: "closureType",
  label: "Closure type",
  status: "EXPERIMENTAL",
  applicableCategories: ["apparel", "footwear", "bags"],
  detectability: "high",
  confidenceThreshold: 0.75,
  fixPolicy: "confirm",
  storage: {
    kind: "metafield",
    namespace: "sellenvo",
    key: "closureType",
  },
  normalize: normalizeClosureTypeName,
  match: closureTypesMatch,
  isRecognized: isRecognizedClosureType,
};

const SHOE_STYLE_DEF: AttributeDefinition = {
  key: "shoeStyle",
  label: "Shoe style",
  status: "EXPERIMENTAL",
  applicableCategories: ["footwear"],
  detectability: "high",
  confidenceThreshold: 0.75,
  fixPolicy: "confirm",
  storage: {
    kind: "metafield",
    namespace: "sellenvo",
    key: "shoeStyle",
  },
  normalize: normalizeShoeStyleName,
  match: shoeStylesMatch,
  isRecognized: isRecognizedShoeStyle,
};

const STRAP_TYPE_DEF: AttributeDefinition = {
  key: "strapType",
  label: "Strap type",
  status: "EXPERIMENTAL",
  applicableCategories: ["bags"],
  detectability: "high",
  confidenceThreshold: 0.75,
  fixPolicy: "confirm",
  storage: {
    kind: "metafield",
    namespace: "sellenvo",
    key: "strapType",
  },
  normalize: normalizeStrapTypeName,
  match: strapTypesMatch,
  isRecognized: isRecognizedStrapType,
};

/** Registry — single source of truth. Do not add attribute branches elsewhere. */
const REGISTRY: Record<AttributeKey, AttributeDefinition> = {
  color: COLOR_DEF,
  productType: PRODUCT_TYPE_DEF,
  material: MATERIAL_DEF,
  pattern: PATTERN_DEF,
  finish: FINISH_DEF,
  sleeveType: SLEEVE_TYPE_DEF,
  neckline: NECKLINE_DEF,
  closureType: CLOSURE_TYPE_DEF,
  shoeStyle: SHOE_STYLE_DEF,
  strapType: STRAP_TYPE_DEF,
};

/** Experimental metafield-backed attributes (confirm-only). */
export const EXPERIMENTAL_METAFIELD_KEYS: AttributeKey[] = [
  "pattern",
  "finish",
  "sleeveType",
  "neckline",
  "closureType",
  "shoeStyle",
  "strapType",
];

export function getAttribute(key: AttributeKey): AttributeDefinition | undefined {
  return REGISTRY[key];
}

export function listAttributes(
  statuses?: AttributeStatus[],
): AttributeDefinition[] {
  const all = Object.values(REGISTRY);
  if (!statuses || statuses.length === 0) return all;
  return all.filter((a) => statuses.includes(a.status));
}

export function listProductionAttributes(): AttributeDefinition[] {
  return listAttributes(["PRODUCTION"]);
}

export function listEnabledAttributes(opts?: {
  includeExperimental?: boolean;
}): AttributeDefinition[] {
  const statuses: AttributeStatus[] = ["PRODUCTION"];
  if (opts?.includeExperimental) statuses.push("EXPERIMENTAL");
  return listAttributes(statuses);
}

export function isAttributeApplicable(
  def: AttributeDefinition,
  category: string | null | undefined,
): boolean {
  if (def.applicableCategories.includes("*")) return true;
  if (!category) return false;
  const cat = category.toLowerCase().trim();
  return def.applicableCategories.some((c) => c === cat);
}

export function getRegistrySnapshot(): AttributeDefinition[] {
  return listAttributes();
}
