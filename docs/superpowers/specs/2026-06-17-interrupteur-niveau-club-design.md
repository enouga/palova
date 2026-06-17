# Interrupteur club : activer/désactiver le système de niveau — Design

**Date :** 2026-06-17
**Statut :** validé, prêt pour plan d'implémentation
**Contexte :** Le système de niveau de joueur (Glicko-2, padel uniquement) est désormais complet
(Lots 1-4 livrés et poussés). Tous les clubs en bénéficient automatiquement. Cette feature ajoute
un **interrupteur par club** : un club peut décider de **ne pas** l'activer, auquel cas la feature
**disparaît entièrement** (affichage masqué partout + saisie de résultats bloquée).

## Décisions de cadrage (le « pourquoi »)

- **Padel-only conservé.** Le système est codé en dur sur `'padel'` (10 points d'appel back :
  `getLevelsForUsers(..., 'padel')`, `sport ?? 'padel'`). On ne touche pas à ça. Le multi-sport réel
  (sélection/affichage par sport) reste **hors périmètre**.
- **Sémantique de OFF = « tout masquer + bloquer la saisie ».** Pour un club qui n'en veut pas, la
  feature est invisible et inutilisable, pas juste cosmétiquement cachée.
- **Défaut = ON.** Migration additive avec backfill `true` → comportement inchangé pour les clubs
  existants ; nouveaux clubs ON par défaut.
- **Données conservées quand OFF.** On masque/bloque, on **ne supprime pas** les `PlayerRating`/
  `Match`. Réactiver restaure l'historique tel quel.
- **Réglage staff/admin uniquement** (`/admin/settings`), pas de réglage côté joueur.

## A. Donnée

`Club.levelSystemEnabled Boolean @default(true) @map("level_system_enabled")` — migration additive
`add_level_system_enabled` (backfill implicite `true` via le défaut). Pattern identique aux flags
club existants (`listedInDirectory`, `showOtherClubsReservations`).

- **Exposition publique** : ajouté au payload `GET /api/clubs/:slug` (type front `ClubDetail`), donc
  disponible partout via `useClub().club.levelSystemEnabled`.
- **Édition admin** : accepté par l'update club admin (`UpdateClubBody`/`PATCH` settings), avec une
  case « Système de niveau de joueur » dans `/admin/settings`.

## B. Backend — bloquer les chemins « actifs » (défense en profondeur)

Quand `levelSystemEnabled = false` pour le club concerné :

1. **Saisie de résultat** — `MatchService.createFromReservation` (seul point d'entrée de création,
   via `POST /api/reservations/:id/match`) : charge déjà la réservation → ressource → `clubId` ; lire
   le flag du club et, si OFF, `throw new Error('LEVEL_SYSTEM_DISABLED')`. La route mappe → **403**
   `{ error: 'LEVEL_SYSTEM_DISABLED' }`. Bloque toute saisie même par appel direct.
2. **Leaderboard** — `GET /api/clubs/:slug/leaderboard` : si OFF → **404** (surface « niveau »).
3. **Back-office matchs** — `GET /admin/matches`, `POST /admin/matches/:id/resolve`,
   `POST /admin/matches/:id/void` : si OFF → **404**.

> Les méthodes `confirm`/`dispute`/`finalize`/`voidMatch`/`resolveDispute` agissent sur un `Match`
> **déjà existant** ; comme la création est bloquée et le back-office renvoie 404 quand OFF, on n'a
> pas besoin de les garder individuellement — un club ne peut pas créer de nouveau match, et ses
> matchs antérieurs (si la feature a été désactivée après coup) sont simplement gelés et masqués.

**Enrichissement de niveau laissé tel quel.** Les services qui ajoutent les niveaux aux payloads
(`getLevelsForUsers` dans `openMatch`/`reservation`/`event`/`tournament`/`club`) **ne sont pas
modifiés** : le front masque l'affichage (section C), donc l'info supplémentaire est ignorée côté
client. Choix délibéré (YAGNI) pour ne pas toucher 4+ services ; aucun risque fonctionnel.

## C. Frontend — masquer l'affichage

Source de vérité unique : `useClub().club.levelSystemEnabled`. Points de gate (~6-8) ; un composant
partagé gaté couvre plusieurs appelants :

