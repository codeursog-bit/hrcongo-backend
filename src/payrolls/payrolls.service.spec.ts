import { Test, TestingModule } from '@nestjs/testing';
import { PayrollsService } from './payrolls.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoansService } from '../loans/loans.service';

describe('PayrollsService - Calculs Critiques', () => {
  let service: PayrollsService;
  let prisma: PrismaService;

  // Mock des settings de paie (paramètres Congo)
  const mockSettings = {
    cnssSalarialRate: 4,
    cnssEmployerRate: 16,
    cnssCeiling: 1200000,
    overtimeRate15: 15,
    overtimeRate50: 50,
    workHoursPerDay: 173.33,
    workDaysPerMonth: 26,
    itsBrackets: JSON.stringify([
      { min: 0, max: 50000, rate: 0 },
      { min: 50000, max: 130000, rate: 0.01 },
      { min: 130000, max: 300000, rate: 0.1 },
      { min: 300000, max: 600000, rate: 0.15 },
      { min: 600000, max: Infinity, rate: 0.2 },
    ]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollsService,
        {
          provide: PrismaService,
          useValue: {
            payrollSettings: { findFirst: jest.fn() },
            employee: { findUnique: jest.fn(), findMany: jest.fn() },
            payroll: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: LoansService,
          useValue: {
            processMonthlyDeduction: jest.fn(),
            markAdvanceAsDeducted: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PayrollsService>(PayrollsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('Calcul ITS (Impôt sur Traitement et Salaire)', () => {
    it('should calculate ITS = 0 for salary <= 50,000 FCFA', () => {
      const result = service['calculatePayroll'](
        40000, // salaire de base
        0, // heures sup 15%
        0, // heures sup 50%
        [], // bonus
        [], // déductions
        mockSettings,
      );

      expect(result.its).toBe(0);
      expect(result.grossSalary).toBe(40000);
    });

    it('should calculate ITS correctly for 100,000 FCFA (tranche 1%)', () => {
      const result = service['calculatePayroll'](
        100000,
        0,
        0,
        [],
        [],
        mockSettings,
      );

      // Taxable = 100,000 - CNSS(4,000) = 96,000
      // ITS = (96,000 - 50,000) * 1% = 460 FCFA
      const expectedCNSS = Math.floor(100000 * 0.04); // 4,000
      const taxableNet = 100000 - expectedCNSS; // 96,000
      const expectedITS = Math.floor((taxableNet - 50000) * 0.01); // 460

      expect(result.cnssSalarial).toBe(expectedCNSS);
      expect(result.its).toBe(expectedITS);
    });

    it('should calculate ITS correctly for 500,000 FCFA (multiples tranches)', () => {
      const result = service['calculatePayroll'](
        500000,
        0,
        0,
        [],
        [],
        mockSettings,
      );

      // Taxable = 500,000 - CNSS(20,000) = 480,000
      const expectedCNSS = Math.floor(500000 * 0.04); // 20,000
      const taxableNet = 500000 - expectedCNSS; // 480,000

      // ITS par tranches:
      // 0-50k: 0
      // 50k-130k: (130k-50k) * 1% = 800
      // 130k-300k: (300k-130k) * 10% = 17,000
      // 300k-480k: (480k-300k) * 15% = 27,000
      // TOTAL = 44,800 FCFA
      const expectedITS = Math.floor(
        0 +
          (130000 - 50000) * 0.01 +
          (300000 - 130000) * 0.1 +
          (480000 - 300000) * 0.15,
      );

      expect(result.cnssSalarial).toBe(expectedCNSS);
      expect(result.its).toBe(expectedITS);
    });

    it('should calculate ITS correctly for 1,000,000 FCFA (tranche 20%)', () => {
      const result = service['calculatePayroll'](
        1000000,
        0,
        0,
        [],
        [],
        mockSettings,
      );

      // Taxable = 1,000,000 - CNSS(40,000) = 960,000
      const expectedCNSS = Math.floor(1000000 * 0.04); // 40,000
      const taxableNet = 1000000 - expectedCNSS; // 960,000

      // ITS = 0 + 800 + 17,000 + 45,000 + (960k-600k)*20% = 134,800
      const expectedITS = Math.floor(
        0 +
          (130000 - 50000) * 0.01 +
          (300000 - 130000) * 0.1 +
          (600000 - 300000) * 0.15 +
          (960000 - 600000) * 0.2,
      );

      expect(result.its).toBe(expectedITS);
    });
  });

  describe('Plafond CNSS (1,200,000 FCFA)', () => {
    it('should respect CNSS ceiling for high salary (2M FCFA)', () => {
      const result = service['calculatePayroll'](
        2000000, // Salaire au-dessus du plafond
        0,
        0,
        [],
        [],
        mockSettings,
      );

      // CNSS doit être calculée sur 1.2M max
      const expectedCNSSSalarial = Math.floor(1200000 * 0.04); // 48,000
      const expectedCNSSEmployer = Math.floor(1200000 * 0.16); // 192,000

      expect(result.cnssSalarial).toBe(expectedCNSSSalarial);
      expect(result.cnssEmployer).toBe(expectedCNSSEmployer);
    });

    it('should apply full CNSS for salary below ceiling', () => {
      const result = service['calculatePayroll'](
        800000,
        0,
        0,
        [],
        [],
        mockSettings,
      );

      const expectedCNSSSalarial = Math.floor(800000 * 0.04); // 32,000
      const expectedCNSSEmployer = Math.floor(800000 * 0.16); // 128,000

      expect(result.cnssSalarial).toBe(expectedCNSSSalarial);
      expect(result.cnssEmployer).toBe(expectedCNSSEmployer);
    });
  });

  describe('Heures Supplémentaires', () => {
    it('should calculate overtime 15% correctly', () => {
      const baseSalary = 200000;
      const result = service['calculatePayroll'](
        baseSalary,
        10, // 10 heures sup à 15%
        0,
        [],
        [],
        mockSettings,
      );

      const hourlyRate = baseSalary / 173.33;
      const expectedOT15 = 10 * hourlyRate * 1.15;

      expect(result.grossSalary).toBeCloseTo(baseSalary + expectedOT15, 0);
    });

    it('should calculate overtime 50% correctly', () => {
      const baseSalary = 200000;
      const result = service['calculatePayroll'](
        baseSalary,
        0,
        8, // 8 heures sup à 50%
        [],
        [],
        mockSettings,
      );

      const hourlyRate = baseSalary / 173.33;
      const expectedOT50 = 8 * hourlyRate * 1.5;

      expect(result.grossSalary).toBeCloseTo(baseSalary + expectedOT50, 0);
    });

    it('should calculate mixed overtime correctly', () => {
      const baseSalary = 300000;
      const result = service['calculatePayroll'](
        baseSalary,
        10, // 10h à 15%
        5, // 5h à 50%
        [],
        [],
        mockSettings,
      );

      const hourlyRate = baseSalary / 173.33;
      const expectedOT15 = 10 * hourlyRate * 1.15;
      const expectedOT50 = 5 * hourlyRate * 1.5;

      expect(result.grossSalary).toBeCloseTo(
        baseSalary + expectedOT15 + expectedOT50,
        0,
      );
    });
  });

  describe('Bonus et Déductions', () => {
    it('should add bonuses to gross salary', () => {
      const bonuses = [
        { type: 'Transport', amount: 50000 },
        { type: 'Performance', amount: 100000 },
      ];

      const result = service['calculatePayroll'](
        300000,
        0,
        0,
        bonuses,
        [],
        mockSettings,
      );

      expect(result.grossSalary).toBe(300000 + 150000);
      expect(result.totalBonuses).toBe(150000);
    });

    it('should subtract deductions from net salary', () => {
      const deductions = [
        { type: 'Prêt', amount: 30000 },
        { type: 'Avance', amount: 20000 },
      ];

      const result = service['calculatePayroll'](
        300000,
        0,
        0,
        [],
        deductions,
        mockSettings,
      );

      // Vérifier que les déductions sont bien soustraites
      expect(result.totalDeductions).toBeGreaterThan(50000); // CNSS + ITS + déductions
    });
  });

  describe('Scénario Réel Complet', () => {
    it('should calculate complete payroll for typical employee', () => {
      // Employé type: 400k FCFA, 5h sup 15%, transport 30k, prêt 40k
      const result = service['calculatePayroll'](
        400000,
        5, // 5h sup 15%
        0,
        [{ type: 'Transport', amount: 30000 }],
        [{ type: 'Prêt', amount: 40000 }],
        mockSettings,
      );

      // Vérifications
      expect(result.grossSalary).toBeGreaterThan(400000);
      expect(result.netSalary).toBeLessThan(result.grossSalary);
      expect(result.cnssSalarial).toBeGreaterThan(0);
      expect(result.its).toBeGreaterThan(0);
      expect(result.cnssEmployer).toBeGreaterThan(0);

      // Le net doit être: Brut - CNSS - ITS - Prêt
      const expectedNet = Math.floor(
        result.grossSalary - result.cnssSalarial - result.its - 40000,
      );
      expect(result.netSalary).toBe(expectedNet);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero salary', () => {
      const result = service['calculatePayroll'](0, 0, 0, [], [], mockSettings);

      expect(result.grossSalary).toBe(0);
      expect(result.netSalary).toBe(0);
      expect(result.cnssSalarial).toBe(0);
      expect(result.its).toBe(0);
    });

    it('should handle negative overtime (should not happen but defensive)', () => {
      const result = service['calculatePayroll'](
        300000,
        -5, // Négatif (erreur)
        0,
        [],
        [],
        mockSettings,
      );

      // Le calcul ne doit pas crasher
      expect(result.grossSalary).toBeDefined();
    });
  });
});

// ============================================
// 🧪 COMMANDES POUR LANCER LES TESTS
// ============================================
// npm test payrolls.service.spec.ts
// npm test -- --coverage (pour voir la couverture)
