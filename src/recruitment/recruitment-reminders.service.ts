// src/recruitment/recruitment-reminders.service.ts
// ============================================================================
// RAPPELS AUTOMATIQUES D'ENTRETIEN
//   Toutes les 30 minutes : pour chaque entretien prévu dans les 24 heures,
//   • le candidat reçoit un e-mail de rappel (modèle « Rappel d'entretien »,
//     personnalisable par l'entreprise) — il peut répondre au recruteur ;
//   • le recruteur qui l'a planifié reçoit une notification dans l'application.
//   Un seul rappel par entretien ; si l'entretien est reporté, le rappel repart.
//   Pas de rappel si l'entretien a été planifié il y a moins de 3 h (l'invitation
//   vient de partir).
// ============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { EMAIL_TEMPLATES, renderTemplate } from './recruitment-email-templates';

const TZ = 'Africa/Brazzaville';
const fmtDate = (d: Date) =>
  d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
const fmtTime = (d: Date) =>
  d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

@Injectable()
export class RecruitmentRemindersService {
  private readonly logger = new Logger(RecruitmentRemindersService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  @Cron('*/30 * * * *', { timeZone: TZ })
  async sendInterviewReminders() {
    const now = new Date();
    let due: any[] = [];
    try {
      due = await this.prisma.candidateInterview.findMany({
        where: {
          status: 'SCHEDULED',
          reminderSentAt: null,
          scheduledAt: { gt: now, lte: new Date(now.getTime() + 24 * 3_600_000) },
          createdAt: { lte: new Date(now.getTime() - 3 * 3_600_000) },
        },
        include: {
          candidate: {
            select: {
              id: true, firstName: true, lastName: true, email: true,
              jobOffer: { select: { title: true, companyId: true } },
            },
          },
        },
        take: 100,
      });
    } catch (e) {
      this.logger.error(`Lecture des entretiens à rappeler impossible: ${(e as Error).message}`);
      return;
    }
    if (!due.length) return;

    let sent = 0;
    for (const itv of due) {
      // « Réserve » l'entretien : deux instances du serveur n'enverront jamais deux rappels
      const claim = await this.prisma.candidateInterview.updateMany({
        where: { id: itv.id, reminderSentAt: null },
        data: { reminderSentAt: new Date() },
      });
      if (claim.count === 0) continue;
      try {
        await this.remind(itv);
        sent++;
      } catch (e) {
        // Échec : on libère l'entretien, le prochain passage réessaiera
        await this.prisma.candidateInterview
          .update({ where: { id: itv.id }, data: { reminderSentAt: null } })
          .catch(() => undefined);
        this.logger.warn(`Rappel non envoyé (entretien ${itv.id}): ${(e as Error).message}`);
      }
    }
    if (sent) this.logger.log(`✅ ${sent} rappel(s) d'entretien envoyé(s)`);
  }

  private async remind(itv: any) {
    const candidate = itv.candidate;
    if (!candidate?.email) throw new Error('candidat sans e-mail');
    const companyId: string = candidate.jobOffer.companyId;

    const [company, creator, custom] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: companyId }, select: { tradeName: true, legalName: true } }),
      itv.createdById
        ? this.prisma.user.findUnique({ where: { id: itv.createdById }, select: { id: true, firstName: true, lastName: true, email: true } })
        : Promise.resolve(null),
      this.prisma.recruitmentEmailTemplate.findUnique({
        where: { companyId_templateId: { companyId, templateId: 'INTERVIEW_REMINDER' } },
      }),
    ]);

    const base = EMAIL_TEMPLATES.find((t) => t.id === 'INTERVIEW_REMINDER')!;
    const companyName = company?.tradeName || company?.legalName || 'Notre entreprise';
    const recruiter = creator ? `${creator.firstName ?? ''} ${creator.lastName ?? ''}`.trim() : companyName;
    const vars: Record<string, string> = {
      prenom: candidate.firstName,
      nom: candidate.lastName,
      poste: candidate.jobOffer.title,
      entreprise: companyName,
      recruteur: recruiter || companyName,
      date_entretien: fmtDate(itv.scheduledAt),
      heure_entretien: fmtTime(itv.scheduledAt),
      lieu: itv.meetingUrl || itv.location || 'à confirmer',
    };
    const subject = renderTemplate(custom?.subject ?? base.subject, vars);
    const body = renderTemplate(custom?.body ?? base.body, vars);

    const ok = await this.mail.sendRecruitmentMessage({
      to: candidate.email, subject, body, companyName, replyTo: creator?.email ?? null,
    });
    if (!ok) throw new Error('envoi e-mail refusé');

    await this.prisma.candidateActivity.create({
      data: {
        candidateId: candidate.id,
        type: 'EMAIL' as any,
        title: `Rappel automatique envoyé : ${subject}`,
        body,
        metadata: { sent: true, automatic: true, interviewId: itv.id },
        authorName: 'Système',
      },
    });

    if (creator) {
      try {
        await this.prisma.notification.create({
          data: {
            userId: creator.id,
            type: 'SYSTEM_ALERT' as any,
            title: 'Entretien dans moins de 24 h',
            message: `${candidate.firstName} ${candidate.lastName} — ${fmtDate(itv.scheduledAt)} à ${fmtTime(itv.scheduledAt)}. Le candidat a reçu un rappel.`,
            link: `/recrutement/candidat/${candidate.id}?tab=interviews`,
            metadata: { interviewId: itv.id },
          },
        });
      } catch (e) {
        this.logger.warn(`Notification recruteur échouée: ${(e as Error).message}`);
      }
    }
  }
}