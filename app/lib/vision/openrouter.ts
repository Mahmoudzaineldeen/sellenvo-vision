/**
 * OpenRouter VisionProvider — secondary fallback when Groq is unavailable.
 * Only activates when OPENROUTER_API_KEY is set.
 *
 * Uses OpenAI-compatible chat completions API with a multimodal model.
 * Same Zod validation / sanitization path as Groq (via VisionResponseSchema).
 */

import { VisionResponseSchema } from "../types";
import { logEvent } from "../logger.server";
import type {
  VisionAnalyzeInput,
  VisionAnalyzeResult,
  VisionProvider,
} from "./provider";
import { VisionProviderError } from "./provider";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** Free-tier-friendly multimodal model on OpenRouter — override via env. */
const DEFAULT_MODEL =
  process.env.OPENROUTER_VISION_MODEL?.trim() || "qwen/qwen2.5-vl-32b-instruct";
const TIMEOUT_MS = 40_000;

function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(0.95, Math.max(0, n));
}

function extractJsonObject(raw: string): unknown {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object in OpenRouter response");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

export class OpenRouterVisionProvider implements VisionProvider {
  readonly id = "openrouter" as const;
  readonly displayName = "OpenRouter";

  isAvailable(): boolean {
    return Boolean(process.env.OPENROUTER_API_KEY?.trim());
  }

  async analyze(input: VisionAnalyzeInput): Promise<VisionAnalyzeResult> {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new VisionProviderError(
        "OPENROUTER_API_KEY is not set",
        { code: "unavailable", providerId: this.id, retryable: false },
      );
    }

    const imageRef =
      input.dataUri?.startsWith("data:")
        ? input.dataUri
        : input.imageUrl?.startsWith("https://")
          ? input.imageUrl
          : null;

    if (!imageRef) {
      throw new VisionProviderError(
        "OpenRouter provider requires an HTTPS imageUrl or dataUri",
        { code: "invalid_response", providerId: this.id, retryable: false },
      );
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.SHOPIFY_APP_URL || "https://sellenvo.local",
          "X-Title": "Sellenvo Vision Catalog Integrity",
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          temperature: 0.1,
          max_tokens: 384,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                'You are a product image analyzer for catalog integrity. Respond with ONLY a single JSON object: {"primaryColor":"string","colorConfidence":0.0,"productType":"string","productTypeConfidence":0.0,"material":"string","materialConfidence":0.0,"imageQuality":"good|fair|poor","reasoning":"string"}. Never guess — use unknown or not_detectable when evidence is insufficient. Prefer observed evidence over inference.',
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Look at this product image and return ONLY the JSON object.",
                },
                {
                  type: "image_url",
                  image_url: { url: imageRef },
                },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const retryable = res.status === 429 || res.status >= 500;
        throw new VisionProviderError(
          `OpenRouter HTTP ${res.status}: ${body.slice(0, 200)}`,
          {
            code: res.status === 429 ? "rate_limited" : "unknown",
            providerId: this.id,
            retryable,
          },
        );
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawText = json.choices?.[0]?.message?.content ?? "";
      if (!rawText.trim()) {
        throw new VisionProviderError("OpenRouter returned empty content", {
          code: "invalid_response",
          providerId: this.id,
          retryable: true,
        });
      }

      const parsed = extractJsonObject(rawText);
      const validated = VisionResponseSchema.parse(parsed);
      // Clamp confidence like Groq path (sanitize without importing private helpers)
      const response = {
        ...validated,
        colorConfidence: clampConfidence(validated.colorConfidence),
        productTypeConfidence: clampConfidence(validated.productTypeConfidence),
        materialConfidence:
          validated.materialConfidence != null
            ? clampConfidence(validated.materialConfidence)
            : validated.materialConfidence,
      };

      const latencyMs = Date.now() - started;
      logEvent({
        level: "info",
        event: "vision.provider.success",
        durationMs: latencyMs,
        details: { providerId: this.id, model: DEFAULT_MODEL },
      });

      return { response, providerId: this.id, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - started;
      if (err instanceof VisionProviderError) {
        logEvent({
          level: "error",
          event: "vision.provider.failed",
          durationMs: latencyMs,
          details: { providerId: this.id, code: err.code, error: err.message },
        });
        throw err;
      }
      const aborted =
        err instanceof Error &&
        (err.name === "AbortError" || /aborted/i.test(err.message));
      logEvent({
        level: "error",
        event: "vision.provider.failed",
        durationMs: latencyMs,
        details: {
          providerId: this.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw new VisionProviderError(
        err instanceof Error ? err.message : String(err),
        {
          code: aborted ? "timeout" : "unknown",
          providerId: this.id,
          retryable: true,
        },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
