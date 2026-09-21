import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { KioskApiKeyGuard } from './guards/kiosk-api-key.guard';
import { CheckinDevicesService } from './checkin-devices.service';
import { RegisterKioskDeviceDto } from './dto/register-device.dto';
import { RegisterCredentialDto } from './dto/register-credential.dto';
import { ScanCheckinDto } from './dto/scan.dto';

@Controller('checkin-devices')
export class CheckinDevicesController {
  constructor(private readonly service: CheckinDevicesService) {}

  // ========================================
  // 🔐 ADMIN — gestion des tablettes (JWT classique, comme le reste de l'app)
  // ========================================

  @Post('devices')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async registerDevice(@Body() dto: RegisterKioskDeviceDto, @Request() req) {
    try {
      return await this.service.registerDevice(req.user.companyId, dto);
    } catch (error: any) {
      throw new HttpException(
        error.message || "Erreur lors de l'enregistrement de la tablette",
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('devices')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async listDevices(@Request() req) {
    return this.service.listDevices(req.user.companyId);
  }

  @Delete('devices/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async deleteDevice(@Param('id') id: string, @Request() req) {
    return this.service.deleteDevice(req.user.companyId, id);
  }

  @Post('devices/:id/midday')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async updateMidDay(
    @Param('id') id: string,
    @Body() body: { midDayStartHour: number | null; midDayEndHour: number | null },
    @Request() req,
  ) {
    return this.service.updateMidDay(req.user.companyId, id, body.midDayStartHour, body.midDayEndHour);
  }

  @Get('company-admins')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async listCompanyAdmins(@Query('companyId') companyId: string, @Request() req) {
    return this.service.listCompanyAdmins(req.user.id, companyId);
  }

  // ========================================
  // 🏢 ADMIN — partage d'une tablette entre plusieurs entreprises
  // ========================================

  @Get('devices/:id/companies')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async listAdditionalCompanies(@Param('id') id: string, @Request() req) {
    return this.service.listAdditionalCompanies(req.user.companyId, id);
  }

  @Post('devices/:id/companies')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async addAdditionalCompany(
    @Param('id') id: string,
    @Body() body: { companyId: string; actingUserId: string },
    @Request() req,
  ) {
    try {
      return await this.service.addAdditionalCompany(req.user.companyId, id, body.companyId, body.actingUserId);
    } catch (error: any) {
      throw new HttpException(
        error.message || "Erreur lors de l'ajout de l'entreprise",
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete('devices/:id/companies/:linkId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async removeAdditionalCompany(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Request() req,
  ) {
    return this.service.removeAdditionalCompany(req.user.companyId, id, linkId);
  }

  // ========================================
  // 🪪 ADMIN — badges NFC / QR codes
  // ========================================

  @Post('credentials')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async registerCredential(
    @Body() dto: RegisterCredentialDto,
    @Request() req,
  ) {
    try {
      return await this.service.registerCredential([req.user.companyId], dto);
    } catch (error: any) {
      throw new HttpException(
        error.message || "Erreur lors de l'enregistrement du badge",
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('credentials')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async listCredentials(@Request() req) {
    return this.service.listCredentials(req.user.companyId);
  }

  @Get('credentials/:employeeId/qrcode')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'EMPLOYEE')
  async getQrCode(@Param('employeeId') employeeId: string, @Request() req) {
    return this.service.getOrCreateQrCode(req.user.companyId, employeeId);
  }

  @Delete('credentials/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async deleteCredential(@Param('id') id: string, @Request() req) {
    return this.service.deleteCredential(req.user.companyId, id);
  }

  // ========================================
  // 🪪 TABLETTE — mode enrôlement (auth clé device, pas de JWT)
  // ========================================

  @Get('schedule')
  @UseGuards(KioskApiKeyGuard)
  async getSchedule(@Request() req) {
    const companyPorters = req.kioskDevice.companyPorters as Map<string, string>;
    const companyIds = Array.from(companyPorters.keys());
    return this.service.getSchedule(companyIds, req.kioskDevice.id);
  }

  @Get('employees')
  @UseGuards(KioskApiKeyGuard)
  async listEmployeesForKiosk(@Request() req) {
    const companyPorters = req.kioskDevice.companyPorters as Map<string, string>;
    const companyIds = Array.from(companyPorters.keys());
    return this.service.listEmployeesForKiosk(companyIds);
  }

  @Get('lookup')
  @UseGuards(KioskApiKeyGuard)
  async lookup(@Query('identifier') identifier: string, @Request() req) {
    const companyPorters = req.kioskDevice.companyPorters as Map<string, string>;
    const companyIds = Array.from(companyPorters.keys());
    return this.service.lookupIdentifier(companyIds, identifier);
  }

  @Post('enroll')
  @UseGuards(KioskApiKeyGuard)
  async enroll(@Body() dto: RegisterCredentialDto, @Request() req) {
    try {
      const companyPorters = req.kioskDevice.companyPorters as Map<string, string>;
      const companyIds = Array.from(companyPorters.keys());
      return await this.service.enrollFromKiosk(companyIds, dto);
    } catch (error: any) {
      throw new HttpException(
        error.message || "Erreur lors de l'enrôlement du badge",
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ========================================
  // 📲 TABLETTE — scan badge / QR (auth par clé API device, pas de JWT)
  // ========================================

  @Post('scan')
  @UseGuards(KioskApiKeyGuard)
  async scan(@Body() dto: ScanCheckinDto, @Request() req) {
    try {
      return await this.service.scan(req.kioskDevice, dto);
    } catch (error: any) {
      // On relaie le statut/erreur d'origine (ex: 404 CREDENTIAL_NOT_FOUND,
      // ou 200-like "requiresConfirmation" renvoyé directement par checkIn).
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || 'Erreur lors du pointage',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}