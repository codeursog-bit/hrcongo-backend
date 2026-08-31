/*
  Warnings:

  - A unique constraint covering the columns `[phone]` on the table `employees` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "employees" ALTER COLUMN "phone" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "employees_phone_key" ON "employees"("phone");
