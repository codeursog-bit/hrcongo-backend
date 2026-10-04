// ============================================================================
// 📁 src/approvals/approval-functions.service.ts — LOT A
// ✅ Fonctions de validation (comptable, RH, DG, hiérarchie, chef d'équipe) :
//    attribution par l'admin + droit de signer + signature personnelle.
// ✅ AUCUN effet sur les décisions existantes (prêts, avances, absences,
//    congés…) : ce lot ne fait que poser les données et les écrans.
// ============================================================================

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { resolveVerifiedCompanyId } from '../common/resolve-verified-company.util';
import {
  APPROVAL_FUNCTIONS,
  FUNCTION_ADMIN_ROLES,
  FUNCTION_READ_ROLES,
  SIGNATURE_ALLOWED_MIMES,
  SIGNATURE_MAX_BYTES,
  approvalFunctionLabel,
} from './approvals.constants';
import { UserFunctionItemDto } from './dto/set-user-functions.dto';

// Comptes à qui on n'attribue pas de fonction d'avis (hors périmètre entreprise).
const NON_ASSIGNABLE_ROLES = [
  'SUPER_ADMIN',
  'CABINET_ADMIN',
  'CABINET_GESTIONNAIRE',
];

@Injectable()
export class ApprovalFunctionsService {
  private readonly logger = new Logger(ApprovalFunctionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ── Contexte utilisateur vérifié (entreprise résolue sans faire confiance
  //    au client : même util que le reste de l'app) ─────────────────────────
  private async getContextUser(userId: string, requestedCompanyId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        companyId: true,
        isActive: true,
        manageMultipleCompanies: true,
      },
    });
    if (!user || !user.isActive) {
      throw new ForbiddenException('Utilisateur inactif ou introuvable');
    }
    const companyId = await resolveVerifiedCompanyId(
      this.prisma,
      user,
      requestedCompanyId,
    );
    if (!companyId) throw new ForbiddenException('Aucune entreprise associée');
    return { id: user.id, role: user.role as string, companyId };
  }

  // ── Catalogue (lecture libre pour un utilisateur connecté) ───────────────
  getCatalog() {
    return APPROVAL_FUNCTIONS;
  }

  // ── Liste des attributions de l'entreprise ───────────────────────────────
  async listCompanyFunctions(userId: string, requestedCompanyId?: string) {
    const ctx = await this.getContextUser(userId, requestedCompanyId);
    if (!FUNCTION_READ_ROLES.includes(ctx.role)) {
      throw new ForbiddenException(
        "Vous n'avez pas les droits pour consulter les fonctions.",
      );
    }

    const rows = await this.prisma.userApprovalFunction.findMany({
      where: { companyId: ctx.companyId },
      select: { userId: true, code: true, canSign: true },
      orderBy: { createdAt: 'asc' },
    });

    const assignments: Record<string, { code: string; canSign: boolean }[]> =
      {};
    for (const r of rows) {
      (assignments[r.userId] ??= []).push({ code: r.code, canSign: r.canSign });
    }

    return { catalog: APPROVAL_FUNCTIONS, assignments };
  }

  // ── Attribution (admin uniquement) — remplace la liste complète ──────────
  async setUserFunctions(
    adminId: string,
    targetUserId: string,
    items: UserFunctionItemDto[],
    requestedCompanyId?: string,
  ) {
    const ctx = await this.getContextUser(adminId, requestedCompanyId);
    if (!FUNCTION_ADMIN_ROLES.includes(ctx.role)) {
      throw new ForbiddenException(
        "Seul l'administrateur peut attribuer des fonctions.",
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, companyId: true, role: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable.');
    if (target.companyId !== ctx.companyId) {
      throw new ForbiddenException(
        "Cet utilisateur n'appartient pas à cette entreprise.",
      );
    }
    if (NON_ASSIGNABLE_ROLES.includes(target.role as string)) {
      throw new BadRequestException(
        'Une fonction ne peut pas être attribuée à ce type de compte.',
      );
    }

    // Dédoublonnage par code (le dernier gagne)
    const byCode = new Map<string, boolean>();
    for (const it of items) byCode.set(it.code, it.canSign);
    const codes = Array.from(byCode.keys());

    await this.prisma.$transaction([
      this.prisma.userApprovalFunction.deleteMany({
        where: {
          userId: targetUserId,
          companyId: ctx.companyId,
          code: { notIn: codes },
        },
      }),
      ...codes.map((code) =>
        this.prisma.userApprovalFunction.upsert({
          where: {
            userId_companyId_code: {
              userId: targetUserId,
              companyId: ctx.companyId,
              code,
            },
          },
          create: {
            userId: targetUserId,
            companyId: ctx.companyId,
            code,
            canSign: byCode.get(code) ?? false,
            createdBy: adminId,
          },
          update: { canSign: byCode.get(code) ?? false },
        }),
      ),
    ]);

    this.logger.log(
      `🧩 Fonctions de ${targetUserId} mises à jour par ${adminId} : [${codes.join(', ') || 'aucune'}]`,
    );

    return {
      userId: targetUserId,
      functions: codes.map((code) => ({
        code,
        canSign: byCode.get(code) ?? false,
      })),
    };
  }

  // ── Mon contexte (fonctions, droit de signer, signature) ─────────────────
  async getMyContext(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, signatureUrl: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    if (!user.companyId) {
      return {
        functions: [],
        canSign: false,
        signatureUrl: user.signatureUrl ?? null,
      };
    }

    const rows = await this.prisma.userApprovalFunction.findMany({
      where: { userId, companyId: user.companyId },
      select: { code: true, canSign: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      functions: rows.map((r) => ({
        code: r.code,
        label: approvalFunctionLabel(r.code),
        canSign: r.canSign,
      })),
      canSign: rows.some((r) => r.canSign),
      signatureUrl: user.signatureUrl ?? null,
    };
  }

  // ── Signature personnelle : upload (uniquement si le droit est accordé) ──
  async uploadMySignature(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ signatureUrl: string }> {
    if (!file) throw new BadRequestException('Aucun fichier fourni.');
    if (!SIGNATURE_ALLOWED_MIMES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Format non autorisé : ${file.mimetype}. Acceptés : JPG, PNG, WEBP`,
      );
    }
    if (file.size > SIGNATURE_MAX_BYTES) {
      throw new BadRequestException(
        `Fichier trop volumineux : ${(file.size / 1024 / 1024).toFixed(2)} MB (max 2 MB)`,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, signatureUrl: true, isActive: true },
    });
    if (!user || !user.isActive || !user.companyId) {
      throw new ForbiddenException('Utilisateur inactif ou sans entreprise.');
    }

    const canSign = await this.prisma.userApprovalFunction.count({
      where: { userId, companyId: user.companyId, canSign: true },
    });
    if (canSign === 0) {
      throw new ForbiddenException(
        "Vous n'avez pas l'autorisation d'enregistrer une signature. Demandez-la à l'administrateur.",
      );
    }

    // Remplacement : on supprime l'ancienne image (best-effort)
    if (user.signatureUrl) {
      await this.safeDeleteImage(user.signatureUrl);
    }

    const signatureUrl = await this.cloudinary.uploadPublicFile(
      file,
      `signatures/${user.companyId}`,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { signatureUrl },
    });

    return { signatureUrl };
  }

  // ── Signature personnelle : suppression (toujours permise) ───────────────
  async deleteMySignature(userId: string): Promise<{ signatureUrl: null }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { signatureUrl: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    if (user.signatureUrl) {
      await this.safeDeleteImage(user.signatureUrl);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { signatureUrl: null },
    });
    return { signatureUrl: null };
  }

  private async safeDeleteImage(url: string): Promise<void> {
    try {
      const publicId = this.cloudinary.extractPublicId(url);
      if (publicId) await this.cloudinary.deleteFile(publicId, 'image');
    } catch (e) {
      this.logger.warn(`Impossible de supprimer l'ancienne signature : ${e}`);
    }
  }
}
