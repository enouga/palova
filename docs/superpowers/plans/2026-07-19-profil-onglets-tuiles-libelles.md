# Profil — onglets en tuiles icône + libellé & libellés hors des champs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the profile hero's "dossier tabs" (which overflow/truncate on mobile) with icon+label tiles that work identically on mobile and desktop, and move field labels from inside the field box to above it.

**Architecture:** Two independent, self-contained frontend-only changes to existing components — no new files, no props/API changes, no backend/migration. `ProfileHero.tsx` gets a `TAB_ICON`/`TAB_SHORT` lookup and a responsive CSS block (mirroring `ClubNav.tsx`'s mobile pattern). `ProfileFields.tsx`'s `FieldShell` is inverted so the label renders above a bordered box instead of inside it; `PillChoice` drops the box entirely (bare pills under a label).

**Tech Stack:** Next.js 16 (React, TypeScript), Jest + React Testing Library, existing `Icon` component (`components/ui/Icon.tsx`), existing theme system (`lib/ThemeProvider.tsx`, `lib/theme.ts`).

**Spec:** `docs/superpowers/specs/2026-07-19-profil-onglets-tuiles-libelles-design.md`

---

## File Structure

- Modify: `frontend/components/profile/ProfileHero.tsx` — tab rendering (icon+label tiles, responsive CSS), hero corner radius/padding, drop `scrollIntoView` plumbing.
- Modify: `frontend/components/profile/ProfileFields.tsx` — `FieldShell` inverted (label above box), new private `FieldLabel` helper, `PillChoice` drops its box.
- Modify: `frontend/__tests__/ProfileHero.test.tsx` — icon assertions, drop `scrollIntoView` stub.
- Modify: `frontend/__tests__/ProfileFields.test.tsx` — retarget the focus-boxShadow test at the new box element, add a PillChoice "no box" regression test.
- Modify: `frontend/__tests__/MeProfile.test.tsx` — drop `scrollIntoView` stub (no other change expected).

No other file reads `FieldShell`, `ProfileInput`, `ProfileSelect`, or `PillChoice` outside `components/profile/tabs/{ProfileIdentity,ProfilePreferences,ProfileSecurity}.tsx` — none of those three files need edits (they consume the same props/contract).

---

### Task 1: `ProfileHero` — icon + label tiles, responsive (mobile = desktop pattern)

**Files:**
- Modify: `frontend/components/profile/ProfileHero.tsx`
- Test: `frontend/__tests__/ProfileHero.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace the top of `frontend/__tests__/ProfileHero.test.tsx` (drop the now-unneeded `scrollIntoView` stub) and add two new tests. Full new file content:

```tsx
import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { ProfileHero } from '../components/profile/ProfileHero';
import type { MyProfile } from '../lib/api';

const profile = {
  id: 'u1', email: 'eric@palova.fr', firstName: 'Eric', lastName: 'Nougayrede', phone: null, sex: null,
  birthDate: null, avatarUrl: null, locale: 'fr', isSuperAdmin: false, showInLeaderboard: false,
  autoMatchProposals: false, acceptsFriendRequests: false, acceptsDirectMessages: true, preferredSport: null,
} as MyProfile;

const TABS = [
  { key: 'identite' as const, label: 'Identité' },
  { key: 'preferences' as const, label: 'Préférences' },
  { key: 'portefeuille' as const, label: 'Portefeuille' },
];

const base = {
  profile, avatarSrc: null as string | null, initials: 'EN', uploading: false,
  fileRef: createRef<HTMLInputElement>(), onPickAvatar: jest.fn(),
  kicker: 'Padel Arena Paris', level: null as number | null, isSubscriber: false,
  memberSince: null as string | null,
  tabs: TABS, activeTab: 'identite' as const, onTab: jest.fn(), compact: false,
};

const wrap = (props: Partial<typeof base> = {}) =>
  render(<ThemeProvider><ProfileHero {...base} {...props} /></ThemeProvider>);

describe('ProfileHero', () => {
  it('affiche le kicker, le nom, l’email et les initiales', () => {
    wrap();
    expect(screen.getByText('Padel Arena Paris')).toBeInTheDocument();
    expect(screen.getByText('Eric Nougayrede')).toBeInTheDocument();
    expect(screen.getByText('eric@palova.fr')).toBeInTheDocument();
    expect(screen.getByText('EN')).toBeInTheDocument();
  });

  it('affiche la photo quand elle existe, à la place des initiales', () => {
    wrap({ avatarSrc: 'http://x/a.png' });
    expect(screen.getByAltText('Photo de profil')).toHaveAttribute('src', 'http://x/a.png');
    expect(screen.queryByText('EN')).not.toBeInTheDocument();
  });

  it('affiche le badge de niveau quand il est fourni', () => {
    wrap({ level: 6.2 });
    expect(screen.getByText('6.2')).toBeInTheDocument();
  });

  it('pas de badge de niveau sans niveau', () => {
    wrap({ level: null });
    expect(screen.queryByLabelText(/Niveau/)).not.toBeInTheDocument();
  });

  it('affiche les chips Abonné et Membre depuis', () => {
    wrap({ isSubscriber: true, memberSince: '2024-03-01T00:00:00.000Z' });
    expect(screen.getByText(/Abonné/)).toBeInTheDocument();
    expect(screen.getByText('Membre depuis 2024')).toBeInTheDocument();
  });

  it('pas de chips pour un non-membre', () => {
    wrap({ isSubscriber: false, memberSince: null });
    expect(screen.queryByText(/Abonné/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Membre depuis/)).not.toBeInTheDocument();
  });

  it('la pastille photo déclenche le sélecteur de fichier', () => {
    const fileRef = createRef<HTMLInputElement>();
    wrap({ fileRef });
    const click = jest.fn();
    Object.defineProperty(fileRef.current!, 'click', { value: click });
    fireEvent.click(screen.getByRole('button', { name: 'Changer la photo' }));
    expect(click).toHaveBeenCalled();
  });

  it('rend un onglet par entrée et remonte le clic', () => {
    const onTab = jest.fn();
    wrap({ onTab });
    fireEvent.click(screen.getByRole('button', { name: 'Préférences' }));
    expect(onTab).toHaveBeenCalledWith('preferences');
  });

  it('variante compacte : ni email, ni chips, ni pastille photo — mais les onglets restent', () => {
    wrap({ compact: true, isSubscriber: true, memberSince: '2024-03-01T00:00:00.000Z' });
    expect(screen.getByText('Eric Nougayrede')).toBeInTheDocument();
    expect(screen.queryByText('eric@palova.fr')).not.toBeInTheDocument();
    expect(screen.queryByText(/Membre depuis/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Changer la photo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Préférences' })).toBeInTheDocument();
  });

  it('chaque onglet porte une icône (svg) à côté du libellé', () => {
    wrap();
    const tab = screen.getByRole('button', { name: 'Identité' });
    expect(tab.querySelector('svg')).not.toBeNull();
  });

  it('un onglet à libellé court garde son nom complet comme nom accessible', () => {
    wrap();
    // "Portefeuille" a un libellé court ("Solde") réservé au mobile via CSS — le nom
    // accessible (aria-label) doit rester le libellé complet dans les deux cas.
    const tab = screen.getByRole('button', { name: 'Portefeuille' });
    expect(tab).toHaveAttribute('aria-label', 'Portefeuille');
    expect(tab.textContent).toContain('Portefeuille');
    expect(tab.textContent).toContain('Solde');
  });
});
```

- [ ] **Step 2: Run tests to verify the two new ones fail**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ProfileHero.test.tsx`
Expected: FAIL on `chaque onglet porte une icône (svg) à côté du libellé` (no `<svg>` in the button — current tabs are plain text buttons) and on `un onglet à libellé court garde son nom complet comme nom accessible` (`textContent` doesn't contain `'Solde'` — no short-label span exists yet). The 9 pre-existing tests should still PASS (they don't depend on markup that's about to change).

- [ ] **Step 3: Implement the tiles**

Replace the full content of `frontend/components/profile/ProfileHero.tsx`:

```tsx
'use client';
import { RefObject } from 'react';
import type { MyProfile } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { Icon, IconName } from '@/components/ui/Icon';
import { memberSinceYear, ProfileTabKey } from '@/lib/meProfile';

interface Props {
  profile: MyProfile;
  avatarSrc: string | null;
  initials: string;
  uploading: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  onPickAvatar: (file: File | undefined) => void;
  /** Nom du club sur un hôte club, « Palova » sur l'hôte plateforme. */
  kicker: string;
  /** Niveau padel pour le badge ; null = pas de badge. */
  level: number | null;
  isSubscriber: boolean;
  /** ISO de la date d'adhésion ; null = pas de chip. */
  memberSince: string | null;
  tabs: { key: ProfileTabKey; label: string }[];
  activeTab: ProfileTabKey;
  onTab: (k: ProfileTabKey) => void;
  /** Onglets ≠ Identité : identité réduite à une ligne (l'identité s'édite dans Identité). */
  compact: boolean;
}

// Icône par onglet (catalogue existant d'Icon.tsx, aucune icône nouvelle) et libellé court
// réservé au mobile (colonne étroite) — seuls les deux onglets au nom long en ont un.
const TAB_ICON: Record<ProfileTabKey, IconName> = {
  identite: 'user', niveau: 'chart', preferences: 'settings', portefeuille: 'wallet', securite: 'lock',
};
const TAB_SHORT: Partial<Record<ProfileTabKey, string>> = {
  preferences: 'Préfs', portefeuille: 'Solde',
};

// Hero « carte de joueur ». Le dégradé est CLAIR dans les deux thèmes → l'encre est
// FIXE (HERO_INK), jamais th.text (qui virerait au clair en sombre et deviendrait illisible).
export function ProfileHero({
  profile, avatarSrc, initials, uploading, fileRef, onPickAvatar,
  kicker, level, isSubscriber, memberSince, tabs, activeTab, onTab, compact,
}: Props) {
  const { th } = useTheme();
  const size = compact ? 40 : 80;
  const sinceYear = memberSinceYear(memberSince);
  const fullName = `${profile.firstName} ${profile.lastName}`;

  const chip = (bg: string, color: string) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, padding: '6px 11px',
    fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, background: bg, color,
  } as const);

  return (
    // Inset 20px de chaque côté (comme AgendaHero et les cartes en dessous — sinon le
    // panneau, plein-bleed, déborde visuellement des cartes plus étroites qui suivent).
    <div style={{ padding: '0 20px' }}>
    <div style={{ background: HERO_GRADIENT, borderRadius: 18, padding: compact ? '14px 20px' : '20px' }}>
      <div style={{
        fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, letterSpacing: 1.2,
        textTransform: 'uppercase', color: HERO_INK_MUTED,
      }}>{kicker}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 10 : 15, marginTop: compact ? 8 : 12 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {avatarSrc ? (
            <img src={avatarSrc} alt="Photo de profil" style={{
              width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block',
              boxShadow: `0 0 0 ${compact ? 2 : 3}px #fff, 0 10px 24px rgba(24,21,14,0.25)`,
              opacity: uploading ? 0.5 : 1,
            }} />
          ) : (
            <span aria-hidden style={{
              width: size, height: size, borderRadius: '50%', background: th.accent, color: th.onAccent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: th.fontUI, fontWeight: 700, fontSize: compact ? 15 : 27,
              boxShadow: `0 0 0 ${compact ? 2 : 3}px #fff, 0 10px 24px rgba(24,21,14,0.25)`,
              opacity: uploading ? 0.5 : 1,
            }}>{initials}</span>
          )}

          {level != null && (
            <span aria-label={`Niveau ${level}`} style={{
              position: 'absolute', right: -4, bottom: -2, background: '#181510', color: ACCENTS.lime,
              fontFamily: th.fontUI, fontSize: compact ? 8.5 : 10, fontWeight: 800, borderRadius: 999,
              padding: compact ? '2px 5px' : '3px 7px', boxShadow: '0 0 0 2px #e3edf9',
            }}>{level}</span>
          )}

          {!compact && (
            <>
              <input
                ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                aria-label="Choisir une photo de profil"
                onChange={(e) => { onPickAvatar(e.target.files?.[0]); e.target.value = ''; }}
              />
              <button
                type="button" aria-label="Changer la photo" disabled={uploading}
                onClick={() => fileRef.current?.click()}
                style={{
                  position: 'absolute', left: -4, bottom: -2, width: 26, height: 26, borderRadius: '50%',
                  border: 'none', background: '#fff', cursor: uploading ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                  boxShadow: '0 2px 6px rgba(24,21,14,0.25)', opacity: uploading ? 0.6 : 1, padding: 0,
                }}
              >📷</button>
            </>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: th.fontDisplay, fontWeight: 600, fontSize: compact ? 16 : 26,
            letterSpacing: -0.5, lineHeight: 1.05, color: HERO_INK,
          }}>{fullName}</div>

          {!compact && (
            <>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, color: HERO_INK_MUTED, marginTop: 3 }}>
                {profile.email}
              </div>
              {(isSubscriber || sinceYear != null) && (
                <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
                  {isSubscriber && <span style={chip('rgba(255,255,255,0.78)', HERO_INK)}>⚡ Abonné</span>}
                  {sinceYear != null && (
                    <span style={chip('rgba(24,21,14,0.08)', HERO_INK_MUTED)}>Membre depuis {sinceYear}</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Onglets « tuiles » : icône + libellé, pills horizontales en desktop → colonnes en
          mobile (≤600px, même bascule que ClubNav — .ph-lbl-full/.ph-lbl-short reprennent sa
          technique de libellé court). Le hero est refermé (coins arrondis partout) : plus
          d'onglet « soudé » au fond de page. */}
      <style>{`
        .ph-lbl-short { display: none; }
        .ph-tab:not(.is-active) { background: rgba(255,255,255,0.45); }
        @media (max-width: 600px) {
          .ph-tabs { gap: 4px !important; }
          .ph-tab { flex: 1 !important; flex-direction: column !important; gap: 3px !important; padding: 7px 2px !important; border-radius: 13px !important; }
          .ph-tab svg { width: 20px !important; height: 20px !important; }
          .ph-tab .ph-tab-label { font-size: 10px !important; letter-spacing: 0 !important; line-height: 1.1; }
          .ph-tab:not(.is-active) { background: transparent !important; }
          .ph-tab:has(.ph-lbl-short) .ph-lbl-full { display: none; }
          .ph-tab .ph-lbl-short { display: inline; }
        }
      `}</style>
      <div className="ph-tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: compact ? 12 : 18 }}>
        {tabs.map((t) => {
          const active = t.key === activeTab;
          const short = TAB_SHORT[t.key];
          return (
            <button
              key={t.key} type="button" onClick={() => onTab(t.key)}
              aria-label={t.label} className={`ph-tab${active ? ' is-active' : ''}`}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', borderRadius: 999,
                padding: '9px 16px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: active ? 700 : 600,
                background: active ? th.accent : undefined,
                color: active ? th.onAccent : HERO_INK,
                boxShadow: active ? `0 4px 12px ${th.accent}66` : 'none',
              }}
            >
              <Icon name={TAB_ICON[t.key]} size={16} color={active ? th.onAccent : HERO_INK} />
              <span className="ph-tab-label ph-lbl-full">{t.label}</span>
              {short && <span className="ph-tab-label ph-lbl-short">{short}</span>}
            </button>
          );
        })}
      </div>
    </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ProfileHero.test.tsx`
Expected: PASS, all 11 tests.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add components/profile/ProfileHero.tsx __tests__/ProfileHero.test.tsx
git commit -m "feat(profile): onglets du profil en tuiles icone+libelle (mobile=desktop)

Remplace les onglets 'dossier' (debordaient/tronquaient sur mobile)
par des pills icone+libelle - meme langage que ClubNav, meme composant
sur mobile et desktop. Retire le scrollIntoView devenu inutile."
```

---

### Task 2: `MeProfile.test.tsx` — drop the now-unneeded `scrollIntoView` stub

**Files:**
- Modify: `frontend/__tests__/MeProfile.test.tsx:1-7`

- [ ] **Step 1: Remove the stub**

In `frontend/__tests__/MeProfile.test.tsx`, the file currently starts with:

```tsx
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import MyProfilePage from '../app/me/profile/page';
import { ThemeProvider } from '../lib/ThemeProvider';

// jsdom n'implémente pas scrollIntoView (ProfileHero l'utilise pour amener l'onglet actif dans la vue).
window.HTMLElement.prototype.scrollIntoView = jest.fn();
```

Change it to:

```tsx
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import MyProfilePage from '../app/me/profile/page';
import { ThemeProvider } from '../lib/ThemeProvider';
```

- [ ] **Step 2: Run the suite to verify it still passes**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MeProfile.test.tsx`
Expected: PASS, same test count as before this plan (28 tests) — `ProfileHero` no longer calls `scrollIntoView`, so removing the now-dead stub changes nothing behaviorally.

- [ ] **Step 3: Commit**

```bash
cd frontend
git add __tests__/MeProfile.test.tsx
git commit -m "test(profile): retirer le stub scrollIntoView devenu inutile"
```

---

### Task 3: `FieldShell` — label above the box (not inside it)

**Files:**
- Modify: `frontend/components/profile/ProfileFields.tsx`
- Test: `frontend/__tests__/ProfileFields.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/ProfileFields.test.tsx`, replace the `'le focus se reflète sur le bloc (anneau d’accent)'` test (inside `describe('ProfileInput', ...)`) — it currently reads `container.firstElementChild`, which will become the *outer* wrapper (no longer the boxed element) once the label moves out. Replace:

```tsx
  it('le focus se reflète sur le bloc (anneau d’accent)', () => {
    const { container } = wrap(<ProfileInput label="Téléphone" value="" onChange={() => {}} />);
    const shell = container.firstElementChild as HTMLElement;
    const atRest = shell.style.boxShadow;
    fireEvent.focus(screen.getByLabelText('Téléphone'));
    expect(shell.style.boxShadow).not.toBe(atRest);
    fireEvent.blur(screen.getByLabelText('Téléphone'));
    expect(shell.style.boxShadow).toBe(atRest);
  });
```

with:

```tsx
  it('le focus se reflète sur la boîte du champ (anneau d’accent)', () => {
    wrap(<ProfileInput label="Téléphone" value="" onChange={() => {}} />);
    const box = screen.getByTestId('field-box');
    const atRest = box.style.boxShadow;
    fireEvent.focus(screen.getByLabelText('Téléphone'));
    expect(box.style.boxShadow).not.toBe(atRest);
    fireEvent.blur(screen.getByLabelText('Téléphone'));
    expect(box.style.boxShadow).toBe(atRest);
  });

  it('le libellé est rendu AVANT la boîte du champ dans le DOM (au-dessus, pas dedans)', () => {
    const { container } = wrap(<ProfileInput label="Téléphone" value="" onChange={() => {}} />);
    const label = screen.getByText('Téléphone');
    const box = screen.getByTestId('field-box');
    // compareDocumentPosition bit 4 (DOCUMENT_POSITION_FOLLOWING) = label vient avant box.
    // eslint-disable-next-line no-bitwise
    expect(label.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('[data-testid="field-box"] [aria-hidden]')).toBeNull();
  });
```

Also update the import line at the top of the file (`within` stays needed for the `PillChoice` tests further down — no change to imports needed here).

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ProfileFields.test.tsx`
Expected: FAIL on both new/renamed tests — `getByTestId('field-box')` doesn't exist yet (current `FieldShell` has no `data-testid`).

- [ ] **Step 3: Implement — invert `FieldShell`**

In `frontend/components/profile/ProfileFields.tsx`, replace lines 1–32 (imports through the end of `FieldShell`):

```tsx
'use client';
import { CSSProperties, ReactNode, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

/** Libellé au-dessus d'un champ : petites capitales, même convention que le composant
 * `Field` des pages d'inscription (`components/ui/atoms.tsx`) — cohérence entre le
 * profil et l'onboarding. Peint `aria-hidden` (c'est le champ qui porte l'`aria-label`,
 * sinon un lecteur d'écran annoncerait deux fois le même mot). */
function FieldLabel({ label, focused }: { label: string; focused?: boolean }) {
  const { th } = useTheme();
  return (
    <span aria-hidden style={{
      display: 'block', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
      letterSpacing: 0.4, textTransform: 'uppercase', color: focused ? th.accent : th.textMute,
      marginBottom: 7,
    }}>{label}</span>
  );
}

/**
 * Bloc de champ : libellé au-dessus (petites capitales), champ dans une boîte arrondie
 * en dessous. `focused` colore le libellé + le bord de la boîte (piloté par le champ
 * qui vit dedans).
 */
export function FieldShell({ label, focused, children }: { label: string; focused?: boolean; children: ReactNode }) {
  const { th } = useTheme();
  return (
    <div>
      <FieldLabel label={label} focused={focused} />
      <div data-testid="field-box" style={{
        background: th.surface2, borderRadius: 13, padding: '12px 13px',
        boxShadow: focused
          ? `inset 0 0 0 1.5px ${th.accent}, 0 0 0 3px ${th.accent}29`
          : `inset 0 0 0 1px ${th.lineStrong}`,
        transition: 'box-shadow .15s',
      }}>
        {children}
      </div>
    </div>
  );
}
```

Leave everything from `useBareStyle` through `ProfileSelect` (current lines 34–82) exactly as-is — they consume `FieldShell` and don't need changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ProfileFields.test.tsx`
Expected: PASS for the `ProfileInput`/`ProfileSelect` describe blocks. The `PillChoice` describe block will still pass too (untouched so far) — full suite not green yet only if Task 4 below isn't done; run again after Task 4.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add components/profile/ProfileFields.tsx __tests__/ProfileFields.test.tsx
git commit -m "feat(profile): libelle de champ au-dessus de la boite (plus dedans)

FieldShell inverse : le libelle sort du bloc borde, convention Field
des pages d'inscription. ProfileInput/ProfileSelect gardent leur API."
```

---

### Task 4: `PillChoice` — bare pills under a label (no surrounding box)

**Files:**
- Modify: `frontend/components/profile/ProfileFields.tsx`
- Test: `frontend/__tests__/ProfileFields.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/ProfileFields.test.tsx`, inside `describe('PillChoice', ...)`, add a new test after the existing two:

```tsx
  it('les pills ne sont pas posées dans une boîte de champ (pas de field-box)', () => {
    const { container } = wrap(<PillChoice label="Sexe" value="MALE" onChange={() => {}}
      options={[{ value: 'MALE', label: 'Homme' }, { value: 'FEMALE', label: 'Femme' }]} />);
    expect(container.querySelector('[data-testid="field-box"]')).toBeNull();
    expect(screen.getByText('Sexe')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ProfileFields.test.tsx`
Expected: FAIL on the new test — `PillChoice` still wraps its pills in `FieldShell`, which renders a `[data-testid="field-box"]`.

- [ ] **Step 3: Implement — `PillChoice` drops the box**

In `frontend/components/profile/ProfileFields.tsx`, replace the final `PillChoice` function (was lines 84–109 before Task 3's edits shifted line numbers — locate it by its `export function PillChoice` signature, it's the last function in the file):

```tsx
/** Choix court (2-4 valeurs) en pills NUES sous le libellé — pas de boîte autour, les
 * pills portent déjà leur propre fond. */
export function PillChoice<T extends string>({ label, value, onChange, options }: {
  label: string; value: T | null; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  const { th } = useTheme();
  return (
    <div>
      <FieldLabel label={label} />
      <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value} type="button" aria-pressed={active} onClick={() => onChange(o.value)}
              style={{
                cursor: 'pointer', border: 'none', borderRadius: 999, padding: '8px 17px',
                fontFamily: th.fontUI, fontSize: 14.5, fontWeight: active ? 700 : 600,
                background: active ? th.accent : th.surfaceHi,
                color: active ? th.onAccent : th.textMute,
              }}
            >{o.label}</button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the full file's tests to verify everything passes**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ProfileFields.test.tsx`
Expected: PASS, all tests (9 pre-existing + 3 added across Tasks 3–4).

- [ ] **Step 5: Commit**

```bash
cd frontend
git add components/profile/ProfileFields.tsx __tests__/ProfileFields.test.tsx
git commit -m "feat(profile): PillChoice sans boite autour des pills"
```

---

### Task 5: Full regression pass (related suites + typecheck)

**Files:** none (verification only)

- [ ] **Step 1: Run every test suite that touches the profile page**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ProfileHero.test.tsx __tests__/ProfileFields.test.tsx __tests__/MeProfile.test.tsx`
Expected: PASS, 3 suites, 0 failures.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors mentioning `ProfileHero.tsx`, `ProfileFields.tsx`, `ProfileIdentity.tsx`, `ProfilePreferences.tsx`, or `ProfileSecurity.tsx`. (Pre-existing unrelated errors elsewhere in the repo, if any, are out of scope — only confirm nothing NEW appears in these files.)

- [ ] **Step 3: Grep for orphaned references**

Run: `cd frontend && grep -rn "sp-scroll-x" components/profile/ __tests__/ProfileHero.test.tsx __tests__/MeProfile.test.tsx`
Expected: no output — confirms the old scrollable-tab-strip class is fully gone from the profile surface (other pages, e.g. Events filters, legitimately keep their own `sp-scroll-x` usage elsewhere in the app — this grep is scoped to the profile files only).

No commit for this task — it's a verification checkpoint. If anything fails, fix in the relevant Task's files and re-run before continuing.

---

### Task 6: Visual verification (CDP screenshots, light/dark, mobile/desktop, both hosts)

**Files:** none (verification only)

- [ ] **Step 1: Start the dev stack if not already running**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/health` and `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/`
Expected: both `200`. If not, start the stack per `CLAUDE.md` (`start.ps1` or `npm run dev` in `backend/` and `frontend/`).

- [ ] **Step 2: Run the `verify` skill against both hosts, both themes, both viewports**

Invoke the `verify` skill (Skill tool, `skill: "verify"`) with args:

```
pages /me/profile?tab=identite et /me/profile?tab=securite, sur padel-arena-paris.localhost:3000 (5 onglets) ET localhost:3000 (3 onglets, hôte plateforme) — thème clair ET sombre, desktop 1280 ET mobile 390 (mobile:false pour un vrai test de débordement) — vérifier : (1) les 5 onglets tiennent en tuiles sans troncature/scroll sur mobile, Sécurité et Portefeuille compris ; (2) sur mobile, "Préférences" affiche "Préfs" et "Portefeuille" affiche "Solde" ; (3) sur desktop, les onglets sont des pills horizontales icône+libellé complet ; (4) les libellés de champs (Téléphone, Date de naissance, Sport préféré, Sexe, Mot de passe actuel, etc.) sont AU-DESSUS de leur champ, pas dedans ; (5) aucun débordement horizontal nulle part
```

- [ ] **Step 3: Fix anything the screenshots reveal**

If a screenshot shows a real problem (overflow, wrong short label, misaligned spacing after `PillChoice`/`FieldShell` — e.g. the `marginTop: -6` hint spans in `ProfileIdentity.tsx`/`ProfilePreferences.tsx` sitting too close/far from the new bare-pill or boxed layout), fix it directly in the relevant file, re-run the affected Jest suite from Task 5 Step 1, then re-run this task's Step 2 for the affected page/viewport only. Do not proceed to Task 7 until the screenshots look right.

No commit for this task unless Step 3 required a code fix — in that case, commit that fix with a message describing what visual issue it corrects (e.g. `fix(profile): ajuster l'espacement de l'indice sous Sport préféré`).

---

### Task 7: Final full-suite check

**Files:** none (verification only)

- [ ] **Step 1: Run the complete frontend test suite**

Run: `cd frontend && node node_modules/jest/bin/jest.js 2>&1 | tail -60`
Expected: all suites pass. Per project memory, a full-suite run may show ~6 pre-existing `BookingModal` failures that are a known test-isolation flake (pass in isolation, unrelated to this work) — anything else new/red must be investigated before considering this plan done.

- [ ] **Step 2: Push readiness check (no push performed here)**

Run: `cd .. && git log --oneline -8` and `git status --short`
Expected: a clean working tree and 5–6 new commits from Tasks 1–4 (plus any from Task 6 Step 3) on top of `fix/audit-ui-lot-c`. Do not push or open a PR — leave that decision to Eric.

---

## Self-Review Notes

- **Spec coverage:** Icon mapping ✅ (Task 1), desktop pills / mobile columns via one CSS block mirroring `ClubNav` ✅ (Task 1), short labels "Préfs"/"Solde" ✅ (Task 1, tested), hero corners fully rounded + padding restored ✅ (Task 1), `scrollIntoView`/`sp-scroll-x` removal ✅ (Tasks 1–2, verified by Task 5 grep), `aria-label` contract preserved ✅ (Task 1, tested), label-above-box for `ProfileInput`/`ProfileSelect` ✅ (Task 3), `PillChoice` bare pills ✅ (Task 4), visual sign-off in both themes/hosts/viewports ✅ (Task 6).
- **Type consistency:** `TAB_ICON`/`TAB_SHORT` keyed by the same `ProfileTabKey` used throughout `lib/meProfile.ts`; `FieldLabel` props (`label`, `focused?`) match how both `FieldShell` and `PillChoice` call it; `data-testid="field-box"` is the single new contract introduced and it's used consistently across Task 3's tests, Task 4's test, and nowhere else in the codebase (checked for collisions before writing this plan).
- **No placeholders:** every step above ships complete, runnable code — no TBD/TODO, no "add tests for the above" without the actual test body.
