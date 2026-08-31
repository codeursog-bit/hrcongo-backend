// import { NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';

// // ============================================
// // 🏢 EXCEPTIONS LIÉES À L'ENTREPRISE
// // ============================================

// export class CompanyNotFoundException extends NotFoundException {
//   constructor() {
//     super({
//       statusCode: 404,
//       message: 'Entreprise introuvable ou accès refusé',
//       error: 'COMPANY_NOT_FOUND'
//     });
//   }
// }

// export class CompanyAccessDeniedException extends ForbiddenException {
//   constructor() {
//     super({
//       statusCode: 403,
//       message: 'Vous n\'avez pas accès aux données de cette entreprise',
//       error: 'COMPANY_ACCESS_DENIED'
//     });
//   }
// }

// // ============================================
// // 👤 EXCEPTIONS LIÉES AUX EMPLOYÉS
// // ============================================

// export class EmployeeNotFoundException extends NotFoundException {
//   constructor(employeeId?: string) {
//     super({
//       statusCode: 404,
//       message: employeeId
//         ? `Employé #${employeeId} introuvable`
//         : 'Employé introuvable',
//       error: 'EMPLOYEE_NOT_FOUND',
//       employeeId
//     });
//   }
// }

// export class EmployeeInactiveException extends BadRequestException {
//   constructor(employeeName: string) {
//     super({
//       statusCode: 400,
//       message: `L'employé ${employeeName} n'est pas actif`,
//       error: 'EMPLOYEE_INACTIVE'
//     });
//   }
// }

// // ============================================
// // 💰 EXCEPTIONS LIÉES À LA PAIE
// // ============================================

// export class PayrollAlreadyExistsException extends ConflictException {
//   constructor(employeeName: string, month: number, year: number) {
//     super({
//       statusCode: 409,
//       message: `Un bulletin de paie existe déjà pour ${employeeName} (${month}/${year})`,
//       error: 'PAYROLL_ALREADY_EXISTS',
//       month,
//       year
//     });
//   }
// }

// export class PayrollNotFoundException extends NotFoundException {
//   constructor(payrollId: string) {
//     super({
//       statusCode: 404,
//       message: `Bulletin de paie #${payrollId} introuvable`,
//       error: 'PAYROLL_NOT_FOUND',
//       payrollId
//     });
//   }
// }

// export class PayrollAlreadyPaidException extends BadRequestException {
//   constructor() {
//     super({
//       statusCode: 400,
//       message: 'Ce bulletin de paie a déjà été payé et ne peut plus être modifié',
//       error: 'PAYROLL_ALREADY_PAID'
//     });
//   }
// }

// export class PayrollSettingsNotFoundException extends NotFoundException {
//   constructor() {
//     super({
//       statusCode: 404,
//       message: 'Paramètres de paie non configurés. Veuillez les configurer avant de générer des bulletins.',
//       error: 'PAYROLL_SETTINGS_NOT_FOUND'
//     });
//   }
// }

// // ============================================
// // 🏦 EXCEPTIONS LIÉES AUX PRÊTS/AVANCES
// // ============================================

// export class LoanAmountExceededException extends BadRequestException {
//   constructor(amount: number, maxAmount: number) {
//     super({
//       statusCode: 400,
//       message: `Le remboursement mensuel (${amount.toLocaleString()} FCFA) dépasse 30% du salaire (${maxAmount.toLocaleString()} FCFA)`,
//       error: 'LOAN_AMOUNT_EXCEEDED',
//       amount,
//       maxAmount
//     });
//   }
// }

// export class AdvanceAmountExceededException extends BadRequestException {
//   constructor(amount: number, maxAmount: number) {
//     super({
//       statusCode: 400,
//       message: `L'avance (${amount.toLocaleString()} FCFA) dépasse 50% du salaire (${maxAmount.toLocaleString()} FCFA)`,
//       error: 'ADVANCE_AMOUNT_EXCEEDED',
//       amount,
//       maxAmount
//     });
//   }
// }

