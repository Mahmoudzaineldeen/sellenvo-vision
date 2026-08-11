/**
 * Lightweight structured logger for Guardian operations.
 * Never log API keys, access tokens, or image data URIs.
 */

export type LogLevel = "info" | "warn" | "error";

export type LogEvent = {
  level: LogLevel;
  event: string;
  productId?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
};

function safeDetails(
  details?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("token") ||
      lower.includes("apikey") ||
      lower.includes("api_key") ||
      lower.includes("secret") ||
      lower.includes("authorization") ||
      lower.includes("datauri") ||
      lower.includes("data_uri")
    ) {
      out[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string" && value.startsWith("data:")) {
      out[key] = `[data-uri ${value.length} chars]`;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function logEvent(entry: LogEvent): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level: entry.level,
    event: entry.event,
    ...(entry.productId ? { productId: entry.productId } : {}),
    ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
    ...(entry.details ? { details: safeDetails(entry.details) } : {}),
  };

  const line = JSON.stringify(payload);
  if (entry.level === "error") {
    console.error(line);
  } else if (entry.level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}
