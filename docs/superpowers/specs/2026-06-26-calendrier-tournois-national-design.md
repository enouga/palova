# Calendrier national des tournois — chercheur à facettes

> **Date :** 2026-06-26
> **Statut :** Design validé (brainstorming) — prêt pour le plan d'implémentation.
> **Chantier 2** de la refonte de l'accueil `palova.fr` (cf. spec fondation `2026-06-26-accueil-plateforme-fondation-design.md`). **Dépend** de la couche géo livrée au chantier 1 (PR #14) — développé sur une branche empilée `feat/calendrier-tournois-national`.

## Contexte

Aujourd'hui les tournois sont **strictement club par club** : `TournamentService.listPublicByClubSlug(slug)` ne renvoie que les tournois `PUBLISHED` d'**un seul** club. Il n'existe aucune agrégation transverse. Le chantier 1 a posé une couche de géolocalisation des clubs (`latitude/longitude/region/postalCode`) et un emplacement « Tournois · Bientôt » sur l'accueil visiteur (`AnonymousView`).

But : un **calendrier national** des tournois, agrégeant les épreuves des clubs **volontaires**, présenté comme un **chercheur à facettes multi-sélection**.

### Décisions produit validées (brainstorming + compagnon visuel)

- **Opt-in par club** : un interrupteur unique « Publier mes tournois dans le calendrier national » (pas par tournoi, pas automatique).
- **Périmètre : tournois seuls** (pas les events/animations).
- **UX = chercheur à facettes**, pas une « forme » de calendrier. Filtres, tous en **multi-sélection** à facettes intelligentes (valeurs présentes seulement + compteurs ; OU intra-facette, ET inter-facettes) :
  **📍 Autour de moi** (géoloc, tri distance) · **Quand** (présets *Ce week-end / Ce mois-ci / 30 j / 3 mois* + plage *Du…au…*) · **Département** (multi) · **Catégorie** P25→P2000 (multi) · **Genre** (multi). **Pas de filtre Région** (le département suffit ; `region` reste en base pour l'annuaire).
- Liste de résultats secondaire (cartes `AgendaCard`), filtres **dans l'URL** (partageable).

---

## Architecture

```
┌─ Backend ───────────────────────────────────────────────────────────┐
│  schema.prisma : Club + department, departmentCode,                 │
│                  listTournamentsNationally  (migration additive)    │
│  geo.service   : geocodeAddress renvoie aussi department/code       │
│  club.service / platform.service : persistent les nouveaux champs   │
│  tournament.service : listNationalTournaments() (agrégat public)    │
│  route GET /api/tournaments/national                                │
│  scripts/geocode-clubs.ts : backfill département                    │
└─────────────────────────────────────────────────────────────────────┘
┌─ Frontend ──────────────────────────────────────────────────────────┐
│  lib/tournamentCalendar.ts : helpers PURS (facettes, filtres,       │
│        présets date, tri distance) — testés                         │
│  components/calendar/TournamentFinder.tsx + FacetPanel.tsx          │
│  app/tournois/page.tsx (hôte plateforme) : la page du calendrier    │
│  AnonymousView : section « Prochains tournois » (remplace SoonCard) │
│  proxy.ts/authGate : /tournois public sur l'hôte plateforme         │
│  admin/settings : case opt-in                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Principe clé** : l'endpoint renvoie **toute** la liste nationale à venir (fenêtre bornée) ; **tout le filtrage, le calcul des facettes et le tri se font côté client** (même philosophie que `/events` avec `lib/events.ts`). Le volume national de tournois est modeste — pas de pagination ni de filtrage serveur en v1.

---

## Backend

### Modèle de données

Migration additive **`add_national_tournament_calendar`** sur `Club` :

| Champ | Type | Rôle |
|-------|------|------|
| `department`     | `String?` | Nom du département (« Paris ») — facette + affichage |
| `departmentCode` | `String?` | Code département (« 75 ») — clé de filtre stable |
| `listTournamentsNationally` | `Boolean @default(false)` | Opt-in du club au calendrier national |

`department`/`departmentCode` sont nullables (un club non géocodable n'en a pas). Les clubs **seedés** sont mis à `listTournamentsNationally: true` en dev (sinon le calendrier est vide).

### `geo.service.ts` — extension

`geocodeAddress` renvoie aujourd'hui `{ latitude, longitude, region, postalCode, city }`. Le `context` BAN vaut `"75, Paris, Île-de-France"` = `[code, départementNom, régionNom]`. On étend `GeoResult` avec **`department`** (2ᵉ segment) et **`departmentCode`** (1ᵉʳ segment). Parsing robuste : si le contexte a moins de 3 segments, les champs manquants → `null`. `region` reste le **dernier** segment (inchangé).

### Persistance (create/update)

`club.service.createClub`/`updateClub` et `platform.service.createClubWithOwner` ajoutent `department`/`departmentCode` à côté de `region`/`postalCode` (même condition `if (geo)`/`geoData`). **Backfill** `scripts/geocode-clubs.ts` : cibler désormais `where: { OR: [{ latitude: null }, { department: null }] }` pour re-géocoder les clubs du chantier 1 (idempotent) et renseigner leur département.

### `tournament.service.ts` — agrégat national

```
listNationalTournaments(opts?: { monthsAhead?: number }) → NationalTournament[]
```
- `where`: `status: 'PUBLISHED'`, `startTime >= now`, `startTime <= now + monthsAhead` (défaut 6), `club: { status: 'ACTIVE', listTournamentsNationally: true }`.
- `include` le club (`slug, name, city, department, departmentCode, accentColor, logoUrl, latitude, longitude`) et le sport ; `orderBy: { startTime: 'asc' }`.
- Réutilise **`withCounts`** pour les places (`maxTeams`, inscrits confirmés/attente).
- Forme renvoyée par tournoi : champs tournoi publics (`id, name, category, gender, startTime, endTime, registrationDeadline, entryFee, maxTeams` + compteurs) **+ `club`** (projection ci-dessus). Pas d'e-mail, pas de données privées.

### Route

`GET /api/tournaments/national` (public, pas d'auth) → `tournamentService.listNationalTournaments()`. Montée dans `routes/tournaments.ts`. Aucun paramètre de filtre serveur en v1.

---

## Frontend

### `lib/tournamentCalendar.ts` (helpers purs, testés)

Modelé sur `lib/events.ts`. Types `CalendarFilterState` (`deptCodes: string[]`, `categories: string[]`, `genders: string[]`, `datePreset: DatePreset | null`, `from?: string`, `to?: string`, `nearMe: boolean`).
- `calendarFacets(items)` → pour chaque dimension (département, catégorie, genre), la liste des **valeurs présentes triées** + compteur (chaque facette compte sans se contraindre elle-même, comme `agendaFacets`).
- `applyFilters(items, state, now, coords?)` → applique date + département + catégorie + genre (OU intra, ET inter) ; si `nearMe` && `coords`, calcule la distance (haversine) et **trie par distance**, sinon tri par `startTime`. Ajoute `distanceKm` quand connue.
- `DATE_PRESETS` : `weekend | thisMonth | days30 | months3`, plus plage custom `from`/`to`. `resolveDateWindow(preset|range, now)` → `{ from, to }` (tz : heure locale du visiteur ; `now` injecté, jamais `new Date()` au rendu).
- `CATEGORY_ORDER` (P25→P2000) réutilisé/importé depuis `lib/events.ts`.

### Composants

- **`components/calendar/FacetPanel.tsx`** : le panneau (bouton « Autour de moi », groupes de chips multi-sélection Quand/Département/Catégorie/Genre avec compteurs, « + tous » pour les départements si nombreux, lien « Effacer »). Contrôlé (état remonté au parent). Présentation pure.
- **`components/calendar/TournamentFinder.tsx`** : orchestre — charge `api.listNationalTournaments()`, tient le `CalendarFilterState`, persiste dans l'URL (`history.replaceState`, `?quand=&dept=&cat=&genre=&near=`), gère la géoloc (`navigator.geolocation`, repli), calcule facettes + résultats via les helpers, rend `FacetPanel` + la liste de `AgendaCard`. Horloge `now` posée en effet (hydration-safe).
- **`AgendaCard`** réutilisé pour chaque tournoi ; clic → `clubUrl(club.slug, '/tournois/' + id)` (la fiche `/tournois/[id]` existe déjà par club). La carte affiche la distance (« · 8 km ») quand « Autour de moi » est actif.

### Page

- **`app/tournois/page.tsx`** : sur l'**hôte plateforme** (`useClub().slug === null`), rend le `TournamentFinder` (public). Sur un **hôte club**, comportement inchangé (le `/tournois` club redirige déjà vers `/events` — on ne touche pas à cette branche).
- **`proxy.ts`/`authGate`** : ajouter `/tournois` aux chemins publics de l'**hôte plateforme** (`isPlatformPublicPath`) pour que les visiteurs y accèdent sans login. L'hôte club est inchangé.

### Accueil

`AnonymousView` : la `SoonCard` « Tournois » devient une vraie section **« Prochains tournois »** — `components/calendar/UpcomingTournaments.tsx` : 3-4 cartes (triées par distance si géoloc déjà accordée, sinon par date) + lien **« Voir tout le calendrier → »** vers `/tournois`. Même source (`api.listNationalTournaments`). Si la liste est vide → section masquée.

### Admin

`/admin/settings` : case **« Publier mes tournois dans le calendrier national Palova »** liée à `listTournamentsNationally` (réutilise `updateClub` + le type `Club` admin). Étendre `getClubForAdmin`/`updateClub` (additif).

---

## Tests

**Backend**
- `tournament.service.test.ts` : `listNationalTournaments` ne renvoie que PUBLISHED + à venir + club ACTIVE & opt-in (exclut DRAFT, club non opt-in, club suspendu, tournoi passé) ; inclut la projection club + counts.
- `geo.service.test.ts` : parsing `department`/`departmentCode` depuis le `context` BAN ; contexte court → champs `null`.
- `club.service.test.ts` / `platform.service.test.ts` : `department`/`departmentCode` persistés au géocodage.

**Frontend**
- `tournamentCalendar.test.ts` : `calendarFacets` (valeurs présentes + compteurs), `applyFilters` (OU intra / ET inter, présets date, plage custom, tri distance avec/sans coords), `resolveDateWindow`.
- `FacetPanel.test.tsx` (toggle multi, « Effacer »), `TournamentFinder.test.tsx` (chargement, filtrage, « Autour de moi » via stub géoloc, URL).

---

## Hors périmètre (chantiers / évolutions suivantes)

- **Events/animations** dans le calendrier national (resté chantier distinct).
- Poules / tableaux / résultats ; notifications « nouveau tournoi près de chez vous » ; pagination / filtrage serveur (si le volume explose) ; favoris.

---

## Fichiers touchés (indicatif — le plan pinnera les lignes)

**Backend**
- `prisma/schema.prisma` (+ migration `add_national_tournament_calendar`).
- `src/services/geo.service.ts` (department/code), `club.service.ts`, `platform.service.ts` (persistance), `scripts/geocode-clubs.ts` (backfill département).
- `src/services/tournament.service.ts` (`listNationalTournaments` + projection), `src/routes/tournaments.ts` (route).
- Tests : `tournament.service.test.ts`, `geo.service.test.ts`, `club.service.test.ts`, `platform.service.test.ts`.

**Frontend**
- `lib/tournamentCalendar.ts` (**nouveau**), `lib/api.ts` (`listNationalTournaments` + types).
- `components/calendar/{TournamentFinder,FacetPanel,UpcomingTournaments}.tsx` (**nouveaux**).
- `app/tournois/page.tsx` (**nouveau** — branche hôte plateforme).
- `components/platform/AnonymousView.tsx` (section « Prochains tournois »).
- `proxy.ts`/`lib/authGate.ts` (`/tournois` public plateforme).
- `app/admin/settings/page.tsx` (case opt-in), types admin dans `lib/api.ts`.
- Tests : `tournamentCalendar.test.ts`, `FacetPanel.test.tsx`, `TournamentFinder.test.tsx`.

---

## Vérification (manuelle)

1. Migration + `prisma generate` + `geocode-clubs.ts` (les clubs seedés obtiennent département + sont opt-in).
2. `curl http://localhost:3001/api/tournaments/national` → tournois à venir des clubs opt-in, avec `club.departmentCode` et compteurs ; un club non opt-in ou suspendu n'apparaît pas.
3. Hôte plateforme `/tournois` (sans login) : panneau de facettes, multi-sélection Quand/Département/Catégorie/Genre (compteurs, valeurs présentes), « Autour de moi » trie par distance, filtres dans l'URL, carte → sous-domaine club `/tournois/[id]`.
4. Accueil visiteur : section « Prochains tournois » remplie + lien vers `/tournois` ; vide → masquée.
5. `/admin/settings` : la case opt-in bascule `listTournamentsNationally` (vérifier via l'API national).
6. Non-régression : `/tournois` sur un sous-domaine club redirige toujours vers `/events`.
