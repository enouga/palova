# Vitrine « Le club » — refonte immersive de la section d'accueil + page /club

**Date** : 2026-07-12
**Statut** : validé sur maquettes (companion visuel, direction B retenue parmi 3)

## Contexte & objectif

La section « Le club » du Club-house est une petite carte plate (titre, texte clampé, 3 miniatures
76×56) et la page `/club` est tout aussi sobre. Objectif : un **graphisme de haut niveau** pour la
vitrine du club, avec une contrainte forte : **tout le contenu est auto-géré par les clubs** (aucune
curation Palova) et le rendu reste premium même quand un club n'a presque rien rempli (dégradé
propre, jamais cassé).

Décisions actées avec Eric (maquettes comparées dans le navigateur) :

1. **Périmètre** : la carte de l'accueil **et** la page `/club` (la promesse tient jusqu'au bout).
2. **Direction graphique** : **B « Immersif cinéma »** — la photo du club en pleine scène, voile
   sombre bas, nom en grande typo blanche, chips « verre », mini-galerie flottante. Langage du
   kiosque (reflet/voile), replis « brume bleue » (jamais de grand panneau sombre).
3. **Équipements sur l'accueil** : **bande blanche « Sur place » sous la scène** (option 1 validée)
   — la photo reste épurée, les équipements lisibles sur fond blanc.
4. **Contenu** : données **automatiques** (pistes, indoor, horaires, ville, contact) + **nouveaux
   champs optionnels auto-gérés** dans `/admin/club` : année de création, équipements.

## Données

### Existantes (aucun travail)
- `ClubPresentation` : `presentationText`, `coverImageUrl`, `address`, `city`, `latitude/longitude`,
  `contactPhone`, `contactEmail`, `openingHoursText`, `photos[]` (≤ 12, légendes, triées).
- Club (via `useClub()`) : `name`, `logoUrl`, `accentColor`, `sports[]`.

### Dérivées (backend, ajoutées au payload public)
- **Pistes** : count de `Resource` par sport du club → `courts: [{ sportKey, sportName, count,
  indoorCount }]` (`indoorCount` = `attributes.coverage === 'indoor'`).
- **Horaires structurés** : agrégat des ressources → `hours: { open, close } | null`
  (min `openHour`, max `closeHour` ; null si aucune ressource). Sert la chip « vivante »
  « ● Ouvert · jusqu'à 22h » calculée **côté client** au fuseau du club (hydration-safe : `now`
  posé en effet, chip absente avant montage). `openingHoursText` (texte libre) reste affiché sur
  `/club` en infos pratiques.

### Nouvelles (migration additive `add_club_showcase` sur `Club`)
- `foundedYear Int?` — année de création (kicker « Depuis 2021 »). Validation 1900..année+1, null OK.
- `amenities String[] @default([])` — **catalogue fermé** de 8 clés (ordre canonique) :
  `bar` Bar & cuisine · `shop` Boutique · `lockers` Vestiaires & douches · `parking` Parking ·
  `rental` Location de matériel · `terrace` Terrasse · `wifi` Wi-Fi · `coaching` Cours & coaching.
  Normalisation serveur : clés inconnues rejetées, dédup, ré-ordonnées selon le catalogue
  (constante `AMENITY_KEYS` backend, **miroir front** dans le helper — garder synchro).
- ⚠️ DEV : `prisma db execute` du SQL additif + `prisma generate` (jamais `migrate dev` — dérive
  connue) ; prod : `prisma migrate deploy`.

## Backend

- `PresentationService.getPublic` : + `foundedYear`, `amenities`, `courts`, `hours` (2 requêtes de
  plus max : resources groupées, le reste est déjà chargé). Forme existante inchangée (additif).
- `PresentationService.getAdmin` : + `foundedYear`, `amenities`.
- `PresentationService.updateText` → étendu (`foundedYear`, `amenities`) avec validation ci-dessus ;
  route `PATCH /admin/presentation` inchangée (body additif). Erreur `VALIDATION_ERROR` 400.
- Aucune nouvelle route.

## Frontend — section d'accueil (Club-house)

Nouveau composant **`components/clubhouse/ClubShowcase.tsx`** (remplace `ClubPresentationCard`,
supprimé avec sa suite de tests). La clé de section configurable **`clubCard` est inchangée**
(libellé admin « Le club »), le `SectionHeader` « Le club · Découvrir → » reste au-dessus.

### La scène (desktop ~340 px, mobile ~400 px)
- **Fond** : `coverImageUrl` sinon `photos[0]` ; voile `linear-gradient(178deg, rgba(10,14,24,.02)
  32%, rgba(10,14,24,.74) 90%)` ; la scène entière est un lien vers `/club`.
- **Tuile logo** flottante haut-gauche (fond blanc 92 %, logo du club sinon icône `ball` teintée
  accent).
- **Kicker** Righteous (`th.fontBrand`) : `[ville, « Depuis {foundedYear} »]` joints par « · »
  (segments absents omis) — encre `#cfe0f5` sur photo.
- **Titre** : nom du club, `fontDisplay` 800, ~37 px desktop / 29 px mobile, blanc + text-shadow.
- **Extrait** : `presentationText` clampé 2 lignes (blanc 86 %) ; absent → omis.
- **Chips verre** (blur 6, fond blanc 16 %, liseré blanc 35 %) : chip pistes — mono-sport padel
  « {N} pistes · {i} indoor », autre mono-sport « {N} terrains · {i} indoor », multi-sport
  « {total} terrains » (indoor omis si 0 ; le détail par sport vit sur /club) — et la chip
  horaires vivante (pastille verte `#34b27b`/`ACCENTS.emerald` si ouvert, « Ouvre à {open}h »
  sinon). Icônes du design system (`Icon`), pas d'emoji.
