// ============================================================================
// contract-rupture.module.ts
// ============================================================================
import { Module } from '@nestjs/common';
import { ContractRuptureService } from './contract-rupture.service';
import { ContractRuptureController } from './contract-rupture.controller';

@Module({
  controllers: [ContractRuptureController],
  providers: [ContractRuptureService],
  exports: [ContractRuptureService],
})
export class ContractRuptureModule {}
