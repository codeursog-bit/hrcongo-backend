import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private resend: Resend;
  private readonly appName: string;
  private readonly appUrl: string;
  private readonly frontendUrl: string;
  private readonly fromEmail: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.error('❌ RESEND_API_KEY manquant dans .env');
      throw new Error('RESEND_API_KEY est requis');
    }
    this.resend = new Resend(apiKey);
    this.appName = process.env.APP_NAME || 'KONZA-RH CONGO';
    this.appUrl = process.env.APP_URL || 'http://localhost:3000';
    // FRONTEND_URL : URL de l'application front (là où l'utilisateur se connecte).
    // this.appUrl reste réservé au backend/API et n'est jamais utilisé dans un lien cliquable.
    this.frontendUrl = process.env.FRONTEND_URL || this.appUrl;
    this.fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@yourdomain.com';
    this.logger.log('✅ Resend initialisé');
  }

  // ──────────────────────────────────────────────────────────
  // HELPER : template de base
  // ──────────────────────────────────────────────────────────
  private baseTemplate(
    content: string,
    headerColor = '#0ea5e9',
    headerTitle = '',
  ): string {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${headerTitle}</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#0f172a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#0f172a;">
    <tr><td align="center" style="padding:40px 20px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0"
        style="max-width:600px;width:100%;background:#1e293b;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
        <!-- HEADER -->
        <tr>
          <td style="background:${headerColor};padding:32px 30px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">${headerTitle}</h1>
          </td>
        </tr>
        <!-- CONTENT -->
        <tr><td style="padding:32px 30px;color:#e2e8f0;">
          ${content}
        </td></tr>
        <!-- FOOTER -->
        <tr>
          <td style="padding:24px 30px;text-align:center;border-top:1px solid rgba(255,255,255,0.08);">
            <p style="margin:0 0 6px;font-size:12px;color:#64748b;">
              © ${new Date().getFullYear()} ${this.appName} — Email automatique, ne pas répondre.
            </p>
            <p style="margin:0;font-size:12px;color:#475569;">
              Pointe-Noire, Congo-Brazzaville
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private async send(
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<boolean> {
    try {
      const { error } = await this.resend.emails.send({
        from: `${this.appName} <${this.fromEmail}>`,
        to: [to],
        subject,
        html,
        text,
      });
      if (error) {
        this.logger.error('❌ Resend error:', error);
        return false;
      }
      this.logger.log(`✅ Email envoyé → ${to}`);
      return true;
    } catch (e) {
      this.logger.error(`❌ Échec envoi → ${to}:`, e);
      return false;
    }
  }

  // ──────────────────────────────────────────────────────────
  // 1. CONFIRMATION CANDIDATURE
  // ──────────────────────────────────────────────────────────
  async sendApplicationConfirmation(
    candidate: { firstName: string; email: string },
    job: { title: string; companyName: string },
  ): Promise<boolean> {
    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour <strong>${candidate.firstName}</strong>,</p>
      <p style="color:#94a3b8;line-height:1.7;margin:0 0 24px;">
        Merci d'avoir postulé ! Nous avons bien reçu votre candidature pour le poste de
        <strong style="color:#38bdf8;">${job.title}</strong> chez <strong>${job.companyName}</strong>.
        Nous sommes ravis de découvrir votre profil.
      </p>
      <div style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);border-radius:12px;padding:20px;margin:0 0 24px;">
        <p style="margin:0;font-size:14px;color:#7dd3fc;">
          📋 <strong>Prochaine étape</strong><br>
          <span style="color:#94a3b8;">Notre équipe RH va examiner votre dossier avec attention et reviendra vers vous sous 5 jours ouvrés.</span>
        </p>
      </div>
      <p style="color:#94a3b8;line-height:1.7;margin:0 0 20px;">
        En attendant, n'hésitez pas à consulter nos autres offres si d'autres postes vous intéressent.
      </p>
      <p style="color:#64748b;font-size:14px;margin:0;">Cordialement,<br><strong style="color:#e2e8f0;">L'équipe ${job.companyName}</strong></p>
    `,
      'linear-gradient(135deg,#0ea5e9,#6366f1)',
      `✅ Candidature reçue — ${job.title}`,
    );

    return this.send(
      candidate.email,
      `✅ Candidature reçue — ${job.title}`,
      html,
      `Bonjour ${candidate.firstName},\n\nMerci d'avoir postulé ! Votre candidature pour "${job.title}" chez ${job.companyName} a bien été reçue.\nNous vous répondrons sous 5 jours ouvrés.\n\nCordialement,\n${job.companyName}`,
    );
  }

  // ──────────────────────────────────────────────────────────
  // 2. RÉSULTAT PRÉ-SCREENING IA (éligible)
  // ──────────────────────────────────────────────────────────
  async sendTestInvitation(
    candidate: { firstName: string; email: string },
    job: { title: string; id: string },
    testInfo: { duration: number; candidateId: string },
  ): Promise<boolean> {
    const testUrl = `${this.frontendUrl}/jobs/${job.id}/test/${testInfo.candidateId}`;
    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour <strong>${candidate.firstName}</strong>,</p>
      <p style="color:#94a3b8;line-height:1.7;margin:0 0 20px;">
        Bonne nouvelle ! Votre profil pour le poste de <strong style="color:#38bdf8;">${job.title}</strong>
        a retenu notre attention et vous êtes présélectionné(e). Vous êtes maintenant invité(e)
        à passer le test technique, dernière étape avant l'entretien.
      </p>
      <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:12px;padding:20px;margin:0 0 24px;">
        <p style="margin:0 0 12px;font-weight:700;color:#34d399;">📝 Informations sur le test</p>
        <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">⏱️ Durée : <strong style="color:#e2e8f0;">${testInfo.duration} minutes</strong></p>
        <p style="margin:0;font-size:14px;color:#94a3b8;">📌 Disponible jusqu'à : <strong style="color:#e2e8f0;">7 jours</strong></p>
      </div>
      <div style="text-align:center;margin:28px 0;">
        <a href="${testUrl}" style="display:inline-block;background:linear-gradient(135deg,#10b981,#059669);color:#fff;padding:16px 40px;text-decoration:none;border-radius:12px;font-weight:700;font-size:16px;">
          Commencer le test →
        </a>
      </div>
      <div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:8px;padding:16px;margin:0 0 20px;">
        <p style="margin:0;font-size:13px;color:#fbbf24;">
          ⚠️ Installez-vous dans un endroit calme et ne changez pas d'onglet pendant le test.
          Trop de changements entraînent une disqualification automatique.
        </p>
      </div>
      <p style="color:#64748b;font-size:14px;margin:0;">Bonne chance, on croise les doigts pour vous !<br><strong style="color:#e2e8f0;">L'équipe RH</strong></p>
    `,
      'linear-gradient(135deg,#10b981,#059669)',
      '🎉 Félicitations — Test technique disponible',
    );

    return this.send(
      candidate.email,
      `🎉 Test technique disponible — ${job.title}`,
      html,
      `Bonjour ${candidate.firstName},\n\nFélicitations ! Votre profil a été présélectionné pour "${job.title}".\nPassez le test ici : ${testUrl}\nDurée : ${testInfo.duration} minutes\n\nBonne chance !\nL'équipe RH`,
    );
  }

  // ──────────────────────────────────────────────────────────
  // 3. RÉSULTAT PRÉ-SCREENING IA (non éligible)
  // ──────────────────────────────────────────────────────────
  async sendRejectionAfterScreening(
    candidate: { firstName: string; email: string },
    job: { title: string; companyName: string },
    reasoning?: string,
  ): Promise<boolean> {
    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour <strong>${candidate.firstName}</strong>,</p>
      <p style="color:#94a3b8;line-height:1.7;margin:0 0 20px;">
        Nous vous remercions sincèrement pour l'intérêt que vous portez au poste de
        <strong style="color:#38bdf8;">${job.title}</strong> chez <strong>${job.companyName}</strong>.
      </p>
      <p style="color:#94a3b8;line-height:1.7;margin:0 0 20px;">
        Après examen attentif de votre candidature, nous avons le regret de vous informer que votre profil
        ne correspond pas, pour le moment, aux critères requis pour ce poste.
      </p>
      ${
        reasoning
          ? `
      <div style="background:rgba(100,116,139,0.1);border-radius:8px;padding:16px;margin:0 0 20px;border-left:3px solid #475569;">
        <p style="margin:0;font-size:14px;color:#94a3b8;line-height:1.6;">${reasoning}</p>
      </div>`
          : ''
      }
      <p style="color:#94a3b8;line-height:1.7;margin:0 0 20px;">
        Nous vous encourageons vivement à postuler pour d'autres opportunités qui correspondraient
        mieux à votre profil, et vous souhaitons plein succès dans vos recherches.
      </p>
      <p style="color:#64748b;font-size:14px;margin:0;">Cordialement,<br><strong style="color:#e2e8f0;">L'équipe ${job.companyName}</strong></p>
    `,
      '#475569',
      'Suite à votre candidature',
    );

    return this.send(
      candidate.email,
      `Suite à votre candidature — ${job.title}`,
      html,
      `Bonjour ${candidate.firstName},\n\nNous vous remercions pour votre candidature à "${job.title}" chez ${job.companyName}.\nMalheureusement, votre profil ne correspond pas aux critères requis à ce stade.\n\nCordialement,\n${job.companyName}`,
    );
  }

  // ──────────────────────────────────────────────────────────
  // 4. INVITATION ENTRETIEN
  // ──────────────────────────────────────────────────────────
  async sendInterviewInvitation(
    candidate: { firstName: string; lastName: string; email: string },
    interview: {
      jobTitle: string;
      interviewDate: Date | null;
      interviewNotes?: string | null;
    },
  ): Promise<boolean> {
    const dateStr = interview.interviewDate
      ? interview.interviewDate.toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Date à confirmer — nous vous recontacterons';

    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour <strong>${candidate.firstName} ${candidate.lastName}</strong>,</p>
      <p style="color:#94a3b8;line-height:1.7;margin:0 0 20px;">
        Excellente nouvelle : nous avons le plaisir de vous inviter à un entretien pour le poste de
        <strong style="color:#38bdf8;">${interview.jobTitle}</strong>. Votre parcours nous a convaincus
        et nous avons hâte d'échanger avec vous.
      </p>
      <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.3);border-radius:12px;padding:24px;margin:0 0 24px;">
        <p style="margin:0 0 12px;font-weight:700;color:#a5b4fc;font-size:15px;">📅 Détails de l'entretien</p>
        <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">
          🗓️ Date : <strong style="color:#e2e8f0;">${dateStr}</strong>
        </p>
        ${
          interview.interviewNotes
            ? `
        <p style="margin:12px 0 0;font-size:14px;color:#94a3b8;">
          📝 Notes : <span style="color:#e2e8f0;">${interview.interviewNotes}</span>
        </p>`
            : ''
        }
      </div>
      <div style="background:rgba(56,189,248,0.06);border-radius:8px;padding:16px;margin:0 0 20px;">
        <p style="margin:0;font-size:13px;color:#7dd3fc;line-height:1.6;">
          💡 Merci de confirmer votre présence en répondant à cet email ou en contactant directement notre service RH.
        </p>
      </div>
      <p style="color:#64748b;font-size:14px;margin:0;">À très bientôt !<br><strong style="color:#e2e8f0;">L'équipe RH</strong></p>
    `,
      'linear-gradient(135deg,#6366f1,#8b5cf6)',
      '🎯 Invitation à un entretien',
    );

    return this.send(
      candidate.email,
      `🎯 Invitation à un entretien — ${interview.jobTitle}`,
      html,
      `Bonjour ${candidate.firstName},\n\nVous êtes invité(e) à un entretien pour "${interview.jobTitle}".\nDate : ${dateStr}\n${interview.interviewNotes ? `Notes : ${interview.interviewNotes}\n` : ''}\nCordialement,\nL'équipe RH`,
    );
  }

  // ──────────────────────────────────────────────────────────
  // 5. RÉSULTAT ENTRETIEN — EMBAUCHÉ
  // ──────────────────────────────────────────────────────────
  async sendHireNotification(
    candidate: { firstName: string; email: string },
    job: { title: string; companyName: string },
  ): Promise<boolean> {
    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour <strong>${candidate.firstName}</strong>,</p>
      <p style="color:#94a3b8;line-height:1.7;margin:0 0 20px;">
        Nous avons le grand plaisir de vous informer que vous avez été <strong style="color:#34d399;">sélectionné(e)</strong>
        pour le poste de <strong style="color:#38bdf8;">${job.title}</strong> chez <strong>${job.companyName}</strong>.
        Toute l'équipe est ravie de vous accueillir.
      </p>
      <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:24px;text-align:center;margin:0 0 24px;">
        <p style="font-size:48px;margin:0 0 8px;">🎉</p>
        <p style="margin:0;font-weight:700;color:#34d399;font-size:18px;">Bienvenue dans l'équipe !</p>
      </div>
      <p style="color:#94a3b8;line-height:1.7;margin:0 0 20px;">
        Notre équipe RH vous contactera très prochainement pour les formalités d'embauche
        et convenir ensemble de votre date de prise de poste.
      </p>
      <p style="color:#64748b;font-size:14px;margin:0;">Cordialement,<br><strong style="color:#e2e8f0;">L'équipe ${job.companyName}</strong></p>
    `,
      'linear-gradient(135deg,#10b981,#059669)',
      '🎉 Félicitations — Vous êtes retenu(e)',
    );

    return this.send(
      candidate.email,
      `🎉 Félicitations — Poste ${job.title}`,
      html,
      `Bonjour ${candidate.firstName},\n\nFélicitations ! Vous avez été sélectionné(e) pour le poste de "${job.title}" chez ${job.companyName}.\nNotre équipe vous contactera pour les prochaines étapes.\n\nCordialement,\n${job.companyName}`,
    );
  }

  // ──────────────────────────────────────────────────────────
  // 6. RÉSULTAT ENTRETIEN — REFUSÉ
  // ──────────────────────────────────────────────────────────
  async sendRejectionAfterInterview(
    candidate: { firstName: string; email: string },
    job: { title: string; companyName: string },
    reason?: string,
  ): Promise<boolean> {
    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour <strong>${candidate.firstName}</strong>,</p>
      <p style="color:#94a3b8;line-height:1.7;margin:0 0 20px;">
        Nous vous remercions chaleureusement pour le temps et l'énergie que vous nous avez consacrés
        lors de l'entretien pour le poste de <strong style="color:#38bdf8;">${job.title}</strong>.
      </p>
      <p style="color:#94a3b8;line-height:1.7;margin:0 0 20px;">
        Après délibération, nous avons décidé de poursuivre avec un autre candidat dont le profil
        correspond davantage à nos besoins actuels. Cette décision n'enlève rien à la qualité de votre entretien.
      </p>
      ${
        reason
          ? `
      <div style="background:rgba(100,116,139,0.1);border-radius:8px;padding:16px;margin:0 0 20px;border-left:3px solid #475569;">
        <p style="margin:0;font-size:14px;color:#94a3b8;line-height:1.6;">${reason}</p>
      </div>`
          : ''
      }
      <p style="color:#94a3b8;line-height:1.7;margin:0 0 20px;">
        Nous gardons votre dossier précieusement en vue d'opportunités futures et vous souhaitons
        beaucoup de succès dans la suite de votre parcours.
      </p>
      <p style="color:#64748b;font-size:14px;margin:0;">Cordialement,<br><strong style="color:#e2e8f0;">L'équipe ${job.companyName}</strong></p>
    `,
      '#334155',
      'Suite à votre entretien',
    );

    return this.send(
      candidate.email,
      `Suite à votre entretien — ${job.title}`,
      html,
      `Bonjour ${candidate.firstName},\n\nNous vous remercions pour votre entretien pour "${job.title}" chez ${job.companyName}.\nNous avons retenu un autre candidat. Bonne continuation.\n\nCordialement,\n${job.companyName}`,
    );
  }

  // ──────────────────────────────────────────────────────────
  // MÉTHODES EXISTANTES
  // ──────────────────────────────────────────────────────────
  async sendUserConfirmation(
    user: any,
    originalPassword: string,
  ): Promise<boolean> {
    const loginUrl = `${this.frontendUrl}/auth/login`;
    const hasPhone = !!user.phone;

    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour <strong>${user.firstName} ${user.lastName}</strong>,</p>
      <p style="color:#94a3b8;margin:0 0 24px;">Votre compte <strong>${this.appName}</strong> a été créé avec succès. Voici vos identifiants de connexion.</p>
      <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.3);border-radius:12px;padding:20px;margin:0 0 24px;">
        <p style="margin:0 0 12px;font-weight:700;color:#a5b4fc;">🔑 Vos identifiants</p>
        <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">📧 Email : <strong style="color:#e2e8f0;">${user.email}</strong></p>
        ${hasPhone ? `<p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">📱 Téléphone : <strong style="color:#e2e8f0;">${user.phone}</strong></p>` : ''}
        <p style="margin:0;font-size:14px;color:#94a3b8;">🔑 Mot de passe : <code style="background:#0f172a;padding:4px 8px;border-radius:6px;color:#38bdf8;font-size:16px;">${originalPassword}</code></p>
      </div>
      ${
        hasPhone
          ? `
      <div style="background:rgba(56,189,248,0.06);border-radius:8px;padding:14px;margin:0 0 20px;">
        <p style="margin:0;font-size:13px;color:#7dd3fc;line-height:1.6;">
          💡 Vous pouvez vous connecter avec votre <strong>email</strong> ou votre <strong>numéro de téléphone</strong>, au choix.
        </p>
      </div>`
          : ''
      }
      <div style="text-align:center;margin:20px 0;">
        <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:14px 36px;text-decoration:none;border-radius:10px;font-weight:700;">
          Se connecter
        </a>
      </div>
      <div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:8px;padding:14px;margin:0;">
        <p style="margin:0;font-size:13px;color:#fbbf24;">⚠️ Pour votre sécurité, changez votre mot de passe dès votre première connexion.</p>
      </div>
    `,
      'linear-gradient(135deg,#6366f1,#8b5cf6)',
      `🎉 Bienvenue sur ${this.appName}`,
    );

    return this.send(
      user.email,
      `🔐 Vos identifiants ${this.appName}`,
      html,
      `Bonjour ${user.firstName},\n\nEmail: ${user.email}${hasPhone ? `\nTéléphone: ${user.phone} (vous pouvez aussi vous connecter avec ce numéro)` : ''}\nMot de passe: ${originalPassword}\nConnexion: ${loginUrl}`,
    );
  }

  async sendLeaveApproval(employee: any, leave: any): Promise<boolean> {
    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour <strong>${employee.firstName}</strong>,</p>
      <p style="color:#94a3b8;margin:0 0 20px;">Bonne nouvelle : votre demande de congé a été <strong style="color:#34d399;">approuvée</strong>. Profitez-en bien !</p>
      <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:12px;padding:20px;margin:0 0 20px;">
        <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">📅 Du : <strong style="color:#e2e8f0;">${new Date(leave.startDate).toLocaleDateString('fr-FR')}</strong></p>
        <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">📅 Au : <strong style="color:#e2e8f0;">${new Date(leave.endDate).toLocaleDateString('fr-FR')}</strong></p>
        <p style="margin:0;font-size:14px;color:#94a3b8;">📊 Durée : <strong style="color:#e2e8f0;">${leave.daysCount} jour(s)</strong></p>
      </div>
      <p style="color:#64748b;font-size:14px;margin:0;">Cordialement,<br><strong style="color:#e2e8f0;">Service RH</strong></p>
    `,
      'linear-gradient(135deg,#10b981,#059669)',
      '✅ Congé approuvé',
    );

    return this.send(
      employee.email,
      '✅ Demande de congé approuvée',
      html,
      `Bonjour ${employee.firstName},\n\nVotre congé du ${new Date(leave.startDate).toLocaleDateString('fr-FR')} au ${new Date(leave.endDate).toLocaleDateString('fr-FR')} (${leave.daysCount} jour(s)) a été approuvé.\n\nCordialement,\nService RH`,
    );
  }

  async sendLeaveRejection(
    employee: any,
    leave: any,
    reason?: string,
  ): Promise<boolean> {
    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour <strong>${employee.firstName}</strong>,</p>
      <p style="color:#94a3b8;margin:0 0 20px;">Votre demande de congé a été <strong style="color:#f87171;">refusée</strong>. N'hésitez pas à vous rapprocher du service RH pour en discuter.</p>
      <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:20px;margin:0 0 20px;">
        <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">📅 Période : <strong style="color:#e2e8f0;">${new Date(leave.startDate).toLocaleDateString('fr-FR')} → ${new Date(leave.endDate).toLocaleDateString('fr-FR')}</strong></p>
        ${reason ? `<p style="margin:8px 0 0;font-size:14px;color:#94a3b8;">💬 Motif : <span style="color:#e2e8f0;">${reason}</span></p>` : ''}
      </div>
      <p style="color:#64748b;font-size:14px;margin:0;">Cordialement,<br><strong style="color:#e2e8f0;">Service RH</strong></p>
    `,
      'linear-gradient(135deg,#ef4444,#dc2626)',
      '❌ Congé refusé',
    );

    return this.send(
      employee.email,
      '❌ Demande de congé refusée',
      html,
      `Bonjour ${employee.firstName},\n\nVotre congé a été refusé.${reason ? `\nMotif: ${reason}` : ''}\n\nCordialement,\nService RH`,
    );
  }

  async sendPayslipReady(employee: any, payroll: any): Promise<boolean> {
    const payslipUrl = `${this.frontendUrl}/bulletins/${payroll.id}`;
    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour <strong>${employee.firstName}</strong>,</p>
      <p style="color:#94a3b8;margin:0 0 20px;">Votre bulletin de paie <strong>${payroll.month}/${payroll.year}</strong> est disponible dès maintenant.</p>
      <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:12px;padding:20px;margin:0 0 24px;">
        <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">💵 Salaire net : <strong style="color:#60a5fa;font-size:18px;">${payroll.netSalary?.toLocaleString('fr-FR')} FCFA</strong></p>
        <p style="margin:0;font-size:14px;color:#94a3b8;">📅 Mois : <strong style="color:#e2e8f0;">${payroll.month}/${payroll.year}</strong></p>
      </div>
      <div style="text-align:center;">
        <a href="${payslipUrl}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;padding:14px 36px;text-decoration:none;border-radius:10px;font-weight:700;">
          Télécharger mon bulletin
        </a>
      </div>
    `,
      'linear-gradient(135deg,#3b82f6,#6366f1)',
      '💰 Bulletin de paie disponible',
    );

    return this.send(
      employee.email,
      `💰 Bulletin de paie ${payroll.month}/${payroll.year}`,
      html,
      `Bonjour ${employee.firstName},\n\nVotre bulletin de paie ${payroll.month}/${payroll.year} est disponible (${payroll.netSalary?.toLocaleString('fr-FR')} FCFA net).\n${payslipUrl}`,
    );
  }

  async sendPmeAdminInvitation(params: {
    to: string;
    firstName: string;
    lastName: string;
    companyName: string;
    cabinetName: string;
    cabinetLogo?: string | null;
    cabinetColor?: string | null;
    invitationToken: string;
    expiresAt: Date;
  }): Promise<boolean> {
    const {
      to,
      firstName,
      lastName,
      companyName,
      cabinetName,
      cabinetLogo,
      cabinetColor,
      invitationToken,
      expiresAt,
    } = params;
    const color = cabinetColor || '#6366f1';
    const acceptUrl = `${this.frontendUrl}/auth/accept-invitation/${invitationToken}`;
    const expiryLabel = expiresAt.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const displayName = `${firstName} ${lastName}`.trim() || to.split('@')[0];

    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour <strong>${displayName}</strong>,</p>
      <p style="color:#94a3b8;margin:0 0 24px;line-height:1.6;">
        Le cabinet <strong style="color:#e2e8f0;">${cabinetName}</strong> vous invite à accéder
        à l'espace RH de votre entreprise <strong style="color:#e2e8f0;">${companyName}</strong>.
      </p>
      <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.3);border-radius:12px;padding:20px;margin:0 0 24px;">
        <p style="margin:0 0 10px;font-weight:700;color:#a5b4fc;">✅ Vous pourrez :</p>
        <ul style="margin:0;padding-left:20px;color:#94a3b8;font-size:14px;line-height:1.8;">
          <li>Gérer vos employés et leurs accès</li>
          <li>Suivre les présences et les congés</li>
          <li>Consulter les bulletins de paie (générés par le cabinet)</li>
          <li>Accéder aux rapports RH de votre entreprise</li>
        </ul>
      </div>
      <div style="text-align:center;margin:20px 0;">
        <a href="${acceptUrl}" style="display:inline-block;background:${color};color:#fff;padding:14px 36px;text-decoration:none;border-radius:10px;font-weight:700;">
          Créer mon accès →
        </a>
      </div>
      <div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:8px;padding:14px;margin-top:20px;">
        <p style="margin:0;font-size:13px;color:#fbbf24;">⏳ Ce lien est valable jusqu'au <strong>${expiryLabel}</strong>.</p>
      </div>
    `,
      color,
      `Bienvenue — ${companyName}`,
    );

    return this.send(
      to,
      `Invitation — Accès RH (${companyName})`,
      html,
      `Bonjour ${displayName},\n\nAccédez à votre espace RH : ${acceptUrl}\nValable jusqu'au ${expiryLabel}.`,
    );
  }

  // ──────────────────────────────────────────────────────────
  // MOT DE PASSE OUBLIÉ — Lien de réinitialisation
  // ──────────────────────────────────────────────────────────
  async sendPasswordReset(params: {
    to: string;
    firstName: string;
    resetUrl: string;
  }): Promise<boolean> {
    const { to, firstName, resetUrl } = params;

    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour <strong>${firstName}</strong>,</p>
      <p style="color:#94a3b8;margin:0 0 24px;line-height:1.6;">
        Vous avez demandé la réinitialisation de votre mot de passe.
        Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${resetUrl}"
           style="display:inline-block;background:#0ea5e9;color:#fff;padding:14px 40px;
                  text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;">
          Réinitialiser mon mot de passe →
        </a>
      </div>
      <div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);
                  border-radius:8px;padding:14px;margin-top:20px;">
        <p style="margin:0;font-size:13px;color:#fbbf24;">
          ⏳ Ce lien est valable pendant <strong>30 minutes</strong>.
        </p>
      </div>
      <p style="color:#64748b;font-size:13px;margin-top:20px;line-height:1.6;">
        Si vous n'êtes pas à l'origine de cette demande, ignorez cet email en toute sécurité.
        Votre mot de passe ne sera pas modifié.
      </p>
    `,
      '#0ea5e9',
      'Réinitialisation du mot de passe',
    );

    return this.send(
      to,
      `Réinitialisation de votre mot de passe — ${this.appName}`,
      html,
      `Bonjour ${firstName},\n\nRéinitialisez votre mot de passe ici : ${resetUrl}\nCe lien expire dans 30 minutes.`,
    );
  }

  async sendWelcomeAdmin(params: {
    to: string;
    firstName: string;
    lastName: string;
  }): Promise<boolean> {
    const { to, firstName, lastName } = params;
    const loginUrl = `${this.frontendUrl}/auth/login`;

    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour <strong>${firstName} ${lastName}</strong>,</p>
      <p style="color:#94a3b8;margin:0 0 24px;line-height:1.6;">
        Votre compte <strong style="color:#e2e8f0;">${this.appName}</strong> a été créé avec succès.
        Vous pouvez dès maintenant vous connecter et configurer votre espace RH.
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${loginUrl}"
           style="display:inline-block;background:#0ea5e9;color:#fff;padding:14px 40px;
                  text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;">
          Accéder à mon espace →
        </a>
      </div>
      <p style="color:#64748b;font-size:13px;margin-top:20px;">
        Si vous n'êtes pas à l'origine de cette inscription, ignorez cet email.
      </p>
    `,
      'linear-gradient(135deg,#0ea5e9,#6366f1)',
      `🎉 Bienvenue sur ${this.appName}`,
    );

    return this.send(
      to,
      `🎉 Bienvenue sur ${this.appName} — Votre compte est prêt`,
      html,
      `Bonjour ${firstName},\n\nVotre compte ${this.appName} est prêt.\nConnectez-vous ici : ${loginUrl}`,
    );
  }

  async sendCabinetInvitation(params: {
    to: string;
    cabinetName: string;
    tempPassword: string;
  }): Promise<boolean> {
    const { to, cabinetName, tempPassword } = params;
    const loginUrl = `${this.frontendUrl}/auth/login`;

    const html = this.baseTemplate(
      `
      <p style="font-size:16px;margin:0 0 20px;">Bonjour,</p>
      <p style="color:#94a3b8;margin:0 0 24px;line-height:1.6;">
        Vous avez été ajouté(e) comme gestionnaire du cabinet
        <strong style="color:#e2e8f0;">${cabinetName}</strong>.
        Voici vos identifiants de connexion provisoires.
      </p>
      <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.3);
                  border-radius:12px;padding:20px;margin:0 0 24px;">
        <p style="margin:0 0 10px;font-weight:700;color:#a5b4fc;">🔑 Vos identifiants</p>
        <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">
          📧 Email : <strong style="color:#e2e8f0;">${to}</strong>
        </p>
        <p style="margin:0;font-size:14px;color:#94a3b8;">
          🔑 Mot de passe temporaire :
          <code style="background:#0f172a;padding:4px 10px;border-radius:6px;
                       color:#38bdf8;font-size:16px;">${tempPassword}</code>
        </p>
      </div>
      <div style="text-align:center;margin:28px 0;">
        <a href="${loginUrl}"
           style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);
                  color:#fff;padding:14px 40px;text-decoration:none;
                  border-radius:10px;font-weight:700;font-size:15px;">
          Accéder au cabinet →
        </a>
      </div>
      <div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);
                  border-radius:8px;padding:14px;">
        <p style="margin:0;font-size:13px;color:#fbbf24;">
          ⚠️ Changez votre mot de passe dès votre première connexion.
        </p>
      </div>
    `,
      'linear-gradient(135deg,#6366f1,#8b5cf6)',
      `Invitation — Cabinet ${cabinetName}`,
    );

    return this.send(
      to,
      `Invitation — Accès cabinet ${cabinetName}`,
      html,
      `Bonjour,\n\nVous avez été ajouté(e) au cabinet "${cabinetName}".\n\nEmail : ${to}\nMot de passe temporaire : ${tempPassword}\n\nConnectez-vous ici : ${loginUrl}\n\nChangez votre mot de passe à la première connexion.`,
    );
  }

  // ── Notification au SUPER_ADMIN quand un message de contact arrive ──────────
  async sendContactNotification(params: {
    to: string;
    name: string;
    email: string;
    company?: string;
    phone?: string;
    subject: string;
    message: string;
    id?: string;
  }): Promise<boolean> {
    const content = `
      <h2 style="color:#e2e8f0;font-size:20px;margin:0 0 24px;">
        📩 Nouveau message de contact
      </h2>

      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:#94a3b8;font-size:14px;width:140px;">Nom</td>
          <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:#f1f5f9;font-size:14px;font-weight:600;">${params.name}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:#94a3b8;font-size:14px;">Email</td>
          <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:14px;">
            <a href="mailto:${params.email}" style="color:#06b6d4;text-decoration:none;">${params.email}</a>
          </td>
        </tr>
        ${
          params.company
            ? `<tr>
          <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:#94a3b8;font-size:14px;">Entreprise</td>
          <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:#f1f5f9;font-size:14px;">${params.company}</td>
        </tr>`
            : ''
        }
        ${
          params.phone
            ? `<tr>
          <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:#94a3b8;font-size:14px;">Téléphone</td>
          <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:14px;">
            <a href="tel:${params.phone}" style="color:#06b6d4;text-decoration:none;">${params.phone}</a>
          </td>
        </tr>`
            : ''
        }
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:#94a3b8;font-size:14px;">Sujet</td>
          <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:14px;">
            <span style="background:rgba(6,182,212,0.15);color:#06b6d4;padding:3px 10px;border-radius:99px;font-weight:700;font-size:12px;">${params.subject}</span>
          </td>
        </tr>
      </table>

      <div style="margin-top:24px;">
        <p style="color:#94a3b8;font-size:13px;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.06em;">Message</p>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px;">
          <p style="color:#e2e8f0;font-size:15px;line-height:1.75;margin:0;white-space:pre-wrap;">${params.message}</p>
        </div>
      </div>

      <div style="margin-top:28px;text-align:center;">
        <a href="mailto:${params.email}?subject=Re: ${encodeURIComponent(params.subject)}"
          style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#3b82f6);color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:10px;">
          Répondre à ${params.name} →
        </a>
      </div>

      ${params.id ? `<p style="margin-top:20px;text-align:center;font-size:12px;color:#475569;">Référence message : #${params.id}</p>` : ''}
    `;

    return this.send(
      params.to,
      `[${this.appName} Contact] ${params.subject} — ${params.name}`,
      this.baseTemplate(content, '#0ea5e9', '📩 Nouveau message'),
      `Nouveau message de ${params.name} (${params.email}) : ${params.subject}\n\n${params.message}`,
    );
  }

  // ── Confirmation à l'expéditeur ──────────────────────────────────────────────
  async sendContactConfirmation(params: {
    to: string;
    name: string;
    subject: string;
  }): Promise<boolean> {
    const content = `
      <h2 style="color:#e2e8f0;font-size:20px;margin:0 0 16px;">
        Bonjour ${params.name}, nous avons bien reçu votre message ✅
      </h2>

      <p style="color:#94a3b8;font-size:15px;line-height:1.75;margin:0 0 20px;">
        Merci de nous avoir contactés concernant : <strong style="color:#f1f5f9;">"${params.subject}"</strong>.
      </p>

      <div style="background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.2);border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="color:#e2e8f0;font-size:14px;line-height:1.7;margin:0;">
          Notre équipe à Pointe-Noire vous répondra dans les prochaines <strong>24 heures ouvrées</strong>.
          Si votre demande est urgente, appelez-nous directement au
          <a href="tel:+242053079107" style="color:#06b6d4;text-decoration:none;font-weight:700;">+242 053 079 107</a>.
        </p>
      </div>

      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
            <span style="color:#94a3b8;font-size:13px;">📧</span>
            <a href="mailto:contact@konzarh.com" style="color:#06b6d4;font-size:13px;text-decoration:none;margin-left:8px;">contact@konzarh.com</a>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 0;">
            <span style="color:#94a3b8;font-size:13px;">📍</span>
            <span style="color:#94a3b8;font-size:13px;margin-left:8px;">Pointe-Noire, Congo-Brazzaville</span>
          </td>
        </tr>
      </table>

      <div style="margin-top:28px;text-align:center;">
        <a href="${this.frontendUrl}"
          style="display:inline-block;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#e2e8f0;text-decoration:none;font-weight:600;font-size:14px;padding:10px 24px;border-radius:10px;">
          Visiter ${this.appName} →
        </a>
      </div>
    `;

    return this.send(
      params.to,
      `${this.appName} — Message bien reçu ✅`,
      this.baseTemplate(content, '#0ea5e9', this.appName),
      `Bonjour ${params.name}, nous avons bien reçu votre message concernant "${params.subject}". Notre équipe vous répondra sous 24h.`,
    );
  }

  // ── Notif SUPER_ADMIN quand un nouveau post est publié ──────────────────────
  async sendNewBlogPostNotification(params: {
    to: string;
    postTitle: string;
    postSlug: string;
    authorName: string;
    authorRole: string;
    company?: string;
    category: string;
    appUrl?: string;
  }): Promise<boolean> {
    const url = `${params.appUrl || this.frontendUrl}/blog/${params.postSlug}`;

    const content = `
      <h2 style="color:#e2e8f0;font-size:20px;margin:0 0 20px;">
        📝 Nouvel article publié sur le blog
      </h2>

      <div style="background:rgba(6,182,212,0.06);border:1px solid rgba(6,182,212,0.2);border-radius:12px;padding:20px;margin-bottom:20px;">
        <p style="color:#06b6d4;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">${params.category}</p>
        <h3 style="color:#f1f5f9;font-size:18px;font-weight:800;margin:0 0 12px;">${params.postTitle}</h3>
        <p style="color:#94a3b8;font-size:13px;margin:0;">
          Par <strong style="color:#e2e8f0;">${params.authorName}</strong>
          · ${params.authorRole}
          ${params.company ? `· ${params.company}` : ''}
        </p>
      </div>

      <div style="text-align:center;margin-top:24px;">
        <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#3b82f6);color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:10px;">
          Voir l'article →
        </a>
      </div>
    `;

    return this.send(
      params.to,
      `[Blog ${this.appName}] Nouvel article : ${params.postTitle}`,
      this.baseTemplate(content, '#0ea5e9', `📝 Blog ${this.appName}`),
      `Nouvel article : "${params.postTitle}" par ${params.authorName}. Lire : ${url}`,
    );
  }
}
