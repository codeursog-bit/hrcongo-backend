// ============================================================================
// 📁 chat/chat-policy.service.ts — QUI peut écrire à QUI (source unique de vérité)
// ----------------------------------------------------------------------------
// Règles (symétriques : si A peut écrire à B, B peut écrire à A) :
//   • ADMIN, HR_MANAGER → tout le monde de SA entreprise
//   • MANAGER           → les EMPLOYÉS de son/ses département(s) + HR_MANAGER + ADMIN
//   • EMPLOYEE          → HR_MANAGER + ADMIN + le MANAGER de son département
//   • Employé ↔ employé, manager ↔ manager : interdit
//
// Cette même clause `where` sert à :
//   1. alimenter la liste de contacts (GET /chat/contacts)
//   2. valider l'ouverture d'une conversation
//   3. RE-valider à chaque envoi (si quelqu'un change de département ou est
//      désactivé, il ne peut plus écrire — même dans une conversation existante)
// Toujours filtré par companyId : aucune porte vers une autre entreprise.
// ============================================================================
import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
// ⚠️ ADAPTER le chemin si besoin
import { PrismaService } from '../prisma/prisma.service';
import { CHAT_ROLES, ChatActor, ChatContactDto } from './chat.types';

const CONTACT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  role: true,
  employee: { select: { photoUrl: true, department: { select: { name: true } } } },
} satisfies Prisma.UserSelect;

type ContactRow = Prisma.UserGetPayload<{ select: typeof CONTACT_SELECT }>;

// Seules les vraies URL web courtes sont renvoyées : un éventuel "data:image/..." (base64)
// pèserait des dizaines de Ko dans CHAQUE liste de contacts / conversations.
function safePhotoUrl(raw: string | null | undefined): string | null {
  return raw && /^https?:\/\//i.test(raw) && raw.length <= 600 ? raw : null;
}

export function toContactDto(u: ContactRow): ChatContactDto {
  return {
    id: u.id,
    name: `${u.firstName} ${u.lastName}`.trim(),
    role: u.role,
    department: u.employee?.department?.name ?? null,
    photoUrl: safePhotoUrl(u.employee?.photoUrl),
  };
}

@Injectable()
export class ChatPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Clause Prisma décrivant les personnes que `actor` a le droit de contacter. */
  async contactWhere(actor: ChatActor): Promise<Prisma.UserWhereInput | null> {
    if (!CHAT_ROLES.includes(actor.role)) return null;

    const base: Prisma.UserWhereInput = {
      companyId: actor.companyId,
      isActive: true,
      id: { not: actor.id },
      role: { in: CHAT_ROLES },
    };
    const leadership: Prisma.UserWhereInput = {
      role: { in: [UserRole.ADMIN, UserRole.HR_MANAGER] },
    };

    switch (actor.role) {
      case UserRole.ADMIN:
      case UserRole.HR_MANAGER:
        return base;

      case UserRole.MANAGER: {
        const deptIds = await this.managedDepartmentIds(actor);
        return {
          ...base,
          OR: [
            leadership,
            ...(deptIds.length
              ? [{ role: UserRole.EMPLOYEE, employee: { departmentId: { in: deptIds } } }]
              : []),
          ],
        };
      }

      case UserRole.EMPLOYEE: {
        const managerRefs = await this.myDepartmentManagerRefs(actor);
        return {
          ...base,
          OR: [
            leadership,
            ...(managerRefs.length
              ? [
                  {
                    role: UserRole.MANAGER,
                    OR: [{ id: { in: managerRefs } }, { employeeId: { in: managerRefs } }],
                  },
                ]
              : []),
          ],
        };
      }

      default:
        return null;
    }
  }

  async canMessage(actor: ChatActor, targetUserId: string): Promise<boolean> {
    const where = await this.contactWhere(actor);
    if (!where) return false;
    const n = await this.prisma.user.count({ where: { AND: [where, { id: targetUserId }] } });
    return n > 0;
  }

  async listContacts(actor: ChatActor, q: string | undefined, limit: number): Promise<ChatContactDto[]> {
    const where = await this.contactWhere(actor);
    if (!where) return [];

    const tokens = (q ?? '')
      .trim()
      .slice(0, 60)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4);

    const search: Prisma.UserWhereInput[] = tokens.map((t) => ({
      OR: [
        { firstName: { contains: t, mode: 'insensitive' } },
        { lastName: { contains: t, mode: 'insensitive' } },
      ],
    }));

    const rows = await this.prisma.user.findMany({
      where: { AND: [where, ...search] },
      select: CONTACT_SELECT,
      // enum Postgres : ADMIN < HR_MANAGER < MANAGER < EMPLOYEE (ordre de déclaration)
      orderBy: [{ role: 'asc' }, { firstName: 'asc' }, { lastName: 'asc' }],
      take: Math.min(Math.max(limit, 1), 50),
    });
    return rows.map(toContactDto);
  }

  // ─── Équipe d'un manager ───────────────────────────────────────────────────
  // Department.managerId n'a pas de relation Prisma : on accepte qu'il pointe
  // soit vers User.id soit vers Employee.id (les deux sont des UUID distincts,
  // aucune collision possible). Si le manager ne dirige aucun département
  // explicitement, on se rabat sur le département de sa propre fiche employé.
  private async managedDepartmentIds(actor: ChatActor): Promise<string[]> {
    const me = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { employeeId: true, employee: { select: { departmentId: true } } },
    });
    const refs = [actor.id, me?.employeeId].filter((x): x is string => !!x);
    const depts = await this.prisma.department.findMany({
      where: { companyId: actor.companyId, managerId: { in: refs } },
      select: { id: true },
    });
    if (depts.length) return depts.map((d) => d.id);
    return me?.employee?.departmentId ? [me.employee.departmentId] : [];
  }

  // ─── Manager(s) du département d'un employé ────────────────────────────────
  private async myDepartmentManagerRefs(actor: ChatActor): Promise<string[]> {
    const me = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { employee: { select: { departmentId: true } } },
    });
    const deptId = me?.employee?.departmentId;
    if (!deptId) return [];
    const dept = await this.prisma.department.findFirst({
      where: { id: deptId, companyId: actor.companyId },
      select: { managerId: true },
    });
    return dept?.managerId ? [dept.managerId] : [];
  }
}

export { CONTACT_SELECT };