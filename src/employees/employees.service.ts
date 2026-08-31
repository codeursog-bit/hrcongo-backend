// import {
//   Injectable,
//   NotFoundException,
//   ForbiddenException,
//   ConflictException,
//   BadRequestException,
// } from '@nestjs/common';
// import { PrismaService } from '../prisma/prisma.service';
// import { CreateEmployeeDto } from './dto/create-employee.dto';
// import { UpdateEmployeeDto } from './dto/update-employee.dto';
// import { PaginationDto, PaginatedResponse } from '../common/dto/pagination.dto';
// import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';

// // ─── Rôles autorisés ──────────────────────────────────────────────────────────
// const CAN_CREATE = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];
// const CAN_EDIT   = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];
// const CAN_DELETE = ['SUPER_ADMIN', 'ADMIN'];
// const CAN_LIST   = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'MANAGER', 'CABINET_ADMIN', 'CABINET_GESTIONNAIRE'];

// // Champs sensibles masqués pour MANAGER
// const SAFE_SELECT_MANAGER = {
//   id: true,
//   employeeNumber: true,
//   firstName: true,
//   lastName: true,
//   email: true,
//   phone: true,
//   photoUrl: true,
//   position: true,
//   contractType: true,
//   status: true,
//   hireDate: true,
//   address: true,
//   city: true,
//   gender: true,
//   dateOfBirth: true,
//   placeOfBirth: true,
//   maritalStatus: true,
//   numberOfChildren: true,
//   nationalIdNumber: true,
//   cnssNumber: true,
//   professionalCategory: true,
//   echelon: true,
//   departmentId: true,
//   department: { select: { id: true, name: true } },
//   // ❌ baseSalary masqué
//   // ❌ bankName, bankAccountNumber masqués
//   // ❌ isSubjectToIrpp, isSubjectToCnss masqués
//   // ❌ payrolls masqués
// };

// @Injectable()
// export class EmployeesService {
//   constructor(
//     private prisma: PrismaService,
//     private subscriptionGuard: SubscriptionGuard,
//   ) {}

//   // ============================================================================
//   // 🔒 HELPER : Récupérer user + companyId vérifié
//   // ============================================================================

//   private async getVerifiedUser(userId: string): Promise<{
//     id: string;
//     companyId: string;
//     role: string;
//     email: string | null;
//   }> {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { id: true, companyId: true, role: true, email: true },
//     });
//     if (!user) {
//       throw new ForbiddenException("Utilisateur introuvable.");
//     }
//     // ✅ FIX BUG 5: CABINET_ADMIN/GESTIONNAIRE n'ont pas de companyId sur User
//     const isCabinetUser = user.role === 'CABINET_ADMIN' || user.role === 'CABINET_GESTIONNAIRE';
//     if (!user.companyId && !isCabinetUser) {
//       throw new ForbiddenException("L'utilisateur n'est pas rattaché à une entreprise.");
//     }
//     return { ...user, companyId: user.companyId ?? '' };
//   }

//   // ============================================================================
//   // 🔒 HELPER : Récupérer le département du manager
//   // ============================================================================

//   private async getManagerDeptId(userId: string, companyId: string): Promise<string | null> {
//     const dept = await this.prisma.department.findFirst({
//       where: { managerId: userId, companyId },
//       select: { id: true },
//     });
//     if (dept) return dept.id;

//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { email: true },
//     });
//     if (user?.email) {
//       const emp = await this.prisma.employee.findFirst({
//         where: { email: user.email, companyId },
//         select: { departmentId: true },
//       });
//       return emp?.departmentId ?? null;
//     }
//     return null;
//   }

//   // ============================================================================
//   // 🔒 HELPER : Vérifier accès manager à un employé
//   // ============================================================================

//   private async assertManagerCanAccessEmployee(
//     userId: string,
//     companyId: string,
//     employee: { companyId: string; departmentId: string },
//   ) {
//     if (employee.companyId !== companyId) {
//       throw new ForbiddenException("Accès refusé : entreprise différente.");
//     }
//     const deptId = await this.getManagerDeptId(userId, companyId);
//     if (!deptId || employee.departmentId !== deptId) {
//       throw new ForbiddenException("Vous n'avez accès qu'aux employés de votre département.");
//     }
//   }

//   // ============================================================================
//   // ✅ CRÉER — Réservé à ADMIN / HR_MANAGER / SUPER_ADMIN
//   // ============================================================================

//   async create(createEmployeeDto: CreateEmployeeDto, userId: string) {
//     const user = await this.getVerifiedUser(userId);

//     if (!CAN_CREATE.includes(user.role)) {
//       throw new ForbiddenException(
//         "Vous n'avez pas les droits pour créer un employé. Seuls les administrateurs et RH peuvent effectuer cette action.",
//       );
//     }

//     await this.subscriptionGuard.checkLimit(
//       user.companyId,
//       'maxEmployees',
//       "Limite d'employés atteinte. Veuillez upgrader votre plan.",
//     );

//     // Validation champs obligatoires
//     const missingFields: string[] = [];
//     if (!createEmployeeDto.firstName)    missingFields.push('Prénom');
//     if (!createEmployeeDto.lastName)     missingFields.push('Nom');
//     if (!createEmployeeDto.dateOfBirth)  missingFields.push('Date de naissance');
//     if (!createEmployeeDto.placeOfBirth) missingFields.push('Lieu de naissance');
//     if (!createEmployeeDto.phone)        missingFields.push('Téléphone');
//     if (!createEmployeeDto.email)        missingFields.push('Email');
//     if (!createEmployeeDto.address)      missingFields.push('Adresse');
//     if (!createEmployeeDto.hireDate)     missingFields.push("Date d'embauche");
//     if (!createEmployeeDto.position)     missingFields.push('Poste');
//     if (!createEmployeeDto.departmentId) missingFields.push('Département');
//     if (createEmployeeDto.baseSalary === undefined || createEmployeeDto.baseSalary === null) {
//       missingFields.push('Salaire de base');
//     }
//     if (createEmployeeDto.numberOfChildren === undefined || createEmployeeDto.numberOfChildren === null) {
//       missingFields.push("Nombre d'enfants");
//     }

//     // 🆕 Validation contractEndDate obligatoire pour contrats temporaires
//     const TEMP_CONTRACTS = ['CDD', 'STAGE', 'INTERIM', 'CONSULTANT', 'PRESTATAIRE'];
//     if (TEMP_CONTRACTS.includes(createEmployeeDto.contractType) && !createEmployeeDto.contractEndDate) {
//       missingFields.push('Date de fin de contrat (obligatoire pour CDD/Stage/Intérim/Consultant/Prestataire)');
//     }

//     // 🆕 INTERIM / PRESTATAIRE : vérification spécifique
//     if (createEmployeeDto.contractType === 'INTERIM') {
//       // L'intérimaire est suivi dans le RH mais pas de bulletin généré
//       // Pas de blocage — juste information
//     }

//     if (missingFields.length > 0) {
//       throw new BadRequestException({ message: 'Champs obligatoires manquants', fields: missingFields });
//     }

//     // Vérifier département
//     const dept = await this.prisma.department.findUnique({
//       where: { id: createEmployeeDto.departmentId },
//       select: { companyId: true },
//     });
//     if (!dept || dept.companyId !== user.companyId) {
//       throw new ForbiddenException("Ce département n'appartient pas à votre entreprise.");
//     }

//     // Génération matricule unique (ou utilisation du matricule fourni)
//     const year = new Date().getFullYear();
//     let employeeNumber = '';

