import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logEvent } from "../lib/logger.server";

/**
 * GDPR mandatory webhook: customers/redact
 *
 * Deletes any Session rows for this shop that match the customer email.
 * Product-scoped analyses/audit are not customer PII and are retained
 * until uninstall or retention purge (see PRIVACY.md).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const customer =
    typeof payload === "object" && payload && "customer" in payload
      ? (payload as {
          customer?: { id?: number; email?: string };
        }).customer
      : undefined;

  const customerEmail = customer?.email?.toLowerCase().trim() || null;
  const customerId = customer?.id != null ? String(customer.id) : null;

  let deletedSessions = 0;
  if (customerEmail) {
    const result = await db.session.deleteMany({
      where: {
        shop,
        email: { equals: customerEmail },
      },
    });
    deletedSessions = result.count;
  }

  // Also clear user identity fields on sessions that match customer userId
  // when email is absent but online userId is present in payload orders/etc.
  if (customerId && deletedSessions === 0) {
    try {
      const bigId = BigInt(customerId);
      const result = await db.session.deleteMany({
        where: { shop, userId: bigId },
      });
      deletedSessions = result.count;
    } catch {
      /* non-numeric customer id — ignore */
    }
  }

  logEvent({
    level: "info",
    event: "webhook.customers_redact",
    details: {
      shop,
      topic,
      deletedSessions,
      hasCustomerId: Boolean(customerId),
    },
  });

  return new Response(
    JSON.stringify({
      shop,
      customerId,
      deletedSessions,
      message:
        deletedSessions > 0
          ? "Matching session PII deleted."
          : "No customer PII found for this shop.",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};
