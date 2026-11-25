import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { IncidentCron as Cron } from '../incidents/incident-cron.decorator';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { congoDateString } from '../common/utils/congo-time';
import { inferToolIntent } from './analysis-intent';
import {
  decryptChatText,
  encryptChatText,
  isChatCryptoReady,
} from '../chat/chat-crypto';
import { analysisWindow, DEFAULT_LIMITS } from './analysis-policy';
import { addCredits, grantTrialIfDue } from './credits';
import { buildFreePrompt, guideFor, scrubFreeText, validateFreeReply } from './free-chat';
import { factsFor } from './reference-facts';
import { LegalParametersService } from '../legal-parameters/legal-parameters.service';
import { externalReady, modelConfig, selectSentences } from './model-provider';
import { advancedAnswer } from './advanced-answer';
import {
  commitContext,
  composeAnswer,
  EMPTY_STORED,
  parseStoredContext,
  planTurn,
  type StoredContext,
  type TurnPlan,
} from './assistant-conversation';
import { callModelJson } from './model-transport';
import type { EmployeeRef } from './pseudonymizer';
import { AssistantAnalysisService } from './assistant-analysis.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  DailyWorkspaceService,
  type DailyActor,
} from '../daily-workspace/daily-workspace.service';
import { answerHelp, helpFor, numbersGrounded, REFUSAL } from './help';
import {
  CreditAdjustDto,
  CreditPackDto,
  AssistantOverrideDto,
  AssistantSettingsDto,
  ChatDto,
  FeedbackDto,
  CompanyAssistantDto,
  GuideEventDto,
  UnansweredUpdateDto,
} from './assistant.dto';

