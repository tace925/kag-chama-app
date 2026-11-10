/* views1.js — Home, Members, Contributions, Merry-go-round, Loans */
(function () {
'use strict';
const C = window.Chama, A = window.App;
const { esc, dfmt, pfmt, chip, field, select, kpi, table, bar, card, empty, money, gname, mname, toast, modal, closeModal } = A;
const STAFF = ['superadmin', 'bishop', 'secretary', 'treasurer', 'auditor'], ALL = STAFF.concat(['member', 'parent']);
const R = (n, t, roles, render, after) => { A.routes[n] = { title: t, roles, render, after }; };
const me = () => A.user, isOwner = u => u.role === 'member' || u.role === 'parent';
const cur = () => A.curPeriod();
const scopeMembers = () => { const ids = C.scopeGroupIds(me()); return C.state.members.filter(m => ids.includes(m.groupId)); };
const canMoney = () => C.can(me(), 'money.view');
const link = (h, t) => '<a href="#/' + h + '">' + t + '</a>';

/* ================================================================ HOME */
R('dashboard', 'Home', ALL, () => isOwner(me()) ? ownerDash() : staffDash());

function acctCard(m) {
  const s = C.memberSummary(m.id), p = cur(), ps = C.periodStatus(m, p), g = C.groupById(m.groupId);
  return card(esc(m.name) + ' <span class="chip info">' + esc(g.name) + '</span>',
    '<div class="grid g4">' + kpi('Merry-go-round paid', money(s.mgrContributed)) + (g.types.includes('tb') ? kpi('Savings (table banking)', money(s.tbSavings)) : '') +
    kpi('Overdue', money(s.arrears), '', s.arrears ? 'bad' : 'ok') + kpi('Fines owed', money(s.finesOwed), '', s.finesOwed ? 'warn' : '') +
    (s.joiningFeeOwed ? kpi('Joining fee owed', money(s.joiningFeeOwed), '', 'warn') : '') + '</div>' +
    '<div class="row between" style="margin-top:12px"><span>' + pfmt(p) + ': ' + chip(ps.status) + (ps.due ? ' <span class="muted small">due ' + money(ps.due) + ' by ' + dfmt(ps.dueDate) + '</span>' : '') + '</span>' +
    '<span class="row"><a class="btn sm" href="#/statement/' + m.id + '">Statement</a><button class="btn sm primary" data-act="claimForm" data-id="' + m.id + '">I have paid</button></span></div>' +
    (s.loanOutstanding ? '<p class="small">Loan balance: <b>' + money(s.loanOutstanding) + '</b></p>' : ''));
}
function ownerDash() {
  const u = me(), accts = C.ownMembers(u), t = A.today();
  const nm = C.state.meetings.filter(x => x.date >= t && accts.some(a => x.groupId === 'all' || x.groupId === a.groupId)).sort((a, b) => a.date.localeCompare(b.date))[0];
  const ask = C.state.loans.filter(l => l.status === 'requested' && u.memberId && l.guarantors.includes(u.memberId) && !l.confirmed.includes(u.memberId));
  const unread = C.state.messages.filter(x => accts.some(a => a.id === x.memberId)).slice(-3).reverse();
  return (ask.length ? '<div class="notice warn">' + ask.length + ' loan request(s) are waiting for you to confirm as guarantor. ' + link('loans', 'Open Loans') + '</div>' : '') +
    (u.role === 'parent' ? '<div class="notice">You manage the accounts of your children. You pay, and the money is recorded in <b>their</b> names.</div>' : '') +
    accts.map(acctCard).join('') +
    '<div class="grid g2">' + card('Next meeting', nm ? '<p><b>' + dfmt(nm.date) + '</b> ' + chip(nm.mode === 'online' ? 'info' : 'ok').replace(/>.*?</, '>' + (nm.mode === 'online' ? 'Online' : 'Physical') + '<') + '</p><p class="muted">' + esc(nm.where || 'Details will be communicated.') + '</p>' : empty('No meeting scheduled yet.')) +
    card('Recent messages', unread.length ? unread.map(x => '<div class="msg" style="margin-bottom:6px"><small class="muted">' + dfmt(x.date) + '</small><br>' + esc(x.text) + '</div>').join('') + '<p class="small">' + link('messages', 'All messages') + '</p>' : empty('No messages.')) + '</div>';
}
function staffDash() {
  const u = me(), gs = A.visibleGroups(), p = cur(), money_ = canMoney();
  const sc = C.scopeGroupIds(u), att = [];
  const loans = C.state.loans.filter(l => sc.includes(l.groupId));
  const w = loans.filter(l => l.status === 'requested' && l.confirmed.length === l.guarantors.length && (u.role === 'bishop' || !C.loanNeedsBishop(l))).length;
  if (C.can(u, 'loans.approve') && w) att.push(['loans', w + ' loan request(s) waiting for your approval']);
  const d = loans.filter(l => l.status === 'approved').length; if (C.can(u, 'loans.disburse') && d) att.push(['loans', d + ' approved loan(s) waiting to be disbursed']);
  const cl = C.state.claims.filter(c => c.status === 'pending' && sc.includes(c.groupId)).length; if (C.can(u, 'claims.review') && cl) att.push(['contributions', cl + ' payment claim(s) from members to confirm']);
  const mv = C.can(u, 'members.move') ? C.suggestMoves().filter(s => sc.includes(s.from)).length : 0; if (mv) att.push(['members', mv + ' member(s) due to move to another group']);
  if (C.can(u, 'review.view')) { const pp = C.addMonths(cur(), -1); const n = gs.filter(g => C.fyPeriods(C.fyState(A.today()).fy).includes(pp) && !C.isLocked(g.id, pp)).length; if (n) att.push(['review', n + ' group(s) have ' + pfmt(pp) + ' books not yet signed off']); }
  if (money_) { const late = gs.reduce((t, g) => t + C.groupMonthly(g.id, p).totals.lateCount, 0); if (late) att.push(['contributions', late + ' member(s) are late this month']); }
  return (C.state.meta.demo ? '<div class="notice">Demo data is loaded so you can explore every role. The super admin can reset it under Settings.</div>' : '') +
    (att.length ? card('Needs attention', '<div class="list">' + att.map(a => '<div class="li"><span>' + esc(a[1]) + '</span>' + link(a[0], 'Open →') + '</div>').join('') + '</div>') : '') +
    '<div class="grid g2">' + gs.map(g => {
      const mo = C.groupMonthly(g.id, p), n = C.state.members.filter(m => m.groupId === g.id && m.status === 'active').length, nx = C.mgrNext(g.id);
      const pct = mo.totals.due ? Math.round(100 * mo.totals.collected / mo.totals.due) : 0;
      return card(esc(g.name) + ' <span class="chip muted">' + n + ' members</span>',
        (money_ ? '<div class="row between"><span class="muted small">' + pfmt(p) + ' collected</span><b>' + money(mo.totals.collected) + ' / ' + money(mo.totals.due) + '</b></div>' + bar(pct, pct < 50 ? 'warn' : '') +
          '<div class="grid g3" style="margin-top:10px">' + kpi('Late', mo.totals.lateCount, '', mo.totals.lateCount ? 'bad' : 'ok') + kpi('Cash on hand', money(mo.totals.cash)) + kpi('Loans out', C.state.loans.filter(l => l.groupId === g.id && l.status === 'active').length) + '</div>' : '') +
        (g.types.includes('mgr') ? '<p class="small" style="margin-top:8px">Next merry-go-round recipient: <b>' + (nx ? esc(mname(nx)) : '—') + '</b> · round ' + g.mgr.round + '</p>' : ''));
    }).join('') + '</div>';
}

/* ================================================================ MEMBERS */
function memberRows() {
  const gid = A.f.mg || 'all', q = (A.f.mq || '').toLowerCase(), m_ = canMoney();
  const ms = scopeMembers().filter(m => (gid === 'all' || m.groupId === gid) && (!q || m.name.toLowerCase().includes(q) || (m.phone || '').includes(q)));
  return ms.map(m => { const s = m_ ? C.memberSummary(m.id) : null;
    return '<tr><td><b>' + esc(m.name) + '</b>' + (m.guardianName ? '<br><small class="muted">Guardian: ' + esc(m.guardianName) + '</small>' : '') + '</td><td>' + esc(gname(m.groupId)) + '</td><td class="num">' + C.age(m.dob) + '</td><td>' + (m.married ? 'Married' : 'Single') + '</td>' +
      (m_ ? '<td class="num">' + money(s.mgrContributed + s.tbSavings) + '</td><td class="num">' + (s.arrears ? '<span class="chip bad">' + money(s.arrears) + '</span>' : '—') + '</td>' : '') +
      '<td><button class="btn sm" data-act="memberView" data-id="' + m.id + '">Open</button></td></tr>'; }).join('') || '<tr><td colspan="8" class="empty">No members found.</td></tr>';
}
R('members', 'Members', STAFF, () => {
  const u = me(), gs = A.visibleGroups(), m_ = canMoney();
  const moves = C.can(u, 'members.move') ? C.suggestMoves().filter(s => C.scopeGroupIds(u).includes(s.from)) : [];
  return (moves.length ? card('Suggested group moves', '<p class="small muted">The system found these members whose age or marital status no longer fits their group. Confirm to move them from next month. Savings and loans carry over.</p><div class="list">' +
      moves.map(s => '<div class="li"><span><b>' + esc(mname(s.memberId)) + '</b> · ' + esc(gname(s.from)) + ' → <b>' + esc(gname(s.to)) + '</b> <span class="muted small">(' + esc(s.reason) + ')</span></span><button class="btn sm primary" data-act="moveMember" data-id="' + s.memberId + '" data-to="' + s.to + '" data-confirm="Move ' + esc(mname(s.memberId)) + ' to ' + esc(gname(s.to)) + '?">Move</button></div>').join('') + '</div>') : '') +
    card('Members', '<div class="row" style="margin-bottom:10px"><div style="min-width:180px;flex:1"><input type="search" placeholder="Search name or phone" value="' + esc(A.f.mq || '') + '" data-live="memberSearch" aria-label="Search members"></div><div>' + select('mg', A.optGroups(gs, true), A.f.mg || 'all', 'data-live="memberGroup" aria-label="Group"') + '</div></div>' +
      '<div class="tw"><table><thead><tr><th>Name</th><th>Group</th><th class="num">Age</th><th>Status</th>' + (m_ ? '<th class="num">Saved</th><th class="num">Overdue</th>' : '') + '<th></th></tr></thead><tbody id="mrows">' + memberRows() + '</tbody></table></div>',
      C.can(u, 'members.edit') ? '<button class="btn primary sm" data-act="addMemberForm">+ Add member</button>' : '');
});
A.inputs.memberSearch = el => { A.f.mq = el.value; const b = document.getElementById('mrows'); if (b) b.innerHTML = memberRows(); };
A.inputs.memberGroup = el => { A.f.mg = el.value; A.refresh(); };
A.acts.addMemberForm = () => {
  modal('Add member', '<form data-form="addMember" class="stack">' + field('Full name', '<input name="name" required minlength="3">') +
    '<div class="cols">' + field('Date of birth', '<input name="dob" type="date" required data-live="addPreview">') + field('Sex', select('sex', [{ v: 'M', l: 'Male' }, { v: 'F', l: 'Female' }], 'M', 'data-live="addPreview"')) + '</div>' +
    '<div class="cols">' + field('Phone', '<input name="phone" inputmode="tel" placeholder="0712345678">') + field('Date joined', '<input name="joinedOn" type="date" value="' + A.today() + '" data-live="addPreview">') + '</div>' +
    '<label class="check"><input type="checkbox" name="married" data-live="addPreview"> Married</label>' +
    '<div class="notice" id="addPrev">Enter the date of birth to see the group.</div>' +
    '<fieldset class="card" style="padding:10px"><legend class="small muted">Parent / guardian (required under 18)</legend><div class="stack">' + field('Guardian name', '<input name="guardianName">') + field('Guardian phone', '<input name="guardianPhone" inputmode="tel">') +
    '<label class="check"><input type="checkbox" name="consent"> The parent/guardian agrees to us keeping this child\'s details (Data Protection Act)</label></div></fieldset>' +
    '<div class="row end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary" type="submit">Save member</button></div></form>');
};
A.inputs.addPreview = el => {
  const f = el.closest('form'), d = A.formData(f), box = f.querySelector('#addPrev'); if (!d.dob) { box.textContent = 'Enter the date of birth to see the group.'; return; }
  const on = d.joinedOn || A.today(), gid = C.placement({ dob: d.dob, sex: d.sex, married: !!d.married }, on), a = C.age(d.dob, on);
  box.className = 'notice' + (gid ? '' : ' bad'); box.textContent = gid ? 'Age ' + a + ' → ' + gname(gid) + ' group. Joining fee ' + money(C.groupById(gid).joiningFee) + ', monthly ' + money(C.groupById(gid).contribution) + '.' + (a < 18 ? ' Guardian details and consent are required.' : '') : 'Members must be at least 10 years old.';
};
A.forms.addMember = (f, d) => { const m = C.addMember(me(), d); closeModal(); toast(m.name + ' added to ' + gname(m.groupId)); A.refresh(); };
A.acts.memberView = el => {
  const m = C.memberById(el.dataset.id), u = me(); if (!C.canSeeMember(u, m.id)) throw new Error('Not allowed.');
  const s = canMoney() ? C.memberSummary(m.id) : null, g = C.groupById(m.groupId);
  modal(m.name, '<div class="stack"><div class="row"><span class="chip info">' + esc(g.name) + '</span><span class="chip muted">Age ' + C.age(m.dob) + '</span><span class="chip muted">' + (m.married ? 'Married' : 'Single') + '</span>' + chip(m.status) + '</div>' +
    '<div class="sum"><span>Phone</span><span>' + esc(m.phone || '—') + '</span></div><div class="sum"><span>Joined</span><span>' + dfmt(m.joinedOn) + '</span></div>' +
    (m.guardianName ? '<div class="sum"><span>Guardian</span><span>' + esc(m.guardianName) + ' · ' + esc(m.guardianPhone) + '</span></div>' : '') +
    (s ? '<div class="sum"><span>Merry-go-round paid</span><span>' + money(s.mgrContributed) + '</span></div><div class="sum"><span>Table-banking savings</span><span>' + money(s.tbSavings) + '</span></div><div class="sum"><span>Overdue</span><span>' + money(s.arrears) + '</span></div><div class="sum"><span>Fines owed</span><span>' + money(s.finesOwed) + '</span></div><div class="sum"><span>Loan balance</span><span>' + money(s.loanOutstanding) + '</span></div>' : '') +
    (m.history.length ? '<h4>Group history</h4>' + m.history.map(h => '<div class="small">' + dfmt(h.date) + ': ' + esc(gname(h.from)) + ' → ' + esc(gname(h.to)) + ' (from ' + dfmt(h.effective) + ')</div>').join('') : '') +
    (C.can(u, 'members.edit') ? '<form data-form="editMember" class="stack" style="border-top:1px solid var(--line);padding-top:10px"><input type="hidden" name="id" value="' + m.id + '">' + field('Phone', '<input name="phone" value="' + esc(m.phone || '') + '">') + '<label class="check"><input type="checkbox" name="married"' + (m.married ? ' checked' : '') + '> Married</label><button class="btn primary" type="submit">Save changes</button></form>' : '') +
    (canMoney() ? '<div class="row end"><a class="btn" href="#/statement/' + m.id + '" data-act="closeModal">View statement</a></div>' : '') + '</div>');
};
A.forms.editMember = (f, d) => { C.updateMember(me(), d.id, { phone: d.phone, married: !!d.married }); closeModal(); toast('Saved.'); A.refresh(); };
A.acts.moveMember = el => { const m = C.moveMember(me(), el.dataset.id, el.dataset.to); toast(m.name + ' moved to ' + gname(m.groupId) + ' from next month.'); A.refresh(); };

/* ========================================================= CONTRIBUTIONS */
R('contributions', 'Contributions', ALL, () => isOwner(me()) ? ownerContrib() : staffContrib());

function ownerContrib() {
  const u = me(), t = A.today(), fy = C.fyState(t).fy;
  const mine = C.state.claims.filter(c => C.ownMembers(u).some(m => m.id === c.memberId)).slice(-5).reverse();
  return C.ownMembers(u).map(m => {
    const rows = C.fyPeriods(fy).map(p => { const s = C.periodStatus(m, p); return s.status === 'none' ? '' :
      '<tr><td>' + pfmt(p) + '</td><td class="num">' + money(s.due) + '</td><td class="num">' + money(s.got) + '</td><td class="num">' + (s.short ? money(s.short) : '—') + '</td><td>' + chip(s.status) + '</td></tr>'; }).filter(Boolean);
    const fines = C.openFines(m.id);
    return card(esc(m.name) + ' · ' + esc(gname(m.groupId)), table(['Month', 'Due', 'Paid', 'Short', 'Status'], rows) +
      (fines.length ? '<h4>Fines</h4>' + fines.map(f => '<div class="li"><span>' + esc(f.note) + '</span><b>' + money(C.fineOwed(f)) + '</b></div>').join('') : ''),
      '<button class="btn primary sm" data-act="claimForm" data-id="' + m.id + '">I have paid</button>');
  }).join('') + card('My payment claims', table(['Date', 'Code', 'Amount', 'Status'], mine.map(c => '<tr><td>' + dfmt(c.date) + '</td><td class="mono">' + esc(c.ref) + '</td><td class="num">' + money(c.amountMinor, c.ccy) + '</td><td>' + chip(c.status) + (c.reason ? ' <small class="muted">' + esc(c.reason) + '</small>' : '') + '</td></tr>')));
}
A.acts.claimForm = el => {
  const u = me(), accts = C.ownMembers(u);
  modal('I have paid', '<form data-form="claim" class="stack"><p class="small muted">Tell the treasurer what you paid. They will match it to the group statement and confirm. Nothing is added to the books until they confirm.</p>' +
    field('For', select('memberId', accts.map(m => ({ v: m.id, l: m.name + ' (' + gname(m.groupId) + ')' })), el && el.dataset.id)) +
    '<div class="cols">' + field('Amount', '<input name="amount" type="number" min="1" step="0.01" required>') + field('Currency', select('ccy', [{ v: 'KES', l: 'KSh' }, { v: 'USD', l: 'USD' }], 'KES')) + '</div>' +
    '<div class="cols">' + field('How did you pay?', select('method', C.METHODS.map(x => ({ v: x, l: x })), 'M-Pesa')) + field('Date', '<input name="date" type="date" max="' + A.today() + '" value="' + A.today() + '">') + '</div>' +
    field('M-Pesa / transaction code', '<input name="ref" required minlength="4" placeholder="e.g. QAB1C2D3E4" style="text-transform:uppercase">') + field('Note (optional)', '<input name="note">') +
    '<div class="row end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary" type="submit">Send to treasurer</button></div></form>');
};
A.forms.claim = (f, d) => { C.submitClaim(me(), d); closeModal(); toast('Sent. The treasurer will confirm it.'); A.refresh(); };

function staffContrib() {
  const u = me(), gs = A.visibleGroups(); if (!canMoney()) return card('Contributions', '<p class="muted">Money records are kept by each group\'s Treasurer and reviewed by the auditors. Your role manages members, meetings and loan approvals.</p>');
  const gid = gs.find(g => g.id === A.f.cg) ? A.f.cg : gs[0].id, g = C.groupById(gid), p = A.f.cp || cur(), mo = C.groupMonthly(gid, p), T = mo.totals;
  const canRec = C.can(u, 'payments.record');
  const rows = mo.rows.map(r => '<tr' + (r.status === 'late' ? ' class="hl"' : '') + '><td><b>' + esc(r.member.name) + '</b></td><td class="num">' + money(r.due) + '</td><td class="num">' + money(r.got) + '</td><td class="num">' + (r.short ? money(r.short) : '—') + '</td><td>' + chip(r.status) + '</td>' +
    (canRec ? '<td><button class="btn sm" data-act="payForm" data-id="' + r.member.id + '">Record</button></td>' : '') + '</tr>');
  const fines = C.state.fines.filter(f => f.groupId === gid && C.fineOwed(f) > 0);
  const claims = C.state.claims.filter(c => c.groupId === gid && c.status === 'pending');
  const ent = C.state.ledger.filter(e => e.groupId === gid).sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at)).slice(0, 12);
  return '<div class="row"><div style="min-width:160px">' + select('cg', A.optGroups(gs), gid, 'data-live="ctl" aria-label="Group"') + '</div><div style="min-width:140px">' + select('cp', A.optPeriods(), p, 'data-live="ctl2" aria-label="Month"') + '</div>' +
    (canRec ? '<button class="btn primary" data-act="payForm">+ Record payment</button><button class="btn" data-act="reconForm" data-id="' + gid + '">Check cash</button>' : '') + '</div>' +
    (() => { const r = C.state.recons.filter(x => x.groupId === gid).slice(-1)[0]; return r ? '<p class="small muted">Last cash check: ' + dfmt(r.date) + ' · system ' + money(r.system) + ' · actual ' + money(r.actual) + ' · ' + (r.diff === 0 ? '<b>matches</b>' : '<b style="color:var(--bad)">difference ' + money(r.diff) + '</b>') + '</p>' : '<p class="small muted">No cash check recorded yet.</p>'; })() +
    '<div class="grid g4">' + kpi('Due', money(T.due)) + kpi('Collected', money(T.collected), T.paidCount + ' fully paid', 'ok') + kpi('Short', money(T.short), '', T.short ? 'warn' : '') + kpi('Late members', T.lateCount, '', T.lateCount ? 'bad' : 'ok') + '</div>' +
    (C.isLocked(gid, p) ? '<div class="notice ok">' + pfmt(p) + ' is signed off by the auditors and locked. Corrections need a new entry next month.</div>' : '') +
    card(esc(g.name) + ' · ' + pfmt(p), table(['Member', 'Due', 'Paid', 'Short', 'Status'].concat(canRec ? [''] : []), rows)) +
    (claims.length && C.can(u, 'claims.review') ? card('Payments claimed by members', table(['Member', 'Code', 'Amount', 'Method', ''], claims.map(c => '<tr><td>' + esc(mname(c.memberId)) + (c.by !== mname(c.memberId) ? '<br><small class="muted">by ' + esc(c.by) + '</small>' : '') + '</td><td class="mono">' + esc(c.ref) + '</td><td class="num">' + money(c.amountMinor, c.ccy) + '</td><td>' + esc(c.method) + '</td><td class="nowrap"><button class="btn sm primary" data-act="claimOk" data-id="' + c.id + '">Confirm</button> <button class="btn sm" data-act="claimNo" data-id="' + c.id + '">Reject</button></td></tr>'))) : '') +
    card('Open fines', table(['Member', 'Fine', 'Owed', ''], fines.map(f => '<tr><td>' + esc(mname(f.memberId)) + '</td><td>' + esc(f.note) + '</td><td class="num">' + money(C.fineOwed(f)) + '</td><td>' + (C.can(u, 'fines.waive') ? '<button class="btn sm" data-act="waiveForm" data-id="' + f.id + '">Waive</button>' : '') + '</td></tr>')),
      C.can(u, 'payments.record') ? '' : '') +
    card('Recent entries', table(['Date', 'Member', 'Type', 'Amount', 'Via', ''], ent.map(e => '<tr><td>' + dfmt(e.date) + '</td><td>' + esc(mname(e.memberId)) + '</td><td>' + esc(C.KIND_LABEL[e.kind]) + (e.reversalOf ? ' <span class="chip muted">reversal</span>' : '') + (e.reversed ? ' <span class="chip muted">reversed</span>' : '') + '</td><td class="num">' + (e.orig ? 'USD ' + (e.orig / 100) + ' → ' : '') + money(e.amountMinor) + '</td><td>' + esc(e.method) + (e.ref ? '<br><small class="mono muted">' + esc(e.ref) + '</small>' : '') + '</td><td>' +
      (C.can(u, 'payments.reverse') && !e.reversed && !e.reversalOf && !C.OUTFLOW.includes(e.kind) ? '<button class="btn sm" data-act="reverseForm" data-id="' + e.id + '">Reverse</button>' : '') + '</td></tr>')));
}
A.inputs.ctl = el => { A.f.cg = el.value; A.refresh(); };
A.inputs.ctl2 = el => { A.f.cp = el.value; A.refresh(); };
A.acts.payForm = el => {
  const ms = scopeMembers().filter(m => m.status === 'active'); const sel = el && el.dataset && el.dataset.id;
  modal('Record payment', '<form data-form="recordPay" class="stack">' + field('Member', select('memberId', ms.map(m => ({ v: m.id, l: m.name + ' — ' + gname(m.groupId) })), sel, 'data-live="payPreview"')) +
    '<div class="cols">' + field('Amount', '<input name="amount" type="number" min="1" step="0.01" required data-live="payPreview">') + field('Currency', select('ccy', [{ v: 'KES', l: 'KSh' }, { v: 'USD', l: 'USD (converted to KSh)' }], 'KES', 'data-live="payPreview"')) + '</div>' +
    '<div class="cols">' + field('Method', select('method', C.METHODS.map(x => ({ v: x, l: x })), 'M-Pesa', 'data-live="payPreview"')) + field('What is it for?', select('kind', [{ v: 'auto', l: 'Allocate automatically (recommended)' }, { v: 'fine', l: 'Fines only' }, { v: 'loan_repayment', l: 'Loan repayment' }], 'auto', 'data-live="payPreview"')) + '</div>' +
    '<div class="cols">' + field('Transaction code', '<input name="ref" placeholder="M-Pesa code (blank for cash)" style="text-transform:uppercase">') + field('Date', '<input name="date" type="date" max="' + A.today() + '" value="' + A.today() + '" data-live="payPreview">') + '</div>' +
    field('Paid by', '<input name="paidBy" placeholder="Leave blank if the member paid">', 'For a child, put the parent\'s name. The money is recorded under the child.') +
    '<div class="notice" id="payPrev">Enter an amount to preview where it will go.</div>' +
    '<div class="row end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary" type="submit">Save payment</button></div></form>');
  if (sel) { const f = document.querySelector('#modal-root form'); const i = f && f.querySelector('[name=amount]'); if (i) i.focus(); }
};
A.inputs.payPreview = el => {
  const f = el.closest('form'), d = A.formData(f), box = f.querySelector('#payPrev'), m = C.memberById(d.memberId);
  if (!m || !(+d.amount > 0)) { box.className = 'notice'; box.textContent = 'Enter an amount to preview where it will go.'; return; }
  let amt, note = '';
  if (d.ccy === 'USD') { const r = C.state.meta.rates.USD_KES; amt = Math.round(+d.amount * 100 * r); note = 'USD ' + d.amount + ' × ' + r + ' = ' + money(amt) + '. '; if (!C.INTL.includes(d.method)) { box.className = 'notice bad'; box.textContent = 'USD can only be received by Card, Bank transfer or International. M-Pesa and cash are KSh only.'; return; } } else amt = C.toCents(d.amount);
  box.className = 'notice';
  if (d.kind === 'auto') { const parts = C.autoAllocate(m, amt, d.date || A.today()); box.innerHTML = note + '<b>' + esc(m.name) + '</b>: ' + parts.map(p => esc(C.KIND_LABEL[p.kind]) + ' ' + pfmt(p.period) + ' ' + money(p.amountMinor)).join(' · '); }
  else box.textContent = note + (d.kind === 'fine' ? 'Applied to open fines: ' + money(C.sum(C.openFines(m.id), C.fineOwed)) + ' owed.' : 'Applied to the active loan (' + money(C.sum(C.activeLoans(m.id), C.loanOutstanding)) + ' outstanding).');
};
A.forms.recordPay = (f, d) => {
  const loan = d.kind === 'loan_repayment' ? C.activeLoans(d.memberId)[0] : null; if (d.kind === 'loan_repayment' && !loan) throw new Error('This member has no active loan.');
  const res = C.record(me(), { memberId: d.memberId, kind: d.kind, amount: d.amount, ccy: d.ccy, method: d.method, ref: d.ref ? d.ref.trim().toUpperCase() : '', date: d.date || undefined, paidBy: d.paidBy || undefined, loanId: loan && loan.id });
  closeModal(); toast('Recorded ' + money(res.amountMinor) + ' for ' + mname(d.memberId)); A.refresh();
};
A.acts.reconForm = el => {
  const gid = el.dataset.id;
  modal('Check cash · ' + gname(gid), '<form data-form="recon" class="stack"><input type="hidden" name="gid" value="' + gid + '"><div class="notice">The system says the group should hold <b>' + money(C.cashOnHand(gid)) + '</b>. Enter what the group M-Pesa / bank account and cash box really hold today. A difference is flagged to the auditors.</div>' +
    field('Actual balance (KSh)', '<input name="actual" type="number" step="0.01" min="0" required>') + '<div class="row end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Save check</button></div></form>');
};
A.forms.recon = (f, d) => { const r = C.reconcile(me(), d.gid, C.toCents(d.actual), A.today()); closeModal(); toast(r.diff === 0 ? 'Cash matches the books.' : 'Difference of ' + money(r.diff) + ' recorded. The auditors will see it.', r.diff === 0 ? 'ok' : 'bad'); A.refresh(); };
A.acts.waiveForm = el => modal('Waive fine', '<form data-form="waive" class="stack"><input type="hidden" name="id" value="' + el.dataset.id + '"><p>This is recorded in the audit log and shown to the auditors.</p>' + field('Reason', '<input name="reason" required minlength="5">') + '<div class="row end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Waive fine</button></div></form>');
A.forms.waive = (f, d) => { C.waiveFine(me(), d.id, d.reason); closeModal(); toast('Fine waived.'); A.refresh(); };
A.acts.reverseForm = el => modal('Reverse entry', '<form data-form="reverse" class="stack"><input type="hidden" name="id" value="' + el.dataset.id + '"><p>Entries are never deleted. A reversal adds an opposite entry so the history stays visible.</p>' + field('Reason', '<input name="reason" required minlength="5" placeholder="e.g. Recorded under the wrong member">') + '<div class="row end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn danger">Reverse</button></div></form>');
A.forms.reverse = (f, d) => { C.reverse(me(), d.id, d.reason); closeModal(); toast('Reversed.'); A.refresh(); };
A.acts.claimOk = el => { const r = C.confirmClaim(me(), el.dataset.id); toast('Confirmed ' + money(r.amountMinor)); A.refresh(); };
A.acts.claimNo = el => modal('Reject claim', '<form data-form="claimNo" class="stack"><input type="hidden" name="id" value="' + el.dataset.id + '">' + field('Reason', '<input name="reason" required minlength="3" placeholder="e.g. Code not found on the statement">') + '<div class="row end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn danger">Reject</button></div></form>');
A.forms.claimNo = (f, d) => { C.rejectClaim(me(), d.id, d.reason); closeModal(); toast('Rejected. The member has been told.'); A.refresh(); };

