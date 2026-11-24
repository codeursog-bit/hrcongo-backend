// ============================================================================
// 📁 src/company-taxes/company-tax.module.ts
// ✅ À importer dans app.module.ts
// ============================================================================

import { Module } from '@nestjs/common';
import { CompanyTaxController } from './company-tax.controller';
import { CompanyTaxService } from './company-tax.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CompanyTaxController],
  providers: [CompanyTaxService],
  exports: [CompanyTaxService], // ✅ Exporté pour être utilisé dans PayrollModule
})
export class CompanyTaxModule {}
