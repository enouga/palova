# Réserver — cartes polies + bascule vue grille — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rafraîchir la page Réserver — vue « cartes par terrain » polie (heures alignées, prix creux visible, passés repliés, signal de rareté) par défaut, avec une bascule ☰/⊞ vers une vue « grille » (matrice terrains × heures) mémorisée par club.

**Architecture :** 100 % frontend dans `frontend/`. Les deux vues consomment les mêmes données déjà chargées (`availBySport`) — la bascule est une pure présentation client, aucun fetch. Logique pure isolée dans `lib/reserveView.ts` (testée), deux composants dédiés (`ViewToggle`, `SportGrid`), câblage dans `ClubReserve.tsx`. Aucun backend, aucune migration.

**Tech Stack :** Next.js 16 / React 19, TypeScript, inline styles via `useTheme()` (`th`), Jest + React Testing Library.

**Spec de référence :** `docs/superpowers/specs/2026-07-07-reserver-cartes-polies-vue-grille-design.md`

---

## Rappels d'environnement (mémoire projet)

- **Lancer un test** (cwd = `frontend/`, shims `.bin` cassés → node direct) :
  `node node_modules/jest/bin/jest.js <chemin> --runInBand`
- **Type-check** (jest ne type-check pas) :
  `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
- ⚠️ Les suites `ClubReserve.{deeplink,persport,pastslots,balances}` montent le **vrai** `ClubNav` :
  tout nouvel appel `api.*` non mocké casse leur mock `lib/api`. On n'ajoute AUCUN appel API ici,
  donc rien à faire — mais on relance ces 4 suites en vérification finale.
- Icônes disponibles dans `components/ui/Icon.tsx` : `menu` (☰) et `grid` (⊞) existent déjà.

---

## File Structure

- **Create** `frontend/lib/reserveView.ts` — helpers purs : `ReserveView`, `RESERVE_VIEW_KEY`,
  `splitPastSlots`, `scarcityLabel`, `gridColumns`.
- **Create** `frontend/__tests__/reserveView.test.ts` — tests des helpers purs.
- **Create** `frontend/components/reserve/ViewToggle.tsx` — segmented ☰/⊞.
- **Create** `frontend/__tests__/ViewToggle.test.tsx`.
- **Create** `frontend/components/reserve/SportGrid.tsx` — matrice terrains × heures d'une section sport.
- **Create** `frontend/__tests__/SportGrid.test.tsx`.
- **Modify** `frontend/components/ClubReserve.tsx` — polish des cartes (finitions 1-4), état `view`
  + localStorage (finition 5), rangée toggle, branchement cartes/grille.
- **Modify** `frontend/__tests__/ClubReserve.pastslots.test.tsx` — adapter au repli des passés.
- **Create** `frontend/__tests__/ClubReserve.view.test.tsx` — bascule + persistance + rendu grille.

---

## Task 1 : helpers purs `lib/reserveView.ts`

**Files:**
- Create: `frontend/lib/reserveView.ts`
- Test: `frontend/__tests__/reserveView.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/reserveView.test.ts` :

```ts
import { splitPastSlots, scarcityLabel, gridColumns, RESERVE_VIEW_KEY } from '../lib/reserveView';

const iso = (offsetH: number) => new Date(Date.now() + offsetH * 3600e3).toISOString();

