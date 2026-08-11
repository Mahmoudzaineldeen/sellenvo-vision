import Groq from "groq-sdk";
import { VisionResponseSchema, type VisionResponse } from "./types";
import { MATERIAL_KEYWORDS, normalizeMaterialName } from "./materials";
import {
  fetchImageSafely,
  IMAGE_MAX_BYTES,
} from "./ssrf.server";
import {
  buildVisionAttributePromptSection,
  selectAttributeKeysForProduct,
} from "./attributes";
import { loadGroqEnvFromDotenvFile } from "./load-groq-env.server";

loadGroqEnvFromDotenvFile();

function buildSystemPrompt(includeExperimental: boolean): string {
  const keys = selectAttributeKeysForProduct({
    includeExperimental,
  });
  const attrLines = buildVisionAttributePromptSection(keys);
  return `You are a product image analyzer for catalog integrity. Respond with ONLY a single JSON object (no markdown, no thinking, no extra text).

Core keys (always):
{"primaryColor":"string","colorConfidence":0.0,"productType":"string","productTypeConfidence":0.0,"material":"string","materialConfidence":0.0,"imageQuality":"good|fair|poor","reasoning":"string"}

Optional experimental keys when visually supported:
"pattern","patternConfidence","finish","finishConfidence"

Rules:
- primaryColor: simple color name for the MAIN product (black, white, red, blue, green, yellow, orange, purple, pink, brown, grey, navy, beige, gold, silver, maroon, teal)
- colorConfidence: number from 0 to 1 for how sure you are about that color
- productType: what the product is (e.g. wallet, shoe, bag, watch)
- productTypeConfidence: number from 0 to 1
- material: leather, fabric, cotton, metal, plastic, wood, glass, rubber, denim, synthetic, unknown, or not_detectable
- materialConfidence: number from 0 to 1
- pattern (optional): solid, striped, plaid, floral, geometric, polka dot, camouflage, unknown, not_detectable
- finish (optional): matte, glossy, polished, brushed, satin, metallic, textured, unknown, not_detectable
- Never guess. Prefer unknown / not_detectable when evidence is insufficient.
- Prefer directly observed evidence over inference.
- imageQuality: good, fair, or poor
- reasoning: 1-2 short sentences explaining the color

Attribute focus:
${attrLines}`;
}

const USER_PROMPT =
  'Look at this product image and return ONLY the JSON object. Example: {"primaryColor":"blue","colorConfidence":0.91,"productType":"bag","productTypeConfidence":0.95,"material":"leather","materialConfidence":0.88,"imageQuality":"good","reasoning":"A blue leather handbag with visible grain texture."}. Return unknown or not_detectable when evidence is insufficient — do not invent attributes.';

/** Groq multimodal models — Scout was deprecated Jul 2026 (404 for free/dev tier). */
const VISION_MODELS = ["qwen/qwen3.6-27b"] as const;

/** URL path: Groq fetches the image itself — keep tight so one stall doesn't feel endless. */
const VISION_URL_TIMEOUT_MS = 25_000;
/** Base64 fallback is heavier; allow more headroom once. */
const VISION_DATA_URI_TIMEOUT_MS = 40_000;

/** Cap CDN width so vision tokens stay small on free/dev TPD quotas. */
const VISION_CDN_MAX_WIDTH = 768;

export class VisionRateLimitError extends Error {
  readonly retryAfterSeconds: number | null;
  readonly code = "rate_limit_exceeded" as const;

  constructor(message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "VisionRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isVisionRateLimitError(err: unknown): boolean {
  if (err instanceof VisionRateLimitError) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    msg.includes("429") ||
    msg.includes("rate_limit_exceeded") ||
    /Rate limit reached/i.test(msg) ||
    /tokens per day/i.test(msg)
  );
}

export function formatVisionUserError(err: unknown): string {
  if (err instanceof VisionRateLimitError) {
    return err.message;
  }
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (isVisionRateLimitError(err)) {
    const retry = parseRetryAfterSeconds(msg);
    return buildRateLimitMessage(retry);
  }
  if (msg.includes("Vision analysis failed after all strategies")) {
    // Prefer the last nested error if it's a rate limit
    if (isVisionRateLimitError(msg)) {
      return buildRateLimitMessage(parseRetryAfterSeconds(msg));
    }
  }
  return msg;
}

function parseRetryAfterSeconds(msg: string): number | null {
  const m = /try again in\s+(\d+(?:\.\d+)?)m/i.exec(msg);
  if (m) return Math.ceil(parseFloat(m[1]) * 60);
  const s = /try again in\s+(\d+(?:\.\d+)?)s/i.exec(msg);
  if (s) return Math.ceil(parseFloat(s[1]));
  return null;
}

