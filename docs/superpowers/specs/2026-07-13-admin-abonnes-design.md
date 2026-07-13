# Admin « Abonnés » — registre, stats par forfait et cycle de vie des abonnements

**Date** : 2026-07-13
**Statut** : validé (maquettes comparées dans le companion visuel — piste B « page dédiée » retenue parmi 3)

## Problème

L'admin peut **vendre** un abonnement (`/admin/caisse`) mais ensuite il est aveugle :

- **Voir** : le tableau membres n'affiche qu'un badge « Abonné » (ni forfait, ni échéance) ; la fiche membre n'a qu'une puce ; la caisse montre les carnets d'un acheteur mais pas ses abonnements. La donnée existe pourtant (`GET /admin/members/:userId/subscriptions`) — affichée nulle part.
- **Modifier** : impossible. `SubscriptionService.cancelSubscription` existe (testé) mais n'est branché à **aucune route ni écran**. Ni renouvellement, ni changement de forfait.
- **Stats** : seul un compteur global d'abonnés sur `/admin/members`. Aucune ventilation par forfait, aucun revenu, aucune vue des échéances.

## Contexte modèle (contraintes qui ont tranché le design)

- **Pas de reconduction automatique** : une `Subscription` est une **période vendue** (`startedAt → expiresAt`, snapshot du plan : prix, sports, avantage, plafonds). Rien ne se renouvelle seul → « résilier à l'échéance » n'a pas de sens ; seule la résiliation **immédiate** existe.
- `sellSubscription` crée **une nouvelle ligne démarrant aujourd'hui** → revendre à un abonné actif lui ferait perdre ses jours restants. Le renouvellement doit **prolonger la même ligne**. Le modèle y est préparé : `salePayments Payment[]` est pluriel, la vente note « 1re mensualité ».
- Les plans sont **multi-sports par conception** (`sportKeys: String[]`) ; la couverture d'un créneau vérifie déjà le sport (`coverageFor`) et la part couverte utilise la capacité du bon sport. La page est donc sport-agnostique ; on ajoute seulement des chips sport gatées multi-sport.
- Évolution liée (même jour) : un abonnement couvre désormais **une part nominale** (prix ÷ capacité), jamais toute la partie — au booking comme au balayage caisse.

## Décision — architecture (piste B)

Une **page dédiée « Abonnés »** (nav **Finances**, icône `bolt`) = poste de pilotage, **plus** un **bloc partagé sur la fiche membre** (même composant d'actions). Pistes rejetées : A « tout sur la fiche membre » (pas de vue d'ensemble — impossible de répondre à « qui expire ce mois-ci ? ») ; C « hub Offres enrichi » (la page Offres ferait deux métiers, pas de recherche transverse par membre).

## Sémantiques du cycle de vie (validées)

