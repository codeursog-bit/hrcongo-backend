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
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