/* ========================================================= MERRY-GO-ROUND */
R('mgr', 'Merry-go-round', ALL, () => {
  const u = me(), gs = A.visibleGroups().filter(g => g.types.includes('mgr')), p = cur();
  return '<div class="notice">Each month the whole merry-go-round pot goes to one member. The order is drawn by lots at the start of a round. A round ends when everyone has received once.</div>' + gs.map(g => {
    const nx = C.mgrNext(g.id), pot = C.mgrPot(g.id, p), paidOut = g.mgr.received.some(r => r.period === p && !r.carried);
    const order = g.mgr.order.map((id, i) => { const got = C.mgrReceived(g, id), rr = g.mgr.received.find(x => x.round === g.mgr.round && x.memberId === id);
      return '<tr' + (id === nx ? ' class="hl"' : '') + '><td class="num">' + (i + 1) + '</td><td>' + esc(mname(id)) + '</td><td>' + (got ? '<span class="chip ok">Received' + (rr && rr.period !== 'carried' ? ' · ' + pfmt(rr.period) : '') + '</span>' : id === nx ? '<span class="chip warn">Next</span>' : '<span class="chip muted">Waiting</span>') + '</td><td class="num">' + (rr && rr.amountMinor ? money(rr.amountMinor) : '') + '</td></tr>'; });
    const acts = (C.can(u, 'mgr.draw') && !g.mgr.received.some(r => r.round === g.mgr.round) ? '<button class="btn sm" data-act="mgrDraw" data-id="' + g.id + '" data-confirm="Draw a new random order for ' + esc(g.name) + '?">Draw order</button>' : '') +
      (C.can(u, 'mgr.payout') && C.scopeGroupIds(u).includes(g.id) && nx && !paidOut ? '<button class="btn sm primary" data-act="mgrPay" data-id="' + g.id + '">Pay out ' + pfmt(p) + '</button>' : '') +
      ((C.can(u, 'mgr.payout') || C.can(u, 'mgr.draw')) && nx ? '<button class="btn sm" data-act="mgrSkip" data-id="' + g.id + '">Skip next</button>' : '');
    return card(esc(g.name) + ' <span class="chip info">Round ' + g.mgr.round + '</span>',
      '<div class="grid g3">' + (canMoney() ? kpi(pfmt(p) + ' pot', money(pot), paidOut ? 'Already paid out' : 'Collected so far') : '') + kpi('Next recipient', nx ? esc(mname(nx)) : '—') + kpi('Members in round', g.mgr.order.length) + '</div>' +
      table(['#', 'Member', 'Status', 'Received'], order), acts);
  }).join('');
});
A.acts.mgrDraw = el => { C.mgrDraw(me(), el.dataset.id); toast('New order drawn.'); A.refresh(); };
A.acts.mgrSkip = el => { C.mgrSkip(me(), el.dataset.id, 'Skipped by ' + me().name); toast('Moved to the end of the order.'); A.refresh(); };
A.acts.mgrPay = el => {
  const gid = el.dataset.id, p = cur();
  try { const r = C.mgrPayout(me(), gid, p, {}); toast(money(r.pot) + ' paid to ' + mname(r.to)); }
  catch (e) { if (e.code === 'ARREARS' && window.confirm(e.message + '\n\nPay anyway?')) { const r = C.mgrPayout(me(), gid, p, { force: true }); toast(money(r.pot) + ' paid to ' + mname(r.to)); } else throw e; }
  A.refresh();
};

