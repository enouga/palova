# Alertes parties ouvertes — recherche ponctuelle datée (design)

**Date** : 2026-07-14
**Statut** : validé (brainstorming avec Eric)

## Problème

Un joueur qui veut jouer « jeudi soir entre 18h et 21h » n'a aucun moyen d'être prévenu
quand une partie ouverte correspondante apparaît. L'opt-in existant `autoMatchProposals`
(« parties à mon niveau », `notifyOpenMatchProposed`) est tout-ou-rien : il notifie pour
**toutes** les parties à son niveau, sans filtre horaire, et uniquement à la confirmation
initiale — une partie publiée après coup (interrupteur « Partie ouverte » de l'écran de
succès) ne notifie personne aujourd'hui.

## Décision (choix utilisateur)

- **Forme** : alerte **ponctuelle datée** (« je cherche une partie le jeudi 16 juillet
  entre 18h et 21h »), qui **expire d'elle-même** après la fenêtre. Pas de créneaux hebdo
  récurrents en v1.
- **Déclencheurs** : nouvelle partie publiée **et** place libérée dans une partie
  correspondante.
- **Niveau** : la partie matche si sa fourchette contient le niveau du joueur **ou** si
  elle est sans limite de niveau (« ouverte à tous »).
- **Points d'entrée** : page `/parties` (bouton + état vide + chips des alertes actives)
  **et** page Réserver (créneau pris → alerte pré-remplie).
- **Architecture** : événementiel inline (approche A) — matching déclenché aux points où
  l'état d'une partie change, pas de cron de scan.

## Modèle de données

Migration additive **`add_match_alerts`** (DEV via `prisma db execute` du SQL additif,
prod `prisma migrate deploy`) :

- **`MatchAlert`** : `id`, `userId`, `clubId`, `windowStart` / `windowEnd` (DateTime UTC),
  `createdAt`. FK cascade user + club (la suppression de compte RGPD emporte les alertes).
  **Pas de champ statut** : active ⇔ `windowEnd > now`. Expirée → purgée par le job
  minute existant (`deleteMany windowEnd < now`). Suppression manuelle = hard delete par
  son propriétaire. Index `[clubId, windowEnd]`.
- **`MatchAlertHit`** : `alertId` × `reservationId`, `@@unique([alertId, reservationId])`,
  FK cascade vers l'alerte **et** vers la réservation (pas de hit orphelin).
  Mémorise « cette alerte a déjà sonné pour cette partie » =
  **déduplication** (une place libérée deux fois dans la même partie ne re-notifie pas).

## Règles de matching

Une partie correspond à une alerte si (toutes conditions) :

1. Même club ; partie `visibility PUBLIC` + `status CONFIRMED` + sport padel + `startTime`
   dans le futur + **au moins 1 place libre** (`playerCount(format) − participants ≥ 1`).
2. **Partie entièrement dans la fenêtre** : `startTime ≥ windowStart` ET
   `endTime ≤ windowEnd`. (« Dispo de 18h à 21h » → une partie 17h30–19h ou 20h30–22h ne
   matche pas ; le pré-remplissage UI élargit la fenêtre pour compenser.)
3. **Niveau** : partie sans fourchette (`targetLevelMin/Max null`) → matche pour tous ;
   avec fourchette → niveau **connu** du joueur dans la fourchette (même règle
   `inRange` + `ratingService.getLevelsBySport` que `notifyOpenMatchProposed` ; un joueur
   **non calibré** ne matche que les parties ouvertes à tous).
4. Le joueur n'est **ni organisateur ni participant** de la partie, son adhésion au club
   est `ACTIVE` (BLOCKED ne reçoit rien), et aucun hit `(alertId, reservationId)` n'existe.

**Garde-fous à la création** : max **5 alertes actives** par joueur et par club
(`ALERT_LIMIT_REACHED` 409) ; fenêtre valide = `windowStart < windowEnd`, durée ≤ 7 jours,
`windowEnd > now`, `windowStart ≤ now + 30 jours` (`ALERT_WINDOW_INVALID` 400).

## Backend

**Nouveau service `MatchAlertService`** (`backend/src/services/matchAlert.service.ts`) :

- `create(slug, userId, { windowStart, windowEnd })` — `ensureActiveMembership` (adhésion
  créée à la volée, refus `MEMBERSHIP_BLOCKED`), validations ci-dessus.
- `listMine(slug, userId)` — alertes actives du joueur sur le club, triées par
  `windowStart`.
- `remove(slug, userId, alertId)` — owner-only, idempotent.
- `purgeExpired()` — appelé par le job minute existant (cleanup).
- **`matchAndNotify(reservationId)`** — le matcheur : charge la partie, **s'auto-garde**
  (rien si pas PUBLIC/CONFIRMED/padel/à venir/place libre — pattern défensif de
  `notifyOpenMatchProposed`), requête les alertes actives du club dont la fenêtre contient
  la partie, applique le filtre niveau en code (parité `frontend/lib/recommend.ts`), crée
  les hits, notifie chaque destinataire indépendamment (un échec ne coupe pas les autres),
  renvoie les `userId` notifiés (pour la déduplication ci-dessous).

**4 points d'accroche** (appels additifs en best-effort `safeNotify` — un échec n'annule
jamais l'opération métier) :

