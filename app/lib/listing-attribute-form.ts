/**
 * Client-safe helpers for the Create test product form.
 * Listing claims are captured here before vision analysis.
 */

import {
  CATEGORY_PACKS,
  EXPERIMENTAL_METAFIELD_KEYS,
  getAttribute,
  resolveCategoryPack,
  type AttributeKey,
} from "./attributes";
import { MATERIAL_KEYWORDS } from "./materials";
import { PATTERN_KEYWORDS } from "./attributes/normalize/pattern";
import { FINISH_KEYWORDS } from "./attributes/normalize/finish";
import { SLEEVE_TYPE_KEYWORDS } from "./attributes/normalize/sleeve-type";
import { NECKLINE_KEYWORDS } from "./attributes/normalize/neckline";
import { CLOSURE_TYPE_KEYWORDS } from "./attributes/normalize/closure-type";
import { SHOE_STYLE_KEYWORDS } from "./attributes/normalize/shoe-style";
import { STRAP_TYPE_KEYWORDS } from "./attributes/normalize/strap-type";

export type ListingAttributeDraft = {
  material: string;
  pattern: string;
  finish: string;
  sleeveType: string;
  neckline: string;
  closureType: string;
  shoeStyle: string;
  strapType: string;
};

export const EMPTY_LISTING_ATTRIBUTES: ListingAttributeDraft = {
  material: "",
  pattern: "",
  finish: "",
  sleeveType: "",
  neckline: "",
  closureType: "",
  shoeStyle: "",
  strapType: "",
};

const OPTION_MAP: Record<string, readonly string[]> = {
  material: MATERIAL_KEYWORDS,
  pattern: PATTERN_KEYWORDS,
  finish: FINISH_KEYWORDS,
  sleeveType: SLEEVE_TYPE_KEYWORDS,
  neckline: NECKLINE_KEYWORDS,
  closureType: CLOSURE_TYPE_KEYWORDS,
  shoeStyle: SHOE_STYLE_KEYWORDS,
  strapType: STRAP_TYPE_KEYWORDS,
};

export function titleCaseOption(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Attribute keys shown on the create form for a product type (material always). */
export function listingAttributeFieldsForProductType(
  productType: string,
): Array<{
  key: keyof ListingAttributeDraft;
  label: string;
  options: string[];
  experimental: boolean;
}> {
  const packId = resolveCategoryPack(productType);
  const packKeys = new Set<AttributeKey>([
    ...CATEGORY_PACKS.core.attributeKeys,
    ...CATEGORY_PACKS[packId].attributeKeys,
  ]);

  const fields: Array<{
    key: keyof ListingAttributeDraft;
    label: string;
    options: string[];
    experimental: boolean;
  }> = [
    {
      key: "material",
      label: "Material",
      options: MATERIAL_KEYWORDS.map(titleCaseOption),
      experimental: false,
    },
  ];

  for (const key of EXPERIMENTAL_METAFIELD_KEYS) {
    if (!packKeys.has(key)) continue;
    const def = getAttribute(key);
    const options = OPTION_MAP[key];
    if (!def || !options) continue;
    fields.push({
      key: key as keyof ListingAttributeDraft,
      label: def.label,
      options: options.map(titleCaseOption),
      experimental: true,
    });
  }

  return fields;
}

export function apparelListingDefaults(): ListingAttributeDraft {
  return {
    material: "Cotton",
    pattern: "Solid",
    finish: "Matte",
    sleeveType: "Short",
    neckline: "Crew",
    closureType: "Button",
    shoeStyle: "",
    strapType: "",
  };
}

export function handbagListingDefaults(): ListingAttributeDraft {
  return {
    material: "Leather",
    pattern: "Solid",
    finish: "Matte",
    sleeveType: "",
    neckline: "",
    closureType: "Zipper",
    shoeStyle: "",
    strapType: "Shoulder",
  };
}

export function bottleListingDefaults(): ListingAttributeDraft {
  return {
    material: "Plastic",
    pattern: "",
    finish: "",
    sleeveType: "",
    neckline: "",
    closureType: "",
    shoeStyle: "",
    strapType: "",
  };
}

/** Drop attribute values that are not shown for this product type. */
export function pruneListingAttributesForProductType(
  attrs: ListingAttributeDraft,
  productType: string,
): ListingAttributeDraft {
  const allowed = new Set(
    listingAttributeFieldsForProductType(productType).map((f) => f.key),
  );
  const next: ListingAttributeDraft = { ...EMPTY_LISTING_ATTRIBUTES };
  for (const key of Object.keys(next) as Array<keyof ListingAttributeDraft>) {
    next[key] = allowed.has(key) ? attrs[key] : "";
  }
  return next;
}

/** Only keys currently visible for the product type (for submit). */
export function listingAttributesForSubmit(
  attrs: ListingAttributeDraft,
  productType: string,
): ListingAttributeDraft {
  return pruneListingAttributesForProductType(attrs, productType);
}