describe('reserveView helpers', () => {
  describe('splitPastSlots', () => {
    it('partitionne selon nowMs (<= now = passé), en conservant l\'ordre', () => {
      const now = Date.now();
      const slots = [
        { startTime: iso(-2) }, // passé
        { startTime: iso(-1) }, // passé
        { startTime: iso(1) },  // à venir
        { startTime: iso(3) },  // à venir
      ];
      const { past, rest } = splitPastSlots(slots, now);
      expect(past).toHaveLength(2);
      expect(rest).toHaveLength(2);
      expect(rest[0].startTime).toBe(slots[2].startTime);
    });
    it('renvoie tout dans rest quand rien n\'est passé', () => {
      const { past, rest } = splitPastSlots([{ startTime: iso(1) }], Date.now());
      expect(past).toHaveLength(0);
      expect(rest).toHaveLength(1);
    });
  });

  describe('scarcityLabel', () => {
    it('null en dehors de 1..3', () => {
      expect(scarcityLabel(0, true)).toBeNull();
      expect(scarcityLabel(4, true)).toBeNull();
    });
    it('singulier/pluriel + variante jour', () => {
      expect(scarcityLabel(1, true)).toBe("Plus que 1 créneau aujourd'hui");
      expect(scarcityLabel(3, true)).toBe("Plus que 3 créneaux aujourd'hui");
      expect(scarcityLabel(2, false)).toBe('Plus que 2 créneaux ce jour-là');
    });
  });

  describe('gridColumns', () => {
    it('union triée des heures À VENIR sur tous les terrains (passés exclus, dédupliqués)', () => {
      const now = Date.now();
      const items = [
        { slots: [{ startTime: iso(-1) }, { startTime: iso(2) }, { startTime: iso(1) }] },
        { slots: [{ startTime: iso(1) }, { startTime: iso(3) }] },
      ];
      const cols = gridColumns(items, now);
      expect(cols).toEqual([...cols].sort());          // trié
      expect(cols).toHaveLength(3);                      // iso(1), iso(2), iso(3) — iso(-1) exclu, iso(1) dédup
      expect(cols.some((c) => c === iso(-1))).toBe(false);
    });
  });

  it('RESERVE_VIEW_KEY est scoppé au club', () => {
    expect(RESERVE_VIEW_KEY('c1')).toBe('palova:reserve-view:c1');
  });
});
```

- [ ] **Step 2 : Lancer le test → échec attendu**

Run: `node node_modules/jest/bin/jest.js __tests__/reserveView.test.ts --runInBand`
Expected: FAIL (« Cannot find module '../lib/reserveView' »).

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `frontend/lib/reserveView.ts` :

```ts
// Helpers purs de la page Réserver (présentation des créneaux + vue cartes/grille).
// Aucune dépendance React — testés isolément.

export type ReserveView = 'cards' | 'grid';

/** Clé localStorage de la vue préférée, scoppée au club (comme palova:reserve-sports:<clubId>). */
export const RESERVE_VIEW_KEY = (clubId: string) => `palova:reserve-view:${clubId}`;

/**
 * Partitionne les créneaux d'un terrain : `past` = déjà commencés (startTime <= nowMs,
 * même règle que l'affichage existant), `rest` = le reste, chacun dans l'ordre d'origine.
 */
export function splitPastSlots<T extends { startTime: string }>(
  slots: T[],
  nowMs: number,
): { past: T[]; rest: T[] } {
  const past: T[] = [];
  const rest: T[] = [];
  for (const s of slots) {
    if (new Date(s.startTime).getTime() <= nowMs) past.push(s);
    else rest.push(s);
  }
  return { past, rest };
}

/**
 * Libellé de rareté : affiché seulement quand il reste 1 à 3 créneaux réservables,
 * sinon null. `isToday` change la formulation (« aujourd'hui » vs « ce jour-là »).
 */
export function scarcityLabel(bookableCount: number, isToday: boolean): string | null {
  if (bookableCount < 1 || bookableCount > 3) return null;
  const noun = bookableCount === 1 ? 'créneau' : 'créneaux';
  return isToday
    ? `Plus que ${bookableCount} ${noun} aujourd'hui`
    : `Plus que ${bookableCount} ${noun} ce jour-là`;
}

/**
 * Colonnes de la vue grille : union triée (ISO) des heures de début À VENIR
 * de tous les terrains d'une section. Les créneaux passés sont exclus (pas de repli en grille).
 */
