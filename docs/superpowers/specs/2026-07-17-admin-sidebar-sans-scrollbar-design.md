# Sidebar admin sans scrollbar — densité adaptative

> Spec validée le 2026-07-17 (brainstorming avec Eric).

## Problème

La sidebar du back-office (`frontend/app/admin/layout.tsx`) affiche, pour un rôle admin
complet, **21 liens + 5 titres de section** (+ en-tête de marque, ligne « Tout replier »,
pied ThemeToggle/ProfileMenu). Avec les espacements actuels (liens `padding: 9px 12px`,
titres à `marginTop: 12`), la colonne dépasse ~1050 px de haut : le `<nav>` (`overflowY:
auto`) affiche une scrollbar sur la plupart des écrans, y compris 1080p. Eric veut que
**tous les liens soient visibles sans scroller**.

## Décision : densité adaptative en styles inline (approche A)

Tous les **espacements verticaux** de la sidebar deviennent des valeurs fluides
`clamp(min, calc(a·vh − b), max)` calculées sur la hauteur de fenêtre (la sidebar est
déjà `height: 100vh`) :

- sur grand écran (≥ ~1100 px de haut), les valeurs plafonnent aux espacements
  **actuels** — aucun changement visible ;
- quand la fenêtre raccourcit, les blancs se compriment continûment, sans palier ;
- cible : **tout tient sans scrollbar dès ~800 px** de hauteur de fenêtre ;
- en dessous (~780 px, cas rare), `overflowY: auto` reste en **dernier recours** —
  la scrollbar revient plutôt que de rendre le menu illisible.

Approche B (classes + `@media (max-height)` dans `globals.css`) écartée : paliers
visibles, style éparpillé dans deux fichiers, et piège connu du `globals.css` périmé
sous Turbopack.

## Valeurs

Uniquement le vertical — rien ne change horizontalement. Polices (14 px) et icônes
(18 px) **inchangées** : on comprime les blancs, pas la lisibilité.

| Élément | Avant | Après |
|---|---|---|
| Padding vertical des liens | `9px` | `clamp(2px, 2vh - 15px, 9px)` |
| `marginTop` des titres de section | `12` | `clamp(3px, 2vh - 13px, 12px)` |
| Padding vertical des titres de section | `6px` | `clamp(2px, 1vh - 4px, 6px)` |
| Padding vertical de l'`aside` | `20px` | `clamp(10px, 2vh - 4px, 20px)` |
| `marginTop` du `<nav>` | `10` | `clamp(4px, 1vh - 2px, 10px)` |
| `gap` du `<nav>` | `3` | `2` |
| `paddingTop` du pied (ThemeToggle/ProfileMenu) | `16` | `clamp(8px, 2vh - 8px, 16px)` |

Les formules exactes peuvent être ajustées à l'implémentation **tant que la cible tient**
(aucune scrollbar dès ~800 px de fenêtre avec le menu admin complet déplié, densité
actuelle retrouvée sur grand écran).

## Ce qui ne bouge pas

- Repli des sections (localStorage `palova:admin-sidebar-sections`), ligne « Tout
  replier », badge Signalements, pied de page, largeur 244 px.
- Comportement mobile : sidebar repliée par défaut ≤ 768 px (inchangé).
- `overflowY: auto` du `<nav>` (filet de sécurité).
- Aucun changement backend, aucune migration, aucun autre fichier que
  `frontend/app/admin/layout.tsx`.

## Tests & vérification

- `AdminLayout.test.tsx` n'asserte pas les styles : suite existante inchangée, aucun
  nouveau test (changement purement visuel, jsdom ne calcule pas `clamp`).
- Vérification visuelle CDP : 1280×800 **et** 1280×950, clair + sombre, rôle admin
  complet (21 liens) — critère : `scrollHeight ≤ clientHeight` sur le `<nav>` à 800 px.
