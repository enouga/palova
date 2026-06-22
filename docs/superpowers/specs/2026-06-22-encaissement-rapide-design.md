# Encaissement rapide sur « Réservations & paiements »

**Date :** 2026-06-22
**Statut :** Design validé

## Problème

Deux surfaces gèrent l'encaissement, mais de façon inégale :

- **`/admin/planning`** — la modale de détail d'une réservation offre un
  encaissement **riche** : répartition **par joueur**, chips de **montants
  rapides**, **moyens 1-clic** (Espèces/Carte/Virement/Ticket CE/Abo-Membre/
  Autre), Ticket CE avec référence/émetteur, paiement par **carnet/
  porte-monnaie**.
- **`/admin/reservations`** (« Réservations & paiements ») — le panneau
  « Encaisser » est **primitif** : un montant, un menu déroulant de moyen, un nom
  de payeur. Pas de répartition par joueur, pas de moyens 1-clic, pas de
  prépayés, pas de Ticket CE. La page n'a qu'un **filtre par jour** (et affiche
  « tout » par défaut), aucun filtre par heure, aucune recherche.

La logique métier est pourtant **déjà** factorisée dans `lib/caisse.ts`
(`dueCents`, `quickAmounts`, `paymentDots`, `validatePaymentAmount`…) et dans des
composants partagés (`PlayerPicker`, `PaymentDots`) ; seule l'UI d'encaissement
riche est dupliquée/absente.

## Objectif

Mettre la page « Réservations & paiements » au niveau de la pop-up planning pour
l'encaissement, et l'orienter **comptoir** : filtres rapides (plage horaire +
« En ce moment », « À encaisser », recherche par nom), bouton **« Solder »**
1-clic, et **reçu imprimable**. Le tout en **factorisant** l'encaissement riche
dans un composant partagé utilisé par les **deux** pages.

## Périmètre

- **Aucune migration. Aucun changement backend** : tous les endpoints existent
  déjà et sont utilisés par le planning — `adminAddPayment` (avec
  `participantId` / `voucherRef` / `voucherIssuer` / `sourcePackageId`),
  `adminGetMemberPackages`, `adminAssignReservationMember`,
  `adminAddReservationParticipant`, `adminRemoveReservationParticipant`,
  `adminGetResources`, `adminGetClub`. Le type `ClubReservation` expose déjà
  `participants` (`ParticipantBill[]`), `dueAmount`, `paidAmount`, `payments`,
  `hasCardFingerprint`.
- **Approche A retenue** (composant partagé) : extraction de l'encaissement riche
  du planning dans `components/admin/CollectPanel.tsx`, consommé par le planning
  **et** la page Réservations.
- Orientation comptoir : la page Réservations **défaut sur aujourd'hui** (au lieu
  de « tout »), lien « Tout afficher » conservé.

## Conception

### 1. Composant partagé `components/admin/CollectPanel.tsx`

Extraction du bloc d'encaissement riche actuellement **inline** dans
`frontend/app/admin/planning/page.tsx` (≈ lignes 718-845) **et** des handlers
associés (`payNow`, `payWithPackage`, `assignPlayer`, `addParticipant`,
`removeParticipant`, `createAndAssign`, `createAndAddParticipant`, état
`payAmount` / `payParticipantId` / voucher / packages / busy).

Interface :

```ts
interface CollectPanelProps {
  reservation: ClubReservation;
  due: number;        // centimes ; calculé par le parent via dueCents()
  players: number;    // nb de joueurs du terrain (single=2 / double=4) via playerCount()
  members: Member[];
  clubId: string;
  token: string;
  onChanged: (updated?: ClubReservation) => void; // mutation réussie → le parent recharge
  onError?: (msg: string) => void;
}
```

- Le panneau **charge lui-même** les carnets/porte-monnaie utilisables du joueur
  (`adminGetMemberPackages`, filtrés `isUsable`) au montage et à chaque
  changement de `reservation.user?.id`.
