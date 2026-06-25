# Encaissement par porte-monnaie / carnet en paiement rapide — design

**Date :** 2026-06-25
**Statut :** validé (brainstorming)

## Problème

Les offres prépayées (carnets `ENTRIES`, porte-monnaie `WALLET`) peuvent déjà
être **vendues** (`/admin/caisse`) et **consommées** en ligne ou via la modale
d'encaissement. Deux manques à l'usage comptoir :

1. **Pas de bouton rapide « Porte-monnaie ».** Sur la page Encaissement
   (`/admin/reservations`) les boutons 1 clic ne proposent que les moyens
   « argent » (Carte / Ticket CE / Espèces…). Le prépayé est volontairement
   exclu des moyens rapides configurables (`Club.quickPaymentMethods`) parce
   qu'un paiement prépayé exige un `sourcePackageId` (le solde précis à débiter,
   propre à **un joueur**) — il ne peut donc pas être un moyen « fixe », il doit
   être **contextuel** (présent seulement quand le joueur a un solde utilisable).

2. **Bug modale : payer une part avec le porte-monnaie ne marche pas.** Dans
   `CollectPanel`, le bouton porte-monnaie (`payWithPackage`) encaisse `rest`
   (= part du joueur *sélectionné via son bouton « Régler »*, sinon **le reste
   entier de la résa**) — il **ignore le montant saisi**. La puce « / joueur
   13 € » ne fait que remplir le champ montant sans sélectionner le joueur :
   on voit 13 €, mais le clic Porte-monnaie encaisse 52 €.

## Acquis (rien à changer côté backend paiement)

`ReservationService.addPayment` sait déjà :
- encaisser un montant **partiel** d'une résa ;
- avec `method` `WALLET`/`PACK_CREDIT` + `sourcePackageId` ;
- attribué à un joueur (`participantId`) **ou** à la résa entière ;
- avec **garde de propriété** : `pkg.userId === (participant ? participant.userId
  : reservation.userId)`, sinon `PACKAGE_NOT_FOUND` ;
- consommation par **décrément conditionnel** (`PackageService.consume`),
  `INSUFFICIENT_BALANCE` si solde insuffisant / expiré.

