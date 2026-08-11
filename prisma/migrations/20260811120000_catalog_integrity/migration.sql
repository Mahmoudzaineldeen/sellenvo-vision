-- Catalog Integrity persistence models

CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT,
    "imageUrl" TEXT,
    "imageHash" TEXT,
    "listingFingerprint" TEXT,
    "visualJson" TEXT NOT NULL,
    "listingJson" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "healthScore" INTEGER NOT NULL,
    "overallConfidence" REAL NOT NULL,
    "issuesJson" TEXT NOT NULL,
    "signalResultsJson" TEXT NOT NULL,
    "suggestedFixesJson" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'full',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "Analysis_shop_createdAt_idx" ON "Analysis"("shop", "createdAt");
CREATE INDEX "Analysis_shop_productId_idx" ON "Analysis"("shop", "productId");
CREATE INDEX "Analysis_shop_verdict_idx" ON "Analysis"("shop", "verdict");
CREATE INDEX "Analysis_shop_healthScore_idx" ON "Analysis"("shop", "healthScore");

CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "dedupeKey" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME
);

CREATE INDEX "ScanJob_shop_status_idx" ON "ScanJob"("shop", "status");
CREATE INDEX "ScanJob_status_priority_createdAt_idx" ON "ScanJob"("status", "priority", "createdAt");
CREATE UNIQUE INDEX "ScanJob_shop_dedupeKey_key" ON "ScanJob"("shop", "dedupeKey");

CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT,
    "attribute" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "confidence" REAL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "AuditEvent_shop_createdAt_idx" ON "AuditEvent"("shop", "createdAt");
CREATE INDEX "AuditEvent_shop_productId_idx" ON "AuditEvent"("shop", "productId");

CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "materialWriteMode" TEXT NOT NULL DEFAULT 'metafield',
    "autoScanOnCreate" BOOLEAN NOT NULL DEFAULT true,
    "safeAutoFixEnabled" BOOLEAN NOT NULL DEFAULT false,
    "showExperimentalAttributes" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "VisionFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "analysisId" TEXT,
    "attribute" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "VisionFeedback_shop_createdAt_idx" ON "VisionFeedback"("shop", "createdAt");
CREATE INDEX "VisionFeedback_shop_productId_idx" ON "VisionFeedback"("shop", "productId");
