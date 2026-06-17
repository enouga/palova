# Cours individuels/collectifs + récurrence des réservations — Design

Date : 2026-06-17

## Contexte

Le planning admin (`/admin/planning`) permet déjà au staff de créer une réservation
ponctuelle de n'importe quel type (`adminCreateReservation`), dont un bloc `COACHING`
avec terrain bloqué + 1 membre optionnel + intitulé + prix (cf.
`docs/superpowers/specs/2026-06-06-evenements-admin-planning-design.md`). Mais :

- pas de **coach** identifié (qui donne le cours) ;
- pas de **cours collectif** (un seul membre possible, pas de capacité ni de liste d'attente) ;
- pas de **récurrence** (une réservation = une occurrence, créée à la main).

On veut un vrai système de **cours individuels ou collectifs** géré par le staff/admin
depuis le planning, **et** un mécanisme de **récurrence hebdomadaire générique** applicable
à **tous les types** de réservation (le cours n'en est qu'un cas enrichi).

État du code de référence : `backend/prisma/schema.prisma`, `backend/src/services/reservation.service.ts`,
`backend/src/services/event.service.ts` (modèle d'inscription/attente/promotion à réutiliser),
`backend/src/routes/admin.ts`, `frontend/app/admin/planning/page.tsx`, `frontend/app/events/page.tsx`.

## Objectif

Permettre à un gestionnaire de club (OWNER/ADMIN/STAFF, déjà authentifié et scopé par
`/api/clubs/:clubId/admin`) de :

1. gérer un **catalogue de coachs** (entité propre au club, indépendante des comptes staff) ;
2. créer des **réservations récurrentes** (série hebdo avec date de fin) de n'importe quel type ;
3. créer et gérer des **cours** (individuels = 1 place, ou collectifs = N places) avec coach,
   capacité, **liste d'attente** et **auto-inscription joueur activable par cours** ;
4. côté joueur, **s'inscrire** aux cours ouverts (intégrés à `/events`) et les retrouver
   dans son calendrier, avec **emails** d'inscription/attente/promotion/désinscription.

## Décisions de cadrage (validées)

| Sujet | Décision |
|---|---|
| Socle technique | **Option A** : un cours s'appuie sur une `Reservation` (type `COACHING`) qui bloque le terrain (conflits Serializable, rendu planning, SSE déjà robustes) + un enregistrement `Lesson` 1‑pour‑1 pour la logique cours. |
| Récurrence | **Générique, tous types** de réservation. Série hebdo **avec date de fin**, toutes les occurrences générées d'un coup. Annulation/modification possible d'**une** séance sans casser la série. |
| Coach | Entité `Coach` **dédiée, gérée par le club** (nom, photo…), distincte des comptes staff. |
| Élèves | **Comptes joueurs uniquement** (membres), choisis dans l'annuaire — pas de nom libre. |
| Auto-inscription | **Choisie par cours** à la création (`allowSelfEnroll`). Sinon le cours est géré 100 % par le staff. |
| Mode d'inscription (récurrent) | **Choisi par cours** : `SERIES` (inscription au trimestre, attendu chaque semaine) ou `PER_SESSION` (drop-in, roster propre à chaque séance). |
| Tarif | **Aucun en v1** — organisation seulement. Paiement/caisse = évolution ultérieure. |
| Côté joueur | Intégré à **`/events`** (même langage visuel), pas de page dédiée. |
| Emails | **En v1** (réutilise l'infra `notifications.ts`). |

## Modèle de données (migrations additives)

### `Coach` (nouveau)
```
Coach {
  id        String   @id @default(cuid())
  clubId    String
  name      String
  photoUrl  String?
  bio       String?
  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  club      Club     @relation(...)
  lessons   Lesson[]
  series    ReservationSeries[]
  @@index([clubId])
}
```
Géré par le club via `/admin/coaches`. Suppression = soft (`isActive=false`) pour préserver
l'historique des cours passés.

### `ReservationSeries` (nouveau — récurrence générique)
```
ReservationSeries {
  id          String          @id @default(cuid())
  clubId      String
  resourceId  String
  type        ReservationType                 // COURT | COACHING | TOURNAMENT | EVENT
  title       String?
  weekday     Int                             // 1–7 (Luxon, 1=lundi)
  startLocal  String                          // "18:00" (heure locale du club)
  durationMin Int
  startDate   DateTime        @db.Date         // 1re séance (jour local)
  endDate     DateTime        @db.Date         // dernière séance incluse (jour local)
  // Params « cours » — renseignés seulement si type=COACHING géré en cours, sinon null :
  coachId         String?
  capacity        Int?
  lessonKind      LessonKind?                  // INDIVIDUAL | COLLECTIVE
  allowSelfEnroll Boolean?    @default(false)
  enrollmentMode  EnrollmentMode?              // SERIES | PER_SESSION
  cancelledAt DateTime?                        // série close (occurrences futures annulées)
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  club        Club            @relation(...)
  coach       Coach?          @relation(...)
  reservations Reservation[]
  enrollments  LessonEnrollment[]              // roster de série (mode SERIES)
  @@index([clubId])
}
```

### `Reservation` (additif)
- Ajout `seriesId String?` + relation `series ReservationSeries?` (null = ponctuelle).
- Aucune autre modification. Une `Reservation` de type `COACHING` peut exister **sans**
  `Lesson` (= simple bloc coaching, comportement actuel conservé).

### `Lesson` (nouveau — 1‑pour‑1 avec une Reservation COACHING gérée en cours)
```
Lesson {
  id            String   @id @default(cuid())
  reservationId String   @unique
  clubId        String
  coachId       String
  capacity      Int                            // individuel = 1, collectif = N
  lessonKind    LessonKind
  allowSelfEnroll Boolean @default(false)
  seriesId      String?                         // occurrence d'une série (sinon ponctuel)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  reservation   Reservation @relation(...)
  coach         Coach       @relation(...)
  enrollments   LessonEnrollment[]              // roster d'occurrence (mode PER_SESSION)
  @@index([clubId])
  @@index([seriesId])
}
```
À la génération d'une série de cours, chaque `Lesson` **copie** (snapshot) `coachId`,
`capacity`, `lessonKind`, `allowSelfEnroll` depuis la série — ainsi une occurrence peut
diverger (édition d'une séance) sans impacter les autres.

### `LessonEnrollment` (nouveau — inscription élève, polymorphe)
```
LessonEnrollment {
  id        String             @id @default(cuid())
  lessonId  String?                              // set si inscription PER_SESSION
  seriesId  String?                              // set si inscription SERIES
  userId    String
  status    RegistrationStatus @default(CONFIRMED) // CONFIRMED | WAITLISTED | CANCELLED (enum réutilisé)
  cancelledAt DateTime?
  createdAt DateTime           @default(now())    // = ordre de liste d'attente
  updatedAt DateTime           @updatedAt
  lesson    Lesson?            @relation(...)
  series    ReservationSeries? @relation(...)
  user      User               @relation(...)
  @@unique([lessonId, userId])
  @@unique([seriesId, userId])
  @@index([lessonId, status, createdAt])
  @@index([seriesId, status, createdAt])
  @@index([userId])
}
```
**Invariant** : exactement un de `lessonId` / `seriesId` est renseigné (validé dans le service ;
optionnellement un CHECK SQL). Le « conteneur » porte la capacité :
- mode **PER_SESSION** → conteneur = `Lesson` (`lesson.capacity`), inscriptions où `lessonId=…` ;
- mode **SERIES** → conteneur = `ReservationSeries` (`series.capacity`), inscriptions où `seriesId=…`,
  affichées sur **chaque** occurrence.
- Cours ponctuel (sans série) → toujours conteneur = `Lesson`.

### Nouveaux enums
```
enum LessonKind     { INDIVIDUAL  COLLECTIVE }
enum EnrollmentMode { SERIES      PER_SESSION }
```
`RegistrationStatus` (CONFIRMED/WAITLISTED/CANCELLED) est **réutilisé** tel quel.

Toutes les migrations sont **purement additives** (nouvelles tables + colonnes nullables ;
aucune donnée existante cassée). Noms indicatifs : `add_coaches`, `add_reservation_series`,
`add_lessons`. Appliquées en prod au prochain `prisma migrate deploy`.

## Récurrence : génération, édition, annulation

### Génération (à la création de la série)
- Saisie staff : terrain, type, **jour de semaine**, **heure de début + durée**, **date de début**,
  **date de fin** (+ params cours si `COACHING`).
- Le backend énumère chaque date du `weekday` entre `startDate` et `endDate` (fuseau club via
  Luxon), convertit en UTC, et crée les `Reservation` (`status: CONFIRMED`, `type`, `seriesId`)
  dans une **transaction Serializable**. Pour un cours, crée aussi le `Lesson` snapshoté.
- **Conflit terrain** : pour chaque occurrence, mêmes prédicats de chevauchement que `holdSlot`
  (CONFIRMED, ou PENDING < 10 min, sur `[start,end)`). Politique → **on saute** les créneaux
  occupés et on renvoie un récap `{ created: n, skipped: [{date, reason}] }`. (Un conflit isolé
  ne bloque pas toute la série.)
- **Garde-fou** : refus `SERIES_TOO_LONG` si > 60 occurrences (ou > 12 mois).
- Pas d'horizon glissant (date de fin obligatoire → génération complète en une fois).

### Édition / annulation
- **Annuler une séance** : la `Reservation` de l'occurrence → CANCELLED (terrain libéré, SSE
  `slot_released`), série intacte. Pour un cours : le `Lesson` et ses inscrits PER_SESSION suivent.
- **Modifier une séance** (heure/coach/capacité…) : agit sur cette occurrence seule (elle diverge,
  c'est voulu) — réutilise l'édition d'une réservation existante.
- **Annuler la série** (`adminCancelSeries`) : annule **toutes les occurrences futures**
  (CONFIRMED → CANCELLED, à partir d'aujourd'hui fuseau club), conserve le passé, pose
  `ReservationSeries.cancelledAt`. SSE par terrain impacté.
- **Hors v1** : « cette séance **et les suivantes** » en masse, déplacement d'une série entière,
  récurrence non hebdo.

## Inscriptions (élèves)

Logique calquée sur `EventService` (transaction Serializable + `SELECT FOR UPDATE` sur le
conteneur), paramétrée par le conteneur (`Lesson` ou `ReservationSeries`) :

- **PER_SESSION** : roster propre à chaque séance ; un élève peut être présent une semaine et
  pas la suivante.
- **SERIES** : roster unique au niveau série ; inscrit une fois = attendu à toutes les séances.
  Annuler une occurrence ne désinscrit personne de la série.
- Capacité atteinte → `WAITLISTED` ; à une désinscription, **promotion auto** du premier en
  attente (renvoie l'id promu pour notification), comme `cancelAndPromoteTx`.
- BLOCKED refusé partout. Auto-inscription joueur **uniquement si `allowSelfEnroll`** (sinon 403
  `SELF_ENROLL_DISABLED`). Le staff peut toujours ajouter/retirer un élève.

## Backend (services & routes)

### `CoachService` + routes admin
`/api/clubs/:clubId/admin/coaches` : `GET` (liste), `POST`, `PATCH /:id`, `DELETE /:id`
(soft `isActive=false`). Photo : réutilise l'infra multer existante (variante
`POST …/coaches/:id/photo`, mêmes contraintes 2 Mo / JPEG-PNG-WebP, stockage `uploads/`,
servi par `express.static`).

### Récurrence (dans `reservation.service.ts`)
- `adminCreateSeries({ clubId, resourceId, type, title?, weekday, startLocal, durationMin, startDate, endDate, lessonParams? })`
  → `{ created, skipped }`.
- `adminCancelSeries(seriesId, clubId)` → annule les occurrences futures + SSE.
- `adminCreateReservation` (existant) gagne un `lessonParams?` optionnel (cours **ponctuel**).
- Routes : `POST /api/clubs/:clubId/admin/reservation-series`, `DELETE …/reservation-series/:id`.

### `LessonService` (miroir simplifié d'`EventService`)
- `enroll(container, userId)` / `cancelEnrollment(container, userId)` — `container` =
  `{lessonId}` ou `{seriesId}` ; capacité + waitlist + promotion.
- `adminAddStudent` / `adminRemoveStudent`.
- `listStudents(container)` → `{ userId?, firstName, lastName, avatarUrl, status, waitlistPosition }`
  (jamais l'e-mail), comme events.
- Routes joueur : `POST /api/lessons/:id/enroll`, `DELETE /api/lessons/:id/registration`,
  `GET /api/lessons/:id/participants`, `GET /api/me/lessons`. Le `:id` désigne une occurrence
  (`Lesson`) ; le service route vers le bon conteneur selon `enrollmentMode`.
- Routes admin : `POST/DELETE /api/clubs/:clubId/admin/lessons/:id/students`.

### Mapping erreurs (ajouts au `ERROR_STATUS` admin)
`COACH_NOT_FOUND` 404, `RESOURCE_NOT_FOUND` 404, `CLUB_MISMATCH` 403, `VALIDATION_ERROR` 400,
`SLOT_NOT_AVAILABLE` 409, `SERIES_TOO_LONG` 400, `SELF_ENROLL_DISABLED` 403,
`LESSON_NOT_FOUND` 404, `ALREADY_ENROLLED` 409. (Capacité atteinte = mise en attente, pas une erreur.)

### Notifications email
Réutilise `src/email/notifications.ts` + builders `emails.ts` (best-effort `safeNotify`,
**après commit**, un échec SMTP n'annule jamais l'inscription) : confirmation, mise en liste
d'attente, **promotion** « une place s'est libérée », désinscription — au joueur, et aux
organisateurs staff (OWNER/ADMIN) du club, exactement comme tournois/events.

## Frontend

### `/admin/coaches` (nouvelle page)
Liste de cartes coach (photo ou initiales), ajout/édition/désactivation. Entrée dans la sidebar admin.

### `/admin/planning` (enrichi)
- **Modale de création** : bloc **« Récurrence »** (interrupteur → jour, heure, durée, date de
  fin) disponible pour **tous les types**. Si type = **Coaching**, bloc **« Cours »** : coach,
  capacité (1 = individuel), case « ouvert à l'auto-inscription », et si récurrent → mode
  d'inscription (à la série / séance par séance). Soumission série → récap (« 12 créées, 2 ignorées »).
- **Modale de détail** d'une séance de cours : coach, jauge places (n/capacité), **liste des
  élèves** (avatars, liste d'attente) avec **ajouter/retirer** (recherche annuaire, API membres
  existante), badge « Série · mardi 18h » si occurrence de série, boutons **« Annuler cette
  séance »** / **« Annuler la série »**.
- **Bloc planning** : étiquette `title` sinon « Cours · [coach] » ; pastille de remplissage.

### Côté joueur (intégré à `/events`)
- Les cours **ouverts** (`allowSelfEnroll`) apparaissent dans `/events` (onglet/filtre **« Cours »**),
  cartes `AgendaCard` + fiche type `/events/[id]` (réutilisation des briques `agenda`/`event`).
- Inscription/désinscription + position liste d'attente.
- **« Mes cours »** : les cours où je suis inscrit remontent dans « Mes réservations » / Calendrier
  (fusion client existante `/api/me/*`, on ajoute `/api/me/lessons`).

### Helpers purs
`frontend/lib/lessons.ts` (capacité, jauge, libellés individuel/collectif), `frontend/lib/recurrence.ts`
(calcul des dates d'occurrences, **miroir** de la logique backend — à garder synchronisés).

## Découpage (un plan d'implémentation par lot)

- **Lot 1 — Coachs + récurrence générique** : `Coach` + `/admin/coaches` ; `Reservation.seriesId`
  + `ReservationSeries` + `adminCreateSeries`/`adminCancelSeries` ; bloc « Récurrence » planning
  (tous types) ; récap création. Livrable autonome (réservations récurrentes de tout type).
- **Lot 2 — Cours (staff)** : `Lesson` + `LessonEnrollment` + `LessonService` (capacité, attente,
  promotion polymorphe) ; bloc « Cours » à la création ; gestion des élèves dans la modale de
  détail (ajout/retrait staff). Géré 100 % back-office.
- **Lot 3 — Côté joueur + emails** : `allowSelfEnroll`, intégration `/events` (filtre Cours +
  fiche), « Mes cours » dans Calendrier, emails (inscription/attente/promotion/désinscription).

## Hors périmètre (évolutions ultérieures)

- Tarif / paiement / caisse des cours.
- Édition « cette séance + les suivantes » en masse ; déplacement d'une série entière.
- Absence ponctuelle d'un élève inscrit à la série (« je saute mardi prochain »).
- Coach lié à un compte utilisateur (« mon planning coach »).
- Récurrence non hebdomadaire (quinzaine, mensuel, multi-jours).

## Tests

- **Services (Jest)** : génération de série (dates correctes au fuseau club, saut des conflits +
  récap, `SERIES_TOO_LONG`), capacité/waitlist/promotion **polymorphe** (lesson vs series),
  invariant `lessonId xor seriesId`, gardes IDOR/`CLUB_MISMATCH`, `SELF_ENROLL_DISABLED` → 403,
  notifications appelées avec le bon id (et échec email non bloquant).
- **Routes (supertest)** : 201/200 + 400/403/404/409 mappés ; auto-inscription refusée quand
  désactivée.
- **Front** : helpers purs (`recurrence.ts`, `lessons.ts`) ; composants (modale création
  série/cours, gestion des élèves, intégration filtre Events).
- **Vérif navigateur manuelle** : `/admin/coaches`, création d'une série de chaque type, création
  d'un cours collectif + ajout d'élèves + liste d'attente, annulation d'une séance vs de la série,
  flux joueur d'auto-inscription, réception email.
