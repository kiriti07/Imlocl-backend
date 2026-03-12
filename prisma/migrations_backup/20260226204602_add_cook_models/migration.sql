-- CreateEnum
CREATE TYPE "CookTier" AS ENUM ('HOME_COOK', 'EXPERIENCED', 'PROFESSIONAL', 'CHEF');

-- CreateEnum
CREATE TYPE "MenuCategory" AS ENUM ('STARTER', 'MAIN_COURSE', 'SIDE_DISH', 'DESSERT', 'BEVERAGE', 'BREAD', 'RICE', 'CURRY', 'TANDOOR', 'BBQ', 'BIRYANI', 'THALI');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CookProfile" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "bio" TEXT,
    "experience" TEXT,
    "tier" "CookTier" NOT NULL DEFAULT 'HOME_COOK',
    "pricePerHour" DOUBLE PRECISION,
    "pricePerPerson" DOUBLE PRECISION,
    "minPeople" INTEGER,
    "maxPeople" INTEGER,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "avatar" TEXT,
    "coverImage" TEXT,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CookProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cuisine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cookProfileId" TEXT NOT NULL,

    CONSTRAINT "Cuisine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CookSpecialty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cookProfileId" TEXT NOT NULL,

    CONSTRAINT "CookSpecialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CookImage" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "cookProfileId" TEXT NOT NULL,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CookImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CookMenuItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "category" "MenuCategory" NOT NULL,
    "cuisine" TEXT,
    "isVegetarian" BOOLEAN NOT NULL DEFAULT false,
    "isVegan" BOOLEAN NOT NULL DEFAULT false,
    "isGlutenFree" BOOLEAN NOT NULL DEFAULT false,
    "isSignature" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT,
    "cookProfileId" TEXT NOT NULL,

    CONSTRAINT "CookMenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CookBooking" (
    "id" TEXT NOT NULL,
    "cookProfileId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerAddress" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "timeSlot" TEXT NOT NULL,
    "numberOfPeople" INTEGER NOT NULL,
    "specialRequests" TEXT,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CookBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CookProfile_partnerId_key" ON "CookProfile"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "Cuisine_cookProfileId_name_key" ON "Cuisine"("cookProfileId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CookSpecialty_cookProfileId_name_key" ON "CookSpecialty"("cookProfileId", "name");

-- CreateIndex
CREATE INDEX "CookMenuItem_cookProfileId_idx" ON "CookMenuItem"("cookProfileId");

-- CreateIndex
CREATE INDEX "CookBooking_cookProfileId_idx" ON "CookBooking"("cookProfileId");

-- CreateIndex
CREATE INDEX "CookBooking_status_idx" ON "CookBooking"("status");

-- AddForeignKey
ALTER TABLE "CookProfile" ADD CONSTRAINT "CookProfile_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cuisine" ADD CONSTRAINT "Cuisine_cookProfileId_fkey" FOREIGN KEY ("cookProfileId") REFERENCES "CookProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CookSpecialty" ADD CONSTRAINT "CookSpecialty_cookProfileId_fkey" FOREIGN KEY ("cookProfileId") REFERENCES "CookProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CookImage" ADD CONSTRAINT "CookImage_cookProfileId_fkey" FOREIGN KEY ("cookProfileId") REFERENCES "CookProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CookMenuItem" ADD CONSTRAINT "CookMenuItem_cookProfileId_fkey" FOREIGN KEY ("cookProfileId") REFERENCES "CookProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CookBooking" ADD CONSTRAINT "CookBooking_cookProfileId_fkey" FOREIGN KEY ("cookProfileId") REFERENCES "CookProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
