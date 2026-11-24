// ============================================================================
// 📁 src/contract-chain/contract-chain.controller.ts
// ADMIN / HR_MANAGER / SUPER_ADMIN. Aucune route ne reçoit de companyId du
// client : l'entreprise est déduite du contrat chargé en base, puis vérifiée
// (assertCompanyAccess) dans le service.
// ============================================================================
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CDD_MOTIFS, CDD_RULES } from './contract-chain.rules';
import { ContractChainService, RequestCtx } from './contract-chain.service';
import { ConvertToCdiDto, RenewContractDto } from './dto/contract-chain.dto';

const ctxOf = (req: any): RequestCtx => ({
  ip: req.ip,
  requestId:
    typeof req.headers?.['x-request-id'] === 'string'
      ? req.headers['x-request-id'].slice(0, 100)
      : undefined,
  route: `${req.method} ${req.route?.path ?? ''}`.slice(0, 200),
});

@Controller('contract-chain')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
export class ContractChainController {
  constructor(private readonly service: ContractChainService) {}

  /** Motifs de CDD + limites légales (pour construire le formulaire côté front). */
  @Get('rules')
  rules() {
    return { motifs: CDD_MOTIFS, limits: CDD_RULES };
  }

  @Get('employee/:employeeId')
  chains(@Req() req: any, @Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.service.getChains(req.user, employeeId);
  }

  @Post(':contractId/renewal/preview')
  preview(
    @Req() req: any,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body() dto: RenewContractDto,
  ) {
    return this.service.preview(req.user, contractId, dto);
  }

  @Post(':contractId/renew')
  renew(
    @Req() req: any,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body() dto: RenewContractDto,
  ) {
    return this.service.renew(req.user, contractId, dto, ctxOf(req));
  }

  @Post(':contractId/convert-to-cdi')
  convert(
    @Req() req: any,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body() dto: ConvertToCdiDto,
  ) {
    return this.service.convertToCdi(req.user, contractId, dto, ctxOf(req));
  }
}