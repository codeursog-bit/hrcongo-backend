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

  // ══════════════════════════════════════════════════════════════════════════
  // ✅ AVIS INTER-ENTREPRISES
  // Un admin multi-entreprises peut donner à un utilisateur d'UNE de ses entreprises
  // (ex. le comptable de A) une fonction d'avis dans d'AUTRES de ses entreprises (B, C…).
  // Cette personne ne se connecte pas à B / C : elle reçoit et donne seulement des avis
  // sur les demandes de ces entreprises (voir ApprovalContextService, rôle EXTERNAL_ADVISOR).
  // La ligne UserApprovalFunction(userId, companyId = B) EST l'autorisation.
  // ══════════════════════════════════════════════════════════════════════════

  /** Entreprises que l'admin gère réellement (lien userCompany) — source de vérité. */
  private async getManagedCompanies(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { role: true, isActive: true, manageMultipleCompanies: true, companyId: true },
    });
    if (!admin || !admin.isActive) throw new ForbiddenException('Utilisateur inactif ou introuvable');
    if (!FUNCTION_ADMIN_ROLES.includes(admin.role as string) || !admin.manageMultipleCompanies) {
      throw new ForbiddenException(
        "Seul un administrateur multi-entreprises peut donner des avis sur d'autres entreprises.",
      );
    }
    const links = await this.prisma.userCompany.findMany({
      where: { userId: adminId },
      select: { company: { select: { id: true, legalName: true, tradeName: true } } },
    });
    const map = new Map<string, { id: string; name: string }>();
    for (const l of links) map.set(l.company.id, { id: l.company.id, name: l.company.tradeName || l.company.legalName });
    return map;
  }

  /** Cibles autorisées : un utilisateur d'une entreprise gérée par l'admin. */
  private async getAssignableTarget(targetUserId: string, managed: Map<string, { id: string; name: string }>) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, companyId: true, role: true, isActive: true },
    });
    if (!target || !target.isActive) throw new NotFoundException('Utilisateur introuvable.');
    if (!target.companyId || !managed.has(target.companyId)) {
      throw new ForbiddenException("Cet utilisateur n'appartient pas à l'une de vos entreprises.");
    }
    if (NON_ASSIGNABLE_ROLES.includes(target.role as string)) {
      throw new BadRequestException('Une fonction ne peut pas être attribuée à ce type de compte.');
    }
    return target as { id: string; companyId: string; role: string; isActive: boolean };
  }

  /** Pour l'écran admin : les AUTRES entreprises de l'admin + fonctions déjà données à cet utilisateur là-bas. */
  async listExternalFunctions(adminId: string, targetUserId: string) {
    const managed = await this.getManagedCompanies(adminId);
    const target = await this.getAssignableTarget(targetUserId, managed);

    const rows = await this.prisma.userApprovalFunction.findMany({
      where: { userId: targetUserId, companyId: { in: Array.from(managed.keys()) } },
      select: { companyId: true, code: true, canSign: true },
    });
    const byCompany = new Map<string, { code: string; canSign: boolean }[]>();
    for (const r of rows) {
      if (r.companyId === target.companyId) continue; // sa propre entreprise : gérée par l'écran habituel
      (byCompany.get(r.companyId) ?? byCompany.set(r.companyId, []).get(r.companyId)!).push({ code: r.code, canSign: r.canSign });
    }

    return {
      catalog: APPROVAL_FUNCTIONS,
      companies: Array.from(managed.values())
        .filter((c) => c.id !== target.companyId)
        .map((c) => ({ id: c.id, name: c.name, functions: byCompany.get(c.id) ?? [] })),
    };
  }

  /** Remplace les fonctions de cet utilisateur POUR l'entreprise indiquée (liste vide = retrait). */
  async setExternalFunctions(
    adminId: string,
    targetUserId: string,
    companyId: string,
    items: UserFunctionItemDto[],
  ) {
    const managed = await this.getManagedCompanies(adminId);
    const target = await this.getAssignableTarget(targetUserId, managed);
    if (!managed.has(companyId)) {
      throw new ForbiddenException("Vous ne gérez pas cette entreprise.");
    }
    if (companyId === target.companyId) {
      throw new BadRequestException("C'est l'entreprise de cet utilisateur : utilisez l'attribution habituelle.");
    }

    const byCode = new Map<string, boolean>();
    for (const it of items) byCode.set(it.code, it.canSign);
    const codes = Array.from(byCode.keys());

    await this.prisma.$transaction([
      this.prisma.userApprovalFunction.deleteMany({
        where: { userId: targetUserId, companyId, code: { notIn: codes } },
      }),
      ...codes.map((code) =>
        this.prisma.userApprovalFunction.upsert({
          where: { userId_companyId_code: { userId: targetUserId, companyId, code } },
          create: { userId: targetUserId, companyId, code, canSign: byCode.get(code) ?? false, createdBy: adminId },
          update: { canSign: byCode.get(code) ?? false },
        }),
      ),
    ]);

    this.logger.log(
      `🌐 Avis externes : ${targetUserId} → entreprise ${companyId} [${codes.join(', ') || 'retiré'}] par ${adminId}`,
    );
    return { userId: targetUserId, companyId, functions: codes.map((code) => ({ code, canSign: byCode.get(code) ?? false })) };
  }

  // ── Mon contexte (fonctions, droit de signer, signature) ─────────────────
  async getMyContext(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, signatureUrl: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    // Fonctions d'avis détenues dans D'AUTRES entreprises (donné par l'admin multi-entreprises)
    const externalRows = await this.prisma.userApprovalFunction.findMany({
      where: user.companyId ? { userId, companyId: { not: user.companyId } } : { userId },
      select: { code: true, canSign: true, company: { select: { id: true, legalName: true, tradeName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const ext = new Map<string, { companyId: string; companyName: string; functions: { code: string; label: string; canSign: boolean }[] }>();
    for (const r of externalRows) {
      const e = ext.get(r.company.id) ?? { companyId: r.company.id, companyName: r.company.tradeName || r.company.legalName, functions: [] };
      e.functions.push({ code: r.code, label: approvalFunctionLabel(r.code), canSign: r.canSign });
      ext.set(r.company.id, e);
    }
    const externalCompanies = Array.from(ext.values());
    const externalCanSign = externalRows.some((r) => r.canSign);

    if (!user.companyId) {
      return {
        functions: [],
        canSign: externalCanSign,
        signatureUrl: user.signatureUrl ?? null,
        externalCompanies,
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
      canSign: rows.some((r) => r.canSign) || externalCanSign,
      signatureUrl: user.signatureUrl ?? null,
      externalCompanies,
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

    // Droit de signer : dans son entreprise OU dans une entreprise où l'admin lui a donné une fonction d'avis.
    const canSign = await this.prisma.userApprovalFunction.count({
      where: { userId, canSign: true },
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