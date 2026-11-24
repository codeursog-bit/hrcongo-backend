// src/recruitment/recruitment-requisitions.controller.ts
// Demandes de recrutement : les managers peuvent demander, la RH valide.
// (les droits fins — qui voit quoi — sont appliqués dans le service)
import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Request, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RecruitmentRequisitionsService } from './recruitment-requisitions.service';

@Controller('recruitment/requisitions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN', 'HR_MANAGER', 'MANAGER')
export class RecruitmentRequisitionsController {
  constructor(private readonly svc: RecruitmentRequisitionsService) {}

  @Post()
  create(@Body() body: any, @Request() req: any) {
    return this.svc.create(body, req.user.userId);
  }

  @Get()
  list(@Query('status') status: string | undefined, @Request() req: any) {
    return this.svc.list(req.user.userId, status);
  }

  @Get(':id')
  get(@Param('id') id: string, @Request() req: any) {
    return this.svc.get(id, req.user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.svc.update(id, body, req.user.userId);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  review(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.svc.review(id, body, req.user.userId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id') id: string, @Request() req: any) {
    return this.svc.cancel(id, req.user.userId);
  }

  @Post(':id/link-job')
  @HttpCode(HttpStatus.OK)
  linkJob(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.svc.linkJob(id, body, req.user.userId);
  }
}
