// 📁 EMPLACEMENT (projet backend) : src/device-sync/device-sync-pair.controller.ts
// ============================================================================
// 🤖 JUMELAGE : l'assistant de l'agent échange le code affiché dans Konza contre
//    sa clé. Route PUBLIQUE (l'agent n'a pas encore de clé) → protégée par :
//    code à usage unique de 8 caractères, valable 30 min, et limite stricte par IP
//    (10 essais/min, 30 par 15 min) en plus de la limite globale.
// ============================================================================
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DeviceSyncService } from './device-sync.service';
import { PairDto } from './dto/device-sync.dto';

@Controller('device-sync/agent')
export class DeviceSyncPairController {
  constructor(private readonly service: DeviceSyncService) {}

  @Post('pair')
  @HttpCode(200)
  @Throttle({ short: { limit: 10, ttl: 60_000 }, medium: { limit: 30, ttl: 900_000 } })
  pair(@Body() dto: PairDto) {
    return this.service.pair(dto.code);
  }
}