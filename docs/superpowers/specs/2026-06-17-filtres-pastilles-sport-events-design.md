# Filtres « pastilles accent » : composant partagé + page Réserver + page Events — Design

**Date** : 2026-06-17
**Statut** : approuvé, prêt pour le plan

## Contexte & problème

Sur la page **Réserver** (`ClubReserve.tsx`), chaque sport du club est empilé en une
section (en-tête sport + sélecteur de durée + terrains). Avec plusieurs sports c'est
long, et le sélecteur de durée (`Segmented` pleine largeur) a été jugé **trop gros**.
L'utilisateur veut **filtrer par sport** et une durée **compacte**.

Plus largement, l'utilisateur a rejeté le look « boîte segmented » pour les filtres
(jugé « pas beau ») et a choisi, parmi 3 maquettes, le style **« pastilles accent »**
(option B). Il en fait le **standard des filtres de page** (cf. mémoire
`feedback-filter-style`) et demande de l'appliquer **aussi à la page Events**, dont les
filtres existent déjà mais avec des libellés inactifs peu lisibles et des couleurs
non standardisées.

## Objectif

1. Créer un **composant de filtre partagé** au style « pastilles accent ».
2. L'appliquer à la page **Réserver** : filtre par sport + durée compacte.
3. L'appliquer à la page **Events** : rangée principale + facettes secondaires.

Hors périmètre : toucher au sélecteur de **dates** (inchangé) ; modifier la **logique**
de filtrage Events (`agendaFacets` / `applyAgendaFilters` / persistance URL) — on ne
refait que l'habillage ; tout backend ou migration.

## Règle de style (standard)

Pastilles arrondies (`borderRadius: 999`), **sans piste** :

| Niveau | Taille | Fond actif | Texte actif | Inactif |
|---|---|---|---|---|
| Filtre **principal** (single-select) | `md` (padding 8/16, 14 px, poids 700) | `th.accent` | `inkOn(th.accent)` | fond `th.surface`, `inset 0 0 0 1px th.line`, texte **`th.text`** (poids 600) |
| **Sous-filtre** (durée, facettes) | `sm` (padding 5/12-13, 12.5–13 px) | `th.text` | `inkOn(th.text)` | idem inactif ci-dessus |

- `th.text` comme fond actif des sous-filtres s'**inverse** avec le thème (foncé en clair,
  clair en sombre) → toujours contrasté ; texte calculé par `inkOn()` (déjà exporté par
  `lib/theme.ts`).
- **Lisibilité** : les libellés inactifs sont en `th.text` (plein), pas `th.textMute` —
  c'est le correctif de contraste demandé.

## Architecture

### 1. Composant partagé — `frontend/components/ui/atoms.tsx`

Deux exports, le second construit sur le premier :

```ts
type PillSize = 'md' | 'sm';

// Primitif : une pastille. activeBg défaut = th.accent.
export function Pill(props: {
  label: React.ReactNode;
  active: boolean;
  onClick: () => void;
  size?: PillSize;        // défaut 'md'
  activeBg?: string;      // défaut th.accent
  'aria-label'?: string;
}): JSX.Element;

// Groupe single-select bâti sur Pill.
export function PillTabs<T extends string | number>(props: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: PillSize;        // défaut 'md'
  activeBg?: string;      // défaut th.accent
}): JSX.Element;
```

- `Pill` : `<button>`, styles inline (cohérent avec le fichier). `md` = padding `8px 16px`,
  `fontSize 14`, `fontWeight active?700:600` ; `sm` = padding `5px 13px`, `fontSize 13`,
  `fontWeight active?700:600`. Actif : `background activeBg; color: inkOn(activeBg); boxShadow:none`.
  Inactif : `background th.surface; color th.text; boxShadow: inset 0 0 0 1px th.line`.
  `transition: all .15s`. `cursor:pointer`, `border:none`.
- `PillTabs` : conteneur `display:inline-flex; flexWrap:wrap; gap:8` (`md`) / `gap:6` (`sm`) ;
  mappe les options sur `Pill` (single-select : `active = o.value === value`).
- `inkOn` importé depuis `lib/theme.ts`.
- Le `Segmented` existant **reste inchangé** (toujours utilisé pour la bascule thème
  Clair/Sombre et autres bascules non-filtre).

