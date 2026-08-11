import { z } from "zod";
import type { FixableSignal, SuggestedFix } from "./types";
import {
  extractMaterialFromTitle,
  replaceMaterialInTitle,
} from "./consistency.server";

export type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const ProductOptionValueSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const ProductOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  optionValues: z.array(ProductOptionValueSchema),
});

const MediaImageSchema = z
  .object({
    id: z.string().optional(),
    image: z
      .object({
        url: z.string(),
        altText: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

export const ProductNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  productType: z.string().nullable(),
  options: z.array(ProductOptionSchema),
  featuredMedia: MediaImageSchema.nullable().optional(),
  media: z.object({
    nodes: z.array(MediaImageSchema),
  }),
});

export type ProductNode = z.infer<typeof ProductNodeSchema>;

export type FixOutcome = {
  field: FixableSignal;
  success: boolean;
  verifiedValue: string | null;
  error?: string;
};

const GET_PRODUCT_QUERY = `#graphql
  query GuardianGetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      productType
      options {
        id
        name
        optionValues { id name }
      }
      featuredMedia {
        ... on MediaImage {
          id
          image { url altText }
        }
      }
      media(first: 5) {
        nodes {
          ... on MediaImage {
            id
            image { url altText }
          }
        }
      }
    }
  }
`;

const UPDATE_OPTION_MUTATION = `#graphql
  mutation GuardianUpdateOptionValue(
    $productId: ID!,
    $option: OptionUpdateInput!,
    $optionValuesToUpdate: [OptionValueUpdateInput!]
  ) {
    productOptionUpdate(
      productId: $productId,
      option: $option,
      optionValuesToUpdate: $optionValuesToUpdate
    ) {
      userErrors { field message code }
      product { id }
    }
  }
`;

const UPDATE_PRODUCT_MUTATION = `#graphql
  mutation GuardianUpdateProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      userErrors { field message }
      product { id title productType }
    }
  }
`;

function graphqlErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const errors = (json as { errors?: Array<{ message?: string }> }).errors;
  if (!errors?.length) return null;
  return errors
    .map((e) => e.message)
    .filter((m): m is string => Boolean(m))
    .join("; ");
}

export async function fetchProductNode(
  admin: AdminClient,
  productId: string,
): Promise<ProductNode | null> {
  const response = await admin.graphql(GET_PRODUCT_QUERY, {
    variables: { id: productId },
  });
  const json = await response.json();
  const top = graphqlErrorMessage(json);
  if (top) throw new Error(top);

  const raw =
    json && typeof json === "object" && "data" in json
      ? (json as { data?: { product?: unknown } }).data?.product
      : undefined;
  if (raw == null) return null;

  const parsed = ProductNodeSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(
      "[shopify-fixes] ProductNode schema validation failed:",
      parsed.error.flatten(),
    );
    throw new Error("Shopify product response failed schema validation");
  }
  return parsed.data;
}

export async function applyColorFix(
  admin: AdminClient,
  productId: string,
  args: { optionId: string; optionValueId: string; newValue: string },
): Promise<{ error?: string }> {
  const mutationResponse = await admin.graphql(UPDATE_OPTION_MUTATION, {
    variables: {
      productId,
      option: { id: args.optionId },
      optionValuesToUpdate: [
        { id: args.optionValueId, name: args.newValue },
      ],
    },
  });
  const mutationJson = await mutationResponse.json();
  const topLevelError = graphqlErrorMessage(mutationJson);
  if (topLevelError) return { error: topLevelError };
  const payload = mutationJson.data?.productOptionUpdate;
  if (!payload) return { error: "Shopify productOptionUpdate returned no data" };
  const userErrors = payload.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      error: userErrors.map((e: { message: string }) => e.message).join("; "),
    };
  }
  return {};
}

/**
 * Apply productType and/or title (material) in one productUpdate when both
 * are requested. Separate sequential productUpdates would race and can
 * overwrite each other on Shopify.
 */
export async function applyProductFieldsFix(
  admin: AdminClient,
  productId: string,
  args: { productType?: string; title?: string },
): Promise<{ error?: string }> {
  const product: Record<string, string> = { id: productId };
  if (args.productType !== undefined) product.productType = args.productType;
  if (args.title !== undefined) product.title = args.title;
  if (Object.keys(product).length === 1) {
    return { error: "No product fields to update" };
  }

  const mutationResponse = await admin.graphql(UPDATE_PRODUCT_MUTATION, {
    variables: { product },
  });
  const mutationJson = await mutationResponse.json();
  const topLevelError = graphqlErrorMessage(mutationJson);
  if (topLevelError) return { error: topLevelError };
  const payload = mutationJson.data?.productUpdate;
  if (!payload) return { error: "Shopify productUpdate returned no data" };
  const userErrors = payload.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      error: userErrors.map((e: { message: string }) => e.message).join("; "),
    };
  }
  return {};
}

export type FixRequest = {
  field: FixableSignal;
  newValue: string;
  currentValue?: string;
  optionId?: string;
  optionValueId?: string;
};

function verifiedColor(product: ProductNode): string | null {
  return (
    product.options.find(
      (o) =>
        o.name.toLowerCase() === "color" || o.name.toLowerCase() === "colour",
    )?.optionValues[0]?.name ?? null
  );
}

/**
 * Apply one or many listing fixes.
 *
 * Parallelism rule:
 * - Color (productOptionUpdate) can run alongside productUpdate.
 * - Product type + material both use productUpdate → combined into ONE mutation
 *   to avoid lost-update races on title/productType.
 */
