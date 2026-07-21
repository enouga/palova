# Email HTML riche aux membres (page « Messages » / broadcast) — Design

**Date :** 2026-07-21
**Statut :** implémenté

## Contexte & problème

Un club peut déjà envoyer un message à tous ses membres actifs depuis `/admin/broadcast`
(« Messages », ouvert au STAFF) : email brandé + notif in-app + push, avec historique et
désinscription 1-clic (`BroadcastService`, `buildBroadcastEmail`, `ClubBroadcast`). **Seule
limite** : le corps est en **texte brut** — `buildBroadcastEmail` fait `escapeHtml(body)` dans
un unique `<p>`. Pas de mise en forme, pas d'images, sauts de ligne non conservés.

Objectif : permettre au club de composer un **vrai email HTML riche** (gras, listes, titres,
liens, couleurs, images) avec un **aperçu** avant envoi, en **réutilisant l'infra déjà en place**
pour les emails automatiques personnalisables (`/admin/emails`).

## Décision de cadrage

Option retenue : **éditeur riche** (choix Eric). On remplace le `<textarea>` par le composant
`RichEmailEditor` (TipTap) déjà utilisé sur `/admin/emails`, plus un aperçu fidèle. **Tout le
reste est inchangé** : envoi à tous les membres actifs, historique, désinscription, canaux
in-app/push, gate STAFF. Options écartées : « newsletter complète » (ciblage d'audience,
planification, test-send, sujet distinct) et « mise en forme légère » (sans éditeur).

## Principe d'architecture

Le broadcast reste **email + notif in-app + push simultanés**. In-app et push ne rendent pas de
HTML → **deux formes du corps** :

- **`bodyHtml`** (nouveau) : HTML riche assaini, source de l'email.
- **`body`** (existant) : texte brut dérivé (via `htmlToText`), pour la notif in-app, le push,
  l'historique et la ligne d'audit.

Colonne additive `ClubBroadcast.bodyHtml` → l'historique (`item.body`) continue d'afficher du
texte propre **sans changement**.

## Backend

- **Migration additive** `add_broadcast_body_html` : `ClubBroadcast.bodyHtml String? @map("body_html")`
  (`ALTER TABLE "club_broadcasts" ADD COLUMN IF NOT EXISTS "body_html" TEXT;`). DEV via
  `prisma db execute`, prod `migrate deploy`.
- **`registry.ts`** : `htmlToText` passe de module-private à **exporté** (déjà : `sanitizeBodyHtml`,
  `decorateBodyHtml`).
- **`buildBroadcastEmail`** (`email/templates/emails.ts`) : prend `bodyHtml` et applique la **même
  pipeline que `renderClubEmail`** — `decorateBodyHtml(sanitizeBodyHtml(bodyHtml), accent)` dans
  `introHtml` (jamais inséré brut) ; `text/plain` dérivé par `htmlToText`.
- **`BroadcastService.send`** : `SendInput = { title, bodyHtml, url? }`. Assainit une fois
  (`safeHtml`), dérive `plainBody = htmlToText(safeHtml).trim()`, valide `title` + `plainBody`
  non vides (rejette `<p></p>`), persiste `body: plainBody` **et** `bodyHtml: safeHtml`, envoie
  l'email riche (`safeHtml`) et **dispatch en texte brut** (`plainBody`). Nouvelle méthode
  **`preview(clubId, input)`** → `{ html }` (même brand, sans envoi ni persistance).
