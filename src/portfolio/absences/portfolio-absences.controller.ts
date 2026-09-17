import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from '../../auth/get-user.decorator';
import { PortfolioAbsenceRequestsService } from './portfolio-absence-requests.service';
import { PortfolioAbsenceTrackingService } from './portfolio-absence-tracking.service';
import { CreateAbsenceRequestDto } from '../../absence-requests/dto/create-absence-request.dto';

// 🆕 Absences — vue transverse "toutes mes entreprises".
// Deux volets : demandes d'absence (requests) et tableaux de bord (tracking).
@Controller('portfolio/absences')
@UseGuards(AuthGuard('jwt'))
export class PortfolioAbsencesController {
  constructor(
    private readonly requests: PortfolioAbsenceRequestsService,
    private readonly tracking: PortfolioAbsenceTrackingService,
  ) {}

  // ==================== Demandes d'absence ====================
  @Get('requests')
  search(
    @GetUser('id') userId: string,
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
  ) {
    return this.requests.search(userId, { companyId, status });
  }

  @Post('requests')
  create(@GetUser('id') userId: string, @Body() dto: CreateAbsenceRequestDto) {
    return this.requests.create(userId, dto);
  }

  @Get('requests/:id')
  findOne(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.requests.findOne(userId, id);
  }

  @Patch('requests/:id/status')
  updateStatus(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body('status') status: 'APPROVED' | 'REJECTED',
    @Body('rejectionReason') rejectionReason?: string,
    @Body('isPaid') isPaid?: boolean,
  ) {
    return this.requests.updateStatus(userId, id, status, rejectionReason, isPaid);
  }

  @Patch('requests/:id/cancel')
  cancel(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.requests.cancel(userId, id, reason);
  }

  // ==================== Tableaux de bord (une entreprise à la fois) ====================
  @Get('tracking/grid')
  getMonthlyGrid(
    @GetUser('id') userId: string,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('departmentId') departmentId?: string,
  ) {
    return this.tracking.getMonthlyGrid(
      userId,
      companyId,
      Number(year),
      Number(month),
      departmentId,
    );
  }

  @Get('tracking/dashboard')
  getMonthlyDashboard(
    @GetUser('id') userId: string,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.tracking.getMonthlyDashboard(userId, companyId, Number(year), Number(month));
  }

  @Get('tracking/journal')
  getMonthJournal(
    @GetUser('id') userId: string,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.tracking.getMonthJournal(userId, companyId, Number(year), Number(month));
  }

  @Get('tracking/yearly')
  getYearlyOverview(
    @GetUser('id') userId: string,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
  ) {
    return this.tracking.getYearlyOverview(userId, companyId, Number(year));
  }
}