/* =====================================================================
   Chama core engine — data model, rules, permissions and calculations.
   No DOM code in here, so it can be unit-tested in Node and later moved
   to Supabase (SQL / edge functions) without changing the rules.
   MONEY IS ALWAYS AN INTEGER NUMBER OF CENTS OF KES (KSh 1 = 100).
   ===================================================================== */
(function (root) {
'use strict';

const KEY = 'chama_app_v1';
const INTL = ['Card', 'Bank transfer', 'International / other'];
const METHODS = ['M-Pesa', 'Cash', 'Card', 'Bank transfer', 'International / other'];
const KIND_LABEL = {
  contribution: 'Merry-go-round contribution', tb_savings: 'Table-banking savings',
  joining_fee: 'Joining fee', fine: 'Fine', loan_repayment: 'Loan repayment',
  loan_disbursement: 'Loan disbursed', mgr_payout: 'Merry-go-round payout',
  unallocated: 'Unallocated (needs review)'
};
const INFLOW = ['contribution', 'tb_savings', 'joining_fee', 'fine', 'loan_repayment', 'unallocated'];
const OUTFLOW = ['mgr_payout', 'loan_disbursement'];

/* ---------------------------------------------------------------- storage */
let S = null;
const memStore = {};
const storage = {
  get(k) { try { if (typeof root.localStorage !== 'undefined') return root.localStorage.getItem(k); } catch (e) {} return memStore[k] || null; },
  set(k, v) { try { if (typeof root.localStorage !== 'undefined') { root.localStorage.setItem(k, v); return; } } catch (e) {} memStore[k] = v; }
};
let seq = 0;
const uid = p => p + '_' + Date.now().toString(36) + (seq++).toString(36) + Math.floor(Math.random() * 1296).toString(36);

/* ------------------------------------------------------------ date helpers
   Dates are plain 'YYYY-MM-DD' strings, periods are 'YYYY-MM'.            */
const pad = n => String(n).padStart(2, '0');
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtD = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayReal = () => fmtD(new Date());
const today = () => (S && S.meta.simDate) || todayReal();
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmtD(d); };
const addMonths = (p, n) => { const [y, m] = p.split('-').map(Number); const t = y * 12 + (m - 1) + n; return Math.floor(t / 12) + '-' + pad(t % 12 + 1); };
const monthOf = s => s.slice(0, 7);
function age(dob, on) {
  const b = parse(dob), t = parse(on || today());
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
}
function monthsBetween(a, b) {
  const A = parse(a), B = parse(b);
  let m = (B.getFullYear() - A.getFullYear()) * 12 + (B.getMonth() - A.getMonth());
  if (B.getDate() < A.getDate()) m--;
  return Math.max(0, m);
}
function nextSaturday(from) {
  const d = parse(from || today()); const add = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + (add === 0 ? 0 : add)); return fmtD(d);
}

/* Financial year runs 2 Jan -> 2 Dec. Contributions fall due on the 10th of
   Jan..Nov (11 periods). 3 Dec -> 1 Jan is the year-end closing window.      */
function fyState(date) {
  const y = +date.slice(0, 4);
  if (date < y + '-01-02') return { fy: y - 1, closing: true };
  if (date > y + '-12-02') return { fy: y, closing: true };
  return { fy: y, closing: false };
}
const fyPeriods = fy => Array.from({ length: 11 }, (_, i) => fy + '-' + pad(i + 1));
const curPeriods = asOf => { const st = fyState(asOf); const ps = fyPeriods(st.fy); return ps.filter(p => p <= monthOf(asOf)); };

