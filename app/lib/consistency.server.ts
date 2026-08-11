import type {
  ListingFacts,
  VisualFacts,
  Verdict,
  AnalysisResult,
  SuggestedFix,
  SignalResult,
  ConsistencyIssue,
} from "./types";
import { colorsMatch, normalizeColorName } from "./color-normalize.server";
import { productTypesMatch } from "./product-type-normalize.server";
import {
  MATERIAL_KEYWORDS,
  materialsMatch,
  normalizeMaterialName,
} from "./materials";

const CONFIDENCE_THRESHOLD = 0.7;

const RECOGNIZED_MATERIALS = new Set<string>(MATERIAL_KEYWORDS);

const BASE_WEIGHTS: Record<"color" | "productType" | "material", number> = {
  color: 0.5,
  productType: 0.25,
  material: 0.25,
};

export {
  MATERIAL_KEYWORDS,
  materialsMatch,
  normalizeMaterialName,
} from "./materials";

/**
 * Preserve existing pixel + vision color confidence strategy exactly
 * (formerly deriveConfidence).
 */
export function blendColorConfidence(
  visionConfidence: number,
  pixelConfidence?: number,
): number {
  if (pixelConfidence !== undefined) {
    return visionConfidence * 0.7 + pixelConfidence * 0.3;
  }
  return visionConfidence;
}

/** @deprecated Use blendColorConfidence — kept as alias for clarity during migration */
export const deriveConfidence = blendColorConfidence;

export function computeHealthScore(
  verdict: Verdict,
  confidence: number,
): number {
  if (verdict === "MATCH") return 100;
  if (verdict === "UNCERTAIN") return 75;
  return Math.round(100 - confidence * 50);
}

