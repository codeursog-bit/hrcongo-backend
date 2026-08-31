// ============================================================================
// 📋 src/conventions/conventions.service.ts
//
// ✅ Service existant CONSERVÉ intégralement
// ✅ Ajout : méthodes bridge pour le module rupture de contrat
//    - resolveConventionForRupture() → point d'entrée unique pour le service rupture
//    - getConventionRuptureData()   → barèmes + catégorie employé + salaire minimum
//    - getCategoriesByConvention()  → pour le controller existant (endpoint categories/:code)
// ============================================================================

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BonusTemplatesService } from '../bonus-templates/bonus-templates.service';

// Import du registre de conventions (module rupture)
import {
  getConvention,
  listConventions,
} from '../contract-rupture/conventions/convention.registry';
import { IConvention } from '../contract-rupture/conventions/convention.interface';

// Import des données de grille/ancienneté par convention (digitalisées à
// partir des textes officiels — voir chaque fichier pour les sources et
// avertissements de fiabilité des données).
import { buildBtpCategories, buildBtpAncienneteRules } from './btp-grille';
import {
  buildCommerceCategories,
  buildCommerceAncienneteRules,
} from './commerce-grille';
import {
  buildIndustrieCategories,
  buildIndustrieAncienneteRules,
} from './industrie-grille';
import {
  buildPetroleCategories,
  buildPetroleAncienneteRules,
} from './petrole-grille';
import {
  buildPharmacieCategories,
  buildPharmacieAncienneteRules,
} from './pharmacie-grille';
import {
  buildTransportCategories,
  buildTransportAncienneteRules,
} from './transport-grille';

export interface PredefinedConvention {
  code: string;
  name: string;
  description: string;
  categories: ConventionCategory[];
  defaultRules: ConventionRule[];
}

export interface ConventionCategory {
  code: string;
  label: string;
  minSalary: number;
  description?: string;
}

export interface ConventionRule {
  ruleType: 'MINIMUM_SALARY' | 'AUTOMATIC_BONUS';
  professionalCategory?: string;
  bonusType?: string;
  bonusPercentage?: number;
  bonusFixedAmount?: number;
  bonusBaseCalculation?: 'BASE_SALARY' | 'GROSS_SALARY';
  minMonthsOfService?: number;
  maxMonthsOfService?: number;
  description?: string;
}

// ─── Type retourné au service rupture ────────────────────────────────────────
export interface ConventionRuptureContext {
  convention: IConvention;
  conventionCode: string;
  conventionNom: string;
  // Catégorie conventionnelle résolue (numérique 1-11)
  categorieNum: number;
  // Code catégorie texte tel que stocké sur l'employé (ex: "C5-E2", "E8-1")
  professionalCategory: string | null;
  echelon: number;
  salaireMinimum: number;
  preavisDays: number;
  salaireConforme: boolean;
  alertes: string[];
}

@Injectable()
export class ConventionsService {
  private readonly logger = new Logger(ConventionsService.name);

