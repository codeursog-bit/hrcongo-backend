// ============================================================================
// 📁 src/absence-tracking/absence-tracking.module.ts
// ✅ Module autonome — aucune dépendance sur LeavesModule ni
//    AbsenceRequestsModule (il lit directement via PrismaService, en
//    lecture seule). Une seule ligne à ajouter dans app.module.ts :
//    imports: [..., AbsenceTrackingModule]
// ============================================================================

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AbsenceTrackingController } from './absence-tracking.controller';
import { AbsenceTrackingService } from './absence-tracking.service';
// ✅ AttendanceUtilsService n'a aucune dépendance propre (pure logique de
//    dates/jours ouvrés) — on l'instancie directement ici plutôt que
//    d'importer tout AttendanceModule (qui traîne CompaniesModule,
//    SubscriptionsModule, AttendanceCronModule…), pour rester un module
//    autonome comme prévu à l'origine.
import { AttendanceUtilsService } from '../attendance/services/attendance-utils.service';

@Module({
  imports: [PrismaModule],
  controllers: [AbsenceTrackingController],
  providers: [AbsenceTrackingService, AttendanceUtilsService],
})
export class AbsenceTrackingModule {}