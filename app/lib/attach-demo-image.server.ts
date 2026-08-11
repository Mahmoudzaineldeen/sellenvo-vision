import type { AdminClient, ProductNode } from "./shopify-fixes.server";
import { fetchProductNode } from "./shopify-fixes.server";
import { DEMO_BLACK_WALLET_IMAGE_URL } from "./demo-assets";

/**
 * Reliable demo sources. Shopify's servers often cannot fetch Unsplash /
 * Wikimedia directly via productCreateMedia — we download here and staged-upload.
 */
const DEMO_IMAGE_CANDIDATES = [
  process.env.DEMO_BLACK_WALLET_IMAGE_URL,
  DEMO_BLACK_WALLET_IMAGE_URL,
  // Wikimedia Commons — solid black leather wallet (public domain / free)
  "https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/Wallet_with_money.jpg/640px-Wallet_with_money.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/4/45/Leather_wallet.jpg",
].filter((u): u is string => Boolean(u));

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadImage(
  url: string,
): Promise<{ bytes: Buffer; filename: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "SellenvoVisionGuardian/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const mimeType = (res.headers.get("content-type") || "image/jpeg")
      .split(";")[0]
      .trim();
    if (!mimeType.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 1000) return null;
    const ext =
      mimeType.includes("png")
        ? "png"
        : mimeType.includes("webp")
          ? "webp"
          : "jpg";
    return { bytes, filename: `demo-wallet.${ext}`, mimeType };
  } catch (err) {
    console.warn("[attach-demo] download failed:", url, err);
    return null;
  }
}