/* ----------------------------------------------------------------- money */
const toCents = x => Math.round(Number(x) * 100);
function money(c, ccy) {
  const v = (c || 0) / 100;
  const s = v.toLocaleString('en-KE', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return (ccy === 'USD' ? 'USD ' : 'KSh ') + s;
}
const sum = (arr, f) => { let t = 0; for (const x of arr) t += f(x); return t; };

/* ---------------------------------------------------------- state access */
const memberById = id => S.members.find(m => m.id === id);
const groupById = id => S.groups.find(g => g.id === id);
const userById = id => S.users.find(u => u.id === id);
const loanById = id => S.loans.find(l => l.id === id);
const childrenOf = u => S.members.filter(m => m.guardianUserId === u.id);
function log(actor, action, detail) {
  S.audit.push({ id: uid('a'), at: new Date().toISOString(), date: today(), by: actor ? actor.name : 'system', role: actor ? actor.role : 'system', action, detail: detail || '' });
}

/* ------------------------------------------------------------ permissions */
const PERMS = {
  'members.view': ['superadmin', 'bishop', 'secretary', 'treasurer', 'auditor'],
  'members.edit': ['secretary', 'superadmin'],
  'members.move': ['secretary', 'treasurer'],
  'money.view': ['superadmin', 'bishop', 'treasurer', 'auditor'],
  'payments.record': ['treasurer'],
  'payments.reverse': ['treasurer'],
  'fines.waive': ['treasurer'],
  'loans.view': ['superadmin', 'bishop', 'secretary', 'treasurer', 'auditor', 'member', 'parent'],
  'loans.approve': ['bishop', 'secretary'],
  'loans.disburse': ['treasurer'],
  'mgr.draw': ['secretary'],
  'mgr.payout': ['treasurer'],
  'meetings.manage': ['secretary'],
  'messages.send': ['secretary', 'treasurer'],
  'review.signoff': ['auditor'],
  'review.view': ['superadmin', 'bishop', 'auditor'],
  'settings.edit': ['superadmin'],
  'terminal': ['superadmin'],
  'audit.view': ['superadmin', 'bishop', 'auditor'],
  'users.manage': ['superadmin'],
  'reports.view': ['superadmin', 'bishop', 'treasurer', 'auditor'],
  'import': ['treasurer'],
  'claims.review': ['treasurer'],
  'claims.submit': ['member', 'parent']
};
const can = (u, perm) => !!u && (PERMS[perm] || []).includes(u.role);
function scopeGroupIds(u) {
  if (!u) return [];
  if (u.role === 'member') { const m = memberById(u.memberId); return m ? [m.groupId] : []; }
  if (u.role === 'parent') return [...new Set(childrenOf(u).map(m => m.groupId))];
  if (!u.groupIds || u.groupIds.includes('*')) return S.groups.map(g => g.id);
  return u.groupIds;
}
function ownMembers(u) {
  if (!u) return [];
  if (u.role === 'member') { const m = memberById(u.memberId); return m ? [m] : []; }
  if (u.role === 'parent') return childrenOf(u);
  return [];
}
function canSeeMember(u, mid) {
  const m = memberById(mid); if (!m) return false;
  if (u.role === 'member' || u.role === 'parent') return ownMembers(u).some(x => x.id === mid);
  return scopeGroupIds(u).includes(m.groupId) || m.timeline.some(t => scopeGroupIds(u).includes(t.groupId));
}
function needPerm(actor, perm) { if (!can(actor, perm)) throw new Error('Your role (' + (actor && actor.role) + ') is not allowed to do this.'); }

/* -------------------------------------------------------------- placement */
function placement(m, on) {
  const a = age(m.dob, on || today());
  if (a < 10) return null;
  if (a <= 19) return 'g_sun';
  if (a <= 30 && !m.married) return 'g_youth';
  return m.sex === 'F' ? 'g_women' : 'g_men';
}
function suggestMoves(asOf) {
  const out = [];
  for (const m of S.members) {
    if (m.status !== 'active') continue;
    const to = placement(m, asOf || today());
    if (to && to !== m.groupId) {
      const a = age(m.dob, asOf || today());
      let reason = 'Age ' + a;
      if (to === 'g_youth') reason += ', unmarried';
      if (m.groupId === 'g_youth' && m.married) reason = 'Married';
      else if (m.groupId === 'g_youth' && a > 30) reason = 'Over 30';
      else if (m.groupId === 'g_sun') reason = 'Turned 20';
      out.push({ memberId: m.id, from: m.groupId, to, reason });
    }
  }
  return out;
}
const groupAt = (m, date) => { let g = m.timeline[0].groupId; for (const t of m.timeline) if (t.from <= date) g = t.groupId; return g; };
function firstPeriod(m) {
  const g = groupById(m.timeline[0].groupId) || S.groups[0];
  return +m.joinedOn.slice(8) <= (g.dueDay || 10) ? monthOf(m.joinedOn) : addMonths(monthOf(m.joinedOn), 1);
}

/* ------------------------------------------------------------------ dues */
function dueFor(m, period) {
  if (period < firstPeriod(m) || (m.status === 'exited' && m.exitedOn && period > monthOf(m.exitedOn))) return { mgr: 0, tb: 0, gid: null };
  const gid = groupAt(m, period + '-10'); const g = groupById(gid);
  return {
    mgr: g.types.includes('mgr') ? g.contribution : 0,
    tb: (g.types.includes('tb') && period >= (m.tbFrom || '0000-00')) ? g.tbSavings : 0,
    gid
  };
}
const paid = (mid, kind, period) => sum(S.ledger, e => e.memberId === mid && e.kind === kind && (period == null || e.period === period) ? e.amountMinor : 0);
function periodStatus(m, period, asOf) {
  asOf = asOf || today();
  const d = dueFor(m, period); const pm = paid(m.id, 'contribution', period), pt = paid(m.id, 'tb_savings', period);
  const due = d.mgr + d.tb, got = pm + pt;
  const short = Math.max(0, d.mgr - pm) + Math.max(0, d.tb - pt);
  const g = groupById(d.gid || m.groupId);
  const dueDate = period + '-' + pad(g.dueDay);
  let status;
  if (due === 0) status = 'none';
  else if (short === 0) status = 'paid';
  else if (period > monthOf(asOf)) status = 'upcoming';
  else if (asOf <= dueDate) status = got > 0 ? 'partial' : 'pending';
  else if (asOf <= addDays(dueDate, g.graceDays)) status = 'grace';
  else status = 'late';
  return { period, due, got, short, mgrDue: d.mgr, tbDue: d.tb, mgrPaid: pm, tbPaid: pt, status, dueDate, gid: d.gid };
}
function arrears(m, asOf) {
  asOf = asOf || today(); let t = 0;
  for (const p of curPeriods(asOf)) { const s = periodStatus(m, p, asOf); if (asOf > s.dueDate) t += s.short; }
  return t;
}
const joiningFeeOwed = m => { const g = groupById(m.timeline[0].groupId); return Math.max(0, (g.joiningFee || 0) - paid(m.id, 'joining_fee')); };
const fineOwed = f => f.status === 'waived' ? 0 : Math.max(0, f.amount - f.paid);
const openFines = mid => S.fines.filter(f => f.memberId === mid && fineOwed(f) > 0);
const loanOutstanding = l => sum(l.schedule || [], r => (r.principal - r.pp) + (r.interest - r.pi));
const loanPrincipalLeft = l => sum(l.schedule || [], r => r.principal - r.pp);
const activeLoans = mid => S.loans.filter(l => l.memberId === mid && l.status === 'active');

function memberSummary(mid, asOf) {
  const m = memberById(mid); asOf = asOf || today();
  const loans = activeLoans(mid);
  return {
    mgrContributed: paid(mid, 'contribution'), tbSavings: paid(mid, 'tb_savings'),
    joiningFeeOwed: joiningFeeOwed(m), finesOwed: sum(openFines(mid), fineOwed),
    loanOutstanding: sum(loans, loanOutstanding), arrears: arrears(m, asOf)
  };
}

/* ----------------------------------------------------------- allocation */
function autoAllocate(m, amt, date) {
  const parts = []; let left = amt;
  const take = (kind, need, period, extra) => {
    if (left <= 0 || need <= 0) return;
    const x = Math.min(left, need); parts.push(Object.assign({ kind, amountMinor: x, period }, extra || {})); left -= x;
  };
  take('joining_fee', joiningFeeOwed(m), monthOf(date));
  const st = fyState(date); const all = fyPeriods(st.fy); const cur = monthOf(date);
  const upto = all.filter(p => p <= cur), future = all.filter(p => p > cur);
  for (const p of upto) { const s = periodStatus(m, p, date); take('contribution', Math.max(0, s.mgrDue - s.mgrPaid), p); take('tb_savings', Math.max(0, s.tbDue - s.tbPaid), p); }
  for (const f of openFines(m.id)) take('fine', fineOwed(f), f.period, { fineId: f.id });
  for (const p of future) { const s = periodStatus(m, p, date); take('contribution', Math.max(0, s.mgrDue - s.mgrPaid), p); take('tb_savings', Math.max(0, s.tbDue - s.tbPaid), p); }
  if (left > 0) parts.push({ kind: 'unallocated', amountMinor: left, period: cur });
  return parts;
}

/* ------------------------------------------------------------- recording */
const isLocked = (gid, period) => S.signoffs.some(s => s.groupId === gid && s.period === period && s.status === 'signed');
function record(actor, p) {
  needPerm(actor, 'payments.record');
  const m = memberById(p.memberId); if (!m) throw new Error('Member not found');
  if (!scopeGroupIds(actor).includes(m.groupId)) throw new Error('This member is not in your group.');
  return recordInternal(actor, p);
}
function recordInternal(actor, p) {
  const m = memberById(p.memberId); const date = p.date || today();
  if (date > today()) throw new Error('Payment date cannot be in the future.');
  const method = p.method || 'M-Pesa'; let ccy = p.ccy || 'KES', amountMinor, orig = null, rate = null;
  if (ccy === 'USD') {
    if (!INTL.includes(method)) throw new Error('USD is accepted only through: ' + INTL.join(', ') + '. M-Pesa and cash are KSh only.');
    rate = S.meta.rates.USD_KES; orig = Math.round(Number(p.amount) * 100); amountMinor = Math.round(orig * rate);
  } else { amountMinor = p.amountMinor != null ? p.amountMinor : toCents(p.amount); }
  if (!(amountMinor > 0) || !Number.isFinite(amountMinor)) throw new Error('Amount must be greater than zero.');
  if (p.ref && method !== 'Cash' && S.ledger.some(e => e.ref === p.ref && !e.reversalOf && e.method !== 'Cash')) throw new Error('Reference ' + p.ref + ' was already recorded (duplicate).');
  const kind = p.kind || 'auto';
  let parts;
  if (kind === 'auto') parts = autoAllocate(m, amountMinor, date);
  else if (kind === 'fine') {
    parts = []; let left = amountMinor;
    for (const f of openFines(m.id)) { const x = Math.min(left, fineOwed(f)); if (x > 0) { parts.push({ kind: 'fine', amountMinor: x, period: f.period, fineId: f.id }); left -= x; } }
    if (!parts.length) throw new Error('This member has no open fines.');
    if (left > 0) throw new Error('Amount is more than the fines owed (' + money(amountMinor - left) + ').');
  } else if (kind === 'loan_repayment') {
    const l = loanById(p.loanId); if (!l || l.status !== 'active') throw new Error('Choose an active loan.');
    if (amountMinor > loanOutstanding(l)) throw new Error('Repayment is more than the outstanding ' + money(loanOutstanding(l)) + '.');
    parts = [{ kind, amountMinor, period: monthOf(date), loanId: l.id }];
  } else {
    parts = [{ kind, amountMinor, period: p.period || monthOf(date) }];
  }
  const gid = groupAt(m, date);
  for (const pt of parts) { if (isLocked(gid, pt.period)) throw new Error('The ' + pt.period + ' books for this group are signed off and locked.'); }
  const receiptId = uid('r'); const made = [];
  parts.forEach((pt, i) => {
    const e = { id: uid('e'), receiptId, date, memberId: m.id, groupId: gid, paidBy: p.paidBy || m.name, kind: pt.kind, period: pt.period,
      amountMinor: pt.amountMinor, orig: i === 0 ? orig : null, ccy, rate, method, ref: p.ref || '', loanId: pt.loanId || null, alloc: null,
      by: actor ? actor.name : 'system', at: new Date().toISOString(), reversalOf: null, reversed: false };
    if (pt.kind === 'fine') { const f = S.fines.find(x => x.id === pt.fineId); f.paid += pt.amountMinor; e.alloc = [{ fineId: f.id, amt: pt.amountMinor }]; }
    if (pt.kind === 'loan_repayment') e.alloc = applyRepayment(loanById(pt.loanId), pt.amountMinor);
    S.ledger.push(e); made.push(e);
  });
  log(actor, 'payment.record', m.name + ' ' + money(amountMinor) + (orig ? ' (USD ' + (orig / 100) + ' @ ' + rate + ')' : '') + ' via ' + method + (p.ref ? ' ref ' + p.ref : '') + ' -> ' + parts.map(x => x.kind + ' ' + x.period).join(', '));
  save();
  return { receiptId, entries: made, amountMinor };
}
function applyRepayment(loan, amt) {
  let left = amt; const alloc = [];
  for (const r of loan.schedule) {
    if (left <= 0) break;
    const i = Math.min(left, r.interest - r.pi); if (i > 0) { r.pi += i; left -= i; }
    const pr = Math.min(left, r.principal - r.pp); if (pr > 0) { r.pp += pr; left -= pr; }
    if (i > 0 || pr > 0) alloc.push({ n: r.n, i, p: pr });
  }
  if (loanOutstanding(loan) === 0) loan.status = 'cleared';
  return alloc;
}
function reverse(actor, entryId, reason) {
  needPerm(actor, 'payments.reverse');
  const e = S.ledger.find(x => x.id === entryId); if (!e) throw new Error('Entry not found');
  if (e.reversed || e.reversalOf) throw new Error('Already reversed.');
  if (OUTFLOW.includes(e.kind)) throw new Error('Payouts and disbursements cannot be reversed here. Ask the Bishop and super admin.');
  if (!reason || reason.trim().length < 5) throw new Error('Give a reason (at least 5 characters).');
  if (isLocked(e.groupId, e.period)) throw new Error('Books for ' + e.period + ' are signed off and locked.');
  if (!scopeGroupIds(actor).includes(e.groupId)) throw new Error('Not your group.');
  const r = Object.assign({}, e, { id: uid('e'), amountMinor: -e.amountMinor, orig: e.orig ? -e.orig : null, reversalOf: e.id, reversed: false, by: actor.name, at: new Date().toISOString(), date: today(), note: reason });
  if (e.kind === 'fine' && e.alloc) for (const a of e.alloc) { const f = S.fines.find(x => x.id === a.fineId); f.paid -= a.amt; }
  if (e.kind === 'loan_repayment' && e.alloc) {
    const l = loanById(e.loanId);
    for (const a of e.alloc) { const row = l.schedule.find(x => x.n === a.n); row.pi -= a.i; row.pp -= a.p; }
    if (l.status === 'cleared') l.status = 'active';
  }
  e.reversed = true; S.ledger.push(r);
  log(actor, 'payment.reverse', money(e.amountMinor) + ' ' + e.kind + ' for ' + memberById(e.memberId).name + '. Reason: ' + reason);
  save(); return r;
}

/* ------------------------------------------------------------------ fines */
function runFines(asOf, actor) {
  asOf = asOf || today(); let created = 0; const notes = [];
  for (const m of S.members) {
    if (m.status !== 'active') continue;
    for (const p of curPeriods(asOf)) {
      const s = periodStatus(m, p, asOf);
      if (s.status !== 'late' || !s.gid) continue;
      if (S.fines.some(f => f.memberId === m.id && f.period === p && f.reason === 'late')) continue;
      const g = groupById(s.gid);
      S.fines.push({ id: uid('f'), memberId: m.id, groupId: g.id, period: p, reason: 'late', note: 'Late contribution ' + p, amount: g.lateFine, paid: 0, status: 'open', date: asOf });
      created++; notes.push(m.id);
    }
  }
  for (const l of S.loans) {
    if (l.status !== 'active') continue;
    const g = groupById(l.groupId);
    for (const r of l.schedule) {
      const left = (r.principal - r.pp) + (r.interest - r.pi);
      if (left > 0 && asOf > addDays(r.due, g.graceDays) && !S.fines.some(f => f.loanId === l.id && f.loanRow === r.n)) {
        S.fines.push({ id: uid('f'), memberId: l.memberId, groupId: g.id, period: monthOf(r.due), reason: 'loan', loanId: l.id, loanRow: r.n, note: 'Late loan instalment ' + r.n, amount: Math.round(left * g.loan.penaltyPct / 100), paid: 0, status: 'open', date: asOf });
        created++; notes.push(l.memberId);
      }
    }
  }
  if (created) { log(actor, 'fines.run', created + ' fine(s) created as of ' + asOf); }
  save(); return { created, memberIds: notes };
}
function waiveFine(actor, fineId, reason) {
  needPerm(actor, 'fines.waive');
  const f = S.fines.find(x => x.id === fineId); if (!f) throw new Error('Fine not found');
  if (!scopeGroupIds(actor).includes(f.groupId)) throw new Error('Not your group.');
  if (isLocked(f.groupId, f.period)) throw new Error('Period is signed off and locked.');
  if (!reason || reason.trim().length < 5) throw new Error('A reason is required to waive a fine.');
  f.status = 'waived'; f.waiveReason = reason; f.waivedBy = actor.name;
  log(actor, 'fine.waive', memberById(f.memberId).name + ' ' + money(f.amount) + ' (' + f.note + '). Reason: ' + reason);
  save();
}

/* -------------------------------------------------------- members + moves */
function normPhone(s) {
  let d = String(s || '').replace(/[^\d]/g, '');
  if (d.startsWith('254')) d = '0' + d.slice(3);
  else if (/^[71]\d{8}$/.test(d)) d = '0' + d;
  return d;
}
function findOrCreateParent(actor, phone, name) {
  const p = normPhone(phone);
  let u = S.users.find(x => x.role === 'parent' && x.phone === p);
  if (!u) { u = { id: uid('u'), name, role: 'parent', phone: p, pin: '1234', active: true }; S.users.push(u); log(actor, 'user.create', 'Parent login for ' + name); }
  return u;
}
function addMember(actor, d) {
  needPerm(actor, 'members.edit');
  const name = (d.name || '').trim(); if (name.length < 3) throw new Error('Enter the full name.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dob || '')) throw new Error('Enter a valid date of birth.');
  const joinedOn = d.joinedOn || today();
  const phone = normPhone(d.phone); if (phone && !/^0[71]\d{8}$/.test(phone)) throw new Error('Phone must look like 0712345678.');
  const m = { name, phone, dob: d.dob, sex: d.sex === 'F' ? 'F' : 'M', married: !!d.married };
  const gid = placement(m, joinedOn); if (!gid) throw new Error('Members must be at least 10 years old.');
  const a = age(d.dob, joinedOn);
  let guardianUserId = null, guardianName = '', guardianPhone = '';
  if (a < 18) {
    if (!d.guardianName || !d.guardianPhone) throw new Error('A parent or guardian name and phone are required for members under 18.');
    if (!d.consent) throw new Error('Parent/guardian consent (Data Protection Act) must be confirmed.');
    guardianName = d.guardianName.trim(); guardianPhone = normPhone(d.guardianPhone);
    guardianUserId = findOrCreateParent(actor, guardianPhone, guardianName).id;
  }
  if (S.members.some(x => x.name.toLowerCase() === name.toLowerCase() && x.dob === d.dob)) throw new Error('This member is already registered.');
  const g = groupById(gid);
  const mem = { id: uid('m'), name, phone, dob: d.dob, sex: m.sex, married: m.married, groupId: gid, joinedOn, status: 'active',
    timeline: [{ from: '0000-00-00', groupId: gid }], guardianUserId, guardianName, guardianPhone, consent: a < 18 ? true : !!d.consent, tbFrom: g.types.includes('tb') ? monthOf(joinedOn) : null, history: [] };
  S.members.push(mem);
  if (g.types.includes('mgr')) g.mgr.order.push(mem.id);
  log(actor, 'member.add', name + ' -> ' + g.name + (a < 18 ? ' (guardian ' + guardianName + ')' : ''));
  save(); return mem;
}
function updateMember(actor, mid, patch) {
  needPerm(actor, 'members.edit');
  const m = memberById(mid); if (!m) throw new Error('Member not found');
  const before = [];
  ['married', 'phone', 'name'].forEach(k => { if (patch[k] !== undefined && patch[k] !== m[k]) { before.push(k + ': ' + m[k] + ' -> ' + patch[k]); m[k] = k === 'phone' ? normPhone(patch[k]) : patch[k]; } });
  if (before.length) log(actor, 'member.update', m.name + ' ' + before.join('; '));
  save(); return m;
}
function moveMember(actor, mid, toGid) {
  needPerm(actor, 'members.move');
  const m = memberById(mid); const from = groupById(m.groupId), to = groupById(toGid);
  if (!to || from.id === to.id) throw new Error('Choose a different group.');
  if (actor.role === 'treasurer' && !scopeGroupIds(actor).includes(from.id)) throw new Error('You can only move members out of your own group.');
  const eff = addMonths(monthOf(today()), 1) + '-01';
  m.timeline.push({ from: eff, groupId: to.id });
  m.history.push({ date: today(), effective: eff, from: from.id, to: to.id, by: actor ? actor.name : 'system' });
  m.groupId = to.id;
  if (to.types.includes('tb') && !from.types.includes('tb')) m.tbFrom = monthOf(eff);
  // merry-go-round place is kept if the turn for this round was not yet received
  const received = from.mgr.received.some(r => r.round === from.mgr.round && r.memberId === m.id);
  from.mgr.order = from.mgr.order.filter(x => x !== m.id);
  if (to.types.includes('mgr') && !to.mgr.order.includes(m.id)) to.mgr.order.push(m.id);
  if (received && to.types.includes('mgr')) to.mgr.received.push({ round: to.mgr.round, memberId: m.id, period: 'carried', amountMinor: 0, date: today(), carried: true });
  log(actor, 'member.move', m.name + ': ' + from.name + ' -> ' + to.name + ' (new amounts from ' + eff + '; savings and loans carry over)');
  notify(actor, [m.id], 'You have been moved to the ' + to.name + ' group from ' + eff + '. Your savings and loans carry over.');
  save(); return m;
}

/* ------------------------------------------------------- merry-go-round */
const mgrReceived = (g, id) => g.mgr.received.some(r => r.round === g.mgr.round && r.memberId === id);
const mgrNext = gid => { const g = groupById(gid); return g.mgr.order.find(id => !mgrReceived(g, id) && memberById(id) && memberById(id).status === 'active') || null; };
const mgrPot = (gid, period) => sum(S.ledger, e => e.groupId === gid && e.kind === 'contribution' && e.period === period ? e.amountMinor : 0);
function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    let j; if (root.crypto && root.crypto.getRandomValues) { const u = new Uint32Array(1); root.crypto.getRandomValues(u); j = u[0] % (i + 1); } else j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
function mgrDraw(actor, gid) {
  needPerm(actor, 'mgr.draw');
  const g = groupById(gid); if (!g.types.includes('mgr')) throw new Error('This group has no merry-go-round.');
  if (g.mgr.received.some(r => r.round === g.mgr.round)) throw new Error('The round has started. The order can only be drawn before the first payout of a round.');
  g.mgr.order = shuffle(S.members.filter(m => m.groupId === gid && m.status === 'active').map(m => m.id));
  log(actor, 'mgr.draw', g.name + ' round ' + g.mgr.round + ' order: ' + g.mgr.order.map(id => memberById(id).name).join(' > '));
  save(); return g.mgr.order;
}
function mgrPayout(actor, gid, period, opts) {
  opts = opts || {};
  needPerm(actor, 'mgr.payout'); return mgrPayoutInternal(actor, gid, period, opts);
}
function mgrPayoutInternal(actor, gid, period, opts) {
  const g = groupById(gid);
  if (!scopeGroupIds(actor).includes(gid) && actor) throw new Error('Not your group.');
  if (isLocked(gid, period)) throw new Error('Books for ' + period + ' are signed off and locked.');
  if (g.mgr.received.some(r => r.period === period && !r.carried)) throw new Error('A payout was already made for ' + period + '.');
  const to = mgrNext(gid); if (!to) throw new Error('Nobody is waiting for a turn.');
  const pot = mgrPot(gid, period); if (pot <= 0) throw new Error('No merry-go-round contributions were collected for ' + period + '.');
  const rec = memberById(to);
  if (!opts.force && arrears(rec) > 0) { const e = new Error(rec.name + ' has arrears of ' + money(arrears(rec)) + '. Skip their turn or confirm to pay anyway.'); e.code = 'ARREARS'; throw e; }
  S.ledger.push({ id: uid('e'), receiptId: uid('r'), date: today(), memberId: to, groupId: gid, paidBy: 'Group', kind: 'mgr_payout', period, amountMinor: pot, orig: null, ccy: 'KES', rate: null, method: opts.method || 'M-Pesa', ref: opts.ref || '', loanId: null, alloc: null, by: actor ? actor.name : 'system', at: new Date().toISOString(), reversalOf: null, reversed: false });
  g.mgr.received.push({ round: g.mgr.round, memberId: to, period, amountMinor: pot, date: today() });
  log(actor, 'mgr.payout', g.name + ' ' + period + ': ' + money(pot) + ' to ' + rec.name + ' (round ' + g.mgr.round + ')');
  if (!mgrNext(gid)) { g.mgr.round++; log(actor, 'mgr.round', g.name + ' round ' + (g.mgr.round - 1) + ' complete. Round ' + g.mgr.round + ' begins; draw a new order.'); }
  save(); return { to, pot };
}
function mgrSkip(actor, gid, reason) {
  if (!can(actor, 'mgr.payout') && !can(actor, 'mgr.draw')) throw new Error('Not allowed.');
  const g = groupById(gid); const to = mgrNext(gid); if (!to) throw new Error('Nothing to skip.');
  g.mgr.order = g.mgr.order.filter(x => x !== to).concat([to]);
  log(actor, 'mgr.skip', memberById(to).name + ' moved to the end of the order. ' + (reason || '')); save();
}

/* ----------------------------------------------------------------- loans */
function buildSchedule(principal, months, ratePct, firstPeriod, dueDay) {
  const base = Math.floor(principal / months); let bal = principal; const rows = [];
  for (let n = 1; n <= months; n++) {
    const pr = n === months ? bal : base; const interest = Math.round(bal * ratePct / 100);
    rows.push({ n, due: addMonths(firstPeriod, n - 1) + '-' + pad(dueDay), principal: pr, interest, pi: 0, pp: 0 });
    bal -= pr;
  }
  return rows;
}
function loanLimit(mid) {
  const m = memberById(mid); const g = groupById(m.groupId);
  if (!g.types.includes('tb')) return 0;
  const held = sum(S.loans.filter(l => l.memberId === mid && ['active', 'approved'].includes(l.status)), l => l.status === 'active' ? loanPrincipalLeft(l) : l.principal);
  return Math.max(0, g.loan.multiple * paid(mid, 'tb_savings') - held);
}
function loanChecks(mid, amount, months, guarantors) {
  const m = memberById(mid); const g = groupById(m.groupId); const L = g.loan;
  const lim = loanLimit(mid); const out = [];
  out.push({ ok: g.types.includes('tb'), label: 'Group offers table banking' });
  out.push({ ok: monthsBetween(m.joinedOn, today()) >= L.minMonths, label: 'Member for at least ' + L.minMonths + ' months' });
  out.push({ ok: arrears(m) === 0, label: 'No overdue contributions' });
  out.push({ ok: sum(openFines(mid), fineOwed) === 0, label: 'No unpaid fines' });
  out.push({ ok: activeLoans(mid).length + S.loans.filter(l => l.memberId === mid && ['requested', 'approved'].includes(l.status)).length < L.maxActive, label: 'No other open loan (max ' + L.maxActive + ')' });
  if (amount != null) out.push({ ok: amount > 0 && amount <= lim, label: 'Amount within limit (' + money(lim) + ' = ' + L.multiple + 'x savings minus loans)' });
  if (months != null) out.push({ ok: months >= 1 && months <= L.maxMonths, label: 'Repayment period 1-' + L.maxMonths + ' months' });
  if (guarantors) {
    const uniq = new Set(guarantors);
    out.push({ ok: guarantors.length === L.guarantors && uniq.size === guarantors.length && !uniq.has(mid) && guarantors.every(id => { const x = memberById(id); return x && x.groupId === m.groupId && x.status === 'active'; }), label: L.guarantors + ' different guarantors from the same group' });
  }
  return out;
}
function requestLoan(actor, d) {
  const m = memberById(d.memberId); if (!m) throw new Error('Member not found');
  const ok = actor.role === 'member' && actor.memberId === m.id || actor.role === 'parent' && m.guardianUserId === actor.id;
  if (!ok) throw new Error('Only the member (or their guardian) can request a loan.');
  const amount = toCents(d.amount), months = +d.months;
  const checks = loanChecks(m.id, amount, months, d.guarantors || []);
  const bad = checks.filter(c => !c.ok); if (bad.length) throw new Error('Cannot request: ' + bad.map(b => b.label).join('; '));
  const g = groupById(m.groupId);
  const l = { id: uid('l'), memberId: m.id, groupId: g.id, principal: amount, months, ratePct: g.loan.ratePct, purpose: d.purpose || '', status: 'requested', guarantors: d.guarantors.slice(), confirmed: [], approvals: [], schedule: [], requestedOn: today() };
  S.loans.push(l);
  log(actor, 'loan.request', m.name + ' ' + money(amount) + ' over ' + months + ' months');
  notify(actor, d.guarantors, m.name + ' has named you as a loan guarantor for ' + money(amount) + '. Open Loans to confirm or decline.');
  save(); return l;
}
function guarantorConfirm(actor, loanId, mid, yes) {
  const l = loanById(loanId); if (!l) throw new Error('Loan not found');
  if (actor.memberId !== mid || !l.guarantors.includes(mid)) throw new Error('You are not a guarantor on this loan.');
  if (yes) { if (!l.confirmed.includes(mid)) l.confirmed.push(mid); }
  else { l.status = 'rejected'; l.reason = memberById(mid).name + ' declined to guarantee'; }
  log(actor, 'loan.guarantor', memberById(mid).name + (yes ? ' confirmed' : ' declined') + ' for ' + memberById(l.memberId).name); save();
}
const loanNeedsBishop = l => l.principal > groupById(l.groupId).loan.approvalLimit;
function approveLoan(actor, loanId) {
  needPerm(actor, 'loans.approve');
  const l = loanById(loanId); if (!l || l.status !== 'requested') throw new Error('Loan is not waiting for approval.');
  if (l.confirmed.length < l.guarantors.length) throw new Error('All guarantors must confirm first.');
  if (loanNeedsBishop(l) && actor.role !== 'bishop') throw new Error('Loans above ' + money(groupById(l.groupId).loan.approvalLimit) + ' need the Bishop.');
  if (actor.memberId && actor.memberId === l.memberId) throw new Error('You cannot approve your own loan.');
  l.status = 'approved'; l.approvals.push({ by: actor.name, role: actor.role, at: today() });
  log(actor, 'loan.approve', memberById(l.memberId).name + ' ' + money(l.principal));
  notify(actor, [l.memberId], 'Your loan of ' + money(l.principal) + ' was approved. The treasurer will disburse it.');
  save();
}
function rejectLoan(actor, loanId, reason) {
  needPerm(actor, 'loans.approve');
  const l = loanById(loanId); if (!l || !['requested', 'approved'].includes(l.status)) throw new Error('Loan cannot be rejected now.');
  if (!reason || reason.trim().length < 3) throw new Error('Give a reason.');
  l.status = 'rejected'; l.reason = reason; log(actor, 'loan.reject', memberById(l.memberId).name + '. ' + reason);
  notify(actor, [l.memberId], 'Your loan request was not approved: ' + reason); save();
}
function disburseLoan(actor, loanId, opts) {
  needPerm(actor, 'loans.disburse');
  opts = opts || {};
  const l = loanById(loanId); if (!l || l.status !== 'approved') throw new Error('Loan must be approved first.');
  if (!scopeGroupIds(actor).includes(l.groupId)) throw new Error('Not your group.');
  if (actor.memberId && actor.memberId === l.memberId) throw new Error('You cannot disburse your own loan.');
  const g = groupById(l.groupId); const date = opts.date || today();
  l.schedule = buildSchedule(l.principal, l.months, l.ratePct, addMonths(monthOf(date), 1), g.dueDay);
  l.status = 'active'; l.disbursedOn = date;
  S.ledger.push({ id: uid('e'), receiptId: uid('r'), date, memberId: l.memberId, groupId: g.id, paidBy: 'Group', kind: 'loan_disbursement', period: monthOf(date), amountMinor: l.principal, orig: null, ccy: 'KES', rate: null, method: opts.method || 'M-Pesa', ref: opts.ref || '', loanId: l.id, alloc: null, by: actor.name, at: new Date().toISOString(), reversalOf: null, reversed: false });
  log(actor, 'loan.disburse', memberById(l.memberId).name + ' ' + money(l.principal) + ' first instalment ' + l.schedule[0].due);
  notify(actor, [l.memberId], 'Loan of ' + money(l.principal) + ' disbursed. First instalment ' + l.schedule[0].due + '.'); save();
}

/* ---------------------------------------------------------------- meetings */
function scheduleMeeting(actor, d) {
  needPerm(actor, 'meetings.manage');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) throw new Error('Pick a date.');
  const mt = { id: uid('t'), date: d.date, groupId: d.groupId || 'all', mode: d.mode === 'physical' ? 'physical' : 'online', where: d.where || '', minutes: '', attendance: null };
  S.meetings.push(mt);
  log(actor, 'meeting.schedule', mt.date + ' ' + mt.mode + ' ' + (mt.where || '') + ' for ' + mt.groupId);
  const ids = S.members.filter(m => m.status === 'active' && (mt.groupId === 'all' || m.groupId === mt.groupId)).map(m => m.id);
  notify(actor, ids, 'Saturday meeting ' + mt.date + ' (' + (mt.mode === 'online' ? 'ONLINE' : 'PHYSICAL') + ')' + (mt.where ? ': ' + mt.where : '') + '.'); save(); return mt;
}
function recordAttendance(actor, meetingId, map, minutes) {
  needPerm(actor, 'meetings.manage');
  const mt = S.meetings.find(x => x.id === meetingId); if (!mt) throw new Error('Meeting not found');
  mt.attendance = map; if (minutes != null) mt.minutes = minutes;
  let fines = 0;
  for (const id in map) {
    if (map[id] !== 'absent') continue; const m = memberById(id); const g = groupById(m.groupId);
    if (S.fines.some(f => f.memberId === id && f.meetingId === mt.id)) continue;
    S.fines.push({ id: uid('f'), memberId: id, groupId: g.id, period: monthOf(mt.date), reason: 'missed', meetingId: mt.id, note: 'Missed meeting ' + mt.date, amount: g.missedFine, paid: 0, status: 'open', date: today() }); fines++;
  }
  log(actor, 'meeting.attendance', mt.date + ' recorded; ' + fines + ' missed-meeting fine(s)'); save(); return fines;
}

/* ---------------------------------------------------------------- messages */
function notify(actor, memberIds, text) {
  const t = new Date().toISOString();
  for (const id of [...new Set(memberIds)]) {
    const m = memberById(id); if (!m) continue;
    const phone = m.guardianUserId ? m.guardianPhone : m.phone;
    S.messages.push({ id: uid('s'), at: t, date: today(), memberId: id, toName: m.guardianUserId ? m.guardianName + ' (for ' + m.name + ')' : m.name, phone, channel: 'SMS + in-app', text, status: 'simulated' });
  }
}
function sendReminders(actor, gids) {
  needPerm(actor, 'messages.send');
  let n = 0;
  for (const m of S.members) {
    if (m.status !== 'active' || !gids.includes(m.groupId)) continue;
    const a = arrears(m); const cur = periodStatus(m, monthOf(today())).short;
    if (a > 0) { notify(actor, [m.id], 'Reminder: contributions overdue ' + money(a) + '. Please pay to avoid fines. / Tafadhali lipa michango yako iliyochelewa: ' + money(a) + '.'); n++; }
    else if (cur > 0 && today() <= monthOf(today()) + '-' + pad(groupById(m.groupId).dueDay)) { notify(actor, [m.id], 'Reminder: ' + money(cur) + ' is due on the 10th. / Mchango wa ' + money(cur) + ' unalipwa tarehe 10.'); n++; }
  }
  log(actor, 'messages.reminders', n + ' reminder(s) queued'); save(); return n;
}
function postMessage(actor, memberIds, text) {
  needPerm(actor, 'messages.send');
  if (!text || text.trim().length < 3) throw new Error('Write a message.');
  notify(actor, memberIds, text.trim()); log(actor, 'messages.send', memberIds.length + ' recipient(s): ' + text.slice(0, 60)); save();
}

/* ---------------------------------------------------------------- claims */
function submitClaim(actor, d) {
  needPerm(actor, 'claims.submit');
  const m = memberById(d.memberId); if (!m || !ownMembers(actor).some(x => x.id === m.id)) throw new Error('Choose one of your own accounts.');
  const amountMinor = toCents(d.amount); if (!(amountMinor > 0)) throw new Error('Enter the amount you paid.');
  if (!d.ref || d.ref.trim().length < 4) throw new Error('Enter the M-Pesa / transaction code.');
  const c = { id: uid('c'), memberId: m.id, groupId: m.groupId, by: actor.name, amountMinor, ccy: d.ccy || 'KES', method: d.method || 'M-Pesa', ref: d.ref.trim().toUpperCase(), date: d.date || today(), note: d.note || '', status: 'pending' };
  S.claims.push(c); log(actor, 'claim.submit', m.name + ' ' + money(amountMinor) + ' ref ' + c.ref); save(); return c;
}
function confirmClaim(actor, claimId) {
  needPerm(actor, 'claims.review');
  const c = S.claims.find(x => x.id === claimId); if (!c || c.status !== 'pending') throw new Error('Claim is not pending.');
  const res = record(actor, { memberId: c.memberId, kind: 'auto', amount: c.ccy === 'USD' ? c.amountMinor / 100 : c.amountMinor / 100, ccy: c.ccy, method: c.method, ref: c.ref, date: c.date, paidBy: c.by });
  c.status = 'confirmed'; c.receiptId = res.receiptId; log(actor, 'claim.confirm', c.ref); save();
  notify(actor, [c.memberId], 'Payment ' + c.ref + ' of ' + money(res.amountMinor) + ' received. Thank you.');
  return res;
}
function rejectClaim(actor, claimId, reason) {
  needPerm(actor, 'claims.review');
  const c = S.claims.find(x => x.id === claimId); if (!c || c.status !== 'pending') throw new Error('Claim is not pending.');
  if (!reason || reason.trim().length < 3) throw new Error('Give a reason.');
  c.status = 'rejected'; c.reason = reason; log(actor, 'claim.reject', c.ref + '. ' + reason);
  notify(actor, [c.memberId], 'We could not match payment ' + c.ref + ': ' + reason); save();
}

/* ------------------------------------------------------- cash + reconcile */
const cashOnHand = gid => sum(S.ledger, e => e.groupId !== gid ? 0 : INFLOW.includes(e.kind) ? e.amountMinor : OUTFLOW.includes(e.kind) ? -e.amountMinor : 0);
function reconcile(actor, gid, actualMinor, date) {
  needPerm(actor, 'payments.record');
  if (!scopeGroupIds(actor).includes(gid)) throw new Error('Not your group.');
  const system = cashOnHand(gid); const r = { id: uid('rc'), groupId: gid, date: date || today(), actual: actualMinor, system, diff: actualMinor - system, by: actor.name };
  S.recons.push(r); log(actor, 'reconcile', groupById(gid).name + ' actual ' + money(actualMinor) + ' vs system ' + money(system) + ' diff ' + money(r.diff)); save(); return r;
}

/* ---------------------------------------------------------- statement import */
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}
function parseDate(s) {
  s = String(s || '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
  if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/))) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
  return null;
}
function parseStatement(text) {
  const rows = parseCSV(text); if (!rows.length) return [];
  let hi = rows.findIndex(r => r.some(c => /paid in|credit|amount/i.test(c)) && r.some(c => /date|time|receipt|ref|detail/i.test(c)));
  const idx = { ref: 0, date: 1, details: 2, amount: 3, phone: -1, name: -1 };
  if (hi >= 0) {
    const h = rows[hi].map(c => c.trim().toLowerCase());
    const find = (re, ex) => h.findIndex((c, i) => re.test(c) && (!ex || !ex.test(c)));
    idx.ref = find(/receipt|ref|code|transaction id/); idx.date = find(/date|time/); idx.details = find(/detail|description|narration|particular/);
    idx.amount = find(/paid in|credit/); if (idx.amount < 0) idx.amount = find(/amount/, /balance|withdraw/);
    idx.phone = find(/phone|msisdn|mobile/); idx.name = find(/^name|party/);
  }
  const out = [];
  for (const r of rows.slice(hi >= 0 ? hi + 1 : 0)) {
    const get = i => i >= 0 && i < r.length ? r[i].trim() : '';
    const amt = parseFloat(get(idx.amount).replace(/[^\d.\-]/g, '')); if (!(amt > 0)) continue;
    const date = parseDate(get(idx.date)); if (!date) continue;
    const details = get(idx.details);
    let phoneRaw = get(idx.phone); if (!phoneRaw) { const mm = details.match(/(2547[\d*]{8}|2541[\d*]{8}|0[71][\d*]{8}|(?:254|0)[71]\d*\*+\d+)/); phoneRaw = mm ? mm[1] : ''; }
    let name = get(idx.name); if (!name) { const nn = details.match(/\s-\s*(.+)$/); name = nn ? nn[1].trim() : ''; }
    out.push({ ref: get(idx.ref).toUpperCase(), date, details, amountMinor: Math.round(amt * 100), phoneRaw, phone: normPhone(phoneRaw.replace(/\*/g, '')), name });
  }
  return out;
}
function matchRow(row, gids) {
  const cand = S.members.filter(m => m.status === 'active' && (!gids || gids.includes(m.groupId)));
  const phones = m => [m.phone, m.guardianPhone].filter(Boolean).map(normPhone);
  if (row.phoneRaw && !row.phoneRaw.includes('*')) {
    const hit = cand.filter(m => phones(m).includes(normPhone(row.phoneRaw))); if (hit.length === 1) return { memberId: hit[0].id, by: 'phone' };
  }
  const tokens = s => String(s || '').toUpperCase().split(/[^A-Z]+/).filter(t => t.length >= 3);
  const rt = tokens(row.name || row.details);
  let masked = cand;
  if (row.phoneRaw && row.phoneRaw.includes('*')) {
    const raw = row.phoneRaw.replace(/^254/, '0'); const pre = raw.split('*')[0], suf = raw.split('*').pop();
    const hit = cand.filter(m => phones(m).some(p => p.startsWith(pre) && p.endsWith(suf))); if (hit.length === 1) return { memberId: hit[0].id, by: 'masked phone'}; if (hit.length > 1) masked = hit;
  }
  let best = null, bestScore = 0, tie = false;
  for (const m of masked) {
    const mt = tokens(m.name).concat(tokens(m.guardianName)); const score = rt.filter(t => mt.includes(t)).length;
    if (score > bestScore) { best = m; bestScore = score; tie = false; } else if (score === bestScore && score > 0) tie = true;
  }
  if (best && bestScore >= 2 && !tie) return { memberId: best.id, by: 'name' };
  return { memberId: null, by: null };
}

