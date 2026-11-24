// src/training/training-sessions.controller.ts
// Routes /training/sessions/* — toutes protégées par le JWT.
// Les rôles sont vérifiés dans le service (RH uniquement).
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TrainingSessionsService } from './training-sessions.service';

@Controller('training/sessions')
@UseGuards(AuthGuard('jwt'))
export class TrainingSessionsController {
  constructor(private readonly sessions: TrainingSessionsService) {}

  @Post()
  create(@Body() body: any, @Request() req: any) {
    return this.sessions.createSession(body, req.user.userId);
  }

  @Get()
  list(
    @Query('courseId') courseId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Request() req: any,
  ) {
    return this.sessions.listSessions(
      { courseId, status, from, to },
      req.user.userId,
    );
  }

  @Get(':id')
  getOne(@Param('id') id: string, @Request() req: any) {
    return this.sessions.getSession(id, req.user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.sessions.updateSession(id, body, req.user.userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.sessions.deleteSession(id, req.user.userId);
  }

  @Post(':id/participants')
  @HttpCode(HttpStatus.OK)
  addParticipants(
    @Param('id') id: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    return this.sessions.addParticipants(id, body, req.user.userId);
  }

  @Delete(':id/participants/:employeeTrainingId')
  removeParticipant(
    @Param('id') id: string,
    @Param('employeeTrainingId') employeeTrainingId: string,
    @Request() req: any,
  ) {
    return this.sessions.removeParticipant(
      id,
      employeeTrainingId,
      req.user.userId,
    );
  }

  @Post(':id/convocations')
  @HttpCode(HttpStatus.OK)
  sendConvocations(@Param('id') id: string, @Request() req: any) {
    return this.sessions.sendConvocations(id, req.user.userId);
  }

  @Put(':id/attendance')
  saveAttendance(
    @Param('id') id: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    return this.sessions.saveAttendance(id, body, req.user.userId);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.sessions.closeSession(id, body, req.user.userId);
  }
}
