# Réglages du club — onglets + barre sticky + contrôles polis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer `/admin/settings` (11 cartes empilées, un bouton Enregistrer caché en bas) en une page à 5 onglets avec barre d'enregistrement sticky globale et contrôles modernisés (presets en chips, interrupteurs, éditeur d'heures creuses au TimePicker).

**Architecture:** 100 % frontend, aucun changement backend, aucune migration — le PATCH `adminUpdateClub` existant couvre déjà tous les champs. La page devient un orchestrateur qui tient **deux états** : `server` (baseline chargée) et `draft` (édité). Les composants d'onglet sont des vues pures pilotées par `draft` + un setter. Un helper pur `buildUpdateBody` sérialise le body de PATCH et sert aussi au calcul « dirty ». Logo et couverture restent persistés à l'upload (ils synchronisent `server` **et** `draft` pour ne jamais rendre le brouillon dirty).

**Tech Stack:** Next.js 16 (client component), React, TypeScript, Jest + React Testing Library. Réutilise `TimePicker` (`components/ui/TimePicker.tsx`), le pattern feuille `MatchAlertSheet`, `Segmented`/`Pill` (`components/ui/atoms.tsx`), `CANCEL_PRESETS` (`lib/onboarding.ts`), tokens de thème via `useTheme`.

**Spec:** `docs/superpowers/specs/2026-07-15-admin-reglages-onglets-design.md`

---

## File Structure

