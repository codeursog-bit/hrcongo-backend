import { Module } from '@nestjs/common';
import { PerformanceService } from './performance.service';
import { PerformanceController } from './performance.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module'; // 🆕

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [PerformanceController],
  providers: [PerformanceService],
})
export class PerformanceModule {}
