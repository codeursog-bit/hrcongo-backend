// ============================================================================
// 📁 src/payroll/settings/settings.controller.ts
// ============================================================================
import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { PayrollSettingsService } from './settings.service';
import { UpdatePayrollSettingsDto } from './dto/update-settings.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { GetUser } from '../../auth/get-user.decorator';

@Controller('payroll-settings')
@UseGuards(JwtAuthGuard)
export class PayrollSettingsController {
  constructor(private readonly settingsService: PayrollSettingsService) {}

  /**
   * Récupérer les paramètres de paie
   * GET /payroll-settings
   */
  @Get()
  findOne(@GetUser('id') userId: string) {
    return this.settingsService.findOne(userId);
  }

  /**
   * Mettre à jour les paramètres
   * PATCH /payroll-settings
   */
  @Patch()
  update(
    @Body() updateDto: UpdatePayrollSettingsDto,
    @GetUser('id') userId: string,
  ) {
    return this.settingsService.update(userId, updateDto);
  }
}
