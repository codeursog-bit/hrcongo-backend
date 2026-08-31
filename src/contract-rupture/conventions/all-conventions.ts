// ============================================================================
// industrie.convention.ts
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
import { _fmt } from '../helpers/calcul.helper';

export class IndustrieConvention implements IConvention {
  code = 'INDUSTRIE';
  nom = 'Convention Collective Industrie & Métallurgie';
  secteurs = ['industrie', 'métallurgie', 'fabrication', 'manufacture'];

  baremeLicenciement: ConventionBaremeLicenciement = {
    format: 'POURCENTAGE',
    seuilMoisAnciennete: 24,
    paliers: [
      { anneeMin: 0, anneeMax: 5, valeur: 0.31 },
      { anneeMin: 5, anneeMax: 10, valeur: 0.36 },
      { anneeMin: 10, anneeMax: 20, valeur: 0.4 },
      { anneeMin: 20, anneeMax: 999, valeur: 0.45 },
    ],
    palierEconomique: [{ anneeMin: 0, anneeMax: 999, valeur: 0.23 }],
    seuilMoisEconomique: 12,
    baseCalcul: 'avg12',
    fractionsMinJours: 30,
  };

  baremeRetraite: ConventionBaremeRetraite = {
    paliers: [{ anneeMin: 0, anneeMax: 999, moisSalaire: 5 }],
    baseCalcul: 'base_anciennete',
  };

  preavis: ConventionPreavis = {
    dureeParCategorie: {
      1: 30,
      2: 30,
      3: 30,
      4: 30,
      5: 30,
      6: 30,
      7: 30,
      8: 60,
      9: 60,
      10: 90,
      11: 90,
    },
    dureeDefaut: 90,
    uniteJours: 'calendaires',
    doubleementSiRupturePendantConge: true,
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
    ancienneteMinMois: 24,
    type: 'EGAL_LICENCIEMENT',
  };

  grilleSalariale: GrilleSalariale = {
    categories: {
      1: { 1: 50463, 2: 52558 },
      2: { 1: 55284 },
      3: { 1: 67088 },
      4: { 1: 70507, 3: 79107 },
      5: { 1: 87383 },
      6: { 1: 102683, 2: 107680 },
      7: { 1: 120641, 2: 133446 },
      8: { 1: 140657, 2: 158301 },
      9: { 1: 164337, 2: 173098 },
      10: { 1: 187357 },
      11: { 1: 229495 },
    },
  };

  getPreavisDays(categorie: number): number {
    return (
      this.preavis.dureeParCategorie[categorie] ?? this.preavis.dureeDefaut
    );
  }
  getSalaireMinimum(cat: number, echelon = 1): number {
    return this.grilleSalariale.categories[cat]?.[echelon] ?? 50463;
  }
  getCategorieFromPoste(_p: string): number | null {
    return null;
  }

