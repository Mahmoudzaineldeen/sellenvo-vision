import { createHash } from "node:crypto";
import db from "../db.server";
import type { AnalysisResult, ListingFacts, VisualFacts } from "./types";

const ANALYSIS_RETENTION_DAYS = 90;
const AUDIT_RETENTION_DAYS = 365;

export function hashImageUrl(imageUrl: string): string {
  return createHash("sha256").update(imageUrl).digest("hex").slice(0, 32);
}

export function listingFingerprint(listing: ListingFacts): string {
  const raw = JSON.stringify({
    color: listing.claimedColor,
    type: listing.productType,
    material: listing.claimedMaterial,
    materialSource: listing.materialSource ?? null,
    pattern: listing.claimedPattern ?? null,
    finish: listing.claimedFinish ?? null,
    sleeveType: listing.claimedSleeveType ?? null,
    neckline: listing.claimedNeckline ?? null,
    closureType: listing.claimedClosureType ?? null,
    shoeStyle: listing.claimedShoeStyle ?? null,
    strapType: listing.claimedStrapType ?? null,
    title: listing.productTitle,
  });
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export async function persistAnalysis(args: {
  shop: string;
  productId: string;
  productTitle?: string | null;
  imageUrl: string;
  listing: ListingFacts;
  visual: VisualFacts;
  analysis: AnalysisResult;
  analysisContract?: string | null;
}): Promise<string> {
  const row = await db.analysis.create({
    data: {
      shop: args.shop,
      productId: args.productId,
      productTitle: args.productTitle ?? args.listing.productTitle,
      imageUrl: args.imageUrl,
      imageHash: hashImageUrl(args.imageUrl),
      listingFingerprint: listingFingerprint(args.listing),
      analysisContract: args.analysisContract ?? null,
      visualJson: JSON.stringify(args.visual),
      listingJson: JSON.stringify(args.listing),
      verdict: args.analysis.overallVerdict,
      healthScore: args.analysis.healthScore,
      overallConfidence: args.analysis.overallConfidence,
      issuesJson: JSON.stringify(args.analysis.issues),
      signalResultsJson: JSON.stringify(args.analysis.signalResults),
      suggestedFixesJson: JSON.stringify(args.analysis.suggestedFixes),
      source: args.analysis.analysisSource ?? "full",
    },
  });
  return row.id;
}

/** Recent successful mutations for Guardian history / revert UI. */
export async function listRecentSuccessfulAudits(args: {
  shop: string;
  productId: string;
  take?: number;
}) {
  return db.auditEvent.findMany({
    where: {
      shop: args.shop,
      productId: args.productId,
      success: true,
      reason: { not: "revert" },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(args.take ?? 10, 25),
  });
}

export async function getLatestAnalysisForProduct(
  shop: string,
  productId: string,
) {
  return db.analysis.findFirst({
    where: { shop, productId },
    orderBy: { createdAt: "desc" },
  });
}

export async function listCatalogHealth(
  shop: string,
  opts?: {
    take?: number;
    skip?: number;
    verdict?: "MISMATCH" | "UNCERTAIN" | "MATCH" | "all";
  },
) {
  const take = Math.min(opts?.take ?? 50, 100);
  const skip = opts?.skip ?? 0;
  const verdict = opts?.verdict && opts.verdict !== "all" ? opts.verdict : null;

  // Latest analysis per product via grouped subquery (avoids N+1 and over-fetch)
  const rows = await db.$queryRawUnsafe<
    Array<{
      id: string;
      shop: string;
      productId: string;
      productTitle: string | null;
      imageUrl: string | null;
      verdict: string;
      healthScore: number;
      overallConfidence: number;
      issuesJson: string;
      createdAt: Date;
    }>
  >(
    `SELECT a.id, a.shop, a.productId, a.productTitle, a.imageUrl,
            a.verdict, a.healthScore, a.overallConfidence, a.issuesJson, a.createdAt
     FROM Analysis a
     INNER JOIN (
       SELECT productId, MAX(createdAt) AS maxCreated
       FROM Analysis
       WHERE shop = ?
       GROUP BY productId
     ) latest
       ON a.productId = latest.productId AND a.createdAt = latest.maxCreated
     WHERE a.shop = ?
       ${verdict ? "AND a.verdict = ?" : ""}
     ORDER BY
       CASE a.verdict
         WHEN 'MISMATCH' THEN 0
         WHEN 'UNCERTAIN' THEN 1
         ELSE 2
       END,
       a.createdAt DESC
     LIMIT ? OFFSET ?`,
    ...(verdict
      ? [shop, shop, verdict, take, skip]
      : [shop, shop, take, skip]),
  );

  return rows;
}

export type CatalogHealthSummary = {
  totalScanned: number;
  needsAttention: number;
  uncertain: number;
  healthy: number;
  recentlyFixed: number;
  byAttribute: Record<string, number>;
  loadMs: number;
};

/**
 * Aggregate Inbox summary from latest-per-product analyses — one query + in-memory group.
 */
export async function summarizeCatalogHealth(
  shop: string,
): Promise<CatalogHealthSummary> {
  const started = Date.now();
  const latest = await listCatalogHealth(shop, { take: 500 });
  const summary: CatalogHealthSummary = {
    totalScanned: latest.length,
    needsAttention: 0,
    uncertain: 0,
    healthy: 0,
    recentlyFixed: 0,
    byAttribute: {},
    loadMs: 0,
  };

  for (const row of latest) {
    if (row.verdict === "MISMATCH") {
      summary.needsAttention += 1;
      try {
        const issues = JSON.parse(row.issuesJson) as Array<{
          signal: string;
          verdict: string;
        }>;
        for (const issue of issues) {
          if (issue.verdict === "MISMATCH") {
            summary.byAttribute[issue.signal] =
              (summary.byAttribute[issue.signal] ?? 0) + 1;
          }
        }
      } catch {
        /* ignore */
      }
    } else if (row.verdict === "UNCERTAIN") {
      summary.uncertain += 1;
    } else if (row.verdict === "MATCH") {
      summary.healthy += 1;
    }
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  summary.recentlyFixed = await db.auditEvent.count({
    where: { shop, success: true, createdAt: { gte: since } },
  });
  summary.loadMs = Date.now() - started;
  return summary;
}

export async function recordAuditEvent(args: {
  shop: string;
  productId: string;
  userId?: string | null;
  attribute: string;
  oldValue?: string | null;
  newValue?: string | null;
  reason?: string | null;
  confidence?: number | null;
  success: boolean;
  error?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await db.auditEvent.create({
    data: {
      shop: args.shop,
      productId: args.productId,
      userId: args.userId ?? null,
      attribute: args.attribute,
      oldValue: args.oldValue ?? null,
      newValue: args.newValue ?? null,
      reason: args.reason ?? null,
      confidence: args.confidence ?? null,
      success: args.success,
      error: args.error ?? null,
      metaJson: args.meta ? JSON.stringify(args.meta) : null,
    },
  });
}

/** Latest successful mutation for an attribute — used by revert. */
export async function getLatestSuccessfulAudit(args: {
  shop: string;
  productId: string;
  attribute: string;
}) {
  return db.auditEvent.findFirst({
    where: {
      shop: args.shop,
      productId: args.productId,
      attribute: args.attribute,
      success: true,
      reason: { not: "revert" },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function recordVisionFeedback(args: {
  shop: string;
  productId: string;
  analysisId?: string | null;
  attribute?: string | null;
  note?: string | null;
}): Promise<void> {
  await db.visionFeedback.create({
    data: {
      shop: args.shop,
      productId: args.productId,
      analysisId: args.analysisId ?? null,
      attribute: args.attribute ?? null,
      note: args.note ?? null,
    },
  });
}

export async function purgeExpiredShopData(shop?: string): Promise<void> {
  const analysisCutoff = new Date(
    Date.now() - ANALYSIS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const auditCutoff = new Date(
    Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const shopFilter = shop ? { shop } : {};
  await db.analysis.deleteMany({
    where: { ...shopFilter, createdAt: { lt: analysisCutoff } },
  });
  await db.auditEvent.deleteMany({
    where: { ...shopFilter, createdAt: { lt: auditCutoff } },
  });
}

/** Uninstall cleanup — delete all shop-scoped persisted data */
export async function deleteAllShopData(shop: string): Promise<void> {
  await db.$transaction([
    db.analysis.deleteMany({ where: { shop } }),
    db.scanJob.deleteMany({ where: { shop } }),
    db.auditEvent.deleteMany({ where: { shop } }),
    db.visionFeedback.deleteMany({ where: { shop } }),
    db.shopSettings.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);
}