  constructor(
    private prisma: PrismaService,
    private bonusTemplates: BonusTemplatesService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // ▼ MÉTHODES EXISTANTES — CONSERVÉES INTÉGRALEMENT
  // ══════════════════════════════════════════════════════════════════════════

  getPredefinedConventions(): PredefinedConvention[] {
    return [
      // ========================================================================
      // 🏗️ BTP — Convention Collective du Bâtiment, TP et Activités Connexes
      // (08/08/1992). Grille datée 1990 (voir btp-grille.ts pour l'avertissement
      // sur son ancienneté) + ancienneté fidèle à l'Art.51.
      // ========================================================================
      {
        code: 'BTP',
        name: 'BTP - Bâtiment et Travaux Publics',
        description:
          'Convention collective du Bâtiment, Travaux Publics et Activités Connexes (08/08/1992) — grille au barème du 01/12/1990 (voir btp-grille.ts)',
        categories: buildBtpCategories(),
        defaultRules: buildBtpAncienneteRules(),
      },

      // ========================================================================
      // 🛒 COMMERCE — Grille protocole 2024 (effet 01/01/2025) + ancienneté
      // fidèle à l'Art.41. Voir commerce-grille.ts.
      // ========================================================================
      {
        code: 'COMMERCE',
        name: 'COMMERCE - Commerce et Industries',
        description:
          'Convention collective du Commerce (03/08/2011) — grille salariale révisée par protocole du 16/10/2024, effet 01/01/2025',
        categories: buildCommerceCategories(),
        defaultRules: buildCommerceAncienneteRules(),
      },

      // ========================================================================
      // 🏭 INDUSTRIE — Grille confirmée (image nette) + ancienneté fidèle à
      // l'Art.40. Voir industrie-grille.ts.
      // ========================================================================
      {
        code: 'INDUSTRIE',
        name: 'INDUSTRIE - Industrie et Métallurgie',
        description:
          "Convention collective de l'Industrie et Métallurgie (30/03/2010)",
        categories: buildIndustrieCategories(),
        defaultRules: buildIndustrieAncienneteRules(),
      },

      // ========================================================================
      // 🛢️ PETROLE (renommé depuis PETROLIER — aligné sur le registre de
      // rupture de contrat qui utilisait déjà PETROLE) — grille confirmée
      // (image nette, échelons 1-6) + ancienneté fidèle à l'Art.59.
      // ========================================================================
      {
        code: 'PETROLE',
        name: 'PETROLE - Entreprises de Services Pétroliers',
        description:
          'Convention collective des Entreprises de Services Pétroliers (02/2010) — grille au barème du 01/07/2023',
        categories: buildPetroleCategories(),
        defaultRules: buildPetroleAncienneteRules(),
      },

      // ========================================================================
      // 🚌 TRANSPORT — Grille + ancienneté fidèles à l'Art.58/58bis. Voir
      // transport-grille.ts.
      // ========================================================================
      {
        code: 'TRANSPORT',
        name: 'TRANSPORT - Auxiliaires de Transport et Assimilés',
        description:
          'Convention collective des Auxiliaires de Transports, Terminaux à Conteneurs et Assimilés (signée 19/01/2024, effet rétroactif 01/01/2024)',
        categories: buildTransportCategories(),
        defaultRules: buildTransportAncienneteRules(),
      },

      // ========================================================================
      // 🏨 HOTELLERIE
      // ========================================================================
      {
        code: 'HOTELLERIE',
        name: 'HOTELLERIE - Hôtellerie & Catering',
        description:
          'Convention collective Hôtellerie, Restauration & Catering',
        categories: [
          { code: 'H1', label: 'Cat.1 — Ouvriers/Employés', minSalary: 0 },
          { code: 'H2', label: 'Cat.2 — Ouvriers/Employés', minSalary: 0 },
          { code: 'H3', label: 'Cat.3 — Ouvriers/Employés', minSalary: 0 },
          { code: 'H4', label: 'Cat.4 — Ouvriers/Employés', minSalary: 0 },
          { code: 'H5', label: 'Cat.5 — Maîtrise', minSalary: 0 },
          { code: 'H6', label: 'Cat.6 — Maîtrise', minSalary: 0 },
          { code: 'H7', label: 'Cat.7 — Maîtrise', minSalary: 0 },
          { code: 'H8', label: 'Cat.8 — Cadres', minSalary: 0 },
          { code: 'H9', label: 'Cat.9 — Cadres', minSalary: 0 },
          { code: 'H10', label: 'Cat.10 — Cadres Sup.', minSalary: 0 },
        ],
        defaultRules: [
          {
            ruleType: 'AUTOMATIC_BONUS',
            bonusType: "Prime d'ancienneté",
            bonusPercentage: 3,
            bonusBaseCalculation: 'BASE_SALARY',
            minMonthsOfService: 24,
          },
        ],
      },

      // ========================================================================
      // 💊 PHARMACIE — grille 2012 (Annexe II), pure SUGGESTION de départ,
      // aucun plancher imposé (voir pharmacie-grille.ts). Ancienneté fidèle
      // à l'Art.37.
      // ========================================================================
      {
        code: 'PHARMACIE',
        name: 'PHARMACIE - Officines de Pharmacie',
        description:
          'Convention collective applicable au personnel des Officines de Pharmacie (11/07/2012)',
        categories: buildPharmacieCategories(),
        defaultRules: buildPharmacieAncienneteRules(),
      },

      // ========================================================================
      // 💻 NTIC
      // ========================================================================
      {
        code: 'NTIC',
        name: "NTIC - Nouvelles Technologies de l'Information",
        description: 'Convention Collective NTIC — République du Congo',
        categories: [
          { code: 'N1', label: 'Cat.1 — Ouvriers/Employés', minSalary: 0 },
          { code: 'N2', label: 'Cat.2 — Ouvriers/Employés', minSalary: 0 },
          { code: 'N3', label: 'Cat.3 — Ouvriers/Employés', minSalary: 0 },
          { code: 'N4', label: 'Cat.4 — Ouvriers/Employés', minSalary: 0 },
          { code: 'N5', label: 'Cat.5 — Agents de Maîtrise', minSalary: 0 },
          { code: 'N6', label: 'Cat.6 — Agents de Maîtrise', minSalary: 0 },
          { code: 'N7', label: 'Cat.7 — Agents de Maîtrise', minSalary: 0 },
          { code: 'N8', label: 'Cat.8 — Cadres', minSalary: 0 },
          { code: 'N9', label: 'Cat.9 — Cadres', minSalary: 0 },
          { code: 'N10', label: 'Cat.10 — Cadres Sup.', minSalary: 0 },
          { code: 'N11', label: 'Cat.11 — Direction', minSalary: 0 },
        ],
        defaultRules: [
          {
            ruleType: 'AUTOMATIC_BONUS',
            bonusType: "Prime d'ancienneté",
            bonusPercentage: 3,
            bonusBaseCalculation: 'BASE_SALARY',
            minMonthsOfService: 24,
          },
        ],
      },
    ];
  }

  // ── Méthode utilitaire (inchangée) ────────────────────────────────────────
  getConventionByCode(code: string): PredefinedConvention | undefined {
    return this.getPredefinedConventions().find((c) => c.code === code);
  }

  // ── Méthode pour le controller GET /conventions/categories/:code ──────────
  getCategoriesByConvention(code: string): ConventionCategory[] {
    const convention = this.getConventionByCode(code);
    return convention?.categories ?? [];
  }

  // ── Activation (inchangée) ────────────────────────────────────────────────
  async activateConventionForCompany(userId: string, conventionCode: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId)
      throw new NotFoundException('Utilisateur sans entreprise');

    const predefinedConvention = this.getConventionByCode(conventionCode);
    if (!predefinedConvention)
      throw new BadRequestException(`Convention ${conventionCode} non trouvée`);

    await this.prisma.collectiveAgreementRule.updateMany({
      where: { companyId: user.companyId, isActive: true },
      data: { isActive: false },
    });

    const rules = predefinedConvention.defaultRules.map((rule) => ({
      companyId: user.companyId!,
      agreementCode: conventionCode,
      ruleType: rule.ruleType,
      professionalCategory: rule.professionalCategory || null,
      bonusType: rule.bonusType || null,
      bonusPercentage: rule.bonusPercentage
        ? Number(rule.bonusPercentage)
        : null,
      bonusFixedAmount: rule.bonusFixedAmount
        ? Number(rule.bonusFixedAmount)
        : null,
      bonusBaseCalculation: rule.bonusBaseCalculation || null,
      minMonthsOfService: rule.minMonthsOfService || null,
      maxMonthsOfService: rule.maxMonthsOfService || null,
      isActive: true,
    }));

    await this.prisma.collectiveAgreementRule.createMany({ data: rules });
    await this.prisma.company.update({
      where: { id: user.companyId },
      data: { collectiveAgreement: conventionCode },
    });

    // 🆕 Pont primes — pré-remplit les BonusTemplate suggérés par la
    // convention. Suggestions de départ uniquement : l'admin modifie,
    // supprime ou ajoute librement ensuite, sans aucun verrou ni
    // avertissement système. Convention non encore mappée dans
    // convention-bonus-presets.ts → ne crée simplement rien (safe no-op).
    const bonusResult = await this.bonusTemplates.importConventionPresets(
      user.companyId,
      conventionCode,
    );

    this.logger.log(
      `✅ Convention ${conventionCode} activée avec ${rules.length} règles` +
        (bonusResult.imported > 0
          ? ` et ${bonusResult.imported} prime(s) suggérée(s) créée(s)`
          : ''),
    );
    return {
      success: true,
      message: `Convention ${predefinedConvention.name} activée`,
      rulesCount: rules.length,
      bonusTemplatesImported: bonusResult.imported,
      bonusTemplatesSkipped: bonusResult.skipped,
    };
  }

