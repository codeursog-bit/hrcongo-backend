import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { CONGO_LEAVE } from '../../leaves/leaves.constants';
import { accruedLeaveDays } from '../../leaves/leave-accrual-math';
import { isLeaveEligibleContract, resolveCycleWindow } from '../../leaves/leaves-common.util';
import { getSeniorityDaysForConvention } from '../../leaves/config/leave-seniority-conventions';
import { payrollAnnualLeaves } from './payroll-leave-return';

type Db = PrismaService | Prisma.TransactionClient;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const sameDate = (a: Date | null, b: Date) => a?.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/** Projection de fin de mois, sans créditer/débiter les soldes réels ni dépendre du cron. */
export async function payrollLeavePeriod(db: Db, employeeId: string, month: number, year: number) {
  const employee = await db.employee.findUnique({ where: { id: employeeId }, include: { company: true } });
  if (!employee) throw new BadRequestException('Salarié introuvable pour le solde de congés.');
  const empty = { annualEntitled: 0, annualTaken: 0, annualRemaining: 0 };
  if (!isLeaveEligibleContract(employee.contractType, !!employee.company.leaveAppliesToContractors)) return empty;
  const end = new Date(Date.UTC(year, month, 1));
  const asOf = new Date(end.getTime() - 1);
  if (employee.hireDate >= end) return empty;
  const [balances, annual, debits] = await Promise.all([
    db.leaveBalance.findMany({ where: { employeeId } }),
    payrollAnnualLeaves(db, employeeId),
    db.leave.findMany({ where: { employeeId, status: 'APPROVED', type: { in: ['ANNUAL', 'ANNUAL_ANTICIPATED'] }, carriedFromLeaveId: null } }),
  ]);
  const returned = annual.filter(leave => leave.returnDate < end).sort((a, b) => b.returnDate.getTime() - a.returnDate.getTime())[0];
  const away = annual.find(leave => leave.startDate < end && leave.returnDate >= end);
  // En janvier pendant le congé, garder le cycle consommé. Le nouveau
  // cycle commence en février, même sans bulletin en janvier.
  const rolling = employee.company.leaveCycleMode !== 'ANNIVERSARY';
  let anchor = rolling ? returned?.returnDate ?? employee.leaveCycleStartDate : null;
  if (anchor && anchor >= end) anchor = null;
  const window = resolveCycleWindow(employee.hireDate, anchor, asOf, employee.company.leaveCycleMode as 'ROLLING' | 'ANNIVERSARY');
  const activeStart = away?.debitedCycleStartDate ?? (away && rolling
    ? balances.filter(row => row.cycleStartDate && row.cycleStartDate <= away.startDate).sort((a, b) => b.cycleStartDate!.getTime() - a.cycleStartDate!.getTime())[0]?.cycleStartDate
    : undefined) ?? window.cycleStartDate;
  const current = balances.find(row => sameDate(row.cycleStartDate, activeStart)) ??
    (returned && rolling ? balances.find(row => sameDate(row.cycleStartDate, returned.endDate)) : undefined);
  const daysTaken = (row: typeof balances[number]) => {
    const events = debits.filter(leave => row.cycleStartDate && sameDate(leave.debitedCycleStartDate, row.cycleStartDate));
    const futureDebits = events.filter(leave => leave.balanceDebitedAt && leave.startDate >= end).reduce((sum, leave) => sum + Number(leave.daysCount), 0);
    const pendingDebits = events.filter(leave => !leave.balanceDebitedAt && leave.startDate < end).reduce((sum, leave) => sum + Number(leave.daysCount), 0);
    return round(Number(row.annualTaken) - futureDebits + pendingDebits);
  };
  const monthCount = Math.max(0, (year - activeStart.getUTCFullYear()) * 12 + month - activeStart.getUTCMonth());
  const seniority = current ? Number(current.seniorityDays) : employee.company.appliesSeniorityLeaveBonus
    ? getSeniorityDaysForConvention(employee.company.leaveConventionKey ?? 'GENERALE', Math.max(0, (activeStart.getTime() - employee.hireDate.getTime()) / (365.25 * 86400000))) : 0;
  const base = accruedLeaveDays(monthCount, CONGO_LEAVE.ANNUAL_DAYS);
  const rights = current?.adjustmentNote ? Number(current.annualEntitled) : base + seniority;
  let taken = current ? daysTaken(current) : 0;
  // Congés approuvés pas encore débités par le cron : les compter dans
  // leur mois de départ, pas dans le mois de paiement de l'indemnité.
  const pending = debits.filter(leave => !leave.balanceDebitedAt && !leave.debitedCycleStartDate && leave.startDate < end && leave.startDate >= activeStart);
  taken += pending.reduce((sum, leave) => sum + Number(leave.daysCount), 0);
  const carry = balances.filter(row => row.id !== current?.id && row.cycleStartDate && row.cycleStartDate < activeStart)
    .reduce((sum, row) => sum + Math.max(0, Number(row.annualEntitled) - daysTaken(row)), 0);
  const annualEntitled = round(rights + carry);
  const annualTaken = round(taken);
  return { annualEntitled, annualTaken, annualRemaining: round(annualEntitled - annualTaken) };
}

/** Une saisie partielle reprend les compteurs calculés, jamais un zéro implicite. */
export function payrollLeaveOverride(balance: { annualEntitled: number; annualTaken: number; annualRemaining: number }, input?: { congesDroits?: number; congesPris?: number; congesSolde?: number }) {
  const droits = input?.congesDroits ?? balance.annualEntitled;
  const pris = input?.congesPris ?? balance.annualTaken;
  const solde = round(droits - pris);
  if (![droits, pris, solde].every(Number.isFinite) || droits < 0 || pris < 0 || (input?.congesSolde != null && Math.abs(input.congesSolde - solde) > .005)) {
    throw new BadRequestException('Compteurs de congés incohérents : le solde doit correspondre aux droits moins les jours pris.');
  }
  return { droits, pris, solde };
}
