# Niveau de joueur — Lot 3b (Frontend : niveau affiché partout + matchmaking parties ouvertes + courbe) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Afficher le niveau des joueurs partout (pastilles, annuaire, inscrits tournois/events), piloter les parties ouvertes par le niveau (pastille + **fourchette cible** à la création + **avertissement** non bloquant + **filtre « à mon niveau »**), et afficher la **courbe de progression** sur le profil.

**Architecture :** un composant compact réutilisable `LevelChip` (montre « 4.2 » + statut), branché dans le composant partagé `PlayerPills` et partout où des joueurs s'affichent. Helpers purs `lib/levelMatch.ts` (dans/hors fourchette, proximité). Les payloads backend exposent déjà `level` (Lot 3a). Courbe = mini-SVG depuis `GET /me/rating/history`.

**Tech Stack :** Next.js 16 / React 19 / TS / Tailwind v4, Jest + RTL.
**Pré-requis (origin/main `f73b929`)** : payloads enrichis `level` (open matches + `targetLevelMin/Max`, membres, inscrits, participants résas), `GET /api/me/rating/history`, `POST /reservations/hold` accepte `targetLevelMin/Max`.

**Machine :** worktree `C:\dev\palova-wt-niveau`, branche `feat/player-rating-lot1`. Frontend depuis `frontend` (`npx jest`, `npx tsc --noEmit`).

---

### Task 1: Client API — types `level` + historique + fourchette

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Type `UserLevel`** (près des interfaces) :
```ts
export interface UserLevel { level: number; tier: string; isProvisional: boolean; }
export interface RatingPoint { playedAt: string; level: number; }
```

- [ ] **Step 2: Ajouter `level` aux payloads existants** (champ optionnel `level?: UserLevel | null`) :
- `OpenMatchPlayer` → ajouter `level?: UserLevel | null;`
- `OpenMatch` → ajouter `targetLevelMin?: number | null; targetLevelMax?: number | null;`
- L'interface des résultats de `searchMembers` (chercher le type renvoyé par la méthode `searchMembers`/annuaire) → ajouter `level?: UserLevel | null;`
- `TournamentParticipant` → ajouter `captainLevel?: UserLevel | null; partnerLevel?: UserLevel | null;`
- `EventParticipant` → ajouter `level?: UserLevel | null;`
- Le type des `participants` de `MyReservation` → ajouter `level?: UserLevel | null;`
(Tous optionnels → rétro-compatibles.)

- [ ] **Step 3: Méthode historique + fourchette à la création** :
```ts
  getRatingHistory: (token: string, sport = 'padel') =>
    request<RatingPoint[]>(`/api/me/rating/history?sport=${encodeURIComponent(sport)}`, {}, token),
```
Et là où le front appelle `POST /api/reservations/hold` (chercher la méthode `holdReservation`/`hold` dans `api`), ajouter au type du body les champs optionnels `targetLevelMin?: number | null; targetLevelMax?: number | null;` (sans casser les appelants).

- [ ] **Step 4: tsc** : `cd C:\dev\palova-wt-niveau\frontend && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**
```bash
cd C:\dev\palova-wt-niveau
git add frontend/lib/api.ts
git commit -m "feat(rating): types front niveau (payloads + historique + fourchette)"
```

---

### Task 2: `LevelChip` + helpers purs `lib/levelMatch.ts`

**Files:**
- Create: `frontend/components/player/LevelChip.tsx`
- Create: `frontend/lib/levelMatch.ts`
- Test: `frontend/__tests__/levelMatch.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// frontend/__tests__/levelMatch.test.ts
import { inRange, rangeLabel, levelDistance } from '@/lib/levelMatch';

describe('inRange', () => {
  it('null fourchette → toujours dans la zone', () => expect(inRange(4, null, null)).toBe(true));
  it('dans la fourchette', () => expect(inRange(4, 3, 5)).toBe(true));
  it('sous la fourchette', () => expect(inRange(2, 3, 5)).toBe(false));
  it('au-dessus', () => expect(inRange(6, 3, 5)).toBe(false));
  it('niveau inconnu (null) → considéré dans la zone', () => expect(inRange(null, 3, 5)).toBe(true));
});

