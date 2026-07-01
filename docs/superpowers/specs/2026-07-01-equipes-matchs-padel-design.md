# Équipes gauche/droite pour les matchs padel (hors tournois/events)

**Date :** 2026-07-01
**Statut :** design validé (en attente de revue du spec)

## Problème

Aujourd'hui, les joueurs d'un match padel (une réservation de terrain) sont affichés
comme une **rangée plate de pastilles** (`PlayerPills`) : organisateur + partenaires +
« Place libre » en pointillés, qui s'enroule. Un match de padel est pourtant un **2 contre 2**
(ou 1v1 en single). On ne distingue pas les deux équipes / les deux côtés du filet.

On veut, **partout où l'on crée, modifie ou affiche un match** (hors tournois et events),
présenter les joueurs en **deux côtés — Équipe 1 (gauche) vs Équipe 2 (droite)** avec un
séparateur central « VS », et pouvoir **réorganiser les équipes**. L'affichage doit rester
**côte à côte même sur mobile** (pas de scroll horizontal).

## Décisions (validées avec l'utilisateur)

1. **Équipes assignables et persistées** (pas seulement un split visuel positionnel).
2. **Layout côte à côte** (gauche | VS | droite), 2 colonnes **même sur mobile**, pastilles compactes.
3. **Réorganisation = tap-pour-permuter** : toucher un joueur (surligné), puis un 2ᵉ joueur pour
   les **échanger**, ou une « Place libre » de l'autre côté pour **déplacer** le joueur choisi.
   Marche même quand les deux côtés sont pleins (2v2).
