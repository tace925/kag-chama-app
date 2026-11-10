/* terminal.js — Super-admin terminal.
   Read-mostly by design: it can inspect everything and run system tasks, but it
   cannot record, edit or delete money. Every state-changing command is audited. */
(function () {
'use strict';
const C = window.Chama, A = window.App, money = C.money;
const esc = A.esc;
const pad = (s, n) => String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s).padEnd(n);
const tbl = (heads, rows) => { const w = heads.map((h, i) => Math.min(30, Math.max(h.length, ...rows.map(r => String(r[i]).length)))); return [heads.map((h, i) => pad(h, w[i])).join('  ')].concat([w.map(n => '─'.repeat(n)).join('  ')], rows.map(r => r.map((c, i) => pad(c, w[i])).join('  '))); };
const gid = s => { if (!s) return null; s = String(s).toLowerCase(); const g = C.state.groups.find(x => x.id === s || x.id === 'g_' + s || x.name.toLowerCase() === s || x.name.toLowerCase().replace(/\s+/g, '') === s); return g ? g.id : null; };
const needG = s => { const g = gid(s); if (!g) throw new Error('Unknown group "' + s + '". Use: ' + C.state.groups.map(x => x.id.replace('g_', '')).join(', ')); return g; };
const memberLike = q => C.state.members.filter(m => m.name.toLowerCase().includes(String(q).toLowerCase()));
const me = () => A.user;

const CMD = {
  help: { d: 'List commands, or help <command>', u: 'help [command]', run(a) {
    if (a[0] && CMD[a[0]]) return ['Usage: ' + CMD[a[0]].u, CMD[a[0]].d];
    return ['Commands (type help <command> for usage):', ''].concat(Object.keys(CMD).map(k => '  ' + pad(k, 14) + CMD[k].d)).concat(['', 'This terminal can read everything but cannot record or change money.', 'Use ↑ / ↓ for history. Tab completes a command name.']); } },
  clear: { d: 'Clear the screen', u: 'clear', run() { A.f.term.lines = []; return []; } },
  whoami: { d: 'Show the signed-in user', u: 'whoami', run() { return [me().name + '  (' + me().role + ')', 'Permissions: ' + Object.keys(C.PERMS).filter(p => C.can(me(), p)).join(', ')]; } },
  date: { d: 'Show today and the simulated date', u: 'date', run() { return ['Real date:      ' + C.todayReal(), 'System date:    ' + C.today() + (C.state.meta.simDate ? '  (simulated)' : ''), 'Financial year: ' + C.fyState(C.today()).fy + (C.fyState(C.today()).closing ? '  (closing window)' : '  (2 Jan – 2 Dec)')]; } },
  simdate: { d: 'Pretend today is another date, for testing fines and due dates', u: 'simdate <YYYY-MM-DD> | simdate reset', run(a) {
    if (a[0] === 'reset') { C.state.meta.simDate = null; C.log(me(), 'terminal.simdate', 'reset'); C.save(); return ['Simulated date cleared. Today is ' + C.todayReal() + '.']; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a[0] || '') || isNaN(C.parse(a[0]))) throw new Error('Usage: simdate YYYY-MM-DD');
    C.state.meta.simDate = a[0]; C.log(me(), 'terminal.simdate', a[0]); C.save(); return ['System date is now ' + a[0] + '. Run "fines run" to see late fines for that date.', 'Reset with: simdate reset']; } },
  groups: { d: 'List groups and their rules', u: 'groups', run() { return tbl(['id', 'name', 'types', 'monthly', 'tb save', 'late fine', 'due', 'members'], C.state.groups.map(g => [g.id.replace('g_', ''), g.name, g.types.join('+'), money(g.contribution), g.types.includes('tb') ? money(g.tbSavings) : '—', money(g.lateFine), g.dueDay + 'th +' + g.graceDays + 'd', C.state.members.filter(m => m.groupId === g.id && m.status === 'active').length]));} },
  members: { d: 'List members, optionally for one group', u: 'members [group]', run(a) { const g = a[0] && needG(a[0]); return tbl(['name', 'group', 'age', 'married', 'phone'], C.state.members.filter(m => !g || m.groupId === g).map(m => [m.name, A.gname(m.groupId), C.age(m.dob), m.married ? 'yes' : 'no', m.phone || '(guardian)'])); } },
  member: { d: 'Full detail for one member', u: 'member <part of name>', run(a) {
    const l = memberLike(a.join(' ')); if (!l.length) throw new Error('No member matches.'); if (l.length > 1) return ['Several matches:'].concat(l.map(m => '  ' + m.name));
    const m = l[0], s = C.memberSummary(m.id); return ['Name:        ' + m.name, 'Group:       ' + A.gname(m.groupId), 'Age/status:  ' + C.age(m.dob) + (m.married ? ', married' : ', single'), 'Joined:      ' + m.joinedOn, 'Guardian:    ' + (m.guardianName || '—'), 'MGR paid:    ' + money(s.mgrContributed), 'TB savings:  ' + money(s.tbSavings), 'Overdue:     ' + money(s.arrears), 'Fines owed:  ' + money(s.finesOwed), 'Loan owed:   ' + money(s.loanOutstanding), 'Moves:       ' + (m.history.length ? m.history.map(h => h.date + ' ' + h.from + '→' + h.to).join('; ') : 'none')]; } },
  users: { d: 'List logins and roles', u: 'users', run() { return tbl(['name', 'role', 'groups', 'active'], C.state.users.map(u => [u.name, u.role, u.groupIds ? u.groupIds.join(',') : (u.memberId ? 'member' : ''), u.active === false ? 'no' : 'yes'])); } },
  balance: { d: 'Cash on hand per group (system vs last reconciliation)', u: 'balance [group]', run(a) { const g = a[0] && needG(a[0]); return tbl(['group', 'system cash', 'last check', 'difference'], C.state.groups.filter(x => !g || x.id === g).map(x => { const r = C.state.recons.filter(y => y.groupId === x.id).slice(-1)[0]; return [x.name, money(C.cashOnHand(x.id)), r ? r.date : 'never', r ? money(r.diff) : '—']; })); } },
  ledger: { d: 'Latest ledger entries (read-only)', u: 'ledger [count] [group]', run(a) { const n = parseInt(a[0], 10) || 10, g = a[1] ? needG(a[1]) : (a[0] && isNaN(parseInt(a[0], 10)) ? needG(a[0]) : null);
    const e = C.state.ledger.filter(x => !g || x.groupId === g).slice(-n).reverse(); return tbl(['date', 'member', 'type', 'amount', 'via', 'ref'], e.map(x => [x.date, C.memberById(x.memberId).name, x.kind, money(x.amountMinor), x.method, x.ref])); } },
  audit: { d: 'Latest audit log entries', u: 'audit [count] [text]', run(a) { const n = parseInt(a[0], 10) || 10, q = (isNaN(parseInt(a[0], 10)) ? a : a.slice(1)).join(' ').toLowerCase(); return tbl(['date', 'who', 'action', 'detail'], C.state.audit.filter(x => !q || (x.by + x.action + x.detail).toLowerCase().includes(q)).slice(-n).reverse().map(x => [x.date, x.by, x.action, x.detail])); } },
  moves: { d: 'Members who should change group', u: 'moves', run() { const m = C.suggestMoves(); return m.length ? tbl(['member', 'from', 'to', 'why'], m.map(x => [C.memberById(x.memberId).name, x.from, x.to, x.reason])) : ['Everyone is in the right group.']; } },
  loans: { d: 'All loans and their status', u: 'loans', run() { return tbl(['borrower', 'amount', 'status', 'balance', 'guarantors'], C.state.loans.map(l => [C.memberById(l.memberId).name, money(l.principal), l.status, money(C.loanOutstanding(l)), l.confirmed.length + '/' + l.guarantors.length])); } },
  signoffs: { d: 'Auditor sign-offs', u: 'signoffs', run() { return tbl(['group', 'month', 'status', 'by'], C.state.signoffs.map(s => [A.gname(s.groupId), s.period, s.status, s.by])); } },
  stats: { d: 'Counts of everything stored', u: 'stats', run() { const S = C.state; return ['members     ' + S.members.length, 'ledger      ' + S.ledger.length, 'fines       ' + S.fines.length, 'loans       ' + S.loans.length, 'messages    ' + S.messages.length, 'audit       ' + S.audit.length, 'storage     ' + (C.exportJSON().length / 1024).toFixed(1) + ' KB']; } },
  check: { d: 'Run the books integrity check', u: 'check', run() { const r = C.integrityCheck(); return r.ok ? ['OK: ' + r.counts.ledger + ' ledger entries, ' + r.counts.loans + ' loans, ' + r.counts.fines + ' fines. Everything adds up.'] : ['PROBLEMS FOUND:'].concat(r.issues.map(i => '  ! ' + i)); } },
  fines: { d: 'Apply late fines now: fines run', u: 'fines run', run(a) { if (a[0] !== 'run') throw new Error('Usage: fines run'); const r = C.runFines(C.today(), me()); return [r.created + ' new fine(s) created for ' + C.today() + '.']; } },
  rate: { d: 'Show or set the USD→KSh rate', u: 'rate [value]', run(a) { if (!a[0]) return ['USD/KES = ' + C.state.meta.rates.USD_KES]; C.setRate(me(), a[0]); return ['USD/KES set to ' + a[0] + '. New USD payments use it; old ones keep theirs.']; } },
  set: { d: 'Change a group setting', u: 'set <group> <key> <value>', run(a) {
    if (a.length < 3) return ['Usage: set <group> <key> <value>', 'Money values are in KSh. Keys: contribution tbSavings lateFine missedFine joiningFee dueDay graceDays', 'loan keys: multiple ratePct maxMonths minMonths guarantors approvalLimit penaltyPct maxActive'];
    const g = needG(a[0]); const loanKeys = ['multiple', 'ratePct', 'maxMonths', 'minMonths', 'guarantors', 'approvalLimit', 'penaltyPct', 'maxActive']; const r = C.updateGroupSetting(me(), g, a[1], a[2]); return [A.gname(g) + ' ' + a[1] + ': ' + (loanKeys.includes(a[1]) && a[1] !== 'approvalLimit' || ['dueDay', 'graceDays'].includes(a[1]) ? r.old + ' → ' + r.nv : money(r.old) + ' → ' + money(r.nv)), 'Applies to new transactions only.']; } },
  export: { d: 'Download a full JSON backup', u: 'export', run() { A.acts.backup(); return ['Backup downloaded.']; } },
  'reset-demo': { d: 'Erase this device and reload demo data', u: 'reset-demo confirm', run(a) { if (a[0] !== 'confirm') return ['This erases all data on this device. Type: reset-demo confirm']; C.reset(); A.logout(); return []; } }
};