describe('rangeLabel', () => {
  it('fourchette complète', () => expect(rangeLabel(3, 5)).toBe('Niveau 3 à 5'));
  it('min seul', () => expect(rangeLabel(3, null)).toBe('Niveau 3 et +'));
  it('max seul', () => expect(rangeLabel(null, 5)).toBe("Niveau 5 et -"));
  it('aucune', () => expect(rangeLabel(null, null)).toBe('Tous niveaux'));
});

describe('levelDistance', () => {
  it('distance absolue', () => expect(levelDistance(4, 4.5)).toBeCloseTo(0.5));
  it('niveau inconnu → Infinity (trié en dernier)', () => expect(levelDistance(null, 4)).toBe(Infinity));
});
```

- [ ] **Step 2: Run, verify FAIL** : `cd C:\dev\palova-wt-niveau\frontend && npx jest __tests__/levelMatch.test.ts`

- [ ] **Step 3: Implementation**
```ts
// frontend/lib/levelMatch.ts
// Helpers purs pour le matchmaking par niveau (fourchette des parties ouvertes).

export function inRange(level: number | null, min: number | null, max: number | null): boolean {
  if (level == null) return true; // niveau inconnu : ne bloque pas
  if (min != null && level < min) return false;
  if (max != null && level > max) return false;
  return true;
}

export function rangeLabel(min: number | null, max: number | null): string {
  if (min != null && max != null) return `Niveau ${min} à ${max}`;
  if (min != null) return `Niveau ${min} et +`;
  if (max != null) return `Niveau ${max} et -`;
  return 'Tous niveaux';
}

/** Distance d'un niveau à une cible (pour trier « à mon niveau »). Niveau inconnu = Infinity. */
export function levelDistance(level: number | null, target: number | null): number {
  if (level == null || target == null) return Infinity;
  return Math.abs(level - target);
}
```

```tsx
// frontend/components/player/LevelChip.tsx
'use client';
import { UserLevel } from '@/lib/api';

// Pastille niveau compacte : « 4.2 » + point orange si provisoire. null → rien.
export function LevelChip({ level, size = 'sm' }: { level: UserLevel | null | undefined; size?: 'xs' | 'sm' }) {
  if (!level) return null;
  const pad = size === 'xs' ? '1px 5px' : '2px 7px';
  const fs = size === 'xs' ? 10 : 11;
  return (
    <span title={level.tier + (level.isProvisional ? ' · en calibrage' : '')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, borderRadius: 999, padding: pad, fontSize: fs, fontWeight: 700, background: 'rgba(0,0,0,0.08)', lineHeight: 1.2 }}>
      {level.level.toFixed(1)}
      {level.isProvisional && <span style={{ width: 5, height: 5, borderRadius: 999, background: '#ffb020' }} />}
    </span>
  );
}
```

- [ ] **Step 4: Run, verify PASS** (+ `npx tsc --noEmit`).

- [ ] **Step 5: Commit**
```bash
cd C:\dev\palova-wt-niveau
git add frontend/components/player/LevelChip.tsx frontend/lib/levelMatch.ts frontend/__tests__/levelMatch.test.ts
git commit -m "feat(rating): LevelChip + helpers purs matchmaking (fourchette/proximité)"
```

---

### Task 3: Niveau sur `PlayerPills` (pastilles partout)

**Files:**
- Modify: `frontend/components/player/PlayerPills.tsx`
- Test: `frontend/__tests__/PlayerPills.test.tsx` (créer si absent, sinon étendre)

- [ ] **Step 1: Add `level` à `PlayerPillData`** : `level?: UserLevel | null;` (importer `UserLevel`).
- [ ] **Step 2: Rendu** : à côté du nom de chaque pastille, rendre `<LevelChip level={p.level} size="xs" />` (s'affiche seulement si `level` non nul).
- [ ] **Step 3: Test** : rendre `PlayerPills` avec un joueur ayant `level: {level:4.2,tier:'Intermédiaire',isProvisional:false}` → « 4.2 » visible ; un joueur sans level → pas de chip. (Wrapper `ThemeProvider`.)
- [ ] **Step 4: Verify** : `npx jest __tests__/PlayerPills.test.tsx && npx tsc --noEmit` + suite complète `npx jest` (corriger d'éventuels mocks). 
- [ ] **Step 5: Commit**
```bash
cd C:\dev\palova-wt-niveau
git add frontend/components/player/PlayerPills.tsx frontend/__tests__/PlayerPills.test.tsx
git commit -m "feat(rating): pastille niveau sur PlayerPills"
```

> Comme `PlayerPills` est consommé par OpenMatches, DayPanel, MyAgendaListItem, etc., il faut que les **données `level`** arrivent jusqu'à ses `players`. Pour les sources déjà enrichies par Lot 3a (`/me/reservations` participants, open matches players), passer `level` dans le mapping `PlayerPillData`. Faire ce câblage dans les Tasks 4 (open matches) et 6 (réservations) ; ici on ne fait que le composant + sa prop.

---

### Task 4: Parties ouvertes — niveaux, fourchette, filtre « à mon niveau », avertissement

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx`

