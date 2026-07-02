# Transformer une réservation en partie ouverte — Design

> Statut : **brouillon en attente de revue**. Deux décisions par défaut ont été prises
> pendant l'absence de l'utilisateur (voir « Décisions ouvertes ») et doivent être
> confirmées avant d'écrire le plan d'implémentation.

## Problème

Aujourd'hui, la **visibilité** d'une réservation (`Reservation.visibility` = `PRIVATE` | `PUBLIC`)
et sa **fourchette de niveau** (`targetLevelMin` / `targetLevelMax`) ne se règlent **qu'à la
création**, pendant la phase `PENDING`, via `holdSlot` / `applyHoldSetup`
(`applyHoldSetup` exige explicitement `status === 'PENDING'`). Une fois la réservation
**confirmée**, il n'existe aucun moyen de la transformer en **partie ouverte**.

Une « partie ouverte » (`/parties`) est exactement une `Reservation` **padel** telle que
`visibility = PUBLIC`, `status = CONFIRMED`, `startTime > now`, avec au moins une place
libre — cf. `OpenMatchService.listOpenMatches` / `joinOpenMatch`. Il ne manque donc qu'une
**action de bascule après confirmation**.

## Objectif

Permettre à l'organisateur d'une réservation confirmée d'**ouvrir sa partie aux joueurs
du club** (la rendre publique → visible et rejoignable sur `/parties`), et de la
**refermer** (repasser privée), sans toucher aux joueurs déjà inscrits.

## Périmètre & éligibilité

L'action « Ouvrir » n'est proposée que si la réservation est :

- **padel** (contrainte du modèle : `visibility PUBLIC` n'a de sens qu'en padel) ;
- **`CONFIRMED`** (une `PENDING` suit encore le flux de création ; une `CANCELLED` est inerte) ;
- **future** (`startTime > now` — une partie passée n'est ni listée ni rejoignable) ;
- **avec ≥ 1 place libre** (`participants.length < capacity`) — sinon l'ouverture est
  inutile (personne ne pourrait rejoindre).

L'action « Fermer » est proposée dès que la partie est `PUBLIC` (et future), sans
condition de place.

## Comportement (UX)

Le contrôle vit dans **`ReservationPlayersInline`**, déjà rendu par le calendrier
(`DayPanel`) **et** la liste (`MyAgendaListItem`) pour les réservations futures dont on est
propriétaire → les deux surfaces sont couvertes sans duplication.

**État privé (éligible)** — un bouton discret « **Ouvrir aux joueurs du club** ». Au clic,
une **petite feuille** s'ouvre :

- interrupteur « **Limiter le niveau des joueurs** » (OFF par défaut = ouvert à tous) ;
- s'il est ON, le composant existant **`LevelRangeSlider`** (curseur double, grille Padel
  Magazine) — même affordance que `BookingModal` ;
- bouton « **Publier** » → `POST /reservations/:id/visibility` avec
  `{ visibility: 'PUBLIC', targetLevelMin, targetLevelMax }`.

**État public** — un **chip « Ouverte »**, un bouton « **Fermer** » (1 tap →
`{ visibility: 'PRIVATE' }`, conserve les joueurs, disparaît de `/parties`), et — bonus
léger — le bouton **« Partager »** (réutilise `MatchShareButton`, la partie étant désormais
une partie ouverte partageable via `/parties/[id]`).

Fermer ne retire jamais de participant ; la partie est simplement retirée de `/parties` et
n'est plus rejoignable.

## Backend

### Service — `ReservationService.setReservationVisibility`

```ts
setReservationVisibility(
  reservationId: string,
  userId: string,
  input: { visibility: 'PRIVATE' | 'PUBLIC'; targetLevelMin?: number | null; targetLevelMax?: number | null },
)
```

