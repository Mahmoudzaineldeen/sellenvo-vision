/**
 * VisionProvider abstraction — Catalog Integrity vision backends.
 *
 * Phase 1: Groq is the primary (and currently only wired) provider.
 * Phase 3: OpenRouter becomes an explicit secondary fallback.
 *
 * Never silently switch providers without logging.
 * Provider identity must be auditable for privacy/data-handling review.
 */

import type { VisionResponse } from "../types";

export type VisionProviderId = "groq" | "openrouter";

export type VisionAnalyzeInput = {
  /** Preferred: HTTPS product image URL (CDN). */
  imageUrl?: string;
  /** Fallback: pre-downloaded data URI. */
  dataUri?: string;
  includeExperimental?: boolean;
  requireEnsembleAgreement?: boolean;
};

export type VisionAnalyzeResult = {
  response: VisionResponse;
  providerId: VisionProviderId;
  /** Wall-clock ms for this provider call. */
  latencyMs: number;
};

export interface VisionProvider {
  readonly id: VisionProviderId;
  readonly displayName: string;
  /** True when required API keys / config are present. */
  isAvailable(): boolean;
  analyze(input: VisionAnalyzeInput): Promise<VisionAnalyzeResult>;
}

export type VisionProviderErrorCode =
  | "unavailable"
  | "rate_limited"
  | "timeout"
  | "invalid_response"
  | "unknown";

export class VisionProviderError extends Error {
  readonly code: VisionProviderErrorCode;
  readonly providerId: VisionProviderId;
  readonly retryable: boolean;

  constructor(
    message: string,
    opts: {
      code: VisionProviderErrorCode;
      providerId: VisionProviderId;
      retryable?: boolean;
    },
  ) {
    super(message);
    this.name = "VisionProviderError";
    this.code = opts.code;
    this.providerId = opts.providerId;
    this.retryable = opts.retryable ?? false;
  }
}
