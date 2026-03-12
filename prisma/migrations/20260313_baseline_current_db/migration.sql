-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PartnerRole" AS ENUM ('LAUNDRY_PARTNER', 'MEAT_PARTNER', 'TAILOR', 'COOK', 'DELIVERY', 'ORGANIC_PARTNER');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('ASSIGNED', 'ON_THE_WAY_TO_STORE', 'ARRIVED_AT_STORE', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('SCOOTY', 'BIKE', 'CAR');

-- CreateEnum
CREATE TYPE "CookTier" AS ENUM ('HOME_COOK', 'EXPERIENCED', 'PROFESSIONAL', 'CHEF');

-- CreateEnum
CREATE TYPE "MenuCategory" AS ENUM ('STARTER', 'MAIN_COURSE', 'SIDE_DISH', 'DESSERT', 'BEVERAGE', 'BREAD', 'RICE', 'CURRY', 'TANDOOR', 'BBQ', 'BIRYANI', 'THALI');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" "PartnerRole" NOT NULL,
    "city" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'PENDING',
    "address" TEXT,
    "businessName" TEXT,
    "email" TEXT,
    "experience" TEXT,
    "fullName" TEXT NOT NULL,
    "partnerType" TEXT NOT NULL,
    "token" TEXT,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignerProfile" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "bio" TEXT,
    "specialties" TEXT[],
    "avatar" TEXT,
    "coverImage" TEXT,
    "experience" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Design" (
    "id" TEXT NOT NULL,
    "designerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT '₹',
    "images" TEXT[],
    "tags" TEXT[],
    "isTrending" BOOLEAN NOT NULL DEFAULT false,
    "isNew" BOOLEAN NOT NULL DEFAULT true,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "inquiries" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'published',
    "fabricType" TEXT,
    "deliveryTime" TEXT,
    "readyToWear" BOOLEAN NOT NULL DEFAULT false,
    "customizationOptions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Design_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignerCategory" (
    "id" TEXT NOT NULL,
    "designerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignerCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignerSubcategory" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignerSubcategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignerItem" (
    "id" TEXT NOT NULL,
    "subcategoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "discountPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT '₹',
    "images" TEXT[],
    "videos" TEXT[],
    "availability" TEXT NOT NULL,
    "measurements" JSONB,
    "deliveryTime" TEXT,
    "customizationTime" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignerItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Size" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "inStock" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Size_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaundryShop" (
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
CREATE TABLE "MeatShop" (
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
    "closeTime" TEXT,
    "openTime" TEXT,

    CONSTRAINT "MeatShop_pkey" PRIMARY KEY ("id")
);

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
    "imageUrl" TEXT,
    "images" TEXT[],

    CONSTRAINT "MeatItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganicShop" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "openTime" TEXT,
    "closeTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganicShop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganicCategory" (
    "id" TEXT NOT NULL,
    "organicShopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganicCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganicItem" (
    "id" TEXT NOT NULL,
    "organicShopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "minQty" DOUBLE PRECISION,
    "stepQty" DOUBLE PRECISION,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "images" TEXT[],
    "category" TEXT,
    "isOrganic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "stock" INTEGER,
    "organicCategoryId" TEXT,

    CONSTRAINT "OrganicItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryPartner" (
    "id" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "currentLat" DOUBLE PRECISION,
    "currentLng" DOUBLE PRECISION,
    "lastLocationUpdate" TIMESTAMP(3),
    "currentOrders" INTEGER NOT NULL DEFAULT 0,
    "totalDeliveries" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "drivingLicense" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "partnerId" TEXT NOT NULL,
    "vehicleModel" TEXT,
    "vehicleType" "VehicleType" NOT NULL,

    CONSTRAINT "DeliveryPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerAddress" TEXT,
    "storeId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "storeAddress" TEXT,
    "status" "DeliveryStatus" NOT NULL,
    "assignedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "estimatedPickupTime" TIMESTAMP(3),
    "estimatedDeliveryTime" TIMESTAMP(3),
    "actualPickupTime" TIMESTAMP(3),
    "actualDeliveryTime" TIMESTAMP(3),
    "currentLat" DOUBLE PRECISION,
    "currentLng" DOUBLE PRECISION,
    "lastLocationUpdate" TIMESTAMP(3),
    "items" JSONB NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "coupon" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discount_type" TEXT,
    "discount_value" DECIMAL(10,2),
    "max_discount" DECIMAL(10,2),
    "min_order_value" DECIMAL(10,2),
    "service_type" TEXT,
    "expiry_date" TIMESTAMP(6),
    "usage_limit" INTEGER,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_payment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID,
    "payment_method" TEXT,
    "payment_gateway" TEXT,
    "transaction_id" TEXT,
    "status" TEXT,
    "amount" DECIMAL(10,2),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_fee_config" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "service_type" TEXT NOT NULL,
    "fee_code" TEXT NOT NULL,
    "fee_label" TEXT NOT NULL,
    "fee_type" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "min_order_value" DECIMAL(10,2),
    "city" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_fee_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT,
    "price" DECIMAL(10,2),
    "duration_days" INTEGER,
    "benefits" JSONB,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_phone_key" ON "Partner"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_token_key" ON "Partner"("token");

-- CreateIndex
CREATE UNIQUE INDEX "DesignerProfile_partnerId_key" ON "DesignerProfile"("partnerId");

-- CreateIndex
CREATE INDEX "Design_designerId_idx" ON "Design"("designerId");

-- CreateIndex
CREATE INDEX "Design_category_idx" ON "Design"("category");

-- CreateIndex
CREATE INDEX "Design_isTrending_idx" ON "Design"("isTrending");

-- CreateIndex
CREATE UNIQUE INDEX "DesignerCategory_designerId_name_key" ON "DesignerCategory"("designerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DesignerSubcategory_categoryId_name_key" ON "DesignerSubcategory"("categoryId", "name");

-- CreateIndex
CREATE INDEX "DesignerItem_subcategoryId_idx" ON "DesignerItem"("subcategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Size_itemId_size_key" ON "Size"("itemId", "size");

-- CreateIndex
CREATE UNIQUE INDEX "LaundryShop_partnerId_key" ON "LaundryShop"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "MeatShop_partnerId_key" ON "MeatShop"("partnerId");

-- CreateIndex
CREATE INDEX "MeatItem_meatShopId_idx" ON "MeatItem"("meatShopId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganicShop_partnerId_key" ON "OrganicShop"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganicCategory_organicShopId_name_key" ON "OrganicCategory"("organicShopId", "name");

-- CreateIndex
CREATE INDEX "OrganicItem_organicShopId_idx" ON "OrganicItem"("organicShopId");

-- CreateIndex
CREATE INDEX "OrganicItem_organicCategoryId_idx" ON "OrganicItem"("organicCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPartner_partnerId_key" ON "DeliveryPartner"("partnerId");

-- CreateIndex
CREATE INDEX "DeliveryPartner_isAvailable_idx" ON "DeliveryPartner"("isAvailable");

-- CreateIndex
CREATE INDEX "DeliveryPartner_currentOrders_idx" ON "DeliveryPartner"("currentOrders");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_orderId_key" ON "Delivery"("orderId");

-- CreateIndex
CREATE INDEX "Delivery_status_idx" ON "Delivery"("status");

-- CreateIndex
CREATE INDEX "Delivery_partnerId_idx" ON "Delivery"("partnerId");

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

-- CreateIndex
CREATE UNIQUE INDEX "coupon_code_key" ON "coupon"("code");

-- AddForeignKey
ALTER TABLE "DesignerProfile" ADD CONSTRAINT "DesignerProfile_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "DesignerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignerCategory" ADD CONSTRAINT "DesignerCategory_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "DesignerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignerSubcategory" ADD CONSTRAINT "DesignerSubcategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DesignerCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignerItem" ADD CONSTRAINT "DesignerItem_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "DesignerSubcategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Size" ADD CONSTRAINT "Size_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DesignerItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaundryShop" ADD CONSTRAINT "LaundryShop_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeatShop" ADD CONSTRAINT "MeatShop_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeatItem" ADD CONSTRAINT "MeatItem_meatShopId_fkey" FOREIGN KEY ("meatShopId") REFERENCES "MeatShop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganicShop" ADD CONSTRAINT "OrganicShop_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganicCategory" ADD CONSTRAINT "OrganicCategory_organicShopId_fkey" FOREIGN KEY ("organicShopId") REFERENCES "OrganicShop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganicItem" ADD CONSTRAINT "OrganicItem_organicCategoryId_fkey" FOREIGN KEY ("organicCategoryId") REFERENCES "OrganicCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganicItem" ADD CONSTRAINT "OrganicItem_organicShopId_fkey" FOREIGN KEY ("organicShopId") REFERENCES "OrganicShop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPartner" ADD CONSTRAINT "DeliveryPartner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "DeliveryPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

