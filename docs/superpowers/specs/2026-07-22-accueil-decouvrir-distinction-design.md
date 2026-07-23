# Distinguer Mon Palova de /decouvrir — « Chez moi / Le territoire »

**Date** : 2026-07-22
**Statut** : validé par Eric (piste A choisie sur maquettes comparées dans le companion visuel, 3 pistes présentées)

## Problème

Depuis que la recherche est remontée dans le hero de Mon Palova (commit `9f767243`), l'accueil
connecté et `/decouvrir` partagent exactement le même motif : hero « brume bleue » arrondi
(`HERO_GRADIENT`) + grande pilule de recherche blanche flottante (`LocationSearchPill`) à cheval
sur son bord bas. En naviguant de l'une à l'autre, **on ne sait plus où on est** — même geste,
même silhouette, même pilule.

## Décision

**La grande pilule blanche devient la signature exclusive de la recherche** (`/decouvrir` et la
vitrine anonyme, qui y atterrit aussi). L'accueil connecté garde le même geste flottant, mais avec
une **porte compacte encre « Découvrir »** — silhouette opposée. Le réflexe visuel installé :
*pilule blanche = je cherche, pastille encre = j'y vais*. Les motifs de filigrane s'opposent
aussi : **balle** au filigrane sur le « chez moi », **France en pointillés** sur le territoire.

Pistes écartées :
- **B « Carte vs bandeau »** (hero `/decouvrir` en bandeau pleine largeur) — pertinente mais plus
  lourde ; combinable plus tard si besoin.
- **C « Deux lavis »** (brume émeraude sur `/decouvrir`) — diluerait la signature brume bleue
  protégée partout ailleurs.

## Design

### 1. `HomeHero.tsx` — textes uniquement

- Titre : « Où veux-tu jouer ? » → **« Prêt à jouer ? »** (neutre multi-sport — « Ta semaine
  padel » a été explicitement refusé : on ne réserve pas que du padel).
- Sous-titre : « Un club, un créneau, une partie ouverte — près de chez toi. » →
  **« Ton agenda, tes clubs et tes parties — d'un coup d'œil. »** (la promesse de recherche part
  dans la porte ; le hero devient l'en-tête du tableau de bord).
- Inchangé : kicker « Bonjour {prénom} » (Righteous), `HERO_GRADIENT`, profondeur radiale,
  filigrane balle, padding bas généreux (la porte flotte toujours sur le bord bas).

### 2. `DiscoverPill.tsx` — grande pilule → porte encre

Le composant ne rend plus `LocationSearchPill`. Il devient une **pastille-lien compacte** :

- **Visuel** : pill pleine `PILL_INK` (`#1b2a3f`), texte `#f4f6fa`, hauteur ~40 px, radius 999,
  ombre portée `0 12px 28px rgba(27,42,63,.35)`, léger lift au survol (transition locale ou
  `.pl-lift`). Alignée à gauche, marge haute négative (même geste flottant que la pilule —
  valeur à caler sur l'existant, ~`-20px`), `zIndex` au-dessus du hero.
- **Contenu** : icône **mini-France en pointillés** (~18 px, trame de points clairs
  `rgba(244,246,250,.95)` masquée par la silhouette hexagone) + libellé
  **« Découvrir · clubs, parties, tournois »** + flèche « → » discrète (opacité ~.7).
- **Icône France** : réutiliser la silhouette existante — exporter `FRANCE_MASK` (ou un petit
  composant icône) depuis `FranceDotsMap.tsx` plutôt que dupliquer le path.
- **Comportement** : un seul geste — clic → `router.push('/decouvrir')`. **Disparaissent** : le
  champ de saisie, le bouton « Autour de moi », les paramètres `?q=` / `?pres=1` posés depuis
  l'accueil (on tape sa recherche sur `/decouvrir`, qui garde ses deep-links pour la vitrine).
- **Accessibilité** : `<button>` (navigation par `router.push`, comme le composant actuel) avec
  libellé accessible « Découvrir · clubs, parties, tournois » ; l'icône France est `aria-hidden`.
- `MonPalova.tsx` : aucun changement (le bloc hero + porte reste groupé tel quel).

### 3. Inchangés

`/decouvrir` (`DiscoverClient`), la vitrine anonyme (`AnonymousView`), `LocationSearchPill`
(toujours utilisée par ces deux surfaces), `FranceDotsMap` (hors l'export éventuel du masque).

## Tests

- `HomeHero.test.tsx` : les 2 assertions « Où veux-tu jouer » passent sur « Prêt à jouer ».
- `DiscoverPill.test.tsx` : réécrit — le clic sur la porte navigue vers `/decouvrir` ; plus de
  champ de saisie ni de bouton « Autour de moi » (les 3 tests actuels tombent avec la recherche
  embarquée).
- `MonPalova.test.tsx` : 2 assertions de texte hero à mettre à jour (lignes « Où veux-tu
  jouer ») ; le mock de `DiscoverPill` reste valable.

## Vérification

Visuelle (CDP) : clair + sombre, desktop 1280 + mobile 390 — la porte flotte sans déborder, le
contraste encre/brume tient dans les deux thèmes ; `/decouvrir` inchangé au pixel.

## Hors périmètre

- Vitrine anonyme et `/decouvrir` (aucun changement).
- Piste B (bandeau pleine largeur sur `/decouvrir`) — réactivable plus tard si la distinction ne
  suffit pas.
- Pré-remplissage de la recherche depuis l'accueil (assumé : il disparaît avec le champ).
