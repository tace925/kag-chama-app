# Chama — Frontend Documentation

Church savings groups (merry-go-round + table banking) as an **installable web app**.
Built by TEVINTECH · plain HTML, CSS and JavaScript, no build step.

> **Status in one line:** a complete, working, tested **frontend with a local demo backend** (data lives in the browser). The rules, screens, roles, assistant, terminal and install support are real. Sign-in, SMS, real M-Pesa/card payments and a shared database are **not connected yet**; section 13 shows how to connect them.

---

## Contents

1. [What this is and what it is not](#1-what-this-is-and-what-it-is-not)
2. [Quick start](#2-quick-start)
3. [Project structure](#3-project-structure)
4. [Architecture](#4-architecture)
5. [Business rules as built](#5-business-rules-as-built)
6. [Roles and permissions](#6-roles-and-permissions)
7. [Screens](#7-screens)
8. [The Assistant (chatbot)](#8-the-assistant-chatbot)
9. [The super-admin terminal](#9-the-super-admin-terminal)
10. [Install on a device (PWA)](#10-install-on-a-device-pwa)
11. [Data model](#11-data-model)
12. [Testing](#12-testing)
13. [Moving to production (Supabase, M-Pesa, SMS)](#13-moving-to-production)
14. [Security and privacy](#14-security-and-privacy)
15. [Recommended suggestions](#15-recommended-suggestions)
16. [Known limitations](#16-known-limitations)
17. [Decisions only you can make](#17-decisions-only-you-can-make)
18. [Troubleshooting](#18-troubleshooting)

---

## 1. What this is and what it is not

**It is:** a responsive web app (phone, tablet, desktop) for church groups. Seven kinds of user sign in and see different screens. It records contributions, fines, merry-go-round payouts and internal loans, produces reports, lets auditors sign off and lock each month, and includes an assistant and (for the super admin) a terminal. It can be installed on a device and opens offline.

**It is not (yet):**
- Connected to a real server. All data is stored in the browser's `localStorage` on one device.
- A payment processor. It *records* payments (M-Pesa, cash, card, bank). It does not move money.
- Sending real SMS. Messages are stored and shown in-app, labelled *simulated*.
- Reading Excel, PDF or Word files directly. It reads **CSV, TSV and pasted text** (see section 16).

**Design rules that run through everything**
1. **Money is always whole cents** (KSh 1 = 100). No floating-point money.
2. **All calculations are ordinary code** in `core.js`. The assistant never invents numbers.
3. **Nothing in the money ledger is deleted.** Mistakes are fixed by a reversal entry.
4. **Separation of duties.** The person who records money cannot approve their own loan, the super admin cannot touch money, only auditors sign off.
5. **Every change is audited** with who, when and what.
6. **A signed-off month is locked.**

---

## 2. Quick start

Open the folder in a terminal and serve it (the service worker and install need `http://localhost` or `https`, not a `file://` path).

```powershell
# Windows PowerShell, inside the chama-app folder
python -m http.server 8080
# or
npx serve .
```

Then open `http://localhost:8080`.

**Demo sign-in:** pick a role, pick a person, PIN **1234**. Demo data is created on first load (4 groups, 24 members, contributions from January to today, fines, 3 loans, meetings). *Settings → Reset demo data* starts again.

**Deploy:** drag the whole folder onto <https://app.netlify.com/drop>, or `netlify deploy --prod --dir .`. Netlify serves `https`, which makes **Install** work.

> Note on `rm -rf`: that is a Linux/macOS command. In PowerShell use `Remove-Item -Recurse -Force <folder>`. This app has no `.next` or build folder, so it never needs it.

---

## 3. Project structure

| File | Lines | Purpose |
|---|---:|---|
| `index.html` | 31 | Page shell and script list |
| `manifest.webmanifest` | 24 | Install metadata (name, icons, colours) |
| `sw.js` | 18 | Service worker: offline cache |
| `css/styles.css` | 125 | All styles, light/dark, print |
| `js/core.js` | 966 | Engine: data, rules, calculations, permissions, demo data |
| `js/ui.js` | 170 | Shell: login, router, layout, modals, event delegation |
| `js/views1.js` | 272 | Home, Members, Contributions, Merry-go-round, Loans |
| `js/views2.js` | 233 | Import, Meetings, Reports, Books review, Messages, Audit, Users, Settings, Statement, Help |
| `js/chatbot.js` | 112 | Assistant |
| `js/terminal.js` | 80 | Super-admin terminal |
| `js/boot.js` | 9 | Start-up + service worker registration |
| `tests/core.test.js` | 208 | Engine tests (Node) |
| `tests/ui.smoke.test.js` | 161 | Browser test (jsdom) |
| `icons/` | — | `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` |
| `docs/FRONTEND.md` | — | This document |

**Script load order matters** (see the bottom of `index.html`): `core` → `ui` → `views1` → `views2` → `chatbot` → `terminal` → `boot`.

---

## 4. Architecture

```
index.html ──loads──▶ core.js        rules, calculations, permissions, storage (no DOM)
                      ui.js          session, router, layout, modal/toast, event delegation
                      views1.js      Home, Members, Contributions, Merry-go-round, Loans
                      views2.js      Import, Meetings, Reports, Books review, Messages, Audit,
                                     Users, Settings, Statement, Help
                      chatbot.js     Assistant
                      terminal.js    Super-admin terminal
                      boot.js        start + service worker registration
```

**`core.js` (the engine).** Exposed as `window.Chama` (and `module.exports` for Node tests). It has 101 public functions. It has **no DOM code**, so the same rules can be unit-tested in Node and later moved to the server. Every function that changes data takes `actor` (the signed-in user) as its first argument and checks permission itself, so the UI cannot bypass the rules.

**`ui.js` (the shell).** `window.App` holds the current user, the route table (`App.routes`), shared state for filters (`App.f`) and three registries used by event delegation:

| Registry | HTML attribute | Fires on | Example |
|---|---|---|---|
| `App.acts` | `data-act="name"` | click | `<button data-act="payForm" data-id="…">` |
| `App.forms` | `data-form="name"` | submit | `<form data-form="recordPay">` |
| `App.inputs` | `data-live="name"` | input / change | live preview while typing |

A single listener on `document` dispatches all three. Errors thrown by the engine (for example “USD can only be received by card”) are caught in one place and shown as a red toast. Views therefore contain **no try/catch**.

**Routing.** Hash routes: `#/contributions`, `#/statement/<memberId>`. A route is registered like this:

```js
App.routes.reports = {
  title: 'Reports',
  roles: ['superadmin', 'bishop', 'treasurer', 'auditor'],   // who may open it (also controls the menu)
  render(param) { return '<div class="card">…</div>'; },     // returns an HTML string
  after(param)  { /* optional: focus, scroll */ },
  nav: user => true                                          // optional: hide from the menu
};
```

If a user opens a route their role does not allow, they are sent Home. There are 17 routes, 46 click actions and 21 forms.

**Rendering.** Each render builds an HTML string and sets `innerHTML`. All user-supplied text goes through `esc()`. The shell is rebuilt on every route change or `App.refresh()` (scroll position is preserved).

**Adding a screen** (5 steps): (1) write `App.routes.x = {…}`; (2) add `['x','Label','🔹']` to `NAV` in `ui.js`; (3) add click/form handlers to `App.acts` / `App.forms`; (4) call engine functions, never touch `Chama.state` directly for writes; (5) add a line to the smoke test.

**Styling.** One file, `css/styles.css`. CSS variables at the top define colours; a dark theme follows the device setting. Mobile first: under 900 px the sidebar becomes a drawer (☰). Tables scroll sideways inside their card. Print styles hide the chrome so any report prints cleanly or saves as PDF.

**Accessibility.** Labels on every field, visible focus rings, `aria-live` on toasts and chat, modal has `role="dialog"`, Escape closes dialogs, touch targets are at least 40 px, motion is reduced when the device asks.

**Storage.** `localStorage` key `chama_app_v1`. Session (who is signed in) is `sessionStorage`. Both are wrapped in try/catch and fall back to memory (private windows). *Settings → Download backup* exports everything as JSON.

---

## 5. Business rules as built

### 5.1 Groups

| Group | Who | Does | Monthly | Table-banking savings | Late fine | Joining fee |
|---|---|---|---:|---:|---:|---:|
| Sunday School | Ages 10–19 | Merry-go-round | KSh 200 | — | KSh 50 | KSh 200 |
| Youth | Ages 20–30, unmarried | Merry-go-round + Table banking | KSh 500 | KSh 200 | KSh 100 | KSh 200 |
| Men | Men: everyone else (31+, or married) | Merry-go-round + Table banking | KSh 1000 | KSh 500 | KSh 100 | KSh 200 |
| Women | Women: everyone else (31+, or married) | Merry-go-round + Table banking | KSh 1000 | KSh 500 | KSh 100 | KSh 200 |

*Monthly amounts for the four groups (200 / 500 / 1,000 / 1,000) and the KSh 200 joining fee are **yours**. The **table-banking savings column and the fine amounts are my placeholders** — see section 17.* Every value is a setting (Settings screen or terminal `set`), not hard-coded.

**Placement** (`Chama.placement`): age 10–19 → Sunday School; 20–30 **and unmarried** → Youth; everyone else → Men or Women by sex. So an unmarried person over 30 and a married person under 30 both go to Men/Women. Under 10 is refused.

**Group moves.** `suggestMoves()` compares each member's current group with the placement rule (age turns 20 or 31, or marriage recorded by the secretary). The Members screen lists them; the secretary or the group's treasurer confirms. The move takes effect **the 1st of next month**. Savings and loans carry over. The old group keeps its history. In the new group the member joins the **end of the merry-go-round order**; if they had already received this round they are marked as received so they cannot receive twice. If the new group has table banking and the old one did not (Sunday School → Youth), table-banking savings start next month. The member is messaged.

### 5.2 Financial year and due dates

- Year runs **2 Jan → 2 Dec**. 3 Dec → 1 Jan is the **closing window** (books closed, interest shared).
- Contributions fall due on the **10th** of each month, January to November (**11 periods**).
- **Grace period:** 3 days. Status is *Upcoming → Due soon → Grace period → Late* (late from the 14th).
- A member who joins on or before the 10th owes that month; after the 10th, from next month.

### 5.3 Fines

- **Late contribution fine:** created once per member per month by `runFines()`, after the grace period. It runs on every sign-in and with the terminal command `fines run`. In production it is a scheduled server job.
- **Missed meeting fine:** created when the secretary marks someone **Absent** (use **Excused** to avoid it).
- **Late loan instalment penalty:** a percentage of the overdue amount, once per instalment.
- Only the treasurer can **waive** a fine, with a written reason. Waivers appear in the auditors' checks.

### 5.4 Where a payment goes (allocation)

When a treasurer saves a payment with “Allocate automatically”, the engine splits it in this order:

1. Joining fee, if owed.
2. Contributions for the current and earlier months, oldest first (merry-go-round part, then table-banking savings).
3. Open fines.
4. Contributions for later months in the same year.
5. Anything left is **Unallocated**, flagged in the books review.

The treasurer sees this split live before saving. Under-18 payments are recorded **under the child**, with the parent's name in *Paid by*.

### 5.5 Currency

KSh is the base. **USD** is accepted only via **Card, Bank transfer or International**. M-Pesa and cash are KSh only (the form refuses USD there). The system converts at the rate in *Settings* and stores, with each payment, the **original USD amount, the rate and the KSh value**, so totals can always be re-checked. In production the rate should come from the payment provider so the books match the money actually received.

### 5.6 Merry-go-round

- Each month the **whole pot** (all merry-go-round contributions of that month) goes to one member.
- The secretary **draws the order** by lots (cryptographic randomness) before the first payout of a round.
- The treasurer **pays out**. If the recipient has arrears the app asks for confirmation; **Skip next** moves them to the end.
- One payout per month. When everyone has received, the round number goes up and a new draw is needed.
- Sunday School has merry-go-round only.

### 5.7 Table banking (internal loans)

Defaults for the three adult groups (change in Settings):

| Setting | Value |
|---|---|
| `multiple` | 3 |
| `ratePct` | 10 |
| `maxMonths` | 6 |
| `minMonths` | 3 |
| `guarantors` | 2 |
| `approvalLimit` | KSh 15000 |
| `penaltyPct` | 5 |
| `maxActive` | 1 |

**Rules:** the group does table banking; member for at least `minMonths`; no overdue contributions; no unpaid fines; no other open loan (`maxActive`); amount ≤ `multiple` × table-banking savings minus loans already held; term 1–`maxMonths`; exactly `guarantors` different members of the same group.

**Flow:** member requests → guarantors confirm (they are messaged) → **secretary or Bishop approves** (loans above `approvalLimit` need the **Bishop**) → **treasurer disburses** → schedule is created → repayments recorded. Nobody can approve or disburse their own loan.

**Maths:** principal is split into equal monthly parts (remainder on the last), **interest = `ratePct` % of the remaining balance each month** (reducing balance). Repayments pay interest first, then principal, instalment by instalment. Reversing a repayment restores the schedule.

### 5.8 Meetings

Every Saturday. The secretary schedules a meeting for one group or all, marks it **Online** or **Physical**, adds the link or venue, and members are messaged. Attendance and minutes are recorded afterwards.

### 5.9 Books review and locking

The auditor opens a group and month and sees automatic checks: cash matches the M-Pesa/bank balance (from the treasurer's **Check cash**), no unallocated money, reversals and waived fines listed, late members. Then **Sign off & lock** or **Send back** with a comment. A locked month rejects new payments, reversals, waivers and payouts for that group and month. Bishop and super admin can read the review but **cannot sign off**.

### 5.10 Year-end shares

Pool = **loan interest paid + fines paid** in the year. Each member's weight = their cumulative table-banking savings summed month by month (savings × months held). Share = pool × weight ÷ total weight, in whole cents; leftover cents go to the largest weights so shares **always add up exactly** to the pool (tested). Shown on *Reports → Year-end shares* as a preview until the year closes.

### 5.11 Children and consent

Under 18: a **guardian name, phone and consent tick** are required. The guardian automatically gets a **Parent** login (several children can be linked to one parent). The parent pays, the child's account holds the money, and messages go to the parent. From 18 a member can use their own login (the super admin links it). *Have the consent wording checked against the Kenya Data Protection Act.*

---

## 6. Roles and permissions

| Permission | Super admin | Bishop | Secretary | Treasurer | Auditor | Member | Parent |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| View member register (`members.view`) | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| Add / edit members (`members.edit`) | ✓ |  | ✓ |  |  |  |  |
| Move members between groups (`members.move`) |  |  | ✓ | ✓ |  |  |  |
| See money (balances, ledger, cash) (`money.view`) | ✓ | ✓ |  | ✓ | ✓ |  |  |
| Record payments, reconcile cash (`payments.record`) |  |  |  | ✓ |  |  |  |
| Reverse a payment (`payments.reverse`) |  |  |  | ✓ |  |  |  |
| Waive a fine (`fines.waive`) |  |  |  | ✓ |  |  |  |
| See loans (`loans.view`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Approve / reject loans (`loans.approve`) |  | ✓ | ✓ |  |  |  |  |
| Disburse loans (`loans.disburse`) |  |  |  | ✓ |  |  |  |
| Draw the merry-go-round order (`mgr.draw`) |  |  | ✓ |  |  |  |  |
| Pay out / skip merry-go-round (`mgr.payout`) |  |  |  | ✓ |  |  |  |
| Schedule meetings, attendance, minutes (`meetings.manage`) |  |  | ✓ |  |  |  |  |
| Send messages and reminders (`messages.send`) |  |  | ✓ | ✓ |  |  |  |
| Sign off / send back monthly books (`review.signoff`) |  |  |  |  | ✓ |  |  |
| Books review screen (`review.view`) | ✓ | ✓ |  |  | ✓ |  |  |
| Change group settings and USD rate (`settings.edit`) | ✓ |  |  |  |  |  |  |
| Terminal (`terminal`) | ✓ |  |  |  |  |  |  |
| Audit log (`audit.view`) | ✓ | ✓ |  |  | ✓ |  |  |
| Create logins, reset PINs (`users.manage`) | ✓ |  |  |  |  |  |  |
| Reports (`reports.view`) | ✓ | ✓ |  | ✓ | ✓ |  |  |
| Import statements (`import`) |  |  |  | ✓ |  |  |  |
| Confirm / reject member payment claims (`claims.review`) |  |  |  | ✓ |  |  |  |
| Submit “I have paid” claims (`claims.submit`) |  |  |  |  |  | ✓ | ✓ |

The matrix above is generated from `Chama.PERMS`, the single source of truth. Rules not visible in a matrix:

- **Group scope.** A treasurer only touches their own group. A member sees only themselves; a parent only their children.
- **No self-approval.** A person cannot approve or disburse a loan to themselves.
- **Super admin cannot touch money** and cannot sign off. It can see everything, manage logins and settings, and use the terminal. It can read finances but has no way to change them.
- **Audit log is append-only** and cannot be edited from the UI or the terminal.

**Menu per role**

| Role | Menu items |
|---|---|
| Super admin | Home, Members, Contributions, Merry-go-round, Loans, Meetings, Reports, Books review, Messages, Audit log, Users & roles, Settings, Terminal, Assistant, Install & help |
| Bishop | Home, Members, Contributions, Merry-go-round, Loans, Meetings, Reports, Books review, Messages, Audit log, Assistant, Install & help |
| Secretary | Home, Members, Contributions, Merry-go-round, Loans, Meetings, Messages, Assistant, Install & help |
| Treasurer | Home, Members, Contributions, Merry-go-round, Loans, Import statement, Meetings, Reports, Messages, Assistant, Install & help |
| Auditor | Home, Members, Contributions, Merry-go-round, Loans, Meetings, Reports, Books review, Messages, Audit log, Assistant, Install & help |
| Member | Home, Contributions, Merry-go-round, Loans, Meetings, Messages, Statement, Assistant, Install & help |
| Parent | Home, Contributions, Merry-go-round, Loans, Meetings, Messages, Statement, Assistant, Install & help |

---

## 7. Screens

| Screen | Route | What it does |
|---|---|---|
| **Sign in** | (none) | Pick role → person → PIN. Demo only; see §13 for real sign-in. |
| **Home** | `#/dashboard` | Members: their accounts, status this month, next meeting, messages, guarantor requests. Staff: *Needs attention* list, one card per group with collected vs due, late count, cash, loans out, next recipient. |
| **Members** | `#/members` | Search/filter, member detail, add member (secretary) with live “will be placed in…” preview, edit phone/marital status, **suggested group moves**. |
| **Contributions** | `#/contributions` | Staff: month and group selector, who paid / short / late, **Record payment** (live allocation preview, USD conversion), **Check cash**, member claims to confirm, open fines (waive), recent entries (reverse). Members: monthly schedule, fines, **I have paid** form. |
| **Merry-go-round** | `#/mgr` | Round number, pot, order with Received / Next / Waiting, draw, pay out, skip. |
| **Loans** | `#/loans` | Members: request with live checks and repayment estimate, guarantor confirmations, own loans. Staff: waiting / approved / active / closed, approve, reject, disburse, full schedule. |
| **Import statement** | `#/import` | Treasurer. Add CSV/pasted statement → matches by phone and name → check → **choose a task** (record, total per member, who has not paid, summary, or type your own) → run. |
| **Meetings** | `#/meetings` | Upcoming and past, schedule, attendance and minutes. |
| **Reports** | `#/reports` | Monthly report, cash book, year-end shares. Print/PDF and CSV. |
| **Books review** | `#/review` | Checks, sign-off or send back, history of reviews. |
| **Messages** | `#/messages` | Members: their messages. Staff: log, send to a group, send payment reminders. |
| **Audit log** | `#/audit` | Searchable list of every change. |
| **Users & roles** | `#/users` | Add login, reset PIN, enable/disable. |
| **Settings** | `#/settings` | Per-group amounts, fines, due day, grace days, loan rules; USD rate; backup, restore, integrity check, reset. |
| **Terminal** | `#/terminal` | Super admin only (§9). |
| **Statement** | `#/statement/<id>` | A member's payments, savings running total, fines. Print/PDF, CSV. |
| **Assistant** | `#/assistant` | Chat with buttons (§8). |
| **Install & help** | `#/help` | Install steps per device, roles explained, quick answers. |

**The “document → question → options → text box” flow** from your original idea is the **Import statement** screen: *1 Add a document → 2 Check what we found → 3 What do you want to do with this data?* (preset tasks + a free-text box). The text box is answered by the same safe assistant described next, so it cannot make up numbers.

---

## 8. The Assistant (chatbot)

**Why a chatbot and not a terminal for members:** a typed-command terminal suits developers. Treasurers, parents and youth need buttons and plain questions.

**How it works** (`js/chatbot.js`)
1. The screen shows **quick buttons that depend on the role** (a member sees *My balance, What do I owe, My fines, My loan, Next meeting, Who receives next*; a treasurer sees *Who is late, Summary, Cash on hand, Fines owed, Loans, Needs attention…*).
2. Each button runs a **fixed function** that reads the engine and formats the answer.
3. The text box maps your words to one of those same functions using keyword rules (English **and** common Swahili: *salio, faini, mkopo, deni, mkutano, zamu, lipa…*). If nothing matches it says so and **never guesses a number**.
4. **Answers respect permissions.** A member asking “who is late?” is told that money records belong to the treasurer. A parent sees only their children.
5. A button switches the assistant's replies between **English and Kiswahili**.

*What it deliberately does not do:* free-form AI answers about money. If you later add a language model, use it only to **choose which fixed function to call** (and to explain results), and keep every figure coming from `core.js`.

---

## 9. The super-admin terminal

Only the super admin sees it (`#/terminal`). It looks like a command line, with history (↑ ↓), Tab completion and clickable shortcuts. It is **read-mostly by design**: it can inspect everything and run system jobs, but **it has no command to record, edit or delete money**, so the technical team cannot change the books. Every command that changes something (`set`, `rate`, `simdate`, and `fines run` when it creates fines) is written to the audit log.

| Command | What it does |
|---|---|
| `help [command]` | List commands, or help <command> |
| `clear` | Clear the screen |
| `whoami` | Show the signed-in user |
| `date` | Show today and the simulated date |
| `simdate <YYYY-MM-DD>` or `simdate reset` | Pretend today is another date, for testing fines and due dates |
| `groups` | List groups and their rules |
| `members [group]` | List members, optionally for one group |
| `member <part of name>` | Full detail for one member |
| `users` | List logins and roles |
| `balance [group]` | Cash on hand per group (system vs last reconciliation) |
| `ledger [count] [group]` | Latest ledger entries (read-only) |
| `audit [count] [text]` | Latest audit log entries |
| `moves` | Members who should change group |
| `loans` | All loans and their status |
| `signoffs` | Auditor sign-offs |
| `stats` | Counts of everything stored |
| `check` | Run the books integrity check |
| `fines run` | Apply late fines now: fines run |
| `rate [value]` | Show or set the USD→KSh rate |
| `set <group> <key> <value>` | Change a group setting |
| `export` | Download a full JSON backup |
| `reset-demo confirm` | Erase this device and reload demo data |

Group names accept `sun`, `youth`, `men`, `women`. Examples:

```
$ groups
$ member moses
$ set men lateFine 150          (KSh; applies to new transactions only)
$ simdate 2026-12-01            (pretend it is 1 Dec to test due dates and fines)
$ fines run
$ simdate reset
$ check                          (books integrity: every shilling adds up)
```

---

## 10. Install on a device (PWA)

**What makes it installable**

| Piece | File | Notes |
|---|---|---|
| Web app manifest | `manifest.webmanifest` | name, `display: standalone`, theme colour, shortcuts |
| Icons | `icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `icon.svg` | maskable icon for Android |
| Service worker | `sw.js` | caches the app files, serves them offline, network-first so updates arrive |
| HTTPS | host | Netlify provides it. `localhost` also works. |
| Install button | top bar and *Install & help* | uses the browser's `beforeinstallprompt` event; falls back to steps for iPhone |

**For users**

| Device | Steps |
|---|---|
| Android (Chrome) | Menu ⋮ → *Install app* / *Add to Home screen* |
| iPhone / iPad (Safari) | Share → *Add to Home Screen* |
| Windows / Mac / Chromebook (Chrome or Edge) | Install icon in the address bar → *Install Chama* |

**Shipping an update:** change any file, then **bump `CACHE = 'chama-v1'` in `sw.js`** (for example `chama-v2`) so installed copies refresh. Add any new file to the `FILES` list.

**Offline:** the app opens with no network. Because data is local in this version, everything works offline. With a real backend you will need an offline queue (section 15).

---

## 11. Data model

Held in one JSON object, `Chama.state`, saved after every change.

| Collection | Key fields |
|---|---|
| `groups` | `id, name, types[mgr,tb], contribution, tbSavings, lateFine, missedFine, joiningFee, dueDay, graceDays, loan{…}, mgr{round, order[], received[]}` |
| `members` | `id, name, phone, dob, sex, married, groupId, joinedOn, status, timeline[{from,groupId}], guardianUserId, guardianName, guardianPhone, consent, tbFrom, history[]` |
| `users` | `id, name, role, pin, phone, active, groupIds[], memberId` |
| `ledger` | **append-only.** `id, receiptId, date, memberId, groupId, paidBy, kind, period, amountMinor, orig, ccy, rate, method, ref, loanId, alloc, by, at, reversalOf, reversed` |
| `fines` | `id, memberId, groupId, period, reason, amount, paid, status, note` |
| `loans` | `id, memberId, groupId, principal, months, ratePct, status, guarantors[], confirmed[], approvals[], schedule[{n,due,principal,interest,pp,pi}]` |
| `meetings` | `id, date, groupId, mode, where, minutes, attendance{}` |
| `messages` | `id, memberId, toName, phone, channel, text, status:'simulated'` |
| `claims` | member “I have paid” requests, `pending → confirmed / rejected` |
| `signoffs` | `groupId, period, status, comment, by` |
| `recons` | cash checks: `system, actual, diff` |
| `audit` | `by, role, action, detail, date` |

`kind` in the ledger: `contribution, tb_savings, joining_fee, fine, loan_repayment, loan_disbursement, mgr_payout, unallocated`. Cash on hand for a group = inflows − outflows (payouts and disbursements).

---

## 12. Testing

```powershell
node tests/core.test.js                                   # 20 engine tests, no dependencies
npm i jsdom                                               # once
node tests/ui.smoke.test.js                               # browser test (237 checks)
```

- **Engine tests** verify the money rules: financial year, placement, loan schedule maths, USD conversion, duplicates, allocation adds up, permissions, approval limit, disburse → repay → reverse, fines only once, merry-go-round pot, year-end shares add up exactly, month locking, statement import matching, group moves, guardian rules, and a final integrity check.
- **Browser test** serves the app, signs in as **every role**, opens **every screen the role can see** (no error cards, no script errors), and drives real actions: payments, USD blocked by M-Pesa, duplicate refusal, member claim → treasurer confirm, cash difference flagged to auditors, reversal, statement import with matching, child needs guardian, suggested move, assistant buttons for all roles (English and Swahili), terminal commands, settings, add login, wrong PIN, install files served.

Both suites passed on the final build. They do **not** test on a real phone, with real M-Pesa files from your chamas, or with several people at once. Do that in your pilot (section 15).

---

## 13. Moving to production

The engine was written so it can move to a server without changing the rules. Recommended stack, matching what you already use: **Supabase (Postgres) + this frontend on Netlify**.

### 13.1 What changes

| Now (demo) | Production |
|---|---|
| `localStorage` | Supabase Postgres tables |
| PIN list | Supabase Auth: **phone number + SMS OTP** for members, email + password + 2FA for officials |
| `core.js` runs in the browser | Same logic as **Postgres functions / Edge Functions**; the browser only calls them |
| `runFines()` at sign-in | **Scheduled job** (`pg_cron`) every night |
| Simulated messages | **Africa's Talking** SMS via an Edge Function |
| Statement CSV only | Daraja callbacks + file parsers (§13.4) |

### 13.2 Table mapping (starting point, untested)

```sql
-- money is bigint cents; ledger is append-only
create table groups   (id text primary key, name text, config jsonb not null);
create table members  (id uuid primary key default gen_random_uuid(), group_id text references groups, name text, dob date, sex char(1),
                       married boolean, phone text, joined_on date, status text, guardian_id uuid references auth.users, consent boolean);
create table profiles (user_id uuid primary key references auth.users, role text not null, member_id uuid references members, group_ids text[]);
create table ledger   (id uuid primary key default gen_random_uuid(), receipt_id uuid, entry_date date, member_id uuid references members,
                       group_id text references groups, kind text, period text, amount_minor bigint not null, orig_minor bigint, ccy text default 'KES',
                       rate numeric, method text, ref text, reversal_of uuid references ledger, created_by uuid, created_at timestamptz default now());
create unique index ledger_ref_once on ledger(ref) where ref <> '' and reversal_of is null and method <> 'Cash';
create table audit_log(id bigserial primary key, at timestamptz default now(), actor uuid, role text, action text, detail text);
-- also: fines, loans, loan_schedule, meetings, messages, claims, signoffs, recons

-- append-only: block UPDATE/DELETE on ledger and audit_log
create or replace function forbid_change() returns trigger language plpgsql as $$ begin raise exception 'append-only'; end $$;
create trigger ledger_no_update before update or delete on ledger for each row execute function forbid_change();
create trigger audit_no_update  before update or delete on audit_log for each row execute function forbid_change();
```

### 13.3 Row-level security (the permissions matrix, enforced by the database)

```sql
alter table ledger enable row level security;
-- treasurer: read/insert only their group's rows
create policy ledger_treasurer on ledger for all using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'treasurer' and group_id = any(p.group_ids)));
-- auditor / bishop / super admin: read-only, all groups
create policy ledger_readers on ledger for select using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role in ('auditor','bishop','superadmin')));
-- member: only own rows; parent: only their children's rows
create policy ledger_own on ledger for select using (
  member_id in (select id from members where id = (select member_id from profiles where user_id = auth.uid()) or guardian_id = auth.uid()));
```

Every rule in `Chama.PERMS` becomes a policy or an RPC check. **Never rely on the browser to enforce permissions** once real money is involved.

### 13.4 Real payments and documents

| Need | Recommended |
|---|---|
| M-Pesa receive and match automatically | Safaricom **Daraja**: *C2B Register URL* with a paybill/till, callback into an Edge Function that inserts a ledger row (needs a registered paybill/till and Safaricom approval) |
| Member pays from the app | Daraja **STK Push** |
| Card and USD | **Pesapal**, **Flutterwave** or **Stripe** via hosted checkout; store the provider's reference and rate |
| SMS | **Africa's Talking** (Kenya sender ID) |
| Excel / Word / PDF statements | Excel: `SheetJS` in the browser. PDF: `pdf.js` text extraction (M-Pesa PDFs are usually password-protected: ask for the password in the UI). Word: `mammoth`. Always keep the *preview → confirm* step. |

### 13.5 Order of work

1. Create the schema + RLS; sign-in with phone OTP.
2. Port the money functions to SQL/Edge Functions; keep `tests/core.test.js` as the specification and run the same cases against them.
3. Swap `Chama.save/load` for API calls (`core.js` is the only file that changes shape; the views keep calling the same function names).
4. SMS, then Daraja, then card payments.

---

## 14. Security and privacy

**In this demo:** PINs are stored in plain text in the browser and the data is unencrypted on the device. This is fine for a demo and **not acceptable for real members**. Do not put real names or numbers in it.

**Before real data:**
- Real authentication (OTP), server-side permission checks (RLS), HTTPS only.
- A **privacy policy** and consent screen. The Kenya **Data Protection Act, 2019** applies: you hold names, phone numbers and children's data. Check whether the organisation must register with the **Office of the Data Protection Commissioner**, and get the consent wording for minors reviewed.
- Decide **retention**: how long uploaded statements are kept (suggest delete after processing) and who may export data.
- Daily encrypted **backups**, and test restoring one.
- Rate-limit sign-in; lock out after repeated wrong codes.
- Keep service keys on the server only; the browser gets the public key and RLS protects the data.
- Keep the audit log on the server where nobody on the tech team can edit it.
- Keep the app **bookkeeping-only**: do not hold members' money. Holding or moving funds, and lending to non-members, raise licensing questions; check with a lawyer first.

---

## 15. Recommended suggestions

**Must do before real money**
1. Connect a real backend with phone-OTP sign-in and row-level security (§13).
2. Pilot with **one real group for 2–3 months alongside their notebook**, compare every total, fix every mismatch.
3. Test with **real M-Pesa statements** from your chamas (names hidden) and harden the parser.
4. Get the **consent text and privacy policy** reviewed.
5. Decide and write down the open rules in §17 with the Bishop and treasurers.

**Should do soon**
6. Direct **Excel/PDF/Word** import with a “password for this PDF” prompt.
7. **Real SMS** and an in-app inbox with read receipts.
8. **M-Pesa paybill/till integration** so contributions are matched automatically, with STK push “Pay now”.
9. **Swahili for the whole interface**, not only the assistant (move text into a `strings.js` dictionary).
10. **Offline queue**: record payments with no network and sync later (needs the backend).
11. **Printable receipts** with a receipt number for every payment.
12. **Two-person approval** for payouts and loans above a limit, enforced on the server.
13. **Export to Excel (.xlsx)** for reports, alongside CSV.
14. **Per-member reminders schedule** (3 days before, on the day, weekly overdue) as a server job.

**Nice to have**
15. Charts on the dashboard (savings per group over time, collection rate).
16. Notices board and poll/voting for the group.
17. Welfare module (event types, payouts, waiting period). It was in your first list of parameters but is not built.
18. Biometric or PIN lock when the installed app is reopened.
19. Multi-church support so TEVINTECH can sell the same system to other churches.
20. A one-tap **WhatsApp share** of a member statement.

---

## 16. Known limitations

Honest list of what this build does **not** do:

- **Data is local to one browser.** Two treasurers on two phones see different data until a backend exists.
- **Sign-in is a demo PIN** (`1234`), not real security.
- **SMS is simulated.** Nothing is sent.
- **No real payments.** Everything is recorded by hand or from a pasted statement.
- **File import reads CSV / TSV / pasted text only.** `.xlsx`, `.pdf` and `.docx` are refused with a clear message. The statement parser is built for the usual M-Pesa export columns (*Receipt No., Completion Time, Details, Paid In*) and generic CSV; real files from your chamas may need small adjustments.
- **Welfare funds, dividends payout records, and member exit/refund** are not built. Year-end shares are calculated and shown but not posted.
- **Interface is English only.** The assistant switches to Kiswahili; the screens do not yet.
- **USD rate is typed in Settings**, not fetched live.
- **Service worker + `file://`:** install and offline need `http://localhost` or `https`.
- **Tested in a simulated browser and Chromium screenshots** (phone and desktop widths). Not yet tested on iPhone Safari, low-end Android, or by non-technical users.
- **Amounts marked as placeholders in §17 are my assumptions**, not rules you gave.

---

## 17. Decisions only you can make

These were asked earlier and not yet answered. The app uses my default until you decide. Change them in *Settings* with no code change.

| # | Question | Default used now |
|---|---|---|
| 1 | In Youth/Men/Women, is the KSh 500 / 1,000 monthly contribution all merry-go-round, with table-banking savings as a **separate extra** amount? | Yes, separate. Extra savings: Youth KSh 200, Men/Women KSh 500 (**placeholders**) |
| 2 | Late contribution fine and missed-meeting fine | Sunday School KSh 50, others KSh 100 (**placeholders**) |
| 3 | Grace period after the 10th | 3 days |
| 4 | Loan interest and limits | 10% per month on the reducing balance, up to 3× savings, up to 6 months, 2 guarantors, wait 3 months, 1 open loan |
| 5 | Loans above what amount need the Bishop? | KSh 15,000 |
| 6 | USD: is a USD group's amount the **same number** (USD 200) or a **converted** amount? | Payments in USD are converted to KSh at the stored rate; contributions stay defined in KSh |
| 7 | At what age does a Sunday School child manage their own login? | 18 |
| 8 | Who pays the group's bank/M-Pesa charges? | Not modelled |
| 9 | Does the **chama pay out to non-members** or lend to outsiders? | No (left out on purpose) |

---

## 18. Troubleshooting

| Problem | Fix |
|---|---|
| Blank page when opening `index.html` by double-click | Serve it: `python -m http.server 8080` (§2). |
| No **Install** button | Needs `https` or `localhost`; the browser may already consider it installed; on iPhone use Share → Add to Home Screen. |
| Updated files do not show on an installed copy | Bump `CACHE` in `sw.js`, redeploy, close and reopen the app. |
| I want to start again | *Settings → Reset demo data* or terminal `reset-demo confirm`. Or clear the site's data in the browser. |
| “USD can only be received by…” | USD is only for card/bank/international. Choose the method or pay in KSh. |
| “Books for … are signed off and locked” | Correct it in the next open month, or ask the auditor to send the month back. |
| Totals look wrong | Terminal `check`, or *Settings → Check books integrity*. |
| PowerShell: `rm -rf` fails | Use `Remove-Item -Recurse -Force <folder>` (`rf` is not a PowerShell parameter). |

---

*Crafted & polished by TEVINTECH.*
