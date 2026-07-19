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
  « Autour de moi » du TournamentFinder). Le champ **ville** s'applique aussi aux **3 onglets** :
  Parties et Tournois filtrent sur la **ville du club** (déjà présente dans les deux payloads),
  Clubs sur son paramètre `city` existant. Les tournois **conservent en plus** leur facette
  Département (les deux se cumulent, ET inter-dimensions).

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
- Trois adaptations :
  1. **Préservation des paramètres d'URL étrangers** : son `writeUrl` reconstruit la query à
     neuf — il doit désormais préserver les paramètres qu'il ne gère pas (dont `tab=`), sinon
     chaque changement de facette éjecte l'onglet de l'URL.
  2. **Prop optionnelle `coords`** : quand la barre partagée a déjà la géoloc, le Finder la
     reçoit en seed (`coordsRef`) et active `nearMe` sans re-demander la permission. Sans prop,
     comportement actuel intact (la page `/tournois` n'existant plus, seul `/decouvrir` le
     monte, mais la prop reste optionnelle pour les tests existants).
  3. **Prop optionnelle `city`** : filtre client sur la **ville du club** (`club.city`, déjà
     dans la projection publique du calendrier national ; comparaison insensible aux
     accents/casse via `norm()`), appliqué **avant** `applyFilters` — les compteurs de facettes
     reflètent ainsi le sous-ensemble de la ville. Se cumule avec la facette Département.

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
  - `TournamentFinder.test.tsx` — `writeUrl` préserve `tab=`, prop `coords` seed `nearMe`,
    prop `city` filtre les tournois (et se cumule avec Département) ;
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

---

## Révision v2 (2026-07-19) — page unique sans onglets + recherche code postal/département

