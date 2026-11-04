import { CabinetMemberGuard, CabinetAdminGuard, CabinetCompanyIsolationGuard } from './guards/cabinet.guards';
import { canAccessCabinetPath } from '../../../frontend/lib/cabinet-access';

const context = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;
describe('Cabinet access boundaries', () => {
  it('loads the current membership role and rejects disabled cabinets', async () => {
    const req: any = { params: { cabinetId: 'cabinet' }, user: { userId: 'user', role: 'CABINET_ADMIN' } };
    const findUnique = jest.fn().mockResolvedValue({ role: 'GESTIONNAIRE', cabinet: { isActive: true } });
    const guard = new CabinetMemberGuard({ cabinetUser: { findUnique } } as any);
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.cabinetRole).toBe('GESTIONNAIRE');
    expect(() => new CabinetAdminGuard().canActivate(context(req))).toThrow();
    findUnique.mockResolvedValue({ role: 'CABINET_ADMIN', cabinet: { isActive: false } });
    await expect(guard.canActivate(context(req))).rejects.toThrow();
    findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(context(req))).rejects.toThrow();
  });
  it('initializes the superadmin context before checking admin-only actions', async () => {
    const req: any = { params: { cabinetId: 'cabinet' }, user: { role: 'SUPER_ADMIN' } };
    await new CabinetMemberGuard({} as any).canActivate(context(req));
    expect(req.cabinetId).toBe('cabinet');
    expect(new CabinetAdminGuard().canActivate(context(req))).toBe(true);
  });
  it('rejects foreign and inactive company links', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const guard = new CabinetCompanyIsolationGuard({ cabinetCompany: { findUnique } } as any);
    const req = { params: { cabinetId: 'cabinet', companyId: 'company' }, user: { role: 'CABINET_GESTIONNAIRE' } };
    await expect(guard.canActivate(context(req))).rejects.toThrow();
    findUnique.mockResolvedValue({ isActive: false });
    await expect(guard.canActivate(context(req))).rejects.toThrow();
    findUnique.mockResolvedValue({ isActive: true });
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { cabinetId_companyId: { cabinetId: 'cabinet', companyId: 'company' } } }));
  });
  it.each(['ajouter-pme','abonnement','gestionnaires','parametres','cloture','entreprise/company/acces','entreprise/company/parametres'])('hides and blocks admin page %s for managers', path => {
    expect(canAccessCabinetPath('GESTIONNAIRE', `/cabinet/cabinet/${path}`, 'cabinet')).toBe(false);
    expect(canAccessCabinetPath('CABINET_ADMIN', `/cabinet/cabinet/${path}`, 'cabinet')).toBe(true);
  });
  it.each(['dashboard','mes-pme','entreprise/company/employes','entreprise/company/recrutement/nouvelle','entreprise/company/bulletins/payroll'])('allows manager dossier page %s', path => {
    expect(canAccessCabinetPath('GESTIONNAIRE', `/cabinet/cabinet/${path}`, 'cabinet')).toBe(true);
  });
  it('does not accept a path belonging to another cabinet', () => {
    expect(canAccessCabinetPath('CABINET_ADMIN', '/cabinet/other/dashboard', 'cabinet')).toBe(false);
  });
});
