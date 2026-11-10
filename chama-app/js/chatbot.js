/* chatbot.js — the Assistant. Guided buttons + a text box.
   Every number comes from Chama (fixed code). The text box only picks which
   fixed calculation to run; if nothing matches it says so instead of guessing.
   Understands English and common Swahili words. */
(function () {
'use strict';
const C = window.Chama, A = window.App, money = C.money;
const isOwner = u => u.role === 'member' || u.role === 'parent';
const L = { lang: 'en' };
const t = (en, sw) => L.lang === 'sw' ? sw : en;
const cur = () => A.curPeriod();
const gs = u => C.scopeGroupIds(u).map(C.groupById).filter(Boolean);
const mname = id => (C.memberById(id) || { name: '?' }).name;
const NOMONEY = () => ({ text: t('Money records are kept by each group\'s Treasurer and the auditors. Ask them, or use the buttons for members, meetings and approvals.', 'Rekodi za pesa zinashikiliwa na Mweka Hazina na wakaguzi. Waulize wao.') });

const H = {
  balance(u) {
    if (isOwner(u)) return { text: C.ownMembers(u).map(m => { const s = C.memberSummary(m.id); return m.name + ' (' + A.gname(m.groupId) + '):\n' + t('  Merry-go-round paid: ', '  Mzunguko umelipwa: ') + money(s.mgrContributed) + (C.groupById(m.groupId).types.includes('tb') ? '\n' + t('  Savings: ', '  Akiba: ') + money(s.tbSavings) : '') + '\n' + t('  Overdue: ', '  Deni la michango: ') + money(s.arrears) + '\n' + t('  Fines owed: ', '  Faini: ') + money(s.finesOwed) + (s.loanOutstanding ? '\n' + t('  Loan balance: ', '  Mkopo: ') + money(s.loanOutstanding) : ''); }).join('\n\n') };
    return H.summary(u);
  },
  due(u) {
    if (isOwner(u)) { const p = cur(); return { text: C.ownMembers(u).map(m => { const s = C.periodStatus(m, p), a = C.arrears(m); return m.name + ': ' + (s.due ? t('this month ', 'mwezi huu ') + money(s.due) + t(' due by ', ' lipa kabla ya ') + A.dfmt(s.dueDate) + ' (' + s.status + ')' : t('nothing due', 'hakuna deni')) + (a ? '\n  ' + t('Overdue: ', 'Umechelewa: ') + money(a) : ''); }).join('\n') }; }
    return H.late(u);
  },
  fines(u) {
    if (isOwner(u)) { const rows = C.ownMembers(u).flatMap(m => C.openFines(m.id).map(f => [m.name, f.note, money(C.fineOwed(f))])); return rows.length ? { text: t('Open fines:', 'Faini zilizo wazi:'), rows: { heads: [t('Member', 'Mwanachama'), t('Reason', 'Sababu'), t('Owed', 'Deni')], body: rows } } : { text: t('You have no open fines.', 'Huna faini.') }; }
    if (!C.can(u, 'money.view')) return NOMONEY();
    const ids = C.scopeGroupIds(u), fs = C.state.fines.filter(f => ids.includes(f.groupId) && C.fineOwed(f) > 0);
    return { text: fs.length + ' open fine(s), ' + money(C.sum(fs, C.fineOwed)) + ' in total.', rows: fs.length ? { heads: ['Member', 'Reason', 'Owed'], body: fs.slice(0, 15).map(f => [mname(f.memberId), f.note, money(C.fineOwed(f))]) } : null };
  },
  loan(u) {
    if (isOwner(u)) { const ls = C.state.loans.filter(l => C.ownMembers(u).some(m => m.id === l.memberId)); if (!ls.length) return { text: t('You have no loans. Open Loans to request one.', 'Huna mkopo. Fungua Mikopo kuomba.') };
      return { text: ls.map(l => { const nx = (l.schedule || []).find(r => r.pp + r.pi < r.principal + r.interest); return mname(l.memberId) + ': ' + money(l.principal) + ' (' + l.status + ')' + (l.status === 'active' ? t('\n  Balance ', '\n  Salio ') + money(C.loanOutstanding(l)) + (nx ? t('\n  Next instalment ', '\n  Malipo yajayo ') + money(nx.principal + nx.interest - nx.pp - nx.pi) + t(' on ', ' tarehe ') + A.dfmt(nx.due) : '') : ''); }).join('\n\n') }; }
    if (!C.can(u, 'loans.view')) return NOMONEY();
    const ids = C.scopeGroupIds(u), ls = C.state.loans.filter(l => ids.includes(l.groupId) && l.status === 'active');
    return { text: ls.length + ' active loan(s)' + (C.can(u, 'money.view') ? ', ' + money(C.sum(ls, C.loanOutstanding)) + ' outstanding.' : '.'), rows: ls.length ? { heads: ['Borrower', 'Amount', 'Balance'], body: ls.map(l => [mname(l.memberId), money(l.principal), C.can(u, 'money.view') ? money(C.loanOutstanding(l)) : '—']) } : null };
  },
  meeting(u) {
    const t0 = A.today(), ids = C.scopeGroupIds(u), m = C.state.meetings.filter(x => x.date >= t0 && (x.groupId === 'all' || ids.includes(x.groupId))).sort((a, b) => a.date.localeCompare(b.date))[0];
    return { text: m ? t('Next meeting: ', 'Mkutano ujao: ') + A.dfmt(m.date) + ' · ' + (m.mode === 'online' ? t('Online', 'Mtandaoni') : t('Physical', 'Ana kwa ana')) + (m.where ? '\n' + m.where : '') : t('No meeting is scheduled yet. Every Saturday is a meeting day.', 'Hakuna mkutano uliopangwa. Kila Jumamosi ni siku ya mkutano.') };
  },
  recipient(u) {
    const list = gs(u).filter(g => g.types.includes('mgr')).map(g => { const n = C.mgrNext(g.id); return g.name + ' (' + t('round', 'mzunguko') + ' ' + g.mgr.round + '): ' + (n ? mname(n) : '—'); });
    return { text: t('Next merry-go-round recipient:\n', 'Atakayepokea mzunguko ujao:\n') + list.join('\n') };
  },
  late(u) {
    if (!C.can(u, 'money.view')) return NOMONEY();
    const p = cur(), rows = []; for (const g of gs(u)) for (const r of C.groupMonthly(g.id, p).rows) if (r.status === 'late' || r.status === 'grace') rows.push([r.member.name, g.name, money(r.short), r.status]);
    return { text: rows.length ? rows.length + t(' member(s) are overdue for ', ' wamechelewa kwa ') + A.pfmt(p) + ':' : t('Nobody is late this month.', 'Hakuna aliyechelewa mwezi huu.'), rows: rows.length ? { heads: [t('Member', 'Mwanachama'), t('Group', 'Kikundi'), t('Short', 'Pungufu'), t('Status', 'Hali')], body: rows } : null };
  },
  summary(u) {
    if (!C.can(u, 'money.view')) return NOMONEY();
    const p = cur(), body = gs(u).map(g => { const T = C.groupMonthly(g.id, p).totals; return [g.name, money(T.collected) + ' / ' + money(T.due), String(T.lateCount), money(T.cash)]; });
    return { text: t('Summary for ', 'Muhtasari wa ') + A.pfmt(p) + ':', rows: { heads: [t('Group', 'Kikundi'), t('Collected / due', 'Zilizokusanywa / zinazodaiwa'), t('Late', 'Waliochelewa'), t('Cash', 'Pesa')], body } };
  },
  cash(u) {
    if (!C.can(u, 'money.view')) return NOMONEY();
    return { text: t('Cash on hand by group:', 'Pesa zilizopo:') + '\n' + gs(u).map(g => g.name + ': ' + money(C.cashOnHand(g.id))).join('\n') };
  },
  pending(u) {
    const sc = C.scopeGroupIds(u), out = [], loans = C.state.loans.filter(l => sc.includes(l.groupId));
    const w = loans.filter(l => l.status === 'requested' && l.confirmed.length === l.guarantors.length).length, d = loans.filter(l => l.status === 'approved').length, cl = C.state.claims.filter(c => c.status === 'pending' && sc.includes(c.groupId)).length, mv = C.suggestMoves().filter(s => sc.includes(s.from)).length;
    if (C.can(u, 'loans.approve') && w) out.push(w + ' loan(s) waiting for approval'); if (C.can(u, 'loans.disburse') && d) out.push(d + ' approved loan(s) to disburse'); if (C.can(u, 'claims.review') && cl) out.push(cl + ' payment claim(s) to confirm'); if (C.can(u, 'members.move') && mv) out.push(mv + ' member(s) to move between groups');
    return { text: out.length ? t('Needs attention:\n', 'Inahitaji uangalizi:\n') + out.map(x => '• ' + x).join('\n') : t('Nothing is waiting for you.', 'Hakuna kitu kinachosubiri.') };
  },
  moves(u) {
    const sc = C.scopeGroupIds(u), mv = C.suggestMoves().filter(s => sc.includes(s.from));
    return { text: mv.length ? mv.length + ' member(s) no longer fit their group:' : 'Everyone is in the right group.', rows: mv.length ? { heads: ['Member', 'From', 'To', 'Why'], body: mv.map(s => [mname(s.memberId), A.gname(s.from), A.gname(s.to), s.reason]) } : null };
  }
};

const RULES = [
  [/\b(late|defaulter|not paid|wachelewa|walio chelewa)\b/, 'late'], [/\b(who|nani).*(next|receive|get|pokea|zamu)|merry|mzunguko|zamu\b/, 'recipient'],
  [/\b(approval|approve|pending|waiting|attention|todo|to do)\b/, 'pending'], [/\b(move|shift|wrong group|change group)\b/, 'moves'],
  [/\b(fine|faini)\b/, 'fines'], [/\b(loan|borrow|mkopo|kopa)\b/, 'loan'], [/\b(meeting|mkutano|saturday|jumamosi)\b/, 'meeting'],
  [/\b(cash|float|in the bank|pesa zilizopo)\b/, 'cash'], [/\b(summary|report|collected|status|muhtasari|ripoti)\b/, 'summary'],
  [/\b(owe|due|pay|arrears|overdue|deadline|lipa|deni|nadaiwa)\b/, 'due'], [/\b(balance|saved|savings|how much|salio|akiba)\b/, 'balance']
];
function ask(u, text) {
  const q = String(text || '').toLowerCase().trim(); if (!q) return { text: t('Type a question or use a button.', 'Andika swali au tumia kitufe.') };
  if (/^(hi|hello|habari|hey|mambo|niaje)\b/.test(q)) return { text: t('Hello ' + u.name.split(' ')[0] + '. Use a button below or ask me about balances, fines, loans, meetings or who is late.', 'Habari ' + u.name.split(' ')[0] + '. Tumia kitufe au uliza kuhusu salio, faini, mikopo, mikutano.') };
  for (const [re, key] of RULES) if (re.test(q)) return H[key](u);
  return { text: t('I can only answer from fixed calculations, and I do not know how to answer that yet. Try one of the buttons, or ask about balance, fines, loans, meetings, who is late, or the next merry-go-round recipient. I will never guess a number.', 'Naweza kujibu maswali ya hesabu zilizowekwa tu. Jaribu kitufe, au uliza kuhusu salio, faini, mikopo, mikutano au atakayepokea mzunguko. Sitabuni namba.') };
}
function quick(u) {
  if (isOwner(u)) return [[t('My balance', 'Salio langu'), 'balance'], [t('What do I owe?', 'Nadaiwa nini?'), 'due'], [t('My fines', 'Faini zangu'), 'fines'], [t('My loan', 'Mkopo wangu'), 'loan'], [t('Next meeting', 'Mkutano ujao'), 'meeting'], [t('Who receives next?', 'Nani anapokea?'), 'recipient']];
  const q = [];
  if (C.can(u, 'money.view')) q.push([t('Who is late?', 'Nani amechelewa?'), 'late'], [t('Summary this month', 'Muhtasari wa mwezi'), 'summary'], [t('Cash on hand', 'Pesa zilizopo'), 'cash'], [t('Fines owed', 'Faini'), 'fines']);
  q.push([t('Loans', 'Mikopo'), 'loan'], [t('Needs attention', 'Inahitaji uangalizi'), 'pending'], [t('Next meeting', 'Mkutano ujao'), 'meeting'], [t('Who receives next?', 'Nani anapokea?'), 'recipient']);
  if (C.can(u, 'members.move')) q.push([t('Members to move', 'Wa kuhamishwa'), 'moves']);
  return q;
}
window.Bot = { ask, quick, L, H };

A.routes.assistant = { title: 'Assistant', roles: ['superadmin', 'bishop', 'secretary', 'treasurer', 'auditor', 'member', 'parent'],
  render() {
    const u = A.user, log = A.f.chat && A.f.chat.uid === u.id ? A.f.chat.log : (A.f.chat = { uid: u.id, log: [{ who: 'bot', text: ask(u, 'hello').text }] }).log;
    const bub = m => '<div class="bub ' + (m.who === 'me' ? 'me' : 'bot') + '">' + A.esc(m.text) + (m.rows ? '<div class="tw"><table><thead><tr>' + m.rows.heads.map(h => '<th>' + A.esc(h) + '</th>').join('') + '</tr></thead><tbody>' + m.rows.body.map(r => '<tr>' + r.map(c => '<td>' + A.esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '') + '</div>';
    return '<section class="card chat"><div class="card-h"><h3>Ask the assistant</h3><div class="card-a"><button class="btn sm" data-act="botLang">' + (L.lang === 'en' ? 'Kiswahili' : 'English') + '</button><button class="btn sm" data-act="botClear">Clear</button></div></div>' +
      '<div class="chat-log" id="chatlog" role="log" aria-live="polite">' + log.map(bub).join('') + '</div>' +
      '<div class="quick">' + quick(u).map(q => '<button type="button" data-act="botQ" data-k="' + q[1] + '" data-t="' + A.esc(q[0]) + '">' + A.esc(q[0]) + '</button>').join('') + '</div>' +
      '<form class="chat-in" data-form="chat"><input name="q" autocomplete="off" placeholder="' + t('Ask about balances, fines, loans, meetings…', 'Uliza kuhusu salio, faini, mikopo…') + '" aria-label="Question"><button class="btn primary">' + t('Send', 'Tuma') + '</button></form>' +
      '<p class="small muted" style="margin-top:6px">' + t('Numbers come from fixed calculations, never from guesswork.', 'Namba zinatoka kwenye hesabu zilizowekwa.') + '</p></section>';
  },
  after() { const l = document.getElementById('chatlog'); if (l) l.scrollTop = l.scrollHeight; const i = document.querySelector('.chat-in input'); if (i && window.innerWidth > 900) i.focus(); }
};
A.forms.chat = (f, d) => { const q = (d.q || '').trim(); if (!q) return; const c = A.f.chat; c.log.push({ who: 'me', text: q }); c.log.push(Object.assign({ who: 'bot' }, ask(A.user, q))); A.render(); };
A.acts.botQ = el => { const c = A.f.chat; c.log.push({ who: 'me', text: el.dataset.t }); c.log.push(Object.assign({ who: 'bot' }, H[el.dataset.k](A.user))); A.render(); };
A.acts.botLang = () => { L.lang = L.lang === 'en' ? 'sw' : 'en'; A.render(); };
A.acts.botClear = () => { A.f.chat = null; A.render(); };
})();