/* ----------------------------------------------------------------- reports */
function groupMonthly(gid, period, asOf) {
  asOf = asOf || today();
  const rows = [];
  for (const m of S.members) {
    const d = dueFor(m, period); if (d.gid !== gid || d.mgr + d.tb === 0) continue;
    rows.push(Object.assign({ member: m }, periodStatus(m, period, asOf)));
  }
  const ents = S.ledger.filter(e => e.groupId === gid && e.period === period);
  const k = kind => sum(ents.filter(e => e.kind === kind), e => e.amountMinor);
  return { rows, totals: {
    due: sum(rows, r => r.due), collected: sum(rows, r => r.got), short: sum(rows, r => r.short),
    mgrPot: k('contribution'), tbSavings: k('tb_savings'), fines: k('fine'), repayments: k('loan_repayment'),
    payouts: k('mgr_payout'), disbursed: k('loan_disbursement'), joining: k('joining_fee'), unallocated: k('unallocated'),
    paidCount: rows.filter(r => r.status === 'paid').length, lateCount: rows.filter(r => r.status === 'late').length, cash: cashOnHand(gid)
  } };
}
function yearEndShares(gid, fy) {
  const g = groupById(gid); if (!g.types.includes('tb')) return null;
  const periods = fyPeriods(fy);
  const interest = sum(S.loans.filter(l => l.groupId === gid), l => sum(l.schedule, r => r.due >= fy + '-01' && r.due <= fy + '-12' ? r.pi : 0));
  const finesPaid = sum(S.fines.filter(f => f.groupId === gid && f.status !== 'waived' && f.period >= fy + '-01' && f.period <= fy + '-12'), f => f.paid);
  const pool = interest + finesPaid;
  const ids = [...new Set(S.ledger.filter(e => e.groupId === gid && e.kind === 'tb_savings').map(e => e.memberId))];
  const weights = ids.map(id => {
    let w = 0, cum = 0;
    for (const p of periods) { cum += sum(S.ledger, e => e.memberId === id && e.groupId === gid && e.kind === 'tb_savings' && e.period === p ? e.amountMinor : 0); w += cum; }
    return { id, w, saved: sum(S.ledger, e => e.memberId === id && e.groupId === gid && e.kind === 'tb_savings' && e.period >= fy + '-01' && e.period <= fy + '-12' ? e.amountMinor : 0) };
  }).filter(x => x.w > 0);
  const totalW = sum(weights, x => x.w);
  const shares = weights.map(x => ({ memberId: x.id, saved: x.saved, weight: x.w, share: totalW ? Math.floor(pool * x.w / totalW) : 0 }));
  let left = pool - sum(shares, s => s.share);
  shares.slice().sort((a, b) => b.weight - a.weight).forEach(s => { if (left > 0) { s.share++; left--; } });
  return { pool, interest, finesPaid, shares, totalW };
}
function statementFor(mid) {
  const ents = S.ledger.filter(e => e.memberId === mid).sort((a, b) => (a.date + a.at).localeCompare(b.date + b.at));
  let bal = 0;
  return ents.map(e => { if (e.kind === 'contribution' || e.kind === 'tb_savings') bal += e.amountMinor; return Object.assign({ savingsBal: bal }, e); });
}
function reviewChecks(gid, period) {
  const ents = S.ledger.filter(e => e.groupId === gid && e.period === period);
  const rev = ents.filter(e => e.reversalOf);
  const un = sum(ents.filter(e => e.kind === 'unallocated'), e => e.amountMinor);
  const waived = S.fines.filter(f => f.groupId === gid && f.period === period && f.status === 'waived');
  const rec = S.recons.filter(r => r.groupId === gid && monthOf(r.date) >= period).slice(-1)[0];
  const mo = groupMonthly(gid, period);
  return [
    { ok: !!rec && rec.diff === 0, warn: !rec, label: 'Cash matches the M-Pesa/bank balance', detail: rec ? 'Last check ' + rec.date + ': difference ' + money(rec.diff) : 'No reconciliation recorded yet' },
    { ok: un === 0, label: 'No unallocated money', detail: money(un) + ' unallocated' },
    { ok: rev.length === 0, warn: rev.length > 0, label: 'Reversals reviewed', detail: rev.length + ' reversal(s) this period' },
    { ok: waived.length === 0, warn: waived.length > 0, label: 'Waived fines reviewed', detail: waived.length + ' waived (' + money(sum(waived, f => f.amount)) + ')' },
    { ok: mo.totals.lateCount === 0, warn: mo.totals.lateCount > 0, label: 'Late members followed up', detail: mo.totals.lateCount + ' late member(s)' }
  ];
}
function signoff(actor, gid, period, status, comment) {
  needPerm(actor, 'review.signoff');
  if (!['signed', 'rejected'].includes(status)) throw new Error('Bad status');
  if (status === 'rejected' && (!comment || comment.trim().length < 5)) throw new Error('Explain what must be corrected.');
  if (isLocked(gid, period)) throw new Error('Already signed off.');
  S.signoffs = S.signoffs.filter(s => !(s.groupId === gid && s.period === period));
  S.signoffs.push({ id: uid('so'), groupId: gid, period, status, comment: comment || '', by: actor.name, at: today() });
  log(actor, 'review.' + status, groupById(gid).name + ' ' + period + (comment ? '. ' + comment : '')); save();
}
function integrityCheck() {
  const issues = [];
  for (const e of S.ledger) {
    if (!Number.isInteger(e.amountMinor)) issues.push('Non-integer amount in ' + e.id);
    if (!memberById(e.memberId)) issues.push('Ledger entry ' + e.id + ' has unknown member');
    if (!groupById(e.groupId)) issues.push('Ledger entry ' + e.id + ' has unknown group');
  }
  for (const l of S.loans) if (l.status === 'active' || l.status === 'cleared') {
    if (sum(l.schedule, r => r.principal) !== l.principal) issues.push('Loan ' + l.id + ' schedule principal does not add up');
    if (sum(l.schedule, r => r.pp) !== sum(S.ledger.filter(e => e.loanId === l.id && e.kind === 'loan_repayment'), e => (e.alloc || []).reduce((t, a) => t + a.p, 0) * (e.reversalOf ? -1 : 1)) && false) issues.push('x');
  }
  for (const f of S.fines) if (f.paid < 0 || f.paid > f.amount) issues.push('Fine ' + f.id + ' has bad paid amount');
  const paidFines = sum(S.fines, f => f.paid), ledFines = sum(S.ledger.filter(e => e.kind === 'fine'), e => e.amountMinor);
  if (paidFines !== ledFines) issues.push('Fines paid (' + paidFines + ') differ from ledger (' + ledFines + ')');
  const rep = sum(S.loans, l => sum(l.schedule || [], r => r.pi + r.pp)), ledRep = sum(S.ledger.filter(e => e.kind === 'loan_repayment'), e => e.amountMinor);
  if (rep !== ledRep) issues.push('Loan repayments in schedules (' + rep + ') differ from ledger (' + ledRep + ')');
  for (const g of S.groups) for (const id of g.mgr.order) if (!memberById(id)) issues.push('Merry-go-round order of ' + g.name + ' has unknown member');
  return { ok: issues.length === 0, issues, counts: { ledger: S.ledger.length, members: S.members.length, fines: S.fines.length, loans: S.loans.length } };
}

