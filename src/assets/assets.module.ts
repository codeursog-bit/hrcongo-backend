import { Module } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module'; // en haut

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
