# Présentation du sport préféré & de l'échelle de niveau (page profil)

**Date :** 2026-06-23
**Périmètre :** `frontend/app/me/profile/page.tsx` + `frontend/components/player/LevelHistoryChart.tsx` (+ nouveau helper pur)
**Backend / migration :** aucun. 100 % front.

## Problème

Sur `/me/profile`, deux présentations sont insatisfaisantes :

1. **Sélecteurs de sport** = menus déroulants natifs (`<select>`) pour « Sport du niveau » et « Sport préféré ». Peu engageants, hors du langage visuel « pastilles » du reste de l'app.
2. **Courbe de progression** (`LevelHistoryChart`) tracée sur **toute l'échelle 0→8**. Quand le niveau bouge peu, c'est une ligne quasi plate collée en bas, avec une **grande zone vide** au-dessus.

## Décisions (validées avec l'utilisateur via maquettes)

- Sélecteur de sport → **pastilles, sans icône** (option A). Réutilisé pour les **deux** sélecteurs.
- Échelle de niveau → **courbe auto-zoomée + puce de delta + repli « Stable »** (option B).
- Delta affiché **« sur N matchs »** (pas de fenêtre en jours).
- Format décimal du delta → **virgule française** (`+0,3`). Le `LevelBadge` garde son point (« 2.2 ») — hors périmètre.

## Changement 1 — Sélecteur de sport en pastilles

Réutilise le composant **existant** `PillTabs<T>` (`components/ui/atoms.tsx`) — single-select, bâti sur `Pill`, couleur accent du club par défaut. **Aucun nouveau composant.**

### « Sport du niveau » (section *Mon niveau*)
Remplacer le `<select id="rating-sport">` (lignes ~301-309) par :

```tsx
<PillTabs
  options={sports.map((s) => ({ value: s.key, label: s.name }))}
  value={ratingSport}
  onChange={setRatingSport}
/>
```
Conserver le `<label>` « Sport du niveau » au-dessus (texte d'aide d'accessibilité — `PillTabs` n'a pas de `<label>` associable, on garde donc un libellé visible).

### « Sport préféré » (section *Préférences*)
Remplacer le `<select id="pref-sport">` (lignes ~384-393) par :

```tsx
<PillTabs
  options={[{ value: '', label: 'Aucun' }, ...sports.map((s) => ({ value: s.id, label: s.name }))]}
  value={profile.preferredSport?.id ?? ''}
  onChange={handlePreferredSport}
/>
```
La pastille **« Aucun »** (value `''`) remplace l'`<option value="">Aucun</option>`. `handlePreferredSport('')` envoie déjà `preferredSportId: null`.

### Notes
- Pas d'icône (choix utilisateur) — uniquement `s.name`.
- Débordement : `PillTabs` fait déjà `flex-wrap`. OK même avec beaucoup de sports.
- Les deux blocs ne s'affichent que si `sports.length > 0` (inchangé).
- Accessibilité : `Pill` expose `aria-pressed`. Le libellé visible reste au-dessus.

## Changement 2 — `LevelHistoryChart` auto-zoomé + delta + repli « Stable »

### Nouveau helper pur — `frontend/lib/levelHistory.ts`
Logique testable isolée du rendu (pattern du codebase).

```ts
import { RatingPoint } from '@/lib/api';

export const FLAT_THRESHOLD = 0.15; // amplitude min (en points de niveau) pour tracer une courbe

export interface HistorySummary {
  state: 'empty' | 'flat' | 'trend';
  count: number;   // nb de points
  delta: number;   // dernier.level - premier.level
  min: number;
  max: number;
}

export function summarizeHistory(points: RatingPoint[]): HistorySummary {
  const count = points.length;
  if (count === 0) return { state: 'empty', count, delta: 0, min: 0, max: 0 };
  const levels = points.map((p) => p.level);
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const delta = points[count - 1].level - points[0].level;
  const state = count < 2 || max - min < FLAT_THRESHOLD ? 'flat' : 'trend';
  return { state, count, delta, min, max };
}

/** Delta signé en virgule française à 1 décimale : "+0,3", "−0,2", "0,0". */
export function fmtDelta(delta: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : ''; // − = U+2212
  return `${sign}${Math.abs(delta).toFixed(1).replace('.', ',')}`;
}
```

### Rendu du composant (`LevelHistoryChart`)
- `state === 'empty'` → **inchangé** : « Pas encore d'historique — joue des matchs pour voir ta progression. »
- `state === 'flat'` → **pas de SVG**. Afficher une ligne calme :
  - puce neutre grise **« – stable »**
  - texte `Niveau stable · {count} match{count > 1 ? 's' : ''}`
  - (évite que l'auto-zoom transforme du bruit infime en fausse montagne)
- `state === 'trend'` → 
  - **puce de delta** : `▲` vert (`#15803d` sur fond `#dcf3e3`) si `delta > 0`, `▼` rouge si `delta < 0`, neutre grise si `|delta| < 0,05` ; texte `{flèche} {fmtDelta(delta)} · {count} matchs`.
  - **sparkline auto-zoomée** : y mappé sur `[min − pad, max + pad]` (au lieu de 0→8), `pad = max(0.1, (max - min) * 0.15)`. Hauteur réduite (`H ≈ 48`, contre 90). Trait accent `#2563eb`, point final plein. Largeur `100%`.

Le `LevelSourceNote` sous le bloc reste inchangé (rendu par la page).

### Position de la puce de delta
Le bloc niveau garde sa rangée badge (`LevelBadge` + bouton « Réévaluer »). La puce de delta vit **dans `LevelHistoryChart`** (au-dessus de la sparkline), pas dans la rangée badge — « Réévaluer » n'est pas déplacé.

## Tests (TDD)

- **`frontend/__tests__/levelHistory.test.ts`** (nouveau) :
  - `summarizeHistory([])` → `empty`.
  - 1 point → `flat`.
  - points avec amplitude `< 0,15` → `flat` ; `≥ 0,15` → `trend`.
  - `delta` = dernier − premier (signe correct).
  - `fmtDelta` : `+0,3`, `−0,2`, `0,0` (virgule, signe moins U+2212).
- **`frontend/__tests__/LevelHistoryChart.test.tsx`** (mise à jour) :
  - vide → message inchangé, pas de `<svg>`.
  - plat → texte « Niveau stable », **pas** de `<path>`.
  - trend → puce de delta présente + `<path>` présent.
- Aucun test backend (rien ne change côté API).

## Hors périmètre

- Format du `LevelBadge` (garde le point décimal).
- Toute modification backend / endpoint `/api/me/rating/history` (renvoie déjà `{ playedAt, level }`).
- Migration de base.
- Refonte des autres sélecteurs natifs de la page (Langue) — non demandé.

## Edge cases

- `sports.length === 1` → une seule pastille (OK).
- Historique avec montée puis retour au même niveau → `state` peut être `trend` (amplitude ≥ seuil) avec `delta ≈ 0` → puce neutre, courbe tracée (cohérent : il s'est passé quelque chose).
- `count` inclut le point de départ ; « N matchs » = nombre de points affichés.
