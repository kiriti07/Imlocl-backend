/*
  Warnings:

  - You are about to drop the column `name` on the `Partner` table. All the data in the column will be lost.
  - Added the required column `fullName` to the `Partner` table without a default value. This is not possible if the table is not empty.
  - Added the required column `partnerType` to the `Partner` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."Partner" DROP COLUMN "name",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "businessName" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "experience" TEXT,
ADD COLUMN     "fullName" TEXT NOT NULL,
ADD COLUMN     "partnerType" TEXT NOT NULL;
