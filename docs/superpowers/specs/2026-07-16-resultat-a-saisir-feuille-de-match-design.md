# Résultat à saisir — carte « Feuille de match » (redesign)

**Date** : 2026-07-16
**Statut** : validé par Eric (direction A choisie parmi 3 maquettes comparées dans le companion visuel, v2 affinée validée « parfait »)
**Périmètre** : 100 % frontend — un seul composant (`ResultsToRecord.tsx`) + helpers purs + tests. Aucune migration, aucun changement backend, aucune route.

## Contexte

Le prompt « Résultat à saisir » (`frontend/components/match/ResultsToRecord.tsx`) liste les matchs padel joués sans résultat et ouvre `MatchResultModal`. Il est monté sur 3 surfaces : Club-house (`ClubHouse.tsx`), `/parties` (`OpenMatches.tsx` ×2) et `/me/matches`. La carte actuelle est une ligne générique (tuile trophée + « Résultat à saisir » + bouton) qui n'exploite rien du payload — alors que `MatchToRecord` porte les 4 joueurs (nom, avatar, équipe 1/2, slot), le type Compétitive/Amicale, le terrain et l'horaire.

Demande d'Eric : « un graphisme de fou… pas du bling bling, du truc trop classe ».

## Direction retenue : « Feuille de match » éditoriale

Trois pistes maquettées et comparées (A feuille de match éditoriale / B « moment » brume bleue / C talon de score ticket) — **A retenue**, puis v2 affinée validée sur 4 situations (desktop, empilement, mobile 390, thème sombre).

La carte devient un **carton de score** : les deux paires face à face, trois cases de sets vides en pointillés qui appellent la saisie, filets fins, petites capitales, footer teinté avec les infos pratiques en mono.

## Anatomie de la carte

