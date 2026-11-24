import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DasDeclarationController } from './das-declaration.controller';
import { DasDeclarationService } from './das-declaration.service';

@Module({
  imports: [PrismaModule],
  controllers: [DasDeclarationController],
  providers: [DasDeclarationService],
})
export class DasDeclarationModule {}
