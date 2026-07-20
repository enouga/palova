# Découvrir — habillage « Carte en filigrane » (le Palova de tous les clubs)

**Date :** 2026-07-20
**Statut :** spec validée (design approuvé en companion visuel), en attente du feu vert d'Eric pour le plan.
**Périmètre :** 100 % frontend. Aucune migration, aucun changement backend, aucune route nouvelle.

## Intention

La page `/decouvrir` (plateforme uniquement — la vue qui **agrège tous les clubs** : parties
ouvertes, tournois et clubs de tout Palova) ressemble aujourd'hui à n'importe quelle page du
site : thème plateforme standard, aucun signal qu'on a **quitté un club pour la vue d'ensemble**.

On veut un **habillage distinctif** qui fasse comprendre d'un coup d'œil : « tu n'es plus chez un
club, tu es dans le Palova de tout le monde ». Le cadrage retenu (comparé en maquettes) est le
**territoire / « partout »** : la page prend l'allure d'un **plan** qu'on survole, avec la barre
de localisation comme point d'entrée.

**Contrainte dure (demande d'Eric) :** l'**affichage des parties, des tournois et des clubs doit
rester identique à celui d'un club**. On ne touche à **aucune** carte
(`NationalMatchCard`, les `AgendaCard` de `TournamentFinder`, les cartes de `ClubDirectory`).
Ces cartes portent déjà le **liseré + la pastille de la couleur du club** concerné — c'est
précisément cette diversité de couleurs, sur fond de plan, qui exprime « tous les clubs à la
fois ». Seul **l'habillage de la page** change (fond, en-tête, barre de localisation).

## Ce qui change (et ce qui ne change pas)

**Change** — uniquement le *chrome* de `frontend/app/decouvrir/page.tsx` :
1. Un **fond « plan » en filigrane** sur toute la hauteur de la page.
2. La **barre de localisation** promue en « héros ».
3. Le **sous-titre** de l'en-tête, reformulé.

**Ne change pas :**
- Les grilles de cartes Parties / Tournois / Clubs (composants et rendu **strictement**
  inchangés).
- La logique de la page : chargement des données, filtres, ancres collantes (`DiscoverAnchors`),
  scroll-spy, deep-links `#parties/#tournois/#clubs`, redirection hôte-club → plateforme,
  compteurs par section, géoloc.
- Les titres de section (« Ça joue bientôt », « Tournois », « Clubs ») restent tels quels.
- Le thème global (clair « daylight » / sombre « floodlit ») et le toggle : l'habillage
  s'adapte aux **deux** thèmes.

## Détail visuel (validé en companion)

### 1. Fond « plan » en filigrane

Une couche décorative **derrière tout le contenu**, très discrète, qui évoque un plan de ville :

- **Base :** un ton « plan » légèrement plus froid que le papier standard, propre à cette page.
  - Clair : `#eef1f5` (le papier standard est `#f1eee5` — le refroidir sépare visuellement la
    vue « tous clubs » d'une page club).
  - Sombre : `#111110` (charbon proche du `canvas`/`bg` du thème floodlit — **pas** un nouvel
    aplat noir dur ; on reste dans le langage sombre existant du site).
- **Motif (SVG) :** quelques **routes** (traits fins), **une route principale** teintée de
  l'accent bleu Palova, une **rivière** en pointillés cyan, des **pâtés** estompés (rectangles
  arrondis), un **rond-point** (cercle). Intensités validées :
  - Clair : routes `rgba(24,21,14,.06)`, route principale `rgba(94,147,218,.16)`, rivière
    `rgba(70,230,208,.20)`, pâtés `rgba(24,21,14,.018)`.
  - Sombre : routes `rgba(255,255,255,.05)`, route principale `rgba(94,147,218,.20)`, rivière
    `rgba(70,230,208,.16)`, pâtés `rgba(255,255,255,.02)`.
- **Épingles :** **3** épingles dessinées (forme goutte + point), aux couleurs de trois clubs
  différents (bleu `#5e93da`, émeraude `#34b27b`, violet `#bda6ff`), `opacity` ≈ `0.55`. Le point
  central de chaque épingle est rempli de la couleur du fond « plan » (contraste net dans les deux
  thèmes).
- La couche est **purement décorative** : `pointer-events: none`, `aria-hidden="true"`, placée
  **sous** le contenu (le contenu reste au-dessus). Les cartes sont opaques → elles passent
  au-dessus du plan sans aucune perte de lisibilité, et la texture ne se voit qu'**entre / autour**
  d'elles.
- **Statique** (aucune animation) → rien à prévoir pour `prefers-reduced-motion`.

### 2. Barre de localisation en « héros »

La barre existe déjà (champ ville/code postal/département + bouton « Autour de moi », hauteur
46px). On la renforce, sans changer son comportement ni ses dimensions :
- **Épingle 📍 intégrée** en tête du champ.
- **Liseré d'accent** autour du champ (`inset 0 0 0 2px` de l'accent bleu) au lieu du liseré
  neutre `th.line` actuel — c'est le point d'entrée mis en avant sur le plan.
