// 📁 EMPLACEMENT (projet backend) : src/device-sync/device-sync-agent.controller.ts
// ============================================================================
// 🤖 Routes appelées par l'AGENT installé chez le client (clé x-sync-agent-key).
//    Toutes sont sortantes depuis le réseau du client : rien à ouvrir.
// ============================================================================
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request, UseGuards } from '@nestjs/common';
import { SyncAgentKeyGuard } from './guards/sync-agent-key.guard';
import { DeviceSyncService } from './device-sync.service';
import { AgentBatchDto, AgentFailDto } from './dto/device-sync.dto';

@Controller('device-sync/agent')
@UseGuards(SyncAgentKeyGuard)
export class DeviceSyncAgentController {
  constructor(private readonly service: DeviceSyncService) {}

  // L'agent demande : « y a-t-il une synchronisation à faire ? »
  @Get('poll')
  poll(@Request() req, @Query('v') version?: string) {
    return this.service.poll(req.syncConnector, version);
  }

  // Envoi d'un lot de pointages (max 1000). `done: true` sur le dernier lot.
  @Post('jobs/:jobId/punches')
  punches(@Param('jobId', ParseUUIDPipe) jobId: string, @Body() dto: AgentBatchDto, @Request() req) {
    return this.service.receiveBatch(req.syncConnector, jobId, dto);
  }

  // L'agent n'a pas pu lire la pointeuse (éteinte, réseau, mauvais mot de passe…)
  @Post('jobs/:jobId/fail')
  fail(@Param('jobId', ParseUUIDPipe) jobId: string, @Body() dto: AgentFailDto, @Request() req) {
    return this.service.failJob(req.syncConnector, jobId, dto.error);
  }
}