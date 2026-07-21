# Chips de filtres teintées par groupe (Parties · Events · Tournois · Découvrir) — design

**Date :** 2026-07-21
**Statut :** validé par Eric (direction B « une teinte par groupe », choisie sur maquettes
comparées dans le companion visuel parmi 3 pistes — A accent du club / B teinte par groupe /
C couleurs d'identité).

## Problème

1. **Trois copies** de la même recette de chip de filtre ont dérivé :
   - `EventsFilterBar.tsx` (`FacetChip`/`FacetGroup` locaux) — taille 13, compteur, inactif transparent, texte inactif `th.text` ;
   - `MatchesFilterBar.tsx` (`Chip`/`GroupLabel` locaux) — taille 12, pas de compteur, texte inactif `th.textMute` ;
   - `calendar/FacetPanel.tsx` (`FacetChip`/`FacetGroup` **exportés**, consommés aussi par `DiscoverMatches.tsx`) — taille 13, inactif sur fond `th.surface`.

   D'où le « les boutons ne sont pas tout à fait les mêmes » d'Eric.

2. Tout est encre/gris : chip active = pill encre pleine (`th.ink`), inactive = contour neutre.
   Eric aime la forme mais « ça manque de couleur ».

## Décision

Chaque **groupe de filtres** porte une teinte fixe de la palette `ACCENTS` : pastille colorée
sur le libellé du groupe + chip active = **pill pleine de la teinte** (encre lisible via
`inkOn`). Les chips inactives restent neutres (contour fin). Même libellé ⇒ même teinte sur
toutes les pages. Les trois copies fusionnent en **un composant partagé**.

## Composant partagé `frontend/components/ui/FacetChip.tsx`

Un module `ui/` (feuille sans dépendance métier) règle l'objection historique « pas d'import
croisé events↔calendar » qui avait justifié les copies (cf. commentaire d'en-tête de
`FacetPanel.tsx`).

Exports :

- **`FILTER_TINTS`** — `Record<clé sémantique, string>`, source unique du mapping :

  | Clé | Teinte | Groupes concernés |
  |---|---|---|
  | `quand` | `ACCENTS.emerald` | « Quand » (Events, calendrier national, Découvrir) |
  | `categorie` | `ACCENTS.violet` | « Catégorie » (Events, calendrier national) |
  | `genre` | `ACCENTS.cyan` | « Genre » (Events, calendrier national) |
  | `niveau` | `ACCENTS.blue` | « Niveau » (Parties) + chip « À mon niveau » (Découvrir) |
  | `typePartie` | `ACCENTS.coral` | « Type de partie » (Parties) |
  | `source` | `ACCENTS.apricot` | « Source » (Events) |
  | `typeAnimation` | `ACCENTS.blue` | « Type » (Events, animations) |
  | `acces` | `ACCENTS.coral` | « Accès » (Events, Réservé membres) |
  | `ou` | `ACCENTS.blue` | « Où » (calendrier national, « Autour de moi » compris) |

  Toutes les teintes d'une même barre sont distinctes. `lime` jamais utilisé (illisible en
  clair). Thème sombre : mêmes teintes — la palette est calibrée pour le floodlit, `inkOn`
  choisit l'encre.

- **`FacetChip`** — props `{ label, count?, active, onClick, tint, ariaExpanded? }`, `useTheme`
  interne (la prop `th` de la version calendar disparaît). Recette harmonisée :
  - taille 13, `padding 5px 11px`, `gap 6`, `borderRadius 999`, `WebkitTapHighlightColor` transparent, `transition all .15s` ;
  - **active** : fond `tint`, texte `inkOn(tint)` graisse 700, coche (`Icon check` 12) même encre, pas de boxShadow ;
  - **inactive** : fond transparent, `inset 0 0 0 1px th.line`, texte `th.text` graisse 600 ;
  - compteur optionnel en suffixe **`aria-hidden`** (le nom accessible reste « Paris », pas « Paris 2 » — contrat des tests calendar), 11.5 graisse 700 `tabular-nums`, encre héritée + `opacity .75` en actif, `th.textFaint` sinon ;
  - `count === 0` et inactive → `opacity .45`, toujours cliquable ;
  - `aria-pressed` conservé, `aria-expanded` optionnel (chip « Régler ▾ » de Parties).

- **`FacetGroup`** — props `{ label, tint, children }` : pastille ronde 7 px de la teinte
  (`aria-hidden`) devant le libellé ; libellé inchangé (10.5 uppercase `th.textFaint`,
  letterSpacing 0.6) ; rangée `flex-wrap` gap 6 `alignItems: center`.

## Câblage par surface

- **`MatchesFilterBar.tsx`** (`/parties`) : `Chip`/`GroupLabel` locaux supprimés → partagés.
  Niveau = `niveau` (chips « À mon niveau · x–y », « Tous », « Régler ▾ » — cette dernière garde
  `ariaExpanded`), Type de partie = `typePartie`. Les chips passent de 12 à 13. Pied (compteur,
  chips d'alertes, « Créer une alerte ») inchangé.
- **`EventsFilterBar.tsx`** (`/events`) : copies locales supprimées → partagées. Source =
  `source`, Quand = `quand`, Catégorie = `categorie`, Genre = `genre`, Type = `typeAnimation`,
  Accès = `acces`. Animation `sp-rise` au changement de source inchangée.
- **`calendar/FacetPanel.tsx`** (`/tournois` national) : copies locales **supprimées** (les
  exports disparaissent — pas de re-export mort), imports depuis `ui/`. Quand = `quand`,
  Où = `ou`, Catégorie = `categorie`, Genre = `genre`. Le bouton dédié « 📍 Autour de moi »
  (tri, sémantique inchangée) : actif = teinte `ou` + `inkOn` (au lieu de `th.accent`/
  `th.onAccent`), inactif harmonisé transparent + contour (était fond `th.surface`).
  **`DateRangeChip`** gagne une prop optionnelle **`tint`** (défaut `th.accent`) appliquée à la
  pill active (bouton + ✕) ; la popup calendrier interne reste sur `th.accent` ; `FacetPanel`
  passe la teinte `quand`.
- **`discover/DiscoverMatches.tsx`** (`/decouvrir`) : imports migrés `calendar/FacetPanel` →
  `ui/FacetChip`. Quand = `quand`, « À mon niveau » = `niveau`.

## Ce qui ne change pas

Structure des barres, logique de filtrage et compteurs, `aria-pressed`, noms accessibles,
pieds « N résultats · Effacer les filtres », chips d'alertes + « Créer une alerte » (Parties),
`LevelRangeSlider`, « + N » départements, popup calendrier de `DateRangeChip`. **100 %
frontend, aucune migration, aucun changement backend.**

## Tests

- Nouvelle suite `__tests__/FacetChip.test.tsx` : teinte appliquée en actif (fond + encre
  `inkOn`), inactif neutre, estompage à 0 cliquable, compteur `aria-hidden`, pastille de
  groupe, `aria-expanded` relayé.
- Suites existantes restent vertes (contrats aria inchangés) : `MatchesFilterBar`,
  `EventsFilterBar`, `TournamentFinder`, `FacetPanel` (si suite dédiée), `DiscoverMatches`,
  `DiscoverPage`.
- Vérification visuelle CDP : clair + sombre, desktop 1280 + mobile 390, les 4 surfaces.

## Hors périmètre

Filtres admin (`ReservationFilters`, planning, caisse — autre langage), `PillTabs`, chips de
la page Réserver, sélecteur de sport. Le mapping des teintes reste une constante front (pas de
personnalisation par club).
