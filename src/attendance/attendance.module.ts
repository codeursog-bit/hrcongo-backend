import { Module, forwardRef } from '@nestjs/common'; // 👈 N'oublie pas d'ajouter forwardRef ici
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceSummaryService } from './attendance-summary.service';
import { AttendanceUtilsService } from './services/attendance-utils.service';
import { AttendanceCalculationService } from './services/attendance-calculation.service';
import { AttendanceCheckService } from './services/attendance-check.service';
import { AttendanceReportService } from './services/attendance-report.service';
import { AttendanceBreakService } from './services/attendance-break.service'; // 🆕 pause
import { AttendanceBreakController } from './attendance-break.controller'; // 🆕 pause
import { AttendanceCronModule } from './cron/attendance-cron.module'; // 🆕 Import du MODULE
import { PrismaModule } from '../prisma/prisma.module';
import { AppGateway } from '../app.gateway';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { CompaniesModule } from '../companies/companies.module';

@Module({
  imports: [
    PrismaModule,
    SubscriptionsModule,
    forwardRef(() => AttendanceCronModule), // 🆕 On importe le module qui gère déjà PushNotificationsService
    CompaniesModule,
  ],
  controllers: [AttendanceController, AttendanceBreakController],
  providers: [
    AttendanceService,
    AttendanceSummaryService,
    AttendanceUtilsService,
    AttendanceCalculationService,
    AttendanceCheckService,
    AttendanceReportService,
    AttendanceBreakService,
    AppGateway,
  ],
  exports: [
    AttendanceService,
    AttendanceSummaryService,
    AttendanceUtilsService,
    AttendanceBreakService, // 🆕 utilisé par les écrans QR / code secret / kiosque
    AttendanceCronModule, // 🆕 On exporte le module complet
  ],
})
export class AttendanceModule {}