Une carte par match, empilées verticalement (gap 12), chacune autonome (pas d'en-tête de section — la carte porte son propre kicker).

### Invariant des données

`listToRecord` (backend) garantit **exactement 4 participants**, padel uniquement, avec `team: 1|2` et `slot` concrets (résolus par `effectiveTeams`). La carte est donc toujours un 2v2 : deux rangées d'équipe, deux joueurs chacune. Joueurs ordonnés par `slot` (gauche puis droite) au sein de chaque équipe.

### Structure (de haut en bas)

1. **En-tête** — padding ~13px 20px :
   - à gauche, kicker petites capitales « RÉSULTAT À SAISIR » (≈10.5px, letter-spacing 2.2px, weight 700, `th.textMute`) ;
   - à droite, **chip de type**, rendu par le composant partagé `Chip` (`components/ui/atoms.tsx`) : `<Chip tone="accent">Compétitive</Chip>` / `<Chip tone="line">Amicale</Chip>` — **exactement le badge déjà rendu par `OpenMatchCard`** pour la même sémantique. Son ton `accent` gère la lisibilité dans les deux thèmes (encre `th.ink` sur lavis fort en clair ; texte accent sur lavis discret en sombre) ; un chip fait main recréerait ce piège de contraste. Source : `m.competitive === false` → Amicale, sinon Compétitive (même convention que `OpenMatchCard`). **Écart assumé vs maquette** : radius 8 du `Chip` partagé au lieu de la pill de la maquette — la cohérence avec le même badge ailleurs dans l'app prime.
2. **Filet** 1px `th.line`.
3. **Corps** (padding latéral 20px) :
   - micro-label « SETS » (9px, letter-spacing 3px, `th.textFaint`), aligné au-dessus de la colonne des cases — **desktop uniquement** ;
   - **rangée équipe 1** : pile de 2 avatars qui se chevauchent (composant `Avatar`, photo `avatarUrl` sinon initiales, `color = colorForSeed(userId)`, bord 2px couleur `th.surface`) · noms « Jean Dupont & Marie Leroy » (weight 700, 14.5px, `th.text` ; le « & » en `th.textFaint` weight 400 ; ellipsis si trop long) · **3 cases de set** vides (≈34×38, radius 9, bord 1.5px **dashed**, la 3ᵉ plus estompée — le 3ᵉ set est optionnel) ;
   - **séparateur « VS »** : deux filets `th.line` de part et d'autre d'un « VS » petites capitales `th.textFaint` letter-spacing 3px ;
   - **rangée équipe 2** : idem.
4. **Filet** 1px `th.line`.
5. **Footer teinté** (`th.surface2`, padding ~12px 20px) :
   - à gauche, infos pratiques en **mono** (`th.fontMono`, 12px, `th.textMute`) : `{resourceName} · {fmtWhen(startTime, tz)}` (format existant « mer. 15 juil. · 22h30 »), ellipsis si étroit ;
   - à droite, **CTA pill** accent (`th.accent` / `th.onAccent`, radius 99) : « Saisir le score » (desktop) / « Saisir » (compact).

Conteneur : `th.surface`, radius 18, `boxShadow: th.shadow` (ombre douce — fini le `inset 0 0 0 1px`), `overflow: hidden`.

### Variante compacte (mobile)

Bascule via le hook viewport existant `useIsDesktop(560)` (pas de mesure de conteneur) :

- avatars 28px, cases de set ≈28×32 ;
- noms abrégés « J. Dupont & M. Leroy » (helper pur `abbrevName`) ;
- micro-label « SETS » masqué ;
- CTA raccourci « Saisir » ;
- paddings latéraux 16px.

**Jamais de débordement horizontal** (règle absolue du projet) : noms en `minWidth:0` + ellipsis, cases et CTA `flexShrink:0`.

### Thème sombre (floodlit)

Mêmes tokens : surface `th.surface`, filets `th.line`, cases dashed sur `rgba(255,255,255,…)` via `th.lineStrong`/`th.line`, footer `th.surface2`, chip Compétitive en lavis accent plus opaque (~20 %) avec texte éclairci. Aucun code spécifique hors tokens + alpha ajusté sur le lavis du chip (pattern `tint()` déjà présent dans le composant).

## Comportement (inchangé)

- Fetch `getMatchesToRecord(token)`, filtre `clubSlug`, rendu `null` si vide ou anonyme.
- **Seul le bouton CTA ouvre la modale** (`MatchResultModal`, wiring identique : `initialTeams`, `locked` si PUBLIC, `competitive`, `onSaved` → reload + `onRecorded`). Les cases de sets sont décoratives (affordance), non cliquables.
- Les 3 surfaces de montage ne changent pas (le composant garde sa signature `{ token, clubSlug?, onRecorded? }` et son wrapper `padding: 18px 20px 0`).

## Implémentation

- `frontend/components/match/ResultsToRecord.tsx` — réécriture du rendu (structure ci-dessus), logique fetch/modale intacte.
- `frontend/lib/resultsToRecord.ts` — helpers purs testés :
  - `abbrevName(firstName, lastName)` → « J. Dupont » (gère prénom vide) ;
  - `teamRows(players)` → `[team1, team2]` ordonnés par `slot` (tolère un `team` inattendu en le versant dans l'équipe la moins remplie — défense en profondeur, le backend garantit 2/2).
- Réutilise `Avatar` (`components/ui/Avatar.tsx`) + `Chip` (`components/ui/atoms.tsx`) + `colorForSeed` (`lib/playerColors.ts`) + `useIsDesktop` (`lib/useIsDesktop.ts`).
- `fmtWhen` existant conservé.

## Tests

- `frontend/__tests__/resultsToRecord.test.ts` (nouveau, helpers purs) : abréviation, ordre par slot, répartition d'équipes.
- `frontend/__tests__/ResultsToRecord.test.tsx` (mise à jour, 8 tests) : noms des 4 joueurs groupés par équipe, séparateur VS, chip « Compétitive » par défaut vs « Amicale » si `competitive: false`, terrain + horaire en pied de carte, variante desktop (CTA « Saisir le score » + noms complets, via surcharge locale de `matchMedia`) ; les 3 tests existants (liste vide, filtre club, ouverture de modale + enregistrement) restent verts sans modification.

⚠️ `matchMedia` est stubé à `matches: false` dans `jest.setup.ts` → `useIsDesktop` renvoie `false` : le rendu testé par défaut est la variante **compacte**. Le test desktop surcharge `window.matchMedia` localement et le restaure.
- Vérification visuelle CDP : clair + sombre, desktop 1280 + mobile 390 (aucun scroll horizontal), sur le Club-house et `/parties`.

## Hors périmètre

- Saisie inline du score dans les cases (la modale reste l'unique chemin de saisie).
- Tout changement de `MatchResultModal`, du backend `listToRecord`, ou des surfaces de montage.
- Carte cliquable en entier (le CTA seul est actionnable).
- Sports non-padel (le flux matchs est padel-only).
