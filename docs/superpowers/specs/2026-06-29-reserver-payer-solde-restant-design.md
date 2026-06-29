# Réserver — payer avec son carnet/porte-monnaie + voir ce qu'il reste

**Date :** 2026-06-29
**Périmètre :** page Réserver (joueur) — `BookingModal` uniquement.

## Contexte

Le paiement d'une réservation de terrain par **solde prépayé** existe déjà :

- `BookingModal` « Avenue 3 — carnets prépayés » affiche un bouton par solde utilisable
  (`packages` prop), libellé via `packageLabel(p)` (« Carnet — 7 entrées » / « Porte-monnaie — 53,50 € »).
- Sélectionner un solde → `confirmReservation(…, { paymentSource: { packageId } })`.
  Consommation **déterministe** côté backend (`PackageService.consume`) :
  **ENTRIES → −1 entrée** ; **WALLET → −`reservation.totalPrice` €** (= le `totalEuros` du modal).
- Un porte-monnaie qui ne couvre pas le total est **désactivé** (`canCover`).
- Après confirmation, `ClubReserve` rafraîchit les chips de solde (`getMyClubPackages`)
  et affiche une bannière générique « Réservation confirmée ! ».

**Ce qui manque** (demande utilisateur) : *voir ce qu'il reste dans le solde* — avant de
payer (projection) **et** après le paiement (confirmation).

## Objectif

Sur le `BookingModal` joueur, quand on règle avec un carnet ou un porte-monnaie :

1. **Projection (avant de payer)** : à la sélection d'un solde, afficher ce qu'il restera
   après ce paiement.
2. **Clarté du solde insuffisant** : un porte-monnaie désactivé indique *pourquoi*
   (« solde insuffisant »), au lieu d'être simplement grisé.
3. **Confirmation (après paiement)** : enrichir le retour « Réservation confirmée ! » avec
   le moyen utilisé et le solde restant.

## Approche

**Tout est calculé côté client.** La consommation est déterministe (carnet −1, porte-monnaie
−total€) et le modal connaît déjà le solde sélectionné + le total. Le solde projeté et le
solde restant après paiement se déduisent sans appel serveur. **Aucun changement backend,
aucune migration.** Les chips rafraîchies par `getMyClubPackages` corroborent la valeur.

Alternative écartée : faire renvoyer le nouveau solde par le backend à la confirmation —
plomberie inutile pour un calcul exact, et les chips se rafraîchissent déjà.

## Conception

### 1. Helpers purs — `frontend/lib/packages.ts`

Deux fonctions pures, testées dans `frontend/__tests__/packages.test.ts` :

- `remainingAfterLabel(p: MemberPackage, amountEuros: number): string`
  Projection : `« il restera 6 entrées »` (ENTRIES, `creditsRemaining − 1`) /
  `« il restera 28,50 € »` (WALLET, `amountRemaining − amountEuros`).
  Format € cohérent avec `packageLabel` (`toFixed(2).replace('.', ',')`).
- `paidWithLabel(p: MemberPackage, amountEuros: number): string`
  Confirmation : `« Payé avec votre carnet · 6 entrées restantes »` /
  `« Payé avec votre porte-monnaie · solde restant 28,50 € »`.

Les deux clampent le restant à 0 (jamais négatif). Réutilisent `p.kind`.

### 2. Projection dans `BookingModal` (avant paiement)

Dans la rangée « Avenue 3 — carnets prépayés » :

- Quand un bouton de solde est **sélectionné** (`paySource === p.id`), afficher sous la
  rangée une légende discrète : *« Après paiement : {remainingAfterLabel} »*.
- Quand un porte-monnaie est **désactivé** (`!canCover`), ajouter sur sa puce grisée la
  mention `· solde insuffisant` (les carnets ne sont jamais désactivés).

Le libellé courant (`packageLabel`, solde *actuel*) reste sur la puce — le joueur voit
l'actuel ET le projeté.

### 3. Confirmation (après paiement)

- Signature : `onConfirmed(reservation, paid?: { label: string })` — second paramètre
  **optionnel et additif** ; l'appelant `courts/[id]/page.tsx` reste inchangé.
- Dans `handleConfirm`, si un **package** a été utilisé (`paySource`), passer
  `{ label: paidWithLabel(selectedPkg, totalEuros) }`. Les chemins abonnement / en ligne /
  régler-au-club ne passent rien (chemin Stripe `onSuccess` : pas de package → rien).
- `ClubReserve` : la bannière verte « Réservation confirmée ! » ajoute la ligne du résumé
  quand il est présent.

## Hors périmètre

- Paiement **partiel** du porte-monnaie (payer une partie au porte-monnaie + le reste
  autrement) — confirmé écarté ; un porte-monnaie insuffisant reste désactivé.
- Inscriptions **tournoi / event** (règlement en ligne CB uniquement aujourd'hui).
- Tout changement backend / migration.

## Tests

- `frontend/__tests__/packages.test.ts` : `remainingAfterLabel` et `paidWithLabel`
  (ENTRIES, WALLET, solde exactement égal au total → reste 0, arrondi des centimes).
- `frontend/__tests__/BookingModal.packages.test.tsx` : la projection s'affiche à la
  sélection ; la mention « solde insuffisant » apparaît sur un porte-monnaie non couvrant ;
  `onConfirmed` est appelé avec le résumé `{ label }` quand un package est utilisé.
