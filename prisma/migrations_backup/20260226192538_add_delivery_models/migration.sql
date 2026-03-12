/*
  Warnings:

  - The values [PENDING] on the enum `DeliveryStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `email` on the `DeliveryPartner` table. All the data in the column will be lost.
  - You are about to drop the column `fullName` on the `DeliveryPartner` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `DeliveryPartner` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `DeliveryPartner` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[partnerId]` on the table `DeliveryPartner` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `drivingLicense` to the `DeliveryPartner` table without a default value. This is not possible if the table is not empty.
  - Added the required column `partnerId` to the `DeliveryPartner` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `vehicleType` on the `DeliveryPartner` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('SCOOTY', 'BIKE', 'CAR');

-- AlterEnum
BEGIN;
CREATE TYPE "DeliveryStatus_new" AS ENUM ('ASSIGNED', 'ON_THE_WAY_TO_STORE', 'ARRIVED_AT_STORE', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'DELIVERED', 'FAILED', 'CANCELLED');
ALTER TABLE "Delivery" ALTER COLUMN "status" TYPE "DeliveryStatus_new" USING ("status"::text::"DeliveryStatus_new");
ALTER TYPE "DeliveryStatus" RENAME TO "DeliveryStatus_old";
ALTER TYPE "DeliveryStatus_new" RENAME TO "DeliveryStatus";
DROP TYPE "public"."DeliveryStatus_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Delivery" DROP CONSTRAINT "Delivery_partnerId_fkey";

-- DropIndex
DROP INDEX "DeliveryPartner_email_key";

-- DropIndex
DROP INDEX "DeliveryPartner_phone_key";

-- AlterTable
ALTER TABLE "DeliveryPartner" DROP COLUMN "email",
DROP COLUMN "fullName",
DROP COLUMN "isActive",
DROP COLUMN "phone",
ADD COLUMN     "drivingLicense" TEXT NOT NULL,
ADD COLUMN     "isVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "partnerId" TEXT NOT NULL,
ADD COLUMN     "vehicleModel" TEXT,
DROP COLUMN "vehicleType",
ADD COLUMN     "vehicleType" "VehicleType" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPartner_partnerId_key" ON "DeliveryPartner"("partnerId");

-- AddForeignKey
ALTER TABLE "DeliveryPartner" ADD CONSTRAINT "DeliveryPartner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "DeliveryPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
