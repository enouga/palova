# Parties : étagère 2 lignes + sélecteur de date unifié avec Tournois

**Date** : 2026-07-23
**Statut** : validé (2 questions de cadrage tranchées)

## Décisions

1. **Parties (`/decouvrir`) gagne une 2ᵉ ligne**, même traitement que Tournois/Clubs/
   Prochains events : étagère `grid-auto-flow: column`, `calc(50% - gap/2)` par
   colonne (exactement 2 vignettes par ligne, sur tout écran), compteur + flèches
   inchangés dans leur mécanique (`useScrollRail`/`RailArrows`, déjà en place).
2. **Le sélecteur de date de Parties devient EXACTEMENT celui de Tournois** — puces
   « Aujourd'hui / Cette semaine / Ce mois-ci » + bouton « Dates » (calendrier de plage
   libre, `DateRangeChip` réutilisé tel quel) — **et ce même triplet de puces remplace
   aussi celui de Tournois** (qui avait Ce week-end/Ce mois-ci/30 jours/3 mois) : un
   seul jeu de puces, partagé, pas deux comportements différents sous un même nom.
   « Cette semaine » est un preset **nouveau**, n'existant nulle part dans le code.

## Fenêtre « Cette semaine »

Nouvelle valeur de `DatePreset` (remplace `weekend`/`days30`/`months3`, qui
disparaissent — plus aucune puce ne les expose) : de `now` jusqu'à dimanche 23:59:59.999
de la semaine en cours (si `now` est déjà dimanche, fenêtre = ce jour seul — même
convention de repli que l'ancien preset `weekend`).

```ts
case 'thisWeek': {
  const dow = now.getDay(); // 0=dim…6=sam
  const daysToSunday = dow === 0 ? 0 : 7 - dow;
  const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToSunday, 23, 59, 59, 999);
  return { from: now, to: sun };
}
```

`DatePreset` final : `'today' | 'thisWeek' | 'thisMonth'` (`thisMonth` inchangé,
`today` reprend exactement l'ancienne logique de `discoverWindow` côté Parties).

## Architecture — un seul point de vérité pour le calcul de fenêtre

`lib/tournamentCalendar.ts` reste la source unique de `DatePreset`/`resolveDateWindow`
(déjà utilisée par Tournois) — `lib/discover.ts` (Parties) **arrête de dupliquer** sa
propre logique de fenêtre (`discoverWindow`/`DiscoverPeriod`, tous deux supprimés) et
appelle `resolveDateWindow` à la place. `resolveDateWindow` élargit son type de
paramètre à un sous-ensemble structurel de `CalendarFilterState` (`{ datePreset, from,
to }` seulement) — tous les appelants existants (`applyFilters`, `calendarFacets`, qui
passent un `CalendarFilterState` complet) restent valides sans changement (typage
structurel TypeScript).

La liste des puces `DATE_PRESETS` (clé + libellé) est **exportée depuis
`tournamentCalendar.ts`** (déplacée hors de `FacetPanel.tsx`, où elle vivait en `const`
locale) pour être partagée par `FacetPanel` (Tournois) et `DiscoverMatches` (Parties) —
un seul jeu de libellés, jamais deux copies qui divergent.

`DiscoverMatches.tsx` gagne un état local `datePreset`/`dateFrom`/`dateTo` (miroir du
sous-ensemble pertinent de `CalendarFilterState`) et rend le même bloc « Quand » que
`FacetPanel` : puces `DATE_PRESETS` + `<DateRangeChip>` réutilisé tel quel (déjà
générique, aucune dépendance tournoi). `DiscoverMatchFilter.period` (Parties) devient
`{ datePreset, from, to }`.

## Hors périmètre

- Les autres groupes de `FacetPanel` (Où/Catégorie/Genre) ne sont pas touchés, ni
  ajoutés à Parties (qui garde son propre filtre Niveau, sans rapport).
- `lib/events.ts` (`AgendaWhen`, page `/events`) est une **copie volontairement
  découplée** (commentaire existant : « dupliquée ici pour éviter un cycle ») — hors
  périmètre, non touchée.
- Le comportement d'interaction preset ↔ plage libre (la plage prime silencieusement
  sur la puce active) est repris tel quel de `FacetPanel`, pas « corrigé ».
