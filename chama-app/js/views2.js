/* views2.js — Import, Meetings, Reports, Books review, Messages, Audit, Users, Settings, Statement, Help */
(function () {
'use strict';
const C = window.Chama, A = window.App;
const { esc, dfmt, pfmt, chip, field, select, kpi, table, bar, card, empty, money, gname, mname, toast, modal, closeModal, download } = A;
const STAFF = ['superadmin', 'bishop', 'secretary', 'treasurer', 'auditor'], ALL = STAFF.concat(['member', 'parent']);
const R = (n, t, roles, render, after) => { A.routes[n] = { title: t, roles, render, after }; };
const me = () => A.user, isOwner = u => u.role === 'member' || u.role === 'parent';
const cur = () => A.curPeriod();
const scopeMembers = () => { const ids = C.scopeGroupIds(me()); return C.state.members.filter(m => ids.includes(m.groupId)); };
const canMoney = () => C.can(me(), 'money.view');

/* ================================================== IMPORT (document → data → task) */
R('import', 'Import statement', ['treasurer'], () => {
  const I = A.f.imp, gs = A.visibleGroups();
  const up = card('1 · Add a document', '<label class="drop" id="drop"><input type="file" id="impFile" data-live="impFile" accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,.doc,.docx" hidden><b>Tap to choose a file</b> or drop it here<br><span class="small muted">M-Pesa statement or group sheet · CSV, TSV or text read directly</span></label>' +
    '<div class="notice warn" style="margin-top:10px">This version reads <b>CSV / TSV / pasted text</b>. For Excel, use <i>Save as → CSV</i>. For a PDF or Word statement, copy the table and paste it below. Direct .xlsx / .pdf / .docx reading is on the roadmap (see the documentation).</div>' +
    '<details style="margin-top:10px"><summary>Or paste the statement text</summary><textarea id="impPaste" placeholder="Receipt No.,Completion Time,Details,Paid In…"></textarea><button class="btn sm" data-act="impPaste" style="margin-top:6px">Read pasted text</button></details>');
  if (!I) return up + card('How it works', '<ol><li>Add the statement.</li><li>The system finds the payments and matches them to members by phone number and name.</li><li>You check the matches, then choose what to do with the data.</li></ol><p class="small muted">Nothing is saved until you press <b>Record payments</b>.</p>');
  const dup = r => r.ref && C.state.ledger.some(e => e.ref === r.ref && !e.reversalOf);
  const ms = scopeMembers().filter(m => m.status === 'active'), mopts = [{ v: '', l: '— not matched —' }].concat(ms.map(m => ({ v: m.id, l: m.name + ' (' + gname(m.groupId) + ')' })));
  const rows = I.rows.map((r, i) => '<tr' + (!r.memberId || dup(r) ? ' class="hl"' : '') + '><td><input type="checkbox" data-live="impInc" data-i="' + i + '"' + (r.include ? ' checked' : '') + (!r.memberId || dup(r) ? ' disabled' : '') + ' aria-label="Include"></td><td>' + dfmt(r.date) + '</td><td class="mono">' + esc(r.ref) + (dup(r) ? ' <span class="chip bad">duplicate</span>' : '') + '</td><td class="num">' + money(r.amountMinor) + '</td><td class="small">' + esc(r.details.slice(0, 60)) + '</td><td>' + select('m' + i, mopts, r.memberId || '', 'data-live="impMatch" data-i="' + i + '" aria-label="Member"') + '</td></tr>');
  const ok = I.rows.filter(r => r.include && r.memberId && !dup(r)), un = I.rows.filter(r => !r.memberId).length, dp = I.rows.filter(dup).length;
  return up + card('2 · Check what we found', '<div class="row"><span class="chip ok">' + I.rows.length + ' payments found</span><span class="chip ' + (un ? 'warn' : 'ok') + '">' + un + ' not matched</span><span class="chip ' + (dp ? 'bad' : 'muted') + '">' + dp + ' duplicates</span><span class="chip info">' + money(C.sum(ok, r => r.amountMinor)) + ' ready</span></div>' +
    table(['', 'Date', 'Code', 'Amount', 'Details', 'Member'], rows), '<button class="btn sm" data-act="impClear">Clear</button>') +
    card('3 · What do you want to do with this data?', '<form data-form="impTask" class="stack">' +
      field('Choose a task', select('task', [{ v: 'record', l: 'Record the payments into the books' }, { v: 'totals', l: 'Total per member' }, { v: 'notpaid', l: 'Who has not paid (not in this file)?' }, { v: 'summary', l: 'Summary of the file' }, { v: 'custom', l: 'Something else (type it below)' }], A.f.impTask || 'record')) +
      field('Or describe the task', '<textarea name="custom" placeholder="e.g. Who is late this month? How much is the Men group short?"></textarea>', 'Used when “Something else” is selected. It is answered from fixed calculations; if it cannot be done, it says so instead of guessing.') +
      '<div class="row end"><button class="btn primary" type="submit">Run</button></div></form><div id="impOut" style="margin-top:12px">' + (A.f.impOut || '') + '</div>');
});
function impParse(text) {
  const ids = C.scopeGroupIds(me()), rows = C.parseStatement(text); if (!rows.length) throw new Error('No payments found. Check that the file has dates and a “Paid In” or “Amount” column.');
  A.f.imp = { rows: rows.map(r => { const mt = C.matchRow(r, ids); return Object.assign({}, r, { memberId: mt.memberId, by: mt.by, include: !!mt.memberId }); }) }; A.f.impOut = '';
  toast(rows.length + ' payment(s) found.'); A.refresh();
}
A.inputs.impFile = el => {
  const f = el.files && el.files[0]; if (!f) return;
  if (/\.(xlsx|xls|pdf|docx?)$/i.test(f.name)) { toast('This version cannot read ' + f.name.split('.').pop().toUpperCase() + ' directly. Save it as CSV or paste the text.', 'bad'); return; }
  const rd = new FileReader(); rd.onload = () => { try { impParse(String(rd.result)); } catch (e) { toast(e.message, 'bad'); } }; rd.readAsText(f);
};
A.acts.impPaste = () => { const t = document.getElementById('impPaste').value; impParse(t); };
A.acts.impClear = () => { A.f.imp = null; A.f.impOut = ''; A.refresh(); };
A.inputs.impInc = el => { A.f.imp.rows[+el.dataset.i].include = el.checked; A.refresh(); };
A.inputs.impMatch = el => { const r = A.f.imp.rows[+el.dataset.i]; r.memberId = el.value || null; r.include = !!el.value; A.refresh(); };
A.forms.impTask = (f, d) => {
  const I = A.f.imp; if (!I) throw new Error('Add a document first.'); A.f.impTask = d.task; const T = A.today();
  const dup = r => r.ref && C.state.ledger.some(e => e.ref === r.ref && !e.reversalOf), use = I.rows.filter(r => r.include && r.memberId && !dup(r));
  let out = '';
  if (d.task === 'record') {
    if (!use.length) throw new Error('Nothing to record. Match at least one payment.');
    let n = 0, tot = 0; const bad = [];
    for (const r of use) { try { const res = C.record(me(), { memberId: r.memberId, kind: 'auto', amountMinor: r.amountMinor, method: 'M-Pesa', ref: r.ref, date: r.date > T ? T : r.date, paidBy: r.name || undefined }); n++; tot += res.amountMinor; r.include = false; r.memberId = r.memberId; r.done = true; } catch (e) { bad.push(r.ref + ': ' + e.message); } }
    out = '<div class="notice ok">Recorded ' + n + ' payment(s), ' + money(tot) + '.</div>' + (bad.length ? '<div class="notice bad">' + bad.map(esc).join('<br>') + '</div>' : '');
    I.rows = I.rows.filter(r => !r.done); toast('Recorded ' + n + ' payment(s).');
  } else if (d.task === 'totals') {
    const t = {}; use.forEach(r => { t[r.memberId] = (t[r.memberId] || 0) + r.amountMinor; });
    out = table(['Member', 'Payments', 'Total'], Object.keys(t).map(id => '<tr><td>' + esc(mname(id)) + '</td><td class="num">' + use.filter(r => r.memberId === id).length + '</td><td class="num">' + money(t[id]) + '</td></tr>')) + '<p class="small muted">Total: <b>' + money(C.sum(use, r => r.amountMinor)) + '</b></p>';
  } else if (d.task === 'notpaid') {
    const paidIds = new Set(I.rows.filter(r => r.memberId).map(r => r.memberId));
    out = table(['Member', 'Group', 'Owes this month'], scopeMembers().filter(m => m.status === 'active' && !paidIds.has(m.id) && C.periodStatus(m, cur()).short > 0).map(m => '<tr><td>' + esc(m.name) + '</td><td>' + esc(gname(m.groupId)) + '</td><td class="num">' + money(C.periodStatus(m, cur()).short) + '</td></tr>'));
  } else if (d.task === 'summary') {
    const ds = I.rows.map(r => r.date).sort();
    out = '<div class="sum"><span>Payments found</span><b>' + I.rows.length + '</b></div><div class="sum"><span>Total in file</span><b>' + money(C.sum(I.rows, r => r.amountMinor)) + '</b></div><div class="sum"><span>Matched to members</span><b>' + I.rows.filter(r => r.memberId).length + '</b></div><div class="sum"><span>Not matched</span><b>' + I.rows.filter(r => !r.memberId).length + '</b></div><div class="sum"><span>Duplicates already recorded</span><b>' + I.rows.filter(dup).length + '</b></div><div class="sum"><span>Dates</span><b>' + dfmt(ds[0]) + ' → ' + dfmt(ds[ds.length - 1]) + '</b></div>';
  } else {
    if (!d.custom || d.custom.trim().length < 3) throw new Error('Describe the task.'); const a = window.Bot.ask(me(), d.custom);
    out = '<div class="msg">' + esc(a.text).replace(/\n/g, '<br>') + '</div>' + (a.rows ? table(a.rows.heads, a.rows.body.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>')) : '');
  }
  A.f.impOut = out; A.refresh();
};

/* ======================================================================= MEETINGS */
R('meetings', 'Meetings', ALL, () => {
  const u = me(), t = A.today(), sc = C.scopeGroupIds(u), mine = m => m.groupId === 'all' || sc.includes(m.groupId);
  const list = C.state.meetings.filter(mine).sort((a, b) => b.date.localeCompare(a.date)), up = list.filter(m => m.date >= t).reverse(), past = list.filter(m => m.date < t);
  const row = m => '<tr><td>' + dfmt(m.date) + '</td><td>' + (m.groupId === 'all' ? 'All groups' : esc(gname(m.groupId))) + '</td><td>' + chip(m.mode === 'online' ? 'info' : 'ok').replace(/>.*?</, '>' + (m.mode === 'online' ? 'Online' : 'Physical') + '<') + '</td><td>' + esc(m.where || 'To be communicated') + '</td><td>' +
    (C.can(u, 'meetings.manage') ? '<button class="btn sm" data-act="attForm" data-id="' + m.id + '">' + (m.attendance ? 'Attendance' : 'Record') + '</button>' : (m.minutes ? '<button class="btn sm" data-act="minutes" data-id="' + m.id + '">Minutes</button>' : '')) + '</td></tr>';
  return '<div class="notice">The chama meets every Saturday, online or physical. The secretary announces which one.</div>' +
    card('Upcoming', table(['Date', 'For', 'Mode', 'Where / link', ''], up.map(row)), C.can(u, 'meetings.manage') ? '<button class="btn primary sm" data-act="meetForm">+ Schedule meeting</button>' : '') + card('Past meetings', table(['Date', 'For', 'Mode', 'Where / link', ''], past.map(row)));
});
A.acts.meetForm = () => {
  const gs = A.visibleGroups();
  modal('Schedule a meeting', '<form data-form="meet" class="stack">' + field('Date', '<input type="date" name="date" value="' + C.nextSaturday(A.today()) + '" required>', 'Meetings are on Saturdays.') + field('For', select('groupId', A.optGroups(gs, true), 'all')) +
    field('Mode', select('mode', [{ v: 'online', l: 'Online' }, { v: 'physical', l: 'Physical' }], 'online')) + field('Link or venue', '<input name="where" placeholder="Meeting link or church hall">') +
    '<div class="notice">Members get an SMS and an in-app message.</div><div class="row end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Schedule</button></div></form>');
};
A.forms.meet = (f, d) => { C.scheduleMeeting(me(), d); closeModal(); toast('Meeting scheduled and members messaged.'); A.refresh(); };
A.acts.attForm = el => {
  const mt = C.state.meetings.find(x => x.id === el.dataset.id), ids = C.scopeGroupIds(me()), ms = C.state.members.filter(m => m.status === 'active' && ids.includes(m.groupId) && (mt.groupId === 'all' || m.groupId === mt.groupId));
  modal('Attendance · ' + dfmt(mt.date), '<form data-form="att" class="stack"><input type="hidden" name="id" value="' + mt.id + '"><div class="notice small">Members marked <b>Absent</b> get the group\'s missed-meeting fine. Use <b>Excused</b> to avoid it.</div>' +
    '<div class="list">' + ms.map(m => '<div class="li"><span>' + esc(m.name) + ' <small class="muted">' + esc(gname(m.groupId)) + '</small></span>' + select('att_' + m.id, [{ v: 'present', l: 'Present' }, { v: 'absent', l: 'Absent' }, { v: 'excused', l: 'Excused' }], (mt.attendance && mt.attendance[m.id]) || 'present', 'style="width:auto"') + '</div>').join('') + '</div>' +
    field('Minutes', '<textarea name="minutes">' + esc(mt.minutes) + '</textarea>') + '<div class="row end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Save</button></div></form>', { wide: true });
};
A.forms.att = (f, d) => { const map = {}; Object.keys(d).forEach(k => { if (k.startsWith('att_')) map[k.slice(4)] = d[k]; }); const n = C.recordAttendance(me(), d.id, map, d.minutes); closeModal(); toast('Saved. ' + n + ' missed-meeting fine(s) added.'); A.refresh(); };
A.acts.minutes = el => { const m = C.state.meetings.find(x => x.id === el.dataset.id); modal('Minutes · ' + dfmt(m.date), '<p>' + esc(m.minutes) + '</p>'); };

/* ======================================================================== REPORTS */
R('reports', 'Reports', ['superadmin', 'bishop', 'treasurer', 'auditor'], () => {
  const gs = A.visibleGroups(), gid = gs.find(g => g.id === A.f.rg) ? A.f.rg : gs[0].id, p = A.f.rp || cur(), tab = A.f.rt || 'monthly', g = C.groupById(gid);
  const tabs = [['monthly', 'Monthly report'], ['ledger', 'Cash book'], ['year', 'Year-end shares']].map(t => '<button class="tab ' + (t[0] === tab ? 'on' : '') + '" data-act="repTab" data-t="' + t[0] + '">' + t[1] + '</button>').join('');
  const ctl = '<div class="row no-print"><div style="min-width:150px">' + select('rg', A.optGroups(gs), gid, 'data-live="repCtl"') + '</div>' + (tab !== 'year' ? '<div style="min-width:140px">' + select('rp', A.optPeriods(), p, 'data-live="repCtl2"') + '</div>' : '') + '<button class="btn" data-act="print">Print / save PDF</button><button class="btn" data-act="repCsv">Download CSV</button></div>';
  let body = '';
  if (tab === 'monthly') {
    const mo = C.groupMonthly(gid, p), T = mo.totals;
    body = '<div class="grid g4">' + kpi('Due', money(T.due)) + kpi('Collected', money(T.collected)) + kpi('Short', money(T.short), '', T.short ? 'warn' : '') + kpi('Cash on hand', money(T.cash)) + '</div>' +
      card('Money in and out · ' + esc(g.name) + ' · ' + pfmt(p), [['Merry-go-round contributions', T.mgrPot], ['Table-banking savings', T.tbSavings], ['Joining fees', T.joining], ['Fines paid', T.fines], ['Loan repayments', T.repayments], ['Unallocated', T.unallocated]].map(x => '<div class="sum"><span>' + x[0] + '</span><b>' + money(x[1]) + '</b></div>').join('') +
        '<div class="sum"><span>Merry-go-round payouts</span><b>− ' + money(T.payouts) + '</b></div><div class="sum"><span>Loans disbursed</span><b>− ' + money(T.disbursed) + '</b></div>') +
      card('Members', table(['Member', 'Due', 'Paid', 'Short', 'Status'], mo.rows.map(r => '<tr><td>' + esc(r.member.name) + '</td><td class="num">' + money(r.due) + '</td><td class="num">' + money(r.got) + '</td><td class="num">' + (r.short ? money(r.short) : '—') + '</td><td>' + chip(r.status) + '</td></tr>')));
  } else if (tab === 'ledger') {
    const ents = C.state.ledger.filter(e => e.groupId === gid && e.period === p).sort((a, b) => (a.date + a.at).localeCompare(b.date + b.at));
    let bal = 0; const rows = ents.map(e => { const sgn = C.INFLOW.includes(e.kind) ? 1 : -1; bal += sgn * e.amountMinor; return '<tr><td>' + dfmt(e.date) + '</td><td>' + esc(mname(e.memberId)) + '</td><td>' + esc(C.KIND_LABEL[e.kind]) + '</td><td class="mono">' + esc(e.ref) + '</td><td class="num">' + (sgn > 0 ? money(e.amountMinor) : '') + '</td><td class="num">' + (sgn < 0 ? money(e.amountMinor) : '') + '</td><td class="num">' + money(bal) + '</td></tr>'; });
    body = card('Cash book · ' + esc(g.name) + ' · ' + pfmt(p), table(['Date', 'Member', 'Type', 'Code', 'In', 'Out', 'Running'], rows), '') + '<p class="small muted">Running total is for this month only. Cash on hand to date: <b>' + money(C.cashOnHand(gid)) + '</b>.</p>';
  } else {
    const fy = C.fyState(A.today()).fy, y = C.yearEndShares(gid, fy);
    body = !y ? '<div class="notice">' + esc(g.name) + ' has no table banking, so there is no interest to share.</div>' :
      '<div class="grid g3">' + kpi('Loan interest paid', money(y.interest)) + kpi('Fines paid', money(y.finesPaid)) + kpi('Pool to share', money(y.pool)) + '</div>' + card('Share per member · FY ' + fy, '<p class="small muted">Shared by each member\'s savings over the year (savings × months held). This is a preview until the year closes on 2 Dec.</p>' +
        table(['Member', 'Saved this year', 'Weight', 'Share'], y.shares.sort((a, b) => b.share - a.share).map(s => '<tr><td>' + esc(mname(s.memberId)) + '</td><td class="num">' + money(s.saved) + '</td><td class="num">' + (y.totalW ? (100 * s.weight / y.totalW).toFixed(1) : 0) + '%</td><td class="num"><b>' + money(s.share) + '</b></td></tr>')));
  }
  return '<div class="tabs no-print">' + tabs + '</div>' + ctl + body;
});
A.acts.repTab = el => { A.f.rt = el.dataset.t; A.refresh(); };
A.inputs.repCtl = el => { A.f.rg = el.value; A.refresh(); }; A.inputs.repCtl2 = el => { A.f.rp = el.value; A.refresh(); };
A.acts.repCsv = () => {
  const gid = A.f.rg || A.visibleGroups()[0].id, p = A.f.rp || cur(), tab = A.f.rt || 'monthly', g = C.groupById(gid); let rows;
  if (tab === 'ledger') rows = [['Date', 'Member', 'Type', 'Code', 'Method', 'Amount KES', 'Original', 'Currency', 'Rate']].concat(C.state.ledger.filter(e => e.groupId === gid && e.period === p).map(e => [e.date, mname(e.memberId), C.KIND_LABEL[e.kind], e.ref, e.method, e.amountMinor / 100, e.orig ? e.orig / 100 : '', e.ccy, e.rate || '']));
  else if (tab === 'year') { const y = C.yearEndShares(gid, C.fyState(A.today()).fy); if (!y) throw new Error('No table banking in this group.'); rows = [['Member', 'Saved', 'Weight', 'Share KES']].concat(y.shares.map(s => [mname(s.memberId), s.saved / 100, s.weight / 100, s.share / 100])); }
  else rows = [['Member', 'Due', 'Paid', 'Short', 'Status']].concat(C.groupMonthly(gid, p).rows.map(r => [r.member.name, r.due / 100, r.got / 100, r.short / 100, r.status]));
  download(g.name.replace(/\s+/g, '-') + '-' + tab + '-' + p + '.csv', C.toCSV(rows), 'text/csv');
};

/* ====================================================================== BOOKS REVIEW */
R('review', 'Books review', ['superadmin', 'bishop', 'auditor'], () => {
  const u = me(), gs = A.visibleGroups(), gid = gs.find(g => g.id === A.f.vg) ? A.f.vg : gs[0].id, ps = C.fyPeriods(C.fyState(A.today()).fy).filter(x => x <= cur()), p = ps.includes(A.f.vp) ? A.f.vp : (ps[ps.length - 2] || ps[0]);
  const so = C.state.signoffs.find(s => s.groupId === gid && s.period === p), checks = C.reviewChecks(gid, p), T = C.groupMonthly(gid, p).totals;
  return '<div class="notice">Auditors and trustees review each group\'s books every month. A signed-off month is <b>locked</b>: nobody can add, change or reverse entries in it. The super admin cannot sign off.</div>' +
    '<div class="row"><div style="min-width:150px">' + select('vg', A.optGroups(gs), gid, 'data-live="revCtl"') + '</div><div style="min-width:140px">' + select('vp', ps.map(x => ({ v: x, l: pfmt(x) })), p, 'data-live="revCtl2"') + '</div></div>' +
    '<div class="grid g4">' + kpi('Collected', money(T.collected)) + kpi('Fines paid', money(T.fines)) + kpi('Payouts + loans out', money(T.payouts + T.disbursed)) + kpi('Cash on hand', money(T.cash)) + '</div>' +
    card('Checks · ' + esc(gname(gid)) + ' · ' + pfmt(p), checks.map(c => '<div class="check-row"><span class="ico ' + (c.ok ? 'ok' : c.warn ? 'warn' : 'bad') + '">' + (c.ok ? '✓' : c.warn ? '!' : '✗') + '</span><div><b>' + esc(c.label) + '</b><br><small class="muted">' + esc(c.detail) + '</small></div></div>').join('')) +
    card('Sign-off', (so ? '<div class="notice ' + (so.status === 'signed' ? 'ok' : 'bad') + '">' + (so.status === 'signed' ? 'Signed off' : 'Sent back') + ' by ' + esc(so.by) + ' on ' + dfmt(so.at) + (so.comment ? '. “' + esc(so.comment) + '”' : '') + '</div>' : '<p class="muted">Not reviewed yet.</p>') +
      (C.can(u, 'review.signoff') && !C.isLocked(gid, p) ? '<form data-form="signoff" class="stack" style="margin-top:10px"><input type="hidden" name="g" value="' + gid + '"><input type="hidden" name="p" value="' + p + '">' + field('Comment', '<input name="comment" placeholder="Required if you send it back">') + '<div class="row"><button class="btn primary" name="s" value="signed" data-act="signBtn" data-s="signed" type="button">Sign off & lock</button><button class="btn danger" type="button" data-act="signBtn" data-s="rejected">Send back to treasurer</button></div></form>' : '')) +
    card('Recent reviews', table(['Group', 'Month', 'Result', 'By', 'Comment'], C.state.signoffs.filter(s => C.scopeGroupIds(u).includes(s.groupId)).slice(-12).reverse().map(s => '<tr><td>' + esc(gname(s.groupId)) + '</td><td>' + pfmt(s.period) + '</td><td>' + chip(s.status) + '</td><td>' + esc(s.by) + '</td><td class="small">' + esc(s.comment) + '</td></tr>')));
});
A.inputs.revCtl = el => { A.f.vg = el.value; A.refresh(); }; A.inputs.revCtl2 = el => { A.f.vp = el.value; A.refresh(); };
A.acts.signBtn = el => { const f = el.closest('form'), d = A.formData(f); C.signoff(me(), d.g, d.p, el.dataset.s, d.comment); toast(el.dataset.s === 'signed' ? 'Signed off and locked.' : 'Sent back to the treasurer.'); A.refresh(); };

/* ======================================================================== MESSAGES */
R('messages', 'Messages', ALL, () => {
  const u = me(), sc = C.scopeGroupIds(u);
  const own = isOwner(u) ? C.ownMembers(u).map(m => m.id) : null;
  const list = C.state.messages.filter(x => own ? own.includes(x.memberId) : sc.includes((C.memberById(x.memberId) || {}).groupId)).slice().reverse().slice(0, 80);
  return '<div class="notice">SMS is <b>simulated</b> in this demo: messages are stored and shown here. Connect an SMS provider (Africa\'s Talking) to send real texts. See the documentation.</div>' +
    (C.can(u, 'messages.send') ? card('Send a message', '<form data-form="msg" class="stack">' + field('To', select('to', A.optGroups(A.visibleGroups(), true), 'all')) + field('Message', '<textarea name="text" required minlength="3" placeholder="Habari. Meeting this Saturday…"></textarea>') +
      '<div class="row between"><button type="button" class="btn" data-act="reminders">Send payment reminders</button><button class="btn primary">Send</button></div></form>') : '') +
    card('Message log', list.length ? '<div class="list">' + list.map(x => '<div class="li" style="align-items:flex-start"><div><b>' + esc(x.toName) + '</b> <small class="muted">· ' + dfmt(x.date) + ' · ' + esc(x.channel) + '</small><br>' + esc(x.text) + '</div></div>').join('') + '</div>' : empty('No messages yet.'));
});
A.forms.msg = (f, d) => { const ids = scopeMembers().filter(m => m.status === 'active' && (d.to === 'all' || m.groupId === d.to)).map(m => m.id); C.postMessage(me(), ids, d.text); toast('Sent to ' + ids.length + ' member(s).'); A.refresh(); };
A.acts.reminders = () => { const n = C.sendReminders(me(), C.scopeGroupIds(me())); toast(n + ' reminder(s) sent.'); A.refresh(); };

/* ========================================================================== AUDIT */
R('audit', 'Audit log', ['superadmin', 'bishop', 'auditor'], () => {
  const q = (A.f.aq || '').toLowerCase(), rows = C.state.audit.slice().reverse().filter(a => !q || (a.by + a.action + a.detail).toLowerCase().includes(q)).slice(0, 200);
  return card('Audit log <span class="chip muted">' + C.state.audit.length + ' entries</span>', '<div style="margin-bottom:10px"><input type="search" placeholder="Filter by person or action" value="' + esc(A.f.aq || '') + '" data-live="auditQ" aria-label="Filter"></div>' +
    '<div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody id="arows">' + auditRows(rows) + '</tbody></table></div><p class="small muted">Newest first, up to 200 shown. Every change to money, members, settings and logins is recorded here and cannot be edited.</p>');
});
const auditRows = rows => rows.map(a => '<tr><td class="nowrap small">' + dfmt(a.date) + '</td><td>' + esc(a.by) + '<br><small class="muted">' + esc(A.ROLE_LABEL[a.role] || a.role) + '</small></td><td><span class="chip muted">' + esc(a.action) + '</span></td><td class="small">' + esc(a.detail) + '</td></tr>').join('') || '<tr><td colspan="4" class="empty">No matching entries.</td></tr>';
A.inputs.auditQ = el => { A.f.aq = el.value; const q = el.value.toLowerCase(), b = document.getElementById('arows'); if (b) b.innerHTML = auditRows(C.state.audit.slice().reverse().filter(a => !q || (a.by + a.action + a.detail).toLowerCase().includes(q)).slice(0, 200)); };

/* ========================================================================== USERS */
R('users', 'Users & roles', ['superadmin'], () => card('Logins', table(['Name', 'Role', 'Phone', 'Groups', 'Status', ''], C.state.users.map(u => '<tr><td>' + esc(u.name) + '</td><td>' + esc(A.ROLE_LABEL[u.role]) + '</td><td>' + esc(u.phone || '') + '</td><td class="small">' + esc((u.groupIds && u.groupIds[0] !== '*' ? u.groupIds.map(gname).join(', ') : u.groupIds ? 'All' : u.memberId ? esc(mname(u.memberId)) : '')) + '</td><td>' + (u.active !== false ? chip('active') : '<span class="chip muted">Disabled</span>') + '</td><td class="nowrap"><button class="btn sm" data-act="pinForm" data-id="' + u.id + '">Reset PIN</button> <button class="btn sm" data-act="userToggle" data-id="' + u.id + '">' + (u.active !== false ? 'Disable' : 'Enable') + '</button></td></tr>')),
  '<button class="btn primary sm" data-act="userForm">+ Add login</button>') + '<div class="notice">Role rules: the super admin manages logins and settings but <b>cannot record money</b>; the treasurer records money but <b>cannot approve their own</b> transactions; only auditors sign off the books.</div>');
A.acts.userForm = () => modal('Add login', '<form data-form="user" class="stack">' + field('Full name', '<input name="name" required>') + field('Role', select('role', ['bishop', 'secretary', 'treasurer', 'auditor', 'superadmin', 'member', 'parent'].map(r => ({ v: r, l: A.ROLE_LABEL[r] })), 'treasurer')) +
  field('Phone', '<input name="phone" inputmode="tel">') + field('PIN (demo sign-in)', '<input name="pin" value="1234" required>') + field('Group (for treasurers)', select('groupIds', C.state.groups.map(g => ({ v: g.id, l: g.name })), 'g_men')) +
  field('Linked member (for members and treasurers who are also members)', select('memberId', [{ v: '', l: '—' }].concat(C.state.members.map(m => ({ v: m.id, l: m.name }))), '')) + '<div class="row end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Create</button></div></form>');
A.forms.user = (f, d) => { C.addUser(me(), { name: d.name, role: d.role, phone: d.phone, pin: d.pin, groupIds: d.role === 'treasurer' ? [d.groupIds] : null, memberId: d.memberId }); closeModal(); toast('Login created.'); A.refresh(); };
A.acts.pinForm = el => modal('Reset PIN', '<form data-form="pin" class="stack"><input type="hidden" name="id" value="' + el.dataset.id + '">' + field('New PIN (4–8 digits)', '<input name="pin" inputmode="numeric" required>') + '<div class="row end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Save</button></div></form>');
A.forms.pin = (f, d) => { C.resetPin(me(), d.id, d.pin); closeModal(); toast('PIN changed.'); };
A.acts.userToggle = el => { const u = C.userById(el.dataset.id); C.setUserActive(me(), u.id, u.active === false); A.refresh(); };

/* ======================================================================== SETTINGS */
const SET = [['contribution', 'Monthly contribution (KSh)', 'm'], ['tbSavings', 'Table-banking savings per month (KSh)', 'm', 'tb'], ['joiningFee', 'Joining fee (KSh)', 'm'], ['lateFine', 'Late contribution fine (KSh)', 'm'], ['missedFine', 'Missed meeting fine (KSh)', 'm'], ['dueDay', 'Due day of month', 'n'], ['graceDays', 'Grace days', 'n'],
  ['L.multiple', 'Loan limit (× savings)', 'n', 'tb'], ['L.ratePct', 'Loan interest % per month', 'n', 'tb'], ['L.maxMonths', 'Longest repayment (months)', 'n', 'tb'], ['L.minMonths', 'Months a member must wait before borrowing', 'n', 'tb'], ['L.guarantors', 'Guarantors needed', 'n', 'tb'], ['L.approvalLimit', 'Bishop must approve loans above (KSh)', 'm', 'tb'], ['L.penaltyPct', 'Late repayment penalty %', 'n', 'tb'], ['L.maxActive', 'Open loans per member', 'n', 'tb']];
const getV = (g, k) => k.startsWith('L.') ? g.loan[k.slice(2)] : g[k];
R('settings', 'Settings', ['superadmin'], () => {
  const rate = C.state.meta.rates.USD_KES;
  return card('Currency', '<form data-form="rate" class="row"><div style="min-width:200px;flex:1">' + field('USD → KSh rate used on card/bank payments', '<input name="rate" type="number" step="0.01" value="' + rate + '">') + '</div><button class="btn primary">Save rate</button></form><p class="small muted">Each payment stores the rate used. In production this comes from the payment provider so the books match the money received.</p>') +
    C.state.groups.map(g => card(esc(g.name) + ' <span class="chip muted">' + g.types.map(t => t === 'mgr' ? 'Merry-go-round' : 'Table banking').join(' + ') + '</span>',
      '<form data-form="gset" class="stack"><input type="hidden" name="gid" value="' + g.id + '"><div class="cols">' + SET.filter(s => !s[3] || g.types.includes('tb')).map(s => field(s[1], '<input name="k_' + s[0] + '" type="number" step="' + (s[2] === 'm' ? '1' : 'any') + '" value="' + (s[2] === 'm' ? getV(g, s[0]) / 100 : getV(g, s[0])) + '">')).join('') + '</div><div class="row end"><button class="btn primary">Save ' + esc(g.name) + '</button></div></form>')).join('') +
    card('Data', '<div class="row"><button class="btn" data-act="backup">Download backup</button><label class="btn">Restore backup<input type="file" accept=".json" data-live="restore" hidden></label><button class="btn" data-act="check">Check books integrity</button><button class="btn danger" data-act="resetDemo" data-confirm="This erases everything on this device and loads fresh demo data. Continue?">Reset demo data</button></div><p class="small muted">Changes to settings apply to new transactions. Old entries keep the rules in force when they were made.</p>');
});
A.forms.rate = (f, d) => { C.setRate(me(), d.rate); toast('Rate saved.'); A.refresh(); };
A.forms.gset = (f, d) => {
  const g = C.groupById(d.gid); let n = 0;
  for (const s of SET) { const v = d['k_' + s[0]]; if (v === undefined || v === '') continue; const cur_ = getV(g, s[0]), now = s[2] === 'm' ? C.toCents(v) : Number(v); if (now !== cur_) { C.updateGroupSetting(me(), g.id, s[0].replace('L.', ''), v); n++; } }
  toast(n ? n + ' setting(s) saved for ' + g.name : 'Nothing changed.'); A.refresh();
};
A.acts.backup = () => download('chama-backup-' + A.today() + '.json', C.exportJSON(), 'application/json');
A.inputs.restore = el => { const f = el.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { C.importJSON(String(rd.result)); toast('Backup restored.'); A.logout(); } catch (e) { toast(e.message, 'bad'); } }; rd.readAsText(f); };
A.acts.check = () => { const r = C.integrityCheck(); if (r.ok) toast('All good: ' + r.counts.ledger + ' ledger entries checked.'); else modal('Integrity problems', '<ul>' + r.issues.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>'); };
A.acts.resetDemo = () => { C.reset(); toast('Demo data reloaded.'); A.logout(); };

/* ======================================================================= STATEMENT */
R('statement', 'Statement', ALL, param => {
  const u = me(); let m = param && C.memberById(param);
  if (!m && isOwner(u)) m = C.ownMembers(u)[0];
  if (!m) return card('Statement', '<p class="muted">Open a member from <a href="#/members">Members</a> and choose “View statement”.</p>');
  if (!C.canSeeMember(u, m.id) || (!isOwner(u) && !canMoney())) throw new Error('You cannot see this statement.');
  const g = C.groupById(m.groupId), s = C.memberSummary(m.id), st = C.statementFor(m.id), accts = isOwner(u) ? C.ownMembers(u) : [];
  const fines = C.state.fines.filter(f => f.memberId === m.id);
  return (accts.length > 1 ? '<div class="row no-print">' + accts.map(a => '<a class="btn sm ' + (a.id === m.id ? 'primary' : '') + '" href="#/statement/' + a.id + '">' + esc(a.name) + '</a>').join('') + '</div>' : '') +
    '<div class="card"><div class="row between"><div><h3>' + esc(m.name) + '</h3><div class="muted small">' + esc(g.name) + ' · member since ' + dfmt(m.joinedOn) + '</div></div><div class="row no-print"><button class="btn" data-act="print">Print / PDF</button><button class="btn" data-act="stCsv" data-id="' + m.id + '">CSV</button></div></div></div>' +
    '<div class="grid g4">' + kpi('Merry-go-round paid', money(s.mgrContributed)) + (g.types.includes('tb') ? kpi('Savings', money(s.tbSavings)) : '') + kpi('Overdue', money(s.arrears), '', s.arrears ? 'bad' : 'ok') + kpi('Fines owed', money(s.finesOwed), '', s.finesOwed ? 'warn' : '') + kpi('Loan balance', money(s.loanOutstanding)) + '</div>' +
    card('Payments', table(['Date', 'For', 'Month', 'Code', 'Amount', 'Savings total'], st.map(e => '<tr><td>' + dfmt(e.date) + '</td><td>' + esc(C.KIND_LABEL[e.kind]) + (e.reversalOf ? ' <span class="chip muted">reversal</span>' : '') + '</td><td>' + pfmt(e.period) + '</td><td class="mono small">' + esc(e.ref) + '</td><td class="num">' + (e.orig ? 'USD ' + (e.orig / 100) + ' → ' : '') + money(e.amountMinor) + (e.paidBy && e.paidBy !== m.name && e.paidBy !== 'Group' ? '<br><small class="muted">paid by ' + esc(e.paidBy) + '</small>' : '') + '</td><td class="num">' + (e.kind === 'contribution' || e.kind === 'tb_savings' ? money(e.savingsBal) : '') + '</td></tr>').reverse())) +
    (fines.length ? card('Fines', table(['Date', 'Reason', 'Amount', 'Paid', 'Status'], fines.map(f => '<tr><td>' + dfmt(f.date) + '</td><td>' + esc(f.note) + '</td><td class="num">' + money(f.amount) + '</td><td class="num">' + money(f.paid) + '</td><td>' + chip(f.status === 'waived' ? 'waived' : C.fineOwed(f) ? 'open' : 'paid') + '</td></tr>'))) : '');
});
A.routes.statement.nav = u => isOwner(u);
A.acts.stCsv = el => { const m = C.memberById(el.dataset.id); download(m.name.replace(/\s+/g, '-') + '-statement.csv', C.toCSV([['Date', 'Type', 'Month', 'Code', 'Amount KES', 'Savings total']].concat(C.statementFor(m.id).map(e => [e.date, C.KIND_LABEL[e.kind], e.period, e.ref, e.amountMinor / 100, e.savingsBal / 100]))), 'text/csv'); };

/* ============================================================================ HELP */
R('help', 'Install & help', ALL, param => {
  const std = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  return card('Install Chama on your device', (std ? '<div class="notice ok">Chama is installed on this device.</div>' : (A.installEvt ? '<p><button class="btn primary lg" data-act="install">⬇ Install Chama now</button></p>' : '<div class="notice">If you do not see an Install button, follow the steps for your device below.</div>')) +
    '<div class="grid g2" style="margin-top:12px"><div class="msg"><b>Android (Chrome)</b><br>Menu ⋮ → <i>Install app</i> or <i>Add to Home screen</i>.</div><div class="msg"><b>iPhone / iPad (Safari)</b><br>Share button → <i>Add to Home Screen</i>.</div><div class="msg"><b>Windows / Mac / Chromebook (Chrome or Edge)</b><br>Click the install icon at the right of the address bar, or menu → <i>Install Chama</i>.</div><div class="msg"><b>Good to know</b><br>The site must be opened over <b>https</b> (Netlify does this) for install and offline use. After the first visit it opens even with no network.</div></div>') +
    card('Who can do what', table(['Role', 'What they do'], [
      ['Bishop (Chair)', 'Sees every group\'s summary, approves large loans, reads the audit log and the books review. Cannot record money.'],
      ['Secretary', 'Keeps the member register, moves members between groups, schedules Saturday meetings, records attendance, draws the merry-go-round order, approves loans within the limit. No access to money records.'],
      ['Treasurer', 'One per group. Records and reverses payments, imports statements, confirms member claims, waives fines, pays out the merry-go-round, disburses loans, reconciles cash. Cannot approve their own loan.'],
      ['Auditor / Trustee', 'Read-only view of every group\'s books. Signs off each month, which locks it.'],
      ['Super admin (Tech)', 'Creates logins, changes group settings and the USD rate, uses the terminal and backups. Cannot record or edit money.'],
      ['Member', 'Sees own statement, pays and reports payments, requests loans, confirms guarantees, asks the assistant.'],
      ['Parent / Guardian', 'Same as a member, for their children. The money is recorded in the child\'s name.']].map(r => '<tr><td><b>' + r[0] + '</b></td><td>' + r[1] + '</td></tr>'))) +
    card('Quick answers', '<p><b>When is money due?</b> On the 10th of each month. There is a grace period before a late fine is added.</p><p><b>What is the financial year?</b> 2 January to 2 December. The days from 3 December to 1 January are for closing the books and sharing interest.</p><p><b>Can I pay in USD?</b> Yes, by card, bank transfer or other international methods. It is converted to KSh when recorded. M-Pesa and cash are KSh only.</p><p><b>My data?</b> This demo stores data on this device only. Nothing leaves your phone or computer.</p>');
}, p => { if (p === 'install') { const el = document.querySelector('.card'); if (el) el.scrollIntoView(); } });
})();