// // ============================================
// // 📋 EXCEPTIONS LIÉES AUX CONGÉS
// // ============================================

// export class InsufficientLeaveBalanceException extends BadRequestException {
//   constructor(requested: number, available: number) {
//     super({
//       statusCode: 400,
//       message: `Solde de congés insuffisant. Demandé: ${requested} jours, Disponible: ${available} jours`,
//       error: 'INSUFFICIENT_LEAVE_BALANCE',
//       requested,
//       available
//     });
//   }
// }

// // ============================================
// // 🔐 EXCEPTIONS LIÉES À L'AUTHENTIFICATION
// // ============================================

// export class UserNotFoundException extends NotFoundException {
//   constructor() {
//     super({
//       statusCode: 404,
//       message: 'Utilisateur introuvable',
//       error: 'USER_NOT_FOUND'
//     });
//   }
// }

// export class InvalidCredentialsException extends BadRequestException {
//   constructor() {
//     super({
//       statusCode: 401,
//       message: 'Email ou mot de passe incorrect',
//       error: 'INVALID_CREDENTIALS'
//     });
//   }
// }

// import { NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';

// // ============================================
// // 🏢 EXCEPTIONS LIÉES À L'ENTREPRISE
// // ============================================

// export class CompanyNotFoundException extends NotFoundException {
//   constructor() {
//     super({
//       statusCode: 404,
//       message: 'Entreprise introuvable ou accès refusé',
//       error: 'COMPANY_NOT_FOUND'
//     });
//   }
// }

// export class CompanyAccessDeniedException extends ForbiddenException {
//   constructor() {
//     super({
//       statusCode: 403,
//       message: 'Vous n\'avez pas accès aux données de cette entreprise',
//       error: 'COMPANY_ACCESS_DENIED'
//     });
//   }
// }

// // ============================================
// // 👤 EXCEPTIONS LIÉES AUX EMPLOYÉS
// // ============================================

// export class EmployeeNotFoundException extends NotFoundException {
//   constructor(employeeId?: string) {
//     super({
//       statusCode: 404,
//       message: employeeId
//         ? `Employé #${employeeId} introuvable`
//         : 'Employé introuvable',
//       error: 'EMPLOYEE_NOT_FOUND',
//       employeeId
//     });
//   }
// }

// export class EmployeeInactiveException extends BadRequestException {
//   constructor(employeeName: string) {
//     super({
//       statusCode: 400,
//       message: `L'employé ${employeeName} n'est pas actif`,
//       error: 'EMPLOYEE_INACTIVE'
//     });
//   }
// }

// // ============================================
// // 💰 EXCEPTIONS LIÉES À LA PAIE
// // ============================================

// export class PayrollAlreadyExistsException extends ConflictException {
//   constructor(employeeName: string, month: number, year: number) {
//     super({
//       statusCode: 409,
//       message: `Un bulletin de paie existe déjà pour ${employeeName} (${month}/${year})`,
//       error: 'PAYROLL_ALREADY_EXISTS',
//       month,
//       year
//     });
//   }
// }

// export class PayrollNotFoundException extends NotFoundException {
//   constructor(payrollId: string) {
//     super({
//       statusCode: 404,
//       message: `Bulletin de paie #${payrollId} introuvable`,
//       error: 'PAYROLL_NOT_FOUND',
//       payrollId
//     });
//   }
// }

// export class PayrollAlreadyPaidException extends BadRequestException {
//   constructor() {
//     super({
//       statusCode: 400,
//       message: 'Ce bulletin de paie a déjà été payé et ne peut plus être modifié',
//       error: 'PAYROLL_ALREADY_PAID'
//     });
//   }
// }

// export class PayrollSettingsNotFoundException extends NotFoundException {
//   constructor() {
//     super({
//       statusCode: 404,
//       message: 'Paramètres de paie non configurés. Veuillez les configurer avant de générer des bulletins.',
//       error: 'PAYROLL_SETTINGS_NOT_FOUND'
//     });
//   }
// }