| Action | Comportement |
|---|---|
| **⟳ Renouveler** | **Prolonge la même Subscription** : `expiresAt = max(now, expiresAt) + commitmentMonths` (du plan) — un abo expiré depuis peu se renouvelle sans trou ni chevauchement. Paiement « mensualité » au **tarif snapshot du membre** (`monthlyPriceSnapshot`, son tarif contractuel — pas le prix courant du plan), moyen choisi (boutons rapides). Refusé sur un abo CANCELLED (`SUBSCRIPTION_NOT_RENEWABLE` 409) → passer par une vente neuve. |
| **✎ Changer de forfait** | **Une transaction** : résilie l'actuel (CANCELLED) + vend le nouveau (nouvelle ligne, snapshot du nouveau plan, démarre aujourd'hui, plein tarif 1re mensualité). **Pas de prorata en v1** — le dialog l'annonce ; ajustement = geste manuel en caisse. |
| **✕ Résilier** | **Immédiat** (status CANCELLED). **Pas de remboursement automatique** (cohérent avec toute l'app : recrédit = geste manuel). ConfirmDialog avec le nom du plan et l'échéance perdue. |

## Backend (aucune migration)

`SubscriptionService` :

- **`overview(clubId)`** → `{ kpis, plans, subscribers }` :
  - `kpis` : `activeCount` (subs ACTIVE non expirées, **utilisateurs distincts**), `monthlyRevenueCents` (Σ `monthlyPriceSnapshot` des actives), `expiringSoonCount` (actives expirant sous 30 j).
  - `plans` : tous les plans du club (actifs et non) + `activeCount` par plan.
  - `subscribers` : **toutes** les subscriptions du club (l'onglet Historique en a besoin ; échelle club OK), avec `user { id, firstName, lastName, avatarUrl }`, `planName`, dates, statut, `monthlyPriceSnapshot`, `sportKeys`, tri `expiresAt` croissant sur les actives puis historique décroissant.
- **`renewSubscription(id, clubId, { method, payerName, voucherRef, voucherIssuer, createdByUserId })`** — transaction Serializable : garde club, statut ACTIVE requis, prolonge, crée le `Payment` (`subscriptionId`, `receiptNo`, note « Renouvellement abonnement {plan} — mensualité », VOUCHER ⇒ ref obligatoire comme la vente).
- **`changeSubscription(id, clubId, { planId, method, … })`** — transaction : cancel + logique de vente (factorisée avec `sellSubscription` — extraire un helper privé de création période+paiement plutôt que dupliquer). Gardes `SUBSCRIPTION_NOT_FOUND`/`PLAN_NOT_FOUND`.
- `cancelSubscription` : inchangé, enfin routé.

Routes `admin.ts`, derrière `requireClubMember('STAFF')` (comme la caisse) :
`GET /subscriptions/overview` · `POST /subscriptions/:id/renew` · `POST /subscriptions/:id/change` · `POST /subscriptions/:id/cancel`.
Codes : `SUBSCRIPTION_NOT_FOUND` 404, `PLAN_NOT_FOUND` 404, `SUBSCRIPTION_NOT_RENEWABLE` 409, `VALIDATION_ERROR` 400.

## Frontend

- **Page `app/admin/abonnes/page.tsx`** (entrée nav « Abonnés », groupe Finances, icône `bolt`, dans `app/admin/layout.tsx`) :
  - **KPIs** en tuiles (⚡ actifs · € revenu/mois · ⏳ expirent sous 30 j — tuile abricot).
  - **Cartes forfait** : liseré accent (couleurs cyclées `ACCENTS`), nom, prix + avantage, **compteur d'abonnés** en display, jauge (part du total des actifs), chip sport si club multi-sport ; forfait à 0 abonné estompé ; **clic = filtre le registre** sur ce plan.
  - **Registre** : recherche par nom, chips `Actifs / Expirent bientôt / Historique`, lignes-cartes (avatar `colorForSeed`, nom → lien fiche membre, plan + « depuis le … », pill statut — « Expire J-x » abricot + liseré latéral abricot si < 30 j —, actions inline ⟳ ✎ ✕).
  - Horloge posée en effet (`now` hydration-safe, pattern maison), montants via helpers centimes.
- **Dialogs d'action** (partagés) : `components/admin/subscriptions/SubscriptionActions.tsx` —
  - *Renouveler* : récap (plan, tarif snapshot, nouvelle échéance calculée) + **boutons moyen rapides** du club (pattern caisse, `payAtClubOnly` respecté → bouton unique « Encaissé »), VOUCHER → champ référence.
  - *Changer* : sélecteur des autres plans actifs (cartes mini), avertissement « l'abonnement actuel est résilié, le nouveau démarre aujourd'hui au plein tarif — pas de prorata », choix du moyen.
  - *Résilier* : `ConfirmDialog` existant.
- **Fiche membre `/admin/members/[userId]`** : 6ᵉ onglet **« Abonnement »** — carte de l'abo actif (plan, tarif, avantage, période, actions via le composant partagé) + historique des périodes. Données : `adminGetMemberSubscriptions` (existant). La puce « Abonné » de l'en-tête devient un lien vers l'onglet.
- **Helpers purs testés `lib/subscriptionAdmin.ts`** : `isActiveSub(sub, now)`, `expiresSoon(sub, now)` (< 30 j), `subscriberKpis(subs, now)`, `planCounts(subs, now)`, `filterRegistry(subs, { query, mode, planId }, now)`, libellés (`benefitLabel` réutilise `coverageLabel`).
- `lib/api.ts` : types `SubscriptionOverview`/`SubscriberRow` + `adminGetSubscriptionOverview`, `adminRenewSubscription`, `adminChangeSubscription`, `adminCancelSubscription`.
- Chips sport : gating `clubIsMultiSport` (pattern `lib/sportBadge.ts`).

## Tests

- **Backend** : `subscription.service` (overview : KPIs/comptage distinct/expirant ; renew : prolonge depuis `max(now, expiresAt)`, paiement snapshot, CANCELLED refusé, VOUCHER sans ref refusé ; change : atomique, snapshot du nouveau plan, gardes) ; `admin.routes` (4 routes, STAFF ok, codes d'erreur).
- **Frontend** : `subscriptionAdmin.test.ts` (helpers purs) ; `AdminSubscribers.test.tsx` (KPIs, filtre par plan au clic, recherche, chips, actions → bons appels API) ; `MemberHistory`/fiche membre (onglet Abonnement, actions) ; `AdminLayout` (entrée nav).

## Hors périmètre v1

Prorata au changement de forfait · remboursement automatique à la résiliation · relances email avant échéance · reconduction automatique (Stripe récurrent) · export CSV du registre · achat en ligne du renouvellement par le joueur (le Club-house vend déjà la 1re mensualité).
