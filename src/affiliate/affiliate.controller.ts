// src/affiliate/affiliate.controller.ts
import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { AffiliateAdminService } from './affiliate-admin.service';
import { AffiliateJwtGuard } from './guards/affiliate-jwt.guard';
import { AffiliateRegisterDto } from './dto/affiliate-register.dto';
import { AffiliateLoginDto } from './dto/affiliate-login.dto';
import { UltraAdminGuard } from '../admin/guards/ultra-admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('affiliate')
export class AffiliateController {
  constructor(
    private readonly affiliateService: AffiliateService,
    private readonly affiliateAdminService: AffiliateAdminService,
  ) {}

  // ── AUTH ──────────────────────────────────────────────────────────────────

  @Post('register')
  register(@Body() dto: AffiliateRegisterDto) {
    return this.affiliateService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: AffiliateLoginDto) {
    return this.affiliateService.login(dto);
  }

  // ── AFFILIÉ CONNECTÉ ──────────────────────────────────────────────────────

  @Get('dashboard')
  @UseGuards(AffiliateJwtGuard)
  getDashboard(@Req() req: any) {
    return this.affiliateService.getDashboard(req.affiliate.id);
  }

  @Post('withdrawal/request')
  @UseGuards(AffiliateJwtGuard)
  requestWithdrawal(@Req() req: any) {
    return this.affiliateService.requestWithdrawal(req.affiliate.id);
  }

  // ── SUPER-ADMIN ───────────────────────────────────────────────────────────

  @Get('admin/threshold')
  @UseGuards(JwtAuthGuard, UltraAdminGuard)
  getThreshold() {
    return this.affiliateAdminService
      .getWithdrawalThreshold()
      .then((t) => ({ threshold: t }));
  }

  @Patch('admin/threshold')
  @UseGuards(JwtAuthGuard, UltraAdminGuard)
  setThreshold(@Body('amount') amount: number) {
    return this.affiliateAdminService.setWithdrawalThreshold(amount);
  }

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, UltraAdminGuard)
  getAllAffiliates() {
    return this.affiliateAdminService.getAllAffiliates();
  }

  @Get('admin/withdrawals/pending')
  @UseGuards(JwtAuthGuard, UltraAdminGuard)
  getPendingWithdrawals() {
    return this.affiliateAdminService.getPendingWithdrawals();
  }

  /**
   * Distribution automatique Yabetoo (J+1)
   * POST /affiliate/admin/withdrawals/:requestId/distribute
   * → crée un disbursement Yabetoo, statut "processing"
   * → la confirmation PAID arrive via webhook disbursement.completed
   */
  @Post('admin/withdrawals/:requestId/distribute')
  @UseGuards(JwtAuthGuard, UltraAdminGuard)
  distribute(@Param('requestId') requestId: string) {
    return this.affiliateAdminService.distributeToAffiliate(requestId);
  }

  /**
   * Versement manuel (fallback si Yabetoo indisponible)
   * POST /affiliate/admin/withdrawals/:requestId/mark-paid
   * Body : { paymentNote?: string }
   * → marque immédiatement PAID sans passer par Yabetoo
   */
  @Post('admin/withdrawals/:requestId/mark-paid')
  @UseGuards(JwtAuthGuard, UltraAdminGuard)
  markAsPaid(
    @Param('requestId') requestId: string,
    @Body('paymentNote') paymentNote?: string,
  ) {
    return this.affiliateAdminService.markAsPaid(requestId, paymentNote);
  }

  @Patch('admin/withdrawals/:requestId/reject')
  @UseGuards(JwtAuthGuard, UltraAdminGuard)
  rejectWithdrawal(
    @Param('requestId') requestId: string,
    @Body('reason') reason?: string,
  ) {
    return this.affiliateAdminService.rejectWithdrawal(requestId, reason);
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, UltraAdminGuard)
  getDetail(@Param('id') id: string) {
    return this.affiliateAdminService.getAffiliateDetail(id);
  }

  @Patch('admin/:id/commission-rate')
  @UseGuards(JwtAuthGuard, UltraAdminGuard)
  updateRate(@Param('id') id: string, @Body('commissionRate') rate: number) {
    return this.affiliateAdminService.updateCommissionRate(id, rate);
  }

  @Patch('admin/:id/toggle')
  @UseGuards(JwtAuthGuard, UltraAdminGuard)
  toggle(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.affiliateAdminService.toggleAffiliate(id, isActive);
  }

  @Patch('admin/:id/phone')
  @UseGuards(JwtAuthGuard, UltraAdminGuard)
  updatePhone(
    @Param('id') id: string,
    @Body('phone') phone: string,
    @Body('disbursementPhone') disbursementPhone?: string,
  ) {
    return this.affiliateAdminService.updatePhone(id, phone, disbursementPhone);
  }
}
