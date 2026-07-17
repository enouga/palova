# Espace coach « Mes cours » (Lot C de l'audit des rôles)

**Date** : 2026-07-16
**Statut** : validé (design approuvé par Eric)

## Contexte et problème

L'audit des rôles (2026-07-16) a montré qu'un **coach** n'a aujourd'hui **aucun droit** : la
facette Coach (table `coaches`, `coach.service.ts` — « être coach ne confère aucun privilège
d'accès ») sert uniquement à l'assignation de cours et à l'affichage. Conséquence : un coach ne
peut **ni voir ses cours ni sa liste d'élèves**. Le seul contournement est de le nommer STAFF,
ce qui lui ouvre la caisse, la comptabilité et les réglages — exactement ce qu'on veut éviter.

Lot C ajoute un **espace coach côté joueur** : le coach connecté voit et gère ses cours sans
back-office. **Décision d'architecture (tranchée à l'audit)** : le gate n'est **PAS un rôle**
dans `ClubRole` (un rôle COACH casserait le RANK linéaire STAFF<ADMIN<OWNER et ne correspond
pas à un « moins que staff » mais à un périmètre *différent*) — c'est l'existence d'une ligne
**`Coach` active liée au `userId`** dans le club.

## Décisions de cadrage (tranchées par Eric)

- **Portée v1 = lecture + gestion des élèves** : le coach voit ses cours à venir ET passés, et
  peut **inscrire/retirer des élèves de SES cours** (pas seulement lecture).
- **Infos élève = nom + photo + téléphone** : le coach voit le téléphone de ses élèves (pour les
  joindre). Écart assumé au principe du roster existant (nom seul, `userId` jamais exposé) —
  le téléphone n'est exposé QUE dans les rosters des cours du coach.
- **Cours à venir + passés** (deux sections).
- **Placement** : page club-host `/me/coaching`, entrée « Mes cours » dans `ProfileMenu` visible
  seulement pour un coach.

## Architecture

**Aucune migration.** Les modèles `Coach` (`userId?`, `isActive`, `@@unique([clubId,userId])`),
`Lesson` (`coachId`, `reservationId`, `capacity`, `lessonKind`, `seriesId?`, `allowSelfEnroll`)
et `LessonEnrollment` (lesson- OU series-scopée, statut CONFIRMED/WAITLISTED/CANCELLED) existent.
La logique d'inscription/annulation/promotion-liste-d'attente vit déjà dans `LessonService`
(`resolveContainer`, `withCounts`, `mapRoster`, `adminEnrollStudent`, `adminRemoveStudent`,
transactions Serializable + `SELECT FOR UPDATE`).

**Frontière de sécurité = propriété du cours** (pas un rôle) : le coach connecté est résolu par
`Coach.findFirst({ where: { clubId, userId, isActive: true } })` ; un cours lui appartient ssi
`lesson.coachId === coach.id`. Toute action (voir roster, enroll, remove) re-vérifie cette
propriété côté serveur.

## 1. Backend

### 1.1 Résolution du coach + signal d'entrée
- Helper `LessonService.resolveCoach(clubId, userId): Promise<{ id: string } | null>` —
  `coach.findFirst({ where: { clubId, userId, isActive: true }, select: { id: true } })`.
- Route **`GET /api/clubs/:slug/me/coach`** (auth) → `{ isCoach: boolean }`. Résout le club
  ACTIVE par slug puis `resolveCoach`. Sert au gating de l'entrée `ProfileMenu` (appel léger,
  un `findFirst` indexé). Anonyme/non-coach → `{ isCoach: false }` (jamais 403 ici, pour ne pas
  bruiter le menu).

### 1.2 Liste des cours du coach
- Route **`GET /api/clubs/:slug/me/coach/lessons?scope=upcoming|past`** (auth). Résout le club
  ACTIVE + le coach ; **`403 NOT_A_COACH`** si pas de ligne coach active. À la première
  résolution réussie, `ensureActiveMembership(userId, clubId)` (idempotent, pattern 1re
  réservation) — pour qu'un coach sans adhésion puisse quand même utiliser le picker de membres.
