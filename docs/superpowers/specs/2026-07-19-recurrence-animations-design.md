# Récurrence des animations (mêlée hebdo) — design

**Date** : 2026-07-19
**Statut** : validé (brainstorming avec Eric)

## Problème

Un `ClubEvent` (mêlée, stage, soirée…) n'a aucune notion de récurrence — une mêlée hebdomadaire
doit être recréée à la main par le staff chaque semaine, alors que le repo a déjà un mécanisme de
récurrence hebdomadaire éprouvé pour les créneaux/cours (`ReservationSeries` +
`backend/src/services/recurrence.ts::weeklyOccurrences`), jamais branché sur les événements.

## Décisions (choix utilisateur)

- **Série bornée**, comme `ReservationSeries` : date de début ET date de fin saisies à la
  création, toutes les occurrences générées d'un coup (plafond **60**, réutilise
  `weeklyOccurrences` tel quel — aucune modification de ce helper). Pas de récurrence à durée
  indéterminée / cron.
- **Série persistée**, prolongeable et annulable en bloc (mirroir `ReservationSeries`) — pas une
  simple création groupée fire-and-forget.
- **Clôture des inscriptions** : un **délai fixe avant le début**, saisi une fois pour toute la
  série (ex. « 4h avant »), appliqué à chaque occurrence sur son propre horaire — pas une heure de
  clôture absolue récurrente (« tous les mardis 20h »), jugé trop complexe à saisir/valider pour la
  v1.
- **Annulation de la série** : annule **toutes** les occurrences futures, y compris celles qui ont
  déjà des inscrits — en réutilisant tel quel le chemin d'annulation d'un event existant
  (notification « activité annulée par le club » + remboursement des inscrits payés, déjà testés),
  pas une règle « seulement si personne n'est inscrit ».

## Portée exacte

Concerne uniquement `ClubEvent` (animations : MELEE/STAGE/SOIREE/INITIATION/AUTRE). Les tournois
(`Tournament`) restent hors périmètre — une compétition n'a pas vocation à se répéter à
l'identique chaque semaine. Une fois générées, les occurrences sont des `ClubEvent` **tout à fait
normaux** : elles s'affichent sur `/events`, s'inscrivent, s'annulent, se republient comme n'importe
quel event — la série n'intervient que pour la génération initiale et deux actions de gestion en
bloc (prolonger / annuler).

## Modèle de données

Migration additive — nouveau modèle **`ClubEventSeries`** (mirroir de `ReservationSeries`) :

```prisma
model ClubEventSeries {
  id                  String    @id @default(cuid())
  clubId              String    @map("club_id")
  name                String
  kind                ClubEventKind
  description         String?
  capacity            Int?
  price               Decimal?  @db.Decimal(10, 2)
  memberOnly          Boolean   @default(true) @map("member_only")
  requirePrepayment   Boolean   @default(false) @map("require_prepayment")
  clubSportId         String?   @map("club_sport_id")
  weekday             Int                                    // 1=lundi … 7=dimanche (Luxon)
  startLocal          String    @map("start_local")          // "HH:mm"
  durationMin         Int       @map("duration_min")
  deadlineLeadMinutes Int       @map("deadline_lead_minutes") // clôture = début − ce délai
  startDate           DateTime  @map("start_date") @db.Date
  endDate             DateTime  @map("end_date") @db.Date
  cancelledAt         DateTime? @map("cancelled_at")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  club   Club        @relation(fields: [clubId], references: [id], onDelete: Cascade)
  events ClubEvent[]

  @@index([clubId])
  @@map("club_event_series")
}
```

`ClubEvent` gagne un champ additif **`seriesId String? @map("series_id")`** (FK vers
`ClubEventSeries`, `onDelete: SetNull` — supprimer la série ne doit jamais supprimer les
occurrences déjà créées) + relation inverse. Un event créé normalement (hors série) garde
`seriesId: null`, comportement 100 % inchangé.

## Backend

### Génération — réutilise `weeklyOccurrences` sans le modifier

