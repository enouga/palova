# Onglets « Mes réservations » adaptés au mobile — Design

**Date :** 2026-06-22
**Statut :** validé, prêt pour le plan d'implémentation

## Contexte & problème

La page `/me/reservations` affiche une barre d'onglets `Segmented` à 4 entrées :
`Calendrier`, `À venir · N`, `Passées · N`, `Matchs` (l'onglet « Matchs »
n'existe que si le club a activé le système de niveau).

Le composant `Segmented` (`frontend/components/ui/atoms.tsx`) met les boutons en
`flex: 1` (largeur égale), sans gestion de débordement ni de césure. Sur **desktop /
tablette, tout tient** (la colonne app monte jusqu'à 820 px). Mais sur un **téléphone**
(colonne = pleine largeur de l'écran, ~360–430 px) les libellés longs (« À venir · 3 »,
« Passées · 5 ») débordent : la rangée devient plus large que l'écran et « Matchs » est
rogné / les textes se chevauchent.

## Objectif

Sur écran étroit, faire tenir les 4 onglets proprement, **sans rien changer au rendu
desktop** (qui convient déjà) et en gardant chaque onglet accessible **d'un seul tap**.

### Non-objectifs

- Ne pas changer le rendu desktop / tablette.
- Ne pas repenser l'information-architecture (pas de navigation à deux niveaux).
- Ne pas toucher aux 5 autres usages du composant `Segmented`.

## Solution retenue (option B — icônes empilées sur mobile)

### Comportement

- **Largeur ≥ 480 px (desktop, tablette) : strictement inchangé.** 4 onglets texte en
  largeur égale, compteur inline (« À venir · 3 »).
- **Largeur < 480 px (mobile) :** chaque onglet devient une **icône empilée au-dessus
  d'un libellé court** :
  - `Calendrier` → icône `calendar`
  - `À venir` → icône `clock`
  - `Passées` → icône `check`
  - `Matchs` → icône `trophy`

  Toutes ces icônes existent déjà dans `frontend/components/ui/Icon.tsx` — rien à dessiner.
- Les **compteurs** (À venir / Passées) passent d'un texte inline à une **pastille**
  posée sur l'icône. `Calendrier` et `Matchs` n'ont pas de compteur (comme aujourd'hui).
  Le nombre est affiché tel quel (y compris « 0 »), pour rester aligné sur le desktop.
- **Onglet actif :** fond blanc + ombre douce (inchangé) + icône à la **couleur d'accent**
  du club. **Onglet inactif :** icône grisée (`textFaint`). Le libellé reste lisible
  (`text`) dans les deux cas.
- Le **seuil de 480 px** est ajustable. Il couvre tous les téléphones (même les grands
  ~430 px basculent en icônes) ; les tablettes en portrait (≥ 768 px) gardent le texte.

## Architecture

On **étend le composant existant `Segmented`** plutôt que d'en créer un
nouveau, via des champs **optionnels** :

- Par option : `icon?: IconName` et `count?: number`.
- Sur le composant : un flag `responsive?: boolean` (défaut `false`).

Règles :

- Quand `responsive` est faux (cas par défaut) **et** qu'aucune option ne porte d'icône,
  le rendu est **identique à aujourd'hui**. Les **5 autres usages** de `Segmented`
  (parties/classement, durées de créneau, privé/public, thème clair/sombre, oui/non) ne
  passent aucun de ces nouveaux champs → **aucun changement, aucun risque**.
- Seule la page `/me/reservations` passe `responsive` + `icon` + `count`.

### Mécanisme responsive

- Le basculement ligne → colonne et l'affichage icône/pastille se font en **CSS pur**,
  via `@media (max-width: 480px)` dans `frontend/app/globals.css` (le fichier contient
  déjà des `@media`, c'est la convention du projet). Quelques classes dédiées
  (ex. `seg-tab`, `seg-tab-icon`, `seg-tab-count`) portent la mise en page responsive.
- **Les couleurs restent en styles inline** depuis le thème (`th.accent`, `th.text`,
  `th.surface`, `th.textFaint`, `th.shadowSoft`) — comme tout le reste de l'app. Un même
  élément peut porter `className` (mise en page responsive) **et** `style` (couleurs).
- Un seul rendu DOM, le CSS décide au premier paint selon la largeur : **pas de JS, pas
  de scintillement, pas de mismatch d'hydratation.**

### Rendu des compteurs (un seul DOM, bascule CSS)

Chaque onglet rend toujours : l'icône (masquée en CSS sur desktop), le libellé, et le
compteur dans un `<span>` dédié. En desktop, ce span s'affiche en texte inline (avec son
séparateur « · ») ; en mobile, il devient une pastille positionnée sur l'icône. Le
basculement est piloté par la media query, pas par deux rendus séparés.

## Tests

- Les tests existants de `Segmented` et de `MyReservationsCalendar` doivent **rester
  verts** (le rendu desktop par défaut ne change pas).
- **Ajout :** un test vérifiant qu'avec `icon` et `count` fournis, l'icône et la pastille
  de compteur sont bien rendues, et qu'une option sans ces champs ne les rend pas.

## Hors périmètre

- Navigation à deux niveaux (vue + filtre).
- Barre défilante horizontale.
- Modification des autres usages de `Segmented`.
