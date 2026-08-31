-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'MANAGER', 'EMPLOYEE', 'CABINET_ADMIN', 'CABINET_GESTIONNAIRE');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "marital_status" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED');

-- CreateEnum
CREATE TYPE "contract_type" AS ENUM ('CDI', 'CDD', 'STAGE', 'CONSULTANT', 'INTERIM', 'PRESTATAIRE');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('BANK_TRANSFER', 'CHECK', 'CASH', 'MOBILE_MONEY');

-- CreateEnum
CREATE TYPE "employee_status" AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED', 'RETIRED');

-- CreateEnum
CREATE TYPE "tol_zone" AS ENUM ('VILLE', 'PERIPHERIE');

-- CreateEnum
CREATE TYPE "TrialStatus" AS ENUM ('NONE', 'IN_PROGRESS', 'CONFIRMED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "payroll_status" AS ENUM ('DRAFT', 'VALIDATED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payroll_item_type" AS ENUM ('GAIN', 'DEDUCTION', 'EMPLOYER_COST', 'INFO');

-- CreateEnum
CREATE TYPE "leave_type" AS ENUM ('ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'COMPENSATORY');

-- CreateEnum
CREATE TYPE "leave_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('UNKNOWN', 'PRESENT', 'REMOTE', 'LEAVE', 'ABSENT_PAID', 'ABSENT_UNPAID', 'HOLIDAY', 'OFF_DAY', 'LATE', 'FUTURE');

-- CreateEnum
CREATE TYPE "correction_type" AS ENUM ('CHECKIN_MISSED', 'CHECKOUT_MISSED', 'STATUS_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "correction_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "overtime_status" AS ENUM ('NONE', 'PENDING_EMPLOYEE', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'AUTO_CLOSED');

-- CreateEnum
CREATE TYPE "closure_reason" AS ENUM ('FORGOT', 'OVERTIME', 'AUTO_CLOSED');

-- CreateEnum
CREATE TYPE "job_offer_status" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "processing_mode" AS ENUM ('MANUAL', 'AI_ASSISTED');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('MULTIPLE_CHOICE', 'CHECKBOXES', 'SHORT_TEXT', 'CODE', 'YES_NO');

-- CreateEnum
CREATE TYPE "candidate_status" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'EN_ATTENTE_TEST', 'REFUSE', 'EN_ATTENTE_ANALYSE', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "ai_suggestion" AS ENUM ('RETENU', 'MOYENNE', 'SECONDE_CHANCE', 'REFUS');

-- CreateEnum
CREATE TYPE "goal_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('DRAFT', 'SHARED', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "training_format" AS ENUM ('ONLINE', 'IN_PERSON', 'HYBRID');

-- CreateEnum
CREATE TYPE "provider_type" AS ENUM ('INTERNAL', 'EXTERNAL_VENDOR', 'ONLINE_PLATFORM');

-- CreateEnum
CREATE TYPE "training_status" AS ENUM ('REQUESTED', 'APPROVED', 'PLANNED', 'IN_PROGRESS', 'COMPLETION_REQUESTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "onboarding_type" AS ENUM ('ONBOARDING', 'OFFBOARDING');

-- CreateEnum
CREATE TYPE "onboarding_status" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "document_type" AS ENUM ('PAYSLIP', 'WORK_CERTIFICATE', 'SALARY_ATTESTATION', 'CONTRACT', 'ID_CARD', 'RESUME', 'OTHER');

-- CreateEnum
CREATE TYPE "loan_status" AS ENUM ('PENDING', 'ACTIVE', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "advance_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID', 'DEDUCTED');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('LEAVE_REQUEST', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'PAYROLL_READY', 'PAYROLL_ERROR', 'PAYROLL_WARNING', 'ATTENDANCE_ALERT', 'DOCUMENT_UPLOADED', 'SYSTEM_ALERT', 'CONTRACT_EXPIRY', 'CONTRACT_RUPTURE', 'CNSS_DEADLINE', 'CNSS_LATE', 'UNPAID_SALARY', 'SALARY_LATE', 'CHECKOUT_REMINDER', 'CHECKIN_REMINDER', 'OVERTIME_REQUEST', 'OVERTIME_APPROVED', 'OVERTIME_REJECTED', 'AUTO_CLOSED_NOTICE', 'ATTENDANCE_CORRECTION');

-- CreateEnum
CREATE TYPE "asset_status" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "subscription_plan" AS ENUM ('FREE', 'BASIC', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIALING', 'PAUSED');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "bonus_calculation_type" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "bonus_base" AS ENUM ('BASE_SALARY', 'GROSS_SALARY');

-- CreateEnum
CREATE TYPE "bonus_frequency" AS ENUM ('MONTHLY', 'ANNUAL', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "bonus_category" AS ENUM ('FRAIS', 'POSTE', 'PERFORMANCE', 'EXCEPTIONNELLE');

-- CreateEnum
CREATE TYPE "collective_agreement_rule_type" AS ENUM ('MINIMUM_SALARY', 'AUTOMATIC_BONUS', 'ADDITIONAL_LEAVE', 'OVERTIME_RATE');

-- CreateEnum
CREATE TYPE "company_tax_base" AS ENUM ('GROSS', 'TAXABLE', 'NET_IMPOSABLE', 'FIXED');

-- CreateEnum
CREATE TYPE "CabinetRole" AS ENUM ('CABINET_ADMIN', 'GESTIONNAIRE');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('TRIAL_CREDIT', 'PACK_PURCHASE', 'FORFAIT_ACTIVATION', 'BULLETIN_DEBIT', 'BULLETIN_REFUND', 'MANUAL_CREDIT', 'FORFAIT_RESET');

-- CreateEnum
CREATE TYPE "BatchClosureStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "BatchItemStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "cabinet_plan" AS ENUM ('STARTER', 'PRO', 'EXPERT');

-- CreateEnum
CREATE TYPE "cabinet_sub_status" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'PAUSED');

-- CreateEnum
CREATE TYPE "cnss_declaration_status" AS ENUM ('A_DECLARER', 'DECLAREE', 'PAYEE', 'EN_RETARD', 'REGULARISEE');

-- CreateEnum
CREATE TYPE "contract_status" AS ENUM ('ACTIVE', 'EXPIRED', 'TERMINATED', 'TRIAL', 'TRIAL_FAILED', 'CONVERTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "rupture_type" AS ENUM ('DEMISSION', 'LICENCIEMENT_FAUTE_SIMPLE', 'LICENCIEMENT_FAUTE_GRAVE', 'LICENCIEMENT_FAUTE_LOURDE', 'LICENCIEMENT_ECONOMIQUE', 'RUPTURE_CONVENTIONNELLE', 'FIN_CDD', 'FIN_PERIODE_ESSAI', 'RETRAITE', 'DECES', 'FORCE_MAJEURE', 'INVALIDITE');

-- CreateEnum
CREATE TYPE "rupture_status" AS ENUM ('EN_COURS', 'CALCULE', 'VALIDE', 'PAYE', 'CONTESTE', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "unpaid_status" AS ENUM ('EN_ATTENTE', 'PAIEMENT_PARTIEL', 'PAYE', 'EN_LITIGE');

-- CreateEnum
CREATE TYPE "affiliate_commission_status" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'EMPLOYEE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" VARCHAR(255),
    "twoFactorBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastLoginAt" TIMESTAMPTZ,
    "lastLoginIp" INET,
    "passwordChangedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "firstLoginAt" TIMESTAMPTZ,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ,
    "companyId" UUID,
    "employeeId" UUID,
    "pushToken" TEXT,
    "pushNotifEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legalName" VARCHAR(255) NOT NULL,
    "tradeName" VARCHAR(255),
    "rccmNumber" VARCHAR(50) NOT NULL,
    "cnssNumber" VARCHAR(50),
    "cnssAffiliationNumber" VARCHAR(50),
    "cnssRegisteredAt" DATE,
    "taxNumber" VARCHAR(50),
    "address" TEXT NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "country" CHAR(2) NOT NULL DEFAULT 'CG',
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "website" VARCHAR(255),
    "logo" TEXT,
    "slug" VARCHAR(255),
    "primaryColor" CHAR(7) NOT NULL DEFAULT '#0EA5E9',
    "secondaryColor" CHAR(7) NOT NULL DEFAULT '#10B981',
    "bankName" VARCHAR(100),
    "bankAccount" VARCHAR(50),
    "bankRib" VARCHAR(30),
    "industry" VARCHAR(100),
    "foundedDate" DATE,
    "fiscalYearStart" SMALLINT NOT NULL DEFAULT 1,
    "workDaysPerMonth" SMALLINT NOT NULL DEFAULT 26,
    "workHoursPerDay" DECIMAL(4,2) NOT NULL DEFAULT 8.0,
    "payrollCloseDay" SMALLINT NOT NULL DEFAULT 25,
    "payrollPaymentDay" SMALLINT NOT NULL DEFAULT 10,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "allowedRadius" SMALLINT DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "managedByCabinet" BOOLEAN NOT NULL DEFAULT false,
    "cabinetId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "appliesCnssEmployer" BOOLEAN NOT NULL DEFAULT true,
    "cnssEmployerRate" DECIMAL(5,2) NOT NULL DEFAULT 20.28,
    "defaultAppliesIrpp" BOOLEAN NOT NULL DEFAULT true,
    "defaultAppliesCnss" BOOLEAN NOT NULL DEFAULT true,
    "isSubjectToTus" BOOLEAN NOT NULL DEFAULT true,
    "careerPageBanner" TEXT,
    "careerPageLogo" TEXT,
    "careerPageColors" JSONB,
    "careerPageAbout" TEXT,
    "careerPageValues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "careerPagePhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "careerPageCustomCss" TEXT,
    "collectiveAgreement" VARCHAR(100),
    "affiliatedBy" UUID,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_working_days" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "dayOfWeek" SMALLINT NOT NULL,
    "description" VARCHAR(255),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "non_working_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(20),
    "description" TEXT,
    "color" CHAR(7) NOT NULL DEFAULT '#0EA5E9',
    "managerId" UUID,
    "companyId" UUID NOT NULL,
    "training_budget" DECIMAL(15,2),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeNumber" VARCHAR(50) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "placeOfBirth" VARCHAR(100) NOT NULL,
    "gender" "gender" NOT NULL,
    "maritalStatus" "marital_status" NOT NULL DEFAULT 'SINGLE',
    "numberOfChildren" SMALLINT NOT NULL DEFAULT 0,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "address" TEXT NOT NULL,
    "city" VARCHAR(100) NOT NULL DEFAULT 'Brazzaville',
    "tolZone" "tol_zone" NOT NULL DEFAULT 'VILLE',
    "photoUrl" TEXT,
    "nationalIdNumber" VARCHAR(50),
    "cnssNumber" VARCHAR(50),
    "taxNumber" VARCHAR(50),
    "niu" TEXT,
    "hireDate" DATE NOT NULL,
    "contractType" "contract_type" NOT NULL,
    "contractEndDate" DATE,
    "position" VARCHAR(100) NOT NULL,
    "departmentId" UUID NOT NULL,
    "baseSalary" DECIMAL(15,2) NOT NULL,
    "bankName" VARCHAR(100),
    "bankAccountNumber" VARCHAR(50),
    "paymentMethod" "payment_method" NOT NULL DEFAULT 'BANK_TRANSFER',
    "mobileMoneyNumber" VARCHAR(20),
    "mobileMoneyOperator" VARCHAR(50),
    "status" "employee_status" NOT NULL DEFAULT 'ACTIVE',
    "terminationDate" DATE,
    "terminationReason" TEXT,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "isSubjectToIrpp" BOOLEAN NOT NULL DEFAULT true,
    "isSubjectToCnss" BOOLEAN NOT NULL DEFAULT true,
    "isSubjectToTus" BOOLEAN NOT NULL DEFAULT true,
    "taxExemptionReason" TEXT,
    "professionalCategory" VARCHAR(10),
    "echelon" VARCHAR(10),
    "trialPeriodDays" SMALLINT,
    "trialEndDate" DATE,
    "trialConfirmedAt" TIMESTAMPTZ,
    "trialStatus" "TrialStatus" NOT NULL DEFAULT 'NONE',
    "isResident" BOOLEAN NOT NULL DEFAULT true,
    "nationality" VARCHAR(50),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payrolls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "paymentDate" DATE,
    "workDays" SMALLINT NOT NULL,
    "workedDays" DECIMAL(5,2) NOT NULL,
    "absenceDays" DECIMAL(5,2) NOT NULL,
    "daysOnLeave" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "daysRemote" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "daysHoliday" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "normalHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtimeHours10" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtimeHours25" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtimeHours50" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtimeHours100" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtimeAmount10" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "overtimeAmount25" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "overtimeAmount50" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "overtimeAmount100" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalOvertimeAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "baseSalary" DECIMAL(15,2) NOT NULL,
    "adjustedBaseSalary" DECIMAL(15,2),
    "absenceDeduction" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalBonuses" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "grossSalary" DECIMAL(15,2) NOT NULL,
    "netSalary" DECIMAL(15,2) NOT NULL,
    "totalDeductions" DECIMAL(15,2) NOT NULL,
    "totalEmployerCost" DECIMAL(15,2) NOT NULL,
    "cnssSalarial" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cnssEmployer" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "its" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cnssEmployerPension" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cnssEmployerFamily" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cnssEmployerAccident" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tusDgiAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tusCnssAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tusTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "employeeCustomTaxTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "employerCustomTaxTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "irppAbattement" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "irppFiscalParts" DECIMAL(3,1) NOT NULL DEFAULT 1,
    "irppEffectiveRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "status" "payroll_status" NOT NULL DEFAULT 'DRAFT',
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "validatedBy" UUID,
    "validatedAt" TIMESTAMPTZ,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMPTZ,
    "paymentReference" VARCHAR(100),
    "notes" TEXT,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,

    CONSTRAINT "payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payrollId" UUID NOT NULL,
    "code" VARCHAR(50),
    "label" VARCHAR(255) NOT NULL,
    "type" "payroll_item_type" NOT NULL,
    "base" DECIMAL(15,2),
    "rate" DECIMAL(5,4),
    "amount" DECIMAL(15,2) NOT NULL,
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "isCnss" BOOLEAN NOT NULL DEFAULT true,
    "order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cnssSalarialRate" DECIMAL(5,2) NOT NULL DEFAULT 4,
    "cnssEmployerRate" DECIMAL(5,2) NOT NULL DEFAULT 20.28,
    "cnssPensionCeiling" DECIMAL(15,2) NOT NULL DEFAULT 1200000,
    "cnssSocialCeiling" DECIMAL(15,2) NOT NULL DEFAULT 600000,
    "taxBrackets" JSONB,
    "fiscalMode" TEXT NOT NULL DEFAULT 'AUTO',
    "forfaitItsRate" DOUBLE PRECISION NOT NULL DEFAULT 0.08,
    "overtimeRate10" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "overtimeRate25" DECIMAL(5,2) NOT NULL DEFAULT 25,
    "overtimeRate50" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "overtimeRate100" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "apprenticeshipTax" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "fonerTax" DECIMAL(15,2) NOT NULL DEFAULT 2000,
    "workDaysPerMonth" SMALLINT NOT NULL DEFAULT 26,
    "workHoursPerDay" DECIMAL(4,2) NOT NULL DEFAULT 8,
    "officialStartHour" SMALLINT DEFAULT 8,
    "lateToleranceMinutes" SMALLINT DEFAULT 60,
    "workDays" JSONB NOT NULL DEFAULT '[1,2,3,4,5]',
    "overtimeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "nightShiftEnabled" BOOLEAN NOT NULL DEFAULT false,
    "officialEndHour" SMALLINT NOT NULL DEFAULT 17,
    "nightShiftStartHour" SMALLINT NOT NULL DEFAULT 20,
    "nightShiftEndHour" SMALLINT NOT NULL DEFAULT 5,
    "nightShiftPremiumRate" DECIMAL(5,2) NOT NULL DEFAULT 25,
    "checkoutReminderDelay" SMALLINT NOT NULL DEFAULT 15,
    "autoCloseHour" SMALLINT NOT NULL DEFAULT 23,
    "cnssRounding" VARCHAR(10) NOT NULL DEFAULT 'UP',
    "itsRounding" VARCHAR(10) NOT NULL DEFAULT 'UP',
    "effectiveDate" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payroll_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaves" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "type" "leave_type" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "daysCount" DECIMAL(5,2) NOT NULL,
    "reason" TEXT,
    "attachmentUrl" TEXT,
    "status" "leave_status" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMPTZ,
    "rejectedBy" UUID,
    "rejectedAt" TIMESTAMPTZ,
    "rejectionReason" TEXT,
    "cancelledAt" TIMESTAMPTZ,
    "cancellationReason" TEXT,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "year" SMALLINT NOT NULL,
    "annualEntitled" DECIMAL(5,2) NOT NULL,
    "annualTaken" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "annualRemaining" DECIMAL(5,2) NOT NULL,
    "seniorityDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "carriedForward" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "carriedForwardExpiry" DATE,
    "lastCalculated" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "status" "attendance_status" NOT NULL DEFAULT 'UNKNOWN',
    "checkIn" TIMESTAMPTZ,
    "checkOut" TIMESTAMPTZ,
    "checkInLat" DECIMAL(10,8),
    "checkInLon" DECIMAL(11,8),
    "checkOutLat" DECIMAL(10,8),
    "checkOutLon" DECIMAL(11,8),
    "totalHours" DECIMAL(6,2),
    "normalHours" DECIMAL(6,2),
    "overtime10" DECIMAL(6,2),
    "overtime25" DECIMAL(6,2),
    "overtime50" DECIMAL(6,2),
    "overtime100" DECIMAL(6,2),
    "isNightShift" BOOLEAN NOT NULL DEFAULT false,
    "pendingOvertimeHours" DECIMAL(6,2),
    "overtimeStatus" "overtime_status" NOT NULL DEFAULT 'NONE',
    "overtimeRequestedAt" TIMESTAMPTZ,
    "overtimeApprovedBy" UUID,
    "overtimeApprovedAt" TIMESTAMPTZ,
    "overtimeRejectedAt" TIMESTAMPTZ,
    "overtimeRejectedReason" TEXT,
    "autoClosedAt" TIMESTAMPTZ,
    "closureReason" "closure_reason",
    "checkoutReminderSentAt" TIMESTAMPTZ,
    "leaveId" UUID,
    "absenceReason" TEXT,
    "notes" TEXT,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendanceId" UUID NOT NULL,
    "modifiedBy" UUID NOT NULL,
    "modifiedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "field" VARCHAR(50) NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT NOT NULL,
    "ipAddress" INET,
    "userAgent" TEXT,

    CONSTRAINT "attendance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "daysPresent" SMALLINT NOT NULL DEFAULT 0,
    "daysRemote" SMALLINT NOT NULL DEFAULT 0,
    "daysOnLeave" SMALLINT NOT NULL DEFAULT 0,
    "daysAbsentPaid" SMALLINT NOT NULL DEFAULT 0,
    "daysAbsentUnpaid" SMALLINT NOT NULL DEFAULT 0,
    "daysHoliday" SMALLINT NOT NULL DEFAULT 0,
    "daysOffDay" SMALLINT NOT NULL DEFAULT 0,
    "daysLate" SMALLINT NOT NULL DEFAULT 0,
    "daysToPay" SMALLINT NOT NULL DEFAULT 0,
    "daysToDeduct" SMALLINT NOT NULL DEFAULT 0,
    "normalHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtime10Hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtime25Hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtime50Hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtime100Hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendanceId" UUID NOT NULL,
    "modifiedBy" UUID,
    "modifiedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correctionType" "correction_type" NOT NULL,
    "oldStatus" "attendance_status",
    "newStatus" "attendance_status",
    "oldCheckIn" TIMESTAMPTZ,
    "newCheckIn" TIMESTAMPTZ,
    "oldCheckOut" TIMESTAMPTZ,
    "newCheckOut" TIMESTAMPTZ,
    "reason" TEXT NOT NULL,
    "status" "correction_status" NOT NULL DEFAULT 'PENDING',
    "approvedBy" UUID,
    "approvedAt" TIMESTAMPTZ,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_holidays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "year" SMALLINT NOT NULL,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "requirements" TEXT,
    "imageUrl" TEXT,
    "additionalDocumentType" VARCHAR(50),
    "additionalDocumentLabel" VARCHAR(200),
    "departmentId" UUID NOT NULL,
    "location" VARCHAR(100) NOT NULL DEFAULT 'Brazzaville',
    "type" "contract_type" NOT NULL,
    "status" "job_offer_status" NOT NULL DEFAULT 'DRAFT',
    "processingMode" "processing_mode" NOT NULL DEFAULT 'MANUAL',
    "aiConfig" JSONB,
    "questionsGeneratedByAI" BOOLEAN NOT NULL DEFAULT false,
    "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minExperience" SMALLINT,
    "educationLevel" VARCHAR(100),
    "salaryMin" DECIMAL(15,2),
    "salaryMax" DECIMAL(15,2),
    "salaryCurrency" CHAR(3) NOT NULL DEFAULT 'XAF',
    "companyId" UUID NOT NULL,
    "showOnPortal" BOOLEAN NOT NULL DEFAULT false,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "premiumExpiresAt" TIMESTAMPTZ,
    "premiumPaidAmount" DECIMAL(10,2),
    "startDate" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expirationDate" TIMESTAMPTZ,
    "isExpired" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMPTZ,
    "closedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_offer_views" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobOfferId" UUID NOT NULL,
    "ipAddress" INET,
    "userAgent" TEXT,
    "source" VARCHAR(50),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_offer_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_offer_test_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobOfferId" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "questionType" "question_type" NOT NULL DEFAULT 'MULTIPLE_CHOICE',
    "points" SMALLINT NOT NULL,
    "order" SMALLINT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "correctAnswers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_offer_test_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "resumeUrl" TEXT,
    "additionalDocUrl" TEXT,
    "coverLetter" TEXT,
    "jobOfferId" UUID NOT NULL,
    "cvScore" SMALLINT DEFAULT 0,
    "cvAnalysis" JSONB,
    "cvAnalyzedAt" TIMESTAMPTZ,
    "testScore" SMALLINT DEFAULT 0,
    "testStartedAt" TIMESTAMPTZ,
    "testCompletedAt" TIMESTAMPTZ,
    "testDuration" INTEGER,
    "totalScore" SMALLINT DEFAULT 0,
    "aiSuggestion" "ai_suggestion",
    "aiReasoning" TEXT,
    "aiAnalyzedAt" TIMESTAMPTZ,
    "hrDecision" "ai_suggestion",
    "hrNotes" TEXT,
    "hrDecidedBy" UUID,
    "hrDecidedAt" TIMESTAMPTZ,
    "tabSwitchCount" SMALLINT NOT NULL DEFAULT 0,
    "suspiciousActivity" BOOLEAN NOT NULL DEFAULT false,
    "autoDisqualified" BOOLEAN NOT NULL DEFAULT false,
    "autoDisqualifiedAt" TIMESTAMPTZ,
    "interviewDate" TIMESTAMPTZ,
    "interviewNotes" TEXT,
    "interviewScheduledBy" UUID,
    "interviewScheduledAt" TIMESTAMPTZ,
    "canRetake" BOOLEAN NOT NULL DEFAULT false,
    "retakeReason" TEXT,
    "retakeGrantedBy" UUID,
    "retakeGrantedAt" TIMESTAMPTZ,
    "status" "candidate_status" NOT NULL DEFAULT 'APPLIED',
    "rating" SMALLINT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_test_answers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidateId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "selectedOption" TEXT,
    "selectedOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isCorrect" BOOLEAN,
    "pointsEarned" SMALLINT NOT NULL DEFAULT 0,
    "answeredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timeSpentSeconds" INTEGER,

    CONSTRAINT "candidate_test_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_seekers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20),
    "resumeUrl" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "desiredPositions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "desiredLocations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "desiredContractTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastAlertSent" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_seekers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "employeeId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "progress" SMALLINT NOT NULL DEFAULT 0,
    "status" "goal_status" NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "goalId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "targetValue" DECIMAL(15,2) NOT NULL,
    "currentValue" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "unit" VARCHAR(50),

    CONSTRAINT "key_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "period" VARCHAR(50) NOT NULL,
    "date" DATE NOT NULL,
    "rating" DECIMAL(3,2),
    "feedback" TEXT,
    "status" "review_status" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "performance_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_courses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(100),
    "duration" VARCHAR(50),
    "durationHours" SMALLINT,
    "cost" DECIMAL(15,2),
    "provider" VARCHAR(100),
    "format" "training_format" NOT NULL DEFAULT 'ONLINE',
    "providerType" "provider_type" NOT NULL DEFAULT 'INTERNAL',
    "providerName" VARCHAR(100),
    "linkUrl" TEXT,
    "location" VARCHAR(255),
    "dateSchedule" TIMESTAMPTZ,
    "thumbnailUrl" TEXT,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "training_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_trainings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "status" "training_status" NOT NULL DEFAULT 'PLANNED',
    "certificateUrl" TEXT,
    "certificate_ref" VARCHAR(60),
    "reason" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ,
    "reviewNote" TEXT,
    "completion_requested_at" TIMESTAMPTZ,
    "mention" VARCHAR(20),
    "validation_note" VARCHAR(255),
    "validated_by_id" UUID,
    "validated_at" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employee_trainings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_processes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "type" "onboarding_type" NOT NULL DEFAULT 'ONBOARDING',
    "startDate" DATE NOT NULL,
    "status" "onboarding_status" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "onboarding_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "processId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMPTZ,
    "assigneeRole" VARCHAR(50),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "document_type" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" VARCHAR(100),
    "employeeId" UUID,
    "payrollId" UUID,
    "companyId" UUID NOT NULL,
    "uploadedBy" UUID,
    "uploadedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "monthlyRepayment" DECIMAL(15,2) NOT NULL,
    "remainingBalance" DECIMAL(15,2) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "loan_status" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMPTZ,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "deductMonth" SMALLINT NOT NULL,
    "deductYear" SMALLINT NOT NULL,
    "status" "advance_status" NOT NULL DEFAULT 'PENDING',
    "deducted" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMPTZ,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMPTZ,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entity" VARCHAR(50) NOT NULL,
    "entityId" UUID,
    "description" TEXT NOT NULL,
    "changes" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "jti" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_errors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "errorCode" VARCHAR(100) NOT NULL,
    "statusCode" SMALLINT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "method" VARCHAR(10) NOT NULL,
    "path" TEXT NOT NULL,
    "body" JSONB,
    "query" JSONB,
    "userId" UUID,
    "companyId" UUID,
    "ip" TEXT,
    "severity" VARCHAR(20) NOT NULL DEFAULT 'ERROR',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMPTZ,
    "resolvedBy" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "role" "user_role" NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "invitedBy" UUID NOT NULL,
    "companyId" UUID,
    "cabinetId" UUID,
    "cabinetName" VARCHAR(255),
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "acceptedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "serialNumber" VARCHAR(100),
    "purchaseDate" DATE NOT NULL,
    "purchasePrice" DECIMAL(15,2) NOT NULL,
    "currentValue" DECIMAL(15,2),
    "assignedTo" UUID,
    "status" "asset_status" NOT NULL DEFAULT 'AVAILABLE',
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_mapping_patterns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "columnsSignature" TEXT NOT NULL,
    "mappingData" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_mapping_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "plan" "subscription_plan" NOT NULL DEFAULT 'FREE',
    "status" "subscription_status" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodStart" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMPTZ NOT NULL,
    "canceledAt" TIMESTAMPTZ,
    "trialEndsAt" TIMESTAMPTZ,
    "pricePerMonth" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'XAF',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscriptionId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "yabetooIntentId" VARCHAR(100) NOT NULL,
    "yabetooChargeId" VARCHAR(100),
    "yabetooTransactionId" VARCHAR(100),
    "yabetooFinancialTxId" VARCHAR(100),
    "clientSecret" VARCHAR(255),
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XAF',
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" VARCHAR(50),
    "paymentMethodDetails" JSONB,
    "description" VARCHAR(500),
    "metadata" JSONB,
    "paidAt" TIMESTAMPTZ,
    "failedAt" TIMESTAMPTZ,
    "refundedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_bonuses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "bonusType" VARCHAR(100) NOT NULL,
    "calculationType" "bonus_calculation_type" NOT NULL DEFAULT 'FIXED_AMOUNT',
    "fixedAmount" DECIMAL(15,2),
    "percentage" DECIMAL(5,2),
    "baseCalculation" "bonus_base" DEFAULT 'BASE_SALARY',
    "frequency" "bonus_frequency" NOT NULL DEFAULT 'MONTHLY',
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "ruleId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "isCnss" BOOLEAN NOT NULL DEFAULT true,
    "isProratized" BOOLEAN NOT NULL DEFAULT false,
    "isInLeaveBase" BOOLEAN NOT NULL DEFAULT true,
    "bonusCategory" "bonus_category" NOT NULL DEFAULT 'PERFORMANCE',
    "bonusTemplateId" UUID,

    CONSTRAINT "employee_bonuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collective_agreement_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "agreementCode" VARCHAR(50) NOT NULL,
    "ruleType" "collective_agreement_rule_type" NOT NULL,
    "professionalCategory" VARCHAR(10),
    "minimumSalary" DECIMAL(15,2),
    "bonusType" VARCHAR(100),
    "minMonthsOfService" SMALLINT,
    "maxMonthsOfService" SMALLINT,
    "bonusPercentage" DECIMAL(5,2),
    "bonusFixedAmount" DECIMAL(15,2),
    "bonusBaseCalculation" "bonus_base" DEFAULT 'BASE_SALARY',
    "additionalLeaveDays" SMALLINT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "collective_agreement_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predefined_conventions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "country" CHAR(2) NOT NULL DEFAULT 'CG',
    "pdfUrl" TEXT,
    "effectiveDate" DATE NOT NULL,
    "lastUpdated" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categories" JSONB NOT NULL,
    "defaultRules" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "predefined_conventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusTemplate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "defaultAmount" DECIMAL(15,2),
    "defaultPercentage" DECIMAL(5,2),
    "baseCalculation" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT true,
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "isCnss" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isProratized" BOOLEAN NOT NULL DEFAULT false,
    "isInLeaveBase" BOOLEAN NOT NULL DEFAULT true,
    "bonusCategory" "bonus_category" NOT NULL DEFAULT 'PERFORMANCE',

    CONSTRAINT "BonusTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_taxes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "description" TEXT,
    "employeeRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "fixedEmployee" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "employerRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "fixedEmployer" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "baseType" "company_tax_base" NOT NULL DEFAULT 'GROSS',
    "hasCeiling" BOOLEAN NOT NULL DEFAULT false,
    "ceiling" DECIMAL(15,2),
    "minSalaryThreshold" DECIMAL(15,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "company_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cabinets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "subdomain" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "logo" TEXT,
    "primaryColor" VARCHAR(7) DEFAULT '#6366f1',
    "secondaryColor" VARCHAR(7) DEFAULT '#8b5cf6',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "affiliatedBy" UUID,

    CONSTRAINT "cabinets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cabinet_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cabinetId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "CabinetRole" NOT NULL DEFAULT 'GESTIONNAIRE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cabinet_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cabinet_companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cabinetId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "pmePortalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "employeeAccessEnabled" BOOLEAN NOT NULL DEFAULT false,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cabinet_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cabinet_wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cabinetId" UUID NOT NULL,
    "bulletinsBalance" INTEGER NOT NULL DEFAULT 0,
    "isForfait" BOOLEAN NOT NULL DEFAULT false,
    "forfaitExpiresAt" TIMESTAMPTZ,
    "trialActive" BOOLEAN NOT NULL DEFAULT true,
    "trialExpiresAt" TIMESTAMPTZ,
    "bulletinsUsedThisMonth" INTEGER NOT NULL DEFAULT 0,
    "lastResetAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cabinet_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cabinet_wallet_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "walletId" UUID NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "companyId" UUID,
    "payrollId" UUID,
    "reference" VARCHAR(100),
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cabinet_wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cabinet_import_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cabinetId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "mapping" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cabinet_import_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cabinet_batch_closures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cabinetId" UUID NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "status" "BatchClosureStatus" NOT NULL DEFAULT 'PENDING',
    "totalCompanies" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cabinet_batch_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cabinet_batch_closure_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batchId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "status" "BatchItemStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "bulletinsGenerated" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMPTZ,

    CONSTRAINT "cabinet_batch_closure_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cabinet_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cabinetId" UUID NOT NULL,
    "plan" "cabinet_plan" NOT NULL DEFAULT 'STARTER',
    "status" "cabinet_sub_status" NOT NULL DEFAULT 'TRIALING',
    "maxCompanies" INTEGER NOT NULL DEFAULT 5,
    "maxEmployees" INTEGER NOT NULL DEFAULT 100,
    "currentCompanies" INTEGER NOT NULL DEFAULT 0,
    "currentEmployees" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodStart" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMPTZ NOT NULL,
    "trialEndsAt" TIMESTAMPTZ,
    "canceledAt" TIMESTAMPTZ,
    "pricePerMonth" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'XAF',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cabinet_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cabinet_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscriptionId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XAF',
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "reference" VARCHAR(100),
    "yabetopayIntentId" VARCHAR(100),
    "yabetopayOperator" VARCHAR(20),
    "yabetopayPhone" VARCHAR(20),
    "plan" VARCHAR(20),
    "billingPeriod" VARCHAR(20),
    "months" INTEGER,
    "paidAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cabinet_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cnss_declarations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "effectif" SMALLINT NOT NULL,
    "masseSalariale" DECIMAL(15,2) NOT NULL,
    "cotisationSalariale" DECIMAL(15,2) NOT NULL,
    "cotisationPatronale" DECIMAL(15,2) NOT NULL,
    "cotisationTotale" DECIMAL(15,2) NOT NULL,
    "tusCnss" DECIMAL(15,2) NOT NULL,
    "tusDgi" DECIMAL(15,2) NOT NULL,
    "totalAVerserCnss" DECIMAL(15,2) NOT NULL,
    "totalAVerserDgi" DECIMAL(15,2) NOT NULL,
    "status" "cnss_declaration_status" NOT NULL DEFAULT 'A_DECLARER',
    "declaredAt" TIMESTAMPTZ,
    "paidAt" TIMESTAMPTZ,
    "paymentReference" VARCHAR(100),
    "paymentMode" VARCHAR(50),
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "monthsLate" SMALLINT NOT NULL DEFAULT 0,
    "penaltyAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "lastExportedAt" TIMESTAMPTZ,
    "exportedByUser" UUID,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "declaredBy" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cnss_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cnss_declaration_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "declarationId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "employeeNumber" VARCHAR(50) NOT NULL,
    "employeeName" VARCHAR(200) NOT NULL,
    "cnssNumber" VARCHAR(50),
    "contractType" "contract_type" NOT NULL,
    "brutMensuel" DECIMAL(15,2) NOT NULL,
    "pensionSalarial" DECIMAL(15,2) NOT NULL,
    "pensionPatronal" DECIMAL(15,2) NOT NULL,
    "familyPatronal" DECIMAL(15,2) NOT NULL,
    "accidentPatronal" DECIMAL(15,2) NOT NULL,
    "totalCnss" DECIMAL(15,2) NOT NULL,
    "tusCnss" DECIMAL(15,2) NOT NULL,
    "tusDgi" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "cnss_declaration_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contractType" "contract_type" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "duration" SMALLINT,
    "isRenewable" BOOLEAN NOT NULL DEFAULT false,
    "renewalCount" SMALLINT NOT NULL DEFAULT 0,
    "position" VARCHAR(100) NOT NULL,
    "baseSalary" DECIMAL(15,2) NOT NULL,
    "departmentId" UUID NOT NULL,
    "trialPeriodDays" SMALLINT,
    "trialEndDate" DATE,
    "trialConfirmedAt" TIMESTAMPTZ,
    "serviceDescription" TEXT,
    "dailyRate" DECIMAL(15,2),
    "invoicingMode" VARCHAR(50),
    "interimAgency" VARCHAR(100),
    "interimAgencyRef" VARCHAR(50),
    "status" "contract_status" NOT NULL DEFAULT 'ACTIVE',
    "documentUrl" TEXT,
    "signedAt" TIMESTAMPTZ,
    "signedByEmp" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employee_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_ruptures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contractId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "ruptureType" "rupture_type" NOT NULL,
    "ruptureDate" DATE NOT NULL,
    "noticeGiven" DATE,
    "causeCode" VARCHAR(50),
    "causeLabel" VARCHAR(255),
    "causeDetail" TEXT,
    "noticePeriodDays" SMALLINT,
    "noticeWorked" BOOLEAN NOT NULL DEFAULT true,
    "noticeWaived" BOOLEAN NOT NULL DEFAULT false,
    "yearsOfService" DECIMAL(5,2) NOT NULL,
    "monthsOfService" SMALLINT NOT NULL,
    "lastMonthlyGross" DECIMAL(15,2) NOT NULL,
    "avgLast3MonthsGross" DECIMAL(15,2),
    "conventionCode" VARCHAR(50),
    "avgLast12MonthsGross" DECIMAL(15,2),
    "categorieConventionnelle" SMALLINT,
    "indemLicenciementDetail" TEXT,
    "indemGratification" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "brutImposable" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "indemnitesExonerees" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "alertes" JSONB NOT NULL DEFAULT '[]',
    "indemLicenciement" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "indemLicenciementBase" VARCHAR(100),
    "indemPreavis" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "indemPreavisDays" SMALLINT NOT NULL DEFAULT 0,
    "indemConges" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "indemCongesDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "dernierSalaireProrata" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "dernierSalaireDays" SMALLINT NOT NULL DEFAULT 0,
    "autresSommesDues" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "autresSommesDetail" TEXT,
    "totalBrut" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cnssApplicable" BOOLEAN NOT NULL DEFAULT false,
    "itsApplicable" BOOLEAN NOT NULL DEFAULT false,
    "lettreNotificationUrl" TEXT,
    "conventionRuptureUrl" TEXT,
    "recuSoldeUrl" TEXT,
    "cnssAttestationUrl" TEXT,
    "cnssNotifiedAt" TIMESTAMP(3),
    "status" "rupture_status" NOT NULL DEFAULT 'EN_COURS',
    "paidAt" TIMESTAMPTZ,
    "paymentRef" VARCHAR(100),
    "processedBy" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contract_ruptures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pse_procedures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OUVERT',
    "motif" TEXT NOT NULL,
    "nbPostesSupprimes" SMALLINT NOT NULL,
    "notes" TEXT,
    "etapes" JSONB NOT NULL DEFAULT '[]',
    "dateOuverture" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateNotificationInspection" TIMESTAMPTZ,
    "dateReunionDP" TIMESTAMPTZ,
    "dateCloture" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pse_procedures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pse_salaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pseId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "statut" VARCHAR(20) NOT NULL DEFAULT 'PREVU',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pse_salaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unpaid_salary_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "totalNetDu" DECIMAL(15,2) NOT NULL,
    "employeeCount" SMALLINT NOT NULL,
    "status" "unpaid_status" NOT NULL DEFAULT 'EN_ATTENTE',
    "daysOverdue" SMALLINT NOT NULL DEFAULT 0,
    "alertSentAt" TIMESTAMPTZ,
    "alertLevel" SMALLINT NOT NULL DEFAULT 1,
    "partiallyPaidAt" TIMESTAMPTZ,
    "partialAmount" DECIMAL(15,2),
    "fullyPaidAt" TIMESTAMPTZ,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "unpaid_salary_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "startHour" SMALLINT NOT NULL,
    "startMinute" SMALLINT NOT NULL DEFAULT 0,
    "endHour" SMALLINT NOT NULL,
    "endMinute" SMALLINT NOT NULL DEFAULT 0,
    "durationHours" DECIMAL(4,2) NOT NULL,
    "crossesMidnight" BOOLEAN NOT NULL DEFAULT false,
    "isNightShift" BOOLEAN NOT NULL DEFAULT false,
    "nightPremiumRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "color" CHAR(7) NOT NULL DEFAULT '#0EA5E9',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "work_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_shift_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "specificDate" VARCHAR(10),
    "dayOfWeek" SMALLINT,
    "validFrom" DATE,
    "validUntil" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employee_shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_sites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "latitude" DECIMAL(10,8) NOT NULL,
    "longitude" DECIMAL(11,8) NOT NULL,
    "radius" SMALLINT NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "company_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "referralCode" VARCHAR(50) NOT NULL,
    "phone" VARCHAR(20),
    "disbursementPhone" VARCHAR(20),
    "commissionRate" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "affiliateId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "linkedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_commissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "affiliateId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "paymentAmount" INTEGER NOT NULL,
    "commissionRate" DECIMAL(5,2) NOT NULL,
    "commissionAmount" INTEGER NOT NULL,
    "status" "affiliate_commission_status" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMPTZ,
    "paymentRef" VARCHAR(100),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "affiliate_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_cabinets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "affiliateId" UUID NOT NULL,
    "cabinetId" UUID NOT NULL,
    "linkedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_cabinets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_cabinet_commissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "affiliateId" UUID NOT NULL,
    "cabinetPaymentId" UUID NOT NULL,
    "cabinetId" UUID NOT NULL,
    "paymentAmount" INTEGER NOT NULL,
    "commissionRate" DECIMAL(5,2) NOT NULL,
    "commissionAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMPTZ,
    "paymentRef" VARCHAR(100),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "affiliate_cabinet_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_withdrawal_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "affiliateId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMPTZ,
    "paymentNote" TEXT,
    "rejectionReason" TEXT,
    "processedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "affiliate_withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_config" (
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "bulletin_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bulletin_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "authorId" UUID NOT NULL,
    "companyId" UUID,
    "title" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(300) NOT NULL,
    "excerpt" VARCHAR(500),
    "content" TEXT NOT NULL,
    "coverImage" TEXT,
    "category" VARCHAR(50) NOT NULL DEFAULT 'GENERAL',
    "scope" VARCHAR(20) NOT NULL DEFAULT 'COMPANY',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMPTZ,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_likes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "postId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_anonymous_likes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "postId" UUID NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_anonymous_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_monthly_quotas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "year" SMALLINT NOT NULL,
    "month" SMALLINT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "limit" INTEGER NOT NULL DEFAULT 4,

    CONSTRAINT "blog_monthly_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "company" VARCHAR(150),
    "phone" VARCHAR(30),
    "subject" VARCHAR(100) NOT NULL,
    "message" TEXT NOT NULL,
    "ip" VARCHAR(45),
    "status" VARCHAR(20) NOT NULL DEFAULT 'UNREAD',
    "readAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeId_key" ON "users"("employeeId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_companyId_idx" ON "users"("companyId");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_isActive_idx" ON "users"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "companies_rccmNumber_key" ON "companies"("rccmNumber");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE INDEX "companies_appliesCnssEmployer_idx" ON "companies"("appliesCnssEmployer");

-- CreateIndex
CREATE INDEX "companies_rccmNumber_idx" ON "companies"("rccmNumber");

-- CreateIndex
CREATE INDEX "companies_isActive_idx" ON "companies"("isActive");

-- CreateIndex
CREATE INDEX "non_working_days_companyId_idx" ON "non_working_days"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "non_working_days_companyId_dayOfWeek_key" ON "non_working_days"("companyId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "departments_companyId_idx" ON "departments"("companyId");

-- CreateIndex
CREATE INDEX "departments_managerId_idx" ON "departments"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_companyId_code_key" ON "departments"("companyId", "code");

-- CreateIndex
CREATE INDEX "employees_isSubjectToIrpp_idx" ON "employees"("isSubjectToIrpp");

-- CreateIndex
CREATE INDEX "employees_isSubjectToCnss_idx" ON "employees"("isSubjectToCnss");

-- CreateIndex
CREATE INDEX "employees_companyId_idx" ON "employees"("companyId");

-- CreateIndex
CREATE INDEX "employees_departmentId_idx" ON "employees"("departmentId");

-- CreateIndex
CREATE INDEX "employees_employeeNumber_idx" ON "employees"("employeeNumber");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employees_maritalStatus_idx" ON "employees"("maritalStatus");

-- CreateIndex
CREATE INDEX "employees_hireDate_idx" ON "employees"("hireDate");

-- CreateIndex
CREATE INDEX "employees_professionalCategory_idx" ON "employees"("professionalCategory");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employeeNumber_companyId_key" ON "employees"("employeeNumber", "companyId");

-- CreateIndex
CREATE INDEX "payrolls_companyId_status_paid_idx" ON "payrolls"("companyId", "status", "paid");

-- CreateIndex
CREATE INDEX "payrolls_companyId_paid_year_idx" ON "payrolls"("companyId", "paid", "year");

-- CreateIndex
CREATE INDEX "payrolls_companyId_status_idx" ON "payrolls"("companyId", "status");

-- CreateIndex
CREATE INDEX "payrolls_employeeId_year_month_idx" ON "payrolls"("employeeId", "year", "month");

-- CreateIndex
CREATE INDEX "payrolls_month_year_idx" ON "payrolls"("month", "year");

-- CreateIndex
CREATE INDEX "payrolls_periodEnd_idx" ON "payrolls"("periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "payrolls_employeeId_month_year_key" ON "payrolls"("employeeId", "month", "year");

-- CreateIndex
CREATE INDEX "payroll_items_payrollId_idx" ON "payroll_items"("payrollId");

-- CreateIndex
CREATE INDEX "payroll_items_type_idx" ON "payroll_items"("type");

-- CreateIndex
CREATE INDEX "payroll_settings_companyId_idx" ON "payroll_settings"("companyId");

-- CreateIndex
CREATE INDEX "payroll_settings_effectiveDate_idx" ON "payroll_settings"("effectiveDate");

-- CreateIndex
CREATE INDEX "leaves_employeeId_status_idx" ON "leaves"("employeeId", "status");

-- CreateIndex
CREATE INDEX "leaves_companyId_idx" ON "leaves"("companyId");

-- CreateIndex
CREATE INDEX "leaves_startDate_endDate_idx" ON "leaves"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "leaves_status_idx" ON "leaves"("status");

-- CreateIndex
CREATE INDEX "leave_balances_employeeId_idx" ON "leave_balances"("employeeId");

-- CreateIndex
CREATE INDEX "leave_balances_year_idx" ON "leave_balances"("year");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_employeeId_year_key" ON "leave_balances"("employeeId", "year");

-- CreateIndex
CREATE INDEX "attendances_companyId_idx" ON "attendances"("companyId");

-- CreateIndex
CREATE INDEX "attendances_date_idx" ON "attendances"("date");

-- CreateIndex
CREATE INDEX "attendances_status_idx" ON "attendances"("status");

-- CreateIndex
CREATE INDEX "attendances_employeeId_date_idx" ON "attendances"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_employeeId_date_key" ON "attendances"("employeeId", "date");

-- CreateIndex
CREATE INDEX "attendance_logs_attendanceId_idx" ON "attendance_logs"("attendanceId");

-- CreateIndex
CREATE INDEX "attendance_logs_modifiedBy_idx" ON "attendance_logs"("modifiedBy");

-- CreateIndex
CREATE INDEX "attendance_logs_modifiedAt_idx" ON "attendance_logs"("modifiedAt");

-- CreateIndex
CREATE INDEX "attendance_summaries_employeeId_idx" ON "attendance_summaries"("employeeId");

-- CreateIndex
CREATE INDEX "attendance_summaries_month_year_idx" ON "attendance_summaries"("month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_summaries_employeeId_month_year_key" ON "attendance_summaries"("employeeId", "month", "year");

-- CreateIndex
CREATE INDEX "attendance_corrections_attendanceId_idx" ON "attendance_corrections"("attendanceId");

-- CreateIndex
CREATE INDEX "attendance_corrections_modifiedBy_idx" ON "attendance_corrections"("modifiedBy");

-- CreateIndex
CREATE INDEX "attendance_corrections_modifiedAt_idx" ON "attendance_corrections"("modifiedAt");

-- CreateIndex
CREATE INDEX "attendance_corrections_status_idx" ON "attendance_corrections"("status");

-- CreateIndex
CREATE INDEX "public_holidays_companyId_year_idx" ON "public_holidays"("companyId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "public_holidays_companyId_date_key" ON "public_holidays"("companyId", "date");

-- CreateIndex
CREATE INDEX "job_offers_companyId_idx" ON "job_offers"("companyId");

-- CreateIndex
CREATE INDEX "job_offers_status_idx" ON "job_offers"("status");

-- CreateIndex
CREATE INDEX "job_offers_processingMode_idx" ON "job_offers"("processingMode");

-- CreateIndex
CREATE INDEX "job_offers_showOnPortal_idx" ON "job_offers"("showOnPortal");

-- CreateIndex
CREATE INDEX "job_offers_isPremium_idx" ON "job_offers"("isPremium");

-- CreateIndex
CREATE INDEX "job_offers_expirationDate_idx" ON "job_offers"("expirationDate");

-- CreateIndex
CREATE INDEX "job_offers_isExpired_idx" ON "job_offers"("isExpired");

-- CreateIndex
CREATE INDEX "job_offer_views_jobOfferId_idx" ON "job_offer_views"("jobOfferId");

-- CreateIndex
CREATE INDEX "job_offer_views_source_idx" ON "job_offer_views"("source");

-- CreateIndex
CREATE INDEX "job_offer_views_createdAt_idx" ON "job_offer_views"("createdAt");

-- CreateIndex
CREATE INDEX "job_offer_test_questions_jobOfferId_idx" ON "job_offer_test_questions"("jobOfferId");

-- CreateIndex
CREATE INDEX "job_offer_test_questions_order_idx" ON "job_offer_test_questions"("order");

-- CreateIndex
CREATE INDEX "candidates_jobOfferId_idx" ON "candidates"("jobOfferId");

-- CreateIndex
CREATE INDEX "candidates_status_idx" ON "candidates"("status");

-- CreateIndex
CREATE INDEX "candidates_aiSuggestion_idx" ON "candidates"("aiSuggestion");

-- CreateIndex
CREATE INDEX "candidates_hrDecision_idx" ON "candidates"("hrDecision");

-- CreateIndex
CREATE INDEX "candidates_totalScore_idx" ON "candidates"("totalScore");

-- CreateIndex
CREATE INDEX "candidates_email_idx" ON "candidates"("email");

-- CreateIndex
CREATE INDEX "candidates_createdAt_idx" ON "candidates"("createdAt");

-- CreateIndex
CREATE INDEX "candidates_autoDisqualified_idx" ON "candidates"("autoDisqualified");

-- CreateIndex
CREATE INDEX "candidates_interviewDate_idx" ON "candidates"("interviewDate");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_email_jobOfferId_key" ON "candidates"("email", "jobOfferId");

-- CreateIndex
CREATE INDEX "candidate_test_answers_candidateId_idx" ON "candidate_test_answers"("candidateId");

-- CreateIndex
CREATE INDEX "candidate_test_answers_questionId_idx" ON "candidate_test_answers"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_test_answers_candidateId_questionId_key" ON "candidate_test_answers"("candidateId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "job_seekers_email_key" ON "job_seekers"("email");

-- CreateIndex
CREATE INDEX "job_seekers_email_idx" ON "job_seekers"("email");

-- CreateIndex
CREATE INDEX "goals_employeeId_idx" ON "goals"("employeeId");

-- CreateIndex
CREATE INDEX "goals_status_idx" ON "goals"("status");

-- CreateIndex
CREATE INDEX "key_results_goalId_idx" ON "key_results"("goalId");

-- CreateIndex
CREATE INDEX "performance_reviews_employeeId_idx" ON "performance_reviews"("employeeId");

-- CreateIndex
CREATE INDEX "performance_reviews_reviewerId_idx" ON "performance_reviews"("reviewerId");

-- CreateIndex
CREATE INDEX "training_courses_companyId_idx" ON "training_courses"("companyId");

-- CreateIndex
CREATE INDEX "employee_trainings_employeeId_idx" ON "employee_trainings"("employeeId");

-- CreateIndex
CREATE INDEX "employee_trainings_courseId_idx" ON "employee_trainings"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_processes_employeeId_key" ON "onboarding_processes"("employeeId");

-- CreateIndex
CREATE INDEX "onboarding_tasks_processId_idx" ON "onboarding_tasks"("processId");

-- CreateIndex
CREATE UNIQUE INDEX "documents_payrollId_key" ON "documents"("payrollId");

-- CreateIndex
CREATE INDEX "documents_employeeId_idx" ON "documents"("employeeId");

-- CreateIndex
CREATE INDEX "documents_companyId_idx" ON "documents"("companyId");

-- CreateIndex
CREATE INDEX "documents_type_idx" ON "documents"("type");

-- CreateIndex
CREATE INDEX "loans_employeeId_idx" ON "loans"("employeeId");

-- CreateIndex
CREATE INDEX "loans_status_idx" ON "loans"("status");

-- CreateIndex
CREATE INDEX "advances_employeeId_idx" ON "advances"("employeeId");

-- CreateIndex
CREATE INDEX "advances_status_idx" ON "advances"("status");

-- CreateIndex
CREATE INDEX "advances_deductMonth_deductYear_idx" ON "advances"("deductMonth", "deductYear");

-- CreateIndex
CREATE INDEX "notifications_userId_read_idx" ON "notifications"("userId", "read");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_userId_idx" ON "activity_logs"("userId");

-- CreateIndex
CREATE INDEX "activity_logs_entity_entityId_idx" ON "activity_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "activity_logs_createdAt_idx" ON "activity_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_jti_key" ON "user_sessions"("jti");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");

-- CreateIndex
CREATE INDEX "user_sessions_jti_idx" ON "user_sessions"("jti");

-- CreateIndex
CREATE INDEX "user_sessions_expiresAt_idx" ON "user_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "app_errors_statusCode_idx" ON "app_errors"("statusCode");

-- CreateIndex
CREATE INDEX "app_errors_companyId_idx" ON "app_errors"("companyId");

-- CreateIndex
CREATE INDEX "app_errors_path_idx" ON "app_errors"("path");

-- CreateIndex
CREATE INDEX "app_errors_errorCode_idx" ON "app_errors"("errorCode");

-- CreateIndex
CREATE INDEX "app_errors_createdAt_idx" ON "app_errors"("createdAt");

-- CreateIndex
CREATE INDEX "app_errors_resolved_idx" ON "app_errors"("resolved");

-- CreateIndex
CREATE UNIQUE INDEX "user_invitations_token_key" ON "user_invitations"("token");

-- CreateIndex
CREATE INDEX "user_invitations_email_idx" ON "user_invitations"("email");

-- CreateIndex
CREATE INDEX "user_invitations_token_idx" ON "user_invitations"("token");

-- CreateIndex
CREATE INDEX "user_invitations_expiresAt_idx" ON "user_invitations"("expiresAt");

-- CreateIndex
CREATE INDEX "assets_companyId_idx" ON "assets"("companyId");

-- CreateIndex
CREATE INDEX "assets_assignedTo_idx" ON "assets"("assignedTo");

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- CreateIndex
CREATE INDEX "assets_category_idx" ON "assets"("category");

-- CreateIndex
CREATE INDEX "import_mapping_patterns_companyId_idx" ON "import_mapping_patterns"("companyId");

-- CreateIndex
CREATE INDEX "import_mapping_patterns_usageCount_idx" ON "import_mapping_patterns"("usageCount");

-- CreateIndex
CREATE UNIQUE INDEX "import_mapping_patterns_companyId_columnsSignature_key" ON "import_mapping_patterns"("companyId", "columnsSignature");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_companyId_key" ON "subscriptions"("companyId");

-- CreateIndex
CREATE INDEX "subscriptions_companyId_idx" ON "subscriptions"("companyId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscriptions_plan_idx" ON "subscriptions"("plan");

-- CreateIndex
CREATE UNIQUE INDEX "payments_yabetooIntentId_key" ON "payments"("yabetooIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_yabetooChargeId_key" ON "payments"("yabetooChargeId");

-- CreateIndex
CREATE INDEX "payments_subscriptionId_idx" ON "payments"("subscriptionId");

-- CreateIndex
CREATE INDEX "payments_companyId_idx" ON "payments"("companyId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_yabetooIntentId_idx" ON "payments"("yabetooIntentId");

-- CreateIndex
CREATE INDEX "payments_createdAt_idx" ON "payments"("createdAt");

-- CreateIndex
CREATE INDEX "employee_bonuses_employeeId_idx" ON "employee_bonuses"("employeeId");

-- CreateIndex
CREATE INDEX "employee_bonuses_isActive_idx" ON "employee_bonuses"("isActive");

-- CreateIndex
CREATE INDEX "employee_bonuses_isAutomatic_idx" ON "employee_bonuses"("isAutomatic");

-- CreateIndex
CREATE INDEX "employee_bonuses_frequency_idx" ON "employee_bonuses"("frequency");

-- CreateIndex
CREATE INDEX "collective_agreement_rules_companyId_idx" ON "collective_agreement_rules"("companyId");

-- CreateIndex
CREATE INDEX "collective_agreement_rules_agreementCode_idx" ON "collective_agreement_rules"("agreementCode");

-- CreateIndex
CREATE INDEX "collective_agreement_rules_ruleType_idx" ON "collective_agreement_rules"("ruleType");

-- CreateIndex
CREATE INDEX "collective_agreement_rules_professionalCategory_idx" ON "collective_agreement_rules"("professionalCategory");

-- CreateIndex
CREATE INDEX "collective_agreement_rules_isActive_idx" ON "collective_agreement_rules"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "predefined_conventions_code_key" ON "predefined_conventions"("code");

-- CreateIndex
CREATE INDEX "predefined_conventions_code_idx" ON "predefined_conventions"("code");

-- CreateIndex
CREATE INDEX "predefined_conventions_country_idx" ON "predefined_conventions"("country");

-- CreateIndex
CREATE INDEX "BonusTemplate_companyId_idx" ON "BonusTemplate"("companyId");

-- CreateIndex
CREATE INDEX "company_taxes_companyId_idx" ON "company_taxes"("companyId");

-- CreateIndex
CREATE INDEX "company_taxes_isActive_idx" ON "company_taxes"("isActive");

-- CreateIndex
CREATE INDEX "company_taxes_code_idx" ON "company_taxes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "cabinets_email_key" ON "cabinets"("email");

-- CreateIndex
CREATE UNIQUE INDEX "cabinets_subdomain_key" ON "cabinets"("subdomain");

-- CreateIndex
CREATE INDEX "cabinets_subdomain_idx" ON "cabinets"("subdomain");

-- CreateIndex
CREATE INDEX "cabinets_affiliatedBy_idx" ON "cabinets"("affiliatedBy");

-- CreateIndex
CREATE INDEX "cabinet_users_cabinetId_idx" ON "cabinet_users"("cabinetId");

-- CreateIndex
CREATE INDEX "cabinet_users_userId_idx" ON "cabinet_users"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cabinet_users_cabinetId_userId_key" ON "cabinet_users"("cabinetId", "userId");

-- CreateIndex
CREATE INDEX "cabinet_companies_cabinetId_idx" ON "cabinet_companies"("cabinetId");

-- CreateIndex
CREATE INDEX "cabinet_companies_companyId_idx" ON "cabinet_companies"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "cabinet_companies_cabinetId_companyId_key" ON "cabinet_companies"("cabinetId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "cabinet_wallets_cabinetId_key" ON "cabinet_wallets"("cabinetId");

-- CreateIndex
CREATE INDEX "cabinet_wallet_transactions_walletId_idx" ON "cabinet_wallet_transactions"("walletId");

-- CreateIndex
CREATE INDEX "cabinet_wallet_transactions_companyId_idx" ON "cabinet_wallet_transactions"("companyId");

-- CreateIndex
CREATE INDEX "cabinet_import_mappings_cabinetId_companyId_idx" ON "cabinet_import_mappings"("cabinetId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "cabinet_import_mappings_cabinetId_companyId_name_key" ON "cabinet_import_mappings"("cabinetId", "companyId", "name");

-- CreateIndex
CREATE INDEX "cabinet_batch_closures_cabinetId_idx" ON "cabinet_batch_closures"("cabinetId");

-- CreateIndex
CREATE INDEX "cabinet_batch_closure_items_batchId_idx" ON "cabinet_batch_closure_items"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "cabinet_subscriptions_cabinetId_key" ON "cabinet_subscriptions"("cabinetId");

-- CreateIndex
CREATE INDEX "cabinet_subscriptions_cabinetId_idx" ON "cabinet_subscriptions"("cabinetId");

-- CreateIndex
CREATE INDEX "cabinet_subscriptions_status_idx" ON "cabinet_subscriptions"("status");

-- CreateIndex
CREATE INDEX "cabinet_payments_subscriptionId_idx" ON "cabinet_payments"("subscriptionId");

-- CreateIndex
CREATE INDEX "cabinet_payments_yabetopayIntentId_idx" ON "cabinet_payments"("yabetopayIntentId");

-- CreateIndex
CREATE INDEX "cnss_declarations_companyId_idx" ON "cnss_declarations"("companyId");

-- CreateIndex
CREATE INDEX "cnss_declarations_month_year_idx" ON "cnss_declarations"("month", "year");

-- CreateIndex
CREATE INDEX "cnss_declarations_status_idx" ON "cnss_declarations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "cnss_declarations_companyId_month_year_key" ON "cnss_declarations"("companyId", "month", "year");

-- CreateIndex
CREATE INDEX "cnss_declaration_lines_declarationId_idx" ON "cnss_declaration_lines"("declarationId");

-- CreateIndex
CREATE INDEX "cnss_declaration_lines_employeeId_idx" ON "cnss_declaration_lines"("employeeId");

-- CreateIndex
CREATE INDEX "employee_contracts_employeeId_idx" ON "employee_contracts"("employeeId");

-- CreateIndex
CREATE INDEX "employee_contracts_companyId_idx" ON "employee_contracts"("companyId");

-- CreateIndex
CREATE INDEX "employee_contracts_contractType_idx" ON "employee_contracts"("contractType");

-- CreateIndex
CREATE INDEX "employee_contracts_status_idx" ON "employee_contracts"("status");

-- CreateIndex
CREATE INDEX "employee_contracts_endDate_idx" ON "employee_contracts"("endDate");

-- CreateIndex
CREATE UNIQUE INDEX "contract_ruptures_contractId_key" ON "contract_ruptures"("contractId");

-- CreateIndex
CREATE INDEX "contract_ruptures_employeeId_idx" ON "contract_ruptures"("employeeId");

-- CreateIndex
CREATE INDEX "contract_ruptures_companyId_idx" ON "contract_ruptures"("companyId");

-- CreateIndex
CREATE INDEX "contract_ruptures_ruptureType_idx" ON "contract_ruptures"("ruptureType");

-- CreateIndex
CREATE INDEX "contract_ruptures_status_idx" ON "contract_ruptures"("status");

-- CreateIndex
CREATE INDEX "contract_ruptures_ruptureDate_idx" ON "contract_ruptures"("ruptureDate");

-- CreateIndex
CREATE INDEX "pse_procedures_companyId_idx" ON "pse_procedures"("companyId");

-- CreateIndex
CREATE INDEX "pse_procedures_status_idx" ON "pse_procedures"("status");

-- CreateIndex
CREATE INDEX "pse_salaries_pseId_idx" ON "pse_salaries"("pseId");

-- CreateIndex
CREATE INDEX "pse_salaries_employeeId_idx" ON "pse_salaries"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "pse_salaries_pseId_employeeId_key" ON "pse_salaries"("pseId", "employeeId");

-- CreateIndex
CREATE INDEX "unpaid_salary_alerts_companyId_idx" ON "unpaid_salary_alerts"("companyId");

-- CreateIndex
CREATE INDEX "unpaid_salary_alerts_status_idx" ON "unpaid_salary_alerts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "unpaid_salary_alerts_companyId_month_year_key" ON "unpaid_salary_alerts"("companyId", "month", "year");

-- CreateIndex
CREATE INDEX "work_shifts_companyId_idx" ON "work_shifts"("companyId");

-- CreateIndex
CREATE INDEX "work_shifts_isActive_idx" ON "work_shifts"("isActive");

-- CreateIndex
CREATE INDEX "employee_shift_assignments_employeeId_idx" ON "employee_shift_assignments"("employeeId");

-- CreateIndex
CREATE INDEX "employee_shift_assignments_companyId_idx" ON "employee_shift_assignments"("companyId");

-- CreateIndex
CREATE INDEX "employee_shift_assignments_shiftId_idx" ON "employee_shift_assignments"("shiftId");

-- CreateIndex
CREATE INDEX "employee_shift_assignments_specificDate_idx" ON "employee_shift_assignments"("specificDate");

-- CreateIndex
CREATE UNIQUE INDEX "employee_shift_assignments_employeeId_specificDate_key" ON "employee_shift_assignments"("employeeId", "specificDate");

-- CreateIndex
CREATE INDEX "company_sites_companyId_idx" ON "company_sites"("companyId");

-- CreateIndex
CREATE INDEX "company_sites_isActive_idx" ON "company_sites"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_email_key" ON "affiliates"("email");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_referralCode_key" ON "affiliates"("referralCode");

-- CreateIndex
CREATE INDEX "affiliates_referralCode_idx" ON "affiliates"("referralCode");

-- CreateIndex
CREATE INDEX "affiliates_email_idx" ON "affiliates"("email");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_companies_companyId_key" ON "affiliate_companies"("companyId");

-- CreateIndex
CREATE INDEX "affiliate_companies_affiliateId_idx" ON "affiliate_companies"("affiliateId");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_commissions_paymentId_key" ON "affiliate_commissions"("paymentId");

-- CreateIndex
CREATE INDEX "affiliate_commissions_affiliateId_idx" ON "affiliate_commissions"("affiliateId");

-- CreateIndex
CREATE INDEX "affiliate_commissions_companyId_idx" ON "affiliate_commissions"("companyId");

-- CreateIndex
CREATE INDEX "affiliate_commissions_status_idx" ON "affiliate_commissions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_cabinets_cabinetId_key" ON "affiliate_cabinets"("cabinetId");

-- CreateIndex
CREATE INDEX "affiliate_cabinets_affiliateId_idx" ON "affiliate_cabinets"("affiliateId");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_cabinet_commissions_cabinetPaymentId_key" ON "affiliate_cabinet_commissions"("cabinetPaymentId");

-- CreateIndex
CREATE INDEX "affiliate_cabinet_commissions_affiliateId_idx" ON "affiliate_cabinet_commissions"("affiliateId");

-- CreateIndex
CREATE INDEX "affiliate_cabinet_commissions_status_idx" ON "affiliate_cabinet_commissions"("status");

-- CreateIndex
CREATE INDEX "affiliate_withdrawal_requests_affiliateId_idx" ON "affiliate_withdrawal_requests"("affiliateId");

-- CreateIndex
CREATE INDEX "affiliate_withdrawal_requests_status_idx" ON "affiliate_withdrawal_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "bulletin_templates_companyId_key" ON "bulletin_templates"("companyId");

-- CreateIndex
CREATE INDEX "bulletin_templates_companyId_idx" ON "bulletin_templates"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "blog_posts_authorId_idx" ON "blog_posts"("authorId");

-- CreateIndex
CREATE INDEX "blog_posts_companyId_idx" ON "blog_posts"("companyId");

-- CreateIndex
CREATE INDEX "blog_posts_published_publishedAt_idx" ON "blog_posts"("published", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "blog_posts_scope_idx" ON "blog_posts"("scope");

-- CreateIndex
CREATE INDEX "blog_posts_category_idx" ON "blog_posts"("category");

-- CreateIndex
CREATE INDEX "blog_likes_postId_idx" ON "blog_likes"("postId");

-- CreateIndex
CREATE INDEX "blog_likes_userId_idx" ON "blog_likes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "blog_likes_postId_userId_key" ON "blog_likes"("postId", "userId");

-- CreateIndex
CREATE INDEX "blog_anonymous_likes_postId_idx" ON "blog_anonymous_likes"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "blog_anonymous_likes_postId_fingerprint_key" ON "blog_anonymous_likes"("postId", "fingerprint");

-- CreateIndex
CREATE INDEX "blog_monthly_quotas_companyId_idx" ON "blog_monthly_quotas"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "blog_monthly_quotas_companyId_year_month_key" ON "blog_monthly_quotas"("companyId", "year", "month");

-- CreateIndex
CREATE INDEX "contact_messages_status_idx" ON "contact_messages"("status");

-- CreateIndex
CREATE INDEX "contact_messages_createdAt_idx" ON "contact_messages"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_affiliatedBy_fkey" FOREIGN KEY ("affiliatedBy") REFERENCES "affiliates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_working_days" ADD CONSTRAINT "non_working_days_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_validatedBy_fkey" FOREIGN KEY ("validatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "payrolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_rejectedBy_fkey" FOREIGN KEY ("rejectedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_leaveId_fkey" FOREIGN KEY ("leaveId") REFERENCES "leaves"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "attendances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_summaries" ADD CONSTRAINT "attendance_summaries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "attendances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offer_views" ADD CONSTRAINT "job_offer_views_jobOfferId_fkey" FOREIGN KEY ("jobOfferId") REFERENCES "job_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offer_test_questions" ADD CONSTRAINT "job_offer_test_questions_jobOfferId_fkey" FOREIGN KEY ("jobOfferId") REFERENCES "job_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_jobOfferId_fkey" FOREIGN KEY ("jobOfferId") REFERENCES "job_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_test_answers" ADD CONSTRAINT "candidate_test_answers_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_test_answers" ADD CONSTRAINT "candidate_test_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "job_offer_test_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_results" ADD CONSTRAINT "key_results_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_trainings" ADD CONSTRAINT "employee_trainings_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_trainings" ADD CONSTRAINT "employee_trainings_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "training_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_trainings" ADD CONSTRAINT "employee_trainings_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_trainings" ADD CONSTRAINT "employee_trainings_validated_by_id_fkey" FOREIGN KEY ("validated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_processes" ADD CONSTRAINT "onboarding_processes_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_processId_fkey" FOREIGN KEY ("processId") REFERENCES "onboarding_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "payrolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_mapping_patterns" ADD CONSTRAINT "import_mapping_patterns_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_bonuses" ADD CONSTRAINT "employee_bonuses_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_bonuses" ADD CONSTRAINT "employee_bonuses_bonusTemplateId_fkey" FOREIGN KEY ("bonusTemplateId") REFERENCES "BonusTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collective_agreement_rules" ADD CONSTRAINT "collective_agreement_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusTemplate" ADD CONSTRAINT "BonusTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_taxes" ADD CONSTRAINT "company_taxes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinets" ADD CONSTRAINT "cabinets_affiliatedBy_fkey" FOREIGN KEY ("affiliatedBy") REFERENCES "affiliates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_users" ADD CONSTRAINT "cabinet_users_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "cabinets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_users" ADD CONSTRAINT "cabinet_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_companies" ADD CONSTRAINT "cabinet_companies_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "cabinets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_companies" ADD CONSTRAINT "cabinet_companies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_wallets" ADD CONSTRAINT "cabinet_wallets_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "cabinets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_wallet_transactions" ADD CONSTRAINT "cabinet_wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "cabinet_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_import_mappings" ADD CONSTRAINT "cabinet_import_mappings_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "cabinets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_import_mappings" ADD CONSTRAINT "cabinet_import_mappings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_batch_closures" ADD CONSTRAINT "cabinet_batch_closures_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "cabinets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_batch_closure_items" ADD CONSTRAINT "cabinet_batch_closure_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "cabinet_batch_closures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_batch_closure_items" ADD CONSTRAINT "cabinet_batch_closure_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_subscriptions" ADD CONSTRAINT "cabinet_subscriptions_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "cabinets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinet_payments" ADD CONSTRAINT "cabinet_payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "cabinet_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cnss_declarations" ADD CONSTRAINT "cnss_declarations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cnss_declaration_lines" ADD CONSTRAINT "cnss_declaration_lines_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "cnss_declarations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cnss_declaration_lines" ADD CONSTRAINT "cnss_declaration_lines_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_ruptures" ADD CONSTRAINT "contract_ruptures_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "employee_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_ruptures" ADD CONSTRAINT "contract_ruptures_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_ruptures" ADD CONSTRAINT "contract_ruptures_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pse_procedures" ADD CONSTRAINT "pse_procedures_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pse_salaries" ADD CONSTRAINT "pse_salaries_pseId_fkey" FOREIGN KEY ("pseId") REFERENCES "pse_procedures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pse_salaries" ADD CONSTRAINT "pse_salaries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unpaid_salary_alerts" ADD CONSTRAINT "unpaid_salary_alerts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shift_assignments" ADD CONSTRAINT "employee_shift_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shift_assignments" ADD CONSTRAINT "employee_shift_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shift_assignments" ADD CONSTRAINT "employee_shift_assignments_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "work_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_sites" ADD CONSTRAINT "company_sites_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_companies" ADD CONSTRAINT "affiliate_companies_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_companies" ADD CONSTRAINT "affiliate_companies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_cabinets" ADD CONSTRAINT "affiliate_cabinets_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_cabinets" ADD CONSTRAINT "affiliate_cabinets_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "cabinets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_cabinet_commissions" ADD CONSTRAINT "affiliate_cabinet_commissions_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_cabinet_commissions" ADD CONSTRAINT "affiliate_cabinet_commissions_cabinetPaymentId_fkey" FOREIGN KEY ("cabinetPaymentId") REFERENCES "cabinet_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_withdrawal_requests" ADD CONSTRAINT "affiliate_withdrawal_requests_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletin_templates" ADD CONSTRAINT "bulletin_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_likes" ADD CONSTRAINT "blog_likes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_likes" ADD CONSTRAINT "blog_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_anonymous_likes" ADD CONSTRAINT "blog_anonymous_likes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_monthly_quotas" ADD CONSTRAINT "blog_monthly_quotas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
