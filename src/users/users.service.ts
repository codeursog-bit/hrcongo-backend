import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import * as bcrypt from 'bcrypt';
import { MailService } from '../mail/mail.service';
import { UserRole } from '@prisma/client';
import { User } from '@prisma/client';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard'; // 🆕

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private subscriptionGuard: SubscriptionGuard, // 🆕
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const { email, password, firstName, lastName } = createUserDto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Cet email est déjà utilisé');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    return this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        role: 'ADMIN',
      },
    });
  }

  async inviteUser(adminId: string, inviteDto: InviteUserDto) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { companyId: true, role: true },
    });

    if (!admin || !admin.companyId) {
      throw new ForbiddenException(
        'Vous devez appartenir à une entreprise pour inviter.',
      );
    }
    // 🆕 Ajouter après vérification admin
    await this.subscriptionGuard.checkLimit(admin.companyId, 'maxUsers');

    const existing = await this.prisma.user.findUnique({
      where: { email: inviteDto.email },
    });

    if (existing) {
      throw new ConflictException('Cet utilisateur existe déjà.');
    }

    const hashedPassword = await bcrypt.hash(inviteDto.password, 10);

    // ✅ VÉRIFIER SI UN EMPLOYÉ EXISTE DÉJÀ AVEC CET EMAIL
    const existingEmployee = await this.prisma.employee.findFirst({
      where: {
        email: inviteDto.email,
        companyId: admin.companyId,
      },
      include: { user: true }, // ✅ pour détecter si un compte est déjà lié à cet employé
    });

    // ✅ GARDE-FOU : un employé ne peut avoir qu'un seul compte (User.employeeId est unique).
    // Si un compte existe déjà, on refuse clairement plutôt que de planter sur la contrainte unique.
    if (existingEmployee?.user) {
      throw new ConflictException(
        `${existingEmployee.firstName} ${existingEmployee.lastName} a déjà un compte utilisateur (${existingEmployee.user.email}). ` +
          `Modifiez son email directement depuis sa fiche employé plutôt que d'en créer un nouveau.`,
      );
    }

    let employeeId: string | null = null;
    let employeePhone: string | null = null; // ✅ AJOUT : téléphone à lier au compte user

    if (existingEmployee) {
      // ✅ CAS 1 : Employé existe déjà (importé via CSV par exemple)
      this.logger.log(
        `🔗 Liaison user → employé existant : ${existingEmployee.firstName} ${existingEmployee.lastName}`,
      );
      employeeId = existingEmployee.id;
      // ✅ On ne garde le téléphone que s'il a été réellement renseigné (pas le placeholder d'import)
      if (existingEmployee.phone) {
        employeePhone = existingEmployee.phone;
      }

      // Mettre à jour le prénom/nom de l'employé si différent
      if (
        existingEmployee.firstName !== inviteDto.firstName ||
        existingEmployee.lastName !== inviteDto.lastName
      ) {
        await this.prisma.employee.update({
          where: { id: existingEmployee.id },
          data: {
            firstName: inviteDto.firstName,
            lastName: inviteDto.lastName,
          },
        });
        this.logger.log(
          `✏️ Mise à jour nom employé : ${inviteDto.firstName} ${inviteDto.lastName}`,
        );
      }
    } else if (inviteDto.role === 'EMPLOYEE' || inviteDto.role === 'MANAGER') {
      // ✅ CAS 2 : Créer une fiche employé pour EMPLOYEE/MANAGER
      const matricule = `EMP-${Date.now().toString().slice(-6)}`;

      const newEmployee = await this.prisma.employee.create({
        data: {
          firstName: inviteDto.firstName,
          lastName: inviteDto.lastName,
          email: inviteDto.email,
          departmentId:
            inviteDto.departmentId ||
            (await this.getDefaultDepartmentId(admin.companyId)),
          companyId: admin.companyId,
          employeeNumber: matricule,
          position:
            inviteDto.role === 'MANAGER' ? 'Chef de Département' : 'Employé',
          phone: null, // ✅ null (pas de placeholder texte) : compatible avec la contrainte @unique
          address: 'À renseigner',
          gender: 'MALE',
          maritalStatus: 'SINGLE',
          dateOfBirth: new Date('1990-01-01'),
          placeOfBirth: 'À renseigner',
          hireDate: new Date(),
          contractType: 'CDI',
          baseSalary: 0,
        },
      });

      employeeId = newEmployee.id;
      this.logger.log(`✅ Nouvelle fiche employé créée : ${matricule}`);
    }

    // ✅ CRÉER L'UTILISATEUR AVEC LIAISON employeeId
    // (le téléphone n'est jamais stocké ici — il reste uniquement sur Employee.phone ;
    // le login par téléphone passe par la relation Employee → User)
    const newUser = await this.prisma.user.create({
      data: {
        email: inviteDto.email,
        firstName: inviteDto.firstName,
        lastName: inviteDto.lastName,
        password: hashedPassword,
        role: inviteDto.role as UserRole,
        companyId: admin.companyId,
        employeeId: employeeId, // ✅ LIAISON CRITIQUE ICI !
        isActive: true,
        mustChangePassword: true,
      },
    });

    this.logger.log(
      `✅ Utilisateur créé : ${newUser.email} (role: ${newUser.role}, employeeId: ${employeeId || 'null'}, phone lié: ${employeePhone || 'aucun'})`,
    );

    // Envoyer email — on informe aussi du numéro de l'employé comme identifiant
    // de connexion alternatif si disponible (jamais persisté sur User, juste
    // transmis à l'email et à la réponse API pour affichage/partage).
    try {
      await this.mailService.sendUserConfirmation(
        { ...newUser, phone: employeePhone },
        inviteDto.password,
      );
      this.logger.log(`📧 Email envoyé à ${newUser.email}`);
    } catch (e) {
      this.logger.warn(`⚠️ Échec envoi email : ${e.message}`);
    }

    // ✅ On renvoie le téléphone dans la réponse (pas en DB) pour que le front
    // puisse l'afficher dans le message de partage WhatsApp/SMS.
    return { ...newUser, phone: employeePhone };
  }

  /**
   * ✅ Obtenir le département par défaut de l'entreprise
   */
  private async getDefaultDepartmentId(companyId: string): Promise<string> {
    const dept = await this.prisma.department.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });

    if (!dept) {
      throw new NotFoundException(
        'Aucun département trouvé dans cette entreprise',
      );
    }

    return dept.id;
  }

  async findOne(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findAllByCompany(currentUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: currentUserId },
      select: { companyId: true },
    });

    if (!user || !user.companyId) return [];

    return this.prisma.user.findMany({
      where: { companyId: user.companyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isActive: true,
        canRecordAttendanceForAll: true, // 🆕 permission "secrétaire" pointage
        lastLoginAt: true,
        createdAt: true,
        employeeId: true, // ✅ Inclure pour debug
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id },
      data: {
        ...updateUserDto,
        role: updateUserDto.role as UserRole | undefined,
      },
    });
  }

  // 🆕 Suppression d'un utilisateur — réservée aux Admin/Super Admin de la même entreprise
  async remove(id: string, requestingUserId: string) {
    const requester = await this.prisma.user.findUnique({
      where: { id: requestingUserId },
      select: { id: true, companyId: true, role: true },
    });
    if (!requester || !['ADMIN', 'SUPER_ADMIN'].includes(requester.role)) {
      throw new ForbiddenException(
        "Vous n'avez pas les droits pour supprimer un utilisateur.",
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, companyId: true, role: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable.');
    if (target.companyId !== requester.companyId) {
      throw new ForbiddenException("Vous n'avez pas accès à cet utilisateur.");
    }
    if (target.id === requester.id) {
      throw new ForbiddenException(
        'Vous ne pouvez pas supprimer votre propre compte.',
      );
    }

    // Ne jamais laisser une entreprise sans aucun admin
    if (['ADMIN', 'SUPER_ADMIN'].includes(target.role)) {
      const adminCount = await this.prisma.user.count({
        where: {
          companyId: target.companyId,
          role: { in: ['ADMIN', 'SUPER_ADMIN'] },
        },
      });
      if (adminCount <= 1) {
        throw new ForbiddenException(
          "Impossible de supprimer le dernier administrateur de l'entreprise.",
        );
      }
    }

    try {
      await this.prisma.user.delete({ where: { id } });
      return { success: true };
    } catch (err: any) {
      // Contrainte de clé étrangère (ex: enregistrements liés qui bloquent la suppression réelle)
      if (err?.code === 'P2003' || err?.code === 'P2014') {
        throw new ForbiddenException(
          'Impossible de supprimer cet utilisateur : des données lui sont liées (historique, notifications…). Désactivez-le plutôt.',
        );
      }
      throw err;
    }
  }
}
