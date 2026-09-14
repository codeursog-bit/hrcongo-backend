// ============================================================================
// Fichier: backend/src/platform-settings/platform-settings.module.ts
// ============================================================================

import { Module } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PlatformSettingsService],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}