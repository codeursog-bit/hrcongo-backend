// 📁 src/bonus-templates/bonus-templates.module.ts
import { Module } from '@nestjs/common';
import { BonusTemplatesService } from './bonus-templates.service';
import { BonusTemplatesController } from './bonus-templates.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [BonusTemplatesService],
  exports: [BonusTemplatesService],
  controllers: [BonusTemplatesController],
})
export class BonusTemplatesModule {}