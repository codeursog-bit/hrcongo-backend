// src/affiliate/affiliate.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AffiliateController } from './affiliate.controller';
import { AffiliateService } from './affiliate.service';
import { AffiliateAdminService } from './affiliate-admin.service';
import { AffiliateJwtGuard } from './guards/affiliate-jwt.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { YabetooPayService } from '../payments/yabetoopay.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [AffiliateController],
  providers: [
    AffiliateService,
    AffiliateAdminService,
    AffiliateJwtGuard,
    YabetooPayService, // requis pour distributeToAffiliate()
  ],
  exports: [AffiliateService],
})
export class AffiliateModule {}
