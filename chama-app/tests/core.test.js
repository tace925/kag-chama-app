/* Run with:  node tests/core.test.js
   Checks the money rules of the chama engine. */
const assert = require('node:assert/strict');
const C = require('../js/core.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}
const S = () => C.state;
C.load();
const user = role => S().users.find(u => u.role === role);
const treasurerOf = gid => S().users.find(u => u.role === 'treasurer' && u.groupIds.includes(gid));
const member = name => S().members.find(m => m.name === name);

console.log('Chama core tests (today = ' + C.today() + ')');

test('seed data passes the integrity check', () => {
  const r = C.integrityCheck();
  assert.deepEqual(r.issues, []);
});

test('financial year: 2 Jan to 2 Dec, 11 contribution periods, year-end window', () => {
  assert.equal(C.fyState('2026-01-01').closing, true);
  assert.equal(C.fyState('2026-01-01').fy, 2025);
  assert.equal(C.fyState('2026-01-02').closing, false);
  assert.equal(C.fyState('2026-12-02').closing, false);
  assert.equal(C.fyState('2026-12-03').closing, true);
  assert.equal(C.fyPeriods(2026).length, 11);
  assert.equal(C.fyPeriods(2026)[10], '2026-11');
});

test('group placement follows the age/status rules', () => {
  const on = '2026-06-01';
  assert.equal(C.placement({ dob: '2012-01-01', sex: 'M', married: false }, on), 'g_sun');      // 14
  assert.equal(C.placement({ dob: '2007-07-01', sex: 'F', married: false }, on), 'g_sun');      // 18 (turns 19 in July) -> still Sunday School
  assert.equal(C.placement({ dob: '2005-05-01', sex: 'M', married: false }, on), 'g_youth');    // 21
  assert.equal(C.placement({ dob: '2000-01-01', sex: 'F', married: true }, on), 'g_women');     // 26 married
  assert.equal(C.placement({ dob: '1990-01-01', sex: 'M', married: false }, on), 'g_men');      // 36 unmarried over 30
  assert.equal(C.placement({ dob: '1990-01-01', sex: 'F', married: false }, on), 'g_women');
  assert.equal(C.placement({ dob: '2020-01-01', sex: 'F', married: false }, on), null);         // under 10
});

test('seed shows the suggested group moves (turned 20, married)', () => {
  const s = C.suggestMoves();
  const names = s.map(x => C.memberById(x.memberId).name);
  assert.ok(names.includes('Ian Kiptoo'), 'Ian turned 20');
  assert.ok(names.includes('Samuel Mwangi'), 'Samuel married');
});

test('loan schedule: principal adds up exactly, interest is reducing balance', () => {
  const rows = C.buildSchedule(1000000, 3, 10, '2026-12', 10);   // KSh 10,000
  assert.equal(C.sum(rows, r => r.principal), 1000000);
  assert.equal(rows[0].interest, 100000);                          // 10% of 10,000
  assert.equal(rows[1].interest, Math.round((1000000 - rows[0].principal) * 0.10));
  const odd = C.buildSchedule(1000001, 3, 10, '2026-12', 10);
  assert.equal(C.sum(odd, r => r.principal), 1000001);             // remainder lands on last row
  assert.equal(rows[0].due, '2026-12-10');
});

test('USD is converted to KSh at the stored rate and only for card/bank', () => {
  const t = treasurerOf('g_youth'); const m = member('Peter Njoroge');
  assert.throws(() => C.record(t, { memberId: m.id, kind: 'auto', amount: 5, ccy: 'USD', method: 'M-Pesa' }), /KSh only/);
  const before = C.paid(m.id, 'contribution') + C.paid(m.id, 'tb_savings') + C.paid(m.id, 'unallocated');
  const res = C.record(t, { memberId: m.id, kind: 'auto', amount: 10, ccy: 'USD', method: 'Card', ref: 'USDTEST1' });
  assert.equal(res.amountMinor, Math.round(1000 * S().meta.rates.USD_KES));
  const e = res.entries[0]; assert.equal(e.orig, 1000); assert.equal(e.rate, S().meta.rates.USD_KES);
  const after = C.paid(m.id, 'contribution') + C.paid(m.id, 'tb_savings') + C.paid(m.id, 'unallocated');
  assert.equal(after - before, res.amountMinor);
});

test('duplicate transaction references are refused', () => {
  const t = treasurerOf('g_youth'); const m = member('Peter Njoroge');
  C.record(t, { memberId: m.id, kind: 'auto', amount: 100, method: 'M-Pesa', ref: 'DUPTEST9' });
  assert.throws(() => C.record(t, { memberId: m.id, kind: 'auto', amount: 100, method: 'M-Pesa', ref: 'DUPTEST9' }), /duplicate/);
});

test('every recorded shilling is allocated (nothing lost or invented)', () => {
  const t = treasurerOf('g_men'); const m = member('Moses Kiprop');
  const res = C.record(t, { memberId: m.id, kind: 'auto', amount: 3777.5, method: 'Cash' });
  assert.equal(C.sum(res.entries, e => e.amountMinor), 377750);
});

test('permissions: secretary cannot record money, treasurer cannot approve loans', () => {
  const sec = user('secretary'), t = treasurerOf('g_men'); const m = member('Moses Kiprop');
  assert.throws(() => C.record(sec, { memberId: m.id, kind: 'auto', amount: 100 }), /not allowed/);
  const pending = S().loans.find(l => l.status === 'requested' && l.confirmed.length === l.guarantors.length);
  assert.ok(pending, 'a loan awaiting approval exists');
  assert.throws(() => C.approveLoan(t, pending.id), /not allowed/);
});

test('treasurer cannot record for a group that is not theirs', () => {
  const t = treasurerOf('g_sun'); const m = member('Peter Njoroge');
  assert.throws(() => C.record(t, { memberId: m.id, kind: 'auto', amount: 100 }), /not in your group/);
});

test('loan above the approval limit needs the Bishop; confirmed guarantors required', () => {
  const sec = user('secretary'), bishop = user('bishop');
  const pending = S().loans.find(l => l.status === 'requested' && l.confirmed.length === l.guarantors.length);
  const g = C.groupById(pending.groupId); const old = g.loan.approvalLimit;
  g.loan.approvalLimit = 100;                                       // tiny limit for the test
  assert.throws(() => C.approveLoan(sec, pending.id), /need the Bishop/);
  C.approveLoan(bishop, pending.id);
  assert.equal(pending.status, 'approved');
  g.loan.approvalLimit = old;
  const waiting = S().loans.find(l => l.status === 'requested' && l.confirmed.length < l.guarantors.length);
  assert.throws(() => C.approveLoan(bishop, waiting.id), /guarantors must confirm/);
});

test('disburse -> repay -> reverse keeps balances exact; overpayment refused', () => {
  const loan = S().loans.find(l => l.status === 'approved'); const t = treasurerOf(loan.groupId);
  C.disburseLoan(t, loan.id, {});
  const total = C.loanOutstanding(loan);
  assert.equal(C.sum(loan.schedule, r => r.principal), loan.principal);
  const first = loan.schedule[0].principal + loan.schedule[0].interest;
  const r = C.record(t, { memberId: loan.memberId, kind: 'loan_repayment', loanId: loan.id, amount: first / 100, method: 'M-Pesa', ref: 'LNTEST1' });
  assert.equal(C.loanOutstanding(loan), total - first);
  assert.throws(() => C.record(t, { memberId: loan.memberId, kind: 'loan_repayment', loanId: loan.id, amount: 999999, method: 'M-Pesa' }), /more than the outstanding/);
  C.reverse(t, r.entries[0].id, 'Wrong member code');
  assert.equal(C.loanOutstanding(loan), total);
  assert.equal(C.integrityCheck().ok, true);
  const rest = total; C.record(t, { memberId: loan.memberId, kind: 'loan_repayment', loanId: loan.id, amount: rest / 100, method: 'Cash' });
  assert.equal(loan.status, 'cleared');
});

test('late fine is created once per member per period, and only after the grace period', () => {
  const before = S().fines.length;
  const a = C.runFines(); const mid = S().fines.length;
  const b = C.runFines();
  assert.equal(b.created, 0);
  assert.equal(S().fines.length, mid);
  void before; void a;
  // grace: on the 12th the contribution is not yet fined, on the 14th it is
  const m = member('Esther Moraa'); const p = C.curPeriods(C.today()).slice(-1)[0];
  assert.equal(C.periodStatus(m, p, p + '-12').status === 'grace' || C.periodStatus(m, p, p + '-12').status === 'paid', true);
  assert.notEqual(C.periodStatus(m, p, p + '-14').status, 'grace');
});

test('merry-go-round pays the whole pot to the next member, once per period', () => {
  const gid = 'g_women'; const g = C.groupById(gid); const t = treasurerOf(gid);
  const p = C.curPeriods(C.today()).slice(-1)[0];
  const next = C.mgrNext(gid); const pot = C.mgrPot(gid, p);
  if (pot > 0 && !g.mgr.received.some(r => r.period === p)) {
    let res; try { res = C.mgrPayout(t, gid, p, { force: true }); } catch (e) { throw e; }
    assert.equal(res.pot, pot); assert.equal(res.to, next);
    assert.throws(() => C.mgrPayout(t, gid, p, { force: true }), /already made/);
  }
});

test('year-end shares add up exactly to the pool', () => {
  const fy = C.fyState(C.today()).fy;
  for (const gid of ['g_youth', 'g_men', 'g_women']) {
    const y = C.yearEndShares(gid, fy);
    assert.equal(C.sum(y.shares, s => s.share), y.pool);
  }
  assert.equal(C.yearEndShares('g_sun', fy), null);
});

test('signed-off periods are locked against new payments', () => {
  const so = S().signoffs.find(s => s.status === 'signed'); const t = treasurerOf(so.groupId);
  const m = S().members.find(x => C.groupAt(x, so.period + '-10') === so.groupId && C.dueFor(x, so.period).mgr > 0);
  assert.throws(() => C.record(t, { memberId: m.id, kind: 'contribution', amount: 10, period: so.period, method: 'Cash' }), /locked/);
});

test('statement import: parses an M-Pesa style CSV and matches by phone and name', () => {
  const peter = member('Peter Njoroge'); const lucy = member('Lucy Chebet');
  const csv = 'Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance\n' +
    'QAB1C2D3E4,2026-11-05 09:12:01,Funds received from ' + C.normPhone(peter.phone).replace(/^0/, '254') + ' - PETER NJOROGE,Completed,"1,500.00",,5000\n' +
    'QAB1C2D3E5,2026-11-06 10:00:00,Funds received from 254733***002 - LUCY WACHERA CHEBET,Completed,700.00,,5700\n' +
    'QAB1C2D3E6,2026-11-06 11:00:00,Pay Bill to Safaricom,Completed,,200.00,5500\n';
  const rows = C.parseStatement(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amountMinor, 150000);
  assert.equal(C.matchRow(rows[0]).memberId, peter.id);
  assert.equal(C.matchRow(rows[1]).memberId, lucy.id);
});

test('moving a member keeps savings and loans and changes future dues only', () => {
  const ian = member('Ian Kiptoo'); const sec = user('secretary');
  const before = C.memberSummary(ian.id);
  C.moveMember(sec, ian.id, 'g_youth');
  const after = C.memberSummary(ian.id);
  assert.equal(after.mgrContributed, before.mgrContributed);
  assert.equal(ian.groupId, 'g_youth');
  const nextP = C.addMonths(C.monthOf(C.today()), 1);
  assert.equal(C.dueFor(ian, nextP).mgr, C.groupById('g_youth').contribution);
  assert.ok(C.dueFor(ian, nextP).tb > 0, 'starts table banking next month');
  assert.equal(C.dueFor(ian, C.monthOf(C.today())).mgr, C.groupById('g_sun').contribution, 'this month keeps the old amount');
});

test('under-18 members need a guardian and consent; guardian login is created', () => {
  const sec = user('secretary');
  const d = new Date(C.today()); d.setFullYear(d.getFullYear() - 13);
  const dob = C.fmtD(d);
  assert.throws(() => C.addMember(sec, { name: 'Test Child', dob, sex: 'M', phone: '' }), /guardian/);
  assert.throws(() => C.addMember(sec, { name: 'Test Child', dob, sex: 'M', guardianName: 'Mr Test', guardianPhone: '0700111222' }), /consent/);
  const m = C.addMember(sec, { name: 'Test Child', dob, sex: 'M', guardianName: 'Mr Test', guardianPhone: '0700111222', consent: true });
  assert.equal(m.groupId, 'g_sun');
  assert.ok(C.userById(m.guardianUserId));
});

test('after all changes the books still balance', () => {
  assert.equal(C.integrityCheck().ok, true, C.integrityCheck().issues.join('; '));
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
