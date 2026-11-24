import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SupportService } from '../support/support.service';
import { CreateContactDto, SUBJECTS } from './dto/contact.dto';
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly support: SupportService,
  ) {}
  async create(dto: CreateContactDto, ip?: string) {
    if (
      dto.name.trim().length < 2 ||
      dto.message.trim().length < 10 ||
      !SUBJECTS.includes(dto.subject as any)
    )
      throw new BadRequestException('Vérifiez les champs de votre message.');
    const { contact, trackingPath } = await this.support.contact(dto, ip);
    const adminEmail = process.env.SUPER_ADMIN_EMAIL || '';
    if (adminEmail)
      try {
        await this.mail.sendContactNotification({
          to: adminEmail,
          name: escape(contact.name),
          email: escape(contact.email),
          company: escape(contact.company || ''),
          phone: escape(contact.phone || ''),
          subject: escape(contact.subject),
          message: escape(contact.message),
          id: contact.id,
        });
      } catch {
        /* La demande reste disponible dans la boîte support. */
      }
    let emailSent = false;
    try {
      emailSent = await this.mail.sendSupportReceipt(
        contact.email,
        trackingPath,
      );
    } catch {
      /* Le lien est également renvoyé au navigateur. */
    }
    return {
      success: true,
      message:
        'Votre message est enregistré. Vous pouvez poursuivre la conversation avec notre équipe.',
      id: contact.id,
      trackingPath,
      emailSent,
    };
  }
  findAll(status?: string) {
    return this.prisma.contactMessage.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  markAsRead(id: string) {
    return this.prisma.contactMessage.update({
      where: { id },
      data: { status: 'READ', readAt: new Date() },
    });
  }
}
