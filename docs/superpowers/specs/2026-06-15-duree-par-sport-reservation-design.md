# Sélecteur de durée par sport sur la page Réserver

Date : 2026-06-15

## Problème

Les durées sont déjà modélisées par sport (`Sport.defaultDurationsMin` + override
`ClubSport.durationsMin`, helper `effectiveDurations`). Mais la page Réserver
(`ClubReserve`) fusionne toutes les durées en **un seul sélecteur global** et envoie
une **unique** durée à `getClubAvailability` pour **tous** les terrains. Choisir « 45 min »
calcule donc des créneaux de 45 min même pour un sport qui ne propose que 90 min.

## Solution (Option B)

Chaque **section de sport** de la page Réserver a **son propre sélecteur de durée**
(uniquement les durées de ce sport) et charge **ses** dispos indépendamment.
La **date** reste globale.

## Backend

`GET /api/clubs/:slug/availability` accepte un param optionnel **`clubSportId`** :
filtre les terrains de ce sport. `AvailabilityService.getClubAvailability(clubId, date,
durationMinutes, clubSportId?)` ajoute `clubSportId` au `where` (`resource.clubSportId`).
Rétro-compatible : sans le param, comportement actuel (tous les terrains).

## Frontend (`components/ClubReserve.tsx`)

- État **par sport** (clé = `clubSport.id`) :
  `durationBySport: Record<string, number>` (init = `defaultDuration(effectiveDurations(...))`),
  `availBySport: Record<string, ClubAvailability[]>`, `loadingBySport: Record<string, boolean>`.
- `api.getClubAvailability(slug, date, duration, clubSportId?)` — 4ᵉ arg optionnel.
- `loadSport(clubSportId, duration, date)` charge une section ; `reloadAll()` boucle sur
  `club.clubSports`. Effet [tab, date] → `reloadAll` (durées courantes lues via une ref pour
  éviter de recharger tous les sports quand une seule durée change). Changer la durée d'un
  sport → `loadSport` de ce seul sport.
- Rendu : une section par `club.clubSports` (en-tête sport + `Segmented` de durée si > 1
  durée + terrains/créneaux). Le sélecteur global est **supprimé**.
- `booking` porte désormais `duration` (la durée du sport du créneau) ; passé à `BookingModal`.
- `onSlot(resourceId, price, slot, duration, format)` reçoit la durée du sport.
- Lien profond `?resource=&start=` : on cherche le créneau dans `availBySport` (toutes
  sections), on ouvre la confirmation avec la durée du sport du terrain ; repli gracieux si
  le créneau exact n'existe pas à la durée par défaut (comportement actuel).
- Durées **non** persistées dans l'URL (scope serré).

## Tests

- Backend `availability.service.test.ts` : `clubSportId` ajoute le filtre au `where` ;
  absent → pas de filtre de sport.
- Frontend : `ClubReserve.deeplink.test.tsx` passe inchangé (mock renvoie la dispo quel que
  soit l'arg). Nouveau cas : deux sports → `getClubAvailability` appelé une fois par sport
  avec le bon `clubSportId` et la bonne durée.

## Hors périmètre

- Horaires d'ouverture par sport (restent par terrain via `Resource.openHour/closeHour`).
- Pas de filtrage sport-d'abord (Option A), pas de durée dans l'URL.
- `/admin/planning` (formulaire de blocage) non concerné.
