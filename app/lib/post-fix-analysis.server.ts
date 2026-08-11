/**
 * Targeted post-mutation analysis — no vision, no image download.
 * Uses verified Shopify product + cached VisualFacts only.
 */

import {
  buildAnalysisResultV2,
  extractListingFacts,
  findColorOptionIds,
} from "./consistency.server";
import { getCachedVisual } from "./vision-cache.server";
import { getShopSettings } from "./shop-settings.server";
import { persistAnalysis } from "./analysis-persist.server";
import { logEvent } from "./logger.server";
import { fetchProductSellenvoMetafields } from "./metafields.server";
import { resolveCategoryPack } from "./attributes";
import type { AnalysisResult } from "./types";
import type { AdminClient, ProductNode } from "./shopify-fixes.server";
import type { ProductMetafields } from "./metafields.server";

function productImageUrl(product: ProductNode): string | null {
  return (
    product.featuredMedia?.image?.url ??
    product.media?.nodes?.find((n) => n.image?.url)?.image?.url ??
    null
  );
}

export type PostFixAnalysisResult =
  | {
      ok: true;
      analysis: AnalysisResult;
      mode: "targeted-recheck";
      timings: {
        consistencyMs: number;
        persistMs: number;
        totalMs: number;
        cacheHit: true;
      };
    }
  | { ok: false; error: string; reason: "cache_miss" | "no_image" };

/**
 * After a successful mutation + Shopify field verification:
 * recompute consistency from cached vision + updated listing claims.
 *
 * NEVER downloads images or calls Groq.
 */
export async function recomputeAnalysisAfterFix(args: {
  shop: string;
  product: ProductNode;
  admin?: AdminClient;
  /** Metafields already verified during mutation (avoid extra Shopify round-trip) */
  metafields?: ProductMetafields | null;
}): Promise<PostFixAnalysisResult> {
  const totalStarted = Date.now();
  const imageUrl = productImageUrl(args.product);
  if (!imageUrl) {
    return { ok: false, error: "No product image", reason: "no_image" };
  }

  const visual = getCachedVisual(args.product.id, imageUrl);
  if (!visual) {
    return {
      ok: false,
      error: "Vision cache miss — targeted recheck unavailable",
      reason: "cache_miss",
    };
  }

  const consistencyStarted = Date.now();

  const [settings, metafields] = await Promise.all([
    getShopSettings(args.shop),
    args.metafields
      ? Promise.resolve(args.metafields)
      : args.admin
        ? fetchProductSellenvoMetafields(args.admin, args.product.id).catch(
            () => ({
              material: null,
              pattern: null,
              finish: null,
              sleeveType: null,
              neckline: null,
              closureType: null,
              shoeStyle: null,
              strapType: null,
            }),
          )
        : Promise.resolve({
            material: null,
            pattern: null,
            finish: null,
            sleeveType: null,
            neckline: null,
            closureType: null,
            shoeStyle: null,
            strapType: null,
          }),
  ]);

  const listing = extractListingFacts(args.product, {
    material: metafields?.material ?? undefined,
    pattern: metafields?.pattern ?? undefined,
    finish: metafields?.finish ?? undefined,
    sleeveType: metafields?.sleeveType ?? undefined,
    neckline: metafields?.neckline ?? undefined,
    closureType: metafields?.closureType ?? undefined,
    shoeStyle: metafields?.shoeStyle ?? undefined,
    strapType: metafields?.strapType ?? undefined,
  });
  const colorIds = findColorOptionIds(args.product);
  const analysis = buildAnalysisResultV2({
    listing,
    visual,
    imageUrl,
    productId: args.product.id,
    colorOptionId: colorIds?.optionId,
    colorOptionValueId: colorIds?.optionValueId,
    materialWriteMode: settings.materialWriteMode,
    includeExperimental:
      settings.showExperimentalAttributes ||
      Boolean(
        metafields?.pattern?.trim() ||
          metafields?.finish?.trim() ||
          metafields?.sleeveType?.trim() ||
          metafields?.neckline?.trim() ||
          metafields?.closureType?.trim() ||
          metafields?.shoeStyle?.trim() ||
          metafields?.strapType?.trim(),
      ) ||
      resolveCategoryPack(args.product.productType) !== "core",
  });
  analysis.analysisSource = "cached-recheck";
  const consistencyMs = Date.now() - consistencyStarted;

  const persistStarted = Date.now();
  try {
    await persistAnalysis({
      shop: args.shop,
      productId: args.product.id,
      productTitle: args.product.title,
      imageUrl,
      listing,
      visual,
      analysis,
    });
  } catch {
    /* non-fatal — UI still gets updated analysis */
  }
  const persistMs = Date.now() - persistStarted;
  const totalMs = Date.now() - totalStarted;

  logEvent({
    level: "info",
    event: "mutation.targeted_recheck",
    productId: args.product.id,
    durationMs: totalMs,
    details: {
      consistencyMs,
      persistMs,
      verdict: analysis.overallVerdict,
      cacheHit: true,
    },
  });

  return {
    ok: true,
    analysis,
    mode: "targeted-recheck",
    timings: {
      consistencyMs,
      persistMs,
      totalMs,
      cacheHit: true,
    },
  };
}