function buildRateLimitMessage(retryAfterSeconds: number | null): string {
  const wait =
    retryAfterSeconds != null && retryAfterSeconds > 0
      ? ` Try again in about ${Math.ceil(retryAfterSeconds / 60)} min.`
      : " Try again later today, or upgrade Groq Dev Tier.";
  return (
    `Groq daily vision token limit reached (free on_demand TPD).${wait} ` +
    `Cached analyses still work — avoid Re-analyze until the quota resets. ` +
    `Billing: https://console.groq.com/settings/billing`
  );
}

/**
 * Prefer a smaller Shopify CDN derivative so Groq burns fewer image tokens.
 */
export function toVisionOptimizedImageUrl(imageUrl: string): string {
  if (!imageUrl.startsWith("https://")) return imageUrl;
  try {
    const u = new URL(imageUrl);
    const host = u.hostname.toLowerCase();
    const shopifyCdn =
      host === "cdn.shopify.com" ||
      host.endsWith(".shopify.com") ||
      host.includes("shopifycdn");
    if (!shopifyCdn) return imageUrl;

    // Query-param width is widely supported on Shopify CDN
    if (!u.searchParams.has("width")) {
      u.searchParams.set("width", String(VISION_CDN_MAX_WIDTH));
    }
    return u.toString();
  } catch {
    return imageUrl;
  }
}

/** Models rarely have true ≥99% certainty on visual analysis — clamp overconfidence. */
const CONFIDENCE_CEILING = 0.95;

const RECOGNIZED_MATERIALS = new Set<string>(MATERIAL_KEYWORDS);

/** After a 429, don't burn this key again until retry-after. */
const keyCooldownUntil = new Map<string, number>();

function fingerprint(apiKey: string): string {
  return `${apiKey.slice(0, 8)}:${apiKey.slice(-4)}`;
}

function markKeyRateLimited(apiKey: string, retryAfterSeconds: number | null) {
  const ms = Math.max(60, retryAfterSeconds ?? 15 * 60) * 1000;
  keyCooldownUntil.set(fingerprint(apiKey), Date.now() + ms);
}

function getGroqApiKeys(): string[] {
  if (loadGroqEnvFromDotenvFile()) {
    // New .env keys — drop cooldowns from the previous account
    keyCooldownUntil.clear();
    console.info("[vision] reloaded Groq keys from .env");
  }

  const raw = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_FALLBACK,
    ...(process.env.GROQ_API_KEYS
      ? process.env.GROQ_API_KEYS.split(",").map((k) => k.trim())
      : []),
  ];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const k of raw) {
    if (!k || seen.has(k)) continue;
    seen.add(k);
    keys.push(k);
  }

  // Skip keys that recently hit TPD until cooldown expires; prefer healthy keys first.
  const now = Date.now();
  const healthy: string[] = [];
  const cooling: string[] = [];
  for (const k of keys) {
    const until = keyCooldownUntil.get(fingerprint(k)) ?? 0;
    if (until > now) cooling.push(k);
    else healthy.push(k);
  }
  return [...healthy, ...cooling];
}

function getGroqClient(apiKey?: string) {
  const key = apiKey ?? getGroqApiKeys()[0];
  if (!key) {
    throw new Error(
      "GROQ_API_KEY is not set. Get a free key at https://console.groq.com",
    );
  }
  return new Groq({ apiKey: key });
}

function keyLabel(index: number, total: number): string {
  if (index === 0) return "primary";
  return `fallback#${index}/${total - 1}`;
}

function stripThinkingTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();
}

function extractJsonObject(text: string): unknown {
  let raw = stripThinkingTags(text);
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    raw = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error(
      `Could not parse JSON from model output: ${raw.slice(0, 200)}`,
    );
  }
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const bounded = Math.min(1, Math.max(0, value));
  return Math.min(bounded, CONFIDENCE_CEILING);
}

/**
 * Unrecognized materials (canvas, suede, …) become "unknown" so they do not
 * create false MISMATCH against listing keywords.
 */
function sanitizeMaterial(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const normalized = normalizeMaterialName(raw);
  if (!normalized || normalized === "unknown") return "unknown";
  if (!RECOGNIZED_MATERIALS.has(normalized)) return "unknown";
  return normalized;
}

function sanitizeVisionResponse(parsed: VisionResponse): VisionResponse {
  return {
    ...parsed,
    colorConfidence: clampConfidence(parsed.colorConfidence),
    productTypeConfidence: clampConfidence(parsed.productTypeConfidence),
    material: sanitizeMaterial(parsed.material),
    materialConfidence:
      parsed.materialConfidence === undefined
        ? undefined
        : clampConfidence(parsed.materialConfidence),
  };
}

export type DownloadedImage = {
  buffer: Buffer;
  mimeType: string;
  dataUri: string;
};

