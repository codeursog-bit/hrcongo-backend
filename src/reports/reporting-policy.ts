/** Même périmètre que les totaux de la page Paie : tous les bulletins hors annulation. */
export const REPORT_PAYROLL_STATUS = {not:'CANCELLED' as const};
export const CONFIRMED_PAYROLL_STATUSES = ['VALIDATED','TO_PAY','PAID'] as const;
export const payrollReportingWhere=(companyId:string,month?:number,year?:number)=>({companyId,...(month?{month}:{}),...(year?{year}:{}),status:REPORT_PAYROLL_STATUS});
export const reportMonthStart=(year:number,month:number)=>new Date(Date.UTC(year,month-1,1)-3600000);
