// ============================================================================
// 📁 src/contract-templates/contract-templates.module.ts
// Importé dans app.module.ts. Le calcul brut/net vient de ContractBreakdownService
// (même moteur que la paie : IrppCalculatorService via FiscalModule).
// ============================================================================
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FiscalModule } from '../payroll/fiscal/fiscal.module';
import { ContractTemplatesController } from './contract-templates.controller';
import { ContractTemplatesService } from './contract-templates.service';
import { ContractBreakdownService } from './contract-breakdown.service';

@Module({
  imports: [PrismaModule, FiscalModule],
  controllers: [ContractTemplatesController],
  providers: [ContractTemplatesService, ContractBreakdownService],
  exports: [ContractTemplatesService],
})
export class ContractTemplatesModule {}