`backend/src/services/recurrence.ts::weeklyOccurrences({ weekday, startLocal, durationMin,
startDate, endDate, tz })` renvoie déjà `Occurrence[] { startUtc, endUtc }` — générique, sans
dépendance aux réservations. Aucune modification de ce fichier.

### `EventService.adminCreateSeries(clubId, input)`

- Valide les champs gabarit (mêmes règles que `validateEventInput` existant) + les champs de
  récurrence (`weekday` 1–7, `startLocal` `HH:mm`, `durationMin` > 0, `startDate`/`endDate`
  `YYYY-MM-DD`, `deadlineLeadMinutes` > 0).
- Appelle `weeklyOccurrences(...)` (fuseau = `Club.timezone`) → lève `VALIDATION_ERROR` /
  `SERIES_TOO_LONG` (> 60) comme le fait déjà `adminCreateSeries` des réservations.
- Dans une transaction : crée `ClubEventSeries`, puis un `ClubEvent` par occurrence avec
  `startTime = occ.startUtc`, `endTime = occ.endUtc`,
  `registrationDeadline = occ.startUtc − deadlineLeadMinutes minutes`, `seriesId`, et **le même
  `status`** (DRAFT ou PUBLISHED, choisi une fois pour toute la série) pour chaque occurrence.
- Renvoie `{ series, events }` (ids + dates, pour affichage immédiat côté admin).

### `EventService.adminExtendSeries(seriesId, clubId, newEndDate)`

- Charge la série (`CLUB_MISMATCH` si `clubId` ne correspond pas, `SERIES_NOT_FOUND` sinon,
  `SERIES_CANCELLED` si `cancelledAt` déjà posé).
- Recalcule `weeklyOccurrences` sur la fenêtre **complète** `startDate..newEndDate`, ne garde que
  les occurrences dont `startUtc` est strictement postérieur à la dernière occurrence déjà
  existante de la série (évite les doublons), plafonné à **60 occurrences au total sur la série**
  (compte les existantes + les nouvelles ; delta refusé avec `SERIES_TOO_LONG` si le total
  dépasserait 60).
- Crée les nouveaux `ClubEvent` (mêmes champs gabarit + `status` = celui de la série au moment de
  l'extension — donc si la série a été publiée puis qu'une occurrence a été repassée en brouillon
  individuellement, l'extension ne revient pas dessus, elle ne fait qu'ajouter du neuf), met à jour
  `series.endDate = newEndDate`.

### `EventService.adminCancelSeries(seriesId, clubId)`

- Mêmes gardes que `adminExtendSeries`, **sauf** `SERIES_CANCELLED` : appeler l'annulation sur une
  série déjà annulée est **idempotent** (aucune erreur, renvoie simplement `{ cancelled: 0 }` s'il
  ne reste aucune occurrence future non annulée), cohérent avec les autres actions idempotentes du
  repo.
- Sélectionne les `ClubEvent` de la série avec `startTime > now()` et `status !== 'CANCELLED'`.
- Pour **chacun**, appelle **l'`updateEvent(id, clubId, { status: 'CANCELLED' })` existant tel
  quel** (pas de duplication de logique) — ce qui déclenche déjà, par event :
  `notifyActivityCancelledByClub('event', eventId)` (best-effort) puis
  `refundAllPaidRegistrations(eventId, clubId, 'Annulation par le club')` (best-effort). Les
  occurrences passées ne sont jamais touchées.
- Marque `series.cancelledAt = now()`.
- Renvoie `{ cancelled: number }` (mirroir du retour de `adminCancelSeries` réservations).

### Routes (`backend/src/routes/admin.ts`, section STAFF existante des events)

```
POST   /api/clubs/:clubId/admin/event-series          → adminCreateSeries
POST   /api/clubs/:clubId/admin/event-series/:id/extend → adminExtendSeries  { endDate }
DELETE /api/clubs/:clubId/admin/event-series/:id        → adminCancelSeries
```

