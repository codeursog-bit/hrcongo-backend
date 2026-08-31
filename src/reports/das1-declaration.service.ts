// ============================================================================
// 📁 src/reports/das1-declaration.service.ts
// ✅ "Bulletin Individuel" — Déclaration Annuelle des Salaires (DAS 1),
//    formulaire officiel de la Direction Générale des Impôts (Congo).
//
// ⚠️ Le fichier fourni comme modèle (PPP_MODELE_BILAN_DAS_I...xls) contient
// une anomalie : la cellule "NOM et PRENOMS" et plusieurs cellules chiffrées
// affichent la valeur "23" de façon identique sur TOUS les employés (visible
// en comparant le bloc DIKOBAT et le bloc POATY — même "23" partout, alors
// que les noms diffèrent). C'est une formule cassée (référence figée suite
// à une copie), pas une valeur réelle. On reproduit donc la STRUCTURE et les
// LIBELLÉS du formulaire à la lettre, mais les valeurs viennent de nos
// vraies données (Employee + Payroll + Leave), pas du fichier modèle.
//
// Réutilise PayrollRecapService.getAnnualRecap() pour tous les montants déjà
// calculés et validés (brut, CNSS, IRPP, indemnités par catégorie, TOL,
// taxe départementale, mois en congé) — pas de recalcul redondant.
// ============================================================================

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollRecapService } from './payroll-recap.service';

export interface Das1IndemniteLine {
  label: string;
  amount: number;
}

export interface Das1Bulletin {
  ordre: number;
  employeeId: string;
  employeeName: string;
  niu: string | null;
  position: string;
  address: string;
  city: string;
  phone: string | null;
  maritalStatusLabel: string;
  numberOfChildren: number;
  periodFrom: string; // JJ/MM/AAAA
  periodTo: string; // JJ/MM/AAAA

  montantEspeces: number; // Brut annuel − CNSS (avant IRPP), "Montant payé en espèces"
  avantageNatureLogement: number; // Non géré aujourd'hui → 0, affiché mais modifiable à la main
  avantageNatureAutres: number; // idem
  montantImposable80: number; // 80% du total (montant espèces + avantages)
  irppRetenu: number;
  taxeDepartementale: number;
  tolRetenu: number;

  indemnitesNonImposables: Das1IndemniteLine[];
  totalIndemnitesNonImposables: number;

  moisPresence: number; // mois avec bulletin payé
  moisConge: number; // mois en congé approuvé
  moisSansPaie: number; // mois sans bulletin ni congé (à vérifier)
}

export interface Das1Declaration {
  year: number;
  companyName: string;
  companyActivity: string | null;
  companyAddress: string;
  companyCity: string;
  companyPhone: string;
  bulletins: Das1Bulletin[];
}

const MARITAL_STATUS_LABELS: Record<string, string> = {
  SINGLE: 'CELIBATAIRE',
  MARRIED: 'MARIE(E)',
  DIVORCED: 'DIVORCE(E)',
  WIDOWED: 'VEUF(VE)',
};

function fmtDdMmYyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

@Injectable()
export class Das1DeclarationService {
  constructor(
    private prisma: PrismaService,
    private payrollRecapService: PayrollRecapService,
  ) {}

