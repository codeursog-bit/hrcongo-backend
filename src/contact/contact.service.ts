// ============================================================================
// 📁 src/contact/contact.service.ts — Konza RH
//
// Reçoit le message, l'enregistre en DB et envoie un email au SUPER_ADMIN
// Utilise Resend (déjà configuré dans MailService)
// ============================================================================
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { Throttle } from '@nestjs/throttler';

export interface CreateContactDto {
  name: string;
  email: string;
  company?: string;
  phone?: string;
  subject: string;
  message: string;
}

const VALID_SUBJECTS = [
  'Demande de démo',
  'Question sur les tarifs',
  'Support technique',
  'Partenariat commercial',
  'Demande de formation sur site',
  'Signalement / Bug',
  'Autre',
];

@Injectable()
export class ContactService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async create(dto: CreateContactDto, ip?: string) {
    // ─── Validation manuelle (complète class-validator si souhaité) ───────────
    if (!dto.name?.trim() || dto.name.trim().length < 2)
      throw new BadRequestException('Nom invalide (minimum 2 caractères)');
    if (!dto.email?.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))
      throw new BadRequestException('Email invalide');
    if (!VALID_SUBJECTS.includes(dto.subject))
      throw new BadRequestException('Sujet invalide');
    if (!dto.message?.trim() || dto.message.trim().length < 10)
      throw new BadRequestException(
        'Message trop court (minimum 10 caractères)',
      );

    // ─── 1. Enregistrement en DB ──────────────────────────────────────────────
    // Le modèle ContactMessage est à ajouter dans schema.prisma (voir en bas de ce fichier)
    let record: any = null;
    try {
      record = await (this.prisma as any).contactMessage.create({
        data: {
          name: dto.name.trim(),
          email: dto.email.toLowerCase().trim(),
          company: dto.company?.trim() || null,
          phone: dto.phone?.trim() || null,
          subject: dto.subject,
          message: dto.message.trim(),
          ip: ip || null,
          status: 'UNREAD',
        },
      });
    } catch {
      // Si la table n'existe pas encore, on continue quand même (envoi email)
      console.warn(
        '[ContactService] Table contactMessage non trouvée, message non persisté',
      );
    }

    // ─── 2. Email au SUPER_ADMIN ──────────────────────────────────────────────
    const adminEmail =
      process.env.SUPER_ADMIN_EMAIL || process.env.RESEND_FROM_EMAIL || '';
    if (adminEmail) {
      try {
        await this.mail.sendContactNotification({
          to: adminEmail,
          name: dto.name,
          email: dto.email,
          company: dto.company,
          phone: dto.phone,
          subject: dto.subject,
          message: dto.message,
          id: record?.id,
        });
      } catch (err) {
        console.error('[ContactService] Erreur envoi email admin:', err);
        // On ne bloque pas la réponse si l'email échoue
      }
    }

    // ─── 3. Email de confirmation à l'expéditeur ──────────────────────────────
    try {
      await this.mail.sendContactConfirmation({
        to: dto.email,
        name: dto.name,
        subject: dto.subject,
      });
    } catch {
      // Silencieux
    }

    return {
      success: true,
      message:
        'Votre message a bien été envoyé. Notre équipe vous répondra sous 24h.',
      id: record?.id || null,
    };
  }

  // ─── Admin : liste des messages (SUPER_ADMIN uniquement) ──────────────────
  async findAll(status?: string) {
    try {
      return (this.prisma as any).contactMessage.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    } catch {
      return [];
    }
  }

  async markAsRead(id: string) {
    try {
      return (this.prisma as any).contactMessage.update({
        where: { id },
        data: { status: 'READ', readAt: new Date() },
      });
    } catch {
      return null;
    }
  }
}

// ============================================================================
// À AJOUTER dans schema.prisma :
//
// model ContactMessage {
//   id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
//   name      String   @db.VarChar(100)
//   email     String   @db.VarChar(255)
//   company   String?  @db.VarChar(150)
//   phone     String?  @db.VarChar(30)
//   subject   String   @db.VarChar(100)
//   message   String   @db.Text
//   ip        String?  @db.VarChar(45)
//   status    String   @default("UNREAD") @db.VarChar(20) // UNREAD | READ | REPLIED
//   readAt    DateTime? @db.Timestamptz
//   createdAt DateTime @default(now()) @db.Timestamptz
//
//   @@index([status])
//   @@index([createdAt(sort: Desc)])
//   @@map("contact_messages")
// }
//
// Puis : npx prisma migrate dev --name add_contact_messages
// ============================================================================
