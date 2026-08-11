/**
 * Process-local sliding-window rate limiter for Shopify mutations.
 * Caps mutations per product to avoid accidental double-submit storms
 * and stay within Admin API comfort bounds for this app.
 */

type WindowEntry = {
  timestamps: number[];
};

const windows = new Map<string, WindowEntry>();

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_MS = 60_000;

function prune(entry: WindowEntry, now: number, windowMs: number): void {
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
}

/**
 * Returns null when allowed, or an error message when rate-limited.
 * Call this BEFORE applying mutations. On allow, records the attempt.
 */
export function checkMutationRateLimit(
  productId: string,
  opts: { limit?: number; windowMs?: number } = {},
): string | null {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const now = Date.now();

  let entry = windows.get(productId);
  if (!entry) {
    entry = { timestamps: [] };
    windows.set(productId, entry);
  }

  prune(entry, now, windowMs);

  if (entry.timestamps.length >= limit) {
    const oldest = entry.timestamps[0] ?? now;
    const retrySec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    return `Too many updates for this product. Try again in ${retrySec}s.`;
  }

  entry.timestamps.push(now);
  return null;
}

/** Test helper — clear all windows. */
export function clearMutationRateLimits(): void {
  windows.clear();
}
