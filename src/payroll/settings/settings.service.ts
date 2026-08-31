// ============================================================================
// 📁 src/payroll/settings/settings.service.ts
// ✅ Ajout fiscalMode + forfaitItsRate + nuit + overtime + plafonds CNSS
// ============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePayrollSettingsDto } from './dto/update-settings.dto';
import {
  CompanyNotFoundException,
  PayrollSettingsNotFoundException,
} from '../../exceptions/business.exceptions';
import * as CONST from './constants/settings.constants';
import { Prisma } from '@prisma/client';

@Injectable()
export class PayrollSettingsService {
  private readonly logger = new Logger(PayrollSettingsService.name);

  constructor(private prisma: PrismaService) {}

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTHODES PUBLIQUES
  // ══════════════════════════════════════════════════════════════════════════

  async findOne(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new CompanyNotFoundException();

    let settings = await this.prisma.payrollSettings.findFirst({
      where: { companyId: user.companyId },
      orderBy: { effectiveDate: 'desc' },
    });

    if (!settings) {
      this.logger.log(
        '⚠️  Aucun paramètre trouvé, création avec valeurs Congo 2026',
      );
      settings = await this.createDefaultSettings(user.companyId);
    }

    settings = await this.ensureCorrectRates(settings);

    const workHoursPerMonth =
      Number(settings?.workHoursPerDay || 8) *
      Number(settings?.workDaysPerMonth || 26);

    return { ...this.formatSettings(settings), workHoursPerMonth };
  }

  async getSettingsByCompanyId(companyId: string) {
    const settings = await this.prisma.payrollSettings.findFirst({
      where: { companyId },
      orderBy: { effectiveDate: 'desc' },
    });

    if (!settings) {
      this.logger.log(
        `⚠️  Aucun paramètre pour company ${companyId}, création...`,
      );
      const created = await this.createDefaultSettings(companyId);
      const workHoursPerMonth =
        Number(created.workHoursPerDay) * created.workDaysPerMonth;
      return { ...this.formatSettings(created), workHoursPerMonth };
    }

    const corrected = await this.ensureCorrectRates(settings);
    const workHoursPerMonth =
      Number(corrected.workHoursPerDay) * corrected.workDaysPerMonth;

    return { ...this.formatSettings(corrected), workHoursPerMonth };
  }