4. **Saisie du résultat pré-remplie** depuis les équipes assignées (toujours modifiable).
5. **Padel uniquement** — cohérent avec les parties ouvertes, la saisie de résultat et le
   système de niveau (tous padel-only aujourd'hui). Les autres sports gardent la liste plate.
6. **Écrans admin d'encaissement inchangés** (`/admin/reservations`, modale planning) : ils
   restent centrés paiement, lignes par joueur, **aucune notion d'équipe**.

## Principe d'architecture clé : `team` nullable, dérivé à la lecture

`ReservationParticipant` gagne **une seule** colonne nullable `team Int?` (1 = côté gauche,
2 = côté droit ; `null` = non assigné). **Aucun des 7 sites de création ni des 5 sites de
modification de participants n'est modifié** : les nouveaux participants naissent `team = null`.

Un **helper pur** `effectiveTeams(participants, maxPlayers)` attribue à **chaque** joueur un
côté concret 1 ou 2 **au moment de la sérialisation** :

```
half = maxPlayers / 2            // 2 en double, 1 en single
count = { 1: 0, 2: 0 }
// 1) honorer les team explicites (clamp défensif si dépassement du côté)
for p in participants (ordre joinedAt) where p.team in {1,2}:
    if count[p.team] < half: p -> p.team ; count[p.team]++
    else: (laissé au 2e passage)
// 2) remplir les null (et tout dépassement) dans l'ordre joinedAt
for p not yet assigned:
    side = count[1] < half ? 1 : 2 ; p -> side ; count[side]++
```

Déterministe pour un ordre `joinedAt` stable. Les choix d'équipe ne sont **persistés que via
les endpoints « set teams » explicites**. Conséquence : pas de backfill de migration, pas de
touche aux flux hold/confirm/reschedule/join/leave.

## Backend

### Migration
- `add_reservation_participant_team` (additive) : `ALTER TABLE reservation_participants ADD COLUMN team INTEGER;`
  Appliquée en DEV via `prisma db execute` du SQL additif (dérive de base connue), prod
  `migrate deploy`. Pas de backfill.

### Helper pur
- `backend/src/services/matchTeams.ts` → `effectiveTeams(participants, maxPlayers)` (testé isolément).
  Réutilise le convention `team ∈ {1,2}` déjà employée par `MatchPlayer.team`.

### Sérialisation — exposer `team` (padel seulement)
Ajouter `team` au `select` des participants puis passer par `effectiveTeams` dans :
- `openMatch.service.ts` → `listOpenMatches` : `OpenMatchPlayer.team` (déjà `maxPlayers` calculé).
- `reservation.service.ts` → `listUserReservations` : `MyReservation.participants[].team`
  (`resource.sport` déjà présent — badges ; calculer `maxPlayers` via `playerCount(format)`).
- `reservation.service.ts` → `getOwnReservationPlayers` : `ReservationPlayer.team`
  (ajouter la clé sport à la réponse si absente, pour le gating padel côté front).

Pour un match **non-padel**, `team` est renvoyé `null` (le front utilise la liste plate).

### Endpoints d'assignation (padel, matchs uniquement)
Cœur partagé `applyTeams(tx, reservationId, teamsByUserId, maxPlayers)` : valide (tous les
participants présents, chaque côté ≤ `half`, valeurs ∈ {1,2}), persiste chaque `team` en une
transaction Serializable + `FOR UPDATE`. Pas de recalcul de parts, pas de notification.
Erreurs : `TEAM_INVALID`, `TEAM_SIDE_FULL`, `NOT_ORGANIZER` / `NOT_OWNER`.

Trois routes, réutilisant les gardes d'auth existantes :
- **Organisateur** (partie ouverte) : `POST /api/clubs/:slug/open-matches/:id/participants/teams`
  → `OpenMatchService.setTeams(slug, id, organizerUserId, teams)` (résa PUBLIC, organisateur).
- **Propriétaire** (sa propre réservation) : `POST /api/reservations/:id/teams`
  → `ReservationService.setTeams(id, userId, teams)` (même auth que `/reservations/:id/players`).
- **À la création** : `applyHoldSetup` gagne un paramètre optionnel `teams` (mappé userId→côté),
  appliqué à la fin de la transaction existante (après recréation des participants).

## Frontend

### Composant partagé
- `frontend/components/match/MatchTeams.tsx` : deux colonnes **Équipe 1** (`ACCENTS.blue`) /
  **Équipe 2** (`ACCENTS.coral`) avec **« VS » central vertical**, chaque côté rendant ses
  slots (joueurs assignés + « Place libre » en pointillés jusqu'à `half`). Réutilise
  `Avatar` + `colorForSeed`, `LevelChip`, badge « orga », anneau ami (`friendIds`), le `×` de
  retrait et `AddPlayerPill` (rattachés au bon côté). **Flex 2 colonnes `flex:1` + gouttière VS,
  côte à côte même sur mobile, pastilles empilées verticalement dans chaque côté, pas de scroll
  horizontal.**
  - Prop `editable?: boolean` + `onSetTeams(teamsByUserId)` → **tap-pour-permuter** : état local
    `picked`. Tap joueur → surligné ; tap 2ᵉ joueur → échange les `team` ; tap « Place libre » du
    côté opposé → déplace ; re-tap → désélection. Chaque geste construit la **map complète** et
    appelle `onSetTeams` (**optimiste**, rollback sur échec).
  - Non-`editable` (ou lecteur non-organisateur/anonyme) : lecture seule, pas de sélection.
- `PlayerPills` **reste inchangé** et continue de servir les usages plats/non-match.

### Gating padel
Chaque surface choisit `MatchTeams` (si la résa est **padel**) sinon `PlayerPills`. La clé sport
provient de `OpenMatch.sport`, `MyReservation.resource.sport`, ou la clé ajoutée à
`getOwnReservationPlayers`.

### Câblage par surface
- **Affichage seul** : calendrier `components/calendar/MyAgendaListItem.tsx` + `DayPanel.tsx`
  (remplacent `PlayerPills` par `MatchTeams` en lecture pour les résas padel).
- **Éditable (tap-swap)** :
  - `components/openmatch/OpenMatchCard.tsx` (organisateur) → `api.setOpenMatchTeams(...)`.
  - `components/reservations/ReservationPlayersInline.tsx` (propriétaire) → `api.setReservationTeams(...)`.
  - `components/BookingModal.tsx` (création) : arrangement local des partenaires sélectionnés,
    persisté via `applyHoldSetup({ …, teams })`. L'organisateur par défaut à gauche (Éq.1).
- **Admin** : **inchangé** (aucune notion d'équipe dans l'encaissement).

### Saisie du résultat
- `MatchResultModal` reçoit une prop `initialTeams?: Record<userId, 1|2>` et initialise son état
  `team` avec (composition modifiable comme aujourd'hui). `OpenMatches` la fournit depuis
  `player.team`. Aucun autre changement au flux de résultat.

### Types `lib/api.ts`
- `team?: 1 | 2 | null` ajouté à `OpenMatchPlayer`, `MyReservation.participants[]`, `ReservationPlayer`.
- Nouvelles méthodes : `setOpenMatchTeams(slug, id, teams, token)`,
  `setReservationTeams(id, teams, token)` ; `applyHoldSetup` gagne `teams?`.
- **⚠️ Mocks** : les suites qui montent `OpenMatches`/`OpenMatchCard`/`ReservationPlayersInline`/
  `BookingModal`/calendrier doivent exposer les nouvelles méthodes `api.*` (sinon « not a function »).

## Plan d'implémentation (phases)

1. **Fondation backend** : colonne `team`, helper `effectiveTeams` (+ test), exposition de `team`
   dans `listOpenMatches` / `listUserReservations` / `getOwnReservationPlayers`, clé sport dispo
   pour le gating. *(Aucun changement de comportement visible ; les DTO gagnent `team`.)*
2. **Composant partagé + affichage** : `MatchTeams.tsx` (affichage + tap-swap), câblage
   **lecture** sur calendrier (MyAgendaListItem, DayPanel) et **lecture** sur OpenMatchCard.
3. **Édition** : `applyTeams` + routes (organisateur, propriétaire) + `applyHoldSetup.teams` ;
   tap-swap actif dans OpenMatchCard, ReservationPlayersInline, BookingModal.
4. **Résultat pré-rempli** : `MatchResultModal.initialTeams` alimenté par `OpenMatches`.

## Tests

- **Backend** : `matchTeams.test.ts` (helper : split double/single, remplissage des null,
  clamp dépassement, ordre joinedAt) ; blocs `setTeams` dans `openMatch.service.test.ts` et
  `reservation.service.test.ts` (organisateur/propriétaire OK, côté plein refusé, non-autorisé
  refusé) ; routes dans les suites clubs/reservations.
- **Frontend** : `MatchTeams.test.tsx` (2 colonnes, place libre, tap-swap émet la bonne map,
  lecture seule non-organisateur) ; maj `OpenMatchCard.test.tsx`, calendrier, `BookingModal.test.tsx`
  (teams via applyHoldSetup), `MatchResultModal` (pré-remplissage) ; ajout des mocks `api.*`.

## Hors périmètre (YAGNI)

Équipes pour tournois/events ; drag-and-drop desktop ; verrouillage des équipes ; notification
de réarrangement ; équipes en admin/encaissement ; équipes pour sports non-padel.