Gardes (mêmes codes d'erreur que le reste du service) :

- réservation introuvable → `RESERVATION_NOT_FOUND` (404) ;
- `reservation.userId !== userId` → `UNAUTHORIZED` (403) ;
- `status !== 'CONFIRMED'` → `RESERVATION_NOT_ACTIVE` (409) ;
- `visibility === 'PUBLIC'` et sport ≠ padel → `OPEN_MATCH_PADEL_ONLY` (400) ;
- `startTime <= now` → `RESERVATION_IN_PAST` (409).

Fourchette de niveau : appliquée **uniquement en padel** (miroir de `sportHasLevels` /
`services/rating/level.ts`), bornée `[0,8]` avec `min ≤ max`. Hors padel **et** quand on
repasse `PRIVATE`, `targetLevelMin`/`targetLevelMax` sont forcés à `null`.

Implémentation = un simple `prisma.reservation.update` (la place est déjà tenue par une
réservation confirmée : aucun verrou Redis, aucune mutation de `ReservationParticipant`,
aucun recalcul de prix). Retourne la réservation mise à jour (forme `MyReservation`-compatible,
ou au minimum `{ id, visibility, targetLevelMin, targetLevelMax }`).

Pas de SSE ni de notification : les parties ouvertes se découvrent en parcourant
`/parties` (cohérent avec le modèle actuel — voir « Hors périmètre »).

### Route — `POST /api/reservations/:id/visibility`

`authMiddleware`, propriétaire uniquement. Validation calquée sur `/reservations/:id/setup` :

- `visibility` ∈ `{ 'PRIVATE', 'PUBLIC' }` sinon `VALIDATION_ERROR` (400) ;
- `targetLevelMin` / `targetLevelMax` : `number` ∈ `[0,8]` ou `null` ; `min ≤ max` si les
  deux fournis, sinon `VALIDATION_ERROR` (400).

Codes déjà présents dans `ERROR_STATUS` de `reservations.ts`
(`UNAUTHORIZED`, `RESERVATION_NOT_FOUND`, `RESERVATION_NOT_ACTIVE`, `RESERVATION_IN_PAST`,
`OPEN_MATCH_PADEL_ONLY`, `VALIDATION_ERROR`) → aucun ajout de mapping requis.

### Migration

**Aucune.** Les colonnes `visibility`, `targetLevelMin`, `targetLevelMax` existent déjà sur
`Reservation`.

## Frontend

- **`lib/api.ts`** : `MyReservation` gagne (additif) `visibility: 'PRIVATE' | 'PUBLIC'` et
  `targetLevelMin?: number | null` / `targetLevelMax?: number | null`. Nouvelle méthode
  `api.setReservationVisibility(id, visibility, token, opts?)`.
- **`listUserReservations`** (backend) : ajouter `visibility, targetLevelMin, targetLevelMax`
  à la projection ; les propager dans le map de sortie.
- **`ReservationPlayersInline`** : ajouter le contrôle ouvrir/fermer + la feuille de niveau
  (gaté par l'éligibilité ci-dessus, padel via `reservation.resource.sport?.key === 'padel'`,
  place libre via `capacity - participants.length`). Réutilise `LevelRangeSlider`,
  `sportHasLevels`, et `MatchShareButton` pour le partage à l'état public.

## Tests

**Backend** (`reservation.service.test.ts` + `reservations.routes.test.ts`)
- ouvrir : `CONFIRMED` padel future → `visibility PUBLIC`, fourchette persistée ;
- fourchette **ignorée hors padel** / forcée `null` en repassant `PRIVATE` ;
- refus : non-owner (`UNAUTHORIZED`), non-`CONFIRMED` (`RESERVATION_NOT_ACTIVE`),
  passée (`RESERVATION_IN_PAST`), `PUBLIC` sur sport non-padel (`OPEN_MATCH_PADEL_ONLY`) ;
- fermer : `PUBLIC` → `PRIVATE`, participants intacts ;
- route : validation 400 alignée sur `/setup`.

**Frontend** (`ReservationPlayersInline.test.tsx`)
- le bouton « Ouvrir » n'apparaît que pour padel/confirmée/future/place libre ;
- ouvrir affiche la feuille, publie avec/sans fourchette ;
- état public → chip « Ouverte » + « Fermer » + partage ;
- fermer appelle `setReservationVisibility('PRIVATE')`.

## Hors périmètre (v1)

- Notifier les membres du club qu'une nouvelle partie est ouverte.
- Auto-organiser les équipes G/D à l'ouverture (l'édition d'équipes existe déjà par ailleurs).
- Ouvrir une réservation non-padel, pleine ou passée.
- SSE temps réel de la liste `/parties` (rafraîchissement à la navigation, comme aujourd'hui).
- Ouverture depuis le planning admin (`/admin/planning`) — réservé à l'organisateur côté joueur.

## Décisions ouvertes (défauts pris, à confirmer)

1. **Portée de l'ouverture** — défaut : **feuille de niveau optionnelle** (interrupteur +
   `LevelRangeSlider`) plutôt qu'une bascule 1-tap nue. Alternative : bascule sèche « ouvert
   à tous ».
2. **Réversibilité** — défaut : **bascule dans les deux sens** (ouvrir ↔ fermer). Alternative :
   ouverture seule (irréversible jusqu'à ce que la partie soit pleine/passée).
