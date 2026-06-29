# Système de niveau réservé au padel — design

Date : 2026-06-25
Statut : validé (prêt pour plan d'implémentation)

## Problème

Le système de niveau de Palova (note 0–8, grille *Padel Magazine*, classement, fourchette
de niveau d'une *Partie ouverte*, recommandations, résultats de match) est conçu
**uniquement pour le padel**. Le profil joueur fixe déjà `ratingSport = 'padel'` et la
section « Mon niveau » est padel-only.

Mais au moment de réserver (`components/BookingModal.tsx`), le bloc
**« Limiter le niveau des joueurs »** d'une *Partie ouverte* s'affiche pour **n'importe quel
sport** multi-joueurs (tennis, squash…), alors que la notion de niveau n'a pas de sens hors
padel. Le curseur double + la mention « Niveaux d'après la grille Padel Magazine »
apparaissent à tort sur un terrain non-padel.

Le limiteur est aujourd'hui gardé uniquement par `visibility === 'PUBLIC' && levelEnabled`
(`levelEnabled` = drapeau de club `levelSystemEnabled`), **jamais par le sport**.

## Règle — une seule source de vérité

Un sport « a des niveaux » **ssi sa clé est `padel`**. On centralise cette règle des deux
côtés plutôt que de coder `=== 'padel'` en dur dans les composants, pour qu'un futur sport à
niveaux ne se change qu'à un seul endroit.

- **Front** — dans `frontend/lib/level.ts` (module pur déjà dédié au référentiel padel) :
  ```ts
  export const LEVEL_SPORT_KEY = 'padel';
  /** Ce sport utilise-t-il le système de niveau (grille Padel Magazine) ? */
  export function sportHasLevels(sportKey?: string | null): boolean {
    return sportKey === LEVEL_SPORT_KEY;
  }
  ```
- **Backend** — miroir dans `backend/src/services/rating/level.ts` (même module pur) :
  mêmes `LEVEL_SPORT_KEY` et `sportHasLevels`.

## Changement 1 — `BookingModal` (front, l'écran concerné)

Le bloc limiteur de niveau (`frontend/components/BookingModal.tsx`, lignes ~485–502) est
gardé par `visibility === 'PUBLIC' && levelEnabled`. On ajoute la condition de sport :

> `visibility === 'PUBLIC' && levelEnabled && sportHasLevels(sportKey)`

Conséquences :

- Terrain non-padel → ni l'interrupteur « Limiter le niveau », ni le `LevelRangeSlider`, ni la
  mention *Padel Magazine* ne s'affichent. Le reste de la section (partenaires, segment
  Privée/Ouverte, paiement, annulation) est inchangé.
- `persistHoldSetup` (lignes ~313–324) n'inclut `targetLevelMin/Max` **que si**
  `sportHasLevels(sportKey)`. Hors padel → on retombe sur `{}` (exactement le comportement
  actuel d'une partie privée). La constante locale `limiting` reste calculée à partir de
  `visibility === 'PUBLIC' && levelEnabled && levelLimited`, et n'est utilisée que dans la
  branche padel.
- L'effet de préchargement de la fourchette (`getMyRating`, lignes ~265–276) se court-circuite
  aussi hors padel (ajout de `sportHasLevels(sportKey)` à la garde de sortie), pour ne pas
  appeler l'API de notation inutilement.

`sportKey` est déjà fourni à `BookingModal` par `ClubReserve` (`cs.sport.key`).

## Changement 2 — garde backend `applyHoldSetup`

La route `POST /api/reservations/:id/setup` → `ReservationService.applyHoldSetup`
(`backend/src/services/reservation.service.ts`, lignes ~325–364) accepte et persiste
`targetLevelMin/Max` **quel que soit le sport**. On ajoute une garde serveur (défense en
profondeur) :

1. Étendre le `findUnique` initial pour inclure la clé du sport du terrain :
   `resource: { select: { clubId: true, attributes: true,
   clubSport: { select: { sport: { select: { key: true } } } } } }`
   (même forme d'include que `confirmReservation`).
2. Avant l'`update`, si `!sportHasLevels(sportKey)`, **forcer**
   `targetLevelMin = targetLevelMax = null`.

Ainsi aucun client (UI périmée, appel direct à l'API) ne peut créer une *Partie ouverte*
non-padel porteuse d'une fourchette de niveau. Le reste de la transaction (suppression/recréation
des participants, visibilité) est inchangé. La forme de la réponse de l'API est inchangée.

## Hors périmètre (et pourquoi c'est sûr)

- **`/parties` (`OpenMatches`)** : le payload `OpenMatch` ne porte pas de clé de sport, et après
  ce correctif une partie non-padel a `targetLevelMin/Max = null` → aucun chip de niveau affiché
  (`OpenMatchCard` ne l'affiche que si une borne est non nulle), et `inRange(level, null, null)`
  est vrai → la partie compte comme « ouverte à tous ». Comportement cohérent, aucun changement
  requis. Les fonctions « À mon niveau », « Pour toi », classement et saisie de résultat restent
  gardées par le drapeau de club `levelSystemEnabled` (comportement actuel).
- **Profil** (`/me/profile`) : déjà padel-only (`ratingSport` fixé).
- **Interrupteur de niveau du club** (`levelSystemEnabled`) : inchangé — il reste le commutateur
  global ; le sport est une condition **supplémentaire** côté réservation.

## Tests

- **Front** `frontend/__tests__/BookingModal.test.tsx` :
  - Terrain `sportKey='tennis'`, *Partie ouverte* sélectionnée → **pas** de « Limiter le
    niveau ».
  - Terrain `sportKey='padel'`, *Partie ouverte* → limiteur présent (régression).
  - Confirmation sur terrain tennis → `api.applyHoldSetup` appelé **sans** `targetLevelMin/Max`.
- **Backend** `backend/src/services/__tests__/reservation.service.test.ts` :
  - `applyHoldSetup` sur une résa dont le sport ≠ padel, avec `targetLevelMin/Max` fournis →
    `reservation.update` reçoit `targetLevelMin/Max = null`.
  - Régression padel : valeurs fournies persistées telles quelles.
- **Helpers purs** `frontend/lib/level.ts` (via la suite front existante) et
  `backend/src/services/rating/__tests__/level.test.ts` :
  `sportHasLevels('padel') === true`, `sportHasLevels('tennis') === false`,
  `sportHasLevels(undefined) === false`.

## Fichiers touchés

- `frontend/lib/level.ts` — ajout `LEVEL_SPORT_KEY` + `sportHasLevels`.
- `frontend/components/BookingModal.tsx` — garde sport sur le bloc niveau, `persistHoldSetup`,
  effet de préchargement.
- `backend/src/services/rating/level.ts` — miroir `LEVEL_SPORT_KEY` + `sportHasLevels`.
- `backend/src/services/reservation.service.ts` — include sport + garde dans `applyHoldSetup`.
- Tests : `frontend/__tests__/BookingModal.test.tsx`,
  `backend/src/services/__tests__/reservation.service.test.ts`,
  `backend/src/services/rating/__tests__/level.test.ts`.

Aucune migration. Aucun changement de forme d'API.
