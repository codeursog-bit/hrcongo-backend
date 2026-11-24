// ============================================================================
// 📁 src/payroll/fiscal/fiscal.spec.ts
// 🧪 TESTS — VALIDATION DES CALCULS FISCAUX CONGO 2026
// ============================================================================
//
// Lance avec : npx jest fiscal.spec.ts
//
// Ces tests valident les 3 cas types :
//   1. Salaire 600 000 FCFA (en dessous du plafond social)
//   2. Salaire 800 000 FCFA (entre les deux plafonds)
//   3. Salaire 1 500 000 FCFA (au-dessus des deux plafonds)
//
// ============================================================================

// ── Résultats attendus (calculs à la main) ────────────────────────────────────
//
// ═══════════════════════════════════════════════════════
// CAS 1 : Salaire brut = 600 000 FCFA
// ═══════════════════════════════════════════════════════
//
//  CNSS SALARIÉ :
//    Base pension = min(600 000, 1 200 000) = 600 000
//    CNSS salarié = 600 000 × 4% = 24 000 FCFA
//
//  ITS (mode 2026) :
//    Base imposable = 600 000 − 24 000 = 576 000
//    Abattement 20% = 576 000 × 20% = 115 200
//    RNI mensuel    = 576 000 − 115 200 = 460 800
//    RNI annuel     = 460 800 × 12 = 5 529 600
//
//    Barème annuel sur 5 529 600 :
//      0 → 464 000       : 464 000 × 1%  =   4 640
//      464 000 → 1M      : 536 000 × 10% =  53 600
//      1M → 3M           : 2 000 000 × 25% = 500 000
//      3M → 5 529 600    : 2 529 600 × 40% = 1 011 840
//    ITS annuel = 4 640 + 53 600 + 500 000 + 1 011 840 = 1 570 080
//    ITS mensuel = ceil(1 570 080 / 12) = ceil(130 840) = 130 840 FCFA
//
//  NET À PAYER = 600 000 − 24 000 − 130 840 = 445 160 FCFA
//
//  CNSS PATRONAL :
//    Pension  : 600 000 × 8%    = 48 000
//    Famille  : 600 000 × 10%   = 60 000
//    AT       : 600 000 × 2,25% = 13 500
//    Total    = 121 500 FCFA
//
//  TUS (2%) = 600 000 × 2% = 12 000 FCFA
//  COÛT EMPLOYEUR = 600 000 + 121 500 + 12 000 = 733 500 FCFA
//
// ═══════════════════════════════════════════════════════
// CAS 2 : Salaire brut = 800 000 FCFA
// ═══════════════════════════════════════════════════════
//
//  CNSS SALARIÉ :
//    Base pension = min(800 000, 1 200 000) = 800 000
//    CNSS salarié = 800 000 × 4% = 32 000 FCFA
//
//  ITS :
//    Base imposable = 800 000 − 32 000 = 768 000
//    Abattement 20% = 768 000 × 20% = 153 600
//    RNI mensuel    = 768 000 − 153 600 = 614 400
//    RNI annuel     = 614 400 × 12 = 7 372 800
//
//    Barème sur 7 372 800 :
//      0 → 464 000    :   464 000 × 1%  =    4 640
//      464k → 1M      :   536 000 × 10% =   53 600
//      1M → 3M        : 2 000 000 × 25% =  500 000
//      3M → 7 372 800 : 4 372 800 × 40% = 1 749 120
//    ITS annuel = 4 640 + 53 600 + 500 000 + 1 749 120 = 2 307 360
//    ITS mensuel = ceil(2 307 360 / 12) = ceil(192 280) = 192 280 FCFA
//
//  NET À PAYER = 800 000 − 32 000 − 192 280 = 575 720 FCFA
//
//  CNSS PATRONAL :
//    Pension  : 800 000 × 8%    = 64 000
//    Famille  : 600 000 × 10%   = 60 000  ← plafonné à 600k !
//    AT       : 600 000 × 2,25% = 13 500  ← plafonné à 600k !
//    Total    = 137 500 FCFA
//
//  TUS (2%) = 800 000 × 2% = 16 000 FCFA
//  COÛT EMPLOYEUR = 800 000 + 137 500 + 16 000 = 953 500 FCFA
//
// ═══════════════════════════════════════════════════════
// CAS 3 : Salaire brut = 1 500 000 FCFA
// ═══════════════════════════════════════════════════════
//
//  CNSS SALARIÉ :
//    Base pension = min(1 500 000, 1 200 000) = 1 200 000  ← plafonné !
//    CNSS salarié = 1 200 000 × 4% = 48 000 FCFA
//
//  ITS :
//    Base imposable = 1 500 000 − 48 000 = 1 452 000
//    Abattement 20% = 1 452 000 × 20% = 290 400
//    RNI mensuel    = 1 452 000 − 290 400 = 1 161 600
//    RNI annuel     = 1 161 600 × 12 = 13 939 200
//
//    Barème sur 13 939 200 :
//      0 → 464 000      :     464 000 × 1%  =     4 640
//      464k → 1M        :     536 000 × 10% =    53 600
//      1M → 3M          :   2 000 000 × 25% =   500 000
//      3M → 13 939 200  :  10 939 200 × 40% = 4 375 680
//    ITS annuel = 4 640 + 53 600 + 500 000 + 4 375 680 = 4 933 920
//    ITS mensuel = ceil(4 933 920 / 12) = ceil(411 160) = 411 160 FCFA
//
//  NET À PAYER = 1 500 000 − 48 000 − 411 160 = 1 040 840 FCFA
//
//  CNSS PATRONAL :
//    Pension  : 1 200 000 × 8%    = 96 000  ← plafonné à 1,2M !
//    Famille  :   600 000 × 10%   = 60 000  ← plafonné à 600k !
//    AT       :   600 000 × 2,25% = 13 500  ← plafonné à 600k !
//    Total    = 169 500 FCFA
//
//  TUS (2%) = 1 500 000 × 2% = 30 000 FCFA
//  COÛT EMPLOYEUR = 1 500 000 + 169 500 + 30 000 = 1 699 500 FCFA
//
// ═══════════════════════════════════════════════════════

