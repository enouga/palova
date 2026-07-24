# Carte « partie ouverte » unifiée + rails de parties compacts en mobile

**Date** : 2026-07-24
**Statut** : validé par Eric (retour post-livraison sur la refonte des régions d'events)

## Problème

Retour d'Eric après livraison de la spec `2026-07-24-regions-events-rail-cartes-design.md` :

1. **Deux cartes différentes** pour la même chose : /decouvrir et la vitrine affichent
   `NationalMatchCard` (liseré club en haut, ligne « club · ville », chips « Pour de vrai »/genre,
   CTA « Rejoindre → ») tandis que le Club-house (« Ça joue bientôt ») a ses propres cartes
   `<article>` dans `OpenMatchesShowcase` (pas de chips de type, genre en texte dans la méta,
   CTA « Rejoindre » sans flèche, coquille différente).
2. **Vignettes trop grosses en mobile** : le rail partagé étire ces cartes plein cadre
   (~344px sur 390) alors que leur contenu est conçu pour ~272px — bouton immense, carte
   qui domine l'écran. Avant la refonte elles gardaient leur largeur fixe même en mobile.

## Décisions

### 1 · Une seule carte : `components/match/OpenMatchRailCard.tsx`

`NationalMatchCard` (components/platform/) est **déplacée et renommée** en
`OpenMatchRailCard` (components/match/) et devient LA carte de partie ouverte des rails.
`OpenMatchesShowcase` abandonne ses cartes `<article>` maison pour elle.

- **En-tête club optionnel** (prop `club?: { name, city, accentColor } | null`) : liseré
  4px en haut + point + « club · ville · distance » rendus **seulement si `club` fourni** —
  surfaces cross-club (/decouvrir, vitrine, Mon Palova) le passent, le Club-house
  (mono-club) l'omet.
- **Interface** : `{ match, club?, distanceKm?, href, timezone }` — `match` en typage
  structurel couvrant `OpenMatch` ET `NationalOpenMatch` (`id`, `startTime`, `endTime`,
  `resourceName`, `players`, `spotsLeft`, `full?`, `competitive?`, `gender?`,
  `targetLevelMin/Max?`). `timezone` passé par l'appelant (national : `m.club.timezone` ;
  club-house : sa prop `timezone`). `href` passé par l'appelant (national :
  `clubUrl(slug, '/parties/id')` cross-sous-domaine ; club-house : `/parties/id` relatif).
  La carte reste un `<a>` (ancre réelle, comme aujourd'hui côté national — le Club-house
  perd le `next/link`, navigation pleine page acceptée).
- **Le Club-house y gagne** : les chips « Pour de vrai »/« Pour le fun » + genre (la ligne
  méta redevient `terrain · niveau` seul). **La carte partagée y gagne** : l'état
  **« Complet »** (chip grise + CTA « Voir la partie ») que seule la carte Club-house
  gérait (`match.full === true` ; les flux nationaux ne renvoient jamais de partie pleine).
- **Coquille inchangée** : celle de `NationalMatchCard` actuelle (surface, radius 20,
  `shadowSoft` + filet inset, `pl-lift`), validée visuellement à la livraison.

### 2 · Rails de parties compacts en mobile : `AgendaRail.mobileColumns`

`AgendaRail` gagne une prop optionnelle **`mobileColumns?: string`**
(défaut `'calc(100% - 6px)'` = comportement actuel, inchangé pour tournois/events/clubs).
Implémentation : la règle mobile de `RAIL_CSS` lit une variable CSS
(`grid-auto-columns: var(--ag-mobile-cols)`) posée en inline par instance, comme
`--ag-cols`/`--ag-rows`.

Les **3 rails de parties** (`DiscoverMatches`, `NationalOpenMatches`,
`OpenMatchesShowcase`) passent **`mobileColumns="272px"`** ET s'unifient sur
**`desktopColumns="272px"`** (aujourd'hui 270/282/272 — convergence recommandée par la
revue finale). En mobile la vignette redevient compacte, un bout de la suivante est
visible, points de pagination et snap inchangés.

## Hors périmètre

- `OpenMatchCard` (/parties, page détail) et les autres surfaces : intouchées.
- Aucun backend, aucune migration.

## Tests & vérification

- Nouvelle suite `OpenMatchRailCard.test.tsx` (en-tête club présent/absent, chips type et
  genre, état Complet, sièges vides, href).
- `AgendaRail.test.tsx` : cas `mobileColumns` (variable CSS posée / défaut).
- Suites consommatrices adaptées aux nouveaux imports/DOM : `NationalOpenMatches`,
  `DiscoverMatches`, `HomeMatchesRail`, `OpenMatchesShowcase`, `ClubHouse`, `DiscoverPage`,
  `AnonymousView` (mocks du chemin `NationalMatchCard` → `OpenMatchRailCard`).
- `tsc --noEmit` + vérif CDP mobile 390 (les deux surfaces, clair + sombre).
