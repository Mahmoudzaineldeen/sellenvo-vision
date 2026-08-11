import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueScanJob } from "../lib/jobs.server";
import { logEvent } from "../lib/logger.server";
import db from "../db.server";

/**
 * products/update — invalidate by enqueueing a fresh scan (deduped).
 * Listing/image changes are handled via new ScanJob; prior analyses remain for history.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  logEvent({
    level: "info",
    event: "webhook.products_update",
    details: { shop, topic },
  });

  const productId =
    typeof payload === "object" &&
    payload &&
    "admin_graphql_api_id" in payload
      ? String((payload as { admin_graphql_api_id?: string }).admin_graphql_api_id)
      : typeof payload === "object" && payload && "id" in payload
        ? `gid://shopify/Product/${(payload as { id: number }).id}`
        : null;

  if (!productId) return new Response();

  // Soft-invalidate: mark older analyses as superseded by enqueueing new scan
  // with a unique-ish fingerprint from updated_at when available
  const updatedAt =
    typeof payload === "object" &&
    payload &&
    "updated_at" in payload
      ? String((payload as { updated_at?: string }).updated_at)
      : String(Date.now());

  await enqueueScanJob({
    shop,
    productId,
    listingFp: updatedAt,
    priority: 0,
  });

  // Optional: prune very old analyses for this product beyond retention is handled globally
  void db;

  return new Response();
};
