# Sport préféré & classement multi-sport — Design

**Date :** 2026-06-22
**Statut :** Validé (brainstorming), en attente de relecture avant plan.

## Contexte & problème

Aujourd'hui le **système de classement de partie (Glicko-2)** est « padel-only par convention » mais **pas verrouillé en code** : le modèle de données est déjà générique par sport (`PlayerRating @@unique([userId, sportId])`, `Match.sportId`, sport dérivé du terrain à la création du match), mais **tous les affichages codent `'padel'` en dur** (`getLevelsForUsers(..., 'padel')` dans reservation/event/tournament/openMatch/club services, `/api/me/rating` défaut `padel`, `clubLeaderboard` défaut `padel`).

Plutôt que de poser un garde-fou « padel-only » (option initialement envisagée puis **abandonnée**), on **assume le multi-sport** : chaque joueur choisit un **sport préféré** qui personnalise la navigation, et le classement devient réellement multi-sport.

## Décisions (issues du brainstorming)

1. **Portée** : multi-sport complet, traité en **un seul chantier** (un spec, un plan).
2. **Filtres** : le sport préféré est une **pré-sélection modifiable** (pas un filtre strict).
3. **Events** : on **ajoute un sport optionnel** à `ClubEvent` ; les pastilles de niveau le suivent si renseigné.
4. **Vues perso** : défaut = **sport préféré**, avec **sélecteur** de sport ; **calibrage manuel par sport** (généralisation de l'existant).
5. **Garde-fou padel** : **abandonné** (le multi-sport est désormais voulu).

## Modèle de données (2 migrations additives)

- `add_user_preferred_sport` : `User.preferredSportId String?` → FK `Sport` (`onDelete: SetNull`). **Nullable** → `null` = comportement actuel, aucune régression.
- `add_event_sport` : `ClubEvent.clubSportId String?` → FK `ClubSport` (`onDelete: Restrict`, cohérent avec `Tournament.clubSportId`). Nullable → event « tous sports » si non renseigné.

Aucune donnée existante modifiée. Le seed reste padel ; les comptes seedés ont `preferredSportId = null` (⇒ fallback padel partout).

## 1. Capture du sport préféré

**Inscription** (`/register`, `/clubs/new`, étape 1 du flux en 2 temps) :
- Sélecteur **optionnel** « Sport préféré » alimenté par `GET /api/sports` (sports publiés du catalogue plateforme — pas de contexte club à l'inscription).
- `POST /api/auth/register` accepte `preferredSportId?` (validé : doit exister et être publié, sinon ignoré/`VALIDATION_ERROR`).

**Profil** (`/me/profile`) :
- Sélecteur éditable « Sport préféré ».
- `PATCH /api/me` accepte `preferredSportId` (null pour effacer).
- `GET /api/me/profile` renvoie `preferredSport: { id, key, name } | null`.

## 2. Filtres pré-remplis (défaut modifiable)

- **Annuaire des clubs** (`ClubDirectory.tsx`) : l'état `sport` est initialisé au `key` du sport préféré (s'il existe), modifiable par l'utilisateur. Sans préférence → comportement actuel (aucun filtre).
- **Page Réserver** (`ClubReserve.tsx`) : `selectedSportId` par défaut = le `clubSport` dont `sport.key === preferred` **si le club le propose**, sinon `clubSports[0]` (fallback actuel inchangé).

Le sport préféré est lu côté client (présent dans le profil/contexte d'auth). Aucune contrainte serveur : ce ne sont que des défauts d'UI.

## 3. Classement contextuel (les pastilles suivent le sport du contexte)

Remplacement des `'padel'` codés en dur par le sport **du contexte** :

| Surface | Source du sport |
|---|---|
| Mes réservations (`listUserReservations`) | sport du terrain de **chaque** résa |
| Parties ouvertes (`listOpenMatches`) | sport du terrain |
| Tournois (`tournament.service`) | `tournament.clubSport.sport` |
| Events (`event.service`) | `event.clubSport.sport` **si renseigné**, sinon **pas de pastille** |

Détail d'implémentation : `getLevelsForUsers(userIds, sportKey)` traite un seul sport. Pour les surfaces multi-sport (réservations, parties ouvertes), on **regroupe les lignes par `sportKey`** et on enrichit par groupe (ou on ajoute un helper `getLevelsForUsersBySport`). Le moteur calcule déjà par sport — ce chantier est **uniquement de l'affichage**.

Les composants `PlayerPills`/`LevelChip`/`LevelBadge` ne changent pas : ils reçoivent déjà un `level` par joueur ; seul le sport servant à le calculer change. L'auto-masquage `useLevelSystem` (club `levelSystemEnabled`) reste en place.

## 4. Vues perso multi-sport (défaut préféré + sélecteur)

- `GET /api/me/rating`, `/history`, `POST /calibrate` : déjà paramétrés par `sportKey`. **Le défaut serveur passe de `'padel'` au sport préféré du user** (fallback `'padel'` si null). Côté profil : **sélecteur de sport** + **calibrage manuel par sport** (le service `RatingService.calibrate` est déjà générique).
- **Leaderboard club** + **liste des membres** (`club.service`) : sélecteur = **sports offerts par le club** ; défaut = sport préféré s'il fait partie des sports du club, sinon le 1er.

Le sélecteur de sport des vues perso liste : pour le profil, les sports où le user a un `PlayerRating` (+ possibilité d'en calibrer un nouveau = sport préféré) ; pour les vues club, les `clubSports` du club.

## 5. Enregistrement de match (garde-fou abandonné)

`MatchService.createFromReservation` **reste tel quel** (sport dérivé du terrain). Aucun garde-fou padel.

**Limite conservée (YAGNI)** : un match exige **4 joueurs** (double). Les sports en **simple** (tennis/squash format `single`, capacité 2) n'ont donc pas d'enregistrement de match → leur niveau ne bouge que par **calibrage manuel**. Assumé pour cette v1.

## 6. Compatibilité / fallbacks

- `preferredSportId = null` → exactement le comportement d'aujourd'hui (défauts padel/premier sport).
- Club ne proposant pas le sport préféré → fallback `clubSports[0]` / 1er sport du club.
- Event sans `clubSportId` → pas de pastille de niveau (au lieu d'un niveau padel arbitraire).
- Données seedées (padel) inchangées visuellement.

## 7. Tests (TDD)

**Backend**
- Migrations appliquées (champs nullable présents).
- `register` + `PATCH /api/me` : `preferredSportId` validé, lu, effaçable ; `GET /me/profile` le renvoie.
- Enrichissement niveau **par sport** : réservations / parties ouvertes mixtes (2 sports) → bons niveaux par ligne ; tournoi → sport du tournoi ; event avec sport → niveau ; event sans sport → aucun niveau.
- Défauts `me/rating` & `clubLeaderboard` : sport préféré si présent, sinon padel.

**Frontend**
- `ClubDirectory` : filtre initialisé au sport préféré, modifiable.
- `ClubReserve` : sport par défaut = préféré si offert, sinon 1er.
- Sélecteur de sport à l'inscription et au profil (envoi `preferredSportId`).
- Vues perso : sélecteur de sport (profil/leaderboard/membres), défaut préféré.
- Event sans sport → pas de pastille de niveau sur les inscrits.

## 8. Hors périmètre (YAGNI)

- Enregistrement de match en **simple** (2 joueurs).
- Traduction réelle de l'UI (reste en français malgré `locale`).
- Prompt de calibrage **forcé** à l'inscription (le calibrage reste à l'initiative du joueur).
- Dé-hardcodage des libellés « padel » purement cosmétiques **hors classement** (textes marketing, emails « partie de padel », etc.).
- Refonte des filtres `/events` (catégorie/genre/type) — inchangés.

## Fichiers principaux touchés

**Backend** : `prisma/schema.prisma` (+2 migrations), `routes/auth*` (register), `routes/me.ts` (PATCH/profile/rating défauts), `services/rating.service.ts` (helper par sport éventuel), `services/reservation.service.ts`, `services/openMatch.service.ts`, `services/tournament.service.ts`, `services/event.service.ts`, `services/club.service.ts` (leaderboard/membres défauts + sélecteur), routes/admin events (champ sport). 

**Frontend** : `lib/api.ts` (types `preferredSport`, `MyReservation`/`OpenMatch`/event sport, params sport), `components/ClubDirectory.tsx`, `components/ClubReserve.tsx`, `app/register` + `app/clubs/new` (sélecteur), `app/me/profile/page.tsx` (sélecteur + calibrage par sport), vues rating/leaderboard/membres (sélecteur de sport), `app/admin/events` (champ sport).
