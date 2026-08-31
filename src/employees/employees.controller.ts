// // ============================================================================
// // 📁 src/employees/employees.controller.ts
// // ✅ Tous les accès Prisma passent par le service (plus de bypass)
// // ✅ Guards de rôles déclaratifs
// // ✅ Endpoints cohérents et documentés
// // ============================================================================

// import {
//   Controller,
//   Get,
//   Post,
//   Put,
//   Patch,
//   Delete,
//   Body,
//   Param,
//   Query,
//   UseGuards,
//   Request,
//   HttpException,
//   HttpStatus,
//   ForbiddenException,
// } from '@nestjs/common';
// import { AuthGuard } from '@nestjs/passport';
// import { EmployeesService } from './employees.service';
// import { CreateEmployeeDto } from './dto/create-employee.dto';
// import { UpdateEmployeeDto } from './dto/update-employee.dto';

// // Rôles qui peuvent voir la liste complète
// const LIST_ROLES  = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'MANAGER'];
// const CREATE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];
// const EDIT_ROLES   = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];
// const DELETE_ROLES = ['SUPER_ADMIN', 'ADMIN'];

// @Controller('employees')
// @UseGuards(AuthGuard('jwt'))
// export class EmployeesController {
//   constructor(private readonly employeesService: EmployeesService) {}

//   // ==========================================================================
//   // GET /employees/me — Profil de l'employé connecté (tous rôles)
//   // ==========================================================================
//   @Get('me')
//   async getMyProfile(@Request() req) {
//     try {
//       const employee = await this.employeesService.findByUser(req.user.userId);
//       if (!employee) {
//         throw new HttpException(
//           'Profil employé introuvable. Contactez les RH.',
//           HttpStatus.NOT_FOUND,
//         );
//       }
//       return employee;
//     } catch (error: any) {
//       if (error instanceof HttpException) throw error;
//       throw new HttpException(
//         error.message || 'Erreur lors de la récupération du profil',
//         HttpStatus.INTERNAL_SERVER_ERROR,
//       );
//     }
//   }

//   // ==========================================================================
//   // GET /employees — Liste paginée (ADMIN, HR, MANAGER)
//   // Le service filtre automatiquement selon le rôle
//   // ==========================================================================
//   @Get()
//   async findAll(@Request() req, @Query() query: any) {
//     try {
//       const page  = parseInt(query?.page)  || 1;
//       const limit = parseInt(query?.limit) || 50;
//       return await this.employeesService.findAll(req.user.userId, { page, limit });
//     } catch (error: any) {
//       if (error instanceof HttpException) throw error;
//       throw new HttpException(
//         error.message || 'Erreur lors de la récupération des employés',
//         HttpStatus.INTERNAL_SERVER_ERROR,
//       );
//     }
//   }

//   // ==========================================================================
//   // GET /employees/paginated — Alias pour rétrocompatibilité
//   // ==========================================================================
//   @Get('paginated')
//   async findAllPaginated(@Request() req, @Query() query: any) {
//     return this.findAll(req, query);
//   }

//   // ==========================================================================
//   // GET /employees/simple — Liste légère pour selects/dropdowns (ADMIN, HR, MANAGER)
//   // ==========================================================================
//   @Get('simple')
//   async findAllSimple(@Request() req) {
//     try {
//       return await this.employeesService.findAllSimple(req.user.userId);
//     } catch (error: any) {
//       if (error instanceof HttpException) throw error;
//       throw new HttpException(
//         error.message || 'Erreur',
//         HttpStatus.INTERNAL_SERVER_ERROR,
//       );
//     }
//   }

//   // ==========================================================================
//   // POST /employees — Créer un employé (ADMIN, HR, SUPER_ADMIN seulement)
//   // Le service lève ForbiddenException si le rôle est insuffisant
//   // ==========================================================================
//   @Post()
//   async create(@Body() createEmployeeDto: CreateEmployeeDto, @Request() req) {
//     try {
//       return await this.employeesService.create(createEmployeeDto, req.user.userId);
//     } catch (error: any) {
//       if (error instanceof HttpException) throw error;
//       throw new HttpException(
//         error.message || 'Erreur lors de la création',
//         HttpStatus.INTERNAL_SERVER_ERROR,
//       );
//     }
//   }

//   // ==========================================================================
//   // GET /employees/:id — Détail d'un employé
//   // MANAGER : données expurgées (sans salaire ni fiscalité)
//   // ==========================================================================
//   @Get(':id')
//   async findOne(@Param('id') id: string, @Request() req) {
//     try {
//       return await this.employeesService.findOne(id, req.user.userId);
//     } catch (error: any) {
//       if (error instanceof HttpException) throw error;
//       throw new HttpException(
//         error.message || 'Erreur lors de la récupération',
//         HttpStatus.INTERNAL_SERVER_ERROR,
//       );
//     }
//   }

