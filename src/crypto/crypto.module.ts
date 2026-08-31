// ============================================================================
// 📁 src/crypto/crypto.module.ts
// ============================================================================
import { Module, Global } from '@nestjs/common';
import { CryptoService } from './crypto.service';

@Global() // Disponible dans toute l'app sans réimporter
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