/* ================================================================ LOANS */
R('loans', 'Loans', ALL, () => isOwner(me()) ? ownerLoans() : staffLoans());
const loanRow = (l, extra) => '<tr><td><b>' + esc(mname(l.memberId)) + '</b><br><small class="muted">' + esc(gname(l.groupId)) + '</small></td><td class="num">' + money(l.principal) + '</td><td class="num">' + l.months + ' mo @ ' + l.ratePct + '%</td><td>' + chip(l.status) + '</td><td>' + extra + '</td></tr>';
function ownerLoans() {
  const u = me(), accts = C.ownMembers(u).filter(m => C.groupById(m.groupId).types.includes('tb'));
  const mine = C.state.loans.filter(l => C.ownMembers(u).some(m => m.id === l.memberId)), ask = C.state.loans.filter(l => l.status === 'requested' && u.memberId && l.guarantors.includes(u.memberId) && !l.confirmed.includes(u.memberId));
  return (ask.length ? card('Please confirm: you were named as guarantor', table(['Borrower', 'Amount', 'Terms', 'Purpose', ''], ask.map(l => '<tr><td>' + esc(mname(l.memberId)) + '</td><td class="num">' + money(l.principal) + '</td><td>' + l.months + ' months</td><td>' + esc(l.purpose) + '</td><td class="nowrap"><button class="btn sm primary" data-act="guarantor" data-id="' + l.id + '" data-yes="1">I agree</button> <button class="btn sm" data-act="guarantor" data-id="' + l.id + '">Decline</button></td></tr>')), '', 'warn') : '') +
    card('My loans', table(['Borrower', 'Amount', 'Terms', 'Status', ''], mine.map(l => loanRow(l, '<button class="btn sm" data-act="loanView" data-id="' + l.id + '">Details</button>'))),
      accts.length ? '<button class="btn primary sm" data-act="loanForm">+ Request a loan</button>' : '') +
    (!accts.length ? '<div class="notice">Loans are available in groups that do table banking (Youth, Men and Women). Sunday School has merry-go-round only.</div>' : '');
}
function staffLoans() {
  const u = me(), sc = C.scopeGroupIds(u), all = C.state.loans.filter(l => sc.includes(l.groupId)), by = s => all.filter(l => l.status === s);
  const ap = l => (C.can(u, 'loans.approve') ? (l.confirmed.length < l.guarantors.length ? '<small class="muted">Waiting for guarantors (' + l.confirmed.length + '/' + l.guarantors.length + ')</small>' : (C.loanNeedsBishop(l) && u.role !== 'bishop' ? '<small class="muted">Needs the Bishop</small>' : '<button class="btn sm primary" data-act="loanApprove" data-id="' + l.id + '">Approve</button> <button class="btn sm" data-act="loanReject" data-id="' + l.id + '">Reject</button>')) : '<small class="muted">' + l.confirmed.length + '/' + l.guarantors.length + ' guarantors</small>') + ' <button class="btn sm" data-act="loanView" data-id="' + l.id + '">Details</button>';
  return '<div class="grid g4">' + kpi('Waiting approval', by('requested').length) + kpi('Approved', by('approved').length) + kpi('Active', by('active').length) + kpi('Outstanding', canMoney() ? money(C.sum(by('active'), C.loanOutstanding)) : '—') + '</div>' +
    card('Waiting for approval', table(['Borrower', 'Amount', 'Terms', 'Status', ''], by('requested').map(l => loanRow(l, ap(l))))) +
    card('Approved — waiting to be paid out', table(['Borrower', 'Amount', 'Terms', 'Status', ''], by('approved').map(l => loanRow(l, (C.can(u, 'loans.disburse') && sc.includes(l.groupId) ? '<button class="btn sm primary" data-act="loanDisburse" data-id="' + l.id + '">Disburse</button> ' : '') + '<button class="btn sm" data-act="loanView" data-id="' + l.id + '">Details</button>')))) +
    card('Active loans', table(['Borrower', 'Amount', 'Terms', 'Balance', ''], by('active').map(l => '<tr><td><b>' + esc(mname(l.memberId)) + '</b></td><td class="num">' + money(l.principal) + '</td><td>' + l.months + ' mo @ ' + l.ratePct + '%</td><td class="num">' + (canMoney() ? money(C.loanOutstanding(l)) : '—') + '</td><td><button class="btn sm" data-act="loanView" data-id="' + l.id + '">Schedule</button></td></tr>'))) +
    card('Closed', table(['Borrower', 'Amount', 'Terms', 'Status', ''], by('cleared').concat(by('rejected')).map(l => loanRow(l, '<button class="btn sm" data-act="loanView" data-id="' + l.id + '">Details</button>'))));
}
A.acts.loanView = el => {
  const l = C.loanById(el.dataset.id), u = me(); if (!isOwner(u) || C.ownMembers(u).some(m => m.id === l.memberId)) { /* allowed */ } else throw new Error('Not your loan.');
  const rows = (l.schedule || []).map(r => { const left = r.principal + r.interest - r.pp - r.pi; return '<tr><td>' + r.n + '</td><td>' + dfmt(r.due) + '</td><td class="num">' + money(r.principal) + '</td><td class="num">' + money(r.interest) + '</td><td class="num">' + money(r.pp + r.pi) + '</td><td>' + (left === 0 ? chip('paid') : A.today() > r.due ? chip('late') : chip('upcoming')) + '</td></tr>'; });
  modal('Loan · ' + mname(l.memberId), '<div class="stack"><div class="row">' + chip(l.status) + '<span class="muted small">' + money(l.principal) + ' · ' + l.months + ' months · ' + l.ratePct + '% per month on the balance</span></div>' +
    (l.purpose ? '<p>Purpose: ' + esc(l.purpose) + '</p>' : '') + '<p class="small">Guarantors: ' + l.guarantors.map(id => esc(mname(id)) + (l.confirmed.includes(id) ? ' ✓' : ' …')).join(', ') + '</p>' + (l.reason ? '<div class="notice bad">' + esc(l.reason) + '</div>' : '') +
    (rows.length ? table(['#', 'Due', 'Principal', 'Interest', 'Paid', ''], rows) + '<p class="small muted">Outstanding: <b>' + money(C.loanOutstanding(l)) + '</b></p>' : '') + '</div>', { wide: true });
};
A.acts.guarantor = el => { C.guarantorConfirm(me(), el.dataset.id, me().memberId, !!el.dataset.yes); toast(el.dataset.yes ? 'Thank you. You are now a guarantor.' : 'You declined. The request was cancelled.'); A.refresh(); };
A.acts.loanApprove = el => { C.approveLoan(me(), el.dataset.id); toast('Approved.'); A.refresh(); };
A.acts.loanDisburse = el => { C.disburseLoan(me(), el.dataset.id, {}); toast('Disbursed. The repayment schedule is ready.'); A.refresh(); };
A.acts.loanReject = el => modal('Reject loan', '<form data-form="loanReject" class="stack"><input type="hidden" name="id" value="' + el.dataset.id + '">' + field('Reason', '<input name="reason" required minlength="3">') + '<div class="row end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn danger">Reject</button></div></form>');
A.forms.loanReject = (f, d) => { C.rejectLoan(me(), d.id, d.reason); closeModal(); toast('Rejected. The member has been told.'); A.refresh(); };
A.acts.loanForm = () => {
  const m = C.ownMembers(me()).find(x => C.groupById(x.groupId).types.includes('tb')); if (!m) throw new Error('No table-banking account.');
  const peers = C.state.members.filter(x => x.groupId === m.groupId && x.id !== m.id && x.status === 'active'), L = C.groupById(m.groupId).loan;
  modal('Request a loan', '<form data-form="loanReq" class="stack"><input type="hidden" name="memberId" value="' + m.id + '"><div class="notice">Your limit now: <b>' + money(C.loanLimit(m.id)) + '</b> (' + L.multiple + '× savings, minus loans). Interest ' + L.ratePct + '% per month on the balance, up to ' + L.maxMonths + ' months.</div>' +
    '<div class="cols">' + field('Amount (KSh)', '<input name="amount" type="number" min="1" required data-live="loanPrev">') + field('Months', '<input name="months" type="number" min="1" max="' + L.maxMonths + '" value="3" required data-live="loanPrev">') + '</div>' + field('Purpose', '<input name="purpose" placeholder="e.g. School fees">') +
    '<div class="cols">' + field('Guarantor 1', select('g1', [{ v: '', l: 'Choose…' }].concat(peers.map(x => ({ v: x.id, l: x.name }))), '', 'data-live="loanPrev"')) + field('Guarantor 2', select('g2', [{ v: '', l: 'Choose…' }].concat(peers.map(x => ({ v: x.id, l: x.name }))), '', 'data-live="loanPrev"')) + '</div>' +
    '<div id="loanPrev" class="msg small">Fill in the amount to see the checks and repayment plan.</div><div class="row end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Send request</button></div></form>', { wide: true });
};
A.inputs.loanPrev = el => {
  const f = el.closest('form'), d = A.formData(f), box = f.querySelector('#loanPrev'); const amt = C.toCents(d.amount || 0), months = +d.months || 0;
  const checks = C.loanChecks(d.memberId, amt || null, months || null, [d.g1, d.g2].filter(Boolean).length === 2 ? [d.g1, d.g2] : []);
  const g = C.groupById(C.memberById(d.memberId).groupId); let sched = '';
  if (amt > 0 && months > 0) { const rows = C.buildSchedule(amt, months, g.loan.ratePct, C.addMonths(C.monthOf(A.today()), 1), g.dueDay); sched = '<p class="small">Estimated repayment: <b>' + money(C.sum(rows, r => r.principal + r.interest)) + '</b> (interest ' + money(C.sum(rows, r => r.interest)) + '). First instalment ' + money(rows[0].principal + rows[0].interest) + '.</p>'; }
  box.innerHTML = checks.map(c => '<div class="check-row"><span class="ico ' + (c.ok ? 'ok' : 'bad') + '">' + (c.ok ? '✓' : '✗') + '</span><span>' + esc(c.label) + '</span></div>').join('') + sched;
};
A.forms.loanReq = (f, d) => { C.requestLoan(me(), { memberId: d.memberId, amount: d.amount, months: d.months, purpose: d.purpose, guarantors: [d.g1, d.g2] }); closeModal(); toast('Request sent. Your guarantors have been messaged.'); A.refresh(); };
})();
