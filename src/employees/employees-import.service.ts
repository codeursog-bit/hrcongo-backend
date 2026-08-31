import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as XLSX from 'xlsx';
import Fuse from 'fuse.js';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import { EmployeesService } from './employees.service';
import {
  CreateEmployeeDto,
  ContractType,
  Gender,
  MaritalStatus,
  PaymentMethod,
} from './dto/create-employee.dto';
import {
  ConventionsService,
  ConventionCategory,
} from '../conventions/conventions.service';
import { normalizePhone } from '../common/utils/phone.util';

export interface ColumnMapping {
  excelColumn: string;
  dbField: string;
  confidence: number;
  isRequired: boolean;
}
export interface ImportAnalysis {
  totalRows: number;
  previewData: any[];
  detectedColumns: string[];
  suggestedMappings: ColumnMapping[];
  warnings: string[];
  cleanedPreview?: any[];
}
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  validRows: number;
  invalidRows: number;
}
export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

const FIELD_MAPPINGS: Record<string, any> = {
  firstName: {
    keywords: [
      'prénom',
      'prenom',
      'prénoms',
      'prenoms',
      'first name',
      'firstname',
      'first_name',
      'fn',
      'fname',
    ],
    required: true,
    type: 'string',
  },
  lastName: {
    keywords: [
      'nom',
      'noms',
      'nom de famille',
      'last name',
      'lastname',
      'last_name',
      'surname',
      'family name',
      'ln',
      'lname',
    ],
    required: true,
    type: 'string',
  },
  baseSalary: {
    keywords: [
      'salaire',
      'salary',
      'base_salary',
      'salaire de base',
      'salaire base',
      'base salary',
      'wage',
      'pay',
      'remuneration',
      'rémunération',
      'montant',
      'fcfa',
    ],
    required: true,
    type: 'salary',
  },
  email: {
    keywords: [
      'email',
      'e-mail',
      'mail',
      'courriel',
      'adresse mail',
      'email pro',
    ],
    required: false,
    type: 'email',
  },
  phone: {
    keywords: [
      'téléphone',
      'telephone',
      'tel',
      'tél',
      'phone',
      'mobile',
      'gsm',
      'portable',
      'cellphone',
      'contact',
      'numero',
      'numéro',
    ],
    required: false,
    type: 'phone',
  },
  dateOfBirth: {
    keywords: [
      'date naissance',
      'date de naissance',
      'naissance',
      'birth date',
      'date_of_birth',
      'birthdate',
      'dob',
      'né le',
      'born',
    ],
    required: false,
    type: 'date',
  },
  placeOfBirth: {
    keywords: [
      'lieu naissance',
      'lieu de naissance',
      'place of birth',
      'birthplace',
      'né à',
      'born in',
    ],
    required: false,
    type: 'string',
  },
  gender: {
    keywords: ['sexe', 'genre', 'gender', 'sex', 'h/f', 'm/f'],
    required: false,
    type: 'enum',
    allowedValues: ['MALE', 'FEMALE'],
    mappings: {
      M: 'MALE',
      MALE: 'MALE',
      HOMME: 'MALE',
      H: 'MALE',
      MAN: 'MALE',
      MASCULIN: 'MALE',
      F: 'FEMALE',
      FEMALE: 'FEMALE',
      FEMME: 'FEMALE',
      WOMAN: 'FEMALE',
      FEMININ: 'FEMALE',
    },
  },
  address: {
    keywords: [
      'adresse',
      'address',
      'addr',
      'rue',
      'street',
      'domicile',
      'residence',
    ],
    required: false,
    type: 'string',
  },
  city: {
    keywords: ['ville', 'city', 'town', 'localité', 'localite', 'commune'],
    required: false,
    type: 'string',
  },
  hireDate: {
    keywords: [
      'date embauche',
      'embauche',
      'hire date',
      'hire_date',
      'date entrée',
      'date entree',
      'start date',
      'recrutement',
      'entrée',
    ],
    required: false,
    type: 'date',
  },
  contractType: {
    keywords: [
      'contrat',
      'type contrat',
      'type de contrat',
      'contract type',
      'employment type',
    ],
    required: false,
    type: 'enum',
    allowedValues: [
      'CDI',
      'CDD',
      'STAGE',
      'CONSULTANT',
      'INTERIM',
      'PRESTATAIRE',
    ],
    mappings: {
      CDI: 'CDI',
      PERMANENT: 'CDI',
      CDD: 'CDD',
      TEMPORARY: 'CDD',
      TEMPORAIRE: 'CDD',
      STAGE: 'STAGE',
      INTERN: 'STAGE',
      STAGIAIRE: 'STAGE',
      CONSULTANT: 'CONSULTANT',
      FREELANCE: 'CONSULTANT',
      PRESTATAIRE: 'PRESTATAIRE',
      INTERIM: 'INTERIM',
      TEMP: 'INTERIM',
    },
  },
  position: {
    keywords: [
      'poste',
      'position',
      'fonction',
      'job',
      'title',
      'job title',
      'role',
      'emploi',
      'métier',
    ],
    required: false,
    type: 'string',
  },
  nationalIdNumber: {
    keywords: [
      'cni',
      'carte identité',
      'id number',
      'national_id',
      'identity card',
      'numero cni',
      'n° cni',
    ],
    required: false,
    type: 'string',
  },
  cnssNumber: {
    keywords: [
      'cnss',
      'numero cnss',
      'n° cnss',
      'social security',
      'securite sociale',
    ],
    required: false,
    type: 'string',
  },
  maritalStatus: {
    keywords: [
      'situation familiale',
      'situation',
      'marital status',
      'etat civil',
      'family status',
    ],
    required: false,
    type: 'enum',
    allowedValues: ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'],
    mappings: {
      CELIBATAIRE: 'SINGLE',
      SINGLE: 'SINGLE',
      MARIE: 'MARRIED',
      MARIEE: 'MARRIED',
      MARRIED: 'MARRIED',
      DIVORCE: 'DIVORCED',
      DIVORCED: 'DIVORCED',
      VEUF: 'WIDOWED',
      VEUVE: 'WIDOWED',
      WIDOWED: 'WIDOWED',
    },
  },
  numberOfChildren: {
    keywords: [
      'enfants',
      'nombre enfants',
      'children',
      'number of children',
      'kids',
    ],
    required: false,
    type: 'number',
  },
  contractEndDate: {
    keywords: [
      'fin contrat',
      'date fin contrat',
      'date de fin',
      'contract end',
      'end date',
      'expiry date',
      'expiration',
    ],
    required: false,
    type: 'date',
  },
  bankName: {
    keywords: ['banque', 'bank', 'nom banque', 'bank name'],
    required: false,
    type: 'string',
  },
  bankAccountNumber: {
    keywords: [
      'compte bancaire',
      'numero compte',
      'account number',
      'bank account',
      'rib',
      'iban',
    ],
    required: false,
    type: 'string',
  },
  mobileMoneyNumber: {
    keywords: ['mobile money', 'airtel money', 'mtn money', 'orange money'],
    required: false,
    type: 'phone',
  },
  departmentName: {
    keywords: [
      'département',
      'department',
      'dept',
      'service',
      'division',
      'unité',
      'direction',
    ],
    required: false,
    type: 'string',
  },
  employeeNumber: {
    keywords: [
      'matricule',
      'numero employé',
      'employee number',
      'employee id',
      'staff number',
      'mat',
    ],
    required: false,
    type: 'string',
  },

  // 🆕 Convention collective — catégorie / échelon (code grille, ex: "C3-E1")
  professionalCategory: {
    keywords: [
      'catégorie',
      'categorie',
      'category',
      'classification',
      'code catégorie',
      'code categorie',
      'cat conventionnelle',
    ],
    required: false,
    type: 'string',
  },
  echelon: {
    keywords: ['échelon', 'echelon', 'niveau', 'step', 'ech'],
    required: false,
    type: 'string',
  },

  // 🆕 Fiche ORCA — Informations complémentaires (toutes optionnelles)
  bloodType: {
    keywords: ['groupe sanguin', 'blood type', 'groupe sang'],
    required: false,
    type: 'string',
  },
  pathology: {
    keywords: [
      'pathologie',
      'maladie habituelle',
      'maladie',
      'health condition',
    ],
    required: false,
    type: 'string',
  },
  fatherName: {
    keywords: [
      'nom du père',
      'nom du pere',
      'nom pere',
      'nom père',
      'père',
      'pere',
      'father name',
    ],
    required: false,
    type: 'string',
  },
  motherName: {
    keywords: [
      'nom de la mère',
      'nom de la mere',
      'nom mere',
      'nom mère',
      'mère',
      'mere',
      'mother name',
    ],
    required: false,
    type: 'string',
  },
  educationLevel: {
    keywords: [
      "niveau d'études",
      'niveau etudes',
      "niveau d'etude",
      'diplôme',
      'diplome',
      'education level',
      'niveau scolaire',
    ],
    required: false,
    type: 'string',
  },
  emergencyContactName: {
    keywords: [
      'personne à contacter',
      'personne a contacter',
      'contact urgence',
      'emergency contact',
      'personne urgence',
    ],
    required: false,
    type: 'string',
  },
  emergencyContactRelation: {
    keywords: [
      'lien de parenté',
      'lien de parente',
      'lien parente',
      'relation urgence',
    ],
    required: false,
    type: 'string',
  },
  emergencyContactPhone: {
    keywords: [
      'téléphone urgence',
      'telephone urgence',
      'tel urgence',
      'emergency phone',
    ],
    required: false,
    type: 'string',
  },
  hasDrivingLicense: {
    keywords: [
      'permis de conduire',
      'permis',
      'driving license',
      'driver license',
    ],
    required: false,
    type: 'boolean',
  },
  drivingLicenseNumber: {
    keywords: [
      'numero permis',
      'numéro de permis',
      'n° permis',
      'license number',
    ],
    required: false,
    type: 'string',
  },
  foreignLanguages: {
    keywords: [
      'langue étrangère',
      'langue etrangere',
      'foreign language',
      'langues',
    ],
    required: false,
    type: 'string',
  },
  uniformSize: {
    keywords: [
      'taille de la tenue',
      'taille tenue',
      'uniform size',
      'taille vêtement',
      'taille vetement',
    ],
    required: false,
    type: 'string',
  },
  shoeSize: {
    keywords: ['pointure', 'pointure de chaussures', 'shoe size'],
    required: false,
    type: 'string',
  },
};

