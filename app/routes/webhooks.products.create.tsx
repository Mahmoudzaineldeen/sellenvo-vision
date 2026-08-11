import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getShopSettings,
  shouldAutoScanOnCreate,
} from "../lib/shop-settings.server";
import { enqueueScanJob } from "../lib/jobs.server";
import { logEvent } from "../lib/logger.server";

/**
 * products/create — queue analysis when autoScanOnCreate is enabled.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  logEvent({
    level: "info",
    event: "webhook.products_create",
    details: { shop, topic },
  });

  const settings = await getShopSettings(shop);
  if (!shouldAutoScanOnCreate(settings)) {
    return new Response();
  }

  const productId =
    typeof payload === "object" &&
    payload &&
    "admin_graphql_api_id" in payload
      ? String((payload as { admin_graphql_api_id?: string }).admin_graphql_api_id)
      : typeof payload === "object" && payload && "id" in payload
        ? `gid://shopify/Product/${(payload as { id: number }).id}`
        : null;

  if (productId) {
    await enqueueScanJob({
      shop,
      productId,
      priority: 1,
    });
  }

  return new Response();
};
