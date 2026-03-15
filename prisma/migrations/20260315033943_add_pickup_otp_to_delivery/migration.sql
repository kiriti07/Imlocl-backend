-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "pickupOtp" TEXT,
ADD COLUMN     "pickupOtpVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pickupOtpVerifiedAt" TIMESTAMP(3);
