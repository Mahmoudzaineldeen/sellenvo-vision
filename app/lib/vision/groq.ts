/**
 * Groq VisionProvider — wraps existing vision.server.ts implementation.
 * Preserves all current Groq behavior (keys, rate limits, strategies).
 */

import {
  analyzeProductImageDataUri,
  analyzeProductImageUrl,
  isVisionRateLimitError,
} from "../vision.server";
import { logEvent } from "../logger.server";
import type {
  VisionAnalyzeInput,
  VisionAnalyzeResult,
  VisionProvider,
} from "./provider";
import { VisionProviderError } from "./provider";

export class GroqVisionProvider implements VisionProvider {
  readonly id = "groq" as const;
  readonly displayName = "Groq";

  isAvailable(): boolean {
    const primary = process.env.GROQ_API_KEY?.trim();
    const fallback = process.env.GROQ_API_KEY_FALLBACK?.trim();
    const list = process.env.GROQ_API_KEYS?.trim();
    return Boolean(primary || fallback || list);
  }

  async analyze(input: VisionAnalyzeInput): Promise<VisionAnalyzeResult> {
    if (!this.isAvailable()) {
      throw new VisionProviderError(
        "GROQ_API_KEY is not set. Get a free key at https://console.groq.com",
        { code: "unavailable", providerId: this.id, retryable: false },
      );
    }

    const started = Date.now();
    const opts = {
      includeExperimental: input.includeExperimental,
      requireEnsembleAgreement: input.requireEnsembleAgreement,
      imageUrl: input.imageUrl,
      productType: input.productType,
    };

    try {
      let response;
      if (
        input.imageUrl &&
        input.imageUrl.startsWith("https://") &&
        !input.dataUri
      ) {
        response = await analyzeProductImageUrl(input.imageUrl, opts);
      } else if (input.dataUri) {
        response = await analyzeProductImageDataUri(input.dataUri, opts);
      } else if (input.imageUrl?.startsWith("https://")) {
        response = await analyzeProductImageUrl(input.imageUrl, opts);
      } else {
        throw new VisionProviderError(
          "Groq provider requires an HTTPS imageUrl or dataUri",
          { code: "invalid_response", providerId: this.id, retryable: false },
        );
      }

      const latencyMs = Date.now() - started;
      logEvent({
        level: "info",
        event: "vision.provider.success",
        durationMs: latencyMs,
        details: { providerId: this.id },
      });

      return { response, providerId: this.id, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - started;
      if (isVisionRateLimitError(err)) {
        logEvent({
          level: "warn",
          event: "vision.provider.rate_limited",
          durationMs: latencyMs,
          details: { providerId: this.id },
        });
        // Preserve VisionRateLimitError so callers skip base64 fallback
        throw err;
      }
      logEvent({
        level: "error",
        event: "vision.provider.failed",
        durationMs: latencyMs,
        details: {
          providerId: this.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  }
}
