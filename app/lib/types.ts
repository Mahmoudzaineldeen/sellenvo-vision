import { z } from "zod";

/** Vision model response — validated by Zod at runtime */
export const VisionResponseSchema = z.object({
  primaryColor: z.string(),
  colorConfidence: z.number().min(0).max(1),
  productType: z.string(),
  productTypeConfidence: z.number().min(0).max(1),
  material: z.string().optional(),
  materialConfidence: z.number().min(0).max(1).optional(),
  /** EXPERIMENTAL — only when experimental pack enabled */
  pattern: z.string().optional(),
  patternConfidence: z.number().min(0).max(1).optional(),
  finish: z.string().optional(),
  finishConfidence: z.number().min(0).max(1).optional(),
  sleeveType: z.string().optional(),
  sleeveTypeConfidence: z.number().min(0).max(1).optional(),
  neckline: z.string().optional(),
  necklineConfidence: z.number().min(0).max(1).optional(),
  closureType: z.string().optional(),
  closureTypeConfidence: z.number().min(0).max(1).optional(),
  shoeStyle: z.string().optional(),
  shoeStyleConfidence: z.number().min(0).max(1).optional(),
  strapType: z.string().optional(),
  strapTypeConfidence: z.number().min(0).max(1).optional(),
  imageQuality: z.enum(["good", "fair", "poor"]),
  reasoning: z.string(),
});
export type VisionResponse = z.infer<typeof VisionResponseSchema>;

export interface ListingFacts {
  claimedColor: string | null;
  productTitle: string;
  productType: string | null;
  claimedMaterial: string | null;
  materialSource?: "metafield" | "title" | null;
  claimedPattern?: string | null;
  claimedFinish?: string | null;
  claimedSleeveType?: string | null;
  claimedNeckline?: string | null;
  claimedClosureType?: string | null;
  claimedShoeStyle?: string | null;
  claimedStrapType?: string | null;
}

export interface VisualFacts {
  visionColor: string;
  visionConfidence: number;
  visionReasoning: string;
  visionProductType: string;
  visionProductTypeConfidence: number;
  visionMaterial: string | null;
  visionMaterialConfidence: number | null;
  visionPattern?: string | null;
  visionPatternConfidence?: number | null;
  visionFinish?: string | null;
  visionFinishConfidence?: number | null;
  visionSleeveType?: string | null;
  visionSleeveTypeConfidence?: number | null;
  visionNeckline?: string | null;
  visionNecklineConfidence?: number | null;
  visionClosureType?: string | null;
  visionClosureTypeConfidence?: number | null;
  visionShoeStyle?: string | null;
  visionShoeStyleConfidence?: number | null;
  visionStrapType?: string | null;
  visionStrapTypeConfidence?: number | null;
  imageQuality: "good" | "fair" | "poor";
  pixelColor?: string;
  pixelHex?: string;
  pixelConfidence?: number;
}

export type Verdict =
  | "MATCH"
  | "MISMATCH"
  | "UNCERTAIN"
  | "NOT_DETECTABLE"
  | "NOT_APPLICABLE";

export type SignalKey =
  | "color"
  | "productType"
  | "material"
  | "pattern"
  | "finish"
  | "sleeveType"
  | "neckline"
  | "closureType"
  | "shoeStyle"
  | "strapType";

export interface SignalResult {
  signal: SignalKey;
  claimed: string | null;
  detected: string | null;
  confidence: number | null;
  verdict: Verdict;
  evidence: string;
}

export interface ConsistencyIssue {
  signal: SignalKey;
  claimed: string | null;
  detected: string;
  confidence: number;
  verdict: "MISMATCH" | "UNCERTAIN";
  evidence: string;
}

export type FixableSignal =
  | "color"
  | "productType"
  | "material"
  | "pattern"
  | "finish"
  | "sleeveType"
  | "neckline"
  | "closureType"
  | "shoeStyle"
  | "strapType";

export const FixableSignalSchema = z.enum([
  "color",
  "productType",
  "material",
  "pattern",
  "finish",
  "sleeveType",
  "neckline",
  "closureType",
  "shoeStyle",
  "strapType",
]);

export const SuggestedFixSchema = z.object({
  field: FixableSignalSchema,
  currentValue: z.string(),
  suggestedValue: z.string().min(1),
  productId: z.string().min(1),
  optionId: z.string().optional(),
  optionValueId: z.string().optional(),
});

export const SuggestedFixesArraySchema = z.array(SuggestedFixSchema);

export interface SuggestedFix {
  field: FixableSignal;
  currentValue: string;
  suggestedValue: string;
  productId: string;
  optionId?: string;
  optionValueId?: string;
}

export interface AnalysisResult {
  overallVerdict: Verdict;
  overallConfidence: number;
  healthScore: number;
  signalResults: SignalResult[];
  issues: ConsistencyIssue[];
  imageQuality: "good" | "fair" | "poor";
  imageQualityNote: string | null;
  visionReasoning: string;
  imageUrl: string;
  suggestedFixes: SuggestedFix[];
  analysisSource?: "full" | "cached-recheck";
}

export interface ShopifyProductOptionValue {
  id: string;
  name: string;
}

export interface ShopifyProductOption {
  id: string;
  name: string;
  optionValues: ShopifyProductOptionValue[];
}

export interface ShopifyProduct {
  id: string;
  title: string;
  productType: string | null;
  options: ShopifyProductOption[];
  imageUrl: string | null;
}
