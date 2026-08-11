import type { AttributeKey, CategoryPack, CategoryPackId } from "./types";
import { getAttribute, isAttributeApplicable } from "./registry";

/**
 * Category-aware attribute packs.
 * Only request attributes that are enabled + applicable.
 */
export const CATEGORY_PACKS: Record<CategoryPackId, CategoryPack> = {
  core: {
    id: "core",
    label: "Core",
    attributeKeys: ["color", "productType", "material"],
  },
  apparel: {
    id: "apparel",
    label: "Fashion / Apparel",
    attributeKeys: [
      "color",
      "productType",
      "material",
      "pattern",
      "finish",
      "sleeveType",
      "neckline",
      "closureType",
    ],
  },
  footwear: {
    id: "footwear",
    label: "Footwear",
    attributeKeys: [
      "color",
      "productType",
      "material",
      "pattern",
      "finish",
      "shoeStyle",
      "closureType",
    ],
  },
  bags: {
    id: "bags",
    label: "Bags",
    attributeKeys: [
      "color",
      "productType",
      "material",
      "pattern",
      "finish",
      "strapType",
      "closureType",
    ],
  },
  jewelry: {
    id: "jewelry",
    label: "Jewelry",
    attributeKeys: ["color", "productType", "material", "finish"],
  },
};

const PRODUCT_TYPE_TO_PACK: Array<{ match: RegExp; pack: CategoryPackId }> = [
  {
    match:
      /\b(shirt|sweatshirt|hoodie|sweater|jacket|coat|pants|jeans|shorts|skirt|dress|blouse|apparel|clothing|tee|t-shirt)\b/i,
    pack: "apparel",
  },
  {
    match: /\b(shoe|sneaker|boot|sandal|slipper|loafer|footwear|heel|pump)\b/i,
    pack: "footwear",
  },
  {
    match: /\b(bag|handbag|purse|backpack|tote|clutch|wallet)\b/i,
    pack: "bags",
  },
  {
    match: /\b(jewelry|jewellery|necklace|ring|bracelet|earring|watch)\b/i,
    pack: "jewelry",
  },
];

export function resolveCategoryPack(
  productType: string | null | undefined,
): CategoryPackId {
  if (!productType) return "core";
  for (const rule of PRODUCT_TYPE_TO_PACK) {
    if (rule.match.test(productType)) return rule.pack;
  }
  return "core";
}

export function selectAttributeKeysForProduct(opts: {
  productType?: string | null;
  includeExperimental?: boolean;
}): AttributeKey[] {
  const packId = resolveCategoryPack(opts.productType);
  const pack = CATEGORY_PACKS[packId];
  const keys = new Set<AttributeKey>(CATEGORY_PACKS.core.attributeKeys);
  for (const key of pack.attributeKeys) keys.add(key);

  const category =
    packId === "core" ? null : packId === "apparel" ? "apparel" : packId;

  return [...keys].filter((key) => {
    const def = getAttribute(key);
    if (!def) return false;
    if (def.status === "DISABLED" || def.status === "REJECTED") return false;
    if (def.status === "EXPERIMENTAL" && !opts.includeExperimental) return false;
    if (def.status === "PRODUCTION") return true;
    return isAttributeApplicable(def, category);
  });
}

export function buildVisionAttributePromptSection(
  keys: AttributeKey[],
): string {
  const lines: string[] = [];
  for (const key of keys) {
    const def = getAttribute(key);
    if (!def) continue;
    lines.push(
      `- ${key}: return value only when visually supported; otherwise "unknown" or "not_detectable". Prefer observed over inferred.`,
    );
  }
  return lines.join("\n");
}
