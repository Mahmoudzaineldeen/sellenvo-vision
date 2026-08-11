/**
 * SSRF-safe outbound image fetching.
 * Prefer Shopify CDN; block private IPs, localhost, metadata, non-HTTPS (except data:).
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000;
const IMAGE_MAX_BYTES = 4_000_000;
const MAX_REDIRECTS = 3;

const SHOPIFY_CDN_HOST_SUFFIXES = [
  ".myshopify.com",
  ".shopify.com",
  ".shopifycdn.com",
  "cdn.shopify.com",
];

function isShopifyHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "cdn.shopify.com") return true;
  return SHOPIFY_CDN_HOST_SUFFIXES.some(
    (suffix) => h === suffix.replace(/^\./, "") || h.endsWith(suffix),
  );
}

function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "127.0.0.1" || v === "::1" || v === "0.0.0.0") return true;
  if (v.startsWith("10.")) return true;
  if (v.startsWith("192.168.")) return true;
  if (v.startsWith("169.254.")) return true;
  if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;

  const m = /^172\.(\d+)\./.exec(v);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }

  // IPv4-mapped IPv6 ::ffff:x.x.x.x
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v);
  if (mapped) return isPrivateIp(mapped[1]);

  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (
    h === "localhost" ||
    h === "metadata.google.internal" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  // AWS / cloud metadata
  if (h === "169.254.169.254" || h === "metadata") return true;
  return false;
}

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  /** When true, only Shopify CDN hosts are allowed (strict mode). Default false: HTTPS public hosts OK after IP check. */
  shopifyOnly?: boolean;
};

/**
 * Validate URL + resolve DNS and reject private destinations before fetch.
 */
export async function assertSafeImageUrl(
  imageUrl: string,
  opts?: SafeFetchOptions,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error("Invalid image URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("Only HTTPS image URLs are allowed");
  }

  if (url.username || url.password) {
    throw new Error("Image URLs with credentials are not allowed");
  }

  const hostname = url.hostname;
  if (isBlockedHostname(hostname)) {
    throw new Error("Blocked image host");
  }

  if (opts?.shopifyOnly && !isShopifyHost(hostname)) {
    throw new Error("Only Shopify CDN image hosts are allowed");
  }

  // If hostname is a literal IP, check directly
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("Private IP image hosts are not allowed");
    }
    return url;
  }

  // Resolve DNS — reject if any address is private
  try {
    const records = await lookup(hostname, { all: true });
    if (!records.length) {
      throw new Error("Image host DNS lookup failed");
    }
    for (const rec of records) {
      if (isPrivateIp(rec.address)) {
        throw new Error("Image host resolves to a private address");
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("private")) throw err;
    throw new Error(
      `Image host DNS lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return url;
}

/**
 * Fetch an image with SSRF protections, redirect re-validation, timeout, size limit.
 */
export async function fetchImageSafely(
  imageUrl: string,
  opts?: SafeFetchOptions,
): Promise<{ buffer: Buffer; mimeType: string; finalUrl: string }> {
  const timeoutMs = opts?.timeoutMs ?? IMAGE_DOWNLOAD_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? IMAGE_MAX_BYTES;

  let current = imageUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertSafeImageUrl(current, opts);

    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "SellenvoVisionGuardian/1.0",
        Accept: "image/*,*/*;q=0.8",
      },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Redirect without Location header");
      }
      current = new URL(location, current).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(`Failed to download product image (${response.status})`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new Error("Product image is too large for vision analysis (>4MB)");
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.split(";")[0].trim() || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.byteLength > maxBytes) {
      throw new Error("Product image is too large for vision analysis (>4MB)");
    }

    return { buffer, mimeType, finalUrl: current };
  }

  throw new Error("Too many redirects while fetching product image");
}

export { isShopifyHost, isPrivateIp, IMAGE_MAX_BYTES, IMAGE_DOWNLOAD_TIMEOUT_MS };
