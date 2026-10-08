// ============================================================================
// 📁 src/unpaid-salary/unpaid-salary.module.ts
// ============================================================================
import { Module } from '@nestjs/common';
import { UnpaidSalaryService } from './unpaid-salary.service';
import { UnpaidSalaryController } from './unpaid-salary.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PayrollsModule } from '../payrolls/payrolls.module'; // 🆕 simulation de paie (montant dû des mois sans bulletin)

@Module({
  imports: [
    PrismaModule,
    NotificationsModule, // ✅ nécessaire pour injecter NotificationsService
    PayrollsModule, // 🆕 exporte PayrollsService (utilisé en lecture seule, le calcul de paie n'est pas modifié)
  ],
  controllers: [UnpaidSalaryController],
  providers: [UnpaidSalaryService],
  exports: [UnpaidSalaryService],
})
export class UnpaidSalaryModule {}