# Reco « parties pour toi » — Design

**Date :** 2026-06-16
**Statut :** approuvé (brainstorm)
**Lot :** Lot 4 de la feature « niveau de joueur (Glicko-2) » — sous-feature 2/3

## Contexte

La feature niveau est en place (rating Glicko par sport, niveau affiché partout, matchmaking
des parties ouvertes avec fourchette cible + filtre « à mon niveau », leaderboard club).
Il manque une **recommandation active** : pousser spontanément au joueur les parties ouvertes
à son niveau, plutôt que de le laisser filtrer une liste.

Découverte structurante : **toutes les données nécessaires existent déjà côté front.**
`api.getOpenMatches(slug, token)` renvoie les `OpenMatch[]` (avec `targetLevelMin/Max`,
`spotsLeft`, `full`, `viewerIsParticipant`, `startTime`, `players`, `resourceName`) et
`api.getMyRating(token)` renvoie le niveau du joueur. La reco se calcule donc **entièrement
côté client** — **aucun backend, aucune migration**.

## Décisions produit (validées)

1. **Deux surfaces in-app** (pas d'email en v1) : un bloc « Parties pour toi » sur le
   Club-house, ET une section « Pour toi » en tête de `/parties`.
2. **Règle de reco** (filtre, toujours) : partie **non complète**, **à venir**, où le joueur
   **n'est pas déjà** inscrit, et dont la **fourchette cible inclut** le joueur (`inRange`).
   Les parties « tous niveaux » (sans fourchette) sont incluses mais **reléguées**.
3. **Tri** : (a) distance du niveau du joueur au **centre de la fourchette** croissant
   (« tous niveaux » → distance +∞, donc en dernier) ; (b) puis `startTime` croissant.
4. **Joueur non calibré** (niveau inconnu) : pas de reco personnalisable → helper renvoie `[]`,
   les deux surfaces se masquent en silence. (La calibration est sollicitée ailleurs.)

## Architecture

### Helper pur — `frontend/lib/recommend.ts`

```ts
recommendMatches(matches: OpenMatch[], myLevel: number | null, now: Date): OpenMatch[]
```

- Si `myLevel == null` → `[]`.
- Filtre : `!m.full && new Date(m.startTime) > now && !m.viewerIsParticipant
  && inRange(myLevel, m.targetLevelMin ?? null, m.targetLevelMax ?? null)`.
- Centre de fourchette `rangeCenter(min, max)` : `(min+max)/2` si les deux ; la borne si une
  seule ; `null` si aucune (→ traité comme distance `Infinity`).
- Tri stable : clé primaire `distanceToCenter` (Infinity pour « tous niveaux »), clé secondaire
  `startTime`.
- Réutilise `inRange` de `lib/levelMatch.ts` ; ajoute `rangeCenter` (exporté pour test).

### Surface A — Club-house

Nouveau composant **`frontend/components/clubhouse/MatchesForYou.tsx`** :
- Props : `{ matches: OpenMatch[]; myLevel: number | null; timezone: string }`.
- Calcule `recommendMatches(...).slice(0, 3)`. Si vide → rend `null` (silencieux).
- En-tête « Parties pour toi » (style `sectionTitle` du Club-house), lien « Voir tout → »
  vers `/parties`. Cartes **compactes** (langage visuel `SlotsAlaUne`/`TournamentsAlaUne` :
  tuile icône `users` teintée accent, terrain, créneau via `Intl`, chip places restantes,
  chip fourchette via `rangeLabel`, avatars des joueurs présents). Chaque carte est un lien
  vers `/parties`.

Câblage dans **`frontend/components/ClubHouse.tsx`** : deux loaders additionnels
(`getOpenMatches(club.slug, token)` → `openMatches`, `getMyRating(token)` → `myLevel`),
gardés par `token` (bloc réservé aux connectés, comme « Vos réservations »). Rend
`<MatchesForYou matches={openMatches} myLevel={myLevel} timezone={club.timezone} />`
en section juste après la grille d'action. Le bloc participe au calcul `empty` existant.

### Surface B — /parties

Refactor : **extraire la carte de partie** (actuellement en JSX inline dans
`OpenMatches.tsx`) vers **`frontend/components/openmatch/OpenMatchCard.tsx`**, avec les
handlers passés en props (`onJoin`, `onLeave`, `onAddPlayer`, `onRemovePlayer`,
`onRecordResult`, état `busy`, `myLevel`, etc. — exactement ce que la carte consomme
aujourd'hui). Allège `OpenMatches.tsx` (gros fichier) sans changer le rendu.

Dans `OpenMatches.tsx`, vue « Parties » :
- `recommended = recommendMatches(matches, myLevel, now)`.
- Section **« Pour toi »** en tête = `recommended` rendus via `OpenMatchCard` (jouables).
- Section **« Autres parties »** = `visibleMatches` (liste existante, filtre « à mon niveau »
  inclus) **dé-dupliquée** : exclut les ids présents dans `recommended`.
- Si `recommended` est vide : pas de section « Pour toi », la liste garde son titre actuel
  (« Parties ouvertes ») et son comportement.
- Le filtre « à mon niveau » **reste** et agit sur « Autres parties ».
- `now` posé une fois (hydration-safe, pattern existant : pas de `new Date()` au rendu sans
  garde — l'horloge est figée au montage via un état/`useEffect`, comme dans ClubHouse).

## Tests

- **`frontend/__tests__/recommend.test.ts`** (pur) :
  - exclusions : complète, passée, déjà participant, hors fourchette ;
  - inclusion d'une « tous niveaux » mais reléguée après une fourchette qui matche ;
  - tri : deux fourchettes → la plus proche du centre d'abord ; égalité de distance → la plus
    tôt ; `myLevel == null` → `[]` ;
  - `rangeCenter` : deux bornes, une borne, aucune (null).
- **`frontend/__tests__/MatchesForYou.test.tsx`** : rend jusqu'à 3 recos ordonnées ; masqué
  (`null`) si aucune reco ou `myLevel == null` ; lien « Voir tout » vers `/parties` présent.
- **`OpenMatches`** : tests existants restent verts ; ajout d'un test « section Pour toi + la
  liste Autres parties dé-duplique le match recommandé ».
- `OpenMatchCard` : couvert via les tests OpenMatches (pas de test dédié sauf si la carte
  isolée le justifie).

## Hors périmètre (v1)

- Notifications email/push (« une partie à ton niveau cherche des joueurs »).
- Deep-link vers une partie précise depuis le Club-house (la carte mène à `/parties`).
- Reco basée sur le niveau des joueurs **déjà présents** dans la partie (on s'appuie sur la
  fourchette cible déclarée, cohérent avec le filtre existant).
- Backend / migration (aucun).
- Les autres sous-features du Lot 4 (leaderboard — fait ; corrections niveau staff — spec à part).
