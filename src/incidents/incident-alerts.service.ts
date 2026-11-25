import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushNotificationsService } from '../notifications/push-notifications.service';
import { MailService } from '../mail/mail.service';
import { AppGateway } from '../app.gateway';
import type { IncidentEvent } from './incidents.service';
import { safeIncidentText } from './incident-privacy';

@Injectable()
export class IncidentAlertsService {
  private readonly logger = new Logger(IncidentAlertsService.name);
  private windows = new Map<string, { start: number; count: number }>();
  private failedChannels = new Set<string>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly push: PushNotificationsService,
    private readonly mail: MailService,
    private readonly gateway: AppGateway,
  ) {}
  private async claim(key: string, ttl = 900000) {
    await this.prisma.notificationDedupKey.deleteMany({
      where: { key, createdAt: { lte: new Date(Date.now() - ttl) } },
    });
    try {
      await this.prisma.notificationDedupKey.create({ data: { key } });
      return true;
    } catch (e) {
      if ((e as any)?.code === 'P2002') return false;
      throw e;
    }
  }
  async notify(
    group: {
      id: string;
      fingerprint: string;
      severity: string;
      count: number;
      firstSeen: Date;
      lastSeen: Date;
    },
    event: IncidentEvent,
    reason: { isNew: boolean; regressed: boolean; batchCount: number },
  ) {
    if (process.env.INCIDENTS_ALERTS_ENABLED !== 'true') return;
    const now = Date.now(),
      windowMs = Math.max(
        60000,
        Number(process.env.INCIDENTS_SPIKE_WINDOW_MS) || 300000,
      );
    let window = this.windows.get(group.id);
    if (!window || now - window.start > windowMs) {
      window = { start: now, count: 0 };
      this.windows.set(group.id, window);
    }
    window.count += reason.batchCount;
    if (this.windows.size > 1000)
      for (const [key, value] of this.windows)
        if (now - value.start > windowMs) this.windows.delete(key);
    const spike =
      window.count >=
      Math.max(2, Number(process.env.INCIDENTS_SPIKE_THRESHOLD) || 50);
    if (
      ['INFO', 'WARN'].includes(group.severity) &&
      !reason.regressed &&
      !spike
    )
      return;
    if (
      !reason.isNew &&
      !reason.regressed &&
      !spike &&
      group.severity !== 'CRITICAL'
    )
      return;
    // A regression is a new lifecycle; it may alert even if the preceding incident alerted recently.
    const key = `incident:${group.id}${reason.regressed ? `:regressed:${group.lastSeen.toISOString()}` : ''}`;
    if (!(await this.claim(key))) return;
    const [admins, company, user] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'SUPER_ADMIN', isActive: true },
        select: { id: true, email: true, incidentEmailAlerts: true },
      }),
      event.companyId
        ? this.prisma.company.findUnique({
            where: { id: event.companyId },
            select: {
              legalName: true,
              subscription: { select: { plan: true } },
            },
          })
        : null,
      event.userId
        ? this.prisma.user.findUnique({
            where: { id: event.userId },
            select: { firstName: true, lastName: true, role: true },
          })
        : null,
    ]);
    const title = `${reason.regressed ? 'Récidive' : spike ? 'Pic d’erreurs' : 'Incident'} · ${group.severity}`;
    const message = [
      `${company?.legalName ?? 'Plateforme / visiteur'}${company?.subscription ? ` · ${company.subscription.plan}` : ''}`,
      user
        ? `${user.firstName} ${user.lastName} · ${user.role}`
        : 'Utilisateur non identifié',
      `${event.source} · ${event.path}`,
      event.message,
      `${group.count} occurrence(s) depuis ${group.firstSeen.toISOString()}`,
      `Version : ${event.version ?? 'non renseignée'}`,
      event.context?.browser ?? '',
    ]
      .filter(Boolean)
      .join('\n');
    const link = `/admin/errors?incident=${group.id}`;
    const failures: string[] = [];
    for (const admin of admins) {
      try {
        await this.notifications.create({
          userId: admin.id,
          type: 'SYSTEM_ALERT',
          title,
          message,
          link,
          metadata: { incidentId: group.id },
        });
      } catch {
        failures.push('notification');
      }
      try {
        const delivery = await this.push.sendPushToUserDetailed(admin.id, {
          title,
          body: `${event.source} · ${event.path}`,
          url: link,
          tag: `incident:${group.id}`,
          requireInteraction: group.severity === 'CRITICAL',
        });
        if (['FAILED', 'PARTIAL', 'NO_VAPID'].includes(delivery.status))
          failures.push('push');
      } catch {
        failures.push('push');
      }
      if (process.env.INCIDENTS_EMAIL_ENABLED !== 'false' && admin.incidentEmailAlerts)
        try {
          if (
            !(await this.mail.sendIncidentAlert(
              admin.email,
              title,
              message,
              link,
            ))
          )
            failures.push('email');
        } catch {
          failures.push('email');
        }
    }
    try {
      await this.gateway.sendSuperAdminIncident({
        id: group.id,
        title,
        message,
        link,
      });
    } catch {
      failures.push('socket');
    }
    if (failures.length)
      await this.reportChannelFailure([...new Set(failures)], admins, link);
  }
  private async reportChannelFailure(
    channels: string[],
    admins: { id: string; email: string; incidentEmailAlerts?: boolean }[],
    link: string,
  ) {
    for (const channel of channels) this.failedChannels.add(channel);
    this.logger.warn(
      `Alerte incident : canal indisponible (${channels.join(', ')}).`,
    );
    if (!(await this.claim('incident:channel-health', 3600000))) return;
    const title = 'Canal d’alerte indisponible',
      message = `Vérifier les canaux : ${channels.join(', ')}. Les incidents restent consultables dans l’administration.`;
    for (const admin of admins) {
      if (!channels.includes('notification'))
        await this.notifications
          .create({
            userId: admin.id,
            type: 'SYSTEM_ALERT',
            title,
            message,
            link,
          })
          .catch(() => undefined);
      if (
        !channels.includes('email') && admin.incidentEmailAlerts &&
        process.env.INCIDENTS_EMAIL_ENABLED !== 'false'
      )
        await this.mail
          .sendIncidentAlert(admin.email, title, message, link)
          .catch(() => false);
    }
  }
  @Interval(300000)
  async checkChannels() {
    if (
      process.env.INCIDENTS_ENABLED !== 'true' ||
      process.env.INCIDENTS_ALERTS_ENABLED !== 'true'
    )
      return;
    try {
      const issues = new Set(this.failedChannels);
      if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY)
        issues.add('push');
      if (
        process.env.INCIDENTS_EMAIL_ENABLED !== 'false' &&
        !process.env.RESEND_API_KEY
      )
        issues.add('email');
      const failed = await this.prisma.pushDelivery.count({
        where: {
          tag: { startsWith: 'incident:' },
          status: { in: ['FAILED', 'PARTIAL', 'NO_VAPID'] },
          createdAt: { gte: new Date(Date.now() - 300000) },
        },
      });
      if (failed) issues.add('push');
      if (!issues.size) return;
      const admins = await this.prisma.user.findMany({
        where: { role: 'SUPER_ADMIN', isActive: true },
        select: { id: true, email: true, incidentEmailAlerts: true },
      });
      await this.reportChannelFailure([...issues], admins, '/admin/errors');
    } catch {
      this.logger.warn('Contrôle des canaux indisponible.');
    }
  }
  @Cron('0 8 * * *', { timeZone: 'Africa/Brazzaville' })
  async dailyDigest() {
    if (
      process.env.INCIDENTS_ENABLED !== 'true' ||
      process.env.INCIDENTS_ALERTS_ENABLED !== 'true' ||
      process.env.INCIDENTS_EMAIL_ENABLED === 'false'
    )
      return;
    try {
      if (!(await this.claim('incident:daily-digest', 23 * 3600000))) return;
      const groups = await this.prisma.errorGroup.findMany({
        where: {
          severity: { in: ['INFO', 'WARN'] },
          lastSeen: { gte: new Date(Date.now() - 86400000) },
          status: { not: 'IGNORED' },
        },
        orderBy: { count: 'desc' },
        take: 50,
      });
      if (!groups.length) return;
      const admins = await this.prisma.user.findMany({
        where: { role: 'SUPER_ADMIN', isActive: true, incidentEmailAlerts: true },
        select: { email: true },
      });
      const message = groups
        .map(
          (g) =>
            `${g.source} · ${g.severity} · ${g.count} occurrence(s) · ${g.id}`,
        )
        .join('\n');
      for (const admin of admins)
        await this.mail.sendIncidentAlert(
          admin.email,
          'Résumé quotidien des incidents',
          message,
          '/admin/errors',
        );
    } catch {
      this.logger.warn('Résumé des incidents indisponible.');
    }
  }
}
