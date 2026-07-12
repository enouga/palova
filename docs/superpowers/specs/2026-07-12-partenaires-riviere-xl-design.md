# Partenaires — Rivière XL, logo en héros (SponsorMarquee v2)

**Date** : 2026-07-12
**Statut** : validé par Eric (direction A « Rivière XL » + anatomie 1 « logo + nom + offre », choisies sur maquettes comparées dans le companion visuel)

## Problème

Dans la section « Nos partenaires » du Club-house (`components/clubhouse/SponsorMarquee.tsx`), les logos font 46×46 px dans des petites cartes horizontales : les marques sont illisibles, les partenaires ne sont pas valorisés.

## Décision

La carte de la rivière s'inverse : **le logo devient la carte**. Carte verticale, logo en héros, nom et offre dessous. Le défilement et toute la mécanique existante sont conservés.

## Périmètre

- **100 % frontend** : seul `components/clubhouse/SponsorMarquee.tsx` change (+ sa suite de tests).
- **Aucune migration, aucun backend** : le modèle `Sponsor` expose déjà tout le nécessaire (`logoUrl`, `linkUrl`, `offerText`, `offerCode`, `offerUntil`, `pinned`).
- `/admin/sponsors` inchangé.

## Anatomie de la nouvelle carte

De haut en bas :

1. **Tuile logo** : ~150×84 px, fond **blanc fixe** (`#fff`, y compris en thème sombre — les logos en ont besoin), `border-radius` ~12, logo en `objectFit: 'contain'` avec padding ~10, ombre douce (pas de bordure inset).
2. **Nom** en petites capitales : ~11 px, bold, `letterSpacing` ~1.2, `textTransform: uppercase`, couleur `th.text`, centré.
3. **Rangée offre** (seulement si offre active — `offerIsActive(s, ref)` inchangé) :
   - chip teinte accent (`${th.accent}1c` / `th.accent`) avec `offerText` (ellipsis si trop long, `maxWidth` ~150) ;
   - **bouton code** copiable si `offerCode` : mono, fond encre, « ✓ Copié » 1,6 s au clic (logique `copy` actuelle conservée) ;
   - **compte à rebours coral** si expiration urgente (< 48 h) via `deadlineCountdown` (inchangé, gaté sur `now`).
4. **Sans offre active** : tuile + nom seuls, pas de rangée vide.

La carte entière est centrée (`textAlign: center`), largeur fixe ~150 px, `flexShrink: 0`.

## Comportements conservés tels quels

- **Tri** : `pinned desc, sortOrder asc` (backend `listPublic`, non touché).
- **Lien** : tuile + nom enveloppés dans un `<a target="_blank" rel="noreferrer">` si `linkUrl`, sinon `<span>` — le bouton code reste un **sibling hors de l'ancre** (pattern existant, pas de nested interactive).
- **Défilement** : piste dupliquée si > 2 sponsors, animation CSS `sp-slide` translateX(-50%), pause au survol, fondus latéraux `th.bg` sur les bords.
- **Reduced-motion** : pas d'animation, `flex-wrap: wrap`.
- **≤ 2 sponsors** : rangée statique.
- **`now` null-safe** : `ref = now ?? new Date(0)` (hydration-safe, inchangé).
- **0 sponsor** : section non rendue.

## Ajustement

- **Durée d'animation** : cartes plus larges → défilement un peu plus lent, `Math.max(22, sponsors.length * 8)` s (au lieu de `Math.max(18, n * 6)`).

## Tests

Mise à jour de `frontend/__tests__/SponsorMarquee.test.tsx` :

- tuile logo rendue avec `alt` = nom, dimensions XL ;
- nom affiché sous la tuile ;
- offre active → chip texte + bouton code, clic = copie + « ✓ Copié » ;
- sponsor sans offre → pas de chip ni bouton ;
- compte à rebours urgent affiché quand `offerUntil` proche et `now` fourni ;
- lien `linkUrl` sur tuile+nom, bouton code hors de l'ancre ;
- rien rendu si 0 sponsor.

Vérification visuelle CDP (clair + sombre, desktop + mobile) après implémentation.

## Hors périmètre

- Page dédiée `/partenaires` (directions B « mur » et C « vitrine tournante » écartées).
- Changement backend, upload/format des logos, admin sponsors.
