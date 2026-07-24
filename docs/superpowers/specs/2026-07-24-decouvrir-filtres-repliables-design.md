# /decouvrir — filtres repliables partout, mémorisés, compteur unique, cartes club compactes

**Date** : 2026-07-24
**Statut** : validé (Eric), à planifier

## Contexte

La page `/decouvrir` empile trois sections (Parties → Tournois → Clubs) sous une barre de
localisation partagée. Leurs filtres ont dérivé en trois présentations :

- **Tournois** (`TournamentFinder` embarqué, `hideTitle`) : bouton repliable « ⚙ Filtres · N »
  (badge compteur, chevron, lien « Effacer » à côté) ouvrant le tiroir `FacetPanel` ; filtres
  **déjà mémorisés** (localStorage `palova:discover-tournois-filters` + URL). Le pied du tiroir
  affiche « N résultats · Effacer les filtres » **en doublon** avec le « N tournois » du rail.
- **Ça joue bientôt** (`DiscoverMatches`) : tiroir **toujours ouvert** (pas de bouton), filtres
  **non mémorisés**, pas de doublon de compteur.
- **Clubs** (`ClubDirectory` en mode contrôlé) : filtres toujours visibles (champ « Nom du
  club » + chips sport), **non mémorisés**, cartes larges (3 par rangée desktop
  `calc((100% - 24px) / 3)`, plein cadre mobile) vs 272 px pour les cartes de parties.

Objectif : un seul langage de filtres sur la page (le pattern Tournois), tous mémorisés d'une
session à l'autre, un seul compteur de résultats (celui du rail, en bas), et des cartes club à
la même largeur compacte que les cartes de parties.

## Décisions de cadrage (validées)

- **Périmètre Clubs = /decouvrir uniquement.** `ClubDirectory` est aussi rendu sur la vitrine
  anonyme (`AnonymousView`) en mode autonome : là-bas, **rien ne change** (recherche visible,
  cartes larges, pas de mémorisation). Le mode contrôlé (`controlled`, déjà détecté par le
  composant) est le discriminant — il n'est vrai que sur /decouvrir.
- **« Mes clubs » (toggle maison de la barre de localisation) est mémorisé aussi.**

## 1. Composant partagé `FiltersToggle`

Le pattern du bouton Tournois est extrait dans **`components/ui/FiltersToggle.tsx`** :

- Rangée : pill « ⚙ Filtres » (`Icon settings`, fond `th.bgElev`, liseré `th.line`) + badge
  compteur accent (`th.accent`/`th.onAccent`, masqué à 0) + chevron `chevR` tourné selon l'état
  + lien texte « Effacer » à droite du bouton, rendu seulement si `count > 0`.
