# Périmètre STAFF → ADMIN du back-office club (Lot B de l'audit des rôles)

**Date** : 2026-07-16
**Statut** : validé (design approuvé par Eric, décisions de cadrage tranchées)

## Contexte et problème

L'audit des rôles (2026-07-16) a montré que le rôle STAFF est quasi-admin : le routeur
`/api/clubs/:clubId/admin` est monté en `requireClubMember('STAFF')` (admin.ts:182) et seules
6 familles de routes sont surclassées ADMIN (staff-role, coach, level, onboarding-status,
billing, moderation) + 2 OWNER (Stripe Connect, billing checkout/portal). Un staff de comptoir
peut aujourd'hui modifier tous les réglages du club (tarifs, quotas, heures creuses), créer et
supprimer des terrains, changer le prix des offres, éditer l'identité légale (SIRET), et
exporter la comptabilité.

Décision : le STAFF devient un vrai rôle « comptoir » ; la **structure** du club (réglages,
terrains, offres, légal, pilotage comptable) passe sous ADMIN. Le modèle à 3 rôles
OWNER/ADMIN/STAFF est conservé (décision explicite — pas de rôle COACH, pas de matrice de
permissions fines, un ADMIN peut toujours nommer/révoquer un autre ADMIN).

## Décisions de cadrage (tranchées par Eric)

- **Passent en ADMIN** : Réglages du club, terrains (**toutes les écritures**, y compris
  modification/tarif/réordre/activation), création/modification des offres & plans (prix),
  export comptable + **page Comptabilité entière**, **page Contenu & mentions entière**
  (coordonnées légales, pages légales, FAQ).
- **Restent au STAFF** (décision explicite) : résiliation d'abonnements, remboursements,
  suppression de membres — en plus de tout le quotidien (planning, caisse, encaissement,
  ventes, membres, annonces, broadcast, emails, page club, matchs, tournois/events).
- Un ADMIN peut nommer/révoquer un autre ADMIN (comportement actuel conservé).

## Approche

Même pattern que billing/modération : **la vérité est la garde backend**
(`requireClubMember('ADMIN')` posée route par route, défense en profondeur), le frontend
**masque** les entrées de nav et affiche « Cette page est réservée aux administrateurs du
club. » en deep-link (via `useAdminRole()`/`isClubAdmin` — le rôle vient du contexte posé par
le layout, zéro appel API ajouté). Aucune migration, aucune route nouvelle.

## 1. Backend — routes qui passent `requireClubMember('ADMIN')`

