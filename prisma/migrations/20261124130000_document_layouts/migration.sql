ALTER TYPE "document_template" ADD VALUE 'CUSTOM';

CREATE TABLE "document_layouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "docType" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Mon modèle',
    "basePreset" TEXT,
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "document_layouts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_layouts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "document_layouts_companyId_docType_key" ON "document_layouts"("companyId", "docType");
CREATE INDEX "document_layouts_companyId_idx" ON "document_layouts"("companyId");
