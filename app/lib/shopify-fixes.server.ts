import { z } from "zod";
import type { FixableSignal, SuggestedFix } from "./types";
import {
  extractMaterialFromTitle,
  replaceMaterialInTitle,
  resolveClaimedMaterial,
} from "./consistency.server";
import {
  ensureSellenvoMetafieldDefinitions,
  fetchProductSellenvoMetafields,
  setProductSellenvoMetafield,
  type SellenvoMetafieldKey,
  type ProductMetafields,
} from "./metafields.server";
import { evaluateFixPolicy, type ShopFixSettings } from "./attributes";
import type { MaterialWriteMode } from "./shop-settings.server";

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
  let lastError: unknown;
  // One retry for transient tunnel/DNS blips ("fetch failed", no response)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
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
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        msg.includes("fetch failed") ||
        msg.includes("no response available") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ENOTFOUND");
      if (!transient || attempt === 1) break;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const msg =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    msg.includes("fetch failed") || msg.includes("no response available")
      ? "Could not reach Shopify Admin API (network). Retry, or restart `shopify app dev` and open the Preview URL from Admin."
      : msg,
  );
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

export type ApplyFixesOptions = {
  /** Server-side policy settings — client safeToApply is ignored */
  settings?: ShopFixSettings;
  /** Confirmed by merchant (or safe auto-fix path) */
  merchantConfirmed?: boolean;
};

function verifiedColor(product: ProductNode): string | null {
  return (
    product.options.find(
      (o) =>
        o.name.toLowerCase() === "color" || o.name.toLowerCase() === "colour",
    )?.optionValues[0]?.name ?? null
  );
}

function defaultFixSettings(): ShopFixSettings {
  return {
    safeAutoFixEnabled: false,
    materialWriteMode: "metafield",
    showExperimentalAttributes: false,
  };
}

/**
 * Apply one or many listing fixes.
 *
 * Parallelism rule:
 * - Color (productOptionUpdate) can run alongside productUpdate / metafields.
 * - Product type + material title both use productUpdate → combined into ONE mutation
 *   to avoid lost-update races on title/productType.
 * - Material metafield writes use metafieldsSet (independent).
 *
 * SECURITY: server re-evaluates FixPolicy; never trusts client safeToApply.
 */
