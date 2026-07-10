# Refonte « Ventes & journée » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre `/admin/caisse` (« Ventes & journée ») en une page « journal vivant + panneau de vente » : bandeau KPI avec sparkline 7 jours, journal horodaté filtrable, carte « Compter la caisse », panneau de vente unifié (carnets **et** abonnements), tickets CE.

**Architecture:** 100 % frontend, aucune migration ni route nouvelle. Toutes les données existent déjà : `adminGetCaisse(date)` (paiements + totaux par moyen), `adminGetReservations(date).summary.outstanding` (reste dû), `adminAccountingSummary(year, month).byDay` (net encaissé/jour, fuseau club). La page (~440 lignes) est découpée en trois composants présentationnels sous `components/admin/ventes/`, l'orchestration (fetchs, état, modales reçu/remboursement) reste dans la page. Les calculs purs (série de tendance, partition journal, format heure) vivent dans `lib/caisse.ts` et `lib/calendar.ts`, testés isolément.

**Tech Stack:** Next.js 16 (client component), React 19, TypeScript, Jest + React Testing Library, thème maison (`useTheme`/`ACCENTS`), pas de lib externe.

---

## Contexte codebase (à lire avant de commencer)

- **Fichier cible :** `frontend/app/admin/caisse/page.tsx` (composant `AdminCaissePage`). Il gère aujourd'hui : chargement (`load`), totaux du jour, deux cartes de vente redondantes qui **partagent** `buyer`/`sellMethod`, tickets CE, modales reçu + remboursement. On conserve **toute** la logique métier (vente, remboursement, reçu, tickets CE) et on la réorganise.
- **Helpers purs existants** dans `frontend/lib/caisse.ts` : `toCents`, `centsToStr`, `fmtEuros`, `validatePaymentAmount`. On y **ajoute** `hhmm`, `isSalePayment`, `trendSeries`.
- **Helpers date** dans `frontend/lib/calendar.ts` : `todayKey`, `dayKeyInTz`, `monthLabel`, `addMonths`. On y **ajoute** `addDaysKey`, `frLongLabel`, `frWeekday`.
- **Thème :** `const { th } = useTheme();` expose `th.surface`, `th.surface2`, `th.bg`, `th.line`, `th.text`, `th.textMute`, `th.textFaint`, `th.shadow`, `th.accent`, `th.fontUI`, `th.fontMono`, `th.fontDisplay`. Accents : `import { ACCENTS } from '@/lib/theme'` → `ACCENTS.blue`, `ACCENTS.coral`, `ACCENTS.apricot`, `ACCENTS.cyan`.
- **Types API** (`frontend/lib/api.ts`) : `CaissePayment extends Payment { reservation: {...} | null; memberPackage: {...} | null }`, `CaisseSummary { date; totalsByMethod: Partial<Record<PaymentMethod,string>>; collected; payments }`, `MonthlySummary { byDay: { date: string; net: string }[]; ... }`, `PaymentMethod`, `PackageTemplate`, `SubscriptionPlan`, `Member`, `MemberPackage`.
- **Timezone :** `useClub().club?.timezone` (repli `'Europe/Paris'`).
- **Convention repo :** styles inline (pas de CSS modules), `th.fontMono` uppercase pour les micro-labels, montants via `fmtEuros(cents)` ou l'`euro()` local. Jest ne type-checke pas (ts-jest `isolatedModules`) → `tsc --noEmit` est le garde-fou de types.
- **Lancer les tests (shims `.bin` cassés sur ce poste) :** `node node_modules/jest/bin/jest.js <pattern>` et `node node_modules/typescript/bin/tsc --noEmit` depuis `frontend/`.

---

## File Structure

- **Créer** `frontend/components/admin/ventes/TrendKpis.tsx` — bandeau KPI (encaissé, reste dû, nb encaissements) + sparkline 7 jours + delta. Purement présentationnel : reçoit un `TrendModel` déjà calculé.
- **Créer** `frontend/components/admin/ventes/DayJournal.tsx` — filtres Tout/Ventes/Résas, liste horodatée des encaissements (heure, libellé, chip moyen, remboursé, montant, Reçu/Rembourser), carte « Compter la caisse ». Reçoit les paiements + callbacks.
- **Créer** `frontend/components/admin/ventes/SellPanel.tsx` — panneau de vente unifié : `PlayerPicker`, soldes du membre, offres groupées (carnets/abos) en radio, chips de moyen (CE → réf+émetteur), CTA « Encaisser {prix} ». Gère son état de formulaire, remonte `onSell(sel)`.
- **Modifier** `frontend/lib/caisse.ts` — ajout `hhmm`, `isSalePayment`, `trendSeries` (+ types `TrendPoint`, `TrendModel`).
- **Modifier** `frontend/lib/calendar.ts` — ajout `addDaysKey`, `frLongLabel`, `frWeekday`.
- **Modifier** `frontend/app/admin/caisse/page.tsx` — orchestration : navigation de date, fetch tendance, composition des trois composants, modales reçu + remboursement conservées.
- **Créer** `frontend/__tests__/AdminCaisse.test.tsx` — suite d'intégration de la page.
- **Modifier** `frontend/__tests__/caisse.test.ts` — cas `hhmm`/`isSalePayment`/`trendSeries`.
- **Modifier** `frontend/__tests__/calendar.test.ts` — cas `addDaysKey`/`frLongLabel`/`frWeekday` (créer le fichier s'il n'existe pas — vérifier d'abord avec `ls frontend/__tests__/calendar.test.ts`).

---

## Task 1 : Helpers purs (dates + caisse)

**Files:**
- Modify: `frontend/lib/calendar.ts` (fin de fichier)
- Modify: `frontend/lib/caisse.ts` (fin de fichier)
- Test: `frontend/__tests__/calendar.test.ts`, `frontend/__tests__/caisse.test.ts`

- [ ] **Step 1 : Écrire les tests date qui échouent**

Vérifier d'abord si le fichier existe : `ls frontend/__tests__/calendar.test.ts`. S'il existe, **ajouter** ces blocs à la fin ; sinon créer le fichier avec l'entête d'import ci-dessous.

Ajouter dans `frontend/__tests__/calendar.test.ts` (si création, préfixer par `import { addDaysKey, frLongLabel, frWeekday } from '@/lib/calendar';`, sinon compléter la ligne d'import existante) :

```typescript
describe('addDaysKey', () => {
  it('avance et recule d\'un nombre de jours (arithmétique UTC, sans décalage DST)', () => {
    expect(addDaysKey('2026-07-10', 1)).toBe('2026-07-11');
    expect(addDaysKey('2026-07-10', -1)).toBe('2026-07-09');
    expect(addDaysKey('2026-07-10', -7)).toBe('2026-07-03');
  });
  it('franchit les bornes de mois et d\'année', () => {
    expect(addDaysKey('2026-07-01', -1)).toBe('2026-06-30');
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('frLongLabel / frWeekday', () => {
  it('libellé long français sans passer par un fuseau local', () => {
    expect(frLongLabel('2026-07-10')).toBe('vendredi 10 juillet');
    expect(frWeekday('2026-07-10')).toBe('vendredi');
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd frontend && node node_modules/jest/bin/jest.js calendar.test`
Expected: FAIL (`addDaysKey is not a function` / import manquant).

- [ ] **Step 3 : Implémenter les helpers date**

Ajouter à la fin de `frontend/lib/calendar.ts` :

```typescript
/** "YYYY-MM-DD" + delta jours, arithmétique UTC pure (aucun décalage de fuseau/DST). */
export function addDaysKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** "YYYY-MM-DD" → "vendredi 10 juillet" (rendu UTC : indépendant du fuseau du navigateur). */
export function frLongLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** "YYYY-MM-DD" → "vendredi" (jour de semaine seul). */
export function frWeekday(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `cd frontend && node node_modules/jest/bin/jest.js calendar.test`
Expected: PASS.

- [ ] **Step 5 : Écrire les tests caisse qui échouent**

Ajouter `hhmm, isSalePayment, trendSeries` à la ligne d'import en tête de `frontend/__tests__/caisse.test.ts`, puis ajouter à la fin :

```typescript
describe('hhmm', () => {
  it('heure locale du club au format HH:MM (été Paris = UTC+2)', () => {
    // 16:04 UTC → 18:04 à Paris
    expect(hhmm('2026-07-10T16:04:00.000Z', 'Europe/Paris')).toBe('18:04');
  });
});

describe('isSalePayment', () => {
  it('vente = paiement sans réservation liée (carnet/abo/recharge)', () => {
    expect(isSalePayment({ reservation: null })).toBe(true);
    expect(isSalePayment({ reservation: { id: 'rv-1' } })).toBe(false);
  });
});

describe('trendSeries', () => {
  const byDay = [
    { date: '2026-07-03', net: '10.00' }, // vendredi S-1 (J-7)
    { date: '2026-07-08', net: '30.00' },
    { date: '2026-07-10', net: '20.00' }, // vendredi J
  ];
  it('renvoie 7 points finissant à endKey, jours manquants comblés à 0', () => {
    const t = trendSeries(byDay, '2026-07-10');
    expect(t.points.map((p) => p.key)).toEqual([
      '2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10',
    ]);
    expect(t.points.map((p) => p.cents)).toEqual([0, 0, 0, 0, 3000, 0, 2000]);
  });
  it('compare au même jour de semaine S-1 (J-7)', () => {
    const t = trendSeries(byDay, '2026-07-10');
    expect(t.todayCents).toBe(2000);
    expect(t.prevWeekCents).toBe(1000);
    expect(t.deltaPct).toBe(100); // (2000-1000)/1000
  });
  it('deltaPct null quand la semaine précédente est à 0 (pas de division)', () => {
    const t = trendSeries([{ date: '2026-07-10', net: '20.00' }], '2026-07-10');
    expect(t.prevWeekCents).toBe(0);
    expect(t.deltaPct).toBeNull();
  });
});
```

- [ ] **Step 6 : Lancer, vérifier l'échec**

Run: `cd frontend && node node_modules/jest/bin/jest.js caisse.test`
Expected: FAIL (`hhmm is not a function`).

- [ ] **Step 7 : Implémenter les helpers caisse**

Ajouter à la fin de `frontend/lib/caisse.ts` :

```typescript
import { addDaysKey } from '@/lib/calendar';

/** ISO → "HH:MM" au fuseau donné (24 h). */
export function hhmm(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz })
    .format(new Date(iso));
}