- `LessonService.listCoachLessons(clubId, coachId, scope): Promise<CoachLessonRow[]>` :
  `lesson.findMany({ where: { clubId, coachId, reservation: { status: { not: 'CANCELLED' },
  startTime|endTime filtré } } })`. **upcoming** = `reservation.startTime > now`, tri
  `startTime asc`. **past** = `reservation.endTime < now`, tri `startTime desc`, **plafonné à 30**.
  Chaque cours est hydraté (coach, reservation+resource+sport, series, club) puis mappé.
- **`CoachLessonRow`** = forme proche de `PublicLessonRow` (id, lessonKind, seriesId,
  reservation {startTime,endTime,resource.name}, sport, series {title,enrollmentMode}, capacity,
  confirmedCount, waitlistCount) + **`students: CoachStudentRow[]`** + `startTime`/`endTime`
  bruts pour le tri/affichage. Pas de `club.slug` cross-club (mono-club ici).
- **`CoachStudentRow`** = `StudentRow` existant (`id`=enrollmentId, `status`, `firstName`,
  `lastName`, `avatarUrl`, `waitlistPosition`) **+ `phone: string | null`**. Nouvelle fonction
  de mapping `mapRosterForCoach` (l'existant `mapRoster` reste inchangé pour les usages publics)
  qui ajoute `phone` au `select` de `user` et le propage. Le `userId` reste NON exposé.

### 1.3 Gestion des élèves (cours du coach uniquement)
- Route **`POST /api/clubs/:slug/me/coach/lessons/:lessonId/students`** `{ userId }` (auth) →
  `LessonService.coachEnrollStudent(clubId, coachId, lessonId, targetUserId)`.
- Route **`DELETE /api/clubs/:slug/me/coach/lessons/:lessonId/students/:enrollId`** (auth) →
  `LessonService.coachRemoveStudent(clubId, coachId, lessonId, enrollId)`.
- Les deux : **assertion de propriété** `assertCoachOwnsLesson(lessonId, clubId, coachId)`
  (charge la lesson, vérifie `clubId` et `coachId` → sinon `LESSON_NOT_FOUND` / `LESSON_NOT_YOURS`
  403), puis **délèguent au cœur existant** `adminEnrollStudent`/`adminRemoveStudent`
  (mêmes garanties transactionnelles + promotion liste d'attente, zéro duplication).
- **Refus sur cours passé** : enroll/remove sur un cours dont `reservation.startTime <= now`
  → `ENROLLMENT_LOCKED` 409 (miroir de la garde `cancelEnrollment` joueur ; ajoutée dans le
  wrapper coach avant délégation).
- Codes d'erreur mappés : `NOT_A_COACH` 403, `LESSON_NOT_YOURS` 403, `LESSON_NOT_FOUND` 404,
  `ENROLLMENT_LOCKED` 409, `ALREADY_ENROLLED` 409, `MEMBERSHIP_BLOCKED` 409,
  `ENROLLMENT_NOT_FOUND` 404 (déjà mappés pour la plupart côté routes lessons admin).

### 1.4 Picker de membres
Réutilise l'existant **`GET /api/clubs/:slug/members/search?q=`** (`ClubService.searchMembers`,
renvoie id+nom, jamais l'e-mail) — le coach est membre actif (garanti par `ensureActiveMembership`
en 1.2).

## 2. Frontend

- Page **`frontend/app/me/coaching/page.tsx`** (coquille de `/me/reservations` : header club +
  ProfileSectionNav non requis). `Segmented` **À venir / Passés** (défaut À venir). Charge
  `api.getCoachLessons(slug, scope, token)`. `403 NOT_A_COACH` → message « Cet espace est
  réservé aux coachs du club. » (deep-link direct par un non-coach).
- Composants `frontend/components/coach/` :
  - `CoachLessonCard.tsx` : tuile date (jour/mois teintée), plage horaire (fuseau club), terrain,
    chip sport (si multi-sport), chip type de cours + titre de série, jauge capacité
    (confirmés/capacité). Roster = liste `Avatar` + nom + **téléphone** (lien `tel:`) + pastille
    Confirmé/Liste d'attente (position). Sur un cours **à venir** : bouton **« Ajouter un élève »**
    (ouvre un picker de recherche membre réutilisant `searchClubMembers`) + croix de retrait par
    élève (ConfirmDialog). Sur un cours **passé** : roster en lecture seule (pas d'ajout/retrait).
  - Picker d'ajout : réutilise le pattern `PartnerSearch`/annuaire (recherche débouncée →
    `searchClubMembers` → clic = enroll). Optimiste léger ou reload après succès.
- Entrée **`ProfileMenu`** : lien « Mes cours » (icône `whistle` ou `ball`) vers `/me/coaching`,
  rendu seulement si `isCoach` (chargé paresseusement via `api.getCoachStatus(slug, token)` à la
  1re ouverture, slug-gated — non appelé sur l'hôte plateforme).
- Helpers purs testés `frontend/lib/coachLessons.ts` si logique (ex. libellé de section, tri,
  regroupement) — sinon inline. Types `CoachLessonRow`/`CoachStudentRow`/`CoachStatus` + méthodes
  `getCoachStatus`/`getCoachLessons`/`coachEnrollStudent`/`coachRemoveStudent` dans `lib/api.ts`.

## 3. Gestion d'erreur

Serveur = défense en profondeur (toutes les actions re-vérifient la propriété du cours ; le
gating frontend n'est qu'un confort). `403 NOT_A_COACH` sur la page = message dédié, aucun autre
fetch. Les actions enroll/remove mappent les codes en messages FR (picker/toast). Un cours passé
qui reçoit une action → `ENROLLMENT_LOCKED` (bouton déjà masqué côté UI, garde serveur en filet).

## 4. Tests

**Backend** :
- `resolveCoach` / `GET /me/coach` : coach actif → `{isCoach:true}` ; non-coach / coach `isActive:false`
  → `{isCoach:false}`.
- `listCoachLessons` : ne renvoie que les cours du coach (coachId), filtre upcoming/past correct,
  roster inclut `phone`, `userId` absent, compteurs justes.
- `NOT_A_COACH` 403 sur `/me/coach/lessons` pour un non-coach.
- `coachEnrollStudent`/`coachRemoveStudent` : délégation OK sur un cours du coach ; **refus
  `LESSON_NOT_YOURS`** sur un cours d'un autre coach ; `ENROLLMENT_LOCKED` sur un cours passé.
- Routes : `clubs.coach.routes.test.ts` (403 non-coach, 200 coach, ownership, enroll/remove).

**Frontend** :
- `MeCoaching.test.tsx` : rend les cours à venir + passés, roster avec téléphone, ajout d'un
  élève (appelle `coachEnrollStudent`), retrait (ConfirmDialog → `coachRemoveStudent`), cours
  passé en lecture seule, `NOT_A_COACH` → message réservé.
- `ProfileMenu.test.tsx` : lien « Mes cours » présent si `isCoach`, absent sinon.
- `CoachLessonCard.test.tsx` : capacité, roster, boutons contextuels à venir/passé.

## 5. Hors périmètre v1

- **Pointage de présence** (attendance) — le vrai « plus tard », prépare l'usage de la section
  passés.
- Le coach **ne crée/n'édite pas** de cours (horaire, capacité, terrain) — reste au staff `/admin`.
- Notifications au coach (nouveaux inscrits) — les emails d'inscription existants ciblent déjà
  joueurs + organisateurs staff.
- Vue multi-clubs (un coach dans plusieurs clubs voit l'espace par sous-domaine).
- Statistiques coach, revenus, historique au-delà de 30 cours passés.

## Impact

Aucune migration, aucune route back-office modifiée, aucune garde OWNER/ADMIN/STAFF touchée. Un
coach n'a plus besoin d'être nommé STAFF pour voir/gérer ses cours. ⚠️ Les suites *real-mount*
de `ClubNav` devront mocker le nouvel appel `api.getCoachStatus` (classe de casse connue :
tout nouvel appel dans `ProfileMenu`/`ClubNav`). Réalisé sur la branche partagée
`feat/annonces-drag-drop-kiosque` (WIP d'Eric) — pas de branche dédiée.
