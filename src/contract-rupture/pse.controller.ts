// ============================================================================
// 📁 src/contract-rupture/pse.controller.ts
// Routes : /api/pse
// ============================================================================
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { PSEService } from './pse.service';
import { CreatePSEDto, UpdateEtapePSEDto } from './dto/pse.dto';

@ApiBearerAuth()
@Controller('pse')
@UseGuards(JwtAuthGuard)
export class PSEController {
  constructor(private readonly pseService: PSEService) {}

  /** GET /pse — Liste toutes les procédures PSE de l'entreprise */
  @Get()
  @ApiOperation({ summary: 'Liste des procédures PSE' })
  findAll(@GetUser('companyId') companyId: string) {
    return this.pseService.findAll(companyId);
  }

  /** POST /pse — Ouvrir une nouvelle procédure PSE */
  @Post()
  @ApiOperation({ summary: 'Ouvrir une procédure PSE' })
  create(
    @Body() dto: CreatePSEDto,
    @GetUser('companyId') companyId: string,
    @GetUser('id') userId: string,
  ) {
    return this.pseService.create(companyId, userId, dto);
  }

  /** GET /pse/:id — Détail d'une procédure */
  @Get(':id')
  @ApiOperation({ summary: "Détail d'une procédure PSE" })
  @ApiParam({ name: 'id' })
  findOne(@Param('id') id: string, @GetUser('companyId') companyId: string) {
    return this.pseService.findOne(id, companyId);
  }

  /** PATCH /pse/:id/etape/:idx — Marquer une étape comme faite/pas faite */
  @Patch(':id/etape/:idx')
  @ApiOperation({ summary: 'Mettre à jour une étape légale PSE' })
  @ApiParam({ name: 'id', description: 'ID de la procédure PSE' })
  @ApiParam({ name: 'idx', description: "Index de l'étape (0-6)" })
  @HttpCode(HttpStatus.OK)
  updateEtape(
    @Param('id') id: string,
    @Param('idx') idx: string,
    @Body() dto: UpdateEtapePSEDto,
    @GetUser('companyId') companyId: string,
  ) {
    return this.pseService.updateEtape(
      id,
      companyId,
      Number(idx),
      dto.done,
      dto.date,
    );
  }

  /** PATCH /pse/:id/salarie/:salariePseId — Changer statut d'un salarié concerné */
  @Patch(':id/salarie/:salariePseId')
  @ApiOperation({
    summary: "Mettre à jour le statut d'un salarié dans la procédure PSE",
  })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'salariePseId' })
  @HttpCode(HttpStatus.OK)
  updateSalarie(
    @Param('id') id: string,
    @Param('salariePseId') salariePseId: string,
    @Body('statut') statut: 'PREVU' | 'CONFIRME' | 'MAINTENU',
    @GetUser('companyId') companyId: string,
  ) {
    return this.pseService.updateSalarieConcerne(
      id,
      companyId,
      salariePseId,
      statut,
    );
  }
}
