# Audit pré-mise-en-production — Palova

> Réalisé le **2026-07-17**, en lecture seule, sur 4 axes menés en parallèle
> (sécurité backend, préparation prod/ops, qualité frontend, robustesse métier backend).
> Chaque finding a été vérifié dans le code réel — les références `fichier:ligne`
> sont exactes au moment de l'audit (branche `feat/siret-garde-club`).
>
> **Verdict global** : application remarquablement saine pour une V1 (pas de faille
> critique de sécurité, logique métier concurrente rigoureuse, design system cohérent,
> zéro TODO dans le code vivant, UI 100 % FR). Le fond est bon. Ce qui bloque la MEP
> n'est pas une feature mal faite, c'est **la préparation opérationnelle** (sauvegardes,
> seed de démo, secrets) et **trois fragilités autour de l'argent** invisibles en dev.

---

## Ordre d'attaque recommandé

1. **Sauvegardes Postgres réelles + 1 test de restauration** (§1.1) — rien d'autre ne compte tant que ça n'existe pas
2. **Seed démo gardé/retiré du runbook prod** (§1.2)
3. **Répétition générale** : `migrate deploy` sur base vierge (§1.3) + `.env.prod` complet, SMTP surtout (§6)
4. **Le trio argent** : webhook non-2xx sur erreur (§1.6) + idempotencyKey refunds (§1.7) + retry P2034 (§1.5)
5. **Rate limit login** (§1.4) + cookie `Secure` (§2.1)
6. **2 chemins publics manquants** (§4.1) + erreurs réseau visibles sur 3 listes (§4.2)
7. **Ménage** : patch/, design/, next-pwa, tmp-* (§5)

Estimations : points 1-3 = ops pur (~½ journée) · point 4 = le plus technique (~1 jour) · points 5-7 = rapides.

---

## 1. Bloquants avant la mise en prod

### 1.1 — [BLOQUANT] Aucune sauvegarde Postgres n'existe
`docs/sauvegardes.md` est un runbook complet mais **théorique** : le script `deploy/backup-db.sh`
qu'il décrit **n'existe pas** (seuls `deploy.sh` et `setup-vm.sh` sont présents). Checklist de mise
en place entièrement décochée (`docs/sauvegardes.md:293-300`), fichier terminé par
« Dernier test de restauration réussi : — (jamais encore effectué) » (`:304`).
La base est la seule donnée irremplaçable ; les volumes `backend_uploads`/`backend_uploads_private`
(avatars, affiches, photos DM) aussi.
**Correctif** : écrire `backup-db.sh` (pg_dump quotidien + compression + rotation 7-30j),
pousser une copie **hors VM** (Storage Box / S3 / rsync), **faire 1 test de restauration**.

### 1.2 — [BLOQUANT] Le seed de démo tourne en prod avec `password123`
`docs/deploiement-hetzner.md:110-112` (« Étape 6 ») et `deploy/setup-vm.sh:39-40` lancent `npm run db:seed`.
`backend/prisma/seed.ts` crée le club `club-demo` (`:40-57`) et **5 comptes réels**
`test/owner/admin/staff/joueur@palova.fr` en `password123` (`:99-113`), **sans garde `NODE_ENV`**
(seul `super@palova.fr` est protégé, `:194-196`). → comptes OWNER exploitables en prod.
`seed-demo.ts` (100 membres × 5 clubs, `:24`) n'a aucune garde non plus.
**Correctif** : garde `if (NODE_ENV !== 'production')` autour des comptes démo **ET** retirer l'étape du runbook (défense en profondeur).

