-- AlterTable
ALTER TABLE "customer_order" ADD COLUMN     "deliveryNote" TEXT,
ADD COLUMN     "isScheduled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scheduleSlot" TEXT,
ADD COLUMN     "scheduledFor" TIMESTAMP(6);