//   // ==========================================================================
//   // PUT /employees/:id — Modifier (ADMIN, HR, SUPER_ADMIN)
//   // ==========================================================================
//   @Put(':id')
//   async update(
//     @Param('id') id: string,
//     @Body() updateEmployeeDto: UpdateEmployeeDto,
//     @Request() req,
//   ) {
//     try {
//       return await this.employeesService.update(id, updateEmployeeDto, req.user.userId);
//     } catch (error: any) {
//       if (error instanceof HttpException) throw error;
//       throw new HttpException(
//         error.message || 'Erreur lors de la modification',
//         HttpStatus.INTERNAL_SERVER_ERROR,
//       );
//     }
//   }

//   // ==========================================================================
//   // PATCH /employees/:id — Modifier partiel (ADMIN, HR, SUPER_ADMIN)
//   // ==========================================================================
//   @Patch(':id')
//   async updatePartial(
//     @Param('id') id: string,
//     @Body() updateEmployeeDto: UpdateEmployeeDto,
//     @Request() req,
//   ) {
//     return this.update(id, updateEmployeeDto, req);
//   }

//   // ==========================================================================
//   // DELETE /employees/:id — Soft delete (ADMIN, SUPER_ADMIN uniquement)
//   // Passe le statut à TERMINATED, ne supprime pas physiquement
//   // ==========================================================================
//   @Delete(':id')
//   async remove(@Param('id') id: string, @Request() req) {
//     try {
//       return await this.employeesService.remove(id, req.user.userId);
//     } catch (error: any) {
//       if (error instanceof HttpException) throw error;
//       throw new HttpException(
//         error.message || 'Erreur lors de la suppression',
//         HttpStatus.INTERNAL_SERVER_ERROR,
//       );
//     }
//   }
// }

import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpException,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { SelfServiceUpdateEmployeeDto } from './dto/self-service-update-employee.dto';
import { SalaryEstimateService } from './salary-estimate.service';

// Rôles qui peuvent voir la liste complète
const LIST_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'MANAGER'];
const CREATE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];
const EDIT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];
const DELETE_ROLES = ['SUPER_ADMIN', 'ADMIN'];

