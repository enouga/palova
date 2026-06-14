# Design — Gérer les joueurs & annuler une réservation depuis « Mes réservations »

**Date :** 2026-06-14
**Statut :** validé (brainstorming) — prêt pour le plan d'implémentation
**Approche retenue :** A — réutiliser `ReservationParticipant` + endpoints scopés au propriétaire

## Objectif

Depuis la page « Mes réservations », permettre à l'organisateur d'une réservation à venir de :
1. **Ajouter / retirer des joueurs** à sa partie ;
2. **Annuler** sa réservation,

le tout encadré par des **délais configurables par le club**.

## Décisions de cadrage

| Sujet | Décision |
|---|---|
| Qui peut être ajouté | **Membres ACTIFS du club uniquement** |
| Impact paiement | **Réparti** comme à la réservation avec partenaires : on réutilise `splitShares` (part égale, l'organisateur garde le reste au centime) ; la **caisse** affiche la part de chacun. Cohérent avec le booking-avec-partenaires existant. |
| Fenêtre temporelle | **Délais configurables par club** : un délai « changement de joueurs », un délai « annulation » |
| Sélection du membre | **Autocomplétion par nom** — réutilise l'endpoint et le composant **existants** des tournois |
| Permissions | **Organisateur uniquement** (`reservation.userId`) |
| Notifications aux joueurs ajoutés | Réutilise le best-effort existant `notifyReservationMemberAssigned` (déjà appelé par l'ajout admin) |

## 1. Modèle de données

### Club (2 nouvelles colonnes)
`backend/prisma/schema.prisma` — modèle `Club` :

```prisma
playerChangeCutoffHours Int @default(0) @map("player_change_cutoff_hours")
cancellationCutoffHours Int @default(0) @map("cancellation_cutoff_hours")
```

- Unité : **heures avant `startTime`**.
- Défaut `0` = action autorisée **jusqu'au début de la partie** (préserve la liberté actuelle ; le club peut durcir).
- Clamp **0–365** (cohérent avec `publicBookingDays`/`memberBookingDays`).
- Migration Prisma additive (`ALTER TABLE "clubs" ADD COLUMN …`).

### Joueurs — réutilisation totale de l'existant
Aucun changement de schéma sur `ReservationParticipant`. On **réutilise la logique de répartition existante** (`splitShares` + transaction Serializable) déjà utilisée par :
- `holdSlot` (création avec partenaires) ;
- `addReservationParticipant` / `removeReservationParticipant` (caisse/planning admin).

La seule différence du flux « mes réservations » est l'**autorisation** (organisateur au lieu de l'admin du club) et le **contrôle de délai**. On factorise donc le cœur transactionnel (membership + capacité + répartition) dans des helpers privés réutilisés par les deux flux.

## 2. Backend — endpoints scopés au propriétaire

`backend/src/routes/reservations.ts` (déjà sous `authMiddleware`) + `backend/src/services/reservation.service.ts`.

| Méthode | Endpoint | Rôle |
|---|---|---|
| `GET` | `/api/reservations/:id/players` | Liste joueurs + capacité (pour le modal) |
| `POST` | `/api/reservations/:id/players` `{ memberUserId }` | Ajoute un membre (répartit les parts) |
| `DELETE` | `/api/reservations/:id/players/:participantId` | Retire un joueur (recalcule les parts) |
| `DELETE` | `/api/reservations/:id` (existant) | Annulation — **reçoit le contrôle de délai** |

### Garde commune (ajout/retrait/lecture)
- Réservation existe sinon `RESERVATION_NOT_FOUND` (404).
- `reservation.userId === callerUserId` sinon `UNAUTHORIZED` (403) — organisateur uniquement.

### Garde supplémentaire ajout/retrait
- Statut `CONFIRMED` sinon `RESERVATION_NOT_ACTIVE` (409). (Une `PENDING` est un hold en cours de checkout.)
- `Date.now() ≤ startTime − playerChangeCutoffHours·3600000` sinon `PLAYER_CHANGE_TOO_LATE` (409).
- Puis cœur partagé : membre `ACTIVE`/non bloqué sinon `MEMBER_NOT_FOUND` ; capacité `playerCount(format)` sinon `TOO_MANY_PLAYERS` ; doublon organisateur sinon `PARTNER_DUPLICATE` ; (retrait) `PARTICIPANT_NOT_FOUND`, organisateur seul retirable en dernier sinon `CANNOT_REMOVE_ORGANIZER`.

### Garde annulation (ajout au flux existant)
- Checks existants conservés (`RESERVATION_NOT_FOUND`, `UNAUTHORIZED`, `ALREADY_CANCELLED`).
- `Date.now() ≤ startTime − cancellationCutoffHours·3600000` sinon `CANCELLATION_TOO_LATE` (409).

### Chargement du club pour les délais
Chemin de relation : `Reservation → Resource → Club`. Les méthodes chargent `resource.club.select { playerChangeCutoffHours | cancellationCutoffHours }`.

## 3. Backend — recherche de membres (déjà disponible)

**Aucun nouvel endpoint.** On réutilise tel quel `GET /api/clubs/:slug/members/search?q=` (`ClubService.searchMembers`) — réservé aux membres ACTIFS du club, renvoie `{ id, firstName, lastName }` (jamais l'e-mail), exclut l'appelant. L'organisateur est membre du club (il y a réservé), la garde passe.

## 4. Frontend — UX

### Points d'entrée
- `frontend/app/me/reservations/page.tsx` (liste « À venir ») : sur chaque carte à venir, bouton **« Gérer les joueurs »** à côté de « Annuler ».
- `frontend/components/calendar/DayPanel.tsx` (calendrier) : même bouton pour les résas à venir.
- Bouton **« Annuler » désactivé** quand le délai d'annulation est dépassé (calcul client à partir de `startTime` + `cancellationCutoffHours`, le backend reste la source de vérité).

### `ManagePlayersModal` (nouveau composant)
- Charge `GET /api/reservations/:id/players` à l'ouverture.
- En-tête : court + club + indicateur de capacité (ex. *3/4 joueurs*).
- Liste : **Organisateur (toi)** non retirable, puis joueurs ajoutés avec « ✕ retirer ».
- **Recherche de membres** : réutilise le composant **`PartnerSearch`** (annuaire par nom, `keepOpenOnSelect`, `excludeIds` = joueurs déjà présents).
- Si **délai de changement dépassé** : lecture seule + message (« Modification des joueurs fermée Xh avant le début »).
- Mapping des codes d'erreur backend → messages FR.

### Données nécessaires côté liste
`MyReservation.resource.club` est enrichi de `playerChangeCutoffHours` et `cancellationCutoffHours` (additif) pour calculer côté client si les actions sont encore ouvertes.

## 5. Admin — réglages

`frontend/app/admin/settings/page.tsx` : nouvelle carte **« Délais (annulation & changement de joueurs) »**, deux champs `number` (heures), sauvegarde via `api.adminUpdateClub` existant.

Backend : `getClubForAdmin` (select) + `updateClub` (params + merge, clamp 0–365) dans `backend/src/services/club.service.ts`. Frontend : `ClubAdminDetail` + `UpdateClubBody` enrichis dans `frontend/lib/api.ts`.

## 6. Codes d'erreur (→ messages FR)

| Code | HTTP | Message UI (indicatif) |
|---|---|---|
| `PLAYER_CHANGE_TOO_LATE` | 409 | « Trop tard pour modifier les joueurs. » |
| `CANCELLATION_TOO_LATE` | 409 | « Trop tard pour annuler cette réservation. » |
| `RESERVATION_NOT_ACTIVE` | 409 | « Cette réservation n'est pas modifiable. » |
| `TOO_MANY_PLAYERS` | 409 | « La partie est complète. » |
| `MEMBER_NOT_FOUND` | 404 | « Ce joueur n'est pas membre du club. » |
| `PARTNER_DUPLICATE` | 400 | « Ce joueur est déjà dans la partie. » |
| `CANNOT_REMOVE_ORGANIZER` | 409 | « L'organisateur ne peut pas être retiré. » |
| `PARTICIPANT_NOT_FOUND` | 404 | « Joueur introuvable. » |
| `UNAUTHORIZED` | 403 | « Seul l'organisateur peut modifier cette réservation. » |

## 7. Hors périmètre v1
- Flux d'invitation/acceptation (la partie n'apparaît pas dans les « Mes réservations » des joueurs ajoutés).
- Notifications dédiées au **retrait** d'un joueur (l'ajout réutilise la notif existante).
- Reprogrammation (reschedule) — suivie ailleurs.

