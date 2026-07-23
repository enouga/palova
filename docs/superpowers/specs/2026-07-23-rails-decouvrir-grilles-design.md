# Rails de cartes — extension : /decouvrir, retrait des liens "Toutes", grilles 4×2

**Date** : 2026-07-23
**Statut** : validé, prêt pour le plan d'implémentation
**Complète** : `docs/superpowers/specs/2026-07-23-rails-compteur-fleches-design.md` (compteur +
flèches, déjà livré) — homepage jugée bonne telle quelle par Eric.

## Décisions (issues de 3 questions de cadrage)

1. **`/decouvrir` « Parties ouvertes »** doit recevoir le même traitement que le rail de
   l'accueil (compteur + flèches), pas rester une grille qui wrap.
2. **Retrait du lien « Toutes/Tout voir → »** : seulement sur les rails à flèches déjà
   livrés (`OpenMatchesShowcase`, `HomeMatchesRail`) — pas ailleurs (HomeAgenda, Vos
   réservations, calendrier national anonyme… restent inchangés).
3. **Grille 4 colonnes × 2 lignes (8 cartes)** pour les listes d'events/tournois, à deux
   endroits : Club-house « Prochains events » et `/decouvrir` section Tournois. Pour
   « Prochains events », qui partageait sa ligne avec « Vos réservations » (`.ch-grid`
   2 colonnes), la vraie grille 4×2 a besoin de toute la largeur de page — « Vos
   réservations » descend en dessous, en pleine largeur lui aussi.

## 1. `DiscoverMatches.tsx` → rail

Remplace la grille CSS (`repeat(auto-fill, minmax(270px,1fr))`, capée `MAX_VISIBLE=9`)
par un rail `.sp-scroll-x` (mêmes briques que le lot précédent : `useScrollRail` +
`RailArrows`), avec un compteur « N partie(s) » aligné à droite juste au-dessus (même
présentation que `NationalOpenMatches.tsx` — pas de header/lien "voir tout", cette page
est déjà la vue complète). Filtres (chips Quand/Niveau) et état vide inchangés.
`MAX_VISIBLE = 9` conservé tel quel (pas demandé de le changer). Cartes `NationalMatchCard`
à largeur fixe `270px` (reprend le `min` de l'ancienne grille) au lieu de `minmax(270px,1fr)`.

## 2. Retrait de « Toutes/Tout voir → »

- `OpenMatchesShowcase.tsx` : `<SectionHeader title="Ça joue bientôt" count={count} />`
  (le prop `action` disparaît de cet appel — `SectionHeader` garde la capacité, juste
  plus utilisée ici).
- `HomeMatchesRail.tsx` : `<SectionHeader kicker="Parties à rejoindre" />` (retrait de
  `moreLabel`/`moreHref`).
- Tests à ajuster : l'assertion « Toutes les parties » dans
  `OpenMatchesShowcase.test.tsx` et l'assertion « Toutes » dans `HomeMatchesRail.test.tsx`
  (remplacées par une attente sur un autre élément du rail, pas de perte de couverture).

## 3. Grilles 4×2 (8 cartes)

### 3a. Club-house « Prochains events » (`TournamentsAlaUne.tsx` + `ClubHouse.tsx`)

- `ClubHouse.tsx` : `nextEvents = mergeAgenda(...).slice(0, 3)` → `.slice(0, 8)`. La
  section `agenda` abandonne `.ch-grid` (2 colonnes côte-à-côte) pour un simple
  empilement pleine largeur : `TournamentsAlaUne` d'abord (si non vide), puis
  `MyReservationsCard` juste après (si non vide) — chacun occupe 100% de la largeur.
  `.ch-grid` (devenu orphelin) est supprimé.
- `TournamentsAlaUne.tsx` : la liste verticale (`flexDirection:'column'`) devient une
  grille responsive — 1 colonne mobile, 2 colonnes ≥560px, **4 colonnes ≥900px** — même
  carte/lien qu'aujourd'hui (pas de nouveau composant, juste le conteneur qui change).

### 3b. `/decouvrir` section Tournois (`TournamentFinder.tsx`, mode `hideTitle`)

- `MAX_VISIBLE` : 10 → **8**.
- `.discover-tournaments-grid` : 1 colonne → 2 colonnes ≥640px (inchangé) → **4 colonnes
  ≥960px** (nouveau palier). Mêmes `AgendaCard`, aucun changement de contenu.
- Test à ajuster : `TournamentFinder.test.tsx` (« plafonnée à 10 » → 8).

## Hors périmètre

- La page `/tournois` autonome (hors `hideTitle`) reste un flux complet, non grillé/capé
  — inchangé.
- `HomeAgenda`, `MyReservationsCard`, `UpcomingTournaments` (vitrine anonyme) : aucun
  changement (confirmé hors scope par la décision 2).
- Pas de nouveau composant de carte — les grilles réutilisent les cartes existantes
  (`NationalMatchCard`, le bloc `<Link>` de `TournamentsAlaUne`, `AgendaCard`).
