import {
  Controller,
  Get,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // Ton guard JWT
import { RolesGuard } from '../auth/guards/roles.guard'; // Si tu as un guard de rôles
import { Roles } from '../auth/decorators/roles.decorator'; // Ton décorateur
import { UnpaidSalaryService } from './unpaid-salary.service';

@Controller('unpaid-salary')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UnpaidSalaryController {
  constructor(private readonly service: UnpaidSalaryService) {}

  // Résumé global pour le dashboard de l'entreprise
  @Get('dashboard')
  @Roles('ADMIN', 'HR_MANAGER') // Seuls les chefs voient ça
  async getDashboard(@Request() req: any) {
    return this.service.getDashboard(req.user.id);
  }

  // Stats rapides (pour une badge de notification par exemple)
  @Get('stats')
  @Roles('ADMIN', 'HR_MANAGER')
  async getStats(@Request() req: any) {
    return this.service.getCompanyStats(req.user.companyId);
  }

  // Historique spécifique d'un employé (ex: pour sa fiche perso)
  @Get('employee/:id/timeline')
  async getTimeline(@Param('id') id: string, @Request() req: any) {
    // Sécurité : Un employé ne peut voir que sa propre timeline,
    // SAUF si c'est un Admin/RH
    if (req.user.role === 'EMPLOYEE' && req.user.employeeId !== id) {
      throw new ForbiddenException(
        "Vous ne pouvez pas voir les impayés d'un collègue !",
      );
    }

    return this.service.getEmployeeUnpaidTimeline(id, req.user.companyId);
  }
}
