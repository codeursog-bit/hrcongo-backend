-- AlterTable
ALTER TABLE "leaves" ADD COLUMN     "carriedFromLeaveId" UUID;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_carriedFromLeaveId_fkey" FOREIGN KEY ("carriedFromLeaveId") REFERENCES "leaves"("id") ON DELETE SET NULL ON UPDATE CASCADE;