  // ── Désactivation (inchangée) ─────────────────────────────────────────────
  async deactivateConvention(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId)
      throw new NotFoundException('Utilisateur sans entreprise');

    await this.prisma.collectiveAgreementRule.updateMany({
      where: { companyId: user.companyId, isActive: true },
      data: { isActive: false },
    });
    await this.prisma.company.update({
      where: { id: user.companyId },
      data: { collectiveAgreement: null },
    });

    return { success: true, message: 'Convention désactivée' };
  }

  // ── Règles (inchangées) ───────────────────────────────────────────────────
  async getCompanyConventionRules(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId)
      return {
        hasConvention: false,
        agreementCode: null,
        agreementName: null,
        rules: [],
      };

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { collectiveAgreement: true },
    });
    if (!company?.collectiveAgreement)
      return {
        hasConvention: false,
        agreementCode: null,
        agreementName: null,
        rules: [],
      };

    const rules = await this.prisma.collectiveAgreementRule.findMany({
      where: { companyId: user.companyId, isActive: true },
    });
    const convention = this.getConventionByCode(company.collectiveAgreement);

    return {
      hasConvention: true,
      agreementCode: company.collectiveAgreement,
      agreementName: convention?.name || company.collectiveAgreement,
      agreementDescription: convention?.description || null,
      rules: rules.map((r) => ({
        id: r.id,
        ruleType: r.ruleType,
        professionalCategory: r.professionalCategory,
        bonusType: r.bonusType,
        bonusPercentage: r.bonusPercentage,
        bonusFixedAmount: r.bonusFixedAmount,
        bonusBaseCalculation: r.bonusBaseCalculation,
        minMonthsOfService: r.minMonthsOfService,
        maxMonthsOfService: r.maxMonthsOfService,
      })),
    };
  }

  async addCustomRule(userId: string, ruleData: Partial<ConventionRule>) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId)
      throw new NotFoundException('Utilisateur sans entreprise');

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { collectiveAgreement: true },
    });
    if (!company?.collectiveAgreement)
      throw new BadRequestException('Aucune convention active');

    return this.prisma.collectiveAgreementRule.create({
      data: {
        companyId: user.companyId,
        agreementCode: company.collectiveAgreement,
        ruleType: ruleData.ruleType || 'AUTOMATIC_BONUS',
        professionalCategory: ruleData.professionalCategory || null,
        bonusType: ruleData.bonusType || null,
        bonusPercentage: ruleData.bonusPercentage
          ? Number(ruleData.bonusPercentage)
          : null,
        bonusFixedAmount: ruleData.bonusFixedAmount
          ? Number(ruleData.bonusFixedAmount)
          : null,
        bonusBaseCalculation: ruleData.bonusBaseCalculation || null,
        minMonthsOfService: ruleData.minMonthsOfService || null,
        maxMonthsOfService: ruleData.maxMonthsOfService || null,
        isActive: true,
      },
    });
  }

  async deactivateRule(userId: string, ruleId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId)
      throw new NotFoundException('Utilisateur sans entreprise');

    const rule = await this.prisma.collectiveAgreementRule.findFirst({
      where: { id: ruleId, companyId: user.companyId },
    });
    if (!rule) throw new NotFoundException(`Règle ${ruleId} introuvable`);

    await this.prisma.collectiveAgreementRule.update({
      where: { id: ruleId },
      data: { isActive: false },
    });
    return { success: true, message: 'Règle désactivée' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ▼ NOUVELLES MÉTHODES — BRIDGE POUR LE MODULE RUPTURE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Point d'entrée unique appelé par ContractRuptureService.
   * Résout convention + catégorie employé + salaire minimum.
   * Lit Company.collectiveAgreement (BDD) — c'est la source de vérité.
   */
  async resolveConventionForRupture(
    employeeId: string,
    companyId: string,
    overrides?: {
      conventionCode?: string;
      professionalCategory?: string; // override catégorie texte
      echelon?: number;
    },
  ): Promise<ConventionRuptureContext> {
    const alertes: string[] = [];

    // 1. Convention de l'entreprise (BDD)
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { collectiveAgreement: true },
    });

    const conventionCode =
      overrides?.conventionCode ?? company?.collectiveAgreement ?? null;

    if (!conventionCode) {
      throw new BadRequestException(
        'Aucune convention collective paramétrée. ' +
          'Activez-en une dans Paramètres → Convention collective.',
      );
    }
    const _conventionExists = (() => {
      try {
        getConvention(conventionCode);
        return true;
      } catch {
        return false;
      }
    })();
    if (!_conventionExists) {
      throw new BadRequestException(
        `Convention "${conventionCode}" non implémentée dans le module rupture. ` +
          `Conventions disponibles : ${listConventions()
            .map((c) => c.code)
            .join(', ')}`,
      );
    }

    const convention = getConvention(conventionCode);

    // 2. Employé — lit professionalCategory et echelon (BDD)
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: {
        position: true,
        baseSalary: true,
        professionalCategory: true, // ex: "C5-E2", "E8-1", "I7-E1"
        echelon: true, // ex: "2", "1"
      },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');

    // 3. Résolution catégorie texte → numérique
    const catTexte =
      overrides?.professionalCategory ?? employee.professionalCategory ?? null;
    const echelonStr =
      overrides?.echelon?.toString() ?? employee.echelon ?? '1';
    const echelon = Number(echelonStr) || 1;

    // Convertir code catégorie texte (ex: "C5-E2") → numérique (ex: 5)
    let categorieNum = catTexte ? this._parseCategorieNum(catTexte) : null;

    if (!categorieNum) {
      categorieNum = convention.getCategorieFromPoste(employee.position) ?? 1;
      if (categorieNum) {
        alertes.push(
          `ℹ️ Catégorie ${categorieNum} détectée depuis le poste "${employee.position}" — vérifiez la fiche employé.`,
        );
      } else {
        alertes.push(
          `⚠️ Catégorie non renseignée — catégorie 1 appliquée. Mettez à jour la fiche employé.`,
        );
        categorieNum = 1;
      }
    }

    // 4. Salaire minimum depuis les catégories prédéfinies (source BDD-compatible)
    const salaireMin = this._getSalaireMinFromCategories(
      conventionCode,
      catTexte,
      categorieNum,
      echelon,
    );
    const salaireBase = Number(employee.baseSalary);
    const salaireConforme = salaireMin === 0 || salaireBase >= salaireMin;

    if (!salaireConforme) {
      alertes.push(
        `⚠️ Salaire (${this._fmt(salaireBase)} FCFA) < minimum conventionnel ` +
          `${catTexte ?? `cat. ${categorieNum}`} (${this._fmt(salaireMin)} FCFA). Risque contentieux.`,
      );
    }

    return {
      convention,
      conventionCode: convention.code,
      conventionNom: convention.nom,
      categorieNum,
      professionalCategory: catTexte,
      echelon,
      salaireMinimum: salaireMin,
      preavisDays: convention.getPreavisDays(categorieNum),
      salaireConforme,
      alertes,
    };
  }

  /**
   * Vérifie si l'entreprise a une convention active.
   * Utilisé par le front pour afficher ou non le modal de sélection.
   */
  async hasActiveConvention(companyId: string): Promise<{
    hasConvention: boolean;
    conventionCode: string | null;
    conventionName: string | null;
    categories: ConventionCategory[];
  }> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { collectiveAgreement: true },
    });

    if (!company?.collectiveAgreement) {
      return {
        hasConvention: false,
        conventionCode: null,
        conventionName: null,
        categories: [],
      };
    }

    const conv = this.getConventionByCode(company.collectiveAgreement);
    return {
      hasConvention: true,
      conventionCode: company.collectiveAgreement,
      conventionName: conv?.name ?? company.collectiveAgreement,
      categories: conv?.categories ?? [],
    };
  }

  // ── Helpers privés ─────────────────────────────────────────────────────────

  /**
   * Extrait le numéro de catégorie depuis un code texte.
   * "C5-E2" → 5 / "I11-E1" → 11 / "E9-1" → 9 / "MAN_ORD" → 1
   */
  private _parseCategorieNum(code: string): number | null {
    // Pattern : lettre(s) + chiffre(s) ex: C5, I11, E9, T7, H8, PH10
    const m = code.match(/[A-Z]+(\d+)/i);
    if (m) return Number(m[1]);
    // Fallback : codes spéciaux BTP (MAN_ORD, OS1, OP2, OQ, OHQ)
    if (code.startsWith('MAN_ORD') || code.startsWith('MAN_BAT')) return 1;
    if (code.startsWith('MAN_SPE') || code.startsWith('OS1')) return 2;
    if (code.startsWith('OS2') || code.startsWith('OS3')) return 3;
    if (code.startsWith('OP1') || code.startsWith('OP2')) return 4;
    if (code.startsWith('OQ')) return 5;
    if (code.startsWith('OHQ')) return 6;
    return null;
  }

  /** Récupère le salaire minimum depuis les catégories prédéfinies */
  private _getSalaireMinFromCategories(
    conventionCode: string,
    catTexte: string | null,
    categorieNum: number,
    echelon: number,
  ): number {
    const conv = this.getConventionByCode(conventionCode);
    if (!conv) return 0;

    // 1. Recherche exacte par code texte
    if (catTexte) {
      const found = conv.categories.find((c) => c.code === catTexte);
      if (found) return found.minSalary;
    }

    // 2. Recherche par catégorie numérique + échelon
    const echelonCode = `-E${echelon}`;
    const byNumEchelon = conv.categories.find((c) => {
      const num = this._parseCategorieNum(c.code);
      return num === categorieNum && c.code.includes(echelonCode);
    });
    if (byNumEchelon) return byNumEchelon.minSalary;

    // 3. Premier échelon de la catégorie numérique
    const byNum = conv.categories.find(
      (c) => this._parseCategorieNum(c.code) === categorieNum,
    );
    return byNum?.minSalary ?? 0;
  }

  private _fmt(n: number): string {
    return new Intl.NumberFormat('fr-FR').format(Math.round(n));
  }
}