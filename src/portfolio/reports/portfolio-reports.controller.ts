import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from '../../auth/get-user.decorator';
import { PortfolioReportsService } from './portfolio-reports.service';

// 🆕 GET /portfolio/reports/overview — comparatif entre entreprises.
@Controller('portfolio/reports')
@UseGuards(AuthGuard('jwt'))
export class PortfolioReportsController {
  constructor(private readonly service: PortfolioReportsService) {}

  @Get('overview')
  getOverview(@GetUser('id') userId: string, @Query('months') months?: string) {
    return this.service.getOverview(userId, months ? Number(months) : undefined);
  }
}