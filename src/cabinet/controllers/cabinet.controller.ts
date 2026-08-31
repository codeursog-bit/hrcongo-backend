import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  CabinetMemberGuard,
  CabinetAdminGuard,
} from '../guards/cabinet.guards';
import { CabinetService } from '../services/cabinet.service';
import { CabinetWalletService } from '../services/cabinet-wallet.service';
import {
  CreateCabinetDto,
  UpdateCabinetDto,
  AddCabinetUserDto,
  AddCompanyToCabinetDto,
  UpdatePortalAccessDto,
} from '../dto/cabinet.dto';

@Controller('cabinet')
@UseGuards(JwtAuthGuard)
export class CabinetController {
  constructor(
    private readonly cabinetService: CabinetService,
    private readonly cabinetWalletService: CabinetWalletService,
  ) {}

  // ── Cabinet CRUD ────────────────────────────────────────────────────────────

  @Post()
  create(@Body() dto: CreateCabinetDto, @Request() req) {
    return this.cabinetService.create(dto, req.user.userId);
  }

  @Get(':cabinetId')
  @UseGuards(CabinetMemberGuard)
  findOne(@Param('cabinetId') cabinetId: string) {
    return this.cabinetService.findById(cabinetId);
  }

  // ── Alias /profile → même que GET :cabinetId (le front appelle les deux) ──
  @Get(':cabinetId/profile')
  @UseGuards(CabinetMemberGuard)
  getProfile(@Param('cabinetId') cabinetId: string) {
    return this.cabinetService.findById(cabinetId);
  }

  // ── GET :cabinetId/gestionnaires — liste des membres du cabinet ──
  @Get(':cabinetId/gestionnaires')
  @UseGuards(CabinetMemberGuard)
  getGestionnaires(@Param('cabinetId') cabinetId: string) {
    return this.cabinetService.getMembers(cabinetId);
  }

  @Get(':cabinetId/dashboard')
  @UseGuards(CabinetMemberGuard)
  getDashboard(@Param('cabinetId') cabinetId: string) {
    return this.cabinetService.getDashboard(cabinetId);
  }

  // NOTE: GET :cabinetId/subscription est maintenant géré par CabinetSubscriptionController
  // (src/cabinet/controllers/cabinet-subscription.controller.ts)
  // Il retourne le nouveau CabinetSubscription avec plan/maxCompanies/maxEmployees

  @Patch(':cabinetId')
  @UseGuards(CabinetMemberGuard, CabinetAdminGuard)
  update(@Param('cabinetId') cabinetId: string, @Body() dto: UpdateCabinetDto) {
    return this.cabinetService.update(cabinetId, dto);
  }

  // ── Branding ────────────────────────────────────────────────────────────────

  @Patch(':cabinetId/branding')
  @UseGuards(CabinetMemberGuard, CabinetAdminGuard)
  updateBranding(
    @Param('cabinetId') cabinetId: string,
    @Body()
    dto: { logo?: string; primaryColor?: string; secondaryColor?: string },
  ) {
    return this.cabinetService.updateBranding(cabinetId, dto);
  }

  // NOTE: getBranding par subdomain est intentionnellement PUBLIC
  // → déplacé dans auth.controller.ts pour échapper au JwtAuthGuard global
  // Route : GET /auth/cabinet-branding/:subdomain

  // ── Gestionnaires ───────────────────────────────────────────────────────────

  @Post(':cabinetId/users')
  @UseGuards(CabinetMemberGuard, CabinetAdminGuard)
  addUser(
    @Param('cabinetId') cabinetId: string,
    @Body() dto: AddCabinetUserDto,
  ) {
    return this.cabinetService.addUser(cabinetId, dto);
  }

  @Delete(':cabinetId/users/:userId')
  @UseGuards(CabinetMemberGuard, CabinetAdminGuard)
  removeUser(
    @Param('cabinetId') cabinetId: string,
    @Param('userId') userId: string,
    @Request() req,
  ) {
    return this.cabinetService.removeUser(cabinetId, userId, req.user.userId);
  }

  // ── PME — Lier ──────────────────────────────────────────────────────────────

  @Post(':cabinetId/companies')
  @UseGuards(CabinetMemberGuard, CabinetAdminGuard)
  addCompany(
    @Param('cabinetId') cabinetId: string,
    @Body() dto: AddCompanyToCabinetDto,
  ) {
    return this.cabinetService.addCompany(cabinetId, dto);
  }

  // ── PME — Créer + Lier ──────────────────────────────────────────────────────

  @Post(':cabinetId/companies/create')
  @UseGuards(CabinetMemberGuard, CabinetAdminGuard)
  createAndLink(@Param('cabinetId') cabinetId: string, @Body() dto: any) {
    return this.cabinetService.createAndLinkCompany(cabinetId, dto);
  }

  // ── PME — Recherche ─────────────────────────────────────────────────────────

  @Get(':cabinetId/companies/search')
  @UseGuards(CabinetMemberGuard)
  searchCompanies(
    @Param('cabinetId') cabinetId: string,
    @Query('q') q: string,
    @Query('limit') limit = '10',
  ) {
    return this.cabinetService.searchAvailableCompanies(
      cabinetId,
      q,
      parseInt(limit),
    );
  }

  @Delete(':cabinetId/companies/:companyId')
  @UseGuards(CabinetMemberGuard, CabinetAdminGuard)
  removeCompany(
    @Param('cabinetId') cabinetId: string,
    @Param('companyId') companyId: string,
  ) {
    return this.cabinetService.removeCompany(cabinetId, companyId);
  }

  @Patch(':cabinetId/companies/:companyId/access')
  @UseGuards(CabinetMemberGuard, CabinetAdminGuard)
  updatePortalAccess(
    @Param('cabinetId') cabinetId: string,
    @Param('companyId') companyId: string,
    @Body() dto: UpdatePortalAccessDto,
  ) {
    return this.cabinetService.updatePortalAccess(cabinetId, companyId, dto);
  }

  // ── Invitation PME ──────────────────────────────────────────────────────────
  // IMPORTANT : invite-admin reste protégé (seul un membre du cabinet peut inviter)
  // Les routes invitation-info et accept-invitation sont PUBLIQUES
  // → déplacées dans auth.controller.ts pour échapper au JwtAuthGuard global

  @Post(':cabinetId/companies/:companyId/invite-admin')
  @UseGuards(CabinetMemberGuard, CabinetAdminGuard)
  inviteAdmin(
    @Param('cabinetId') cabinetId: string,
    @Param('companyId') companyId: string,
    @Body('email') email: string,
    @Body('firstName') firstName: string,
    @Body('lastName') lastName: string,
    @Request() req,
  ) {
    return this.cabinetService.invitePmeAdmin(
      cabinetId,
      companyId,
      email,
      firstName,
      lastName,
      req.user.userId,
    );
  }

  // ── Resolve subdomain ───────────────────────────────────────────────────────

  @Get('resolve/:subdomain')
  resolveBySubdomain(@Param('subdomain') subdomain: string) {
    return this.cabinetService.resolveBySubdomain(subdomain);
  }
}
