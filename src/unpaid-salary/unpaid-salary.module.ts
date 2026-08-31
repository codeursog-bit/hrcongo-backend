// ============================================================================
// 📁 src/unpaid-salary/unpaid-salary.module.ts
// ============================================================================
import { Module } from '@nestjs/common';
import { UnpaidSalaryService } from './unpaid-salary.service';
import { UnpaidSalaryController } from './unpaid-salary.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule, // ✅ nécessaire pour injecter NotificationsService
  ],
  controllers: [UnpaidSalaryController],
  providers: [UnpaidSalaryService],
  exports: [UnpaidSalaryService],
})
export class UnpaidSalaryModule {}
