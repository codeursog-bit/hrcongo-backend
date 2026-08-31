// // ============================================================================
// // 4️⃣ EMPLOYEES MODULE (MISE À JOUR)
// // ============================================================================
// // Fichier: src/employees/employees.module.ts

// import { Module } from '@nestjs/common';
// import { EmployeesService } from './employees.service';
// import { EmployeesController } from './employees.controller';
// import { EmployeesImportService } from './employees-import.service';
// import { EmployeesImportController } from './employees-import.controller';
// import { EmployeeBonusesController } from './bonuses/employee-bonuses.controller'; //
// import { EmployeeBonusesService } from './bonuses/employee-bonuses.service'; // 🆕
// import { PrismaModule } from '../prisma/prisma.module';
// import { SubscriptionsModule } from '../subscriptions/subscriptions.module'; // 🆕

// @Module({
//   imports: [
//     PrismaModule,
//     SubscriptionsModule, // 🆕 Import du module subscriptions
//   ],
//   controllers: [EmployeesController,  EmployeeBonusesController],
//   providers: [EmployeesService, EmployeesImportService,EmployeeBonusesService],
//   exports: [EmployeesService,  EmployeeBonusesService],
// })
// export class EmployeesModule {}

import { Module } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { EmployeesImportService } from './employees-import.service';
import { EmployeesImportController } from './employees-import.controller';
import { EmployeeBonusesController } from './bonuses/employee-bonuses.controller';
import { EmployeeBonusesService } from './bonuses/employee-bonuses.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ConventionsModule } from '../conventions/conventions.module';
import { FiscalModule } from '../payroll/fiscal/fiscal.module';
import { SalaryEstimateService } from './salary-estimate.service';

@Module({
  imports: [PrismaModule, SubscriptionsModule, ConventionsModule, FiscalModule],
  controllers: [
    EmployeesController,
    EmployeesImportController,
    EmployeeBonusesController,
  ],
  providers: [
    EmployeesService,
    EmployeesImportService,
    EmployeeBonusesService,
    SalaryEstimateService,
  ],
  exports: [EmployeesService, EmployeeBonusesService],
})
export class EmployeesModule {}

// import { Module } from '@nestjs/common';
// import { EmployeesService } from './employees.service';
// import { EmployeesController } from './employees.controller';
// import { EmployeesImportService } from './employees-import.service';
// import { EmployeesImportController } from './employees-import.controller';
// import { EmployeeBonusesController } from './bonuses/employee-bonuses.controller';
// import { EmployeeBonusesService } from './bonuses/employee-bonuses.service';
// import { PrismaModule } from '../prisma/prisma.module';
// import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

// @Module({
//   imports: [
//     PrismaModule,
//     SubscriptionsModule,
//   ],
//   controllers: [EmployeesController, EmployeesImportController, EmployeeBonusesController],
//   providers: [EmployeesService, EmployeesImportService, EmployeeBonusesService],
//   exports: [EmployeesService, EmployeeBonusesService],
// })
// export class EmployeesModule {}