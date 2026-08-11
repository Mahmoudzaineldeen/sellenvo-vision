import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteAllShopData } from "../lib/analysis-persist.server";
import { logEvent } from "../lib/logger.server";

/**
 * GDPR mandatory webhook: shop/redact
 *
 * Fired 48h after uninstall. Wipe all shop-scoped data
 * (same as app/uninstalled — idempotent).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  logEvent({
    level: "info",
    event: "webhook.shop_redact",
    details: { shop, topic },
  });

  try {
    await deleteAllShopData(shop);
  } catch (err) {
    logEvent({
      level: "warn",
      event: "webhook.shop_redact_failed",
      details: {
        shop,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }

  return new Response();
};
