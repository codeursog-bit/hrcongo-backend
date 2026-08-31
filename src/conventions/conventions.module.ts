// ============================================================================
// 📁 src/conventions/conventions.module.ts
// Identique à l'existant — ConventionsService exporté pour le module rupture
// ============================================================================
import { Module } from '@nestjs/common';
import { ConventionsController } from './conventions.controller';
import { ConventionsService } from './conventions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BonusTemplatesModule } from '../bonus-templates/bonus-templates.module';

@Module({
  imports: [PrismaModule, BonusTemplatesModule],
  controllers: [ConventionsController],
  providers: [ConventionsService],
  exports: [ConventionsService], // ← déjà exporté, inchangé
})
export class ConventionsModule {}