const assert = require('node:assert/strict'),
  { randomUUID } = require('node:crypto');
module.exports = async function ({
  db,
  app,
  a,
  b,
  user,
  request,
  events,
  turn,
  superAdmin,
  policy,
  employee,
}) {
  const actor = await user(a.id),
    employeeA = await db.employee.findMany({
      where: { companyId: a.id },
      orderBy: { id: 'asc' },
    }),
    employeeB = await db.employee.findFirst({ where: { companyId: b.id } });
  policy.planLimits.FREE.monthlyAnalyses = 100;
  await request('/admin/assistant/settings', 'PUT', policy, superAdmin.token);
  const today = require('../src/common/utils/congo-time').congoDateString(),
    year = Number(today.slice(0, 4)),
    month = Number(today.slice(5, 7)),
    prevMonth = month === 1 ? 12 : month - 1,
    prevYear = month === 1 ? year - 1 : year;
  for (const e of [...employeeA, employeeB])
    for (const [m, y, gross, net] of [
      [
        month,
        year,
        e.companyId === a.id ? 150000 : 999999,
        e.companyId === a.id ? 120000 : 888888,
      ],
      [prevMonth, prevYear, 130000, 110000],
    ])
      await db.payroll.create({
        data: {
          employeeId: e.id,
          companyId: e.companyId,
          month: m,
          year: y,
          periodStart: new Date(Date.UTC(y, m - 1, 1)),
          periodEnd: new Date(Date.UTC(y, m, 0)),
          workDays: 26,
          workedDays: 26,
          absenceDays: 0,
          baseSalary: 100000,
          totalBonuses: m === month ? 30000 : 20000,
          totalOvertimeAmount: m === month ? 20000 : 10000,
          grossSalary: gross,
          netSalary: net,
          totalDeductions: 30000,
          totalEmployerCost: 180000,
          employeeCustomTaxTotal: 15000,
          employerCustomTaxTotal: 10000,
          status: 'PAID',
        },
      });
  for (let n = 0; n < 3; n++)
    await db.permissionTicket.create({
      data: {
        employeeId: employeeA[0].id,
        companyId: a.id,
        createdByUserId: actor.id,
        type: 'AUTRE',
        reason: 'Fixture',
        departureTime: new Date(Date.UTC(year, month - 1, 2, 8)),
        expectedReturnTime: new Date(Date.UTC(year, month - 1, 2, 10)),
        status: n === 2 ? 'REJECTED' : 'APPROVED',
      },
    });
  await db.permissionTicket.create({
    data: {
      employeeId: employeeB.id,
      companyId: b.id,
      createdByUserId: actor.id,
      type: 'AUTRE',
      reason: 'Foreign fixture',
      departureTime: new Date(Date.UTC(year, month - 1, 2, 8)),
      expectedReturnTime: new Date(Date.UTC(year, month - 1, 2, 10)),
      status: 'APPROVED',
    },
  });
  await db.leave.create({
    data: {
      employeeId: employeeA[0].id,
      companyId: a.id,
      type: 'SICK',
      startDate: new Date(Date.UTC(year, month - 1, 1)),
      endDate: new Date(Date.UTC(year, month - 1, 2)),
      daysCount: 2,
      status: 'APPROVED',
      returnConfirmed: true,
      actualReturnDate: new Date(Date.UTC(year, month - 1, 3)),
    },
  });
  await db.company.update({
    where: { id: a.id },
    data: { leaveIndemnityMethod: 'CURRENT_SALARY' },
  });
  const { resolveCycleWindow } = require('../src/leaves/leaves-common.util');
  const cycle = resolveCycleWindow(
    employeeA[0].hireDate,
    null,
    new Date(),
    'ROLLING',
  );
  await db.leaveBalance.create({
    data: {
      employeeId: employeeA[0].id,
      year: cycle.cycleStartDate.getFullYear(),
      cycleStartDate: cycle.cycleStartDate,
      cycleEndDate: cycle.cycleEndDate,
      annualEntitled: 26,
      annualTaken: 7,
      annualRemaining: 19,
    },
  });
  const snapshot = async () =>
    JSON.stringify({
      employees: await db.employee.findMany({
        where: { companyId: a.id },
        orderBy: { id: 'asc' },
      }),
      balances: await db.leaveBalance.findMany({
        where: { employeeId: { in: employeeA.map((e) => e.id) } },
        orderBy: { id: 'asc' },
      }),
      leaves: await db.leave.findMany({
        where: { companyId: a.id },
        orderBy: { id: 'asc' },
      }),
      payroll: await db.payroll.findMany({
        where: { companyId: a.id },
        orderBy: { id: 'asc' },
      }),
    });
  const before = await snapshot();
  async function run(tool, extra = {}) {
    const result = events(
      await request(
        '/assistant/chat',
        'POST',
        {
          ...turn('Analyse du dossier'),
          analysis: { tool, month, year, ...extra },
        },
        actor.token,
      ),
    );
    return {
      result,
      card: result.find((e) => e.type === 'card')?.data.card,
      done: result.at(-1).data,
    };
  }
  let result = await run('explain_payroll_variation');
  assert.equal(
    result.card.metrics.find((m) => m.label === 'Brut de la période').value,
    300000,
  );
  assert.equal(
    result.card.metrics.find((m) => m.label === 'Écart brut').value,
    40000,
  );
  assert.equal(
    result.card.metrics.find(
      (m) => m.label === 'Autres composantes de l’écart brut',
    ).value,
    0,
  );
  const saved = await db.assistantMessage.findUnique({
    where: { id: result.done.messageId },
  });
  assert.equal(saved.payload.card, undefined);
  assert.ok(saved.payload.encryptedCard.startsWith('v1:'));
  assert.ok(!JSON.stringify(saved.payload).includes('300000'));
  const reread = await request(
    '/assistant/conversations/' + result.done.conversationId,
    'GET',
    undefined,
    actor.token,
  );
  assert.equal(reread.messages.at(-1).payload.card.metrics[0].value, 300000);
  result = await run('top_paid_employees');
  assert.equal(result.card.rows.length, 2);
  assert.ok(
    result.card.rows.every(
      (r) => employeeA.some((e) => e.id === r.employeeId) && r.value === 120000,
    ),
  );
  assert.ok(result.card.rows.every((r) => r.label === 'Fixture Effectif'));
  const raw = await db.assistantMessage.findUnique({
    where: { id: result.done.messageId },
  });
  assert.ok(!JSON.stringify(raw).includes('Fixture Effectif'));
  result = await run('explain_employee_pay', { employeeId: employeeA[0].id });
  assert.equal(
    result.card.metrics.find((m) => m.label === 'Coût employeur').value,
    180000,
  );
  assert.equal(
    result.card.metrics.find((m) => m.label === 'Total des retenues').value,
    30000,
  );
  assert.equal(
    result.card.metrics.find(
      (m) => m.label === 'Écart net avec le mois précédent',
    ).value,
    10000,
  );
  result = await run('permissions_ranking');
  assert.equal(result.card.rows.length, 1);
  assert.equal(result.card.rows[0].value, 2);
  for (const tool of ['leave_departures', 'leave_returns']) {
    result = await run(tool);
    assert.equal(result.card.rows.length, 1);
    assert.equal(result.card.rows[0].employeeId, employeeA[0].id);
  }
  result = await run('leave_balance', {
    employeeId: employeeA[0].id,
    month: 12,
    year: 2100,
  });
  assert.equal(
    result.card.period,
    today,
    'Current leave balance ignores a previously selected historical/future month',
  );
  assert.equal(
    result.card.metrics.find((m) => m.label === 'Jours restants').value,
    19,
  );
  const {
    LeavesIndemnityService,
  } = require('../src/leaves/leaves-indemnity.service');
  const engine = new LeavesIndemnityService(db);
  engine.logger = { log() {}, warn() {}, error() {} };
  const expected = await engine.calculateLeaveIndemnity(
    employeeA[0].id,
    26,
    a.id,
    month,
    year,
    undefined,
    { estimateCurrentMonth: false },
  );
  result = await run('leave_allowance', {
    employeeId: employeeA[0].id,
    days: 26,
  });
  assert.equal(
    result.card.metrics.find((m) => m.label === 'Allocation calculée').value,
    expected.indemnity,
  );
  const used = await db.assistantAnalysisUsage.count({
    where: { companyId: a.id, charged: true },
  });
  for (const extra of [
    { tool: 'explain_employee_pay', employeeId: employeeB.id },
    { tool: 'leave_balance', employeeId: employeeA[1].id },
    { tool: 'leave_allowance', employeeId: employeeA[0].id },
  ]) {
    const { tool, ...rest } = extra;
    result = await run(tool, rest);
    assert.ok(result.result.some((e) => e.type === 'refusal'));
    assert.equal(result.card, undefined);
  }
  assert.equal(
    await db.assistantAnalysisUsage.count({
      where: { companyId: a.id, charged: true },
    }),
    used,
  );
  assert.equal(
    await snapshot(),
    before,
    'All analysis tools must preserve business data exactly',
  );
  await request(
    '/assistant/employees?q=Fixture',
    'GET',
    undefined,
    employee.token,
    403,
  );
  const found = await request(
    '/assistant/employees?q=Fixture',
    'GET',
    undefined,
    actor.token,
  );
  assert.ok(
    found.every(
      (e) => employeeA.some((a) => a.id === e.id) && !('baseSalary' in e),
    ),
  );
  await request(
    '/assistant/chat',
    'POST',
    {
      ...turn('Test borne'),
      analysis: {
        tool: 'leave_allowance',
        month,
        year,
        employeeId: employeeA[0].id,
        days: -1,
      },
    },
    actor.token,
    400,
  );
  await request(
    '/assistant/chat',
    'POST',
    {
      ...turn('Test entreprise injectée'),
      analysis: { tool: 'headcount_summary', month, year, companyId: b.id },
    },
    actor.token,
    400,
  );
  console.log(
    'PASS: all nine analysis tools over real scoped fixtures; stored amounts encrypted, names hydrated only for authorized responses, engine parity, no business mutations, bounded inputs and uncharged refusals.',
  );
};