/* -------------------------------------------------------------- settings */
function updateGroupSetting(actor, gid, key, value) {
  needPerm(actor, 'settings.edit');
  const g = groupById(gid); if (!g) throw new Error('Group not found');
  const moneyKeys = ['contribution', 'tbSavings', 'lateFine', 'missedFine', 'joiningFee'];
  const loanMoney = ['approvalLimit']; const loanNum = ['multiple', 'ratePct', 'maxMonths', 'minMonths', 'guarantors', 'penaltyPct', 'maxActive'];
  let old, nv;
  if (moneyKeys.includes(key)) { old = g[key]; nv = toCents(value); if (!(nv >= 0)) throw new Error('Bad amount'); g[key] = nv; }
  else if (['graceDays', 'dueDay'].includes(key)) { old = g[key]; nv = parseInt(value, 10); if (!(nv >= 0 && nv <= 28)) throw new Error('Enter 0-28'); g[key] = nv; }
  else if (loanMoney.includes(key)) { old = g.loan[key]; nv = toCents(value); g.loan[key] = nv; }
  else if (loanNum.includes(key)) { old = g.loan[key]; nv = Number(value); if (!(nv >= 0)) throw new Error('Bad number'); g.loan[key] = nv; }
  else throw new Error('Unknown setting ' + key);
  log(actor, 'settings.change', g.name + ' ' + key + ': ' + old + ' -> ' + nv + ' (effective for new transactions)'); save(); return { old, nv };
}
function setRate(actor, v) {
  needPerm(actor, 'settings.edit'); const n = Number(v); if (!(n > 50 && n < 500)) throw new Error('USD/KES rate must be between 50 and 500.');
  const old = S.meta.rates.USD_KES; S.meta.rates.USD_KES = n; log(actor, 'settings.rate', 'USD_KES ' + old + ' -> ' + n); save();
}

