import type { VisualFacts } from "./types";

/**
 * In-memory visual analysis cache keyed by product + image URL.
 * Listing-only Shopify updates (color/type/title) reuse this to skip
 * Groq vision + pixel download — the real post-fix bottleneck.
 *
 * Process-local Map with LRU eviction (max 500). Not shared across
 * workers/instances — acceptable for single-process deployments.
 */
type CacheEntry = {
  imageUrl: string;
  visual: VisualFacts;
  cachedAt: number;
};

const cache = new Map<string, CacheEntry>();

/** 30 minutes — vision for a stable product image rarely needs refresh sooner. */
const TTL_MS = 30 * 60 * 1000;

/** Hard cap to prevent unbounded memory growth in long-running processes. */
const MAX_ENTRIES = 500;

function touch(productId: string, entry: CacheEntry): void {
  // Re-insert to move to Map insertion order (newest at end).
  cache.delete(productId);
  cache.set(productId, entry);
}

function evictIfNeeded(): void {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function getCachedVisual(
  productId: string,
  imageUrl: string,
): VisualFacts | null {
  const entry = cache.get(productId);
  if (!entry) return null;
  if (entry.imageUrl !== imageUrl) return null;
  if (Date.now() - entry.cachedAt > TTL_MS) {
    cache.delete(productId);
    return null;
  }
  touch(productId, entry);
  return entry.visual;
}

export function setCachedVisual(
  productId: string,
  imageUrl: string,
  visual: VisualFacts,
): void {
  cache.set(productId, {
    imageUrl,
    visual,
    cachedAt: Date.now(),
  });
  evictIfNeeded();
}

export function clearCachedVisual(productId: string): void {
  cache.delete(productId);
}

/** Test helper — wipe all entries. */
export function clearAllVisualCaches(): void {
  cache.clear();
}

/** Test helper — current entry count. */
export function getVisualCacheSize(): number {
  return cache.size;
}