export async function applyShopifyFixes(
  admin: AdminClient,
  productId: string,
  fixes: FixRequest[],
): Promise<{ outcomes: FixOutcome[]; product: ProductNode | null }> {
  if (fixes.length === 0) {
    return { outcomes: [], product: await fetchProductNode(admin, productId) };
  }

  const colorFix = fixes.find((f) => f.field === "color");
  const typeFix = fixes.find((f) => f.field === "productType");
  const materialFix = fixes.find((f) => f.field === "material");

  let current: ProductNode | null = null;
  if (materialFix || typeFix) {
    current = await fetchProductNode(admin, productId);
    if (!current) {
      return {
        outcomes: fixes.map((f) => ({
          field: f.field,
          success: false,
          verifiedValue: null,
          error: "Product not found",
        })),
        product: null,
      };
    }
  }

  const productUpdate: { productType?: string; title?: string } = {};
  let materialPrepError: string | undefined;

  if (typeFix) {
    productUpdate.productType = typeFix.newValue;
  }

  if (materialFix && current) {
    const claimed =
      extractMaterialFromTitle(current.title) ??
      (materialFix.currentValue || "").trim().toLowerCase();
    if (!claimed) {
      materialPrepError =
        "No material claim found in the product title to update safely";
    } else {
      const nextTitle = replaceMaterialInTitle(
        current.title,
        claimed,
        materialFix.newValue,
      );
      if (!nextTitle) {
        materialPrepError = `Could not safely replace material "${claimed}" in title "${current.title}"`;
      } else if (nextTitle === current.title) {
        materialPrepError = "Material title rewrite produced no change";
      } else {
        productUpdate.title = nextTitle;
      }
    }
  }

  const colorOutcomePromise = (async (): Promise<FixOutcome | null> => {
    if (!colorFix) return null;
    if (!colorFix.optionId || !colorFix.optionValueId) {
      return {
        field: "color",
        success: false,
        verifiedValue: null,
        error: "Missing color option IDs",
      };
    }
    const result = await applyColorFix(admin, productId, {
      optionId: colorFix.optionId,
      optionValueId: colorFix.optionValueId,
      newValue: colorFix.newValue,
    });
    if (result.error) {
      return {
        field: "color",
        success: false,
        verifiedValue: null,
        error: result.error,
      };
    }
    return {
      field: "color",
      success: true,
      verifiedValue: colorFix.newValue,
    };
  })();

  const productOutcomePromise = (async (): Promise<FixOutcome[]> => {
    const outcomes: FixOutcome[] = [];
    if (materialFix && materialPrepError) {
      outcomes.push({
        field: "material",
        success: false,
        verifiedValue: null,
        error: materialPrepError,
      });
    }
    const hasProductFields =
      productUpdate.productType !== undefined ||
      productUpdate.title !== undefined;
    if (!hasProductFields) {
      if (typeFix && !productUpdate.productType) {
        outcomes.push({
          field: "productType",
          success: false,
          verifiedValue: null,
          error: "Product type update skipped",
        });
      }
      return outcomes;
    }

    const result = await applyProductFieldsFix(admin, productId, productUpdate);
    if (result.error) {
      if (typeFix && productUpdate.productType !== undefined) {
        outcomes.push({
          field: "productType",
          success: false,
          verifiedValue: null,
          error: result.error,
        });
      }
      if (materialFix && productUpdate.title !== undefined) {
        outcomes.push({
          field: "material",
          success: false,
          verifiedValue: null,
          error: result.error,
        });
      }
      return outcomes;
    }

    if (typeFix && productUpdate.productType !== undefined) {
      outcomes.push({
        field: "productType",
        success: true,
        verifiedValue: typeFix.newValue,
      });
    }
    if (materialFix && productUpdate.title !== undefined) {
      outcomes.push({
        field: "material",
        success: true,
        verifiedValue: materialFix.newValue,
      });
    }
    return outcomes;
  })();

  // Color option update is independent of productUpdate — run in parallel.
  const [colorOutcome, productOutcomes] = await Promise.all([
    colorOutcomePromise,
    productOutcomePromise,
  ]);

  const verified = await fetchProductNode(admin, productId);
  const outcomes: FixOutcome[] = [];

  if (colorOutcome) {
    if (!colorOutcome.success || !verified) {
      outcomes.push(colorOutcome);
    } else {
      const value = verifiedColor(verified);
      const expected = colorFix?.newValue ?? "";
      const success = value?.toLowerCase() === expected.toLowerCase();
      outcomes.push({
        field: "color",
        success,
        verifiedValue: value,
        error: success
          ? undefined
          : `Verification failed. Shopify shows: ${value ?? "unknown"}`,
      });
    }
  }

  for (const outcome of productOutcomes) {
    if (!outcome.success || !verified) {
      outcomes.push(outcome);
      continue;
    }
    if (outcome.field === "productType") {
      const value = verified.productType;
      const success =
        value?.toLowerCase() ===
        (typeFix?.newValue ?? "").toLowerCase();
      outcomes.push({
        field: "productType",
        success,
        verifiedValue: value,
        error: success
          ? undefined
          : `Verification failed. Shopify shows: ${value ?? "unknown"}`,
      });
    } else if (outcome.field === "material") {
      const value = extractMaterialFromTitle(verified.title);
      const success =
        value?.toLowerCase() ===
        (materialFix?.newValue ?? "").toLowerCase();
      outcomes.push({
        field: "material",
        success,
        verifiedValue: value,
        error: success
          ? undefined
          : `Verification failed. Shopify shows: ${value ?? "unknown"}`,
      });
    }
  }

  return { outcomes, product: verified };
}

export function fixRequestFromSuggested(
  fix: SuggestedFix,
  newValue?: string,
): FixRequest {
  return {
    field: fix.field,
    newValue: (newValue ?? fix.suggestedValue).trim(),
    currentValue: fix.currentValue,
    optionId: fix.optionId,
    optionValueId: fix.optionValueId,
  };
}
