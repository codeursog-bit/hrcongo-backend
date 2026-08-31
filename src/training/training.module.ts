import { Module } from '@nestjs/common';
import { TrainingService } from './training.service';
import { TrainingController } from './training.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AppGateway } from '../app.gateway';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [TrainingController],
  providers: [TrainingService, AppGateway],
})
export class TrainingModule {}
