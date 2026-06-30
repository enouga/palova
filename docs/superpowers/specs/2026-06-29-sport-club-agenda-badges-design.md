# Badges sport & club sur les parties, tournois, events & cours — Design

> Date : 2026-06-29 · Statut : validé (design approuvé, prêt pour le plan)

## Contexte & intention

Un club Palova peut activer **plusieurs sports** (`ClubSport` → `Sport`), et certaines vues
agrègent des contenus de **plusieurs clubs** (calendrier national `/tournois`, calendrier
« Mes réservations »). Aujourd'hui, sur ces surfaces, **rien n'indique le sport** d'un tournoi,
d'un event, d'une partie ouverte ou d'un cours : sur un club padel+tennis, on ne sait pas à
quel sport se rapporte une compétition.

On veut, sur **toutes les surfaces qui listent ou affichent** ces contenus, ajouter :

- un **badge sport** — **uniquement si le club est multi-sport** (≥ 2 sports actifs). Sur un
  club mono-sport (padel seul), **rien ne change** (pas de bruit visuel) ;
- le **club** — **uniquement dans les vues multi-clubs** (calendrier national, « Mes
  réservations »). Le club y est **déjà affiché** (sous-titre « Club · Ville · distance » du
  calendrier national ; `club.name` dans le sous-titre de la liste « Mes »). Le travail neuf
  porte donc essentiellement sur le **badge sport** ; on s'assure seulement que le club reste
  présent là où c'est requis.

Entités couvertes : **tournois, events/animations, parties ouvertes, cours**.

## Décisions d'architecture

### A — Plomberie de la donnée « sport » : **uniforme** (retenu)

On sérialise un champ additif **`sport: { key: string; name: string }`** sur **chaque DTO** qui
représente un de ces contenus, partout où il manque. Les relations existent déjà
(`Reservation → Resource → ClubSport → Sport`, `Tournament.clubSport`, `ClubEvent.clubSport`,
`Lesson → … → ClubSport`), donc **aucune migration** : ce sont des ajouts de `select`/`include`
+ de mapping de sortie.

Un **unique helper front** lit `item.sport` ; aucune logique de mapping côté client. Ça
fonctionne **même sur l'hôte plateforme** (où il n'y a pas de `club` courant) et reste
trivialement testable.

> Alternative écartée (A2 — mapping client via `club.clubSports`) : moins d'éditions backend
> mais deux chemins de code, et cassé là où il n'y a pas de `club` (hôte plateforme, page
> « Mes »). Rejetée pour la cohérence et la testabilité.

**DTO à compléter (tous additifs, sans migration) :**

| DTO / endpoint | Fichier backend | Champ ajouté |
|---|---|---|
| `OpenMatch` (liste parties) | `openMatch.service.ts` (`listOpenMatches`) | `sport` (via `reservation.resource.clubSport.sport`) |
| `NationalTournament` | `tournament.service.ts` (`listNationalTournaments`) | `sport` (via `clubSport.sport`) |
| `ClubEvent` (liste publique) + `ClubEventDetail` | `event.service.ts` (`listPublicByClubSlug`, `getById`) | `sport` (via `clubSport.sport`, **null si `clubSportId` null**) |
| `Tournament` (liste publique) + `TournamentDetail` | `tournament.service.ts` (`listPublicByClubSlug`) | `sport` (`TournamentDetail` l'a déjà via `clubSport.sport` ; on l'aligne aussi sur la liste) |
| `MyReservation.resource` | `reservation.service.ts` (`listUserReservations`) | `resource.sport` |
| `MyTournamentRegistration.tournament` / `MyEventRegistration.event` | `tournament.service.ts` / `event.service.ts` (`listMy*`) | `sport` sur le tournoi/event embarqué |
| `MyLessonSummary` (`/me/lessons`) + `LessonSummary` (`/clubs/:slug/lessons`) | `lesson.service.ts` | `sport` |

> Note : `ClubEvent.clubSportId` est **nullable** → `sport` peut être `null` ; le helper de
> gating traite `null` comme « sport inconnu » (pas de badge, et ne compte pas comme un sport
> distinct dans un set cross-club).

### B — Traitement visuel : **chip/pill dédié** (retenu)

Une présentation unique réutilisable :

- **Cartes** (`AgendaCard`, `OpenMatchCard`) : un petit **chip sport** (nom du sport, ton
  neutre `line`, icône `Sport.icon` si dispo — repli sans icône). Sur `AgendaCard`, nouvelle
  prop optionnelle `sportLabel?: string | null` rendue dans la rangée méta (à côté du tag) ;
  rien si `null`.
- **Heros de fiche** (`AgendaHero`) : on ajoute une **pill sport** à `pills` (pas de nouvelle
  API — `pills` est déjà un tableau `{ label, strong? }[]`).
- **Liste « Mes réservations »** (`MyAgendaListItem`) : le sport est **préfixé au sous-titre
  existant** qui porte déjà le club (ex. « Padel · P500 · Messieurs · Mon Club »).

> Alternative écartée (B2 — préfixer le sport dans le texte du tag partout) : moins d'UI neuve
> mais plus dense, moins scannable, et difficile à colorer/icôner.

### Gating — un helper pur `frontend/lib/sportBadge.ts`

Deux fonctions pures, testées :