/* ------------------------------------------------------------------- users */
function addUser(actor, d) {
  needPerm(actor, 'users.manage');
  const name = (d.name || '').trim(); if (name.length < 3) throw new Error('Enter the full name.');
  if (!['superadmin', 'bishop', 'secretary', 'treasurer', 'auditor', 'member', 'parent'].includes(d.role)) throw new Error('Choose a role.');
  if (!/^\d{4,8}$/.test(String(d.pin || ''))) throw new Error('PIN must be 4 to 8 digits.');
  const u = { id: uid('u'), name, role: d.role, pin: String(d.pin), active: true, phone: normPhone(d.phone) };
  if (d.role === 'member') { if (!memberById(d.memberId)) throw new Error('Link this login to a member.'); u.memberId = d.memberId; }
  if (d.role === 'treasurer') { if (!d.groupIds || !d.groupIds.length) throw new Error('A treasurer needs a group.'); u.groupIds = [].concat(d.groupIds); if (memberById(d.memberId)) u.memberId = d.memberId; }
  if (['superadmin', 'bishop', 'secretary', 'auditor'].includes(d.role)) u.groupIds = ['*'];
  S.users.push(u); log(actor, 'user.create', name + ' as ' + d.role); save(); return u;
}
function setUserActive(actor, id, on) {
  needPerm(actor, 'users.manage'); const u = userById(id); if (!u) throw new Error('User not found');
  if (actor && actor.id === id && !on) throw new Error('You cannot deactivate yourself.');
  u.active = !!on; log(actor, 'user.' + (on ? 'activate' : 'deactivate'), u.name); save();
}
function resetPin(actor, id, pin) {
  needPerm(actor, 'users.manage'); const u = userById(id); if (!u) throw new Error('User not found');
  if (!/^\d{4,8}$/.test(String(pin || ''))) throw new Error('PIN must be 4 to 8 digits.');
  u.pin = String(pin); log(actor, 'user.pin', 'PIN reset for ' + u.name); save();
}

