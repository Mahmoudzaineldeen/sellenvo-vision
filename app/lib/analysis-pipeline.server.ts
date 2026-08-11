import {
  downloadProductImage,
  formatVisionUserError,
  isVisionRateLimitError,
  toVisionOptimizedImageUrl,
} from "./vision.server";
import { analyzeWithProviders } from "./vision";
import { extractDominantColor } from "./color-analysis.server";
import {
  buildAnalysisResultV2,
  extractListingFacts,
  findColorOptionIds,
} from "./consistency.server";
import {
  getCachedVisual,
  setCachedVisual,
} from "./vision-cache.server";
import { logEvent } from "./logger.server";
import type { AnalysisResult, VisualFacts } from "./types";
import type { AdminClient, ProductNode } from "./shopify-fixes.server";
import { fetchProductNode } from "./shopify-fixes.server";
import { fetchProductSellenvoMetafields } from "./metafields.server";
import { getShopSettings } from "./shop-settings.server";
import {
  getLatestAnalysisForProduct,
  persistAnalysis,
} from "./analysis-persist.server";

export type AnalysisTimings = {
  productFetchMs: number;
  visionMs: number;
  pixelMs: number;
  consistencyMs: number;
  totalMs: number;
  cacheHit: boolean;
};

export type AnalyzePipelineResult =
  | {
      ok: true;
      analysis: AnalysisResult;
      product: ProductNode;
      timings: AnalysisTimings;
      mode: "full" | "cached-recheck";
      analysisId?: string;
    }
  | { ok: false; error: string };

export type PipelineContext = {
  shop?: string;
  includeExperimental?: boolean;
  requireEnsembleAgreement?: boolean;
};

function getImageUrl(product: ProductNode): string | null {
  return (
    product.featuredMedia?.image?.url ??
    product.media?.nodes?.find((n) => n.image?.url)?.image?.url ??
    null
  );
}

function isPlaceholderImage(url: string | null): boolean {
  if (!url) return true;
  const u = url.toLowerCase();
  return (
    u.includes("placeholder") ||
    u.includes("no-image") ||
    u.includes("image_large.png") ||
    u.includes("cdn.shopify.com/s/files/1/0533/2089")
  );
}

/**
 * Rebuild a displayable AnalysisResult from a persisted Analysis row.
 * Used for instant Guardian paint when the image URL is unchanged.
 */
export function analysisFromPersistedRow(row: {
  imageUrl: string | null;
  verdict: string;
  healthScore: number;
  overallConfidence: number;
  issuesJson: string;
  signalResultsJson: string;
  suggestedFixesJson: string;
  visualJson: string;
}): AnalysisResult | null {
  if (!row.imageUrl) return null;
  try {
    const visual = JSON.parse(row.visualJson) as VisualFacts;
    const signalResults = JSON.parse(row.signalResultsJson);
    const issues = JSON.parse(row.issuesJson);
    const suggestedFixes = JSON.parse(row.suggestedFixesJson);
    if (!visual?.visionColor || !Array.isArray(signalResults)) return null;
    return {
      overallVerdict: row.verdict as AnalysisResult["overallVerdict"],
      overallConfidence: row.overallConfidence,
      healthScore: row.healthScore,
      signalResults,
      issues: Array.isArray(issues) ? issues : [],
      imageQuality: visual.imageQuality ?? "fair",
      imageQualityNote: null,
      visionReasoning: visual.visionReasoning ?? "",
      imageUrl: row.imageUrl,
      suggestedFixes: Array.isArray(suggestedFixes) ? suggestedFixes : [],
      analysisSource: "cached-recheck",
    };
  } catch {
    return null;
  }
}

/**
 * Hydrate in-memory vision cache from the latest DB analysis for this image.
 */
