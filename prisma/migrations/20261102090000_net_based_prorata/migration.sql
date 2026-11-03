-- AlterTable
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "netBasedProrata" BOOLEAN NOT NULL DEFAULT false;