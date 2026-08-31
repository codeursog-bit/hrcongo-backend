// ============================================================================
// 5️⃣ DEPARTMENTS MODULE (MISE À JOUR)
// ============================================================================
// Fichier: src/departments/departments.module.ts

import { Module } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { DepartmentsController } from './departments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module'; // 🆕

@Module({
  imports: [
    PrismaModule,
    SubscriptionsModule, // 🆕
  ],
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
