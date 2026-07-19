# Page « Découvrir » (/decouvrir) — clubs, parties ouvertes & tournois de toute la plateforme

**Date** : 2026-07-19
**Statut** : validé (brainstorming avec Eric, maquettes comparées dans le companion visuel)

## Objectif

Depuis l'appli d'un club, un joueur doit pouvoir explorer le reste de Palova : trouver d'autres
clubs, des parties ouvertes à rejoindre ailleurs, et des tournois. Aujourd'hui cette matière est
éclatée (annuaire `/clubs` enfoui dans le menu profil sous « Mes clubs », parties nationales
visibles uniquement sur la landing anonyme, calendrier tournois sur `/tournois`) et sans point
d'entrée visible depuis un sous-domaine club.

On crée une **page de découverte unique `/decouvrir`** sur l'hôte plateforme, **publique**, en
**3 onglets « Parties | Tournois | Clubs »**, avec une **barre de localisation partagée** — et un
**point d'entrée visible dans la barre de navigation du club** (icône ronde au monogramme Palova).

Décisions de cadrage (maquettes comparées) :
- Emplacement du point d'entrée : **icône ronde dans la grappe d'actions** du ClubNav (option B,
  retenue contre « 6ᵉ onglet » et « wordmark à côté du nom du club »).
- Structure de la page : **onglets** (option C, retenue contre « un seul scroll parties d'abord »
  et « un seul scroll clubs d'abord »).
- Bloc parties : **recherche filtrée** (localisation, période, « à mon niveau »), pas un simple
  rail vitrine.
- Les pages `/clubs` et `/tournois` (hôte plateforme) deviennent des **redirections** vers
  `/decouvrir` — une seule surface de recherche, pas de doublon.

## 1. Points d'entrée

### Icône Palova dans `ClubNav`

- Icône ronde 38 px, même langage visuel que l'icône Messages (rond `th.surface2`), contenant le
  **monogramme Palova** : la balle SVG du `Logotype` existant (cercle + deux arcs, trait
  `th.accent`), sans le wordmark.
- Position : dans la grappe d'actions de la rangée 1 (entre le ThemeToggle et l'icône Messages).
- Visible **pour tous** — connecté ou anonyme (la page cible est publique).
- Lien : ancre pleine page vers `platformUrl('/decouvrir')` (navigation cross-sous-domaine ; en
  prod le cookie `.palova.fr` suit ; en dev l'anonymat de la page rend le sujet indolore).
- `aria-label`/`title` : « Palova — découvrir clubs, parties et tournois ».

**Parades mobile (la grappe passe à 6 icônes max chez un staff connecté)** :
- Media query ≤ 400 px : icônes de la grappe 38 → 34 px, gap 8 → 6 px.
- Largeur du logo du club plafonnée (`max-width`) en mobile — il est en `width:auto` aujourd'hui
  et un logo horizontal large peut faire déborder la rangée sur 360 px.

### Menu profil

- L'entrée « Mes clubs » du `ProfileMenu` est renommée **« Palova »** et cible
  `platformUrl('/decouvrir')`.

### Redirections & liens existants

- **`/clubs` (hôte plateforme) → `router.replace('/decouvrir?tab=clubs')`** (pattern
  `/admin/sports`). La page `app/clubs/page.tsx` devient un stub de redirection.
- **`/tournois` (hôte plateforme) → `router.replace('/decouvrir?tab=tournois')`**. La branche
  hôte club (`/tournois` → `/events?filtre=competitions`) est **inchangée**, les fiches
  `/tournois/[id]` aussi.
- Bouton d'état vide de `/me/reservations` (« Trouver un club ») : cible mise à jour vers
  `/decouvrir?tab=clubs`.
- Lien « Voir tout le calendrier → » d'`UpcomingTournaments` (landing anonyme) : mis à jour vers
  `/decouvrir?tab=tournois`.
- `Logotype` (atoms.tsx) : la destination par défaut « joueur connecté sur l'hôte plateforme »
  passe de `/clubs` à **`/`** (l'accueil personnalisé « Vos clubs » — cohérent avec le correctif
  post-login du 2026-07-19 qui envoie déjà le joueur sur `/`).
- La racine `/` (PlatformLanding) et le routage post-login ne bougent pas.

## 2. Page `/decouvrir` (hôte plateforme, publique)

### Accès & hôtes

- `app/decouvrir/page.tsx`, client. Ajoutée à **`isPlatformPublicPath`** (`lib/authGate.ts`) —
  accessible anonyme.
- Sur un **hôte club** : redirection pleine page vers `platformUrl('/decouvrir')` (miroir du
  pattern `/tournois` hôte club ; on préserve `?tab=` si présent).

### En-tête & barre de localisation partagée

- Titre « Découvrir » + sous-titre (« Clubs, parties et tournois, partout sur Palova »).
- **Barre de localisation** commune au-dessus des onglets :
  - chip **« 📍 Autour de moi »** (géoloc `navigator.geolocation`, états idle/locating/denied,
    même UX que `ClubDirectory`) ;
  - champ **ville** (texte libre).
- Portée : la géoloc alimente les **3 onglets** (tri par distance des clubs et parties, seed du
  « Autour de moi » du TournamentFinder). Le champ **ville** ne s'applique qu'aux onglets
  **Parties** (ville du club) et **Clubs** — les tournois gardent leur filtre par département,
  plus adapté à leur usage.

### Onglets

- **« Parties | Tournois | Clubs »**, défaut **Parties**. Onglet actif dans l'URL `?tab=`
  (`history.replaceState`, pattern `/admin/settings`) ; `?tab=` inconnu → Parties.

### Onglet Parties

- Source : `api.listNationalOpenMatches()` (endpoint étendu, cf. §3). **Tout le
  filtrage/tri est côté client** — même philosophie que le calendrier national des tournois.
- Cartes : pattern `NationalOpenMatches` existant (liseré/pastille `accentColor` du club, date au
  fuseau du club, sièges vides pointillés, fourchette de niveau, lien
  `clubUrl(slug, '/parties/'+id)`), enrichies de la **distance** (« · 3 km ») quand la géoloc est
  active — haversine client (réutiliser celui de `lib/tournamentCalendar.ts`, à exporter si
  besoin).
- Filtres (chips) :
  - **Période** : Aujourd'hui / Week-end / 14 jours (défaut 14 jours = tout le jeu de données).
  - **« À mon niveau »** : connecté seulement — `getMyRating(token,'padel')`, fourchette ±1
    autour du niveau arrondi, `rangesOverlap` contre `targetLevelMin/Max` (parité stricte avec
    `/parties` ; une partie sans fourchette = « ouverte à tous » passe toujours).
  - **Ville** (barre partagée) : filtre sur `club.city` (insensible aux accents/casse, `norm()`
    de `lib/members.ts`).
  - Géoloc active → tri par distance croissante ; sinon tri chronologique (ordre serveur).
- État vide : message + repli « Voir les clubs » (bascule d'onglet).
- Anonyme : tout visible sauf le chip « À mon niveau » ; « Rejoindre » vit sur la page club
  cible (flux `AuthPromptDialog` existant, inchangé).

### Onglet Tournois

- **Réutilise `TournamentFinder`** tel quel (facettes Quand/Département/Catégorie/Genre,
  compteurs, cartes `AgendaCard` cross-sous-domaine).
- Deux adaptations :
  1. **Préservation des paramètres d'URL étrangers** : son `writeUrl` reconstruit la query à
     neuf — il doit désormais préserver les paramètres qu'il ne gère pas (dont `tab=`), sinon
     chaque changement de facette éjecte l'onglet de l'URL.
  2. **Prop optionnelle `coords`** : quand la barre partagée a déjà la géoloc, le Finder la
     reçoit en seed (`coordsRef`) et active `nearMe` sans re-demander la permission. Sans prop,
     comportement actuel intact (la page `/tournois` n'existant plus, seul `/decouvrir` le
     monte, mais la prop reste optionnelle pour les tests existants).

### Onglet Clubs

- **Réutilise `ClubDirectory`**, refactoré pour accepter la localisation en props **optionnelles**
  (`city?`, `coords?`) : quand fournies, elles pilotent `listClubs` et les contrôles internes
  ville/géoloc sont masqués (la barre partagée les porte). Sans props, comportement actuel
  intact (`PlatformLanding`/`AnonymousView` ne changent pas).
- Recherche par nom + chips sport restent internes à l'onglet.
- Pré-sélection du sport préféré (comportement existant) conservée.

## 3. Backend (additif, aucune migration)

`OpenMatchService.listNationalOpenMatches` (route publique `GET /api/open-matches/national`) :

- Fenêtre : 7 → **14 jours**.
- Plafond : 12 → **60** parties non pleines (le `take` interne passe de 40 à 120 pour compenser
  le filtrage des pleines).
- Projection club : + **`latitude`/`longitude`** (déjà en base, comme le calendrier national des
  tournois) — nécessaires à la distance et au tri côté client.
- Pas de query param, pas de changement de forme cassant (champs additifs uniquement).

Types front (`lib/api.ts`) : `NationalOpenMatchClub` gagne `latitude`/`longitude`
(nullables/optionnels, convention des champs additifs).

## 4. Composants & helpers

- `app/decouvrir/page.tsx` — orchestrateur : état localisation + onglet, rend les 3 onglets.
- `components/discover/DiscoverMatches.tsx` — onglet Parties (cartes + filtres).
- Helpers purs testés `lib/discover.ts` :
  - `discoverWindow(preset, now)` — bornes Aujourd'hui/Week-end/14 jours (réutiliser la
    philosophie `whenWindow` de `lib/events.ts`) ;
  - `filterNationalMatches(matches, state, now, myLevel?)` — période + ville + niveau ;
  - `sortByDistance(matches, coords)` — haversine, les clubs sans lat/lng en fin de liste ;
  - `distanceLabel(km)` — « 3 km » / « 850 m ».
- `ClubDirectory` : props optionnelles `city?`/`coords?` (+ masquage des contrôles internes).
- `TournamentFinder` : préservation des params étrangers + prop `coords?`.
- `ClubNav` : icône Palova + media query grappe ≤ 400 px + plafond logo.
- `ProfileMenu` : renommage de l'entrée.

## 5. Tests

- **Backend** : bloc national de `openMatch.service.test.ts` étendu — fenêtre 14 j, cap 60,
  lat/lng présents dans la projection club.
- **Front** :
  - `discover.test.ts` — fenêtres de période, filtre ville/niveau, tri distance, labels ;
  - `DiscoverPage.test.tsx` — onglets + `?tab=`, filtres parties, état vide, anonyme (pas de
    chip niveau), redirection hôte club ;
  - `ClubDirectory.test.tsx` — props localisation (contrôles masqués, `listClubs` piloté) ;
  - `TournamentFinder.test.tsx` — `writeUrl` préserve `tab=`, prop `coords` seed `nearMe` ;
  - `ClubNav.test.tsx` — icône Palova visible (connecté ET anonyme), cible `/decouvrir` ;
  - `ProfileMenu.test.tsx` — entrée « Palova » ;
  - stubs de redirection `/clubs` et `/tournois` (remplace l'assertion actuelle du
    TournamentFinder monté sur `/tournois`).
- Vérification visuelle CDP : clair + sombre, desktop 1280 + mobile 390 (et grappe ClubNav en
  360 px, `mobile:false`), aucun débordement horizontal.

## Hors périmètre (v1)

- Sports non-padel pour les parties (limite produit : la visibilité PUBLIC est padel-only).
- Pagination/filtrage serveur (le plafond 60 suffit au volume actuel ; à revoir avec l'échelle).
- Rayon de recherche configurable, carte interactive.
- Section « Vos clubs » sur `/decouvrir` (elle vit sur `/`, l'accueil connecté).
- Notifications/alertes cross-clubs (les alertes de parties restent club-scopées).
