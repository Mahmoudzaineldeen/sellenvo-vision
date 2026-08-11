/**
 * Demo/backfill helper: ensure experimental metafield definitions exist and
 * fill missing sellenvo.* values with category-aware dummy claims so Guardian
 * can evaluate them after a re-scan.
 */

import type { AdminClient } from "./shopify-fixes.server";
import {
  ensureSellenvoMetafieldDefinitions,
  fetchProductSellenvoMetafields,
  setProductSellenvoMetafield,
  type ProductMetafields,
  type SellenvoMetafieldKey,
} from "./metafields.server";
import {
  EXPERIMENTAL_METAFIELD_KEYS,
  resolveCategoryPack,
  type AttributeKey,
  type CategoryPackId,
} from "./attributes";
import { upsertShopSettings } from "./shop-settings.server";

const DUMMY_BY_PACK: Record<
  CategoryPackId,
  Partial<Record<AttributeKey, string>>
> = {
  core: {
    pattern: "Solid",
    finish: "Matte",
  },
  apparel: {
    pattern: "Solid",
    finish: "Matte",
    sleeveType: "Short",
    neckline: "Crew",
    closureType: "Button",
  },
  footwear: {
    pattern: "Solid",
    finish: "Matte",
    shoeStyle: "Sneaker",
    closureType: "Lace",
  },
  bags: {
    pattern: "Solid",
    finish: "Matte",
    strapType: "Shoulder",
    closureType: "Zipper",
  },
  jewelry: {
    finish: "Polished",
  },
};

type ProductLite = {
  id: string;
  title: string;
  productType: string | null;
};

async function listAllProducts(
  admin: AdminClient,
  max = 100,
): Promise<ProductLite[]> {
  const out: ProductLite[] = [];
  let after: string | null = null;
  while (out.length < max) {
    const response = await admin.graphql(
      `#graphql
      query SeedListProducts($first: Int!, $after: String) {
        products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              title
              productType
            }
          }
        }
      }`,
      {
        variables: {
          first: Math.min(50, max - out.length),
          after,
        },
      },
    );
    const json = await response.json();
    const connection = json?.data?.products;
    const edges = connection?.edges ?? [];
    for (const edge of edges) {
      const node = edge?.node;
      if (!node?.id) continue;
      out.push({
        id: node.id,
        title: node.title ?? "",
        productType: node.productType ?? null,
      });
    }
    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) {
      break;
    }
    after = connection.pageInfo.endCursor;
  }
  return out;
}

function dummyPlanForProduct(product: ProductLite): Partial<
  Record<SellenvoMetafieldKey, string>
> {
  const pack = resolveCategoryPack(product.productType || product.title);
  const plan = { ...DUMMY_BY_PACK.core, ...DUMMY_BY_PACK[pack] };
  const out: Partial<Record<SellenvoMetafieldKey, string>> = {};
  for (const key of EXPERIMENTAL_METAFIELD_KEYS) {
    const value = plan[key];
    if (value) out[key as SellenvoMetafieldKey] = value;
  }
  return out;
}

function missingKeys(
  current: ProductMetafields,
  plan: Partial<Record<SellenvoMetafieldKey, string>>,
): Array<[SellenvoMetafieldKey, string]> {
  const writes: Array<[SellenvoMetafieldKey, string]> = [];
  for (const [key, value] of Object.entries(plan) as Array<
    [SellenvoMetafieldKey, string]
  >) {
    const existing = current[key];
    if (!existing?.trim() && value) writes.push([key, value]);
  }
  return writes;
}

export async function seedExperimentalDummyMetafields(args: {
  admin: AdminClient;
  shop: string;
}): Promise<{
  productsTouched: number;
  metafieldsWritten: number;
  experimentalEnabled: boolean;
  productIds: string[];
  errors: string[];
}> {
  const errors: string[] = [];
  const productIds: string[] = [];
  await upsertShopSettings(args.shop, { showExperimentalAttributes: true });

  const defs = await ensureSellenvoMetafieldDefinitions(args.admin);
  if (!defs.ok) {
    errors.push(defs.error ?? "Failed to ensure metafield definitions");
    return {
      productsTouched: 0,
      metafieldsWritten: 0,
      experimentalEnabled: true,
      productIds,
      errors,
    };
  }

  const products = await listAllProducts(args.admin, 100);
  let productsTouched = 0;
  let metafieldsWritten = 0;

  for (const product of products) {
    try {
      const plan = dummyPlanForProduct(product);
      const current = await fetchProductSellenvoMetafields(
        args.admin,
        product.id,
      );
      const writes = missingKeys(current, plan);
      if (writes.length === 0) continue;

      for (const [key, value] of writes) {
        const result = await setProductSellenvoMetafield(
          args.admin,
          product.id,
          key,
          value,
        );
        if (result.error) {
          errors.push(`${product.title}: ${key}: ${result.error}`);
          continue;
        }
        metafieldsWritten += 1;
      }
      productsTouched += 1;
      productIds.push(product.id);
    } catch (err) {
      errors.push(
        `${product.title}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    productsTouched,
    metafieldsWritten,
    experimentalEnabled: true,
    productIds,
    errors,
  };
}
