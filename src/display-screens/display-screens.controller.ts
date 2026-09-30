// ============================================================================
// 📁 src/display-screens/display-screens.controller.ts
// 3 contrôleurs, 3 niveaux d'accès distincts :
//   1. /display/*            → l'ÉCRAN (public pour l'appairage, jeton d'appareil ensuite)
//   2. /admin/display-screens → ADMIN / RH (JWT)
//   3. /pointage-qr/*         → EMPLOYÉ connecté (JWT) — jamais de route publique
// ============================================================================
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DisplayScreensService } from './display-screens.service';
import { DisplayDeviceGuard } from './guards/display-device.guard';
import {
  ApproveScreenDto,
  PollPairingDto,
  QrScanDto,
  RenameScreenDto,
  SecretPunchDto,
  SetSecretDto,
} from './dto';

// ────────────────────────────────────────────────────────────────────────────
// 1) ÉCRAN / TABLETTE
// ────────────────────────────────────────────────────────────────────────────
@Controller('display')
export class DisplayDeviceController {
  constructor(private readonly service: DisplayScreensService) {}

  @Post('pairing/start')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  startPairing() {
    return this.service.startPairing();
  }

  @Post('pairing/poll')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  pollPairing(@Body() dto: PollPairingDto) {
    return this.service.pollPairing(dto.pollToken);
  }

  @Get('me')
  @UseGuards(DisplayDeviceGuard)
  me(@Request() req) {
    return this.service.me(req.displayScreen);
  }

  @Get('qr-batch')
  @UseGuards(DisplayDeviceGuard)
  qrBatch(@Request() req) {
    return this.service.qrBatch(req.displayScreen);
  }

  @Post('secret-punch')
  @UseGuards(DisplayDeviceGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  secretPunch(@Body() dto: SecretPunchDto, @Request() req) {
    return this.service.secretPunch(req.displayScreen, dto.secret, dto.confirm);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 2) ADMIN / RH
// ────────────────────────────────────────────────────────────────────────────
@Controller('admin/display-screens')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
export class DisplayAdminController {
  constructor(private readonly service: DisplayScreensService) {}

  @Get()
  list(@Request() req) {
    return this.service.list(req.user);
  }

  @Post('approve')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  approve(@Body() dto: ApproveScreenDto, @Request() req) {
    return this.service.approve(req.user, dto);
  }

  @Patch(':id')
  rename(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RenameScreenDto,
    @Request() req,
  ) {
    return this.service.rename(req.user, id, dto.name);
  }

  @Delete(':id')
  revoke(@Param('id', new ParseUUIDPipe()) id: string, @Request() req) {
    return this.service.revoke(req.user, id);
  }

  // 🆕 Régénération du QR : change le sel de l'écran → tous les QR déjà émis
  // (y compris ceux partagés en photo) deviennent invalides immédiatement.
  @Post(':id/regenerate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  regenerate(@Param('id', new ParseUUIDPipe()) id: string, @Request() req) {
    return this.service.regenerateQr(req.user, id);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 3) EMPLOYÉ CONNECTÉ (scan) + gestion du code secret par ADMIN / RH uniquement
// ────────────────────────────────────────────────────────────────────────────
@Controller('pointage-qr')
export class EmployeeQrController {
  constructor(private readonly service: DisplayScreensService) {}

  /** { enabled, defaultMode: 'SCAN' | 'GPS' } — SCAN par défaut si et seulement si configuré. */
  @Get('config')
  @UseGuards(AuthGuard('jwt'))
  config(@Request() req) {
    return this.service.employeeConfig(req.user.id);
  }

  @Post('scan')
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  scan(@Body() dto: QrScanDto, @Request() req) {
    return this.service.qrScan(req.user.id, dto.token, dto.confirm);
  }

  // ── Liste des employés qui ONT un code secret (traçabilité admin / RH) ──
  // Ne renvoie jamais le code (stocké sous forme d'empreinte) : seulement qui en a un.
  @Get('secret/list')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  listSecrets(@Request() req) {
    return this.service.listSecrets(req.user.companyId);
  }

  // ── Code secret : défini UNIQUEMENT par l'admin / RH (routes ci-dessous) ──
  @Get('secret/employee/:employeeId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async employeeSecretStatus(
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Request() req,
  ) {
    const emp = await this.service.employeeOfCompany(employeeId, req.user.companyId);
    return this.service.hasSecret(emp.id);
  }

  @Put('secret/employee/:employeeId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async setEmployeeSecret(
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Body() dto: SetSecretDto,
    @Request() req,
  ) {
    const emp = await this.service.employeeOfCompany(employeeId, req.user.companyId);
    return this.service.setSecret(emp, dto.secret, req.user.id);
  }

  @Delete('secret/employee/:employeeId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async removeEmployeeSecret(
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Request() req,
  ) {
    const emp = await this.service.employeeOfCompany(employeeId, req.user.companyId);
    return this.service.removeSecret(emp.id);
  }
}