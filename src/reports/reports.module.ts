import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ExportService } from '../payrolls/export.service';
import { PayrollRecapService } from './payroll-recap.service';
import { PayrollRecapExportService } from './payroll-recap-export.service';
import { Das1DeclarationService } from './das1-declaration.service';
import { ReportsController } from './reports.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ConventionsModule } from '../conventions/conventions.module';

@Module({
  imports: [PrismaModule, ConventionsModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ExportService,
    PayrollRecapService,
    PayrollRecapExportService,
    Das1DeclarationService,
  ],
  exports: [
    ReportsService,
    ExportService, // ✅ IMPORTANT : Export les deux services
    PayrollRecapService,
    PayrollRecapExportService,
    Das1DeclarationService,
  ],
})
export class ReportsModule {}