// // ============================================
// // 🏦 EXCEPTIONS LIÉES AUX PRÊTS/AVANCES
// // ============================================

// export class LoanAmountExceededException extends BadRequestException {
//   constructor(amount: number, maxAmount: number) {
//     super({
//       statusCode: 400,
//       message: `Le remboursement mensuel (${amount.toLocaleString()} FCFA) dépasse 30% du salaire (${maxAmount.toLocaleString()} FCFA)`,
//       error: 'LOAN_AMOUNT_EXCEEDED',
//       amount,
//       maxAmount
//     });
//   }
// }

// export class AdvanceAmountExceededException extends BadRequestException {
//   constructor(amount: number, maxAmount: number) {
//     super({
//       statusCode: 400,
//       message: `L'avance (${amount.toLocaleString()} FCFA) dépasse 50% du salaire (${maxAmount.toLocaleString()} FCFA)`,
//       error: 'ADVANCE_AMOUNT_EXCEEDED',
//       amount,
//       maxAmount
//     });
//   }
// }

// // ============================================
// // 📋 EXCEPTIONS LIÉES AUX CONGÉS
// // ============================================

// export class InsufficientLeaveBalanceException extends BadRequestException {
//   constructor(requested: number, available: number) {
//     super({
//       statusCode: 400,
//       message: `Solde de congés insuffisant. Demandé: ${requested} jours, Disponible: ${available} jours`,
//       error: 'INSUFFICIENT_LEAVE_BALANCE',
//       requested,
//       available
//     });
//   }
// }

// // ============================================
// // 🔐 EXCEPTIONS LIÉES À L'AUTHENTIFICATION
// // ============================================

// export class UserNotFoundException extends NotFoundException {
//   constructor() {
//     super({
//       statusCode: 404,
//       message: 'Utilisateur introuvable',
//       error: 'USER_NOT_FOUND'
//     });
//   }
// }

// export class InvalidCredentialsException extends BadRequestException {
//   constructor() {
//     super({
//       statusCode: 401,
//       message: 'Email ou mot de passe incorrect',
//       error: 'INVALID_CREDENTIALS'
//     });
//   }
// }

import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';

// ============================================
// 🏢 EXCEPTIONS LIÉES À L'ENTREPRISE
// ============================================

export class CompanyNotFoundException extends NotFoundException {
  constructor() {
    super({
      statusCode: 404,
      message: 'Entreprise introuvable ou accès refusé',
      error: 'COMPANY_NOT_FOUND',
    });
  }
}

export class CompanyAccessDeniedException extends ForbiddenException {
  constructor() {
    super({
      statusCode: 403,
      message: "Vous n'avez pas accès aux données de cette entreprise",
      error: 'COMPANY_ACCESS_DENIED',
    });
  }
}

// ============================================
// 👤 EXCEPTIONS LIÉES AUX EMPLOYÉS
// ============================================

export class EmployeeNotFoundException extends NotFoundException {
  constructor(employeeId?: string) {
    super({
      statusCode: 404,
      message: employeeId
        ? `Employé #${employeeId} introuvable`
        : 'Employé introuvable',
      error: 'EMPLOYEE_NOT_FOUND',
      employeeId,
    });
  }
}

export class EmployeeInactiveException extends BadRequestException {
  constructor(employeeName: string) {
    super({
      statusCode: 400,
      message: `L'employé ${employeeName} n'est pas actif`,
      error: 'EMPLOYEE_INACTIVE',
    });
  }
}

// ============================================
// 💰 EXCEPTIONS LIÉES À LA PAIE
// ============================================

export class PayrollAlreadyExistsException extends ConflictException {
  constructor(employeeName: string, month: number, year: number) {
    super({
      statusCode: 409,
      message: `Un bulletin de paie existe déjà pour ${employeeName} (${month}/${year})`,
      error: 'PAYROLL_ALREADY_EXISTS',
      month,
      year,
    });
  }
}

