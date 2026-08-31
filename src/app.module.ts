// ============================================================================
// 📁 src/app.module.ts — VERSION MISE À JOUR
// Ajout : CnssDeclarationModule, ContractRuptureModule, UnpaidSalaryModule
// ContractsModule (déjà existant, vérifier s'il est bien importé)
// ============================================================================
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CryptoModule } from './crypto/crypto.module';
import { AuditModule } from './audit/audit.module';
import { CleanupModule } from './cleanup/cleanup.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { CompaniesModule } from './companies/companies.module';
import { DepartmentsModule } from './departments/departments.module';
import { EmployeesModule } from './employees/employees.module';
import { LeavesModule } from './leaves/leaves.module';
import { AttendanceModule } from './attendance/attendance.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { RecruitmentModule } from './recruitment/recruitment.module';
import { PerformanceModule } from './performance/performance.module';
import { TrainingModule } from './training/training.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { DocumentsModule } from './documents/documents.module';
import { AssetsModule } from './assets/assets.module';
import { ReportsModule } from './reports/reports.module';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { LoansModule } from './loans/loans.module';
import { HealthModule } from './health/health.module';
import { ConventionsModule } from './conventions/conventions.module';
import { EchelonSuggestionsModule } from './echelon-suggestions/echelon-suggestions.module';
import { PaymentsModule } from './payments/payments.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PayrollSettingsModule } from './payroll/settings/settings.module';
import { FiscalModule } from './payroll/fiscal/fiscal.module';
import { PayrollsModule } from './payrolls/payrolls.module';
import { AdminModule } from './admin/admin.module';
import { BonusTemplatesModule } from './bonus-templates/bonus-templates.module';
import { CompanyTaxModule } from './company-taxes/company-tax.module';
import { CabinetModule } from './cabinet/cabinet.module';
import { AppGateway } from './app.gateway';

// 🆕 NOUVEAUX MODULES
import { ContractsModule } from './contracts/contracts.module'; // Scheduler expiry existant
import { CnssDeclarationModule } from './cnss-declaration/cnss-declaration.module';
import { DasDeclarationModule } from './das-declaration/das-declaration.module';
import { ContractRuptureModule } from './contract-rupture/contract-rupture.module';
import { UnpaidSalaryModule } from './unpaid-salary/unpaid-salary.module';
import { AffiliateModule } from './affiliate/affiliate.module';
import { BulletinTemplateModule } from './bulletin-template/bulletin-template.module';
import { AbsenceRequestsModule } from './absence-requests/absence-requests.module';

import { BlogModule } from './blog/blog.module';
import { ContactModule } from './contact/contact.module';
import { PermissionTicketsModule } from './permission-tickets/permission-tickets.module';
import { CompanyDeductionsModule } from './company-deductions/company-deductions.module';
import { AbsenceTrackingModule } from './absence-tracking/absence-tracking.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),

    // ── SÉCURITÉ — CHIFFREMENT & AUDIT ──────────────────────────────────────
    CryptoModule, // Chiffrement AES-256-GCM des données sensibles (global)
    AuditModule,
    CleanupModule, // Audit log des actions sensibles (global)

    // ── RATE LIMITING GLOBAL ──────────────────────────────────────────────
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60_000, // 1 minute
        limit: 120, // max 120 req/min par IP (toutes routes confondues)
      },
      {
        name: 'medium',
        ttl: 900_000, // 15 minutes
        limit: 500, // max 500 req/15min par IP
      },
    ]),

    // ── CORE ─────────────────────────────────────────────────────────────────
    PrismaModule,
    UsersModule,
    AuthModule,

    // ── ENTREPRISE ───────────────────────────────────────────────────────────
    BulletinTemplateModule, // ✅ Avant CompaniesModule pour que GET /companies/bulletin-template ne soit pas capturé par GET :id
    CompaniesModule,
    DepartmentsModule,
    EmployeesModule,

    // ── RH ───────────────────────────────────────────────────────────────────
    LeavesModule,
    AttendanceModule,
    AbsenceRequestsModule, // 🆕
    PermissionTicketsModule, // 🆕

    // ── PAIE ─────────────────────────────────────────────────────────────────
    PayrollSettingsModule,
    FiscalModule,
    PayrollsModule,
    LoansModule,
    BonusTemplatesModule,

    // ── 🆕 MODULES CONTRATS & RUPTURE ────────────────────────────────────────
    ContractsModule, // Scheduler alertes expiration contrats
    CnssDeclarationModule, // Déclaration mensuelle CNSS + exports
    DasDeclarationModule,
    ContractRuptureModule, // Rupture contrat + calcul indemnités
    UnpaidSalaryModule, // Suivi salaires impayés + alertes auto

    // ── SAAS / CABINET ───────────────────────────────────────────────────────
    AdminModule,
    CabinetModule,

    // ── GESTION ──────────────────────────────────────────────────────────────
    DashboardModule,
    RecruitmentModule,
    PerformanceModule,
    TrainingModule,
    OnboardingModule,
    DocumentsModule,
    AssetsModule,
    ReportsModule,
    CompanyDeductionsModule,

    // ── COMMUNICATION ────────────────────────────────────────────────────────
    MailModule,
    PaymentsModule,
    SubscriptionsModule,
    NotificationsModule,
    HealthModule,
    ConventionsModule,
    EchelonSuggestionsModule,
    CompanyTaxModule,
    AffiliateModule,
    BlogModule,
    ContactModule,
    AbsenceTrackingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AppGateway,
    // ✅ Rate limiting appliqué sur TOUTES les routes (surchargeable par @Throttle)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // ✅ Audit log automatique sur les actions sensibles
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}