export async function applyShopifyFixes(
  admin: AdminClient,
  productId: string,
  fixes: FixRequest[],
  options?: ApplyFixesOptions,
): Promise<{
  outcomes: FixOutcome[];
  product: ProductNode | null;
  metafields: ProductMetafields | null;
  timings: { mutateMs: number; verifyMs: number };
}> {
  const mutateStarted = Date.now();
  if (fixes.length === 0) {
    return {
      outcomes: [],
      product: await fetchProductNode(admin, productId),
      metafields: null,
      timings: { mutateMs: 0, verifyMs: 0 },
    };
  }

  const settings = options?.settings ?? defaultFixSettings();
  const merchantConfirmed = options?.merchantConfirmed !== false;

  const policyBlocked: FixOutcome[] = [];
  const allowedFixes: FixRequest[] = [];
  for (const fix of fixes) {
    const decision = evaluateFixPolicy(fix.field, settings);
    if (!decision.allowed) {
      policyBlocked.push({
        field: fix.field,
        success: false,
        verifiedValue: null,
        error: decision.reason,
      });
      continue;
    }
    if (decision.requiresConfirmation && !merchantConfirmed) {
      policyBlocked.push({
        field: fix.field,
        success: false,
        verifiedValue: null,
        error: "Merchant confirmation required",
      });
      continue;
    }
    allowedFixes.push(fix);
  }

  if (allowedFixes.length === 0) {
    return {
      outcomes: policyBlocked,
      product: await fetchProductNode(admin, productId),
      metafields: null,
      timings: { mutateMs: Date.now() - mutateStarted, verifyMs: 0 },
    };
  }

  const colorFix = allowedFixes.find((f) => f.field === "color");
  const typeFix = allowedFixes.find((f) => f.field === "productType");
  const materialFix = allowedFixes.find((f) => f.field === "material");
  const patternFix = allowedFixes.find((f) => f.field === "pattern");
  const finishFix = allowedFixes.find((f) => f.field === "finish");

  let current: ProductNode | null = null;
  if (materialFix || typeFix) {
    current = await fetchProductNode(admin, productId);
    if (!current) {
      return {
        outcomes: [
          ...policyBlocked,
          ...allowedFixes.map((f) => ({
            field: f.field,
            success: false,
            verifiedValue: null,
            error: "Product not found",
          })),
        ],
        product: null,
        metafields: null,
        timings: { mutateMs: Date.now() - mutateStarted, verifyMs: 0 },
      };
    }
  }

  const writeMode: MaterialWriteMode = settings.materialWriteMode;
  const productUpdate: { productType?: string; title?: string } = {};
  let materialPrepError: string | undefined;
  let materialNeedsMetafield = false;

  if (typeFix) {
    productUpdate.productType = typeFix.newValue;
  }

  if (materialFix && current) {
    materialNeedsMetafield =
      writeMode === "metafield" || writeMode === "both";
    const needsTitle = writeMode === "title" || writeMode === "both";

    if (needsTitle) {
      const claimed =
        extractMaterialFromTitle(current.title) ??
        (materialFix.currentValue || "").trim().toLowerCase();
      if (!claimed) {
        if (!materialNeedsMetafield) {
          materialPrepError =
            "No material claim found in the product title to update safely";
        }
      } else {
        const nextTitle = replaceMaterialInTitle(
          current.title,
          claimed,
          materialFix.newValue,
        );
        if (!nextTitle) {
          if (!materialNeedsMetafield) {
            materialPrepError = `Could not safely replace material "${claimed}" in title "${current.title}"`;
          }
        } else if (nextTitle === current.title) {
          if (!materialNeedsMetafield) {
            materialPrepError = "Material title rewrite produced no change";
          }
        } else {
          productUpdate.title = nextTitle;
        }
      }
    }

    if (materialNeedsMetafield) {
      await ensureSellenvoMetafieldDefinitions(admin);
    }
  }

  if (patternFix || finishFix) {
    await ensureSellenvoMetafieldDefinitions(admin);
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
    if (materialFix && materialPrepError && !materialNeedsMetafield) {
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
    } else {
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
      } else {
        if (typeFix && productUpdate.productType !== undefined) {
          outcomes.push({
            field: "productType",
            success: true,
            verifiedValue: typeFix.newValue,
          });
        }
        if (materialFix && productUpdate.title !== undefined && !materialNeedsMetafield) {
          outcomes.push({
            field: "material",
            success: true,
            verifiedValue: materialFix.newValue,
          });
        }
      }
    }

    // Metafield writes (material / pattern / finish)
    const metafieldWrites: Array<{
      field: FixableSignal;
      key: SellenvoMetafieldKey;
      value: string;
    }> = [];
    if (materialFix && materialNeedsMetafield && !materialPrepError) {
      metafieldWrites.push({
        field: "material",
        key: "material",
        value: materialFix.newValue,
      });
    } else if (
      materialFix &&
      materialNeedsMetafield &&
      materialPrepError &&
      writeMode === "metafield"
    ) {
      // title prep failed but metafield-only still OK
      metafieldWrites.push({
        field: "material",
        key: "material",
        value: materialFix.newValue,
      });
    } else if (materialFix && materialNeedsMetafield) {
      metafieldWrites.push({
        field: "material",
        key: "material",
        value: materialFix.newValue,
      });
    }
    if (patternFix) {
      metafieldWrites.push({
        field: "pattern",
        key: "pattern",
        value: patternFix.newValue,
      });
    }
    if (finishFix) {
      metafieldWrites.push({
        field: "finish",
        key: "finish",
        value: finishFix.newValue,
      });
    }

    const metafieldOutcomes = await Promise.all(
      metafieldWrites.map(async (write) => {
        const result = await setProductSellenvoMetafield(
          admin,
          productId,
          write.key,
          write.value,
        );
        if (result.error) {
          return {
            field: write.field,
            success: false,
            verifiedValue: null,
            error: result.error,
          } as FixOutcome;
        }
        return {
          field: write.field,
          success: true,
          verifiedValue: write.value,
        } as FixOutcome;
      }),
    );
    outcomes.push(...metafieldOutcomes);

    return outcomes;
  })();

  // Color option update is independent of productUpdate — run in parallel.
  const [colorOutcome, productOutcomes] = await Promise.all([
    colorOutcomePromise,
    productOutcomePromise,
  ]);
  const mutateMs = Date.now() - mutateStarted;

  const verifyStarted = Date.now();
  // Parallelize product refetch + metafield verify when needed
  const needsMeta = Boolean(materialFix || patternFix || finishFix);
  const [verified, metaVerified] = await Promise.all([
    fetchProductNode(admin, productId),
    needsMeta
      ? fetchProductSellenvoMetafields(admin, productId)
      : Promise.resolve(null),
  ]);
  const verifyMs = Date.now() - verifyStarted;
  const outcomes: FixOutcome[] = [...policyBlocked];

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
      const expected = (materialFix?.newValue ?? "").toLowerCase();
      let value: string | null = null;
      if (metaVerified?.material) {
        value = metaVerified.material;
      } else if (verified) {
        value = resolveClaimedMaterial({
          title: verified.title,
          metafieldValue: metaVerified?.material,
        }).claimedMaterial;
      }
      const success = value?.toLowerCase() === expected;
      outcomes.push({
        field: "material",
        success,
        verifiedValue: value,
        error: success
          ? undefined
          : `Verification failed. Shopify shows: ${value ?? "unknown"}`,
      });
    } else if (outcome.field === "pattern") {
      const value = metaVerified?.pattern ?? null;
      const success =
        value?.toLowerCase() === (patternFix?.newValue ?? "").toLowerCase();
      outcomes.push({
        field: "pattern",
        success,
        verifiedValue: value,
        error: success
          ? undefined
          : `Verification failed. Shopify shows: ${value ?? "unknown"}`,
      });
    } else if (outcome.field === "finish") {
      const value = metaVerified?.finish ?? null;
      const success =
        value?.toLowerCase() === (finishFix?.newValue ?? "").toLowerCase();
      outcomes.push({
        field: "finish",
        success,
        verifiedValue: value,
        error: success
          ? undefined
          : `Verification failed. Shopify shows: ${value ?? "unknown"}`,
      });
    }
  }

  return {
    outcomes,
    product: verified,
    metafields: metaVerified,
    timings: { mutateMs, verifyMs },
  };
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
