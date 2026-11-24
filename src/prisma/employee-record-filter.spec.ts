import { employeeRecordFilter } from './employee-record-filter';
describe('Fiches supprimées : lecture et historique',()=>{
  it('masque les fiches dans les listes, compteurs et accès directs',async()=>{
    for(const action of ['findMany','findUnique','count','aggregate','update']){
      const args:any={model:'Employee',action,args:{where:{id:'employee'}}};
      await employeeRecordFilter(args,async params=>params);
      expect(args.args.where).toEqual({id:'employee',recordDeletedAt:null});
    }
  });
  it('garde une lecture explicite des suppressions pour le registre',async()=>{
    const args:any={model:'Employee',action:'findMany',args:{where:{recordDeletedAt:{}}}};
    await employeeRecordFilter(args,async params=>params);expect(args.args.where).toEqual({recordDeletedAt:{}});
  });
  it('filtre aussi les listes et compteurs imbriqués des départements',async()=>{
    const args:any={model:'Department',action:'findMany',args:{include:{employees:{where:{status:'ACTIVE'}},_count:{select:{employees:true}}}}};
    await employeeRecordFilter(args,async params=>params);
    expect(args.args.include.employees.where).toEqual({status:'ACTIVE',recordDeletedAt:null});
    expect(args.args.include._count.select.employees.where).toEqual({recordDeletedAt:null});
  });
  it('conserve le lien d’un bulletin vers son employé et ne filtre pas les montants historiques',async()=>{
    const args:any={model:'Payroll',action:'findMany',args:{where:{companyId:'company'},include:{employee:{select:{firstName:true}}}}};
    await employeeRecordFilter(args,async params=>params);
    expect(args.args.where).toEqual({companyId:'company'});expect(args.args.include.employee).toEqual({select:{firstName:true}});
  });
});
