# Rails de cartes : compteur de résultats + flèches persistantes

**Date** : 2026-07-23
**Statut** : validé, prêt pour le plan d'implémentation

## Contexte

Plusieurs rails de cartes défilant horizontalement (`.sp-scroll-x`) n'offrent aucune
affordance explicite : la seule indication qu'il y a plus de contenu est une carte
coupée au bord du viewport, et le seul moyen de voir la suite est de glisser au doigt/
trackpad. Sur desktop notamment, ce n'est pas évident. Eric veut un signal explicite :
un compteur du nombre de résultats + des flèches pour défiler.

`components/clubhouse/OffersShowcase.tsx` a déjà une ébauche de ce pattern (flèches
rondes pleines accent, superposées au bord de la rangée, visibles seulement quand il
reste du contenu caché de ce côté) — c'est le style visuel de référence qu'Eric a
validé sur capture (bouton rond bleu plein, `‹`/`›` blanc, ombre portée).

## Périmètre

**Dans le périmètre** — les rails de cartes « événementielles » qui partagent le même
problème (rangée de cartes, lien « Voir tout » optionnel, pas de contrôle de
défilement explicite) :

- `components/platform/NationalOpenMatches.tsx` — rail « Parties à rejoindre »
  (utilisé par `HomeMatchesRail` sur Mon Palova et par `AnonymousView` sur la vitrine)
- `components/clubhouse/OpenMatchesShowcase.tsx` — « Ça joue bientôt » (Club-house)
- `components/clubhouse/OffersShowcase.tsx` — rail d'offres (Club-house) — remplace son
  implémentation actuelle par la version partagée (même rendu visuel, code factorisé)
- `components/social/FriendsAgendaRail.tsx` — « Ça joue bientôt » (Mes amis)

**Hors périmètre** (autres usages de `.sp-scroll-x` / `overflowX`, structurellement
différents — pas des rails de cartes avec « Voir tout ») :

- `FriendsQuickRow.tsx` — mini-avatars dans un picker (dropdown), pas des cartes
- `DateSelector.tsx` — bande de dates, a déjà ses propres flèches + logique dédiée
- `SportGrid.tsx`, `ClubReserve.tsx` (balances-row) — grilles/données, pas des cartes
- Tableaux/filtres admin (`admin/settings`, `admin/members`, superadmin…) — usage différent
  (overflow de tableau responsive, pas un carrousel de cartes)
- `components/discover/DiscoverMatches.tsx` — grille CSS qui wrap (`repeat(auto-fill,…)`),
  pas un rail horizontal

## Comportement cible

- La rangée de cartes reste défilable au doigt/trackpad (`.sp-scroll-x` inchangé) —
  les flèches sont un ajout, pas un remplacement.
- **Compteur** : texte statique « N résultat(s) » (libellé adapté au contenu : « N
  parties », « N offres »…), toujours affiché à côté du titre de section — même si rien
  n'est à faire défiler.
- **Flèches** : reprennent **exactement** le style déjà en place dans
  `OffersShowcase.tsx` — bouton rond plein accent, `‹`/`›`, superposées au bord de la
  rangée avec un dégradé de fondu, et **visibles seulement quand il reste du contenu
  caché de ce côté** (pas de grisé — la flèche disparaît simplement à l'extrémité,
  comportement actuel d'OffersShowcase conservé tel quel).

## Architecture

Deux briques partagées, extraites de la logique déjà présente dans `OffersShowcase.tsx` :

1. **`frontend/lib/useScrollRail.ts`** (hook) — factorise le suivi de bord gauche/droite
   et le défilement par page :
   ```ts
   function useScrollRail(deps: readonly unknown[]): {
     railRef: RefObject<HTMLDivElement>;
     edges: { left: boolean; right: boolean };
     scrollByPage: (dir: 1 | -1) => void;
   }
   ```
   Même logique que l'effet actuel d'`OffersShowcase` (mesure `scrollLeft`/`scrollWidth`/
   `clientWidth`, écoute `scroll` + `resize`, recalcule quand `deps` change).

2. **`frontend/components/ui/RailArrows.tsx`** (atome présentationnel) — extrait les
   fonctions `navBtn`/`fade` et les deux `<button>` conditionnels d'`OffersShowcase`,
   pixel pour pixel (même rond accent, même dégradé de fondu). Props :
   ```ts
   { edges: {left,right}; onPrev(): void; onNext(): void; prevLabel: string; nextLabel: string; fadeBg?: string }
   ```
   `fadeBg` (fond du dégradé, défaut `th.bg`) et l'inset bas du fondu restent
   paramétrables — chaque rail n'a pas exactement le même padding de rangée.

3. **`components/clubhouse/SectionHeader.tsx`** gagne un prop optionnel `count?: string`,
   affiché en texte discret entre le titre et le lien « Voir tout » (ou aligné à droite
   si pas de lien). Ce composant est déjà partagé par `OpenMatchesShowcase`,
   `OffersShowcase` et `FriendsAgendaRail` — un seul point de changement suffit pour ces
   trois rails.

   `NationalOpenMatches` ne passe pas par ce `SectionHeader` (ses 2 appelants —
   `HomeMatchesRail` et `AnonymousView` — ont chacun leur propre en-tête, différent).
   Il affiche donc son compteur lui-même, en petite ligne discrète alignée à droite
   juste au-dessus de sa rangée, indépendamment de l'en-tête du parent.

## Détail par composant

| Composant | Libellé compteur | Source du header |
|---|---|---|
| `NationalOpenMatches` | `N partie(s)` | ligne interne dédiée (pas de `SectionHeader`) |
| `OpenMatchesShowcase` | `N partie(s)` | `SectionHeader` (clubhouse), prop `count` |
| `OffersShowcase` | `N offre(s)` | `SectionHeader` (clubhouse), prop `count` — remplace `navBtn`/`fade`/effet local par les briques partagées |
| `FriendsAgendaRail` | `N résultat(s)` (contenu hétérogène : parties/tournois/events) | `SectionHeader` (clubhouse), prop `count` |

Chaque rail passe son propre conteneur de rangée en `position: relative` (déjà le cas
pour `OffersShowcase`) pour que `RailArrows` puisse se superposer.

## Tests

- `useScrollRail` : test unitaire pur (mesure des bords, recalcul sur resize/deps).
- `RailArrows` : rendu conditionnel selon `edges`, clics appellent `onPrev`/`onNext`,
  aria-labels présents.
- `SectionHeader` (clubhouse) : nouveau cas avec `count` (seul, avec `action`, sans).
- Mise à jour des suites existantes : `OpenMatchesShowcase`, `OffersShowcase`,
  `FriendsAgendaRail`, `NationalOpenMatches` (présence du compteur + flèches, aucune
  régression sur le rendu des cartes).

## Hors périmètre (assumé)

- Pas de position/pagination (« 2/4 ») — le compteur est un total statique, pas un
  indicateur de position.
- Pas de désactivation du glisser tactile — les flèches s'ajoutent, ne remplacent rien.
- Pas de traitement des sélecteurs de dates, grilles de données, ou tableaux admin
  (cf. Périmètre).
