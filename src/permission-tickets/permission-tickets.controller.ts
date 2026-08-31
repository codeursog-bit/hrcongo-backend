// ============================================================================
// 📁 src/permission-tickets/permission-tickets.controller.ts
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionTicketsService } from './permission-tickets.service';
import { CreatePermissionTicketDto } from './dto/create-permission-ticket.dto';

@Controller('permission-tickets')
@UseGuards(AuthGuard('jwt'))
export class PermissionTicketsController {
  constructor(
    private readonly permissionTicketsService: PermissionTicketsService,
  ) {}

  @Post()
  create(@Body() dto: CreatePermissionTicketDto, @Request() req) {
    return this.permissionTicketsService.create(dto, req.user.userId);
  }

  @Get()
  findAll(@Request() req, @Query('status') status?: string) {
    return this.permissionTicketsService.findAll(req.user.userId, status);
  }

  @Get('me')
  findMine(@Request() req) {
    return this.permissionTicketsService.findMine(req.user.userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.permissionTicketsService.findOne(id, req.user.userId);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: 'APPROVED' | 'REJECTED',
    @Body('rejectionReason') rejectionReason: string,
    @Request() req,
  ) {
    return this.permissionTicketsService.updateStatus(
      id,
      status,
      req.user.userId,
      rejectionReason,
    );
  }

  @Patch(':id/return')
  markReturn(@Param('id') id: string, @Request() req) {
    return this.permissionTicketsService.markReturn(id, req.user.userId);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Request() req) {
    return this.permissionTicketsService.cancel(id, req.user.userId);
  }
}
