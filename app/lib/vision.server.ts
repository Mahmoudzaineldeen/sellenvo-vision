import Groq from "groq-sdk";
import { VisionResponseSchema, type VisionResponse } from "./types";
import { MATERIAL_KEYWORDS, normalizeMaterialName } from "./materials";

const SYSTEM_PROMPT = `You are a product image analyzer. Respond with ONLY a single JSON object (no markdown, no thinking, no extra text) with exactly these keys:
{"primaryColor":"string","colorConfidence":0.0,"productType":"string","productTypeConfidence":0.0,"material":"string","materialConfidence":0.0,"imageQuality":"good|fair|poor","reasoning":"string"}

Rules:
- primaryColor: simple color name for the MAIN product (black, white, red, blue, green, yellow, orange, purple, pink, brown, grey, navy, beige, gold, silver, maroon, teal)
- colorConfidence: number from 0 to 1 for how sure you are about that color
- productType: what the product is (e.g. wallet, shoe, bag, watch)
- productTypeConfidence: number from 0 to 1
- material: what the product appears to be made of (leather, fabric, cotton, metal, plastic, wood, glass, rubber, denim, synthetic, unknown)
- materialConfidence: number from 0 to 1 for how sure you are about the material
- imageQuality: good, fair, or poor
- reasoning: 1-2 short sentences explaining the color`;

const USER_PROMPT =
  'Look at this product image and return ONLY the JSON object. Example: {"primaryColor":"blue","colorConfidence":0.91,"productType":"bag","productTypeConfidence":0.95,"material":"leather","materialConfidence":0.88,"imageQuality":"good","reasoning":"A blue leather handbag with visible grain texture."}';

/** Groq multimodal models (vision docs currently highlight qwen; scout as secondary) */
const VISION_MODELS = [
  "qwen/qwen3.6-27b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
] as const;

const VISION_CALL_TIMEOUT_MS = 30_000;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000;
const IMAGE_MAX_BYTES = 4_000_000;

/** Models rarely have true ≥99% certainty on visual analysis — clamp overconfidence. */
const CONFIDENCE_CEILING = 0.95;

const RECOGNIZED_MATERIALS = new Set<string>(MATERIAL_KEYWORDS);

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Get a free key at https://console.groq.com",
    );
  }
  return new Groq({ apiKey });
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

  const response = await fetch(imageUrl, {
    signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to download product image (${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const mimeType = contentType.split(";")[0].trim() || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.byteLength > IMAGE_MAX_BYTES) {
    throw new Error("Product image is too large for vision analysis (>4MB)");
  }

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
  imageDataUri: string,
  useJsonMode: boolean,
): Promise<string> {
  // Build request body manually so we can pass reasoning_effort for Qwen
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: USER_PROMPT },
          { type: "image_url", image_url: { url: imageDataUri } },
        ],
      },
    ],
    temperature: 0.1,
    max_completion_tokens: 1024,
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
    VISION_CALL_TIMEOUT_MS,
    `Groq ${model}`,
  )) as {
    choices: Array<{ message?: { content?: string | null } | null }>;
  };

  return completion.choices[0]?.message?.content ?? "";
}

/**
 * Analyze a product image via Groq vision from a pre-downloaded data URI.
 */
export async function analyzeProductImageDataUri(
  imageDataUri: string,
): Promise<VisionResponse> {
  const groq = getGroqClient();
  const errors: string[] = [];

  for (const model of VISION_MODELS) {
    for (const useJsonMode of [false, true]) {
      try {
        const rawText = await callVisionModel(
          groq,
          model,
          imageDataUri,
          useJsonMode,
        );
        if (!rawText.trim()) {
          errors.push(`${model} jsonMode=${useJsonMode}: empty response`);
          continue;
        }
        const parsed = extractJsonObject(rawText);
        const validated = VisionResponseSchema.parse(parsed);
        return sanitizeVisionResponse(validated);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${model} jsonMode=${useJsonMode}: ${msg}`);
      }
    }
  }

  throw new Error(
    `Vision analysis failed after all strategies. Last errors: ${errors.slice(-4).join(" | ")}`,
  );
}

/**
 * Analyze a product image via Groq vision.
 * Downloads the Shopify image server-side, then tries models/JSON strategies.
 */
export async function analyzeProductImage(
  imageUrl: string,
): Promise<VisionResponse> {
  const downloaded = await downloadProductImage(imageUrl);
  return analyzeProductImageDataUri(downloaded.dataUri);
}