/**
 * Download a product image once for both vision and pixel analysis.
 * Enforces timeout and size limits.
 */
export async function downloadProductImage(
  imageUrl: string,
): Promise<DownloadedImage> {
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error("Invalid data URI for product image");
    }
    const mimeType = match[1] || "image/jpeg";
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.byteLength > IMAGE_MAX_BYTES) {
      throw new Error("Product image is too large for vision analysis (>4MB)");
    }
    return { buffer, mimeType, dataUri: imageUrl };
  }

  const { buffer, mimeType } = await fetchImageSafely(imageUrl);

  return {
    buffer,
    mimeType,
    dataUri: `data:${mimeType};base64,${buffer.toString("base64")}`,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callVisionModel(
  groq: Groq,
  model: string,
  imageRef: string,
  useJsonMode: boolean,
  includeExperimental = false,
  timeoutMs = VISION_URL_TIMEOUT_MS,
): Promise<string> {
  // Prefer HTTPS URL refs when possible — huge base64 data URIs often timeout.
  // Merchant/product text is NEVER injected into the system prompt.
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt(includeExperimental) },
      {
        role: "user",
        content: [
          { type: "text", text: USER_PROMPT },
          { type: "image_url", image_url: { url: imageRef } },
        ],
      },
    ],
    temperature: 0.1,
    // Compact JSON only — large caps invite thinking/verbose stalls
    max_completion_tokens: 384,
  };

  if (useJsonMode) {
    body.response_format = { type: "json_object" };
  }

  // Disable Qwen thinking — empty failed_generation is common with thinking+JSON
  if (model.includes("qwen")) {
    body.reasoning_effort = "none";
  }

  const completion = (await withTimeout(
    groq.chat.completions.create(
      body as unknown as Parameters<Groq["chat"]["completions"]["create"]>[0],
    ),
    timeoutMs,
    `Groq ${model}`,
  )) as {
    choices: Array<{ message?: { content?: string | null } | null }>;
  };

  return completion.choices[0]?.message?.content ?? "";
}

export type AnalyzeVisionOptions = {
  includeExperimental?: boolean;
  /**
   * When true, run a second strategy pass and treat color/type/material
   * disagreement as uncertain. With a single available vision model this
   * compares jsonMode variants rather than two model families.
   */
  requireEnsembleAgreement?: boolean;
  /**
   * Original HTTPS product image URL. Preferred over data URI for Groq
   * (smaller payload, fewer timeouts). Data URI remains the fallback.
   */
  imageUrl?: string;
};

function disagree(
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (!a || !b) return false;
  return a.toLowerCase().trim() !== b.toLowerCase().trim();
}

type VisionStrategy = {
  label: string;
  imageRef: string;
  useJsonMode: boolean;
  timeoutMs: number;
};

function buildUrlStrategies(imageUrl: string): VisionStrategy[] {
  const optimized = toVisionOptimizedImageUrl(imageUrl);
  // Single URL+json attempt — url+text after a 429 doubles TPD burn for no gain.
  return [
    {
      label: "url+json",
      imageRef: optimized,
      useJsonMode: true,
      timeoutMs: VISION_URL_TIMEOUT_MS,
    },
  ];
}

function buildDataUriStrategies(dataUri: string): VisionStrategy[] {
  return [
    {
      label: "dataUri+json",
      imageRef: dataUri,
      useJsonMode: true,
      timeoutMs: VISION_DATA_URI_TIMEOUT_MS,
    },
  ];
}

function buildImageStrategies(
  dataUri: string | null | undefined,
  imageUrl?: string,
): VisionStrategy[] {
  const strategies: VisionStrategy[] = [];

  const canUseRemoteUrl =
    typeof imageUrl === "string" &&
    imageUrl.startsWith("https://") &&
    !imageUrl.startsWith("data:");

  if (canUseRemoteUrl) {
    strategies.push(...buildUrlStrategies(imageUrl));
  }

  if (dataUri && dataUri.startsWith("data:")) {
    strategies.push(...buildDataUriStrategies(dataUri));
  }

  return strategies;
}

