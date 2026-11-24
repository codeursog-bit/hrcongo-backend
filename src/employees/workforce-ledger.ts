/** Une fiche supprimée n'est pas une fin d'emploi. Une date seule n'est pas une preuve de départ. */
export interface WorkforceRecord {
  id:string; hireDate:Date|string; status:string; terminationDate?:Date|string|null;
  terminationReason?:string|null; trialStatus?:string; recordDeletedAt?:Date|string|null;
  recordDeletedStatus?:string|null;
  department?:{id?:string;name:string}|null; [key:string]:any;
}
export interface ExitRecord {employeeId:string;ruptureDate:Date|string;ruptureType:string;status:string}
const confirmed=new Set(['VALIDE','PAYE','CONTESTE','ARCHIVE']);
const stamp=(value:Date|string|null|undefined)=>value?new Date(value).getTime():NaN;
export function buildWorkforceLedger<T extends WorkforceRecord>(records:T[],ruptures:ExitRecord[],now=new Date()) {
  const byEmployee=new Map<string,ExitRecord[]>();
  for(const exit of ruptures)if(confirmed.has(exit.status)&&stamp(exit.ruptureDate)<=now.getTime()) {
    const list=byEmployee.get(exit.employeeId)||[];list.push(exit);byEmployee.set(exit.employeeId,list);
  }
  const entries=records.map(record=>{
    const ended=['TERMINATED','RETIRED'].includes(record.status);
    const documented=ended?(byEmployee.get(record.id)||[]).filter(exit=>stamp(exit.ruptureDate)>=stamp(record.hireDate)).sort((a,b)=>stamp(a.ruptureDate)-stamp(b.ruptureDate))[0]:undefined;
    const explicitLegacy=ended&&stamp(record.terminationDate)<=now.getTime()&&
      (record.trialStatus==='FAILED'||((!record.recordDeletedAt||['TERMINATED','RETIRED'].includes(record.recordDeletedStatus||''))&&!!record.terminationReason?.trim()));
    const exitDate=documented?new Date(documented.ruptureDate):explicitLegacy?new Date(record.terminationDate!):null;
    return {...record,exitDate,exitType:documented?.ruptureType||(record.trialStatus==='FAILED'?'FIN_PERIODE_ESSAI':record.status==='RETIRED'?'RETRAITE':exitDate?'AUTRE_DEPART_CONFIRME':null),
      isCurrent:!record.recordDeletedAt&&record.status==='ACTIVE'&&!exitDate,
      unconfirmedDeparture:ended&&!record.recordDeletedAt&&!exitDate};
  });
  // Même périmètre que la liste des employés : actifs, complétés des vrais départs pour l'historique.
  const employment=entries.filter(record=>record.isCurrent||!!record.exitDate);
  const headcountAt=(at:Date)=>employment.filter(record=>stamp(record.hireDate)<=at.getTime()&&(!record.exitDate||stamp(record.exitDate)>at.getTime())).length;
  return {entries,employment,current:entries.filter(record=>record.isCurrent),
    departures:employment.filter(record=>!!record.exitDate),deletions:entries.filter(record=>!!record.recordDeletedAt),
    unconfirmedDepartures:entries.filter(record=>record.unconfirmedDeparture),headcountAt};
}
