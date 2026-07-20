# Filtres Tournois — chip « 📅 Dates » + calendrier de plage maison

**Date :** 2026-07-20
**Statut :** design validé (piste A choisie par Eric sur maquettes comparées A/B/C dans le companion visuel).
**Périmètre :** 100 % frontend. Aucune migration, aucun backend, aucune route. Aucun changement d'état ni d'URL (`?du=&au=` inchangés).

## Intention

Dans le panneau de filtres des tournois (`FacetPanel`, partagé par **`/decouvrir`** et **`/tournois`**),
la rangée « Quand » se termine par **deux `<input type="date">` natifs** (`jj/mm/aaaa`) — non
stylables, laids dans les deux thèmes, incohérents avec le langage du site. Eric les rejette
(« genre un calendrier »). Piste retenue (A) : les presets restent, les deux champs deviennent
**une chip « 📅 Dates »** qui ouvre le **calendrier maison** en mode **plage** (2 taps).

## Comportement (validé en maquette)

**La chip** (en bout de rangée « Quand », après les 4 presets) :
- Sans plage : chip neutre « 📅 Dates » → ouvre le calendrier.
- Avec plage : chip **pleine accent** « 📅 24 juil. → 2 août ✕ » — le corps rouvre le
  calendrier, le **✕ efface la plage sans ouvrir** (appelle `onSetRange(null, null)`).
- Plage partielle (from seul / to seul, déjà permis par l'état) : « 📅 Du 24 juil. » /
  « 📅 Jusqu'au 2 août ».

**Le calendrier** (popup ancrée à la chip, même anatomie visuelle que le popup de `DateField` :
surface, bord `th.line`, ombre, nav ‹ › mois, rangée lun→dim, grille `monthGrid`) — logique
**plage** :
- 1ᵉʳ tap = début (`from` posé, `to` effacé) ; 2ᵉ tap = fin, puis **fermeture**. Si le 2ᵉ tap est
  avant le début, les bornes sont **échangées** (jamais d'état invalide).
- Rendu : bornes en pastilles encre (`th.ink`), jours **entre** les bornes en lavis accent
  (`${th.accent}26`, coins droits — les bornes portent les arrondis), aujourd'hui = anneau accent
  (règle `DateField`).
- Pied : « Effacer » (vide la plage, ferme) ; fermeture par clic extérieur / Échap (idiome
  `DateField`).
- Poser une plage **ne touche pas** le preset ; la règle d'affichage existante reste : un preset
  n'est actif que si `!from && !to` (le calendrier prime dès qu'une borne existe).

**Ce qui disparaît :** les deux `<input type="date">` et la flèche « → » entre eux (le style
`dateInput` devient mort et est supprimé). **Tout le reste du `FacetPanel` est inchangé**
(Autour de moi, presets, Département/Catégorie/Genre avec compteurs, Effacer global).

## Architecture

- **Créer `frontend/components/calendar/DateRangeChip.tsx`** — chip + popup calendrier de plage,
  **autonome** : réutilise les helpers purs de `lib/calendar` (`monthGrid`, `monthLabel`,
  `addMonths`, `todayKey`) comme `DateField`, mais **sans toucher `DateField`** (mono-date,
  consommé partout — le dupliqué de ~40 lignes de grille est le prix de sa stabilité, tradeoff
  assumé). Props : `{ from: string | null, to: string | null, onChange(from, to), ariaLabel? }`.
  Valeurs `YYYY-MM-DD` (le format d'état existant de `CalendarFilterState`).
- **Créer le helper pur `rangeChipLabel(from, to)`** dans `frontend/lib/tournamentCalendar.ts`
  (« 24 juil. → 2 août » / « Du 24 juil. » / « Jusqu'au 2 août » / `null` si aucune borne —
  formatage **sans passer par `Date`** pour le jour : split de la clé, mois via tableau FR
  abrégé, même philosophie que `frLabel` de `DateField`).
- **Modifier `frontend/components/calendar/FacetPanel.tsx`** — remplacer le `<span>` des deux
  inputs par `<DateRangeChip from={state.from} to={state.to} onChange={onSetRange} />` ;
  supprimer `dateInput`. **Aucun changement de props** (`onSetRange` existe déjà) → aucun
  changement dans `TournamentFinder`, l'état, l'URL, `applyFilters`.
- Les deux surfaces (`/decouvrir` section Tournois, `/tournois` national) héritent du changement
  automatiquement.

## Accessibilité

- Chip : `aria-haspopup="dialog"`, `aria-expanded` ; ✕ = bouton distinct « Effacer les dates ».
- Popup : `role="dialog"`, jours en boutons avec `aria-label` date complète (idiome `DateField`),
  Échap / clic extérieur pour fermer, focus clavier natif des boutons.

## Tests

- **`frontend/__tests__/DateRangeChip.test.tsx`** (nouveau) : ouvre au clic ; 1ᵉʳ tap pose from
  (popup reste ouverte) ; 2ᵉ tap pose to et ferme ; 2ᵉ tap antérieur → bornes échangées ;
  ✕ efface sans ouvrir ; « Effacer » vide et ferme ; libellé de chip selon from/to.
- **`frontend/lib/tournamentCalendar`** (`tournamentCalendar.test.ts`) : cas `rangeChipLabel`
  (plein / from seul / to seul / vide).
- **`FacetPanel.test.tsx`** (existant, mise à jour) : les assertions sur les inputs natifs
  (`aria-label` « Du »/« au ») migrent vers la chip + le dialog ; le reste (presets, facettes,
  Effacer) reste vert.
- **`TournamentFinder.test.tsx`** (existant) : doit rester vert sans modification si ses tests ne
  touchent pas les inputs date ; sinon même migration.
- Vérification visuelle CDP : `/decouvrir` (section Tournois, popup ouverte) clair + sombre,
  1280 + 390 — popup lisible, pas de débordement.

## Hors périmètre

- La bande d'horizon (piste B) et la barre à menus (piste C).
- Tout changement de `DateField`, des presets, des facettes, de l'état ou de l'URL.
- Le sélecteur « Quand » de `/events` (EventsFilterBar, autre modèle sans plage libre).
