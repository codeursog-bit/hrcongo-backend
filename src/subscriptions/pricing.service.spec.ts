import { PricingService } from './pricing.service';
import { PublicPlansController } from './public-plans.controller';

describe('Superadmin pricing catalog', () => {
  let rows: any[];
  let pricing: PricingService;
  beforeEach(() => {
    rows = [];
    const prisma = { planPrice: {
      findMany: jest.fn(async () => rows),
      upsert: jest.fn(async ({ create, update }: any) => {
        const previous = rows.find(row => row.plan === create.plan);
        if (previous) { Object.assign(previous, update); return previous; }
        rows.push(create); return create;
      }),
      deleteMany: jest.fn(async ({ where }: any) => { rows = rows.filter(row => row.plan !== where.plan); }),
    } };
    pricing = new PricingService(prisma as any);
  });

  it('never invents paid prices when the table is empty', async () => {
    const plans = await pricing.getPlans();
    expect(plans.FREE.priceMonthly).toBe(0);
    for (const key of ['BASIC', 'PRO', 'ENTERPRISE']) {
      expect(plans[key].priceMonthly).toBeNull();
      expect(plans[key].priceYearly).toBeNull();
      expect(plans[key].isPriceConfigured).toBe(false);
    }
    await expect(pricing.getPrice('PRO', 'monthly')).rejects.toThrow();
  });

  it('returns exactly the monthly and annual amounts saved by the superadmin', async () => {
    await pricing.updatePrice('PRO', { priceMonthly: 43210, priceYearly: 321987 }, 'admin');
    expect(await pricing.getPrice('PRO', 'monthly')).toBe(43210);
    expect(await pricing.getPrice('PRO', 'yearly')).toBe(321987);
    await pricing.updatePrice('PRO', { priceMonthly: 65432, priceYearly: 456789 }, 'admin');
    expect((await pricing.getPlans()).PRO.priceMonthly).toBe(65432);
  });

  it('publishes the same catalog without exposing pricing administration fields', async () => {
    await pricing.updatePrice('BASIC', { priceMonthly: 12345, priceYearly: 98765 }, 'private-admin-id');
    const response = await new PublicPlansController(pricing).getPlans();
    expect(response.plans.BASIC.priceYearly).toBe(98765);
    expect(JSON.stringify(response)).not.toContain('private-admin-id');
    expect(JSON.stringify(response)).not.toContain('updatedByUserId');
  });

  it('removes a tariff without restoring a price from source code', async () => {
    await pricing.updatePrice('PRO', { priceMonthly: 12345, priceYearly: 98765 }, 'admin');
    await pricing.resetPrice('PRO');
    expect((await pricing.getPlans()).PRO.priceMonthly).toBeNull();
    const admin = await pricing.listForAdmin();
    expect(admin.find(row => row.plan === 'PRO')).toMatchObject({ priceMonthly: null, isPriceConfigured: false });
  });
  it('requires an explicit annual price instead of inventing a discount', async () => {
    await expect(pricing.updatePrice('PRO', { priceMonthly: 12345 } as any, 'admin')).rejects.toThrow();
    expect((await pricing.getPlans()).PRO.priceMonthly).toBeNull();
  });
});