- Props : `{ count: number; open: boolean; onToggle(): void; onClear(): void; controlsId: string }`
  (`aria-expanded`, `aria-controls` posés comme aujourd'hui). Le **tiroir reste chez l'appelant**
  (contenu conditionnel `open && <div id={controlsId}>…</div>`).
- `TournamentFinder` migre dessus (comportement strictement identique) ; Parties et Clubs
  l'adoptent.

## 2. Ça joue bientôt (`DiscoverMatches`)

- Le tiroir existant (Quand / Type de partie / Genre / Niveau) passe **fermé par défaut**
  derrière `FiltersToggle` — miroir exact des Tournois. Le pied interne « Effacer les filtres »
  du tiroir disparaît (le lien « Effacer » vit à côté du bouton, pattern commun).
- **Badge compteur** : helper pur `partiesFilterCount` dans `lib/discover.ts` —
  `(datePreset || from || to ? 1 : 0) + (kind ≠ 'all') + (gender ≠ 'all') + (levelOn ? 1 : 0)`.
  Le terme niveau n'est compté que si la chip est visible (connecté + niveau calculé).
- **Mémorisation** localStorage **`palova:discover-parties-filters`** : forme stockée
  `{ quand, from, to, type, genre, niveau }`, helpers purs `partiesStateToStored` /
  `storedToPartiesState` dans `lib/discover.ts` (tolérants à toute entrée corrompue, miroir de
  `calendarStateToStored`/`storedToCalendarState`). Restauration au montage, écriture à chaque
  changement (la première passe de restauration n'écrit pas — ref « prêt », idiome
  `wroteLocOnce` de la page). « À mon niveau » restauré ne **s'applique** que si la chip est
  visible (déjà garanti par `myLevel = levelChipVisible && levelOn`).
- Pas de paramètres URL pour les parties (hors périmètre — seule la section Tournois avait des
  liens partageables, elle les garde).

## 3. Clubs (`ClubDirectory`, mode contrôlé seulement)

- En mode contrôlé, le champ « Nom du club » + les chips sport passent derrière le même
  `FiltersToggle`, tiroir fermé par défaut. Le bouton « Effacer les filtres » actuel migre dans
  le lien « Effacer » du toggle. **Badge** : `(q ? 1 : 0) + (sport ? 1 : 0)`.
- **Mémorisation** localStorage **`palova:discover-clubs-filters`** : `{ q, sport }`, écrite à
  chaque changement, restaurée au montage. **Si une entrée stockée existe (même vide), le
  pré-remplissage « sport préféré » est sauté** — sinon impossible de mémoriser le choix
  « Tous ». L'effet de restauration est déclaré avant l'effet de seed (ref lue par ce dernier).
- **Cartes compactes** : en mode contrôlé, le rail passe à
  `desktopColumns="272px" mobileColumns="272px"` (même largeur que les cartes de parties,
  `ClubCard` inchangé — la largeur est imposée par le rail). Mode autonome (vitrine) : props
  actuelles conservées.
- Mode autonome : aucun autre changement (tiroir toujours visible, pas de mémorisation).

## 4. Compteur en doublon (`FacetPanel`)

- Le pied du tiroir perd son « N résultats » : la prop `resultCount` est **supprimée** (du
  composant et de l'appel dans `TournamentFinder`). Le pied ne garde que « Effacer les
  filtres ». Le seul compteur de la section est celui du rail (« N tournois »).
- La page `/tournois` autonome est une redirection vers `/decouvrir#tournois` — aucune surface
  ne perd son compteur.

## 5. « Mes clubs » (`DiscoverClient`)

- Le toggle `mineOnly` est mémorisé : localStorage **`palova:discover-mine-only`** (`'1'` /
  clé absente). Restauré au montage, écrit au toggle. Il ne **s'applique**, comme aujourd'hui,
  que si le joueur est connecté avec une adhésion ACTIVE (`myClubsActive = chipVisible && mineOnly`).
- Le lieu est déjà mémorisé (`palova:discover-location`) ; la géoloc n'est jamais rejouée
  (inchangé).

## Clés localStorage (toutes dans `lib/discover.ts`)

| Clé | Contenu | Statut |
|---|---|---|
| `palova:discover-location` | texte de recherche par lieu | existant |
| `palova:discover-tournois-filters` | filtres tournois (`calendarStateToStored`) | existant |
| `palova:discover-parties-filters` | `{ quand, from, to, type, genre, niveau }` | nouveau |
| `palova:discover-clubs-filters` | `{ q, sport }` | nouveau |
| `palova:discover-mine-only` | `'1'` si actif | nouveau |

## Hors périmètre

- Vitrine anonyme (`AnonymousView`) : strictement inchangée.
- Paramètres URL pour Parties/Clubs (liens partageables) — Tournois seul les garde.
- Mémorisation de la géoloc « Autour de moi » (jamais rejouée, règle existante).
- Backend : **aucun changement, aucune migration** — 100 % frontend.

## Tests

- `lib/discover` : `partiesStateToStored`/`storedToPartiesState` (aller-retour, entrées
  corrompues), `partiesFilterCount`.
- `DiscoverMatches` : tiroir fermé par défaut, ouverture au clic, badge compteur, restauration
  localStorage, écriture au changement, « Effacer » à côté du bouton.
- `ClubDirectory` : mode contrôlé (tiroir repliable, badge, persistance q+sport, seed sport
  préféré sauté quand une mémoire existe, rail 272 px) ; mode autonome inchangé (non-régression
  vitrine).
- `FacetPanel` / `TournamentFinder` : plus de « N résultats » au pied, prop retirée.
- `DiscoverClient` : `mineOnly` restauré/écrit.
- Vérification visuelle CDP : clair + sombre, desktop 1280 + mobile 390 (aucun débordement
  horizontal, cartes club 272 px alignées sur les cartes parties).
