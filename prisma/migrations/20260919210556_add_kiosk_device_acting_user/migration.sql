/*
  Warnings:

  - Added the required column `actingUserId` to the `KioskDevice` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "KioskDevice" ADD COLUMN     "actingUserId" UUID NOT NULL;

-- AddForeignKey
ALTER TABLE "KioskDevice" ADD CONSTRAINT "KioskDevice_actingUserId_fkey" FOREIGN KEY ("actingUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