  private async resolveCompanyId(userId: string, overrideCompanyId?: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true },
    });
    const isCabinet = user?.role === 'CABINET_ADMIN' || user?.role === 'CABINET_GESTIONNAIRE';
    return isCabinet && overrideCompanyId ? overrideCompanyId : (user?.companyId ?? null);
  }

  async getAnnualDeclaration(
    userId: string,
    year: number,
    overrideCompanyId?: string,
  ): Promise<Das1Declaration> {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) {
      return {
        year,
        companyName: 'Entreprise',
        companyActivity: null,
        companyAddress: '',
        companyCity: '',
        companyPhone: '',
        bulletins: [],
      };
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { tradeName: true, legalName: true, industry: true, address: true, city: true, phone: true },
    });

    // Tous les montants annuels (brut, CNSS, IRPP, indemnités par catégorie,
    // TOL, taxe dépt, mois en congé...) viennent du récap déjà validé.
    const annualRecap = await this.payrollRecapService.getAnnualRecap(userId, year, overrideCompanyId);

    const employeeIds = annualRecap.rows.map((r) => r.employeeId).filter((id) => id !== 'TOTAL');
    const employeesRaw = employeeIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: employeeIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            niu: true,
            taxNumber: true,
            position: true,
            address: true,
            city: true,
            phone: true,
            maritalStatus: true,
            numberOfChildren: true,
            hireDate: true,
            terminationDate: true,
            contractType: true,
          },
        })
      : [];

    // ⚠️ Le Bulletin Annuel (DAS 1) ne concerne QUE les salariés en CDD/CDI.
    // Prestataires, consultants et stagiaires ont un régime fiscal différent
    // (pas de bulletin de salaire classique) — leur cas sera géré séparément
    // plus tard. On les exclut donc ici, sans casser le récap personnel
    // (payroll-recap.service.ts) qui, lui, continue de tous les afficher.
    const employees = employeesRaw.filter(
      (e) => e.contractType === 'CDD' || e.contractType === 'CDI',
    );
    const employeeById = new Map(employees.map((e) => [e.id, e]));

    // On ne garde que les lignes du récap correspondant à un employé retenu
    // (CDD/CDI) — l'ordre (N° d'ordre du bordereau) reste ainsi séquentiel
    // sans trou, même après avoir écarté prestataires/consultants/stagiaires.
    const recapRows = annualRecap.rows.filter(
      (r) => r.employeeId !== 'TOTAL' && employeeById.has(r.employeeId),
    );

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    const bulletins: Das1Bulletin[] = recapRows
      .map((r, idx) => {
        const emp = employeeById.get(r.employeeId);

        const montantEspeces = r.salBrut - r.cnss;
        const montantImposable80 = Math.round(montantEspeces * 0.8);

        const indemnitesNonImposables: Das1IndemniteLine[] = annualRecap.indemniteColumns.map((c) => ({
          label: c.label,
          amount: r.indemnites[c.key] ?? 0,
        }));

        const moisConge = r.moisEnConge?.length ?? 0;
        const moisSansPaie = r.moisSansPaie?.length ?? 0;
        const moisPresence = 12 - moisConge - moisSansPaie;

        const periodFrom = emp?.hireDate && emp.hireDate > yearStart ? emp.hireDate : yearStart;
        const periodTo = emp?.terminationDate && emp.terminationDate < yearEnd ? emp.terminationDate : yearEnd;

        return {
          ordre: idx + 1,
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          niu: emp?.niu ?? emp?.taxNumber ?? null,
          position: emp?.position ?? '',
          address: emp?.address ?? '',
          city: emp?.city ?? '',
          phone: emp?.phone ?? null,
          maritalStatusLabel: MARITAL_STATUS_LABELS[emp?.maritalStatus ?? 'SINGLE'] ?? 'CELIBATAIRE',
          numberOfChildren: emp?.numberOfChildren ?? 0,
          periodFrom: fmtDdMmYyyy(periodFrom),
          periodTo: fmtDdMmYyyy(periodTo),

          montantEspeces,
          avantageNatureLogement: 0,
          avantageNatureAutres: 0,
          montantImposable80,
          irppRetenu: r.irpp,
          taxeDepartementale: r.taxeDept,
          tolRetenu: r.tol,

          indemnitesNonImposables,
          totalIndemnitesNonImposables: indemnitesNonImposables.reduce((s, l) => s + l.amount, 0),

          moisPresence,
          moisConge,
          moisSansPaie,
        };
      });

    return {
      year,
      companyName: company?.tradeName ?? company?.legalName ?? 'Entreprise',
      companyActivity: company?.industry ?? null,
      companyAddress: company?.address ?? '',
      companyCity: company?.city ?? '',
      companyPhone: company?.phone ?? '',
      bulletins,
    };
  }
}