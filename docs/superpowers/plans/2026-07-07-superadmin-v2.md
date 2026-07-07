# Superadmin v2 — pilotage plateforme (clubs, facturation SaaS, stats d'utilisation)

## Contexte

Le propriétaire de Palova veut piloter sa plateforme : gérer les clubs, suivre/agir sur les paiements SaaS des clubs, et voir des stats d'utilisation. **Une bonne partie existe déjà** (`/superadmin` : dashboard 7 compteurs, table clubs avec suspendre/exonérer/alias/créer, CRUD sports ; facturation Stripe Billing complète côté club-admin). Les trous réels, validés avec le user :

1. **Fiche club détaillée** `/superadmin/clubs/[id]` (aucun drill-down aujourd'hui) + recherche dans la table.
2. **Facturation superadmin** : vue riche par club (palier souscrit, cadence, prochaine échéance, factures) + **actions sur l'abonnement** (changer palier, annuler à échéance, réactiver) + page vue d'ensemble. Point technique clé : **aucune facture Stripe n'est persistée** (le webhook `invoice.paid`/`payment_failed` ne fait que flipper `PlatformSubscription.status`, vérifié l.70-84 de `platform-billing-webhooks.ts`) → nouvelle table `PlatformInvoice` pour l'historique CA/MRR fiable.
3. **Stats d'utilisation** : croissance plateforme (nouveaux clubs/users/résas par mois), activité par club (classement), revenus SaaS (CA encaissé/mois, répartition paliers, cumulé).

**Question perf du user (répondue)** : aucun impact sur le site — tout est on-demand derrière `requireSuperAdmin`, jamais exécuté pour les joueurs/clubs ; les agrégations lourdes s'appuient sur les snapshots mensuels déjà en base et des `$queryRaw` ponctuels. Pas de cache nécessaire en v1.

**Hypothèses vérifiées dans le code** : `stripeBilling.ts` expose `changeSubscriptionTier(subId, newTier)` (l.187, sans interval) et `cancelAtPeriodEnd` (l.200), **pas de resume** → à ajouter ; `Reservation.createdAt` mappé `created_at` ; `PlatformSubscription` = état courant 1 ligne/club ; `ClubMemberSnapshot` = série mensuelle déjà en base ; pages superadmin ne montent PAS ClubNav (tests simples).

## Étape 0 — Docs (convention repo)

Écrire spec + plan dans `docs/superpowers/specs/2026-07-07-superadmin-v2-design.md` et `docs/superpowers/plans/2026-07-07-superadmin-v2.md` (condensé de ce plan), commit docs.

## Lot 1 — `PlatformInvoice` : migration, webhook, synchro Stripe (backend)

**Schéma** (`backend/prisma/schema.prisma`, après `ClubMemberSnapshot`) : modèle `PlatformInvoice` — `id`, `clubId` FK→Club Cascade, `stripeInvoiceId @unique`, `amountCents Int`, `currency @default("eur")`, `status` ('paid'|'open'|'failed'|'void'|'uncollectible'), `tier Int?`, `interval String?`, `periodStart/periodEnd/paidAt DateTime?`, `hostedInvoiceUrl String?`, `createdAt` (= `created` Stripe, posé explicitement), `@@index([clubId])`, `@@map("platform_invoices")`. + relation `platformInvoices PlatformInvoice[]` sur `Club`.

**Migration** `backend/prisma/migrations/20260707130000_add_platform_invoices/migration.sql` — SQL additif manuel (CREATE TABLE + unique index + index + FK). **DEV : `npx prisma db execute --file …` puis `npx prisma generate` (JAMAIS `migrate dev`/`db push` — dérive base dev). Prod : `migrate deploy`.**

**Nouveau `backend/src/services/platformBilling/platformInvoices.ts`** (types Stripe **structurels inline** `StripeInvoiceLike` — le namespace `Stripe.*` ne résout pas sous le tsconfig) :
- `invoiceSubscriptionId(inv)` — tolère `invoice.subscription` ET `invoice.parent.subscription_details.subscription` (deux versions d'API, comme le webhook).
- `invoiceFields(inv, statusOverride?)` — helper PUR : `amountCents` = `amount_paid` si paid sinon `amount_due` ; `paidAt` = `status_transitions.paid_at` ; tier/interval via `lookup_key` de la 1re ligne (`tierFromLookupKey`), repli sur `PlatformSubscription` (API Basil n'expose plus lookup_key).
- `upsertInvoice(inv, statusOverride?)` — idempotent par `stripeInvoiceId`, club résolu via `customer` → `Club.platformCustomerId`, customer inconnu → skip silencieux.
- `syncAllInvoices(): Promise<{clubs, imported}>` — pagine `stripe.invoices.list({customer, limit:100, starting_after})` pour chaque club à `platformCustomerId` non nul ; un échec n'arrête pas la boucle (pattern `refreshAllClubs`). Sert de backfill ET rattrapage webhook.

**Webhook** (`platform-billing-webhooks.ts`, case invoice.paid/payment_failed) : conserver le flip de statut, **ajouter** `await upsertInvoice(invoice, type === 'invoice.paid' ? 'paid' : 'failed')` dans le try/catch best-effort existant (toujours répondre 200).

**Route** (`backend/src/routes/platform.ts`) : `POST /billing/sync-invoices` → `syncAllInvoices()` (déjà derrière `requireSuperAdmin` via app.ts).

**Tests** : `src/services/__tests__/platformInvoices.test.ts` (invoiceFields pré-Basil/Basil/override/montants ; upsert résolution club + skip ; sync pagination has_more + échec non bloquant — mock `jest.mock('../../db/stripe')` AVANT import, `import '../../__mocks__/prisma'` en 1re ligne) ; étendre `platform-billing.webhook.test.ts` (upsert appelé, updateMany toujours appelé) ; nouveau `src/routes/__tests__/platform.billing.routes.test.ts` (401/403/200).

## Lot 2 — Fiche club `/superadmin/clubs/[id]` + actions abonnement

**Backend `stripeBilling.ts`** (rétro-compatible) : `changeSubscriptionTier(subId, newTier, newInterval?)` (absent = cadence courante — cron mensuel inchangé) ; nouveau `resumeAtPeriodEnd(subId)` (`cancel_at_period_end: false`).

**Nouveau `backend/src/services/platformBilling/subscriptionAdmin.ts`** — wrappers avec gardes (erreurs mappées `ERROR_STATUS` : `NO_SUBSCRIPTION` 409, `TIER_INVALID`/`VALIDATION_ERROR` 400, `CLUB_NOT_FOUND` 404) :
- `setClubSubscriptionTier(clubId, tier, interval?)` — tier 1..4 ; abonnement live requis (null/canceled → NO_SUBSCRIPTION) ; Stripe puis update DB locale (le webhook `subscription.updated` resynchronise de toute façon).
- `cancelClubSubscription(clubId)` / `resumeClubSubscription(clubId)` — idempotents.

**`platform.service.ts`** :
- `listClubs()` : select subscription élargi à `{status, tier, interval, currentPeriodEnd, cancelAtPeriodEnd}`, billing gagne `subscription: {...} | null` (canceled → null). **`subscribedTier` conservé** (compat tests/front).
- Nouveau `getClubDetail(id)` → `{ id, slug, name, city, address, timezone, status, createdAt, aliases[], owners[], counts{adherents,resources,reservations,tournaments,events}, billing{exempt, activeMembers, countedAt, observedTier, state, subscription{status,tier,interval,priceCents,currentPeriodEnd,cancelAtPeriodEnd}|null, snapshots[12 desc], invoices[24 desc]}, activity{reservationsByMonth[12 asc], reservations30d, lastReservationAt} }`. Série mensuelle : `findMany({where: {resource:{clubId}, status:'CONFIRMED', createdAt:{gte}}, select:{createdAt}})` bucketé via helpers purs `lastMonths`/`bucketByMonth` (créés dès ce lot dans `platformStats.service.ts`). `CLUB_NOT_FOUND` si absent.

**Routes `platform.ts`** : `GET /clubs/:id`, `POST /clubs/:id/billing/tier` {tier, interval?}, `POST /clubs/:id/billing/cancel`, `POST /clubs/:id/billing/resume`.

**Frontend `lib/api.ts`** : types `PlatformInvoiceRow`, `PlatformClubDetail`, extension additive `PlatformClubBilling.subscription?` ; méthodes `platformClubDetail`, `platformSetSubscriptionTier`, `platformCancelSubscription`, `platformResumeSubscription`, `platformSyncInvoices`.

**Frontend helpers/composants** :
- `lib/platformBilling.ts` (pur, testé) : `BILLING_STATE_LABEL` (factorise le map inline de clubs/page.tsx + admin/billing), `invoiceStatusLabel`, `intervalLabel`, `formatPeriod`.
- `lib/platformStats.ts` (pur, testé) : `countBarsModel(series)` (géométrie miroir de `revenueChartModel` pour des entiers), `centsSeriesToDecimal` (pont vers `MonthlyRevenueChart`), `daysSince(iso, nowIso)`.
- Extractions : `components/superadmin/ChangeSlugDialog.tsx` (depuis clubs/page.tsx, tel quel) ; `components/billing/MemberGauge.tsx` (+`gaugePercent`, depuis `app/admin/billing/page.tsx` — **`AdminBilling.test.tsx` doit rester vert**).
- Nouveaux : `components/superadmin/KpiCard.tsx` (Card dashboard + `href?`), `components/superadmin/TierChangeDialog.tsx` (grille paliers via `lib/platformTiers.ts`, segmenté mensuel/annuel, avertissement « effectif à la prochaine facture, sans prorata »), `components/superadmin/CountBarsChart.tsx` (SVG sur countBarsModel, langage MonthlyRevenueChart).

**Page `app/superadmin/clubs/[id]/page.tsx`** (`'use client'`, id via `useParams()` — pas de `await params`) : ① en-tête identité (nom, pill statut, slug.palova.fr, aliases, gérants) ; ② actions club (Suspendre/Réactiver, Exonérer, Changer l'alias — ConfirmDialog/ChangeSlugDialog, reload après action) ; ③ billing (badge état, MemberGauge, observé vs souscrit, échéance, actions abonnement grisées + message si `subscription === null`) ; ④ historique (snapshots 12 mois + table factures avec lien `hostedInvoiceUrl`) ; ⑤ activité (CountBarsChart résas/mois, compteurs, dernière résa). Hydration-safe : pas de `new Date()` au rendu.

**Page `clubs/page.tsx`** : champ recherche client-side (nom/slug/ville/email gérant), nom du club → `<Link href=/superadmin/clubs/${id}>`, actions existantes conservées dans la table. **`layout.tsx`** : état actif par `startsWith(href + '/')`.

**Tests** : backend `subscriptionAdmin.test.ts`, extensions `platform.service.test.ts` (getClubDetail), `stripeBilling.test.ts` (interval, resume), routes ; front `SuperAdminClubDetail.test.tsx` (mock `useParams`), `SuperAdminClubs.test.tsx` (recherche + lien), libs `platformBilling`/`platformStats`, **ne pas casser `SuperAdminClubsSlug.test.tsx`** (champ subscription optionnel).

## Lot 3 — Vue d'ensemble `/superadmin/billing`

**Backend** : factoriser la boucle billing de `getStats()` en helper pur `aggregateBilling(clubs)` dans `platformBilling.service.ts` (→ `{mrrCents, byTierObserved, byTierSubscribed, toRegularize, pastDue}` ; réponse `getStats` **inchangée**). Compléter `platformStats.service.ts` : `billingOverview(now?)` → `{ mrrCents, toRegularize, pastDue, byTierObserved, byTierSubscribed, revenueByMonth[12 asc depuis PlatformInvoice 'paid', bucket paidAt??createdAt], totalCollectedCents, invoiceCount }`. Route `GET /billing/overview`.

**Frontend `app/superadmin/billing/page.tsx`** : ① rangée KpiCard (MRR, Encaissé total, À régulariser, Impayés) ; ② **CA encaissé/mois = `MonthlyRevenueChart` réutilisé tel quel** via `centsSeriesToDecimal` ; ③ répartition par palier (barres divs locales `TierBars`, observé vs souscrit, `tierLabel`) ; ④ table clubs payants (state ≠ FREE ou subscription non null : lien fiche, état, palier souscrit vs observé, cadence, échéance, mention annulation) ; ⑤ bouton « Synchroniser Stripe » → `platformSyncInvoices` + reload. Nav : `{href:'/superadmin/billing', label:'Facturation', icon:'euro'}`.

**Tests** : `platformStats.service.test.ts` (lastMonths/bucketByMonth bords d'année, billingOverview), `platform.service.test.ts` vert après factorisation, route ; front `SuperAdminBilling.test.tsx`.

## Lot 4 — Stats `/superadmin/stats`

**Backend `PlatformStatsService.usageStats(now?)`** → `{ months[12 asc], growth{newClubs[], newUsers[], reservations[]}, activity[{clubId, name, slug, status, activeMembers, reservations30d, lastReservationAt}] }` :
- newClubs/newUsers : findMany createdAt → `bucketByMonth` (volumes faibles).
- reservations : `$queryRaw` `date_trunc('month', created_at AT TIME ZONE 'Europe/Paris')` **avec `status = 'CONFIRMED'`** (les annulées/pending ne sont pas de l'activité).
- activity : un `$queryRaw` (join `reservations`→`resources` sur `resource_id`, `club_id` ; `COUNT FILTER (created_at >= since30)`, `MAX(created_at)`, CONFIRMED only) fusionné en JS avec `club.findMany` (clubs sans résa inclus à 0/null), tri `reservations30d` desc. `activeMembers` = `Club.activeMemberCount` (déjà pré-calculé par le cron nocturne — zéro coût).
- Route `GET /stats/usage`.

**Frontend `app/superadmin/stats/page.tsx`** : ① 3 cartes croissance (CountBarsChart ×3 : clubs, joueurs, réservations ; total 12 mois en sous-titre) ; ② table classement activité (rang, club → lien fiche, résas 30j, membres actifs, dernier signe de vie via `daysSince`, pill statut). Nav : `{href:'/superadmin/stats', label:'Statistiques', icon:'chart'}`.

**Tests** : backend usageStats (mock `$queryRaw` ×2, mois manquants comblés à 0, fusion clubs sans résa, tri), route ; front `SuperAdminStats.test.tsx`, `platformStats.test.ts` (countBarsModel géométrie/max 0, daysSince).

## Lot 5 — Finitions

1. `app/superadmin/page.tsx` : Card locale → `KpiCard` ; MRR/À régulariser/Impayés cliquables → `/superadmin/billing`, Clubs → `/superadmin/clubs`.
2. `CLAUDE.md` : nouvelle section « Superadmin v2 » (routes, migration, tests, hors-v1 : cache stats, export CSV, remboursements).
3. Suites complètes + tsc.

## Pièges connus du repo

- Migrations : SQL manuel + `prisma db execute` (dev) / `migrate deploy` (prod). JAMAIS `migrate dev`/`db push`.
- Types Stripe : structurels inline (`StripeInvoiceLike`), tolérer les 2 formes d'API (subscription id, lookup_key absent en Basil → repli PlatformSubscription).
- Webhook : `express.raw`, toujours 200 après signature valide, upsert dans le try/catch best-effort.
- Tests backend : `import '../../__mocks__/prisma'` en 1re ligne, `jest.mock('../../db/stripe')` avant l'import du module ; jest via `node node_modules/jest/bin/jest.js` (shims .bin cassés).
- Tests front superadmin : pas de ClubNav monté → recette simple `jest.mock('../lib/api')` + `ThemeProvider` ; mocker `next/navigation` pour `useParams`.
- Frontend jest ne type-check pas → `node node_modules/typescript/bin/tsc --noEmit` en gate séparée.
- Miroir paliers : `frontend/lib/platformTiers.ts` ↔ `backend/.../tiers.ts` (ne rien dupliquer d'autre).
- Hydration : pas de `new Date()` au rendu (`daysSince(iso, nowIso)` avec now posé en effet).
- OneDrive coupé ; repo = C:\ProjetsIA\05_PERSO\RESERVE\palova.

## Vérification finale

1. Backend : `node node_modules/jest/bin/jest.js` (backend/) — nouvelles suites + `platform.service`/`stripeBilling`/webhook verts.
2. Frontend : `node node_modules/jest/bin/jest.js` (frontend/) + `node node_modules/typescript/bin/tsc --noEmit` (flake BookingModal full-suite connu → vérifier par suites scopées).
3. Migration dev appliquée (`prisma db execute` + `generate`), backend redémarré (piège backend périmé → 404).
4. Smoke manuel : login `super@palova.fr` → `/superadmin` (KPI cliquables), `/superadmin/clubs` (recherche, lien fiche), fiche club-demo (billing, actions grisées sans abonnement), `/superadmin/billing` (bouton sync → `{clubs, imported}`), `/superadmin/stats` (3 charts + classement). Vérif visuelle via skill `verify` (clair + sombre).
5. `AdminBilling.test.tsx` et `SuperAdminClubsSlug.test.tsx` restent verts (extractions non-régressives).

**Hors v1** : cache/agrégats pré-calculés des stats, export CSV, remboursement de facture depuis l'UI, emails superadmin, changement de cadence seul (passe par TierChangeDialog), pagination serveur de la table clubs.
