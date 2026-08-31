// src/training/training.controller.ts
// Un seul fichier — la route /verify/:ref est publique via @UseGuards() vide
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TrainingService } from './training.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { CreateTrainingRequestDto } from './dto/create-request.dto';
import { ReviewRequestDto } from './dto/review-request.dto';
import { UpdatePfaDto } from './dto/update-pfa.dto';

@Controller('training')
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  // ── Route PUBLIQUE — doit être AVANT le guard global ─────────────────────
  // Vérification d'un certificat : accessible sans compte
  // Ex: GET /training/verify/CERT-A1B2-OHAD-2026-XY9Z
  @Get('verify/:ref')
  verifyCertificate(@Param('ref') ref: string) {
    return this.trainingService.verifyCertificate(ref);
  }

  // ── Toutes les routes suivantes nécessitent un JWT ────────────────────────

  @Post('courses')
  @UseGuards(AuthGuard('jwt'))
  createCourse(@Body() dto: CreateCourseDto, @Request() req: any) {
    return this.trainingService.createCourse(dto, req.user.userId);
  }

  @Get('courses')
  @UseGuards(AuthGuard('jwt'))
  findAllCourses(@Request() req: any) {
    return this.trainingService.findAllCourses(req.user.userId);
  }

  @Post('join/:courseId')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  joinCourse(@Param('courseId') courseId: string, @Request() req: any) {
    return this.trainingService.joinCourse(courseId, req.user.userId);
  }

  @Patch('request-completion/:sessionId')
  @UseGuards(AuthGuard('jwt'))
  requestCompletion(
    @Param('sessionId') sessionId: string,
    @Request() req: any,
  ) {
    return this.trainingService.requestCompletion(sessionId, req.user.userId);
  }

  @Patch('validate/:sessionId')
  @UseGuards(AuthGuard('jwt'))
  validateCompletion(
    @Param('sessionId') sessionId: string,
    @Body() body: { mention: string; validationNote?: string },
    @Request() req: any,
  ) {
    return this.trainingService.validateCompletion(
      sessionId,
      body,
      req.user.userId,
    );
  }

  @Post('assign')
  @UseGuards(AuthGuard('jwt'))
  assignCourse(
    @Body() body: { courseId: string; employeeId: string },
    @Request() req: any,
  ) {
    return this.trainingService.assignCourse(
      body.courseId,
      body.employeeId,
      req.user.userId,
    );
  }

  @Post('requests')
  @UseGuards(AuthGuard('jwt'))
  createRequest(@Body() dto: CreateTrainingRequestDto, @Request() req: any) {
    return this.trainingService.createRequest(dto, req.user.userId);
  }

  @Get('requests')
  @UseGuards(AuthGuard('jwt'))
  findAllRequests(@Request() req: any) {
    return this.trainingService.findAllRequests(req.user.userId);
  }

  @Patch('requests/:id')
  @UseGuards(AuthGuard('jwt'))
  reviewRequest(
    @Param('id') id: string,
    @Body() dto: ReviewRequestDto,
    @Request() req: any,
  ) {
    return this.trainingService.reviewRequest(id, dto, req.user.userId);
  }

  @Get('dashboard')
  @UseGuards(AuthGuard('jwt'))
  getDashboard(@Request() req: any) {
    return this.trainingService.getDashboard(req.user.userId);
  }

  @Get('pfa')
  @UseGuards(AuthGuard('jwt'))
  getPfa(@Request() req: any) {
    return this.trainingService.getPfa(req.user.userId);
  }

  @Patch('pfa/:deptId')
  @UseGuards(AuthGuard('jwt'))
  updateDeptBudget(
    @Param('deptId') deptId: string,
    @Body() dto: UpdatePfaDto,
    @Request() req: any,
  ) {
    return this.trainingService.updateDeptBudget(deptId, dto, req.user.userId);
  }

  @Get('my')
  @UseGuards(AuthGuard('jwt'))
  getMyTrainings(@Request() req: any) {
    return this.trainingService.getMyTrainings(req.user.userId);
  }

  @Get('passeport/:employeeId')
  @UseGuards(AuthGuard('jwt'))
  getPasseport(@Param('employeeId') employeeId: string, @Request() req: any) {
    return this.trainingService.getPasseport(employeeId, req.user.userId);
  }
}