- [ ] **Step 1: Lire** `OpenMatches.tsx` : comment il rend chaque carte de partie (joueurs, bouton Rejoindre), et où il a le niveau du **joueur courant** (sinon le charger via `api.getMyRating(token)` une fois).
- [ ] **Step 2: Niveau des joueurs** : passer `level: p.level` dans les `PlayerPillData` (ou afficher `<LevelChip>` à côté de chaque joueur) sur chaque carte.
- [ ] **Step 3: Fourchette cible** : afficher un badge `rangeLabel(m.targetLevelMin, m.targetLevelMax)` sur la carte (discret).
- [ ] **Step 4: Filtre « à mon niveau »** : un toggle en tête de liste ; quand actif, ne montrer que les parties où `inRange(myLevel, m.targetLevelMin, m.targetLevelMax)` (ou sans fourchette). Trier optionnellement par `levelDistance` de la cible (milieu de fourchette) à `myLevel`.
- [ ] **Step 5: Avertissement à l'inscription** : si le joueur clique « Rejoindre » sur une partie où `!inRange(myLevel, min, max)`, afficher une **confirmation non bloquante** (« Cette partie est hors de ta fourchette de niveau. Rejoindre quand même ? ») avant d'appeler `joinOpenMatch`. (Réutiliser un ConfirmDialog existant si présent ; sinon une confirm inline.)
- [ ] **Step 6: Verify** : `npx tsc --noEmit && npx jest __tests__/` (corriger les mocks `getMyRating` si besoin).
- [ ] **Step 7: Commit**
```bash
cd C:\dev\palova-wt-niveau
git add frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/
git commit -m "feat(rating): parties ouvertes — niveaux, fourchette, filtre à mon niveau, avertissement"
```

---

### Task 5: Création d'une partie ouverte — saisie de la fourchette

**Files:**
- Modify: `frontend/components/BookingModal.tsx` (le flux « partie ouverte »)

- [ ] **Step 1: Lire** `BookingModal.tsx` : trouver l'option « partie ouverte » (visibility PUBLIC) et l'appel à `api.hold…`.
- [ ] **Step 2: UI** : quand « partie ouverte » est coché, afficher deux petits sélecteurs optionnels **Niveau min / Niveau max** (0–8, pas 0,5 ou entier). Passer `targetLevelMin/targetLevelMax` (ou null) au body de `hold`.
- [ ] **Step 3: Verify** : `npx tsc --noEmit && npx jest __tests__/` (mocks).
- [ ] **Step 4: Commit**
```bash
cd C:\dev\palova-wt-niveau
git add frontend/components/BookingModal.tsx frontend/__tests__/
git commit -m "feat(rating): fourchette de niveau à la création d'une partie ouverte"
```

---

### Task 6: Niveau dans l'annuaire/partenaire + Mes réservations + tournois/events

**Files:**
- Modify: les composants d'affichage des inscrits/partenaires (partner picker de `BookingModal`, `components/event/ParticipantsGrid.tsx`, `components/tournament/TeamsGrid.tsx`, et les rendus `PlayerPills` de « Mes réservations »)

- [ ] **Step 1: Partner picker / annuaire** : là où la recherche de membres affiche les résultats (BookingModal partner selector et/ou page annuaire), afficher `<LevelChip level={m.level} />` à côté du nom.
- [ ] **Step 2: Mes réservations** : dans le mapping des `participants` vers `PlayerPillData` (page `/me/reservations`, DayPanel, MyAgendaListItem), passer `level: p.level`.
- [ ] **Step 3: Tournois/events** : dans `TeamsGrid` (binômes : afficher `captainLevel`/`partnerLevel`) et `ParticipantsGrid` (events : `level`), afficher `<LevelChip>`.
- [ ] **Step 4: Verify** : `npx tsc --noEmit && npx jest __tests__/` (corriger mocks).
- [ ] **Step 5: Commit**
```bash
cd C:\dev\palova-wt-niveau
git add frontend/components frontend/app frontend/__tests__
git commit -m "feat(rating): niveau dans annuaire, Mes réservations, tournois/events"
```

