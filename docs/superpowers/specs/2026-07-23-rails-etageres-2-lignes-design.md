# Rails de cartes — correction : étagères 2 lignes (au lieu de grilles qui wrappent)

**Date** : 2026-07-23
**Statut** : validé (confirmé sur aperçu ASCII), corrige un choix de design du lot précédent
**Corrige** : `docs/superpowers/specs/2026-07-23-rails-decouvrir-grilles-design.md` — la
grille 4 colonnes × 2 lignes qui WRAP (empile plus de lignes si l'écran est étroit,
capée en dur) ne convenait pas visuellement à Eric.

## Décision

Les 3 listes tournois/events (Club-house « Prochains events », `/decouvrir` Tournois,
`/decouvrir` Clubs) deviennent des **étagères qui défilent HORIZONTALEMENT sur 2
lignes** — même mécanique que les rails déjà livrés (`useScrollRail` + `RailArrows` +
compteur), mais la grille se remplit en **colonnes de 2** (`grid-auto-flow: column`,
`grid-template-rows: repeat(2, auto)`) au lieu d'une seule ligne. Le glisser/les flèches
révèlent les colonnes suivantes ; ce n'est plus un wrap qui change de nombre de colonnes
selon la largeur d'écran.

```
─ TOURNOIS                    8 tournois   ‹ ›

┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────🡂
│ Tournoi 1│ │ Tournoi 3│ │ Tournoi 5│ │ Tournoi 7
└──────────┘ └──────────┘ └──────────┘ └────🡂
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────🡂
│ Tournoi 2│ │ Tournoi 4│ │ Tournoi 6│ │ Tournoi 8
└──────────┘ └──────────┘ └──────────┘ └────🡂
```

## Périmètre

Les 3 composants du lot précédent qui étaient passés en grille-qui-wrap reviennent sur
le pattern étagère, cette fois à 2 lignes :

1. **`TournamentsAlaUne.tsx`** (Club-house « Prochains events ») — `.ta-grid` :
   `grid-auto-columns: 260px`, gap 10. Gagne un compteur (absent jusqu'ici) à côté du
   titre. Cap inchangé (`ClubHouse.tsx` garde `.slice(0, 8)`).
2. **`TournamentFinder.tsx`** (mode `hideTitle`, `/decouvrir` Tournois) — même classe
   `.discover-tournaments-grid`, redéfinie en étagère : `grid-auto-columns: 320px`
   (cartes `AgendaCard`, plus larges), gap 12. Compteur "N tournois" ajouté au-dessus
   du rail (le `resultCount` du tiroir de filtres `FacetPanel` reste, ce n'est pas le
   même endroit). Cap inchangé (`MAX_VISIBLE = 8`).
3. **`ClubDirectory.tsx`** (`/decouvrir` Clubs **et** vitrine anonyme, composant
   partagé) — `.discover-clubs-grid` redéfinie en étagère : `grid-auto-columns: 270px`
   (cartes `ClubCard`), gap 16. **Aucun plafond** — c'est un vrai annuaire avec
   recherche/filtres, tous les résultats doivent rester atteignables via le défilement
   horizontal (pas de cap comme sur les 2 listes tournois/events, qui sont des
   sélections « pas exhaustives »). Compteur "N clubs" ajouté.

## Détail technique commun

Recette CSS (même structure, colonnes/gap propres à chaque carte) :

```css
.XXX-grid {
  display: grid;
  grid-template-rows: repeat(2, auto);
  grid-auto-flow: column;
  grid-auto-columns: <Wpx>;
  gap: <Gpx>;
  align-items: start;
}
```

Posée sur le même conteneur `ref={railRef} className="sp-scroll-x XXX-grid"` que les
rails à une ligne — `useScrollRail`/`RailArrows` sont réutilisés tels quels (aucune
nouvelle brique). Les états chargement/erreur/vide (loading/error/empty) sortent du
conteneur grille (ils n'en sont plus des cellules — `gridColumn:'1/-1'` n'a plus de
sens sur une étagère à flux colonne).

## Hors périmètre

- Pas de changement du nombre de colonnes visibles à la fois (dépend de la largeur de
  fenêtre, comme les rails à 1 ligne existants) — la largeur de carte est fixe, le
  nombre de colonnes visibles varie naturellement.
- Pas de changement des plafonds (8 pour les 2 listes tournois/events, aucun pour les
  clubs) — seule la mécanique de défilement change.