1. **Pastilles/chips de niveau partagés** — `components/player/PlayerPills.tsx`,
   `components/player/LevelBadge.tsx`, `components/player/LevelChip.tsx` : ne pas rendre la partie
   niveau quand OFF. Couvre annuaire, parties (`OpenMatchCard`), events (`ParticipantsGrid`),
   tournois (`TeamsGrid`/`PartnerSearch`), Mes réservations (`ReservationPlayersInline`),
   `BookingModal`.
2. **Profil** `app/me/profile/page.tsx` — masquer la carte niveau, l'auto-évaluation
   (`LevelCalibration`) et la courbe (`LevelHistoryChart`) quand OFF.
3. **`/parties`** (`components/openmatch/OpenMatches.tsx`) — masquer l'onglet « Classement »
   (`Leaderboard`), la fourchette cible + le filtre « à mon niveau » du matchmaking, et la reco
   « Pour toi » (`MatchesForYou` dans `ClubHouse` + section en tête de `/parties`).
4. **Saisie/confirmation de match** — masquer les entrées « Saisir le résultat » (Mes réservations/
   Calendrier + partie ouverte) et l'onglet « Matchs » (confirm/contest).
5. **Nav admin** — masquer le lien « Matchs » dans la sidebar `/admin`.

Quand le flag est absent/undefined (ex. payload plus ancien), traiter comme **ON** (rétrocompat —
le défaut du modèle est `true`).

## D. Stratégie de tests (TDD)

**Backend :**
- `createFromReservation` : **rejette** `LEVEL_SYSTEM_DISABLED` quand le club est OFF ; **réussit**
  inchangé quand ON (les tests existants couvrent déjà le cas ON par défaut — vérifier que le mock
  du club expose `levelSystemEnabled: true`/absent).
- Route `POST /api/reservations/:id/match` mappe `LEVEL_SYSTEM_DISABLED` → 403.
- `GET /:slug/leaderboard` → 404 quand OFF.
- Routes `/admin/matches` (liste/resolve/void) → 404 quand OFF.
- Le payload `GET /api/clubs/:slug` inclut `levelSystemEnabled` ; l'update admin l'accepte.

**Frontend :** pour chaque cluster de la section C, un test « OFF → ne rend rien / rend normalement
quand ON » :
- `PlayerPills`/`LevelChip`/`LevelBadge` : pas de niveau affiché quand OFF.
- `OpenMatches` : pas d'onglet « Classement », pas de fourchette/filtre, pas de « Pour toi ».
- profil : pas de carte/auto-éval/courbe.
- entrées « Saisir le résultat » + onglet « Matchs » absents.
- lien admin « Matchs » absent.
- Réglage `/admin/settings` : la case bascule `levelSystemEnabled`.

## Fichiers concernés (indicatif)

- `backend/prisma/schema.prisma` + migration `add_level_system_enabled`.
- `backend/src/services/club.service.ts` : exposer le flag dans le payload public + accepter à
  l'update admin (+ leaderboard gate).
- `backend/src/services/match.service.ts` : gate dans `createFromReservation`.
- `backend/src/routes/reservations.ts` : mapping 403 `LEVEL_SYSTEM_DISABLED`.
- `backend/src/routes/clubs.ts` (leaderboard) + `backend/src/routes/admin.ts` (matches) : gate 404.
- `frontend/lib/api.ts` : `levelSystemEnabled` sur `ClubDetail` + champ dans l'update.
- `frontend/components/player/{PlayerPills,LevelBadge,LevelChip,LevelCalibration,LevelHistoryChart}.tsx`,
  `frontend/components/openmatch/OpenMatches.tsx`, `frontend/components/ClubHouse.tsx`,
  `frontend/app/me/profile/page.tsx`, la sidebar admin, et les entrées de saisie de résultat.
- `frontend/app/admin/settings/...` : la case.
- Tests associés (services + routes back ; composants front).

## Hors périmètre v1 (assumé)

- Multi-sport réel (sélection/affichage par sport).
- Réglage côté joueur.
- Suppression des données `PlayerRating`/`Match` à la désactivation (on les conserve, masqués).
- Gater l'enrichissement `getLevelsForUsers` côté backend (le front masque l'affichage).
