// ============================================================================
// src/subscriptions/billing-admin.controller.ts
// Routes SUPER_ADMIN : prix des plans, codes de réduction, devis, choix de
// l'agrégateur de paiement.
// ============================================================================

import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UltraAdminGuard } from '../admin/guards/ultra-admin.guard';
import { PricingService } from './pricing.service';
import { DiscountCodesService } from './discount-codes.service';
import { CustomQuotesService } from './custom-quotes.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { YabetooPayService } from '../payments/yabetoopay.service';
import { MotekiService } from '../payments/moteki.service';
import { ChariowService } from '../payments/chariow.service';
import { InvoicesService } from '../invoices/invoices.service';
import {
  CreateCustomQuoteDto, CreateDiscountCodeDto, SetPaymentProviderDto, UpdateDiscountCodeDto, UpdatePlanPriceDto,
} from './dto/billing-admin.dto';

const actorId = (req: any): string => req.user.userId ?? req.user.sub;

@Controller('admin/billing-config')
@UseGuards(JwtAuthGuard, UltraAdminGuard)
export class BillingAdminController {
  constructor(
    private readonly pricing: PricingService,
    private readonly discountCodes: DiscountCodesService,
    private readonly quotes: CustomQuotesService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly yabetoo: YabetooPayService,
    private readonly moteki: MotekiService,
    private readonly chariow: ChariowService,
    private readonly invoices: InvoicesService,
  ) {}

  // ── Prix des plans ──────────────────────────────────────────────────────
  @Get('plans')
  listPlans() {
    return this.pricing.listForAdmin();
  }

  @Patch('plans/:plan')
  updatePlan(@Param('plan') plan: string, @Body() dto: UpdatePlanPriceDto, @Request() req) {
    return this.pricing.updatePrice(plan, dto, actorId(req));
  }

  @Delete('plans/:plan')
  resetPlan(@Param('plan') plan: string) {
    return this.pricing.resetPrice(plan);
  }

  // ── Codes de réduction ──────────────────────────────────────────────────
  @Get('discount-codes')
  listCodes() {
    return this.discountCodes.list();
  }

  @Post('discount-codes')
  createCode(@Body() dto: CreateDiscountCodeDto, @Request() req) {
    return this.discountCodes.create(dto, actorId(req));
  }

  @Patch('discount-codes/:id')
  updateCode(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDiscountCodeDto) {
    return this.discountCodes.update(id, dto);
  }

  @Delete('discount-codes/:id')
  deleteCode(@Param('id', ParseUUIDPipe) id: string) {
    return this.discountCodes.remove(id);
  }

  // ── Devis ───────────────────────────────────────────────────────────────
  @Get('quotes')
  listQuotes(@Query('companyId') companyId?: string) {
    return this.quotes.list(companyId);
  }

  @Post('quotes')
  createQuote(@Body() dto: CreateCustomQuoteDto, @Request() req) {
    return this.quotes.create(dto, actorId(req));
  }

  @Patch('quotes/:id/cancel')
  cancelQuote(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.cancel(id);
  }

  // ── Agrégateur de paiement ──────────────────────────────────────────────
  @Get('provider')
  async getProvider() {
    const settings = await this.platformSettings.get();
    return {
      provider: settings.paymentProvider,
      configured: {
        YABETOOPAY: this.yabetoo.isConfigured(),
        MOTEKI: this.moteki.isConfigured(),
        CHARIOW: this.chariow.isConfigured(),
      },
      updatedAt: settings.updatedAt,
    };
  }

  @Patch('provider')
  async setProvider(@Body() dto: SetPaymentProviderDto, @Request() req) {
    await this.platformSettings.update({ paymentProvider: dto.provider }, actorId(req));
    return this.getProvider();
  }

  // ── Factures (toutes entreprises) ───────────────────────────────────────
  @Get('invoices')
  listInvoices(
    @Query('search') search?: string,
    @Query('companyId') companyId?: string,
    @Query('page') page?: string,
  ) {
    return this.invoices.listAll({ search, companyId, page: page ? parseInt(page) : 1 });
  }

  @Get('invoices/:id/pdf')
  async downloadInvoice(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const inv = await this.invoices.getById(id);
    const pdf = await this.invoices.buildPdf(inv);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${inv.number}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }

  @Post('invoices/:id/resend')
  resendInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.resendById(id);
  }
}