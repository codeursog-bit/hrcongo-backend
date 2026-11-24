import { EmployeesService } from './employees.service';
jest.mock('bcrypt',()=>({hash:jest.fn(),compare:jest.fn()}));
describe('Supprimer une fiche sans déclarer un départ',()=>{
  const setup=(role='ADMIN',companyId='company')=>{
    const tx={user:{findFirst:jest.fn(async(_query:any)=>({id:'linked'})),update:jest.fn(async()=>({}))},userSession:{updateMany:jest.fn(async()=>({count:1}))},employee:{update:jest.fn(async({data})=>({id:'employee',...data}))}};
    const prisma={employee:{findUnique:jest.fn(async()=>({id:'employee',companyId,departmentId:'rh',email:'person@example.test',status:'ACTIVE'}))},$transaction:jest.fn(async callback=>callback(tx))};
    const context={prisma,getVerifiedUser:async()=>({id:'admin',role,companyId:'company'}),applyCompanyOverride:async()=>{}};
    return {tx,prisma,context};
  };
  it('marque la fiche comme supprimée, préserve ses données d’emploi et désactive le compte lié',async()=>{
    const {context,prisma,tx}=setup();
    await EmployeesService.prototype.remove.call(context,'employee','admin');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const data=tx.employee.update.mock.calls[0][0].data;
    expect(data.recordDeletedAt).toBeInstanceOf(Date);expect(data.recordDeletedBy).toBe('admin');
    expect(data).not.toHaveProperty('terminationDate');expect(data).not.toHaveProperty('status');
    expect(tx.user.update).toHaveBeenCalledWith({where:{id:'linked'},data:{isActive:false}});
    expect(tx.userSession.updateMany).toHaveBeenCalledWith({where:{userId:'linked',revokedAt:null},data:{revokedAt:data.recordDeletedAt}});
  });
  it('refuse une suppression interentreprise sans modifier la fiche ni le compte',async()=>{
    const {context,prisma,tx}=setup('ADMIN','other-company');
    await expect(EmployeesService.prototype.remove.call(context,'employee','admin')).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();expect(tx.user.update).not.toHaveBeenCalled();
  });
  it('conserve le contrôle de rôle et ne désactive jamais le compte de l’auteur',async()=>{
    const forbidden=setup('EMPLOYEE');
    await expect(EmployeesService.prototype.remove.call(forbidden.context,'employee','admin')).rejects.toThrow();
    expect(forbidden.prisma.employee.findUnique).not.toHaveBeenCalled();
    const {context,tx}=setup();await EmployeesService.prototype.remove.call(context,'employee','admin');
    expect(tx.user.findFirst.mock.calls[0][0].where.id).toEqual({not:'admin'});
  });
});
