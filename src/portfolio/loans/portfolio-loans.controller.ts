import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from '../../auth/get-user.decorator';
import { PortfolioLoansService } from './portfolio-loans.service';
import { CreateLoanDto } from '../../loans/dto/create-loan.dto';
import { CreateAdvanceDto } from '../../loans/dto/create-advance.dto';
import { UpdateLoanDto } from '../../loans/dto/update-loan.dto';
import { UpdateAdvanceDto } from '../../loans/dto/update-advance.dto';

// 🆕 Prêts/avances — vue transverse "toutes mes entreprises".
// ⚠️ Même règle que loans.controller.ts : les routes fixes ('advances', ...)
// sont déclarées AVANT ':id', sinon NestJS lirait '/advances' comme :id.
@Controller('portfolio/loans')
@UseGuards(AuthGuard('jwt'))
export class PortfolioLoansController {
  constructor(private readonly service: PortfolioLoansService) {}

  // ==================== Recherche transverse ====================
  @Get()
  search(
    @GetUser('id') userId: string,
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('type') type?: 'loan' | 'advance',
  ) {
    return this.service.search(userId, { companyId, status, type });
  }

  @Post()
  createLoan(@GetUser('id') userId: string, @Body() dto: CreateLoanDto) {
    return this.service.createLoan(userId, dto);
  }

  // ==================== Avances — routes fixes d'abord ====================
  @Post('advances')
  createAdvance(@GetUser('id') userId: string, @Body() dto: CreateAdvanceDto) {
    return this.service.createAdvance(userId, dto);
  }

  @Get('advances/:id')
  findOneAdvance(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.service.findOneAdvance(userId, id);
  }

  @Patch('advances/:id')
  updateAdvance(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAdvanceDto,
  ) {
    return this.service.updateAdvance(userId, id, dto);
  }

  @Delete('advances/:id')
  deleteAdvance(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.service.deleteAdvance(userId, id);
  }

  @Patch('advances/:id/cancel')
  cancelAdvance(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.service.cancelAdvance(userId, id);
  }

  @Patch('advances/:id/decision')
  decideAdvance(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body('decision') decision: 'APPROVED' | 'REJECTED',
    @Body('rejectionReason') rejectionReason: string,
    @Body('recoverViaPayroll') recoverViaPayroll: boolean,
  ) {
    return this.service.decideAdvance(
      userId,
      id,
      decision,
      rejectionReason,
      recoverViaPayroll ?? true,
    );
  }

  @Patch('advances/:id/mark-paid-cash')
  markAdvancePaidInCash(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.service.markAdvancePaidInCash(userId, id);
  }

  @Post('advances/:id/cash-repayment')
  recordAdvanceCashRepayment(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body('amount') amount: number,
  ) {
    return this.service.recordAdvanceCashRepayment(userId, id, Number(amount));
  }

  @Delete('advances/:id/cash-repayment/:logId')
  deleteAdvanceCashRepayment(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Param('logId') logId: string,
  ) {
    return this.service.deleteAdvanceCashRepayment(userId, id, logId);
  }

  @Get('advances/:id/history')
  getAdvanceHistory(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.service.getAdvanceHistory(userId, id);
  }

  // ==================== Prêts — routes avec :id (déclarées en dernier) ====================
  @Get(':id')
  findOneLoan(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.service.findOneLoan(userId, id);
  }

  @Patch(':id')
  updateLoan(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLoanDto,
  ) {
    return this.service.updateLoan(userId, id, dto);
  }

  @Delete(':id')
  deleteLoan(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.service.deleteLoan(userId, id);
  }

  @Patch(':id/cancel')
  cancelLoan(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.service.cancelLoan(userId, id);
  }

  @Patch(':id/decision')
  decideLoan(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body('decision') decision: 'OUI' | 'NON',
    @Body('rejectionReason') rejectionReason: string,
    @Body('recoverViaPayroll') recoverViaPayroll: boolean,
  ) {
    return this.service.decideLoan(
      userId,
      id,
      decision,
      rejectionReason,
      recoverViaPayroll ?? true,
    );
  }

  @Post(':id/cash-repayment')
  recordCashRepayment(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body('amount') amount: number,
  ) {
    return this.service.recordCashRepayment(userId, id, Number(amount));
  }

  @Get(':id/history')
  getLoanHistory(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.service.getLoanHistory(userId, id);
  }

  @Delete(':id/cash-repayment/:logId')
  deleteCashRepayment(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Param('logId') logId: string,
  ) {
    return this.service.deleteCashRepayment(userId, id, logId);
  }
}