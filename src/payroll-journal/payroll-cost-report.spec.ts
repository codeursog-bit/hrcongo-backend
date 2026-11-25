import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PayrollCostReportService } from './payroll-cost-report.service';
import { PayrollCostEmployeesQueryDto } from './dto/payroll-cost-query.dto';

describe('Rapport de coûts paginé',()=>{
  function setup() {
    const prisma={payroll:{count:jest.fn().mockResolvedValue(101),findMany:jest.fn().mockResolvedValue([])},payrollForeignPay:{aggregate:jest.fn().mockResolvedValue({_sum:{grossAmount:700,netAmount:600},_count:{_all:1}})},$transaction:jest.fn()};
    prisma.$transaction.mockImplementation(callback=>callback(prisma));
    const journal={resolveCompanyId:jest.fn().mockResolvedValue('verified-company')};
    const costs={get:jest.fn().mockResolvedValue({gross:713388})};
    return {prisma,journal,costs,service:new PayrollCostReportService(prisma as any,journal as any,costs as any)};
  }
  it('lit les agrégats sans charger les bulletins et sépare la paie étrangère',async()=>{
    const {service,prisma,costs,journal}=setup();
    const result=await service.overview('session-user',{month:11,year:2026,companyId:'requested-company'});
    expect(journal.resolveCompanyId).toHaveBeenCalledWith('session-user','requested-company');
    expect(costs.get).toHaveBeenCalledWith('verified-company',11,2026);
    expect(prisma.payroll.findMany).not.toHaveBeenCalled();
    expect(result.summary).toEqual({foreignGross:700,foreignNet:600});
    expect(prisma.payrollForeignPay.aggregate.mock.calls[0][0].where.companyId).toBe('verified-company');
  });
  it('pagine en base, scope les filtres et conserve les salariés supprimés dans l’historique',async()=>{
    const {service,prisma}=setup();
    await service.employees('session-user',Object.assign(new PayrollCostEmployeesQueryDto(),{month:11,year:2026,page:2,limit:20,search:'Laure',contractType:'CDD'}));
    const query=prisma.payroll.findMany.mock.calls[0][0];
    expect(query.skip).toBe(20);expect(query.take).toBe(20);
    expect(query.where).toMatchObject({companyId:'verified-company',month:11,year:2026,status:{not:'CANCELLED'},employee:{companyId:'verified-company',recordDeletedAt:{},contractType:'CDD'}});
    expect(query.where.employee.status).toBeUndefined();
    expect(query.select.items.where.OR).toContainEqual({code:null});
    expect(query.orderBy).toEqual([{totalEmployerCost:'desc'},{id:'asc'}]);
  });
  it('interrompt toute lecture si la société demandée est refusée',async()=>{
    const {service,prisma,journal,costs}=setup();journal.resolveCompanyId.mockRejectedValue(new Error('Forbidden'));
    await expect(service.overview('user',{month:11,year:2026})).rejects.toThrow('Forbidden');
    expect(costs.get).not.toHaveBeenCalled();expect(prisma.payrollForeignPay.aggregate).not.toHaveBeenCalled();
  });
  it('valide période, limite, UUID et tri avant toute requête',async()=>{
    const bad=plainToInstance(PayrollCostEmployeesQueryDto,{month:'13',year:'1990',limit:'1000',page:'0',companyId:'other',sort:'password',direction:'raw',search:'x'.repeat(101)});
    const errors=await validate(bad);
    expect(errors.map(error=>error.property)).toEqual(expect.arrayContaining(['month','year','limit','page','companyId','sort','direction','search']));
    expect(await validate(plainToInstance(PayrollCostEmployeesQueryDto,{month:'11',year:'2026'}))).toHaveLength(0);
  });
});
