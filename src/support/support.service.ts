import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, SupportTicket, User } from '@prisma/client';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  decryptChatText,
  encryptChatText,
  isChatCryptoReady,
} from '../chat/chat-crypto';
import {
  SupportAgentCreateDto,
  SupportCreateDto,
  SupportMessagesDto,
  SupportSendDto,
  SupportUpdateDto,
} from './support.dto';
const staffRoles = ['SUPER_ADMIN', 'SUPPORT'];
// Le support Konza est réservé aux administrateurs : ni employés ni managers.
const supportBlockedRoles = ['EMPLOYEE', 'MANAGER'];
type Actor = Pick<User, 'id' | 'role' | 'firstName' | 'lastName' | 'email'>;
type Tx = Prisma.TransactionClient;
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
@Injectable()
export class SupportService {
  constructor(
    private readonly db: PrismaService,
    private readonly mail: MailService,
  ) {}
  async actor(id: string, staff = false, superOnly = false): Promise<Actor> {
    const a = await this.db.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        isActive: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    });
    if (
      !a?.isActive ||
      (staff && !staffRoles.includes(a.role)) ||
      (superOnly && a.role !== 'SUPER_ADMIN')
    )
      throw new ForbiddenException('Accès au support refusé.');
    if (!staff && supportBlockedRoles.includes(a.role))
      throw new ForbiddenException(
        'Le support Konza est réservé aux administrateurs de l’entreprise.',
      );
    return a;
  }
  private crypto() {
    if (!isChatCryptoReady())
      throw new ServiceUnavailableException(
        'Le support est temporairement indisponible.',
      );
  }
  private async accessible(id: string, a: Actor, staff: boolean) {
    const ticket = await this.db.supportTicket.findFirst({
      where: { id, ...(!staff ? { requesterId: a.id } : {}) },
    });
    if (!ticket) throw new NotFoundException('Conversation introuvable.');
    return ticket;
  }
  private view(t: any, staff: boolean) {
    return {
      id: t.id,
      subject: t.subject,
      category: t.category,
      status: t.status,
      priority: t.priority,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      unread: staff
        ? t.lastCustomerSeq > t.staffReadSeq
        : t.lastStaffSeq > t.requesterReadSeq,
      ...(staff
        ? {
            requesterName: t.requesterName,
            requesterEmail: t.requesterEmail,
            companyLabel: t.companyLabel,
            source: t.contactId ? 'CONTACT' : 'APP',
            assigneeId: t.assigneeId,
            assignee: t.assignee
              ? {
                  id: t.assignee.id,
                  name: t.assignee.firstName + ' ' + t.assignee.lastName,
                }
              : null,
          }
        : {}),
      lastPreview: t.messages?.[0]
        ? decryptChatText(t.messages[0].body, t.id).slice(0, 100)
        : null,
    };
  }
  private message(m: any) {
    return {
      id: m.id,
      seq: m.seq,
      body: decryptChatText(m.body, m.ticketId),
      side: m.side,
      internal: m.internal,
      createdAt: m.createdAt,
      clientId: m.clientId,
      ...(m.author && m.side === 'STAFF'
        ? { authorName: m.author.firstName + ' ' + m.author.lastName }
        : {}),
    };
  }
  async list(a: Actor, staff: boolean, offset = 0, status?: string) {
    this.crypto();
    if (staff) await this.importContacts();
    const where = {
      ...(!staff ? { requesterId: a.id } : {}),
      ...(status ? { status } : {}),
    };
    const [rows, total, unreadTotal] = await this.db.$transaction([
      this.db.supportTicket.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: 20,
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true } },
          messages: {
            where: staff ? {} : { internal: false },
            orderBy: { seq: 'desc' },
            take: 1,
          },
        },
      }),
      this.db.supportTicket.count({ where }),
      this.db.supportTicket.count({
        where: {
          ...(!staff ? { requesterId: a.id } : {}),
          ...(staff
            ? {
                lastCustomerSeq: {
                  gt: this.db.supportTicket.fields.staffReadSeq,
                },
              }
            : {
                lastStaffSeq: {
                  gt: this.db.supportTicket.fields.requesterReadSeq,
                },
              }),
        },
      }),
    ]);
    return {
      tickets: rows.map((t) => this.view(t, staff)),
      total,
      unreadTotal,
      pendingContacts: staff
        ? await this.db.contactMessage.count({ where: { supportTicket: null } })
        : 0,
      offset,
      limit: 20,
    };
  }
  private async rate(tx: Tx, a: Actor) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM users WHERE id=${a.id}::uuid FOR UPDATE`,
    );
    if (
      (await tx.supportMessage.count({
        where: {
          authorId: a.id,
          createdAt: { gte: new Date(Date.now() - 60000) },
        },
      })) >= 20
    )
      throw new HttpException(
        'Trop de messages. Réessayez dans une minute.',
        429,
      );
  }
  async create(a: Actor, dto: SupportCreateDto) {
    this.crypto();
    const body = dto.body.trim(),
      subject = dto.subject.trim();
    if (!body || subject.length < 3)
      throw new BadRequestException('Précisez le sujet et votre message.');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM users WHERE id=${a.id}::uuid FOR UPDATE`,
      );
      const prior = await tx.supportMessage.findFirst({
        where: { authorId: a.id, clientId: dto.clientId, side: 'CUSTOMER' },
      });
      if (prior) return { id: prior.ticketId };
      await this.rate(tx, a);
      if (
        (await tx.supportTicket.count({
          where: { requesterId: a.id, status: { not: 'RESOLVED' } },
        })) >= 20
      )
        throw new BadRequestException(
          'Répondez à une conversation existante ou clôturez une demande.',
        );
      const account = await tx.user.findUnique({
        where: { id: a.id },
        select: { company: { select: { legalName: true } } },
      });
      const t = await tx.supportTicket.create({
        data: {
          requesterId: a.id,
          requesterName: a.firstName + ' ' + a.lastName,
          requesterEmail: a.email,
          companyLabel: account?.company?.legalName.slice(0, 150) || null,
          subject,
          category: dto.category,
        },
      });
      const m = await tx.supportMessage.create({
        data: {
          ticketId: t.id,
          authorId: a.id,
          side: 'CUSTOMER',
          body: encryptChatText(body, t.id),
          clientId: dto.clientId,
        },
      });
      await tx.supportTicket.update({
        where: { id: t.id },
        data: { lastCustomerSeq: m.seq, requesterReadSeq: m.seq },
      });
      return { id: t.id };
    });
  }
  async messages(
    a: Actor,
    id: string,
    staff: boolean,
    q: SupportMessagesDto = {},
  ) {
    const t = await this.accessible(id, a, staff);
    return this.read(t, staff, q);
  }
  private async read(
    t: SupportTicket,
    staff: boolean,
    q: SupportMessagesDto = {},
  ) {
    this.crypto();
    if (q.after !== undefined && q.before !== undefined)
      throw new BadRequestException('Un seul curseur est permis.');
    const rows = await this.db.supportMessage.findMany({
      where: {
        ticketId: t.id,
        ...(!staff ? { internal: false } : {}),
        ...(q.after !== undefined
          ? { seq: { gt: q.after } }
          : q.before
            ? { seq: { lt: q.before } }
            : {}),
      },
      orderBy: { seq: q.after !== undefined ? 'asc' : 'desc' },
      take: 100,
      include: { author: { select: { firstName: true, lastName: true } } },
    });
    if (q.after === undefined) rows.reverse();
    const latest = rows.at(-1)?.seq;
    if (latest) {
      const key = staff ? 'staffReadSeq' : 'requesterReadSeq';
      await this.db.supportTicket.updateMany({
        where: { id: t.id, [key]: { lt: latest } },
        data: { [key]: latest },
      });
    }
    return {
      ticket: this.view(t, staff),
      messages: rows.map((m) => this.message(m)),
      hasMore: rows.length === 100,
    };
  }
  async send(a: Actor, id: string, staff: boolean, dto: SupportSendDto) {
    const t = await this.accessible(id, a, staff);
    if (dto.internal && !staff)
      throw new ForbiddenException('Note interne interdite.');
    return this.append(t, staff, dto, a);
  }
  private async append(
    t: SupportTicket,
    staff: boolean,
    dto: SupportSendDto,
    a?: Actor,
  ) {
    this.crypto();
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Écrivez un message.');
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM support_tickets WHERE id=${t.id}::uuid FOR UPDATE`,
      );
      const prior = await tx.supportMessage.findUnique({
        where: {
          ticketId_clientId: { ticketId: t.id, clientId: dto.clientId },
        },
      });
      if (prior) {
        if (
          prior.authorId !== (a?.id ?? null) ||
          prior.side !== (staff ? 'STAFF' : 'CUSTOMER') ||
          (!staff && prior.internal)
        )
          throw new ConflictException('Identifiant de message déjà utilisé.');
        return {
          message: this.message(prior),
          new: false,
          trackingPath: undefined as string | undefined,
        };
      }
      if (a) await this.rate(tx, a);
      else if (
        (await tx.supportMessage.count({
          where: {
            ticketId: t.id,
            side: 'CUSTOMER',
            createdAt: { gte: new Date(Date.now() - 60000) },
          },
        })) >= 10
      )
        throw new HttpException('Réessayez dans une minute.', 429);
      const m = await tx.supportMessage.create({
        data: {
          ticketId: t.id,
          authorId: a?.id,
          side: staff ? 'STAFF' : 'CUSTOMER',
          internal: staff && dto.internal === true,
          clientId: dto.clientId,
          body: encryptChatText(body, t.id),
        },
      });
      await tx.supportTicket.update({
        where: { id: t.id },
        data: {
          updatedAt: new Date(),
          ...(!dto.internal
            ? staff
              ? {
                  lastStaffSeq: m.seq,
                  staffReadSeq: m.seq,
                  status: 'IN_PROGRESS',
                }
              : {
                  lastCustomerSeq: m.seq,
                  requesterReadSeq: m.seq,
                  status: 'OPEN',
                }
            : {}),
        },
      });
      if (staff && a)
        await this.audit(tx, a, 'SUPPORT_REPLY', t.id, {
          internal: !!dto.internal,
        });
      let trackingPath: string | undefined;
      if (staff && !dto.internal && t.contactId && !t.requesterId) {
        const current = await tx.supportTicket.findUniqueOrThrow({
          where: { id: t.id },
        });
        if (
          !current.guestTokenHash ||
          !current.guestExpiresAt ||
          current.guestExpiresAt < new Date()
        )
          trackingPath = await this.rotateGuestLink(tx, t.id);
      }
      return { message: this.message(m), new: true, trackingPath };
    });
    let notificationSent: boolean | undefined;
    if (staff && !dto.internal && result.new) {
      try {
        notificationSent = result.trackingPath
          ? await this.mail.sendSupportReceipt(
              t.requesterEmail,
              result.trackingPath,
            )
          : await this.mail.sendSupportNotice(t.requesterEmail);
      } catch {
        notificationSent = false;
      }
    }
    return {
      ...result.message,
      ...(notificationSent !== undefined ? { notificationSent } : {}),
    };
  }
  async update(a: Actor, id: string, dto: SupportUpdateDto) {
    await this.accessible(id, a, true);
    if (dto.assigneeId) {
      const u = await this.db.user.findFirst({
        where: {
          id: dto.assigneeId,
          isActive: true,
          role: { in: ['SUPER_ADMIN', 'SUPPORT'] },
        },
      });
      if (!u) throw new BadRequestException('Agent indisponible.');
    }
    return this.db.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.update({
        where: { id },
        data: { ...dto, updatedAt: new Date() },
      });
      await this.audit(tx, a, 'SUPPORT_UPDATED', id, { ...dto });
      return this.view(ticket, true);
    });
  }
  private async rotateGuestLink(tx: Tx, id: string) {
    const token = randomBytes(32).toString('hex');
    await tx.supportTicket.update({
      where: { id },
      data: {
        guestTokenHash: hash(token),
        guestExpiresAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    return '/contact/suivi#' + new URLSearchParams({ id, token }).toString();
  }
  async resendGuestLink(a: Actor, id: string) {
    const ticket = await this.accessible(id, a, true);
    if (!ticket.contactId || ticket.requesterId)
      throw new BadRequestException(
        'Cette conversation utilise un compte connecté.',
      );
    const path = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM support_tickets WHERE id=${id}::uuid FOR UPDATE`,
      );
      const link = await this.rotateGuestLink(tx, id);
      await this.audit(tx, a, 'SUPPORT_LINK_RENEWED', id);
      return link;
    });
    let sent = false;
    try {
      sent = await this.mail.sendSupportReceipt(ticket.requesterEmail, path);
    } catch {}
    return { sent };
  }
  private audit(
    tx: Tx,
    a: Actor,
    action: string,
    id: string,
    metadata: Prisma.InputJsonObject = {},
  ) {
    return tx.activityLog.create({
      data: {
        userId: a.id,
        action,
        entity: 'SUPPORT',
        entityId: id,
        description: 'Gestion d’une demande de support.',
        metadata,
      },
    });
  }
  async agents(a: Actor) {
    return this.db.user.findMany({
      where: { role: { in: ['SUPER_ADMIN', 'SUPPORT'] } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isActive: true,
        role: true,
        ...(a.role === 'SUPER_ADMIN' ? { email: true } : {}),
      },
      orderBy: { firstName: 'asc' },
    });
  }
  async createAgent(a: Actor, dto: SupportAgentCreateDto) {
    const password = await bcrypt.hash(dto.password, 12);
    try {
      return await this.db.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: dto.email.trim().toLowerCase(),
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            password,
            role: 'SUPPORT',
            mustChangePassword: true,
            createdBy: a.id,
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            isActive: true,
          },
        });
        await this.audit(tx, a, 'SUPPORT_AGENT_CREATED', u.id);
        return u;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException('Cette adresse est déjà utilisée.');
      throw e;
    }
  }
  async updateAgent(a: Actor, id: string, isActive: boolean) {
    if (!(await this.db.user.findFirst({ where: { id, role: 'SUPPORT' } })))
      throw new NotFoundException('Agent introuvable.');
    return this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive } });
      if (!isActive)
        await tx.userSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await this.audit(tx, a, 'SUPPORT_AGENT_UPDATED', id, { isActive });
      return { ok: true };
    });
  }
  async guest(id: string, token: string) {
    const t = await this.db.supportTicket.findUnique({ where: { id } });
    const supplied = hash(token);
    if (
      !t?.guestTokenHash ||
      !t.guestExpiresAt ||
      t.guestExpiresAt < new Date() ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(t.guestTokenHash))
    )
      throw new NotFoundException('Lien de suivi invalide ou expiré.');
    return t;
  }
  async guestRead(id: string, token: string, after?: number, before?: number) {
    return this.read(await this.guest(id, token), false, { after, before });
  }
  async guestSend(id: string, token: string, dto: SupportSendDto) {
    return this.append(await this.guest(id, token), false, {
      ...dto,
      internal: false,
    });
  }
  async contact(
    data: {
      name: string;
      email: string;
      company?: string;
      phone?: string;
      subject: string;
      message: string;
    },
    ip?: string,
  ) {
    this.crypto();
    const token = randomBytes(32).toString('hex'),
      id = randomUUID();
    const result = await this.db.$transaction(async (tx) => {
      const c = await tx.contactMessage.create({
        data: {
          name: data.name.trim(),
          email: data.email.trim().toLowerCase(),
          company: data.company?.trim() || null,
          phone: data.phone?.trim() || null,
          subject: data.subject,
          message: data.message.trim(),
          ip: ip || null,
        },
      });
      await tx.supportTicket.create({
        data: {
          id,
          contactId: c.id,
          requesterName: c.name,
          requesterEmail: c.email,
          companyLabel: c.company,
          subject: c.subject,
          category: c.subject === 'Signalement / Bug' ? 'INCIDENT' : 'QUESTION',
          guestTokenHash: hash(token),
          guestExpiresAt: new Date(Date.now() + 30 * 86400000),
        },
      });
      const m = await tx.supportMessage.create({
        data: {
          ticketId: id,
          side: 'CUSTOMER',
          body: encryptChatText(c.message, id),
          clientId: randomUUID(),
        },
      });
      await tx.supportTicket.update({
        where: { id },
        data: { lastCustomerSeq: m.seq, requesterReadSeq: m.seq },
      });
      return c;
    });
    return {
      contact: result,
      trackingPath:
        '/contact/suivi#' + new URLSearchParams({ id, token }).toString(),
    };
  }
  private async importContacts() {
    const old = await this.db.contactMessage.findMany({
      where: { supportTicket: null },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    for (const c of old)
      try {
        await this.db.$transaction(async (tx) => {
          const id = randomUUID();
          await tx.supportTicket.create({
            data: {
              id,
              contactId: c.id,
              requesterName: c.name,
              requesterEmail: c.email,
              companyLabel: c.company,
              subject: c.subject,
              createdAt: c.createdAt,
              updatedAt: c.createdAt,
              status: c.status === 'REPLIED' ? 'RESOLVED' : 'OPEN',
            },
          });
          const m = await tx.supportMessage.create({
            data: {
              ticketId: id,
              side: 'CUSTOMER',
              body: encryptChatText(c.message, id),
              clientId: randomUUID(),
              createdAt: c.createdAt,
            },
          });
          await tx.supportTicket.update({
            where: { id },
            data: { lastCustomerSeq: m.seq },
          });
        });
      } catch (e) {
        if (!(
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ))
          throw e;
      }
  }
}