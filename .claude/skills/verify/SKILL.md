---
name: verify
description: Vérifier visuellement une page du frontend Palova en local (screenshots Chrome headless + CDP, session authentifiée, viewport mobile/desktop)
---

# Vérifier une page Palova en local (screenshots)

Recette éprouvée pour observer une page du frontend (Next.js, hôtes multi-clubs) telle qu'un joueur la voit, sans Playwright/Puppeteer (non installés, et les shims `.bin`/npx sont cassés sur ce poste).

## Pré-requis

- Backend (3001) et frontend (3000) déjà lancés (`start.ps1` ou `npm run dev` dans chaque dossier). Sanity : `curl http://localhost:3001/health` et `curl -o /dev/null -w "%{http_code}" http://localhost:3000/`.
- Chrome : `C:/Program Files (x86)/Google/Chrome/Application/chrome.exe` (Edge dispo aussi en `(x86)/Microsoft/Edge`).

## Les 3 pièges à connaître

1. **Hôte club** : en dev `ROOT_DOMAINS=['localhost']` → utiliser `http://padel-arena-paris.localhost:3000` (Chrome résout `*.localhost` en loopback nativement). `http://localhost:3000` = hôte plateforme → beaucoup de pages club affichent « Chargement… » ou redirigent vers /login.
2. **Auth** : le token vit dans un **cookie `token`** (pas localStorage). L'obtenir par l'API : `POST http://localhost:3001/api/auth/login` avec `{"email":"test@palova.fr","password":"password123"}`, puis l'injecter via CDP `Network.setCookie` AVANT de naviguer. Sans lui, le proxy renvoie l'anonyme vers /login (sauf PUBLIC_PATHS).
3. **`chrome --screenshot` simple ne suffit pas** (pas de cookie possible) → passer par **CDP sur WebSocket natif Node** (Node ≥ 22, aucun npm install).

## Driver CDP (pattern qui marche)

Script Node `.mjs` (exemple complet ayant servi : scratchpad `cdp-shots2.mjs` de la session du 2026-07-05) :

1. Login API → `auth.token`.
2. `spawn(CHROME, ['--remote-debugging-port=9345','--headless=new','--disable-gpu','--hide-scrollbars','--user-data-dir=<scratch>/chrome-cdp','about:blank'])`.
3. Poll `http://127.0.0.1:9345/json` → `webSocketDebuggerUrl` du target `type:'page'`.
4. `new WebSocket(wsUrl)` ; protocole JSON `{id, method, params}` ; **mettre un timeout par commande** (30 s) sinon un stall Chrome bloque tout le script (vécu).
5. Séquence : `Page.enable` → `Network.enable` → `Network.setCookie {name:'token', value, url:BASE}` → boucle par capture :
   - `Emulation.setDeviceMetricsOverride {width, height:950, deviceScaleFactor:1.5, mobile: width<800}` (390 = mobile, 360 = étroit, 1280 = desktop)
   - `Page.navigate {url}` → attendre `Page.loadEventFired` (cap 15 s) + 2,5 s de marge pour les fetches client
   - `Page.captureScreenshot {format:'png', captureBeyondViewport:true}` → écrire le base64.
6. Lire les PNG avec le tool Read (multimodal) pour juger le rendu.

## Nettoyage

Ne JAMAIS `Stop-Process` tous les chrome.exe (le user a son Chrome ouvert). Cibler le profil dédié :
`Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*chrome-cdp*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`.

## Données utiles (seed)

- Club : slug `padel-arena-paris` (id `club-demo`), user `test@palova.fr` / `password123`.
- Ids frais : `GET /api/clubs/padel-arena-paris/tournaments` (états variés : complet+attente, presque plein) et `/events` (avec/sans capacité, prix).

## Gotchas

- Jamais `npx jest`/`npx tsc` — `node node_modules/jest/bin/jest.js`, `node node_modules/typescript/bin/tsc`.
- Le user teste souvent la **prod sur son téléphone** : préciser que la vérif est locale.
- Première visite d'une route en dev = compile Turbopack (quelques secondes) → prévoir l'attente load-event, pas un sleep court.