//     if (createEmployeeDto.employeeNumber?.trim()) {
//       // Matricule personnalisé fourni — vérifier unicité
//       const customNumber = createEmployeeDto.employeeNumber.trim();
//       const existing = await this.prisma.employee.findFirst({
//         where: { employeeNumber: customNumber, companyId: user.companyId },
//       });
//       if (existing) {
//         throw new ConflictException(`Le matricule "${customNumber}" est déjà utilisé dans cette entreprise.`);
//       }
//       employeeNumber = customNumber;
//     } else {
//       // Auto-génération
//       let isUnique = false;
//       let attempt = 0;
//       while (!isUnique && attempt < 10) {
//         const count = await this.prisma.employee.count({ where: { companyId: user.companyId } });
//         const sequence = (count + 1 + attempt).toString().padStart(3, '0');
//         employeeNumber = `EMP-${year}-${sequence}`;
//         const existing = await this.prisma.employee.findFirst({
//           where: { employeeNumber, companyId: user.companyId },
//         });
//         if (!existing) isUnique = true;
//         else attempt++;
//       }
//       if (!employeeNumber) throw new ConflictException('Impossible de générer un matricule unique.');
//     }

//     try {
//       const { dateOfBirth, hireDate, contractEndDate, ...rest } = createEmployeeDto;

//       let finalPhotoUrl = rest.photoUrl;
//       if (finalPhotoUrl && finalPhotoUrl.startsWith('data:image')) {
//         console.warn('⚠️ Photo base64 — à uploader sur Cloudinary.');
//       }

//       // 🆕 CDI → forcer contractEndDate à null
//       // 🆕 Contrats temporaires → convertir string en Date pour Prisma
//       const parsedContractEndDate = TEMP_CONTRACTS.includes(rest.contractType) && contractEndDate
//         ? new Date(contractEndDate)
//         : null;

//       // ── Période d'essai : calculer trialEndDate et trialStatus ────────────
//       const trialDays = rest.trialPeriodDays ? Number(rest.trialPeriodDays) : 0;
//       let computedTrialEndDate: Date | null = null;
//       let trialStatus: string = 'NONE';

//       if (trialDays > 0 && ['CDI', 'CDD'].includes(rest.contractType)) {
//         const start = new Date(hireDate);
//         computedTrialEndDate = new Date(start);
//         computedTrialEndDate.setDate(computedTrialEndDate.getDate() + trialDays);
//         // Si la date d'essai est dans le futur → IN_PROGRESS
//         trialStatus = computedTrialEndDate > new Date() ? 'IN_PROGRESS' : 'EXPIRED';
//       }

//       // ── Nationalité / résidence BNC ────────────────────────────────────────
//       // Pour CONSULTANT et PRESTATAIRE : isResident détermine le taux BNC
//       // Par défaut : true (résident congolais → 10%)
//       const isResident = rest.isResident !== undefined ? rest.isResident : true;

//       // ── Auto-configuration fiscale selon le type de contrat ───────────────
//       // CONSULTANT / PRESTATAIRE / INTERIM → pas de CNSS salariale, pas d'ITS
//       const contractType = rest.contractType;
//       let autoIsSubjectToCnss  = rest.isSubjectToCnss  ?? true;
//       let autoIsSubjectToIrpp  = rest.isSubjectToIrpp  ?? true;
//       let autoIsSubjectToTus   = (rest as any).isSubjectToTus ?? true;

//       if (['CONSULTANT', 'PRESTATAIRE', 'INTERIM'].includes(contractType)) {
//         autoIsSubjectToCnss = false;
//         autoIsSubjectToIrpp = false;
//         autoIsSubjectToTus  = false;
//       } else if (contractType === 'STAGE') {
//         // Stagiaire : pas de CNSS salariale, pas de TUS
//         // ITS seulement si gratification > SMIG (géré dans le calculateur)
//         autoIsSubjectToCnss = false;
//         autoIsSubjectToTus  = false;
//       }

//      // Utiliser une transaction pour créer l'employé ET son contrat ensemble
// return await this.prisma.$transaction(async (tx) => {
//   const newEmployee = await tx.employee.create({
//     data: {
//       ...rest,
//       dateOfBirth: new Date(dateOfBirth),
//       hireDate: new Date(hireDate),
//       contractEndDate: parsedContractEndDate,
//       employeeNumber,
//       companyId: user.companyId,
//       createdById: userId,
//       photoUrl: finalPhotoUrl,
//       city: rest.city || 'Brazzaville',
//       numberOfChildren: rest.numberOfChildren || 0,
//       nationalIdNumber: rest.nationalIdNumber || null,
//       trialPeriodDays:  trialDays > 0 ? trialDays : null,
//       trialEndDate:     computedTrialEndDate,
//       trialStatus:      trialStatus as any,
//       isResident,
//       nationality:      rest.nationality || null,
//       isSubjectToCnss:  autoIsSubjectToCnss,
//       isSubjectToIrpp:  autoIsSubjectToIrpp,
//       isSubjectToTus:   autoIsSubjectToTus,
//     },
//   });

//   // Créer le contrat lié automatiquement
//   await tx.employeeContract.create({
//     data: {
//       employeeId:      newEmployee.id,
//       companyId:       user.companyId,
//       contractType:    contractType as any,
//       startDate:       new Date(hireDate),
//       endDate:         parsedContractEndDate,
//       position:        rest.position,
//       baseSalary:      rest.baseSalary,
//       departmentId:    rest.departmentId,
//       status:          trialDays > 0 ? 'TRIAL' : 'ACTIVE',
//       trialPeriodDays: trialDays > 0 ? trialDays : null,
//       trialEndDate:    computedTrialEndDate,
//       notes:           "Créé automatiquement à l'enregistrement",
//     },
//   });

//   return newEmployee;
// });
//     } catch (error: any) {
//       if (error.code === 'P2002') {
//         const field = error.meta?.target?.[0];
//         if (field === 'nationalIdNumber') throw new ConflictException("Ce numéro CNI est déjà enregistré.");
//         if (field === 'cnssNumber') throw new ConflictException('Ce numéro CNSS est déjà enregistré.');
//         throw new ConflictException('Un employé avec ces informations existe déjà.');
//       }
//       if (error.code === 'P2000' || error.code === 'P2003') {
//         throw new BadRequestException({ message: 'Erreur de validation', details: error.meta });
//       }
//       throw error;
//     }
//   }

//   // ============================================================================
//   // ✅ LISTE PAGINÉE
//   // ============================================================================

//   async findAll(userId: string, pagination?: PaginationDto): Promise<PaginatedResponse<any>> {
//     const user = await this.getVerifiedUser(userId);

//     if (!CAN_LIST.includes(user.role)) {
//       throw new ForbiddenException("Accès non autorisé à la liste des employés.");
//     }

//     // ✅ FIX BUG 5: cabinet users passent companyId via query param (pas sur leur User)
//     const isCabinet = user.role === 'CABINET_ADMIN' || user.role === 'CABINET_GESTIONNAIRE';
//     const effectiveCompanyId = (isCabinet && (pagination as any)?.companyId)
//       ? (pagination as any).companyId
//       : user.companyId;

//     if (!effectiveCompanyId) {
//       return { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };
//     }

//     const whereClause: any = {
//       companyId: effectiveCompanyId,
//       status: 'ACTIVE',
//     };

//     if (user.role === 'MANAGER') {
//       const deptId = await this.getManagerDeptId(user.id, user.companyId);
//       if (!deptId) return { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };
//       whereClause.departmentId = deptId;
//     }

//     const page  = pagination?.page  || 1;
//     const limit = pagination?.limit || 50;
//     const skip  = (page - 1) * limit;

//     const isManager = user.role === 'MANAGER';