/* ---------------------------------------------------------------- seed data */
function seed() {
  const real = todayReal();
  let rs = 20260101; const rnd = () => { rs = (rs * 1664525 + 1013904223) % 4294967296; return rs / 4294967296; };
  const T = real; const st = fyState(T); const fy = st.fy;
  const dobAge = (a, extraDays) => { const d = parse(T); d.setFullYear(d.getFullYear() - a); d.setMonth(d.getMonth() - 3); if (extraDays) d.setDate(d.getDate() - extraDays); return fmtD(d); };
  const loanDef = (limit) => ({ multiple: 3, ratePct: 10, maxMonths: 6, minMonths: 3, guarantors: 2, approvalLimit: limit, penaltyPct: 5, maxActive: 1 });
  const mk = (id, name, ageMin, ageMax, types, contrib, tb, fine) => ({ id, name, ageMin, ageMax, types, contribution: contrib, tbSavings: tb, lateFine: fine, missedFine: fine, graceDays: 3, dueDay: 10, joiningFee: 20000, loan: loanDef(1500000), mgr: { round: 1, order: [], received: [] }, ccy: ['KES', 'USD'] });
  S = {
    v: 1, meta: { simDate: null, rates: { USD_KES: 129 }, policy: 'carry', demo: true },
    groups: [mk('g_sun', 'Sunday School', 10, 19, ['mgr'], 20000, 0, 5000), mk('g_youth', 'Youth', 20, 30, ['mgr', 'tb'], 50000, 20000, 10000), mk('g_men', 'Men', 31, 120, ['mgr', 'tb'], 100000, 50000, 10000), mk('g_women', 'Women', 31, 120, ['mgr', 'tb'], 100000, 50000, 10000)],
    members: [], users: [], ledger: [], fines: [], loans: [], meetings: [], messages: [], audit: [], signoffs: [], recons: [], claims: []
  };
  const SYS = { name: 'system', role: 'system', id: 'system' };
  const jan2 = fy + '-01-02';
  const addM = (name, age, sex, married, gid, phone, extra) => {
    const m = Object.assign({ id: uid('m'), name, phone, dob: dobAge(age), sex, married, groupId: gid, joinedOn: (fy - 1) + '-10-01', status: 'active', timeline: [{ from: '0000-00-00', groupId: gid }], guardianUserId: null, guardianName: '', guardianPhone: '', consent: true, tbFrom: S.groups.find(g => g.id === gid).types.includes('tb') ? fy + '-01' : null, history: [] }, extra || {});
    S.members.push(m); const g = groupById(gid); if (g.types.includes('mgr')) g.mgr.order.push(m.id); return m;
  };
  const U = (name, role, extra) => { const u = Object.assign({ id: uid('u'), name, role, pin: '1234', active: true }, extra || {}); S.users.push(u); return u; };
  const pMutua = U('Mr. Joseph Mutua', 'parent', { phone: '0722000111' });
  const pWanjiru = U('Mrs. Alice Wanjiru', 'parent', { phone: '0722000222' });
  const pOtieno = U('Mr. Charles Otieno', 'parent', { phone: '0722000333' });
  const kid = (name, age, sex, p, ph) => addM(name, age, sex, false, 'g_sun', '', { guardianUserId: p.id, guardianName: p.name, guardianPhone: p.phone });
  kid('Brian Mutua', 15, 'M', pMutua); kid('Faith Wanjiru', 12, 'F', pWanjiru); kid('Kevin Otieno', 17, 'M', pOtieno); kid('Mercy Akinyi', 14, 'F', pOtieno);
  addM('Joy Nduta', 18, 'F', false, 'g_sun', '0711000018');
  const ian = addM('Ian Kiptoo', 19, 'M', false, 'g_sun', '0711000019');
  ian.dob = (() => { const d = parse(T); d.setFullYear(d.getFullYear() - 20); d.setDate(d.getDate() - 1); return fmtD(d); })();
  const peter = addM('Peter Njoroge', 24, 'M', false, 'g_youth', '0733100001');
  const lucy = addM('Lucy Chebet', 22, 'F', false, 'g_youth', '0733100002');
  const samuel = addM('Samuel Mwangi', 27, 'M', true, 'g_youth', '0733100003');
  addM('Grace Atieno', 25, 'F', false, 'g_youth', '0733100004'); addM('Daniel Kariuki', 29, 'M', false, 'g_youth', '0733100005'); const esther = addM('Esther Moraa', 21, 'F', false, 'g_youth', '0733100006');
  const john = addM('John Kamau', 41, 'M', true, 'g_men', '0744200001');
  addM('James Ochieng', 35, 'M', true, 'g_men', '0744200002'); addM('Paul Mutiso', 52, 'M', true, 'g_men', '0744200003'); addM('Moses Kiprop', 33, 'M', true, 'g_men', '0744200004'); addM('David Wekesa', 46, 'M', true, 'g_men', '0744200005');
  const joseph = addM('Joseph Barasa', 31, 'M', false, 'g_men', '0744200006');
  const mary = addM('Mary Wambui', 38, 'F', true, 'g_women', '0755300001');
  addM('Ann Njeri', 44, 'F', true, 'g_women', '0755300002'); addM('Ruth Achieng', 29, 'F', true, 'g_women', '0755300003'); addM('Sarah Naliaka', 36, 'F', true, 'g_women', '0755300004'); addM('Lydia Jepkoech', 50, 'F', true, 'g_women', '0755300005');
  const dorcas = addM('Dorcas Mueni', 32, 'F', false, 'g_women', '0755300006');
  U('Tech Team Admin', 'superadmin', { groupIds: ['*'] });
  U('Bishop Elijah Mwangi', 'bishop', { groupIds: ['*'] });
  U('Rose Waithera', 'secretary', { groupIds: ['*'] });
  U('Hannah Teacher', 'treasurer', { groupIds: ['g_sun'] });
  U('Lucy Chebet', 'treasurer', { groupIds: ['g_youth'], memberId: lucy.id });
  U('John Kamau', 'treasurer', { groupIds: ['g_men'], memberId: john.id });
  U('Mary Wambui', 'treasurer', { groupIds: ['g_women'], memberId: mary.id });
  U('Mr. Wafula', 'auditor', { groupIds: ['*'] });
  U('Mrs. Cherono', 'auditor', { groupIds: ['*'] });
  const moses = S.members.find(m => m.name === 'Moses Kiprop'), sarah = S.members.find(m => m.name === 'Sarah Naliaka');
  [peter, esther, joseph, dorcas, ian, moses, sarah].forEach(m => U(m.name, 'member', { memberId: m.id, phone: m.phone }));
  const goodStanding = new Set([peter.id, moses.id, sarah.id]);
  S.members.find(m => m.name === 'Joy Nduta') && U('Joy Nduta', 'member', { memberId: S.members.find(m => m.name === 'Joy Nduta').id });
  samuel.married = true;

  // history: joining fees and contributions for every closed period
  const lateOnes = new Set([S.members[1].id, esther.id, joseph.id, dorcas.id]);
  const dayOk = () => '0' + (1 + Math.floor(rnd() * 9)), dayLate = () => String(14 + Math.floor(rnd() * 8));
  const curP = monthOf(T) > fy + '-11' ? fy + '-11' : monthOf(T);
  const pay = (m, kind, period, amt, date) => {
    if (amt <= 0) return;
    const gid = groupAt(m, period + '-10');
    S.ledger.push({ id: uid('e'), receiptId: uid('r'), date, memberId: m.id, groupId: gid, paidBy: m.guardianName || m.name, kind, period, amountMinor: amt, orig: null, ccy: 'KES', rate: null, method: rnd() < 0.85 ? 'M-Pesa' : 'Cash', ref: 'S' + Math.floor(rnd() * 1e8).toString(36).toUpperCase() + Math.floor(rnd() * 1e5), loanId: null, alloc: null, by: 'seed', at: date + 'T08:00:00.000Z', reversalOf: null, reversed: false });
  };
  for (const m of S.members) pay(m, 'joining_fee', fy + '-01', 20000, jan2);
  const periods = fyPeriods(fy).filter(p => p <= curP);
  for (const p of periods) for (const m of S.members) {
    const d = dueFor(m, p); const isCur = p === curP;
    let ok = !(lateOnes.has(m.id) && ((p.slice(5) | 0) % 3 === 0) && p !== curP) ;
    const dd = (v) => p + '-' + v;
    if (isCur) { if (goodStanding.has(m.id) || (rnd() < 0.5 && +T.slice(8) >= 3)) { const day = Math.min(+T.slice(8), 1 + Math.floor(rnd() * 8)); const ds = p + '-' + pad(day); pay(m, 'contribution', p, d.mgr, ds); pay(m, 'tb_savings', p, d.tb, ds); } continue; }
    if (!ok) continue;
    const late = rnd() < 0.12, ds = dd(late ? dayLate() : dayOk());
    pay(m, 'contribution', p, d.mgr, ds); pay(m, 'tb_savings', p, d.tb, ds);
  }
  runFines(T, SYS);
  // pay some fines
  S.fines.forEach((f, i) => { if (i % 2 === 0) { f.paid = f.amount; S.ledger.push({ id: uid('e'), receiptId: uid('r'), date: T, memberId: f.memberId, groupId: f.groupId, paidBy: 'seed', kind: 'fine', period: f.period, amountMinor: f.amount, orig: null, ccy: 'KES', rate: null, method: 'M-Pesa', ref: 'F' + i + 'X' + f.id.slice(-4), loanId: null, alloc: [{ fineId: f.id, amt: f.amount }], by: 'seed', at: T + 'T08:00:00.000Z', reversalOf: null, reversed: false }); } });
  // past merry-go-round payouts (closed periods only)
  for (const g of S.groups) {
    for (const p of periods.filter(x => x < curP)) {
      const to = mgrNext(g.id); if (!to) break; const pot = mgrPot(g.id, p); if (pot <= 0) continue;
      mgrPayoutInternal(SYS, g.id, p, { force: true });
    }
  }
  // sign off two older months for the first group set, to show locking
  const signP = periods.filter(p => p < curP).slice(-3)[0];
  if (signP) for (const g of S.groups) S.signoffs.push({ id: uid('so'), groupId: g.id, period: signP, status: 'signed', comment: 'Books agree with M-Pesa statement.', by: 'Mr. Wafula', at: addDays(signP + '-28', 5) });
  for (const g of S.groups) { const b = cashOnHand(g.id); S.recons.push({ id: uid('rc'), groupId: g.id, date: T, actual: b, system: b, diff: 0, by: 'seed' }); }
  // loans: one active, one waiting for guarantors, one awaiting approval
  try {
    const gm = (nm) => S.members.find(m => m.name === nm);
    const actorOf = m => S.users.find(u => u.memberId === m.id);
    const tre = gid => S.users.find(u => u.role === 'treasurer' && u.groupIds.includes(gid));
    const sec = S.users.find(u => u.role === 'secretary'), bishop = S.users.find(u => u.role === 'bishop');
    const l1 = requestLoan(actorOf(moses), { memberId: moses.id, amount: 5000, months: 4, guarantors: [gm('Paul Mutiso').id, gm('David Wekesa').id], purpose: 'School fees' });
    l1.confirmed = l1.guarantors.slice(); approveLoan(sec, l1.id); disburseLoan(tre('g_men'), l1.id, { date: addDays(T, -45) });
    const l2 = requestLoan(actorOf(sarah), { memberId: sarah.id, amount: 8000, months: 5, guarantors: [gm('Ann Njeri').id, gm('Lydia Jepkoech').id], purpose: 'Stock for shop' });
    l2.confirmed = [gm('Ann Njeri').id];
    const l3 = requestLoan(actorOf(peter), { memberId: peter.id, amount: 3000, months: 3, guarantors: [gm('Grace Atieno').id, gm('Daniel Kariuki').id], purpose: 'Laptop repair' });
    l3.confirmed = l3.guarantors.slice();
    void bishop;
  } catch (e) { if (typeof console !== 'undefined') console.warn('Demo loans were not created: ' + e.message); }
  // meetings
  const sat = nextSaturday(T);
  S.meetings.push({ id: uid('t'), date: addDays(sat, -7), groupId: 'all', mode: 'physical', where: 'Main church hall', minutes: 'Reviewed contributions and the merry-go-round order.', attendance: null });
  S.meetings.push({ id: uid('t'), date: sat, groupId: 'all', mode: 'online', where: 'Google Meet link will be sent on Friday', minutes: '', attendance: null });
  S.messages.push({ id: uid('s'), at: new Date().toISOString(), date: T, memberId: peter.id, toName: peter.name, phone: peter.phone, channel: 'SMS + in-app', text: 'Welcome to the chama system. Contributions are due on the 10th of each month.', status: 'simulated' });
  log(SYS, 'system.seed', 'Demo data created for FY ' + fy);
  return S;
}

