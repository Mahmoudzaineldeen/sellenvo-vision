import type {
  ListingFacts,
  VisualFacts,
  Verdict,
  AnalysisResult,
  SuggestedFix,
  SignalResult,
  ConsistencyIssue,
} from "./types";
import { colorsMatch, normalizeColorName } from "./color-normalize";
import { productTypesMatch } from "./product-type-normalize";
import {
  MATERIAL_KEYWORDS,
  materialsMatch,
  normalizeMaterialName,
} from "./materials";
import {
  getAttribute,
  EXPERIMENTAL_METAFIELD_KEYS,
  selectAttributeKeysForProduct,
} from "./attributes";
import type { AttributeKey } from "./attributes";

const CONFIDENCE_THRESHOLD = 0.7;

const RECOGNIZED_MATERIALS = new Set<string>(MATERIAL_KEYWORDS);

const BASE_WEIGHTS: Record<string, number> = {
  color: 0.5,
  productType: 0.25,
  material: 0.25,
  pattern: 0.15,
  finish: 0.15,
  sleeveType: 0.12,
  neckline: 0.12,
  closureType: 0.12,
  shoeStyle: 0.15,
  strapType: 0.12,
};

/** Map experimental attribute → listing claim + visual fields */
const EXPERIMENTAL_SIGNAL_MAP: Record<
  string,
  {
    claimed: (l: ListingFacts) => string | null | undefined;
    detected: (v: VisualFacts) => string | null | undefined;
    confidence: (v: VisualFacts) => number | null | undefined;
  }
> = {
  pattern: {
    claimed: (l) => l.claimedPattern,
    detected: (v) => v.visionPattern,
    confidence: (v) => v.visionPatternConfidence,
  },
  finish: {
    claimed: (l) => l.claimedFinish,
    detected: (v) => v.visionFinish,
    confidence: (v) => v.visionFinishConfidence,
  },
  sleeveType: {
    claimed: (l) => l.claimedSleeveType,
    detected: (v) => v.visionSleeveType,
    confidence: (v) => v.visionSleeveTypeConfidence,
  },
  neckline: {
    claimed: (l) => l.claimedNeckline,
    detected: (v) => v.visionNeckline,
    confidence: (v) => v.visionNecklineConfidence,
  },
  closureType: {
    claimed: (l) => l.claimedClosureType,
    detected: (v) => v.visionClosureType,
    confidence: (v) => v.visionClosureTypeConfidence,
  },
  shoeStyle: {
    claimed: (l) => l.claimedShoeStyle,
    detected: (v) => v.visionShoeStyle,
    confidence: (v) => v.visionShoeStyleConfidence,
  },
  strapType: {
    claimed: (l) => l.claimedStrapType,
    detected: (v) => v.visionStrapType,
    confidence: (v) => v.visionStrapTypeConfidence,
  },
};

/** Experimental keys from listing pack ∪ vision pack ∪ any claimed metafields. */
function experimentalKeysToEvaluate(
  listing: ListingFacts,
  visual: VisualFacts,
): AttributeKey[] {
  const keys = new Set<AttributeKey>();
  for (const source of [listing.productType, visual.visionProductType]) {
    for (const key of selectAttributeKeysForProduct({
      productType: source,
      includeExperimental: true,
    })) {
      if (EXPERIMENTAL_METAFIELD_KEYS.includes(key)) keys.add(key);
    }
  }
  for (const key of EXPERIMENTAL_METAFIELD_KEYS) {
    const mapping = EXPERIMENTAL_SIGNAL_MAP[key];
    if (mapping?.claimed(listing)?.trim()) keys.add(key);
  }
  return [...keys];
}

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
  if (
    verdict === "UNCERTAIN" ||
    verdict === "NOT_DETECTABLE" ||
    verdict === "NOT_APPLICABLE"
  ) {
    return 75;
  }
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

/**
 * Dual-read material claim: metafield preferred, title keyword fallback.
 */