/** Une « vente » = un encaissement SANS réservation liée (carnet, abo, recharge, libre). */
export function isSalePayment(p: { reservation: unknown | null }): boolean {
  return p.reservation == null;
}

export interface TrendPoint { key: string; cents: number }
export interface TrendModel {
  /** 7 points, de endKey-6 à endKey inclus (net encaissé/jour en centimes). */
  points: TrendPoint[];
  todayCents: number;
  prevWeekCents: number;
  /** Variation % vs le même jour de semaine S-1 ; null si S-1 = 0 (pas de division). */
  deltaPct: number | null;
}

/**
 * Série de tendance sur 7 jours (fuseau déjà appliqué en amont : `byDay` vient de
 * `adminAccountingSummary`, dont les clés jour sont au fuseau du club). Comble les
 * jours absents à 0 et compare endKey au même jour de semaine 7 jours plus tôt.
 */
export function trendSeries(byDay: { date: string; net: string }[], endKey: string): TrendModel {
  const map = new Map<string, number>();
  for (const d of byDay) map.set(d.date, toCents(d.net));
  const points: TrendPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const key = addDaysKey(endKey, -i);
    points.push({ key, cents: map.get(key) ?? 0 });
  }
  const todayCents = map.get(endKey) ?? 0;
  const prevWeekCents = map.get(addDaysKey(endKey, -7)) ?? 0;
  const deltaPct = prevWeekCents === 0 ? null : Math.round(((todayCents - prevWeekCents) / prevWeekCents) * 100);
  return { points, todayCents, prevWeekCents, deltaPct };
}
```

> Note : `caisse.ts` importe déjà des types depuis `@/lib/api` ; ajouter l'import de `addDaysKey` en tête du fichier plutôt qu'au milieu si le linter du repo l'exige (déplacer la ligne `import { addDaysKey }` en haut avec les autres imports). Pas de cycle : `calendar.ts` n'importe pas `caisse.ts`.

- [ ] **Step 8 : Lancer, vérifier le succès**

Run: `cd frontend && node node_modules/jest/bin/jest.js caisse.test calendar.test`
Expected: PASS (toutes les suites vertes).

- [ ] **Step 9 : Type-check**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur nouvelle dans `lib/caisse.ts` / `lib/calendar.ts`.

- [ ] **Step 10 : Commit**

```bash
git add frontend/lib/caisse.ts frontend/lib/calendar.ts frontend/__tests__/caisse.test.ts frontend/__tests__/calendar.test.ts
git commit -m "feat(caisse): helpers purs tendance/journal/dates pour Ventes & journee"
```

---

## Task 2 : Composant `TrendKpis`

**Files:**
- Create: `frontend/components/admin/ventes/TrendKpis.tsx`
- Test: `frontend/__tests__/TrendKpis.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/TrendKpis.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { TrendKpis } from '../components/admin/ventes/TrendKpis';
import { ThemeProvider } from '../lib/ThemeProvider';
import type { TrendModel } from '@/lib/caisse';

const trend: TrendModel = {
  points: [
    { key: '2026-07-04', cents: 0 }, { key: '2026-07-05', cents: 1000 },
    { key: '2026-07-06', cents: 0 }, { key: '2026-07-07', cents: 2000 },
    { key: '2026-07-08', cents: 3000 }, { key: '2026-07-09', cents: 0 },
    { key: '2026-07-10', cents: 2000 },
  ],
  todayCents: 2000, prevWeekCents: 1000, deltaPct: 100,
};

const renderKpis = (over: Partial<React.ComponentProps<typeof TrendKpis>> = {}) =>
  render(<ThemeProvider><TrendKpis collectedCents={42550} outstanding="297.00" count={12} trend={trend} weekday="vendredi" {...over} /></ThemeProvider>);

