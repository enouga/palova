# Filtres Tournois — tiroir compact façon Events + fin du vide sous la section

**Date :** 2026-07-20
**Statut :** design validé (Eric : aligner sur le tiroir de `/events`, « fais au mieux » sur les arbitrages).
**Périmètre :** 100 % frontend. Aucune migration, aucun backend. Complète la spec du jour
`2026-07-20-filtres-tournois-calendrier-design.md` (la chip « 📅 Dates » reste telle quelle).

## Problèmes (constatés par Eric sur `/decouvrir`)

1. Le `FacetPanel` empile **4 groupes pleine largeur** (Quand / Département / Catégorie / Genre)
   + la pill « Autour de moi » au-dessus → trop de hauteur, look « formulaire », incohérent avec
   le **tiroir compact de la page Events** (groupes côte à côte dans un panneau).
2. **Grand vide quand il n'y a pas (ou peu) de tournois** : la racine de `TournamentFinder`
   force `minHeight: '100vh'` — voulu sur la page `/tournois` autonome, absurde embarqué dans
   `/decouvrir` (la section Tournois occupe un écran entier même vide).

## Design (langage du tiroir `EventsFilterBar`, réutilisé à l'identique)

Le `FacetPanel` devient **un panneau unique** : fond `th.bgElev`, `borderRadius 16`,
liseré `inset 0 0 0 1px th.line`, contenu en **`flex-wrap` de groupes labellisés**
(`gap '14px 26px'`, padding `'12px 14px'`) qui passent à la ligne en mobile :

- **QUAND** — les 4 presets (`Ce week-end · Ce mois-ci · 30 jours · 3 mois`) + la chip
  **« 📅 Dates »** (`DateRangeChip`, inchangée — sa popup s'ancre déjà correctement).
- **OÙ** — **« 📍 Autour de moi » rejoint ce groupe** (même sujet que les départements, une
  rangée de gagnée ; ses états `Localisation…` / `✓` et son rôle de tri sont inchangés), suivi
  des chips départements avec compteurs + le bouton « + N / voir moins » existant
  (`DEPT_VISIBLE = 8` conservé).
- **CATÉGORIE** — chips avec compteurs.
- **GENRE** — chips avec compteurs.
- **Pied de tiroir** (rendu seulement si un filtre est actif — même règle `hasActive`
  qu'aujourd'hui, « Autour de moi » toujours exclu) : `N résultats · ✕ Effacer les filtres`,
  séparé par un filet `th.line` (copie du pied Events).

**Style des chips** : celui des `FacetChip` d'Events — plus petites (`padding '5px 11px'`,
fontSize 13), **✓ + encre pleine** quand actives (`th.ink`), compteur en suffixe discret,
**estompées (`opacity .45`) mais cliquables à 0**. Les groupes vides (0 facette) restent omis.
Le label de groupe = petites capitales `10.5px` `th.textFaint` (recette `FacetGroup`).

**Implémentation** : ces briques (`FacetChip`/`FacetGroup`) sont **dupliquées localement** dans
`FacetPanel.tsx` (composants module-scope — jamais définis dans le corps du composant, leçon du
bug `Group` du jour) plutôt qu'exportées depuis `EventsFilterBar.tsx` : les deux barres n'ont pas
la même API (sources/compteurs live vs facettes calculées) et un import croisé events↔calendar
créerait un couplage que `lib/events` ↔ `lib/tournamentCalendar` évitent déjà volontairement
(précédent : `whenWindow` dupliqué pour éviter le cycle, cf. CLAUDE.md). Le `Pill` générique
n'est plus utilisé par ce panneau.

**API** : `FacetPanel` gagne **`resultCount?: number | null`** (affiché dans le pied ;
`TournamentFinder` le passe depuis `results.length`). Tout le reste des props est inchangé.

## Fin du vide sous la section

- `TournamentFinder` : `minHeight: '100vh'` devient **conditionnel au mode autonome**
  (`hideTitle ? undefined : '100vh'`) — embarqué dans `/decouvrir`, la section reprend sa
  hauteur naturelle.
- **État vide actionnable** : « Aucun tournoi ne correspond à votre recherche. » gagne un bouton
  **« Effacer les filtres »** (réutilise le `onClear` existant — préserve `nearMe`, comme le
  Effacer du tiroir), rendu seulement si un filtre est actif ; sans filtre actif, le message
  seul (« Aucun tournoi à venir pour le moment. »).

## Tests

- **`FacetPanel.test.tsx`** : les 6 tests existants restent verts (mêmes rôles/libellés — chips,
  Autour de moi, Effacer, Dates, régression remount) ; ajouts : « Autour de moi » rendu dans le
  groupe Où (le groupe existe, la pill isolée au-dessus a disparu), pied « N résultats » rendu
  quand `resultCount` fourni + filtre actif, absent sinon.
- **`TournamentFinder.test.tsx`** : reste vert ; ajouts : état vide avec filtre actif → bouton
  « Effacer les filtres » qui relance la liste ; `hideTitle` → pas de `minHeight` (assertion de
  style sur le conteneur racine via `data-testid` ou style direct).
- **Vérification CDP** : `/decouvrir` clair 1280 + sombre 390 — tiroir compact (hauteur ~2×
  moindre qu'avant), plus de vide sous la section quand 0 résultat, aucun débordement ;
  `/tournois` (page autonome) inchangée fonctionnellement.

## Hors périmètre

- Toute modification d'`EventsFilterBar`, du `DateRangeChip`, de l'état/URL/`applyFilters`.
- Onglets « sources » façon Events (les ancres Parties/Tournois/Clubs de `/decouvrir` jouent
  déjà ce rôle).

## Évolution (même jour, demande d'Eric) — « Ça joue bientôt » aligné

Les filtres de la section Parties de `/decouvrir` (`DiscoverMatches` : `PillTabs` de période +
`Pill` « À mon niveau » flottantes) adoptent **le même tiroir** : `FacetChip`/`FacetGroup` sont
**exportées** de `FacetPanel.tsx` et réutilisées — groupes **QUAND** (Aujourd'hui / Week-end /
14 jours) et **NIVEAU** (« À mon niveau », rendu seulement connecté+calibré, gating inchangé).
Pas de pied « résultats » (une période est toujours active, rien à effacer). Noms accessibles
conservés (contrats de tests). Test : « les filtres vivent dans le tiroir compact » dans
`DiscoverMatches.test.tsx`.
