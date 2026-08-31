import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const employees = await prisma.employee.findMany({
    where: { status: { not: 'TERMINATED' } },
    include: { contracts: { take: 1 } },
  });

  let count = 0;
  for (const emp of employees) {
    if (emp.contracts.length > 0) continue;
    await prisma.employeeContract.create({
      data: {
        employeeId: emp.id,
        companyId: emp.companyId,
        contractType: emp.contractType as any,
        startDate: emp.hireDate,
        endDate: emp.contractEndDate ?? null,
        position: emp.position,
        baseSalary: emp.baseSalary,
        departmentId: emp.departmentId,
        status: 'ACTIVE',
        notes: 'Migré automatiquement',
      },
    });
    count++;
  }
  console.log(`✅ ${count} employés migrés sur ${employees.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