- Contenu (identique à l'actuel planning) :
  - **Par joueur** : liste des `participants` avec part `payé / dû`, bouton
    « Régler » (présélectionne le montant), retrait (× — l'organisateur ne part
    pas tant qu'il reste des joueurs), `PlayerPicker` « + Ajouter un joueur »
    (création à la volée incluse) tant que `participants.length < players`.
  - **Montant** : `<input>` + chips `quickAmounts(due, paid, players)` (Total /
    Reste / ÷ joueur), bord rouge + boutons désactivés au-delà du plafond
    (`validatePaymentAmount`).
  - **Moyens 1-clic** : `COUNTER_METHODS` (Espèces/Carte/Virement/Ticket CE/
    Abo-Membre/Autre) ; Ticket CE ouvre la saisie référence/émetteur en 2 temps
    (référence optionnelle).
  - **Prépayés** : boutons carnet/porte-monnaie (`packageLabel`, `canCover`),
    sinon `prepaidHint`.
- Après chaque mutation réussie : `onChanged(updated?)` (le parent recharge la
  liste du jour ; pour assign/add/remove qui renvoient la résa à jour, le parent
  la re-dérive par id). Les erreurs métier sont traduites en FR et remontées via
  `onError` (réutilise les messages existants : `PAYMENT_EXCEEDS_DUE`,
  `INSUFFICIENT_BALANCE`, `TOO_MANY_PLAYERS`, `MEMBER_NOT_FOUND`…).
- **Planning** : sa modale rend `<CollectPanel reservation={selected}
  due={dueOf(selected)} players={playersOf(selected)} … onChanged={() => { load();
  /* re-dérive selected */ }} />` à la place des ≈ 125 lignes inline → la page
  maigrit, comportement inchangé.

### 2. Page Réservations refondue (`frontend/app/admin/reservations/page.tsx`)

- **Chargement** aligné sur le planning : `adminGetClub` (`timezone`,
  `offPeakHours`, `name`, `address` pour le reçu) + `adminGetResources`
  (format single/double + tarifs, pour `playerCount` et `dueCents`) +
  `adminGetReservations` + `adminGetMembers`. `resById` comme dans le planning.
- **Défaut sur aujourd'hui** (`todayISO()`), lien « Tout afficher » remet
  `date=''`.
- Table compacte conservée. Le **dû** d'une ligne passe de
  `Number(totalPrice)` à `dueCents(r, resById.get(r.resourceId), peak, tz)` —
  corrige le cas « tarif terrain sans prix de résa » (déjà géré côté planning).
- Le bouton **« Encaisser »** ouvre une **modale** (même pattern visuel que la
  modale planning) contenant `<CollectPanel>`. `onChanged` recharge + met à jour
  la résa sélectionnée ; fermeture standard.
  - *(Alternative non retenue : panneau inline déroulant comme aujourd'hui — la
    modale est choisie pour coller à la pop-up planning, référence de
    l'utilisateur.)*
- Bandeau résumé (« Total dû / Encaissé / Reste dû ») recalculé sur la **vue
  filtrée** (cf. §4) plutôt que sur `summary` brut.

### 3. « Solder » 1-clic

Sur chaque ligne avec reste dû (`due - paid > 0`, hors annulée) :

- Bouton **« Solder »** qui encaisse **tout le reste** avec un **moyen par
  défaut** mémorisé en `localStorage` (`palova:solder-method`, init `CASH`), +
  petit caret pour changer le moyen avant de solder.
- Appelle `adminAddPayment(clubId, r.id, { amount: reste€, method }, token)` puis
  recharge.
- Le bouton « Encaisser » riche reste pour les cas par-joueur / Ticket CE /
  carnet.

### 4. Filtres — helpers purs `lib/collect.ts` (testés)

Tous **client-side** sur les réservations déjà chargées (pas de nouvel
endpoint). Combinaison **ET** entre dimensions.

- **Plage horaire** : sélecteurs `De [h] à [h]` + chip **« En ce moment »**
  (cale `date=aujourd'hui`, début = heure courante, fin = fermeture). Une résa
  matche si son créneau **recoupe** la fenêtre `[from, to)` en **fuseau club**
  (miroir de la logique `localMinutes` du planning).
  `overlapsHourWindow(rv, from, to, tz): boolean`.
- **« À encaisser »** : segment `Tout | À encaisser | Payées`.
  `outstandingFilter(rv, due, paid, mode): boolean` — « À encaisser » =
  `due - paid > 0` & non annulée ; « Payées » = soldée.
- **Recherche par nom** : champ texte, `matchesQuery(rv, q): boolean` sur
  nom/prénom du joueur, intitulé (`title`), email — insensible casse/accents.

### 5. Reçu imprimable

- Bouton **« Reçu »** sur chaque paiement listé (dans la modale) → modale print
  (même pattern `@media print` que `/admin/caisse`) réutilisant `Receipt`.
- Adaptateur pur : construire un `CaissePayment` depuis la résa + le paiement —
  `{ ...payment, reservation: { id, startTime, resource: { name }, user },
  memberPackage: null }` → le reçu affiche « Terrain X – HH:MM ». Nom/adresse du
  club déjà chargés.

## Tests (TDD)

- **`lib/collect.ts`** (purs) : `overlapsHourWindow` (créneau dans/à cheval/hors
  fenêtre, fuseau), « en ce moment », `outstandingFilter` (3 modes),
  `matchesQuery` (nom/intitulé/email, accents).
- **`CollectPanel`** : encaissement 1-clic (montant + moyen → `adminAddPayment`
  appelé), plafond (bouton désactivé au-delà du dû), répartition par joueur
  (Régler présélectionne), Ticket CE (réf en 2 temps), paiement par carnet.
- **Page Réservations** : défaut aujourd'hui, filtres (plage / à-encaisser /
  recherche), ouverture modale, « Solder » (encaisse le reste avec le moyen
  mémorisé), reçu.
- **Non-régression planning** : la modale rend `<CollectPanel>` et conserve son
  comportement (relancer la suite planning ; mocks `lib/api` à exposer les mêmes
  méthodes + `assetUrl`).

## Découpage (subagent-driven, worktree hors OneDrive)

1. **Lot 1** — extraction `CollectPanel` + branchement de la modale planning
   dessus (+ non-régression planning verte).
2. **Lot 2** — refonte page Réservations : chargement aligné, modale
   `<CollectPanel>`, dû via `dueCents`, défaut aujourd'hui, reçu imprimable.
3. **Lot 3** — filtres `lib/collect.ts` (plage + « En ce moment » + « À
   encaisser » + recherche) + bouton « Solder » 1-clic.
4. **Revue finale holistique** end-to-end (les revues par-lot ne suffisent pas —
   cf. bugs cross-layer rattrapés sur les features précédentes).

Worktree hors OneDrive (parade aux collisions du dev parallèle sur le planning),
push FF sur `main` après gate verte (back + front + `tsc`).

## Hors périmètre

- Tout changement backend / migration.
- Recrédit automatique à l'annulation, export comptable (restent des évolutions
  Caisse séparées).
- Encaissement en ligne (Stripe) — non concerné.
- La 2e surface de réservation `frontend/app/courts/[id]/page.tsx` (front public).