- **Routes** (`admin.ts`, gate `STAFF` inchangé) : `POST /broadcast` lit `bodyHtml` ; nouvelle
  `POST /broadcast/preview` → `{ html }`. **Route image réutilisée telle quelle** :
  `POST /emails/images` (même gate STAFF, club-scoped, 5 Mo, JPEG/PNG/WebP,
  `/uploads/email-images/…` accepté par l'allowlist). Aucune nouvelle route d'upload.

## Frontend

- **`lib/api.ts`** : `sendClubBroadcast` prend `bodyHtml` ; nouvelle `previewClubBroadcast` →
  `{ html }` ; `adminUploadEmailImage` réutilisée.
- **`RichEmailEditor.tsx`** : bouton « ＠ Insérer une info » gaté sur `vars.length > 0` (la page
  broadcast passe `vars={[]}` → pas de variables à insérer).
- **`app/admin/broadcast/page.tsx`** : `<textarea>` → `RichEmailEditor` (`vars={[]}`,
  `onUploadImage`), grille 2 colonnes (compose + aperçu collant réutilisant `EmailPreview`,
  débounce ~400 ms), historique inchangé. `canSend` via helper pur **`broadcastHasContent(html)`**
  (`lib/broadcast.ts` — texte non-blanc **ou** une image, car `<p></p>` est non vide).

## Tests

- Back : `emails.test` (buildBroadcastEmail riche/sanitize), `broadcast.service.test` (bodyHtml,
  texte brut dérivé, stockage double, dispatch texte brut, sanitize, preview),
  `admin.broadcast.routes.test` (payload bodyHtml + route preview STAFF).
- Front : `broadcast.test` (broadcastHasContent), `AdminBroadcast.test` (éditeur mocké, envoi
  bodyHtml, canSend), `RichEmailEditor.test` (bouton variables masqué si `vars=[]`).

## Vérification visuelle

CDP clair + sombre, desktop 1280 + mobile 390 : éditeur TipTap monté avec barre d'outils
complète (dont Photo), **sans** bouton « Insérer une info », colonne « Aperçu de l'email » qui
rend l'email brandé et se met à jour à la frappe, aucun débordement horizontal.

## Choix des canaux (2026-07-21, même itération)

Le club choisit, par envoi, sur quels canaux le message part : **Email / Cloche (in-app) / Push**,
tout coché par défaut. **Le push est couplé à la cloche** (impossible d'avoir un push sans notif
in-app — état incohérent). Au moins un canal requis.

- **Dispatcher** (`notification/dispatcher.ts`) : nouveau champ optionnel **`allowChannels?: { inapp?, email?, push? }`**
  = plafond appelant, **intersecté** avec les préférences du membre (`channels.x && allow.x !== false`).
  Absent = comportement historique. C'est ce qui permet enfin de **couper la cloche** d'un message
  club — `CLUB_MESSAGES + INAPP` est pourtant *forcé ON* au niveau membre (`preferences.ts`).
- **Service** : `SendInput.channels?`, helper pur exporté **`normalizeBroadcastChannels`** (défaut
  tout on, `push = push && inApp`), rejet `VALIDATION_ERROR` si aucun canal. L'email n'est
  **construit que si `email` demandé** (skip `buildBroadcastEmail` par membre sinon). `dispatch`
  reçoit `allowChannels`.
- **Route** : `POST /broadcast` lit `channels` (coercition en booléens).
- **Front** : 3 `SwitchRow` (couplage push↔cloche géré au toggle + wrapper `pointerEvents/opacity`),
  `hasAnyChannel`/`coupleChannels` (`lib/broadcast.ts`), `canSend` exige ≥1 canal, l'aperçu email
  est remplacé par une note quand Email est décoché (et le fetch d'aperçu est sauté).
- **Tests** : `dispatcher.test` (intersection allowChannels), `broadcast.service.test`
  (canaux + `normalizeBroadcastChannels`), `admin.broadcast.routes.test` (passthrough),
  `broadcast.test` (`coupleChannels`/`hasAnyChannel`), `AdminBroadcast.test` (switches, couplage,
  no-channel, aperçu masqué). Vérifié CDP (switches, couplage, note).

## Hors périmètre

Ciblage d'audience, planification, envoi de test dédié, sujet distinct du titre, libellé CTA
configurable (reste « Voir »), file d'envoi/rate-limit (fan-out synchrone V1 conservé),
mémorisation en base des canaux utilisés par envoi (historique inchangé).
