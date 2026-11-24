// ============================================================================
// 📁 src/payroll/settings/settings.module.ts
// ============================================================================
import { Module } from '@nestjs/common';
import { PayrollSettingsService } from './settings.service';
import { PayrollSettingsController } from './settings.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PayrollSettingsController],
  providers: [PayrollSettingsService],
  exports: [PayrollSettingsService], // ✅ CRITICAL : Export pour autres modules
})
export class PayrollSettingsModule {}
