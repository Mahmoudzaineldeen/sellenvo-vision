/**
 * Vision provider registry — primary (Groq) with optional secondary fallback.
 *
 * Phase 1: Groq only.
 * Phase 3: OpenRouter registered when OPENROUTER_API_KEY is set.
 */

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

let secondaryFactory: (() => VisionProvider | null) | null = () =>
  openrouter.isAvailable() ? openrouter : null;

/**
 * Override secondary provider (tests / future providers).
 */
export function registerSecondaryVisionProvider(
  factory: () => VisionProvider | null,
): void {
  secondaryFactory = factory;
}

export function getPrimaryVisionProvider(): VisionProvider {
  return groq;
}

export function getSecondaryVisionProvider(): VisionProvider | null {
  if (!secondaryFactory) return null;
  try {
    return secondaryFactory();
  } catch {
    return null;
  }
}

export function listAvailableProviders(): VisionProviderId[] {
  const ids: VisionProviderId[] = [];
  if (groq.isAvailable()) ids.push("groq");
  const secondary = getSecondaryVisionProvider();
  if (secondary?.isAvailable()) ids.push(secondary.id);
  return ids;
}

/**
 * Analyze with primary provider; on retryable failure, try secondary once.
 * Logs every provider selection/switch (no secrets).
 */
export async function analyzeWithProviders(
  input: VisionAnalyzeInput,
): Promise<VisionAnalyzeResult> {
  const primary = getPrimaryVisionProvider();
  if (!primary.isAvailable()) {
    const secondary = getSecondaryVisionProvider();
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
      "No vision provider is configured (set GROQ_API_KEY)",
      { code: "unavailable", providerId: primary.id, retryable: false },
    );
  }

  try {
    return await primary.analyze(input);
  } catch (err) {
    const retryable =
      err instanceof VisionProviderError
        ? err.retryable
        : /rate.?limit|429|timeout|unavailable/i.test(
            err instanceof Error ? err.message : String(err),
          );

    if (!retryable) throw err;

    const secondary = getSecondaryVisionProvider();
    if (!secondary?.isAvailable()) throw err;

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
