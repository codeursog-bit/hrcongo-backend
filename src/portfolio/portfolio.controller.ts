import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from '../auth/get-user.decorator';
import { PortfolioStatsService } from './portfolio-stats.service';

// 🆕 GET /portfolio/stats — comptages agrégés pour le tableau de bord.
@Controller('portfolio')
@UseGuards(AuthGuard('jwt'))
export class PortfolioController {
  constructor(private readonly stats: PortfolioStatsService) {}

  @Get('stats')
  getStats(@GetUser('id') userId: string) {
    return this.stats.getStats(userId);
  }
}