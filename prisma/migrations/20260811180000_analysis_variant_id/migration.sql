-- AlterTable
ALTER TABLE "Analysis" ADD COLUMN "variantId" TEXT;

-- CreateIndex
CREATE INDEX "Analysis_shop_productId_variantId_idx" ON "Analysis"("shop", "productId", "variantId");
