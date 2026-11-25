import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollJournalService } from './payroll-journal.service';
import { PayrollCostSummaryService } from './payroll-cost-summary.service';
import { PayrollCostEmployeesQueryDto, PayrollCostQueryDto } from './dto/payroll-cost-query.dto';
import { NON_TAXABLE_EXCLUSIONS } from './payroll-cost-details';

@Injectable()
export class PayrollCostReportService {
  constructor(private readonly prisma: PrismaService, private readonly journal: PayrollJournalService, private readonly costs: PayrollCostSummaryService) {}

  async overview(userId: string, query: PayrollCostQueryDto) {
    const companyId = await this.journal.resolveCompanyId(userId, query.companyId);
    const [costSummary, foreign] = await Promise.all([
      this.costs.get(companyId, query.month, query.year),
      this.prisma.payrollForeignPay.aggregate({where:{companyId,month:query.month,year:query.year},_sum:{grossAmount:true,netAmount:true},_count:{_all:true}}),
    ]);
    return {month:query.month,year:query.year,costSummary,options:{hasExpat:foreign._count._all>0},summary:{foreignGross:Number(foreign._sum.grossAmount??0),foreignNet:Number(foreign._sum.netAmount??0)}};
  }

  async employees(userId: string, query: PayrollCostEmployeesQueryDto) {
    const companyId = await this.journal.resolveCompanyId(userId, query.companyId);
    const search = query.search?.trim();
    const employee: Prisma.EmployeeWhereInput = {companyId,recordDeletedAt:{},
      ...(query.departmentId?{departmentId:query.departmentId}:{}),
      ...(query.contractType?{contractType:query.contractType}:{}),
      ...(query.category?{professionalCategory:query.category}:{}),
      ...(search?{OR:['firstName','lastName','employeeNumber'].map(field=>({[field]:{contains:search,mode:'insensitive'}}))}:{}),
    };
    const where: Prisma.PayrollWhereInput={companyId,month:query.month,year:query.year,status:{not:'CANCELLED'},employee};
    return this.prisma.$transaction(async tx=>{
      const total=await tx.payroll.count({where});
      const pages=Math.max(1,Math.ceil(total/query.limit)),page=Math.min(query.page,pages);
      const records=await tx.payroll.findMany({where,skip:(page-1)*query.limit,take:query.limit,
        orderBy:[{[query.sort]:query.direction},{id:'asc'}],
        select:{id:true,status:true,grossSalary:true,netSalary:true,totalDeductions:true,totalEmployerCost:true,cnssEmployer:true,tusTotal:true,employerCustomTaxTotal:true,
          employee:{select:{id:true,firstName:true,lastName:true,employeeNumber:true,department:{select:{name:true}},contractType:true,professionalCategory:true}},
          items:{where:{type:'GAIN',isTaxable:false,isCnss:false,OR:[{code:null},{code:{notIn:NON_TAXABLE_EXCLUSIONS}}]},select:{amount:true}}},
      });
      return {page,limit:query.limit,total,pages,rows:records.map(({items,...row})=>({...row,grossSalary:Number(row.grossSalary),netSalary:Number(row.netSalary),totalDeductions:Number(row.totalDeductions),totalEmployerCost:Number(row.totalEmployerCost),employerCharges:Number(row.cnssEmployer)+Number(row.tusTotal)+Number(row.employerCustomTaxTotal),outsideGross:items.reduce((sum,item)=>sum+Number(item.amount),0)}))};
    },{isolationLevel:'RepeatableRead'});
  }
}
