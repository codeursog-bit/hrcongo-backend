export function deadlineUrgency(days:number):'danger'|'warning'|'neutral' {
  return days<=7?'danger':days<=30?'warning':'neutral';
}
export function contractDeadlines(contracts:any[], legacy:any[], now=new Date()) {
  const rows:any[]=[];
  const add=(id:string,employee:any,type:string,value:Date|string|null|undefined,kind:string)=>{
    if(!value)return;const due=new Date(value);if(!Number.isFinite(due.getTime()))return;
    const daysLeft=Math.ceil((due.getTime()-now.getTime())/86400000);
    if(daysLeft < -14 || daysLeft>90)return;
    rows.push({id:`${id}:${kind}`,employee:{id:employee.id,firstName:employee.firstName,lastName:employee.lastName},contractType:type,kind,dueAt:due.toISOString(),daysLeft,urgency:deadlineUrgency(daysLeft)});
  };
  for(const c of contracts){if(c.employee?.status && c.employee.status!=='ACTIVE')continue;
    if(c.contractType!=='CDI')add(c.id,c.employee,c.contractType,c.endDate,'CONTRACT');
    if(!c.trialConfirmedAt)add(c.id,c.employee,c.contractType,c.trialEndDate,'TRIAL');
  }
  for(const e of legacy){if(e.contractType!=='CDI')add(e.id,e,e.contractType,e.contractEndDate,'CONTRACT');
    if(['IN_PROGRESS','EXPIRED'].includes(e.trialStatus))add(e.id,e,e.contractType,e.trialEndDate,'TRIAL');
  }
  return rows.sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt)).slice(0,12);
}
