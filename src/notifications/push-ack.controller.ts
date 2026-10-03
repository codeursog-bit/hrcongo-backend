import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PushNotificationsService } from './push-notifications.service';

// 🆕 Accusé de réception d'une notification push, appelé par le service worker (sw.js) de l'appareil.
// Volontairement SANS authentification : le service worker n'a pas de session. L'identifiant est un
// UUID aléatoire, connu uniquement de l'appareil destinataire, et l'appel ne fait qu'horodater l'envoi.
@Controller('push')
export class PushAckController {
  constructor(private readonly push: PushNotificationsService) {}

  @Post('ack/:id')
  @HttpCode(204)
  @Throttle({ short: { limit: 120, ttl: 60_000 } })
  async ack(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.push.acknowledge(id); // réponse identique que l'id existe ou non
  }
}