/** Administrative completeness and payroll settings, not proof of a monthly filing. */
export function employeeRegistrationSummary(employees: ReadonlyArray<{
  cnssNumber: string | null;
  cnssEmployeeDeclared?: boolean | null;
  isSubjectToCnss: boolean;
  isSubjectToIrpp: boolean;
}>) {
  return {
    cnss: {
      declared: employees.filter(e => e.cnssEmployeeDeclared === true).length,
      notDeclared: employees.filter(e => e.cnssEmployeeDeclared === false).length,
      unverified: employees.filter(e => e.cnssEmployeeDeclared == null).length,
      numberRecorded: employees.filter(e => Boolean(e.cnssNumber?.trim())).length,
      numberMissing: employees.filter(e => !e.cnssNumber?.trim()).length,
      contributionEnabled: employees.filter(e => e.isSubjectToCnss).length,
      contributionDisabled: employees.filter(e => !e.isSubjectToCnss).length,
      contributionEnabledWithoutNumber: employees.filter(e => e.isSubjectToCnss && !e.cnssNumber?.trim()).length,
    },
    incomeTax: {
      withholdingEnabled: employees.filter(e => e.isSubjectToIrpp).length,
      withholdingDisabled: employees.filter(e => !e.isSubjectToIrpp).length,
    },
  };
}
