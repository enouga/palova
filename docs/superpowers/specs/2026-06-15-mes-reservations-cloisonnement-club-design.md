# Spec — Cloisonnement par club dans « Mes réservations »

Date : 2026-06-15

## Contexte / problème

La page « Mes réservations » (`frontend/app/me/reservations/page.tsx`) agrège désormais réservations + tournois + events de **tous** les clubs du joueur. Vu depuis l'app d'un club (sous-domaine), c'est trompeur : le joueur voit aussi les autres clubs. On veut, **par défaut, ne montrer que le club courant**, et **laisser chaque club ouvrir la vision des autres clubs**. Quand cette vision est ouverte, cliquer une entrée d'un autre club emmène vers l'app de ce club.

## Comportement retenu

La page lit `useClub()` → `slug` (club courant, `null` sur la plateforme) + `club.showOtherClubsReservations`.

- **Sur l'app d'un club** (`slug` défini) :
  - réglage **OFF (défaut)** → n'afficher que les items dont `club.slug === slug` (les 3 types, listes **et** calendrier) ;
  - réglage **ON** → afficher tous les clubs du joueur.
- **Sur la plateforme** (`slug` null) → vue globale inchangée (tout affiché).

**Calcul** : `showAll = !slug || !!club?.showOtherClubsReservations`. Filtrage côté client des 3 sources (`reservations`/`regs`/`events`) sur `club.slug` quand `!showAll`.

**Navigation** : une entrée est « étrangère » si `slug` existe **et** `item.club.slug !== slug`.
- Entrée **du club courant** → comportement actuel (réservation : Joueurs/Annuler ; tournoi/event : lien « Voir » vers la fiche du club).
- Entrée **étrangère** → toute la carte renvoie vers l'app de ce club : réservation → `clubUrl(slug, '/me/reservations')`, tournoi → `clubUrl(slug, '/tournois/[id]')`, event → `clubUrl(slug, '/events/[id]')`. Pas d'actions inline pour une résa étrangère.
- Sur la plateforme (pas de `slug`), aucune entrée n'est « étrangère » → actions inline conservées (pas de régression).

## Architecture / changements

**Aucun nouvel endpoint** : `/api/me/*` ne renvoie que les données du joueur ; le filtrage est purement client (chaque item porte déjà `club.slug`).

### Backend
- `backend/prisma/schema.prisma` — `Club.showOtherClubsReservations Boolean @default(false) @map("show_other_clubs_reservations")`.
- Migration additive `backend/prisma/migrations/<ts>_add_club_show_other_clubs_reservations/migration.sql` : `ALTER TABLE "clubs" ADD COLUMN "show_other_clubs_reservations" BOOLEAN NOT NULL DEFAULT false;`.
- `backend/src/services/club.service.ts` — `updateClub` accepte le booléen (param + spread conditionnel) ; `getClubBySlug` l'ajoute au `select` (exposition publique). Vérifier que le GET admin du club le renvoie déjà (renvoie la ligne).

### Frontend
- `frontend/lib/api.ts` — `ClubDetail` (public/`useClub`), `ClubAdminDetail`, `UpdateClubBody` += `showOtherClubsReservations`.
- `frontend/app/admin/settings/page.tsx` — carte « Mes réservations » avec case à cocher « Afficher aussi les réservations des autres clubs » (`set('showOtherClubsReservations', …)`, sauvegarde existante).
- `frontend/lib/calendar.ts` — helper pur `agendaItemClubSlug(item)` (slug du club d'un `AgendaListItem`), réutilisé pour le filtrage et le calcul « étranger ».
- `frontend/app/me/reservations/page.tsx` — `showAll`, filtrage des 3 sources, passage de `localSlug = slug` à `MyAgendaListItem` et `DayPanel`.
- `frontend/components/calendar/MyAgendaListItem.tsx` — prop `localSlug` ; si entrée étrangère → carte = lien vers l'app du club (pas d'actions inline).
- `frontend/components/calendar/DayPanel.tsx` — prop `localSlug` ; résa étrangère → lien « Voir » vers `clubUrl(slug, '/me/reservations')` au lieu de Annuler/Joueurs (tournoi/event : liens déjà vers la fiche du club, inchangés).

## Tests
- `frontend/__tests__/calendar.test.ts` — `agendaItemClubSlug` (3 types).
- `frontend/__tests__/MyReservationsCalendar.test.tsx` (ou nouveau) — `useClub` OFF → seuls les items du club courant ; ON → tous ; une entrée étrangère rend un lien de navigation (pas de bouton Annuler).
- `/admin/settings` — couverture de la case à cocher (si test existant).
- Backend `club.service` — `updateClub` écrit le booléen (si test existant).

## Hors périmètre
- Sélecteur de club sur la plateforme (la plateforme reste vue globale).
- Tout changement backend des endpoints `/api/me/*`.
