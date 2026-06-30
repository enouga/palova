# CGV pré-cochée au paiement en ligne (BookingModal) — design

**Date :** 2026-07-01
**Statut :** validé, en implémentation

## Problème

Sur la modale de réservation (`BookingModal`), quand le club exige (ou propose) le
paiement en ligne, le bouton « Payer » n'apparaît qu'**après** avoir coché la case
« J'accepte les conditions générales de vente ». Un joueur fidèle, qui a déjà
accepté les CGV du club et qui a déjà une carte enregistrée, doit donc malgré tout
recocher la case à chaque réservation avant de pouvoir payer. Friction inutile.

## Constat

Les **inscriptions tournois/events** (`/tournois/[id]`, `/events/[id]`) n'ont **pas**
ce problème : elles affichent le formulaire Stripe directement (aucune case CGV) et
pré-sélectionnent déjà la carte enregistrée via `CustomerSession`. **Rien à changer**
de ce côté.

Le frottement est donc **localisé à `BookingModal`**, seul endroit avec une case CGV
qui masque le bouton de paiement.

## Comportement cible

- À l'ouverture de la modale, si le joueur a **déjà accepté les CGV de ce club**
  auparavant, la case est **déjà cochée** → le formulaire Stripe + bouton « Payer X€ »
  s'affichent d'emblée, et la carte enregistrée est pré-sélectionnée (déjà en place)
  → **un seul clic** pour payer.
- **Première fois** (jamais accepté pour ce club) : la case est décochée, le joueur
  la coche une fois (minimum légal). Dès qu'il la coche, c'est **mémorisé** pour les
  réservations suivantes sur ce club.
- La carte enregistrée : aucun travail — la pré-sélection `CustomerSession` (évolution
  2026-06-30) est déjà active sur le chemin booking.

## Mécanique

### `frontend/lib/cgv.ts` (nouveau, pur, testé)

Mémoire locale de l'acceptation CGV, **par club** (clé = `slug`) :

```
PREFIX = 'palova:cgv-accepted:'
hasAcceptedCgv(slug?)     → localStorage.getItem(PREFIX+slug) === '1'  (SSR-safe, try/catch)
rememberCgvAccepted(slug?) → localStorage.setItem(PREFIX+slug, '1')    (best-effort)
```

Clé par club : accepter chez le club A ne pré-coche pas chez le club B. Sans `slug`,
les deux fonctions sont des no-op (lecture → `false`).

### `frontend/components/BookingModal.tsx`

- `cgvAccepted` garde `useState(false)` (valeur SSR-safe).
- **Lecture de la mémoire dans un `useEffect`** au montage (jamais au render — le
  deep-link `?resource=&start=` peut pré-ouvrir la modale ; pattern hydration-safe
  du projet) : `if (hasAcceptedCgv(slug)) setCgvAccepted(true)`.
- À la coche de la case → `rememberCgvAccepted(slug)`.
- Le reste inchangé : le formulaire Stripe s'affiche déjà dès que `cgvAccepted` est vrai.

### Backend

**Aucun changement.** `cgvAccepted: true` reste envoyé au `confirmReservation` à chaque
commande (la trace légale par transaction est préservée). La mémoire locale ne sert
qu'à **pré-cocher l'UI**.

## Considération juridique

Pré-cocher la case repose sur une **acceptation antérieure explicite** du même joueur
pour le **même club** (et non un pré-cochage par défaut « à l'aveugle »). La trace
d'acceptation par transaction reste enregistrée côté serveur. Choix assumé par le
product owner pour réduire la friction des joueurs récurrents.

## Tests

- `frontend/__tests__/cgv.test.ts` : helper (vide → false ; remember → true ; clé par
  club ; sans slug → no-op).
- `frontend/__tests__/BookingModal.payment.test.tsx` : avec `slug` + localStorage
  pré-rempli → case déjà cochée et `stripe-step` affiché **sans** clic ; et cocher la
  case mémorise (relecture → cochée).

## Hors périmètre

- Inscriptions tournois/events (déjà conformes).
- Suppression de la case (on la garde, juste pré-cochée quand mémorisée).
- Mémoire serveur multi-appareils (localStorage suffit pour l'UI ; la trace légale
  reste par transaction côté serveur).