//     const [data, total] = await Promise.all([
//       this.prisma.employee.findMany({
//         where: whereClause,
//         select: isManager
//           ? SAFE_SELECT_MANAGER
//           : {
//               id: true,
//               employeeNumber: true,
//               firstName: true,
//               lastName: true,
//               email: true,
//               phone: true,
//               photoUrl: true,
//               position: true,
//               contractType: true,
//               contractEndDate: true, // 🆕 inclus dans la liste
//               status: true,
//               hireDate: true,
//               baseSalary: true,
//               department: { select: { id: true, name: true } },
//               departmentId: true,
//             },
//         orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
//         skip,
//         take: limit,
//       }),
//       this.prisma.employee.count({ where: whereClause }),
//     ]);

//     return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
//   }

//   // ============================================================================
//   // ✅ LISTE SIMPLE (pour selects, congés, etc.)
//   // ============================================================================

//   async findAllSimple(userId: string, overrideCompanyId?: string) {
//     const user = await this.getVerifiedUser(userId);

//     if (!CAN_LIST.includes(user.role)) {
//       throw new ForbiddenException("Accès non autorisé.");
//     }

//     // ✅ FIX BUG 5: cabinet users passent companyId via overrideCompanyId
//     const isCab = user.role === 'CABINET_ADMIN' || user.role === 'CABINET_GESTIONNAIRE';
//     const effCompanyId = (isCab && overrideCompanyId) ? overrideCompanyId : user.companyId;
//     if (!effCompanyId) return [];
//     const whereClause: any = { companyId: effCompanyId, status: 'ACTIVE' };

//     if (user.role === 'MANAGER') {
//       const deptId = await this.getManagerDeptId(user.id, user.companyId);
//       if (!deptId) return [];
//       whereClause.departmentId = deptId;
//     }

//     return this.prisma.employee.findMany({
//       where: whereClause,
//       select: {
//         id: true,
//         firstName: true,
//         lastName: true,
//         email: true,
//         position: true,
//         photoUrl: true,
//         employeeNumber: true,
//         department: { select: { id: true, name: true } },
//       },
//       orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
//     });
//   }

//   // ============================================================================
//   // ✅ DÉTAIL D'UN EMPLOYÉ
//   // ============================================================================

//   async findOne(id: string, userId: string) {
//     const user = await this.getVerifiedUser(userId);

//     if (!CAN_LIST.includes(user.role)) {
//       throw new ForbiddenException("Accès non autorisé.");
//     }

//     const employee = await this.prisma.employee.findUnique({
//       where: { id },
//       include: {
//         department: true,
//         leaves: {
//           orderBy: { createdAt: 'desc' },
//           take: 10,
//         },
//         assets: {
//           where: { status: 'IN_USE' },
//         },
//         documents: {
//           orderBy: { createdAt: 'desc' },
//           take: 10,
//         },
//       },
//     });

//     if (!employee) throw new NotFoundException('Employé introuvable.');

//     if (employee.companyId !== user.companyId) {
//       throw new ForbiddenException("Vous n'avez pas accès à cet employé.");
//     }

//     if (user.role === 'MANAGER') {
//       await this.assertManagerCanAccessEmployee(user.id, user.companyId, employee);

//       const { baseSalary, bankName, bankAccountNumber, mobileMoneyNumber,
//               isSubjectToIrpp, isSubjectToCnss, taxExemptionReason,
//               ...safeEmployee } = employee as any;

//       return {
//         ...safeEmployee,
//         baseSalary: null,
//         bankName: null,
//         bankAccountNumber: null,
//         mobileMoneyNumber: null,
//         isSubjectToIrpp: null,
//         isSubjectToCnss: null,
//         taxExemptionReason: null,
//         payrolls: [],
//       };
//     }

//     const payrolls = await this.prisma.payroll.findMany({
//       where: { employeeId: id },
//       select: {
//         id: true, month: true, year: true,
//         netSalary: true, grossSalary: true, status: true,
//       },
//       orderBy: [{ year: 'desc' }, { month: 'desc' }],
//       take: 24,
//     });

//     return { ...employee, payrolls };
//   }

//   // ============================================================================
//   // ✅ MON PROFIL
//   // ============================================================================

//   async findByUser(userId: string) {
//     const user = await this.getVerifiedUser(userId);

//     return this.prisma.employee.findFirst({
//       where: { email: user.email ?? undefined, companyId: user.companyId },
//       include: { department: true },
//     });
//   }

//   // ============================================================================
//   // ✅ MODIFIER
//   // ============================================================================

//   async update(id: string, updateEmployeeDto: UpdateEmployeeDto, userId: string) {
//     const user = await this.getVerifiedUser(userId);

//     if (!CAN_EDIT.includes(user.role)) {
//       throw new ForbiddenException(
//         "Vous n'avez pas les droits pour modifier un employé.",
//       );
//     }

//     const employee = await this.prisma.employee.findUnique({ where: { id } });
//     if (!employee) throw new NotFoundException('Employé introuvable.');

//     if (employee.companyId !== user.companyId) {
//       throw new ForbiddenException("Vous n'avez pas accès à cet employé.");
//     }

//     if (updateEmployeeDto.departmentId) {
//       const dept = await this.prisma.department.findUnique({
//         where: { id: updateEmployeeDto.departmentId },
//         select: { companyId: true },
//       });
//       if (!dept || dept.companyId !== user.companyId) {
//         throw new ForbiddenException("Ce département n'appartient pas à votre entreprise.");
//       }
//     }

//     const dataToUpdate: any = { ...updateEmployeeDto };
//     if (dataToUpdate.dateOfBirth)     dataToUpdate.dateOfBirth     = new Date(dataToUpdate.dateOfBirth);
//     if (dataToUpdate.hireDate)        dataToUpdate.hireDate        = new Date(dataToUpdate.hireDate);
//     if (dataToUpdate.terminationDate) dataToUpdate.terminationDate = new Date(dataToUpdate.terminationDate);
//     else if ('terminationDate' in dataToUpdate && !dataToUpdate.terminationDate) dataToUpdate.terminationDate = null;

//     // Fix contractEndDate : convertir string → Date ou forcer null si CDI
//     const TEMP_CONTRACTS = ['CDD', 'STAGE', 'INTERIM', 'CONSULTANT', 'PRESTATAIRE'];
//     if ('contractEndDate' in dataToUpdate) {
//       const contractType = dataToUpdate.contractType ?? employee.contractType;
//       if (TEMP_CONTRACTS.includes(contractType) && dataToUpdate.contractEndDate) {
//         dataToUpdate.contractEndDate = new Date(dataToUpdate.contractEndDate);
//       } else {
//         dataToUpdate.contractEndDate = null;
//       }
//     }

//     // Recalculer trialEndDate si trialPeriodDays ou hireDate change
//     const hireDateForTrial = dataToUpdate.hireDate ?? new Date(employee.hireDate);
//     const trialDays = dataToUpdate.trialPeriodDays !== undefined
//       ? Number(dataToUpdate.trialPeriodDays)
//       : (employee as any).trialPeriodDays ?? 0;

//     const contractTypeForTrial = dataToUpdate.contractType ?? employee.contractType;
//     if (['CDI', 'CDD'].includes(contractTypeForTrial) && trialDays > 0) {
//       const end = new Date(hireDateForTrial);
//       end.setDate(end.getDate() + trialDays);
//       dataToUpdate.trialEndDate = end;
//       // Ne pas écraser un statut déjà CONFIRMED ou FAILED
//       const currentStatus = (employee as any).trialStatus ?? 'NONE';
//       if (!['CONFIRMED', 'FAILED'].includes(currentStatus)) {
//         dataToUpdate.trialStatus = end > new Date() ? 'IN_PROGRESS' : 'EXPIRED';
//       }
//     } else if (dataToUpdate.trialPeriodDays === 0 || dataToUpdate.trialPeriodDays === '0') {
//       dataToUpdate.trialEndDate = null;
//       dataToUpdate.trialStatus  = 'NONE';
//     }

