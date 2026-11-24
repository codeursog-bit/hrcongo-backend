// ============================================================================
// contract-rupture.service.ts — Couche 5 : orchestration complète
// ============================================================================

import { Injectable } from '@nestjs/common';
import {
  CreateRuptureDto,
  RuptureResult,
  MotifRupture,
} from './dto/create-rupture.dto';
import {
  getConvention,
  listConventions,
} from './conventions/convention.registry';
import {
  calcAnciennete,
  calcAvg12,
  calcSoldeConges,
  calcIndemConges,
  calcDernierSalaireProrata,
  calcIndemPreavis,
  calcGratifProrata,
  calcFiscaliteSTC,
  calcITSAvecParts,
  ancienneteEnAnneesPourBareme,
  PayeurPreavis,
  _fmt,
} from './helpers/calcul.helper';
import {
  genererChecklist,
  genererAlertes,
} from './procedures/procedure.helper';

@Injectable()
export class ContractRuptureService {
  listConventions() {
    return listConventions();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POINT D'ENTRÉE PRINCIPAL
  // ──────────────────────────────────────────────────────────────────────────
  calculerRupture(dto: CreateRuptureDto): RuptureResult {
    const convention = getConvention(dto.conventionCode);
    const donneesManquantes: string[] = [];

    // ── 1. ANCIENNETÉ ────────────────────────────────────────────────────────
    const anciennete = calcAnciennete(
      new Date(dto.dateEmbauche),
      new Date(dto.dateFinEffective),
    );
    const yearsExact = ancienneteEnAnneesPourBareme(
      anciennete,
      convention.baremeLicenciement.fractionsMinJours,
    );

    // ── 2. AVG12 ─────────────────────────────────────────────────────────────
    const avg12Result = calcAvg12(
      dto.bulletinsKonza ?? [],
      new Date(dto.dateFinEffective),
      dto.salaireActuel,
      dto.migrationData,
    );
    if (avg12Result.source !== 'konza') {
      donneesManquantes.push(
        `Salaires manquants : ${avg12Result.moisFallback} mois estimés`,
      );
    }
    // Override manuel si RH le demande
    const avg12 = dto.overrides?.avg12 ?? avg12Result.montant;

    // ── 3. SOLDE CONGÉS ──────────────────────────────────────────────────────
    const soldeCongesResult = calcSoldeConges(
      new Date(dto.dateEmbauche),
      new Date(dto.dateFinEffective),
      dto.congesPrisKonza ?? 0,
      dto.joursParAn ?? convention.conges.joursParAn,
      dto.migrationData,
    );
    if (soldeCongesResult.source === 'estime') {
      donneesManquantes.push('Historique congés avant Konza non renseigné');
    }

    // ── 4. DERNIER SALAIRE PRORATISÉ ─────────────────────────────────────────
    const dernierSalairePro = calcDernierSalaireProrata(
      dto.joursTravaillesDernierMois ?? 30,
      avg12,
    );

    // ── 5. INDEMNITÉ CONGÉS PAYÉS ────────────────────────────────────────────
    const indemConges = calcIndemConges(soldeCongesResult.solde, avg12);
    const indemCongesFinal =
      dto.overrides?.indemConges !== undefined
        ? {
            montant: dto.overrides.indemConges,
            detail: `Override manuel : ${_fmt(dto.overrides.indemConges)} FCFA`,
          }
        : indemConges;

    // ── 6. PRÉAVIS ───────────────────────────────────────────────────────────
    const { indemPreavis: indemPreavisCalc, dureeJours: preavisDuree } =
      this._calcPreavis(dto, convention, avg12);
    const indemPreavisfinal =
      dto.overrides?.indemPreavis !== undefined
        ? {
            montant: dto.overrides.indemPreavis,
            detail: `Override manuel : ${_fmt(dto.overrides.indemPreavis)} FCFA`,
            payeur: 'EMPLOYEUR',
            dureeJours: preavisDuree,
          }
        : indemPreavisCalc;

    // ── 7. INDEMNITÉ DE LICENCIEMENT / RETRAITE / DÉCÈS ─────────────────────
    const { indemLicenciement, indemRetraite, indemDeces } =
      this._calcIndemPrincipale(dto, convention, yearsExact, avg12);

    const indemLicFinal =
      dto.overrides?.indemLicenciement !== undefined
        ? {
            montant: dto.overrides.indemLicenciement,
            detail: `Override manuel : ${_fmt(dto.overrides.indemLicenciement)} FCFA`,
          }
        : indemLicenciement;

    // ── 8. GRATIFICATION PRORATISÉE ──────────────────────────────────────────
    const gratifProrata = calcGratifProrata(
      new Date(dto.dateFinEffective),
      new Date(dto.dateEmbauche),
      dto.gratifData,
      dto.motif,
      anciennete.totalMois,
    );
    const gratifFinal =
      dto.overrides?.gratifProrata !== undefined
        ? {
            montant: dto.overrides.gratifProrata,
            detail: `Override manuel : ${_fmt(dto.overrides.gratifProrata)} FCFA`,
          }
        : gratifProrata;

    // ── 9. AUTRES SOMMES ─────────────────────────────────────────────────────
    const autresSommes = dto.autresSommes ?? [];
    const autresMontantImp = autresSommes
      .filter((a) => a.imposable)
      .reduce((s, a) => s + a.montant, 0);

    // ── 10. FISCALITÉ ────────────────────────────────────────────────────────
    const fiscalite = calcFiscaliteSTC({
      dernierSalairePro: dernierSalairePro.montant,
      indemConges: indemCongesFinal.montant,
      indemPreavis: indemPreavisfinal.montant,
      indemLicenciement: indemLicFinal.montant,
      gratifProrata: gratifFinal.montant,
      autresSommes: autresMontantImp,
      nbParts: dto.nbParts ?? 1,
    });

    // ── 11. TOTAUX ───────────────────────────────────────────────────────────
    const brutTotal =
      dernierSalairePro.montant +
      indemCongesFinal.montant +
      indemPreavisfinal.montant +
      indemLicFinal.montant +
      (indemRetraite?.montant ?? 0) +
      (indemDeces?.montant ?? 0) +
      gratifFinal.montant +
      autresSommes.reduce((s, a) => s + a.montant, 0);

    // Déduction si préavis à charge de l'employé
    const deductionPreavisEmploye =
      indemPreavisfinal.payeur === 'EMPLOYE' ? indemPreavisfinal.montant : 0;

    // Déduction indemnités antérieures (multi-embauches compression)
    const deductionAnterieure = dto.migrationData?.indemnitesAnterieures ?? 0;

    const totalRetenues =
      fiscalite.its +
      fiscalite.cnss +
      deductionPreavisEmploye +
      deductionAnterieure;
    const netAPayer = Math.max(0, brutTotal - totalRetenues);

    // ── 12. CHECKLIST + ALERTES ──────────────────────────────────────────────
    const checklist = genererChecklist(
      dto.motif,
      dto.typeContrat,
      dto.statutPreavis,
      undefined,
    );

    const alertes = genererAlertes({
      motif: dto.motif,
      anciennete,
      seuilMoisAnc: convention.baremeLicenciement.seuilMoisAnciennete,
      statutPreavis: dto.statutPreavis,
      avg12Source: avg12Result.source,
      soldeCongesSource: soldeCongesResult.source,
      dateRupture: new Date(dto.dateRupture),
      dateFinEffective: new Date(dto.dateFinEffective),
      conventionCode: dto.conventionCode,
    });

    // ── 13. RÉSULTAT FINAL ───────────────────────────────────────────────────
    return {
      employeeId: dto.employeeId,
      conventionCode: dto.conventionCode,
      motif: dto.motif,
      dateRupture: new Date(dto.dateRupture),
      dateFinEffective: new Date(dto.dateFinEffective),

      anciennete: {
        annees: anciennete.annees,
        mois: anciennete.moisRestant,
        jours: anciennete.joursRestant,
        totalMois: anciennete.totalMois,
        detail: anciennete.detail,
      },

      avg12: {
        montant: avg12Result.montant,
        source: avg12Result.source,
        moisKonza: avg12Result.moisKonza,
        moisFallback: avg12Result.moisFallback,
        detail: avg12Result.detail,
      },

      composantes: {
        dernierSalairePro: dernierSalairePro,
        indemConges: {
          ...indemCongesFinal,
          soldeJours: soldeCongesResult.solde,
        },
        indemPreavis: indemPreavisfinal,
        indemLicenciement: indemLicFinal,
        indemRetraite,
        indemDeces,
        gratifProrata: gratifFinal,
        autresSommes: autresSommes.map((a) => ({
          libelle: a.libelle,
          montant: a.montant,
        })),
      },

      fiscalite,

      totaux: {
        brutTotal,
        totalRetenues,
        netAPayer,
      },

      alertes,
      checklist,
      donneesManquantes,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HELPERS PRIVÉS
  // ──────────────────────────────────────────────────────────────────────────

  private _calcPreavis(
    dto: CreateRuptureDto,
    convention: any,
    avg12: number,
  ): { indemPreavis: any; dureeJours: number } {
    // Motifs sans préavis
    const sansPreavais: MotifRupture[] = [
      'LICENCIEMENT_FAUTE_LOURDE',
      'LICENCIEMENT_FAUTE_GRAVE',
      'FIN_CDD',
      'DECES',
    ];
    if (sansPreavais.includes(dto.motif)) {
      return {
        indemPreavis: {
          montant: 0,
          payeur: 'AUCUN',
          dureeJours: 0,
          detail: 'Aucun préavis pour ce motif',
        },
        dureeJours: 0,
      };
    }

    const dureeConv = convention.getPreavisDays(dto.categorie);
    const dureeJours = dto.dureePreavjours ?? dureeConv;
    const double =
      dto.rupturePendantConge === true &&
      convention.preavis.doubleementSiRupturePendantConge === true;

    // Déterminer le payeur
    let payeur: PayeurPreavis = 'AUCUN';
    if (dto.statutPreavis === 'DISPENSE_EMPLOYEUR') payeur = 'EMPLOYEUR';
    if (dto.statutPreavis === 'REFUSE_SALARIE') payeur = 'EMPLOYE';

    const indemPreavis = calcIndemPreavis(
      avg12,
      dureeJours,
      dto.statutPreavis === 'EFFECTUE',
      payeur,
      double,
    );

    return { indemPreavis, dureeJours };
  }

  private _calcIndemPrincipale(
    dto: CreateRuptureDto,
    convention: any,
    yearsExact: number,
    avg12: number,
  ): {
    indemLicenciement: { montant: number; detail: string };
    indemRetraite?: { montant: number; detail: string };
    indemDeces?: { montant: number; detail: string };
  } {
    const ZERO = { montant: 0, detail: 'Non applicable pour ce motif' };

    // ── Faute grave/lourde → 0
    if (
      dto.motif === 'LICENCIEMENT_FAUTE_GRAVE' ||
      dto.motif === 'LICENCIEMENT_FAUTE_LOURDE'
    ) {
      return { indemLicenciement: ZERO };
    }

    // ── Décès
    if (dto.motif === 'DECES') {
      const indemDeces = convention.calcIndemDeces(
        yearsExact,
        avg12,
        dto.nbEnfantsCharge ?? 0,
      );
      return { indemLicenciement: ZERO, indemDeces };
    }

    // ── Retraite
    if (
      dto.motif === 'RETRAITE_EMPLOYEUR' ||
      dto.motif === 'RETRAITE_SALARIE'
    ) {
      const indemRetraite = convention.calcIndemRetraite(
        yearsExact,
        avg12,
        dto.salaireBase,
        dto.categorieLabel,
      );
      return { indemLicenciement: ZERO, indemRetraite };
    }

    // ── Démission → 0
    if (dto.motif === 'DEMISSION') {
      return { indemLicenciement: ZERO };
    }

    // ── Fin normale CDD → 0
    if (dto.motif === 'FIN_CDD') {
      return { indemLicenciement: ZERO };
    }

    // ── Rupture anticipée CDD par employeur → salaires restants jusqu'au terme
    if (dto.motif === 'RUPTURE_ANTICIPEE_CDD_EMPLOYEUR') {
      const montant = dto.salaireRestantsJusquTerme ?? 0;
      return {
        indemLicenciement: {
          montant,
          detail: `Rémunérations restantes jusqu'au terme : ${_fmt(montant)} FCFA (CT art. 37-4)`,
        },
      };
    }

    // ── Licenciements (motif personnel, économique, invalidité, conventionnel)
    const ancMin =
      dto.motif === 'LICENCIEMENT_ECONOMIQUE'
        ? (convention.baremeLicenciement.seuilMoisEconomique ??
          convention.baremeLicenciement.seuilMoisAnciennete)
        : convention.baremeLicenciement.seuilMoisAnciennete;

    if (yearsExact * 12 < ancMin) {
      return {
        indemLicenciement: {
          montant: 0,
          detail: `Ancienneté insuffisante (${Math.round(yearsExact * 12)} mois / ${ancMin} mois requis)`,
        },
      };
    }

    const isEco =
      dto.motif === 'LICENCIEMENT_ECONOMIQUE' &&
      !!convention.baremeLicenciement.palierEconomique;

    let indemLicenciement = convention.calcIndemLicenciement(
      yearsExact,
      avg12,
      isEco,
      dto.salaireBase,
      dto.categorieLabel,
    );

    // Déduire indemnités antérieures si multi-embauches compression
    if (isEco && dto.migrationData?.indemnitesAnterieures) {
      const deduction = dto.migrationData.indemnitesAnterieures;
      indemLicenciement = {
        montant: Math.max(0, indemLicenciement.montant - deduction),
        detail: `${indemLicenciement.detail} − déduction antérieure (${_fmt(deduction)}) = ${_fmt(Math.max(0, indemLicenciement.montant - deduction))} FCFA`,
      };
    }

    return { indemLicenciement };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CALCUL PRÉAVIS SEUL (endpoint dédié)
  // ──────────────────────────────────────────────────────────────────────────
  calcPreavisSeul(
    conventionCode: string,
    categorie: number,
    avg12: number,
    double = false,
  ) {
    const convention = getConvention(conventionCode);
    const dureeJours = convention.getPreavisDays(categorie);
    return calcIndemPreavis(avg12, dureeJours, false, 'EMPLOYEUR', double);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SIMULATION RAPIDE (sans tout le contexte)
  // ──────────────────────────────────────────────────────────────────────────
  simulerIndemnite(params: {
    conventionCode: string;
    annees: number;
    avg12: number;
    isEco?: boolean;
  }): { montant: number; detail: string } {
    const convention = getConvention(params.conventionCode);
    return convention.calcIndemLicenciement(
      params.annees,
      params.avg12,
      params.isEco ?? false,
    );
  }
}