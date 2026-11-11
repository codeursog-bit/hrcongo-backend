// 📁 EMPLACEMENT (projet backend) : src/device-sync/device-sync.controller.ts
// ============================================================================
// 🔐 Routes ADMIN (JWT, comme le reste de l'app) — écran « Synchronisation ».
// ============================================================================
import {
  Body, Controller, Delete, Get, HttpException, HttpStatus, Param, ParseUUIDPipe,
  Patch, Post, Query, Request, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DeviceSyncService } from './device-sync.service';
import {
  CreateConnectorDto, ResolveConflictDto, ResolveIncompleteDto, SaveMappingsDto,
  StartSyncDto, UpdateConnectorDto,
} from './dto/device-sync.dto';

// Relaie le statut HTTP d'origine ; sinon 400 avec le message.
const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e: any) {
    if (e instanceof HttpException) throw e;
    throw new HttpException(e?.message || 'Erreur', HttpStatus.BAD_REQUEST);
  }
};

@Controller('device-sync')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
export class DeviceSyncController {
  constructor(private readonly service: DeviceSyncService) {}

  // ── Connecteurs ──────────────────────────────────────────────────────────
  @Get('connectors')
  list(@Request() req) { return wrap(() => this.service.listConnectors(req.user.companyId)); }

  @Post('connectors')
  create(@Body() dto: CreateConnectorDto, @Request() req) {
    return wrap(() => this.service.createConnector(req.user.companyId, req.user.userId, dto));
  }

  @Patch('connectors/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConnectorDto, @Request() req) {
    return wrap(() => this.service.updateConnector(req.user.companyId, id, dto));
  }

  @Post('connectors/:id/rotate-key')
  rotate(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return wrap(() => this.service.rotateKey(req.user.companyId, id));
  }

  @Post('connectors/:id/rebind')
  rebind(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return wrap(() => this.service.rebindActingUser(req.user.companyId, id, req.user.userId));
  }

  @Delete('connectors/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return wrap(() => this.service.deleteConnector(req.user.companyId, id));
  }

  // ── Le bouton « Synchroniser » ───────────────────────────────────────────
  @Post('connectors/:id/sync')
  sync(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StartSyncDto, @Request() req) {
    return wrap(() => this.service.startSync(req.user.companyId, req.user.userId, id, dto));
  }

  @Get('connectors/:id/jobs')
  jobs(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return wrap(() => this.service.listJobs(req.user.companyId, id));
  }

  @Get('jobs/:jobId')
  job(@Param('jobId', ParseUUIDPipe) jobId: string, @Request() req) {
    return wrap(() => this.service.getJob(req.user.companyId, jobId));
  }

  @Post('jobs/:jobId/cancel')
  cancel(@Param('jobId', ParseUUIDPipe) jobId: string, @Request() req) {
    return wrap(() => this.service.cancelJob(req.user.companyId, jobId));
  }

  // ── Associations ─────────────────────────────────────────────────────────
  @Get('connectors/:id/mappings')
  mappings(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return wrap(() => this.service.getMappings(req.user.companyId, id));
  }

  @Post('connectors/:id/mappings')
  saveMappings(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveMappingsDto, @Request() req) {
    return wrap(() => this.service.saveMappings(req.user.companyId, id, dto));
  }

  @Post('connectors/:id/mappings/auto')
  autoMap(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return wrap(() => this.service.autoMap(req.user.companyId, id));
  }

  // ── À corriger ───────────────────────────────────────────────────────────
  @Get('issues')
  issues(@Query('connectorId') connectorId: string | undefined, @Request() req) {
    return wrap(() => this.service.getIssues(req.user.companyId, connectorId || undefined));
  }

  @Post('issues/incomplete')
  resolveIncomplete(@Body() dto: ResolveIncompleteDto, @Request() req) {
    return wrap(() => this.service.resolveIncomplete(req.user.companyId, dto));
  }

  @Post('issues/conflict')
  resolveConflict(@Body() dto: ResolveConflictDto, @Request() req) {
    return wrap(() => this.service.resolveConflict(req.user.companyId, dto));
  }
}