/* =====================================================================
   ui.js — app shell: session, router, layout, modal/toast helpers,
   event delegation. Views register themselves on App.routes.
   ===================================================================== */
(function () {
'use strict';
const C = window.Chama;
const App = window.App = { user: null, routes: {}, acts: {}, forms: {}, inputs: {}, f: {}, installEvt: null, last: '' };

/* ------------------------------------------------------------ small helpers */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dfmt = s => { if (!s) return '—'; const d = C.parse(s.slice(0, 10)); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); };
const pfmt = p => { const [y, m] = p.split('-'); return MONTHS[+m - 1] + ' ' + y; };
const ROLE_LABEL = { superadmin: 'Super admin (Tech)', bishop: 'Bishop (Chair)', secretary: 'Secretary', treasurer: 'Treasurer', auditor: 'Auditor / Trustee', member: 'Member', parent: 'Parent / Guardian' };
const STATUS = {
  paid: ['ok', 'Paid'], partial: ['warn', 'Partial'], pending: ['info', 'Due soon'], grace: ['warn', 'Grace period'], late: ['bad', 'Late'], upcoming: ['muted', 'Upcoming'], none: ['muted', 'n/a'],
  open: ['bad', 'Open'], waived: ['muted', 'Waived'], requested: ['info', 'Requested'], approved: ['warn', 'Approved'], active: ['ok', 'Active'], cleared: ['muted', 'Cleared'],
  rejected: ['bad', 'Rejected'], signed: ['ok', 'Signed off'], confirmed: ['ok', 'Confirmed']
};
const chip = s => { const [c, l] = STATUS[s] || ['muted', s]; return '<span class="chip ' + c + '">' + esc(l) + '</span>'; };
const field = (label, inner, hint) => '<label class="f"><span>' + label + '</span>' + inner + (hint ? '<small>' + hint + '</small>' : '') + '</label>';
const select = (name, opts, sel, attrs) => '<select name="' + name + '" ' + (attrs || '') + '>' + opts.map(o => '<option value="' + esc(o.v) + '"' + (String(o.v) === String(sel) ? ' selected' : '') + '>' + esc(o.l) + '</option>').join('') + '</select>';
const kpi = (label, value, sub, cls) => '<div class="kpi ' + (cls || '') + '"><div class="kpi-l">' + esc(label) + '</div><div class="kpi-v">' + value + '</div>' + (sub ? '<div class="kpi-s">' + sub + '</div>' : '') + '</div>';
const table = (heads, rows, cls) => '<div class="tw"><table class="' + (cls || '') + '"><thead><tr>' + heads.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + (rows.length ? rows.join('') : '<tr><td colspan="' + heads.length + '" class="empty">Nothing here yet.</td></tr>') + '</tbody></table></div>';
const bar = (pct, cls) => '<div class="bar"><i class="' + (cls || '') + '" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div>';
const card = (title, body, actions, cls) => '<section class="card ' + (cls || '') + '"><div class="card-h"><h3>' + title + '</h3><div class="card-a">' + (actions || '') + '</div></div>' + body + '</section>';
const empty = t => '<p class="empty">' + t + '</p>';
const initials = n => n.split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();
function formData(form) {
  const o = {};
  new FormData(form).forEach((v, k) => { o[k] = o[k] !== undefined ? [].concat(o[k], v) : v; });
  form.querySelectorAll('input[type=checkbox]').forEach(cb => { if (!cb.name) return; if (cb.value && cb.value !== 'on') return; o[cb.name] = cb.checked; });
  return o;
}
function download(name, text, mime) {
  const b = new Blob([text], { type: mime || 'text/plain' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function toast(msg, type) {
  const root = document.getElementById('toast-root'); if (!root) return;
  const t = document.createElement('div'); t.className = 'toast ' + (type || 'ok'); t.textContent = msg; root.appendChild(t);
  setTimeout(() => t.classList.add('out'), type === 'bad' ? 6000 : 3500); setTimeout(() => t.remove(), type === 'bad' ? 6500 : 4000);
}
function modal(title, html, opts) {
  opts = opts || {};
  document.getElementById('modal-root').innerHTML = '<div class="modal-back"><div class="modal ' + (opts.wide ? 'wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="modal-h"><h3>' + esc(title) + '</h3><button class="icon-btn" data-act="closeModal" aria-label="Close">✕</button></div><div class="modal-b">' + html + '</div></div></div>';
  const first = document.querySelector('#modal-root input:not([type=hidden]), #modal-root select, #modal-root textarea'); if (first && !opts.noFocus) first.focus();
}
const closeModal = () => { document.getElementById('modal-root').innerHTML = ''; };
const today = () => C.today();
const curPeriod = () => { const ps = C.curPeriods(today()); return ps[ps.length - 1] || C.fyPeriods(C.fyState(today()).fy)[0]; };
const visibleGroups = () => C.scopeGroupIds(App.user).map(C.groupById).filter(Boolean);
const gname = id => (C.groupById(id) || { name: id }).name;
const mname = id => (C.memberById(id) || { name: '?' }).name;
const optGroups = (gs, withAll) => (withAll ? [{ v: 'all', l: 'All groups' }] : []).concat(gs.map(g => ({ v: g.id, l: g.name })));
const optPeriods = () => C.fyPeriods(C.fyState(today()).fy).filter(p => p <= C.addMonths(curPeriod(), 0)).map(p => ({ v: p, l: pfmt(p) }));

Object.assign(App, { esc, dfmt, pfmt, ROLE_LABEL, chip, field, select, kpi, table, bar, card, empty, initials, formData, download, toast, modal, closeModal, today, curPeriod, visibleGroups, gname, mname, optGroups, optPeriods, money: C.money });

/* ------------------------------------------------------------------ session */
function loadSession() {
  try { const id = sessionStorage.getItem('chama_uid'); if (id) { const u = C.userById(id); if (u && u.active !== false) App.user = u; } } catch (e) {}
}
App.login = function (uid) {
  const u = C.userById(uid); App.user = u; try { sessionStorage.setItem('chama_uid', uid); } catch (e) {}
  C.runFines(C.today(), null);   // apply any late fines that have fallen due (a server job does this in production)
  C.log(u, 'login', ROLE_LABEL[u.role]); C.save(); location.hash = '#/dashboard'; App.render();
};
App.logout = function () { if (App.user) { C.log(App.user, 'logout', ''); C.save(); } App.user = null; try { sessionStorage.removeItem('chama_uid'); } catch (e) {} location.hash = ''; App.render(); };

/* ------------------------------------------------------------------- router */
const NAV = [
  ['dashboard', 'Home', '🏠'], ['members', 'Members', '👥'], ['contributions', 'Contributions', '💰'], ['mgr', 'Merry-go-round', '🔄'],
  ['loans', 'Loans', '🏦'], ['import', 'Import statement', '📥'], ['meetings', 'Meetings', '📅'], ['reports', 'Reports', '📊'],
  ['review', 'Books review', '✅'], ['messages', 'Messages', '✉️'], ['audit', 'Audit log', '🧾'], ['users', 'Users & roles', '🔑'],
  ['settings', 'Settings', '⚙️'], ['terminal', 'Terminal', '⌨️'], ['statement', 'Statement', '📄'], ['assistant', 'Assistant', '💬'], ['help', 'Install & help', '❓']
];
function route() { const h = (location.hash || '#/dashboard').replace(/^#\/?/, '').split('/'); return { name: h[0] || 'dashboard', param: decodeURIComponent(h[1] || '') }; }
App.go = (name, param) => { location.hash = '#/' + name + (param ? '/' + encodeURIComponent(param) : ''); };
const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

function loginView() {
  const role = App.f.loginRole || 'treasurer';
  const users = C.state.users.filter(u => u.role === role && u.active !== false);
  const pills = ['superadmin', 'bishop', 'secretary', 'treasurer', 'auditor', 'member', 'parent'].map(r => '<button type="button" class="pill ' + (r === role ? 'on' : '') + '" data-act="loginRole" data-role="' + r + '">' + ROLE_LABEL[r] + '</button>').join('');
  return '<div class="login"><div class="login-card"><div class="brand big"><span class="logo">✚</span><div><b>Chama</b><small>Church savings groups</small></div></div>' +
    '<h1>Sign in</h1><p class="muted">Demo mode: pick a role, pick a person and use PIN <b>1234</b>. Real sign-in (phone + OTP) replaces this when the Supabase backend is connected.</p>' +
    '<div class="pills">' + pills + '</div>' +
    '<form data-form="login" class="stack">' + field('Person', select('uid', users.map(u => ({ v: u.id, l: u.name })), users[0] && users[0].id)) + field('PIN', '<input name="pin" type="password" inputmode="numeric" autocomplete="off" value="1234" required>') +
    '<button class="btn primary lg" type="submit">Sign in</button></form>' +
    '<p class="small muted">Data in this demo is stored only on this device.</p></div></div>';
}

function shell(name, r, body) {
  const u = App.user;
  const items = NAV.filter(n => { const rt = App.routes[n[0]]; return rt && rt.roles.includes(u.role) && (!rt.nav || rt.nav(u)); });
  const sim = C.state.meta.simDate ? '<div class="banner warn">Simulated date is on: <b>' + dfmt(C.state.meta.simDate) + '</b>. Use the terminal (<code>simdate reset</code>) to return to today.</div>' : '';
  const install = isStandalone() ? '' : '<button class="btn sm" data-act="install" title="Install on this device">⬇ Install</button>';
  return '<div class="shell"><aside class="side" id="side"><div class="brand"><span class="logo">✚</span><div><b>Chama</b><small>' + esc(ROLE_LABEL[u.role]) + '</small></div></div>' +
    '<nav>' + items.map(n => '<a href="#/' + n[0] + '" class="nav ' + (n[0] === name ? 'on' : '') + '" data-act="closeNav"><span>' + n[2] + '</span>' + n[1] + '</a>').join('') + '</nav>' +
    '<div class="side-f"><div class="me"><span class="av">' + esc(initials(u.name)) + '</span><div><b>' + esc(u.name) + '</b><small>' + esc(ROLE_LABEL[u.role]) + '</small></div></div><button class="btn ghost sm" data-act="logout">Sign out</button></div></aside>' +
    '<div class="scrim" data-act="closeNav"></div>' +
    '<div class="main"><header class="top"><button class="icon-btn burger" data-act="toggleNav" aria-label="Menu">☰</button><h2>' + esc(r.title) + '</h2><div class="top-r"><span class="net" id="net" title="Connection"></span>' + install + '</div></header>' +
    sim + '<main class="view" id="view">' + body + '</main><footer class="foot">Crafted &amp; polished by TEVINTECH · demo data stored on this device</footer></div></div>';
}

App.render = function () {
  const root = document.getElementById('app');
  if (!App.user) { root.innerHTML = loginView(); document.title = 'Sign in — Chama'; return; }
  let { name, param } = route(); let r = App.routes[name];
  if (!r || !r.roles.includes(App.user.role)) { name = 'dashboard'; r = App.routes.dashboard; }
  let body; try { body = r.render(param); } catch (e) { console.error(e); body = '<div class="card"><h3>Something went wrong</h3><p>' + esc(e.message) + '</p></div>'; }
  root.innerHTML = shell(name, r, body); document.title = r.title + ' — Chama';
  if (r.after) { try { r.after(param); } catch (e) { console.error(e); } }
  App.updateNet();
};
App.refresh = function () { const y = window.scrollY; App.render(); window.scrollTo(0, y); };
App.updateNet = () => { const n = document.getElementById('net'); if (n) { n.className = 'net ' + (navigator.onLine ? 'on' : 'off'); n.textContent = navigator.onLine ? 'Online' : 'Offline'; } };

/* ------------------------------------------------------------- shared actions */
Object.assign(App.acts, {
  closeModal, toggleNav() { document.body.classList.toggle('nav-open'); }, closeNav() { document.body.classList.remove('nav-open'); },
  logout() { App.logout(); },
  loginRole(el) { App.f.loginRole = el.dataset.role; App.render(); },
  install() {
    if (App.installEvt) { App.installEvt.prompt(); App.installEvt.userChoice.finally(() => { App.installEvt = null; App.render(); }); }
    else App.go('help', 'install');
  },
  print() { window.print(); }
});
App.forms.login = (f, d) => {
  const u = C.userById(d.uid); if (!u) throw new Error('Choose a person.');
  if (String(d.pin) !== String(u.pin)) throw new Error('Wrong PIN.');
  App.login(u.id);
};

/* ----------------------------------------------------------- event delegation */
function run(fn, quiet) { try { return fn(); } catch (e) { if (!quiet) toast(e.message || String(e), 'bad'); else console.warn(e); } }
document.addEventListener('click', e => {
  if (e.target.classList && e.target.classList.contains('modal-back')) { closeModal(); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = App.acts[el.dataset.act]; if (!fn) return;
  /* FIX: links that point to a route (#/something) must be allowed to navigate.
     Before, every <a data-act> had its default prevented, so sidebar links did nothing. */
  const href = el.getAttribute('href') || '';
  const isRouteLink = el.tagName === 'A' && href.indexOf('#/') === 0;
  if (!isRouteLink && (el.tagName === 'A' || el.type === 'submit' || el.tagName === 'BUTTON')) e.preventDefault();
  if (el.dataset.confirm && !window.confirm(el.dataset.confirm)) { if (isRouteLink) e.preventDefault(); return; }
  run(() => fn(el, e));
});
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault();
  const fn = App.forms[f.dataset.form]; if (fn) run(() => fn(f, formData(f)));
});
['input', 'change'].forEach(ev => document.addEventListener(ev, e => {
  const el = e.target.closest('[data-live]'); if (!el) return;
  if (ev === 'change' && el.type === 'text') return;
  const fn = App.inputs[el.dataset.live]; if (fn) run(() => fn(el, e), true);
}));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); document.body.classList.remove('nav-open'); } });
window.addEventListener('hashchange', () => { document.body.classList.remove('nav-open'); App.render(); window.scrollTo(0, 0); });
window.addEventListener('online', App.updateNet); window.addEventListener('offline', App.updateNet);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); App.installEvt = e; if (App.user) App.render(); });
window.addEventListener('appinstalled', () => { App.installEvt = null; toast('Installed. Open Chama from your home screen or app list.'); App.render(); });

App.start = function () {
  C.load(); loadSession();
  if (App.user) { C.runFines(C.today(), null); }
  App.render();
};
})();