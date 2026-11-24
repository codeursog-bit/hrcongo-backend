// ============================================================================
// 📁 src/legal-parameters/legal-parameters.module.ts
// @Global : les calculateurs de paie injectent le service sans modifier
// chacun des modules qui les déclarent.
// ============================================================================
import { Global, Module } from '@nestjs/common';
import { LegalParametersService } from './legal-parameters.service';
import { LegalParametersController, LegalParametersReadController } from './legal-parameters.controller';

@Global()
@Module({
  controllers: [LegalParametersController, LegalParametersReadController],
  providers: [LegalParametersService],
  exports: [LegalParametersService],
})
export class LegalParametersModule {}