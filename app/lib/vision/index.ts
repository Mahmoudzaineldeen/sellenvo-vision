/**
 * Vision provider registry — configurable primary with optional fallback.
 *
 * Env:
 *   VISION_PRIMARY_PROVIDER=groq|openrouter (default: groq)
 *   VISION_FALLBACK_PROVIDER=openrouter|groq|none (default: openrouter if key present)
 */

import { isVisionRateLimitError } from "../vision.server";
import { GroqVisionProvider } from "./groq";
import { OpenRouterVisionProvider } from "./openrouter";
import type {
  VisionAnalyzeInput,
  VisionAnalyzeResult,
  VisionProvider,
  VisionProviderId,
} from "./provider";
import { VisionProviderError } from "./provider";
import { logEvent } from "../logger.server";

const groq = new GroqVisionProvider();
const openrouter = new OpenRouterVisionProvider();

const PROVIDERS: Record<VisionProviderId, VisionProvider> = {
  groq,
  openrouter,
};

function parseProviderId(raw: string | undefined): VisionProviderId | null {
  const v = raw?.trim().toLowerCase();
  if (v === "groq" || v === "openrouter") return v;
  return null;
}

function resolvePrimaryId(): VisionProviderId {
  return parseProviderId(process.env.VISION_PRIMARY_PROVIDER) ?? "groq";
}

function resolveFallbackId(primaryId: VisionProviderId): VisionProviderId | null {
  const raw = process.env.VISION_FALLBACK_PROVIDER?.trim().toLowerCase();
  if (raw === "none" || raw === "off" || raw === "false") return null;
  const parsed = parseProviderId(raw);
  if (parsed) return parsed === primaryId ? null : parsed;
  // Default: prefer the other provider when available
  return primaryId === "groq" ? "openrouter" : "groq";
}

let secondaryFactory: (() => VisionProvider | null) | null = null;

/**
 * Override secondary provider (tests). Pass null to restore env-based fallback.
 */
export function registerSecondaryVisionProvider(
  factory: (() => VisionProvider | null) | null,
): void {
  secondaryFactory = factory;
}

export function getPrimaryVisionProvider(): VisionProvider {
  const id = resolvePrimaryId();
  return PROVIDERS[id];
}

export function getSecondaryVisionProvider(): VisionProvider | null {
  if (secondaryFactory) {
    try {
      return secondaryFactory();
    } catch {
      return null;
    }
  }
  const primaryId = resolvePrimaryId();
  const fallbackId = resolveFallbackId(primaryId);
  if (!fallbackId) return null;
  const provider = PROVIDERS[fallbackId];
  return provider.isAvailable() ? provider : null;
}

export function listAvailableProviders(): VisionProviderId[] {
  const ids: VisionProviderId[] = [];
  for (const p of Object.values(PROVIDERS)) {
    if (p.isAvailable()) ids.push(p.id);
  }
  return ids;
}

function isRetryableProviderFailure(err: unknown): boolean {
  if (err instanceof VisionProviderError) return err.retryable;
  if (isVisionRateLimitError(err)) return true;
  return /rate.?limit|429|timeout|unavailable|ECONNRESET|ETIMEDOUT/i.test(
    err instanceof Error ? err.message : String(err),
  );
}

/**
 * Analyze with primary provider; on retryable failure, try secondary once.
 * Logs every provider selection/switch (no secrets).
 */
export async function analyzeWithProviders(
  input: VisionAnalyzeInput,
): Promise<VisionAnalyzeResult> {
  const primary = getPrimaryVisionProvider();
  const secondary = getSecondaryVisionProvider();

  if (!primary.isAvailable()) {
    if (secondary?.isAvailable()) {
      logEvent({
        level: "warn",
        event: "vision.provider.primary_unavailable",
        details: {
          primary: primary.id,
          fallingBackTo: secondary.id,
        },
      });
      return secondary.analyze(input);
    }
    throw new VisionProviderError(
      "Analysis unavailable. Configure VISION_PRIMARY_PROVIDER credentials (e.g. GROQ_API_KEY) or a fallback provider.",
      { code: "unavailable", providerId: primary.id, retryable: true },
    );
  }

  logEvent({
    level: "info",
    event: "vision.provider.selected",
    details: {
      primary: primary.id,
      fallback: secondary?.id ?? null,
    },
  });

  try {
    return await primary.analyze(input);
  } catch (err) {
    if (!isRetryableProviderFailure(err)) throw err;

    if (!secondary?.isAvailable()) {
      throw err;
    }

    logEvent({
      level: "warn",
      event: "vision.provider.fallback",
      details: {
        from: primary.id,
        to: secondary.id,
        reason: err instanceof Error ? err.message : String(err),
      },
    });

    return secondary.analyze(input);
  }
}

export type {
  VisionAnalyzeInput,
  VisionAnalyzeResult,
  VisionProvider,
  VisionProviderId,
} from "./provider";
export { VisionProviderError } from "./provider";
export { OpenRouterVisionProvider } from "./openrouter";
export { GroqVisionProvider } from "./groq";
