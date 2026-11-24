// ============================================================================
// Fichier: backend/src/system-logs/system-logs.module.ts
// ============================================================================

import { Module } from '@nestjs/common';
import { SystemLogsService } from './system-logs.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SystemLogsService],
  exports: [SystemLogsService],
})
export class SystemLogsModule {}