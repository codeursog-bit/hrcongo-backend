// ============================================================================
// 📄 src/documents/documents.service.ts — CORRIGÉ (aligned avec le vrai schéma)
// ============================================================================

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentType, DocumentStatus, Prisma } from '@prisma/client';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

export interface CreateDocumentInput {
  name: string;
  type: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  description?: string;
  employeeId: string;
  documentNumber?: string;
  issuingBody?: string;
  issuedAt?: string;
  expiresAt?: string;
}

export interface FindAllFilters {
  employeeId?: string;
  type?: DocumentType;
  status?: DocumentStatus;
  expiringInDays?: number;
  includeArchived?: boolean;
}

// Types qui nécessitent une date d'expiration
const EXPIRABLE_TYPES: DocumentType[] = [
  DocumentType.CNI,
  DocumentType.PASSPORT,
  DocumentType.DRIVER_LICENSE,
  DocumentType.MEDICAL_CERT,
  DocumentType.MEDICAL_VISIT,
  DocumentType.CERTIFICATION,
];

const VERIFIER_ROLES = [
  'ADMIN',
  'HR_MANAGER',
  'SUPER_ADMIN',
  'CABINET_ADMIN',
  'CABINET_GESTIONNAIRE',
];
const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'CABINET_ADMIN'];

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private cloudinary: CloudinaryService,
  ) {}

  // ── Mapping type frontend → enum Prisma (aligné sur le vrai DocumentType) ─

  private mapDocumentType(raw: string): DocumentType {
    const map: Record<string, DocumentType> = {
      // Identité
      cni: DocumentType.CNI,
      id_card: DocumentType.CNI,
      carte_identite: DocumentType.CNI,
      passport: DocumentType.PASSPORT,
      passeport: DocumentType.PASSPORT,
      driver_license: DocumentType.DRIVER_LICENSE,
      permis: DocumentType.DRIVER_LICENSE,
      permis_conduire: DocumentType.DRIVER_LICENSE,
      // RH
      contract: DocumentType.CONTRACT,
      contrat: DocumentType.CONTRACT,
      contrat_cdi: DocumentType.CONTRACT,
      contrat_cdd: DocumentType.CONTRACT,
      avenant: DocumentType.AVENANT,
      payslip: DocumentType.PAYSLIP,
      bulletin_paie: DocumentType.PAYSLIP,
      fiche_paie: DocumentType.PAYSLIP,
      work_certificate: DocumentType.WORK_CERTIFICATE,
      attestation_travail: DocumentType.WORK_CERTIFICATE,
      certificat_travail: DocumentType.WORK_CERTIFICATE,
      salary_attestation: DocumentType.SALARY_ATTESTATION,
      attestation_salaire: DocumentType.SALARY_ATTESTATION,
      employment_letter: DocumentType.EMPLOYMENT_LETTER,
      lettre_embauche: DocumentType.EMPLOYMENT_LETTER,
      // Diplômes & formations
      diploma: DocumentType.DIPLOMA,
      diplome: DocumentType.DIPLOMA,
      certification: DocumentType.CERTIFICATION,
      certificat: DocumentType.CERTIFICATION,
      training_cert: DocumentType.TRAINING_CERT,
      attestation_formation: DocumentType.TRAINING_CERT,
      // Médical
      medical_cert: DocumentType.MEDICAL_CERT,
      certificat_medical: DocumentType.MEDICAL_CERT,
      medical_visit: DocumentType.MEDICAL_VISIT,
      visite_medicale: DocumentType.MEDICAL_VISIT,
      // Divers
      resume: DocumentType.RESUME,
      cv: DocumentType.RESUME,
      rib: DocumentType.RIB,
      other: DocumentType.OTHER,
      autre: DocumentType.OTHER,
    };
    return map[raw?.toLowerCase().trim()] ?? DocumentType.OTHER;
  }

  // ── Contexte utilisateur ──────────────────────────────────────────────────

  private async getUserCtx(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, role: true, email: true },
    });
    if (!user?.companyId) throw new ForbiddenException('Accès refusé');
    // On retourne avec companyId garanti non-null
    return user as typeof user & { companyId: string };
  }

  // ── Vérifier accès à un employé ──────────────────────────────────────────

  private async assertEmployeeAccess(
    user: { companyId: string; role: string; email: string },
    employeeId: string,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true, email: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');
    if (employee.companyId !== user.companyId)
      throw new ForbiddenException('Employé non autorisé');
    if (user.role === 'EMPLOYEE' && employee.email !== user.email) {
      throw new ForbiddenException(
        'Vous ne pouvez gérer que vos propres documents',
      );
    }
    return employee;
  }

  // ==========================================================================
  // CREATE
  // ==========================================================================

  async create(data: CreateDocumentInput, userId: string) {
    const user = await this.getUserCtx(userId);
    await this.assertEmployeeAccess(user, data.employeeId);

    const docType = this.mapDocumentType(data.type);

    if (EXPIRABLE_TYPES.includes(docType) && !data.expiresAt) {
      throw new BadRequestException(
        "La date d'expiration est obligatoire pour ce type de document",
      );
    }

    // Récupérer la version active existante
    const existing = await this.prisma.document.findFirst({
      where: {
        employeeId: data.employeeId,
        type: docType,
        isArchived: false,
        status: { not: DocumentStatus.EXPIRED },
      },
      select: { id: true, version: true },
    });

    const nextVersion = existing ? (existing.version ?? 1) + 1 : 1;

    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.document.update({
          where: { id: existing.id },
          data: { isArchived: true },
        });
      }

      return tx.document.create({
        data: {
          name: data.name,
          type: docType,
          fileUrl: data.fileUrl,
          fileSize: data.fileSize,
          mimeType: data.mimeType,
          description: data.description ?? null,
          documentNumber: data.documentNumber ?? null,
          issuingBody: data.issuingBody ?? null,
          issuedAt: data.issuedAt ? new Date(data.issuedAt) : null,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          // RH / Admin / Manager → validé immédiatement sans attente
          // Employé (future v2 self-service) → en attente de vérification RH
          status: VERIFIER_ROLES.includes(user.role)
            ? DocumentStatus.VERIFIED
            : DocumentStatus.PENDING_REVIEW,
          verifiedById: VERIFIER_ROLES.includes(user.role) ? userId : null,
          verifiedAt: VERIFIER_ROLES.includes(user.role) ? new Date() : null,
          version: nextVersion,
          isArchived: false,
          employeeId: data.employeeId,
          companyId: user.companyId,
          uploadedById: userId,
        },
        include: {
          employee: {
            select: { firstName: true, lastName: true, position: true },
          },
          uploadedBy: { select: { id: true } },
        },
      });
    });
  }

  // ==========================================================================
  // FIND ALL
  // ==========================================================================

  async findAll(userId: string, filters: FindAllFilters = {}) {
    const user = await this.getUserCtx(userId);
    const companyId = user.companyId;

    const where: Prisma.DocumentWhereInput = {
      companyId,
      isArchived: filters.includeArchived ? undefined : false,
    };

    // EMPLOYEE → uniquement ses propres docs
    if (user.role === 'EMPLOYEE') {
      const emp = await this.prisma.employee.findFirst({
        where: { email: user.email, companyId },
        select: { id: true },
      });
      if (!emp) return [];
      where.employeeId = emp.id;
    }

    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.type) where.type = filters.type;
    if (filters.status) where.status = filters.status;

    if (filters.expiringInDays) {
      const limit = new Date();
      limit.setDate(limit.getDate() + filters.expiringInDays);
      where.expiresAt = { not: null, lte: limit, gte: new Date() };
      where.status = DocumentStatus.VERIFIED;
      where.isArchived = false;
    }

    return this.prisma.document.findMany({
      where,
      include: {
        employee: {
          select: { firstName: true, lastName: true, position: true },
        },
        verifiedBy: { select: { id: true } },
        uploadedBy: { select: { id: true } },
      },
      orderBy: [{ isArchived: 'asc' }, { createdAt: 'desc' }],
    });
  }

  // ==========================================================================
  // FIND ONE
  // ==========================================================================

  async findOne(documentId: string, userId: string) {
    const user = await this.getUserCtx(userId);
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            position: true,
          },
        },
        verifiedBy: { select: { id: true } },
        uploadedBy: { select: { id: true } },
      },
    });
    if (!doc) throw new NotFoundException('Document introuvable');
    if (doc.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');
    if (user.role === 'EMPLOYEE' && doc.employee?.email !== user.email) {
      throw new ForbiddenException('Accès refusé à ce document');
    }
    return doc;
  }

  // ==========================================================================
  // FIND BY EMPLOYEE
  // ==========================================================================

  async findByEmployee(
    employeeId: string,
    userId: string,
    includeArchived = false,
  ) {
    const user = await this.getUserCtx(userId);
    await this.assertEmployeeAccess(user, employeeId);

    return this.prisma.document.findMany({
      where: {
        employeeId,
        companyId: user.companyId,
        isArchived: includeArchived ? undefined : false,
      },
      include: {
        verifiedBy: { select: { id: true } },
        uploadedBy: { select: { id: true } },
      },
      orderBy: [{ type: 'asc' }, { version: 'desc' }],
    });
  }

  // ==========================================================================
  // URL SIGNÉE CLOUDINARY
  // ==========================================================================

  async getSignedUrl(documentId: string, userId: string) {
    const doc = await this.findOne(documentId, userId);
    const url = this.cloudinary.getSignedUrl(doc.fileUrl, 3600);
    return { url, expiresIn: 3600, fileName: doc.name, mimeType: doc.mimeType };
  }

  // ==========================================================================
  // VERIFY
  // ==========================================================================

  async verify(documentId: string, userId: string) {
    const user = await this.getUserCtx(userId);
    if (!VERIFIER_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        'Seuls les RH et admins peuvent vérifier les documents',
      );
    }

    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        companyId: true,
        status: true,
        employeeId: true,
        name: true,
      },
    });
    if (!doc) throw new NotFoundException('Document introuvable');
    if (doc.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');
    if (doc.status === DocumentStatus.VERIFIED)
      throw new BadRequestException('Document déjà vérifié');

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.VERIFIED,
        verifiedById: userId,
        verifiedAt: new Date(),
        rejectionReason: null,
      },
    });

    if (doc.employeeId) {
      await this.notifyEmployee(
        doc.employeeId,
        user.companyId,
        'verified',
        doc.name,
      );
    }
    return updated;
  }

  // ==========================================================================
  // REJECT
  // ==========================================================================

  async reject(documentId: string, userId: string, reason: string) {
    const user = await this.getUserCtx(userId);
    if (!VERIFIER_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        'Seuls les RH et admins peuvent rejeter les documents',
      );
    }
    if (!reason?.trim())
      throw new BadRequestException('Le motif de rejet est obligatoire');

    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        companyId: true,
        status: true,
        employeeId: true,
        name: true,
      },
    });
    if (!doc) throw new NotFoundException('Document introuvable');
    if (doc.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.REJECTED,
        rejectionReason: reason.trim(),
        verifiedById: userId,
        verifiedAt: new Date(),
      },
    });

    if (doc.employeeId) {
      await this.notifyEmployee(
        doc.employeeId,
        user.companyId,
        'rejected',
        doc.name,
        reason,
      );
    }
    return updated;
  }

  // ==========================================================================
  // DELETE
  // ==========================================================================

  async delete(documentId: string, userId: string) {
    const user = await this.getUserCtx(userId);
    if (!ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        'Seuls les admins peuvent supprimer des documents',
      );
    }

    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, companyId: true, fileUrl: true },
    });
    if (!doc) throw new NotFoundException('Document introuvable');
    if (doc.companyId !== user.companyId)
      throw new ForbiddenException('Accès refusé');

    try {
      await this.cloudinary.deleteFile(doc.fileUrl, 'raw');
    } catch (err) {
      this.logger.warn(`Cloudinary delete failed: ${doc.fileUrl}`, err);
    }

    return this.prisma.document.delete({ where: { id: documentId } });
  }

  // ==========================================================================
  // STATS
  // ==========================================================================

  async getStats(userId: string) {
    const user = await this.getUserCtx(userId);
    const companyId = user.companyId;

    const today = new Date();
    const in7 = new Date();
    in7.setDate(today.getDate() + 7);
    const in30 = new Date();
    in30.setDate(today.getDate() + 30);

    const [total, pending, verified, rejected, expired, expiring30, expiring7] =
      await Promise.all([
        this.prisma.document.count({ where: { companyId, isArchived: false } }),
        this.prisma.document.count({
          where: {
            companyId,
            status: DocumentStatus.PENDING_REVIEW,
            isArchived: false,
          },
        }),
        this.prisma.document.count({
          where: {
            companyId,
            status: DocumentStatus.VERIFIED,
            isArchived: false,
          },
        }),
        this.prisma.document.count({
          where: {
            companyId,
            status: DocumentStatus.REJECTED,
            isArchived: false,
          },
        }),
        this.prisma.document.count({
          where: { companyId, status: DocumentStatus.EXPIRED },
        }),
        this.prisma.document.count({
          where: {
            companyId,
            status: DocumentStatus.VERIFIED,
            isArchived: false,
            expiresAt: { not: null, lte: in30, gte: today },
          },
        }),
        this.prisma.document.count({
          where: {
            companyId,
            status: DocumentStatus.VERIFIED,
            isArchived: false,
            expiresAt: { not: null, lte: in7, gte: today },
          },
        }),
      ]);

    return {
      total,
      pending,
      verified,
      rejected,
      expired,
      expiring30,
      expiring7,
    };
  }

  // ==========================================================================
  // HELPER NOTIFICATION — utilise "read" (pas "isRead")
  // ==========================================================================

  private async notifyEmployee(
    employeeId: string,
    companyId: string,
    event: 'verified' | 'rejected',
    docName: string,
    reason?: string,
  ) {
    try {
      const employee = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { email: true },
      });
      if (!employee) return;

      const userRecord = await this.prisma.user.findFirst({
        where: { email: employee.email, companyId },
        select: { id: true },
      });
      if (!userRecord) return;

      await this.prisma.notification.create({
        data: {
          userId: userRecord.id,
          type: 'DOCUMENT_UPLOADED',
          title:
            event === 'verified' ? '✅ Document validé' : '❌ Document rejeté',
          message:
            event === 'verified'
              ? `Votre document "${docName}" a été vérifié et validé.`
              : `Votre document "${docName}" a été rejeté. Motif : ${reason}. Veuillez le re-soumettre.`,
          read: false, // ← "read" pas "isRead"
        },
      });
    } catch (err) {
      this.logger.warn('Erreur notification document', err);
    }
  }
}
