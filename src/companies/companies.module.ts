// // ============================================================================
// // 📁 src/companies/companies.module.ts
// //  Import CloudinaryModule pour l'upload du logo
// // ============================================================================
// import { Module, forwardRef } from '@nestjs/common';
// import { CompaniesService } from './companies.service';
// import { CompaniesController } from './companies.controller';
// import { PrismaModule } from '../prisma/prisma.module';
// import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
// import { CloudinaryModule } from '../cloudinary/cloudinary.module';

// @Module({
//   imports: [
//     PrismaModule,
//     forwardRef(() => SubscriptionsModule),
//     CloudinaryModule, // ✅ Pour uploadLogo() et deleteLogo()
//   ],
//   controllers: [CompaniesController],
//   providers: [CompaniesService],
//   exports: [CompaniesService],
// })
// export class CompaniesModule {}

import { Module, forwardRef } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { AffiliateModule } from '../affiliate/affiliate.module';
import { ConventionsModule } from '../conventions/conventions.module';

import { CompanySiteService } from './company-site.service';
import { CompanySiteController } from './company-site.controller';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => SubscriptionsModule),
    CloudinaryModule,
    AffiliateModule, // ✅ Requis pour injecter AffiliateService dans CompaniesService
    ConventionsModule, // ✅ Requis pour injecter ConventionsService dans CompaniesService
  ],
  controllers: [CompaniesController, CompanySiteController],
  providers: [CompaniesService, CompanySiteService],
  exports: [CompaniesService, CompanySiteService],
})
export class CompaniesModule {}