Toutes dans `backend/src/routes/admin.ts` (aujourd'hui STAFF implicite via le `router.use`).

### Réglages du club
- `PATCH /` (updateClub — tarification, quotas, heures creuses, visibilité, moyens rapides…)
- `POST /club-logo`, `POST /club-cover` (uploads d'identité)
- `POST /sports`, `PATCH /sports/:clubSportId` (onglet Sports des Réglages)

### Terrains (écritures)
- `POST /resources`
- `PATCH /resources/reorder`
- `PATCH /resources/:id`
- `PATCH /resources/:id/active`
- `DELETE /resources/:id`

### Offres & plans (écritures)
- `POST /packages/templates`, `PATCH /packages/templates/:id`, `POST /packages/templates/:id/image`
- `POST /subscription-plans`, `PATCH /subscription-plans/:id`, `POST /subscription-plans/:id/image`

### Comptabilité
- `GET /accounting/export` (export CSV)

### Contenu & mentions (bloc entier — aucun consommateur staff hors de cette page)
- `GET /pages`, `GET /pages/:kind/template`, `PUT /pages/:kind`
- `GET /faq`, `POST /faq`, `PATCH /faq/reorder`, `PATCH /faq/:id`, `DELETE /faq/:id`

### Restent STAFF (explicitement — des surfaces staff en dépendent)
- `GET /` (getClubForAdmin : planning/caisse lisent quickPaymentMethods, payAtClubOnly…)
- `GET /resources` (planning, caisse, encaissement)
- `GET /sports` (lecture inoffensive)
- `GET /packages/templates`, `GET /packages/active`, `GET /subscription-plans` (la **vente**
  en caisse dépend de ces lectures)
- Vente/recharge/correction des packages membres (`POST /members/:userId/packages*`),
  vente/renouvellement/changement/**résiliation** d'abonnements (`/subscriptions/*`,
  `/members/:userId/subscriptions`)
- `GET /accounting/summary` (consommé par Ventes & journée)
- Remboursements (`POST /payments/:paymentId/refunds`), no-show, encaissements
- Suppression/blocage de membres (avec la garde MEMBER_IS_STAFF du Lot A)
- Broadcast, emails, présentation/photos (Page club), annonces, sponsors, tournois/events,
  matchs, séries, cours — inchangés

## 2. Frontend

### Nav (app/admin/layout.tsx — pattern des entrées Signalements / Abonnement Palova)
5 entrées supplémentaires rendues seulement si `isClubAdmin(role)` :
- **Ressources** (`/admin/courts`) et **Réglages** (`/admin/settings`) et
  **Contenu & mentions** (`/admin/pages`) — section Configuration, qui devient **vide** pour
  un staff. ⚠️ Le rendu actuel de la sidebar ne saute PAS une section sans items (le titre
  serait affiché seul) : ajouter un filtre `items.length > 0` avant le map des sections.
- **Offres** (`/admin/packages`) et **Comptabilité** (`/admin/comptabilite`) — section Finances

### Garde deep-link (pattern /admin/billing)
Chaque page concernée (`/admin/settings`, `/admin/courts`, `/admin/packages`,
`/admin/comptabilite`, `/admin/pages`) lit `useAdminRole()` et, pour un non-admin, rend le
message « Cette page est réservée aux administrateurs du club. » **sans déclencher aucun
fetch** (pas d'appels voués au 403).

### Page club (/admin/club) — reste STAFF, une carte masquée
La carte « Sections du Club-house » (`ClubHouseSectionsCard`, ordre des sections + curseur
kiosque) écrit via `PATCH /` (désormais ADMIN) → **masquée pour un staff**. Présentation,
galerie photos, vitrine : inchangées (routes `/presentation` et `/photos*` restent STAFF).

### Wizard onboarding
Déjà gaté ADMIN (Lot A). Ses appels (`adminUpdateClub`, `adminAddSport`,
`adminCreateResource`, `uploadClubLogo`) deviennent cohérents avec les nouvelles gardes.

## 3. Gestion d'erreur

Le masquage frontend est la première ligne ; les 403 backend restent possibles (session d'un
staff rétrogradé en cours de route). Les pages gatées ne fetchent plus rien pour un non-admin,
donc pas de « Chargement… » infini ni de 403 brut à l'écran (même comportement que
/admin/billing : `loadError` distingue FORBIDDEN si jamais atteint).

## 4. Tests

### Backend (pattern admin.stripe.routes.test.ts : STAFF 403 / ADMIN 200)
Un test par famille déplacée, sur une route représentative au minimum — idéalement chaque
route déplacée :
- Réglages : `PATCH /` en STAFF → 403, en ADMIN → 200 (idem un upload et un write sports)
- Terrains : `POST /resources` + `DELETE /resources/:id` (STAFF 403 / ADMIN 200) ;
  `GET /resources` en STAFF → 200 (non-régression)
- Offres : `POST /packages/templates` + `PATCH /subscription-plans/:id` (403/200) ;
  `GET /packages/active` en STAFF → 200 (non-régression vente)
- Comptabilité : `GET /accounting/export` 403/200 ; `GET /accounting/summary` STAFF → 200
- Pages/FAQ : `PUT /pages/:kind` + `POST /faq` (403/200)

### Frontend
- `AdminLayout.test.tsx` : viewer STAFF → les 5 entrées absentes ; viewer ADMIN → présentes ;
  section Configuration absente pour un staff
- Gardes deep-link : un cas « staff → message réservé admin + aucun fetch » par page gatée
  (dans les suites existantes AdminSettings / AdminPackages / etc., pattern AdminPayments)
- `AdminClub.test.tsx` : carte « Sections du Club-house » présente pour ADMIN, absente pour
  STAFF (le reste de la page rendu normalement)

## 5. Hors périmètre

- Transfert de propriété OWNER, outils support superadmin (impersonation, ban)
- Matrice de permissions fines / rôles personnalisés
- Vue coach « Mes cours » (= Lot C, spec séparée)
- Journal d'audit visible en UI
- Toute modification des gardes OWNER existantes (Stripe, billing checkout/portal)

## Impact

Aucune migration. Effet assumé : les comptes STAFF existants perdent l'accès aux 5 pages du
jour au lendemain — c'est l'objectif (le hint du panneau membre « Staff : accès au
back-office » / « Admin : back-office + gestion du staff et des niveaux » sera reformulé :
Staff = comptoir & quotidien, Admin = + structure du club (réglages, terrains, offres,
légal, comptabilité)).