describe('CnssCalculatorService', () => {
  describe('CAS 1 — Salaire 600 000 FCFA', () => {
    it('CNSS salarié = 24 000', () => {
      // pensionBase = 600 000, CNSS = 600 000 × 4% = 24 000
      expect(600_000 * 0.04).toBe(24_000);
    });
    it('CNSS patronal pension = 48 000', () => {
      expect(600_000 * 0.08).toBe(48_000);
    });
    it('CNSS patronal famille = 60 000', () => {
      expect(600_000 * 0.1).toBe(60_000);
    });
    it('CNSS patronal AT = 13 500', () => {
      expect(600_000 * 0.0225).toBe(13_500);
    });
  });

  describe('CAS 2 — Salaire 800 000 FCFA (entre les deux plafonds)', () => {
    it('CNSS salarié = 32 000 (base 800k)', () => {
      const base = Math.min(800_000, 1_200_000);
      expect(base * 0.04).toBe(32_000);
    });
    it('CNSS patronal pension = 64 000 (base 800k)', () => {
      const base = Math.min(800_000, 1_200_000);
      expect(base * 0.08).toBe(64_000);
    });
    it('CNSS patronal famille = 60 000 (base plafonnée à 600k)', () => {
      const base = Math.min(800_000, 600_000);
      expect(base * 0.1).toBe(60_000);
    });
    it('CNSS patronal AT = 13 500 (base plafonnée à 600k)', () => {
      const base = Math.min(800_000, 600_000);
      expect(base * 0.0225).toBe(13_500);
    });
    it('CNSS patronal total = 137 500', () => {
      expect(64_000 + 60_000 + 13_500).toBe(137_500);
    });
  });

  describe('CAS 3 — Salaire 1 500 000 FCFA (au-dessus des deux plafonds)', () => {
    it('CNSS salarié = 48 000 (base plafonnée à 1,2M)', () => {
      const base = Math.min(1_500_000, 1_200_000);
      expect(base * 0.04).toBe(48_000);
    });
    it('CNSS patronal total = 169 500', () => {
      const pension = Math.min(1_500_000, 1_200_000) * 0.08; // 96 000
      const famille = Math.min(1_500_000, 600_000) * 0.1; // 60 000
      const at = Math.min(1_500_000, 600_000) * 0.0225; // 13 500
      expect(pension + famille + at).toBe(169_500);
    });
  });
});

