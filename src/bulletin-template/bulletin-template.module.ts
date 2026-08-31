// ============================================================================
// src/bulletin-template/bulletin-template.module.ts
// ⚠️  Ajouter dans src/app.module.ts :
//     import { BulletinTemplateModule } from './bulletin-template/bulletin-template.module';
//     // Dans imports: [..., BulletinTemplateModule]
// ============================================================================
import { Module } from '@nestjs/common';
import { BulletinTemplateController } from './bulletin-template.controller';
import { BulletinTemplateService } from './bulletin-template.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BulletinTemplateController],
  providers: [BulletinTemplateService],
  exports: [BulletinTemplateService],
})
export class BulletinTemplateModule {}