export function gridColumns<S extends { startTime: string }>(
  items: { slots: S[] }[],
  nowMs: number,
): string[] {
  const set = new Set<string>();
  for (const it of items) {
    for (const s of it.slots) {
      if (new Date(s.startTime).getTime() > nowMs) set.add(s.startTime);
    }
  }
  return [...set].sort();
}
```

- [ ] **Step 4 : Lancer le test → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/reserveView.test.ts --runInBand`
Expected: PASS (tous les cas verts).

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/reserveView.ts frontend/__tests__/reserveView.test.ts
git commit -m "feat(reserve): helpers purs reserveView (partition passés, rareté, colonnes grille)"
```

---

## Task 2 : composant `ViewToggle` (segmented ☰/⊞)

**Files:**
- Create: `frontend/components/reserve/ViewToggle.tsx`
- Test: `frontend/__tests__/ViewToggle.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/ViewToggle.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewToggle } from '../components/reserve/ViewToggle';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('ViewToggle', () => {
  it('reflète la vue active via aria-pressed', () => {
    wrap(<ViewToggle value="cards" onChange={() => {}} />);
    expect(screen.getByLabelText('Vue liste')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Vue grille')).toHaveAttribute('aria-pressed', 'false');
  });

  it('émet la nouvelle vue au clic', () => {
    const onChange = jest.fn();
    wrap(<ViewToggle value="cards" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Vue grille'));
    expect(onChange).toHaveBeenCalledWith('grid');
  });
});
```

- [ ] **Step 2 : Lancer le test → échec attendu**

Run: `node node_modules/jest/bin/jest.js __tests__/ViewToggle.test.tsx --runInBand`
Expected: FAIL (« Cannot find module '../components/reserve/ViewToggle' »).

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `frontend/components/reserve/ViewToggle.tsx` :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import type { ReserveView } from '@/lib/reserveView';

// Interrupteur d'affichage des créneaux : liste (cartes par terrain) ↔ grille (matrice).
// Segmented compact, pastille pleine sur l'option active (même langage que les autres toggles).
export function ViewToggle({ value, onChange }: {
  value: ReserveView; onChange: (v: ReserveView) => void;
}) {
  const { th } = useTheme();
  const opts: { v: ReserveView; icon: 'menu' | 'grid'; label: string }[] = [
    { v: 'cards', icon: 'menu', label: 'Vue liste' },
    { v: 'grid', icon: 'grid', label: 'Vue grille' },
  ];
  return (
    <div role="group" aria-label="Affichage des créneaux"
      style={{ display: 'inline-flex', gap: 2, background: th.surface2, borderRadius: 10, padding: 2 }}>
      {opts.map((o) => {
        const on = value === o.v;
        return (
          <button key={o.v} type="button" aria-label={o.label} aria-pressed={on}
            onClick={() => onChange(o.v)}
            style={{ border: 'none', cursor: 'pointer', borderRadius: 8, padding: '5px 9px',
              display: 'inline-flex', alignItems: 'center', background: on ? th.text : 'transparent' }}>
            <Icon name={o.icon} size={16} color={on ? th.bg : th.textMute} stroke={2} />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4 : Lancer le test → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/ViewToggle.test.tsx --runInBand`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/reserve/ViewToggle.tsx frontend/__tests__/ViewToggle.test.tsx
git commit -m "feat(reserve): ViewToggle segmented liste/grille"
```

---

## Task 3 : composant `SportGrid` (matrice terrains × heures)

**Files:**
- Create: `frontend/components/reserve/SportGrid.tsx`
- Test: `frontend/__tests__/SportGrid.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/SportGrid.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SportGrid } from '../components/reserve/SportGrid';
import { ThemeProvider } from '../lib/ThemeProvider';
import type { ClubAvailability } from '../lib/api';

const future = new Date(Date.now() + 3 * 3600e3).toISOString();
const past = new Date(Date.now() - 3 * 3600e3).toISOString();
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
    .format(new Date(iso)).replace(':', 'h');

const items: ClubAvailability[] = [{
  resource: { id: 'r1', name: 'Terrain 1', attributes: {}, price: '25', offPeakPrice: null,
    sport: { key: 'padel', name: 'Padel' }, clubSportId: 'cs1' },
  slots: [
    { startTime: past, endTime: past, available: true, price: '25', offPeak: false },     // exclu (passé)
    { startTime: future, endTime: future, available: true, price: '25', offPeak: false }, // libre
  ],
}];

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('SportGrid', () => {
  it('rend une colonne par heure à venir (le passé est exclu) et ouvre la confirmation au clic d\'une cellule libre', () => {
    const onSlot = jest.fn();
    wrap(<SportGrid items={items} nowMs={Date.now()} timezone="Europe/Paris"
      slotAllowed={() => true} onSlot={onSlot} sportKey="padel" duration={90} />);
    // en-tête : l'heure à venir est présente, le passé absent
    expect(screen.getByText(fmt(future))).toBeInTheDocument();
    expect(screen.queryByText(fmt(past))).toBeNull();
    // clic sur la cellule libre → onSlot
    fireEvent.click(screen.getByLabelText(new RegExp(`Terrain 1 ${fmt(future)}`)));
    expect(onSlot).toHaveBeenCalledWith('r1', '25', items[0].slots[1], 90, undefined, 'padel', 'Terrain 1');
  });

  it('affiche un état vide quand aucun créneau à venir', () => {
    const onlyPast: ClubAvailability[] = [{
      resource: items[0].resource,
      slots: [{ startTime: past, endTime: past, available: true, price: '25', offPeak: false }],
    }];
    wrap(<SportGrid items={onlyPast} nowMs={Date.now()} timezone="Europe/Paris"
      slotAllowed={() => true} onSlot={jest.fn()} sportKey="padel" duration={90} />);
    expect(screen.getByText(/Aucun créneau à venir/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : Lancer le test → échec attendu**

Run: `node node_modules/jest/bin/jest.js __tests__/SportGrid.test.tsx --runInBand`
Expected: FAIL (« Cannot find module '../components/reserve/SportGrid' »).

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `frontend/components/reserve/SportGrid.tsx` :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import type { ClubAvailability, TimeSlot } from '@/lib/api';
import { gridColumns } from '@/lib/reserveView';

function fmtHour(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

// Vue « grille » d'une section sport : lignes = terrains, colonnes = heures à venir.
// Colonne terrain figée (sticky), la table défile horizontalement (.sp-scroll-x).
// Mêmes données et même onSlot que la vue cartes → clic d'une cellule libre = même confirmation.
export function SportGrid({ items, nowMs, timezone, slotAllowed, onSlot, sportKey, duration }: {
  items: ClubAvailability[];
  nowMs: number;
  timezone: string;
  slotAllowed: (iso: string) => boolean;
  onSlot: (resourceId: string, price: string, slot: TimeSlot, duration: number,
           format: string | undefined, sportKey: string, resourceName: string) => void;
  sportKey: string;
  duration: number;
}) {
  const { th } = useTheme();
  const cols = gridColumns(items, nowMs);
  const freeBg = `${th.accent}2e`;       // accent translucide (libre)
  const offPeakBg = `${th.accentWarm}33`; // ambré translucide (heures creuses)

  if (cols.length === 0) {
    return <div style={{ padding: '12px 0', fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>Aucun créneau à venir ce jour.</div>;
  }

  return (
    <div>
      <div className="sp-scroll-x">
        <table style={{ borderCollapse: 'separate', borderSpacing: 4 }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: th.bg, zIndex: 1 }} />
              {cols.map((c) => (
                <th key={c} style={{ fontFamily: th.fontMono, fontSize: 11, fontWeight: 500,
                  color: th.textMute, padding: '0 2px', whiteSpace: 'nowrap' }}>{fmtHour(c, timezone)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(({ resource, slots }) => {
              const format = typeof resource.attributes?.format === 'string' ? resource.attributes.format : undefined;
              return (
                <tr key={resource.id}>
                  <td style={{ position: 'sticky', left: 0, background: th.bg, zIndex: 1, paddingRight: 10, whiteSpace: 'nowrap' }}>
                    <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, color: th.text }}>{resource.name}</span>
                    <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 11, color: th.textMute }}>
                      {Number(resource.price)}€
                      {resource.offPeakPrice && <span style={{ color: th.accentWarm }}> · {Number(resource.offPeakPrice)}€ creux</span>}
                    </span>
                  </td>
                  {cols.map((c) => {
                    const slot = slots.find((s) => s.startTime === c);
                    const isPast = slot ? new Date(slot.startTime).getTime() <= nowMs : false;
                    const free = !!slot && slot.available && !isPast && slotAllowed(slot.startTime);
                    if (free && slot) {
                      return (
                        <td key={c}>
                          <button type="button" aria-label={`${resource.name} ${fmtHour(c, timezone)}`}
                            title={slot.offPeak ? 'Heures creuses' : undefined}
                            onClick={() => onSlot(resource.id, slot.price, slot, duration, format, sportKey, resource.name)}
                            style={{ border: 'none', cursor: 'pointer', width: '100%', minWidth: 44, height: 34,
                              borderRadius: 7, background: slot.offPeak ? offPeakBg : freeBg }} />
                        </td>
                      );
                    }
                    return (
                      <td key={c}>
                        <div aria-hidden="true" style={{ minWidth: 44, height: 34, borderRadius: 7,
                          background: slot ? th.takenBg : 'transparent' }} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: freeBg }} /> libre</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: offPeakBg }} /> heures creuses</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: th.takenBg }} /> pris</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : Lancer le test → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/SportGrid.test.tsx --runInBand`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/reserve/SportGrid.tsx frontend/__tests__/SportGrid.test.tsx
git commit -m "feat(reserve): SportGrid (matrice terrains x heures, colonne figee)"
```

---

## Task 4 : polish de la vue cartes dans `ClubReserve.tsx` (finitions 1-4)

Objectif : dans la vue cartes existante, aligner les heures en colonnes, afficher le prix creux
sur le chip, replier les créneaux passés, ajouter la ligne de rareté. On garde le rendu par terrain.

**Files:**
- Modify: `frontend/components/ClubReserve.tsx`
- Modify (adaptation): `frontend/__tests__/ClubReserve.pastslots.test.tsx`

- [ ] **Step 1 : Ajouter les imports et l'état de repli**

Dans `ClubReserve.tsx`, ajouter aux imports (après la ligne `import { SportPicker } ...`) :

```tsx
import { ACCENTS } from '@/lib/theme';
import { splitPastSlots, scarcityLabel } from '@/lib/reserveView';
```

Ajouter l'état de repli des passés (près des autres `useState`, ex. après `const [confirmed, setConfirmed] = useState(false);`) :

```tsx
  // Repli des créneaux du jour déjà commencés, par terrain (clé = resource.id). Réinitialisé au
  // changement de date (le passé n'existe que le jour même).
  const [expandedPast, setExpandedPast] = useState<Record<string, boolean>>({});
```

Et réinitialiser au changement de date (près des autres effets, ex. après l'effet `useEffect(() => { refreshQuota(); }, ...)`) :

```tsx
  useEffect(() => { setExpandedPast({}); }, [date]);
```

- [ ] **Step 2 : Remplacer le bloc de rendu des créneaux (cartes)**

Dans `ClubReserve.tsx`, repérer le bloc actuel qui rend les créneaux d'un terrain — il commence par
`{slots.length === 0 ? (` et se termine par la fermeture du ternaire juste avant `</div>` de la carte
(le bloc `flex-wrap` qui `slots.map(...)`). Remplacer **tout ce ternaire** par :

```tsx
                            {slots.length === 0 ? (
                              <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>Aucun créneau ce jour.</div>
                            ) : (() => {
                              const { past, rest } = splitPastSlots(slots, nowMs);
                              const showPast = expandedPast[resource.id] === true;
                              const bookableCount = rest.filter((s) => s.available && win.slotAllowed(s.startTime)).length;
                              const scarcity = scarcityLabel(bookableCount, date === todayISO());
                              const renderSlot = (s: TimeSlot, forcePast?: boolean) => {
                                const isPast = forcePast ?? (new Date(s.startTime).getTime() <= nowMs);
                                return (s.available && !isPast && win.slotAllowed(s.startTime)) ? (
                                  <button key={s.startTime} onClick={() => onSlot(resource.id, s.price, s, selDur, typeof resource.attributes?.format === 'string' ? resource.attributes.format : undefined, cs.sport.key, resource.name)} title={s.offPeak ? 'Heures creuses' : undefined}
                                    style={{ border: 'none', cursor: 'pointer', borderRadius: 9, padding: '7px 6px', background: s.offPeak ? `${th.accentWarm}26` : th.surface2, color: th.text, fontFamily: th.fontMono, fontSize: 13, fontWeight: 500, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                                    {formatHour(s.startTime, club.timezone)}
                                    {s.offPeak && <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 600, color: th.accentWarm }}>{Number(s.price)}€</span>}
                                  </button>
                                ) : (
                                  <span key={s.startTime} title={isPast ? 'Passé' : 'Réservé'}
                                    style={{ borderRadius: 9, padding: '7px 6px', background: th.takenBg, color: th.takenText, fontFamily: th.fontMono, fontSize: 13, fontWeight: 500, textAlign: 'center', textDecoration: `line-through ${th.takenText}`, cursor: 'not-allowed' }}>
                                    {formatHour(s.startTime, club.timezone)}
                                  </span>
                                );
                              };
                              return (
                                <>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 7 }}>
                                    {past.length > 0 && !showPast && (
                                      <button type="button" aria-label="Afficher les créneaux passés" onClick={() => setExpandedPast((m) => ({ ...m, [resource.id]: true }))}
                                        style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '7px 6px', color: th.textFaint, fontFamily: th.fontUI, fontSize: 12, fontWeight: 500 }}>
                                        ‹ {past.length} passé{past.length > 1 ? 's' : ''}
                                      </button>
                                    )}
                                    {showPast && past.map((s) => renderSlot(s, true))}
                                    {rest.map((s) => renderSlot(s))}
                                  </div>
                                  {scarcity && (
                                    <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, color: ACCENTS.coral }}>{scarcity}</div>
                                  )}
                                </>
                              );
                            })()}
```

Note : `TimeSlot` est déjà importé depuis `@/lib/api` en tête de fichier ; `cs`, `resource`, `selDur`,
`nowMs`, `win`, `date` sont dans la portée de la boucle existante.

- [ ] **Step 3 : Adapter le test `pastslots` au repli**

Remplacer le corps du `it(...)` de `frontend/__tests__/ClubReserve.pastslots.test.tsx` (le test unique)
par la version qui vérifie le repli puis le dépli :

```tsx
  it('replie les créneaux passés derrière un chip ; le créneau à venir reste réservable', async () => {
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    // Le créneau à venir s'affiche et reste réservable (bouton).
    const futureEl = await screen.findByText(fmt(future));
    expect(futureEl.closest('button')).not.toBeNull();
    // Le créneau passé est REPLIÉ : son heure n'est pas rendue tant qu'on n'a pas déplié.
    expect(screen.queryByText(fmt(past))).toBeNull();
    // Un chip « ‹ 1 passé » est présent ; on le déplie.
    const toggle = screen.getByLabelText('Afficher les créneaux passés');
    fireEvent.click(toggle);
    // Après dépli, l'heure passée apparaît, non réservable (pas un bouton).
    const pastEl = await screen.findByText(fmt(past));
    expect(pastEl.closest('button')).toBeNull();
  });
```

Ajouter `fireEvent` à l'import RTL en haut du fichier :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
```

- [ ] **Step 4 : Lancer le test adapté → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/ClubReserve.pastslots.test.tsx --runInBand`
Expected: PASS.

- [ ] **Step 5 : Type-check ciblé**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: aucune erreur sur `components/ClubReserve.tsx` / `lib/reserveView.ts` / `components/reserve/*`
(⚠️ mémoire : d'autres WIP peuvent être en cours — filtrer la sortie sur ces chemins).

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/ClubReserve.tsx frontend/__tests__/ClubReserve.pastslots.test.tsx
git commit -m "feat(reserve): cartes polies (heures alignees, prix creux, passes replies, raréte)"
```

---

## Task 5 : bascule de vue + persistance + branchement grille dans `ClubReserve.tsx` (finition 5)

**Files:**
- Modify: `frontend/components/ClubReserve.tsx`
- Test: `frontend/__tests__/ClubReserve.view.test.tsx`

- [ ] **Step 1 : Écrire le test d'intégration qui échoue**

Créer `frontend/__tests__/ClubReserve.view.test.tsx` (scaffold de mock repris de `pastslots`, car
`ClubReserve` monte le vrai `ClubNav`) :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ClubReserve } from '../components/ClubReserve';
import { ThemeProvider } from '../lib/ThemeProvider';

const future = new Date(Date.now() + 3 * 3600e3).toISOString();
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
    .format(new Date(iso)).replace(':', 'h');

jest.mock('next/navigation', () => ({
  usePathname: () => '/reserver',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../components/BookingModal', () => ({
  __esModule: true,
  default: ({ resourceId }: { resourceId: string }) => <div data-testid="booking-modal">{resourceId}</div>,
}));
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  notificationsStreamUrl: () => 'http://x/stream',
  api: {
    getMyMemberships: jest.fn().mockResolvedValue([]),
    getMyClubPackages: jest.fn().mockResolvedValue([]),
    getMyCardStatus: jest.fn().mockResolvedValue({ hasCardOnFile: false }),
    getMyClubSubscriptions: jest.fn().mockResolvedValue([]),
    getMyQuotaStatus: jest.fn().mockResolvedValue(null),
    getMyProfile: jest.fn().mockResolvedValue({ firstName: 'Test', lastName: 'User', email: 'test@palova.fr', avatarUrl: null }),
    getClubAvailability: jest.fn(),
    getMyReservations: jest.fn().mockResolvedValue([]),
    getMyTournaments: jest.fn().mockResolvedValue([]),
    getMyEvents: jest.fn().mockResolvedValue([]),
    getMyLessons: jest.fn().mockResolvedValue([]),
    getDmUnread: jest.fn().mockResolvedValue({ count: 0 }),
    getUnreadCount: jest.fn().mockResolvedValue({ count: 0 }),
    getNotifications: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    markNotificationRead: jest.fn().mockResolvedValue({ ok: true }),
    markAllNotificationsRead: jest.fn().mockResolvedValue({ ok: true }),
  },
}));
beforeAll(() => {
  (global as any).EventSource = class { onmessage: ((e: any) => void) | null = null; close() {} };
});
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const club = {
  id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris', description: null,
  memberBookingDays: 7, publicBookingDays: 7,
  clubSports: [{ id: 'cs1', durationsMin: [90], sport: { defaultDurationsMin: [90], name: 'Padel', icon: null }, resources: [{ id: 'r1' }] }],
} as never;

const availability = [{
  resource: { id: 'court-1', name: 'Terrain 1', attributes: {}, price: '25', offPeakPrice: null, sport: { key: 'padel', name: 'Padel' }, clubSportId: 'cs1' },
  slots: [{ startTime: future, endTime: future, available: true, price: '25', offPeak: false }],
}];

describe('ClubReserve — bascule de vue', () => {
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
    localStorage.clear();
    mocked.getClubAvailability.mockResolvedValue(availability as never);
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('bascule en vue grille, persiste le choix, et rend une cellule cliquable', async () => {
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    // Vue cartes par défaut : le chip horaire est là.
    await screen.findByText(fmt(future));
    // Bascule en grille.
    fireEvent.click(screen.getByLabelText('Vue grille'));
    // La cellule de grille (aria-label « Terrain 1 <heure> ») est présente.
    expect(await screen.findByLabelText(new RegExp(`Terrain 1 ${fmt(future)}`))).toBeInTheDocument();
    // Le choix est persisté.
    expect(localStorage.getItem('palova:reserve-view:c1')).toBe('grid');
  });

  it('restaure la vue grille mémorisée au montage', async () => {
    localStorage.setItem('palova:reserve-view:c1', 'grid');
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    expect(await screen.findByLabelText(new RegExp(`Terrain 1 ${fmt(future)}`))).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : Lancer le test → échec attendu**

Run: `node node_modules/jest/bin/jest.js __tests__/ClubReserve.view.test.tsx --runInBand`
Expected: FAIL (« Vue grille » introuvable / cellule grille absente).

- [ ] **Step 3 : Ajouter l'état de vue + imports**

Dans `ClubReserve.tsx`, ajouter aux imports :

```tsx
import { ViewToggle } from '@/components/reserve/ViewToggle';
import { SportGrid } from '@/components/reserve/SportGrid';
import { RESERVE_VIEW_KEY, type ReserveView } from '@/lib/reserveView';
```

Ajouter l'état de vue (près des autres `useState`) :

```tsx
  // Vue d'affichage des créneaux : cartes par terrain (défaut) ou grille (matrice). Le premier
  // rendu est TOUJOURS 'cards' (pas de localStorage dans l'initializer → pas de mismatch
  // d'hydratation) ; la valeur mémorisée est lue au montage.
  const [view, setView] = useState<ReserveView>('cards');
  useEffect(() => {
    try { const v = localStorage.getItem(RESERVE_VIEW_KEY(club.id)); if (v === 'grid' || v === 'cards') setView(v); } catch { /* localStorage indispo */ }
  }, [club.id]);
  const changeView = (v: ReserveView) => {
    setView(v);
    try { localStorage.setItem(RESERVE_VIEW_KEY(club.id), v); } catch { /* localStorage indispo */ }
  };
```

- [ ] **Step 4 : Rendre la rangée toggle (toujours visible)**

Remplacer le bloc actuel du sélecteur de sport :

```tsx
            {/* sélecteur de sport discret — affiché seulement si le club a plusieurs sports réservables */}
            {bookableSports.length > 1 && selectedSportIds !== null && (
              <div style={{ padding: '12px 20px 0' }}>
                <SportPicker
                  sports={bookableSports.map((cs) => ({ id: cs.id, name: cs.sport.name, icon: cs.sport.icon }))}
                  selectedIds={selectedSportIds}
                  onChange={changeSports}
                />
              </div>
            )}
```

par une rangée qui pose le SportPicker à gauche (si multi-sport) et le ViewToggle à droite :

```tsx
            {/* rangée : sélecteur de sport (si plusieurs sports) à gauche, bascule de vue à droite */}
            <div style={{ padding: '12px 20px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
              {bookableSports.length > 1 && selectedSportIds !== null ? (
                <SportPicker
                  sports={bookableSports.map((cs) => ({ id: cs.id, name: cs.sport.name, icon: cs.sport.icon }))}
                  selectedIds={selectedSportIds}
                  onChange={changeSports}
                />
              ) : <span aria-hidden="true" />}
              <div style={{ marginLeft: 'auto' }}>
                <ViewToggle value={view} onChange={changeView} />
              </div>
            </div>
```

- [ ] **Step 5 : Brancher la vue grille par section**

Dans le rendu par section sport, repérer le conteneur des cartes terrain — le bloc :

```tsx
                    <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {items.map(({ resource, slots }) => {
```

L'envelopper d'un branchement `view === 'grid'` : juste après la ligne `) : (` qui précède ce
conteneur (la branche « items non vides »), insérer le rendu grille et n'afficher les cartes que
si `view === 'cards'`. Concrètement, remplacer l'ouverture :

```tsx
                    ) : (
                    <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s', display: 'flex', flexDirection: 'column', gap: 12 }}>
```

par :

```tsx
                    ) : view === 'grid' ? (
                    <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
                      <SportGrid
                        items={items}
                        nowMs={nowMs}
                        timezone={club.timezone}
                        slotAllowed={win.slotAllowed}
                        onSlot={onSlot}
                        sportKey={cs.sport.key}
                        duration={selDur}
                      />
                    </div>
                    ) : (
                    <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s', display: 'flex', flexDirection: 'column', gap: 12 }}>
```

(Le reste du bloc cartes — `{items.map(...)}` et sa fermeture `</div>` — est inchangé ; on a juste
ajouté une branche `view === 'grid'` avant lui.)

- [ ] **Step 6 : Lancer le test d'intégration → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/ClubReserve.view.test.tsx --runInBand`
Expected: PASS (les 2 cas).

- [ ] **Step 7 : Commit**

```bash
git add frontend/components/ClubReserve.tsx frontend/__tests__/ClubReserve.view.test.tsx
git commit -m "feat(reserve): bascule vue cartes/grille memorisee par club"
```

---

## Task 6 : vérification finale (non-régression + types)

**Files:** aucun (vérification + commit éventuel de correctifs).

- [ ] **Step 1 : Lancer toutes les suites Réserver + nouveaux composants**

Run:
```bash
node node_modules/jest/bin/jest.js __tests__/reserveView.test.ts __tests__/ViewToggle.test.tsx __tests__/SportGrid.test.tsx __tests__/ClubReserve.pastslots.test.tsx __tests__/ClubReserve.view.test.tsx __tests__/ClubReserve.deeplink.test.tsx __tests__/ClubReserve.persport.test.tsx __tests__/ClubReserve.balances.test.tsx __tests__/SportPicker.test.tsx --runInBand
```
Expected: toutes PASS. Si `deeplink`/`persport`/`balances` échouent sur un point DOM introduit par
la rangée toggle (peu probable — nouveaux `aria-label` distincts), corriger le sélecteur du test
concerné sans changer le comportement, puis relancer.

- [ ] **Step 2 : Type-check global**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: pas d'erreur nouvelle sur les fichiers touchés (`lib/reserveView.ts`,
`components/reserve/ViewToggle.tsx`, `components/reserve/SportGrid.tsx`, `components/ClubReserve.tsx`).
⚠️ Filtrer la sortie sur ces chemins (WIP parallèle possible).

- [ ] **Step 3 : Vérification visuelle (skill `verify`)**

Optionnel mais recommandé : lancer la skill `verify` sur `/reserver` (viewport mobile + desktop) pour
contrôler l'alignement des colonnes, le chip creux ambré, le repli « ‹ N passés », la ligne coral de
rareté, et la bascule ☰/⊞ → grille (colonne terrain figée, scroll horizontal). Comparer thème clair
ET sombre.

- [ ] **Step 4 : Commit final si correctifs**

```bash
git add -A
git commit -m "test(reserve): non-regression suites Reserver apres redesign"
```

---

## Self-review (couverture spec)

- **Finition 1 — heures alignées** : Task 4, `gridTemplateColumns: repeat(auto-fill, minmax(76px,1fr))`
  (cartes de même largeur + même génération de créneaux → colonnes alignées). ✓
- **Finition 2 — prix creux sur le chip** : Task 4, badge `{Number(s.price)}€` ambré + fond
  `${th.accentWarm}26` sur les créneaux `offPeak` (le point de 5px disparaît). ✓
- **Finition 3 — passés repliés** : Task 4, `splitPastSlots` + chip « ‹ N passés » + état
  `expandedPast` par terrain, réinitialisé au changement de date. ✓
- **Finition 4 — signal de rareté** : Task 4, `scarcityLabel(bookableCount, isToday)` en `ACCENTS.coral`. ✓
- **Finition 5 — vue mémorisée** : Task 5, `RESERVE_VIEW_KEY(club.id)` en localStorage, restaurée au
  montage (hydration-safe, défaut cards). ✓
- **Bascule ☰/⊞** : Task 2 `ViewToggle` + Task 5 rangée toujours visible (même mono-sport). ✓
- **Vue grille (matrice, colonne figée, scroll, cellules teintées, légende, tap → confirmation)** :
  Task 3 `SportGrid` + Task 5 branchement `view === 'grid'` par section. ✓
- **Zéro fetch / zéro impact perf** : aucune nouvelle route/appel ; les deux vues lisent `availBySport`
  déjà en mémoire ; la bascule ne recharge rien. ✓
- **Inchangé** (DateSelector, SportPicker, BookingModal, lien profond, quotas, onglet Terrains,
  backend) : aucune modification de ces chemins. ✓
- **Tests** : helpers purs (Task 1), composants isolés (Tasks 2-3), intégration bascule/persistance
  (Task 5), adaptation `pastslots` (Task 4), non-régression (Task 6). ✓
