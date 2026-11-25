import { Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

/** Pulse signature protocol is not verified. Never trust or process this public payload.
 * The existing authenticated provider polling remains the payment source of truth.
 */
@Controller('webhooks/chariow')
export class ChariowWebhooksController {
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({default:{limit:10,ttl:60000}})
  handleWebhook() {
    return {received:true,processing:'POLLING_ONLY'};
  }
}
