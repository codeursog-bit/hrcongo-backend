import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  CabinetMemberGuard,
  CabinetAdminGuard,
} from '../guards/cabinet.guards';
import { CabinetBatchClosureService } from '../services/cabinet-batch-closure.service';
import { InitBatchClosureDto } from '../dto/cabinet.dto';

@Controller('cabinet/:cabinetId/batch-closure')
@UseGuards(JwtAuthGuard, CabinetMemberGuard)
export class CabinetBatchClosureController {
  constructor(private readonly batchService: CabinetBatchClosureService) {}

  // POST /cabinet/:cabinetId/batch-closure/init
  @Post('init')
  @UseGuards(CabinetAdminGuard)
  init(
    @Param('cabinetId') cabinetId: string,
    @Body() dto: InitBatchClosureDto,
  ) {
    return this.batchService.initBatchClosure(
      cabinetId,
      dto.month,
      dto.year,
      dto.companyIds,
    );
  }

  // POST /cabinet/:cabinetId/batch-closure/:batchId/run
  // Polling au lieu de SSE — compatible cross-site (Vercel -> Render)
  // EventSource ne supporte pas credentials cross-site sans proxy
  @Post(':batchId/run')
  @UseGuards(CabinetAdminGuard)
  async run(
    @Param('cabinetId') cabinetId: string,
    @Param('batchId') batchId: string,
  ) {
    // month/year lus depuis la DB (sauvegardés à l'init)
    // Ne jamais utiliser new Date() — le mois choisi peut différer du mois serveur
    return this.batchService.executeBatchClosure(cabinetId, batchId);
  }

  // GET /cabinet/:cabinetId/batch-closure/:batchId/status  (polling frontend)
  @Get(':batchId/status')
  getStatus(
    @Param('cabinetId') cabinetId: string,
    @Param('batchId') batchId: string,
  ) {
    return this.batchService.getBatchStatus(cabinetId, batchId);
  }

  // GET /cabinet/:cabinetId/batch-closure/history
  @Get('history')
  getHistory(@Param('cabinetId') cabinetId: string) {
    return this.batchService.getBatchHistory(cabinetId);
  }
}
