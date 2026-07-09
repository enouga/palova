# Saisie du résultat d'un match — découvrable et sans re-saisie

**Date** : 2026-07-09
**Statut** : validé (design approuvé en conversation)

## Problème

Deux irritants remontés par l'utilisateur (copie d'écran de la modale à l'appui) :

1. **On ne sait pas où saisir un résultat.** Le seul chemin réaliste aujourd'hui :
   Mes réservations → onglet « Passées » (ou taper le bon jour du calendrier) → carte de la
   réservation → « Saisir le résultat ». Rien n'y invite : pas de notification après le match,
   rien sur le Club-house, et la vue « Mes matchs » de `/parties` ne liste que les résultats
   **déjà** saisis (à confirmer / historique).
2. **On re-saisit des équipes déjà connues.** La modale s'ouvre avec l'affectation 1/2 vide
   alors que `ReservationParticipant.team`/`slot` sont persistés et exposés partout.

### Découvertes d'exploration (structurantes)

- `app/me/reservations/page.tsx` ouvre `MatchResultModal` **sans `initialTeams`**
  (le même appel depuis `OpenMatchModals.tsx:24` les passe) → cause directe de l'irritant 2.
- `listUserReservations` filtre `where: { userId }` = **réservations dont on est
  l'organisateur seulement**. Les 3 autres joueurs d'un match n'ont donc *aucune* surface
  pour saisir le résultat (le backend `MatchService.createFromReservation` autorise pourtant
  **n'importe lequel des 4 participants**). Un bandeau purement client ne suffit pas →
  il faut une source backend.
- `effectiveTeams` attribue un côté concret 1/2 à **chaque** participant padel à la lecture :
  les équipes pré-remplies sont donc toujours complètes (2v2) pour un match padel à 4.

## Design

### 1. Correction immédiate — équipes pré-remplies dans Mes réservations

`app/me/reservations/page.tsx` passe `initialTeams` à `MatchResultModal`, dérivé de
`recordingFor.participants` (`p.team === 1 || p.team === 2`), à l'identique de
`OpenMatchModals.tsx`.

### 2. `MatchResultModal` — mode « résumé + Modifier »

- **Condition** : `initialTeams` couvre les 4 joueurs en 2/2 (toujours vrai au padel via
  `effectiveTeams` ; jamais vrai pour un autre sport où `team` est `null`).
- **Mode résumé** (état initial quand la condition tient) : deux lignes compactes
  « ● Éq. 1 — Alice & Bob » (pastille `ACCENTS.blue`) / « ● Éq. 2 — Chloé & David »
  (`ACCENTS.coral`) + lien-bouton « Modifier les équipes ». La saisie des sets est
  directement accessible dessous.
- **« Modifier les équipes »** bascule vers l'écran d'affectation actuel (liste des joueurs
  avec boutons 1/2, inchangé). Équipes incomplètes ou non padel → affectation directe
  (comportement actuel).
- La validation (`compositionOk`, chip vainqueur, garde `canSave`) est inchangée : l'état
  `team` est simplement pré-rempli.

### 3. Backend — `GET /api/me/matches/to-record`

Nouvelle méthode **`MatchService.listToRecord(userId, now)`** + route dans `routes/me.ts`
(après `GET /matches`), derrière `authMiddleware`. **Aucune migration.**

Critères (miroir des gardes de `createFromReservation`) :

- `Reservation` `type: COURT`, `status: CONFIRMED` ;
- `endTime <= now` et `endTime >= now − 7 jours` (fenêtre de rappel) ;
- exactement **4 participants**, dont `userId` (participant, pas seulement organisateur) ;
- `resource.club.levelSystemEnabled = true` ;
- **aucun `Match` lié avec `status ≠ CANCELLED`** (un match annulé par le staff redevient
  saisissable, comme aujourd'hui) ;
- tri `endTime desc`.

DTO par entrée :

```
{ reservationId, club: { slug, name, timezone }, resourceName,
  startTime, endTime, sport: { key, name },
  players: [{ userId, firstName, lastName, avatarUrl, isOrganizer, team, slot }] }
```

`team`/`slot` concrets via `effectiveTeams` (capacité depuis `Resource.attributes.format`,
comme `listUserReservations`). Pas de niveaux (inutiles à la modale).

### 4. Frontend — composant partagé `ResultsToRecord`

`components/match/ResultsToRecord.tsx`, autonome :

- fetch `api.getMatchesToRecord(token)` au montage (nouvelle méthode `lib/api.ts`, type
  `MatchToRecord`) ; prop `clubSlug?` pour filtrer au club courant ; rend `null` si vide
  ou sans token ;
- cartes compactes : tuile icône `trophy` teintée, « Résultat à saisir », terrain ·
  date · heure (fuseau du club), bouton « Saisir » ;
- monte lui-même `MatchResultModal` (players + `initialTeams` depuis `players[].team`,
  `context` depuis club/terrain/horaire) ; après enregistrement → refetch local (la carte
  disparaît) + prop optionnelle `onRecorded` pour que la surface parente rafraîchisse
  (ex. `MyMatchesList`).

Placements (uniquement si connecté et `club.levelSystemEnabled !== false`) :

- **Club-house** (`ClubHouse.tsx`) : entre `AnnouncementKiosk` et les sections configurables
  — prompt personnel, **hors** système `clubHouseSections` ;
- **`/parties`** (`OpenMatches.tsx`) : bandeau au-dessus des onglets, rendu en vue
  « parties » seulement (la vue « matchs » a sa propre section, pas de doublon) ;
- **vue « Mes matchs »** (`/parties?vue=matchs`) : section « À saisir » en tête, au-dessus
  de `MyMatchesList`, avec `onRecorded` → recharge `getMyMatches` ;
- **`/me/matches`** (page alias plateforme / clubs non padel) : même section au-dessus de
  la liste, non filtrée par club.

### 5. Notification après le match

Extension de **`reminders.job.ts`** (même cron 15 min, même idempotence par tranche de
fenêtre, même compromis best-effort documenté) : nouvelle passe sur **`endTime`** —
réservations dont la fin tombe dans la tranche `[now − 30 min, now − 15 min]` (lead 15 min
pour laisser les joueurs sortir du terrain) et satisfaisant les critères du §3 — hors
fenêtre 7 jours (sans objet ici) et hors scoping utilisateur (le job est global, le
notifier cible les 4 joueurs).

Nouveau notifier **`notifyMatchResultPrompt(reservationId)`** dans `email/notifications.ts` :

- re-vérifie les gardes (4 participants, `levelSystemEnabled`, pas de match non annulé) ;
- `dispatch` à **chacun des 4 joueurs** : catégorie **`MY_MATCHES`** (existante → pas de
  migration d'enum, préférence déjà exposée), type **`match.to_record`**,
  titre « Comment s'est passé votre match ? », corps « Saisissez le résultat de votre
  partie sur {terrain} », `url = clubAppUrl(slug, '/me/matches')` (redirige vers
  `/parties?vue=matchs` sur un hôte club padel, où la section « À saisir » est en tête) ;
- **cloche + push uniquement, pas d'email** → pas de nouveau type dans le registre
  `/admin/emails`.

### 6. Tests

Backend :

- `match.service.test` — `listToRecord` : inclut le participant non-organisateur ; exclut
  match existant PENDING/CONFIRMED/DISPUTED ; ré-inclut si le seul match est CANCELLED ;
  exclut > 7 jours, non terminé, < 4 joueurs, level off ; `team`/`slot` concrets.
- `me.routes.test` — `GET /api/me/matches/to-record` (200 + forme, 401 sans token).
- `reminders.job` — tranche sur `endTime`, notifier appelé par réservation éligible,
  échec best-effort non propagé.
- `notifications.match.test` — `notifyMatchResultPrompt` : dispatch aux 4 joueurs,
  catégorie/type/url corrects, **sans champ email**.

Frontend :

- `MatchResultModal.test` — mode résumé quand `initialTeams` complet (pas de boutons 1/2,
  sets accessibles), « Modifier les équipes » → affectation pré-remplie, `initialTeams`
  incomplet → affectation directe, enregistrement envoie les équipes du résumé.
- `ResultsToRecord.test` — cartes filtrées par club, ouverture modale pré-remplie,
  vide → null, `onRecorded` appelé après enregistrement.
- Suites existantes : page Mes réservations (passe `initialTeams`), `ClubHouse.test` /
  `OpenMatches.test` (bandeau rendu, mock du nouvel appel).

⚠️ **Mocks** : toute suite qui monte `ClubHouse` ou `OpenMatches` (y compris les suites
*real-mount* `ClubNav`) devra mocker `api.getMatchesToRecord` (cf. mémoire « ClubNav
real-mount test suites » — même piège que `listClubFriends`).

## Hors périmètre (v1)

- Email de rappel (cloche + push seulement) et relance J+1 si toujours pas saisi.
- Deep-link qui ouvrirait la modale directement depuis la notification.
- Saisie du résultat par le staff depuis l'admin.
- Fenêtre des 7 jours configurable par club.
