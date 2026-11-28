// ============================================================================
// 📁 src/accounting/accounting-payroll.controller.ts
// ============================================================================
import { BadRequestException, Controller, DefaultValuePipe, Get, ParseIntPipe, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AccountingPayrollService } from './accounting-payroll.service';

const PAYROLL_ROLES = ['ADMIN', 'HR_MANAGER', 'CABINET_ADMIN', 'CABINET_GESTIONNAIRE'];

@Controller('accounting/payroll')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(...PAYROLL_ROLES)
export class AccountingPayrollController {
  constructor(private readonly service: AccountingPayrollService) {}

  /** Règlements du mois : net, CNSS, DGI, TOL (?paidOnly=false pour inclure les nets non payés). */
  @Get('settlements')
  settlements(
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Query('paidOnly', new DefaultValuePipe('true')) paidOnly: string,
    @Request() req: any,
  ) {
    if (month < 1 || month > 12) throw new BadRequestException('month entre 1 et 12');
    return this.service.settlements(req.user.userId, month, year, paidOnly !== 'false');
  }

  /** Provision des congés payés à une date : écriture de variation (?previous = stock déjà comptabilisé, XAF). */
  @Get('leave-provision')
  leaveProvision(@Query('date') date: string, @Query('previous', new DefaultValuePipe('0'), ParseIntPipe) previous: number, @Request() req: any) {
    return this.service.leaveProvision(req.user.userId, date, previous);
  }
}