### 1.3 — [BLOQUANT] `prisma migrate deploy` jamais validé sur base vierge
Workflow dev = `prisma db execute` puis dossier de migration écrit à la main → la chaîne complète
n'a jamais été rejouée d'un bloc. Timestamps de dossiers **dupliqués** (`20260701000000` ×3,
`20260717120000` ×2…), SQL partiellement rejouables (`add_tournament_referee` : `ADD COLUMN IF NOT EXISTS`
mais `ADD CONSTRAINT` sans garde → rejouable une seule fois). Le conteneur boote sur
`npx prisma migrate deploy && node dist/app.js` (`backend/Dockerfile:26`) → **1 migration qui échoue = crash-loop**.
**Correctif** : répétition sur un Postgres jetable vierge + `prisma migrate diff` pour confirmer base == schéma.
**Note** : `add_registration_online_payment` **existe bien** avec son SQL (la note du CLAUDE.md:260 est périmée).

### 1.4 — [BLOQUANT] Zéro rate limiting sur l'authentification
`assertRateLimit` (`backend/src/services/rateLimit.ts`) n'est branché que sur chats/DM/signalements.
`backend/src/routes/auth.ts` : `/login` (:53), `/register` (:77), `/forgot-password` (:187),
`/reset-password` (:214), `/resend-code` (:160), `/verify-email` (:119) → aucun throttle.
Brute-force de mot de passe libre sur `/login`. (Le brute-force des **codes** est bien fermé :
CSPRNG 6 chiffres, 5 essais max/code, cooldown 60s.) Énumération de comptes possible (register 409
selon existence vérifiée ; timing login différent).
**Correctif** : `assertRateLimit` par IP + par email (ex. `login:{ip}` 10/min, `login:{email}` 5/min) sur login/forgot/resend.

### 1.5 — [BLOQUANT] Pas de retry sur les conflits de sérialisation (P2034)
~40 transactions `isolationLevel: 'Serializable'`, **aucun helper de retry**. Un conflit 40001/P2034
remonte brut, non mappé par les `handleError` de route → handler global (`app.ts:103-106`) →
**500 « Erreur interne » en plein paiement**. Aggravant : chaque encaissement incrémente le compteur
`ClubCounter` **partagé par club** (`package.service.ts:326-333`) → 2 tx concurrentes du même club = conflit quasi garanti
(soir de tournoi : caisse + paiement en ligne simultanés). Endroits : `reservation.service.ts:519-660` (confirmReservation)
et `:2114-2134` (encaissement), `offer.service.ts:45-94` (fulfillPaidIntent), `event.service.ts:79-276`,
`tournament.service.ts:115-336`, `refund.service.ts:62-92`.
**Correctif** : wrapper `withSerializableRetry(fn, {retries:4, backoff})` sur P2034/40001. Conditionne le §1.6.

### 1.6 — [BLOQUANT] Webhook Stripe : erreurs avalées, toujours 200
`routes/stripe-webhooks.ts` : chaque handler en `catch { /* idempotent */ }` (:60,:65,:69,:81),
catch global (:127-129) + `res.json({received:true})` (:131) → **toujours 200**. Une erreur transitoire
(DB, ou un P2034 du §1.5) est perdue et **Stripe ne rejoue jamais**. Scénario : client paie, ferme l'onglet
(seul le webhook fulfille) → 1 échec = **carte débitée, rien créé** (le commentaire :60 admet « remboursement manuel »).
**Correctif** : distinguer erreurs d'idempotence attendues (→200, avaler) et inattendues (→500, laisser Stripe rejouer).

### 1.7 — [BLOQUANT] Remboursements : double remboursement possible
`refund.service.ts:56-59` appelle `stripe.refunds.create(...)` **hors transaction**, après un contrôle
`refundableCents` lu **hors transaction** (:29-36), **sans `idempotencyKey`**. Le garde-fou en tx
(`updateMany where refundedAmount = valeur lue`, :63-67) n'empêche que le double **enregistrement** DB,
pas le double **mouvement d'argent** Stripe. Double-clic admin / 2 staff sur la même résa = **remboursement réel ×2**,
et l'écart est invisible en compta.
**Correctif** : `idempotencyKey` déterministe (`refund-{paymentId}-{montant}-{refundedAmountLu}`) + idéalement marquer la DB avant l'appel Stripe.

---

## 2. Sécurité — reste du détail

