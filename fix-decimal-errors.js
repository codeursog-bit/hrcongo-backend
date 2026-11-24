// fix-decimal-errors.js - Script de correction automatique des erreurs Decimal
const fs = require('fs');
const path = require('path');

console.log('🔧 Début de la correction automatique des erreurs TypeScript...\n');

// Configuration des fichiers à corriger
const fixes = [
  // assets.service.ts
  {
    file: 'src/assets/assets.service.ts',
    replacements: [
      {
        search: /status: employeeId \? AssetStatus\.ASSIGNED : \(status \|\| AssetStatus\.AVAILABLE\),/g,
        replace: 'status: (employeeId ? AssetStatus.ASSIGNED : (status || AssetStatus.AVAILABLE)) as AssetStatus,'
      },
      {
        search: /status: employeeId \? AssetStatus\.ASSIGNED : AssetStatus\.AVAILABLE$/gm,
        replace: 'status: (employeeId ? AssetStatus.ASSIGNED : AssetStatus.AVAILABLE) as AssetStatus'
      }
    ]
  },
  
  // attendance-summary.service.ts
  {
    file: 'src/attendance/attendance-summary.service.ts',
    replacements: [
      {
        search: /sum \+ \(r\.normalHours \|\| 0\)/g,
        replace: 'sum + Number(r.normalHours || 0)'
      },
      {
        search: /sum \+ \(r\.overtime15 \|\| 0\)/g,
        replace: 'sum + Number(r.overtime15 || 0)'
      },
      {
        search: /sum \+ \(r\.overtime50 \|\| 0\)/g,
        replace: 'sum + Number(r.overtime50 || 0)'
      },
      {
        search: /sum \+ s\.normalHours/g,
        replace: 'sum + Number(s.normalHours)'
      },
      {
        search: /sum \+ s\.overtime15Hours \+ s\.overtime50Hours/g,
        replace: 'sum + Number(s.overtime15Hours) + Number(s.overtime50Hours)'
      }
    ]
  },
  
  // attendance.service.ts
  {
    file: 'src/attendance/attendance.service.ts',
    replacements: [
      {
        search: /totalHours: attendance\?\.totalHours \?\? undefined,/g,
        replace: 'totalHours: attendance?.totalHours ? Number(attendance.totalHours) : undefined,'
      },
      {
        search: /overtime15: attendance\?\.overtime15 \?\? undefined,/g,
        replace: 'overtime15: attendance?.overtime15 ? Number(attendance.overtime15) : undefined,'
      },
      {
        search: /overtime50: attendance\?\.overtime50 \?\? undefined/g,
        replace: 'overtime50: attendance?.overtime50 ? Number(attendance.overtime50) : undefined'
      },
      {
        search: /company\.latitude, company\.longitude/g,
        replace: 'Number(company.latitude), Number(company.longitude)'
      },
      {
        search: /this\.calculateOvertime\(totalHours, normalDaily\)/g,
        replace: 'this.calculateOvertime(totalHours, Number(normalDaily))'
      },
      {
        search: /status: updates\.status \|\| current\.status,/g,
        replace: 'status: (updates.status || current.status) as AttendanceStatus,'
      },
      {
        search: /data: notifications$/gm,
        replace: 'data: notifications.map(n => ({ ...n, type: n.type as NotificationType }))'
      }
    ]
  },
  
  // companies.service.ts
  {
    file: 'src/companies/companies.service.ts',
    replacements: [
      {
        search: /itsBrackets:/g,
        replace: 'taxBrackets:'
      }
    ]
  },
  
  // departments.service.ts
  {
    file: 'src/departments/departments.service.ts',
    replacements: [
      {
        search: /sum \+ \(emp\.payrolls\[0\]\?\.grossSalary \|\| 0\)/g,
        replace: 'sum + Number(emp.payrolls[0]?.grossSalary || 0)'
      },
      {
        search: /sum \+ \(emp\.payrolls\[0\]\?\.netSalary \|\| 0\)/g,
        replace: 'sum + Number(emp.payrolls[0]?.netSalary || 0)'
      },
      {
        search: /empSum \+ \(emp\.payrolls\[0\]\?\.grossSalary \|\| 0\)/g,
        replace: 'empSum + Number(emp.payrolls[0]?.grossSalary || 0)'
      }
    ]
  },
  
  // leaves.service.ts
  {
    file: 'src/leaves/leaves.service.ts',
    replacements: [
      {
        search: /if \(balance\.annualRemaining < workingDays\)/g,
        replace: 'if (Number(balance.annualRemaining) < workingDays)'
      },
      {
        search: /type: createLeaveDto\.type,$/gm,
        replace: 'type: createLeaveDto.type as LeaveType,'
      }
    ]
  },
  
  // loans.service.ts
  {
    file: 'src/loans/loans.service.ts',
    replacements: [
      {
        search: /employee\.baseSalary \* MAX_LOAN_RATIO/g,
        replace: 'Number(employee.baseSalary) * MAX_LOAN_RATIO'
      },
      {
        search: /employee\.baseSalary \* 0\.75/g,
        replace: 'Number(employee.baseSalary) * 0.75'
      },
      {
        search: /employee\.baseSalary \* MAX_ADVANCE_RATIO/g,
        replace: 'Number(employee.baseSalary) * MAX_ADVANCE_RATIO'
      },
      {
        search: /loan\.remainingBalance - loan\.monthlyRepayment/g,
        replace: 'Number(loan.remainingBalance) - Number(loan.monthlyRepayment)'
      },
      {
        search: /sum \+ loan\.monthlyRepayment/g,
        replace: 'sum + Number(loan.monthlyRepayment)'
      }
    ]
  },
  
  // settings.service.ts
  {
    file: 'src/payroll/settings/settings.service.ts',
    replacements: [
      {
        search: /Number\(settings\.workHoursPerDay\) \* settings\.workDaysPerMonth/g,
        replace: 'Number(settings?.workHoursPerDay || 8) * Number(settings?.workDaysPerMonth || 22)'
      }
    ]
  },
  
  // payrolls.service.ts
  {
    file: 'src/payrolls/payrolls.service.ts',
    replacements: [
      {
        search: /companyId: user\.companyId,$/gm,
        replace: 'companyId: user.companyId!,'
      },
      {
        search: /summary\.overtime15Hours,$/gm,
        replace: 'Number(summary.overtime15Hours),'
      }
    ]
  },
  
  // recruitment.service.ts
  {
    file: 'src/recruitment/recruitment.service.ts',
    replacements: [
      {
        search: /type: data\.contractType,$/gm,
        replace: 'type: data.contractType as ContractType,'
      },
      {
        search: /status: 'OPEN'/g,
        replace: "status: 'OPEN' as JobOfferStatus"
      },
      {
        search: /data: { status }/g,
        replace: 'data: { status: status as CandidateStatus }'
      }
    ]
  },
  
  // reports.service.ts
  {
    file: 'src/reports/reports.service.ts',
    replacements: [
      // Conversions pour les divisions
      {
        search: /\(t\._sum\.grossSalary \|\| 0\) \/ 1000000/g,
        replace: 'Number(t._sum.grossSalary || 0) / 1000000'
      },
      {
        search: /\(t\._sum\.netSalary \|\| 0\) \/ 1000000/g,
        replace: 'Number(t._sum.netSalary || 0) / 1000000'
      },
      {
        search: /\(\(t\._sum\.totalEmployerCost \|\| 0\) - \(t\._sum\.grossSalary \|\| 0\)\) \/ 1000000/g,
        replace: '(Number(t._sum.totalEmployerCost || 0) - Number(t._sum.grossSalary || 0)) / 1000000'
      },
      // Conversions pour les reduce
      {
        search: /acc \+ \(emp\.payrolls\[0\]\?\.grossSalary \|\| 0\)/g,
        replace: 'acc + Number(emp.payrolls[0]?.grossSalary || 0)'
      },
      {
        search: /sum \+ \(emp\.payrolls\[0\]\?\.grossSalary \|\| 0\)/g,
        replace: 'sum + Number(emp.payrolls[0]?.grossSalary || 0)'
      },
      {
        search: /sum \+ \(emp\.payrolls\[0\]\?\.netSalary \|\| 0\)/g,
        replace: 'sum + Number(emp.payrolls[0]?.netSalary || 0)'
      },
      {
        search: /sum \+ \(emp\.payrolls\[0\]\?\.cnssEmployer \|\| 0\)/g,
        replace: 'sum + Number(emp.payrolls[0]?.cnssEmployer || 0)'
      },
      {
        search: /sum \+ \(emp\.payrolls\[0\]\?\.its \|\| 0\)/g,
        replace: 'sum + Number(emp.payrolls[0]?.its || 0)'
      },
      // Conversions pour les additions complexes
      {
        search: /\(totalPayroll\._sum\.grossSalary \|\| 0\) \+ \(totalPayroll\._sum\.cnssEmployer \|\| 0\)/g,
        replace: 'Number(totalPayroll._sum.grossSalary || 0) + Number(totalPayroll._sum.cnssEmployer || 0)'
      },
      {
        search: /\(totalPayroll\._sum\.cnssSalarial \|\| 0\) \+ \(totalPayroll\._sum\.its \|\| 0\)/g,
        replace: 'Number(totalPayroll._sum.cnssSalarial || 0) + Number(totalPayroll._sum.its || 0)'
      },
      {
        search: /\(totalPayroll\._sum\.grossSalary \|\| 0\) - totalDeductions/g,
        replace: 'Number(totalPayroll._sum.grossSalary || 0) - totalDeductions'
      },
      // Conversions pour les comparaisons
      {
        search: /if \(gross > 0\)/g,
        replace: 'if (Number(gross) > 0)'
      },
      {
        search: /\(p\.overtimeHours15 \|\| 0\) \+ \(p\.overtimeHours50 \|\| 0\) > 0/g,
        replace: 'Number(p.overtimeHours15 || 0) + Number(p.overtimeHours50 || 0) > 0'
      },
      {
        search: /\(p\.overtimeHours15 \|\| 0\) \+ \(p\.overtimeHours50 \|\| 0\)([,\)])/g,
        replace: 'Number(p.overtimeHours15 || 0) + Number(p.overtimeHours50 || 0)$1'
      },
      {
        search: /\(p\.overtimeAmount15 \|\| 0\) \+ \(p\.overtimeAmount50 \|\| 0\)/g,
        replace: 'Number(p.overtimeAmount15 || 0) + Number(p.overtimeAmount50 || 0)'
      },
      {
        search: /\(lastPayroll\.overtimeHours15 \|\| 0\) \+ \(lastPayroll\.overtimeHours50 \|\| 0\)/g,
        replace: 'Number(lastPayroll.overtimeHours15 || 0) + Number(lastPayroll.overtimeHours50 || 0)'
      },
      {
        search: /\(lastPayroll\.overtimeAmount15 \|\| 0\) \+ \(lastPayroll\.overtimeAmount50 \|\| 0\)/g,
        replace: 'Number(lastPayroll.overtimeAmount15 || 0) + Number(lastPayroll.overtimeAmount50 || 0)'
      },
      {
        search: /sum \+ l\.daysCount/g,
        replace: 'sum + Number(l.daysCount)'
      },
      {
        search: /sum \+ gross/g,
        replace: 'sum + Number(gross)'
      },
      {
        search: /sum \+ \(emp\.payrolls\[0\]\?\.overtimeHours15 \|\| 0\) \+ \(emp\.payrolls\[0\]\?\.overtimeHours50 \|\| 0\)/g,
        replace: 'sum + Number(emp.payrolls[0]?.overtimeHours15 || 0) + Number(emp.payrolls[0]?.overtimeHours50 || 0)'
      },
      // Conversions pour calcVariation
      {
        search: /calcVariation\(current\._sum\.grossSalary \|\| 0/g,
        replace: 'calcVariation(Number(current._sum.grossSalary || 0)'
      },
      {
        search: /previous\._sum\.grossSalary \|\| 0\)/g,
        replace: 'Number(previous._sum.grossSalary || 0))'
      },
      {
        search: /calcVariation\(current\._sum\.netSalary \|\| 0/g,
        replace: 'calcVariation(Number(current._sum.netSalary || 0)'
      },
      {
        search: /previous\._sum\.netSalary \|\| 0\)/g,
        replace: 'Number(previous._sum.netSalary || 0))'
      },
      {
        search: /calcVariation\(current\._sum\.totalEmployerCost \|\| 0/g,
        replace: 'calcVariation(Number(current._sum.totalEmployerCost || 0)'
      },
      {
        search: /previous\._sum\.totalEmployerCost \|\| 0\)/g,
        replace: 'Number(previous._sum.totalEmployerCost || 0))'
      }
    ]
  },
  
  // repair-payroll-data.ts
  {
    file: 'src/scripts/repair-payroll-data.ts',
    replacements: [
      {
        search: /settings\.cnssEmployerRate !== 16/g,
        replace: 'Number(settings.cnssEmployerRate) !== 16'
      },
      {
        search: /settings\.cnssSalarialRate !== 4/g,
        replace: 'Number(settings.cnssSalarialRate) !== 4'
      },
      {
        search: /settings\.cnssCeiling !== 1200000/g,
        replace: 'Number(settings.cnssCeiling) !== 1200000'
      },
      {
        search: /Math\.min\(p\.grossSalary/g,
        replace: 'Math.min(Number(p.grossSalary)'
      },
      {
        search: /Math\.abs\(p\.cnssSalarial - /g,
        replace: 'Math.abs(Number(p.cnssSalarial) - '
      },
      {
        search: /Math\.abs\(p\.cnssEmployer - /g,
        replace: 'Math.abs(Number(p.cnssEmployer) - '
      },
      {
        search: /sum \+ p\.grossSalary/g,
        replace: 'sum + Number(p.grossSalary)'
      },
      {
        search: /sum \+ p\.cnssSalarial/g,
        replace: 'sum + Number(p.cnssSalarial)'
      },
      {
        search: /sum \+ p\.cnssEmployer/g,
        replace: 'sum + Number(p.cnssEmployer)'
      },
      {
        search: /sum \+ p\.netSalary/g,
        replace: 'sum + Number(p.netSalary)'
      }
    ]
  },
  
  // users.service.ts
  {
    file: 'src/users/users.service.ts',
    replacements: [
      {
        search: /role: inviteDto\.role,$/gm,
        replace: 'role: inviteDto.role as UserRole,'
      },
      {
        search: /data: updateUserDto$/gm,
        replace: 'data: { ...updateUserDto, role: updateUserDto.role as UserRole | undefined }'
      }
    ]
  }
];

// Fonction pour appliquer les corrections
function applyFixes() {
  let totalFiles = 0;
  let totalReplacements = 0;
  let errors = [];

  fixes.forEach(({ file, replacements }) => {
    const filePath = path.join(process.cwd(), file);
    
    // Vérifier si le fichier existe
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  Fichier ignoré (non trouvé): ${file}`);
      return;
    }

    try {
      let content = fs.readFileSync(filePath, 'utf8');
      let fileModified = false;
      let replacementCount = 0;

      replacements.forEach(({ search, replace }) => {
        const matches = content.match(search);
        if (matches) {
          content = content.replace(search, replace);
          fileModified = true;
          replacementCount += matches.length;
        }
      });

      if (fileModified) {
        fs.writeFileSync(filePath, content, 'utf8');
        totalFiles++;
        totalReplacements += replacementCount;
        console.log(`✅ ${file} - ${replacementCount} correction(s)`);
      } else {
        console.log(`⏭️  ${file} - Aucune correction nécessaire`);
      }
    } catch (error) {
      errors.push({ file, error: error.message });
      console.log(`❌ Erreur sur ${file}: ${error.message}`);
    }
  });

  // Résumé
  console.log('\n' + '='.repeat(60));
  console.log(`📊 RÉSUMÉ:`);
  console.log(`   - Fichiers modifiés: ${totalFiles}`);
  console.log(`   - Corrections appliquées: ${totalReplacements}`);
  if (errors.length > 0) {
    console.log(`   - Erreurs: ${errors.length}`);
    errors.forEach(({ file, error }) => {
      console.log(`     • ${file}: ${error}`);
    });
  }
  console.log('='.repeat(60));
  console.log('\n✨ Correction terminée ! Lancez `npm run build` pour vérifier.');
}

// Exécuter les corrections
applyFixes();