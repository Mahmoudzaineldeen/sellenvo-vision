import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteAllShopData } from "../lib/analysis-persist.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // Delete all shop-scoped persisted data (analyses, jobs, audit, settings, sessions).
  if (session) {
    await deleteAllShopData(shop);
  } else {
    // Session may already be gone — still attempt shop-scoped cleanup
    try {
      await deleteAllShopData(shop);
    } catch {
      /* best-effort */
    }
  }

  return new Response();
};