| Événement | Où |
|---|---|
| Partie publiée dès la confirmation | `ReservationService.confirmReservation` (à côté du `notifyOpenMatchProposed` actuel) |
| Partie publiée après coup | `ReservationService.setReservationVisibility` → passage en PUBLIC |
| Place libérée (départ / retrait organisateur) | `OpenMatchService.leaveOpenMatch` + `removeOpenMatchPlayer` |
| Place libérée (retrait propriétaire / admin) | `ReservationService.removeOwnReservationParticipant` + `removeReservationParticipant` |

`changeReservationParticipant` = échange à somme nulle → pas de déclencheur.

**Notification** : nouveau type **`open_match.alert`**, catégorie **`MY_GAMES`** existante
(opt-out par canal déjà géré) — **in-app + push + email**, URL profonde **`/parties/[id]`**
(fiche partageable existante). Email = **19ᵉ type du registre** `/admin/emails` (entrée
`EMAIL_DEFS` avec variables `prenom` / `terrain` / `date` / `niveau` / `phrase_places` /
`lien`, personnalisable par le club, défaut fourni).

**Déduplication avec l'existant** : à la confirmation, un joueur ayant `autoMatchProposals`
**et** une alerte qui matche ne reçoit **que** la notif d'alerte (la plus spécifique) —
le matcheur tourne en premier, `notifyOpenMatchProposed` gagne un paramètre additif
`excludeUserIds` alimenté par les `userId` notifiés.

**Routes** (club-scoped, pattern existant) :

- `POST /api/clubs/:slug/match-alerts` (auth) — body `{ windowStart, windowEnd }` (ISO).
- `GET /api/clubs/:slug/match-alerts` (auth) — mes alertes actives.
- `DELETE /api/clubs/:slug/match-alerts/:id` (auth) — owner, idempotent.

## Frontend

**API** (`lib/api.ts`) : type `MatchAlert` + `createMatchAlert` / `listMyMatchAlerts` /
`deleteMatchAlert`.

**Page `/parties`** (`OpenMatches.tsx`) :

- Bouton **« 🔔 Créer une alerte »** près des filtres + rappel dans l'état vide
  (« Aucune partie à votre niveau ? Créez une alerte »). Anonyme → `AuthPromptDialog`
  existant (retour post-login sur `/parties`).
- **Alertes actives en chips supprimables** (« jeu. 16 juil. · 18h–21h ✕ », suppression
  optimiste avec rollback). Chips rendues seulement connecté.
- **Feuille de création** `components/openmatch/MatchAlertSheet.tsx` (pattern bottom-sheet
  existant) : date + « de / à » (réutilise `TimePicker`), récap lisible (« Une partie à
  votre niveau le jeudi 16 juillet entre 18h et 21h »), CTA « Créer l'alerte ».
- Conversion date+heures **locales club → UTC** dans un helper pur testé
  **`lib/matchAlerts.ts`** (fuseau via `club.timezone`, jamais de `new Date()` au rendu —
  hydration-safe).

**Page Réserver** (`ClubReserve.tsx`) — entrée « créneau complet » :

- Les pills **« pris »** (aujourd'hui inertes) deviennent **cliquables sur les terrains
  padel** : tap → mini-feuille « Ce créneau est pris — soyez alerté si une partie s'ouvre
  à cet horaire » → même `MatchAlertSheet` **pré-remplie** (fenêtre = créneau **±1h**,
  modifiable avant validation).
- Même comportement en **vue grille** (cellule prise → même handler). Terrains non-padel :
  rien (parties ouvertes padel-only).

**Erreurs mappées** dans la feuille : `ALERT_LIMIT_REACHED` (« Vous avez déjà 5 alertes
actives »), `ALERT_WINDOW_INVALID`, `MEMBERSHIP_BLOCKED`.

## Tests

- **Backend** : `matchAlert.service.test.ts` (création/limite/fenêtre invalide ; matching :
  niveau dans fourchette, ouverte à tous, non calibré, déjà participant, hit dédupliqué,
  BLOCKED exclu, partie hors fenêtre/pleine/passée) ; câblage des 4 déclencheurs dans
  `reservation.service.test.ts` / `openMatch.service.test.ts` (notifier appelé, échec non
  bloquant) ; routes (`clubs.match-alerts.routes.test.ts`) ; entrée registre email
  (`registry.test.ts`) ; déduplication `excludeUserIds`
  (`notifications.openmatch-proposed.test.ts`).
- **Frontend** : `matchAlerts.test.ts` (helper tz/fenêtre), `MatchAlertSheet.test.tsx`,
  `OpenMatches` (bouton, chips, anonyme → AuthPromptDialog), `ClubReserve` (pill prise →
  feuille pré-remplie ±1h). ⚠️ Suites real-mount `ClubNav` : ajouter les nouveaux `api.*`
  aux mocks concernés.

## Hors périmètre v1 (parqué)

- Alertes **récurrentes hebdo** (« tous les mardis soir »).
- Re-match au **déplacement** d'une partie (`reschedule` / `adminReschedule`).
- Alerte sur une **partie précise** (« me prévenir si une place se libère ICI »).
- **Retrait de la notif** si la partie se remplit entre l'envoi et la lecture.
- Vue **admin** des alertes du club.
- Correction du gap existant : `setReservationVisibility` → PUBLIC n'appelle toujours pas
  `notifyOpenMatchProposed` (seul le nouveau matcheur y est branché ; brancher l'existant
  exigerait sa propre déduplication de re-publication).