export function resolveClaimedMaterial(args: {
  title: string;
  metafieldValue?: string | null;
}): { claimedMaterial: string | null; materialSource: "metafield" | "title" | null } {
  const fromMeta = args.metafieldValue?.trim();
  if (fromMeta) {
    return {
      claimedMaterial: normalizeMaterialName(fromMeta),
      materialSource: "metafield",
    };
  }
  const fromTitle = extractMaterialFromTitle(args.title);
  if (fromTitle) {
    return { claimedMaterial: fromTitle, materialSource: "title" };
  }
  return { claimedMaterial: null, materialSource: null };
}

function pushIssue(
  issues: ConsistencyIssue[],
  result: SignalResult,
): void {
  // NOT_DETECTABLE / NOT_APPLICABLE never become mismatch issues
  if (result.verdict !== "MISMATCH" && result.verdict !== "UNCERTAIN") return;
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

function evaluateSignal(args: {
  signal: SignalResult["signal"];
  claimed: string;
  detectedRaw: string;
  confidence: number;
  match: (a: string, b: string) => boolean;
  normalizeDetected: (raw: string) => string;
  matchEvidence: string;
  mismatchPrefix: string;
  uncertainPrefix: string;
  threshold?: number;
}): SignalResult {
  const threshold = args.threshold ?? CONFIDENCE_THRESHOLD;
  const detected = args.normalizeDetected(args.detectedRaw);
  const matched = args.match(args.claimed, args.detectedRaw);

  let verdict: Verdict;
  let evidence: string;

  if (matched) {
    verdict = "MATCH";
    evidence = args.matchEvidence;
  } else if (args.confidence >= threshold) {
    verdict = "MISMATCH";
    evidence = `${args.mismatchPrefix} (vision confidence ${Math.round(args.confidence * 100)}%).`;
  } else {
    verdict = "UNCERTAIN";
    evidence = args.uncertainPrefix;
  }

  return {
    signal: args.signal,
    claimed: args.claimed,
    detected,
    confidence: args.confidence,
    verdict,
    evidence,
  };
}

/**
 * Evaluate each available signal independently.
 * Missing signals are omitted from both signalResults and issues.
 * MATCH results appear only in signalResults.
 * UNCERTAIN / NOT_DETECTABLE never become MISMATCH.
 */
export function evaluateConsistency(
  listing: ListingFacts,
  visual: VisualFacts,
  opts?: { includeExperimental?: boolean },
): { signalResults: SignalResult[]; issues: ConsistencyIssue[] } {
  const signalResults: SignalResult[] = [];
  const issues: ConsistencyIssue[] = [];
  const includeExperimental = opts?.includeExperimental === true;

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
    const rawLower = visionMaterialRaw.toLowerCase().trim();
    // Explicit not_detectable → surface as NOT_DETECTABLE (never MISMATCH)
    if (rawLower === "not_detectable") {
      signalResults.push({
        signal: "material",
        claimed: listing.claimedMaterial,
        detected: "not_detectable",
        confidence: visionMaterialConfidence,
        verdict: "NOT_DETECTABLE",
        evidence:
          "Could not confidently determine the material from this image.",
      });
    } else {
    const recognized =
      detected !== "" &&
      detected !== "unknown" &&
      RECOGNIZED_MATERIALS.has(detected);

    // Unrecognized / unknown → omit signal (backward-compatible; avoids false MISMATCH)
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
    } // end else (not explicit not_detectable)
  }

  // --- Experimental metafield attributes (confirm-only) ---
  // Only show attributes the merchant claimed. Skipped / unset fields stay out of Guardian.
  if (includeExperimental) {
    for (const key of experimentalKeysToEvaluate(listing, visual)) {
      const def = getAttribute(key);
      const mapping = EXPERIMENTAL_SIGNAL_MAP[key];
      if (!def || def.status !== "EXPERIMENTAL" || !mapping) continue;

      const claimed = mapping.claimed(listing)?.trim() || null;
      if (!claimed) continue;

      const raw = mapping.detected(visual) ?? null;
      const conf = mapping.confidence(visual) ?? null;

      if (!raw || conf === null) {
        signalResults.push({
          signal: key as SignalResult["signal"],
          claimed,
          detected: null,
          confidence: null,
          verdict: "NOT_DETECTABLE",
          evidence: `Listing claims "${claimed}" for ${def.label.toLowerCase()}, but the image did not yield a reliable visual reading.`,
        });
        continue;
      }

      const detected = def.normalize(raw);
      const unrecognized =
        detected === "unknown" ||
        detected === "not_detectable" ||
        (def.isRecognized ? !def.isRecognized(detected) : false);

      if (unrecognized) {
        signalResults.push({
          signal: key as SignalResult["signal"],
          claimed,
          detected,
          confidence: conf,
          verdict: "NOT_DETECTABLE",
          evidence: `Could not confidently determine the ${def.label.toLowerCase()} from this image.`,
        });
        continue;
      }

      const result = evaluateSignal({
        signal: key as SignalResult["signal"],
        claimed,
        detectedRaw: detected,
        confidence: conf,
        match: def.match,
        normalizeDetected: def.normalize,
        matchEvidence: `${def.label} matches: "${claimed}".`,
        mismatchPrefix: `${def.label} mismatch: listing "${claimed}" vs detected "${detected}"`,
        uncertainPrefix: `Low confidence ${def.label.toLowerCase()} comparison: listing "${claimed}" vs detected "${detected}".`,
        threshold: def.confidenceThreshold,
      });
      signalResults.push(result);
      pushIssue(issues, result);
    }
  }

  return { signalResults, issues };
}

