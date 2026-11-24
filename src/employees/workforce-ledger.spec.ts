import { buildWorkforceLedger, WorkforceRecord } from './workforce-ledger';
describe('Mouvements réels et suppressions de fiches',()=>{
  const now=new Date('2026-11-24T12:00:00Z');
  const employee=(id:string,extra:any={}):WorkforceRecord=>({id,status:'ACTIVE',hireDate:new Date('2026-01-01'),department:{id:'rh',name:'RH'},...extra});
  it('une suppression ne crée ni départ ni turnover, même si une ancienne date erronée existe',()=>{
    const ledger=buildWorkforceLedger([employee('ok'),employee('deleted',{status:'TERMINATED',terminationDate:new Date('2026-11-20'),recordDeletedAt:new Date('2026-11-20')})],[],now);
    expect(ledger.current.map(e=>e.id)).toEqual(['ok']);expect(ledger.departures).toHaveLength(0);
    expect(ledger.deletions).toHaveLength(1);expect(ledger.headcountAt(now)).toBe(1);
  });
  it('compte une rupture effective une seule fois, exclut les brouillons et les dates futures',()=>{
    const records=[employee('left',{status:'TERMINATED'}),employee('future'),employee('draft',{status:'TERMINATED'})];
    const exits:any[]=[{employeeId:'left',ruptureDate:'2026-11-12',ruptureType:'DEMISSION',status:'VALIDE'},
      {employeeId:'left',ruptureDate:'2026-11-12',ruptureType:'DEMISSION',status:'PAYE'},
      {employeeId:'future',ruptureDate:'2027-01-01',ruptureType:'FIN_CDD',status:'VALIDE'},
      {employeeId:'draft',ruptureDate:'2026-11-11',ruptureType:'FIN_CDD',status:'CALCULE'}];
    const ledger=buildWorkforceLedger(records,exits,now);
    expect(ledger.departures.map(e=>e.id)).toEqual(['left']);expect(ledger.current.map(e=>e.id)).toEqual(['future']);
    expect(ledger.unconfirmedDepartures.map(e=>e.id)).toEqual(['draft']);
  });
  it('conserve une vraie sortie passée même si la fiche est ensuite supprimée',()=>{
    const ledger=buildWorkforceLedger([employee('left',{status:'TERMINATED',recordDeletedAt:'2026-11-23'})],[{employeeId:'left',ruptureDate:'2026-11-12',ruptureType:'FIN_CDD',status:'VALIDE'}],now);
    expect(ledger.departures).toHaveLength(1);expect(ledger.deletions).toHaveLength(1);
    expect(ledger.headcountAt(new Date('2026-11-01'))).toBe(1);expect(ledger.headcountAt(now)).toBe(0);
  });
  it('reconnaît une fin d’essai et un départ explicite, pas une simple date de fin prévue',()=>{
    const ledger=buildWorkforceLedger([employee('trial',{status:'TERMINATED',trialStatus:'FAILED',terminationDate:'2026-11-16'}),
      employee('retired',{status:'RETIRED',terminationDate:'2026-11-10',terminationReason:'Retraite confirmée'}),
      employee('planned',{terminationDate:'2026-11-15'})],[],now);
    expect(ledger.departures.map(e=>e.exitType)).toEqual(['FIN_PERIODE_ESSAI','RETRAITE']);
    expect(ledger.current.map(e=>e.id)).toEqual(['planned']);
  });
  it('ignore la rupture d’un ancien contrat si une nouvelle embauche a eu lieu depuis',()=>{
    const ledger=buildWorkforceLedger([employee('rehired',{hireDate:'2026-11-01'})],[{employeeId:'rehired',ruptureDate:'2026-03-01',status:'PAYE',ruptureType:'FIN_CDD'}],now);
    expect(ledger.current).toHaveLength(1);expect(ledger.departures).toHaveLength(0);
  });
  it('préserve le départ manuel déjà confirmé avant une suppression de fiche',()=>{
    const ledger=buildWorkforceLedger([employee('manual',{status:'TERMINATED',recordDeletedStatus:'TERMINATED',terminationDate:'2026-11-10',terminationReason:'Fin de contrat confirmée',recordDeletedAt:'2026-11-22'})],[],now);
    expect(ledger.departures).toHaveLength(1);expect(ledger.deletions).toHaveLength(1);
  });
});
