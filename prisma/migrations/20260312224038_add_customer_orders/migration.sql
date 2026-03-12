-- CreateTable
CREATE TABLE "customer_order" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderNumber" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "storeType" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerAddress" TEXT NOT NULL,
    "customerLat" DOUBLE PRECISION,
    "customerLng" DOUBLE PRECISION,
    "paymentMethod" TEXT NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING_CASH_COLLECTION',
    "orderStatus" TEXT NOT NULL DEFAULT 'PLACED',
    "couponCode" TEXT,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "packagingCharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "platformFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "handlingFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "gst" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "restaurantGst" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "gstOnDeliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lateNightFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "deliveryId" UUID,
    "deliveryPartnerId" UUID,
    "placedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(6),
    "rejectedAt" TIMESTAMP(6),
    "readyForPickupAt" TIMESTAMP(6),
    "deliveredAt" TIMESTAMP(6),
    "cashCollectedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_order_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unit" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "lineTotal" DECIMAL(10,2) NOT NULL,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "actorType" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_order_orderNumber_key" ON "customer_order"("orderNumber");

-- CreateIndex
CREATE INDEX "customer_order_storeId_idx" ON "customer_order"("storeId");

-- CreateIndex
CREATE INDEX "customer_order_orderStatus_idx" ON "customer_order"("orderStatus");

-- CreateIndex
CREATE INDEX "customer_order_paymentStatus_idx" ON "customer_order"("paymentStatus");

-- CreateIndex
CREATE INDEX "customer_order_deliveryId_idx" ON "customer_order"("deliveryId");

-- CreateIndex
CREATE INDEX "customer_order_item_orderId_idx" ON "customer_order_item"("orderId");

-- CreateIndex
CREATE INDEX "order_status_history_orderId_idx" ON "order_status_history"("orderId");

-- CreateIndex
CREATE INDEX "order_status_history_status_idx" ON "order_status_history"("status");

-- AddForeignKey
ALTER TABLE "customer_order_item" ADD CONSTRAINT "customer_order_item_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "customer_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "customer_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