**Créés :**
- `frontend/lib/adminSettings.ts` — helpers purs (défs d'onglets, parse `?tab=`, `buildUpdateBody`, `isDirty`, presets, `offPeakChipLabel`).
- `frontend/components/admin/settings/PresetChips.tsx` — chips de presets numériques + « Autre… » révélant un champ.
- `frontend/components/admin/settings/SwitchRow.tsx` — interrupteur avec titre + description optionnelle.
- `frontend/components/admin/settings/OffPeakRangeSheet.tsx` — feuille d'édition d'une plage creuse (deux `TimePicker` De/À).
- `frontend/components/admin/settings/OffPeakEditor.tsx` — chips de plages par jour + « + plage » (ouvre la feuille) + « × » (supprime).
- `frontend/components/admin/settings/SaveBar.tsx` — barre sticky d'enregistrement.
- `frontend/components/admin/settings/SettingsIdentity.tsx` — onglet Identité (profil + identité visuelle).
- `frontend/components/admin/settings/SettingsBooking.tsx` — onglet Réservation (fenêtres + délais).
- `frontend/components/admin/settings/SettingsPricing.tsx` — onglet Tarifs & quotas (heures creuses + quotas).
- `frontend/components/admin/settings/SettingsCollect.tsx` — onglet Caisse & paiement.
- `frontend/components/admin/settings/SettingsVisibility.tsx` — onglet Visibilité & joueurs.
- `frontend/components/admin/settings/shared.ts` — styles partagés (`useSettingsStyles`) + type `SettingsTabProps`.
- Tests : `frontend/__tests__/adminSettings.test.ts`, `PresetChips.test.tsx`, `SwitchRow.test.tsx`, `OffPeakEditor.test.tsx`, `SaveBar.test.tsx`, `AdminSettings.test.tsx`.

**Modifiés :**
- `frontend/app/admin/settings/page.tsx` — réécrit en orchestrateur.
- `frontend/lib/onboarding.ts:38` — la ligne checklist « Logo & couleur » deep-linke `?tab=identite`.
- `frontend/__tests__/AdminSettings.refresh.test.tsx` — mock du club enrichi si besoin (voir Task 9).

---

## Task 1: Helpers purs `lib/adminSettings.ts`

**Files:**
- Create: `frontend/lib/adminSettings.ts`
- Test: `frontend/__tests__/adminSettings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/__tests__/adminSettings.test.ts`:

```typescript
import {
  SETTINGS_TABS, parseTab, buildUpdateBody, isDirty, offPeakChipLabel,
  DAY_PRESETS_PUBLIC, DAY_PRESETS_MEMBER,
} from '@/lib/adminSettings';
import type { ClubAdminDetail } from '@/lib/api';

const CLUB: ClubAdminDetail = {
  id: 'c1', slug: 'demo', name: 'Démo', description: '', address: 'a', city: '', country: '',
  timezone: 'Europe/Paris', logoUrl: '', coverImageUrl: null, accentColor: '#5e93da', defaultThemeMode: 'daylight',
  status: 'ACTIVE', listedInDirectory: true, listTournamentsNationally: false, showOffersPublicly: false,
  publicBookingDays: 7, memberBookingDays: 14, bookingReleaseMode: 'DAY_AT_HOUR', publicReleaseHour: 8, memberReleaseHour: 8,
  offPeakHours: null, bookingQuotas: null, playerChangeCutoffHours: 2, cancellationCutoffHours: 2,
  showOtherClubsReservations: false, refundOnCancelWithinCutoff: false, levelSystemEnabled: true,
  stripeAccountId: null, stripeAccountStatus: 'ACTIVE', requireOnlinePayment: true, requireCardFingerprint: true,
  quickPaymentMethods: ['CARD'], payAtClubOnly: false,
  legalEntityName: '', legalForm: '', siret: '', vatNumber: '', legalRepresentative: '', legalEmail: '', legalPhone: '',
};

describe('adminSettings helpers', () => {
  it('exposes 5 tabs in order', () => {
    expect(SETTINGS_TABS.map((t) => t.key)).toEqual(['identite', 'reservation', 'tarifs', 'caisse', 'visibilite']);
  });

  it('parseTab reads ?tab= and defaults/sanitizes to identite', () => {
    expect(parseTab('?tab=caisse')).toBe('caisse');
    expect(parseTab('?foo=1')).toBe('identite');
    expect(parseTab('?tab=bogus')).toBe('identite');
    expect(parseTab('')).toBe('identite');
  });

  it('buildUpdateBody includes showOtherClubsReservations (fixes the persisted-toggle bug)', () => {
    const body = buildUpdateBody({ ...CLUB, showOtherClubsReservations: true });
    expect(body.showOtherClubsReservations).toBe(true);
  });

  it('buildUpdateBody sends offPeakHours=null when the map is empty', () => {
    expect(buildUpdateBody({ ...CLUB, offPeakHours: {} }).offPeakHours).toBeNull();
    expect(buildUpdateBody({ ...CLUB, offPeakHours: { 1: [{ start: 9, end: 12 }] } }).offPeakHours)
      .toEqual({ 1: [{ start: 9, end: 12 }] });
  });

  it('isDirty is false for identical draft and true after any saved-field change', () => {
    expect(isDirty(CLUB, { ...CLUB })).toBe(false);
    expect(isDirty(CLUB, { ...CLUB, name: 'Autre' })).toBe(true);
    expect(isDirty(CLUB, { ...CLUB, bookingQuotas: { model: 'WEEKLY', subscriber: { peak: null, offPeak: null }, nonSubscriber: { peak: null, offPeak: null } } })).toBe(true);
  });

  it('offPeakChipLabel formats a range as "9h00 → 12h30"', () => {
    expect(offPeakChipLabel({ start: 9, end: 12 })).toBe('9h00 → 12h00');
    expect(offPeakChipLabel({ start: 9, startMin: 30, end: 12, endMin: 15 })).toBe('9h30 → 12h15');
  });

  it('exposes independent day presets for public and members', () => {
    expect(DAY_PRESETS_PUBLIC).toEqual([7, 14, 30]);
    expect(DAY_PRESETS_MEMBER).toEqual([14, 28, 60]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && node node_modules/jest/bin/jest.js adminSettings.test -c jest.config.js`
Expected: FAIL — `Cannot find module '@/lib/adminSettings'`.

- [ ] **Step 3: Write the helper module**

Create `frontend/lib/adminSettings.ts`:

```typescript
// Helpers PURS de la page Réglages du club. Aucune horloge, aucun fetch, aucun JSX.
import type { ClubAdminDetail, UpdateClubBody, OffPeakRange } from '@/lib/api';

export type SettingsTabKey = 'identite' | 'reservation' | 'tarifs' | 'caisse' | 'visibilite';

export const SETTINGS_TABS: { key: SettingsTabKey; label: string }[] = [
  { key: 'identite',   label: 'Identité' },
  { key: 'reservation', label: 'Réservation' },
  { key: 'tarifs',     label: 'Tarifs & quotas' },
  { key: 'caisse',     label: 'Caisse & paiement' },
  { key: 'visibilite', label: 'Visibilité & joueurs' },
];

/** Lit `?tab=` d'une query string ; défaut et valeur inconnue → 'identite'. */
export function parseTab(search: string): SettingsTabKey {
  const raw = new URLSearchParams(search).get('tab');
  return SETTINGS_TABS.some((t) => t.key === raw) ? (raw as SettingsTabKey) : 'identite';
}

/** Presets de fenêtre de réservation (jours), indépendants public / abonnés. */
export const DAY_PRESETS_PUBLIC = [7, 14, 30];
export const DAY_PRESETS_MEMBER = [14, 28, 60];

/**
 * Body du PATCH club depuis un brouillon. UNIQUE source de vérité des champs
 * enregistrés — inclut `showOtherClubsReservations` (que l'ancien save() oubliait).
 * offPeakHours vidé → null (désactive les heures creuses).
 */
export function buildUpdateBody(c: ClubAdminDetail): UpdateClubBody {
  return {
    name: c.name, description: c.description ?? '', address: c.address,
    city: c.city ?? '', timezone: c.timezone, logoUrl: c.logoUrl ?? '',
    coverImageUrl: c.coverImageUrl,
    accentColor: c.accentColor, defaultThemeMode: c.defaultThemeMode,
    listedInDirectory: c.listedInDirectory,
    listTournamentsNationally: c.listTournamentsNationally,
    showOffersPublicly: c.showOffersPublicly,
    levelSystemEnabled: c.levelSystemEnabled,
    publicBookingDays: Number(c.publicBookingDays), memberBookingDays: Number(c.memberBookingDays),
    bookingReleaseMode: c.bookingReleaseMode,
    publicReleaseHour: Number(c.publicReleaseHour), memberReleaseHour: Number(c.memberReleaseHour),
    offPeakHours: c.offPeakHours && Object.keys(c.offPeakHours).length > 0 ? c.offPeakHours : null,
    bookingQuotas: c.bookingQuotas ?? null,
    playerChangeCutoffHours: Number(c.playerChangeCutoffHours),
    cancellationCutoffHours: Number(c.cancellationCutoffHours),
    showOtherClubsReservations: c.showOtherClubsReservations,
    refundOnCancelWithinCutoff: c.refundOnCancelWithinCutoff,
    requireOnlinePayment: c.requireOnlinePayment,
    requireCardFingerprint: c.requireCardFingerprint,
    quickPaymentMethods: c.quickPaymentMethods,
    payAtClubOnly: c.payAtClubOnly ?? false,
  };
}

/** Vrai si le brouillon diffère de la baseline sur un champ enregistré. */
export function isDirty(server: ClubAdminDetail, draft: ClubAdminDetail): boolean {
  return JSON.stringify(buildUpdateBody(server)) !== JSON.stringify(buildUpdateBody(draft));
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Libellé d'une plage creuse, ex. « 9h30 → 12h00 ». */
export function offPeakChipLabel(r: OffPeakRange): string {
  return `${r.start}h${pad2(r.startMin ?? 0)} → ${r.end}h${pad2(r.endMin ?? 0)}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && node node_modules/jest/bin/jest.js adminSettings.test -c jest.config.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/adminSettings.ts frontend/__tests__/adminSettings.test.ts
git commit -m "feat(settings): helpers purs adminSettings (onglets, buildUpdateBody, isDirty)"
```

---

## Task 2: Contrôle partagé `SwitchRow`

**Files:**
- Create: `frontend/components/admin/settings/SwitchRow.tsx`
- Test: `frontend/__tests__/SwitchRow.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/SwitchRow.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { SwitchRow } from '@/components/admin/settings/SwitchRow';

const wrap = (checked: boolean, onChange = jest.fn()) =>
  render(
    <ThemeProvider>
      <SwitchRow checked={checked} onChange={onChange} title="Annuaire public" description="Visible dans la recherche." />
    </ThemeProvider>,
  );

describe('SwitchRow', () => {
  it('renders title + description and reflects checked state', () => {
    wrap(true);
    expect(screen.getByText('Annuaire public')).toBeInTheDocument();
    expect(screen.getByText('Visible dans la recherche.')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange with the negated value on click', () => {
    const onChange = jest.fn();
    wrap(false, onChange);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && node node_modules/jest/bin/jest.js SwitchRow.test -c jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `frontend/components/admin/settings/SwitchRow.tsx`:

```tsx
'use client';
import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
}

/** Interrupteur (switch) avec titre + description optionnelle. Remplace les cases à cocher brutes. */
export function SwitchRow({ checked, onChange, title, description }: Props) {
  const { th } = useTheme();
  return (
    <div
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!checked); } }}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', padding: '4px 0' }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0, marginTop: 1, width: 42, height: 24, borderRadius: 999,
          background: checked ? th.accent : th.line, position: 'relative', transition: 'background .15s',
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? 21 : 3, width: 18, height: 18, borderRadius: '50%',
          background: '#fff', transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        }} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 600, color: th.text }}>{title}</span>
        {description && <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, lineHeight: 1.4 }}>{description}</span>}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && node node_modules/jest/bin/jest.js SwitchRow.test -c jest.config.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/admin/settings/SwitchRow.tsx frontend/__tests__/SwitchRow.test.tsx
git commit -m "feat(settings): SwitchRow (interrupteur titre+description)"
```

---

## Task 3: Contrôle partagé `PresetChips`

**Files:**
- Create: `frontend/components/admin/settings/PresetChips.tsx`
- Test: `frontend/__tests__/PresetChips.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/PresetChips.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { PresetChips } from '@/components/admin/settings/PresetChips';

const wrap = (value: number, onChange = jest.fn(), format?: (n: number) => string) =>
  render(
    <ThemeProvider>
      <PresetChips presets={[7, 14, 30]} value={value} onChange={onChange} unit="jours" format={format} />
    </ThemeProvider>,
  );

describe('PresetChips', () => {
  it('marks the matching preset chip active and hides the custom input', () => {
    wrap(14);
    expect(screen.getByRole('button', { name: '14 jours' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('selects "Autre…" and shows the input when value is off-preset', () => {
    wrap(21);
    expect(screen.getByRole('button', { name: 'Autre…' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('spinbutton')).toHaveValue(21);
  });

  it('emits the preset value on chip click', () => {
    const onChange = jest.fn();
    wrap(7, onChange);
    fireEvent.click(screen.getByRole('button', { name: '30 jours' }));
    expect(onChange).toHaveBeenCalledWith(30);
  });

  it('reveals the input when "Autre…" is clicked and emits typed numbers', () => {
    const onChange = jest.fn();
    wrap(7, onChange);
    fireEvent.click(screen.getByRole('button', { name: 'Autre…' }));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '45' } });
    expect(onChange).toHaveBeenCalledWith(45);
  });

  it('uses format() for chip labels when provided', () => {
    wrap(7, jest.fn(), (n) => (n === 0 ? 'Jusqu’au début' : `${n} h`));
    expect(screen.getByRole('button', { name: '14 h' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && node node_modules/jest/bin/jest.js PresetChips.test -c jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `frontend/components/admin/settings/PresetChips.tsx`:

```tsx
'use client';
import { CSSProperties, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

interface Props {
  presets: number[];
  value: number;
  onChange: (v: number) => void;
  /** Suffixe des libellés par défaut (« 14 jours »). Ignoré si `format` fourni. */
  unit?: string;
  /** Libellé custom par valeur (ex. 0 → « Jusqu'au début »). */
  format?: (n: number) => string;
  min?: number;
  max?: number;
}

/** Presets numériques en chips + « Autre… » révélant un champ. Contrôlé par `value`. */
export function PresetChips({ presets, value, onChange, unit = '', format, min = 0, max = 999 }: Props) {
  const { th } = useTheme();
  const onPreset = presets.includes(value);
  // « Autre… » forcé dès que value est hors presets, ou après clic explicite.
  const [otherOpen, setOtherOpen] = useState(false);
  const showInput = !onPreset || otherOpen;

  const label = (n: number) => (format ? format(n) : `${n}${unit ? ` ${unit}` : ''}`);

  const chip = (active: boolean): CSSProperties => ({
    border: `1px solid ${active ? th.accent : th.line}`,
    background: active ? th.accent : th.surface2,
    color: active ? th.onAccent : th.textMute,
    borderRadius: 999, padding: '8px 14px', cursor: 'pointer',
    fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {presets.map((p) => (
          <button key={p} type="button" aria-pressed={value === p && !otherOpen}
            onClick={() => { setOtherOpen(false); onChange(p); }} style={chip(value === p && !otherOpen)}>
            {label(p)}
          </button>
        ))}
        <button type="button" aria-pressed={showInput} onClick={() => setOtherOpen(true)} style={chip(showInput)}>
          Autre…
        </button>
      </div>
      {showInput && (
        <input
          type="number" min={min} max={max} value={value}
          aria-label="Valeur personnalisée"
          onChange={(e) => onChange(Math.max(min, Math.min(max, Math.trunc(Number(e.target.value) || 0))))}
          style={{
            width: 120, height: 44, padding: '0 12px', borderRadius: 12,
            background: th.bg, color: th.text, border: `1px solid ${th.line}`,
            fontFamily: th.fontUI, fontSize: 15,
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && node node_modules/jest/bin/jest.js PresetChips.test -c jest.config.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/admin/settings/PresetChips.tsx frontend/__tests__/PresetChips.test.tsx
git commit -m "feat(settings): PresetChips (presets numeriques + Autre…)"
```

---

## Task 4: Feuille + éditeur d'heures creuses

**Files:**
- Create: `frontend/components/admin/settings/OffPeakRangeSheet.tsx`
- Create: `frontend/components/admin/settings/OffPeakEditor.tsx`
- Test: `frontend/__tests__/OffPeakEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/OffPeakEditor.test.tsx`:

```typescript
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { OffPeakEditor } from '@/components/admin/settings/OffPeakEditor';
import type { OffPeakHours } from '@/lib/api';

function Harness({ initial }: { initial: OffPeakHours | null }) {
  const [value, setValue] = useState<OffPeakHours | null>(initial);
  return (
    <ThemeProvider>
      <OffPeakEditor value={value} onChange={setValue} />
    </ThemeProvider>
  );
}

describe('OffPeakEditor', () => {
  it('shows existing ranges as chips per day', () => {
    render(<Harness initial={{ 1: [{ start: 9, end: 12 }] }} />);
    expect(screen.getByText('9h00 → 12h00')).toBeInTheDocument();
  });

  it('removes a range when its × is clicked', () => {
    render(<Harness initial={{ 1: [{ start: 9, end: 12 }] }} />);
    fireEvent.click(screen.getByRole('button', { name: /Supprimer la plage/ }));
    expect(screen.queryByText('9h00 → 12h00')).not.toBeInTheDocument();
  });

  it('opens the sheet on "+ plage" and adds a range on validation', () => {
    render(<Harness initial={null} />);
    // Ouvre la feuille pour lundi (1er bouton « + plage »).
    fireEvent.click(screen.getAllByRole('button', { name: '+ plage' })[0]);
    expect(screen.getByRole('dialog', { name: /plage/i })).toBeInTheDocument();
    // La feuille propose un défaut 9h00 → 12h00 ; on valide.
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(screen.getByText('9h00 → 12h00')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && node node_modules/jest/bin/jest.js OffPeakEditor.test -c jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the sheet**

Create `frontend/components/admin/settings/OffPeakRangeSheet.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { TimePicker } from '@/components/ui/TimePicker';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import type { OffPeakRange } from '@/lib/api';

interface Props {
  dayLabel: string;
  /** Plage éditée (édition) ou null (ajout → défaut 9h00–12h00). */
  initial: OffPeakRange | null;
  onClose: () => void;
  onSave: (r: OffPeakRange) => void;
}

const toHHMM = (h: number, m?: number) => `${String(h).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
const fromHHMM = (s: string): { h: number; m: number } => {
  const [h, m] = s.split(':').map(Number);
  return { h: h || 0, m: m || 0 };
};

/** Feuille « brume bleue » d'édition d'une plage creuse : deux TimePicker De/À. */
export function OffPeakRangeSheet({ dayLabel, initial, onClose, onSave }: Props) {
  const { th } = useTheme();
  const [from, setFrom] = useState(toHHMM(initial?.start ?? 9, initial?.startMin));
  const [to, setTo] = useState(toHHMM(initial?.end ?? 12, initial?.endMin));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    const a = fromHHMM(from);
    const b = fromHHMM(to);
    onSave({ start: a.h, startMin: a.m, end: b.h, endMin: b.m });
  };

  const timeLabel: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.textMute, minWidth: 24 };

  return (
    <div role="dialog" aria-label={`Plage creuse — ${dayLabel}`} aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(12,10,6,.5)', backdropFilter: 'blur(2px)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: th.bg, width: '100%', maxWidth: 440, borderRadius: '0 0 22px 22px', boxShadow: th.shadow, boxSizing: 'border-box' }}>
        <div style={{ background: HERO_GRADIENT, padding: '18px 22px', display: 'flex', gap: 13, alignItems: 'center' }}>
          <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="clock" size={20} color={HERO_INK} />
          </div>
          <div>
            <h2 style={{ fontFamily: th.fontDisplay, fontSize: 19, fontWeight: 700, color: HERO_INK, margin: 0 }}>Heures creuses — {dayLabel}</h2>
            <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: HERO_INK_MUTED, margin: '3px 0 0' }}>Tarif réduit sur cette plage.</p>
          </div>
        </div>
        <div style={{ padding: '20px 22px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TimePicker value={from} onChange={setFrom} minuteChips={[]} leading={<span style={timeLabel}>De</span>} />
          <TimePicker value={to} onChange={setTo} minuteChips={[]} leading={<span style={timeLabel}>À</span>} />
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, padding: '11px 14px', borderRadius: 999, border: `1px solid ${th.line}`, background: 'transparent', color: th.text, fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Annuler
            </button>
            <button type="button" onClick={save}
              style={{ flex: 2, padding: '11px 14px', borderRadius: 999, border: 'none', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              {initial ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the editor**

Create `frontend/components/admin/settings/OffPeakEditor.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { offPeakChipLabel } from '@/lib/adminSettings';
import { OffPeakRangeSheet } from './OffPeakRangeSheet';
import type { OffPeakHours, OffPeakRange } from '@/lib/api';

const DAYS: [number, string][] = [
  [1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [7, 'Dimanche'],
];

interface Props {
  value: OffPeakHours | null;
  onChange: (v: OffPeakHours) => void;
}

/** Éditeur d'heures creuses : chips de plages par jour + « + plage » (feuille) + « × » (supprime). */
export function OffPeakEditor({ value, onChange }: Props) {
  const { th } = useTheme();
  // Feuille ouverte : { day, idx | null }. idx null = ajout.
  const [sheet, setSheet] = useState<{ day: number; idx: number | null } | null>(null);

  const clone = (): OffPeakHours =>
    Object.fromEntries(Object.entries(value ?? {}).map(([d, r]) => [d, [...r]]));

  const saveRange = (day: number, idx: number | null, r: OffPeakRange) => {
    const oph = clone();
    const ranges = oph[day] ?? [];
    if (idx == null) oph[day] = [...ranges, r];
    else { ranges[idx] = r; oph[day] = ranges; }
    onChange(oph);
    setSheet(null);
  };

  const removeRange = (day: number, idx: number) => {
    const oph = clone();
    const ranges = (oph[day] ?? []).filter((_, i) => i !== idx);
    if (ranges.length) oph[day] = ranges; else delete oph[day];
    onChange(oph);
  };

  const dayName = (d: number) => DAYS.find(([n]) => n === d)![1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {DAYS.map(([day, name]) => {
        const ranges = value?.[day] ?? [];
        return (
          <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0', borderBottom: `1px dashed ${th.line}` }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, width: 92 }}>{name}</span>
            {ranges.length === 0 && (
              <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>tout en heures pleines</span>
            )}
            {ranges.map((r, idx) => (
              <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: `${th.accentWarm}22`, color: th.text, border: `1px solid ${th.accentWarm}55`, borderRadius: 999, padding: '5px 6px 5px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>
                <button type="button" onClick={() => setSheet({ day, idx })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0 }}>
                  {offPeakChipLabel(r)}
                </button>
                <button type="button" aria-label={`Supprimer la plage ${offPeakChipLabel(r)} de ${name}`} onClick={() => removeRange(day, idx)}
                  style={{ width: 22, height: 22, borderRadius: 7, background: 'transparent', border: 'none', color: th.textMute, cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
              </span>
            ))}
            <button type="button" onClick={() => setSheet({ day, idx: null })}
              style={{ padding: '5px 11px', borderRadius: 999, background: 'transparent', color: th.textMute, border: `1px dashed ${th.line}`, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
              + plage
            </button>
          </div>
        );
      })}
      {sheet && (
        <OffPeakRangeSheet
          dayLabel={dayName(sheet.day)}
          initial={sheet.idx == null ? null : (value?.[sheet.day]?.[sheet.idx] ?? null)}
          onClose={() => setSheet(null)}
          onSave={(r) => saveRange(sheet.day, sheet.idx, r)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && node node_modules/jest/bin/jest.js OffPeakEditor.test -c jest.config.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/admin/settings/OffPeakRangeSheet.tsx frontend/components/admin/settings/OffPeakEditor.tsx frontend/__tests__/OffPeakEditor.test.tsx
git commit -m "feat(settings): editeur d'heures creuses (feuille TimePicker + chips par jour)"
```

---

## Task 5: Barre sticky `SaveBar`

**Files:**
- Create: `frontend/components/admin/settings/SaveBar.tsx`
- Test: `frontend/__tests__/SaveBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/SaveBar.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { SaveBar } from '@/components/admin/settings/SaveBar';

const base = { dirty: true, saving: false, error: null as string | null, onSave: jest.fn(), onCancel: jest.fn() };
const wrap = (over: Partial<typeof base> = {}) =>
  render(<ThemeProvider><SaveBar {...base} {...over} /></ThemeProvider>);

describe('SaveBar', () => {
  it('is hidden when there is nothing to save and no error', () => {
    const { container } = wrap({ dirty: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the pending message and both actions when dirty', () => {
    wrap();
    expect(screen.getByText(/Modifications non enregistrées/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('wires the actions and disables buttons while saving', () => {
    const onSave = jest.fn(); const onCancel = jest.fn();
    wrap({ onSave, onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onSave).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    wrap({ saving: true });
    expect(screen.getByRole('button', { name: 'Enregistrement…' })).toBeDisabled();
  });

  it('shows an error and stays visible even if not dirty', () => {
    wrap({ dirty: false, error: 'Boom' });
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && node node_modules/jest/bin/jest.js SaveBar.test -c jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `frontend/components/admin/settings/SaveBar.tsx`:

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';

interface Props {
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}

/** Barre sticky d'enregistrement global. Rendue seulement si dirty ou erreur. */
export function SaveBar({ dirty, saving, error, onSave, onCancel }: Props) {
  const { th } = useTheme();
  if (!dirty && !error) return null;
  return (
    <div style={{
      position: 'sticky', bottom: 0, zIndex: 20, marginTop: 20,
      background: th.mode === 'floodlit' ? th.surface2 : '#1d2433',
      color: '#fff', borderRadius: 14, padding: '12px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      boxShadow: '0 -6px 24px rgba(0,0,0,.28)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        {error ? (
          <span role="alert" style={{ fontFamily: th.fontUI, fontSize: 13, color: '#ffd1c9', fontWeight: 600 }}>{error}</span>
        ) : (
          <>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24', flexShrink: 0 }} />
            <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: '#fff' }}>Modifications non enregistrées</span>
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onCancel} disabled={saving}
          style={{ padding: '9px 15px', borderRadius: 10, border: 'none', background: 'transparent', color: '#cdd6e6', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
          Annuler
        </button>
        <button type="button" onClick={onSave} disabled={saving}
          style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && node node_modules/jest/bin/jest.js SaveBar.test -c jest.config.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/admin/settings/SaveBar.tsx frontend/__tests__/SaveBar.test.tsx
git commit -m "feat(settings): SaveBar sticky (dirty/annuler/enregistrer/erreur)"
```

---

## Task 6: Styles & props partagés des onglets

**Files:**
- Create: `frontend/components/admin/settings/shared.ts`

Aucun test dédié (module de styles purs, couvert par les tests d'onglets et la page). Ce module DRY les styles répétés (`card`, `label`, `field`, titres) et le type de props commun.

- [ ] **Step 1: Write the module**

Create `frontend/components/admin/settings/shared.ts`:

```typescript
import { CSSProperties } from 'react';
import type { ClubAdminDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

/** Setter typé d'un champ du brouillon (fourni par la page orchestratrice). */
export type SetClubField = <K extends keyof ClubAdminDetail>(k: K, v: ClubAdminDetail[K]) => void;

/** Props communes à tous les composants d'onglet. */
export interface SettingsTabProps {
  club: ClubAdminDetail;
  set: SetClubField;
}

/** Styles partagés (carte, label, champ, titre de section). Hook car dépend du thème. */
export function useSettingsStyles() {
  const { th } = useTheme();
  const card: CSSProperties = { background: th.surface, borderRadius: 18, padding: 22, boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 16 };
  const label: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute, display: 'block', marginBottom: 7 };
  const field: CSSProperties = { width: '100%', height: 48, padding: '0 14px', borderRadius: 12, background: th.bg, color: th.text, border: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 15 };
  const h2: CSSProperties = { fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, margin: '0 0 6px', color: th.text };
  const hint: CSSProperties = { fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, margin: '0 0 16px' };
  return { th, card, label, field, h2, hint };
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep "settings/shared" || echo "no shared.ts errors"`
Expected: `no shared.ts errors`.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/admin/settings/shared.ts
git commit -m "feat(settings): styles & props partages des onglets"
```

---

## Task 7: Composants d'onglet

Chaque onglet est une **vue pure** pilotée par `club` (brouillon) + `set`. On extrait le JSX de l'ancien `page.tsx` (référence : lignes citées) en remplaçant les contrôles par les briques polies. Identité reçoit en plus les handlers d'upload (la page les possède).

**Files:**
- Create: `frontend/components/admin/settings/SettingsIdentity.tsx`
- Create: `frontend/components/admin/settings/SettingsBooking.tsx`
- Create: `frontend/components/admin/settings/SettingsPricing.tsx`
- Create: `frontend/components/admin/settings/SettingsCollect.tsx`
- Create: `frontend/components/admin/settings/SettingsVisibility.tsx`

- [ ] **Step 1: SettingsIdentity** (source : page.tsx `168-250`)

Create `frontend/components/admin/settings/SettingsIdentity.tsx`:

```tsx
'use client';
import { RefObject } from 'react';
import { assetUrl } from '@/lib/api';
import { ACCENTS } from '@/lib/theme';
import { Btn, Segmented } from '@/components/ui/atoms';
import { ClubCover } from '@/components/ClubCover';
import { SettingsTabProps, useSettingsStyles } from './shared';

interface Props extends SettingsTabProps {
  uploading: boolean;
  logoInputRef: RefObject<HTMLInputElement | null>;
  coverInputRef: RefObject<HTMLInputElement | null>;
  pickLogo: (f: File | undefined) => void;
  pickCover: (f: File | undefined) => void;
}

export function SettingsIdentity({ club, set, uploading, logoInputRef, coverInputRef, pickLogo, pickCover }: Props) {
  const { th, card, label, field, h2 } = useSettingsStyles();
  return (
    <>
      <div style={card}>
        <h2 style={{ ...h2, marginBottom: 16 }}>Profil</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><span style={label}>Nom du club</span><input value={club.name} onChange={(e) => set('name', e.target.value)} style={field} /></div>
          <div><span style={label}>Description</span><textarea value={club.description ?? ''} onChange={(e) => set('description', e.target.value)} rows={2} style={{ ...field, height: 'auto', padding: '10px 14px', resize: 'vertical' }} /></div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 2 }}><span style={label}>Adresse</span><input value={club.address} onChange={(e) => set('address', e.target.value)} style={field} /></div>
            <div style={{ flex: 1 }}><span style={label}>Ville</span><input value={club.city ?? ''} onChange={(e) => set('city', e.target.value)} style={field} /></div>
          </div>
          <div><span style={label}>Fuseau horaire</span><input value={club.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Europe/Paris" style={field} /></div>
        </div>
      </div>

      <div style={card}>
        <h2 style={{ ...h2, marginBottom: 16 }}>Identité visuelle</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <span style={label}>Logo du club</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {club.logoUrl ? (
                <img src={assetUrl(club.logoUrl) ?? ''} alt="Logo du club"
                  style={{ width: 72, height: 72, borderRadius: 14, objectFit: 'contain', background: th.bg, border: `1px solid ${th.line}`, flexShrink: 0, opacity: uploading ? 0.5 : 1 }} />
              ) : (
                <span style={{ width: 72, height: 72, borderRadius: 14, flexShrink: 0, background: th.accent, color: th.onAccent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 26 }}>
                  {(club.name?.[0] ?? '?').toUpperCase()}
                </span>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input ref={logoInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                  aria-label="Choisir un logo de club"
                  onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
                <Btn type="button" variant="surface" disabled={uploading} onClick={() => logoInputRef.current?.click()}>
                  {uploading ? 'Envoi…' : 'Changer le logo'}
                </Btn>
                <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>JPEG, PNG ou WebP · 2 Mo max</span>
              </div>
            </div>
          </div>
          <div>
            <span style={label}>Image de couverture</span>
            <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: '0 0 10px' }}>
              Illustre votre club dans l&apos;annuaire des clubs. Sans photo importée, une belle photo de court est utilisée automatiquement par défaut.
            </p>
            <div style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${th.line}`, marginBottom: 10, opacity: uploading ? 0.5 : 1 }}>
              <ClubCover club={{ name: club.name, slug: club.slug, accentColor: club.accentColor, coverImageUrl: club.coverImageUrl }} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                aria-label="Choisir une image de couverture"
                onChange={(e) => { pickCover(e.target.files?.[0]); e.target.value = ''; }} />
              <Btn type="button" variant="surface" disabled={uploading} onClick={() => coverInputRef.current?.click()}>
                {uploading ? 'Envoi…' : 'Importer une photo'}
              </Btn>
              {club.coverImageUrl && (
                <Btn type="button" variant="ghost" disabled={uploading} onClick={() => set('coverImageUrl', null)}>
                  Utiliser l&apos;illustration automatique
                </Btn>
              )}
            </div>
            <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, display: 'block', marginTop: 6 }}>JPEG, PNG ou WebP · 2 Mo max</span>
          </div>
          <div>
            <span style={label}>Couleur d&apos;accent</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {Object.values(ACCENTS).map((hex) => (
                <button key={hex} type="button" onClick={() => set('accentColor', hex)} aria-label={`Accent ${hex}`}
                  style={{ width: 34, height: 34, borderRadius: 10, background: hex, cursor: 'pointer', border: club.accentColor.toLowerCase() === hex.toLowerCase() ? `2px solid ${th.text}` : `2px solid transparent`, boxShadow: `inset 0 0 0 1px ${th.line}` }} />
              ))}
              <input value={club.accentColor} onChange={(e) => set('accentColor', e.target.value)} style={{ ...field, width: 120, height: 34 }} />
            </div>
          </div>
          <div>
            <span style={label}>Thème par défaut</span>
            <Segmented
              options={[{ value: 'daylight', label: 'Clair' }, { value: 'floodlit', label: 'Sombre' }]}
              value={club.defaultThemeMode}
              onChange={(v) => set('defaultThemeMode', v)}
            />
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: SettingsBooking** (source : page.tsx `269-324`)

Create `frontend/components/admin/settings/SettingsBooking.tsx`:

```tsx
'use client';
import type { ClubAdminDetail } from '@/lib/api';
import { Segmented } from '@/components/ui/atoms';
import { CANCEL_PRESETS } from '@/lib/onboarding';
import { DAY_PRESETS_PUBLIC, DAY_PRESETS_MEMBER } from '@/lib/adminSettings';
import { PresetChips } from './PresetChips';
import { SwitchRow } from './SwitchRow';
import { SettingsTabProps, useSettingsStyles } from './shared';

const CANCEL_HOURS = CANCEL_PRESETS.map((p) => p.hours);              // [0, 4, 24]
const cancelLabel = (n: number) => CANCEL_PRESETS.find((p) => p.hours === n)?.label ?? `${n} h avant`;

export function SettingsBooking({ club, set }: SettingsTabProps) {
  const { th, card, label, field, h2, hint } = useSettingsStyles();
  const rolling = club.bookingReleaseMode === 'ROLLING_SLOT';
  return (
    <>
      <div style={card}>
        <h2 style={h2}>Réservation à l&apos;avance</h2>
        <p style={hint}>Jusqu&apos;à combien de jours à l&apos;avance vos joueurs peuvent réserver. Les abonnés profitent d&apos;une fenêtre élargie.</p>
        <span style={label}>Fenêtre publique (jours)</span>
        <PresetChips presets={DAY_PRESETS_PUBLIC} value={club.publicBookingDays} unit="jours" min={0} max={365}
          onChange={(v) => set('publicBookingDays', v)} />
        <span style={{ ...label, marginTop: 18 }}>Fenêtre abonnés (jours)</span>
        <PresetChips presets={DAY_PRESETS_MEMBER} value={club.memberBookingDays} unit="jours" min={0} max={365}
          onChange={(v) => set('memberBookingDays', v)} />

        <div style={{ marginTop: 18 }}>
          <span style={label}>Ouverture des nouvelles réservations</span>
          <Segmented
            options={[
              { value: 'DAY_AT_HOUR', label: 'Journée à heure fixe' },
              { value: 'ROLLING_SLOT', label: 'Au fil de l’eau' },
              { value: 'WINDOW_SHIFT', label: 'Fenêtre glissante' },
            ]}
            value={club.bookingReleaseMode}
            onChange={(v) => set('bookingReleaseMode', v as ClubAdminDetail['bookingReleaseMode'])}
          />
          <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: '8px 0 0' }}>
            « Au fil de l&apos;eau » n&apos;utilise pas l&apos;heure d&apos;ouverture. Heure 0 = minuit.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 12, opacity: rolling ? 0.4 : 1 }}>
          <div style={{ flex: 1 }}>
            <span style={label}>Heure publique (0-23)</span>
            <input type="number" min={0} max={23} disabled={rolling}
              value={club.publicReleaseHour} onChange={(e) => set('publicReleaseHour', Number(e.target.value))} style={field} />
          </div>
          <div style={{ flex: 1 }}>
            <span style={label}>Heure abonnés (0-23)</span>
            <input type="number" min={0} max={23} disabled={rolling}
              value={club.memberReleaseHour} onChange={(e) => set('memberReleaseHour', Number(e.target.value))} style={field} />
          </div>
        </div>
      </div>

      <div style={card}>
        <h2 style={h2}>Délais (annulation & changement de joueurs)</h2>
        <p style={hint}>Au-delà de ce délai avant le début, le joueur ne peut plus annuler / modifier les joueurs de sa partie.</p>
        <span style={label}>Annulation</span>
        <PresetChips presets={CANCEL_HOURS} value={club.cancellationCutoffHours} format={cancelLabel} min={0} max={365}
          onChange={(v) => set('cancellationCutoffHours', v)} />
        <span style={{ ...label, marginTop: 18 }}>Changement de joueurs</span>
        <PresetChips presets={CANCEL_HOURS} value={club.playerChangeCutoffHours} format={cancelLabel} min={0} max={365}
          onChange={(v) => set('playerChangeCutoffHours', v)} />
        <div style={{ marginTop: 16 }}>
          <SwitchRow
            checked={club.refundOnCancelWithinCutoff}
            onChange={(v) => set('refundOnCancelWithinCutoff', v)}
            title="Rembourser automatiquement en cas d’annulation dans les délais"
            description="Le joueur est remboursé (recrédit du carnet / porte-monnaie si prépayé) lorsqu’il annule avant le délai."
          />
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: SettingsPricing** (source : page.tsx `344-427`)

Create `frontend/components/admin/settings/SettingsPricing.tsx`:

```tsx
'use client';
import { Segmented } from '@/components/ui/atoms';
import { SwitchRow } from './SwitchRow';
import { OffPeakEditor } from './OffPeakEditor';
import { SettingsTabProps, useSettingsStyles } from './shared';
import type { BookingQuotas } from '@/lib/api';

const EMPTY_QUOTAS: BookingQuotas = {
  model: 'UPCOMING',
  subscriber: { peak: null, offPeak: null },
  nonSubscriber: { peak: null, offPeak: null },
};

export function SettingsPricing({ club, set }: SettingsTabProps) {
  const { th, card, label, field, h2, hint } = useSettingsStyles();
  const quotas = club.bookingQuotas ?? null;

  const setQuotaLimit = (who: 'subscriber' | 'nonSubscriber', kind: 'peak' | 'offPeak', raw: string) => {
    if (!quotas) return;
    const v = raw === '' ? null : Math.max(0, Math.min(999, Math.trunc(Number(raw))));
    set('bookingQuotas', { ...quotas, [who]: { ...quotas[who], [kind]: v } });
  };

  return (
    <>
      <div style={card}>
        <h2 style={h2}>Heures pleines / creuses</h2>
        <p style={hint}>Ajoutez des plages d&apos;<strong>heures creuses</strong> (tarif réduit) jour par jour. Le reste de la journée est en heures pleines. Le tarif creux se règle par terrain dans <strong>Ressources</strong>.</p>
        <OffPeakEditor value={club.offPeakHours} onChange={(v) => set('offPeakHours', v)} />
      </div>

      <div style={card}>
        <h2 style={h2}>Quotas de réservation</h2>
        <p style={hint}>Limitez le nombre de réservations de terrain par joueur, en heures pleines et creuses, avec des limites différentes pour les abonnés. Vide = illimité, 0 = bloqué.</p>
        <SwitchRow
          checked={!!quotas}
          onChange={(on) => set('bookingQuotas', on ? EMPTY_QUOTAS : null)}
          title="Limiter les réservations par joueur"
        />
        {quotas && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
            <div>
              <span style={label}>Période de comptage</span>
              <Segmented
                options={[{ value: 'UPCOMING', label: 'À venir simultanées' }, { value: 'WEEKLY', label: 'Par semaine' }]}
                value={quotas.model}
                onChange={(v) => set('bookingQuotas', { ...quotas, model: v as BookingQuotas['model'] })}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr', gap: 10, alignItems: 'center', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
              <span />
              <span style={{ ...label, marginBottom: 0 }}>Heures pleines</span>
              <span style={{ ...label, marginBottom: 0 }}>Heures creuses</span>
              {(['nonSubscriber', 'subscriber'] as const).map((who) => (
                <span key={`${who}-row`} style={{ display: 'contents' }}>
                  <span>{who === 'subscriber' ? 'Abonnés' : 'Non-abonnés'}</span>
                  <input type="number" min={0} max={999} placeholder="illimité" value={quotas[who].peak ?? ''}
                    onChange={(e) => setQuotaLimit(who, 'peak', e.target.value)} style={field} />
                  <input type="number" min={0} max={999} placeholder="illimité" value={quotas[who].offPeak ?? ''}
                    onChange={(e) => setQuotaLimit(who, 'offPeak', e.target.value)} style={field} />
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: SettingsCollect** (source : page.tsx `429-479`)

Create `frontend/components/admin/settings/SettingsCollect.tsx`:

```tsx
'use client';
import { QUICK_METHODS, QUICK_METHOD_LABEL } from '@/lib/caisse';
import type { PaymentMethod } from '@/lib/api';
import { SwitchRow } from './SwitchRow';
import { SettingsTabProps, useSettingsStyles } from './shared';

export function SettingsCollect({ club, set }: SettingsTabProps) {
  const { th, card, h2, hint } = useSettingsStyles();
  return (
    <>
      <div style={card}>
        <h2 style={h2}>Moyens d&apos;encaissement rapides</h2>
        <p style={hint}>Choisissez les moyens proposés en <strong>1 clic</strong> sur chaque ligne joueur de la page <strong>Paiements</strong>. Les autres moyens restent accessibles via « Détails ».</p>

        <div style={{ paddingBottom: 16, marginBottom: 16, borderBottom: `1px solid ${th.line}` }}>
          <SwitchRow
            checked={!!club.payAtClubOnly}
            onChange={(v) => set('payAtClubOnly', v)}
            title="Paiement au club — encaissement en un clic"
            description="À l’encaissement, un seul bouton « Encaissé » au lieu du choix du moyen. Le paiement est enregistré (il compte dans le chiffre d’affaires) sous le libellé neutre « Au club ». Les moyens rapides ci-dessous sont alors masqués."
          />
        </div>

        {!club.payAtClubOnly && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {QUICK_METHODS.map((m) => {
              const checked = (club.quickPaymentMethods ?? []).includes(m);
              return (
                <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...(club.quickPaymentMethods ?? []), m]
                        : (club.quickPaymentMethods ?? []).filter((x) => x !== m);
                      set('quickPaymentMethods', QUICK_METHODS.filter((x) => next.includes(x)) as PaymentMethod[]);
                    }}
                    style={{ width: 18, height: 18, accentColor: th.accent, cursor: 'pointer' }} />
                  <span style={{ fontFamily: th.fontUI, fontSize: 15, color: th.text }}>{QUICK_METHOD_LABEL[m]}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={h2}>Paiement en ligne</h2>
        <p style={hint}>La connexion Stripe et les réglages de paiement CB ont leur page dédiée.</p>
        <a href="/admin/payments" style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.accent }}>
          Gérer le paiement en ligne →
        </a>
      </div>
    </>
  );
}
```

- [ ] **Step 5: SettingsVisibility** (source : page.tsx `252-342`)

Create `frontend/components/admin/settings/SettingsVisibility.tsx`:

```tsx
'use client';
import { SwitchRow } from './SwitchRow';
import { SettingsTabProps, useSettingsStyles } from './shared';

export function SettingsVisibility({ club, set }: SettingsTabProps) {
  const { card, h2, hint } = useSettingsStyles();
  return (
    <>
      <div style={card}>
        <h2 style={h2}>Visibilité</h2>
        <p style={hint}>Affiche votre club dans l&apos;annuaire public et la recherche. Décoché, votre club reste accessible par son adresse directe (sous-domaine) mais n&apos;apparaît pas dans l&apos;annuaire.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SwitchRow checked={club.listedInDirectory} onChange={(v) => set('listedInDirectory', v)} title="Afficher mon club dans l’annuaire public" />
          <SwitchRow checked={club.listTournamentsNationally} onChange={(v) => set('listTournamentsNationally', v)} title="Publier mes tournois dans le calendrier national Palova" />
          <SwitchRow checked={club.showOffersPublicly} onChange={(v) => set('showOffersPublicly', v)} title="Afficher mes formules (abonnements & carnets) sur le Club-house" />
        </div>
      </div>

      <div style={card}>
        <h2 style={h2}>Système de niveau de joueur</h2>
        <p style={hint}>Active le classement par niveau (Glicko-2), la saisie des résultats de matchs, le leaderboard et le matchmaking par niveau. Décoché, ces fonctionnalités et le menu « Matchs » sont masqués.</p>
        <SwitchRow checked={club.levelSystemEnabled} onChange={(v) => set('levelSystemEnabled', v)} title="Activer le système de niveau de joueur" />
      </div>

      <div style={card}>
        <h2 style={h2}>Page « Mes réservations »</h2>
        <p style={hint}>Par défaut, vos joueurs ne voient ici que les réservations, tournois et events de <strong>votre club</strong>. Activez pour leur afficher aussi ceux des autres clubs dont ils sont membres.</p>
        <SwitchRow checked={club.showOtherClubsReservations} onChange={(v) => set('showOtherClubsReservations', v)} title="Afficher aussi les réservations des autres clubs" />
      </div>
    </>
  );
}
```

- [ ] **Step 6: Type-check the tab components**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep "components/admin/settings/Settings" || echo "no tab errors"`
Expected: `no tab errors`.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/admin/settings/Settings*.tsx
git commit -m "feat(settings): 5 composants d'onglet (identite/reservation/tarifs/caisse/visibilite)"
```

---

## Task 8: Réécriture de la page orchestratrice

**Files:**
- Modify: `frontend/app/admin/settings/page.tsx` (remplacement complet)

- [ ] **Step 1: Rewrite `page.tsx`**

Replace the ENTIRE content of `frontend/app/admin/settings/page.tsx` with:

```tsx
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { api, ClubAdminDetail } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { PillTabs } from '@/components/ui/atoms';
import {
  SETTINGS_TABS, SettingsTabKey, parseTab, buildUpdateBody, isDirty,
} from '@/lib/adminSettings';
import { SetClubField } from '@/components/admin/settings/shared';
import { SaveBar } from '@/components/admin/settings/SaveBar';
import { SettingsIdentity } from '@/components/admin/settings/SettingsIdentity';
import { SettingsBooking } from '@/components/admin/settings/SettingsBooking';
import { SettingsPricing } from '@/components/admin/settings/SettingsPricing';
import { SettingsCollect } from '@/components/admin/settings/SettingsCollect';
import { SettingsVisibility } from '@/components/admin/settings/SettingsVisibility';

const LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export default function AdminSettingsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club: hostClub, refresh: refreshClub } = useClub();
  const clubId = hostClub?.id;

  // Deux états : baseline serveur + brouillon édité. Le brouillon est dirty quand il diffère.
  const [server, setServer] = useState<ClubAdminDetail | null>(null);
  const [draft, setDraft] = useState<ClubAdminDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<SettingsTabKey>('identite');

  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try {
      setError(null);
      const c = await api.adminGetClub(clubId, token);
      setServer(c);
      setDraft(c);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  // Onglet initial depuis l'URL (?tab=), puis reflété à chaque changement.
  useEffect(() => { setTab(parseTab(window.location.search)); }, []);
  const changeTab = (k: SettingsTabKey) => {
    setTab(k);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', k);
    window.history.replaceState(null, '', url.toString());
  };

  const set: SetClubField = (k, v) => setDraft((c) => (c ? { ...c, [k]: v } : c));

  const dirty = !!server && !!draft && isDirty(server, draft);

  // Garde beforeunload tant que le brouillon est dirty.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Upload logo/couverture : persiste côté serveur puis synchronise server ET draft
  // (déjà enregistré → ne rend jamais le brouillon dirty).
  const syncImage = (patch: Partial<ClubAdminDetail>) => {
    setServer((c) => (c ? { ...c, ...patch } : c));
    setDraft((c) => (c ? { ...c, ...patch } : c));
  };
  const pickLogo = async (file: File | undefined) => {
    if (!file || !token || !clubId) return;
    if (!LOGO_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > MAX_LOGO_BYTES) { setError('Image trop lourde (2 Mo max)'); return; }
    setError(null); setUploading(true);
    try { const res = await api.uploadClubLogo(clubId, file, token); syncImage({ logoUrl: res.logoUrl }); }
    catch (e) { setError((e as Error).message); }
    finally { setUploading(false); }
  };
  const pickCover = async (file: File | undefined) => {
    if (!file || !token || !clubId) return;
    if (!LOGO_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > MAX_LOGO_BYTES) { setError('Image trop lourde (2 Mo max)'); return; }
    setError(null); setUploading(true);
    try { const res = await api.uploadClubCover(clubId, file, token); syncImage({ coverImageUrl: res.coverImageUrl }); }
    catch (e) { setError((e as Error).message); }
    finally { setUploading(false); }
  };

  const save = async () => {
    if (!token || !clubId || !draft) return;
    setSaving(true);
    try {
      setError(null);
      await api.adminUpdateClub(clubId, buildUpdateBody(draft), token);
      setServer(draft);           // le brouillon devient la nouvelle baseline → barre disparaît
      refreshClub();              // rafraîchit le club partagé (réservation, tarifs…)
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const cancel = () => { setDraft(server); setError(null); };

  if (loading || !draft) {
    return <div style={{ fontFamily: th.fontUI, color: th.textFaint, padding: '32px 0' }}>Chargement…</div>;
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 20px', color: th.text }}>Réglages du club</h1>

      <div className="sp-scroll-x" style={{ marginBottom: 20 }}>
        <PillTabs options={SETTINGS_TABS.map((t) => ({ value: t.key, label: t.label }))} value={tab} onChange={changeTab} />
      </div>

      {tab === 'identite' && (
        <SettingsIdentity club={draft} set={set} uploading={uploading}
          logoInputRef={logoInputRef} coverInputRef={coverInputRef} pickLogo={pickLogo} pickCover={pickCover} />
      )}
      {tab === 'reservation' && <SettingsBooking club={draft} set={set} />}
      {tab === 'tarifs' && <SettingsPricing club={draft} set={set} />}
      {tab === 'caisse' && <SettingsCollect club={draft} set={set} />}
      {tab === 'visibilite' && <SettingsVisibility club={draft} set={set} />}

      <SaveBar dirty={dirty} saving={saving} error={error} onSave={save} onCancel={cancel} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check the page**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep "app/admin/settings/page" || echo "no page errors"`
Expected: `no page errors`.

Note : `Segmented` infère `T = string` (les valeurs d'options sont élargies sans `as const`). `defaultThemeMode` est `string` → OK sans cast ; `bookingReleaseMode` est un union → le cast `v as ClubAdminDetail['bookingReleaseMode']` (déjà écrit dans `SettingsBooking.tsx` Task 7) est nécessaire. `quotas.model` est casté de même dans `SettingsPricing.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/admin/settings/page.tsx
git commit -m "feat(settings): page orchestratrice (onglets + brouillon global + SaveBar)"
```

---

## Task 9: Test d'intégration de la page + mise à jour du test de refresh

**Files:**
- Create: `frontend/__tests__/AdminSettings.test.tsx`
- Modify: `frontend/__tests__/AdminSettings.refresh.test.tsx`

- [ ] **Step 1: Write the integration test**

Create `frontend/__tests__/AdminSettings.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminSettingsPage from '../app/admin/settings/page';

const refreshMock = jest.fn();
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ slug: 'demo', club: { id: 'c1' }, loading: false, refresh: refreshMock }),
}));
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: { adminGetClub: jest.fn(), adminUpdateClub: jest.fn().mockResolvedValue({}), uploadClubLogo: jest.fn(), uploadClubCover: jest.fn() },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const CLUB = {
  id: 'c1', slug: 'demo', name: 'Démo', description: '', address: 'a', city: '', country: '',
  timezone: 'Europe/Paris', logoUrl: '', coverImageUrl: null, accentColor: '#5e93da', defaultThemeMode: 'daylight',
  status: 'ACTIVE', listedInDirectory: true, listTournamentsNationally: false, showOffersPublicly: false,
  publicBookingDays: 14, memberBookingDays: 28, bookingReleaseMode: 'DAY_AT_HOUR', publicReleaseHour: 8, memberReleaseHour: 8,
  offPeakHours: null, bookingQuotas: null, playerChangeCutoffHours: 0, cancellationCutoffHours: 24,
  showOtherClubsReservations: false, refundOnCancelWithinCutoff: false, levelSystemEnabled: true,
  stripeAccountId: null, stripeAccountStatus: 'ACTIVE', requireOnlinePayment: true, requireCardFingerprint: true,
  quickPaymentMethods: ['CARD'], payAtClubOnly: false,
  legalEntityName: '', legalForm: '', siret: '', vatNumber: '', legalRepresentative: '', legalEmail: '', legalPhone: '',
};

const wrap = () => render(<AdminSettingsPage />);

describe('AdminSettingsPage (onglets + SaveBar)', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    (mocked.adminGetClub as jest.Mock).mockResolvedValue({ ...CLUB });
    (mocked.adminUpdateClub as jest.Mock).mockClear().mockResolvedValue({});
    window.history.replaceState(null, '', '/admin/settings');
  });

  it('shows the Identité tab first and no save bar when pristine', async () => {
    wrap();
    expect(await screen.findByText('Profil')).toBeInTheDocument();
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
  });

  it('switches tabs and reflects the active tab in the URL', async () => {
    wrap();
    await screen.findByText('Profil');
    fireEvent.click(screen.getByRole('button', { name: 'Réservation' }));
    expect(await screen.findByText(/Réservation à l/)).toBeInTheDocument();
    expect(window.location.search).toContain('tab=reservation');
  });

  it('reveals the save bar on edit and saves via the global PATCH then refreshes', async () => {
    wrap();
    const nameInput = await screen.findByDisplayValue('Démo');
    fireEvent.change(nameInput, { target: { value: 'Nouveau nom' } });
    expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateClub).toHaveBeenCalled());
    const body = (mocked.adminUpdateClub as jest.Mock).mock.calls[0][1];
    expect(body.name).toBe('Nouveau nom');
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument());
  });

  it('Cancel reverts the draft and hides the save bar', async () => {
    wrap();
    const nameInput = await screen.findByDisplayValue('Démo');
    fireEvent.change(nameInput, { target: { value: 'X' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
    expect(screen.getByDisplayValue('Démo')).toBeInTheDocument();
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
  });

  it('opens on the tab named in ?tab= at mount', async () => {
    window.history.replaceState(null, '', '/admin/settings?tab=visibilite');
    wrap();
    expect(await screen.findByText('Système de niveau de joueur')).toBeInTheDocument();
  });

  it('booking presets: the member "28 jours" chip is active for memberBookingDays=28', async () => {
    // NB : « 14 jours » existe dans les presets public ET abonnés → ambigu ; on teste la
    // valeur abonnés (28), unique aux presets abonnés [14, 28, 60].
    wrap();
    await screen.findByText('Profil');
    fireEvent.click(screen.getByRole('button', { name: 'Réservation' }));
    const chip = await screen.findByRole('button', { name: '28 jours' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('persists showOtherClubsReservations (regression: old save() dropped it)', async () => {
    wrap();
    await screen.findByText('Profil');
    fireEvent.click(screen.getByRole('button', { name: 'Visibilité & joueurs' }));
    const toggle = await screen.findByText('Afficher aussi les réservations des autres clubs');
    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateClub).toHaveBeenCalled());
    const body = (mocked.adminUpdateClub as jest.Mock).mock.calls[0][1];
    expect(body.showOtherClubsReservations).toBe(true);
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `cd frontend && node node_modules/jest/bin/jest.js AdminSettings.test -c jest.config.js`
Expected: PASS (7 tests). If the `?tab=` mount test flakes because jsdom keeps `window.location.search` between tests, the `beforeEach` reset (`window.history.replaceState(null, '', '/admin/settings')`) handles it.

- [ ] **Step 3: Update the refresh test's mock club**

The existing `AdminSettings.refresh.test.tsx` (Task context) mocks `adminGetClub` with `MIN_CLUB` and finds a button `Enregistrer`. With the new page, `Enregistrer` only appears once dirty. Rewrite its single test to edit a field first. Replace the `it(...)` block body in `frontend/__tests__/AdminSettings.refresh.test.tsx`:

```typescript
  it('refreshes the shared club context after saving so the booking flow sees new settings', async () => {
    render(<AdminSettingsPage />);
    const nameInput = await screen.findByDisplayValue('Démo');
    fireEvent.change(nameInput, { target: { value: 'Démo 2' } });
    fireEvent.click(await screen.findByText('Enregistrer'));

    await waitFor(() => expect(mocked.adminUpdateClub).toHaveBeenCalled());
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
```

Also add `coverImageUrl: null` and `payAtClubOnly: false` to `MIN_CLUB` if absent, and add `uploadClubLogo`/`uploadClubCover: jest.fn()` to the mocked `api` object (drop the now-unused `getStripeStatus`). The page no longer calls `getStripeStatus`.

- [ ] **Step 4: Run the refresh test**

Run: `cd frontend && node node_modules/jest/bin/jest.js AdminSettings.refresh.test -c jest.config.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/__tests__/AdminSettings.test.tsx frontend/__tests__/AdminSettings.refresh.test.tsx
git commit -m "test(settings): integration onglets + SaveBar + regression showOtherClubs"
```

---

## Task 10: Deep-link de la checklist d'onboarding

**Files:**
- Modify: `frontend/lib/onboarding.ts:38`
- Test: `frontend/__tests__/onboarding.test.ts` (ajout d'une assertion)

- [ ] **Step 1: Add the failing assertion**

Open `frontend/__tests__/onboarding.test.ts` and, inside the `buildChecklist` describe block, add:

```typescript
  it('deep-links the logo item to the Identité tab of settings', () => {
    const items = buildChecklist({
      hasLogo: false, sportsCount: 0, resourcesCount: 0, hasPresentation: false,
      stripeStatus: 'NONE', offersCount: 0, eventsCount: 0,
    });
    expect(items.find((i) => i.key === 'logo')?.href).toBe('/admin/settings?tab=identite');
  });
```

(If `buildChecklist` isn't yet imported in that file, add it to the import from `@/lib/onboarding`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node node_modules/jest/bin/jest.js onboarding.test -c jest.config.js`
Expected: FAIL — expected `/admin/settings?tab=identite`, received `/admin/settings`.

- [ ] **Step 3: Update the href**

In `frontend/lib/onboarding.ts`, change the `logo` line (currently line 38):

```typescript
    { key: 'logo',   label: 'Logo & couleur',                            done: s.hasLogo,                     href: '/admin/settings?tab=identite' },
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && node node_modules/jest/bin/jest.js onboarding.test -c jest.config.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/onboarding.ts frontend/__tests__/onboarding.test.ts
git commit -m "feat(settings): checklist demarrage deep-linke ?tab=identite"
```

---

## Task 11: Vérification finale (tsc + suites + visuel)

**Files:** aucun (vérification).

- [ ] **Step 1: Type gate on all touched files**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -E "lib/adminSettings|components/admin/settings|app/admin/settings|lib/onboarding" || echo "TYPE OK"`
Expected: `TYPE OK`.

- [ ] **Step 2: Run every settings-related suite together**

Run: `cd frontend && node node_modules/jest/bin/jest.js adminSettings SwitchRow PresetChips OffPeakEditor SaveBar AdminSettings onboarding -c jest.config.js`
Expected: all suites PASS (adminSettings 7, SwitchRow 2, PresetChips 5, OffPeakEditor 3, SaveBar 4, AdminSettings 7, AdminSettings.refresh 1, onboarding all green).

- [ ] **Step 3: Ensure the dev stack is running**

Run: `cd .. && powershell -File start.ps1` (or confirm `curl http://localhost:3001/health` responds and `http://localhost:3000` serves). CLAUDE.md: after any `globals.css` change run `start.ps1` (no CSS added here, but restart guarantees fresh chunks).

- [ ] **Step 4: Visual verification via the `verify` skill**

Use the `verify` skill to screenshot `/admin/settings` on the seeded club (`padel-arena-paris.localhost`, `owner@palova.fr`/`password123`) in both themes, desktop 1280 and mobile 390:
- Each of the 5 tabs renders; the pill tab row scrolls (no horizontal page overflow) at 390.
- Editing a field reveals the sticky bar at the bottom, legible in light AND dark; « Annuler » reverts.
- Booking presets highlight the matching chip; « Autre… » reveals the number input.
- Heures creuses : « + plage » opens the brume-bleue sheet with two TimePickers; adding shows a chip; « × » removes it.
- Quotas switch toggles the grid.

Confirm no `scrollWidth > innerWidth` at 390 on any tab.

- [ ] **Step 5: Final commit if any visual fix was needed**

```bash
git add -A
git commit -m "polish(settings): ajustements visuels post-verification"
```

(Skip if nothing changed.)

---

## Self-Review notes (couverture spec → tâches)

- Spec §1 (5 onglets + `?tab=`) → Task 1 (`SETTINGS_TABS`/`parseTab`), Task 8 (PillTabs + URL), Task 9 (tests URL/mount).
- Spec §2 (répartition des 11 sections) → Task 7 (5 composants d'onglet, chaque section placée).
- Spec §3 (barre sticky, brouillon global, Annuler, beforeunload, uploads non-dirty) → Task 5 (SaveBar), Task 8 (server/draft, save/cancel, beforeunload, syncImage).
- Spec §4 (presets, interrupteurs, mode segmenté, heures creuses feuille, thème segmenté) → Task 2 (SwitchRow), Task 3 (PresetChips), Task 4 (OffPeak), Task 7 (Segmented pour mode & thème).
- Spec §5 (wizard inchangé, checklist deep-link) → Task 10.
- Spec §6 (éclatement en composants, helpers testés, aucun backend/migration, tests, CDP) → Tasks 1–9, 11.
- Régression identifiée hors spec mais dans le périmètre : `showOtherClubsReservations` désormais persisté (`buildUpdateBody`), testé Task 1 + Task 9.