  calcIndemLicenciement(
    yearsExact: number,
    avg12: number,
    isEco = false,
  ): { montant: number; detail: string } {
    const paliers = isEco
      ? this.baremeLicenciement.palierEconomique!
      : this.baremeLicenciement.paliers;
    let montant = 0;
    const lignes: string[] = [];
    for (const p of paliers) {
      if (yearsExact <= p.anneeMin) break;
      const n = Math.min(yearsExact, p.anneeMax) - p.anneeMin;
      if (n <= 0) continue;
      const c = avg12 * p.valeur * n;
      montant += c;
      lignes.push(
        `${n.toFixed(2)}a × ${(p.valeur * 100).toFixed(0)}% × ${_fmt(avg12)} = ${_fmt(c)}`,
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
    const montant = Math.round(avg12 * 5);
    return {
      montant,
      detail: `5 mois (base + ancienneté) × ${_fmt(avg12)} = ${_fmt(montant)} FCFA`,
    };
  }

  calcIndemDeces(
    yearsExact: number,
    avg12: number,
  ): { montant: number; detail: string } {
    if (yearsExact * 12 < 24)
      return { montant: 0, detail: 'Ancienneté < 2 ans' };
    return this.calcIndemLicenciement(yearsExact, avg12);
  }
}

// ============================================================================
// petrole.convention.ts
// ============================================================================
export class PetroleConvention implements IConvention {
  code = 'PETROLE';
  nom = 'Convention Collective Para-Pétrolier';
  secteurs = ['pétrole', 'gaz', 'para-pétrolier', 'hydrocarbures'];

  baremeLicenciement: ConventionBaremeLicenciement = {
    format: 'POURCENTAGE',
    seuilMoisAnciennete: 24,
    paliers: [
      { anneeMin: 0, anneeMax: 5, valeur: 0.45 },
      { anneeMin: 5, anneeMax: 10, valeur: 0.5 },
      { anneeMin: 10, anneeMax: 15, valeur: 0.6 },
      { anneeMin: 15, anneeMax: 20, valeur: 0.65 },
      { anneeMin: 20, anneeMax: 30, valeur: 0.7 },
      { anneeMin: 30, anneeMax: 999, valeur: 0.85 },
    ],
    // Pétrole : même barème pour éco et personnel
    baseCalcul: 'avg12',
    fractionsMinJours: 0, // prorata mois
  };

  baremeRetraite: ConventionBaremeRetraite = {
    paliers: [
      { anneeMin: 1, anneeMax: 8, moisSalaire: 4 },
      { anneeMin: 8, anneeMax: 16, moisSalaire: 8 },
      { anneeMin: 16, anneeMax: 21, moisSalaire: 10 },
      { anneeMin: 21, anneeMax: 999, moisSalaire: 12 }, // 12.5 arrondi
    ],
    baseCalcul: 'avg12',
  };

  preavis: ConventionPreavis = {
    dureeParCategorie: {
      1: 60,
      2: 60,
      3: 60,
      4: 60,
      5: 60,
      6: 60,
      7: 60,
      8: 60,
      9: 90,
      10: 90,
    },
    dureeDefaut: 90,
    uniteJours: 'calendaires',
    doubleementSiRupturePendantConge: false,
    baseIndemCompensatrice: 'avg12',
    heuresRechercheEmploi: { type: 'heures_jour', valeur: 2 },
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
    type: 'FORFAIT_PLUS_LICENCIEMENT',
    moisForfait: 2,
  };

  grilleSalariale: GrilleSalariale = { categories: {} };

  getPreavisDays(cat: number): number {
    return this.preavis.dureeParCategorie[cat] ?? this.preavis.dureeDefaut;
  }
  getSalaireMinimum(_c: number): number {
    return 70000;
  }
  getCategorieFromPoste(_p: string): number | null {
    return null;
  }

  calcIndemLicenciement(
    yearsExact: number,
    avg12: number,
  ): { montant: number; detail: string } {
    const paliers = this.baremeLicenciement.paliers;
    let montant = 0;
    const lignes: string[] = [];
    for (const p of paliers) {
      if (yearsExact <= p.anneeMin) break;
      const n = Math.min(yearsExact, p.anneeMax) - p.anneeMin;
      if (n <= 0) continue;
      const c = avg12 * p.valeur * n;
      montant += c;
      lignes.push(
        `${n.toFixed(2)}a × ${(p.valeur * 100).toFixed(0)}% × ${_fmt(avg12)} = ${_fmt(c)}`,
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
    const p =
      this.baremeRetraite.paliers.find(
        (x) => yearsExact >= x.anneeMin && yearsExact < x.anneeMax,
      ) ?? this.baremeRetraite.paliers.at(-1)!;
    const montant = Math.round(avg12 * p.moisSalaire);
    return {
      montant,
      detail: `${p.moisSalaire} mois × ${_fmt(avg12)} = ${_fmt(montant)} FCFA`,
    };
  }

  calcIndemDeces(
    yearsExact: number,
    avg12: number,
  ): { montant: number; detail: string } {
    const forfait = Math.round(avg12 * 2);
    const lic =
      yearsExact * 12 >= 12
        ? this.calcIndemLicenciement(yearsExact, avg12).montant
        : 0;
    return {
      montant: forfait + lic,
      detail: `2 mois forfait (${_fmt(forfait)}) + indemnité licenciement (${_fmt(lic)}) = ${_fmt(forfait + lic)} FCFA`,
    };
  }
}

// ============================================================================
// btp.convention.ts
// ============================================================================
export class BTPConvention implements IConvention {
  code = 'BTP';
  nom = 'Convention Collective BTP';
  secteurs = ['bâtiment', 'travaux publics', 'construction', 'génie civil'];

  baremeLicenciement: ConventionBaremeLicenciement = {
    format: 'POURCENTAGE',
    seuilMoisAnciennete: 24,
    paliers: [
      { anneeMin: 0, anneeMax: 5, valeur: 0.35 },
      { anneeMin: 5, anneeMax: 10, valeur: 0.4 },
      { anneeMin: 10, anneeMax: 999, valeur: 0.45 },
    ],
    palierEconomique: [{ anneeMin: 0, anneeMax: 999, valeur: 0.2 }],
    seuilMoisEconomique: 18,
    baseCalcul: 'avg12',
    // BTP exclut AUSSI les primes diverses (pas seulement frais)
    exclusionsBase: ['remboursements_frais', 'primes_diverses'],
    fractionsMinJours: 30,
  };

  baremeRetraite: ConventionBaremeRetraite = {
    paliers: [
      { anneeMin: 2, anneeMax: 6, moisSalaire: 2 },
      { anneeMin: 6, anneeMax: 999, moisSalaire: 3 },
    ],
    baseCalcul: 'avg12',
    // ≥ 6 ans : 3 mois + 1.5% par année, max +25%
    bonusMajoration: { anneeDepart: 6, moisParPeriode: 0.015, periodeMois: 12 },
  };

  preavis: ConventionPreavis = {
    // BTP : jours OUVRABLES
    dureeParCategorie: {
      1: 21,
      2: 21,
      3: 21, // cat 1-3 : 21 jours ouvrables
      4: 35,
      5: 35, // cat 4-5 : 35 jours ouvrables
      6: 40,
      7: 40,
      8: 40, // cat 6-8 : 40 jours ouvrables
      9: 90, // cat 9+  : 3 mois
    },
    dureeDefaut: 90,
    uniteJours: 'ouvrables',
    doubleementSiRupturePendantConge: true,
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
    ancienneteMinMois: 18,
    type: 'EGAL_LICENCIEMENT',
  };

  grilleSalariale: GrilleSalariale = { categories: {} };

  getPreavisDays(cat: number): number {
    return this.preavis.dureeParCategorie[cat] ?? this.preavis.dureeDefaut;
  }
  getSalaireMinimum(_c: number): number {
    return 70000;
  }
  getCategorieFromPoste(_p: string): number | null {
    return null;
  }

  calcIndemLicenciement(
    yearsExact: number,
    avg12: number,
    isEco = false,
  ): { montant: number; detail: string } {
    const paliers = isEco
      ? this.baremeLicenciement.palierEconomique!
      : this.baremeLicenciement.paliers;
    let montant = 0;
    const lignes: string[] = [];
    for (const p of paliers) {
      if (yearsExact <= p.anneeMin) break;
      const n = Math.min(yearsExact, p.anneeMax) - p.anneeMin;
      if (n <= 0) continue;
      const c = avg12 * p.valeur * n;
      montant += c;
      lignes.push(
        `${n.toFixed(2)}a × ${(p.valeur * 100).toFixed(0)}% × ${_fmt(avg12)} = ${_fmt(c)}`,
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
    if (yearsExact < 2) return { montant: 0, detail: 'Ancienneté < 2 ans' };
    if (yearsExact < 6) {
      const montant = Math.round(avg12 * 2);
      return {
        montant,
        detail: `2 mois × ${_fmt(avg12)} = ${_fmt(montant)} FCFA`,
      };
    }
    // ≥ 6 ans : 3 mois + 1.5% par année, max +25%
    const bonus = Math.min(yearsExact * 0.015, 0.25);
    const mois = 3 * (1 + bonus);
    const montant = Math.round(avg12 * mois);
    return {
      montant,
      detail: `3 mois × (1 + ${(bonus * 100).toFixed(1)}%) × ${_fmt(avg12)} = ${_fmt(montant)} FCFA`,
    };
  }

  calcIndemDeces(
    yearsExact: number,
    avg12: number,
  ): { montant: number; detail: string } {
    if (yearsExact * 12 < 18)
      return { montant: 0, detail: 'Ancienneté < 18 mois' };
    return this.calcIndemLicenciement(yearsExact, avg12);
  }
}

// ============================================================================
// hotellerie.convention.ts
// ============================================================================
export class HotellerieConvention implements IConvention {
  code = 'HOTELLERIE';
  nom = 'Convention Collective Hôtellerie & Catering';
  secteurs = ['hôtellerie', 'restauration', 'catering', 'tourisme'];

  baremeLicenciement: ConventionBaremeLicenciement = {
    format: 'POURCENTAGE',
    seuilMoisAnciennete: 24,
    paliers: [
      { anneeMin: 0, anneeMax: 5, valeur: 0.5 },
      { anneeMin: 5, anneeMax: 10, valeur: 0.6 },
      { anneeMin: 10, anneeMax: 999, valeur: 0.7 },
    ],
    palierEconomique: [{ anneeMin: 0, anneeMax: 999, valeur: 0.55 }],
    seuilMoisEconomique: 12,
    baseCalcul: 'avg12',
    fractionsMinJours: 30,
  };

  baremeRetraite: ConventionBaremeRetraite = {
    paliers: [
      { anneeMin: 5, anneeMax: 10, moisSalaire: 4 },
      { anneeMin: 10, anneeMax: 15, moisSalaire: 6 },
      { anneeMin: 15, anneeMax: 20, moisSalaire: 8 },
      { anneeMin: 20, anneeMax: 999, moisSalaire: 8 }, // +1 mois tous les 2 ans
    ],
    baseCalcul: 'avg12',
    bonusMajoration: { anneeDepart: 20, moisParPeriode: 1, periodeMois: 24 },
  };

  preavis: ConventionPreavis = {
    dureeParCategorie: {
      1: 30,
      2: 30,
      3: 30,
      4: 30,
      5: 30,
      6: 30,
      7: 30,
      8: 60,
      9: 60,
      10: 90,
    },
    dureeDefaut: 90,
    uniteJours: 'calendaires',
    doubleementSiRupturePendantConge: true,
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
    ancienneteMinMois: 24,
    type: 'EGAL_LICENCIEMENT',
  };

  grilleSalariale: GrilleSalariale = { categories: {} };

  getPreavisDays(cat: number): number {
    return this.preavis.dureeParCategorie[cat] ?? this.preavis.dureeDefaut;
  }
  getSalaireMinimum(_c: number): number {
    return 70000;
  }
  getCategorieFromPoste(_p: string): number | null {
    return null;
  }

  calcIndemLicenciement(
    yearsExact: number,
    avg12: number,
    isEco = false,
  ): { montant: number; detail: string } {
    const paliers = isEco
      ? this.baremeLicenciement.palierEconomique!
      : this.baremeLicenciement.paliers;
    let montant = 0;
    const lignes: string[] = [];
    for (const p of paliers) {
      if (yearsExact <= p.anneeMin) break;
      const n = Math.min(yearsExact, p.anneeMax) - p.anneeMin;
      if (n <= 0) continue;
      const c = avg12 * p.valeur * n;
      montant += c;
      lignes.push(
        `${n.toFixed(2)}a × ${(p.valeur * 100).toFixed(0)}% × ${_fmt(avg12)} = ${_fmt(c)}`,
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
    if (yearsExact < 5) return { montant: 0, detail: 'Ancienneté < 5 ans' };
    let mois = 8;
    if (yearsExact >= 20) mois = 8 + Math.floor((yearsExact - 20) / 2);
    else if (yearsExact >= 15) mois = 8;
    else if (yearsExact >= 10) mois = 6;
    else mois = 4;
    const montant = Math.round(avg12 * mois);
    return {
      montant,
      detail: `${mois} mois × ${_fmt(avg12)} = ${_fmt(montant)} FCFA`,
    };
  }

  calcIndemDeces(
    yearsExact: number,
    avg12: number,
  ): { montant: number; detail: string } {
    if (yearsExact * 12 < 24)
      return { montant: 0, detail: 'Ancienneté < 2 ans' };
    return this.calcIndemLicenciement(yearsExact, avg12);
  }
}

// ============================================================================
// pharmacie.convention.ts
// ============================================================================
export class PharmacieConvention implements IConvention {
  code = 'PHARMACIE';
  nom = 'Convention Collective Officines de Pharmacies';
  secteurs = ['pharmacie', 'parapharmacie', 'officine'];

  baremeLicenciement: ConventionBaremeLicenciement = {
    format: 'POURCENTAGE',
    seuilMoisAnciennete: 24,
    paliers: [
      { anneeMin: 0, anneeMax: 5, valeur: 0.32 },
      { anneeMin: 5, anneeMax: 10, valeur: 0.38 },
      { anneeMin: 10, anneeMax: 999, valeur: 0.44 },
    ],
    palierEconomique: [{ anneeMin: 0, anneeMax: 999, valeur: 0.24 }],
    seuilMoisEconomique: 12,
    baseCalcul: 'avg12',
    fractionsMinJours: 30,
  };

  baremeRetraite: ConventionBaremeRetraite = {
    paliers: [
      { anneeMin: 0, anneeMax: 10, moisSalaire: 4 },
      { anneeMin: 10, anneeMax: 15, moisSalaire: 5 },
      { anneeMin: 15, anneeMax: 999, moisSalaire: 6 },
    ],
    baseCalcul: 'base', // ⚠️ salaire de base, pas avg12
  };

  preavis: ConventionPreavis = {
    dureeParCategorie: {
      1: 30,
      2: 30,
      3: 30,
      4: 30,
      5: 60,
      6: 60,
      7: 60,
      8: 90,
      9: 90,
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

  grilleSalariale: GrilleSalariale = { categories: {} };

  getPreavisDays(cat: number): number {
    return this.preavis.dureeParCategorie[cat] ?? this.preavis.dureeDefaut;
  }
  getSalaireMinimum(_c: number): number {
    return 70000;
  }
  getCategorieFromPoste(_p: string): number | null {
    return null;
  }

  calcIndemLicenciement(
    yearsExact: number,
    avg12: number,
    isEco = false,
  ): { montant: number; detail: string } {
    const paliers = isEco
      ? this.baremeLicenciement.palierEconomique!
      : this.baremeLicenciement.paliers;
    let montant = 0;
    const lignes: string[] = [];
    for (const p of paliers) {
      if (yearsExact <= p.anneeMin) break;
      const n = Math.min(yearsExact, p.anneeMax) - p.anneeMin;
      if (n <= 0) continue;
      const c = avg12 * p.valeur * n;
      montant += c;
      lignes.push(
        `${n.toFixed(2)}a × ${(p.valeur * 100).toFixed(0)}% × ${_fmt(avg12)} = ${_fmt(c)}`,
      );
    }
    return {
      montant: Math.round(montant),
      detail: lignes.join(' + ') + ` = ${_fmt(montant)} FCFA`,
    };
  }

  calcIndemRetraite(
    _yearsExact: number,
    _avg12: number,
    _cat?: string,
    salaireBase?: number,
  ): { montant: number; detail: string } {
    const base = salaireBase ?? _avg12;
    const p =
      this.baremeRetraite.paliers.find(
        (x) => _yearsExact >= x.anneeMin && _yearsExact < x.anneeMax,
      ) ?? this.baremeRetraite.paliers.at(-1)!;
    const montant = Math.round(base * p.moisSalaire);
    return {
      montant,
      detail: `${p.moisSalaire} mois × salaire de base (${_fmt(base)}) = ${_fmt(montant)} FCFA`,
    };
  }

  calcIndemDeces(
    yearsExact: number,
    avg12: number,
  ): { montant: number; detail: string } {
    if (yearsExact * 12 < 12)
      return { montant: 0, detail: 'Ancienneté < 1 an' };
    return this.calcIndemLicenciement(yearsExact, avg12);
  }
}

// ============================================================================
// transport.convention.ts — Barème FORFAITAIRE par tranche
// ============================================================================
export class TransportConvention implements IConvention {
  code = 'TRANSPORT';
  nom = 'Convention Collective Auxiliaires de Transport';
  secteurs = ['transport', 'logistique', 'fret', 'manutention'];

  baremeLicenciement: ConventionBaremeLicenciement = {
    format: 'FORFAIT',
    seuilMoisAnciennete: 12,
    // Pour le transport, paliers = montants forfaitaires par TRANCHE (pas × années)
    // valeur = nombre de mois de salaire brut total pour la tranche
    paliers: [
      { anneeMin: 1, anneeMax: 3, valeur: 2 },
      { anneeMin: 3, anneeMax: 5, valeur: 3 },
      { anneeMin: 5, anneeMax: 10, valeur: 4 },
      { anneeMin: 10, anneeMax: 999, valeur: 6 },
    ],
    palierEconomique: [
      { anneeMin: 1, anneeMax: 3, valeur: 2 },
      { anneeMin: 3, anneeMax: 6, valeur: 4 },
      { anneeMin: 6, anneeMax: 9, valeur: 5 },
      { anneeMin: 9, anneeMax: 12, valeur: 8 },
      { anneeMin: 12, anneeMax: 999, valeur: 10 },
    ],
    baseCalcul: 'avg12',
    fractionsMinJours: 30,
  };

  baremeRetraite: ConventionBaremeRetraite = {
    paliers: [
      {
        anneeMin: 0,
        anneeMax: 999,
        moisSalaire: 0,
        parCategorie: { execution: 11, maitrise: 9, cadre: 5 },
      },
    ],
    baseCalcul: 'avg12',
    primeSpeciale: { execution: 500000, maitrise: 550000, cadre: 600000 },
  };

  preavis: ConventionPreavis = {
    dureeParCategorie: {
      1: 30,
      2: 30,
      3: 30,
      4: 30,
      5: 30,
      6: 30,
      7: 60,
      8: 60,
      9: 90,
      10: 90,
    },
    dureeDefaut: 90,
    uniteJours: 'calendaires',
    doubleementSiRupturePendantConge: true,
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

  grilleSalariale: GrilleSalariale = { categories: {} };

  getPreavisDays(cat: number): number {
    return this.preavis.dureeParCategorie[cat] ?? this.preavis.dureeDefaut;
  }
  getSalaireMinimum(_c: number): number {
    return 70000;
  }
  getCategorieFromPoste(_p: string): number | null {
    return null;
  }

  calcIndemLicenciement(
    yearsExact: number,
    avg12: number,
    isEco = false,
  ): { montant: number; detail: string } {
    // Transport : montant forfaitaire basé sur la tranche (pas × années)
    const paliers = isEco
      ? this.baremeLicenciement.palierEconomique!
      : this.baremeLicenciement.paliers;
    const palier = [...paliers].reverse().find((p) => yearsExact >= p.anneeMin);
    if (!palier) return { montant: 0, detail: 'Ancienneté insuffisante' };

    const montantBase = Math.round(avg12 * palier.valeur);

    // Majoration 25% du salaire de base par année au-delà du min de tranche (motif personnel)
    let majoration = 0;
    if (!isEco) {
      const anneesAuDela = Math.max(0, yearsExact - palier.anneeMin);
      majoration = Math.round(avg12 * 0.25 * anneesAuDela);
    }

    const montant = montantBase + majoration;
    const detail = isEco
      ? `${palier.valeur} mois forfait × ${_fmt(avg12)} = ${_fmt(montantBase)} FCFA`
      : `${palier.valeur} mois × ${_fmt(avg12)} = ${_fmt(montantBase)} + maj. 25%/an (${_fmt(majoration)}) = ${_fmt(montant)} FCFA`;

    return { montant, detail };
  }

  calcIndemRetraite(
    yearsExact: number,
    avg12: number,
    categorieLabel = 'execution',
  ): { montant: number; detail: string } {
    const cat = categorieLabel.toLowerCase();
    const mois = this.baremeRetraite.paliers[0].parCategorie?.[cat] ?? 5;
    const prime = this.baremeRetraite.primeSpeciale?.[cat] ?? 0;
    const montant = Math.round(avg12 * mois) + prime;
    return {
      montant,
      detail: `${mois} mois × ${_fmt(avg12)} + prime ${_fmt(prime)} = ${_fmt(montant)} FCFA`,
    };
  }

  calcIndemDeces(
    yearsExact: number,
    avg12: number,
  ): { montant: number; detail: string } {
    const forfait = 1_300_000;
    const lic =
      yearsExact * 12 >= 12
        ? this.calcIndemLicenciement(yearsExact, avg12, true).montant
        : 0;
    return {
      montant: forfait + lic,
      detail: `Forfait obsèques ${_fmt(forfait)} + indemnité éco (${_fmt(lic)}) = ${_fmt(forfait + lic)} FCFA`,
    };
  }
}

// ============================================================================
// presse.convention.ts — Barème MOIS_PAR_AN avec plafond
// ============================================================================
export class PresseConvention implements IConvention {
  code = 'PRESSE';
  nom =
    "Convention Collective Personnel de l'Information et de la Communication";
  secteurs = [
    'presse',
    'médias',
    'journalisme',
    'communication',
    'audiovisuel',
  ];

  baremeLicenciement: ConventionBaremeLicenciement = {
    format: 'MOIS_PAR_AN',
    seuilMoisAnciennete: 0,
    paliers: [
      { anneeMin: 0, anneeMax: 5, valeur: 1.0 },
      { anneeMin: 5, anneeMax: 10, valeur: 1.5 },
      { anneeMin: 10, anneeMax: 15, valeur: 2.0 },
      { anneeMin: 15, anneeMax: 20, valeur: 2.5 },
      { anneeMin: 20, anneeMax: 999, valeur: 3.0 },
    ],
    baseCalcul: 'avg12',
    fractionsMinJours: 0,
    plafondMois: 33,
  };

  baremeRetraite: ConventionBaremeRetraite = {
    paliers: [{ anneeMin: 0, anneeMax: 999, moisSalaire: 6 }],
    baseCalcul: 'base_anciennete',
  };

  preavis: ConventionPreavis = {
    dureeParCategorie: {
      1: 30,
      2: 30,
      3: 30,
      4: 30,
      5: 60,
      6: 60,
      7: 60,
      8: 90,
      9: 90,
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
    ancienneteMinMois: 0,
    type: 'PROGRESSIF',
    paliers: [
      { anneeMin: 0, anneeMax: 1, moisSalaire: 2 },
      { anneeMin: 1, anneeMax: 5, moisSalaire: 3 },
      { anneeMin: 5, anneeMax: 15, moisSalaire: 4 },
      { anneeMin: 15, anneeMax: 20, moisSalaire: 5 },
      { anneeMin: 20, anneeMax: 999, moisSalaire: 6 },
    ],
    majorationJoursParEnfant: 15,
  };

  grilleSalariale: GrilleSalariale = { categories: {} };

  getPreavisDays(cat: number): number {
    return this.preavis.dureeParCategorie[cat] ?? this.preavis.dureeDefaut;
  }
  getSalaireMinimum(_c: number): number {
    return 70000;
  }
  getCategorieFromPoste(_p: string): number | null {
    return null;
  }

  calcIndemLicenciement(
    yearsExact: number,
    avg12: number,
  ): { montant: number; detail: string } {
    let montant = 0;
    const lignes: string[] = [];
    for (const p of this.baremeLicenciement.paliers) {
      if (yearsExact <= p.anneeMin) break;
      const n = Math.min(yearsExact, p.anneeMax) - p.anneeMin;
      if (n <= 0) continue;
      const c = avg12 * p.valeur * n;
      montant += c;
      lignes.push(
        `${n.toFixed(2)}a × ${p.valeur} mois × ${_fmt(avg12)} = ${_fmt(c)}`,
      );
    }
    // Plafond 33 mois
    const plafond = avg12 * 33;
    if (montant > plafond) {
      return {
        montant: Math.round(plafond),
        detail: `Plafonné à 33 mois : ${_fmt(plafond)} FCFA (calculé : ${_fmt(montant)})`,
      };
    }
    return {
      montant: Math.round(montant),
      detail: lignes.join(' + ') + ` = ${_fmt(montant)} FCFA`,
    };
  }

  calcIndemRetraite(
    _yearsExact: number,
    avg12: number,
  ): { montant: number; detail: string } {
    const montant = Math.round(avg12 * 6);
    return {
      montant,
      detail: `6 mois (base + ancienneté) × ${_fmt(avg12)} = ${_fmt(montant)} FCFA`,
    };
  }

  calcIndemDeces(
    yearsExact: number,
    avg12: number,
    nbEnfants = 0,
  ): { montant: number; detail: string } {
    const p =
      this.decesConfig.paliers?.find(
        (x) => yearsExact >= x.anneeMin && yearsExact < x.anneeMax,
      ) ?? this.decesConfig.paliers?.at(-1)!;
    const majorationJours =
      (this.decesConfig.majorationJoursParEnfant ?? 0) * nbEnfants;
    const mois = p.moisSalaire;
    const bonus = Math.round((avg12 / 30) * majorationJours);
    const montant = Math.round(avg12 * mois) + bonus;
    return {
      montant,
      detail: `${mois} mois × ${_fmt(avg12)} + ${majorationJours}j enfants (${_fmt(bonus)}) = ${_fmt(montant)} FCFA`,
    };
  }
}

// ============================================================================
// ntic.convention.ts — Barème MOIS_PAR_AN avec plafond 36 mois
// ============================================================================
export class NTICConvention implements IConvention {
  code = 'NTIC';
  nom = 'Convention Collective NTIC';
  secteurs = [
    'informatique',
    'télécommunications',
    'numérique',
    'tech',
    'NTIC',
  ];

  baremeLicenciement: ConventionBaremeLicenciement = {
    format: 'MOIS_PAR_AN',
    seuilMoisAnciennete: 0,
    paliers: [
      { anneeMin: 0, anneeMax: 3, valeur: 1.0 },
      { anneeMin: 3, anneeMax: 10, valeur: 1.5 },
      { anneeMin: 10, anneeMax: 15, valeur: 2.0 },
      { anneeMin: 15, anneeMax: 999, valeur: 2.5 },
    ],
    baseCalcul: 'avg12',
    fractionsMinJours: 0,
    plafondMois: 36,
  };

  baremeRetraite: ConventionBaremeRetraite = {
    paliers: [],
    paliersPourcent: [
      { anneeMin: 5, anneeMax: 10, pourcent: 0.1 },
      { anneeMin: 10, anneeMax: 20, pourcent: 0.2 },
      { anneeMin: 20, anneeMax: 30, pourcent: 0.4 },
      { anneeMin: 30, anneeMax: 999, pourcent: 0.6 },
    ],
    baseCalcul: 'annuel', // % du salaire annuel brut
  };

  preavis: ConventionPreavis = {
    dureeParCategorie: {
      1: 30,
      2: 30,
      3: 30,
      4: 30,
      5: 60,
      6: 60,
      7: 60,
      8: 90,
      9: 90,
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
    ancienneteMinMois: 0,
    type: 'PROGRESSIF',
    paliers: [
      { anneeMin: 0, anneeMax: 5, moisSalaire: 4 },
      { anneeMin: 5, anneeMax: 15, moisSalaire: 10 },
      { anneeMin: 15, anneeMax: 20, moisSalaire: 12 },
      { anneeMin: 20, anneeMax: 999, moisSalaire: 15 },
    ],
  };

  grilleSalariale: GrilleSalariale = { categories: {} };

  getPreavisDays(cat: number): number {
    return this.preavis.dureeParCategorie[cat] ?? this.preavis.dureeDefaut;
  }
  getSalaireMinimum(_c: number): number {
    return 70000;
  }
  getCategorieFromPoste(_p: string): number | null {
    return null;
  }

  calcIndemLicenciement(
    yearsExact: number,
    avg12: number,
  ): { montant: number; detail: string } {
    let montant = 0;
    const lignes: string[] = [];
    for (const p of this.baremeLicenciement.paliers) {
      if (yearsExact <= p.anneeMin) break;
      const n = Math.min(yearsExact, p.anneeMax) - p.anneeMin;
      if (n <= 0) continue;
      const c = avg12 * p.valeur * n;
      montant += c;
      lignes.push(
        `${n.toFixed(2)}a × ${p.valeur} mois × ${_fmt(avg12)} = ${_fmt(c)}`,
      );
    }
    const plafond = avg12 * 36;
    if (montant > plafond)
      return {
        montant: Math.round(plafond),
        detail: `Plafonné 36 mois : ${_fmt(plafond)} FCFA`,
      };
    return {
      montant: Math.round(montant),
      detail: lignes.join(' + ') + ` = ${_fmt(montant)} FCFA`,
    };
  }

  calcIndemRetraite(
    yearsExact: number,
    avg12: number,
  ): { montant: number; detail: string } {
    const p =
      this.baremeRetraite.paliersPourcent?.find(
        (x) => yearsExact >= x.anneeMin && yearsExact < x.anneeMax,
      ) ?? this.baremeRetraite.paliersPourcent?.at(-1);
    if (!p) return { montant: 0, detail: 'Ancienneté < 5 ans' };
    const salAnnuel = avg12 * 12;
    const montant = Math.round(salAnnuel * p.pourcent);
    return {
      montant,
      detail: `${(p.pourcent * 100).toFixed(0)}% × salaire annuel (${_fmt(salAnnuel)}) = ${_fmt(montant)} FCFA`,
    };
  }

  calcIndemDeces(
    yearsExact: number,
    avg12: number,
  ): { montant: number; detail: string } {
    const p =
      this.decesConfig.paliers?.find(
        (x) => yearsExact >= x.anneeMin && yearsExact < x.anneeMax,
      ) ?? this.decesConfig.paliers?.at(-1)!;
    const montant = Math.round(avg12 * p.moisSalaire);
    return {
      montant,
      detail: `${p.moisSalaire} mois × ${_fmt(avg12)} = ${_fmt(montant)} FCFA`,
    };
  }
}