Décision d'Eric après avoir vu la v1 implémentée : **les onglets ne conviennent pas** — tout doit
vivre sur **une seule page**. Trois pistes comparées dans le companion visuel (A sections empilées
+ ancres collantes / B aperçus + « Tout afficher » / C moteur de recherche unifié) — **A retenue**.
Deuxième demande : la recherche de localisation doit accepter **le code postal et le département**,
pas seulement la ville. Cette révision **remplace la section « Onglets » du §2** ; tout le reste de
la spec (points d'entrée §1, backend §3 — complété ci-dessous, composants §4, tests §5) reste
acquis, la v1 étant déjà implémentée sur la branche `feat/page-decouvrir` (les composants
construits sont réutilisés, seule l'orchestration de la page change).

### Structure de la page (remplace « Onglets »)

- **Un seul scroll**, trois sections empilées dans cet ordre : **« Ça joue bientôt » (parties)**
  → **« Tournois »** → **« Clubs »**. Chaque section a un intitulé avec **compteur** d'items
  (après filtre de localisation).
- **Rangée d'ancres collante** (sticky sous la barre de recherche) : `Parties N · Tournois N ·
  Clubs N` — un clic **scrolle en douceur** vers la section (ce n'est PAS des onglets : les trois
  sections restent rendues et visibles). État actif par **scroll-spy** (`IntersectionObserver`,
  déjà stubé dans `jest.setup.ts` — le pattern existait dans l'ex-`ProfileSectionNav`).
- **Section Parties** = le `DiscoverMatches` existant tel quel (chips période + « À mon niveau »,
  grille `NationalMatchCard` avec distance).
- **Section Tournois** = le `TournamentFinder` existant embarqué (`hideTitle`, coords, filtre de
  localisation) avec ses facettes complètes.
- **Section Clubs** = le `ClubDirectory` contrôlé existant (nom + chips sport internes).
- **Deep-links** : les redirections passent de `?tab=` aux **ancres de hash** — `/clubs` →
  `/decouvrir#clubs`, `/tournois` → `/decouvrir#tournois` ; au chargement, la page scrolle vers la
  section du hash **après le rendu des données** (le scroll natif du navigateur arriverait avant).
  `?tab=` n'est plus lu (les seuls producteurs étaient nos propres redirections, mises à jour en
  même temps) ; le `writeUrl` du TournamentFinder continue de préserver les params étrangers
  (inoffensif désormais, on le garde). Le hash est laissé intact par `replaceState`.

### Recherche de localisation unifiée (ville, code postal ou département)

- Le champ unique de la barre partagée devient **« Ville, code postal ou département »**.
  Helper pur **`parseLocationQuery(q)`** (dans `lib/discover.ts`) :
  - `^\d{5}$` (code postal) → **réduit au département** : `deptCode` = 2 premiers chiffres
    (DOM `97x` → 3 chiffres ; `20xxx` (Corse) → matche `2A` ET `2B`) — un CP exact cherche donc
    « dans mon département », comportement assumé v1 ;
  - `^\d{2,3}$` ou `2a`/`2b` → `deptCode` direct ;
  - sinon → recherche par **nom de ville** (insensible accents/casse via `norm()`), et à défaut
    par **nom de département** (« gironde ») quand la donnée est disponible.
  - Retour : `{ city: string | null, deptCode: string | null }` (exclusifs).
- **Application aux 3 sections** :
  - **Parties** : filtre client — nécessite d'ajouter **`department`/`departmentCode`** à la
    projection club de `listNationalOpenMatches` (additif backend, symétrique du calendrier des
    tournois) + les 2 champs dans `NationalOpenMatchClub` (front).
  - **Tournois** : filtre client — `club.department`/`departmentCode` déjà dans le payload ;
    le `TournamentFinder` gagne une prop optionnelle **`deptCode?: string`** (cumulable avec sa
    facette Département, même mécanique que la prop `city` existante, appliquée avant les
    facettes).
  - **Clubs** : l'annuaire est filtré serveur — **`GET /api/clubs` (listClubs) gagne un param
    additif `dept`** (matche `Club.departmentCode`) ; `ClubDirectory` gagne une prop
    **`deptCode?: string`** transmise au fetch. Le param `city` existant ne change pas.
- La géoloc (📍 Autour de moi) est **inchangée** et cumulable (tri par distance).

### Ce qui est conservé tel quel de la v1

Backend §3 (fenêtre 14 j/cap 60/lat-lng), `lib/discover.ts` (+ `parseLocationQuery`),
`NationalMatchCard`, `DiscoverMatches`, les props embeddable du `TournamentFinder` et de
`ClubDirectory` (+ `deptCode`), authGate (2 hôtes), icône ClubNav, entrée ProfileMenu, cible du
Logotype, redirections (cibles ajustées en `#hash`). Seule `app/decouvrir/page.tsx` est réécrite
(sections + ancres + scroll-spy au lieu du montage exclusif par onglet) — conséquence assumée :
**les 3 sections fetchent toutes dès l'arrivée** (plus de montage paresseux du Finder/annuaire),
acceptable (3 requêtes publiques légères, cache navigateur).

### Tests (delta)

- `discover.test.ts` : `parseLocationQuery` (CP 5 chiffres → dept, DOM 97x, Corse 20→2A/2B,
  code direct, `2a`/`2b`, ville, nom de département, vide).
- `DiscoverPage.test.tsx` : réécrit — 3 sections rendues simultanément (compteurs), ancres
  scrollent (stub `scrollIntoView`), `#clubs`/`#tournois` au chargement, champ unique filtre les
  3 sections (`31` ne garde que les items du 31), plus aucun `?tab=`.
- `DiscoverRedirects.test.tsx` : cibles `#clubs`/`#tournois`.
- `TournamentFinder.test.tsx` : prop `deptCode` (+ cumul facette). `ClubDirectory.test.tsx` :
  prop `deptCode` → `listClubs` reçoit `dept`. Backend : projection dept dans
  `openMatch.service.test.ts`, param `dept` de listClubs dans la suite club/clubs routes.
- Vérification visuelle CDP : mêmes points que v1 + ancres collantes au scroll, 390 px.