async function runVisionStrategies(
  strategies: VisionStrategy[],
  opts?: AnalyzeVisionOptions,
): Promise<VisionResponse> {
  if (strategies.length === 0) {
    throw new Error("No vision strategies available (need HTTPS image URL or data URI)");
  }

  const apiKeys = getGroqApiKeys();
  if (apiKeys.length === 0) {
    throw new Error(
      "GROQ_API_KEY is not set. Get a free key at https://console.groq.com",
    );
  }
  console.info(`[vision] using ${apiKeys.length} Groq API key(s)`);

  const errors: string[] = [];
  const includeExperimental = opts?.includeExperimental === true;
  const results: VisionResponse[] = [];

  for (const model of VISION_MODELS) {
    for (const strategy of strategies) {
      let strategySucceeded = false;
      for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
        const activeKey = apiKeys[keyIndex];
        const groq = getGroqClient(activeKey);
        const label = `${model} ${strategy.label}@${keyLabel(keyIndex, apiKeys.length)}`;
        try {
          const rawText = await callVisionModel(
            groq,
            model,
            strategy.imageRef,
            strategy.useJsonMode,
            includeExperimental,
            strategy.timeoutMs,
          );
          if (!rawText.trim()) {
            errors.push(`${label}: empty response`);
            continue;
          }
          const parsed = extractJsonObject(rawText);
          const validated = VisionResponseSchema.parse(parsed);
          const sanitized = sanitizeVisionResponse(validated);
          results.push(sanitized);
          strategySucceeded = true;
          if (keyIndex > 0) {
            console.info(
              `[vision] succeeded with ${keyLabel(keyIndex, apiKeys.length)} after earlier key failure`,
            );
          }
          if (!opts?.requireEnsembleAgreement) {
            return sanitized;
          }
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${label}: ${msg}`);
          if (isVisionRateLimitError(err)) {
            markKeyRateLimited(activeKey, parseRetryAfterSeconds(msg));
          }
          // Rate limit / auth on this key → try next key before giving up
          if (
            (isVisionRateLimitError(err) ||
              /401|403|invalid.*api.?key|authentication/i.test(msg)) &&
            keyIndex < apiKeys.length - 1
          ) {
            console.warn(
              `[vision] ${keyLabel(keyIndex, apiKeys.length)} failed (${isVisionRateLimitError(err) ? "rate limit" : "auth"}); trying next key`,
            );
            continue;
          }
          if (isVisionRateLimitError(err) && keyIndex === apiKeys.length - 1) {
            throw new VisionRateLimitError(
              buildRateLimitMessage(parseRetryAfterSeconds(msg)),
              parseRetryAfterSeconds(msg),
            );
          }
          break;
        }
      }
      if (strategySucceeded && results.length >= 2) break;
    }
    if (results.length >= 2) break;
  }

  if (results.length === 0) {
    const joined = errors.slice(-4).join(" | ");
    if (isVisionRateLimitError(joined)) {
      throw new VisionRateLimitError(
        buildRateLimitMessage(parseRetryAfterSeconds(joined)),
        parseRetryAfterSeconds(joined),
      );
    }
    throw new Error(
      `Vision analysis failed after all strategies. Last errors: ${joined}`,
    );
  }

  if (results.length === 1 || !opts?.requireEnsembleAgreement) {
    return results[0];
  }

  const [primary, secondary] = results;
  const merged: VisionResponse = { ...primary };
  if (disagree(primary.primaryColor, secondary.primaryColor)) {
    merged.colorConfidence = Math.min(primary.colorConfidence, 0.5);
    merged.reasoning = `${primary.reasoning} (strategies disagreed on color — treating as uncertain)`;
  }
  if (disagree(primary.productType, secondary.productType)) {
    merged.productTypeConfidence = Math.min(primary.productTypeConfidence, 0.5);
  }
  if (disagree(primary.material, secondary.material)) {
    merged.material = "unknown";
    merged.materialConfidence = Math.min(
      primary.materialConfidence ?? 0.5,
      0.5,
    );
  }
  return sanitizeVisionResponse(merged);
}

/**
 * Fast path: Groq fetches the HTTPS image URL (no local download / base64).
 */
export async function analyzeProductImageUrl(
  imageUrl: string,
  opts?: AnalyzeVisionOptions,
): Promise<VisionResponse> {
  if (!imageUrl.startsWith("https://")) {
    throw new Error("analyzeProductImageUrl requires an HTTPS image URL");
  }
  return runVisionStrategies(buildUrlStrategies(imageUrl), opts);
}

/**
 * Analyze a product image via Groq vision from a pre-downloaded data URI.
 * Prefers HTTPS URL when provided (avoids timeout on large base64 payloads).
 */
export async function analyzeProductImageDataUri(
  imageDataUri: string,
  opts?: AnalyzeVisionOptions,
): Promise<VisionResponse> {
  const strategies = buildImageStrategies(imageDataUri, opts?.imageUrl);
  return runVisionStrategies(strategies, opts);
}

/**
 * Analyze a product image via Groq vision.
 * Downloads the Shopify image server-side for local pixel analysis fallback path,
 * but prefers the HTTPS URL for the Groq request itself.
 */
export async function analyzeProductImage(
  imageUrl: string,
): Promise<VisionResponse> {
  const downloaded = await downloadProductImage(imageUrl);
  return analyzeProductImageDataUri(downloaded.dataUri, { imageUrl });
}
