import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { PortfolioMembershipService } from '../portfolio-membership.service';

// 🆕 Inviter un co-admin "même rôle" sur son portefeuille — même principe
// que invitePmeAdmin/acceptInvitation du Cabinet (token + email), mais :
// - companyId reste null sur l'invitation (pas UNE entreprise, TOUTES)
// - à l'acceptation, on copie les entreprises ACTUELLES de l'inviteur
//   (dynamique : si l'inviteur en a ajouté depuis l'envoi, le nouveau
//   co-admin en hérite aussi — cohérent avec "mêmes droits que moi")
@Injectable()
export class PortfolioTeamService {
  constructor(
    private prisma: PrismaService,
    private membership: PortfolioMembershipService,
    private mail: MailService,
  ) {}

  async invite(
    inviterUserId: string,
    dto: { email: string; firstName: string; lastName: string },
  ) {
    await this.membership.assertCanUsePortfolio(inviterUserId);
    const inviterUser = await this.prisma.user.findUnique({
      where: { id: inviterUserId },
      select: { firstName: true, lastName: true },
    });

    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) throw new ConflictException(`Un compte existe déjà pour ${dto.email}`);

    const pendingInvite = await this.prisma.userInvitation.findFirst({
      where: { email: dto.email, accepted: false, expiresAt: { gt: new Date() } },
    });
    if (pendingInvite) throw new ConflictException('Une invitation est déjà en attente pour cet email');

    const companyIds = await this.membership.getLinkedCompanyIds(inviterUserId);
    if (companyIds.length === 0)
      throw new BadRequestException('Ajoutez au moins une entreprise avant d\'inviter un co-admin.');

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await this.prisma.userInvitation.create({
      data: {
        email: dto.email,
        role: 'ADMIN',
        token,
        expiresAt,
        invitedBy: inviterUserId,
        companyId: null,
        manageMultipleCompanies: true,
      },
    });

    const inviterName = `${inviterUser?.firstName ?? ''} ${inviterUser?.lastName ?? ''}`.trim() || 'Un administrateur';

    try {
      await this.mail.sendPortfolioCoAdminInvitation({
        to: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        inviterName,
        companyCount: companyIds.length,
        invitationToken: token,
        expiresAt,
      });
    } catch {
      // Email non configuré → le lien reste disponible côté front pour copier/coller
    }

    return { success: true, email: dto.email, expiresAt, token, invitationId: invitation.id };
  }

  async listInvitations(inviterUserId: string) {
    await this.membership.assertCanUsePortfolio(inviterUserId);
    return this.prisma.userInvitation.findMany({
      where: { invitedBy: inviterUserId, manageMultipleCompanies: true },
      select: { id: true, email: true, accepted: true, acceptedAt: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInvitationInfo(token: string) {
    const inv = await this.prisma.userInvitation.findUnique({ where: { token } });
    if (!inv || inv.accepted) throw new BadRequestException('Lien invalide ou déjà utilisé');
    if (new Date() > inv.expiresAt) throw new BadRequestException('Lien expiré');
    if (!inv.manageMultipleCompanies)
      throw new BadRequestException('Ce lien ne correspond pas à une invitation portefeuille');

    const inviter = await this.prisma.user.findUnique({
      where: { id: inv.invitedBy },
      select: { firstName: true, lastName: true },
    });
    const companyIds = await this.membership.getLinkedCompanyIds(inv.invitedBy);

    return {
      email: inv.email,
      inviterName: `${inviter?.firstName ?? ''} ${inviter?.lastName ?? ''}`.trim(),
      companyCount: companyIds.length,
    };
  }

  async acceptInvitation(token: string, password: string, firstName?: string, lastName?: string) {
    const inv = await this.prisma.userInvitation.findUnique({ where: { token } });
    if (!inv || inv.accepted) throw new BadRequestException('Lien invalide ou déjà utilisé');
    if (new Date() > inv.expiresAt) throw new BadRequestException('Lien expiré. Demandez une nouvelle invitation.');
    if (!inv.manageMultipleCompanies)
      throw new BadRequestException('Ce lien ne correspond pas à une invitation portefeuille');

    const existing = await this.prisma.user.findUnique({ where: { email: inv.email } });
    if (existing) throw new ConflictException('Un compte existe déjà avec cet email');

    const inviter = await this.prisma.user.findUnique({
      where: { id: inv.invitedBy },
      select: { maxCompanies: true },
    });
    // Copie DYNAMIQUE des entreprises actuelles de l'inviteur (voir commentaire en tête de fichier).
    const companyIds = await this.membership.getLinkedCompanyIds(inv.invitedBy);
    if (companyIds.length === 0)
      throw new BadRequestException("L'invitant n'a plus d'entreprise dans son portefeuille.");

    const hashedPwd = await bcrypt.hash(password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: inv.email,
          password: hashedPwd,
          firstName: firstName ?? inv.email.split('@')[0],
          lastName: lastName ?? '',
          role: 'ADMIN',
          manageMultipleCompanies: true,
          maxCompanies: inviter?.maxCompanies ?? 5,
          companyId: companyIds[0], // entreprise active par défaut à la 1ère connexion
          isActive: true,
        },
      });
      await tx.userCompany.createMany({
        data: companyIds.map((companyId) => ({ userId: newUser.id, companyId })),
      });
      await tx.userInvitation.update({
        where: { id: inv.id },
        data: { accepted: true, acceptedAt: new Date() },
      });
      return newUser;
    });

    return { success: true, userId: user.id, companiesCount: companyIds.length };
  }
}