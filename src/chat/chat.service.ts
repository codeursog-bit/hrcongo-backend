// ============================================================================
// 📁 chat/chat.service.ts
// ----------------------------------------------------------------------------
// Règles de sécurité appliquées ICI (pas seulement dans le contrôleur) :
//   1. L'identité (id, rôle, companyId) vient du JWT. Jamais du client.
//   2. Toute lecture/écriture de conversation passe par assertMember() :
//      il faut être participant ET que la conversation soit de TA entreprise.
//      Sinon → 404 (pas 403) : on ne révèle même pas l'existence d'un id.
//   3. Aucun accès "admin" aux conversations des autres : un admin ne lit que
//      les siennes, comme tout le monde.
//   4. Chaque envoi re-vérifie la politique de contact (canMessage).
//   5. Corps chiffré au repos (AES-256-GCM, AAD = conversationId).
// ============================================================================
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
// ⚠️ ADAPTER le chemin si besoin
import { PrismaService } from '../prisma/prisma.service';
import { decryptChatText, encryptChatText, isChatCryptoReady } from './chat-crypto';
import { ChatPolicyService, CONTACT_SELECT, toContactDto } from './chat-policy.service';
import { ChatSignalService } from './chat-signal.service';
import {
  ChatActor,
  ChatContactDto,
  ChatConversationDto,
  ChatMessageDto,
  ChatPollDto,
  MAX_BODY_LENGTH,
} from './chat.types';

export const CHAT_PUSH_SENDER = Symbol('CHAT_PUSH_SENDER');

export interface ChatPushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}
/** Adaptateur vers TON service de push existant — branché dans chat.module.ts */
export interface ChatPushSender {
  send(userId: string, payload: ChatPushPayload): Promise<unknown>;
}