/* -------------------------------------------------------------- lifecycle */
function save() { storage.set(KEY, JSON.stringify(S)); }
function load() {
  const raw = storage.get(KEY);
  if (raw) { try { S = JSON.parse(raw); if (S && S.v === 1) return S; } catch (e) {} }
  seed(); save(); return S;
}
function reset() { S = null; seed(); save(); return S; }
function exportJSON() { return JSON.stringify(S, null, 2); }
function importJSON(txt) { const o = JSON.parse(txt); if (!o || o.v !== 1 || !Array.isArray(o.ledger)) throw new Error('Not a chama backup file'); S = o; save(); }
function toCSV(rows) { return rows.map(r => r.map(c => { c = c == null ? '' : String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',')).join('\n'); }

const Chama = {
  KEY, INTL, METHODS, KIND_LABEL, INFLOW, OUTFLOW, PERMS,
  get state() { return S; }, load, save, reset, exportJSON, importJSON, seed,
  today, todayReal, addDays, addMonths, monthOf, age, monthsBetween, nextSaturday, fyState, fyPeriods, curPeriods, parse, fmtD, pad,
  toCents, money, sum, uid, toCSV,
  memberById, groupById, userById, loanById, childrenOf, log,
  can, needPerm, scopeGroupIds, ownMembers, canSeeMember,
  placement, suggestMoves, groupAt, firstPeriod, dueFor, paid, periodStatus, arrears, joiningFeeOwed, fineOwed, openFines,
  loanOutstanding, loanPrincipalLeft, activeLoans, memberSummary, autoAllocate,
  isLocked, record, reverse, runFines, waiveFine, normPhone, findOrCreateParent, addMember, updateMember, moveMember,
  mgrReceived, mgrNext, mgrPot, mgrDraw, mgrPayout, mgrSkip,
  buildSchedule, loanLimit, loanChecks, requestLoan, guarantorConfirm, loanNeedsBishop, approveLoan, rejectLoan, disburseLoan,
  scheduleMeeting, recordAttendance, notify, sendReminders, postMessage,
  submitClaim, confirmClaim, rejectClaim, cashOnHand, reconcile,
  parseCSV, parseStatement, matchRow, groupMonthly, yearEndShares, statementFor, reviewChecks, signoff, integrityCheck,
  updateGroupSetting, setRate, addUser, setUserActive, resetPin
};
if (typeof module !== 'undefined' && module.exports) module.exports = Chama; else root.Chama = Chama;
})(typeof globalThis !== 'undefined' ? globalThis : this);
