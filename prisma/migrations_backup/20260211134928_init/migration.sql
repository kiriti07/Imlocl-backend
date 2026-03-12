-- CreateEnum
CREATE TYPE "public"."PartnerRole" AS ENUM ('LAUNDRY_PARTNER', 'MEAT_PARTNER', 'TAILOR', 'COOK', 'DELIVERY');

-- CreateTable
CREATE TABLE "public"."Partner" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "role" "public"."PartnerRole" NOT NULL,
    "city" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LaundryShop" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaundryShop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MeatShop" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeatShop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_phone_key" ON "public"."Partner"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "LaundryShop_partnerId_key" ON "public"."LaundryShop"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "MeatShop_partnerId_key" ON "public"."MeatShop"("partnerId");

-- AddForeignKey
ALTER TABLE "public"."LaundryShop" ADD CONSTRAINT "LaundryShop_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MeatShop" ADD CONSTRAINT "MeatShop_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
