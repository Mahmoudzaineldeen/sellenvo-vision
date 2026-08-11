import { z } from "zod";

/** Vision model response — validated by Zod at runtime */
export const VisionResponseSchema = z.object({
  primaryColor: z.string(),
  colorConfidence: z.number().min(0).max(1),
  productType: z.string(),
  productTypeConfidence: z.number().min(0).max(1),
  material: z.string().optional(),
  materialConfidence: z.number().min(0).max(1).optional(),
  imageQuality: z.enum(["good", "fair", "poor"]),
  reasoning: z.string(),
});
export type VisionResponse = z.infer<typeof VisionResponseSchema>;

export interface ListingFacts {
  claimedColor: string | null;
  productTitle: string;
  productType: string | null;
  claimedMaterial: string | null;
}

export interface VisualFacts {
  visionColor: string;
  visionConfidence: number;
  visionReasoning: string;
  visionProductType: string;
  visionProductTypeConfidence: number;
  visionMaterial: string | null;
  visionMaterialConfidence: number | null;
  imageQuality: "good" | "fair" | "poor";
  pixelColor?: string;
  pixelHex?: string;
  pixelConfidence?: number;
}

export type Verdict = "MATCH" | "MISMATCH" | "UNCERTAIN";

export interface SignalResult {
  signal: "color" | "productType" | "material";
  claimed: string | null;
  detected: string | null;
  confidence: number | null;
  verdict: Verdict;
  evidence: string;
}

export interface ConsistencyIssue {
  signal: "color" | "productType" | "material";
  claimed: string | null;
  detected: string;
  confidence: number;
  verdict: "MISMATCH" | "UNCERTAIN";
  evidence: string;
}

export type FixableSignal = "color" | "productType" | "material";

export const FixableSignalSchema = z.enum(["color", "productType", "material"]);

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
  /** Required for color fixes (Shopify option value mutation) */
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
  /** Color, product-type, and/or material fixes the merchant can confirm one at a time. */
  suggestedFixes: SuggestedFix[];
  /** full = vision ran; cached-recheck = listing-only compare reused vision */
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