export async function hydrateVisualCacheFromDb(
  shop: string,
  productId: string,
  imageUrl: string,
): Promise<VisualFacts | null> {
  try {
    const row = await getLatestAnalysisForProduct(shop, productId);
    if (!row?.imageUrl || row.imageUrl !== imageUrl || !row.visualJson) {
      return null;
    }
    const visual = JSON.parse(row.visualJson) as VisualFacts;
    if (!visual?.visionColor) return null;
    setCachedVisual(productId, imageUrl, visual);
    return visual;
  } catch {
    return null;
  }
}

async function buildVisualFacts(
  imageUrl: string,
  opts?: PipelineContext,
): Promise<{ visual: VisualFacts; visionMs: number; pixelMs: number }> {
  const visionOpts = {
    includeExperimental: opts?.includeExperimental,
    requireEnsembleAgreement: opts?.requireEnsembleAgreement,
  };

  const visionImageUrl = toVisionOptimizedImageUrl(imageUrl);
  const canUseRemoteUrl =
    visionImageUrl.startsWith("https://") && !visionImageUrl.startsWith("data:");

  const visionStarted = Date.now();
  // Start CDN download for pixel in parallel with Groq URL vision —
  // never wait on download before kicking off the model.
  const downloadPromise = downloadProductImage(imageUrl).catch((err) => {
    logEvent({
      level: "warn",
      event: "analysis.image.download.failed",
      details: {
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return null;
  });

  let vision;
  let visionProviderId = "groq";
  if (canUseRemoteUrl) {
    try {
      const result = await analyzeWithProviders({
        imageUrl: visionImageUrl,
        ...visionOpts,
      });
      vision = result.response;
      visionProviderId = result.providerId;
    } catch (urlErr) {
      // Rate limit: never fall back to base64 — that burns far more TPD.
      if (isVisionRateLimitError(urlErr)) throw urlErr;
      const downloaded = await downloadPromise;
      if (!downloaded) throw urlErr;
      const result = await analyzeWithProviders({
        dataUri: downloaded.dataUri,
        imageUrl: visionImageUrl,
        ...visionOpts,
      });
      vision = result.response;
      visionProviderId = result.providerId;
    }
  } else {
    const downloaded = await downloadPromise;
    if (!downloaded) {
      throw new Error("Could not download product image for vision analysis");
    }
    const result = await analyzeWithProviders({
      dataUri: downloaded.dataUri,
      imageUrl,
      ...visionOpts,
    });
    vision = result.response;
    visionProviderId = result.providerId;
  }
  const visionMs = Date.now() - visionStarted;
  logEvent({
    level: "info",
    event: "analysis.vision.completed",
    durationMs: visionMs,
    details: { providerId: visionProviderId },
  });

  const pixelStarted = Date.now();
  let pixelColor: string | undefined;
  let pixelHex: string | undefined;
  let pixelConfidence: number | undefined;
  const downloaded = await downloadPromise;
  if (downloaded) {
    const pixel = await extractDominantColor(downloaded.buffer);
    if (pixel) {
      pixelColor = pixel.colorName;
      pixelHex = pixel.hex;
      pixelConfidence = pixel.confidence;
    }
  }
  const pixelMs = Date.now() - pixelStarted;

  const visual: VisualFacts = {
    visionColor: vision.primaryColor,
    visionConfidence: vision.colorConfidence,
    visionReasoning: vision.reasoning,
    visionProductType: vision.productType,
    visionProductTypeConfidence: vision.productTypeConfidence,
    visionMaterial: vision.material ?? null,
    visionMaterialConfidence: vision.materialConfidence ?? null,
    visionPattern: vision.pattern ?? null,
    visionPatternConfidence: vision.patternConfidence ?? null,
    visionFinish: vision.finish ?? null,
    visionFinishConfidence: vision.finishConfidence ?? null,
    imageQuality: vision.imageQuality,
    pixelColor,
    pixelHex,
    pixelConfidence,
  };

  return { visual, visionMs, pixelMs };
}


async function runConsistency(
  admin: AdminClient,
  product: ProductNode,
  visual: VisualFacts,
  imageUrl: string,
  opts?: PipelineContext,
): Promise<{ analysis: AnalysisResult; consistencyMs: number; listing: ReturnType<typeof extractListingFacts> }> {
  const started = Date.now();

  // Parallelize independent reads
  const [metafieldsResult, settingsResult] = await Promise.all([
    fetchProductSellenvoMetafields(admin, product.id).catch(() => ({
      material: null as string | null,
      pattern: null as string | null,
      finish: null as string | null,
    })),
    opts?.shop
      ? getShopSettings(opts.shop).catch(() => null)
      : Promise.resolve(null),
  ]);

  const metafields = metafieldsResult;
  let materialWriteMode: "metafield" | "title" | "both" = "metafield";
  let includeExperimental = opts?.includeExperimental === true;
  if (settingsResult) {
    materialWriteMode = settingsResult.materialWriteMode;
    includeExperimental =
      includeExperimental || settingsResult.showExperimentalAttributes;
  }

  const listing = extractListingFacts(product, metafields);
  const colorIds = findColorOptionIds(product);
  const analysis = buildAnalysisResultV2({
    listing,
    visual,
    imageUrl,
    productId: product.id,
    colorOptionId: colorIds?.optionId,
    colorOptionValueId: colorIds?.optionValueId,
    materialWriteMode,
    includeExperimental,
  });
  return { analysis, consistencyMs: Date.now() - started, listing };
}

/**
 * Full vision path. Always refreshes the visual cache for this image.
 */
export async function runFullAnalysis(
  admin: AdminClient,
  productId: string,
  ctx?: PipelineContext,
): Promise<AnalyzePipelineResult> {
  const totalStarted = Date.now();
  try {
    const fetchStarted = Date.now();
    const product = await fetchProductNode(admin, productId);
    const productFetchMs = Date.now() - fetchStarted;
    if (!product) return { ok: false, error: "Product not found" };

    const imageUrl = getImageUrl(product);
    if (!imageUrl || isPlaceholderImage(imageUrl)) {
      return {
        ok: false,
        error:
          "Product still has a blank/placeholder image. Click “Replace with black wallet demo image” first.",
      };
    }

    const { visual, visionMs, pixelMs } = await buildVisualFacts(imageUrl, ctx);
    setCachedVisual(product.id, imageUrl, visual);

    const { analysis, consistencyMs, listing } = await runConsistency(
      admin,
      product,
      visual,
      imageUrl,
      ctx,
    );
    analysis.analysisSource = "full";

    let analysisId: string | undefined;
    if (ctx?.shop) {
      try {
        analysisId = await persistAnalysis({
          shop: ctx.shop,
          productId: product.id,
          productTitle: product.title,
          imageUrl,
          listing,
          visual,
          analysis,
        });
      } catch (err) {
        logEvent({
          level: "warn",
          event: "analysis.persist.failed",
          productId,
          details: {
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    const timings: AnalysisTimings = {
      productFetchMs,
      visionMs,
      pixelMs,
      consistencyMs,
      totalMs: Date.now() - totalStarted,
      cacheHit: false,
    };
    logEvent({
      level: "info",
      event: "analysis.full.completed",
      productId,
      durationMs: timings.totalMs,
      details: {
        productFetchMs,
        visionMs,
        pixelMs,
        consistencyMs,
        verdict: analysis.overallVerdict,
        healthScore: analysis.healthScore,
      },
    });

    return { ok: true, analysis, product, timings, mode: "full", analysisId };
  } catch (err) {
    // Soft recovery: if Groq TPD is exhausted, serve cached vision instead of failing hard.
    // Do NOT call runListingRecheck here — it falls back to runFullAnalysis and would recurse.
    if (isVisionRateLimitError(err)) {
      const friendly = formatVisionUserError(err);
      logEvent({
        level: "warn",
        event: "analysis.full.rate_limited",
        productId,
        details: { error: friendly },
      });

      try {
        const product = await fetchProductNode(admin, productId);
        if (product) {
          const imageUrl = getImageUrl(product);
          if (imageUrl && !isPlaceholderImage(imageUrl)) {
            const cached =
              getCachedVisual(product.id, imageUrl) ??
              (ctx?.shop
                ? await hydrateVisualCacheFromDb(ctx.shop, product.id, imageUrl)
                : null);
            if (cached) {
              const { analysis, consistencyMs, listing } = await runConsistency(
                admin,
                product,
                cached,
                imageUrl,
                ctx,
              );
              analysis.analysisSource = "cached-recheck";
              analysis.visionReasoning = `${analysis.visionReasoning} [Groq rate-limited — cached vision]`;
              if (ctx?.shop) {
                try {
                  await persistAnalysis({
                    shop: ctx.shop,
                    productId: product.id,
                    productTitle: product.title,
                    imageUrl,
                    listing,
                    visual: cached,
                    analysis,
                  });
                } catch {
                  /* non-fatal */
                }
              }
              return {
                ok: true,
                analysis,
                product,
                timings: {
                  productFetchMs: 0,
                  visionMs: 0,
                  pixelMs: 0,
                  consistencyMs,
                  totalMs: Date.now() - totalStarted,
                  cacheHit: true,
                },
                mode: "cached-recheck",
              };
            }
          }
        }
      } catch {
        /* fall through to rate-limit error */
      }

      return { ok: false, error: friendly };
    }

    logEvent({
      level: "error",
      event: "analysis.full.failed",
      productId,
      details: {
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return {
      ok: false,
      error: formatVisionUserError(err),
    };
  }
}

/**
 * Listing-only recheck: reuse cached vision when the image URL is unchanged.
 * Falls back to full analysis on cache miss / image change.
 */
export async function runListingRecheck(
  admin: AdminClient,
  productId: string,
  product?: ProductNode | null,
  ctx?: PipelineContext,
): Promise<AnalyzePipelineResult> {
  const totalStarted = Date.now();
  try {
    const fetchStarted = Date.now();
    const resolved =
      product ?? (await fetchProductNode(admin, productId));
    const productFetchMs = Date.now() - fetchStarted;
    if (!resolved) return { ok: false, error: "Product not found" };

    const imageUrl = getImageUrl(resolved);
    if (!imageUrl || isPlaceholderImage(imageUrl)) {
      return {
        ok: false,
        error:
          "Product still has a blank/placeholder image. Attach a real product photo first.",
      };
    }

    const cached =
      getCachedVisual(resolved.id, imageUrl) ??
      (ctx?.shop
        ? await hydrateVisualCacheFromDb(ctx.shop, resolved.id, imageUrl)
        : null);
    if (!cached) {
      return runFullAnalysis(admin, productId, ctx);
    }

    const { analysis, consistencyMs, listing } = await runConsistency(
      admin,
      resolved,
      cached,
      imageUrl,
      ctx,
    );
    analysis.analysisSource = "cached-recheck";

    let analysisId: string | undefined;
    if (ctx?.shop) {
      try {
        analysisId = await persistAnalysis({
          shop: ctx.shop,
          productId: resolved.id,
          productTitle: resolved.title,
          imageUrl,
          listing,
          visual: cached,
          analysis,
        });
      } catch {
        /* non-fatal */
      }
    }

    const timings: AnalysisTimings = {
      productFetchMs,
      visionMs: 0,
      pixelMs: 0,
      consistencyMs,
      totalMs: Date.now() - totalStarted,
      cacheHit: true,
    };
    logEvent({
      level: "info",
      event: "analysis.recheck.completed",
      productId,
      durationMs: timings.totalMs,
      details: {
        productFetchMs,
        consistencyMs,
        verdict: analysis.overallVerdict,
        healthScore: analysis.healthScore,
        cacheHit: true,
      },
    });

    return {
      ok: true,
      analysis,
      product: resolved,
      timings,
      mode: "cached-recheck",
      analysisId,
    };
  } catch (err) {
    logEvent({
      level: "error",
      event: "analysis.recheck.failed",
      productId,
      details: {
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Listing recheck failed",
    };
  }
}

export { getImageUrl, isPlaceholderImage };
