import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from '../../auth/get-user.decorator';
import { PortfolioAttendanceService } from './portfolio-attendance.service';

// 🆕 Présences — vue transverse "toutes mes entreprises" (consultation).
// Toutes les routes prennent companyId en query : on choisit l'entreprise
// du portefeuille qu'on veut suivre, comme on choisirait un onglet.
@Controller('portfolio/attendance')
@UseGuards(AuthGuard('jwt'))
export class PortfolioAttendanceController {
  constructor(private readonly service: PortfolioAttendanceService) {}

  @Get('today')
  findToday(@GetUser('id') userId: string, @Query('companyId') companyId: string) {
    return this.service.findToday(userId, companyId);
  }

  @Get()
  findAll(
    @GetUser('id') userId: string,
    @Query('companyId') companyId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.service.findAll(userId, companyId, Number(month), Number(year));
  }

  @Get('logs')
  getLogs(
    @GetUser('id') userId: string,
    @Query('companyId') companyId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.service.getLogs(userId, companyId, Number(month), Number(year));
  }

  @Get('report')
  generateMonthlyReport(
    @GetUser('id') userId: string,
    @Query('companyId') companyId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.service.generateMonthlyReport(userId, companyId, Number(month), Number(year));
  }

  @Get('grid')
  generateMonthlyAttendanceGrid(
    @GetUser('id') userId: string,
    @Query('companyId') companyId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.service.generateMonthlyAttendanceGrid(userId, companyId, Number(month), Number(year));
  }

  @Get('employee/:employeeId')
  getEmployeeDayStatuses(
    @GetUser('id') userId: string,
    @Param('employeeId') employeeId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.service.getEmployeeDayStatuses(userId, employeeId, Number(month), Number(year));
  }

  @Get('employee/:employeeId/summary')
  getEmployeeSummary(
    @GetUser('id') userId: string,
    @Param('employeeId') employeeId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.service.getEmployeeSummary(userId, employeeId, Number(month), Number(year));
  }
}