function exec(line) {
  const T = A.f.term; T.lines.push({ c: 'cmd', t: '$ ' + line }); if (!line.trim()) return;
  T.hist.push(line); T.hi = T.hist.length;
  const parts = []; line.replace(/"([^"]*)"|(\S+)/g, (m, q, w) => parts.push(q !== undefined ? q : w));
  const name = parts[0].toLowerCase(), cmd = CMD[name];
  if (!cmd) { T.lines.push({ c: 'err', t: 'Unknown command: ' + name + '. Type help.' }); return; }
  try { const out = cmd.run(parts.slice(1)); (out || []).forEach((l, i) => T.lines.push({ c: name === 'help' && i === 0 ? 'h' : (/^PROBLEMS|^\s+!/.test(l) ? 'err' : /^OK/.test(l) ? 'ok' : ''), t: l })); }
  catch (e) { T.lines.push({ c: 'err', t: 'Error: ' + e.message }); }
}

A.routes.terminal = { title: 'Terminal', roles: ['superadmin'],
  render() {
    const T = A.f.term || (A.f.term = { lines: [{ c: 'h', t: 'Chama admin terminal' }, { c: 'dim', t: 'Type help to see commands. This terminal reads everything but cannot record or change money.' }], hist: [], hi: 0 });
    return '<section class="term"><div class="term-out" id="termout" role="log">' + T.lines.map(l => '<div class="' + (l.c || '') + '">' + esc(l.t) + '</div>').join('') + '</div>' +
      '<form class="term-in" data-form="term" autocomplete="off"><span>' + esc(me().name.split(' ')[0].toLowerCase()) + '@chama $</span><input id="terminput" name="line" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Terminal command"></form></section>' +
      '<p class="small muted">Quick: <a href="#" data-act="termRun" data-c="help">help</a> · <a href="#" data-act="termRun" data-c="check">check</a> · <a href="#" data-act="termRun" data-c="groups">groups</a> · <a href="#" data-act="termRun" data-c="moves">moves</a> · <a href="#" data-act="termRun" data-c="audit 8">audit 8</a></p>';
  },
  after() {
    const o = document.getElementById('termout'); if (o) o.scrollTop = o.scrollHeight; const i = document.getElementById('terminput'); if (!i) return; if (window.innerWidth > 900) i.focus(); const T = A.f.term;
    i.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp') { e.preventDefault(); if (T.hi > 0) T.hi--; i.value = T.hist[T.hi] || ''; }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (T.hi < T.hist.length) T.hi++; i.value = T.hist[T.hi] || ''; }
      else if (e.key === 'Tab') { e.preventDefault(); const v = i.value.trim().toLowerCase(); const m = Object.keys(CMD).filter(k => k.startsWith(v)); if (m.length === 1) i.value = m[0] + ' '; }
    });
  }
};
A.forms.term = (f, d) => { exec(d.line || ''); A.render(); };
A.acts.termRun = el => { exec(el.dataset.c); A.render(); };
window.TerminalCommands = Object.keys(CMD).map(k => ({ name: k, usage: CMD[k].u, desc: CMD[k].d }));
})();
