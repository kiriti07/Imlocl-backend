-- CreateEnum
CREATE TYPE "public"."PartnerStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "public"."Partner" ADD COLUMN     "status" "public"."PartnerStatus" NOT NULL DEFAULT 'PENDING';
