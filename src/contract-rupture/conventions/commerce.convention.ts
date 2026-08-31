// ============================================================================
// commerce.convention.ts — Convention Collective Commerce Congo
// Source : Convention-Collective-Commerce.pdf + Protocole d'accord 05/04/2024
// ============================================================================

import {
  IConvention,
  ConventionBaremeLicenciement,
  ConventionBaremeRetraite,
  ConventionPreavis,
  ConventionConges,
  ConventionFiscalite,
  ConventionDecesConfig,
  GrilleSalariale,
} from './convention.interface';
import {
  ancienneteEnAnneesPourBareme,
  AncienneteResult,
  _fmt,
} from '../helpers/calcul.helper';

export class CommerceConvention implements IConvention {
  code = 'COMMERCE';
  nom = 'Convention Collective du Commerce';
  secteurs = ['commerce', 'distribution', 'grande surface', 'négoce'];

  baremeLicenciement: ConventionBaremeLicenciement = {
    format: 'POURCENTAGE',
    seuilMoisAnciennete: 18, // Art. 21 : 18 mois minimum
    paliers: [
      { anneeMin: 0, anneeMax: 6, valeur: 0.3 }, // 30% ans 1-6
      { anneeMin: 6, anneeMax: 12, valeur: 0.38 }, // 38% ans 7-12
      { anneeMin: 12, anneeMax: 20, valeur: 0.44 }, // 44% ans 13-20
      { anneeMin: 20, anneeMax: 999, valeur: 0.5 }, // 50% au-delà
    ],
    // Art. 22 compression : taux différent
    palierEconomique: [
      { anneeMin: 0, anneeMax: 999, valeur: 0.15 }, // 15% après 1 an
    ],
    seuilMoisEconomique: 12,
    baseCalcul: 'avg12',
    fractionsMinJours: 31, // Art. 21 : fractions ≥ 1 mois
  };

  baremeRetraite: ConventionBaremeRetraite = {
    paliers: [
      { anneeMin: 0, anneeMax: 10, moisSalaire: 5 }, // 5 mois < 10 ans
      { anneeMin: 10, anneeMax: 999, moisSalaire: 7 }, // 7 mois ≥ 10 ans
    ],
    baseCalcul: 'avg12',
  };

  preavis: ConventionPreavis = {
    dureeParCategorie: {
      1: 30,
      2: 30,
      3: 30,
      4: 30, // Cat. 1-4 : 1 mois
      5: 60,
      6: 60,
      7: 60, // Cat. 5-7 : 2 mois
      8: 90,
      9: 90,
      10: 90, // Cat. 8+  : 3 mois
    },
    dureeDefaut: 90,
    uniteJours: 'calendaires',
    doubleementSiRupturePendantConge: false,
    baseIndemCompensatrice: 'avg12',
    heuresRechercheEmploi: { type: 'jours_semaine', valeur: 2 },
  };

  conges: ConventionConges = { joursParAn: 26, baseCalcul: 'avg12' };

  fiscalite: ConventionFiscalite = {
    indemLicenciementExonereITS: true,
    indemPreavisImposableITS: true,
    indemCongesImposableITS: true,
    indemGratificationImposable: true,
    TAUX_CNSS_SALARIE: 0.04,
    indemLicenciementExonereCNSS: true,
    preavisAssietteCNSS: true,
    congesAssietteCNSS: true,
    dernierSalaireAssietteCNSS: true,
    gratificationAssietteCNSS: true,
  };

  decesConfig: ConventionDecesConfig = {
    ancienneteMinMois: 12,
    type: 'EGAL_LICENCIEMENT',
  };

  grilleSalariale: GrilleSalariale = {
    categories: {
      1: { 0: 71000, 1: 72139, 2: 73278, 3: 74417, 4: 75556 },
      2: { 0: 76695, 1: 78037, 2: 79379, 3: 80720, 4: 82061 },
      3: { 0: 81169, 1: 82475, 2: 83781, 3: 85085, 4: 86391 },
      4: { 0: 87697, 1: 91934, 2: 96171, 3: 100409, 4: 104645 },
      5: { 0: 105939, 1: 109342, 2: 112746, 3: 116149, 4: 118978 },
      6: { 0: 122956, 1: 126647, 2: 130338, 3: 134029, 4: 137720 },
      7: { 0: 141411, 1: 149081, 2: 156751, 3: 164420, 4: 172090 },
      8: { 0: 173250, 1: 174636, 2: 176022, 3: 177366, 4: 178794 },
      9: { 0: 180180 },
      10: { 0: 222915 },
    },
  };

  getPreavisDays(categorie: number): number {
    return (
      this.preavis.dureeParCategorie[categorie] ?? this.preavis.dureeDefaut
    );
  }

  getSalaireMinimum(categorie: number, echelon = 0): number {
    return (
      this.grilleSalariale.categories[categorie]?.[echelon] ??
      this.grilleSalariale.categories[categorie]?.[0] ??
      71000
    );
  }

  getCategorieFromPoste(_poste: string): number | null {
    return null;
  }

  calcIndemLicenciement(
    yearsExact: number,
    avg12: number,
    isEco = false,
    _salaireBase?: number,
    _catLabel?: string,
  ): { montant: number; detail: string } {
    const paliers = isEco
      ? this.baremeLicenciement.palierEconomique!
      : this.baremeLicenciement.paliers;

    let montant = 0;
    const lignes: string[] = [];
    let anneesCumulees = 0;

    for (const p of paliers) {
      if (yearsExact <= p.anneeMin) break;
      const anneesInTranche = Math.min(yearsExact, p.anneeMax) - p.anneeMin;
      if (anneesInTranche <= 0) continue;
      const contribution = avg12 * p.valeur * anneesInTranche;
      montant += contribution;
      anneesCumulees += anneesInTranche;
      lignes.push(
        `${anneesInTranche.toFixed(2)} an(s) × ${(p.valeur * 100).toFixed(0)}% × ${_fmt(avg12)} = ${_fmt(contribution)}`,
      );
    }

    return {
      montant: Math.round(montant),
      detail: lignes.join(' + ') + ` = ${_fmt(montant)} FCFA`,
    };
  }

  calcIndemRetraite(
    yearsExact: number,
    avg12: number,
  ): { montant: number; detail: string } {
    const palier =
      this.baremeRetraite.paliers.find(
        (p) => yearsExact >= p.anneeMin && yearsExact < p.anneeMax,
      ) ?? this.baremeRetraite.paliers.at(-1)!;

    const montant = Math.round(avg12 * palier.moisSalaire);
    return {
      montant,
      detail: `${palier.moisSalaire} mois × ${_fmt(avg12)} = ${_fmt(montant)} FCFA`,
    };
  }

  calcIndemDeces(
    yearsExact: number,
    avg12: number,
    _nbEnfants = 0,
  ): { montant: number; detail: string } {
    if (yearsExact * 12 < this.decesConfig.ancienneteMinMois)
      return {
        montant: 0,
        detail: `Ancienneté insuffisante (${Math.round(yearsExact * 12)}m / ${this.decesConfig.ancienneteMinMois}m requis)`,
      };
    return this.calcIndemLicenciement(yearsExact, avg12);
  }
}
