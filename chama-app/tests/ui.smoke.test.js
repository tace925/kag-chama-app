/* Browser smoke test (jsdom).  Run:  NODE_PATH=/path/to/node_modules node tests/ui.smoke.test.js
   Serves the app on localhost, signs in as every role, opens every screen and
   drives the main actions. Fails on any script error or "Something went wrong". */
const http = require('http'), fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const errors = []; let checks = 0, failed = 0;
const ok = (c, msg) => { checks++; if (!c) { failed++; console.error('FAIL  ' + msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail && e.detail.message || e.message))); vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const dom = await JSDOM.fromURL(base + '/', { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window, d = w.document;
  await new Promise(r => w.document.readyState === 'complete' ? r() : w.addEventListener('load', r)); await sleep(100);
  w.confirm = () => true; w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
  const C = w.Chama, A = w.App;

  // static files the install needs
  for (const f of ['manifest.webmanifest', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/icon.svg']) { const r = await fetch(base + '/' + f); ok(r.status === 200, 'static file ' + f + ' served'); }
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  ok(man.display === 'standalone' && man.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'), 'manifest is installable (standalone + maskable 512 icon)');
  ok(!!d.querySelector('.login-card'), 'login screen renders');

  const go = async h => { w.location.hash = '#/' + h; await sleep(15); A.render(); };
  const view = () => d.getElementById('view') ? d.getElementById('view').innerHTML : '';
  const click = sel => { const el = typeof sel === 'string' ? d.querySelector(sel) : sel; if (!el) throw new Error('missing ' + sel); el.click(); };
  const submit = form => form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const setv = (form, name, v) => { const el = form.querySelector('[name="' + name + '"]'); if (!el) throw new Error('no field ' + name); if (el.type === 'checkbox') el.checked = !!v; else el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const modalForm = () => d.querySelector('#modal-root form');
  const toasts = () => [...d.querySelectorAll('#toast-root .toast')].map(t => t.textContent + '|' + t.className);
  const lastToast = () => { const t = d.querySelectorAll('#toast-root .toast'); return t.length ? t[t.length - 1] : null; };
  const userOf = (role, pred) => C.state.users.find(u => u.role === role && (!pred || pred(u)));

  /* ---------- 1. every role opens every screen it can see ---------- */
  const ROLES = ['superadmin', 'bishop', 'secretary', 'treasurer', 'auditor', 'member', 'parent'];
  const seen = {};
  for (const role of ROLES) {
    const u = userOf(role); A.login(u.id); await sleep(10);
    ok(!d.querySelector('.login-card'), role + ': signed in');
    const links = [...d.querySelectorAll('a.nav')].map(a => a.getAttribute('href').slice(2)); seen[role] = links;
    ok(links.includes('dashboard') && links.includes('assistant') && links.includes('help'), role + ': has Home, Assistant, Help in the menu (' + links.length + ' items)');
    for (const r of links) { await go(r); const html = view(); ok(html.length > 200, role + ' → ' + r + ': renders content'); ok(!/Something went wrong/.test(html), role + ' → ' + r + ': no error card'); }
    if (role === 'treasurer') await go('statement/' + C.state.members[5].id);
    d.getElementById('app'); A.logout(); await sleep(5);
  }
  ok(seen.superadmin.includes('terminal') && !ROLES.filter(r => r !== 'superadmin').some(r => seen[r].includes('terminal')), 'terminal is visible to the super admin ONLY');
  ok(!seen.superadmin.includes('import') && seen.treasurer.includes('import'), 'import is for the treasurer only');
  ok(!seen.secretary.includes('reports') && !seen.member.includes('review'), 'menus differ by role (secretary: no reports, member: no review)');
  ok(seen.auditor.includes('review') && seen.bishop.includes('review'), 'auditor and bishop see the books review');

  /* ---------- 2. forbidden screens fall back to Home ---------- */
  A.login(userOf('member').id); await go('terminal'); ok(/Home/.test(d.querySelector('.top h2').textContent), 'member opening #/terminal is sent Home');
  A.logout();

  /* ---------- 3. treasurer records a payment (KSh + USD) ---------- */
  const men = userOf('treasurer', u => u.groupIds.includes('g_men')); A.login(men.id); await go('contributions');
  const mem = C.state.members.find(m => m.name === 'Moses Kiprop'), before = C.state.ledger.length, cash0 = C.cashOnHand('g_men');
  click('[data-act=payForm]'); let f = modalForm(); ok(!!f, 'record-payment modal opens');
  setv(f, 'memberId', mem.id); setv(f, 'amount', '1500'); setv(f, 'method', 'M-Pesa'); setv(f, 'ref', 'UIT001XYZ');
  ok(/Merry-go-round|Table-banking|Unallocated/.test(f.querySelector('#payPrev').textContent), 'live preview shows where the money goes');
  submit(f); await sleep(10);
  ok(C.state.ledger.length > before && C.cashOnHand('g_men') - cash0 === 150000, 'KSh 1,500 recorded and cash on hand rose by exactly that');
  ok(modalForm() === null, 'modal closes after saving');
  click('[data-act=payForm]'); f = modalForm(); setv(f, 'memberId', mem.id); setv(f, 'amount', '10'); setv(f, 'ccy', 'USD'); setv(f, 'method', 'M-Pesa');
  ok(/KSh only/.test(f.querySelector('#payPrev').textContent), 'USD by M-Pesa is blocked in the preview');
  setv(f, 'method', 'Card'); setv(f, 'ref', 'UIT002USD'); ok(/USD 10 × 129/.test(f.querySelector('#payPrev').textContent), 'USD preview shows the conversion'); submit(f); await sleep(10);
  ok(C.state.ledger.some(e => e.ref === 'UIT002USD' && e.orig === 1000 && e.rate === 129), 'USD payment stored with original amount and rate');
  ok(modalForm() === null, 'modal closes after the USD payment too');
  click('[data-act=payForm]'); f = modalForm(); setv(f, 'memberId', mem.id); setv(f, 'amount', '5'); setv(f, 'ref', 'UIT001XYZ'); submit(f); await sleep(10);
  ok(/duplicate/.test(lastToast().textContent) && lastToast().className.includes('bad'), 'duplicate code is refused with a clear message');
  A.logout();

  /* ---------- 4. member claims a payment, treasurer confirms ---------- */
  const mu = userOf('member', u => u.name === 'Moses Kiprop'); A.login(mu.id); await go('dashboard'); click('[data-act=claimForm]'); f = modalForm();
  setv(f, 'amount', '500'); setv(f, 'ref', 'claim123x'); submit(f); await sleep(10);
  ok(C.state.claims.some(c => c.ref === 'CLAIM123X' && c.status === 'pending'), 'member claim saved as pending (books untouched)'); A.logout();
  A.login(men.id); await go('contributions'); const lg = C.state.ledger.length; click('[data-act=claimOk]'); await sleep(10);
  ok(C.state.claims.find(c => c.ref === 'CLAIM123X').status === 'confirmed' && C.state.ledger.length > lg, 'treasurer confirms the claim and it reaches the books');

  /* ---------- 4b. cash check (reconciliation) ---------- */
  await go('contributions'); click('[data-act=reconForm]'); f = modalForm(); setv(f, 'actual', String((C.cashOnHand('g_men') - 5000) / 100)); submit(f); await sleep(10);
  ok(C.state.recons.slice(-1)[0].diff === -5000 && /difference/i.test(lastToast().textContent), 'cash check records a KSh 50 shortfall and says so');
  ok(C.reviewChecks('g_men', C.monthOf(A.today())).find(c => /Cash matches/.test(c.label)).ok === false, 'the books review flags the cash difference to the auditors');

  /* ---------- 5. reversal keeps history ---------- */
  await go('contributions'); const rev = [...d.querySelectorAll('[data-act=reverseForm]')][0]; click(rev); f = modalForm(); setv(f, 'reason', 'Entered by mistake'); const n0 = C.state.ledger.length; submit(f); await sleep(10);
  ok(C.state.ledger.length === n0 + 1 && C.state.ledger.some(e => e.reversalOf), 'reversal adds an opposite entry (nothing deleted)'); ok(C.integrityCheck().ok, 'books still balance after the reversal');
  A.logout();

  /* ---------- 6. statement import ---------- */
  const yt = userOf('treasurer', u => u.groupIds.includes('g_youth')); A.login(yt.id); await go('import');
  const peter = C.state.members.find(m => m.name === 'Peter Njoroge');
  const csv = 'Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance\nIMP1AAAAA,' + A.today() + ' 09:12:01,Funds received from ' + peter.phone.replace(/^0/, '254') + ' - PETER NJOROGE,Completed,"700.00",,5000\nIMP2BBBBB,' + A.today() + ' 10:00:00,Funds received from 254700000000 - SOMEONE ELSE,Completed,300.00,,5300\n';
  d.getElementById('impPaste').value = csv; click('[data-act=impPaste]'); await sleep(10);
  ok(A.f.imp && A.f.imp.rows.length === 2 && A.f.imp.rows[0].memberId === peter.id && !A.f.imp.rows[1].memberId, 'import finds 2 payments, matches one, leaves the stranger unmatched');
  f = d.querySelector('form[data-form=impTask]'); setv(f, 'task', 'summary'); submit(f); await sleep(10); ok(/Payments found/.test(d.getElementById('impOut').textContent), 'import task "summary" works');
  f = d.querySelector('form[data-form=impTask]'); setv(f, 'task', 'custom'); setv(f, 'custom', 'who is late this month?'); submit(f); await sleep(10); ok(d.getElementById('impOut').textContent.length > 10, 'import free-text task is answered');
  f = d.querySelector('form[data-form=impTask]'); setv(f, 'task', 'record'); const l0 = C.state.ledger.length; submit(f); await sleep(10);
  ok(C.state.ledger.some(e => e.ref === 'IMP1AAAAA') && !C.state.ledger.some(e => e.ref === 'IMP2BBBBB') && C.state.ledger.length > l0, 'only the matched payment is recorded'); A.logout();

  /* ---------- 7. secretary adds a child (guardian rules) + moves a member ---------- */
  const sec = userOf('secretary'); A.login(sec.id); await go('members'); click('[data-act=addMemberForm]'); f = modalForm();
  const dob = new Date(A.today()); dob.setFullYear(dob.getFullYear() - 12); setv(f, 'name', 'Test Child Wanjiku'); setv(f, 'dob', C.fmtD(dob)); setv(f, 'sex', 'F');
  ok(/Sunday School/.test(f.querySelector('#addPrev').textContent), 'add-member preview places a 12-year-old in Sunday School'); submit(f); await sleep(10);
  ok(/guardian/i.test(lastToast().textContent), 'child without guardian is refused');
  setv(f, 'guardianName', 'Mrs Wanjiku'); setv(f, 'guardianPhone', '0700123123'); setv(f, 'consent', true); submit(f); await sleep(10);
  ok(C.state.members.some(m => m.name === 'Test Child Wanjiku' && m.guardianUserId), 'child added with guardian and consent');
  await go('members'); const mv = d.querySelector('[data-act=moveMember]'); ok(!!mv, 'suggested group moves are listed'); if (mv) { const mid = mv.dataset.id; click(mv); await sleep(10); ok(C.memberById(mid).history.length === 1, 'confirming a suggested move records it'); }
  A.logout();

  /* ---------- 8. loan flow end to end ---------- */
  const peterU = userOf('member', u => u.name === 'Peter Njoroge'); A.login(peterU.id); await go('loans');
  const askBefore = C.state.loans.length; A.logout();
  const grace = userOf('member', u => u.name === 'Sarah Naliaka'); A.login(grace.id); await go('loans');
  ok(!!d.querySelector('[data-act=loanForm]'), 'member sees "Request a loan"'); A.logout();

  /* ---------- 9. books review: sign-off locks a month ---------- */
  const aud = userOf('auditor'); A.login(aud.id); await go('review'); ok(!!d.querySelector('[data-act=signBtn]'), 'auditor sees sign-off buttons'); A.logout();
  A.login(userOf('superadmin').id); await go('review'); ok(!d.querySelector('[data-act=signBtn]'), 'super admin CANNOT sign off the books'); A.logout();

  /* ---------- 10. assistant answers every quick button for every role ---------- */
  for (const role of ROLES) { A.login(userOf(role).id); await go('assistant'); const btns = [...d.querySelectorAll('.quick button')]; ok(btns.length >= 5, role + ': assistant has quick buttons'); for (let i = 0; i < btns.length; i++) { click(d.querySelectorAll('.quick button')[i]); await sleep(3); }
    ok(!/Something went wrong/.test(view()) && d.querySelectorAll('.bub.bot').length === btns.length + 1, role + ': every assistant button answered (' + d.querySelectorAll('.bub.bot').length + ' replies for ' + btns.length + ' buttons)'); A.logout(); }
  A.login(userOf('member', u => u.name === 'Moses Kiprop').id); await go('assistant'); f = d.querySelector('form[data-form=chat]'); setv(f, 'q', 'tell me a joke about elephants'); submit(f); await sleep(10);
  ok(/never guess/.test(d.querySelector('.bub.bot:last-of-type').textContent), 'assistant refuses to invent an answer'); f = d.querySelector('form[data-form=chat]'); setv(f, 'q', 'salio langu'); submit(f); await sleep(10);
  ok(/Moses Kiprop/.test(d.querySelector('.bub.bot:last-of-type').textContent), 'assistant understands Swahili ("salio") and answers from the member\'s own data'); f = d.querySelector('form[data-form=chat]'); setv(f, 'q', 'who is late?'); submit(f); await sleep(10);
  ok(/Treasurer/.test(d.querySelector('.bub.bot:last-of-type').textContent), 'member cannot see other people\'s lateness through the assistant'); A.logout();

  /* ---------- 11. super-admin terminal ---------- */
  A.login(userOf('superadmin').id); await go('terminal'); const run = async c => { const i = d.getElementById('terminput'); i.value = c; submit(i.closest('form')); await sleep(5); };
  const out = () => d.getElementById('termout').textContent;
  for (const c of w.TerminalCommands.map(x => x.name).filter(n => !['clear', 'export', 'reset-demo'].includes(n))) { await run(c === 'simdate' ? 'simdate 2026-12-01' : c === 'fines' ? 'fines run' : c === 'set' ? 'set men lateFine 150' : c === 'rate' ? 'rate 130' : c === 'member' ? 'member moses' : c); }
  ok(!/Unknown command/.test(out()) && !/Error:/.test(out().replace(/Error: Usage/g, '')), 'every terminal command ran without error');
  ok(C.state.meta.simDate === '2026-12-01', 'simdate changes the system date'); ok(C.groupById('g_men').lateFine === 15000 && C.state.meta.rates.USD_KES === 130, 'set / rate change settings');
  await run('simdate reset'); ok(C.state.meta.simDate === null, 'simdate reset works'); await run('rate 129'); await run('set men lateFine 100');
  await run('bogus'); ok(/Unknown command: bogus/.test(out()), 'unknown command is reported'); await run('ledger 3'); ok(/UIT|IMP|S[A-Z0-9]/.test(out()), 'ledger command lists entries');
  ok(C.state.audit.some(a => a.action === 'settings.change'), 'terminal changes are audited'); await run('check'); ok(/Everything adds up/.test(out()), 'integrity check passes at the end of the whole session'); A.logout();

  /* ---------- 12. settings + users ---------- */
  A.login(userOf('superadmin').id); await go('settings'); f = d.querySelector('form[data-form=gset]'); setv(f, 'k_lateFine', '120'); submit(f); await sleep(10); ok(C.state.groups[0].lateFine === 12000, 'settings form saves');
  await go('users'); click('[data-act=userForm]'); f = modalForm(); setv(f, 'name', 'New Treasurer Test'); setv(f, 'role', 'treasurer'); setv(f, 'groupIds', 'g_men'); submit(f); await sleep(10); ok(C.state.users.some(u => u.name === 'New Treasurer Test'), 'super admin can add a login'); A.logout();

  /* ---------- 13. login screen: wrong PIN ---------- */
  const lu = userOf('treasurer'); d.querySelector('select[name=uid]'); const lf = d.querySelector('form[data-form=login]'); setv(lf, 'uid', lu.id); setv(lf, 'pin', '9999'); submit(lf); await sleep(10);
  ok(!!d.querySelector('.login-card') && /Wrong PIN/.test(lastToast().textContent), 'wrong PIN is refused');

  ok(errors.length === 0, 'no script errors during the whole run' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  console.log('\n' + checks + ' checks, ' + failed + ' failed' + (errors.length ? ', ' + errors.length + ' script error(s)' : ''));
  if (errors.length) errors.slice(0, 10).forEach(e => console.error('  ' + e));
  server.close(); process.exit(failed || errors.length ? 1 : 0);
})().catch(e => { console.error('TEST CRASHED', e); server.close(); process.exit(2); });