- Le bouton « Autour de moi » et l'état géoloc (`idle`/`locating`/`denied`) sont **inchangés**.

### 3. Sous-titre

- Actuel : « Clubs, parties et tournois, partout sur Palova. »
- Nouveau : « **Un club, une partie, un tournoi — partout autour de vous.** »
- Le titre « Découvrir » reste inchangé.

## Architecture d'implémentation

Un seul composant nouveau + de petites retouches dans la page.

- **`frontend/components/discover/DiscoverMapBackground.tsx`** (nouveau) — couche « plan »
  présentationnelle, pure :
  - Lit `useTheme()` pour choisir la palette (branche sur `th.mode === 'floodlit'` vs
    `'daylight'`). Les tons « plan » et les alphas ci-dessus sont des **constantes locales au
    composant** (pas de nouveaux tokens de thème globaux — surface décorative propre à cette page,
    YAGNI).
  - Rend un conteneur `position:absolute; inset:0; z-index:0; pointer-events:none;` avec
    `aria-hidden="true"` et un `data-testid="discover-map"`, peignant la base « plan » puis le SVG
    (routes/rivière/pâtés/rond-point/épingles). Le SVG utilise `preserveAspectRatio` en mode
    *slice* et `width/height:100%` → il ne force **jamais** de débordement horizontal quelle que
    soit la hauteur de page.
- **`frontend/app/decouvrir/page.tsx`** (retouches) :
  - Monter `<DiscoverMapBackground />` comme **premier enfant** de `<Screen>` (la colonne interne
    de `Screen` est déjà `position:relative; minHeight:100vh` → l'ancre parfaite ; la couche
    `inset:0` s'étire sur toute la hauteur réelle du contenu).
  - Envelopper le contenu existant dans un `div` `position:relative; z-index:1` pour qu'il passe
    au-dessus de la couche « plan ».
  - Reformuler le sous-titre.
  - Ajouter l'épingle + le liseré d'accent au champ de localisation.
  - La couche « plan » est rendue **après** l'early-return de redirection hôte-club (`if (slug)
    return null;`) — elle n'apparaît que sur l'hôte plateforme, comme le reste de la page.

Rien d'autre n'est modifié. `DiscoverMatches`, `TournamentFinder`, `ClubDirectory`,
`DiscoverAnchors`, `lib/discover.ts` : **inchangés**.

## Accessibilité & perfs

- Couche `aria-hidden` + `pointer-events:none` → invisible pour les lecteurs d'écran et le
  pointeur ; n'entre jamais dans l'ordre de tabulation.
- Le contraste des textes n'est pas affecté (cartes et textes sont posés au-dessus, sur des
  surfaces opaques).
- SVG statique et léger (une poignée de tracés) → coût de rendu négligeable, pas de reflow, pas
  de fetch.
- Pas de débordement horizontal (SVG `slice`, `pointer-events:none`, couche `inset:0`).

## Tests

- **`frontend/__tests__/DiscoverMapBackground.test.tsx`** (nouveau) : le composant rend un élément
  `aria-hidden` avec `data-testid="discover-map"` ; vérifie qu'il choisit bien la palette selon le
  thème (monter avec un `useTheme` mocké en `daylight` puis `floodlit` et asserter une couleur de
  trait distincte — mutation-proof : changer le mode change au moins une valeur observée).
- **`frontend/__tests__/DiscoverPage.test.tsx`** (existant) : reste vert ; ajouter une assertion
  que la couche `discover-map` est présente sur l'hôte plateforme et **absente** quand `slug` est
  défini (redirection hôte-club).
- **Vérification visuelle CDP** (skill `verify`) : `/decouvrir` en **clair + sombre**, **desktop
  1280 + mobile 390** — texture discrète, épingles lisibles, barre de localisation en évidence,
  cartes intactes, **aucun débordement horizontal** (mobile vérifié en `mobile:false` + largeur
  fixe 390, cf. piège d'émulation connu).

## Hors périmètre (non fait, volontairement)

- Toute modification des cartes Parties / Tournois / Clubs.
- Nouveaux tokens de thème globaux, ou refonte du système clair/sombre.
- Animation / parallaxe du fond, plan interactif, vraie carte géographique (Leaflet/Mapbox).
- Extension de l'habillage à d'autres pages plateforme (accueil anonyme, `/tournois`, `/clubs`) —
  cette spec ne concerne que `/decouvrir`.
- Renommage de la page ou de la route (« Découvrir » reste le libellé).
```