/**
 * Dynamic weight redistribution among available signals.
 * Image quality is NEVER included.
 * NOT_DETECTABLE / NOT_APPLICABLE signals do not contribute to overall confidence.
 */
export function computeOverallConfidence(
  signalResults: SignalResult[],
): number {
  const available = signalResults.filter(
    (s) =>
      s.confidence !== null &&
      s.signal in BASE_WEIGHTS &&
      s.verdict !== "NOT_DETECTABLE" &&
      s.verdict !== "NOT_APPLICABLE",
  );
  if (available.length === 0) return 0;

  const totalBase = available.reduce(
    (sum, s) => sum + (BASE_WEIGHTS[s.signal] ?? 0),
    0,
  );
  if (totalBase === 0) return 0;

  return available.reduce((sum, s) => {
    const weight = (BASE_WEIGHTS[s.signal] ?? 0) / totalBase;
    return sum + (s.confidence as number) * weight;
  }, 0);
}

function computeOverallVerdict(
  issues: ConsistencyIssue[],
  signalResults: SignalResult[],
  imageQuality: "good" | "fair" | "poor",
): Verdict {
  if (imageQuality === "poor") return "UNCERTAIN";
  if (issues.some((i) => i.verdict === "MISMATCH")) return "MISMATCH";
  if (issues.some((i) => i.verdict === "UNCERTAIN")) return "UNCERTAIN";
  const applicable = signalResults.filter(
    (s) => s.verdict !== "NOT_APPLICABLE" && s.verdict !== "NOT_DETECTABLE",
  );
  if (applicable.length === 0) return "UNCERTAIN";
  if (applicable.every((s) => s.verdict === "MATCH")) return "MATCH";
  return "UNCERTAIN";
}

export type BuildAnalysisOptions = {
  listing: ListingFacts;
  visual: VisualFacts;
  imageUrl: string;
  productId: string;
  colorOptionId?: string;
  colorOptionValueId?: string;
  /** When false (default), material fix only via metafield — title rewrite not required */
  materialWriteMode?: "metafield" | "title" | "both";
  includeExperimental?: boolean;
};

/**
 * Build a full AnalysisResult from listing + visual facts and optional fix IDs.
 */