- **CTA** pill accent (`th.accent`, encre `inkOn`) « Découvrir le club → ».
- **Rail mini-galerie** bas-droite (desktop uniquement) : 2 tuiles photo 80×60 + tuile « +N »
  (photos restantes, cover exclue) — liens vers `/club`. **Mobile** : rail remplacé par une chip
  verre « {N} photos » (icône appareil) en haut-droite ; CTA pleine largeur.

### Bande « Sur place » (sous la scène)
Carte blanche (`cardStyle`) : label « SUR PLACE » + items icône teintée accent 13 % + libellé.
Mobile : icônes seules + « +N ». **Masquée si `amenities` vide.**

### Replis (matrice de dégradé)
- **Aucune photo ni cover** → scène « brume bleue » : `HERO_GRADIENT` + `HERO_INK`, filigrane logo
  (ou balle) en grand à ~12 % d'opacité, chips en style clair standard (pas de verre), même contenu.
- **Pas de texte** → extrait omis, la scène vit avec kicker + titre + chips.
- **Section masquée** si le club n'a **rien** de propre à montrer : ni texte, ni photo/cover, ni
  équipements, ni année (même esprit que la règle actuelle — un club neuf ne montre pas une scène
  vide).
- Jamais de grand panneau sombre hors photo (préférence forte d'Eric) : le repli est toujours brume
  bleue.

## Frontend — page `/club` (refonte, même langage)

- **Hero cinéma** pleine largeur ~300 px : même fond/voile/kicker/titre que la scène d'accueil
  (kicker enrichi du/des sports) + CTAs : pill accent « Réserver un terrain → » (`/reserver`),
  chips verre « Itinéraire » (lien maps existant) et téléphone si présent.
  Sans photo → brume bleue (même repli).
- **Corps** 2 colonnes ≥ 800 px (1.5fr / 1fr), empilé mobile :
  - Colonne principale : carte « Le club » (texte complet en paragraphes — rendu actuel conservé) ;
    « La galerie » en **mosaïque** (1re photo en 2×2, puis grille, tuile « +N » si > 5) avec la
    **lightbox existante** conservée.
  - Colonne latérale : carte « Sur place » (grille 2 col d'équipements) ; carte « Infos pratiques »
    (chip horaires vivante + `openingHoursText` + adresse/Itinéraire + tel/mail cliquables) ;
    **encart brume bleue** « Envie de jouer ? » + CTA Réserver.
  - Cartes absentes si données vides (la colonne latérale peut se réduire à l'encart CTA).

## Admin `/admin/club`

Dans la carte Présentation existante : champ **« Année de création »** (number, vide = non
affichée) + grille de **8 cases à cocher « Sur place »** (catalogue). Sauvegarde via
`adminUpdatePresentation` étendu. Aucune nouvelle page.

## Helpers purs & icônes

- **`frontend/lib/clubShowcase.ts`** (testé) : `AMENITIES` (catalogue clé/libellé/icône, miroir
  backend), `showcaseKicker(city, foundedYear)`, `courtsChip(courts)`, `openNowChip(hours, tz, now)`
  (`now: Date | null` → null = pas de chip), `coverUrl(presentation)`, `railPhotos(photos, cover)`
  (→ ≤ 2 tuiles + reste), `showShowcase(presentation)` (règle de visibilité).
- **`components/ui/Icon.tsx`** : icônes ligne ajoutées pour le catalogue (8) + `pin` et `camera`
  si absentes — style identique aux existantes.

## Accessibilité, thèmes, robustesse

- Scène = `<Link aria-label="Découvrir {nom du club}">` ; images `alt` = légende photo ; contrastes
  garantis par le voile (texte blanc) / `HERO_INK` (brume) ; chips = vrai texte.
- Thème sombre : photo + voile identiques ; brume bleue à encre fixe déjà theme-proof ; bande et
  cartes en tokens `th.*`.
- Texte club rendu en nœuds texte React (pas d'HTML), URLs via `assetUrl` (pattern anti-injection
  du kiosque).
- Hydration-safe : aucune `new Date()` au rendu (horloge posée en effet) ; zéro scroll horizontal
  mobile (grilles `minmax`, chips wrap).

## Tests

- **Backend** : `presentation.service.test` (payload enrichi, counts/indoor, hours null sans
  ressource, validation foundedYear/amenities, normalisation), route admin (body additif).
- **Front** : `clubShowcase.test` (helpers : kicker, chips, openNow ouvert/fermé/avant-ouverture/
  null, rail, visibilité), `ClubShowcase.test` (scène complète, repli brume, mobile chip photos,
  bande masquée si vide, liens), `ClubPage.test` (hero, galerie+lightbox, infos, encart),
  `AdminClub.test` (année + cases), `ClubHouse.test` (clé `clubCard` inchangée, section masquée).
- `tsc --noEmit` des deux côtés ; vérif visuelle skill `verify` (clair/sombre × mobile 390
  [mobile:false + width fixe] / desktop 1280 × club complet / club minimal).

## Hors v1

Réseaux sociaux (Instagram/Facebook), vidéo de présentation, mini-carte image (l'itinéraire reste
un lien), stats de communauté (nb membres — sensible), upload de cover dédié si absent aujourd'hui
(la 1re photo fait cover), multi-langue.