//     // Auto-reconfigurer les flags fiscaux si le type de contrat change
//     if (dataToUpdate.contractType) {
//       const ct = dataToUpdate.contractType;
//       if (['CONSULTANT', 'PRESTATAIRE', 'INTERIM'].includes(ct)) {
//         dataToUpdate.isSubjectToCnss = false;
//         dataToUpdate.isSubjectToIrpp = false;
//         dataToUpdate.isSubjectToTus  = false;
//       } else if (ct === 'STAGE') {
//         dataToUpdate.isSubjectToCnss = false;
//         dataToUpdate.isSubjectToTus  = false;
//         dataToUpdate.isSubjectToIrpp = true;
//       } else if (['CDI', 'CDD'].includes(ct)) {
//         // Remettre à true seulement si c'était un non-salarié avant
//         const prev = employee.contractType;
//         if (['CONSULTANT', 'PRESTATAIRE', 'INTERIM', 'STAGE'].includes(prev)) {
//           dataToUpdate.isSubjectToCnss = true;
//           dataToUpdate.isSubjectToIrpp = true;
//           dataToUpdate.isSubjectToTus  = true;
//         }
//       }
//     }

//     try {
//       return await this.prisma.employee.update({ where: { id }, data: dataToUpdate });
//     } catch (error: any) {
//       if (error.code === 'P2002') {
//         const field = error.meta?.target?.[0];
//         if (field === 'nationalIdNumber') throw new ConflictException('Ce numéro CNI est déjà utilisé.');
//         if (field === 'cnssNumber')        throw new ConflictException('Ce numéro CNSS est déjà utilisé.');
//         throw new ConflictException('Ces informations sont déjà utilisées.');
//       }
//       throw error;
//     }
//   }

//   // ============================================================================
//   // ✅ SUPPRIMER
//   // ============================================================================

//   async remove(id: string, userId: string) {
//     const user = await this.getVerifiedUser(userId);

//     if (!CAN_DELETE.includes(user.role)) {
//       throw new ForbiddenException("Seuls les administrateurs peuvent supprimer un employé.");
//     }

//     const employee = await this.prisma.employee.findUnique({
//       where: { id },
//       select: { id: true, companyId: true, departmentId: true, email: true },
//     });
//     if (!employee) throw new NotFoundException('Employé introuvable.');

//     if (employee.companyId !== user.companyId) {
//       throw new ForbiddenException("Vous n'avez pas accès à cet employé.");
//     }

//     if (employee.email) {
//       const linkedUser = await this.prisma.user.findFirst({
//         where: {
//           email: employee.email,
//           companyId: user.companyId,
//           id: { not: userId },
//         },
//         select: { id: true },
//       });

//       if (linkedUser) {
//         await this.prisma.user.delete({ where: { id: linkedUser.id } });
//       }
//     }

//     return this.prisma.employee.update({
//       where: { id },
//       data: {
//         status: 'TERMINATED',
//         terminationDate: new Date(),
//       },
//     });
//   }
// }

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { PaginationDto, PaginatedResponse } from '../common/dto/pagination.dto';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import { Prisma } from '@prisma/client';
import {
  normalizeAndValidatePhone,
  normalizePhone,
} from '../common/utils/phone.util';
import { normalizeNationality } from '../common/utils/nationality.util';
import { ConventionsService } from '../conventions/conventions.service';

// ─── Rôles autorisés ──────────────────────────────────────────────────────────
const CAN_CREATE = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];
const CAN_EDIT = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];
const CAN_DELETE = ['SUPER_ADMIN', 'ADMIN'];
const CAN_LIST = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR_MANAGER',
  'MANAGER',
  'CABINET_ADMIN',
  'CABINET_GESTIONNAIRE',
];

// Champs sensibles masqués pour MANAGER
const SAFE_SELECT_MANAGER = {
  id: true,
  employeeNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  photoUrl: true,
  position: true,
  contractType: true,
  status: true,
  hireDate: true,
  address: true,
  city: true,
  gender: true,
  dateOfBirth: true,
  placeOfBirth: true,
  maritalStatus: true,
  numberOfChildren: true,
  nationalIdNumber: true,
  cnssNumber: true,
  professionalCategory: true,
  echelon: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
};

@Injectable()
export class EmployeesService {
  constructor(
    private prisma: PrismaService,
    private subscriptionGuard: SubscriptionGuard,
    private conventionsService: ConventionsService,
  ) {}

