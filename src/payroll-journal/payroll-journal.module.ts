// ============================================================================
// 📁 src/payroll-journal/payroll-journal.module.ts
// Module AUTONOME : ne touche à aucun module existant (paie, reports...).
// ============================================================================
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PayrollJournalController } from './payroll-journal.controller';
import { PayrollJournalService } from './payroll-journal.service';
import { PayrollForeignPayService } from './payroll-foreign-pay.service';
import { PayrollJournalExportService } from './payroll-journal-export.service';

@Module({
  imports: [PrismaModule],
  controllers: [PayrollJournalController],
  providers: [
    PayrollJournalService,
    PayrollForeignPayService,
    PayrollJournalExportService,
  ],
  exports: [PayrollJournalService, PayrollForeignPayService],
})
export class PayrollJournalModule {}