function capitalizeLabel(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract the first known material keyword from a product title. */
export function extractMaterialFromTitle(title: string): string | null {
  const lower = title.toLowerCase();
  for (const keyword of MATERIAL_KEYWORDS) {
    const re = new RegExp(`\\b${keyword}\\b`, "i");
    if (re.test(lower)) return keyword;
  }
  return null;
}

/**
 * Replace the claimed material token in a title, preserving surrounding words.
 * Returns null when the current material claim is not present as a whole word.
 */
export function replaceMaterialInTitle(
  title: string,
  currentMaterial: string,
  newMaterial: string,
): string | null {
  const current = currentMaterial.toLowerCase().trim();
  const next = newMaterial.toLowerCase().trim();
  if (!current || !next) return null;

  const re = new RegExp(`\\b${escapeRegExp(current)}\\b`, "i");
  if (!re.test(title)) return null;

  return title.replace(re, (matched) => {
    if (matched === matched.toUpperCase() && matched.length > 1) {
      return next.toUpperCase();
    }
    if (matched[0] === matched[0].toUpperCase()) {
      return capitalizeLabel(next);
    }
    return next;
  });
}

function pushIssue(
  issues: ConsistencyIssue[],
  result: SignalResult,
): void {
  if (result.verdict === "MATCH") return;
  if (result.confidence === null || result.detected === null) return;
  issues.push({
    signal: result.signal,
    claimed: result.claimed,
    detected: result.detected,
    confidence: result.confidence,
    verdict: result.verdict,
    evidence: result.evidence,
  });
}

/**
 * Evaluate each available signal independently.
 * Missing signals are omitted from both signalResults and issues.
 * MATCH results appear only in signalResults.
 */
export function evaluateConsistency(
  listing: ListingFacts,
  visual: VisualFacts,
): { signalResults: SignalResult[]; issues: ConsistencyIssue[] } {
  const signalResults: SignalResult[] = [];
  const issues: ConsistencyIssue[] = [];

  // --- Color signal ---
  if (listing.claimedColor) {
    const confidence = blendColorConfidence(
      visual.visionConfidence,
      visual.pixelConfidence,
    );
    const detected = normalizeColorName(visual.visionColor);
    const match = colorsMatch(listing.claimedColor, visual.visionColor);

    let verdict: Verdict;
    let evidence: string;

    if (match) {
      verdict = "MATCH";
      evidence = visual.visionReasoning;
    } else if (confidence >= CONFIDENCE_THRESHOLD) {
      verdict = "MISMATCH";
      const pct = Math.round(visual.visionConfidence * 100);
      evidence = `Vision detected "${detected}" (vision confidence ${pct}%). Listing claims "${listing.claimedColor}".`;
      if (
        visual.pixelColor &&
        colorsMatch(visual.pixelColor, visual.visionColor)
      ) {
        evidence += ` Pixel analysis independently confirmed: ${visual.pixelHex} maps to "${visual.pixelColor}".`;
      }
      evidence += ` ${visual.visionReasoning}`;
    } else {
      verdict = "UNCERTAIN";
      evidence = `Low confidence color detection. ${visual.visionReasoning}`;
    }

    const colorResult: SignalResult = {
      signal: "color",
      claimed: listing.claimedColor,
      detected,
      confidence,
      verdict,
      evidence,
    };
    signalResults.push(colorResult);
    pushIssue(issues, colorResult);
  }

  // --- Product type signal ---
  if (
    listing.productType &&
    listing.productType.trim() !== "" &&
    visual.visionProductType &&
    visual.visionProductType.trim() !== ""
  ) {
    const confidence = visual.visionProductTypeConfidence;
    const match = productTypesMatch(
      listing.productType,
      visual.visionProductType,
    );

    let verdict: Verdict;
    let evidence: string;

    if (match) {
      verdict = "MATCH";
      evidence = `Product type matches: listing "${listing.productType}" ≈ detected "${visual.visionProductType}".`;
    } else if (confidence >= CONFIDENCE_THRESHOLD) {
      verdict = "MISMATCH";
      evidence = `Product type mismatch: listing "${listing.productType}" vs detected "${visual.visionProductType}" (vision confidence ${Math.round(confidence * 100)}%).`;
    } else {
      verdict = "UNCERTAIN";
      evidence = `Low confidence product type comparison: listing "${listing.productType}" vs detected "${visual.visionProductType}".`;
    }

    const ptResult: SignalResult = {
      signal: "productType",
      claimed: listing.productType,
      detected: visual.visionProductType.toLowerCase().trim(),
      confidence,
      verdict,
      evidence,
    };
    signalResults.push(ptResult);
    pushIssue(issues, ptResult);
  }

  // --- Material signal ---
  // Unrecognized vision materials (canvas, suede, …) are treated as unknown
  // to avoid false MISMATCH against listing keywords.
  const visionMaterialRaw = visual.visionMaterial;
  const visionMaterialConfidence = visual.visionMaterialConfidence;
  if (
    listing.claimedMaterial &&
    visionMaterialRaw !== null &&
    visionMaterialConfidence !== null
  ) {
    const detected = normalizeMaterialName(visionMaterialRaw);
    const recognized =
      detected !== "" &&
      detected !== "unknown" &&
      RECOGNIZED_MATERIALS.has(detected);

    if (recognized) {
      const claimed = listing.claimedMaterial.toLowerCase().trim();
      const confidence = visionMaterialConfidence;
      const match = materialsMatch(claimed, detected);

      let verdict: Verdict;
      let evidence: string;

      if (match) {
        verdict = "MATCH";
        evidence = `Material matches: "${claimed}".`;
      } else if (confidence >= CONFIDENCE_THRESHOLD) {
        verdict = "MISMATCH";
        evidence = `Material mismatch: listing "${claimed}" vs detected "${detected}" (vision confidence ${Math.round(confidence * 100)}%).`;
      } else {
        verdict = "UNCERTAIN";
        evidence = `Low confidence material comparison: listing "${claimed}" vs detected "${detected}".`;
      }

      const matResult: SignalResult = {
        signal: "material",
        claimed: listing.claimedMaterial,
        detected,
        confidence,
        verdict,
        evidence,
      };
      signalResults.push(matResult);
      pushIssue(issues, matResult);
    }
  }

  return { signalResults, issues };
}

/**
 * Dynamic weight redistribution among available signals.
 * Image quality is NEVER included.
 */
export function computeOverallConfidence(
  signalResults: SignalResult[],
): number {
  const available = signalResults.filter(
    (s) => s.confidence !== null && s.signal in BASE_WEIGHTS,
  );
  if (available.length === 0) return 0;

  const totalBase = available.reduce(
    (sum, s) => sum + BASE_WEIGHTS[s.signal],
    0,
  );
  if (totalBase === 0) return 0;

  return available.reduce((sum, s) => {
    const weight = BASE_WEIGHTS[s.signal] / totalBase;
    return sum + (s.confidence as number) * weight;
  }, 0);
}

function computeOverallVerdict(
  issues: ConsistencyIssue[],
  imageQuality: "good" | "fair" | "poor",
): Verdict {
  if (imageQuality === "poor") return "UNCERTAIN";
  if (issues.some((i) => i.verdict === "MISMATCH")) return "MISMATCH";
  if (issues.some((i) => i.verdict === "UNCERTAIN")) return "UNCERTAIN";
  return "MATCH";
}

/**
 * Build a full AnalysisResult from listing + visual facts and optional fix IDs.
 */
export function buildAnalysisResultV2(args: {
  listing: ListingFacts;
  visual: VisualFacts;
  imageUrl: string;
  productId: string;
  colorOptionId?: string;
  colorOptionValueId?: string;
}): AnalysisResult {
  const {
    listing,
    visual,
    imageUrl,
    productId,
    colorOptionId,
    colorOptionValueId,
  } = args;

  const { signalResults, issues } = evaluateConsistency(listing, visual);
  let overallConfidence = computeOverallConfidence(signalResults);
  let overallVerdict = computeOverallVerdict(issues, visual.imageQuality);

  let imageQualityNote: string | null = null;
  if (visual.imageQuality === "fair") {
    imageQualityNote =
      "Image quality is fair; visual evidence has reduced reliability";
  } else if (visual.imageQuality === "poor") {
    imageQualityNote =
      "Image quality is poor; visual evidence is unreliable";
    overallVerdict = "UNCERTAIN";
  }

  // Extreme edge: no signals evaluated
  if (signalResults.length === 0) {
    overallVerdict = "UNCERTAIN";
    overallConfidence = 0;
  }

  const healthScore = computeHealthScore(overallVerdict, overallConfidence);

  const suggestedFixes: SuggestedFix[] = [];

  const colorIssue = issues.find(
    (i) => i.signal === "color" && i.verdict === "MISMATCH",
  );
  const colorSignal = signalResults.find((s) => s.signal === "color");

  if (
    colorIssue &&
    colorSignal &&
    colorSignal.confidence !== null &&
    colorSignal.confidence >= CONFIDENCE_THRESHOLD &&
    visual.imageQuality !== "poor" &&
    listing.claimedColor &&
    colorSignal.detected &&
    colorOptionId &&
    colorOptionValueId
  ) {
    suggestedFixes.push({
      field: "color",
      currentValue: listing.claimedColor,
      suggestedValue: capitalizeLabel(colorSignal.detected),
      productId,
      optionId: colorOptionId,
      optionValueId: colorOptionValueId,
    });
  }

  const typeIssue = issues.find(
    (i) => i.signal === "productType" && i.verdict === "MISMATCH",
  );
  const typeSignal = signalResults.find((s) => s.signal === "productType");

  if (
    typeIssue &&
    typeSignal &&
    typeSignal.confidence !== null &&
    typeSignal.confidence >= CONFIDENCE_THRESHOLD &&
    visual.imageQuality !== "poor" &&
    listing.productType &&
    typeSignal.detected
  ) {
    suggestedFixes.push({
      field: "productType",
      currentValue: listing.productType,
      suggestedValue: capitalizeLabel(typeSignal.detected),
      productId,
    });
  }

  const materialIssue = issues.find(
    (i) => i.signal === "material" && i.verdict === "MISMATCH",
  );
  const materialSignal = signalResults.find((s) => s.signal === "material");

  if (
    materialIssue &&
    materialSignal &&
    materialSignal.confidence !== null &&
    materialSignal.confidence >= CONFIDENCE_THRESHOLD &&
    visual.imageQuality !== "poor" &&
    listing.claimedMaterial &&
    materialSignal.detected &&
    // Title is the canonical material claim in this app — only offer a fix
    // when the claimed token is actually present for a safe title rewrite.
    replaceMaterialInTitle(
      listing.productTitle,
      listing.claimedMaterial,
      materialSignal.detected,
    ) !== null
  ) {
    suggestedFixes.push({
      field: "material",
      currentValue: capitalizeLabel(listing.claimedMaterial),
      suggestedValue: capitalizeLabel(materialSignal.detected),
      productId,
    });
  }

  return {
    overallVerdict,
    overallConfidence,
    healthScore,
    signalResults,
    issues,
    imageQuality: visual.imageQuality,
    imageQualityNote,
    visionReasoning: visual.visionReasoning,
    imageUrl,
    suggestedFixes,
  };
}

/**
 * Extract ListingFacts from a Shopify product's title/type/options.
 */
export function extractListingFacts(product: {
  title: string;
  productType?: string | null;
  options: Array<{ name: string; optionValues: Array<{ name: string }> }>;
}): ListingFacts {
  const colorOption = product.options.find(
    (o) => o.name.toLowerCase() === "color" || o.name.toLowerCase() === "colour",
  );
  const claimedColor = colorOption?.optionValues[0]?.name ?? null;

  return {
    claimedColor,
    productTitle: product.title,
    productType: product.productType ?? null,
    claimedMaterial: extractMaterialFromTitle(product.title),
  };
}

/**
 * Find the Color option + first value IDs for mutation targeting.
 */
export function findColorOptionIds(product: {
  options: Array<{
    id: string;
    name: string;
    optionValues: Array<{ id: string; name: string }>;
  }>;
}): { optionId: string; optionValueId: string } | null {
  const colorOption = product.options.find(
    (o) => o.name.toLowerCase() === "color" || o.name.toLowerCase() === "colour",
  );
  if (!colorOption || !colorOption.optionValues[0]) return null;
  return {
    optionId: colorOption.id,
    optionValueId: colorOption.optionValues[0].id,
  };
}