  private async getVerifiedUser(userId: string): Promise<{
    id: string;
    companyId: string;
    role: string;
    email: string | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, role: true, email: true },
    });
    if (!user) {
      throw new ForbiddenException('Utilisateur introuvable.');
    }
    const isCabinetUser =
      user.role === 'CABINET_ADMIN' || user.role === 'CABINET_GESTIONNAIRE';
    if (!user.companyId && !isCabinetUser) {
      throw new ForbiddenException(
        "L'utilisateur n'est pas rattaché à une entreprise.",
      );
    }
    return { ...user, companyId: user.companyId ?? '' };
  }

  private async getManagerDeptId(
    userId: string,
    companyId: string,
  ): Promise<string | null> {
    const dept = await this.prisma.department.findFirst({
      where: { managerId: userId, companyId },
      select: { id: true },
    });
    if (dept) return dept.id;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user?.email) {
      const emp = await this.prisma.employee.findFirst({
        where: { email: user.email, companyId },
        select: { departmentId: true },
      });
      return emp?.departmentId ?? null;
    }
    return null;
  }

  private async assertManagerCanAccessEmployee(
    userId: string,
    companyId: string,
    employee: { companyId: string; departmentId: string },
  ) {
    if (employee.companyId !== companyId) {
      throw new ForbiddenException('Accès refusé : entreprise différente.');
    }
    const deptId = await this.getManagerDeptId(userId, companyId);
    if (!deptId || employee.departmentId !== deptId) {
      throw new ForbiddenException(
        "Vous n'avez accès qu'aux employés de votre département.",
      );
    }
  }

  async create(
    createEmployeeDto: CreateEmployeeDto,
    userId: string,
    options?: { phoneOptional?: boolean },
  ) {
    const user = await this.getVerifiedUser(userId);

    if (!CAN_CREATE.includes(user.role)) {
      throw new ForbiddenException(
        "Vous n'avez pas les droits pour créer un employé. Seuls les administrateurs et RH peuvent effectuer cette action.",
      );
    }

    await this.subscriptionGuard.checkLimit(
      user.companyId,
      'maxEmployees',
      "Limite d'employés atteinte. Veuillez upgrader votre plan.",
    );

    const missingFields: string[] = [];
    if (!createEmployeeDto.firstName) missingFields.push('Prénom');
    if (!createEmployeeDto.lastName) missingFields.push('Nom');
    if (!createEmployeeDto.dateOfBirth) missingFields.push('Date de naissance');
    if (!createEmployeeDto.placeOfBirth)
      missingFields.push('Lieu de naissance');
    if (!createEmployeeDto.phone && !options?.phoneOptional)
      missingFields.push('Téléphone');
    if (!createEmployeeDto.email) missingFields.push('Email');
    if (!createEmployeeDto.address) missingFields.push('Adresse');
    if (!createEmployeeDto.hireDate) missingFields.push("Date d'embauche");
    if (!createEmployeeDto.position) missingFields.push('Poste');
    if (!createEmployeeDto.departmentId) missingFields.push('Département');
    if (
      createEmployeeDto.baseSalary === undefined ||
      createEmployeeDto.baseSalary === null
    ) {
      missingFields.push('Salaire de base');
    }
    if (
      createEmployeeDto.numberOfChildren === undefined ||
      createEmployeeDto.numberOfChildren === null
    ) {
      missingFields.push("Nombre d'enfants");
    }

    const TEMP_CONTRACTS = [
      'CDD',
      'STAGE',
      'INTERIM',
      'CONSULTANT',
      'PRESTATAIRE',
    ];
    if (
      TEMP_CONTRACTS.includes(createEmployeeDto.contractType) &&
      !createEmployeeDto.contractEndDate
    ) {
      missingFields.push(
        'Date de fin de contrat (obligatoire pour CDD/Stage/Intérim/Consultant/Prestataire)',
      );
    }

    if (missingFields.length > 0) {
      throw new BadRequestException({
        message: 'Champs obligatoires manquants',
        fields: missingFields,
      });
    }

    // ✅ TÉLÉPHONE : normalisation (espaces, +242/00242/242 → forme canonique 0XXXXXXXX),
    // validation (un seul numéro à 9 chiffres) et unicité dans l'entreprise.
    if (createEmployeeDto.phone) {
      let normalizedPhone: string;
      try {
        normalizedPhone = normalizeAndValidatePhone(createEmployeeDto.phone);
      } catch (e: any) {
        throw new BadRequestException(e.message);
      }
      const phoneTaken = await this.prisma.employee.findFirst({
        where: { phone: normalizedPhone }, // ✅ global, pas par entreprise : le login cherche aussi tous employés confondus
      });
      if (phoneTaken) {
        throw new ConflictException(
          `Le numéro "${normalizedPhone}" est déjà utilisé par un autre employé.`,
        );
      }
      createEmployeeDto.phone = normalizedPhone;
    }

    // ✅ TÉLÉPHONE SECONDAIRE : juste normalisé (espaces/indicatif), pas de validation stricte
    // du format ni de vérification d'unicité — il ne sert jamais à se connecter.
    if (createEmployeeDto.secondaryPhone) {
      createEmployeeDto.secondaryPhone =
        normalizePhone(createEmployeeDto.secondaryPhone) ??
        createEmployeeDto.secondaryPhone;
    }

    // 🆕 Nationalité normalisée — même format en base peu importe la saisie
    if (createEmployeeDto.nationality) {
      createEmployeeDto.nationality =
        normalizeNationality(createEmployeeDto.nationality) ?? undefined;
    }

    const dept = await this.prisma.department.findUnique({
      where: { id: createEmployeeDto.departmentId },
      select: { companyId: true },
    });
    if (!dept || dept.companyId !== user.companyId) {
      throw new ForbiddenException(
        "Ce département n'appartient pas à votre entreprise.",
      );
    }

    const year = new Date().getFullYear();
    let employeeNumber = '';

    if (createEmployeeDto.employeeNumber?.trim()) {
      const customNumber = createEmployeeDto.employeeNumber.trim();
      const existing = await this.prisma.employee.findFirst({
        where: { employeeNumber: customNumber, companyId: user.companyId },
      });
      if (existing) {
        throw new ConflictException(
          `Le matricule "${customNumber}" est déjà utilisé dans cette entreprise.`,
        );
      }
      employeeNumber = customNumber;
    } else {
      let isUnique = false;
      let attempt = 0;
      while (!isUnique && attempt < 10) {
        const count = await this.prisma.employee.count({
          where: { companyId: user.companyId },
        });
        const sequence = (count + 1 + attempt).toString().padStart(3, '0');
        employeeNumber = `EMP-${year}-${sequence}`;
        const existing = await this.prisma.employee.findFirst({
          where: { employeeNumber, companyId: user.companyId },
        });
        if (!existing) isUnique = true;
        else attempt++;
      }
      if (!employeeNumber)
        throw new ConflictException(
          'Impossible de générer un matricule unique.',
        );
    }

    try {
      // ✅ FIX : extraire seniorityLinearOverride avant le spread pour gérer Prisma.JsonNull
      const {
        dateOfBirth,
        hireDate,
        contractEndDate,
        seniorityLinearOverride,
        ...rest
      } = createEmployeeDto;

      const finalPhotoUrl = rest.photoUrl;
      if (finalPhotoUrl && finalPhotoUrl.startsWith('data:image')) {
        console.warn('⚠️ Photo base64 — à uploader sur Cloudinary.');
      }

      const parsedContractEndDate =
        TEMP_CONTRACTS.includes(rest.contractType) && contractEndDate
          ? new Date(contractEndDate)
          : null;

      const trialDays = rest.trialPeriodDays ? Number(rest.trialPeriodDays) : 0;
      let computedTrialEndDate: Date | null = null;
      let trialStatus: string = 'NONE';

      if (trialDays > 0 && ['CDI', 'CDD'].includes(rest.contractType)) {
        const start = new Date(hireDate);
        computedTrialEndDate = new Date(start);
        computedTrialEndDate.setDate(
          computedTrialEndDate.getDate() + trialDays,
        );
        trialStatus =
          computedTrialEndDate > new Date() ? 'IN_PROGRESS' : 'EXPIRED';
      }

      const isResident = rest.isResident !== undefined ? rest.isResident : true;

      const contractType = rest.contractType;
      let autoIsSubjectToCnss = rest.isSubjectToCnss ?? true;
      let autoIsSubjectToIrpp = rest.isSubjectToIrpp ?? true;
      let autoIsSubjectToTus = (rest as any).isSubjectToTus ?? true;

      if (['CONSULTANT', 'PRESTATAIRE', 'INTERIM'].includes(contractType)) {
        autoIsSubjectToCnss = false;
        autoIsSubjectToIrpp = false;
        autoIsSubjectToTus = false;
      } else if (contractType === 'STAGE') {
        autoIsSubjectToCnss = false;
        autoIsSubjectToTus = false;
      }

      return await this.prisma.$transaction(async (tx) => {
        const newEmployee = await tx.employee.create({
          data: {
            ...rest,
            dateOfBirth: new Date(dateOfBirth),
            hireDate: new Date(hireDate),
            contractEndDate: parsedContractEndDate,
            employeeNumber,
            companyId: user.companyId,
            createdById: userId,
            photoUrl: finalPhotoUrl,
            city: rest.city || 'Brazzaville',
            numberOfChildren: rest.numberOfChildren || 0,
            nationalIdNumber: rest.nationalIdNumber || null,
            trialPeriodDays: trialDays > 0 ? trialDays : null,
            trialEndDate: computedTrialEndDate,
            trialStatus: trialStatus as any,
            isResident,
            nationality: rest.nationality || null,
            isSubjectToCnss: autoIsSubjectToCnss,
            isSubjectToIrpp: autoIsSubjectToIrpp,
            isSubjectToTus: autoIsSubjectToTus,
            // ✅ FIX : Prisma.JsonNull au lieu de null pour les champs Json?
            seniorityLinearOverride: seniorityLinearOverride ?? Prisma.JsonNull,
          },
        });

        await tx.employeeContract.create({
          data: {
            employeeId: newEmployee.id,
            companyId: user.companyId,
            contractType: contractType as any,
            startDate: new Date(hireDate),
            endDate: parsedContractEndDate,
            position: rest.position,
            baseSalary: rest.baseSalary,
            departmentId: rest.departmentId,
            status: trialDays > 0 ? 'TRIAL' : 'ACTIVE',
            trialPeriodDays: trialDays > 0 ? trialDays : null,
            trialEndDate: computedTrialEndDate,
            notes: "Créé automatiquement à l'enregistrement",
          },
        });

        return newEmployee;
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        const field = error.meta?.target?.[0];
        if (field === 'nationalIdNumber')
          throw new ConflictException('Ce numéro CNI est déjà enregistré.');
        if (field === 'cnssNumber')
          throw new ConflictException('Ce numéro CNSS est déjà enregistré.');
        throw new ConflictException(
          'Un employé avec ces informations existe déjà.',
        );
      }
      if (error.code === 'P2000' || error.code === 'P2003') {
        throw new BadRequestException({
          message: 'Erreur de validation',
          details: error.meta,
        });
      }
      throw error;
    }
  }

  async findAll(
    userId: string,
    pagination?: PaginationDto,
  ): Promise<PaginatedResponse<any>> {
    const user = await this.getVerifiedUser(userId);

    if (!CAN_LIST.includes(user.role)) {
      throw new ForbiddenException(
        'Accès non autorisé à la liste des employés.',
      );
    }

    const isCabinet =
      user.role === 'CABINET_ADMIN' || user.role === 'CABINET_GESTIONNAIRE';
    const effectiveCompanyId =
      isCabinet && (pagination as any)?.companyId
        ? (pagination as any).companyId
        : user.companyId;

    if (!effectiveCompanyId) {
      return { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };
    }

    const whereClause: any = {
      companyId: effectiveCompanyId,
      status: 'ACTIVE',
    };

    if (user.role === 'MANAGER') {
      const deptId = await this.getManagerDeptId(user.id, user.companyId);
      if (!deptId)
        return { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };
      whereClause.departmentId = deptId;
    }

    // 🆕 Recherche/filtres — appliqués côté base sur TOUS les employés de l'entreprise,
    // avant pagination, pour que "X employés trouvés" reflète le vrai total, pas juste
    // la page actuellement affichée.
    const search = (pagination as any)?.search?.trim();
    const department = (pagination as any)?.department;
    const contractType = (pagination as any)?.contractType;
    const nationality = (pagination as any)?.nationality; // 🆕 filtre nationalité

    if (search) {
      whereClause.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { employeeNumber: { contains: search, mode: 'insensitive' } },
        { position: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (department && department !== 'Tous') {
      whereClause.department = { name: department };
    }
    if (contractType && contractType !== 'Tous') {
      whereClause.contractType = contractType;
    }
    if (nationality && nationality !== 'Tous') {
      // 🆕 "Non renseigné" = employés sans nationalité en base
      if (nationality === 'Non renseigné') {
        whereClause.nationality = null;
      } else {
        whereClause.nationality = nationality;
      }
    }

    const page = pagination?.page || 1;
    const limit = pagination?.limit || 50;
    const skip = (page - 1) * limit;

    const isManager = user.role === 'MANAGER';

    const [data, total] = await Promise.all([
      this.prisma.employee.findMany({
        where: whereClause,
        select: isManager
          ? SAFE_SELECT_MANAGER
          : {
              id: true,
              employeeNumber: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              photoUrl: true,
              position: true,
              contractType: true,
              contractEndDate: true,
              status: true,
              hireDate: true,
              baseSalary: true,
              department: { select: { id: true, name: true } },
              departmentId: true,
            },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.employee.count({ where: whereClause }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ============================================================
  // 🆕 RÉCAP COMPARATIF — respecte les mêmes filtres que la liste
  // (recherche, département, type de contrat), pour le tableau de bord
  // affiché sous la liste des employés sur la page de gestion.
  // ============================================================
  private readonly SUMMARY_CONTRACT_LABELS: Record<string, string> = {
    CDI: 'CDI',
    CDD: 'CDD',
    STAGE: 'Stagiaire',
    INTERIM: 'Intérimaire',
    CONSULTANT: 'Consultant',
    PRESTATAIRE: 'Prestataire',
  };

  async getSummary(
    userId: string,
    filters?: {
      search?: string;
      department?: string;
      contractType?: string;
      nationality?: string; // 🆕 filtre nationalité
    },
  ) {
    const user = await this.getVerifiedUser(userId);
    if (!CAN_LIST.includes(user.role)) {
      throw new ForbiddenException(
        'Accès non autorisé à la liste des employés.',
      );
    }
    const empty = {
      total: 0,
      byDepartment: [],
      byContractType: [],
      byGender: [],
      byCategory: [],
      byNationality: [], // 🆕
      hasConvention: false,
      agePyramid: [],
      seniorityPyramid: [],
    };
    if (!user.companyId) return empty;

    const whereClause: any = { companyId: user.companyId, status: 'ACTIVE' };
    if (user.role === 'MANAGER') {
      const deptId = await this.getManagerDeptId(user.id, user.companyId);
      if (!deptId) return empty;
      whereClause.departmentId = deptId;
    }

    const search = filters?.search?.trim();
    if (search) {
      whereClause.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { employeeNumber: { contains: search, mode: 'insensitive' } },
        { position: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filters?.department && filters.department !== 'Tous')
      whereClause.department = { name: filters.department };
    if (filters?.contractType && filters.contractType !== 'Tous')
      whereClause.contractType = filters.contractType;
    if (filters?.nationality && filters.nationality !== 'Tous') {
      // 🆕 "Non renseigné" = employés sans nationalité en base
      whereClause.nationality =
        filters.nationality === 'Non renseigné' ? null : filters.nationality;
    }

    const [employees, company] = await Promise.all([
      this.prisma.employee.findMany({
        where: whereClause,
        select: {
          gender: true,
          contractType: true,
          professionalCategory: true,
          dateOfBirth: true,
          hireDate: true,
          nationality: true, // 🆕
          department: { select: { name: true } },
        },
      }),
      this.prisma.company.findUnique({
        where: { id: user.companyId },
        select: { collectiveAgreement: true },
      }),
    ]);

    const total = employees.length;

    const deptCounts = new Map<string, number>();
    for (const e of employees) {
      const d = e.department?.name || 'Sans département';
      deptCounts.set(d, (deptCounts.get(d) || 0) + 1);
    }
    const byDepartment = Array.from(deptCounts, ([name, count]) => ({
      name,
      count,
    })).sort((a, b) => b.count - a.count);

    const contractCounts = new Map<string, number>();
    for (const e of employees)
      contractCounts.set(
        e.contractType,
        (contractCounts.get(e.contractType) || 0) + 1,
      );
    const byContractType = Array.from(contractCounts, ([type, count]) => ({
      type,
      label: this.SUMMARY_CONTRACT_LABELS[type] ?? type,
      count,
    })).sort((a, b) => b.count - a.count);

    const genderCounts = { MALE: 0, FEMALE: 0 };
    for (const e of employees) {
      if (e.gender === 'MALE') genderCounts.MALE++;
      else if (e.gender === 'FEMALE') genderCounts.FEMALE++;
    }
    const byGender = [
      { gender: 'MALE', label: 'Hommes', count: genderCounts.MALE },
      { gender: 'FEMALE', label: 'Femmes', count: genderCounts.FEMALE },
    ];

    const gridCategories = company?.collectiveAgreement
      ? this.conventionsService.getCategoriesByConvention(
          company.collectiveAgreement,
        )
      : [];
    const categoryByCode = new Map(gridCategories.map((c) => [c.code, c]));
    const catCounts = new Map<string, number>();
    for (const e of employees) {
      const code = e.professionalCategory?.trim();
      const cat = code ? categoryByCode.get(code) : undefined;
      const label = cat ? cat.label : code || 'Non catégorisé';
      catCounts.set(label, (catCounts.get(label) || 0) + 1);
    }
    const byCategory = Array.from(catCounts, ([label, count]) => ({
      label,
      count,
    })).sort((a, b) => b.count - a.count);

    // 🆕 Répartition détaillée par nationalité (un pays = une barre, pas juste
    // "Congolais/Étranger") — le champ est déjà normalisé à la création/édition
    // de l'employé (common/utils/nationality.util.ts), donc pas de doublons.
    const natCounts = new Map<string, number>();
    for (const e of employees) {
      const label = e.nationality?.trim() || 'Non renseigné';
      natCounts.set(label, (natCounts.get(label) || 0) + 1);
    }
    const byNationality = Array.from(natCounts, ([label, count]) => ({
      label,
      count,
    })).sort((a, b) => b.count - a.count);

    // 🆕 Pyramide des âges & de l'ancienneté (mêmes tranches que la page Effectifs)
    const now = new Date();
    const ageInYears = (dob: Date) => {
      let age = now.getFullYear() - dob.getFullYear();
      const hadBirthday =
        now.getMonth() > dob.getMonth() ||
        (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
      if (!hadBirthday) age--;
      return age;
    };
    const tenureInYears = (hire: Date) =>
      (now.getTime() - hire.getTime()) / (1000 * 60 * 60 * 24 * 365.25);

    const ageBuckets = [
      { label: '< 25 ans', min: 0, max: 24 },
      { label: '25-34 ans', min: 25, max: 34 },
      { label: '35-44 ans', min: 35, max: 44 },
      { label: '45-54 ans', min: 45, max: 54 },
      { label: '55-59 ans', min: 55, max: 59 },
      { label: '60 ans +', min: 60, max: 999 },
    ];
    const agePyramid = ageBuckets.map((b) => {
      const inBucket = employees.filter(
        (e) =>
          e.dateOfBirth &&
          ageInYears(new Date(e.dateOfBirth)) >= b.min &&
          ageInYears(new Date(e.dateOfBirth)) <= b.max,
      );
      return {
        label: b.label,
        male: inBucket.filter((e) => e.gender === 'MALE').length,
        female: inBucket.filter((e) => e.gender === 'FEMALE').length,
      };
    });

    const tenureBuckets = [
      { label: '< 1 an', min: 0, max: 1 },
      { label: '1-3 ans', min: 1, max: 3 },
      { label: '3-5 ans', min: 3, max: 5 },
      { label: '5-10 ans', min: 5, max: 10 },
      { label: '10 ans +', min: 10, max: 999 },
    ];
    const seniorityPyramid = tenureBuckets.map((b) => {
      const inBucket = employees.filter(
        (e) =>
          e.hireDate &&
          tenureInYears(new Date(e.hireDate)) >= b.min &&
          tenureInYears(new Date(e.hireDate)) < b.max,
      );
      return {
        label: b.label,
        male: inBucket.filter((e) => e.gender === 'MALE').length,
        female: inBucket.filter((e) => e.gender === 'FEMALE').length,
      };
    });

    return {
      total,
      byDepartment,
      byContractType,
      byGender,
      byCategory,
      byNationality, // 🆕
      hasConvention: !!company?.collectiveAgreement,
      agePyramid,
      seniorityPyramid,
    };
  }

  async findAllSimple(userId: string, overrideCompanyId?: string) {
    const user = await this.getVerifiedUser(userId);

    if (!CAN_LIST.includes(user.role)) {
      throw new ForbiddenException('Accès non autorisé.');
    }

    const isCab =
      user.role === 'CABINET_ADMIN' || user.role === 'CABINET_GESTIONNAIRE';
    const effCompanyId =
      isCab && overrideCompanyId ? overrideCompanyId : user.companyId;
    if (!effCompanyId) return [];
    const whereClause: any = { companyId: effCompanyId, status: 'ACTIVE' };

    if (user.role === 'MANAGER') {
      const deptId = await this.getManagerDeptId(user.id, user.companyId);
      if (!deptId) return [];
      whereClause.departmentId = deptId;
    }

    return this.prisma.employee.findMany({
      where: whereClause,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        position: true,
        photoUrl: true,
        employeeNumber: true,
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async findOne(id: string, userId: string) {
    const user = await this.getVerifiedUser(userId);

    if (!CAN_LIST.includes(user.role)) {
      throw new ForbiddenException('Accès non autorisé.');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        department: true,
        leaves: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        assets: {
          where: { status: 'IN_USE' },
        },
        documents: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!employee) throw new NotFoundException('Employé introuvable.');

    if (employee.companyId !== user.companyId) {
      throw new ForbiddenException("Vous n'avez pas accès à cet employé.");
    }

    if (user.role === 'MANAGER') {
      await this.assertManagerCanAccessEmployee(
        user.id,
        user.companyId,
        employee,
      );

      const {
        baseSalary,
        bankName,
        bankAccountNumber,
        mobileMoneyNumber,
        isSubjectToIrpp,
        isSubjectToCnss,
        taxExemptionReason,
        ...safeEmployee
      } = employee as any;

      return {
        ...safeEmployee,
        baseSalary: null,
        bankName: null,
        bankAccountNumber: null,
        mobileMoneyNumber: null,
        isSubjectToIrpp: null,
        isSubjectToCnss: null,
        taxExemptionReason: null,
        payrolls: [],
      };
    }

    const payrolls = await this.prisma.payroll.findMany({
      where: { employeeId: id },
      select: {
        id: true,
        month: true,
        year: true,
        netSalary: true,
        grossSalary: true,
        status: true,
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: 24,
    });

    return { ...employee, payrolls };
  }

  async findByUser(userId: string) {
    const user = await this.getVerifiedUser(userId);

    return this.prisma.employee.findFirst({
      where: { email: user.email ?? undefined, companyId: user.companyId },
      include: { department: true },
    });
  }

  // ============================================================
  // 🆕 AUTO-SERVICE EMPLOYÉ — RH/Admin autorise temporairement l'employé à
  // modifier lui-même certaines infos de son profil (hors contrat/paie).
  // ============================================================

  /** RH/Admin active ou désactive l'auto-service pour un employé donné. */
  async toggleSelfService(id: string, userId: string, enabled: boolean) {
    const user = await this.getVerifiedUser(userId);
    if (!CAN_EDIT.includes(user.role)) {
      throw new ForbiddenException(
        "Vous n'avez pas les droits pour gérer cet accès.",
      );
    }
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException('Employé introuvable.');
    if (employee.companyId !== user.companyId) {
      throw new ForbiddenException("Vous n'avez pas accès à cet employé.");
    }

    const grantedByUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const grantedByName = grantedByUser
      ? `${grantedByUser.firstName} ${grantedByUser.lastName}`.trim()
      : undefined;

    return this.prisma.employee.update({
      where: { id },
      data: {
        selfServiceEnabled: enabled,
        selfServiceEnabledAt: enabled ? new Date() : null,
        selfServiceEnabledBy: enabled ? grantedByName : null,
      } as any,
      select: {
        id: true,
        selfServiceEnabled: true,
        selfServiceEnabledAt: true,
        selfServiceEnabledBy: true,
      } as any,
    });
  }

  /**
   * L'employé met à jour lui-même son profil — uniquement si l'auto-service
   * lui a été accordé, et uniquement sur les champs du DTO liste blanche
   * (SelfServiceUpdateEmployeeDto) : rien de contractuel ni de sensible à la paie.
   */
  async updateOwnProfile(userId: string, dto: Record<string, any>) {
    const employee = await this.findByUser(userId);
    if (!employee) throw new NotFoundException('Profil employé introuvable.');
    if (!(employee as any).selfServiceEnabled) {
      throw new ForbiddenException(
        "La modification de votre profil n'est pas activée pour le moment. Contactez votre RH pour demander l'accès.",
      );
    }

    if (dto.nationality) {
      dto.nationality = normalizeNationality(dto.nationality) ?? undefined;
    }

    return this.prisma.employee.update({
      where: { id: employee.id },
      data: dto,
      include: { department: true },
    });
  }

  async update(
    id: string,
    updateEmployeeDto: UpdateEmployeeDto,
    userId: string,
  ) {
    const user = await this.getVerifiedUser(userId);

    if (!CAN_EDIT.includes(user.role)) {
      throw new ForbiddenException(
        "Vous n'avez pas les droits pour modifier un employé.",
      );
    }

    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException('Employé introuvable.');

    if (employee.companyId !== user.companyId) {
      throw new ForbiddenException("Vous n'avez pas accès à cet employé.");
    }

    // 🆕 Nationalité normalisée — même format en base peu importe la saisie
    if (updateEmployeeDto.nationality) {
      updateEmployeeDto.nationality =
        normalizeNationality(updateEmployeeDto.nationality) ?? undefined;
    }

    // ✅ TÉLÉPHONE : mêmes règles qu'à la création (normalisation + validation + unicité)
    if (updateEmployeeDto.phone && updateEmployeeDto.phone !== employee.phone) {
      let normalizedPhone: string;
      try {
        normalizedPhone = normalizeAndValidatePhone(updateEmployeeDto.phone);
      } catch (e: any) {
        throw new BadRequestException(e.message);
      }
      const phoneTaken = await this.prisma.employee.findFirst({
        where: { phone: normalizedPhone, NOT: { id } }, // ✅ global, cohérent avec le login
      });
      if (phoneTaken) {
        throw new ConflictException(
          `Le numéro "${normalizedPhone}" est déjà utilisé par un autre employé.`,
        );
      }
      updateEmployeeDto.phone = normalizedPhone;
    }

    // ✅ TÉLÉPHONE SECONDAIRE : juste normalisé, pas de validation stricte ni d'unicité
    if (updateEmployeeDto.secondaryPhone) {
      updateEmployeeDto.secondaryPhone =
        normalizePhone(updateEmployeeDto.secondaryPhone) ??
        updateEmployeeDto.secondaryPhone;
    }

    if (updateEmployeeDto.departmentId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: updateEmployeeDto.departmentId },
        select: { companyId: true },
      });
      if (!dept || dept.companyId !== user.companyId) {
        throw new ForbiddenException(
          "Ce département n'appartient pas à votre entreprise.",
        );
      }
    }

    // ✅ FIX : extraire seniorityLinearOverride et passer Prisma.JsonNull si null
    const { seniorityLinearOverride, ...restDto } = updateEmployeeDto;
    const dataToUpdate: any = {
      ...restDto,
      // Si le champ est absent du DTO (undefined), on ne l'inclut pas du tout
      ...(seniorityLinearOverride !== undefined
        ? {
            seniorityLinearOverride: seniorityLinearOverride ?? Prisma.JsonNull,
          }
        : {}),
    };

    if (dataToUpdate.dateOfBirth)
      dataToUpdate.dateOfBirth = new Date(dataToUpdate.dateOfBirth);
    if (dataToUpdate.hireDate)
      dataToUpdate.hireDate = new Date(dataToUpdate.hireDate);
    if (dataToUpdate.terminationDate)
      dataToUpdate.terminationDate = new Date(dataToUpdate.terminationDate);
    else if ('terminationDate' in dataToUpdate && !dataToUpdate.terminationDate)
      dataToUpdate.terminationDate = null;

    const TEMP_CONTRACTS = [
      'CDD',
      'STAGE',
      'INTERIM',
      'CONSULTANT',
      'PRESTATAIRE',
    ];
    if ('contractEndDate' in dataToUpdate) {
      const contractType = dataToUpdate.contractType ?? employee.contractType;
      if (
        TEMP_CONTRACTS.includes(contractType) &&
        dataToUpdate.contractEndDate
      ) {
        dataToUpdate.contractEndDate = new Date(dataToUpdate.contractEndDate);
      } else {
        dataToUpdate.contractEndDate = null;
      }
    }

    const hireDateForTrial =
      dataToUpdate.hireDate ?? new Date(employee.hireDate);
    const trialDays =
      dataToUpdate.trialPeriodDays !== undefined
        ? Number(dataToUpdate.trialPeriodDays)
        : ((employee as any).trialPeriodDays ?? 0);

    const contractTypeForTrial =
      dataToUpdate.contractType ?? employee.contractType;
    if (['CDI', 'CDD'].includes(contractTypeForTrial) && trialDays > 0) {
      const end = new Date(hireDateForTrial);
      end.setDate(end.getDate() + trialDays);
      dataToUpdate.trialEndDate = end;
      const currentStatus = (employee as any).trialStatus ?? 'NONE';
      if (!['CONFIRMED', 'FAILED'].includes(currentStatus)) {
        dataToUpdate.trialStatus = end > new Date() ? 'IN_PROGRESS' : 'EXPIRED';
      }
    } else if (
      dataToUpdate.trialPeriodDays === 0 ||
      dataToUpdate.trialPeriodDays === '0'
    ) {
      dataToUpdate.trialEndDate = null;
      dataToUpdate.trialStatus = 'NONE';
    }

    if (dataToUpdate.contractType) {
      const ct = dataToUpdate.contractType;
      if (['CONSULTANT', 'PRESTATAIRE', 'INTERIM'].includes(ct)) {
        dataToUpdate.isSubjectToCnss = false;
        dataToUpdate.isSubjectToIrpp = false;
        dataToUpdate.isSubjectToTus = false;
      } else if (ct === 'STAGE') {
        dataToUpdate.isSubjectToCnss = false;
        dataToUpdate.isSubjectToTus = false;
        dataToUpdate.isSubjectToIrpp = true;
      } else if (['CDI', 'CDD'].includes(ct)) {
        const prev = employee.contractType;
        if (['CONSULTANT', 'PRESTATAIRE', 'INTERIM', 'STAGE'].includes(prev)) {
          dataToUpdate.isSubjectToCnss = true;
          dataToUpdate.isSubjectToIrpp = true;
          dataToUpdate.isSubjectToTus = true;
        }
      }
    }

    try {
      const updated = await this.prisma.employee.update({
        where: { id },
        data: dataToUpdate,
      });

      // ✅ SYNCHRO : si l'email de l'employé change, on répercute sur le compte
      // User lié (s'il existe) pour éviter toute désynchronisation Employee/User.
      if (
        updateEmployeeDto.email &&
        updateEmployeeDto.email !== employee.email
      ) {
        const linkedUser = await this.prisma.user.findUnique({
          where: { employeeId: id },
        });
        if (linkedUser && linkedUser.email !== updateEmployeeDto.email) {
          try {
            await this.prisma.user.update({
              where: { id: linkedUser.id },
              data: { email: updateEmployeeDto.email },
            });
          } catch (syncError: any) {
            if (syncError.code === 'P2002') {
              throw new ConflictException(
                `Impossible de mettre à jour l'email : "${updateEmployeeDto.email}" est déjà utilisé par un autre compte utilisateur.`,
              );
            }
            throw syncError;
          }
        }
      }

      return updated;
    } catch (error: any) {
      if (error.code === 'P2002') {
        const field = error.meta?.target?.[0];
        if (field === 'nationalIdNumber')
          throw new ConflictException('Ce numéro CNI est déjà utilisé.');
        if (field === 'cnssNumber')
          throw new ConflictException('Ce numéro CNSS est déjà utilisé.');
        throw new ConflictException('Ces informations sont déjà utilisées.');
      }
      throw error;
    }
  }

  async remove(id: string, userId: string) {
    const user = await this.getVerifiedUser(userId);

    if (!CAN_DELETE.includes(user.role)) {
      throw new ForbiddenException(
        'Seuls les administrateurs peuvent supprimer un employé.',
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id },
      select: { id: true, companyId: true, departmentId: true, email: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable.');

    if (employee.companyId !== user.companyId) {
      throw new ForbiddenException("Vous n'avez pas accès à cet employé.");
    }

    if (employee.email) {
      const linkedUser = await this.prisma.user.findFirst({
        where: {
          email: employee.email,
          companyId: user.companyId,
          id: { not: userId },
        },
        select: { id: true },
      });

      if (linkedUser) {
        await this.prisma.user.delete({ where: { id: linkedUser.id } });
      }
    }

    return this.prisma.employee.update({
      where: { id },
      data: {
        status: 'TERMINATED',
        terminationDate: new Date(),
      },
    });
  }
}