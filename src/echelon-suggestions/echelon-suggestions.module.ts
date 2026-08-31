// ============================================================================
// 📁 src/echelon-suggestions/echelon-suggestions.module.ts
// ============================================================================

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EchelonSuggestionsService } from './echelon-suggestions.service';
import { EchelonSuggestionsCron } from './echelon-suggestions.cron';
import { EchelonSuggestionsController } from './echelon-suggestions.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [EchelonSuggestionsController],
  providers: [EchelonSuggestionsService, EchelonSuggestionsCron],
  exports: [EchelonSuggestionsService],
})
export class EchelonSuggestionsModule {}