# Filtre « Prochain créneau » (Encaissement) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un 3ᵉ mode de période « Prochain créneau » à la page Encaissement (`/admin/reservations`) qui resserre la liste sur le prochain départ réel du jour, avec une marge de 20 min en arrière pour les joueurs en retard.

**Architecture:** Deux helpers purs testables dans `frontend/lib/collect.ts` (`nextSlotWindow`, `isNextSlot`) ; l'état de période de la page passe de `boolean upcoming` à `PeriodMode = 'next' | 'upcoming' | 'all'` ; le sélecteur de `ReservationFilters.tsx` passe de 2 à 3 radios. Aucun changement backend, aucune migration.

**Tech Stack:** Next.js 16 (React 19, client component), TypeScript, Jest 30 + React Testing Library. Tests lancés depuis `frontend/`.

---

## Contexte (à lire avant de commencer)

- La page `frontend/app/admin/reservations/page.tsx` est un client component. La période courante est `const [upcoming, setUpcoming] = useState(true)` (ligne ~73). L'heure courante est posée côté client : `const [nowMs, setNowMs] = useState<number | null>(null)` puis `useEffect(() => { setNowMs(Date.now()); }, [])` — **jamais** `Date.now()` au rendu (hydratation).
- Le prédicat de période actuel : `const passWindow = (r) => !upcoming || isUpcoming(r, nowMs)` (ligne ~216). `isUpcoming` (déjà dans `collect.ts`) = `endTime ≥ now` ; `nowMs === null` → `true` (pas de masquage avant hydratation).
- Le sélecteur de période vit dans `frontend/components/admin/ReservationFilters.tsx` (composant présentationnel, tout l'état est dans la page). C'est un `role="radiogroup"` à 2 `role="radio"` (« À venir » / « Tout le jour »).
- **Seuls** `ReservationFilters.tsx` et `page.tsx` utilisent les props `upcoming`/`onUpcoming` — aucun autre consommateur, aucune suite de test ne cible directement les props du composant.
- Les helpers `presetWindow` / `statusFilter` / `hasAnyMethod` / `overlapsHourWindow` dans `collect.ts` sont dormants (non câblés) — **ne pas y toucher**.
- Lancer un test ciblé : `npx jest <fichier-ou-motif>` depuis `frontend/` (jest 30, exécution unique par défaut, pas de watch).

---

## Task 1: Helpers purs `nextSlotWindow` + `isNextSlot`

**Files:**
- Modify: `frontend/lib/collect.ts` (ajout en fin de fichier, après `isUpcoming`)
- Test: `frontend/__tests__/collect.test.ts` (ajout de blocs `describe`)

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter en bas de `frontend/__tests__/collect.test.ts`, et **mettre à jour la ligne d'import** en tête de fichier pour inclure les deux nouveaux symboles :

Ligne 1 actuelle :
```ts
import { overlapsHourWindow, statusFilter, matchesQuery, presetWindow, hasAnyMethod, isUpcoming } from '@/lib/collect';
```
La remplacer par :
```ts
import { overlapsHourWindow, statusFilter, matchesQuery, presetWindow, hasAnyMethod, isUpcoming, nextSlotWindow, isNextSlot } from '@/lib/collect';
```

Puis ajouter à la fin du fichier :
```ts
describe('nextSlotWindow', () => {
  const NOW = Date.parse('2026-06-24T16:10:00.000Z');   // 16:10 UTC
  const at = (iso: string) => Date.parse(iso);
  it('borne haute = prochain départ ≥ now ; borne basse = now − 20 min', () => {
    const starts = [at('2026-06-24T16:00:00.000Z'), at('2026-06-24T16:30:00.000Z'), at('2026-06-24T17:30:00.000Z')];
    expect(nextSlotWindow(starts, NOW)).toEqual([NOW - 20 * 60_000, at('2026-06-24T16:30:00.000Z')]);
  });
  it('aucun départ futur → borne haute = now', () => {
    expect(nextSlotWindow([at('2026-06-24T15:00:00.000Z')], NOW)).toEqual([NOW - 20 * 60_000, NOW]);
  });
  it('liste vide → [now − 20 min, now]', () => {
    expect(nextSlotWindow([], NOW)).toEqual([NOW - 20 * 60_000, NOW]);
  });
  it('marge paramétrable', () => {
    expect(nextSlotWindow([], NOW, 5)).toEqual([NOW - 5 * 60_000, NOW]);
  });
});

describe('isNextSlot', () => {
  const NOW = Date.parse('2026-06-24T16:10:00.000Z');
  const win: [number, number] = [NOW - 20 * 60_000, Date.parse('2026-06-24T16:30:00.000Z')];
  it('start dans la fenêtre → true (bornes incluses)', () => {
    expect(isNextSlot({ startTime: '2026-06-24T16:00:00.000Z' }, win)).toBe(true);   // retardataire ≤ 20 min
    expect(isNextSlot({ startTime: '2026-06-24T16:30:00.000Z' }, win)).toBe(true);   // prochain départ (borne haute)
    expect(isNextSlot({ startTime: '2026-06-24T15:50:00.000Z' }, win)).toBe(true);   // borne basse exacte
  });
  it('start hors fenêtre → false', () => {
    expect(isNextSlot({ startTime: '2026-06-24T15:40:00.000Z' }, win)).toBe(false);  // > 20 min de retard
    expect(isNextSlot({ startTime: '2026-06-24T17:30:00.000Z' }, win)).toBe(false);  // après le prochain départ
  });
  it('window null → true (pré-hydratation)', () => {
    expect(isNextSlot({ startTime: '2000-01-01T00:00:00.000Z' }, null)).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

Run (depuis `frontend/`) : `npx jest collect.test.ts`
Expected: FAIL — `nextSlotWindow is not a function` / `isNextSlot is not a function` (et erreur de compilation TS à l'import).

- [ ] **Step 3: Implémenter les helpers**

Ajouter à la fin de `frontend/lib/collect.ts` :
```ts
/** Modes du sélecteur de période de la page Encaissement. */
export type PeriodMode = 'next' | 'upcoming' | 'all';

/**
 * Fenêtre « prochain créneau » en ms epoch : [now − graceMin, T].
 * T = plus petit start ≥ now parmi `starts` (le prochain départ réel), sinon now.
 * La borne basse couvre les joueurs en retard (créneau commencé il y a ≤ graceMin).
 */
export function nextSlotWindow(starts: number[], nowMs: number, graceMin = 20): [number, number] {
  const low = nowMs - graceMin * 60_000;
  const future = starts.filter((s) => s >= nowMs);
  const high = future.length ? Math.min(...future) : nowMs;
  return [low, high];
}

/**
 * La réservation démarre-t-elle dans la fenêtre [low, high] (bornes incluses) ?
 * `window === null` (heure courante pas encore connue) → true (pas de masquage avant hydratation).
 */
export function isNextSlot(rv: { startTime: string }, window: [number, number] | null): boolean {
  if (!window) return true;
  const t = new Date(rv.startTime).getTime();
  return t >= window[0] && t <= window[1];
}
```

- [ ] **Step 4: Lancer les tests pour vérifier le succès**

Run (depuis `frontend/`) : `npx jest collect.test.ts`
Expected: PASS (tous les `describe`, dont les anciens, verts).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/collect.ts frontend/__tests__/collect.test.ts
git commit -m "feat(encaissement): helpers nextSlotWindow/isNextSlot (fenêtre prochain créneau)"
```

---

## Task 2: 3ᵉ segment « Prochain créneau » (composant + page)

**Files:**
- Modify: `frontend/components/admin/ReservationFilters.tsx` (props + 3 radios)
- Modify: `frontend/app/admin/reservations/page.tsx` (état `period`, fenêtre, prédicat, activeCount, reset, props)
- Test: `frontend/__tests__/AdminReservations.test.tsx` (nouveau test d'intégration)

- [ ] **Step 1: Écrire le test d'intégration qui échoue**

Ajouter ce test dans `frontend/__tests__/AdminReservations.test.tsx`, juste après le test « « À venir » masque un créneau terminé… » (vers la ligne 230). Il s'appuie sur les helpers existants du fichier (`mkCourt`, `mkResa`, `resp`, `renderPage`, et les mocks `api`) :
```tsx
it('« Prochain créneau » : prochain départ + retardataire ≤ 20 min, masque le reste', async () => {
  const FIXED = Date.parse('2026-06-24T16:10:00.000Z');   // 16:10 → fenêtre [15:50, 16:30]
  const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED);
  try {
    (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1')]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([
      mkResa('rv-late',  'court-1', 'C1', { title: 'RetardEnCours',  startTime: '2026-06-24T16:00:00.000Z', endTime: '2026-06-24T17:00:00.000Z' }),   // commencé il y a 10 min
      mkResa('rv-next',  'court-1', 'C1', { title: 'ProchainDepart', startTime: '2026-06-24T16:30:00.000Z', endTime: '2026-06-24T17:30:00.000Z' }),   // prochain départ (= borne haute)
      mkResa('rv-later', 'court-1', 'C1', { title: 'PlusTard',       startTime: '2026-06-24T17:30:00.000Z', endTime: '2026-06-24T18:30:00.000Z' }),   // après le prochain départ
      mkResa('rv-old',   'court-1', 'C1', { title: 'TropEnRetard',   startTime: '2026-06-24T15:40:00.000Z', endTime: '2026-06-24T16:40:00.000Z' }),   // commencé il y a 30 min
    ]));
    renderPage();
    // Défaut « À venir » : les 4 réservations (toutes en cours ou à venir) sont visibles.
    await screen.findByText('RetardEnCours');
    expect(screen.getByText('PlusTard')).toBeInTheDocument();
    expect(screen.getByText('TropEnRetard')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Prochain créneau' }));

    // Ne restent que le prochain départ et le retardataire ≤ 20 min.
    await waitFor(() => expect(screen.queryByText('PlusTard')).toBeNull());
    expect(screen.queryByText('TropEnRetard')).toBeNull();
    expect(screen.getByText('RetardEnCours')).toBeInTheDocument();
    expect(screen.getByText('ProchainDepart')).toBeInTheDocument();
  } finally {
    nowSpy.mockRestore();
  }
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run (depuis `frontend/`) : `npx jest AdminReservations.test.tsx -t "Prochain créneau"`
Expected: FAIL — `Unable to find role="radio" and name "Prochain créneau"` (le 3ᵉ radio n'existe pas encore).

- [ ] **Step 3: Mettre à jour `ReservationFilters.tsx` (props + 3 radios)**

Dans `frontend/components/admin/ReservationFilters.tsx` :

a) Étendre l'import du composant `SportPicker` (ligne 5) avec le type partagé — ajouter cette ligne d'import juste après :
```tsx
import { PeriodMode } from '@/lib/collect';
```

b) Dans `ReservationFiltersProps`, remplacer :
```tsx
  upcoming: boolean; onUpcoming: (v: boolean) => void;
```
par :
```tsx
  period: PeriodMode; onPeriod: (p: PeriodMode) => void;
```

c) Remplacer le bloc `role="radiogroup"` (lignes ~53-56) :
```tsx
        <div role="radiogroup" aria-label="Période" style={{ display: 'inline-flex', border: `1px solid ${th.line}`, borderRadius: 999, overflow: 'hidden', background: th.surface }}>
          <button type="button" role="radio" aria-checked={p.upcoming} onClick={() => p.onUpcoming(true)} style={segBtn(p.upcoming)}>À venir</button>
          <button type="button" role="radio" aria-checked={!p.upcoming} onClick={() => p.onUpcoming(false)} style={{ ...segBtn(!p.upcoming), borderLeft: `1px solid ${th.line}` }}>Tout le jour</button>
        </div>
```
par :
```tsx
        <div role="radiogroup" aria-label="Période" style={{ display: 'inline-flex', border: `1px solid ${th.line}`, borderRadius: 999, overflow: 'hidden', background: th.surface }}>
          {(([['next', 'Prochain créneau'], ['upcoming', 'À venir'], ['all', 'Tout le jour']]) as [PeriodMode, string][]).map(([mode, label], i) => (
            <button key={mode} type="button" role="radio" aria-checked={p.period === mode} onClick={() => p.onPeriod(mode)}
              style={i === 0 ? segBtn(p.period === mode) : { ...segBtn(p.period === mode), borderLeft: `1px solid ${th.line}` }}>
              {label}
            </button>
          ))}
        </div>
```

- [ ] **Step 4: Mettre à jour `page.tsx` (état, fenêtre, prédicat, activeCount, reset, props)**

Dans `frontend/app/admin/reservations/page.tsx` :

a) Import depuis `collect` (ligne 15) — remplacer :
```tsx
import { matchesQuery, isUpcoming } from '@/lib/collect';
```
par :
```tsx
import { matchesQuery, isUpcoming, nextSlotWindow, isNextSlot, PeriodMode } from '@/lib/collect';
```

b) État de période (ligne ~73) — remplacer :
```tsx
  const [upcoming, setUpcoming] = useState(true);                       // « À venir » par défaut
```
par :
```tsx
  const [period, setPeriod]     = useState<PeriodMode>('upcoming');     // « À venir » par défaut
```

c) Fenêtre + prédicat de période. Dans le bloc « Prédicats de filtrage » (lignes ~209-218), remplacer la ligne :
```tsx
  const passWindow = (r: ClubReservation) => !upcoming || isUpcoming(r, nowMs);
```
par :
```tsx
  // Fenêtre « prochain créneau » : prochain départ réel du jour + marge retard de 20 min.
  const nextWindow = nowMs === null
    ? null
    : nextSlotWindow(dayResas.filter((r) => r.status !== 'CANCELLED').map((r) => new Date(r.startTime).getTime()), nowMs);
  const passWindow = (r: ClubReservation) =>
    period === 'all'  ? true
    : period === 'next' ? isNextSlot(r, nextWindow)
    : isUpcoming(r, nowMs);   // 'upcoming'
```
(`dayResas` est défini juste au-dessus, ligne ~210 : `const dayResas = data?.reservations ?? [];`.)

d) `activeCount` (lignes ~222-226) — remplacer :
```tsx
    (!upcoming ? 1 : 0) +
```
par :
```tsx
    (period !== 'upcoming' ? 1 : 0) +
```

e) `resetFilters` (ligne ~230) — remplacer :
```tsx
    setUpcoming(true);
```
par :
```tsx
    setPeriod('upcoming');
```

f) Props passées à `ReservationFilters` dans `filtersEl` (lignes ~315-323) — remplacer :
```tsx
      upcoming={upcoming} onUpcoming={setUpcoming}
```
par :
```tsx
      period={period} onPeriod={setPeriod}
```

- [ ] **Step 5: Lancer le test ciblé pour vérifier le succès**

Run (depuis `frontend/`) : `npx jest AdminReservations.test.tsx -t "Prochain créneau"`
Expected: PASS.

- [ ] **Step 6: Lancer toute la suite Encaissement + les helpers (non-régression)**

Run (depuis `frontend/`) : `npx jest AdminReservations.test.tsx collect.test.ts`
Expected: PASS (dont l'ancien test radio « « À venir » masque un créneau terminé ; « Tout le jour » le réaffiche » — labels inchangés, défaut toujours « À venir »).

- [ ] **Step 7: Vérifier la compilation TypeScript**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected: aucune erreur (en particulier aucune référence résiduelle à `upcoming`/`onUpcoming`).

- [ ] **Step 8: Commit**

```bash
git add frontend/components/admin/ReservationFilters.tsx frontend/app/admin/reservations/page.tsx frontend/__tests__/AdminReservations.test.tsx
git commit -m "feat(encaissement): filtre « Prochain créneau » (3e segment de période)"
```

---

## Self-review (auteur du plan)

- **Couverture de la spec :** borne basse `now − 20 min` + borne haute « prochain départ » → `nextSlotWindow` (Task 1) ; `nowMs === null` → `null` → tout passe → `isNextSlot`/`nextWindow` (Task 1 + 2c) ; 3ᵉ segment UI + défaut « À venir » → `ReservationFilters` (2c) + état `'upcoming'` (2b) ; fenêtre calculée sur les réservations actives du jour → 2c ; tests purs + intégration → Task 1 step 1 + Task 2 step 1. ✓
- **Placeholders :** aucun — chaque step contient le code complet.
- **Cohérence des types :** `PeriodMode` exporté depuis `collect.ts` (Task 1) et importé tel quel par le composant (2a) et la page (2a). `nextSlotWindow(starts: number[], nowMs, graceMin=20)` et `isNextSlot(rv, window | null)` : signatures identiques entre définition (Task 1) et appels (2c). ✓
- **Hydratation :** la page ne calcule `nextWindow` que si `nowMs !== null` ; `Date.now()` reste confiné à l'effet existant — pas de `new Date()` au rendu introduit. ✓
