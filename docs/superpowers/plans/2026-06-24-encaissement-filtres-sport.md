# Encaissement — filtres « par sport, à venir » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la barre de filtres de la page Encaissement (`/admin/reservations`) par un modèle léger : sélecteur multi-sport + toggle « À venir / Tout le jour » + toggle « À encaisser » + recherche + jour. Supprimer Statut 5-états, presets de créneau, plage horaire, facette Terrain, facette Moyen.

**Architecture:** Helpers purs dans `lib/collect.ts` (ajout de `isUpcoming`). `ReservationFilters.tsx` réécrit avec une UI légère réutilisant `components/reserve/SportPicker.tsx`. `reservations/page.tsx` : état de filtre simplifié (`sportSel`, `upcoming`, `dueOnly`), sport résolu par terrain via `resources`, persistance localStorage des sports par club.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Jest + React Testing Library. Pré-requis : **OneDrive coupé** (sinon les edits sont révertis).

**Spec :** `docs/superpowers/specs/2026-06-24-encaissement-filtres-sport-design.md`

---

## File Structure

- `frontend/lib/collect.ts` — **modifier** : ajouter `isUpcoming`. Garder `matchesQuery`. Laisser `statusFilter`/`presetWindow`/`hasAnyMethod` en place (encore testés par `collect.test.ts`) mais ils ne seront plus utilisés par la page.
- `frontend/components/admin/ReservationFilters.tsx` — **réécrire** : nouvelle interface + UI légère, réutilise `SportPicker`.
- `frontend/app/admin/reservations/page.tsx` — **modifier** : état de filtre, prédicats, dérivation des sports présents, persistance, rendu de `<ReservationFilters>`.
- `frontend/__tests__/collect.test.ts` — **modifier** : tests de `isUpcoming`.
- `frontend/__tests__/AdminReservations.test.tsx` — **modifier** : supprimer les tests des anciens filtres, ajouter ceux des nouveaux.

Aucun changement backend.

---

## Task 1 : helper `isUpcoming` (lib/collect.ts)

**Files:**
- Modify: `frontend/lib/collect.ts`
- Test: `frontend/__tests__/collect.test.ts`

- [ ] **Step 1: Write the failing test**

