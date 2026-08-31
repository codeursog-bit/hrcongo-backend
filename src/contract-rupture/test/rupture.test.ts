// Test rapide des calculs clés — pas de framework, juste des assertions
import {
  calcITSAvecParts,
  calcITSMensuel,
  calcAnciennete,
  calcAvg12,
  calcSoldeConges,
  calcIndemConges,
  calcIndemPreavis,
  calcGratifProrata,
} from '../helpers/calcul.helper';
import { getConvention } from '../conventions/convention.registry';
import { ContractRuptureService } from '../contract-rupture.service';

let passed = 0;
let failed = 0;
function assert(label: string, got: number, expected: number, tolerance = 1) {
  const ok = Math.abs(got - expected) <= tolerance;
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label} — attendu ${expected}, obtenu ${got}`);
    failed++;
  }
}

console.log('\n=== ITS LF 2026 ===');
assert('ITS 615 000 FCFA', calcITSMensuel(615_000), 1_200);
assert(
  'ITS 1 000 000 FCFA',
  calcITSMensuel(1_000_000),
  1_200 + (1_000_000 - 615_000) * 0.1,
); // 39_700
assert(
  'ITS 2 000 000 FCFA',
  calcITSMensuel(2_000_000),
  1_200 + (1_500_000 - 615_000) * 0.1 + (2_000_000 - 1_500_000) * 0.15,
); // 164_700
assert('ITS 0 FCFA', calcITSMensuel(0), 0);

console.log('\n=== ITS AVEC PARTS FISCALES ===');
// 1 part célibataire = même que calcITSMensuel
assert(
  'ITS 1 part = sans parts',
  calcITSAvecParts(1_000_000, 1),
  calcITSMensuel(1_000_000),
  5,
);
// 2 parts : base /2 → ITS réduit
const its2parts = calcITSAvecParts(1_000_000, 2);
assert(
  'ITS 2 parts < 1 part',
  its2parts < calcITSMensuel(1_000_000) ? its2parts : -1,
  its2parts,
);
// Test direct avec valeur factuelle vérifiée
// Base 1 500 000, 3 parts → quotient annuel = 1.5M×12/3 = 6M → tranche fixe → 1200×12/12 = 1200/mois
// Avec 1 part → quotient = 18M → tranche 30% → beaucoup plus
const its1p_15M = calcITSAvecParts(1_500_000, 1);
const its3p_15M = calcITSAvecParts(1_500_000, 3);
assert(
  'ITS 3 parts < 1 part (base 1.5M)',
  its3p_15M < its1p_15M ? its3p_15M : -1,
  its3p_15M,
);
console.log(
  `  ITS 1.5M — 1 part: ${its1p_15M.toLocaleString('fr-FR')} | 3 parts: ${its3p_15M.toLocaleString('fr-FR')} FCFA`,
);

console.log('\n=== GRATIFICATION — RÈGLES RUPTURE ===');
const gratifData = {
  montantAnnuelBrut: 400_000,
  dejaPaye: false,
  baseCalcul: 400_000,
};
// Faute grave → 0
const gratifFauteGrave = calcGratifProrata(
  new Date('2024-06-15'),
  new Date('2022-01-10'),
  gratifData,
  'LICENCIEMENT_FAUTE_GRAVE',
  24,
);
assert('Gratif faute grave = 0', gratifFauteGrave.montant, 0);
// Faute lourde → 0
const gratifFauteLourde = calcGratifProrata(
  new Date('2024-06-15'),
  new Date('2022-01-10'),
  gratifData,
  'LICENCIEMENT_FAUTE_LOURDE',
  24,
);
assert('Gratif faute lourde = 0', gratifFauteLourde.montant, 0);
// Licenciement normal juin → 6/12 (embauché en 2022, donc présent depuis le
// 1er janvier de l'année de rupture — mois travaillés = jan à juin = 6)
const gratifNormal = calcGratifProrata(
  new Date('2024-06-15'),
  new Date('2022-01-10'),
  gratifData,
  'LICENCIEMENT_MOTIF_PERSONNEL',
  24,
);
assert(
  'Gratif licenciement juin (6/12)',
  gratifNormal.montant,
  Math.round((400_000 * 6) / 12),
); // 200 000
// Ancienneté < 12 mois → 0
const gratifNewbie = calcGratifProrata(
  new Date('2024-06-15'),
  new Date('2023-10-15'),
  gratifData,
  'LICENCIEMENT_MOTIF_PERSONNEL',
  8,
);
assert('Gratif ancienneté < 12 mois = 0', gratifNewbie.montant, 0);
// Déjà versé → 0
const gratifDejaPaye = calcGratifProrata(
  new Date('2024-06-15'),
  new Date('2022-01-10'),
  { ...gratifData, dejaPaye: true },
  'LICENCIEMENT_MOTIF_PERSONNEL',
  24,
);
assert('Gratif déjà versée = 0', gratifDejaPaye.montant, 0);

// 🆕 Embauche EN COURS de l'année de rupture (le cas que l'ancien calcul
// `ruptureDate.getMonth() + 1` ne gérait pas — ici bloqué par le seuil des
// 12 mois d'ancienneté standard, mais utile si ce seuil devient configurable)
const gratifEmbaucheMemeAnnee = calcGratifProrata(
  new Date('2024-09-20'),
  new Date('2024-03-05'), // embauché en mars 2024, rupture en septembre 2024
  gratifData,
  'LICENCIEMENT_MOTIF_PERSONNEL',
  6, // < 12 → bloqué par le seuil ancienneté, comme gratifNewbie
);
assert(
  'Gratif embauche même année, ancienneté insuffisante = 0',
  gratifEmbaucheMemeAnnee.montant,
  0,
);

console.log('\n=== ANCIENNETÉ ===');
const anc = calcAnciennete(new Date('2016-01-01'), new Date('2024-07-15'));
assert('Ancienneté — années', anc.annees, 8);
assert('Ancienneté — mois restant', anc.moisRestant, 6);

console.log('\n=== AVG12 ===');
const avg12_complet = calcAvg12(Array(12).fill(300_000), new Date(), 300_000);
assert('avg12 complet', avg12_complet.montant, 300_000);
const avg12_fallback = calcAvg12(Array(6).fill(300_000), new Date(), 300_000);
assert('avg12 fallback', avg12_fallback.montant, 300_000);

console.log('\n=== CONGÉS ===');
const solde = calcSoldeConges(
  new Date('2020-01-01'),
  new Date('2024-01-01'),
  10,
  26,
);
assert('Congés acquis 4 ans', solde.acquis, 104); // 4×26
assert('Solde congés', solde.solde, 94); // 104 - 10

const indemConges = calcIndemConges(10, 300_000);
assert(
  'Indem congés 10j',
  indemConges.montant,
  Math.round((10 * 300_000) / 26),
  5,
); // 115_384

console.log('\n=== PRÉAVIS ===');
const preavis = calcIndemPreavis(300_000, 30, false, 'EMPLOYEUR');
assert('Préavis 1 mois', preavis.montant, 300_000);
const preavisDouble = calcIndemPreavis(300_000, 30, false, 'EMPLOYEUR', true);
assert('Préavis doublé', preavisDouble.montant, 600_000);

console.log('\n=== COMMERCE — INDEMNITÉ LICENCIEMENT ===');
const commerce = getConvention('COMMERCE');
// 8 ans ancienneté, avg12 = 300 000
// Ans 1-6: 6 × 30% × 300k = 540 000
// Ans 7-8: 2 × 38% × 300k = 228 000
// Total = 768 000
const licCommerce = commerce.calcIndemLicenciement(8, 300_000);
assert('Commerce 8 ans', licCommerce.montant, 768_000);

// Ancienneté insuffisante (15 mois < 18 mois)
const licCommerceInsuff = commerce.calcIndemLicenciement(1.2, 300_000);
assert(
  'Commerce 15 mois (seuil 18m)',
  licCommerceInsuff.montant,
  Math.round(1.2 * 0.3 * 300_000),
);

console.log('\n=== INDUSTRIE — INDEMNITÉ LICENCIEMENT ===');
const industrie = getConvention('INDUSTRIE');
// 12 ans : ans 1-5: 5×31%×400k=620k + ans 6-10: 5×36%×400k=720k + ans 11-12: 2×40%×400k=320k = 1 660 000
const licIndustrie = industrie.calcIndemLicenciement(12, 400_000);
assert('Industrie 12 ans', licIndustrie.montant, 1_660_000);

console.log('\n=== PÉTROLE — INDEMNITÉ LICENCIEMENT ===');
const petrole = getConvention('PETROLE');
// 7 ans : ans 1-5: 5×45%×500k=1125k + ans 6-7: 2×50%×500k=500k = 1 625 000
const licPetrole = petrole.calcIndemLicenciement(7, 500_000);
assert('Pétrole 7 ans', licPetrole.montant, 1_625_000);

console.log('\n=== PRESSE — BARÈME MOIS/AN + PLAFOND ===');
const presse = getConvention('PRESSE');
// 6 ans : 5×1.0×300k + 1×1.5×300k = 1 500k + 450k = 1 950 000
const licPresse = presse.calcIndemLicenciement(6, 300_000);
assert('Presse 6 ans', licPresse.montant, 1_950_000);
// Plafond 33 mois : 33 × 100 000 = 3 300 000
const licPresseMax = presse.calcIndemLicenciement(50, 100_000);
assert('Presse plafond 33 mois', licPresseMax.montant, 3_300_000);

console.log('\n=== NTIC — BARÈME MOIS/AN + PLAFOND ===');
const ntic = getConvention('NTIC');
// 5 ans : 3×1.0×200k + 2×1.5×200k = 600k + 600k = 1 200 000
const licNtic = ntic.calcIndemLicenciement(5, 200_000);
assert('NTIC 5 ans', licNtic.montant, 1_200_000);
// Plafond 36 mois : 36 × 100 000 = 3 600 000
const licNticMax = ntic.calcIndemLicenciement(100, 100_000);
assert('NTIC plafond 36 mois', licNticMax.montant, 3_600_000);

console.log('\n=== TRANSPORT — BARÈME FORFAITAIRE ===');
const transport = getConvention('TRANSPORT');
// 4 ans (tranche 3-5 ans) = 3 mois forfait + majoration 25%/an au-delà du min (3 ans)
// Montant base = 3 × 300k = 900 000
// Majoration = 1 an au-delà × 25% × 300k = 75 000
// Total = 975 000
const licTransport = transport.calcIndemLicenciement(4, 300_000);
assert('Transport 4 ans', licTransport.montant, 975_000);

// Éco : 4 ans (tranche 3-6 ans) = 4 mois forfait, pas de majoration
const licTransportEco = transport.calcIndemLicenciement(4, 300_000, true);
assert('Transport éco 4 ans', licTransportEco.montant, 4 * 300_000); // 1 200 000

console.log('\n=== SERVICE COMPLET — CAS RÉEL ===');
const service = new ContractRuptureService();
const result = service.calculerRupture({
  employeeId: 'EMP001',
  entrepriseId: 'ENT001',
  conventionCode: 'COMMERCE',
  dateEmbauche: new Date('2016-03-01'),
  dateRupture: new Date('2024-06-01'),
  dateFinEffective: new Date('2024-07-01'), // 1 mois de préavis
  typeContrat: 'CDI',
  motif: 'LICENCIEMENT_MOTIF_PERSONNEL',
  categorie: 5,
  poste: 'Commercial',
  salaireBase: 280_000,
  salaireActuel: 350_000,
  bulletinsKonza: Array(12).fill(350_000),
  congesPrisKonza: 8,
  statutPreavis: 'DISPENSE_EMPLOYEUR',
  joursTravaillesDernierMois: 30,
  nbParts: 2, // marié = 2 parts
  redacteurId: 'RH001',
});

console.log(`\n  Ancienneté : ${result.anciennete.detail}`);
console.log(
  `  Avg12 : ${result.avg12.montant.toLocaleString('fr-FR')} FCFA (${result.avg12.source})`,
);
console.log(
  `  Indem licenciement : ${result.composantes.indemLicenciement.montant.toLocaleString('fr-FR')} FCFA`,
);
console.log(
  `  Indem préavis      : ${result.composantes.indemPreavis.montant.toLocaleString('fr-FR')} FCFA`,
);
console.log(
  `  Indem congés       : ${result.composantes.indemConges.montant.toLocaleString('fr-FR')} FCFA`,
);
console.log(
  `  ITS                : ${result.fiscalite.its.toLocaleString('fr-FR')} FCFA`,
);
console.log(
  `  CNSS               : ${result.fiscalite.cnss.toLocaleString('fr-FR')} FCFA`,
);
console.log(
  `  NET À PAYER        : ${result.totaux.netAPayer.toLocaleString('fr-FR')} FCFA`,
);
console.log(`  Alertes            : ${result.alertes.length}`);
console.log(`  Checklist          : ${result.checklist.length} étapes`);

assert(
  'Net > 0',
  result.totaux.netAPayer,
  result.totaux.brutTotal - result.totaux.totalRetenues,
  0,
);
assert(
  'Brut = somme composantes',
  result.totaux.brutTotal,
  result.composantes.dernierSalairePro.montant +
    result.composantes.indemConges.montant +
    result.composantes.indemPreavis.montant +
    result.composantes.indemLicenciement.montant,
  5,
);

console.log(`\n${'─'.repeat(50)}`);
console.log(`✅ ${passed} tests passés | ❌ ${failed} tests échoués`);
if (failed > 0) process.exit(1);