Mêmes conventions de validation body que la route `/admin/reservation-series` existante
(regex `YYYY-MM-DD` / `HH:mm`, `Number.isInteger` sur weekday/durationMin/deadlineLeadMinutes).

## Frontend

### Création (`frontend/app/admin/events/page.tsx`, formulaire inline existant)

- Case **« Se répète chaque semaine »**. Cochée → déplie un petit bloc extrait
  **`components/admin/events/RecurrenceFields.tsx`** : jour de la semaine (pré-coché sur le jour
  du `startTime` déjà saisi dans le formulaire), date de fin, délai de clôture en **chips**
  inspirées de `CANCEL_PRESETS` (`lib/onboarding.ts`, 0/4/24h) + « Autre… ».
- Décochée (défaut) → **comportement actuel strictement inchangé**, appelle toujours
  `api.adminCreateEvent`.
- Cochée → le submit appelle un nouveau `api.adminCreateEventSeries(clubId, body, token)`
  (`POST /admin/event-series`) au lieu de `adminCreateEvent`.

### Liste admin (`AgendaAdminCard`, partagé tournois/events)

- Petite **puce « Série »** (icône repeat) sur toute carte dont `seriesId` n'est pas null.
- Clic sur la puce → petit dialog **« Gérer la série »** (pattern `ConfirmDialog`) avec deux
  actions :
  - **Prolonger** : un champ date de fin → `api.adminExtendEventSeries(clubId, seriesId, {
    endDate }, token)`.
  - **Annuler la série** : `ConfirmDialog` de confirmation qui explicite « Les occurrences déjà
    inscrites seront aussi annulées et les inscrits notifiés par email » →
    `api.adminCancelEventSeries(clubId, seriesId, token)`.
- Après l'une ou l'autre action, rechargement de la liste (mêmes helpers `load()` existants).

### Types (`frontend/lib/api.ts`)

- `CreateEventSeriesBody` (= `CreateEventBody` gabarit + `weekday`/`startLocal`/`durationMin`/
  `startDate`/`endDate`/`deadlineLeadMinutes`).
- `ClubEvent.seriesId?: string | null` (additif).
- 3 méthodes : `adminCreateEventSeries`, `adminExtendEventSeries`, `adminCancelEventSeries` (même
  forme que les 2 méthodes série réservations déjà présentes).

**Rien ne change côté joueur** (`/events`, fiche `/events/[id]`, inscription) : chaque occurrence
est un `ClubEvent` ordinaire, sans notion de série exposée publiquement.

## Hors périmètre v1 (parqué)

- Récurrence à durée indéterminée (cron génération continue).
- Clôture des inscriptions à heure absolue récurrente (« tous les mardis 20h »).
- Édition en masse d'un champ gabarit sur toutes les occurrences existantes (ex. changer le prix
  de toute la série après coup) — chaque occurrence s'édite individuellement via `/admin/events`
  comme aujourd'hui.
- Récurrence pour les tournois (`Tournament`).
- Récurrence autre qu'hebdomadaire (bi-mensuelle, mensuelle…).

## Tests

- **Backend**
  - Aucun nouveau test sur `weeklyOccurrences` (réutilisé sans modification, déjà couvert).
  - Nouveau `event.service.test.ts` (bloc série) : `adminCreateSeries` (génère N events avec
    `registrationDeadline` correct par occurrence, statut homogène, plafond 60 →
    `SERIES_TOO_LONG`), `adminExtendSeries` (ajoute seulement le delta, plafond total,
    `SERIES_CANCELLED` refusé), `adminCancelSeries` (annule uniquement les futures non déjà
    annulées, appelle bien `updateEvent` par occurrence — vérifié via spy —, laisse les passées
    intactes, renvoie le bon compte).
  - Route tests `admin.event-series.routes.test.ts` (validation body, codes d'erreur).
- **Frontend** : `RecurrenceFields.test.tsx` (toggle, pré-remplissage jour, chips délai),
  `AdminEvents.test.tsx` (soumission série vs event simple, puce « Série » visible/absente, dialog
  Prolonger/Annuler, rechargement après action).