const PREVIEW_LENGTH = 80;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ChatPolicyService,
    private readonly signals: ChatSignalService,
    @Optional() @Inject(CHAT_PUSH_SENDER) private readonly push?: ChatPushSender,
  ) {
    if (!isChatCryptoReady()) {
      this.logger.error(
        'CHAT_ENCRYPTION_KEY absente ou invalide : la messagerie est DÉSACTIVÉE (503) tant que la clé n’est pas définie.',
      );
    }
  }

  // ─── Contacts ──────────────────────────────────────────────────────────────
  contacts(actor: ChatActor, q: string | undefined, limit = 30): Promise<ChatContactDto[]> {
    this.assertReady();
    return this.policy.listContacts(actor, q, limit);
  }

  // ─── Ouvrir (ou retrouver) une conversation ───────────────────────────────
  async openConversation(actor: ChatActor, targetUserId: string) {
    this.assertReady();
    if (!this.signals.hit(`open:${actor.id}`, 20, 60_000)) this.tooMany();
    if (targetUserId === actor.id) throw new BadRequestException('Conversation avec soi-même impossible.');

    if (!(await this.policy.canMessage(actor, targetUserId))) {
      // même réponse que "introuvable" : pas d'énumération des utilisateurs
      throw new NotFoundException('Contact introuvable.');
    }

    const [a, b] = [actor.id, targetUserId].sort();
    const directKey = `${a}:${b}`;

    let conv = await this.prisma.chatConversation.findUnique({
      where: { directKey },
      select: { id: true, companyId: true },
    });
    if (!conv) {
      try {
        conv = await this.prisma.chatConversation.create({
          data: {
            companyId: actor.companyId,
            directKey,
            participants: { create: [{ userId: actor.id }, { userId: targetUserId }] },
          },
          select: { id: true, companyId: true },
        });
      } catch (e) {
        // course : l'autre personne a ouvert la même conversation au même instant
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          conv = await this.prisma.chatConversation.findUnique({
            where: { directKey },
            select: { id: true, companyId: true },
          });
        } else throw e;
      }
    }
    if (!conv || conv.companyId !== actor.companyId) throw new NotFoundException('Conversation introuvable.');

    const other = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: CONTACT_SELECT });
    if (!other) throw new NotFoundException('Contact introuvable.');
    return { id: conv.id, other: toContactDto(other) };
  }

  // ─── Liste des conversations (uniquement celles qui contiennent des messages) ─
  async listConversations(actor: ChatActor): Promise<ChatConversationDto[]> {
    this.assertReady();
    const rows = await this.prisma.chatParticipant.findMany({
      where: {
        userId: actor.id,
        conversation: { companyId: actor.companyId, lastMessageAt: { not: null } },
      },
      orderBy: { conversation: { lastMessageAt: 'desc' } },
      take: 100,
      select: {
        unreadCount: true,
        conversation: {
          select: {
            id: true,
            lastMessageAt: true,
            lastPreviewEnc: true,
            lastSenderId: true,
            participants: {
              where: { userId: { not: actor.id } },
              select: { user: { select: CONTACT_SELECT } },
            },
          },
        },
      },
    });

    const out: ChatConversationDto[] = [];
    for (const r of rows) {
      const c = r.conversation;
      const otherUser = c.participants[0]?.user;
      if (!otherUser) continue;
      out.push({
        id: c.id,
        other: toContactDto(otherUser),
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        lastPreview: c.lastPreviewEnc ? decryptChatText(c.lastPreviewEnc, c.id) : null,
        lastFromMe: c.lastSenderId === actor.id,
        unreadCount: r.unreadCount,
      });
    }
    return out;
  }

  // ─── Messages (historique par pages OU delta depuis un curseur) ───────────
  async getMessages(
    actor: ChatActor,
    conversationId: string,
    opts: { before?: number; after?: number; limit?: number },
  ): Promise<{ messages: ChatMessageDto[]; hasMore: boolean }> {
    this.assertReady();
    await this.assertMember(actor, conversationId);
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);

    const select = { id: true, seq: true, senderId: true, bodyEnc: true, createdAt: true } as const;
    const toDto = (m: { id: string; seq: bigint; senderId: string; bodyEnc: string; createdAt: Date }): ChatMessageDto => ({
      id: m.id,
      seq: Number(m.seq),
      mine: m.senderId === actor.id,
      body: decryptChatText(m.bodyEnc, conversationId),
      createdAt: m.createdAt.toISOString(),
    });

    // Delta : tout ce qui est plus récent que le dernier message connu du client
    if (opts.after !== undefined) {
      const rows = await this.prisma.chatMessage.findMany({
        where: { conversationId, seq: { gt: BigInt(opts.after) } },
        orderBy: { seq: 'asc' },
        take: limit,
        select,
      });
      return { messages: rows.map(toDto), hasMore: rows.length === limit };
    }

    // Historique : les N derniers (ou les N précédant `before`)
    const rows = await this.prisma.chatMessage.findMany({
      where: { conversationId, ...(opts.before !== undefined ? { seq: { lt: BigInt(opts.before) } } : {}) },
      orderBy: { seq: 'desc' },
      take: limit + 1,
      select,
    });
    const hasMore = rows.length > limit;
    return { messages: rows.slice(0, limit).reverse().map(toDto), hasMore };
  }

  // ─── Envoi ─────────────────────────────────────────────────────────────────
  async send(actor: ChatActor, conversationId: string, rawBody: string, clientId?: string): Promise<ChatMessageDto> {
    this.assertReady();
    if (!this.signals.hit(`send:${actor.id}`, 30, 60_000)) this.tooMany();

    const body = this.cleanBody(rawBody);
    const recipientId = await this.assertMember(actor, conversationId);

    // Idempotence : renvoi réseau du même message → on renvoie l'existant
    if (clientId) {
      const existing = await this.prisma.chatMessage.findUnique({
        where: { senderId_clientId: { senderId: actor.id, clientId } },
        select: { id: true, seq: true, createdAt: true },
      });
      if (existing) {
        return { id: existing.id, seq: Number(existing.seq), mine: true, body, createdAt: existing.createdAt.toISOString() };
      }
    }

    if (!(await this.policy.canMessage(actor, recipientId))) {
      throw new ForbiddenException('Vous ne pouvez plus écrire à cette personne.');
    }

    const now = new Date();
    const preview = body.replace(/\s+/g, ' ').slice(0, PREVIEW_LENGTH);

    let created: { id: string; seq: bigint };
    try {
      const [msg] = await this.prisma.$transaction([
        this.prisma.chatMessage.create({
          data: {
            conversationId,
            senderId: actor.id,
            bodyEnc: encryptChatText(body, conversationId),
            clientId: clientId ?? null,
            createdAt: now,
          },
          select: { id: true, seq: true },
        }),
        this.prisma.chatConversation.update({
          where: { id: conversationId },
          data: {
            lastMessageAt: now,
            lastPreviewEnc: encryptChatText(preview, conversationId),
            lastSenderId: actor.id,
          },
        }),
        this.prisma.chatParticipant.updateMany({
          where: { conversationId, userId: recipientId },
          data: { unreadCount: { increment: 1 } },
        }),
        this.prisma.chatParticipant.updateMany({
          where: { conversationId, userId: actor.id },
          data: { unreadCount: 0, lastReadAt: now },
        }),
      ]);
      created = msg;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && clientId) {
        const dup = await this.prisma.chatMessage.findUnique({
          where: { senderId_clientId: { senderId: actor.id, clientId } },
          select: { id: true, seq: true, createdAt: true },
        });
        if (dup) return { id: dup.id, seq: Number(dup.seq), mine: true, body, createdAt: dup.createdAt.toISOString() };
      }
      throw e;
    }

    // Signal "il y a du nouveau" pour le DESTINATAIRE uniquement (zéro coût DB côté lecture).
    // L'expéditeur n'est volontairement pas notifié : son écran est déjà à jour (envoi optimiste),
    // ce qui lui évite 3 requêtes inutiles (poll + liste + delta) à chaque message envoyé.
    this.signals.bump(recipientId);

    // Push hors application — jamais bloquant, jamais d'erreur remontée à l'expéditeur
    void this.pushToRecipient(actor, recipientId, conversationId, preview);

    return { id: created.id, seq: Number(created.seq), mine: true, body, createdAt: now.toISOString() };
  }

  // ─── Marquer comme lu ──────────────────────────────────────────────────────
  async markRead(actor: ChatActor, conversationId: string): Promise<{ ok: true }> {
    this.assertReady();
    await this.assertMember(actor, conversationId);
    const res = await this.prisma.chatParticipant.updateMany({
      where: { conversationId, userId: actor.id, unreadCount: { gt: 0 } },
      data: { unreadCount: 0, lastReadAt: new Date() },
    });
    if (res.count > 0) this.signals.bump(actor.id); // synchronise le badge des autres onglets
    return { ok: true };
  }

  // ─── Poll : le cœur de l'optimisation ─────────────────────────────────────
  async poll(actor: ChatActor, clientVersion: string | undefined, sinceIso: string | undefined): Promise<ChatPollDto> {
    if (!this.signals.hit(`poll:${actor.id}`, 120, 60_000)) this.tooMany();
    this.signals.touch(actor.id);

    const v = this.signals.version(actor.id);
    const serverTime = new Date().toISOString();
    if (clientVersion && clientVersion === v) return { v, changed: false, serverTime };

    this.assertReady();
    const sinceMs = sinceIso ? Date.parse(sinceIso) : NaN;
    const since = Number.isFinite(sinceMs) ? new Date(sinceMs - 1000) : null; // marge d'1 s

    const [agg, rows] = await Promise.all([
      this.prisma.chatParticipant.aggregate({
        where: { userId: actor.id, conversation: { companyId: actor.companyId } },
        _sum: { unreadCount: true },
      }),
      since
        ? this.prisma.chatParticipant.findMany({
            where: {
              userId: actor.id,
              conversation: { companyId: actor.companyId, lastMessageAt: { gt: since } },
            },
            select: { conversationId: true, unreadCount: true },
            take: 50,
          })
        : Promise.resolve([] as { conversationId: string; unreadCount: number }[]),
    ]);

    return {
      v,
      changed: true,
      serverTime,
      unreadTotal: agg._sum.unreadCount ?? 0,
      conversations: rows.map((r) => ({ id: r.conversationId, unreadCount: r.unreadCount })),
    };
  }

  away(actor: ChatActor): { ok: true } {
    this.signals.away(actor.id);
    return { ok: true };
  }

  // ─── Internes ──────────────────────────────────────────────────────────────
  /** Vérifie l'appartenance + l'entreprise. Retourne l'id de l'AUTRE participant. */
  private async assertMember(actor: ChatActor, conversationId: string): Promise<string> {
    const part = await this.prisma.chatParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: actor.id } },
      select: {
        conversation: {
          select: {
            companyId: true,
            participants: { where: { userId: { not: actor.id } }, select: { userId: true } },
          },
        },
      },
    });
    const other = part?.conversation.participants[0]?.userId;
    if (!part || part.conversation.companyId !== actor.companyId || !other) {
      throw new NotFoundException('Conversation introuvable.');
    }
    return other;
  }

  private cleanBody(raw: string): string {
    // retire les caractères de contrôle (sauf \n et \t), normalise les retours à la ligne
    const body = String(raw ?? '')
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim();
    if (!body) throw new BadRequestException('Message vide.');
    if (body.length > MAX_BODY_LENGTH) throw new BadRequestException(`Message trop long (max ${MAX_BODY_LENGTH} caractères).`);
    return body;
  }

  private assertReady() {
    if (!isChatCryptoReady()) throw new ServiceUnavailableException('Messagerie momentanément indisponible.');
  }

  private tooMany(): never {
    throw new HttpException('Trop de requêtes, ralentissez un instant.', 429);
  }

  private async pushToRecipient(sender: ChatActor, recipientId: string, conversationId: string, preview: string) {
    try {
      if (!this.push) return;
      if (!this.signals.shouldPush(recipientId, conversationId)) return;

      const s = await this.prisma.user.findUnique({
        where: { id: sender.id },
        select: { firstName: true, lastName: true },
      });
      const showPreview = process.env.CHAT_PUSH_PREVIEW !== 'false';
      await this.push.send(recipientId, {
        title: s ? `${s.firstName} ${s.lastName}`.trim() : 'Nouveau message',
        body: showPreview ? preview : 'Vous avez reçu un nouveau message',
        url: `/messages?c=${conversationId}`,
        tag: `chat-${conversationId}`,
      });
    } catch (e) {
      this.logger.warn(`Push chat non envoyé : ${(e as Error).message}`);
    }
  }
}