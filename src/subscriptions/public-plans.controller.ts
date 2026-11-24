import { Controller, Get, Header } from '@nestjs/common';
import { PricingService } from './pricing.service';

@Controller('public/subscriptions')
export class PublicPlansController {
  constructor(private readonly pricing: PricingService) {}

  @Get('plans')
  @Header('Cache-Control', 'no-store')
  async getPlans() {
    return { plans: await this.pricing.getPlans() };
  }
}
