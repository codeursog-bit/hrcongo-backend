// ============================================================================
// 📁 src/cnss-declaration/cnss-declaration.module.ts
// ============================================================================
import { Module } from '@nestjs/common';
import { CnssDeclarationService } from './cnss-declaration.service';
import { CnssDeclarationController } from './cnss-declaration.controller';
import { CnssCamuDeadlineReminderService } from './cnss-camu-deadline-reminder.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule, // ✅ nécessaire pour injecter NotificationsService (rappels CNSS/CAMU)
  ],
  controllers: [CnssDeclarationController],
  providers: [CnssDeclarationService, CnssCamuDeadlineReminderService],
  exports: [CnssDeclarationService],
})
export class CnssDeclarationModule {}

// ────────────────────────────────────────────────────────────────────────────
// ⚙️  À AJOUTER dans src/app.module.ts :
//
//   import { CnssDeclarationModule } from './cnss-declaration/cnss-declaration.module';
//
//   @Module({
//     imports: [
//       ...
//       CnssDeclarationModule,   // ← ajouter ici
//     ],
//   })
// ────────────────────────────────────────────────────────────────────────────