import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Request, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AttendanceBreakService } from './services/attendance-break.service';

// 🆕 Pause de la journée — routes séparées du contrôleur de pointage (aucune collision avec ses routes :id)
@Controller('attendance-break')
@UseGuards(AuthGuard('jwt'))
export class AttendanceBreakController {
  constructor(private readonly breaks: AttendanceBreakService) {}

  @Get('status')
  status(@Request() req) {
    return this.breaks.getStatus(req.user.userId);
  }

  // Prendre la pause : aucun scan
  @Post('start')
  @HttpCode(200)
  start(@Request() req) {
    return this.breaks.start(req.user.userId);
  }

  // Reprise par GPS (la reprise par QR / code secret passe par le scan de l'écran)
  @Post('end')
  @HttpCode(200)
  end(@Request() req, @Body() body: { latitude?: number; longitude?: number }) {
    return this.breaks.endByGps(req.user.userId, body?.latitude, body?.longitude);
  }

  // Correction admin / RH, justification obligatoire
  @Patch(':attendanceId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
  correct(
    @Request() req,
    @Param('attendanceId', new ParseUUIDPipe()) attendanceId: string,
    @Body() body: { endedAt?: string; reason?: string },
  ) {
    return this.breaks.adminCorrect(
      { userId: req.user.userId, companyId: req.user.companyId ?? null },
      attendanceId,
      body ?? {},
    );
  }
}