@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly daily: DailyWorkspaceService,
    private readonly analyses: AssistantAnalysisService,
    private readonly legal: LegalParametersService,
  ) {}
  async actor(claims: any) {
    const actor = await this.daily.actor(claims);
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { employee: { select: { status: true } } },
    });
    if (
      user?.employee &&
      ['TERMINATED', 'RETIRED'].includes(user.employee.status)
    ) {
      await this.prisma.assistantConversation.deleteMany({
        where: { userId: actor.id },
      });
      throw new ForbiddenException('Accès au compte employé interrompu.');
    }
    return actor;
  }
  async settings() {
    return (
      (await this.prisma.assistantSettings.findUnique({
        where: { id: 'platform' },
      })) || {
        id: 'platform',
        mode: 'INTEGRE',
        guideEnabled: true,
        disabledGuides: [],
        retentionDays: 90,
        analysisEnabled: false,
        killSwitch: false,
        trialCredits: 20,
        creditsPerAnalysis: 1,
        creditsPerMessage: 1,
        planLimits: DEFAULT_LIMITS,
      }
    );
  }
  async capabilities(a: DailyActor) {
    const [s, o, company, subscription] = await Promise.all([
      this.settings(),
      this.prisma.assistantCompanyOverride.findUnique({
        where: { companyId: a.companyId },
      }),
      this.prisma.company.findUniqueOrThrow({
        where: { id: a.companyId },
        select: { assistantAnalysesEnabled: true },
      }),
      this.prisma.subscription.findUnique({
        where: { companyId: a.companyId },
      }),
    ]);
    const window = analysisWindow(subscription),
      analyst = ['ADMIN', 'HR_MANAGER'].includes(a.role),
      cost = Math.max(1, Number((s as any).creditsPerAnalysis) || 1),
      messageCost = Math.max(0, Number((s as any).creditsPerMessage ?? 1));
    // Crédits : l'accès à l'analyse ne dépend plus du forfait mais du solde de l'entreprise.
    let wallet = analyst
      ? await this.prisma.assistantCreditWallet.findUnique({
          where: { companyId: a.companyId },
        })
      : null;
    const trialCredits = Number((s as any).trialCredits) || 0;
    if (analyst && window.plan === 'TRIAL' && !wallet?.trialGrantedAt) {
      await grantTrialIfDue(this.prisma, a.companyId, trialCredits);
      wallet = await this.prisma.assistantCreditWallet.findUnique({
        where: { companyId: a.companyId },
      });
    }
    // Accueil de première arrivée : seulement le créateur d'un compte neuf (premier utilisateur de
    // l'entreprise, créé après la mise en service de cette fonction), tant qu'il n'a ni démarré,
    // terminé ni masqué le guide. L'état vit côté serveur : il suit la personne d'un appareil à l'autre.
    let welcomeEligible = false;
    if (
      analyst &&
      s.guideEnabled &&
      !(Array.isArray(s.disabledGuides) ? s.disabledGuides : []).includes('getting-started')
    ) {
      const since = new Date(process.env.ASSISTANT_WELCOME_SINCE || '2026-11-21T00:00:00Z');
      const [me, first, seen] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: a.id },
          select: { createdAt: true, lastLoginAt: true },
        }),
        this.prisma.user.findFirst({
          where: { companyId: a.companyId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        }),
        this.prisma.activityLog.findFirst({
          where: {
            userId: a.id,
            entity: 'ASSISTANT_GUIDE',
            action: { in: ['GUIDE_STARTED', 'GUIDE_COMPLETED', 'GUIDE_DISMISSED'] },
            metadata: { path: ['guideId'], equals: 'getting-started' },
          },
          select: { id: true },
        }),
      ]);
      // « Plus tard » : l'accueil reste masqué jusqu'à la prochaine connexion (sur tous les appareils).
      const postponed =
        !!me &&
        !!(await this.prisma.activityLog.findFirst({
          where: {
            userId: a.id,
            entity: 'ASSISTANT_GUIDE',
            action: 'GUIDE_POSTPONED',
            metadata: { path: ['guideId'], equals: 'getting-started' },
            ...(me.lastLoginAt ? { createdAt: { gte: me.lastLoginAt } } : {}),
          },
          select: { id: true },
        }));
      welcomeEligible =
        !!me && me.createdAt >= since && first?.id === a.id && !seen && !postponed;
    }
    const balance = wallet?.balance ?? 0,
      off =
        s.mode === 'OFF' ||
        o?.allowed === false ||
        o?.forceMode === 'OFF',
      mode = off
        ? 'OFF'
        : s.mode === 'IA_AVANCEE' &&
            o?.forceMode !== 'INTEGRE' &&
            externalReady(s) &&
            balance >= cost
          ? 'IA_AVANCEE'
          : 'INTEGRE';
    const enabled =
      analyst &&
      s.analysisEnabled &&
      company.assistantAnalysesEnabled &&
      mode !== 'OFF';
    return {
      assistantMode: mode,
      welcome: { eligible: welcomeEligible },
      helpOnly: !enabled,
      analysesEnabled: enabled,
      companyAnalysesEnabled: company.assistantAnalysesEnabled,
      analysisAvailable: enabled && balance >= cost,
      creditCost: cost,
      messageCost,
      credits: analyst
        ? {
            balance,
            costPerAnalysis: cost,
            costPerMessage: messageCost,
            trialGranted: !!wallet?.trialGrantedAt,
          }
        : null,
      remainingAnalyses: analyst ? Math.floor(balance / cost) : null,
      monthlyAnalyses: null,
      usedAnalyses: null,
      usagePercent: 0,
      quotaPeriodStart: window.start.toISOString(),
      quotaPeriodEnd: window.end.toISOString(),
      plan: window.plan,
      guideEnabled: s.guideEnabled,
      disabledGuides: Array.isArray(s.disabledGuides) ? s.disabledGuides : [],
      retentionDays: s.retentionDays,
    };
  }
  help(a: DailyActor) {
    return helpFor(a.role).map(({ keywords, ...article }) => article);
  }
  suggestions(a: DailyActor) {
    return helpFor(a.role)
      .slice(0, 6)
      .map((x) => x.question);
  }
  async availableSuggestions(a: DailyActor) {
    const caps = await this.capabilities(a);
    return [
      ...(caps.analysesEnabled ? ['Quel est l’effectif ce mois-ci ?'] : []),
      ...this.suggestions(a),
    ];
  }
  async companyPreference(a: DailyActor, dto: CompanyAssistantDto) {
    if (a.role !== 'ADMIN')
      throw new ForbiddenException('Réglage réservé à l’administrateur.');
    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: a.companyId },
        data: { assistantAnalysesEnabled: dto.analysisEnabled },
      });
      await tx.activityLog.create({
        data: {
          userId: a.id,
          entity: 'ASSISTANT_PREFERENCES',
          entityId: a.companyId,
          action: 'UPDATE',
          description: 'Préférence des analyses modifiée.',
          metadata: { analysisEnabled: dto.analysisEnabled },
        },
      });
    });
    return this.capabilities(a);
  }
  async upgradeClick(a: DailyActor) {
    if (!['ADMIN', 'HR_MANAGER'].includes(a.role))
      throw new ForbiddenException('Action indisponible.');
    await this.prisma.activityLog.create({
      data: {
        userId: a.id,
        action: 'ASSISTANT_UPGRADE_CLICK',
        entity: 'ASSISTANT',
        entityId: a.companyId,
        description: 'Consultation des forfaits depuis l’assistant.',
        metadata: { companyId: a.companyId },
      },
    });
    return { ok: true };
  }
  async guideEvent(a: DailyActor, dto: GuideEventDto) {
    const caps = await this.capabilities(a);
    if (
      !caps.guideEnabled ||
      caps.disabledGuides.includes(dto.guideId) ||
      !['ADMIN', 'HR_MANAGER'].includes(a.role)
    )
      throw new ForbiddenException('Guide indisponible.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM users WHERE id=${a.id}::uuid FOR UPDATE`,
      );
      const where = {
        userId: a.id,
        entity: 'ASSISTANT_GUIDE',
        entityId: dto.sessionId,
        AND: [
          { metadata: { path: ['companyId'], equals: a.companyId } },
          { metadata: { path: ['guideId'], equals: dto.guideId } },
        ],
      };
      if (
        dto.state === 'COMPLETED' &&
        !(await tx.activityLog.findFirst({
          where: { ...where, action: 'GUIDE_STARTED' },
        }))
      )
        throw new BadRequestException('Orientation non démarrée.');
      if (
        !(await tx.activityLog.findFirst({
          where: { ...where, action: 'GUIDE_' + dto.state },
        }))
      )
        await tx.activityLog.create({
          data: {
            userId: a.id,
            entity: 'ASSISTANT_GUIDE',
            entityId: dto.sessionId,
            action: 'GUIDE_' + dto.state,
            description:
              'Orientation ' +
              (dto.state === 'STARTED'
                ? 'démarrée.'
                : dto.state === 'COMPLETED'
                  ? 'terminée.'
                  : dto.state === 'DISMISSED'
                    ? 'masquée.'
                    : 'reportée.'),
            metadata: { companyId: a.companyId, guideId: dto.guideId },
          },
        });
      return { ok: true };
    });
  }
  async usage() {
    const from = new Date(Date.now() - 30 * 86400000);
    const [
      tools,
      questions,
      conversations,
      changes,
      guideEvents,
      upgradeClicks,
      refusals,
    ] = await Promise.all([
      this.prisma.assistantAnalysisUsage.groupBy({
        by: ['tool', 'charged'],
        where: { createdAt: { gte: from } },
        _count: true,
      }),
      this.prisma.assistantMessage.count({
        where: { role: 'USER', createdAt: { gte: from } },
      }),
      this.prisma.assistantConversation.count(),
      this.prisma.activityLog.findMany({
        where: { entity: { in: ['ASSISTANT_SETTINGS', 'ASSISTANT_OVERRIDE'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          userId: true,
          entity: true,
          description: true,
          createdAt: true,
          metadata: true,
        },
      }),
      this.prisma.activityLog.groupBy({
        by: ['action'],
        where: { entity: 'ASSISTANT_GUIDE', createdAt: { gte: from } },
        _count: true,
      }),
      this.prisma.activityLog.count({
        where: { action: 'ASSISTANT_UPGRADE_CLICK', createdAt: { gte: from } },
      }),
      this.prisma.assistantMessage.count({
        where: {
          role: 'ASSISTANT',
          createdAt: { gte: from },
          payload: { path: ['refusal'], equals: true },
        },
      }),
    ]);
    return {
      from: from.toISOString(),
      questions,
      conversations,
      tools,
      changes,
      guideEvents,
      upgradeClicks,
      refusals,
    };
  }
  companies(search: string) {
    return this.prisma.company.findMany({
      where: search
        ? {
            OR: [
              { legalName: { contains: search, mode: 'insensitive' } },
              ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                search,
              )
                ? [{ id: search }]
                : []),
            ],
          }
        : {},
      select: {
        id: true,
        legalName: true,
        assistantOverride: true,
        assistantWallet: { select: { balance: true, trialGrantedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
  private visible(a: DailyActor, text: string, payload: any, caps: any) {
    if (!payload) return { text, payload };
    if (payload.encryptedCard) {
      try {
        const { encryptedCard, ...rest } = payload;
        payload = {
          ...rest,
          card: JSON.parse(
            decryptChatText(encryptedCard, 'assistant:' + a.companyId),
          ),
        };
      } catch {
        return {
          text: REFUSAL,
          payload: {
            refusal: true,
            source: 'help:scope',
            suggestions: this.suggestions(a),
          },
        };
      }
    }
    if (payload.encryptedText) {
      try {
        const { encryptedText, ...rest } = payload;
        text = decryptChatText(encryptedText, 'assistant:' + a.companyId);
        payload = rest;
      } catch {
        return {
          text: REFUSAL,
          payload: {
            refusal: true,
            source: 'help:scope',
            suggestions: this.suggestions(a),
          },
        };
      }
    }
    if (payload.encryptedClarification) {
      try {
        const { encryptedClarification, ...rest } = payload;
        payload = {
          ...rest,
          clarification: JSON.parse(
            decryptChatText(encryptedClarification, 'assistant:' + a.companyId),
          ),
        };
      } catch {
        return {
          text: REFUSAL,
          payload: {
            refusal: true,
            source: 'help:scope',
            suggestions: this.suggestions(a),
          },
        };
      }
    }
    if (payload.analysis && !['ADMIN', 'HR_MANAGER'].includes(a.role))
      return {
        text: REFUSAL,
        payload: {
          source: 'help:scope',
          refusal: true,
          suggestions: this.suggestions(a),
        },
      };
    if (
      payload.articleId &&
      !helpFor(a.role).some((h) => h.id === payload.articleId)
    )
      return {
        text: REFUSAL,
        payload: {
          refusal: true,
          source: 'help:scope',
          suggestions: this.suggestions(a),
        },
      };
    return {
      text,
      payload: {
        ...payload,
        guideId:
          caps.guideEnabled && !caps.disabledGuides.includes(payload.guideId)
            ? payload.guideId
            : undefined,
      },
    };
  }
  private owned(a: DailyActor) {
    return {
      userId: a.id,
      companyId: a.companyId,
      expiresAt: { gt: new Date() },
    };
  }
  async list(a: DailyActor) {
    return this.prisma.assistantConversation.findMany({
      where: this.owned(a),
      select: { id: true, title: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });
  }
  async conversation(a: DailyActor, id: string) {
    const c = await this.prisma.assistantConversation.findFirst({
      where: { id, ...this.owned(a) },
      select: {
        id: true,
        title: true,
        createdAt: true,
        messages: {
          orderBy: [{ createdAt: 'asc' }, { role: 'desc' }],
          take: 100,
          select: {
            id: true,
            role: true,
            text: true,
            payload: true,
            rating: true,
            createdAt: true,
          },
        },
      },
    });
    if (!c) throw new NotFoundException('Conversation indisponible.');
    const caps = await this.capabilities(a);
    return {
      ...c,
      messages: c.messages.map((m) => ({
        ...m,
        ...this.visible(a, m.text, m.payload, caps),
      })),
    };
  }
  async remove(a: DailyActor, id: string) {
    const d = await this.prisma.assistantConversation.deleteMany({
      where: { id, ...this.owned(a) },
    });
    if (!d.count) throw new NotFoundException('Conversation indisponible.');
  }
  async feedback(a: DailyActor, dto: FeedbackDto) {
    const changed = await this.prisma.assistantMessage.updateMany({
      where: {
        id: dto.messageId,
        role: 'ASSISTANT',
        conversation: this.owned(a),
      },
      data: { rating: dto.rating },
    });
    if (!changed.count) throw new NotFoundException('Réponse indisponible.');
  }
  // ---- Conversation libre (mode IA_AVANCEE) : contexte chiffré, limites, employés ----------------
  private ctxAad(a: DailyActor, conversationId: string) {
    return `assistant-ctx:${a.companyId}:${conversationId}`;
  }
  /** UUID dérivé : la réservation d'un appel de planification ne collisionne jamais avec l'analyse. */
  private planRequestId(requestId: string) {
    const h = createHash('sha256').update('plan:' + requestId).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
  private async loadContext(
    a: DailyActor,
    conversationId?: string,
  ): Promise<StoredContext> {
    if (!conversationId) return EMPTY_STORED;
    const c = await this.prisma.assistantConversation.findFirst({
      where: { id: conversationId, ...this.owned(a) },
      select: { contextEnc: true },
    });
    if (!c?.contextEnc) return EMPTY_STORED;
    try {
      return parseStoredContext(
        JSON.parse(decryptChatText(c.contextEnc, this.ctxAad(a, conversationId))),
      );
    } catch {
      return EMPTY_STORED; // contexte illisible : on repart sans contexte, jamais de supposition
    }
  }
  private async companyEmployees(a: DailyActor): Promise<EmployeeRef[]> {
    const rows = await this.prisma.employee.findMany({
      where: { companyId: a.companyId },
      select: { id: true, firstName: true, lastName: true, employeeNumber: true },
      orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
      take: 3001,
    });
    if (rows.length > 3000) throw new Error('too_many_employees');
    return rows;
  }
  /** Limite de débit + idempotence des appels de planification (aucune migration supplémentaire). */
  private async reserveModelPlan(
    a: DailyActor,
    caps: any,
    requestId: string,
  ): Promise<'ok' | 'replay' | 'limit'> {
    const [perUser, perCompany] = await Promise.all([
      this.prisma.assistantAnalysisUsage.count({
        where: {
          companyId: a.companyId,
          userId: a.id,
          tool: 'model_plan',
          createdAt: { gte: new Date(Date.now() - 60000) },
        },
      }),
      this.prisma.assistantAnalysisUsage.count({
        where: {
          companyId: a.companyId,
          tool: 'model_plan',
          createdAt: { gte: new Date(Date.now() - 3600000) },
        },
      }),
    ]);
    if (perUser >= 6 || perCompany >= 200) return 'limit';
    const id = this.planRequestId(requestId);
    try {
      await this.prisma.assistantAnalysisUsage.create({
        data: {
          companyId: a.companyId,
          userId: a.id,
          requestId: id,
          cacheKey: createHash('sha256').update('plan:' + id).digest('hex'),
          tool: 'model_plan',
          charged: false,
          periodStart: new Date(caps.quotaPeriodStart),
          periodEnd: new Date(caps.quotaPeriodEnd),
        },
      });
      return 'ok';
    } catch (e: any) {
      if (e?.code === 'P2002') return 'replay';
      throw e;
    }
  }
  async chat(a: DailyActor, dto: ChatDto) {
    if (!dto.message.trim())
      throw new BadRequestException('Écrivez une question.');
    const caps = await this.capabilities(a);
    if (caps.assistantMode === 'OFF')
      throw new ForbiddenException(
        'Le chat est désactivé. Les guides disponibles restent accessibles.',
      );
    let answer = answerHelp(dto.message, a.role);
    let intent = dto.analysis || inferToolIntent(dto.message);
    if (intent?.tool === 'leave_balance') {
      const today = congoDateString();
      intent = {
        ...intent,
        month: Number(today.slice(5, 7)),
        year: Number(today.slice(0, 4)),
      };
    }
    // ---- Conversation libre : question comprise par le modèle sur texte PSEUDONYMISÉ -----------
    const analyst = ['ADMIN', 'HR_MANAGER'].includes(a.role);
    const freeChat =
      caps.assistantMode === 'IA_AVANCEE' &&
      caps.analysesEnabled &&
      analyst &&
      isChatCryptoReady();
    const prevCtx: StoredContext = freeChat
      ? await this.loadContext(a, dto.conversationId)
      : EMPTY_STORED;
    let turn: Extract<TurnPlan, { kind: 'intent' }> | null = null;
    let ctxToStore: StoredContext | null = null;
    let clarification: { kind: string; options?: unknown[] } | null = null;
    let planned: TurnPlan | null = null;
    let freeReply: string | null = null;
    let freeGuide: string | null = null;
    const wantsModel =
      freeChat &&
      !dto.analysis &&
      (!!dto.choice || (!intent && (!answer.article || answer.refusal)));
    if (wantsModel) {
      const alreadyAnswered = await this.prisma.assistantMessage.findFirst({
        where: {
          turnId: dto.requestId,
          role: 'ASSISTANT',
          conversation: this.owned(a),
        },
        select: { id: true },
      });
      if (!alreadyAnswered) {
        // La réservation (limite de débit + idempotence) se fait au PREMIER appel réel au modèle :
        // un refus ou une précision purement locale ne consomme donc rien.
        let reserved = false;
        let limited = false;
        try {
          planned = await planTurn(
            dto.message,
            prevCtx,
            {
              employees: () => this.companyEmployees(a),
              model: async (prompt, opts) => {
                if (!reserved) {
                  const gate = await this.reserveModelPlan(a, caps, dto.requestId);
                  if (gate === 'limit') {
                    limited = true;
                    throw new Error('rate_limited');
                  }
                  if (gate === 'replay') throw new Error('replay');
                  reserved = true;
                }
                return callModelJson(prompt, opts);
              },
              now: () => {
                const t = congoDateString();
                return { month: Number(t.slice(5, 7)), year: Number(t.slice(0, 4)) };
              },
            },
            dto.choice ? { choice: { employeeId: dto.choice.employeeId } } : {},
          );
        } catch {
          planned = null; // employés non résolubles : repli explicite plus bas
        }
        if (limited)
          throw new HttpException(
            'Patientez un instant avant une autre question.',
            429,
          );
        if (!planned)
          answer = {
            text: 'Je ne peux pas comprendre cette question libre pour le moment. Utilisez « Explorer mes données » ou l’aide.',
            refusal: true,
            canonical: 'Modèle indisponible',
          };
        else if (planned.kind === 'intent') {
          turn = planned;
          intent = planned.intent;
        } else if (planned.kind === 'clarify') {
          ctxToStore = planned.context;
          clarification = {
            kind: planned.why,
            ...(planned.options?.length ? { options: planned.options } : {}),
          };
          answer = {
            text: planned.text,
            refusal: false,
            canonical: 'Précision demandée',
          };
        } else if (planned.kind === 'refuse' || planned.kind === 'unavailable') {
          ctxToStore = planned.context;
          answer = {
            text: planned.text,
            refusal: true,
            canonical:
              planned.kind === 'unavailable'
                ? 'Modèle indisponible'
                : 'Question non prise en charge',
          };
        }
        // planned.kind === 'help' : on garde la réponse d'aide intégrée déjà calculée.
        // ---- Voie ouverte : Sofia répond sans aucune donnée de l'entreprise (texte masqué) ------------
        const openLane =
          !intent &&
          !dto.choice &&
          ((planned?.kind === 'clarify' && planned.why === 'uncertain') ||
            planned?.kind === 'help' ||
            planned?.kind === 'refuse');
        if (openLane) {
          if (caps.messageCost > 0 && (caps.credits?.balance ?? 0) < caps.messageCost) {
            clarification = null;
            answer = {
              text: 'Vos crédits sont épuisés. L’aide et les guides restent disponibles.',
              refusal: true,
              canonical: 'Crédits épuisés',
            };
          } else {
            try {
              if (!reserved) {
                const gate = await this.reserveModelPlan(a, caps, dto.requestId);
                if (gate === 'limit')
                  throw new HttpException(
                    'Patientez un instant avant une autre question.',
                    429,
                  );
                if (gate === 'replay') throw new Error('replay');
                reserved = true;
              }
              const scrubbed = scrubFreeText(
                dto.message,
                await this.companyEmployees(a),
              );
              const reply = validateFreeReply(
                await callModelJson(
                  buildFreePrompt({
                    message: scrubbed,
                    history: prevCtx.chat || [],
                    role: a.role,
                    // Règles générales lues dans l'application (légales, conventions) : aucune donnée d'entreprise.
                    facts: factsFor(scrubbed, this.legal.getAt()),
                  }),
                  { maxTokens: 900, timeoutMs: 20000 },
                ),
              );
              if (reply) {
                freeReply = reply;
                freeGuide = guideFor(scrubbed, a.role)?.id ?? null;
                clarification = null;
                answer = {
                  text: reply,
                  refusal: false,
                  canonical: 'Conversation avec Sofia',
                };
                ctxToStore = {
                  ...prevCtx,
                  pendingOutbound: undefined,
                  pendingRounds: undefined,
                  pendingRaw: undefined,
                  chat: [
                    ...(prevCtx.chat || []),
                    { q: scrubbed.slice(0, 600), a: reply.slice(0, 1500) },
                  ].slice(-4),
                };
              }
            } catch (e) {
              if (e instanceof HttpException) throw e;
              // Panne ou délai : on garde la réponse locale déjà calculée.
            }
          }
        }
      }
    }
    let card: any = null;
    if (intent && ['ADMIN', 'HR_MANAGER'].includes(a.role)) {
      if (caps.analysesEnabled && isChatCryptoReady()) {
        try {
          card = await this.analyses.execute(a.id, a.companyId, intent);
        } catch {
          card = null;
        }
        if (card)
          answer = {
            text: `Voici les résultats pour ${card.period}. Les valeurs proviennent des données vérifiées de l’application.`,
            refusal: false,
            canonical: `${card.title} — ${card.period}`,
          };
        else
          answer = {
            text: 'Je ne peux pas obtenir un résultat fiable en lecture seule pour cette analyse. Vérifiez la période, l’employé et son dossier, ou contactez le support.',
            refusal: true,
            canonical: 'Analyse indisponible',
          };
      } else
        answer = {
          text: 'Les analyses ne sont pas activées pour votre entreprise ou votre forfait. L’aide et les guides restent disponibles.',
          refusal: true,
          canonical: 'Analyse désactivée',
        };
    }
    const article = answer.article;
    const grounded = numbersGrounded(
      answer.text,
      card || article || { text: answer.text },
    );
    if (!grounded) card = null;
    const text = grounded ? answer.text : REFUSAL;
    const payload = {
      refusal: answer.refusal || !grounded,
      source: article ? `help:${article.id}` : 'help:scope',
      ...(article
        ? {
            articleId: article.id,
            path: article.path,
            guideId:
              caps.guideEnabled &&
              !caps.disabledGuides.includes(article.guideId || '')
                ? article.guideId
                : undefined,
          }
        : {}),
      ...(freeReply &&
      freeGuide &&
      caps.guideEnabled &&
      !caps.disabledGuides.includes(freeGuide)
        ? { guideId: freeGuide }
        : {}),
      suggestions: this.suggestions(a),
      ...(clarification ? { clarification } : {}),
      ...(card
        ? {
            analysis: true,
            card,
            tool: intent!.tool,
            source: card.source,
            path: card.path || '/rapports/mouvements-effectifs',
          }
        : {}),
    };
    if (freeChat && card && intent && !ctxToStore)
      ctxToStore = turn
        ? commitContext(prevCtx, intent, turn.bindings)
        : commitContext(
            prevCtx,
            intent,
            new Map(
              prevCtx.refs.map((id, i) => [`E${i + 1}`, { kind: 'employee' as const, id }]),
            ),
          );
    let newExternalTurn = false;
    let replayed = false;
    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize a user's turns across tabs; duplicate request IDs replay the persisted result.
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM users WHERE id=${a.id}::uuid FOR UPDATE`,
      );
      const prior = await tx.assistantMessage.findFirst({
        where: {
          turnId: dto.requestId,
          role: 'ASSISTANT',
          conversation: this.owned(a),
        },
        include: { conversation: { select: { id: true } } },
      });
      if (prior) {
        replayed = true;
        if (dto.conversationId && prior.conversationId !== dto.conversationId)
          throw new BadRequestException('Requête déjà utilisée.');
        return {
          conversationId: prior.conversationId,
          messageId: prior.id,
          ...this.visible(a, prior.text, prior.payload, caps),
        };
      }
      if (
        (await tx.assistantMessage.count({
          where: {
            role: 'USER',
            createdAt: { gte: new Date(Date.now() - 60000) },
            conversation: { userId: a.id },
          },
        })) >= 20
      )
        throw new HttpException(
          'Patientez un instant avant une autre question.',
          429,
        );
      if (card && intent && (card.metrics.length || card.rows?.length)) {
        const fresh = await tx.user.findUnique({
          where: { id: a.id },
          select: { role: true, isActive: true },
        });
        if (!fresh?.isActive || !['ADMIN', 'HR_MANAGER'].includes(fresh.role))
          throw new ForbiddenException('Analyse non autorisée.');
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM companies WHERE id=${a.companyId}::uuid FOR UPDATE`,
        );
        const existing = await tx.assistantAnalysisUsage.findUnique({
          where: {
            companyId_requestId: {
              companyId: a.companyId,
              requestId: dto.requestId,
            },
          },
        });
        if (existing)
          throw new BadRequestException('Identifiant de requête déjà utilisé.');
        const cacheKey = createHash('sha256')
          .update(JSON.stringify(intent))
          .digest('hex');
        const recent = await tx.assistantAnalysisUsage.findFirst({
          where: {
            companyId: a.companyId,
            cacheKey,
            createdAt: { gte: new Date(Date.now() - 600000) },
            periodStart: new Date(caps.quotaPeriodStart),
          },
        });
        if (!recent) {
          const wallet = await tx.assistantCreditWallet.findUnique({
            where: { companyId: a.companyId },
            select: { balance: true },
          });
          if ((wallet?.balance ?? 0) < caps.creditCost)
            throw new HttpException(
              {
                message:
                  'Vos crédits sont épuisés. L’aide et les guides restent disponibles.',
                error: 'ASSISTANT_QUOTA_EXCEEDED',
              },
              429,
            );
        }
        await tx.assistantAnalysisUsage.create({
          data: {
            companyId: a.companyId,
            userId: a.id,
            requestId: dto.requestId,
            cacheKey,
            tool: intent.tool,
            charged: !recent,
            periodStart: new Date(caps.quotaPeriodStart),
            periodEnd: new Date(caps.quotaPeriodEnd),
          },
        });
        if (!recent)
          await addCredits(tx, {
            companyId: a.companyId,
            delta: -caps.creditCost,
            reason: 'USAGE',
            refId: dto.requestId,
            note: intent.tool,
            createdBy: a.id,
          });
        newExternalTurn = !recent;
      }
      if (freeReply && caps.messageCost > 0) {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM companies WHERE id=${a.companyId}::uuid FOR UPDATE`,
        );
        if (
          await tx.assistantAnalysisUsage.findFirst({
            where: { companyId: a.companyId, requestId: dto.requestId },
            select: { id: true },
          })
        )
          throw new BadRequestException('Identifiant de requête déjà utilisé.');
        const wallet = await tx.assistantCreditWallet.findUnique({
          where: { companyId: a.companyId },
          select: { balance: true },
        });
        if ((wallet?.balance ?? 0) < caps.messageCost)
          throw new HttpException(
            {
              message:
                'Vos crédits sont épuisés. L’aide et les guides restent disponibles.',
              error: 'ASSISTANT_QUOTA_EXCEEDED',
            },
            429,
          );
        await tx.assistantAnalysisUsage.create({
          data: {
            companyId: a.companyId,
            userId: a.id,
            requestId: dto.requestId,
            cacheKey: createHash('sha256')
              .update('free:' + dto.requestId)
              .digest('hex'),
            tool: 'free_chat',
            charged: true,
            periodStart: new Date(caps.quotaPeriodStart),
            periodEnd: new Date(caps.quotaPeriodEnd),
          },
        });
        await addCredits(tx, {
          companyId: a.companyId,
          delta: -caps.messageCost,
          reason: 'USAGE',
          refId: dto.requestId,
          note: 'chat',
          createdBy: a.id,
        });
      }
      let conversation = dto.conversationId
        ? await tx.assistantConversation.findFirst({
            where: { id: dto.conversationId, ...this.owned(a) },
          })
        : null;
      if (dto.conversationId && !conversation)
        throw new NotFoundException('Conversation indisponible.');
      if (
        conversation &&
        (await tx.assistantMessage.count({
          where: { conversationId: conversation.id },
        })) >= 100
      )
        throw new BadRequestException(
          'Cette conversation est complète. Ouvrez une nouvelle conversation.',
        );
      if (!conversation)
        conversation = await tx.assistantConversation.create({
          data: {
            userId: a.id,
            employeeId: a.employeeId,
            companyId: a.companyId,
            title:
              card?.title ||
              article?.title ||
              (freeReply ? 'Conversation avec Sofia' : 'Aide à l’application'),
            expiresAt: new Date(Date.now() + caps.retentionDays * 86400000),
          },
        });
      // Keep canonical help questions, never the user's arbitrary text or personal data.
      await tx.assistantMessage.create({
        data: {
          conversationId: conversation.id,
          turnId: dto.requestId,
          role: 'USER',
          text: answer.canonical,
        },
      });
      const response = await tx.assistantMessage.create({
        data: {
          conversationId: conversation.id,
          turnId: dto.requestId,
          role: 'ASSISTANT',
          // La réponse libre de Sofia reste chiffrée dans le payload ; la colonne garde une phrase neutre.
          text: freeReply ? 'Réponse de Sofia' : text,
          payload: (freeReply
            ? {
                ...payload,
                encryptedText: encryptChatText(
                  freeReply,
                  'assistant:' + a.companyId,
                ),
              }
            : card
            ? {
                ...payload,
                card: undefined,
                encryptedCard: encryptChatText(
                  JSON.stringify(card),
                  'assistant:' + a.companyId,
                ),
              }
            : clarification?.options
              ? {
                  ...payload,
                  clarification: { kind: clarification.kind },
                  encryptedClarification: encryptChatText(
                    JSON.stringify(clarification),
                    'assistant:' + a.companyId,
                  ),
                }
              : payload) as Prisma.InputJsonValue,
        },
      });
      await tx.assistantConversation.update({
        where: { id: conversation.id },
        data: {
          updatedAt: new Date(),
          ...(ctxToStore
            ? {
                contextEnc: encryptChatText(
                  JSON.stringify(ctxToStore),
                  this.ctxAad(a, conversation.id),
                ),
              }
            : {}),
        },
      });
      await tx.activityLog.create({
        data: {
          userId: a.id,
          action: 'ASSISTANT_HELP',
          entity: 'ASSISTANT',
          entityId: conversation.id,
          description: 'Consultation de l’aide intégrée.',
          metadata: {
            companyId: a.companyId,
            tool: card ? intent!.tool : article ? 'search_help' : 'refusal',
            articleId: article?.id || null,
          },
        },
      });
      return {
        conversationId: conversation.id,
        messageId: response.id,
        text: freeReply ?? text,
        payload,
      };
    });
    // Questions saisies que l'assistant n'a pas su traiter : copie MASQUÉE pour le super admin.
    // Au mieux (jamais bloquant) ; un rejeu de la même requête n'est pas recompté.
    if (!replayed)
      void this.recordUnanswered(a, dto, caps, {
        intent,
        card,
        canonical: answer.canonical,
        freeReply,
      }).catch(() => undefined);
    if (
      newExternalTurn &&
      card &&
      intent &&
      caps.assistantMode === 'IA_AVANCEE'
    ) {
      const current = await this.capabilities(a);
      if (current.assistantMode === 'IA_AVANCEE' && current.analysesEnabled) {
        let enriched: string | null = null;
        let verified = false;
        if (turn) {
          // Conversation libre : texte rédigé sur vue masquée, déjà vérifié marqueur par marqueur.
          const c = await composeAnswer({
            tool: intent.tool,
            card,
            outbound: turn.outbound,
            bindings: turn.bindings,
            employees: turn.employees,
            deps: { model: (prompt, opts) => callModelJson(prompt, opts) },
          });
          if (c.ok) {
            enriched = c.text;
            verified = true;
          }
        } else {
          enriched = await advancedAnswer(await this.settings(), intent.tool, card);
        }
        if (
          enriched &&
          (verified || numbersGrounded(enriched, card)) &&
          (await this.capabilities(a)).assistantMode === 'IA_AVANCEE'
        ) {
          // Texte de la conversation libre : il contient de vrais noms et valeurs, donc il reste
          // chiffré dans le payload (la colonne texte garde la phrase locale sans donnée RH).
          await this.prisma.assistantMessage.updateMany({
            where: { id: result.messageId, conversation: this.owned(a) },
            data: verified
              ? {
                  payload: {
                    ...payload,
                    card: undefined,
                    encryptedCard: encryptChatText(
                      JSON.stringify(card),
                      'assistant:' + a.companyId,
                    ),
                    encryptedText: encryptChatText(
                      enriched,
                      'assistant:' + a.companyId,
                    ),
                  } as Prisma.InputJsonValue,
                }
              : { text: enriched },
          });
          result.text = enriched;
        }
      }
    }
    return result;
  }
  async employees(a: DailyActor, query: string) {
    if (!['ADMIN', 'HR_MANAGER'].includes(a.role))
      throw new ForbiddenException('Recherche non autorisée.');
    if (
      typeof query !== 'string' ||
      query.trim().length < 2 ||
      query.length > 80
    )
      return [];
    const q = query.trim();
    return this.prisma.employee.findMany({
      where: {
        companyId: a.companyId,
        AND: q
          .split(/\s+/)
          .slice(0, 4)
          .map((token) => ({
            OR: [
              { firstName: { contains: token, mode: 'insensitive' as const } },
              { lastName: { contains: token, mode: 'insensitive' as const } },
              {
                employeeNumber: {
                  contains: token,
                  mode: 'insensitive' as const,
                },
              },
            ],
          })),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
      },
      orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
      take: 10,
    });
  }
  async present(a: DailyActor, result: any) {
    if (
      !result.payload?.card?.rows ||
      !['ADMIN', 'HR_MANAGER'].includes(a.role)
    )
      return result;
    const ids = [
      ...new Set(
        result.payload.card.rows
          .map((r: any) => r.employeeId)
          .filter(
            (id: any) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id),
          ),
      ),
    ] as string[];
    const emps = await this.prisma.employee.findMany({
        where: { id: { in: ids }, companyId: a.companyId },
        select: { id: true, firstName: true, lastName: true },
      }),
      names = new Map(emps.map((e) => [e.id, e.firstName + ' ' + e.lastName]));
    return {
      ...result,
      payload: {
        ...result.payload,
        card: {
          ...result.payload.card,
          rows: result.payload.card.rows.map((r: any) => ({
            ...r,
            label: names.get(r.employeeId) || 'Employé indisponible',
          })),
        },
      },
    };
  }
  /**
   * Mémorise (texte masqué, 90 jours max) une question TAPÉE que l'assistant n'a pas pu traiter avec
   * un outil, pour que le super admin sache quels outils ajouter. Rien n'est gardé pour les
   * boutons/suggestions ni pour les questions bien traitées. Noms d'employés, e-mails, liens,
   * identifiants, numéros et montants sont masqués avant écriture (même filtre que pour le modèle).
   */
  private async recordUnanswered(
    a: DailyActor,
    dto: ChatDto,
    caps: any,
    r: { intent: unknown; card: unknown; canonical: string; freeReply: string | null },
  ) {
    if (dto.analysis || dto.choice) return;
    let reason: 'OPEN_LANE' | 'OUT_OF_SCOPE' | 'ANALYSIS_FAILED' | null = null;
    if (r.freeReply && !r.intent) reason = 'OPEN_LANE';
    else if (r.canonical === 'Question non prise en charge') reason = 'OUT_OF_SCOPE';
    else if (r.intent && !r.card && r.canonical === 'Analyse indisponible')
      reason = 'ANALYSIS_FAILED';
    if (!reason) return;
    const masked = scrubFreeText(dto.message, await this.companyEmployees(a))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400);
    if (masked.length < 4) return;
    const textKey = createHash('sha256')
      .update(
        masked
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\[\] ]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .digest('hex');
    const days = Math.min(90, Math.max(1, Number(caps?.retentionDays) || 90));
    await this.prisma.assistantUnansweredQuestion.create({
      data: {
        companyId: a.companyId,
        role: String(a.role),
        mode: String(caps?.assistantMode || ''),
        reason,
        questionMasked: masked,
        textKey,
        expiresAt: new Date(Date.now() + days * 86400000),
      },
    });
  }
  /** Questions sans réponse regroupées (même texte masqué), les plus fréquentes d'abord. */
  async unansweredList(days: number, status?: string, reason?: string) {
    const rows = await this.prisma.assistantUnansweredQuestion.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - days * 86400000) },
        ...(reason ? { reason } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 3000,
      select: {
        textKey: true,
        questionMasked: true,
        companyId: true,
        reason: true,
        status: true,
        adminNote: true,
        createdAt: true,
      },
    });
    const groups = new Map<string, any>();
    for (const r of rows) {
      let g = groups.get(r.textKey);
      if (!g) {
        // rows est trié du plus récent au plus ancien : la première ligne porte le statut courant.
        g = {
          key: r.textKey,
          question: r.questionMasked,
          status: r.status,
          note: r.adminNote,
          count: 0,
          companies: new Set<string>(),
          reasons: {} as Record<string, number>,
          lastSeen: r.createdAt,
          firstSeen: r.createdAt,
        };
        groups.set(r.textKey, g);
      }
      g.count += 1;
      g.companies.add(r.companyId);
      g.reasons[r.reason] = (g.reasons[r.reason] || 0) + 1;
      g.firstSeen = r.createdAt;
    }
    const list = [...groups.values()]
      .filter((g) => !status || g.status === status)
      .map((g) => ({ ...g, companies: g.companies.size }))
      .sort(
        (x, y) => y.count - x.count || +new Date(y.lastSeen) - +new Date(x.lastSeen),
      )
      .slice(0, 200);
    return { days, totalQuestions: rows.length, groups: list };
  }
  async unansweredUpdate(userId: string, key: string, dto: UnansweredUpdateDto) {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new BadRequestException('Question inconnue.');
    const res = await this.prisma.assistantUnansweredQuestion.updateMany({
      where: { textKey: key },
      data: {
        status: dto.status,
        adminNote: dto.note?.trim() ? dto.note.trim().slice(0, 500) : null,
      },
    });
    if (!res.count) throw new NotFoundException('Question introuvable.');
    return { updated: res.count, by: userId };
  }
  async requireSuper(claims: any) {
    const u = await this.prisma.user.findUnique({
      where: { id: claims.userId || claims.id },
      select: { id: true, isActive: true, role: true },
    });
    if (!u?.isActive || u.role !== 'SUPER_ADMIN')
      throw new ForbiddenException('Accès super admin requis.');
    return u.id;
  }
  async updateSettings(userId: string, dto: AssistantSettingsDto) {
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.assistantSettings.findUnique({
        where: { id: 'platform' },
      });
      const candidate = { ...previous, ...dto };
      if (
        dto.mode === 'IA_AVANCEE' &&
        !externalReady({ ...candidate, killSwitch: false })
      )
        throw new BadRequestException(
          'Confirmez la licence, sa date et sa référence, et un fournisseur/modèle correspondant à la configuration serveur.',
        );
      const data = {
        ...dto,
        ...(dto.licenseDate ? { licenseDate: new Date(dto.licenseDate) } : {}),
        ...(dto.planLimits
          ? { planLimits: JSON.parse(JSON.stringify(dto.planLimits)) }
          : {}),
        updatedBy: userId,
      };
      const result = await tx.assistantSettings.upsert({
        where: { id: 'platform' },
        create: { id: 'platform', ...data },
        update: data,
      });
      // Shortening retention also shortens existing conversations, never extends them.
      await tx.$executeRaw(
        Prisma.sql`UPDATE "AssistantConversation" SET "expiresAt"=LEAST("expiresAt", "createdAt" + ${dto.retentionDays} * interval '1 day')`,
      );
      await tx.activityLog.create({
        data: {
          userId,
          action: 'UPDATE',
          entity: 'ASSISTANT_SETTINGS',
          description: 'Réglages de l’assistant modifiés.',
          metadata: {
            mode: dto.mode,
            guideEnabled: dto.guideEnabled,
            disabledGuides: dto.disabledGuides,
            retentionDays: dto.retentionDays,
            analysisEnabled: dto.analysisEnabled,
            killSwitch: dto.killSwitch,
            trialCredits: dto.trialCredits,
            creditsPerAnalysis: dto.creditsPerAnalysis,
            creditsPerMessage: dto.creditsPerMessage,
            planLimits: data.planLimits,
            licenseConfirmed: dto.licenseConfirmed,
            licenseProvider: dto.licenseProvider,
            licenseDate: dto.licenseDate,
            licenseReference: dto.licenseReference,
            provider: dto.provider,
            model: dto.model,
          },
        },
      });
      return result;
    });
  }
  async testModel(userId: string) {
    if ((await this.settings()).killSwitch)
      throw new BadRequestException('Interrupteur externe actif.');
    if (!modelConfig())
      throw new BadRequestException(
        'Configurez ASSISTANT_PROVIDER, ASSISTANT_MODEL et ASSISTANT_API_KEY sur le serveur.',
      );
    return this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`,
        );
        const where = {
          userId,
          action: 'ASSISTANT_MODEL_TEST',
          createdAt: { gte: new Date(Date.now() - 60000) },
        };
        if ((await tx.activityLog.count({ where })) >= 3)
          throw new HttpException('Trois tests par minute maximum.', 429);
        await tx.activityLog.create({
          data: {
            userId,
            action: 'ASSISTANT_MODEL_TEST',
            entity: 'ASSISTANT_SETTINGS',
            description:
              'Test du connecteur avec vocabulaire fictif uniquement.',
          },
        });
      })
      .then(async () => {
        try {
          await selectSentences(['overview', 'consult']);
          return {
            ok: true,
            message:
              'Connexion et réponse structurée vérifiées sur données fictives.',
          };
        } catch {
          throw new BadRequestException(
            'Connexion non validée : vérifiez la clé, le modèle, les crédits et la disponibilité du fournisseur.',
          );
        }
      });
  }
  async updateOverride(
    userId: string,
    companyId: string,
    dto: AssistantOverrideDto,
  ) {
    if (
      !(await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Entreprise indisponible.');
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.assistantCompanyOverride.upsert({
        where: { companyId },
        create: { companyId, allowed: dto.allowed, forceMode: dto.forceMode },
        update: { allowed: dto.allowed, forceMode: dto.forceMode },
      });
      await tx.activityLog.create({
        data: {
          userId,
          action: 'UPDATE',
          entity: 'ASSISTANT_OVERRIDE',
          entityId: companyId,
          description: 'Accès au chat modifié.',
          metadata: { allowed: dto.allowed },
        },
      });
      return result;
    });
  }
  // ---- Crédits : solde par entreprise, journal, packs vendus (prix fixés par le super admin) -----
  async companyCredits(companyId: string) {
    const [wallet, ledger] = await Promise.all([
      this.prisma.assistantCreditWallet.findUnique({ where: { companyId } }),
      this.prisma.assistantCreditLedger.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          delta: true,
          balanceAfter: true,
          reason: true,
          note: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      balance: wallet?.balance ?? 0,
      trialGrantedAt: wallet?.trialGrantedAt ?? null,
      ledger,
    };
  }
  async adjustCredits(userId: string, companyId: string, dto: CreditAdjustDto) {
    if (
      !(await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Entreprise indisponible.');
    if (dto.reason === 'PURCHASE' && !dto.reference?.trim())
      throw new BadRequestException(
        'La référence du paiement est obligatoire pour un achat.',
      );
    if (dto.reason !== 'ADJUST' && dto.credits < 0)
      throw new BadRequestException(
        'Utilisez « Correction » pour retirer des crédits.',
      );
    try {
      await this.prisma.$transaction(async (tx) => {
        await addCredits(tx, {
          companyId,
          delta: dto.credits,
          reason: dto.reason,
          note: dto.note,
          refId: dto.reason === 'PURCHASE' ? dto.reference!.trim() : null,
          createdBy: userId,
        });
        await tx.activityLog.create({
          data: {
            userId,
            action: 'UPDATE',
            entity: 'ASSISTANT_CREDITS',
            entityId: companyId,
            description: 'Crédits de l’assistant modifiés.',
            metadata: { credits: dto.credits, reason: dto.reason },
          },
        });
      });
    } catch (e: any) {
      if (e?.code === 'P2002')
        throw new BadRequestException('Ce paiement a déjà été enregistré.');
      throw e;
    }
    return this.companyCredits(companyId);
  }
  packs(activeOnly: boolean) {
    return this.prisma.assistantCreditPack.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: [{ sortOrder: 'asc' }, { credits: 'asc' }],
    });
  }
  async savePack(userId: string, dto: CreditPackDto) {
    const data = {
      name: dto.name.trim(),
      credits: dto.credits,
      price: dto.price,
      active: dto.active ?? true,
      sortOrder: dto.sortOrder ?? 0,
    };
    const pack = dto.id
      ? await this.prisma.assistantCreditPack.update({
          where: { id: dto.id },
          data,
        })
      : await this.prisma.assistantCreditPack.create({ data });
    await this.prisma.activityLog.create({
      data: {
        userId,
        action: dto.id ? 'UPDATE' : 'CREATE',
        entity: 'ASSISTANT_CREDIT_PACK',
        entityId: pack.id,
        description: 'Pack de crédits de l’assistant enregistré.',
        metadata: { credits: data.credits, price: data.price },
      },
    });
    return pack;
  }
  async removePack(userId: string, id: string) {
    await this.prisma.assistantCreditPack.deleteMany({ where: { id } });
    await this.prisma.activityLog.create({
      data: {
        userId,
        action: 'DELETE',
        entity: 'ASSISTANT_CREDIT_PACK',
        entityId: id,
        description: 'Pack de crédits de l’assistant supprimé.',
      },
    });
    return { ok: true };
  }
  @Cron('0 3 * * *', { timeZone: 'Africa/Brazzaville' })
  async purge() {
    await this.prisma.assistantAnalysisUsage.deleteMany({
      where: { periodEnd: { lt: new Date(Date.now() - 90 * 86400000) } },
    });
    await this.prisma.assistantConversation.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: new Date() } },
          { user: { isActive: false } },
          { employee: { status: { in: ['TERMINATED', 'RETIRED'] } } },
          { company: { isActive: false } },
        ],
      },
    });
    await this.prisma.assistantUnansweredQuestion.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
  }
}