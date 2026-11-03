// ============================================================================
// 📁 src/auth/auth.module.ts — Phase 2 : 2FA + Audit + Crypto
// ============================================================================
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorController } from './two-factor.controller';
import { UsersModule } from '../users/users.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { CabinetModule } from '../cabinet/cabinet.module';
import { AffiliateModule } from '../affiliate/affiliate.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    CabinetModule,
    AffiliateModule,
    // ✅ global: true — JwtService devient injectable partout dans l'app sans
    // avoir à importer JwtModule dans chaque module. Nécessaire depuis que
    // AppGateway (redéclaré comme provider dans plusieurs modules :
    // AttendanceModule, TrainingModule, AppModule) dépend de JwtService pour
    // authentifier les sockets WebSocket (fix de la fuite multi-tenant sur
    // les notifications temps réel) — sans ce `global: true`, seul AuthModule
    // lui-même pouvait résoudre JwtService, et tout autre module qui
    // redéclare AppGateway plantait au démarrage (UnknownDependenciesException).
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret:
          configService.get<string>('JWT_SECRET') ||
          'secretKey_change_in_production_123!',
        signOptions: { expiresIn: '1d' },
      }),
      inject: [ConfigService],
    }),
  ],
  // PrismaService vient du PrismaModule global : le redéclarer ici créait une 2e instance (et un 2e pool de connexions)
  providers: [AuthService, TwoFactorService, JwtStrategy],
  controllers: [AuthController, TwoFactorController],
  exports: [AuthService, TwoFactorService],
})
export class AuthModule {}