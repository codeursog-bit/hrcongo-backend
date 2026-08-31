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
import { PrismaService } from 'src/prisma/prisma.service';
import { AffiliateModule } from '../affiliate/affiliate.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    CabinetModule,
    AffiliateModule,
    JwtModule.registerAsync({
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
  providers: [AuthService, TwoFactorService, JwtStrategy, PrismaService],
  controllers: [AuthController, TwoFactorController],
  exports: [AuthService, TwoFactorService],
})
export class AuthModule {}