- `clubIsMultiSport(club: { clubSports: { id: string }[] } | null): boolean`
  → `(club?.clubSports.length ?? 0) > 1`. Utilisé par les **surfaces mono-club**
  (`/events`, `/parties`, club-house, fiches `/tournois/[id]`, `/events/[id]`).
- `setSpansMultipleSports(sportKeys: (string | null | undefined)[]): boolean`
  → nombre de clés **distinctes non nulles** ≥ 2. Utilisé par les **surfaces cross-club**
  (calendrier national `/tournois`, calendrier « Mes réservations »).

Règle d'affichage :

- **Badge sport** : affiché ssi (mono-club) `clubIsMultiSport(club)` **ou** (cross-club)
  `setSpansMultipleSports(set)`. Le label vient toujours de `item.sport.name`.
- **Badge club** : affiché **uniquement** sur les surfaces cross-club ; déjà présent
  (sous-titre national + sous-titre « Mes »). On le conserve, on n'en ajoute pas en mono-club.

## Surfaces touchées (front)

1. **`/events`** (`app/events/page.tsx`) — cartes tournoi / event / **cours**. Calcule
   `multi = clubIsMultiSport(club)` une fois ; passe `sportLabel={multi ? item.sport?.name : null}`
   à chaque `AgendaCard`.
2. **Calendrier national `/tournois`** (`components/calendar/TournamentFinder.tsx`) +
   **`UpcomingTournaments`** (accueil visiteur) — `multi = setSpansMultipleSports(results.map(r => r.tournament.sport?.key))` ;
   `sportLabel` conditionnel. Club déjà dans le sous-titre (inchangé).
3. **Fiche tournoi `/tournois/[id]`** (`components/tournament/TournamentHero.tsx`) — ajoute une
   pill `t.sport.name` à `pills` si `clubIsMultiSport(useClub().club)`.
4. **Fiche event `/events/[id]`** (`app/events/[id]/page.tsx`) — idem (nécessite
   `ClubEventDetail.sport`).
5. **`/parties` + club-house `OpenMatches`** (`components/openmatch/OpenMatchCard.tsx`) — chip
   sport près de `resourceName` si `clubIsMultiSport(club)` (nécessite `OpenMatch.sport`).
6. **Club-house « Prochains events »** (`components/clubhouse/TournamentsAlaUne.tsx`, type
   `AgendaItem`) — chip sport si `clubIsMultiSport(club)`.
7. **Calendrier « Mes réservations »** (`components/calendar/MyAgendaListItem.tsx`, alimenté par
   `DayPanel`/la page) — sport préfixé au sous-titre si `setSpansMultipleSports` sur l'ensemble
   fusionné. Le `DayPanel`/la page calcule le flag une fois et le passe en prop
   (`showSport: boolean`) à `MyAgendaListItem` — pas de `new Date()` ni de calcul lourd dans la
   carte.

## Types front (`frontend/lib/api.ts`)

Ajouts additifs (tous `sport: { key: string; name: string } | null` selon nullabilité) :
`OpenMatch.sport`, `NationalTournament.sport`, `Tournament.sport?`, `ClubEvent.sport`,
`MyReservation.resource.sport`, `MyTournamentRegistration.tournament.sport`,
`MyEventRegistration.event.sport`, `MyLessonSummary.sport`, `LessonSummary.sport`.

> ⚠️ Les tests qui mockent `lib/api` doivent exposer ces champs si leurs fixtures touchent ces
> surfaces.

## Tests

- **Helper pur** `frontend/__tests__/sportBadge.test.ts` : `clubIsMultiSport`
  (0/1/≥2 sports → false/false/true), `setSpansMultipleSports` (vide, une clé, doublons, nulls
  ignorés, ≥2 distinctes).
- **Composants** : `AgendaCard` rend/ne rend pas le chip selon `sportLabel` ; `OpenMatchCard`
  rend le chip si `sport` + multi-sport ; `MyAgendaListItem` préfixe le sport au sous-titre
  quand `showSport` ; heros incluent la pill sport.
- **Backend** : assertions « `sport` présent » dans `openMatch.service.test.ts`,
  `tournament.service.test.ts` (national + liste + détail), `event.service.test.ts`
  (liste + détail, **null si `clubSportId` null**), `reservation.service.test.ts`
  (`listUserReservations`), `lesson.service.test.ts`.

## Hors périmètre

- Aucune **migration** (tout est additif sur des relations existantes).
- Pas de **filtre par sport** (facette) — c'est de l'affichage, pas du filtrage.
- Pas de changement de la **logique de gating multi-club du club** (le club reste affiché
  exactement où il l'est déjà).
- Le **planning admin** et la caisse ne sont pas concernés (vues internes mono-club orientées
  ressources, hors « parties/tournois » publics).

## Risques & notes

- `ClubEvent.clubSportId` nullable → `sport` nullable partout pour les events ; le helper et
  l'UI tolèrent `null` (pas de badge).
- Hôte plateforme : pas de `club` courant → seules les surfaces cross-club s'y affichent
  (national), et elles utilisent `setSpansMultipleSports`, pas `clubIsMultiSport`. Cohérent.
- `OneDrive` peut amputer `node_modules/.prisma` après désync : si `prisma` casse au build,
  réflexe `npm install` + `npx prisma generate` (cf. CLAUDE.md). Pas de `migrate dev` ici.
