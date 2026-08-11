import { mapHexToColorName } from "./color-names.server";

export interface PixelColorResult {
  hex: string;
  colorName: string;
  confidence: number;
}

/**
 * Optional deterministic color extraction via colorthief + sharp.
 * Returns null if packages are unavailable or extraction fails.
 * Never throws — pixel analysis must not block the golden path.
 */
export async function extractDominantColor(
  imageBuffer: Buffer,
): Promise<PixelColorResult | null> {
  try {
    // Dynamic import so missing sharp/colorthief does not crash the app
    const colorthief = await import("colorthief");
    const getColor =
      (colorthief as { getColor?: (src: Buffer) => Promise<unknown> }).getColor ??
      (colorthief as { default?: { getColor?: (src: Buffer) => Promise<unknown> } })
        .default?.getColor;
    const getPalette =
      (colorthief as { getPalette?: (src: Buffer, opts?: unknown) => Promise<unknown[]> })
        .getPalette ??
      (colorthief as {
        default?: { getPalette?: (src: Buffer, opts?: unknown) => Promise<unknown[]> };
      }).default?.getPalette;

    if (!getColor) {
      console.warn("[color-analysis] colorthief.getColor not available — skipping");
      return null;
    }

    const dominant = (await getColor(imageBuffer)) as {
      hex?: () => string;
      population?: number;
      r?: number;
      g?: number;
      b?: number;
    };

    let hex: string;
    if (typeof dominant?.hex === "function") {
      hex = dominant.hex();
    } else if (Array.isArray(dominant) && dominant.length >= 3) {
      const [r, g, b] = dominant as unknown as number[];
      hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    } else if (
      typeof dominant?.r === "number" &&
      typeof dominant?.g === "number" &&
      typeof dominant?.b === "number"
    ) {
      hex = `#${[dominant.r, dominant.g, dominant.b]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")}`;
    } else {
      console.warn("[color-analysis] Unexpected colorthief result shape");
      return null;
    }

    const colorName = mapHexToColorName(hex);
    if (!colorName) {
      console.warn("[color-analysis] Invalid hex from colorthief — skipping");
      return null;
    }

    let confidence = 0.7;
    if (getPalette) {
      try {
        const palette = (await getPalette(imageBuffer, { colorCount: 5 })) as Array<{
          population?: number;
          hex?: () => string;
        }>;
        if (Array.isArray(palette) && palette.length > 0) {
          const total = palette.reduce((sum, c) => sum + (c.population || 1), 0);
          const dominantPop = dominant.population || palette[0]?.population || 1;
          confidence = Math.min((dominantPop / total) * 1.5, 1.0);
        }
      } catch {
        // palette is optional
      }
    }

    return { hex, colorName, confidence };
  } catch (err) {
    console.warn(
      "[color-analysis] Pixel extraction unavailable — continuing with vision-only:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

const IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000;
const IMAGE_DOWNLOAD_MAX_BYTES = 10_000_000; // 10MB

/**
 * Download an image from a public URL into a Buffer.
 * Returns null on failure (non-blocking).
 * Enforces a 15s timeout and 10MB size cap to avoid hangs/OOM.
 */
export async function downloadImageBuffer(
  imageUrl: string,
): Promise<Buffer | null> {
  try {
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const size = Number(contentLength);
      if (Number.isFinite(size) && size > IMAGE_DOWNLOAD_MAX_BYTES) {
        console.warn(
          `[color-analysis] Image too large (${size} bytes) — skipping pixel analysis`,
        );
        return null;
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > IMAGE_DOWNLOAD_MAX_BYTES) {
      console.warn(
        `[color-analysis] Image body too large (${arrayBuffer.byteLength} bytes) — skipping`,
      );
      return null;
    }
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}
