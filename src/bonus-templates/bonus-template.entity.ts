export interface BonusTemplateEntity {
  id: string;
  companyId: string;
  name: string;
  defaultAmount: number | null;
  defaultPercentage: number | null;
  baseCalculation: 'BASE_SALARY' | 'GROSS_SALARY' | null;
  isRecurring: boolean;
  isTaxable: boolean;
  isCnss: boolean;
  // ✅ Avantage EN NATURE (logement, véhicule, téléphone fournis par
  // l'employeur) vs prime EN ESPÈCES. Orthogonal à isTaxable/isCnss : un
  // avantage en nature reste normalement imposable (isTaxable=true,
  // isCnss=true) — ce flag ne change pas le calcul ITS/CNSS/TUS, il sert
  // uniquement à isoler le montant sur une ligne "Avantages en nature"
  // séparée dans les rapports/DAS, au lieu de le mélanger aux indemnités
  // en espèces (transport, panier...). Le RH reste seul responsable de le
  // cocher correctement à la création de la prime.
  isNature: boolean;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}