it('affiche encaissé, reste dû et nombre d\'encaissements', () => {
  renderKpis();
  expect(screen.getByText('425,50 €')).toBeInTheDocument();
  expect(screen.getByText('297,00 €')).toBeInTheDocument();
  expect(screen.getByText('12')).toBeInTheDocument();
});

it('affiche le delta vs même jour S-1', () => {
  renderKpis();
  expect(screen.getByText(/vs vendredi dernier/)).toBeInTheDocument();
  expect(screen.getByText(/\+100\s*%/)).toBeInTheDocument();
});

it('masque le delta quand deltaPct est null', () => {
  renderKpis({ trend: { ...trend, deltaPct: null } });
  expect(screen.queryByText(/vs vendredi dernier/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd frontend && node node_modules/jest/bin/jest.js TrendKpis`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Implémenter le composant**

Créer `frontend/components/admin/ventes/TrendKpis.tsx` :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { fmtEuros, toCents, TrendModel } from '@/lib/caisse';

const euro = (cents: number) => fmtEuros(cents).replace(/(\d) €$/, '$1,00 €').replace(/(\d),(\d\d) €/, '$1,$2 €');

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const { th } = useTheme();
  return (
    <div>
      <div style={{ fontFamily: th.fontMono, fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textFaint }}>{label}</div>
      <div style={{ fontFamily: th.fontDisplay, fontSize: 24, fontWeight: 700, letterSpacing: -0.4, color: accent ?? th.text }}>{value}</div>
    </div>
  );
}

/** Bandeau KPI du jour + sparkline 7 jours. Purement présentationnel (le calcul vit dans trendSeries). */
export function TrendKpis({ collectedCents, outstanding, count, trend, weekday }: {
  collectedCents: number;
  outstanding: string;
  count: number;
  trend: TrendModel;
  weekday: string;
}) {
  const { th } = useTheme();
  const max = Math.max(1, ...trend.points.map((p) => p.cents));
  const up = (trend.deltaPct ?? 0) >= 0;
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: 18, boxShadow: th.shadow, marginBottom: 18, display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
      <Kpi label="Encaissé" value={`${(collectedCents / 100).toFixed(2).replace('.', ',')} €`} accent={th.accent} />
      <Kpi label="Reste dû (jour)" value={`${Number(outstanding).toFixed(2).replace('.', ',')} €`} />
      <Kpi label="Encaissements" value={String(count)} />
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div aria-hidden style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 34 }}>
          {trend.points.map((p) => (
            <div key={p.key} title={p.key}
              style={{ width: 10, height: Math.max(4, Math.round((Math.max(0, p.cents) / max) * 34)), borderRadius: '3px 3px 0 0',
                background: p.key === trend.points[trend.points.length - 1].key ? th.accent : `${th.accent}40` }} />
          ))}
        </div>
        {trend.deltaPct !== null && (
          <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, color: up ? ACCENTS.cyan : ACCENTS.coral, whiteSpace: 'nowrap' }}>
            {up ? '+' : ''}{trend.deltaPct} %<div style={{ color: th.textFaint, fontWeight: 500 }}>vs {weekday} dernier</div>
          </div>
        )}
      </div>
    </div>
  );
}
```

> Le helper `euro`/`toCents` importés mais non utilisés doivent être retirés : n'importer que `{ fmtEuros, TrendModel }` — en fait ce composant formate à la main (`toFixed(2).replace`). **Corriger l'import en `import { TrendModel } from '@/lib/caisse';`** et supprimer la ligne `const euro = …` et l'import `fmtEuros/toCents/ACCENTS` inutiles → ne garder que `ACCENTS` (utilisé) et `TrendModel`. Import final : `import { ACCENTS } from '@/lib/theme';` + `import { TrendModel } from '@/lib/caisse';`.

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `cd frontend && node node_modules/jest/bin/jest.js TrendKpis`
Expected: PASS.

- [ ] **Step 5 : Type-check + commit**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit` (aucune erreur nouvelle).

```bash
git add frontend/components/admin/ventes/TrendKpis.tsx frontend/__tests__/TrendKpis.test.tsx
git commit -m "feat(caisse): composant TrendKpis (bandeau + sparkline 7 jours)"
```

---

## Task 3 : Composant `DayJournal`

**Files:**
- Create: `frontend/components/admin/ventes/DayJournal.tsx`
- Test: `frontend/__tests__/DayJournal.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/DayJournal.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { DayJournal } from '../components/admin/ventes/DayJournal';
import { ThemeProvider } from '../lib/ThemeProvider';
import type { CaissePayment, PaymentMethod } from '@/lib/api';

const pay = (over: Partial<CaissePayment>): CaissePayment => ({
  id: 'p1', amount: '25.00', method: 'CASH' as PaymentMethod, participantId: null,
  payerName: 'Karim B.', note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null,
  createdAt: '2026-07-10T15:30:00.000Z', status: 'CAPTURED', refundedAmount: '0.00', receiptNo: null,
  reservation: { id: 'rv-1', startTime: '2026-07-10T15:00:00.000Z', resource: { name: 'Padel 1' }, user: { firstName: 'Karim', lastName: 'B.' } },
  memberPackage: null, ...over,
});
const sale = pay({ id: 'p2', amount: '90.00', method: 'CARD' as PaymentMethod, reservation: null,
  memberPackage: { id: 'mp', kind: 'ENTRIES', user: { firstName: 'Marie', lastName: 'Dupont' }, template: { name: 'Carnet 10' } } });

const base = {
  payments: [pay({}), sale], tz: 'Europe/Paris', totalsByMethod: { CASH: '25.00', CARD: '90.00' } as Record<string, string>,
  filter: 'all' as const, onFilter: jest.fn(), onReceipt: jest.fn(), onRefund: jest.fn(), busy: false,
};
const renderJ = (over = {}) => render(<ThemeProvider><DayJournal {...base} {...over} /></ThemeProvider>);

it('liste les encaissements avec heure locale et montant', () => {
  renderJ();
  expect(screen.getByText('17:30')).toBeInTheDocument();      // 15:30 UTC → 17:30 Paris
  expect(screen.getByText('90,00 €')).toBeInTheDocument();
});

it('filtre « Ventes » ne garde que les paiements sans réservation', () => {
  renderJ({ filter: 'sales' });
  expect(screen.getByText(/Marie Dupont/)).toBeInTheDocument();
  expect(screen.queryByText(/Padel 1/)).not.toBeInTheDocument();
});

it('filtre « Résas » ne garde que les paiements liés à une réservation', () => {
  renderJ({ filter: 'resa' });
  expect(screen.getByText(/Padel 1/)).toBeInTheDocument();
  expect(screen.queryByText(/Marie Dupont/)).not.toBeInTheDocument();
});

it('clic sur un onglet de filtre remonte onFilter', () => {
  const onFilter = jest.fn();
  renderJ({ onFilter });
  fireEvent.click(screen.getByRole('button', { name: 'Ventes' }));
  expect(onFilter).toHaveBeenCalledWith('sales');
});

it('carte « Compter la caisse » montre un chip par moyen d\'argent', () => {
  renderJ();
  expect(screen.getByText(/Espèces/)).toBeInTheDocument();
  expect(screen.getByText(/Carte/)).toBeInTheDocument();
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd frontend && node node_modules/jest/bin/jest.js DayJournal`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Implémenter le composant**

Créer `frontend/components/admin/ventes/DayJournal.tsx` :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { hhmm, isSalePayment, toCents, fmtEuros } from '@/lib/caisse';
import type { CaissePayment, PaymentMethod } from '@/lib/api';

export type JournalFilter = 'all' | 'sales' | 'resa';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', OTHER: 'Autre',
  VOUCHER: 'Ticket CE', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abo / Membre', SUBSCRIPTION: 'Abonnement',
};
const MONEY_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'OTHER', 'VOUCHER'];
const PREPAID_METHODS: PaymentMethod[] = ['PACK_CREDIT', 'WALLET', 'MEMBER', 'SUBSCRIPTION'];

// Teinte de la chip par moyen : accent bleu pour la CB, coral pour le CE, neutre sinon.
function methodChip(th: ReturnType<typeof useTheme>['th'], m: PaymentMethod): { bg: string; color: string } {
  if (m === 'CARD' || m === 'ONLINE') return { bg: `${th.accent}1f`, color: th.accent };
  if (m === 'VOUCHER') return { bg: `${ACCENTS.apricot}26`, color: ACCENTS.coral };
  return { bg: th.surface2, color: th.textMute };
}

const euro = (s: string) => `${Number(s).toFixed(2).replace('.', ',')} €`;

function label(p: CaissePayment): string {
  if (p.memberPackage) return `${p.memberPackage.user.firstName} ${p.memberPackage.user.lastName} · ${p.memberPackage.template.name}`;
  if (p.reservation) {
    const who = p.reservation.user ? `${p.reservation.user.firstName} ${p.reservation.user.lastName}` : 'Réservation';
    return `${who} · ${p.reservation.resource.name}`;
  }
  return p.payerName ?? 'Encaissement';
}

const FILTERS: { value: JournalFilter; label: string }[] = [
  { value: 'all', label: 'Tout' }, { value: 'sales', label: 'Ventes' }, { value: 'resa', label: 'Résas' },
];

export function DayJournal({ payments, tz, totalsByMethod, filter, onFilter, onReceipt, onRefund, busy }: {
  payments: CaissePayment[];
  tz: string;
  totalsByMethod: Record<string, string>;
  filter: JournalFilter;
  onFilter: (f: JournalFilter) => void;
  onReceipt: (p: CaissePayment) => void;
  onRefund: (p: CaissePayment) => void;
  busy: boolean;
}) {
  const { th } = useTheme();
  const card = { background: th.surface, borderRadius: 16, padding: 18, boxShadow: th.shadow } as const;
  const shown = payments.filter((p) => filter === 'all' ? true : filter === 'sales' ? isSalePayment(p) : !isSalePayment(p));

  const moneyChips = MONEY_METHODS.filter((m) => totalsByMethod[m] != null && toCents(totalsByMethod[m]) !== 0);
  const prepaidChips = PREPAID_METHODS.filter((m) => totalsByMethod[m] != null && toCents(totalsByMethod[m]) !== 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text }}>Journal du jour</div>
          <div style={{ display: 'flex', gap: 4, background: th.surface2, borderRadius: 10, padding: 3 }}>
            {FILTERS.map((f) => (
              <button key={f.value} type="button" onClick={() => onFilter(f.value)}
                style={{ border: 'none', cursor: 'pointer', borderRadius: 8, padding: '5px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
                  background: filter === f.value ? th.surface : 'transparent', color: filter === f.value ? th.text : th.textMute, boxShadow: filter === f.value ? th.shadow : 'none' }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {shown.map((p) => {
            const refunded = toCents(p.refundedAmount ?? '0');
            const isFullyRefunded = p.status === 'REFUNDED';
            const chip = methodChip(th, p.method);
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 13, color: th.text, padding: '9px 0', borderTop: `1px solid ${th.line}` }}>
                <span style={{ fontFamily: th.fontMono, fontSize: 11.5, color: th.textMute, minWidth: 40 }}>{hhmm(p.createdAt, tz)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{label(p)}</span>
                <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '2px 9px', background: chip.bg, color: chip.color, whiteSpace: 'nowrap' }}>
                  {METHOD_LABEL[p.method]}{p.voucherRef ? ` · ${p.voucherRef}` : ''}
                </span>
                {refunded > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: ACCENTS.coral, background: `${ACCENTS.coral}22`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                    remboursé {fmtEuros(refunded)}
                  </span>
                )}
                <b style={{ color: isFullyRefunded ? th.textMute : th.text, whiteSpace: 'nowrap' }}>{euro(p.amount)}</b>
                {!isFullyRefunded && (
                  <button type="button" onClick={() => onRefund(p)} disabled={busy}
                    style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 9, padding: '4px 9px', cursor: busy ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Rembourser
                  </button>
                )}
                <button type="button" onClick={() => onReceipt(p)}
                  style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, borderRadius: 9, padding: '4px 9px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  Reçu
                </button>
              </div>
            );
          })}
          {shown.length === 0 && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, paddingTop: 6 }}>Aucun encaissement.</div>}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontFamily: th.fontMono, fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textFaint, marginBottom: 8 }}>Compter la caisse</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {moneyChips.map((m) => (
            <span key={m} style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: '5px 12px', background: th.surface2, color: th.text }}>
              {METHOD_LABEL[m]} {euro(totalsByMethod[m])}
            </span>
          ))}
          {moneyChips.length === 0 && <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>Aucune entrée d'argent.</span>}
        </div>
        {prepaidChips.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${th.line}` }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, alignSelf: 'center' }}>Consommations prépayées (pas d'argent) :</span>
            {prepaidChips.map((m) => (
              <span key={m} style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, borderRadius: 999, padding: '4px 10px', background: 'transparent', color: th.textMute, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                {METHOD_LABEL[m]} {euro(totalsByMethod[m])}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `cd frontend && node node_modules/jest/bin/jest.js DayJournal`
Expected: PASS.

- [ ] **Step 5 : Type-check + commit**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit` (aucune erreur nouvelle).

```bash
git add frontend/components/admin/ventes/DayJournal.tsx frontend/__tests__/DayJournal.test.tsx
git commit -m "feat(caisse): composant DayJournal (journal filtrable + compter la caisse)"
```

---

## Task 4 : Composant `SellPanel` (vente unifiée carnets + abonnements)

**Files:**
- Create: `frontend/components/admin/ventes/SellPanel.tsx`
- Test: `frontend/__tests__/SellPanel.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/SellPanel.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SellPanel } from '../components/admin/ventes/SellPanel';
import { ThemeProvider } from '../lib/ThemeProvider';
import type { Member, PackageTemplate, SubscriptionPlan, MemberPackage } from '@/lib/api';

jest.mock('../lib/api', () => ({ api: {}, assetUrl: (u: string | null) => u }));

const member: Member = { id: 'm1', userId: 'u1', firstName: 'Marie', lastName: 'Dupont', email: 'marie@x.fr' } as Member;
const templates: PackageTemplate[] = [
  { id: 't1', kind: 'ENTRIES', name: 'Carnet 10', price: '90.00', entriesCount: 10, isActive: true } as PackageTemplate,
];
const plans: SubscriptionPlan[] = [
  { id: 'pl1', name: 'Abo Or', monthlyPrice: '39.00', isActive: true } as SubscriptionPlan,
];

const base = {
  members: [member], templates, plans, buyer: member, buyerPackages: [] as MemberPackage[],
  busy: false, onPickBuyer: jest.fn(), onClear: jest.fn(), onCreate: jest.fn(), onSell: jest.fn(),
};
const renderPanel = (over = {}) => render(<ThemeProvider><SellPanel {...base} {...over} /></ThemeProvider>);

it('propose carnets ET abonnements dans le même panneau', () => {
  renderPanel();
  expect(screen.getByText(/Carnet 10/)).toBeInTheDocument();
  expect(screen.getByText(/Abo Or/)).toBeInTheDocument();
});

it('sélectionner une offre puis Encaisser remonte onSell avec la sélection', () => {
  const onSell = jest.fn();
  renderPanel({ onSell });
  fireEvent.click(screen.getByText(/Carnet 10/));
  fireEvent.click(screen.getByRole('button', { name: /Encaisser/ }));
  expect(onSell).toHaveBeenCalledWith(expect.objectContaining({ kind: 'package', id: 't1', method: 'CASH' }));
});

it('Ticket CE exige une référence avant de vendre', () => {
  const onSell = jest.fn();
  renderPanel({ onSell });
  fireEvent.click(screen.getByText(/Abo Or/));
  fireEvent.click(screen.getByRole('button', { name: 'Ticket CE' }));
  fireEvent.click(screen.getByRole('button', { name: /Encaisser/ }));
  expect(onSell).not.toHaveBeenCalled();               // bloqué : réf manquante
  fireEvent.change(screen.getByPlaceholderText(/N° du ticket/), { target: { value: 'ANCV-1' } });
  fireEvent.click(screen.getByRole('button', { name: /Encaisser/ }));
  expect(onSell).toHaveBeenCalledWith(expect.objectContaining({ kind: 'subscription', id: 'pl1', method: 'VOUCHER', voucherRef: 'ANCV-1' }));
});

it('sans acheteur, invite à choisir un membre', () => {
  renderPanel({ buyer: null });
  expect(screen.queryByText(/Carnet 10/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd frontend && node node_modules/jest/bin/jest.js SellPanel`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Implémenter le composant**

Créer `frontend/components/admin/ventes/SellPanel.tsx` :

```tsx
'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { packageLabel } from '@/lib/packages';
import { Btn } from '@/components/ui/atoms';
import { PlayerPicker } from '@/components/admin/PlayerPicker';
import type { Member, PackageTemplate, SubscriptionPlan, MemberPackage, PaymentMethod, CreateMemberBody } from '@/lib/api';

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', VOUCHER: 'Ticket CE', OTHER: 'Autre',
};
const SALE_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'VOUCHER', 'OTHER'];

export interface SellSelection {
  kind: 'package' | 'subscription';
  id: string;
  method: PaymentMethod;
  voucherRef?: string;
  voucherIssuer?: string;
}

interface Offer { key: string; kind: 'package' | 'subscription'; id: string; name: string; price: string; suffix?: string }

const euro = (s: string) => `${Number(s).toFixed(2).replace('.', ',')} €`;

/** Panneau de vente unifié : un seul acheteur, carnets ET abonnements groupés. */
export function SellPanel({ members, templates, plans, buyer, buyerPackages, busy, onPickBuyer, onClear, onCreate, onSell }: {
  members: Member[];
  templates: PackageTemplate[];
  plans: SubscriptionPlan[];
  buyer: Member | null;
  buyerPackages: MemberPackage[];
  busy: boolean;
  onPickBuyer: (m: Member) => void;
  onClear: () => void;
  onCreate: (body: CreateMemberBody) => Promise<{ tempPassword: string | null; existed: boolean }>;
  onSell: (sel: SellSelection) => void;
}) {
  const { th } = useTheme();
  const [selKey, setSelKey] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [ref, setRef] = useState('');
  const [issuer, setIssuer] = useState('');
  const [refError, setRefError] = useState(false);

  const packageOffers: Offer[] = templates.map((t) => ({ key: `package:${t.id}`, kind: 'package', id: t.id, name: t.name, price: t.price }));
  const planOffers: Offer[] = plans.map((p) => ({ key: `subscription:${p.id}`, kind: 'subscription', id: p.id, name: p.name, price: p.monthlyPrice, suffix: '/mois' }));
  const selected = [...packageOffers, ...planOffers].find((o) => o.key === selKey) ?? null;

  const card = { background: th.surface, borderRadius: 16, padding: 18, boxShadow: th.shadow } as const;
  const sectionTitle = { fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 as const, color: th.text, marginBottom: 12 };
  const groupLabel = { fontFamily: th.fontMono, fontSize: 10, fontWeight: 600 as const, letterSpacing: 0.5, textTransform: 'uppercase' as const, color: th.textFaint, margin: '10px 0 6px' };
  const input = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 } as const;

  const offerRow = (o: Offer) => {
    const active = o.key === selKey;
    return (
      <button key={o.key} type="button" onClick={() => { setSelKey(o.key); setRefError(false); }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left',
          border: `1px solid ${active ? th.accent : th.line}`, background: active ? `${th.accent}12` : 'transparent', color: th.text,
          borderRadius: 10, padding: '9px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>{o.name}</span>
        <span style={{ color: active ? th.accent : th.textMute, fontWeight: 700, whiteSpace: 'nowrap' }}>{euro(o.price)}{o.suffix ?? ''}</span>
      </button>
    );
  };

  const sell = () => {
    if (!selected) return;
    if (method === 'VOUCHER' && !ref.trim()) { setRefError(true); return; }
    onSell({
      kind: selected.kind, id: selected.id, method,
      voucherRef: method === 'VOUCHER' ? ref.trim() : undefined,
      voucherIssuer: method === 'VOUCHER' ? issuer.trim() || undefined : undefined,
    });
    setSelKey(''); setRef(''); setIssuer(''); setRefError(false);
  };

  return (
    <div style={card}>
      <div style={sectionTitle}>Vendre à un membre</div>
      <div style={{ marginBottom: 12 }}>
        <PlayerPicker
          members={members}
          value={buyer ? { firstName: buyer.firstName, lastName: buyer.lastName } : null}
          onSelect={onPickBuyer}
          onClear={() => { onClear(); setSelKey(''); }}
          onCreate={onCreate}
          placeholder="Cliquez pour voir les membres, ou tapez un nom…"
        />
      </div>

      {buyer && (
        <>
          {buyerPackages.length > 0 && (
            <div style={{ marginBottom: 10, fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
              Soldes actuels : {buyerPackages.map((p) => packageLabel(p)).join(' · ')}
            </div>
          )}

          {packageOffers.length > 0 && <div style={groupLabel}>Carnets &amp; cartes</div>}
          {packageOffers.map(offerRow)}
          {planOffers.length > 0 && <div style={groupLabel}>Abonnements</div>}
          {planOffers.map(offerRow)}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
            {SALE_METHODS.map((m) => (
              <button key={m} type="button" onClick={() => { setMethod(m); setRefError(false); }}
                style={{ border: `1px solid ${method === m ? th.accent : th.line}`, background: method === m ? th.accent : 'transparent',
                  color: method === m ? th.onAccent : th.text, borderRadius: 999, padding: '5px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>

          {method === 'VOUCHER' && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <input type="text" value={ref} onChange={(e) => { setRef(e.target.value); setRefError(false); }} placeholder="N° du ticket"
                style={{ ...input, flex: 1, minWidth: 120, border: `1px solid ${refError ? '#ff7a4d' : th.line}` }} />
              <input type="text" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="ANCV…" style={{ ...input, width: 110 }} />
            </div>
          )}

          <Btn type="button" icon="check" onClick={sell} disabled={busy || !selected}>
            {busy ? '…' : selected ? `Encaisser ${euro(selected.price)}${selected.suffix ?? ''}` : 'Encaisser'}
          </Btn>
        </>
      )}
    </div>
  );
}
```

> Vérifier que `th.onAccent` existe (utilisé par les chips de moyen actifs) — il est exposé par le thème (`ThemeProvider`). Si absent, remplacer par `'#fff'`.

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `cd frontend && node node_modules/jest/bin/jest.js SellPanel`
Expected: PASS.

- [ ] **Step 5 : Type-check + commit**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit` (aucune erreur nouvelle).

```bash
git add frontend/components/admin/ventes/SellPanel.tsx frontend/__tests__/SellPanel.test.tsx
git commit -m "feat(caisse): composant SellPanel (vente unifiee carnets + abonnements)"
```

---

## Task 5 : Recomposer la page + suite d'intégration

**Files:**
- Modify: `frontend/app/admin/caisse/page.tsx` (réécriture du rendu + ajout navigation de date + fetch tendance)
- Test: `frontend/__tests__/AdminCaisse.test.tsx`

- [ ] **Step 1 : Écrire la suite d'intégration qui échoue**

Créer `frontend/__tests__/AdminCaisse.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminCaissePage from '../app/admin/caisse/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1', timezone: 'Europe/Paris' } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetCaisse: jest.fn().mockResolvedValue({
      date: '2026-07-10', collected: '115.00',
      totalsByMethod: { CASH: '25.00', CARD: '90.00' },
      payments: [
        { id: 'p1', amount: '25.00', method: 'CASH', participantId: null, payerName: 'Karim', note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2026-07-10T15:30:00.000Z', status: 'CAPTURED', refundedAmount: '0.00', receiptNo: null, reservation: { id: 'rv-1', startTime: '2026-07-10T15:00:00.000Z', resource: { name: 'Padel 1' }, user: { firstName: 'Karim', lastName: 'B.' } }, memberPackage: null },
        { id: 'p2', amount: '90.00', method: 'CARD', participantId: null, payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2026-07-10T16:04:00.000Z', status: 'CAPTURED', refundedAmount: '0.00', receiptNo: null, reservation: null, memberPackage: { id: 'mp', kind: 'ENTRIES', user: { firstName: 'Marie', lastName: 'Dupont' }, template: { name: 'Carnet 10' } } },
      ],
    }),
    adminGetReservations: jest.fn().mockResolvedValue({ reservations: [], summary: { total: '0', paid: '0', paidTotal: '0', outstanding: '297.00' } }),
    adminGetVouchers: jest.fn().mockResolvedValue([]),
    adminGetMembers: jest.fn().mockResolvedValue([{ id: 'm1', userId: 'u1', firstName: 'Marie', lastName: 'Dupont', email: 'marie@x.fr' }]),
    adminGetPackageTemplates: jest.fn().mockResolvedValue([{ id: 't1', kind: 'ENTRIES', name: 'Carnet 10', price: '90.00', entriesCount: 10, isActive: true }]),
    adminGetSubscriptionPlans: jest.fn().mockResolvedValue([{ id: 'pl1', name: 'Abo Or', monthlyPrice: '39.00', isActive: true }]),
    adminGetClub: jest.fn().mockResolvedValue({ name: 'Club', address: 'X', timezone: 'Europe/Paris' }),
    adminAccountingSummary: jest.fn().mockResolvedValue({ year: 2026, month: 7, totalsByMethod: {}, collected: '0', refunded: '0', byDay: [{ date: '2026-07-03', net: '80.00' }, { date: '2026-07-10', net: '115.00' }] }),
    adminGetMemberPackages: jest.fn().mockResolvedValue([]),
    adminSellPackage: jest.fn().mockResolvedValue({ id: 'sale' }),
    adminSellSubscription: jest.fn().mockResolvedValue({ id: 'sale' }),
    adminSetVoucherStatus: jest.fn().mockResolvedValue({ id: 'v' }),
    refundPayment: jest.fn().mockResolvedValue({ id: 'r' }),
  },
  assetUrl: (u: string | null) => u,
}));

const renderPage = () => render(<ThemeProvider><AdminCaissePage /></ThemeProvider>);
beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); });

it('affiche le bandeau KPI (encaissé + reste dû)', async () => {
  renderPage();
  expect(await screen.findByText('115,00 €')).toBeInTheDocument();
  expect(screen.getByText('297,00 €')).toBeInTheDocument();
});

it('le journal liste les encaissements avec heure locale', async () => {
  renderPage();
  expect(await screen.findByText('17:30')).toBeInTheDocument();
});

it('filtre « Ventes » masque les paiements liés à une résa', async () => {
  renderPage();
  await screen.findByText('17:30');
  fireEvent.click(screen.getByRole('button', { name: 'Ventes' }));
  expect(screen.queryByText(/Padel 1/)).not.toBeInTheDocument();
  expect(screen.getByText(/Marie Dupont/)).toBeInTheDocument();
});

it('vend un abonnement depuis le panneau unifié', async () => {
  renderPage();
  fireEvent.click(await screen.findByText(/Marie Dupont/, { selector: '*' }).catch(() => screen.getByText('Marie Dupont')));
  // sélectionner l'acheteur via le PlayerPicker
  fireEvent.click(screen.getByPlaceholderText(/Cliquez pour voir les membres/));
  fireEvent.click(await screen.findByText('Marie Dupont'));
  fireEvent.click(await screen.findByText(/Abo Or/));
  fireEvent.click(screen.getByRole('button', { name: /Encaisser/ }));
  await waitFor(() => expect(api.adminSellSubscription).toHaveBeenCalledWith('club-1', 'u1', expect.objectContaining({ planId: 'pl1' }), 'tok'));
});

it('navigation de date : « jour suivant » recharge au lendemain', async () => {
  renderPage();
  await screen.findByText('115,00 €');
  fireEvent.click(screen.getByRole('button', { name: /jour suivant/i }));
  await waitFor(() => expect(api.adminGetCaisse).toHaveBeenCalledWith('club-1', '2026-07-11', 'tok'));
});
```

> Note : le 4ᵉ test suppose que le `PlayerPicker` ouvre une liste au clic sur son champ et affiche « Marie Dupont ». Si l'API réelle du `PlayerPicker` diffère (ex. il faut taper), adapter : `fireEvent.change(screen.getByPlaceholderText(/Cliquez/), { target: { value: 'Marie' } })` puis cliquer le résultat. Vérifier `frontend/components/admin/PlayerPicker.tsx` avant d'écrire l'implémentation et ajuster le test à son contrat réel.

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd frontend && node node_modules/jest/bin/jest.js AdminCaisse`
Expected: FAIL (KPI/heure/filtre absents — page pas encore recomposée).

- [ ] **Step 3 : Recomposer la page**

Réécrire `frontend/app/admin/caisse/page.tsx`. **Conserver** tout l'état et les handlers existants (`load`, `pickBuyer`, `createBuyer`, `reimburse`, `openRefund`, `doRefund`, modales reçu + remboursement) mais : (a) fusionner `sell`/`sellSub` en un seul handler `onSell(sel)` piloté par `SellPanel` ; (b) ajouter le fetch tendance ; (c) ajouter la navigation de date ; (d) remplacer le bloc « totaux du jour » + les deux cartes de vente + la carte tickets par les nouveaux composants.

Remplacer les imports en tête par :

```tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, CaissePayment, CaisseSummary, Member, MemberPackage, PackageTemplate, PaymentMethod, CreateMemberBody, ClubAdminDetail, SubscriptionPlan } from '@/lib/api';
import { toCents, fmtEuros, validatePaymentAmount, trendSeries, TrendModel } from '@/lib/caisse';
import { addDaysKey, frLongLabel, frWeekday, todayKey } from '@/lib/calendar';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { DateField } from '@/components/ui/DateField';
import { Receipt } from '@/components/admin/Receipt';
import { TrendKpis } from '@/components/admin/ventes/TrendKpis';
import { DayJournal, JournalFilter } from '@/components/admin/ventes/DayJournal';
import { SellPanel, SellSelection } from '@/components/admin/ventes/SellPanel';
```

Corps du composant (remplacer `todayISO` par `todayKey`, ajouter l'état tendance/filtre, fusionner la vente). État additionnel :

```tsx
  const tz = club?.timezone ?? 'Europe/Paris';
  const [date, setDate]       = useState(todayKey());
  const [caisse, setCaisse]   = useState<CaisseSummary | null>(null);
  const [outstanding, setOut] = useState('0.00');
  const [vouchers, setVouchers] = useState<CaissePayment[]>([]);
  const [trend, setTrend]     = useState<TrendModel | null>(null);
  const [filter, setFilter]   = useState<JournalFilter>('all');
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [clubDetail, setClubDetail] = useState<ClubAdminDetail | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<CaissePayment | null>(null);
  const [members, setMembers]     = useState<Member[]>([]);
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [plans, setPlans]         = useState<SubscriptionPlan[]>([]);
  const [buyer, setBuyer]         = useState<Member | null>(null);
  const [buyerPackages, setBuyerPackages] = useState<MemberPackage[]>([]);
  // remboursement (inchangé)
  const [refundTarget, setRefundTarget] = useState<CaissePayment | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
```

`load` — ajouter le fetch tendance (1 ou 2 mois selon chevauchement) :

```tsx
  const load = useCallback(async () => {
    if (!token || !clubId) return;
    try {
      setError(null);
      const startKey = addDaysKey(date, -7);
      const mEnd = { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) };
      const mStart = { y: Number(startKey.slice(0, 4)), m: Number(startKey.slice(5, 7)) };
      const sameMonth = mEnd.y === mStart.y && mEnd.m === mStart.m;
      const [c, resv, v, mem, tpl, detail, pls, ...sums] = await Promise.all([
        api.adminGetCaisse(clubId, date, token),
        api.adminGetReservations(clubId, { date }, token),
        api.adminGetVouchers(clubId, 'PENDING_REIMBURSEMENT', token),
        api.adminGetMembers(clubId, token),
        api.adminGetPackageTemplates(clubId, token),
        api.adminGetClub(clubId, token),
        api.adminGetSubscriptionPlans(clubId, token),
        api.adminAccountingSummary(clubId, mEnd.y, mEnd.m, token),
        ...(sameMonth ? [] : [api.adminAccountingSummary(clubId, mStart.y, mStart.m, token)]),
      ]);
      setCaisse(c);
      setOut(resv.summary.outstanding);
      setVouchers(v);
      setMembers(mem);
      setTemplates(tpl.filter((t) => t.isActive));
      setClubDetail(detail);
      setPlans(pls.filter((p) => p.isActive));
      setTrend(trendSeries(sums.flatMap((s) => s.byDay), date));
    } catch (e) { setError((e as Error).message); }
  }, [token, clubId, date]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);
```

`pickBuyer` / `createBuyer` : inchangés (copier depuis la version actuelle).

Vente unifiée (remplace `sell` + `sellSub`) :

```tsx
  const onSell = async (sel: SellSelection) => {
    if (!token || !clubId || !buyer) return;
    setBusy(true);
    try {
      setError(null);
      const common = {
        method: sel.method, payerName: `${buyer.firstName} ${buyer.lastName}`,
        voucherRef: sel.voucherRef, voucherIssuer: sel.voucherIssuer,
      };
      if (sel.kind === 'package') await api.adminSellPackage(clubId, buyer.userId, { templateId: sel.id, ...common }, token);
      else await api.adminSellSubscription(clubId, buyer.userId, { planId: sel.id, ...common }, token);
      await Promise.all([load(), pickBuyer(buyer)]);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
```

`reimburse`, `openRefund`, `doRefund` : inchangés (copier depuis la version actuelle). Supprimer les variables devenues inutiles (`sellTplId`, `sellPlanId`, `sellMethod`, `sellRef`, `sellIssuer`, `moneyTotal` calculé — le remplacer par `collectedCents`), et les constantes `SALE_METHODS`, `paymentLabel` (déplacées dans les composants ; garder `paymentLabel` **uniquement** si encore utilisé par la modale remboursement — oui, il l'est → conserver `paymentLabel` en haut de fichier).

Rendu (remplace tout le `return`) :

```tsx
  const collectedCents = caisse
    ? (['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'OTHER', 'VOUCHER'] as PaymentMethod[])
        .reduce((s, m) => s + toCents(caisse.totalsByMethod[m] ?? '0'), 0)
    : 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 0 18px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: 0, color: th.text }}>Ventes &amp; journée</h1>
          <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 2, textTransform: 'capitalize' }}>{frLongLabel(date)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" aria-label="Jour précédent" onClick={() => setDate(addDaysKey(date, -1))}
            style={{ border: `1px solid ${th.line}`, background: th.surface, color: th.text, borderRadius: 9, width: 34, height: 34, cursor: 'pointer', fontSize: 16 }}>‹</button>
          <DateField value={date} onChange={setDate} size="sm" />
          <button type="button" aria-label="Jour suivant" onClick={() => setDate(addDaysKey(date, 1))}
            style={{ border: `1px solid ${th.line}`, background: th.surface, color: th.text, borderRadius: 9, width: 34, height: 34, cursor: 'pointer', fontSize: 16 }}>›</button>
        </div>
      </div>

      {error && <div style={{ marginBottom: 16, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {trend && <TrendKpis collectedCents={collectedCents} outstanding={outstanding} count={caisse?.payments.length ?? 0} trend={trend} weekday={frWeekday(date)} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(300px, 1fr)', gap: 18, alignItems: 'start' }} className="ventes-grid">
        <DayJournal
          payments={caisse?.payments ?? []}
          tz={tz}
          totalsByMethod={caisse?.totalsByMethod ?? {}}
          filter={filter}
          onFilter={setFilter}
          onReceipt={setReceiptTarget}
          onRefund={openRefund}
          busy={busy}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SellPanel
            members={members} templates={templates} plans={plans}
            buyer={buyer} buyerPackages={buyerPackages} busy={busy}
            onPickBuyer={pickBuyer} onClear={() => { setBuyer(null); setBuyerPackages([]); }}
            onCreate={createBuyer} onSell={onSell}
          />
          <div style={{ background: th.surface, borderRadius: 16, padding: 18, boxShadow: th.shadow }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text, marginBottom: 12 }}>Tickets CE à rembourser ({vouchers.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {vouchers.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 13, color: th.text, padding: '8px 0', borderTop: `1px solid ${th.line}` }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{paymentLabel(p)}</span>
                  <span style={{ color: th.textMute, fontSize: 12 }}>{p.voucherRef}</span>
                  <b>{`${Number(p.amount).toFixed(2).replace('.', ',')} €`}</b>
                  <button type="button" onClick={() => reimburse(p)} disabled={busy}
                    style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 9, padding: '5px 10px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600 }}>
                    Remboursé
                  </button>
                </div>
              ))}
              {vouchers.length === 0 && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>Aucun ticket en attente.</div>}
            </div>
          </div>
        </div>
      </div>

      <style>{`@media (max-width: 860px) { .ventes-grid { grid-template-columns: 1fr !important; } .ventes-grid > div:last-child { order: -1; } }`}</style>

      {/* modale reçu imprimable — INCHANGÉE (copier depuis la version actuelle) */}
      {/* modale remboursement — INCHANGÉE (copier depuis la version actuelle) */}
    </div>
  );
```

> **Important :** recopier verbatim les deux blocs modaux (reçu imprimable lignes 362-387 et remboursement lignes 390-436 de l'actuel `page.tsx`) à la place des commentaires. Ils utilisent `paymentLabel`, `Receipt`, `clubDetail`, `validatePaymentAmount`, `refundTarget`… tous conservés. En mobile, `order: -1` sur la 2ᵉ colonne fait remonter Vendre + Tickets CE au-dessus du journal (au comptoir sur téléphone, vendre prime).

- [ ] **Step 4 : Vérifier le contrat du PlayerPicker et ajuster le test si besoin**

Run: `sed -n '1,60p' frontend/components/admin/PlayerPicker.tsx` (ou Read) pour confirmer comment sélectionner un membre (clic sur champ → liste, ou saisie). Ajuster le 4ᵉ test de `AdminCaisse.test.tsx` en conséquence.

- [ ] **Step 5 : Lancer la suite d'intégration**

Run: `cd frontend && node node_modules/jest/bin/jest.js AdminCaisse`
Expected: PASS (5 tests).

- [ ] **Step 6 : Type-check strict**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur. Corriger tout import inutilisé résiduel (`fmtEuros`, `Btn` si plus utilisés dans la page — `Btn` reste utilisé par la modale remboursement ; `fmtEuros` peut ne plus l'être → retirer de l'import si `tsc`/lint le signale).

- [ ] **Step 7 : Non-régression des suites caisse existantes**

Run: `cd frontend && node node_modules/jest/bin/jest.js caisse.test calendar.test TrendKpis DayJournal SellPanel AdminCaisse`
Expected: toutes vertes.

- [ ] **Step 8 : Commit**

```bash
git add frontend/app/admin/caisse/page.tsx frontend/__tests__/AdminCaisse.test.tsx
git commit -m "feat(caisse): recompose Ventes & journee (KPI + journal + vente unifiee + nav date)"
```

---

## Task 6 : Vérification visuelle

**Files:** aucun (vérification).

- [ ] **Step 1 : Vérifier la page en clair + sombre, desktop + mobile**

Utiliser le skill `verify` sur `/admin/caisse` (session admin authentifiée). Contrôler :
- Bandeau KPI : encaissé en accent, reste dû, nb encaissements, sparkline 7 jours + delta lisible.
- Journal : heures locales correctes, chips de moyen colorées (CB accent, CE coral), Reçu/Rembourser cliquables, filtres Tout/Ventes/Résas.
- Carte « Compter la caisse » : chips par moyen d'argent + ligne prépayés à part.
- Panneau Vendre : sélection membre, offres groupées Carnets/Abonnements, chips de moyen, CE → réf/émetteur, CTA « Encaisser {prix} ».
- Navigation de date : ‹ / › changent le jour et rechargent ; libellé français « vendredi 10 juillet ».
- **Mobile 390** (skill verify avec `mobile:false` + largeur fixe 390 — cf. mémoire *verify-mobile-overflow-emulation*) : pas de débordement horizontal, Vendre + Tickets CE au-dessus du journal.

- [ ] **Step 2 : Corriger les écarts visuels éventuels**

Si un contraste/dépassement apparaît, corriger dans le composant concerné (styles inline), relancer la suite scoped, re-vérifier.

- [ ] **Step 3 : Commit final si corrections**

```bash
git add -A frontend/
git commit -m "fix(caisse): ajustements visuels Ventes & journee (clair/sombre/mobile)"
```

---

## Self-Review (checklist de l'auteur du plan)

- **Couverture spec :** KPI + reste dû + nb encaissements (Task 2/5) ✓ ; sparkline 7 jours + delta S-1 (Task 1 `trendSeries` + Task 2) ✓ ; journal horodaté filtrable Tout/Ventes/Résas (Task 1 `hhmm`/`isSalePayment` + Task 3) ✓ ; « Compter la caisse » money vs prépayé (Task 3) ✓ ; panneau Vendre unifié carnets+abos + CE (Task 4) ✓ ; tickets CE conservés (Task 5) ✓ ; navigation de date française (Task 1 `addDaysKey`/`frLongLabel`/`frWeekday` + Task 5) ✓ ; reçu + remboursement conservés (Task 5) ✓ ; 100 % frontend, aucune migration ✓.
- **Placeholders :** les deux blocs modaux sont marqués « copier verbatim depuis lignes X-Y » avec référence exacte — pas un vrai placeholder (le code source existe et est cité). Le contrat `PlayerPicker` est vérifié en Task 5 Step 4 avant d'écrire l'implémentation.
- **Cohérence des types :** `TrendModel`/`TrendPoint` définis en Task 1, consommés en Task 2/5 ; `JournalFilter` défini en Task 3, importé en Task 5 ; `SellSelection` défini en Task 4, consommé par `onSell` en Task 5. `onSell(sel)` → `adminSellPackage({ templateId })` / `adminSellSubscription({ planId })` : signatures conformes à `lib/api.ts`.
- **Ambiguïté levée :** le delta compare au **même jour de semaine S-1** (J-7), pas à J-1 ; `deltaPct` null si S-1=0.
