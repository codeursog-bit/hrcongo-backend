import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ContractChainService } from './contract-chain.service';
import { ContractSyncService } from './contract-sync.service';
import { ContractChainController } from './contract-chain.controller';

// AuditTrailService vient du AuditTrailModule (@Global) — pas d'import ici.
@Module({
  imports: [PrismaModule],
  providers: [ContractChainService, ContractSyncService],
  controllers: [ContractChainController],
  exports: [ContractChainService, ContractSyncService],
})
export class ContractChainModule {}