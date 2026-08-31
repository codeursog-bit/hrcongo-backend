// ============================================================================
// 📁 src/attendance/attendance.controller.ts — COMPLET
// ============================================================================
// ✅ Garde tout le code existant intact
// 🆕 AJOUTE :
//   - Routes SHIFTS (GET, POST, PUT, DELETE, assignments)
//   - Routes OVERTIME (resolve-forgotten, declare-overtime, approve, reject)
//   - Import Delete + AttendanceCronService
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  UseGuards,
  Request,
  Query,
  Param,
  HttpStatus,
  HttpException,
  ParseIntPipe,
} from '@nestjs/common';
import {
  AttendanceService,
  MonthlyReportItem,
  DayStatus,
  AuditChange,
} from './attendance.service';
import { AttendanceSummaryService } from './attendance-summary.service';
import { AttendanceCronService } from './cron/attendance-cron.service'; // 🆕
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('attendance')
@UseGuards(AuthGuard('jwt'))
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly summaryService: AttendanceSummaryService,
    private readonly cronService: AttendanceCronService, // 🆕
  ) {}

  // ========================================
  // 🎯 POINTAGE
  // ========================================

  @Post('check-in')
  async checkIn(
    @Body() createAttendanceDto: CreateAttendanceDto,
    @Request() req,
  ) {
    try {
      return await this.attendanceService.checkIn(
        createAttendanceDto,
        req.user.userId,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || "Erreur lors du pointage d'entrée",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('check-out')
  async checkOut(
    @Body() createAttendanceDto: CreateAttendanceDto,
    @Request() req,
  ) {
    try {
      return await this.attendanceService.checkOut(
        createAttendanceDto,
        req.user.userId,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur lors du pointage de sortie',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ========================================
  // 🆕 GET-OR-CREATE
  // ========================================

  // 🆕 Liste des employés pour le sélecteur de pointage manuel — scopée
  //    exclusivement au module attendance (n'affecte aucun autre module).
  @Get('employees-for-manual')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER', 'EMPLOYEE')
  async getEmployeesForManualAttendance(@Request() req) {
    try {
      return await this.attendanceService.getEmployeesForManualAttendance(
        req.user.userId,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur lors de la récupération des employés',
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('get-or-create')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER', 'EMPLOYEE')
  async getOrCreateAttendance(
    @Body() body: { employeeId: string; date: string },
    @Request() req,
  ) {
    try {
      return await this.attendanceService.getOrCreate(
        req.user.userId,
        body.employeeId,
        body.date,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ========================================
  // 📊 CONSULTATION
  // ========================================

  @Get('today')
  async findToday(@Request() req) {
    try {
      return await this.attendanceService.findToday(req.user.userId);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  async findAll(
    @Query('month') month: string,
    @Query('year') year: string,
    @Request() req,
  ): Promise<{
    employees: any[];
    attendances: any[];
    dayStatuses: DayStatus[][];
  }> {
    try {
      const m = month ? parseInt(month) : new Date().getMonth() + 1;
      const y = year ? parseInt(year) : new Date().getFullYear();
      return await this.attendanceService.findAll(req.user.userId, m, y);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('report')
  async getReport(
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('companyId') companyId: string | undefined, // ← AJOUT cabinet
    @Request() req,
  ): Promise<MonthlyReportItem[]> {
    try {
      const m = month ? parseInt(month) : new Date().getMonth() + 1;
      const y = year ? parseInt(year) : new Date().getFullYear();

      // ── Cabinet : passe son companyId cible ─────────────────────────────
      // ── Entreprise : undefined → service utilise user.companyId (inchangé)
      const isCabinet =
        req.user.role === 'CABINET_ADMIN' ||
        req.user.role === 'CABINET_GESTIONNAIRE';
      const override = isCabinet ? companyId : undefined;

      return await this.attendanceService.generateMonthlyReport(
        req.user.userId,
        m,
        y,
        override,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur lors de la génération du rapport',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('employee/:employeeId')
  async getEmployeeAttendance(
    @Param('employeeId') employeeId: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @Request() req,
  ): Promise<DayStatus[]> {
    try {
      const m = month ? parseInt(month) : new Date().getMonth() + 1;
      const y = year ? parseInt(year) : new Date().getFullYear();
      return await this.attendanceService.getEmployeeDayStatuses(
        req.user.userId,
        employeeId,
        m,
        y,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('logs')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER', 'EMPLOYEE')
  async getAttendanceLogs(
    @Query('month') month: string,
    @Query('year') year: string,
    @Request() req,
  ) {
    try {
      const m = month ? parseInt(month) : new Date().getMonth() + 1;
      const y = year ? parseInt(year) : new Date().getFullYear();
      return await this.attendanceService.getLogs(req.user.userId, m, y);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('create-manual')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER', 'EMPLOYEE')
  async createManualAttendance(@Body() body: any, @Request() req) {
    try {
      return await this.attendanceService.createManual(req.user.userId, body);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ========================================
  // 📈 RÉSUMÉS MENSUELS
  // ========================================

  @Get('summary/:employeeId/:month/:year')
  async getEmployeeSummary(
    @Param('employeeId') employeeId: string,
    @Param('month', ParseIntPipe) month: number,
    @Param('year', ParseIntPipe) year: number,
    @Request() req,
  ) {
    try {
      return await this.attendanceService.getEmployeeSummarySecure(
        req.user.userId,
        employeeId,
        month,
        year,
        this.summaryService,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('summaries')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async getMonthlySummaries(
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Request() req,
  ) {
    try {
      const companyId = await this.attendanceService.getCompanyId(
        req.user.userId,
      );
      return await this.summaryService.getStoredSummaries(
        companyId,
        month,
        year,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('generate-summaries')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async generateSummaries(
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
    @Request() req,
  ) {
    try {
      const companyId = await this.attendanceService.getCompanyId(
        req.user.userId,
      );
      return await this.summaryService.generateAndStoreAllMonthlySummaries(
        companyId,
        month,
        year,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ========================================
  // 🔧 GESTION
  // ========================================

  @Post('generate-grid')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async generateMonthlyGrid(
    @Body() body: { month: number; year: number },
    @Request() req,
  ) {
    try {
      const companyId = await this.attendanceService.getCompanyId(
        req.user.userId,
      );
      return await this.attendanceService.generateMonthlyAttendanceGrid(
        companyId,
        body.month,
        body.year,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('correct/:attendanceId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER', 'EMPLOYEE')
  async correctAttendance(
    @Param('attendanceId') attendanceId: string,
    @Body() correctDto: CorrectAttendanceDto,
    @Request() req,
  ): Promise<{ success: boolean; attendance: any; changes: AuditChange[] }> {
    try {
      return await this.attendanceService.correctAttendance(
        attendanceId,
        req.user.userId,
        correctDto,
        req,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ========================================
  // 📈 STATISTIQUES
  // ========================================

  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async getMonthlyStats(
    @Query('month') month: string,
    @Query('year') year: string,
    @Request() req,
  ) {
    try {
      const m = month ? parseInt(month) : new Date().getMonth() + 1;
      const y = year ? parseInt(year) : new Date().getFullYear();
      const companyId = await this.attendanceService.getCompanyId(
        req.user.userId,
      );
      return await this.summaryService.getMonthlyStats(companyId, m, y);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ============================================================================
  // 🆕 OVERTIME WORKFLOW — Oubli / Heures sup / Approbation
  // ============================================================================

  @Post('resolve-forgotten/:attendanceId')
  async resolveAsForgotten(
    @Param('attendanceId') attendanceId: string,
    @Request() req,
  ) {
    try {
      await this.cronService.resolveAsForgotten(attendanceId, req.user.userId);
      return {
        success: true,
        message: "Journée clôturée à l'heure officielle.",
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('declare-overtime/:attendanceId')
  async declareOvertime(
    @Param('attendanceId') attendanceId: string,
    @Request() req,
  ) {
    try {
      await this.cronService.resolveAsOvertime(attendanceId, req.user.userId);
      return {
        success: true,
        message: "Demande d'heures supplémentaires envoyée au responsable.",
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('approve-overtime/:attendanceId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER')
  async approveOvertime(
    @Param('attendanceId') attendanceId: string,
    @Request() req,
  ) {
    try {
      await this.cronService.approveOvertime(attendanceId, req.user.userId);
      return { success: true, message: 'Heures supplémentaires validées.' };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('reject-overtime/:attendanceId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER')
  async rejectOvertime(
    @Param('attendanceId') attendanceId: string,
    @Body() body: { reason: string },
    @Request() req,
  ) {
    try {
      await this.cronService.rejectOvertime(
        attendanceId,
        req.user.userId,
        body.reason || 'Non précisé',
      );
      return { success: true, message: 'Heures supplémentaires refusées.' };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ============================================================================
  // 🆕 SHIFTS — Gestion des plannings flexibles
  // Accessible : ADMIN, HR_MANAGER, SUPER_ADMIN (création/modif/suppression)
  //              MANAGER (lecture + assignation département)
  //              EMPLOYEE (lecture uniquement de ses propres shifts)
  // ============================================================================

  // ── Créer un shift ───────────────────────────────────────────────────────
  @Post('shifts')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async createShift(@Body() body: any, @Request() req) {
    try {
      const companyId = await this.attendanceService.getCompanyId(
        req.user.userId,
      );
      return await this.attendanceService.createShift({ ...body, companyId });
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur création shift',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ── Lister les shifts de l'entreprise ────────────────────────────────────
  @Get('shifts')
  async getShifts(@Request() req) {
    try {
      const companyId = await this.attendanceService.getCompanyId(
        req.user.userId,
      );
      return await this.attendanceService.getShifts(companyId);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ── Modifier un shift ─────────────────────────────────────────────────────
  @Put('shifts/:shiftId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async updateShift(
    @Param('shiftId') shiftId: string,
    @Body() body: any,
    @Request() req,
  ) {
    try {
      const companyId = await this.attendanceService.getCompanyId(
        req.user.userId,
      );
      return await this.attendanceService.updateShift(shiftId, companyId, body);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur mise à jour shift',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ── Supprimer (soft delete) un shift ─────────────────────────────────────
  @Delete('shifts/:shiftId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  async deleteShift(@Param('shiftId') shiftId: string, @Request() req) {
    try {
      const companyId = await this.attendanceService.getCompanyId(
        req.user.userId,
      );
      await this.attendanceService.deleteShift(shiftId, companyId);
      return { success: true, message: 'Shift désactivé.' };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur suppression shift',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ── Assigner un shift à un employé ───────────────────────────────────────
  @Post('shift-assignments')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER')
  async assignShift(
    @Body()
    body: {
      employeeId: string;
      shiftId: string;
      specificDate?: string;
      dayOfWeek?: number;
      validFrom?: string;
      validUntil?: string;
      notes?: string;
    },
    @Request() req,
  ) {
    try {
      const companyId = await this.attendanceService.getCompanyId(
        req.user.userId,
      );
      return await this.attendanceService.assignShift({
        ...body,
        companyId,
        validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
        validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
      });
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur assignation shift',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
  // ── Récupérer TOUTES les assignations de l'entreprise ────────────────────
  // ⚠️ DOIT être avant shift-assignments/:employeeId sinon NestJS l'intercepte
  @Get('shift-assignments')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER')
  async getAllShiftAssignments(@Request() req) {
    try {
      const companyId = await this.attendanceService.getCompanyId(
        req.user.userId,
      );
      return await this.attendanceService.getAllShiftAssignments(companyId);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  // ── Récupérer les shifts d'un employé ────────────────────────────────────
  @Get('shift-assignments/:employeeId')
  async getEmployeeShifts(@Param('employeeId') employeeId: string) {
    try {
      return await this.attendanceService.getEmployeeShifts(employeeId);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ── Récupérer le shift actif d'un employé pour une date ──────────────────
  @Get('employee-shift/:employeeId/:date')
  async getEmployeeShiftForDate(
    @Param('employeeId') employeeId: string,
    @Param('date') date: string,
    @Request() req,
  ) {
    try {
      const companyId = await this.attendanceService.getCompanyId(
        req.user.userId,
      );
      return await this.attendanceService.getEmployeeShiftForDate(
        employeeId,
        companyId,
        date,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Erreur',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

// // 📁 src/attendance/attendance.controller.ts
// // ✅ ZÉRO accès Prisma direct — tout passe par AttendanceService
// // ✅ Isolation entreprise + département garantie par le service
// // ✅ Compatibilité totale avec les autres services (summary, report, etc.)
// // ========================================

// import {
//   Controller,
//   Get,
//   Post,
//   Put,
//   Delete,
//   Body,
//   UseGuards,
//   Request,
//   Query,
//   Param,
//   HttpStatus,
//   HttpException,
//   ParseIntPipe
// } from '@nestjs/common';
// import { AttendanceService, MonthlyReportItem, DayStatus, AuditChange } from './attendance.service';
// import { AttendanceSummaryService } from './attendance-summary.service';
// import { CreateAttendanceDto } from './dto/create-attendance.dto';
// import { CorrectAttendanceDto } from './dto/correct-attendance.dto';
// import { AttendanceCronService } from './cron/attendance-cron.service';
// import { AuthGuard } from '@nestjs/passport';
// import { Roles } from '../auth/decorators/roles.decorator';
// import { RolesGuard } from '../auth/guards/roles.guard';

// @Controller('attendance')
// @UseGuards(AuthGuard('jwt'))
// export class AttendanceController {
//   constructor(
//     private readonly attendanceService: AttendanceService,
//     private readonly summaryService: AttendanceSummaryService,
//     private readonly cronService: AttendanceCronService,
//   ) {}

//   // ========================================
//   // 🎯 POINTAGE — Tous les employés connectés
//   // ========================================

//   @Post('check-in')
//   async checkIn(@Body() createAttendanceDto: CreateAttendanceDto, @Request() req) {
//     try {
//       return await this.attendanceService.checkIn(createAttendanceDto, req.user.userId);
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || "Erreur lors du pointage d'entrée",
//         HttpStatus.BAD_REQUEST
//       );
//     }
//   }

//   @Post('check-out')
//   async checkOut(@Body() createAttendanceDto: CreateAttendanceDto, @Request() req) {
//     try {
//       return await this.attendanceService.checkOut(createAttendanceDto, req.user.userId);
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || 'Erreur lors du pointage de sortie',
//         HttpStatus.BAD_REQUEST
//       );
//     }
//   }

//   // ========================================
//   // 🆕 GET-OR-CREATE — ADMIN/HR/MANAGER
//   // 🔒 Isolation garantie dans le service (assertCanAccessEmployee)
//   // ========================================

//   @Post('get-or-create')
//   @UseGuards(RolesGuard)
//   @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER')
//   async getOrCreateAttendance(
//     @Body() body: { employeeId: string; date: string },
//     @Request() req
//   ) {
//     try {
//       return await this.attendanceService.getOrCreate(
//         req.user.userId,
//         body.employeeId,
//         body.date
//       );
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || 'Erreur lors de la création/récupération',
//         error.status || HttpStatus.INTERNAL_SERVER_ERROR
//       );
//     }
//   }

//   // ========================================
//   // 📊 CONSULTATION
//   // ========================================

//   @Get('today')
//   async findToday(@Request() req) {
//     try {
//       // 🔒 Le service filtre automatiquement par département si MANAGER
//       return await this.attendanceService.findToday(req.user.userId);
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || 'Erreur lors de la récupération des pointages du jour',
//         HttpStatus.INTERNAL_SERVER_ERROR
//       );
//     }
//   }

//   @Get()
//   async findAll(
//     @Query('month') month: string,
//     @Query('year') year: string,
//     @Request() req
//   ): Promise<{ employees: any[]; attendances: any[]; dayStatuses: DayStatus[][] }> {
//     try {
//       const m = month ? parseInt(month) : new Date().getMonth() + 1;
//       const y = year  ? parseInt(year)  : new Date().getFullYear();
//       // 🔒 Le service filtre par département si MANAGER
//       return await this.attendanceService.findAll(req.user.userId, m, y);
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || "Erreur lors de la récupération de l'historique",
//         HttpStatus.INTERNAL_SERVER_ERROR
//       );
//     }
//   }

//   @Get('report')
//   async getReport(
//     @Query('month') month: string,
//     @Query('year') year: string,
//     @Request() req
//   ): Promise<MonthlyReportItem[]> {
//     try {
//       const m = month ? parseInt(month) : new Date().getMonth() + 1;
//       const y = year  ? parseInt(year)  : new Date().getFullYear();
//       return await this.attendanceService.generateMonthlyReport(req.user.userId, m, y);
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || 'Erreur lors de la génération du rapport',
//         HttpStatus.INTERNAL_SERVER_ERROR
//       );
//     }
//   }

//   @Get('employee/:employeeId')
//   async getEmployeeAttendance(
//     @Param('employeeId') employeeId: string,
//     @Query('month') month: string,
//     @Query('year') year: string,
//     @Request() req
//   ): Promise<DayStatus[]> {
//     try {
//       const m = month ? parseInt(month) : new Date().getMonth() + 1;
//       const y = year  ? parseInt(year)  : new Date().getFullYear();

//       // 🔒 getEmployeeDayStatuses vérifie l'accès + filtre département
//       return await this.attendanceService.getEmployeeDayStatuses(
//         req.user.userId,
//         employeeId,
//         m,
//         y
//       );
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || 'Erreur lors de la récupération des détails',
//         error.status || HttpStatus.INTERNAL_SERVER_ERROR
//       );
//     }
//   }

//   // ========================================
//   // 📋 HISTORIQUE DES MODIFICATIONS
//   // 🔒 Filtre MANAGER dans le service (par departmentId, pas name)
//   // ========================================

//   @Get('logs')
//   @UseGuards(RolesGuard)
//   @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER')
//   async getAttendanceLogs(
//     @Query('month') month: string,
//     @Query('year') year: string,
//     @Request() req
//   ) {
//     try {
//       const m = month ? parseInt(month) : new Date().getMonth() + 1;
//       const y = year  ? parseInt(year)  : new Date().getFullYear();
//       return await this.attendanceService.getLogs(req.user.userId, m, y);
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || "Erreur lors de la récupération de l'historique",
//         error.status || HttpStatus.INTERNAL_SERVER_ERROR
//       );
//     }
//   }

//   // ========================================
//   // 🆕 CRÉATION MANUELLE — ADMIN/HR/MANAGER
//   // 🔒 Isolation + calcul overtime dans le service
//   // ========================================

//   @Post('create-manual')
//   @UseGuards(RolesGuard)
//   @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER')
//   async createManualAttendance(
//     @Body() body: {
//       employeeId: string;
//       date: string;
//       status: string;
//       checkIn?: string;
//       checkOut?: string;
//       notes: string;
//     },
//     @Request() req
//   ) {
//     try {
//       return await this.attendanceService.createManual(req.user.userId, body);
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || 'Erreur lors de la création',
//         error.status || HttpStatus.INTERNAL_SERVER_ERROR
//       );
//     }
//   }

//   // ========================================
//   // 📈 RÉSUMÉS MENSUELS (POUR LA PAIE)
//   // ========================================

//   @Get('summary/:employeeId/:month/:year')
//   async getEmployeeSummary(
//     @Param('employeeId') employeeId: string,
//     @Param('month', ParseIntPipe) month: number,
//     @Param('year', ParseIntPipe) year: number,
//     @Request() req
//   ) {
//     try {
//       // 🔒 Vérifie l'accès à l'employé via le service
//       return await this.attendanceService.getEmployeeSummarySecure(
//         req.user.userId,
//         employeeId,
//         month,
//         year,
//         this.summaryService
//       );
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || 'Erreur lors de la récupération du résumé',
//         error.status || HttpStatus.INTERNAL_SERVER_ERROR
//       );
//     }
//   }

//   @Get('summaries')
//   @UseGuards(RolesGuard)
//   @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
//   async getMonthlySummaries(
//     @Query('month', ParseIntPipe) month: number,
//     @Query('year', ParseIntPipe) year: number,
//     @Request() req
//   ) {
//     try {
//       const companyId = await this.attendanceService.getCompanyId(req.user.userId);
//       return await this.summaryService.getStoredSummaries(companyId, month, year);
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || 'Erreur lors de la récupération des résumés',
//         error.status || HttpStatus.INTERNAL_SERVER_ERROR
//       );
//     }
//   }

//   @Post('generate-summaries')
//   @UseGuards(RolesGuard)
//   @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
//   async generateSummaries(
//     @Query('month', ParseIntPipe) month: number,
//     @Query('year', ParseIntPipe) year: number,
//     @Request() req
//   ) {
//     try {
//       const companyId = await this.attendanceService.getCompanyId(req.user.userId);
//       return await this.summaryService.generateAndStoreAllMonthlySummaries(companyId, month, year);
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || 'Erreur lors de la génération des résumés',
//         error.status || HttpStatus.INTERNAL_SERVER_ERROR
//       );
//     }
//   }

//   // ========================================
//   // 🔧 GESTION (ADMIN/HR)
//   // ========================================

//   @Post('generate-grid')
//   @UseGuards(RolesGuard)
//   @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
//   async generateMonthlyGrid(
//     @Body() body: { month: number; year: number },
//     @Request() req
//   ) {
//     try {
//       const companyId = await this.attendanceService.getCompanyId(req.user.userId);
//       return await this.attendanceService.generateMonthlyAttendanceGrid(
//         companyId,
//         body.month,
//         body.year
//       );
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || 'Erreur lors de la génération de la grille',
//         error.status || HttpStatus.INTERNAL_SERVER_ERROR
//       );
//     }
//   }

//   @Put('correct/:attendanceId')
//   @UseGuards(RolesGuard)
//   @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER')
//   async correctAttendance(
//     @Param('attendanceId') attendanceId: string,
//     @Body() correctDto: CorrectAttendanceDto,
//     @Request() req
//   ): Promise<{ success: boolean; attendance: any; changes: AuditChange[] }> {
//     try {
//       // 🔒 La correction vérifie le rôle et l'entreprise dans attendance-check.service.ts
//       return await this.attendanceService.correctAttendance(
//         attendanceId,
//         req.user.userId,
//         correctDto,
//         req
//       );
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || 'Erreur lors de la correction',
//         error.status || HttpStatus.BAD_REQUEST
//       );
//     }
//   }

//   // ========================================
//   // 📈 STATISTIQUES — ADMIN/HR/SUPER_ADMIN
//   // ========================================

//   @Get('stats')
//   @UseGuards(RolesGuard)
//   @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
//   async getMonthlyStats(
//     @Query('month') month: string,
//     @Query('year') year: string,
//     @Request() req
//   ) {
//     try {
//       const m = month ? parseInt(month) : new Date().getMonth() + 1;
//       const y = year  ? parseInt(year)  : new Date().getFullYear();
//       const companyId = await this.attendanceService.getCompanyId(req.user.userId);
//       return await this.summaryService.getMonthlyStats(companyId, m, y);
//     } catch (error: any) {
//       throw new HttpException(
//         error.message || 'Erreur lors du calcul des statistiques',
//         error.status || HttpStatus.INTERNAL_SERVER_ERROR
//       );
//     }
//   }

//   // ========================================
//   // ✅ OVERTIME WORKFLOW — Employé déclare oubli ou heures sup
//   // ========================================

//   @Post('resolve-forgotten/:attendanceId')
//   async resolveAsForgotten(
//     @Param('attendanceId') attendanceId: string,
//     @Request() req
//   ) {
//     try {
//       await this.cronService.resolveAsForgotten(attendanceId, req.user.userId);
//       return { success: true, message: "Journée clôturée à l'heure officielle." };
//     } catch (error: any) {
//       throw new HttpException(error.message || 'Erreur', HttpStatus.BAD_REQUEST);
//     }
//   }

//   @Post('declare-overtime/:attendanceId')
//   async declareOvertime(
//     @Param('attendanceId') attendanceId: string,
//     @Request() req
//   ) {
//     try {
//       await this.cronService.resolveAsOvertime(attendanceId, req.user.userId);
//       return { success: true, message: "Demande d'heures supplémentaires envoyée au responsable." };
//     } catch (error: any) {
//       throw new HttpException(error.message || 'Erreur', HttpStatus.BAD_REQUEST);
//     }
//   }

//   @Post('approve-overtime/:attendanceId')
//   @UseGuards(RolesGuard)
//   @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER')
//   async approveOvertime(
//     @Param('attendanceId') attendanceId: string,
//     @Request() req
//   ) {
//     try {
//       await this.cronService.approveOvertime(attendanceId, req.user.userId);
//       return { success: true, message: 'Heures supplémentaires validées.' };
//     } catch (error: any) {
//       throw new HttpException(error.message || 'Erreur', HttpStatus.BAD_REQUEST);
//     }
//   }

//   @Post('reject-overtime/:attendanceId')
//   @UseGuards(RolesGuard)
//   @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER')
//   async rejectOvertime(
//     @Param('attendanceId') attendanceId: string,
//     @Body() body: { reason: string },
//     @Request() req
//   ) {
//     try {
//       await this.cronService.rejectOvertime(attendanceId, req.user.userId, body.reason || 'Non précisé');
//       return { success: true, message: 'Heures supplémentaires refusées.' };
//     } catch (error: any) {
//       throw new HttpException(error.message || 'Erreur', HttpStatus.BAD_REQUEST);
//     }
//   }

//   // ========================================
//   // ✅ SHIFTS — Gestion des plannings flexibles
//   // ========================================

//   @Post('shifts')
//   @UseGuards(RolesGuard)
//   @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
//   async createShift(@Body() body: any, @Request() req) {
//     const companyId = await this.attendanceService.getCompanyId(req.user.userId);
//     if (!companyId) throw new HttpException('Entreprise introuvable', HttpStatus.BAD_REQUEST);
//     return this.attendanceService.createShift({ ...body, companyId });
//   }

//   @Get('shifts')
//   async getShifts(@Request() req) {
//     const companyId = await this.attendanceService.getCompanyId(req.user.userId);
//     if (!companyId) throw new HttpException('Entreprise introuvable', HttpStatus.BAD_REQUEST);
//     return this.attendanceService.getShifts(companyId);
//   }

//   @Post('shift-assignments')
//   @UseGuards(RolesGuard)
//   @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN', 'MANAGER')
//   async assignShift(
//     @Body() body: {
//       employeeId: string;
//       shiftId: string;
//       specificDate?: string;
//       dayOfWeek?: number;
//       validFrom?: string;
//       validUntil?: string;
//       notes?: string;
//     },
//     @Request() req
//   ) {
//     const companyId = await this.attendanceService.getCompanyId(req.user.userId);
//     if (!companyId) throw new HttpException('Entreprise introuvable', HttpStatus.BAD_REQUEST);
//     return this.attendanceService.assignShift({
//       ...body,
//       companyId,
//       validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
//       validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
//     });
//   }

//   @Get('shift-assignments/:employeeId')
//   async getEmployeeShifts(@Param('employeeId') employeeId: string) {
//     return this.attendanceService.getEmployeeShifts(employeeId);
//   }

//   @Put('shifts/:shiftId')
// @UseGuards(RolesGuard)
// @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
// async updateShift(
//   @Param('shiftId') shiftId: string,
//   @Body() body: any,
//   @Request() req
// ) {
//   const companyId = await this.attendanceService.getCompanyId(req.user.userId);
//   return this.attendanceService.updateShift(shiftId, companyId, body);
// }

// @Delete('shifts/:shiftId')
// @UseGuards(RolesGuard)
// @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
// async deleteShift(
//   @Param('shiftId') shiftId: string,
//   @Request() req
// ) {
//   const companyId = await this.attendanceService.getCompanyId(req.user.userId);
//   await this.attendanceService.deleteShift(shiftId, companyId);
//   return { success: true };
// }

// @Get('employee-shift/:employeeId/:date')
// async getEmployeeShiftForDate(
//   @Param('employeeId') employeeId: string,
//   @Param('date') date: string,
//   @Request() req
// ) {
//   const companyId = await this.attendanceService.getCompanyId(req.user.userId);
//   return this.attendanceService.getEmployeeShiftForDate(employeeId, companyId, date);
// }
// }
