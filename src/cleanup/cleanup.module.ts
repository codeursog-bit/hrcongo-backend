// ============================================================================
// 📁 src/cleanup/cleanup.module.ts
// ============================================================================
import { Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [CleanupService],
  exports: [CleanupService],
})
export class CleanupModule {}
