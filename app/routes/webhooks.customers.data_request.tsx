import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logEvent } from "../lib/logger.server";

/**
 * GDPR mandatory webhook: customers/data_request
 *
 * Sellenvo stores minimal customer PII — only OAuth Session fields
 * (name/email) when an online session exists. Analyses, audit events,
 * and scan jobs are product-scoped, not customer-scoped.
 *
 * Returns 200 with a summary of what (if anything) we hold for the customer.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const customer =
    typeof payload === "object" && payload && "customer" in payload
      ? (payload as {
          customer?: { id?: number; email?: string; phone?: string };
        }).customer
      : undefined;

  const customerId = customer?.id != null ? String(customer.id) : null;
  const customerEmail = customer?.email?.toLowerCase().trim() || null;

  logEvent({
    level: "info",
    event: "webhook.customers_data_request",
    details: { shop, topic, hasCustomerId: Boolean(customerId) },
  });

  // Session may store OAuth user email/name — check for matches
  const sessions = customerEmail
    ? await db.session.findMany({
        where: {
          shop,
          email: { equals: customerEmail },
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          userId: true,
        },
      })
    : [];

  // Product-scoped data is not customer PII; report counts only when asked
  const [analysisCount, auditCount, feedbackCount] = await Promise.all([
    db.analysis.count({ where: { shop } }),
    db.auditEvent.count({ where: { shop } }),
    db.visionFeedback.count({ where: { shop } }),
  ]);

  return new Response(
    JSON.stringify({
      shop,
      customerId,
      dataHeld: {
        sessions: sessions.map((s) => ({
          sessionId: s.id,
          email: s.email,
          firstName: s.firstName,
          lastName: s.lastName,
          userId: s.userId != null ? String(s.userId) : null,
        })),
        note:
          "Product analyses, audit events, and vision feedback are shop/product-scoped and are not tied to a customer record.",
        shopScopedCounts: {
          analyses: analysisCount,
          auditEvents: auditCount,
          visionFeedback: feedbackCount,
        },
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};
