# Fusion Membres + Abonnés — design

**Date :** 2026-07-13

## Objectif

Fusionner la page `/admin/abonnes` (créée plus tôt le 2026-07-13) dans `/admin/membres`. Les abonnés
deviennent une **facette du fichier-membres** : la pastille « Abonnés » enrichit la page au lieu
d'ouvrir une surface séparée. Une seule surface, un seul point d'entrée nav.

## Décisions validées (brainstorming)

- **Structure** = filtre « Abonnés » enrichi (pas d'onglets séparés).
- **Boutons de cycle de vie sur les lignes** (échéance + Renouveler / Changer / Résilier) : affichés
  **uniquement en contexte abonnés** (pastille « Abonnés » active). Hors contexte, la ligne d'abonné
  reste sobre (chip « Abonné » seulement).
- **Pilotage** : bandeau compact en contexte abonnés (KPIs revenu/mois + expirent 30 j + cartes par
  forfait cliquables = filtre forfait).
- **Onglet « Abonnement » de la fiche membre** (`/admin/members/[userId]`) : **retiré** (le cycle de
  vie vit sur la ligne). *Réversible si besoin d'historique des abos résiliés.*
- **Sport** : **filtre** (pas de groupement visuel — incompatible avec la liste triée + virtualisée).
- **WIP `members/page.tsx`** (liste virtualisée + recherche débouncée, non committé) : on travaille
  dessus tel quel ; le commit de la fusion inclura ce WIP (accepté par le user).

## Backend (additif, aucune migration)

`ClubService.listMembers` : la requête `subs` (abonnements ACTIFS non expirés, déjà présente) élargit
son `select` à `{ id, planId, expiresAt, monthlyPriceSnapshot, sportKeys, plan.name }`. On construit
`subByUser: Map<userId, MemberSubscription>` (premier abo actif, comme aujourd'hui) et chaque membre
gagne un champ additif :

```ts
subscription: {
  id: string; planId: string; planName: string;
  expiresAt: string /*ISO*/; monthlyPriceSnapshot: string; sportKeys: string[];
} | null
```

`hasActiveSubscription` / `subscriptionPlan` restent (rétro-compat). Aucun autre endpoint ne change.
Le cycle de vie réutilise les routes existantes `POST /subscriptions/:id/{renew,change,cancel}`.

## Frontend

- **`lib/api.ts`** : `Member.subscription?` (type ci-dessus). Type partagé `MemberSubscription`.
- **`MemberRow.tsx`** : nouvelle prop `subscriptionContext?: boolean`. Quand vraie **et** que le membre
  a un `subscription`, la ligne affiche à droite : pastille échéance (`Expire dans N j` coral si < 30 j,
  sinon `Actif`) + `échéance JJ/MM/AAAA`, puis les boutons **Renouveler / Changer / Résilier** (mêmes
  styles que le registre abonnés — helper `actionBtn`). Les boutons émettent une action vers le parent
  (`onSubAction(kind, member)`) — la page monte `SubscriptionActions`.
- **`app/admin/members/page.tsx`** : quand la pastille « Abonnés » est active (`filter === 'subscribers'`) :
  - **Bandeau compact** (composant `SubscriberInsights`) : KPIs *revenu/mois* (Σ `monthlyPriceSnapshot`
    des abonnés visibles) + *expirent < 30 j*, calculés **côté client** depuis la liste déjà chargée ;
    **cartes par forfait** cliquables (compteur d'abonnés ; forfaits sans abonné via
    `adminGetSubscriptionPlans`, fetch paresseux) qui filtrent par `planId`.
  - **Sous-filtres d'abonnement** : *Expirent bientôt* (< 30 j) + *Sport* (si club ≥ 2 sports),
    en plus du filtre forfait porté par les cartes.
  - Les `MemberRow` reçoivent `subscriptionContext`. Un clic sur Renouveler/Changer/Résilier ouvre
    `SubscriptionActions` (déjà partagé), `onDone` → `load()`.
- **Suppression** : page `app/admin/abonnes/page.tsx` + entrée nav « Abonnés » (`admin/layout.tsx`).
  Le corps riche de la page abonnés (KPIs/cartes/registre groupé) n'est **pas** réutilisé tel quel —
  la fusion s'appuie sur la liste membres ; on ne garde que `SubscriptionActions` + `subscriptionAdmin.ts`.
- **Retrait** : onglet « Abonnement » de `app/admin/members/[userId]/page.tsx` (state/loader/tab/dialog
  ajoutés au T10) — le cycle de vie est désormais sur la ligne.

## Hors périmètre

- Groupement visuel par sport (remplacé par filtre).
- Historique des abonnements résiliés dans l'UI (l'onglet fiche est retiré ; le backend garde tout).
- Achat/vente d'un nouvel abonnement depuis la liste (reste `POST /members/:userId/subscriptions`,
  UI de vente inchangée ailleurs).

## Tests

- Backend : `club.service.test` — `listMembers` expose `subscription` (id/expiresAt/prix/sport) pour un
  abonné, `null` sinon.
- Frontend :
  - `MemberRow` : en `subscriptionContext`, un abonné affiche échéance + 3 boutons ; masqués hors contexte.
  - `AdminMembers` : pastille « Abonnés » → bandeau KPIs + cartes forfait ; filtre « Expirent bientôt » ;
    action Résilier sur une ligne appelle `adminCancelSubscription`.
  - `AdminLayout` : plus d'entrée nav « Abonnés ».
  - `MemberHistory` : plus d'onglet « Abonnement ».
  - Suppression de `AdminSubscribers.test` (page supprimée) ; `subscriptionAdmin.test` conservé.
