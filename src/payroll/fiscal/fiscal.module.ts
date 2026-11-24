// ============================================================================
// 📁 src/payroll/fiscal/fiscal.module.ts
// ============================================================================
import { Module } from '@nestjs/common';
import { IrppCalculatorService } from './irpp-calculator.service';
import { FiscalPartsService } from './fiscal-parts.service';

@Module({
  providers: [IrppCalculatorService, FiscalPartsService],
  exports: [IrppCalculatorService, FiscalPartsService],
})
export class FiscalModule {}
