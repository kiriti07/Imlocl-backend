/*
  Warnings:

  - A unique constraint covering the columns `[token]` on the table `Partner` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "MeatShop" ADD COLUMN     "closeTime" TEXT,
ADD COLUMN     "openTime" TEXT;

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "token" TEXT;

-- CreateTable
CREATE TABLE "MeatItem" (
    "id" TEXT NOT NULL,
    "meatShopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "minQty" DOUBLE PRECISION,
    "stepQty" DOUBLE PRECISION,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeatItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeatItem_meatShopId_idx" ON "MeatItem"("meatShopId");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_token_key" ON "Partner"("token");

-- AddForeignKey
ALTER TABLE "MeatItem" ADD CONSTRAINT "MeatItem_meatShopId_fkey" FOREIGN KEY ("meatShopId") REFERENCES "MeatShop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
