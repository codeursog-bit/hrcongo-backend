import { Module } from '@nestjs/common';
import { CompanyDeductionsController } from './company-deductions.controller';
import { CompanyDeductionsService } from './company-deductions.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CompanyDeductionsController],
  providers: [CompanyDeductionsService],
  exports: [CompanyDeductionsService],
})
export class CompanyDeductionsModule {}