Ajouter dans `frontend/__tests__/collect.test.ts` (après les imports existants, étendre l'import depuis `@/lib/collect` pour inclure `isUpcoming`) :

```ts
import { isUpcoming } from '@/lib/collect';

describe('isUpcoming', () => {
  const NOW = Date.parse('2026-06-24T16:00:00.000Z');
  it('garde un créneau dont la fin est dans le futur', () => {
    expect(isUpcoming({ endTime: '2026-06-24T17:00:00.000Z' }, NOW)).toBe(true);
  });
  it('garde un créneau EN COURS (commencé mais pas fini)', () => {
    expect(isUpcoming({ endTime: '2026-06-24T16:30:00.000Z' }, NOW)).toBe(true);
  });
  it('masque un créneau déjà terminé', () => {
    expect(isUpcoming({ endTime: '2026-06-24T15:00:00.000Z' }, NOW)).toBe(false);
  });
  it('garde tout quand l\'heure courante est inconnue (null)', () => {
    expect(isUpcoming({ endTime: '2020-01-01T00:00:00.000Z' }, null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest __tests__/collect.test.ts -t isUpcoming`
Expected: FAIL — `isUpcoming is not a function` / pas exporté.

- [ ] **Step 3: Write minimal implementation**

Ajouter dans `frontend/lib/collect.ts` (à la fin du fichier) :

```ts
/**
 * Le créneau est-il « à venir » ? = sa fin n'est pas encore passée (l'en-cours
 * reste visible — on peut encore encaisser). `nowMs = null` (heure courante pas
 * encore connue côté client) → tout passe (pas de masquage avant hydratation).
 */
export function isUpcoming(rv: { endTime: string }, nowMs: number | null): boolean {
  if (nowMs === null) return true;
  return new Date(rv.endTime).getTime() >= nowMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest __tests__/collect.test.ts`
Expected: PASS (tous les tests collect, anciens + `isUpcoming`).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/collect.ts frontend/__tests__/collect.test.ts
git commit -m "feat(encaissement): helper isUpcoming (garde l'en-cours, masque le terminé)"
```

---

## Task 2 : nouvelle UI `ReservationFilters.tsx`

**Files:**
- Rewrite: `frontend/components/admin/ReservationFilters.tsx`

Pas de test unitaire dédié (couvert par `AdminReservations.test.tsx` en Task 4). On réécrit le composant ; il compilera et sera branché en Task 3.

- [ ] **Step 1: Réécrire le fichier en entier**

Remplacer TOUT le contenu de `frontend/components/admin/ReservationFilters.tsx` par :

```tsx
'use client';
import { CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { DateField } from '@/components/ui/DateField';
import { SportPicker } from '@/components/reserve/SportPicker';

export interface SportFacet { key: string; name: string }

export interface ReservationFiltersProps {
  query: string; onQuery: (q: string) => void;
  date: string; onDate: (d: string) => void; onClearDate: () => void;
  /** Sports présents le jour donné ; le sélecteur n'est rendu que si length > 1. */
  sports: SportFacet[];
  selectedSports: Set<string>; onSports: (keys: string[]) => void;
  upcoming: boolean; onUpcoming: (v: boolean) => void;
  dueOnly: boolean; onDueOnly: (v: boolean) => void;
  /** Nombre de filtres non par défaut (pour « Réinitialiser »). */
  activeCount: number; onReset: () => void;
}

/**
 * Barre de filtres de la page Encaissement, allégée : sport (multi, si >1),
 * « À venir / Tout le jour », « À encaisser », recherche et jour. Présentationnel :
 * tout l'état vit dans la page.
 */
export function ReservationFilters(p: ReservationFiltersProps) {
  const { th } = useTheme();

  const segBtn = (on: boolean): CSSProperties => ({
    padding: '6px 13px', border: 'none', background: on ? th.accent : 'transparent',
    color: on ? th.onAccent : th.text, cursor: 'pointer', fontFamily: th.fontUI,
    fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>

      {/* ── Ligne 1 : sports (si multi) + recherche ──────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {p.sports.length > 1 && (
          <SportPicker
            sports={p.sports.map((s) => ({ id: s.key, name: s.name }))}
            selectedIds={[...p.selectedSports]}
            onChange={p.onSports}
          />
        )}
        <input value={p.query} onChange={(e) => p.onQuery(e.target.value)} placeholder="🔍 Rechercher un client…"
          style={{ flex: '0 1 220px', minWidth: 140, border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 9, padding: '7px 11px', fontFamily: th.fontUI, fontSize: 13.5 }} />
      </div>

      {/* ── Ligne 2 : à venir | tout · à encaisser · jour · réinitialiser ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div role="radiogroup" aria-label="Période" style={{ display: 'inline-flex', border: `1px solid ${th.line}`, borderRadius: 999, overflow: 'hidden', background: th.surface }}>
          <button type="button" role="radio" aria-checked={p.upcoming} onClick={() => p.onUpcoming(true)} style={segBtn(p.upcoming)}>À venir</button>
          <button type="button" role="radio" aria-checked={!p.upcoming} onClick={() => p.onUpcoming(false)} style={{ ...segBtn(!p.upcoming), borderLeft: `1px solid ${th.line}` }}>Tout le jour</button>
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
          <input type="checkbox" checked={p.dueOnly} onChange={(e) => p.onDueOnly(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: th.accent, cursor: 'pointer' }} />
          À encaisser
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
          Jour <DateField value={p.date} onChange={p.onDate} size="sm" />
        </label>
        {p.date && <button type="button" onClick={p.onClearDate} style={{ border: 'none', background: 'none', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, padding: 0 }}>Tout afficher</button>}

        {p.activeCount > 0 && (
          <button type="button" onClick={p.onReset}
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
            ⟲ Réinitialiser ({p.activeCount})
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check (sera complété en Task 3)**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -i reservationfilters`
Expected : pas d'erreur DANS ce fichier (les erreurs « page.tsx ne passe pas les bonnes props » sont attendues jusqu'à Task 3).

(Pas de commit ici — on commite avec Task 3 qui rend le tout cohérent.)

---

## Task 3 : brancher la page `reservations/page.tsx`

**Files:**
- Modify: `frontend/app/admin/reservations/page.tsx`

- [ ] **Step 1: Imports — retirer les helpers de filtre inutilisés, garder `matchesQuery`, ajouter `isUpcoming` + `SportFacet`**

Remplacer la ligne d'import de `@/lib/collect` :

```ts
import { overlapsHourWindow, statusFilter, matchesQuery, presetWindow, hasAnyMethod, StatusMode, TimePreset } from '@/lib/collect';
```
par :
```ts
import { matchesQuery, isUpcoming } from '@/lib/collect';
```

Et l'import du composant (les props changent, l'import reste) :
```ts
import { ReservationFilters, SportFacet } from '@/components/admin/ReservationFilters';
```

- [ ] **Step 2: État — remplacer l'ancien état de filtre**

Supprimer ces déclarations :
```ts
const [status, setStatus] = useState<StatusMode>('all');
const [courtSel, setCourtSel] = useState<Set<string>>(new Set());
const [preset, setPreset] = useState<TimePreset | null>(null);
const [showCustom, setShowCustom] = useState(false);
const [fromHour, setFrom] = useState<number | null>(null);
const [toHour, setTo]     = useState<number | null>(null);
const [methodSel, setMethodSel] = useState<Set<PaymentMethod>>(new Set());
const [nowH, setNowH]     = useState<number | null>(null);
```
Les remplacer par :
```ts
const [sportSel, setSportSel] = useState<Set<string> | null>(null);   // sports cochés (null = pas encore résolu)
const [upcoming, setUpcoming] = useState(true);                       // « À venir » par défaut
const [dueOnly, setDueOnly]   = useState(false);                      // « À encaisser » par défaut off
const [nowMs, setNowMs]       = useState<number | null>(null);        // heure courante (posée côté client)
```

- [ ] **Step 3: Effet horloge — remplacer l'effet `nowH` par `nowMs`**

Remplacer :
```ts
useEffect(() => {
  setNowH(Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(new Date())));
}, [tz]);
```
par :
```ts
// Heure courante (timestamp absolu) — posée côté client uniquement (pas au rendu : hydratation).
useEffect(() => { setNowMs(Date.now()); }, []);
```

- [ ] **Step 4: Sports présents + résolution/persistance de la sélection**

Juste après la dérivation de `resources` / avant le bloc des prédicats, ajouter :

```ts
// Sports distincts présents parmi les terrains (ordre des terrains), pour le sélecteur.
const sportsPresent: SportFacet[] = (() => {
  const seen = new Map<string, string>();
  for (const r of resources) if (!seen.has(r.clubSport.sport.key)) seen.set(r.clubSport.sport.key, r.clubSport.sport.name);
  return [...seen].map(([key, name]) => ({ key, name }));
})();
const sportByResource = new Map(resources.map((r) => [r.id, r.clubSport.sport.key]));
const sportStorageKey = clubId ? `palova:encaissement-sports:${clubId}` : null;

// Résout la sélection de sports une fois les terrains chargés : localStorage (ids périmés
// filtrés) → sinon TOUS les sports présents.
useEffect(() => {
  if (sportSel !== null || sportsPresent.length === 0) return;
  const present = new Set(sportsPresent.map((s) => s.key));
  let initial: string[] = sportsPresent.map((s) => s.key);
  if (sportStorageKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(sportStorageKey) ?? 'null');
      if (Array.isArray(saved)) {
        const kept = saved.filter((k: unknown): k is string => typeof k === 'string' && present.has(k));
        if (kept.length > 0) initial = kept;
      }
    } catch { /* ignore */ }
  }
  setSportSel(new Set(initial));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [sportsPresent.length, sportStorageKey]);

const changeSports = (keys: string[]) => {
  const next = new Set(keys);
  setSportSel(next);
  if (sportStorageKey) { try { localStorage.setItem(sportStorageKey, JSON.stringify(keys)); } catch { /* ignore */ } }
};
```

- [ ] **Step 5: Prédicats — remplacer le bloc de filtrage**

Supprimer l'ancien bloc des prédicats / facettes (de `const dayResas = ...` jusqu'à `const resetFilters = ...` inclus : `passSearch/passCourt/passTime/passMethod/passStatus`, `visible`, `STATUS_MODES`, `statusCounts`, `courtFacets`, `METHOD_ORDER`, `methodsUsed`, `activeCount`, `toggleCourt`, `toggleMethod`, `applyPreset`, `setCustomHour`, `resetFilters`, et la ligne `slotStart`).

Le remplacer par :

```ts
const dayResas = data?.reservations ?? [];
const multiSport = sportsPresent.length > 1;
const sel = sportSel ?? new Set(sportsPresent.map((s) => s.key));

const passSearch  = (r: ClubReservation) => matchesQuery(r, query);
const passSport   = (r: ClubReservation) => !multiSport || sel.has(sportByResource.get(r.resourceId) ?? '');
const passWindow  = (r: ClubReservation) => !upcoming || isUpcoming(r, nowMs);
const passDue     = (r: ClubReservation) => !dueOnly || isCollectable(r);
// Les annulées restent masquées (sauf demande explicite — non couverte ici).
const passActive  = (r: ClubReservation) => r.status !== 'CANCELLED';

const visible = dayResas.filter((r) => passActive(r) && passSearch(r) && passSport(r) && passWindow(r) && passDue(r));

const activeCount =
  (dueOnly ? 1 : 0) +
  (!upcoming ? 1 : 0) +
  (query.trim() ? 1 : 0) +
  (multiSport && sel.size !== sportsPresent.length ? 1 : 0);

const resetFilters = () => {
  setDueOnly(false);
  setUpcoming(true);
  setQuery('');
  changeSports(sportsPresent.map((s) => s.key));   // tous cochés + persiste
};
```

> Note : `isCollectable` et `dueOf`/`remainingOf` existent déjà dans la page (inchangés). `passActive` remplace l'ancien masquage des annulées qui passait par `statusFilter`.

- [ ] **Step 6: Rendu — remplacer le JSX `filtersEl`**

Remplacer l'ancien bloc `const filtersEl = ( <ReservationFilters ... /> )` par :

```tsx
const filtersEl = (
  <ReservationFilters
    query={query} onQuery={setQuery}
    date={date} onDate={setDate} onClearDate={() => setDate('')}
    sports={sportsPresent}
    selectedSports={sel} onSports={changeSports}
    upcoming={upcoming} onUpcoming={setUpcoming}
    dueOnly={dueOnly} onDueOnly={setDueOnly}
    activeCount={activeCount} onReset={resetFilters}
  />
);
```

- [ ] **Step 7: Type-check + suite (cassée tant que les tests ne sont pas mis à jour)**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: aucune erreur de type. (Les tests `AdminReservations.test.tsx` cassent ici — c'est attendu, corrigé en Task 4.)

(Pas de commit — Task 4 finit le tout vert.)

---

## Task 4 : mettre à jour les tests `AdminReservations.test.tsx`

**Files:**
- Modify: `frontend/__tests__/AdminReservations.test.tsx`

- [ ] **Step 1: Supprimer les tests des anciens filtres**

Supprimer entièrement ces `it(...)` (devenus sans objet) :
- `'filtre « Non payé » et solde le reste en 1 clic (« Tout solder », CB)'`
- `'filtre « Soldé » masque les réservations encore à encaisser'`
- `'filtre par terrain : cocher un terrain masque les réservations des autres'`
- `'filtre par plage horaire (De/à) masque les créneaux hors plage'`
- `'« Réinitialiser » remet les filtres à zéro'` (remplacé plus bas)
- `'« Maintenant » active un filtre de créneau'`

- [ ] **Step 2: Corriger le test latest-wins (référence au rail Statut supprimée)**

Dans le test `'encaissements concurrents : une réponse périmée ne réécrase pas l’état (latest-wins)'`, remplacer le commentaire + l'assertion scopée :

```ts
  // La réponse périmée ne doit pas refaire « réapparaître » le reste à encaisser.
  const list = screen.getByTestId('resa-list');
  await waitFor(() => expect(within(list).getAllByText('Soldé')).toHaveLength(2));
```
par (le rail Statut n'existe plus → plus besoin de scoper, mais on garde `within(list)` qui reste valide) :
```ts
  // La réponse périmée ne doit pas refaire « réapparaître » le reste à encaisser.
  const list = screen.getByTestId('resa-list');
  await waitFor(() => expect(within(list).getAllByText('Soldé')).toHaveLength(2));
```
(inchangé : on vérifie juste qu'il passe encore après suppression du rail. Si le compte diffère à l'exécution, ajuster le nombre attendu en fonction du rendu réel de la liste.)

- [ ] **Step 3: Ajouter les nouveaux tests de filtres**

Ajouter (sous le marqueur `// ── Filtres ──`) :

```ts
// Helper : deux terrains de sports différents (Padel C1, Tennis C2).
const tennisCourt = (id: string, name: string) => ({ ...mkCourt(id, name),
  clubSport: { id: 'cs-tennis', slotStepMin: null, durationsMin: [60], sport: { key: 'tennis', name: 'Tennis', resourceNoun: 'Court', defaultSlotStepMin: 30, defaultDurationsMin: [60], surfaces: [], hasLighting: false } } });

it('filtre par sport : décocher un sport masque ses terrains', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1'), tennisCourt('court-2', 'C2')]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([
    mkResa('rv-a', 'court-1', 'C1', { title: 'Match PADEL' }),
    mkResa('rv-b', 'court-2', 'C2', { title: 'Match TENNIS' }),
  ]));
  renderPage();
  await screen.findByText('Match PADEL');
  expect(screen.getByText('Match TENNIS')).toBeInTheDocument();
  // ouvre le sélecteur de sport (lien « … · changer ») puis décoche Tennis
  fireEvent.click(screen.getByRole('button', { name: /changer/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Tennis' }));
  await waitFor(() => expect(screen.queryByText('Match TENNIS')).not.toBeInTheDocument());
  expect(screen.getByText('Match PADEL')).toBeInTheDocument();
});

it('club mono-sport : pas de sélecteur de sport', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1')]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([mkResa('rv-1', 'court-1', 'C1')]));
  renderPage();
  await screen.findByText('C1');
  expect(screen.queryByRole('button', { name: /changer/ })).toBeNull();
});

it('« À encaisser » masque les réservations soldées', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1')]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([
    mkResa('rv-paid', 'court-1', 'C1', { title: 'Soldée', paidAmount: '52.00' }),
    mkResa('rv-due',  'court-1', 'C1', { title: 'À régler', startTime: '2026-06-22T17:00:00.000Z', endTime: '2026-06-22T18:00:00.000Z' }),
  ]));
  renderPage();
  await screen.findByText('À régler');
  expect(screen.getByText('Soldée')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /À encaisser/ }));
  await waitFor(() => expect(screen.queryByText('Soldée')).not.toBeInTheDocument());
  expect(screen.getByText('À régler')).toBeInTheDocument();
});

it('« À venir » masque un créneau terminé ; « Tout le jour » le réaffiche', async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([mkCourt('court-1', 'C1')]);
  // un créneau bien dans le passé (2020) → terminé quel que soit « now »
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([
    mkResa('rv-past', 'court-1', 'C1', { title: 'Passée', startTime: '2020-01-01T08:00:00.000Z', endTime: '2020-01-01T09:00:00.000Z' }),
  ]));
  renderPage();
  // par défaut « À venir » : la réservation passée est masquée (une fois nowMs posé)
  await waitFor(() => expect(screen.queryByText('Passée')).toBeNull());
  fireEvent.click(screen.getByRole('radio', { name: 'Tout le jour' }));
  expect(await screen.findByText('Passée')).toBeInTheDocument();
});
```

> Note : `mkResa` met par défaut `startTime/endTime` à 16h/17h le 2026-06-22 (passé par rapport à « aujourd'hui » réel) — les tests qui doivent voir une résa **sans** dépendre de l'horloge basculent sur « Tout le jour » ou utilisent un titre recherché après que l'UI soit stable. Pour les tests existants **non liés au temps** (KPI, encaissement, annulation, latest-wins), si « À venir » masque les résas (16h passées), ils doivent d'abord cliquer **« Tout le jour »** OU on neutralise le défaut. Voir Step 4.

- [ ] **Step 4: Neutraliser le défaut « À venir » pour les tests non temporels**

Beaucoup de tests existants (encaissement, KPI, annulation, who-paid, latest-wins, optimiste…) utilisent `mkResa(... 16h)` daté du 2026-06-22, donc **terminé** vs l'horloge réelle → masqué par « À venir ». Pour ne pas réécrire chacun, ajouter un helper qui bascule sur « Tout le jour » juste après le rendu, et l'appeler dans ces tests :

Ajouter près des helpers (après `renderPage`) :
```ts
// Bascule la page sur « Tout le jour » (les fixtures sont datées dans le passé).
const showAllDay = async () => {
  const btn = await screen.findByRole('radio', { name: 'Tout le jour' });
  fireEvent.click(btn);
};
```
Puis, dans chaque test qui affiche une fixture datée et NON lié au « À venir » (tous sauf « club mono-sport », « filtre par sport », « À encaisser », « À venir/Tout »), insérer `await showAllDay();` **avant** la première assertion sur le contenu de la liste (juste après `renderPage()` / le premier `await screen.find...` qui attend `'C1'`/un titre).

> Exécution : faire tourner la suite, et pour chaque test rouge « élément introuvable », ajouter `await showAllDay();` au bon endroit. C'est mécanique.

- [ ] **Step 5: Run la suite ciblée**

Run: `cd frontend && npx jest __tests__/AdminReservations.test.tsx`
Expected: PASS (tous les tests, anciens conservés + nouveaux).

- [ ] **Step 6: Type-check global + commit**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: aucune erreur.

```bash
git add frontend/components/admin/ReservationFilters.tsx frontend/app/admin/reservations/page.tsx frontend/__tests__/AdminReservations.test.tsx
git commit -m "feat(encaissement): filtres simplifiés par sport + à venir / à encaisser"
```

---

## Task 5 : vérification finale

- [ ] **Step 1: Suite frontend complète (in-band pour éviter la flakiness BookingModal sous charge)**

Run: `cd frontend && npx jest --runInBand`
Expected: tout vert.

- [ ] **Step 2: Type-check final**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

---

## Self-Review (rempli)

- **Couverture spec :** sport multi (Task 2/3 + test), À venir/Tout (helper Task 1 + test Task 4), À encaisser (Task 3 + test), suppression Terrain/Moyen/presets/Statut (Task 3 retire l'état + Task 4 retire les tests), défaut tous cochés + persistance (Task 3 + à vérifier en test), mono-sport masque le sélecteur (test Task 4). ✓
- **Placeholders :** le seul point « mécanique » est l'ajout de `await showAllDay()` aux tests datés (Step 4) — instruction explicite, pas un TODO de code. ✓
- **Cohérence des noms :** `isUpcoming`, `sportSel`/`sel`, `sportsPresent`, `sportByResource`, `changeSports`, `ReservationFiltersProps` (sports/selectedSports/onSports/upcoming/onUpcoming/dueOnly/onDueOnly) — alignés entre Task 2 et Task 3. ✓
- **Rappel exécution :** OneDrive coupé impérativement avant d'éditer le code.
