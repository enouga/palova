# Places G/D persistées (padel) — correction de la dérive des emplacements

**Date :** 2026-07-02
**Statut :** validé (choix utilisateur : « persistance backend complète »)
**Complète :** `2026-07-02-matchteams-terrain-redesign-design.md` (qui posait la place G/D
comme mémoire de session — limite désormais levée).

## Problème (cause racine établie)

Retirer le joueur **G** d'une équipe fait glisser le joueur **D** en G partout sauf dans
BookingModal, et l'ajout ciblé ne remplit pas la place tapée (D avant G impossible sur une
équipe vide). Deux causes :

1. **La mémoire d'emplacements (`posRef`) vit sur l'instance de `MatchTeams`.** Le
   calendrier (`/me/reservations` : `onPlayersChanged → load()` → `setLoading(true)` →
   « Chargement… » démonte l'arbre) et les parties (`OpenMatches.tsx:152`,
   `useOpenMatchActions.act → reload()`) **démontent puis remontent** les cartes à chaque
   mutation → mémoire perdue → replacement au premier emplacement libre. BookingModal
   (état local, zéro refetch) garde son instance → comportement correct.
2. **L'ajout ciblé n'épingle jamais le slot tapé** : la passe de placement met le nouveau
   joueur au premier emplacement libre, quel que soit le « + » touché.

## Décision

La place dans l'équipe devient une **donnée persistée** : colonne additive
**`ReservationParticipant.slot Int?`** (0 = G, 1 = D au sein de l'équipe ; null = non
assigné, dérivé à la lecture). Durable après F5, identique pour tous les joueurs et
appareils. Options écartées : cache de session partagé (corrige le symptôme mais pas la
durabilité), statu quo.

## Backend

- **Migration additive `add_reservation_participant_slot`** :
  `ALTER TABLE "reservation_participants" ADD COLUMN IF NOT EXISTS "slot" INTEGER;`
  Dossier de migration versionné (prod : `prisma migrate deploy`) **et** application DEV
  via `prisma db execute` (base partagée avec dérive — jamais `migrate dev`/`db push`),
  puis `prisma generate`.
- **`effectiveTeams` étendu** (`services/matchTeams.ts`, pur) : émet désormais un
  **`slot` concret** en plus du `team` concret. Passe équipe inchangée ; puis, par équipe :
  slot explicite honoré s'il est valide (`0 ≤ slot < half`) et libre (premier arrivé
  `joinedAt` en cas de collision), puis les non-assignés remplissent les slots libres
  croissants dans l'ordre d'entrée. Compat : lignes existantes `slot null` → comportement
  actuel (ordre d'arrivée).
- **`applyTeams(tx, reservationId, teams, maxPlayers, slots?)`** : `slots` optionnel ;
  s'il est fourni il doit couvrir tous les participants (miroir de `teams`), valeurs
  entières `0..half-1` sinon `TEAM_INVALID`, deux joueurs sur la même paire (équipe, slot)
  → **`TEAM_SLOT_TAKEN`** (400). Persiste team+slot dans la même transaction.
- **`applyHoldSetup`** : `setup.slots?: Record<userId, number>` **best-effort** (comme
  `teams` — valeur invalide ignorée, jamais d'échec de confirmation).
- **Sérialiseurs** : `slot` exposé partout où `team` l'est (padel → concret via
  `effectiveTeams`, sinon `null`) : `OpenMatchService.toDTO`/`listOpenMatches`,
  `listUserReservations`, `mapOwnPlayers`/`getOwnReservationPlayers` (+ `slot: true` dans
  les `select` participants).
- **Routes** (mêmes URLs, body additif `{ teams, slots? }`) :
  `POST /api/clubs/:slug/open-matches/:id/participants/teams`,
  `POST /api/reservations/:id/teams`, `POST /api/reservations/:id/setup`.
  `TEAM_SLOT_TAKEN` mappé 400 comme `TEAM_INVALID`/`TEAM_SIDE_FULL`.

## Frontend

- **Types** (`lib/api.ts`) : `slot?: number | null` sur `OpenMatchPlayer`, participants de
  `MyReservation`, `ReservationPlayer` ; `setOpenMatchTeams`/`setReservationTeams`
  acceptent un paramètre optionnel `slots` ; `applyHoldSetup.setup.slots?`.
- **`MatchTeams`** : `MatchPlayerData.slot?: number | null`. Priorité de placement :
  **`p.slot` serveur → mémoire de session (`posRef`) → premier libre** (le serveur fait
  foi au montage ; `posRef` ne couvre plus que l'intervalle optimiste entre action et
  reload, et les brouillons locaux de BookingModal). `onSetTeams` devient
  `(teams, slots) => void` : le déplacement émet la **map complète des slots** dérivée du
  layout courant (positions de tous + mutation du déplacement/échange).
- **Surfaces** : chaque écriture envoie teams **et** slots —
  `ReservationPlayersInline` (déplacement, ajout ciblé `addMode.slot`, remplacement =
  slot de l'ancien joueur `p.slot`), `useOpenMatchActions`/`OpenMatchCard` (idem),
  `BookingModal` (nouvel état `slotsDraft` miroir de `teamsDraft`, envoyé via
  `applyHoldSetup.slots` ; `buildPlayers` alimente `MatchPlayerData.slot`).

## Hors périmètre

Échange G↔D intra-équipe dans l'UI (aucun geste dédié — un slot se choisit à l'ajout ou
par déplacement), sports non-padel, tournois/events, `MatchResultModal`.

## Tests

- Backend : `matchTeams` (slots explicites honorés, collision → `joinedAt`, remplissage,
  `TEAM_SLOT_TAKEN`, `TEAM_INVALID`), services (persistance slots par `setTeams`,
  best-effort `applyHoldSetup`, sérialiseurs exposent `slot`), routes (body `slots`,
  400 sur codes).
- Frontend : `MatchTeams` — **test de régression du bug** : un joueur seul avec
  `slot: 1` rend à D (piloté par la donnée, sans mémoire d'instance) ; le déplacement
  émet `(teams, slots)` ; suites des 3 surfaces mises à jour (nouvelles arités /
  assertions `slots`).