`ParticipantBill` expose déjà `userId` → on peut rattacher chaque joueur (place)
à **son propre** solde. Le seul ajout backend nécessaire est un endpoint de
**lecture en masse** des soldes actifs du club (la page affiche plusieurs
joueurs d'un coup).

## Approche retenue

**A — un endpoint « soldes actifs du club », chargé une fois et indexé par
joueur.** Réutilisé par la page Encaissement *et* par la modale (cohérence ; fait
marcher le porte-monnaie d'un **co-équipier**, pas seulement du titulaire).

Écartées : (B) fetch par joueur à la volée → N appels réseau par jour affiché ;
(C) bouton dans la modale seulement → ne répond pas à la demande (les 3 surfaces).

## Conception

### Backend (additif)

- `PackageService.listActiveByClub(clubId)` : `MemberPackage` **utilisables**
  (non expirés : `expiresAt == null || > now` ; solde > 0 : `creditsRemaining >= 1`
  pour ENTRIES, `amountRemaining > 0` pour WALLET), avec `userId`, `kind`,
  `creditsRemaining`, `amountRemaining`, `expiresAt`, et le nom de l'offre
  (`template.name`). Triés `purchasedAt asc`.
- Route `GET /api/clubs/:clubId/admin/packages/active` (derrière
  `authMiddleware` + droits admin du club, même garde que les autres routes
  `/admin/...`), placée près des routes packages existantes dans `routes/admin.ts`.
- **Aucune** modification de `addPayment`, `consume`, ni des migrations.

### `lib/api.ts`

- Type retourné : `ActiveMemberPackage = MemberPackage & { userId: string }`
  (le `userId` n'est porté que par ce type ; `MemberPackage` reste inchangé,
  puisque `adminGetMemberPackages` interroge déjà un `userId` connu).
- `adminGetActivePackages(clubId, token): Promise<ActiveMemberPackage[]>`.

### `lib/packages.ts` (helper pur, testé)

```
pickPackageFor(
  packages: MemberPackage[],     // soldes utilisables d'UN joueur
  amountCents: number,           // montant à couvrir
  kind?: 'ENTRIES' | 'WALLET',   // filtre éventuel
): MemberPackage | null
```
Retourne le 1ᵉʳ solde du joueur qui **couvre** le montant
(`canCover`, déjà existant : carnet utilisable → toujours vrai ; porte-monnaie →
`amountRemaining >= amount`), `null` sinon. La page/modale construisent une
`Map<userId, MemberPackage[]>` à partir de `adminGetActivePackages` et passent à
ce helper la liste du joueur concerné.

### Pages `/admin/reservations` et `/admin/planning`

- Nouvel état `packagesByUser: Record<string, MemberPackage[]>` (ou `Map`),
  rempli au chargement via `adminGetActivePackages` (groupé par `userId`).
- **Rechargé à la réconciliation** (après encaissement / remboursement /
  mutation joueur) en parallèle du rechargement des réservations — pour que le
  solde affiché sur le bouton **baisse** après un paiement prépayé.
- Passé en prop à `ReservationCollect` (page) et à `CollectPanel` (modale +
  planning).

### `ReservationCollect` (page Encaissement)

- Nouvelle prop `packagesByUser`.
- `pay(amountCents, method, participantId?, sourcePackageId?)` : ajoute
  `sourcePackageId` au `AddPaymentBody`. L'encaissement **optimiste** existant
  (`applyOptimisticPayment`) marche tel quel (paiement synthétique de méthode
  `WALLET`/`PACK_CREDIT`).
- Sur chaque ligne d'un **joueur nommé** (participant ou titulaire/holder) dont
  le `userId` a un solde couvrant sa part : un bouton rapide supplémentaire
  **« Porte-monnaie »** (WALLET) ou **« Carnet »** (ENTRIES) → `pay(part, method,
  participantId, pkg.id)`. Les places **génériques/vides** (sans `userId`) n'ont
  pas de bouton prépayé (impossible d'attribuer un solde).
- Ligne **« Tout solder »** : bouton **porte-monnaie du titulaire** s'il couvre
  le reste (`pay(remaining, WALLET, undefined, pkg.id)` ; backend : `participantId`
  absent ⇒ `expectedUserId = reservation.userId`). **Pas** de bouton carnet ici
  (voir règle carnet).

### `CollectPanel` (modale d'encaissement + planning)

1. **Correctif du bug** : `payWithPackage(pkg)` encaisse `Number(payAmount)`
   (le montant affiché), avec `participantId` si une cible (`activePart`) est
   active ; le bouton est **désactivé** selon la même condition que les autres
   moyens (`!cannotPay` = montant valide ≤ `maxPayable`) **et** `canCover(pkg,
   montant)`. Plus jamais de paiement du reste entier quand l'opérateur a saisi
   une part.
2. **Promotion en rapide** : les soldes affichés viennent de `packagesByUser`
   pour la cible courante (`activePart?.userId ?? reservation.user?.id`). Le(s)
   bouton(s) prépayé(s) montent dans la **rangée des boutons primaires** (style
   plein accent), au lieu d'être relégués sous les moyens secondaires. Le message
   de repli (`prepaidHint`) reste affiché quand aucun solde utilisable.
3. La modale **n'effectue plus son propre fetch** des packages du titulaire :
   elle consomme `packagesByUser` (cohérence, et soldes du co-équipier
   disponibles). Le rechargement de la map (par la page parente après mutation)
   garde les soldes à jour.

### Règle carnet (ENTRIES)

Un carnet consomme **1 entrée par clic, quel que soit le montant**. Donc :
- bouton **Carnet** proposé **uniquement sur une part de joueur** (1 entrée =
  1 part — sémantiquement juste) ;
- **pas** de bouton carnet sur « Tout solder » (sinon 1 entrée pour 4 parts).

Le **porte-monnaie** (euros, décrément exact) reste proposé partout (part ou
total). *(Les offres du club ciblé sont toutes des porte-monnaie ; cette règle
est surtout de la rigueur pour ne pas mal débiter un carnet.)*

## Tests

- `lib/packages.test.ts` (nouveau) : `pickPackageFor` (porte-monnaie couvre /
  ne couvre pas, carnet toujours, filtre `kind`, liste vide → null).
- `backend …/package.service.test.ts` : `listActiveByClub` (exclut expirés &
  soldes à zéro, expose `userId`).
- `backend …/admin.routes` (ou équivalent) : `GET /packages/active` (droits +
  forme de réponse).
- `frontend __tests__/AdminReservations.test.tsx` : un bouton **Porte-monnaie**
  apparaît pour un joueur avec solde et **encaisse sa part** (montant = part,
  `sourcePackageId` + `participantId` envoyés) ; absent pour un joueur sans solde.
- `frontend __tests__/CollectPanel.test.tsx` : porte-monnaie **honore le montant
  « / joueur »** (n'encaisse pas le total), bouton promu en primaire, désactivé
  si le solde ne couvre pas.

## Hors périmètre

- Configurer WALLET/PACK_CREDIT dans `Club.quickPaymentMethods` (incompatible
  avec le besoin de `sourcePackageId` par joueur — reste exclu).
- Recrédit automatique du solde à l'annulation / au remboursement
  (recrédit manuel inchangé).
- Décrément optimiste du solde local (le rechargement à la réconciliation suffit).
- Vente d'offres (inchangée, `/admin/caisse`).