## 8. Tests (gate jest, Prisma mocké)
- **`reservation.service.test.ts`** : 
  - ⚠️ **mettre à jour** les tests `cancelReservation` existants (le mock doit fournir `resource.club.cancellationCutoffHours` + un `startTime` futur, car la garde de délai s'ajoute).
  - nouveaux blocs `addOwnReservationParticipant` / `removeOwnReservationParticipant` / `getOwnReservationPlayers` : succès, `UNAUTHORIZED`, `RESERVATION_NOT_ACTIVE`, `PLAYER_CHANGE_TOO_LATE` ; + `cancelReservation` → `CANCELLATION_TOO_LATE`.
- **`club.service.test.ts`** : `updateClub` clampe les deux nouveaux champs (0–365).
- **`reservations.routes.test.ts`** (nouveau, pattern `me.routes.test.ts` : supertest + jwt + prismaMock) : mapping des codes (403/409) sur les nouvelles routes.
- **Frontend** : helpers purs `isPlayerChangeOpen` / `isCancellationOpen` (`lib/reservations.ts` + test) ; (optionnel) test de `ManagePlayersModal` (lecture seule hors délai).

## 9. Fichiers impactés
**Backend** : `prisma/schema.prisma` (+migration), `src/services/club.service.ts`, `src/services/reservation.service.ts`, `src/routes/reservations.ts`, tests.
**Frontend** : `lib/api.ts`, `lib/reservations.ts` (nouveau), `components/reservations/ManagePlayersModal.tsx` (nouveau), `app/me/reservations/page.tsx`, `components/calendar/DayPanel.tsx`, `app/admin/settings/page.tsx`, tests.
