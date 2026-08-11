import {
  analyzeProductImageDataUri,
  downloadProductImage,
} from "./vision.server";
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
    }
  | { ok: false; error: string };

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

async function buildVisualFacts(
  imageUrl: string,
): Promise<{ visual: VisualFacts; visionMs: number; pixelMs: number }> {
  // Single download shared by vision + optional pixel analysis.
  const downloaded = await downloadProductImage(imageUrl);

  const visionStarted = Date.now();
  const vision = await analyzeProductImageDataUri(downloaded.dataUri);
  const visionMs = Date.now() - visionStarted;

  const pixelStarted = Date.now();
  let pixelColor: string | undefined;
  let pixelHex: string | undefined;
  let pixelConfidence: number | undefined;
  const pixel = await extractDominantColor(downloaded.buffer);
  if (pixel) {
    pixelColor = pixel.colorName;
    pixelHex = pixel.hex;
    pixelConfidence = pixel.confidence;
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
    imageQuality: vision.imageQuality,
    pixelColor,
    pixelHex,
    pixelConfidence,
  };

  return { visual, visionMs, pixelMs };
}

function runConsistency(
  product: ProductNode,
  visual: VisualFacts,
  imageUrl: string,
): { analysis: AnalysisResult; consistencyMs: number } {
  const started = Date.now();
  const listing = extractListingFacts(product);
  const colorIds = findColorOptionIds(product);
  const analysis = buildAnalysisResultV2({
    listing,
    visual,
    imageUrl,
    productId: product.id,
    colorOptionId: colorIds?.optionId,
    colorOptionValueId: colorIds?.optionValueId,
  });
  return { analysis, consistencyMs: Date.now() - started };
}

/**
 * Full vision path. Always refreshes the visual cache for this image.
 */
export async function runFullAnalysis(
  admin: AdminClient,
  productId: string,
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

    const { visual, visionMs, pixelMs } = await buildVisualFacts(imageUrl);
    setCachedVisual(product.id, imageUrl, visual);

    const { analysis, consistencyMs } = runConsistency(
      product,
      visual,
      imageUrl,
    );
    analysis.analysisSource = "full";

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

    return { ok: true, analysis, product, timings, mode: "full" };
  } catch (err) {
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
      error:
        err instanceof Error
          ? err.message
          : "Vision analysis failed. Check GROQ_API_KEY and try again.",
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

    const cached = getCachedVisual(resolved.id, imageUrl);
    if (!cached) {
      return runFullAnalysis(admin, productId);
    }

    const { analysis, consistencyMs } = runConsistency(
      resolved,
      cached,
      imageUrl,
    );
    analysis.analysisSource = "cached-recheck";

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
