import type {
  AttributeDefinition,
  AttributeKey,
  AttributeStatus,
} from "./types";
import { colorsMatch, normalizeColorName } from "../color-normalize.server";
import {
  normalizeProductType,
  productTypesMatch,
} from "../product-type-normalize.server";
import { materialsMatch, normalizeMaterialName } from "../materials";
import {
  normalizePatternName,
  patternsMatch,
} from "./normalize/pattern";
import {
  normalizeFinishName,
  finishesMatch,
} from "./normalize/finish";

const COLOR_DEF: AttributeDefinition = {
  key: "color",
  label: "Color",
  status: "PRODUCTION",
  applicableCategories: ["*"],
  detectability: "high",
  confidenceThreshold: 0.7,
  // "safe" = eligible for auto-apply ONLY when shop.safeAutoFixEnabled is on.
  // When the shop setting is off, FixPolicyEngine still requires confirmation.
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
};

/** Registry — single source of truth. Do not add attribute branches elsewhere. */
const REGISTRY: Record<AttributeKey, AttributeDefinition> = {
  color: COLOR_DEF,
  productType: PRODUCT_TYPE_DEF,
  material: MATERIAL_DEF,
  pattern: PATTERN_DEF,
  finish: FINISH_DEF,
};

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
