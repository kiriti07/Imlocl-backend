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
