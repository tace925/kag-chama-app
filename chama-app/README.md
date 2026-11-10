# Chama — church savings groups

Merry-go-round and table banking for Sunday School, Youth, Men and Women groups.
An installable web app (PWA). Plain HTML/CSS/JS, no build step.

## Run it
```powershell
python -m http.server 8080        # or: npx serve .
```
Open http://localhost:8080 → pick a role, pick a person, PIN **1234**.

## Deploy
Drag this folder onto https://app.netlify.com/drop (https makes the **Install** button work).

## Test
```powershell
npm install        # installs jsdom for the browser test
npm test           # 20 engine tests + 237 browser checks
```

## Read next
`docs/FRONTEND.md` — architecture, rules, roles, screens, terminal, install, Supabase plan, recommendations, known limitations.

**Demo build:** data is stored in the browser, sign-in is a demo PIN, SMS is simulated. See section 16 of the docs before using real member data.

Crafted & polished by TEVINTECH.
