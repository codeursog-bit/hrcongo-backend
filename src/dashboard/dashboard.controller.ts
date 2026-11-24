// import { Controller, Get, UseGuards, Request } from '@nestjs/common';
// import { DashboardService } from './dashboard.service';
// import { AuthGuard } from '@nestjs/passport';

// @Controller('dashboard')
// @UseGuards(AuthGuard('jwt'))
// export class DashboardController {
//   constructor(private readonly dashboardService: DashboardService) {}

//   @Get('summary')
//   getSummary(@Request() req) {
//     return this.dashboardService.getSummary(req.user.userId);
//   }

//   @Get('charts')
//   getCharts(@Request() req) {
//     return this.dashboardService.getChartsData(req.user.userId);
//   }
// }

import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // ─── ADMIN / HR / SUPER_ADMIN ────────────────────────────────
  @Get('summary')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER')
  async getSummary(@Request() req: any) {
    return this.dashboardService.getSummary(req.user.userId);
  }

  @Get('charts')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER')
  async getCharts(@Request() req: any) {
    return this.dashboardService.getChartsData(req.user.userId);
  }

  @Get('pending-requests-count')
  async getPendingRequestsCount(@Request() req) {
    return this.dashboardService.getPendingRequestsCount(req.user.userId);
  }

  // ─── MANAGER ─────────────────────────────────────────────────
  @Get('manager')
  @UseGuards(RolesGuard)
  @Roles('MANAGER')
  async getManagerSummary(@Request() req: any) {
    return this.dashboardService.getManagerSummary(req.user.userId);
  }
}