export class PayrollNotFoundException extends NotFoundException {
  constructor(payrollId: string) {
    super({
      statusCode: 404,
      message: `Bulletin de paie #${payrollId} introuvable`,
      error: 'PAYROLL_NOT_FOUND',
      payrollId,
    });
  }
}

export class PayrollAlreadyPaidException extends BadRequestException {
  constructor() {
    super({
      statusCode: 400,
      message:
        'Ce bulletin de paie a déjà été payé et ne peut plus être modifié',
      error: 'PAYROLL_ALREADY_PAID',
    });
  }
}

export class PayrollSettingsNotFoundException extends NotFoundException {
  constructor() {
    super({
      statusCode: 404,
      message:
        'Paramètres de paie non configurés. Veuillez les configurer avant de générer des bulletins.',
      error: 'PAYROLL_SETTINGS_NOT_FOUND',
    });
  }
}

// ============================================
// 🏦 EXCEPTIONS LIÉES AUX PRÊTS/AVANCES
// ============================================

export class LoanAmountExceededException extends BadRequestException {
  constructor(amount: number, maxAmount: number) {
    super({
      statusCode: 400,
      message: `Le remboursement mensuel (${amount.toLocaleString()} FCFA) dépasse 30% du salaire (${maxAmount.toLocaleString()} FCFA)`,
      error: 'LOAN_AMOUNT_EXCEEDED',
      amount,
      maxAmount,
    });
  }
}

export class AdvanceAmountExceededException extends BadRequestException {
  constructor(amount: number, maxAmount: number) {
    super({
      statusCode: 400,
      message: `L'avance (${amount.toLocaleString()} FCFA) dépasse 50% du salaire (${maxAmount.toLocaleString()} FCFA)`,
      error: 'ADVANCE_AMOUNT_EXCEEDED',
      amount,
      maxAmount,
    });
  }
}

// ============================================
// 📋 EXCEPTIONS LIÉES AUX CONGÉS
// ============================================

export class InsufficientLeaveBalanceException extends BadRequestException {
  constructor(requested: number, available: number) {
    super({
      statusCode: 400,
      message: `Solde de congés insuffisant. Demandé: ${requested} jours, Disponible: ${available} jours`,
      error: 'INSUFFICIENT_LEAVE_BALANCE',
      requested,
      available,
    });
  }
}

// ============================================
// 🔐 EXCEPTIONS LIÉES À L'AUTHENTIFICATION
// ============================================

export class UserNotFoundException extends NotFoundException {
  constructor() {
    super({
      statusCode: 404,
      message: 'Utilisateur introuvable',
      error: 'USER_NOT_FOUND',
    });
  }
}

export class InvalidCredentialsException extends BadRequestException {
  constructor() {
    super({
      statusCode: 401,
      message: 'Email ou mot de passe incorrect',
      error: 'INVALID_CREDENTIALS',
    });
  }
}

// ============================================
// ⏰ EXCEPTIONS LIÉES AUX POINTAGES (NOUVELLES)
// ============================================

export class AttendanceAlreadyExistsException extends ConflictException {
  constructor(employeeName: string, date: string) {
    super({
      statusCode: 409,
      message: `${employeeName} a déjà pointé aujourd'hui (${date})`,
      error: 'ATTENDANCE_ALREADY_EXISTS',
      employeeName,
      date,
    });
  }
}

export class AttendanceCheckOutMissingException extends BadRequestException {
  constructor() {
    super({
      statusCode: 400,
      message: "Aucun pointage d'entrée trouvé pour aujourd'hui",
      error: 'ATTENDANCE_CHECKOUT_MISSING',
    });
  }
}

export class AttendanceAlreadyCheckedOutException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      message: "Vous avez déjà pointé la sortie aujourd'hui",
      error: 'ATTENDANCE_ALREADY_CHECKED_OUT',
    });
  }
}