async function stagedUploadImage(
  admin: AdminClient,
  file: { bytes: Buffer; filename: string; mimeType: string },
): Promise<string> {
  const stagedRes = await admin.graphql(
    `#graphql
    mutation GuardianStagedUpload($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: [
          {
            filename: file.filename,
            mimeType: file.mimeType,
            httpMethod: "POST",
            resource: "IMAGE",
            fileSize: String(file.bytes.length),
          },
        ],
      },
    },
  );
  const stagedJson = await stagedRes.json();
  const payload = stagedJson.data?.stagedUploadsCreate;
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(
      userErrors.map((e: { message: string }) => e.message).join("; "),
    );
  }
  const target = payload?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) {
    throw new Error("stagedUploadsCreate returned no upload target");
  }

  const form = new FormData();
  for (const param of target.parameters as Array<{
    name: string;
    value: string;
  }>) {
    form.append(param.name, param.value);
  }
  form.append(
    "file",
    new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
    file.filename,
  );

  const uploadRes = await fetch(target.url, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(
      `Staged upload failed (${uploadRes.status}): ${text.slice(0, 200)}`,
    );
  }

  return target.resourceUrl as string;
}

function getImageUrl(product: ProductNode): string | null {
  return (
    product.featuredMedia?.image?.url ??
    product.media?.nodes?.find((n) => n.image?.url)?.image?.url ??
    null
  );
}

export function isBlankOrPlaceholderImage(url: string | null): boolean {
  if (!url) return true;
  const u = url.toLowerCase();
  return (
    u.includes("placeholder") ||
    u.includes("no-image") ||
    u.includes("image_large.png") ||
    // Shopify's shared sample-placeholder storefront files
    u.includes("cdn.shopify.com/s/files/1/0533/2089")
  );
}

export async function waitForUsableProductImage(
  admin: AdminClient,
  productId: string,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<ProductNode | null> {
  const attempts = opts.attempts ?? 10;
  const delayMs = opts.delayMs ?? 1000;
  let last: ProductNode | null = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(delayMs);
    last = await fetchProductNode(admin, productId);
    const url = last ? getImageUrl(last) : null;
    if (url && !isBlankOrPlaceholderImage(url)) {
      return last;
    }
  }
  return last;
}

/**
 * Attach a demo black-wallet image using staged upload (reliable) instead of
 * asking Shopify's servers to fetch an external URL (often fails silently).
 */
export async function attachDemoWalletImage(
  admin: AdminClient,
  productId: string,
): Promise<{ product: ProductNode; sourceUrl: string } | { error: string }> {
  // Remove existing media so the new image becomes featured.
  const current = await fetchProductNode(admin, productId);
  const mediaIds = (current?.media?.nodes ?? [])
    .map((n) => n.id)
    .filter((id): id is string => Boolean(id));

  if (mediaIds.length > 0) {
    await admin.graphql(
      `#graphql
      mutation GuardianDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          mediaUserErrors { field message }
          deletedMediaIds
        }
      }`,
      { variables: { productId, mediaIds } },
    );
  }

  let downloaded: {
    bytes: Buffer;
    filename: string;
    mimeType: string;
  } | null = null;
  let sourceUrl = "";
  for (const candidate of DEMO_IMAGE_CANDIDATES) {
    downloaded = await downloadImage(candidate);
    if (downloaded) {
      sourceUrl = candidate;
      break;
    }
  }
  if (!downloaded) {
    return {
      error:
        "Could not download a demo wallet image. Set DEMO_BLACK_WALLET_IMAGE_URL in .env to a public JPG/PNG URL, or upload a photo in Shopify Admin → Products.",
    };
  }

  let resourceUrl: string;
  try {
    resourceUrl = await stagedUploadImage(admin, downloaded);
  } catch (err) {
    console.error("[attach-demo] staged upload failed:", err);
    return {
      error:
        err instanceof Error
          ? err.message
          : "Staged upload to Shopify failed",
    };
  }

  const mediaRes = await admin.graphql(
    `#graphql
    mutation GuardianAttachStagedMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        mediaUserErrors { field message }
        media {
          ... on MediaImage {
            id
            status
            image { url }
          }
        }
      }
    }`,
    {
      variables: {
        productId,
        media: [
          {
            originalSource: resourceUrl,
            mediaContentType: "IMAGE",
            alt: "Black leather wallet demo image",
          },
        ],
      },
    },
  );
  const mediaJson = await mediaRes.json();
  const payload = mediaJson.data?.productCreateMedia;
  const mediaErrors = payload?.mediaUserErrors ?? [];
  if (mediaErrors.length) {
    return {
      error: mediaErrors
        .map((e: { message: string }) => e.message)
        .join("; "),
    };
  }

  const ready = await waitForUsableProductImage(admin, productId, {
    attempts: 12,
    delayMs: 1000,
  });
  if (!ready) {
    return { error: "Product refresh failed after attaching demo image" };
  }
  const url = getImageUrl(ready);
  if (!url || isBlankOrPlaceholderImage(url)) {
    return {
      error:
        "Image was uploaded but Shopify is still processing it. Wait a few seconds and click Attach again, or upload manually in Admin → Products.",
    };
  }

  return { product: ready, sourceUrl };
}

/**
 * Download a remote image, staged-upload to Shopify, attach to product.
 * Prefer this over productCreateMedia(originalSource: externalUrl) — Shopify
 * often fails to fetch Unsplash/third-party hosts.
 */
export async function uploadRemoteImageToProduct(
  admin: AdminClient,
  productId: string,
  imageUrl: string,
  alt = "Product image",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const downloaded = await downloadImage(imageUrl);
  if (!downloaded) {
    return {
      ok: false,
      error: `Could not download image from ${imageUrl}`,
    };
  }

  let resourceUrl: string;
  try {
    resourceUrl = await stagedUploadImage(admin, downloaded);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Staged upload to Shopify failed",
    };
  }

  const mediaRes = await admin.graphql(
    `#graphql
    mutation GuardianAttachRemoteMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        mediaUserErrors { field message }
      }
    }`,
    {
      variables: {
        productId,
        media: [
          {
            originalSource: resourceUrl,
            mediaContentType: "IMAGE",
            alt,
          },
        ],
      },
    },
  );
  const mediaJson = await mediaRes.json();
  const mediaErrors =
    mediaJson.data?.productCreateMedia?.mediaUserErrors ?? [];
  if (mediaErrors.length) {
    return {
      ok: false,
      error: mediaErrors
        .map((e: { message: string }) => e.message)
        .join("; "),
    };
  }

  const ready = await waitForUsableProductImage(admin, productId, {
    attempts: 10,
    delayMs: 800,
  });
  const url = ready ? getImageUrl(ready) : null;
  if (!url || isBlankOrPlaceholderImage(url)) {
    return {
      ok: false,
      error:
        "Image uploaded but still processing. Open the product in a few seconds.",
    };
  }
  return { ok: true };
}
