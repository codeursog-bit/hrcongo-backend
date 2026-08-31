import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  CabinetMemberGuard,
  CabinetAdminGuard,
} from '../guards/cabinet.guards';
import { CabinetWalletService } from '../services/cabinet-wallet.service';
import { PurchasePackDto, ActivateForfaitDto } from '../dto/cabinet.dto';

@Controller('cabinet/:cabinetId/wallet')
@UseGuards(JwtAuthGuard, CabinetMemberGuard)
export class CabinetWalletController {
  constructor(private readonly walletService: CabinetWalletService) {}

  // GET /cabinet/:cabinetId/wallet
  @Get()
  getWallet(@Param('cabinetId') cabinetId: string) {
    return this.walletService.getWallet(cabinetId);
  }

  // POST /cabinet/:cabinetId/wallet/purchase-pack
  @Post('purchase-pack')
  @UseGuards(CabinetAdminGuard)
  purchasePack(
    @Param('cabinetId') cabinetId: string,
    @Body() dto: PurchasePackDto,
  ) {
    return this.walletService.purchasePack(cabinetId, dto.pack, dto.reference);
  }

  // POST /cabinet/:cabinetId/wallet/activate-forfait
  @Post('activate-forfait')
  @UseGuards(CabinetAdminGuard)
  activateForfait(
    @Param('cabinetId') cabinetId: string,
    @Body() dto: ActivateForfaitDto,
  ) {
    return this.walletService.activateForfait(cabinetId, dto.reference);
  }
}
