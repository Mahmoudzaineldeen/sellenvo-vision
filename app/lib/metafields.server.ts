/**
 * Idempotent Sellenvo metafield definitions + product metafield read/write.
 * Namespace: sellenvo — keys: material, pattern, finish
 */

import type { AdminClient } from "./shopify-fixes.server";

export const SELLENVO_NAMESPACE = "sellenvo";

export type SellenvoMetafieldKey = "material" | "pattern" | "finish";

const DEFINITIONS: Array<{
  key: SellenvoMetafieldKey;
  name: string;
  description: string;
}> = [
  {
    key: "material",
    name: "Material",
    description: "Product material verified by Sellenvo Vision",
  },
  {
    key: "pattern",
    name: "Pattern",
    description: "Product pattern (experimental)",
  },
  {
    key: "finish",
    name: "Finish",
    description: "Product surface finish (experimental)",
  },
];

function graphqlErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const errors = (json as { errors?: Array<{ message?: string }> }).errors;
  if (!errors?.length) return null;
  return errors
    .map((e) => e.message)
    .filter((m): m is string => Boolean(m))
    .join("; ");
}

/**
 * Ensure metafield definitions exist (idempotent). Safe to call repeatedly.
 */
export async function ensureSellenvoMetafieldDefinitions(
  admin: AdminClient,
): Promise<{ ok: boolean; error?: string }> {
  for (const def of DEFINITIONS) {
    const response = await admin.graphql(
      `#graphql
      mutation EnsureSellenvoMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id namespace key }
          userErrors { field message code }
        }
      }`,
      {
        variables: {
          definition: {
            name: def.name,
            namespace: SELLENVO_NAMESPACE,
            key: def.key,
            type: "single_line_text_field",
            ownerType: "PRODUCT",
            description: def.description,
          },
        },
      },
    );
    const json = await response.json();
    const top = graphqlErrorMessage(json);
    if (top) return { ok: false, error: top };
    const payload = json?.data?.metafieldDefinitionCreate;
    const userErrors: Array<{ message?: string; code?: string }> =
      payload?.userErrors ?? [];
    // TAKEN / already exists is success for idempotency
    const blocking = userErrors.filter(
      (e) =>
        e.code !== "TAKEN" &&
        !(e.message ?? "").toLowerCase().includes("already been taken") &&
        !(e.message ?? "").toLowerCase().includes("already exists"),
    );
    if (blocking.length > 0) {
      return {
        ok: false,
        error: blocking.map((e) => e.message).join("; "),
      };
    }
  }
  return { ok: true };
}

export type ProductMetafields = {
  material: string | null;
  pattern: string | null;
  finish: string | null;
};

/**
 * Read sellenvo.* metafields from a product.
 */
export async function fetchProductSellenvoMetafields(
  admin: AdminClient,
  productId: string,
): Promise<ProductMetafields> {
  const response = await admin.graphql(
    `#graphql
    query SellenvoProductMetafields($id: ID!) {
      product(id: $id) {
        material: metafield(namespace: "sellenvo", key: "material") { value }
        pattern: metafield(namespace: "sellenvo", key: "pattern") { value }
        finish: metafield(namespace: "sellenvo", key: "finish") { value }
      }
    }`,
    { variables: { id: productId } },
  );
  const json = await response.json();
  const product = json?.data?.product;
  return {
    material: product?.material?.value ?? null,
    pattern: product?.pattern?.value ?? null,
    finish: product?.finish?.value ?? null,
  };
}

/**
 * Upsert a single sellenvo metafield on a product.
 */
export async function setProductSellenvoMetafield(
  admin: AdminClient,
  productId: string,
  key: SellenvoMetafieldKey,
  value: string,
): Promise<{ error?: string }> {
  const response = await admin.graphql(
    `#graphql
    mutation SetSellenvoMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key namespace value }
        userErrors { field message code }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: SELLENVO_NAMESPACE,
            key,
            type: "single_line_text_field",
            value,
          },
        ],
      },
    },
  );
  const json = await response.json();
  const top = graphqlErrorMessage(json);
  if (top) return { error: top };
  const userErrors = json?.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      error: userErrors.map((e: { message: string }) => e.message).join("; "),
    };
  }
  return {};
}
