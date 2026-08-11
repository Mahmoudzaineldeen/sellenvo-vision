/**
 * DB-backed in-process scan job runner.
 * Concurrency 1–2. No Redis. Dedupe by shop+dedupeKey.
 */

import db from "../db.server";
import { logEvent } from "./logger.server";
import type { AdminClient } from "./shopify-fixes.server";
import {
  runFullAnalysis,
  getImageUrl,
} from "./analysis-pipeline.server";
import { listingFingerprint, hashImageUrl } from "./analysis-persist.server";
import { fetchProductNode } from "./shopify-fixes.server";
import { extractListingFacts } from "./consistency.server";
import { fetchProductSellenvoMetafields } from "./metafields.server";

const MAX_CONCURRENCY = 2;
let activeWorkers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function buildDedupeKey(args: {
  productId: string;
  imageHash?: string | null;
  listingFp?: string | null;
}): string {
  return `${args.productId}:${args.imageHash ?? ""}:${args.listingFp ?? ""}`;
}

export async function enqueueScanJob(args: {
  shop: string;
  productId: string;
  imageUrl?: string | null;
  listingFp?: string | null;
  priority?: number;
}): Promise<{ id: string; deduped: boolean }> {
  const imageHash = args.imageUrl ? hashImageUrl(args.imageUrl) : null;
  const dedupeKey = buildDedupeKey({
    productId: args.productId,
    imageHash,
    listingFp: args.listingFp,
  });

  const existing = await db.scanJob.findUnique({
    where: { shop_dedupeKey: { shop: args.shop, dedupeKey } },
  });
  if (
    existing &&
    (existing.status === "queued" || existing.status === "running")
  ) {
    return { id: existing.id, deduped: true };
  }

  // Replace terminal jobs with same dedupe key
  if (existing) {
    await db.scanJob.delete({ where: { id: existing.id } });
  }

  const row = await db.scanJob.create({
    data: {
      shop: args.shop,
      productId: args.productId,
      status: "queued",
      dedupeKey,
      priority: args.priority ?? 0,
    },
  });
  ensureJobPoller();
  return { id: row.id, deduped: false };
}

export async function cancelScanJob(id: string): Promise<boolean> {
  const row = await db.scanJob.findUnique({ where: { id } });
  if (!row || row.status !== "queued") return false;
  await db.scanJob.update({
    where: { id },
    data: { status: "cancelled", finishedAt: new Date() },
  });
  return true;
}

export async function listScanJobs(
  shop: string,
  opts?: { status?: string; take?: number },
) {
  return db.scanJob.findMany({
    where: {
      shop,
      ...(opts?.status ? { status: opts.status } : {}),
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: opts?.take ?? 50,
  });
}

type AdminFactory = (shop: string) => Promise<AdminClient | null>;

let adminFactory: AdminFactory | null = null;

/** Wire shop → admin client factory from the app bootstrap. */
export function configureJobAdminFactory(factory: AdminFactory): void {
  adminFactory = factory;
}

async function processOneJob(): Promise<boolean> {
  if (activeWorkers >= MAX_CONCURRENCY) return false;
  if (!adminFactory) return false;

  const job = await db.scanJob.findFirst({
    where: { status: "queued" },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  if (!job) return false;

  activeWorkers += 1;
  await db.scanJob.update({
    where: { id: job.id },
    data: {
      status: "running",
      attempts: job.attempts + 1,
      startedAt: new Date(),
    },
  });

  try {
    const admin = await adminFactory(job.shop);
    if (!admin) {
      throw new Error("Could not create Admin API client for shop");
    }
    const result = await runFullAnalysis(admin, job.productId, {
      shop: job.shop,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    await db.scanJob.update({
      where: { id: job.id },
      data: { status: "done", finishedAt: new Date(), error: null },
    });
    logEvent({
      level: "info",
      event: "scan_job.done",
      productId: job.productId,
      details: { jobId: job.id, shop: job.shop },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedPermanently = job.attempts + 1 >= job.maxAttempts;
    await db.scanJob.update({
      where: { id: job.id },
      data: {
        status: failedPermanently ? "failed" : "queued",
        error: message,
        finishedAt: failedPermanently ? new Date() : null,
      },
    });
    logEvent({
      level: "error",
      event: "scan_job.failed",
      productId: job.productId,
      details: {
        jobId: job.id,
        shop: job.shop,
        error: message,
        permanent: failedPermanently,
      },
    });
  } finally {
    activeWorkers -= 1;
  }
  return true;
}

async function tick(): Promise<void> {
  try {
    let progressed = true;
    while (progressed && activeWorkers < MAX_CONCURRENCY) {
      progressed = await processOneJob();
    }
  } catch (err) {
    logEvent({
      level: "error",
      event: "scan_job.poller_error",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export function ensureJobPoller(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void tick();
  }, 2000);
  // Don't keep process alive solely for poller in tests
  if (typeof pollTimer === "object" && "unref" in pollTimer) {
    pollTimer.unref();
  }
}

export async function enqueueProductScanFromAdmin(
  admin: AdminClient,
  shop: string,
  productId: string,
): Promise<{ id: string; deduped: boolean }> {
  const product = await fetchProductNode(admin, productId);
  if (!product) {
    return enqueueScanJob({ shop, productId });
  }
  const imageUrl = getImageUrl(product);
  let listingFp: string | null = null;
  try {
    const meta = await fetchProductSellenvoMetafields(admin, productId);
    const listing = extractListingFacts(product, meta);
    listingFp = listingFingerprint(listing);
  } catch {
    /* ignore */
  }
  return enqueueScanJob({
    shop,
    productId,
    imageUrl,
    listingFp,
  });
}
