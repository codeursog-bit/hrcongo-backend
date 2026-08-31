import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard'; // 🆕

@Injectable()
export class DepartmentsService {
  constructor(
    private prisma: PrismaService,
    private subscriptionGuard: SubscriptionGuard, // 🆕
  ) {}

  /**
   * ✅ CRÉER UN DÉPARTEMENT
   */
  async create(createDepartmentDto: CreateDepartmentDto, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user || !user.companyId) {
      throw new ForbiddenException(
        "L'utilisateur n'est pas rattaché à une entreprise.",
      );
    }
    // 🆕 VÉRIFIER LA LIMITE DE DÉPARTEMENTS
    await this.subscriptionGuard.checkLimit(user.companyId, 'maxDepartments');

    // ✅ Génération automatique de couleur
    const color =
      '#' +
      Math.floor(Math.random() * 16777215)
        .toString(16)
        .padStart(6, '0');

    return this.prisma.department.create({
      data: {
        ...createDepartmentDto,
        color,
        companyId: user.companyId,
      },
    });
  }

  /**
   * ✅ LISTE DES DÉPARTEMENTS (avec stats)
   */
  async findAll(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user || !user.companyId) return [];

    const departments = await this.prisma.department.findMany({
      where: { companyId: user.companyId },
      include: {
        _count: {
          select: { employees: true },
        },
        employees: {
          where: { status: 'ACTIVE' },
          include: {
            payrolls: {
              take: 1,
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // ✅ Enrichir avec les statistiques de paie
    return departments.map((dept) => {
      const totalGross = dept.employees.reduce(
        (sum, emp) => sum + Number(emp.payrolls[0]?.grossSalary || 0),
        0,
      );
      const totalNet = dept.employees.reduce(
        (sum, emp) => sum + Number(emp.payrolls[0]?.netSalary || 0),
        0,
      );

      return {
        id: dept.id,
        name: dept.name,
        description: dept.description,
        color: dept.color,
        companyId: dept.companyId,
        createdAt: dept.createdAt,
        updatedAt: dept.updatedAt,
        employeeCount: dept._count.employees,
        activeEmployees: dept.employees.length,
        totalGross: totalGross,
        totalNet: totalNet,
        avgSalary:
          dept.employees.length > 0
            ? Math.floor(totalGross / dept.employees.length)
            : 0,
      };
    });
  }

  /**
   * ✅ DÉTAILS D'UN DÉPARTEMENT
   */
  async findOne(id: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user || !user.companyId) {
      throw new ForbiddenException('Accès non autorisé');
    }

    const department = await this.prisma.department.findUnique({
      where: { id },
      include: {
        employees: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            position: true,
            baseSalary: true,
            email: true,
          },
        },
        _count: {
          select: { employees: true },
        },
      },
    });

    if (!department) {
      throw new NotFoundException('Département non trouvé');
    }

    if (department.companyId !== user.companyId) {
      throw new ForbiddenException("Vous n'avez pas accès à ce département");
    }

    return department;
  }

  /**
   * ✅ SUPPRIMER UN DÉPARTEMENT
   */
  async remove(id: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user || !user.companyId) {
      throw new ForbiddenException('Accès non autorisé');
    }

    const department = await this.prisma.department.findUnique({
      where: { id },
      include: {
        _count: {
          select: { employees: true },
        },
      },
    });

    if (!department) {
      throw new NotFoundException('Département non trouvé');
    }

    if (department.companyId !== user.companyId) {
      throw new ForbiddenException("Vous n'avez pas accès à ce département");
    }

    // ✅ Vérifier qu'il n'y a pas d'employés
    if (department._count.employees > 0) {
      throw new ForbiddenException(
        `Impossible de supprimer ce département car il contient ${department._count.employees} employé(s)`,
      );
    }

    await this.prisma.department.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Département supprimé avec succès',
    };
  }

  /**
   * ✅ STATISTIQUES GLOBALES DES DÉPARTEMENTS
   */
  async getStats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user || !user.companyId) return null;

    const departments = await this.prisma.department.findMany({
      where: { companyId: user.companyId },
      include: {
        _count: {
          select: { employees: true },
        },
        employees: {
          where: { status: 'ACTIVE' },
          include: {
            payrolls: {
              take: 1,
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    const totalEmployees = departments.reduce(
      (sum, d) => sum + d.employees.length,
      0,
    );
    const totalPayroll = departments.reduce((sum, d) => {
      return (
        sum +
        d.employees.reduce(
          (empSum, emp) => empSum + Number(emp.payrolls[0]?.grossSalary || 0),
          0,
        )
      );
    }, 0);

    return {
      totalDepartments: departments.length,
      totalEmployees,
      totalPayroll,
      averageEmployeesPerDept:
        departments.length > 0
          ? Math.round(totalEmployees / departments.length)
          : 0,
      departments: departments.map((d) => ({
        id: d.id,
        name: d.name,
        employeeCount: d.employees.length,
        color: d.color,
      })),
    };
  }
}
