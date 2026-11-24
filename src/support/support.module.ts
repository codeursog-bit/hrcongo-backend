import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  SupportController,
  SupportGuestController,
  SupportStaffController,
} from './support.controller';
import { SupportService } from './support.service';
@Module({
  imports: [PrismaModule],
  providers: [SupportService],
  controllers: [
    SupportController,
    SupportStaffController,
    SupportGuestController,
  ],
  exports: [SupportService],
})
export class SupportModule {}