### 2. Page Réserver — `frontend/components/ClubReserve.tsx`

- **Nouvel état** `selectedSportId: string`, initialisé au **premier** `clubSport.id`.
- **Filtre sport** : si `club.clubSports.length > 1`, afficher en haut de la vue Réserver
  (sous le `DateSelector`, qui ne change pas) un `PillTabs` `md` accent :
  `options = club.clubSports.map(cs => ({ value: cs.id, label: cs.sport.name }))`,
  `value = selectedSportId`, `onChange = setSelectedSportId`.
- **Rendu** : ne rendre que la section du sport sélectionné
  (`club.clubSports.filter(cs => cs.id === selectedSportId)` ; quand 1 seul sport, c'est
  lui). Le petit en-tête majuscule du sport au-dessus de la section est **masqué quand
  `clubSports.length > 1`** (redondant avec l'onglet actif), conservé sinon.
- **Durée** : remplacer le `Segmented` (durations, ~ligne 174) par
  `PillTabs` `sm` avec `activeBg = th.text` :
  `options = durations.map(d => ({ value: d, label: durationLabel(d) }))`,
  `value = selDur`, `onChange = (d) => changeDuration(cs.id, d)`. Condition d'affichage
  inchangée (`durations.length > 1`).
- **Données** : `reloadAll` continue de charger **tous** les sports en fond → bascule
  d'onglet instantanée, aucun nouvel appel.
- **Lien profond** (`?resource=&start=`) : à la résolution, faire
  `setSelectedSportId(<clubSport du terrain visé>)` pour que sa section soit visible
  derrière la confirmation (la boucle qui cherche déjà le terrain dans `club.clubSports`
  connaît le `cs.id`).

### 3. Page Events — `frontend/app/events/page.tsx`

Remplacer les boutons inline `chip`/`secChip` par le composant partagé, **sans toucher à
la logique** (`FILTERS`, `selectSource`, `agendaFacets`, `toggle`, `clearFacets`,
persistance URL, séparateurs `sep`, conditions `showCategories/...`) :

- **Rangée principale** `[Tout | Compétitions | Animations]` → `PillTabs` `md` accent :
  `options = FILTERS.map(f => ({ value: f.key, label: f.label }))`, `value = filter`,
  `onChange = selectSource`.
- **Rangée secondaire** (multi-sélection) → primitif `Pill` `sm` avec `activeBg = th.text` :
  - catégories : `Pill` `active = categories.has(c)` `onClick = () => toggle(setCategories, c)` ;
  - genres : `Pill` `active = genders.has(g)` label `GENDER_LABEL[g]` ;
  - kinds : `Pill` `active = kinds.has(k)` label `KIND_LABEL[k]` ;
  - Membres : `Pill` `active = memberOnly` `onClick = () => setMemberOnly(v => !v)`.
  - Le lien « Effacer » et les séparateurs `sep` restent tels quels.
- Les helpers `chip`/`secChip` sont **supprimés** (remplacés par `Pill`).
- Effet visible assumé : le principal passe foncé→accent, les facettes passent
  accent→foncé ; libellés inactifs désormais pleinement lisibles.

## Tests

- `frontend/__tests__/Pill.test.tsx` : `Pill` rend le libellé, applique l'état actif
  (style/`aria`), déclenche `onClick` ; `PillTabs` rend une pastille par option, marque la
  bonne active, appelle `onChange` au clic d'une autre.
- `ClubReserve.*` : mettre à jour les tests impactés par le filtrage (seul le sport
  sélectionné est rendu) ; ajouter un cas « ≥ 2 sports → onglets présents, bascule change la
  section affichée » et « 1 sport → pas d'onglets ». Garder vert `deeplink`/`pastslots`/`persport`.
- `events.*` : si des tests ciblent les libellés/styles des filtres, les adapter au nouveau
  composant ; la logique de facettes (déjà couverte par `__tests__/events.test.ts`) ne change pas.

## Ce qui ne change pas

- `DateSelector` (dates) ; `Segmented` boxé ; toute la logique de disponibilité/réservation ;
  la logique de facettes Events et la persistance URL. Aucun backend, aucune migration.