  async update(userId: string, updateDto: UpdatePayrollSettingsDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true },
    });
    if (!user?.companyId) throw new CompanyNotFoundException();
    if (!['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'].includes(user.role)) {
      throw new Error('Accès refusé : droits insuffisants');
    }

    const settings = await this.prisma.payrollSettings.findFirst({
      where: { companyId: user.companyId },
      orderBy: { effectiveDate: 'desc' },
    });

    const data: Prisma.PayrollSettingsUpdateInput = {
      ...this.prepareUpdateData(updateDto),
      updatedAt: new Date(),
    };

    if (settings) {
      const updated = await this.prisma.payrollSettings.update({
        where: { id: settings.id },
        data,
      });
      return this.formatSettings(updated);
    }

    return this.createDefaultSettings(user.companyId);
  }

  async getAttendanceSettings(companyId: string) {
    const settings = await this.prisma.payrollSettings.findFirst({
      where: { companyId },
      select: {
        officialStartHour: true,
        lateToleranceMinutes: true,
        workDaysPerMonth: true,
        workHoursPerDay: true,
        workDays: true,
      },
    });

    if (!settings) {
      return {
        officialStartHour: CONST.DEFAULT_START_HOUR,
        lateToleranceMinutes: CONST.DEFAULT_TOLERANCE_MINUTES,
        workDaysPerMonth: CONST.DEFAULT_WORK_DAYS_PER_MONTH,
        workHoursPerDay: CONST.DEFAULT_WORK_HOURS_PER_DAY,
        workDays: CONST.DEFAULT_WORK_DAYS,
      };
    }

    return { ...settings, workDays: this.parseWorkDays(settings.workDays) };
  }

  async validateSettingsExist(companyId: string): Promise<boolean> {
    const settings = await this.prisma.payrollSettings.findFirst({
      where: { companyId },
    });
    if (!settings) throw new PayrollSettingsNotFoundException();
    if (settings.officialStartHour === null)
      throw new Error("L'heure de début n'est pas configurée");
    if (!settings.cnssSalarialRate)
      throw new Error("Le taux CNSS salarié n'est pas configuré");
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTHODES PRIVÉES
  // ══════════════════════════════════════════════════════════════════════════

  private async createDefaultSettings(companyId: string) {
    this.logger.log('🔧 Création paramètres par défaut (Congo 2026)');

    return this.prisma.payrollSettings.create({
      data: {
        companyId,
        officialStartHour: CONST.DEFAULT_START_HOUR,
        lateToleranceMinutes: CONST.DEFAULT_TOLERANCE_MINUTES,
        workDays: CONST.DEFAULT_WORK_DAYS,
        cnssSalarialRate: CONST.DEFAULT_CNSS_SALARIAL_RATE,
        cnssEmployerRate: CONST.DEFAULT_CNSS_EMPLOYER_RATE,
        overtimeRate10: CONST.DEFAULT_OVERTIME_RATE_10,
        overtimeRate25: CONST.DEFAULT_OVERTIME_RATE_25,
        overtimeRate50: CONST.DEFAULT_OVERTIME_RATE_50,
        overtimeRate100: CONST.DEFAULT_OVERTIME_RATE_100,
        workDaysPerMonth: CONST.DEFAULT_WORK_DAYS_PER_MONTH,
        workHoursPerDay: CONST.DEFAULT_WORK_HOURS_PER_DAY,
        cnssRounding: 'UP',
        itsRounding: 'UP',
        // ✅ Valeurs par défaut mode fiscal
        fiscalMode: 'AUTO',
        forfaitItsRate: 0.08,
        effectiveDate: new Date(),
      },
    });
  }

  private async ensureCorrectRates(settings: any) {
    const cnssSalarialOk =
      Number(settings.cnssSalarialRate) === CONST.DEFAULT_CNSS_SALARIAL_RATE;

    if (!cnssSalarialOk) {
      this.logger.warn(
        '🚨 Taux CNSS salarié incorrect, correction automatique...',
      );
      const corrected = await this.prisma.payrollSettings.update({
        where: { id: settings.id },
        data: {
          cnssSalarialRate: CONST.DEFAULT_CNSS_SALARIAL_RATE,
          updatedAt: new Date(),
        },
      });
      this.logger.log('✅ Taux CNSS salarié corrigé à 4%');
      return corrected;
    }

    return settings;
  }

  private formatSettings(settings: any) {
    return {
      ...settings,
      cnssSalarialRate: Number(settings.cnssSalarialRate),
      cnssEmployerRate: Number(settings.cnssEmployerRate),
      cnssCeiling: Number(settings.cnssCeiling),
      // ✅ Plafonds CNSS avec fallbacks
      cnssPensionCeiling: Number(settings.cnssPensionCeiling ?? 1200000),
      cnssSocialCeiling: Number(settings.cnssSocialCeiling ?? 600000),
      workHoursPerDay: Number(settings.workHoursPerDay),
      overtimeRate10: Number(
        settings.overtimeRate10 ?? CONST.DEFAULT_OVERTIME_RATE_10,
      ),
      overtimeRate25: Number(
        settings.overtimeRate25 ?? CONST.DEFAULT_OVERTIME_RATE_25,
      ),
      overtimeRate50: Number(
        settings.overtimeRate50 ?? CONST.DEFAULT_OVERTIME_RATE_50,
      ),
      overtimeRate100: Number(
        settings.overtimeRate100 ?? CONST.DEFAULT_OVERTIME_RATE_100,
      ),
      tusRate: Number(settings.tusRate ?? CONST.DEFAULT_TUS_RATE),
      // ✅ Toggle heures sup
      overtimeEnabled: settings.overtimeEnabled ?? true,
      // ✅ Travail de nuit avec fallbacks
      nightShiftEnabled: settings.nightShiftEnabled ?? false,
      nightShiftStartHour: Number(settings.nightShiftStartHour ?? 20),
      nightShiftEndHour: Number(settings.nightShiftEndHour ?? 5),
      nightShiftPremiumRate: Number(settings.nightShiftPremiumRate ?? 25),
      // ✅ Mode fiscal — avec fallback si colonne pas encore en BDD
      fiscalMode: settings.fiscalMode ?? 'AUTO',
      forfaitItsRate: Number(settings.forfaitItsRate ?? 0.08),

      workDays: this.parseWorkDays(settings.workDays),
    };
  }

  // ✅ prepareUpdateData — tous les champs du DTO mappés vers Prisma
  private prepareUpdateData(
    dto: UpdatePayrollSettingsDto,
  ): Prisma.PayrollSettingsUpdateInput {
    const data: any = {};

    // Champs existants
    if (dto.officialStartHour !== undefined)
      data.officialStartHour = dto.officialStartHour;
    if (dto.lateToleranceMinutes !== undefined)
      data.lateToleranceMinutes = dto.lateToleranceMinutes;
    if (dto.workDays !== undefined) data.workDays = dto.workDays;
    if (dto.cnssSalarialRate !== undefined)
      data.cnssSalarialRate = dto.cnssSalarialRate;
    if (dto.cnssEmployerRate !== undefined)
      data.cnssEmployerRate = dto.cnssEmployerRate;
    if (dto.cnssCeiling !== undefined) data.cnssCeiling = dto.cnssCeiling;
    if (dto.overtimeRate15 !== undefined)
      data.overtimeRate15 = dto.overtimeRate15;
    if (dto.overtimeRate50 !== undefined)
      data.overtimeRate50 = dto.overtimeRate50;
    if (dto.overtimeRate10 !== undefined)
      data.overtimeRate10 = dto.overtimeRate10;
    if (dto.overtimeRate25 !== undefined)
      data.overtimeRate25 = dto.overtimeRate25;
    if (dto.overtimeRate100 !== undefined)
      data.overtimeRate100 = dto.overtimeRate100;
    if (dto.workDaysPerMonth !== undefined)
      data.workDaysPerMonth = dto.workDaysPerMonth;
    if (dto.workHoursPerDay !== undefined)
      data.workHoursPerDay = dto.workHoursPerDay;
    if (dto.apprenticeshipTax !== undefined)
      data.apprenticeshipTax = dto.apprenticeshipTax;
    if (dto.fonerTax !== undefined) data.fonerTax = dto.fonerTax;
    if (dto.cnssRounding !== undefined) data.cnssRounding = dto.cnssRounding;
    if (dto.itsRounding !== undefined) data.itsRounding = dto.itsRounding;
    if (dto.taxBrackets !== undefined) data.taxBrackets = dto.taxBrackets;
    // ✅ Mode fiscal
    if (dto.fiscalMode !== undefined) data.fiscalMode = dto.fiscalMode;
    if (dto.forfaitItsRate !== undefined)
      data.forfaitItsRate = dto.forfaitItsRate;
    // ✅ Plafonds CNSS
    if (dto.cnssPensionCeiling !== undefined)
      data.cnssPensionCeiling = dto.cnssPensionCeiling;
    if (dto.cnssSocialCeiling !== undefined)
      data.cnssSocialCeiling = dto.cnssSocialCeiling;
    // ✅ Toggle heures sup
    if (dto.overtimeEnabled !== undefined)
      data.overtimeEnabled = dto.overtimeEnabled;
    // ✅ Travail de nuit
    if (dto.nightShiftEnabled !== undefined)
      data.nightShiftEnabled = dto.nightShiftEnabled;
    if (dto.nightShiftStartHour !== undefined)
      data.nightShiftStartHour = dto.nightShiftStartHour;
    if (dto.nightShiftEndHour !== undefined)
      data.nightShiftEndHour = dto.nightShiftEndHour;
    if (dto.nightShiftPremiumRate !== undefined)
      data.nightShiftPremiumRate = dto.nightShiftPremiumRate;

    return data;
  }

  private parseWorkDays(workDays: any): number[] {
    if (!workDays) return CONST.DEFAULT_WORK_DAYS;
    if (Array.isArray(workDays)) return workDays;
    if (typeof workDays === 'string') {
      try {
        const parsed = JSON.parse(workDays);
        return Array.isArray(parsed) ? parsed : CONST.DEFAULT_WORK_DAYS;
      } catch {
        return CONST.DEFAULT_WORK_DAYS;
      }
    }
    return CONST.DEFAULT_WORK_DAYS;
  }
}