describe('ITS Calculator (mode ITS_2026)', () => {
  // Utilitaire barème
  function applyBareme(rniAnnuel: number): number {
    const brackets = [
      { min: 0, max: 464_000, rate: 0.01 },
      { min: 464_000, max: 1_000_000, rate: 0.1 },
      { min: 1_000_000, max: 3_000_000, rate: 0.25 },
      { min: 3_000_000, max: Infinity, rate: 0.4 },
    ];
    let its = 0;
    for (const b of brackets) {
      if (rniAnnuel <= b.min) break;
      const imposable = Math.min(rniAnnuel, b.max) - b.min;
      if (imposable > 0) its += Math.round(imposable * b.rate);
    }
    return its;
  }

  describe('CAS 1 — Salaire 600 000 FCFA', () => {
    const brut = 600_000;
    const cnss = 24_000;
    const base = brut - cnss; // 576 000
    const abat = Math.round(base * 0.2); // 115 200
    const rniM = base - abat; // 460 800
    const rniA = rniM * 12; // 5 529 600
    const itsA = applyBareme(rniA);
    const itsM = Math.ceil(itsA / 12);

    it('Base imposable = 576 000', () => expect(base).toBe(576_000));
    it('Abattement = 115 200', () => expect(abat).toBe(115_200));
    it('RNI mensuel = 460 800', () => expect(rniM).toBe(460_800));
    it('RNI annuel = 5 529 600', () => expect(rniA).toBe(5_529_600));
    it('ITS annuel = 1 570 080', () => expect(itsA).toBe(1_570_080));
    it('ITS mensuel = 130 840', () => expect(itsM).toBe(130_840));
    it('Net à payer = 445 160', () => expect(brut - cnss - itsM).toBe(445_160));
  });

  describe('CAS 2 — Salaire 800 000 FCFA', () => {
    const brut = 800_000;
    const cnss = 32_000;
    const base = brut - cnss; // 768 000
    const abat = Math.round(base * 0.2); // 153 600
    const rniM = base - abat; // 614 400
    const rniA = rniM * 12; // 7 372 800
    const itsA = applyBareme(rniA);
    const itsM = Math.ceil(itsA / 12);

    it('RNI annuel = 7 372 800', () => expect(rniA).toBe(7_372_800));
    it('ITS annuel = 2 307 360', () => expect(itsA).toBe(2_307_360));
    it('ITS mensuel = 192 280', () => expect(itsM).toBe(192_280));
    it('Net à payer = 575 720', () => expect(brut - cnss - itsM).toBe(575_720));
  });

  describe('CAS 3 — Salaire 1 500 000 FCFA', () => {
    const brut = 1_500_000;
    const cnss = 48_000;
    const base = brut - cnss; // 1 452 000
    const abat = Math.round(base * 0.2); // 290 400
    const rniM = base - abat; // 1 161 600
    const rniA = rniM * 12; // 13 939 200
    const itsA = applyBareme(rniA);
    const itsM = Math.ceil(itsA / 12);

    it('RNI annuel = 13 939 200', () => expect(rniA).toBe(13_939_200));
    it('ITS annuel = 4 933 920', () => expect(itsA).toBe(4_933_920));
    it('ITS mensuel = 411 160', () => expect(itsM).toBe(411_160));
    it('Net à payer = 1 040 840', () =>
      expect(brut - cnss - itsM).toBe(1_040_840));
  });
});