---

### Task 7: Courbe de progression sur le profil

**Files:**
- Create: `frontend/components/player/LevelHistoryChart.tsx`
- Modify: `frontend/app/me/profile/page.tsx`
- Test: `frontend/__tests__/LevelHistoryChart.test.tsx`

- [ ] **Step 1: Failing test** : rendre `LevelHistoryChart` avec 3 points → un `<svg>` est présent et le nombre de segments/points correspond ; avec 0 point → message « Pas encore d'historique ».
```tsx
// frontend/__tests__/LevelHistoryChart.test.tsx
import { render, screen } from '@testing-library/react';
import { LevelHistoryChart } from '@/components/player/LevelHistoryChart';

it('rend une courbe avec des points', () => {
  const { container } = render(<LevelHistoryChart points={[
    { playedAt: '2026-06-01T00:00:00Z', level: 3 },
    { playedAt: '2026-06-05T00:00:00Z', level: 3.6 },
    { playedAt: '2026-06-10T00:00:00Z', level: 4 },
  ]} />);
  expect(container.querySelector('svg')).toBeTruthy();
  expect(container.querySelectorAll('circle').length).toBe(3);
});

it('état vide', () => {
  render(<LevelHistoryChart points={[]} />);
  expect(screen.getByText(/Pas encore d.historique/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implementation** (SVG pur, échelle 0–8 en Y) :
```tsx
// frontend/components/player/LevelHistoryChart.tsx
'use client';
import { RatingPoint } from '@/lib/api';

export function LevelHistoryChart({ points }: { points: RatingPoint[] }) {
  if (!points.length) return <p style={{ fontSize: 13, opacity: 0.6 }}>Pas encore d’historique — joue des matchs pour voir ta progression.</p>;
  const W = 280, H = 90, pad = 6;
  const n = points.length;
  const x = (i: number) => n === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (lvl: number) => H - pad - (Math.max(0, Math.min(8, lvl)) / 8) * (H - 2 * pad);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.level).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Courbe de progression du niveau">
      <path d={d} fill="none" stroke="#2563eb" strokeWidth="2" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.level)} r="3" fill="#2563eb" />)}
    </svg>
  );
}
```

- [ ] **Step 4: Brancher dans `/me/profile`** : charger `api.getRatingHistory(token)` (état `history`), et sous la carte « Mon niveau padel », rendre `<LevelHistoryChart points={history} />` quand le joueur a un niveau calibré. (Ajouter `getRatingHistory: jest.fn().mockResolvedValue([])` au mock api du test `MeProfile` si présent.)

- [ ] **Step 5: Run, verify PASS** (+ tsc + suite).

- [ ] **Step 6: Commit**
```bash
cd C:\dev\palova-wt-niveau
git add frontend/components/player/LevelHistoryChart.tsx frontend/app/me/profile/page.tsx frontend/__tests__/LevelHistoryChart.test.tsx frontend/__tests__/MeProfile.test.tsx
git commit -m "feat(rating): courbe de progression du niveau sur le profil"
```

---

### Task 8: Vérification finale Lot 3b

- [ ] **Step 1: Gate frontend** : `cd C:\dev\palova-wt-niveau\frontend && npx tsc --noEmit && npx jest` → tout vert.
- [ ] **Step 2: Vérif visuelle (optionnel)** : pastilles de niveau visibles sur parties ouvertes / Mes réservations ; filtre « à mon niveau » ; fourchette à la création ; courbe sur le profil.

---

## Notes de périmètre (Lot 3b)
- Affichage + matchmaking parties ouvertes (A+B+C) ; la **reco active D** = Lot 4.
- Tout est tolérant à l'absence de `level` (champ optionnel → `LevelChip` ne rend rien).
- `LevelChip` est la pastille compacte partagée ; `LevelBadge` (Lot 1) reste la version « carte profil ».