const HARD_REQUIRED_FIELDS = ['firstName', 'lastName', 'baseSalary'];
const TEMP_CONTRACTS = ['CDD', 'STAGE', 'INTERIM', 'CONSULTANT', 'PRESTATAIRE'];

@Injectable()
export class EmployeesImportService {
  constructor(
    private prisma: PrismaService,
    private subscriptionGuard: SubscriptionGuard,
    private employeesService: EmployeesService,
    private conventionsService: ConventionsService,
  ) {}

  async analyzeExcelFile(
    buffer: Buffer,
    userId: string,
  ): Promise<ImportAnalysis> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId)
      throw new BadRequestException(
        "L'utilisateur n'est pas associé à une entreprise.",
      );
    await this.subscriptionGuard.checkFeatureAccess(
      user.companyId,
      'hasEmployeeImportExcel',
    );
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      raw: false,
      defval: '',
    });
    if (jsonData.length === 0)
      throw new BadRequestException('Le fichier Excel est vide.');
    const detectedColumns = Object.keys(jsonData[0] || {});
    const savedMapping = await this.getLearnedMapping(
      user.companyId,
      detectedColumns,
    );
    const suggestedMappings =
      savedMapping || this.generateIntelligentMappings(detectedColumns);
    return {
      totalRows: jsonData.length,
      previewData: jsonData.slice(0, 5),
      cleanedPreview: this.cleanPreviewData(
        jsonData.slice(0, 5),
        suggestedMappings,
      ),
      detectedColumns,
      suggestedMappings,
      warnings: await this.generateWarnings(
        suggestedMappings,
        jsonData,
        user.companyId,
      ),
    };
  }

  private async getLearnedMapping(
    companyId: string,
    columns: string[],
  ): Promise<ColumnMapping[] | null> {
    try {
      const patterns = await this.prisma.importMappingPattern.findMany({
        where: { companyId },
        orderBy: { usageCount: 'desc' },
        take: 5,
      });
      for (const p of patterns) {
        if (
          this.calculateSimilarity(columns, p.columnsSignature.split('|')) > 0.8
        ) {
          await this.prisma.importMappingPattern.update({
            where: { id: p.id },
            data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
          });
          return JSON.parse(p.mappingData);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async saveLearnedMapping(
    companyId: string,
    columns: string[],
    mappings: ColumnMapping[],
  ): Promise<void> {
    try {
      const columnsSignature = columns.sort().join('|').toLowerCase();
      await this.prisma.importMappingPattern.upsert({
        where: { companyId_columnsSignature: { companyId, columnsSignature } },
        create: {
          companyId,
          columnsSignature,
          mappingData: JSON.stringify(mappings),
          usageCount: 1,
          lastUsedAt: new Date(),
        },
        update: {
          mappingData: JSON.stringify(mappings),
          usageCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      });
    } catch {
      console.log('Pattern learning not available yet');
    }
  }

  private calculateSimilarity(arr1: string[], arr2: string[]): number {
    const s1 = new Set(arr1.map((s) => this.normalizeString(s)));
    const s2 = new Set(arr2.map((s) => this.normalizeString(s)));
    return (
      new Set([...s1].filter((x) => s2.has(x))).size /
      Math.max(s1.size, s2.size)
    );
  }

  private generateIntelligentMappings(excelColumns: string[]): ColumnMapping[] {
    const mappings: ColumnMapping[] = [];
    const searchable: Array<{
      keyword: string;
      dbField: string;
      required: boolean;
    }> = [];
    for (const [dbField, config] of Object.entries(FIELD_MAPPINGS))
      for (const kw of config.keywords)
        searchable.push({
          keyword: this.normalizeString(kw),
          dbField,
          required: HARD_REQUIRED_FIELDS.includes(dbField),
        });
    const fuse = new Fuse(searchable, {
      keys: ['keyword'],
      threshold: 0.3,
      includeScore: true,
    });
    for (const col of excelColumns) {
      const norm = this.normalizeString(col);
      if (
        [
          'nomprenom',
          'prenomnom',
          'nom_prenom',
          'prenom_nom',
          'fullname',
          'full_name',
          'nom_complet',
        ].some((p) => norm.includes(p))
      ) {
        mappings.push({
          excelColumn: col,
          dbField: 'FUSED_NAME',
          confidence: 95,
          isRequired: true,
        });
        continue;
      }
      const results = fuse.search(norm);
      if (results.length > 0) {
        const best = results[0];
        const conf = Math.round((1 - (best.score || 0)) * 100);
        if (conf >= 60)
          mappings.push({
            excelColumn: col,
            dbField: best.item.dbField,
            confidence: conf,
            isRequired: HARD_REQUIRED_FIELDS.includes(best.item.dbField),
          });
      }
    }
    return mappings;
  }

  private cleanPreviewData(data: any[], mappings: ColumnMapping[]): any[] {
    return data.map((row) => {
      const cleaned: any = {};
      for (const m of mappings) {
        const fc = FIELD_MAPPINGS[m.dbField];
        if (fc)
          cleaned[m.dbField] = this.cleanValue(
            row[m.excelColumn],
            fc.type,
            m.dbField,
          );
      }
      return cleaned;
    });
  }

  private cleanValue(value: any, type: string, dbField: string): any {
    if (this.isEmptyValue(value)) return null;
    const s = value.toString().trim();
    switch (type) {
      case 'phone':
        return this.cleanPhone(s);
      case 'salary':
        return this.cleanSalary(s);
      case 'email':
        return s.toLowerCase();
      case 'date':
        return this.parseDate(s);
      case 'enum':
        return this.normalizeEnum(s, dbField);
      case 'number':
        return Number(s.replace(/[^\d.,-]/g, '')) || 0;
      case 'boolean':
        return this.cleanBoolean(s);
      case 'string':
        return s
          .split(' ')
          .map(
            (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
          )
          .join(' ');
      default:
        return s;
    }
  }

  private cleanPhone(phone: string): string {
    // ✅ Même logique que la saisie manuelle (src/common/utils/phone.util.ts) :
    // garantit un format identique en base, que le numéro vienne d'un import CSV
    // ou d'une création manuelle. On reste permissif ici (pas de rejet de ligne
    // sur un format invalide) — la validation stricte a lieu à la création/
    // modification manuelle d'un employé.
    return normalizePhone(phone) || phone;
  }

  private cleanSalary(s: string): number {
    return Number(s.replace(/[^\d]/g, '')) || 0;
  }

  private cleanBoolean(s: string): boolean {
    const n = s.toLowerCase().trim();
    return ['oui', 'yes', 'true', '1', 'x', 'o'].includes(n);
  }

  // 🆕 Récupère la grille de la convention collective active de l'entreprise (une seule fois par import)
  private async getCompanyConventionGrid(companyId: string): Promise<{
    conventionCode: string;
    categories: ConventionCategory[];
  } | null> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { collectiveAgreement: true },
    });
    if (!company?.collectiveAgreement) return null;
    const categories = this.conventionsService.getCategoriesByConvention(
      company.collectiveAgreement,
    );
    return categories.length > 0
      ? { conventionCode: company.collectiveAgreement, categories }
      : null;
  }

  // 🆕 Résout un code catégorie/échelon de grille à partir de valeurs Excel brutes.
  // Gère 3 cas : code exact ("C3-E1"), libellé exact ("Cat.3 Éch.1"), ou catégorie+échelon
  // donnés en chiffres séparés (ex: "3" + "1", ou "3-1" dans une seule colonne).
  private resolveConventionCategory(
    categories: ConventionCategory[],
    rawCategory?: any,
    rawEchelon?: any,
  ): ConventionCategory | null {
    if (!categories?.length) return null;
    const catStr = rawCategory != null ? String(rawCategory).trim() : '';
    const echStr = rawEchelon != null ? String(rawEchelon).trim() : '';
    if (catStr) {
      const normCat = this.normalizeString(catStr);
      const exactCode = categories.find(
        (c) => this.normalizeString(c.code) === normCat,
      );
      if (exactCode) return exactCode;
      const exactLabel = categories.find(
        (c) => this.normalizeString(c.label) === normCat,
      );
      if (exactLabel) return exactLabel;
    }
    const catDigits = catStr.match(/\d+/g) || [];
    const echDigits = echStr.match(/\d+/g) || [];
    let catNum: string | null = null;
    let echNum: string | null = null;
    if (catDigits.length >= 2) {
      catNum = catDigits[0] ?? null;
      echNum = catDigits[1] ?? null;
    } else if (catDigits.length === 1) {
      catNum = catDigits[0] ?? null;
      echNum = echDigits[0] ?? null;
    }
    if (!catNum) return null;
    const candidates = categories.filter((c) => {
      const nums = c.code.match(/\d+/g) || [];
      if (nums.length === 0 || nums[0] !== catNum) return false;
      if (echNum) return nums.length > 1 ? nums[1] === echNum : false;
      return true;
    });
    return candidates[0] || null;
  }

  private isEmptyValue(v: any): boolean {
    if (v === null || v === undefined) return true;
    if (v === 0) return false;
    return [
      '',
      'n/a',
      'na',
      '-',
      'null',
      'néant',
      'neant',
      'aucun',
      'none',
      'vide',
      'empty',
      '...',
      '--',
      '__',
    ].includes(v.toString().trim().toLowerCase());
  }

  private normalizeEnum(value: string, dbField: string): string {
    const fc = FIELD_MAPPINGS[dbField];
    if (!fc?.mappings) return value.toUpperCase();
    const n = value.toUpperCase().trim();
    if (fc.mappings[n]) return fc.mappings[n];
    for (const [k, v] of Object.entries(fc.mappings))
      if (n.includes(k) || k.includes(n)) return v as string;
    return fc.allowedValues[0];
  }

  private splitFusedName(name: string): {
    firstName: string;
    lastName: string;
  } {
    const p = name.trim().split(/\s+/);
    if (!p.length) return { lastName: 'INCONNU', firstName: 'Inconnu' };
    if (p.length === 1) return { lastName: p[0].toUpperCase(), firstName: '' };
    return {
      lastName: p[0].toUpperCase(),
      firstName: p
        .slice(1)
        .map(
          (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
        )
        .join(' '),
    };
  }

  private async generateWarnings(
    mappings: ColumnMapping[],
    data: any[],
    companyId: string,
  ): Promise<string[]> {
    const warnings: string[] = [];
    const mapped = mappings.map((m) => m.dbField);
    const hasCategoryMapping =
      mapped.includes('professionalCategory') || mapped.includes('echelon');
    const hasSalaryMapping = mapped.includes('baseSalary');
    for (const f of HARD_REQUIRED_FIELDS) {
      if (!mapped.includes(f) && !mapped.includes('FUSED_NAME')) {
        // 🆕 Salaire non détecté : pas bloquant si catégorie/échelon présents ET convention active
        if (f === 'baseSalary' && hasCategoryMapping) {
          const grid = await this.getCompanyConventionGrid(companyId);
          if (grid) {
            warnings.push(
              `💡 Salaire non détecté — sera calculé depuis la grille conventionnelle (${grid.conventionCode}) via catégorie/échelon`,
            );
            continue;
          }
        }
        const label =
          f === 'firstName'
            ? 'Prénom'
            : f === 'lastName'
              ? 'Nom'
              : 'Salaire de base';
        warnings.push(
          `❌ Champ obligatoire non détecté : "${label}" — l'import sera bloqué`,
        );
      }
    }
    if (hasCategoryMapping && !hasSalaryMapping) {
      const grid = await this.getCompanyConventionGrid(companyId);
      if (!grid)
        warnings.push(
          `⚠️  Catégorie/échelon détecté(s) mais aucune convention collective active — le salaire devra être renseigné manuellement`,
        );
    }
    const opts: Record<string, string> = {
      email: 'Email (adresse temporaire générée)',
      phone: 'Téléphone (laissé vide, à compléter plus tard)',
      hireDate: "Date d'embauche (aujourd'hui)",
      contractType: 'Type de contrat (CDI par défaut)',
      position: 'Poste (sera "À définir")',
    };
    for (const [f, label] of Object.entries(opts))
      if (!mapped.includes(f)) warnings.push(`ℹ️  ${label}`);
    const unmapped =
      data.length > 0
        ? Object.keys(data[0]).filter(
            (c) => !mappings.find((m) => m.excelColumn === c),
          )
        : [];
    if (unmapped.length > 0)
      warnings.push(
        `ℹ️  ${unmapped.length} colonne(s) ignorée(s) : ${unmapped.slice(0, 3).join(', ')}${unmapped.length > 3 ? '…' : ''}`,
      );
    return warnings;
  }

  async validateImportData(
    buffer: Buffer,
    mappings: Record<string, string>,
    userId: string,
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let validRows = 0;
    let invalidRows = 0;
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const jsonData: any[] = XLSX.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[0]],
        { raw: false, defval: '' },
      );
      const mappedFields = Object.values(mappings);

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { companyId: true },
      });
      if (!user?.companyId) {
        errors.push('Utilisateur non associé à une entreprise.');
        return {
          isValid: false,
          errors,
          warnings,
          validRows: 0,
          invalidRows: jsonData.length,
        };
      }

      // 🆕 Grille conventionnelle de l'entreprise (une seule fois) + colonnes catégorie/échelon mappées
      const grid = await this.getCompanyConventionGrid(user.companyId);
      const categoryCol = Object.entries(mappings).find(
        ([, df]) => df === 'professionalCategory',
      )?.[0];
      const echelonCol = Object.entries(mappings).find(
        ([, df]) => df === 'echelon',
      )?.[0];
      const canResolveSalaryFromGrid = !!grid && !!(categoryCol || echelonCol);

      for (const f of HARD_REQUIRED_FIELDS) {
        if (!mappedFields.includes(f) && !mappedFields.includes('FUSED_NAME')) {
          if (f === 'baseSalary' && canResolveSalaryFromGrid) continue; // 🆕 salaire déductible de la grille
          const label =
            f === 'firstName'
              ? 'Prénom'
              : f === 'lastName'
                ? 'Nom'
                : 'Salaire de base';
          errors.push(`❌ Champ obligatoire non mappé : "${label}"`);
        }
      }
      if (errors.length > 0)
        return {
          isValid: false,
          errors,
          warnings,
          validRows: 0,
          invalidRows: jsonData.length,
        };

      let gridResolvedCount = 0;

      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i] as Record<string, any>;
        const rowNum = i + 2;
        const rowErrors: string[] = [];
        for (const [excelCol, dbField] of Object.entries(mappings)) {
          if (!HARD_REQUIRED_FIELDS.includes(dbField)) continue;
          const fc = FIELD_MAPPINGS[dbField];
          if (!fc) continue;
          const cleaned = this.cleanValue(row[excelCol], fc.type, dbField);
          if (this.isEmptyValue(cleaned)) {
            // 🆕 Salaire absent : tenter une résolution via la grille conventionnelle avant d'invalider la ligne
            if (
              dbField === 'baseSalary' &&
              grid &&
              (categoryCol || echelonCol)
            ) {
              const resolved = this.resolveConventionCategory(
                grid.categories,
                categoryCol ? row[categoryCol] : undefined,
                echelonCol ? row[echelonCol] : undefined,
              );
              if (resolved?.minSalary) {
                gridResolvedCount++;
                continue;
              }
            }
            const label =
              dbField === 'firstName'
                ? 'Prénom'
                : dbField === 'lastName'
                  ? 'Nom'
                  : 'Salaire';
            rowErrors.push(`Ligne ${rowNum} : "${label}" vide`);
          } else if (dbField === 'baseSalary') {
            const s =
              typeof cleaned === 'number'
                ? cleaned
                : this.cleanSalary(String(cleaned));
            if (s <= 0) rowErrors.push(`Ligne ${rowNum} : Salaire invalide`);
          }
        }
        // 🆕 Salaire non mappé du tout mais déductible de la grille conventionnelle
        if (!mappedFields.includes('baseSalary') && canResolveSalaryFromGrid) {
          const resolved = this.resolveConventionCategory(
            grid.categories,
            categoryCol ? row[categoryCol] : undefined,
            echelonCol ? row[echelonCol] : undefined,
          );
          if (resolved?.minSalary) gridResolvedCount++;
          else
            rowErrors.push(
              `Ligne ${rowNum} : Catégorie/échelon introuvable dans la grille — salaire non calculable`,
            );
        }
        for (const [excelCol, dbField] of Object.entries(mappings)) {
          if (dbField !== 'email') continue;
          const v = row[excelCol]?.toString().trim().toLowerCase();
          if (
            v &&
            !this.isEmptyValue(v) &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
          )
            warnings.push(
              `Ligne ${rowNum} : email invalide — adresse temporaire générée`,
            );
        }
        if (rowErrors.length > 0) {
          errors.push(...rowErrors);
          invalidRows++;
        } else validRows++;
      }
      if (gridResolvedCount > 0)
        warnings.push(
          `💡 ${gridResolvedCount} salaire(s) seront calculés automatiquement depuis la grille conventionnelle (${grid!.conventionCode})`,
        );
      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        validRows,
        invalidRows,
      };
    } catch (e: any) {
      return {
        isValid: false,
        errors: [`Erreur : ${e.message}`],
        warnings,
        validRows: 0,
        invalidRows: 0,
      };
    }
  }

  async executeImport(
    buffer: Buffer,
    mappings: Record<string, string>,
    userId: string,
  ): Promise<ImportResult> {
    const errors: Array<{ row: number; message: string }> = [];
    let imported = 0;
    let skipped = 0;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { companyId: true },
      });
      if (!user?.companyId)
        throw new BadRequestException(
          'Utilisateur non associé à une entreprise.',
        );
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const jsonData: any[] = XLSX.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[0]],
        { raw: false, defval: '' },
      );

      // 🆕 Grille conventionnelle de l'entreprise (une seule fois pour tout l'import)
      const grid = await this.getCompanyConventionGrid(user.companyId);

      // Départements
      const depts = await this.prisma.department.findMany({
        where: { companyId: user.companyId },
        select: { id: true, name: true },
      });
      let defaultDeptId: string;
      const deptCache = new Map<string, string>();
      if (depts.length === 0) {
        const d = await this.prisma.department.create({
          data: { name: 'Général', companyId: user.companyId },
        });
        defaultDeptId = d.id;
        deptCache.set('général', d.id);
      } else {
        defaultDeptId = depts[0].id;
        depts.forEach((d) => deptCache.set(d.name.toLowerCase(), d.id));
      }

      // Sauvegarder mapping
      await this.saveLearnedMapping(
        user.companyId,
        Object.keys(jsonData[0] || {}),
        Object.entries(mappings).map(([ec, df]) => ({
          excelColumn: ec,
          dbField: df,
          confidence: 100,
          isRequired: HARD_REQUIRED_FIELDS.includes(df),
        })),
      );

      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i] as Record<string, any>;
        const rowNum = i + 2;
        try {
          const raw: Record<string, any> = {};
          let fusedName: { firstName: string; lastName: string } | null = null;
          for (const [ec, df] of Object.entries(mappings)) {
            if (df === 'FUSED_NAME') {
              fusedName = this.splitFusedName(String(row[ec] ?? ''));
              continue;
            }
            const fc = FIELD_MAPPINGS[df];
            if (!fc) continue;
            const cleaned = this.cleanValue(row[ec], fc.type, df);
            if (!this.isEmptyValue(cleaned)) raw[df] = cleaned;
          }
          if (fusedName) {
            if (!raw.firstName) raw.firstName = fusedName.firstName;
            if (!raw.lastName) raw.lastName = fusedName.lastName;
          }

          // 🆕 Salaire déduit de la grille conventionnelle (catégorie + échelon) si absent/invalide du fichier
          if (grid && (raw.professionalCategory || raw.echelon)) {
            const resolvedCategory = this.resolveConventionCategory(
              grid.categories,
              raw.professionalCategory,
              raw.echelon,
            );
            if (resolvedCategory) {
              raw.professionalCategory = resolvedCategory.code;
              raw.echelon = resolvedCategory.code; // même code que professionalCategory, comme sur la fiche employé
              const currentSalary =
                typeof raw.baseSalary === 'number'
                  ? raw.baseSalary
                  : this.cleanSalary(String(raw.baseSalary ?? '0'));
              if (
                (!currentSalary || currentSalary <= 0) &&
                resolvedCategory.minSalary
              ) {
                raw.baseSalary = resolvedCategory.minSalary;
              }
            }
          }

          // Valider les 3 durs
          if (!raw.firstName || !raw.lastName) {
            errors.push({
              row: rowNum,
              message: 'Prénom ou nom manquant — ligne ignorée',
            });
            skipped++;
            continue;
          }
          const salary =
            typeof raw.baseSalary === 'number'
              ? raw.baseSalary
              : this.cleanSalary(String(raw.baseSalary ?? '0'));
          if (!salary || salary <= 0) {
            errors.push({
              row: rowNum,
              message: 'Salaire manquant ou invalide — ligne ignorée',
            });
            skipped++;
            continue;
          }

          // Département
          let departmentId = defaultDeptId;
          if (raw.departmentName) {
            const key = String(raw.departmentName).toLowerCase();
            let did = deptCache.get(key);
            if (!did) {
              const nd = await this.prisma.department.create({
                data: {
                  name: String(raw.departmentName)
                    .split(' ')
                    .map(
                      (w: string) =>
                        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
                    )
                    .join(' '),
                  companyId: user.companyId,
                },
              });
              did = nd.id;
              deptCache.set(key, did);
            }
            departmentId = did;
          }

          // Type de contrat & date de fin
          const contractType: ContractType =
            (raw.contractType as ContractType) || ContractType.CDI;
          let contractEndDate: string | undefined;
          if (TEMP_CONTRACTS.includes(contractType)) {
            if (raw.contractEndDate instanceof Date)
              contractEndDate = raw.contractEndDate.toISOString().split('T')[0];
            else if (raw.contractEndDate)
              contractEndDate = String(raw.contractEndDate);
            else {
              const end = new Date();
              end.setMonth(end.getMonth() + 6);
              contractEndDate = end.toISOString().split('T')[0];
            }
          }

          // Email
          const slug = `${raw.firstName}.${raw.lastName}`
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9.]/g, '');
          const email =
            raw.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw.email))
              ? String(raw.email)
              : `${slug}.imp${Date.now()}@a-completer.local`;

          // Construire le DTO complet
          const dto: CreateEmployeeDto = {
            firstName: String(raw.firstName),
            lastName: String(raw.lastName),
            baseSalary: salary,
            departmentId,
            dateOfBirth:
              raw.dateOfBirth instanceof Date
                ? raw.dateOfBirth.toISOString().split('T')[0]
                : '1990-01-01',
            placeOfBirth: String(raw.placeOfBirth || 'À compléter'),
            gender: (raw.gender as Gender) || Gender.MALE,
            address: String(raw.address || 'À compléter'),
            city: String(raw.city || 'Brazzaville'),
            phone: raw.phone ? String(raw.phone) : undefined, // ✅ undefined (pas de placeholder) : compatible avec l'unicité en base
            email,
            nationalIdNumber: raw.nationalIdNumber
              ? String(raw.nationalIdNumber)
              : undefined,
            cnssNumber: raw.cnssNumber ? String(raw.cnssNumber) : undefined,
            hireDate:
              raw.hireDate instanceof Date
                ? raw.hireDate.toISOString().split('T')[0]
                : new Date().toISOString().split('T')[0],
            contractType,
            contractEndDate,
            position: String(raw.position || 'À définir'),
            maritalStatus:
              (raw.maritalStatus as MaritalStatus) || MaritalStatus.SINGLE,
            numberOfChildren:
              typeof raw.numberOfChildren === 'number'
                ? raw.numberOfChildren
                : 0,
            isSubjectToIrpp: true,
            isSubjectToCnss: true,
            paymentMethod:
              raw.bankName || raw.bankAccountNumber
                ? PaymentMethod.BANK_TRANSFER
                : raw.mobileMoneyNumber
                  ? PaymentMethod.MOBILE_MONEY
                  : PaymentMethod.CASH,
            bankName: raw.bankName ? String(raw.bankName) : undefined,
            bankAccountNumber: raw.bankAccountNumber
              ? String(raw.bankAccountNumber)
              : undefined,
            mobileMoneyNumber: raw.mobileMoneyNumber
              ? String(raw.mobileMoneyNumber)
              : undefined,
            trialPeriodDays: 0,
            isResident: true,
            // 🆕 Convention collective — catégorie/échelon (résolus depuis la grille si fournis)
            professionalCategory: raw.professionalCategory
              ? String(raw.professionalCategory)
              : undefined,
            echelon: raw.echelon ? String(raw.echelon) : undefined,
            // 🆕 Fiche ORCA — Informations complémentaires
            bloodType: raw.bloodType ? String(raw.bloodType) : undefined,
            pathology: raw.pathology ? String(raw.pathology) : undefined,
            fatherName: raw.fatherName ? String(raw.fatherName) : undefined,
            motherName: raw.motherName ? String(raw.motherName) : undefined,
            educationLevel: raw.educationLevel
              ? String(raw.educationLevel)
              : undefined,
            emergencyContactName: raw.emergencyContactName
              ? String(raw.emergencyContactName)
              : undefined,
            emergencyContactRelation: raw.emergencyContactRelation
              ? String(raw.emergencyContactRelation)
              : undefined,
            emergencyContactPhone: raw.emergencyContactPhone
              ? String(raw.emergencyContactPhone)
              : undefined,
            hasDrivingLicense:
              typeof raw.hasDrivingLicense === 'boolean'
                ? raw.hasDrivingLicense
                : undefined,
            drivingLicenseNumber: raw.drivingLicenseNumber
              ? String(raw.drivingLicenseNumber)
              : undefined,
            foreignLanguages: raw.foreignLanguages
              ? String(raw.foreignLanguages)
              : undefined,
            uniformSize: raw.uniformSize ? String(raw.uniformSize) : undefined,
            shoeSize: raw.shoeSize ? String(raw.shoeSize) : undefined,
          };

          // ✅ Passer par employeesService.create() → transaction employee + employeeContract
          await this.employeesService.create(dto, userId, {
            phoneOptional: true,
          });
          imported++;
        } catch (e: any) {
          console.error(`[Import] Ligne ${rowNum}:`, e?.message);
          errors.push({
            row: rowNum,
            message: this.formatErrorMessage(e?.message || 'Erreur inconnue'),
          });
          skipped++;
        }
      }
      return { success: skipped === 0, imported, skipped, errors };
    } catch (e: any) {
      throw new BadRequestException(`Erreur lors de l'import: ${e.message}`);
    }
  }

  generateExcelTemplate(): Buffer {
    const headers = [
      'prénom *',
      'nom *',
      'salaire (auto si catégorie+échelon)',
      'email',
      'téléphone',
      'date_naissance',
      'lieu_naissance',
      'sexe',
      'adresse',
      'ville',
      'date_embauche',
      'type_contrat',
      'poste',
      'département',
      'catégorie_convention',
      'échelon_convention',
      'cni',
      'cnss',
      'situation_familiale',
      'nombre_enfants',
      'banque',
      'numero_compte',
    ];
    const note = [
      '(obligatoire)',
      '(obligatoire)',
      '(obligatoire sauf si catégorie+échelon fournis)',
      '(recommandé)',
      '(recommandé)',
      'JJ/MM/AAAA',
      '',
      'M ou F',
      '',
      '',
      'JJ/MM/AAAA',
      'CDI/CDD/STAGE…',
      '',
      '',
      'code grille (ex: C3-E1)',
      'laisser vide si déjà dans la catégorie',
      '',
      '',
      'Célibataire/Marié…',
      '',
      '',
      '',
    ];
    const ex1 = [
      'Jean',
      'DUPONT',
      '500000',
      'jean.dupont@example.com',
      '066-123-456',
      '01/01/1990',
      'Brazzaville',
      'M',
      '123 Av. Liberté',
      'Brazzaville',
      '01/01/2026',
      'CDI',
      'Développeur',
      'IT',
      '',
      '',
      '123456789',
      'CNSS123',
      'Marié',
      '2',
      'BGFI Bank',
      '0123456789',
    ];
    const ex2 = [
      'Marie',
      'MOUKOKO',
      '',
      'marie@example.com',
      '065 234 567',
      '15/05/1988',
      'Pointe-Noire',
      'F',
      '45 Rue Paix',
      'Pointe-Noire',
      '15/03/2025',
      'CDD',
      'Comptable',
      'Finance',
      'C3-E1',
      '',
      '',
      '',
      'Célibataire',
      '0',
      '',
      '',
    ];
    const ex3 = [
      'Paul',
      'NTARI',
      '150000',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, note, ex1, ex2, ex3]);
    ws['!cols'] = headers.map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employés');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  private normalizeString(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private parseDate(dateStr: string): Date {
    if (!dateStr) return new Date('1990-01-01');
    const f1 = /^(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})$/;
    const f2 = /^(\d{4})[\/\-\.](\d{2})[\/\-\.](\d{2})$/;
    let m = dateStr.match(f1);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    m = dateStr.match(f2);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const p = Date.parse(dateStr);
    return isNaN(p) ? new Date('1990-01-01') : new Date(p);
  }

  private formatErrorMessage(msg: string): string {
    if (msg.includes('P2002') || msg.includes('Unique constraint'))
      return 'Doublon — email ou matricule déjà existant';
    if (msg.includes('P2003') || msg.includes('Foreign key'))
      return 'Référence invalide';
    if (msg.includes('Champs obligatoires manquants'))
      return `Champs manquants : ${msg.substring(0, 100)}`;
    if (msg.includes('P2000')) return 'Valeur trop longue pour un champ';
    return msg.substring(0, 150);
  }
}