### 2.1 — [Moyenne] Cookie de session sans `Secure`
`frontend/lib/session.ts:15` : `document.cookie` avec `SameSite=Lax` (bon anti-CSRF) mais **ni `Secure` ni `HttpOnly`**.
`HttpOnly` = refactor lourd (SPA + proxy lisent le token) → acceptable V1. `Secure` hors localhost = 3 lignes.

### 2.2 — [Moyenne] JWT 7 jours, non révocable
`routes/auth.ts:18` (`expiresIn:'7d'`) + `middleware/auth.ts:26-30` : identité crue du token, jamais revérifiée en base.
Compte supprimé (RGPD) ou compromis = token valide 7j. **Bien fait sur les privilèges** : `requireSuperAdmin` et
`requireClubMember` revérifient le rôle en base (révocation immédiate). Seule l'identité n'est pas révocable.
**Correctif éventuel** : champ `tokenVersion` sur User, incrémenté à suppression/bannissement, vérifié dans le middleware.

### 2.3 — [Moyenne] Avatars/logos non ré-encodés (EXIF/GPS conservés)
`routes/me.ts:179-187` : extension = mimetype **déclaré client**, buffer écrit tel quel dans `/uploads/avatars/`, servi statiquement.
Contraste avec les DM (`messaging.service.ts:336` `reencodeImage` via sharp : format réel, EXIF/GPS retirés, ≤2048px).
Vie privée (position GPS d'une photo) + pas de validation du contenu réel.
**Correctif** : réutiliser le pipeline sharp pour avatars/logos/covers/affiches + header `X-Content-Type-Options: nosniff` sur `/uploads`.

### 2.4 — [Faible] Tokens JWT en query string (SSE/images)
`conversations.ts:166,180`, `notifications.ts:131`, `clubs.ts:569`. Nécessaire (EventSource/`<img>` sans header Authorization).
L'app ne logge pas les URLs, mais Caddy peut. Vérifier le format de log Caddy en prod, masquer le param si besoin.

### 2.5 — [Faible] UserIds internes exposés en anonyme
`tournament.service.ts:418-419`, DTO open-match. Pas de PII, mais ids stables servis à l'anonyme (scraping/corrélation).

### 2.6 — [Faible] Fail-open du rate limiting
`rateLimit.ts:15-17` : Redis en panne = plus aucune limite (chats/DM/signalements). Choix de dispo assumable, à connaître.

### 2.7 — [Info] Périmètre STAFF large
`routes/admin.ts:185` : STAFF peut supprimer membres, rembourser (`:586`), facturer no-show (`:1160`), vendre abos/carnets,
ajuster soldes (`:981-1012`). Pas d'escalade (rôles/branding = ADMIN, Stripe/billing = OWNER). Choix documenté (audit des rôles).

### Bien fait (sécurité)
Webhooks Stripe signés + fail-closed + raw body avant json + 2 secrets distincts · zéro injection SQL (tout paramétré,
aucun `$queryRawUnsafe`) · pas de fallback `JWT_SECRET` en dur · révocation de rôle en base · anti-spoofing
`x-club-slug`/`x-club-path` (`proxy.ts`) · `safeNext` anti-open-redirect · sanitize-html serré (emails) ·
messagerie privée robuste (anti-traversée, sharp, gardes participant) · DTO publics sans PII (`PUBLIC_TOURNAMENT_SELECT`) ·
anti-énumération forgot/resend · deps à jour (jwt 9, multer 2, express 5, bcrypt 6) · aucun `.env` commité.

---

## 3. Robustesse métier — reste du détail

### 3.1 — [Moyenne/Élevée] Aucun handler process global backend
Grep négatif `unhandledRejection`/`uncaughtException` dans `backend/src`. Promesses flottantes multiples
(`safeNotify` void, heartbeats SSE, `.catch(()=>{})`). 1 rejection non gérée peut **terminer le process**
(qui héberge crons + SSE). `restart:unless-stopped` relance mais perd requêtes/streams en vol.
**Symétrique frontend** (`instrumentation.ts:7-9`) : handler qui n'ignore qu'EPIPE mais **avale tout le reste sans re-throw** → à restreindre à EPIPE.

### 3.2 — [Élevée/Moyenne] Pas de `@@unique` sur `stripePaymentIntentId`
`schema.prisma:836,854` : seulement `@@index`. Idempotence = `findFirst` applicatif + Serializable (`offer.service.ts:46`).
Si sérialisation ne détecte pas le conflit (prédicats disjoints), double PaymentIntent (client+webhook) → 2 Payments.
**Correctif** : `@@unique` (après vérif qu'aucun doublon n'existe déjà en base).

### 3.3 — [Faible] Verrou Redis libéré sans compare-and-delete
`reservation.service.ts:270,316,662,707,1191` + `cleanup.job.ts:44` : `redis.del(lockKey)` sans vérifier la valeur `userId`.
Fenêtre étroite (TTL 300s = fenêtre hold), pas d'orphelins, mais suppression croisée possible.
**Correctif** : script Lua « delete if value matches ». Faible priorité.

### 3.4 — [Faible/Moyenne] Heartbeat SSE non protégé
`sse.service.ts:36,80,116,153` : `setInterval(()=>res.write(': ping'))` sans try/catch → write sur socket mort peut jeter dans le timer.
Combiné à §3.1 = risque de chute du process. Les diffusions réelles collectent bien les sockets morts. **Correctif** : try/catch autour du ping.

### 3.5 — [Moyenne] Billing mensuel plateforme non transactionnel
`platformBilling.service.ts:150-222` : snapshot → update club → `changeSubscriptionTier` (Stripe) → update DB → email, non atomique.
Crash entre Stripe et update DB = désync. Re-run relance Stripe + emails (seul le snapshot est idempotent). Concerne **ta** facturation SaaS, rattrapable à la main.

### 3.6 — [Moyenne] N+1 SMTP sur envois de masse
`notifications.ts:1165` + `dispatcher.ts:73` : annulation tournoi 100 inscrits = 100 envois SMTP séquentiels, sans queue.
Fire-and-forget via `safeNotify` (pas de blocage requête) mais peut saturer SMTP. Acceptable V1.

### 3.7 — [Moyenne, latent] `Payment.reservation` en `onDelete: Cascade`
`schema.prisma:839` : supprimer une Reservation cascade-supprimerait ses Payments (reçus/compta). Aucun hard-delete de résa aujourd'hui
(passage en CANCELLED), mais mine pour tout futur script de purge. Toutes les autres FK de Payment sont SetNull.
**Correctif** : passer en `Restrict` ou `SetNull` par cohérence.

### 3.8 — [Faible] Notifs sociales avalées sans log
`friendship.service.ts:61,70,87`, `follow.service.ts:68` : `.catch(()=>{})` sans log. Incohérent avec `safeNotify` qui logge.

### 3.9 — [Faible] Boucle `releaseExpiredRegistrations` sans try/catch par itération
`cleanup.job.ts:21-22` : 1 libération qui jette interrompt le lot (auto-réparé au run suivant). Autres boucles bien protégées.

### 3.10 — [Faible] Chevauchement des runs cron non protégé
`node-cron` ne sérialise pas. Cleanup/reminders idempotents par fenêtre ; billing nocturne/mensuel chevauchant pourrait double-traiter.
**Mono-instance obligatoire** : 2 répliques backend = double exécution des 4 crons (aucun verrou distribué).

### Bien fait (métier)
Anti-survente rigoureux (Serializable + FOR UPDATE + décréments conditionnels : holdSlot, confirmReservation, `PackageService.consume`,
refund, plafond encaissement) · numérotation reçus atomique (`ClubCounter.upsert` + `@@unique([clubId,receiptNo])`, sans trou) ·
argent en centimes (`Math.round(Number*100)` + `Decimal`, **zéro `parseFloat`**) · timezone propre (Luxon + `Club.timezone`, **pas d'UTC+2 en dur** — la note CLAUDE.md est périmée) ·
crons majoritairement best-effort try/catch par itération + logs · `dispatch`/SSE défensifs.

---

## 4. Frontend — reste du détail

### 4.1 — [Moyenne/Élevée] Fiches tournoi/event fermées aux anonymes (hôte club)
`frontend/lib/authGate.ts:24` `isClubPublicPath` autorise `/` + `PUBLIC_PATHS` mais **ni `/tournois/[id]` ni `/events/[id]`**.
Or le Club-house public affiche « Prochains events » à tout visiteur (`ClubHouse.tsx:151`, sans garde token), liens vers ces fiches
(`TournamentsAlaUne.tsx:39`), et les fiches gèrent l'anonyme (CTA « Se connecter pour s'inscrire », `tournois/[id]:197`, `events/[id]:166`).
→ **le visiteur clique un event à la une et se fait renvoyer au login** (cul-de-sac). Incohérent avec `/parties` (public).
**Correctif** : ajouter `/tournois` et `/events` à `isClubPublicPath`. Régression UX la plus visible, correctif d'une ligne.

### 4.2 — [Moyenne] Échecs réseau déguisés en états vides
`catch { setXxx([]) }` sans feedback (loading résolu via finally) → indiscernable de « rien à afficher » :
- `ClubReserve.tsx:169` — **le pire** : dispo en échec → 0 créneau (« complet ») sur la page de réservation
- `ClubDirectory.tsx:41` → « aucun club »
- `OpenMatches.tsx:59` → parties ouvertes vides
- (Low) `Leaderboard.tsx:66`, `app/admin/matches/page.tsx:26`, `MessagesHub.tsx:73`, `MatchDiscussion.tsx:13`
Le reste de l'app gère bien (`BookingModal`, Steps, `FriendsHub`, `MessageThread`). **Correctif** : `setError` + bandeau sur les 3 loaders.

### 4.3 — [Moyenne] `MatchDiscussion.tsx` — outlier design
Tout en classes Tailwind (`bg-black`, `text-white`, `bg-black/[0.03]`) sans `useTheme`/`th` → **ne s'adapte pas** au clair/sombre (fond noir en dur).
Vestige d'une génération UI antérieure (feature litige match). À réécrire dans le design system.

### 4.4 — [Moyenne] Pas de token danger/success/warning dans `lib/theme.ts`
Rouge d'erreur réinventé ≥6× : `#e5484d`, `#e0554f`, `#dc2626`, `#c4472e`, `#c0392b`, `#e55`, `#b23c17`/`#a83214`.
Ni cohérent, ni adaptatif dark/light. `ACCENTS.coral` recopié ~15× + redéfini localement (`members/page.tsx:37`, `encaissement/page.tsx:23`).
**Correctif** : tokens sémantiques au thème + migration.

### 4.5 — [Faible] A11y — boutons-icônes sans nom accessible
`MessagesHub.tsx:94` (`⋮`, le plus notable) · `CollectPanel.tsx:377`, `MessageComposer.tsx:79`, `OffPeakEditor.tsx:61`, `MessagesHub.tsx:152` (`×`) ·
`app/admin/announcements/page.tsx:107` (`alt=""` sur image porteuse). Base saine (236 aria-labels, `role="alert"`).

### 4.6 — [Moyenne] Formatage euro dupliqué ~15×
Helper canonique `lib/payments.ts:4 eurosFromCents` réimplémenté avec règles divergentes (`5 €` vs `5,00 €`) :
`OffersShowcase.tsx:14`, `BookingModal.tsx:209`, `TrendKpis.tsx:13`, `SellPanel.tsx:26`, `DayJournal.tsx:25`,
`SubscriptionActions.tsx:14`, `OfferStudio.tsx:26`, `SubscriberInsights.tsx:7-8`, `packages/page.tsx:12`, `caisse/page.tsx:18`, `lib/packages.ts`.

### 4.7 — [Faible] Fallback API dupliqué 5×
`NEXT_PUBLIC_API_URL || 'http://localhost:3001'` dans `lib/api.ts:1`, `lib/manifest.ts:3`, `lib/useCourtSSE.ts:5`, `app/layout.tsx:33`, `app/parties/[id]/page.tsx:7`.
localhost uniquement en fallback dev. À centraliser en constante.

### Bien fait (frontend)
Aucun `DEMO_TOKEN` (éradiqué) · timezone propre dans le code vivant (Intl + `club.timezone`) · zéro TODO/FIXME/HACK ·
design system centralisé (`makeTheme`, `ACCENTS`, `inkOn`, `cardStyle`, `HERO_*`) · bons messages d'erreur sur flux transactionnels ·
a11y de base saine · perf (pas de lib lourde, charts SVG faits main, Stripe lazy) · proxy durci · i18n cohérent (100% FR) · suite RTL fournie.

---

## 5. Code mort à supprimer

- **`frontend/patch/`** (26 fichiers) : prototype complet, exclu du build (`tsconfig.json:33`), toujours commité.
  Contient l'UTC+2 en dur (`patch/components/CourtCalendar.tsx:12-13`, `patch/components/BookingModal.tsx:19`), prix en dur
  `pricePerHour="25"` (`patch/app/courts/[id]/page.tsx:127`), token via `localStorage` (`:31`), et le seul TODO du repo.
- **`frontend/design/`** (14 maquettes `.jsx`, ~170 Ko) : jamais importées.
- **`components/Logo.tsx`** : orphelin (seul `patch/` l'importe, remplacé par `Logotype`).
- **`next-pwa`** (`frontend/package.json:27`) : jamais utilisé (PWA fait main via `public/sw.js` + `manifest.ts`). `npm uninstall`.
- **Artefacts** : `backend/tmp-pi-check.ts`, `backend/tmp-stripe-check.ts` (copiés dans l'image Docker), `frontend/dev-frontend.log`, `frontend/bash.exe.stackdump`.

---

## 6. Ops — fortement recommandé

- **Secrets prod incomplets** : `setup-vm.sh:23-28` ne génère que `POSTGRES_PASSWORD`, `JWT_SECRET`, `SITE_USER`, `SITE_PASS`.
  Manquent SMTP, VAPID, Stripe, `SUPERADMIN_PASSWORD`. **Piège** : sans SMTP, l'inscription échoue silencieusement
  (codes loggés en console, jamais envoyés → personne ne valide son compte, rien dans les logs). Compléter `.env.prod` + check au boot.
- **`/health` superficiel** (`app.ts:86` : `{status:'ok'}` en dur) — ne teste ni DB ni Redis. Ajouter `SELECT 1` + `redis.ping()`.
- **Pas de rotation logs Docker** (aucune section `logging:` dans le compose prod) → croissance non bornée. Ajouter `logging: {driver:json-file, options:{max-size:"10m", max-file:"5"}}`.
- **Pas de healthcheck conteneur** backend/frontend (seuls Postgres/Redis) ; Caddy/frontend `depends_on` sans `condition`.
- **`setup-vm.sh:33`** fait `up -d --build`, interdit par `DEPLOY.md`.
- **Mono-instance obligatoire** : les 4 crons dans le process backend, aucun verrou distribué (cf. §3.10).

### Bien préparé (ops)
Volumes de persistance corrects (uploads publics/privés) · healthchecks Postgres/Redis + `depends_on: service_healthy` ·
`restart: unless-stopped` partout · CORS strict · TLS on-demand bien géré (`Caddyfile`) · polices OG dans l'image (`fonts-dejavu-core`) ·
garde Stripe au boot (placeholder au lieu de crash) · push VAPID défensif · garde superadmin en prod (`seed.ts:194`) ·
`docs/sauvegardes.md` très complet (reste à l'implémenter) · migration `add_registration_online_payment` présente.

---

## Notes de repo

- Branche au moment de l'audit : `feat/siret-garde-club` (13 commits non mergés, cherry-pick prévu) + petit WIP frontend non commité.
- CLAUDE.md périmé sur 2 points : migration `add_registration_online_payment` **existe** (note :260 fausse) ; UTC+2 **disparu** (tz-aware partout dans le code vivant).