export function buildAnalysisResultV2(args: BuildAnalysisOptions): AnalysisResult {
  const {
    listing,
    visual,
    imageUrl,
    productId,
    colorOptionId,
    colorOptionValueId,
    materialWriteMode = "metafield",
    includeExperimental = false,
  } = args;

  const { signalResults, issues } = evaluateConsistency(listing, visual, {
    includeExperimental,
  });
  let overallConfidence = computeOverallConfidence(signalResults);
  let overallVerdict = computeOverallVerdict(
    issues,
    signalResults,
    visual.imageQuality,
  );

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
    materialSignal.detected
  ) {
    const needsTitle =
      materialWriteMode === "title" || materialWriteMode === "both";
    const titleOk =
      !needsTitle ||
      replaceMaterialInTitle(
        listing.productTitle,
        listing.claimedMaterial,
        materialSignal.detected,
      ) !== null;
    // Metafield-first: always allow material fix suggestion when metafield mode
    const metafieldOk =
      materialWriteMode === "metafield" || materialWriteMode === "both";

    if (metafieldOk || titleOk) {
      suggestedFixes.push({
        field: "material",
        currentValue: capitalizeLabel(listing.claimedMaterial),
        suggestedValue: capitalizeLabel(materialSignal.detected),
        productId,
      });
    }
  }

  if (includeExperimental) {
    for (const field of EXPERIMENTAL_METAFIELD_KEYS) {
      const mapping = EXPERIMENTAL_SIGNAL_MAP[field];
      const issue = issues.find(
        (i) => i.signal === field && i.verdict === "MISMATCH",
      );
      const signal = signalResults.find((s) => s.signal === field);
      const threshold =
        getAttribute(field)?.confidenceThreshold ?? CONFIDENCE_THRESHOLD;
      if (
        issue &&
        signal &&
        signal.confidence !== null &&
        signal.confidence >= threshold &&
        visual.imageQuality !== "poor" &&
        signal.detected &&
        mapping
      ) {
        const claimed = mapping.claimed(listing)?.trim() || null;
        if (claimed) {
          suggestedFixes.push({
            field: field as SuggestedFix["field"],
            currentValue: capitalizeLabel(claimed),
            suggestedValue: capitalizeLabel(signal.detected),
            productId,
          });
        }
      }
    }
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
 * Optional metafield values enable material + experimental attribute dual-read.
 */
export function extractListingFacts(
  product: {
    title: string;
    productType?: string | null;
    options: Array<{ name: string; optionValues: Array<{ name: string }> }>;
  },
  metafields?: {
    material?: string | null;
    pattern?: string | null;
    finish?: string | null;
    sleeveType?: string | null;
    neckline?: string | null;
    closureType?: string | null;
    shoeStyle?: string | null;
    strapType?: string | null;
  },
): ListingFacts {
  const colorOption = product.options.find(
    (o) => o.name.toLowerCase() === "color" || o.name.toLowerCase() === "colour",
  );
  const claimedColor = colorOption?.optionValues[0]?.name ?? null;

  const { claimedMaterial, materialSource } = resolveClaimedMaterial({
    title: product.title,
    metafieldValue: metafields?.material,
  });

  return {
    claimedColor,
    productTitle: product.title,
    productType: product.productType ?? null,
    claimedMaterial,
    materialSource,
    claimedPattern: metafields?.pattern?.trim() || null,
    claimedFinish: metafields?.finish?.trim() || null,
    claimedSleeveType: metafields?.sleeveType?.trim() || null,
    claimedNeckline: metafields?.neckline?.trim() || null,
    claimedClosureType: metafields?.closureType?.trim() || null,
    claimedShoeStyle: metafields?.shoeStyle?.trim() || null,
    claimedStrapType: metafields?.strapType?.trim() || null,
  };
}

/**
 * Find the Color option + first value IDs for mutation targeting.
 * Limitation: uses option value[0] only — multi-variant color not yet solved.
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