@Controller('employees')
@UseGuards(AuthGuard('jwt'))
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly salaryEstimateService: SalaryEstimateService,
  ) {}

  // ==========================================================================
  // GET /employees/me — Profil de l'employé connecté (tous rôles)
  // ==========================================================================
  @Get('me')
  async getMyProfile(@Request() req) {
    try {
      const employee = await this.employeesService.findByUser(req.user.userId);
      if (!employee) {
        throw new HttpException(
          'Profil employé introuvable. Contactez les RH.',
          HttpStatus.NOT_FOUND,
        );
      }
      return employee;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || 'Erreur lors de la récupération du profil',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 🆕 RH/Admin autorise ou révoque temporairement l'auto-service pour un employé
   * PATCH /employees/:id/self-service   body: { enabled: boolean }
   */
  @Patch(':id/self-service')
  async toggleSelfService(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ) {
    try {
      return await this.employeesService.toggleSelfService(
        id,
        req.user.userId,
        !!body.enabled,
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Erreur lors de la mise à jour de l'accès",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 🆕 L'employé met à jour lui-même son profil (uniquement si autorisé, et
   * uniquement les champs non contractuels/non liés à la paie)
   * PATCH /employees/me
   */
  @Patch('me')
  async updateMyProfile(
    @Request() req,
    @Body() dto: SelfServiceUpdateEmployeeDto,
  ) {
    try {
      return await this.employeesService.updateOwnProfile(req.user.userId, dto);
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || 'Erreur lors de la mise à jour de votre profil',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // GET /employees — Liste paginée (ADMIN, HR, MANAGER)
  // Le service filtre automatiquement selon le rôle
  // ==========================================================================
  @Get()
  async findAll(@Request() req, @Query() query: any) {
    try {
      const page = parseInt(query?.page) || 1;
      const limit = parseInt(query?.limit) || 50;
      // ✅ FIX BUG 5: passer companyId pour les rôles cabinet
      const companyId = query?.companyId ?? undefined;
      // 🆕 Recherche/filtres — doivent porter sur TOUS les employés, pas seulement la page affichée
      const search = query?.search ?? undefined;
      const department = query?.department ?? undefined;
      const contractType = query?.contractType ?? undefined;
      const nationality = query?.nationality ?? undefined; // 🆕 filtre nationalité
      return await this.employeesService.findAll(req.user.userId, {
        page,
        limit,
        companyId,
        search,
        department,
        contractType,
        nationality,
      } as any);
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || 'Erreur lors de la récupération des employés',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 🆕 Récap comparatif de la page gestion employés — respecte les mêmes filtres
   * (recherche, département, type de contrat) que la liste elle-même.
   * GET /employees/summary
   */
  @Get('summary')
  async getSummary(@Request() req, @Query() query: any) {
    return this.employeesService.getSummary(req.user.userId, {
      search: query?.search ?? undefined,
      department: query?.department ?? undefined,
      contractType: query?.contractType ?? undefined,
      nationality: query?.nationality ?? undefined, // 🆕 filtre nationalité
    });
  }

  // ==========================================================================
  // GET /employees/paginated — Alias pour rétrocompatibilité
  // ==========================================================================
  @Get('paginated')
  async findAllPaginated(@Request() req, @Query() query: any) {
    return this.findAll(req, query);
  }

  // ==========================================================================
  // GET /employees/simple — Liste légère pour selects/dropdowns (ADMIN, HR, MANAGER)
  // ==========================================================================
  @Get('simple')
  async findAllSimple(@Request() req, @Query() query: any) {
    try {
      // ✅ FIX BUG 5: passer companyId pour les rôles cabinet
      const companyId = query?.companyId ?? undefined;
      return await this.employeesService.findAllSimple(
        req.user.userId,
        companyId,
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || 'Erreur',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // POST /employees — Créer un employé (ADMIN, HR, SUPER_ADMIN seulement)
  // Le service lève ForbiddenException si le rôle est insuffisant
  // ==========================================================================
  @Post()
  async create(@Body() createEmployeeDto: CreateEmployeeDto, @Request() req) {
    try {
      return await this.employeesService.create(
        createEmployeeDto,
        req.user.userId,
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || 'Erreur lors de la création',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // GET /employees/:id — Détail d'un employé
  // MANAGER : données expurgées (sans salaire ni fiscalité)
  // ==========================================================================
  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req) {
    try {
      return await this.employeesService.findOne(id, req.user.userId);
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || 'Erreur lors de la récupération',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // GET /employees/:id/salary-estimate — Brut/net contractuel estimé
  // 🆕 Salaire de base + primes MENSUELLES imposables actives, moins
  // CNSS/ITS/TOL uniquement (aucune autre retenue, aucun prêt/avance,
  // indépendant du simulateur de paie complet — voir SalaryEstimateService)
  // ✅ Query params optionnels pour prévisualiser une prime pas encore
  // enregistrée (page primes employé, avant de cliquer "Attribuer") :
  // ?previewAmount=25000&previewTaxable=true&previewCnss=true
  // ==========================================================================
  @Get(':id/salary-estimate')
  async getSalaryEstimate(
    @Param('id') id: string,
    @Request() req,
    @Query('previewAmount') previewAmount?: string,
    @Query('previewTaxable') previewTaxable?: string,
    @Query('previewCnss') previewCnss?: string,
  ) {
    try {
      const employee = await this.employeesService.findOne(id, req.user.userId);
      const preview =
        previewAmount != null && Number(previewAmount) > 0
          ? {
              amount: Number(previewAmount),
              isTaxable: previewTaxable !== 'false',
              isCnss: previewCnss !== 'false',
            }
          : undefined;
      return await this.salaryEstimateService.estimate(employee as any, preview);
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Erreur lors du calcul de l'estimation salariale",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // PUT /employees/:id — Modifier (ADMIN, HR, SUPER_ADMIN)
  // ==========================================================================
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
    @Request() req,
  ) {
    try {
      return await this.employeesService.update(
        id,
        updateEmployeeDto,
        req.user.userId,
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || 'Erreur lors de la modification',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // PATCH /employees/:id — Modifier partiel (ADMIN, HR, SUPER_ADMIN)
  // ==========================================================================
  @Patch(':id')
  async updatePartial(
    @Param('id') id: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
    @Request() req,
  ) {
    return this.update(id, updateEmployeeDto, req);
  }

  // ==========================================================================
  // DELETE /employees/:id — Soft delete (ADMIN, SUPER_ADMIN uniquement)
  // Passe le statut à TERMINATED, ne supprime pas physiquement
  // ==========================================================================
  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req) {
    try {
      return await this.employeesService.remove(id, req.user.userId);
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || 'Erreur lors de la suppression',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}