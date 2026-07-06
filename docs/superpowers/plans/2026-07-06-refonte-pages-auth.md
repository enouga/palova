# Refonte des pages d'auth (écran scindé brume bleue) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la coquille des 4 pages d'auth (`/login`, `/register`, `/forgot-password`, `/clubs/new`) par un composant partagé `AuthShell` : écran scindé desktop (panneau de marque brume bleue / identité club, formulaire à droite), bandeau compact + colonne en mobile — logique des pages 100 % intacte.

**Architecture:** Un helper pur `lib/authShell.ts` (copy du panneau + lavis club), un composant `components/auth/AuthShell.tsx` dont la bascule desktop/mobile est en **CSS pur** (classes `.auth-*` dans `globals.css` — pas de `useIsDesktop`, donc aucun flash d'hydration), et 4 pages réécrites en JSX seulement (états, handlers, redirections inchangés). Deux nettoyages embarqués : préremplissage login gaté dev, extraction `SelectField` dans `atoms.tsx`.

**Tech Stack:** Next.js 16 / React 19, styles inline + tokens `useTheme()`, jest + React Testing Library (ts-jest), `tsc --noEmit` comme gate de types.

**Spec:** `docs/superpowers/specs/2026-07-06-refonte-pages-auth-design.md`

---

## ⚠️ Notes d'environnement (à lire avant la Task 1)

- **Shims npm cassés** sur cette machine : `npx jest`/`npx tsc` échouent. Lancer :
  `cd frontend && node node_modules/jest/bin/jest.js <suite>` et
  `node node_modules/typescript/bin/tsc --noEmit`.
- **Ne jamais lancer la suite jest complète** (flake BookingModal connu) — toujours des suites scoped.
- **jest ne type-checke pas** (isolatedModules) : `tsc --noEmit` est un gate séparé obligatoire.
- **Avant chaque commit** : vérifier `git branch --show-current` (l'utilisateur peut changer de branche en parallèle) et ne stager QUE les fichiers du task (`git add <paths>`, jamais `-A`).
- jsdom **rejette `color-mix()`** dans les styles inline : ne jamais asserter le `background` calculé du panneau — tester `clubPanelWash` en pur.

## Structure de fichiers

| Fichier | Rôle |
|---|---|
| Create `frontend/lib/authShell.ts` | Helpers purs : `PANEL_COPY` (copy par audience), `CLUB_PANEL_LINE`, `clubPanelWash(accent)` |
| Create `frontend/components/auth/AuthShell.tsx` | La coquille (panneau desktop + bandeau mobile + colonne formulaire) |
| Modify `frontend/app/globals.css` | Classes responsive `.auth-shell/.auth-panel/.auth-banner/.auth-main/.auth-toggle/.auth-title` |
| Modify `frontend/components/ui/atoms.tsx` | + `SelectField` (miroir de `Field` pour `<select>`) |
| Modify `frontend/app/login/page.tsx` | Coquille AuthShell + préremplissage dev-only |
| Modify `frontend/app/register/page.tsx` | Coquille AuthShell + `SelectField` |
| Modify `frontend/app/forgot-password/page.tsx` | Coquille AuthShell |
| Modify `frontend/app/clubs/new/page.tsx` | Coquille AuthShell (`audience="club"`) + `SelectField` |
| Create `frontend/__tests__/authShell.test.ts` | Helpers purs |
| Create `frontend/__tests__/AuthShell.test.tsx` | Composant (Palova / identité club / priorité audience / title omis) |
| Create `frontend/__tests__/LoginPage.test.tsx` | Rendu de la page refondue |
| Create `frontend/__tests__/NewClubPage.test.tsx` | Rendu de la page refondue (panneau B2B) |
| Modify `CLAUDE.md` (racine du repo) | Section documentation (Task 8) |

**Intouchés** : `VerifyCodeForm.tsx`, `ResetPasswordForm.tsx` (ils portent déjà leur propre heading display 30 px — c'est pour ça que les étapes verify/sent omettent `title`), `Screen.tsx` (reste utilisé ailleurs), tout le backend.

---

### Task 1 : Helpers purs `lib/authShell.ts`

**Files:**
- Create: `frontend/lib/authShell.ts`
- Test: `frontend/__tests__/authShell.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// frontend/__tests__/authShell.test.ts
import { PANEL_COPY, CLUB_PANEL_LINE, clubPanelWash } from '../lib/authShell';

describe('authShell helpers', () => {
  it('clubPanelWash : dégradé clair contenant l\'accent (jamais de panneau sombre)', () => {
    const wash = clubPanelWash('#7a4dd8');
    expect(wash).toMatch(/^linear-gradient\(115deg,/);
    expect(wash).toContain('color-mix');
    // L'accent apparaît deux fois (les deux bornes du dégradé), toujours mixé vers le blanc.
    expect(wash.match(/#7a4dd8/g)).toHaveLength(2);
  });

  it('PANEL_COPY : les deux audiences ont headline, ligne et 3 chips icônés', () => {
    for (const audience of ['player', 'club'] as const) {
      const copy = PANEL_COPY[audience];
      expect(copy.headline.length).toBeGreaterThan(0);
      expect(copy.line.length).toBeGreaterThan(0);
      expect(copy.chips).toHaveLength(3);
      for (const chip of copy.chips) {
        expect(chip.icon.length).toBeGreaterThan(0);
        expect(chip.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('CLUB_PANEL_LINE : ligne dédiée à l\'identité club', () => {
    expect(CLUB_PANEL_LINE).toContain('tournois');
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/authShell.test.ts`
Expected: FAIL — `Cannot find module '../lib/authShell'`

- [ ] **Step 3: Implémenter**

```ts
// frontend/lib/authShell.ts
import type { IconName } from '@/components/ui/Icon';

export type AuthAudience = 'player' | 'club';

export interface AuthPanelCopy {
  headline: string;
  line: string;
  chips: { icon: IconName; label: string }[];
}

/** Copy du panneau de marque des pages d'auth, par audience (hôte plateforme). */
export const PANEL_COPY: Record<AuthAudience, AuthPanelCopy> = {
  player: {
    headline: 'Le sport en club, simplifié.',
    line: 'Réservation en direct, tournois, parties ouvertes — dans tous les clubs Palova.',
    chips: [
      { icon: 'bolt', label: 'Dispos en direct' },
      { icon: 'trophy', label: 'Tournois & events' },
      { icon: 'users', label: 'Parties ouvertes' },
    ],
  },
  club: {
    headline: 'Votre club en ligne, simplement.',
    line: 'Planning, encaissement, tournois : le quotidien du club géré depuis un seul endroit.',
    chips: [
      { icon: 'calendar', label: 'Planning & résas' },
      { icon: 'euro', label: 'Caisse & offres' },
      { icon: 'trophy', label: 'Tournois' },
    ],
  },
};

/** Ligne du panneau quand l'identité d'un club habille la page (hôte club). */
export const CLUB_PANEL_LINE =
  'Réservez vos terrains, rejoignez les tournois et les parties ouvertes du club.';

/**
 * Lavis clair dérivé de la couleur d'accent d'un club : dégradé de deux mixes
 * très clairs de l'accent vers un blanc cassé. L'encre fixe HERO_INK reste
 * lisible quelle que soit la couleur du club (jamais de panneau saturé/sombre).
 */
export function clubPanelWash(accent: string): string {
  return `linear-gradient(115deg, color-mix(in srgb, ${accent} 12%, #fdfdfc), color-mix(in srgb, ${accent} 30%, #fdfdfc))`;
}
```

- [ ] **Step 4: Vérifier qu'il passe**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/authShell.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # vérifier qu'on est toujours sur la branche attendue
git add frontend/lib/authShell.ts frontend/__tests__/authShell.test.ts
git commit -m "feat(auth): helpers purs du panneau AuthShell (copy + lavis club)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2 : Composant `AuthShell` + classes CSS

**Files:**
- Modify: `frontend/app/globals.css` (ajout en fin de fichier)
- Create: `frontend/components/auth/AuthShell.tsx`
- Test: `frontend/__tests__/AuthShell.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
// frontend/__tests__/AuthShell.test.tsx
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { AuthShell } from '../components/auth/AuthShell';
import { ThemeProvider } from '../lib/ThemeProvider';
import { PANEL_COPY } from '../lib/authShell';

const useClubMock = jest.fn();
jest.mock('../lib/ClubProvider', () => ({ useClub: () => useClubMock() }));

// Seuls les champs lus par AuthShell/ClubTile comptent ; le reste de ClubDetail est ignoré.
const CLUB = {
  id: 'c1', slug: 'padel-arena-paris', name: 'Padel Arena Paris', city: 'Paris',
  logoUrl: null, accentColor: '#7a4dd8',
} as never;

const wrap = (ui: ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('AuthShell', () => {
  beforeEach(() => {
    useClubMock.mockReturnValue({ slug: null, club: null, loading: false });
  });

  it('hôte plateforme : panneau Palova (headline + ligne joueur dans panneau ET bandeau)', () => {
    wrap(<AuthShell title="Bon retour."><div>form</div></AuthShell>);
    expect(screen.getByText(PANEL_COPY.player.headline)).toBeInTheDocument();
    // La ligne apparaît deux fois : panneau desktop + bandeau mobile (bascule CSS, les deux sont dans le DOM).
    expect(screen.getAllByText(PANEL_COPY.player.line)).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Bon retour.' })).toBeInTheDocument();
    expect(screen.getByText('form')).toBeInTheDocument();
  });

  it('hôte club : identité club (nom, ville, initiale, « propulsé par ») sans headline Palova', () => {
    useClubMock.mockReturnValue({ slug: 'padel-arena-paris', club: CLUB, loading: false });
    wrap(<AuthShell title="Bon retour."><div>form</div></AuthShell>);
    // Nom du club dans le panneau ET le bandeau ; initiale en repli de logo.
    expect(screen.getAllByText('Padel Arena Paris').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Paris')).toBeInTheDocument(); // ville (panneau seul)
    expect(screen.getAllByText('P').length).toBeGreaterThanOrEqual(1); // initiale de la tuile logo
    expect(screen.getByText(/propulsé par/)).toBeInTheDocument();
    expect(screen.queryByText(PANEL_COPY.player.headline)).toBeNull();
  });

  it("audience 'club' prime sur l'identité club (créer un NOUVEAU club = panneau Palova B2B)", () => {
    useClubMock.mockReturnValue({ slug: 'padel-arena-paris', club: CLUB, loading: false });
    wrap(<AuthShell audience="club" title="Créez."><div>form</div></AuthShell>);
    expect(screen.getByText(PANEL_COPY.club.headline)).toBeInTheDocument();
    expect(screen.queryByText('Padel Arena Paris')).toBeNull();
  });

  it('title omis : aucun heading (les étapes verify/reset portent le leur)', () => {
    wrap(<AuthShell><div>form</div></AuthShell>);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/AuthShell.test.tsx`
Expected: FAIL — `Cannot find module '../components/auth/AuthShell'`

- [ ] **Step 3: Ajouter les classes CSS**

Ajouter **en fin de** `frontend/app/globals.css` :

```css
/* ── Pages d'auth : écran scindé (desktop) / bandeau + colonne (mobile) ──────
   Bascule 100 % CSS (pas de useIsDesktop) → aucun flash d'hydration.
   Panneau et bandeau sont tous deux dans le DOM ; le media query affiche l'un. */
.auth-shell { min-height: 100vh; }
.auth-panel { display: none; }
.auth-toggle { display: none; }
.auth-main { display: flex; flex-direction: column; }
.auth-title { font-size: 33px; }
@media (min-width: 800px) {
  .auth-shell { display: flex; }
  .auth-panel { display: flex; width: 44%; max-width: 620px; min-height: 100vh; }
  .auth-banner { display: none; }
  .auth-toggle { display: flex; }
  .auth-main { flex: 1; min-height: 100vh; }
  .auth-title { font-size: 42px; }
}
```

⚠️ Ne PAS poser `display` en style inline sur les éléments portant `.auth-panel`,
`.auth-banner`, `.auth-toggle` (l'inline écraserait le media query).

- [ ] **Step 4: Implémenter le composant**

```tsx
// frontend/components/auth/AuthShell.tsx
'use client';
import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { assetUrl } from '@/lib/api';
import type { ClubDetail } from '@/lib/api';
import { AuthAudience, CLUB_PANEL_LINE, PANEL_COPY, clubPanelWash } from '@/lib/authShell';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';

/** Tuile blanche portant le logo du club (repli : initiale sur l'accent du club). */
function ClubTile({ club, size }: { club: Pick<ClubDetail, 'name' | 'logoUrl' | 'accentColor'>; size: number }) {
  const { th } = useTheme();
  const logo = assetUrl(club.logoUrl);
  return (
    <span style={{
      width: size, height: size, borderRadius: Math.round(size * 0.26), background: '#ffffff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 6px 18px rgba(24,21,14,0.10)', overflow: 'hidden', flexShrink: 0,
    }}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" style={{ width: Math.round(size * 0.72), height: Math.round(size * 0.72), objectFit: 'contain' }} />
      ) : (
        <span style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: Math.round(size * 0.42), color: club.accentColor }}>
          {club.name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/**
 * Coquille des pages d'auth : écran scindé en desktop (panneau de marque à
 * gauche, formulaire à droite), bandeau de marque compact + colonne en mobile.
 * Sur un hôte club, le panneau prend l'identité du club (lavis clair dérivé de
 * son accent, encre fixe HERO_INK) — sauf `audience: 'club'` (créer un NOUVEAU
 * club → toujours le panneau Palova B2B). `title` omis sur les étapes
 * verify/reset : ces formulaires portent leur propre heading.
 */
export function AuthShell({ title, subtitle, audience = 'player', children }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  audience?: AuthAudience;
  children: ReactNode;
}) {
  const { th } = useTheme();
  const { club } = useClub();
  const clubIdentity = audience === 'club' ? null : club;
  const wash = clubIdentity ? clubPanelWash(clubIdentity.accentColor) : HERO_GRADIENT;
  const copy = PANEL_COPY[audience];
  const line = clubIdentity ? CLUB_PANEL_LINE : copy.line;

  const chipRow = (compact: boolean) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: compact ? 10 : 18, position: 'relative' }}>
      {copy.chips.map((c) => (
        <span key={c.label} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.62)',
          borderRadius: 999, padding: compact ? '4px 10px' : '6px 12px',
          fontFamily: th.fontUI, fontSize: compact ? 11.5 : 12.5, fontWeight: 600, color: HERO_INK,
        }}>
          <Icon name={c.icon} size={12} color={HERO_INK} />
          {c.label}
        </span>
      ))}
    </div>
  );

  // Filigrane : traces du logo Palova (même motif que le hero de la vitrine).
  const filigrane = (
    <svg viewBox="0 0 100 100" aria-hidden="true"
      style={{ position: 'absolute', right: -70, bottom: -58, width: 300, height: 300, opacity: 0.1, pointerEvents: 'none' }}>
      <g fill="none" stroke={HERO_INK} strokeWidth={3.4} strokeLinecap="round">
        <circle cx="50" cy="50" r="37" />
        <path d="M20 30 Q50 50 20 70" />
        <path d="M80 30 Q50 50 80 70" />
      </g>
    </svg>
  );

  return (
    <div className="auth-shell" style={{ background: th.bg }}>
      {/* ── Panneau de marque (desktop) ── */}
      <aside className="auth-panel" style={{
        background: wash, color: HERO_INK, position: 'relative', overflow: 'hidden',
        flexDirection: 'column', justifyContent: 'space-between', padding: '30px 36px 24px',
      }}>
        {filigrane}
        <div style={{ position: 'relative' }}>
          {clubIdentity ? <ClubTile club={clubIdentity} size={54} /> : <Logotype size={28} color={HERO_INK} />}
        </div>
        <div style={{ position: 'relative', padding: '40px 0' }}>
          {clubIdentity ? (
            <>
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.6, lineHeight: 1.1 }}>
                {clubIdentity.name}
              </div>
              {clubIdentity.city && (
                <div style={{ fontFamily: th.fontUI, fontSize: 14, color: HERO_INK_MUTED, marginTop: 6 }}>{clubIdentity.city}</div>
              )}
            </>
          ) : (
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.6, lineHeight: 1.14 }}>
              {copy.headline}
            </div>
          )}
          <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: HERO_INK_MUTED, lineHeight: 1.55, margin: '12px 0 0', maxWidth: 340 }}>
            {line}
          </p>
          {chipRow(false)}
        </div>
        <div style={{ position: 'relative', minHeight: 18 }}>
          {clubIdentity && (
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, fontFamily: th.fontUI, fontSize: 12, color: HERO_INK_MUTED }}>
              propulsé par <Logotype size={15} color={HERO_INK} />
            </span>
          )}
        </div>
      </aside>

      {/* ── Bandeau de marque (mobile) ── */}
      <div className="auth-banner" style={{ background: wash, color: HERO_INK, position: 'relative', overflow: 'hidden', padding: '16px 20px 15px' }}>
        {filigrane}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          {clubIdentity ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <ClubTile club={clubIdentity} size={34} />
              <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 17, letterSpacing: -0.3 }}>{clubIdentity.name}</span>
            </span>
          ) : (
            <Logotype size={24} color={HERO_INK} />
          )}
          <ThemeToggle />
        </div>
        <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: HERO_INK_MUTED, margin: '10px 0 0', position: 'relative' }}>{line}</p>
        {chipRow(true)}
      </div>

      {/* ── Colonne formulaire ── */}
      <main className="auth-main">
        <div className="auth-toggle" style={{ justifyContent: 'flex-end', padding: '20px 24px 0' }}>
          <ThemeToggle />
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '26px 24px 44px' }}>
          {/* margin auto (≠ align-items:center) : centre verticalement SANS clipper
              le haut quand le formulaire dépasse l'écran (register, clubs/new). */}
          <div className="sp-hero-rise" style={{ width: '100%', maxWidth: 460, margin: 'auto 0' }}>
            {title != null && (
              <h1 className="auth-title" style={{ fontFamily: th.fontDisplay, fontWeight: 500, color: th.text, letterSpacing: -0.5, lineHeight: 1.06, margin: 0 }}>
                {title}
              </h1>
            )}
            {subtitle != null && (
              <p style={{ fontFamily: th.fontUI, fontSize: 15, color: th.textMute, lineHeight: 1.5, margin: '12px 0 0', maxWidth: 400 }}>
                {subtitle}
              </p>
            )}
            {(title != null || subtitle != null) && <div style={{ height: 26 }} />}
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Vérifier que la suite passe**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/AuthShell.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: Gate de types**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -iE "authshell|AuthShell" ; echo done`
Expected: aucune erreur sur nos fichiers (`done` seul — ignorer d'éventuelles erreurs d'autres WIP parallèles).

- [ ] **Step 7: Commit**

```bash
git branch --show-current
git add frontend/components/auth/AuthShell.tsx frontend/app/globals.css frontend/__tests__/AuthShell.test.tsx
git commit -m "feat(auth): coquille AuthShell ecran scinde brume bleue

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3 : `SelectField` dans `atoms.tsx`

**Files:**
- Modify: `frontend/components/ui/atoms.tsx` (ajouter après le composant `Field`, ~ligne 190)

Pas de suite dédiée (les atoms n'en ont pas) : couvert par la suite `RegisterPage` (Task 5, `getByLabelText('Sport préféré (facultatif)')` traverse le `<label>` wrappant) + `tsc`.

- [ ] **Step 1: Ajouter le composant**

Insérer après la fermeture de `Field` dans `frontend/components/ui/atoms.tsx` :

```tsx
/* ── SelectField ─ select stylé comme Field (label uppercase + surface arrondie).
   Les <option> sont passés en children. Utilisé par /register et /clubs/new. */
export function SelectField({ label, value, onChange, children }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  const { th } = useTheme();
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, display: 'block', marginBottom: 8 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', height: 54, padding: '0 16px', borderRadius: 14, background: th.surface,
          color: th.text, border: 'none', boxShadow: `inset 0 0 0 1.5px ${th.line}`, fontFamily: th.fontUI, fontSize: 16,
        }}>
        {children}
      </select>
    </label>
  );
}
```

(`ReactNode` et `useTheme` sont déjà importés en tête d'`atoms.tsx`.)

- [ ] **Step 2: Gate de types**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -i "atoms" ; echo done`
Expected: `done` seul.

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add frontend/components/ui/atoms.tsx
git commit -m "refactor(ui): SelectField extrait dans atoms (miroir de Field)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4 : Refonte `/login` (+ préremplissage dev-only)

**Files:**
- Modify: `frontend/app/login/page.tsx` (réécriture complète)
- Test: `frontend/__tests__/LoginPage.test.tsx` (nouveau)

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
// frontend/__tests__/LoginPage.test.tsx
import { render, screen } from '@testing-library/react';
import LoginPage from '../app/login/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { PANEL_COPY } from '../lib/authShell';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null, loading: false }) }));
jest.mock('../lib/api', () => ({
  api: { resendCode: jest.fn(), getMyClubs: jest.fn() },
  assetUrl: (p: string | null) => p,
}));

describe('Page connexion (LoginPage)', () => {
  it('rend le titre, le panneau de marque, les champs et le CTA', () => {
    render(<ThemeProvider><LoginPage /></ThemeProvider>);
    expect(screen.getByRole('heading', { name: 'Bon retour.' })).toBeInTheDocument();
    expect(screen.getByText(PANEL_COPY.player.headline)).toBeInTheDocument();
    expect(screen.getByLabelText('Adresse e-mail')).toBeInTheDocument();
    expect(screen.getByLabelText('Mot de passe')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mot de passe oublié ?' })).toBeInTheDocument();
  });

  it('garde le préremplissage seedé hors production (NODE_ENV=test ⇒ prérempli)', () => {
    render(<ThemeProvider><LoginPage /></ThemeProvider>);
    expect(screen.getByLabelText('Adresse e-mail')).toHaveValue('test@palova.fr');
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/LoginPage.test.tsx`
Expected: FAIL — pas de heading « Bon retour. » (l'ancienne page titre « Réservez votre terrain… »)

- [ ] **Step 3: Réécrire la page**

Remplacer **intégralement** `frontend/app/login/page.tsx` (handlers strictement identiques à l'existant, seule la coquille change) :

```tsx
'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { finishAuth } from '@/lib/postAuth';
import { AuthShell } from '@/components/auth/AuthShell';
import { Btn, Field } from '@/components/ui/atoms';
import { VerifyCodeForm } from '@/components/VerifyCodeForm';

// Préremplissage du compte seedé en dev/test uniquement — jamais en production.
const DEV_PREFILL = process.env.NODE_ENV !== 'production';

export default function LoginPage() {
  const router = useRouter();
  const { th } = useTheme();
  const { slug } = useClub();
  const nextPath = () => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') || undefined : undefined);
  const [email, setEmail] = useState(DEV_PREFILL ? 'test@palova.fr' : '');
  const [password, setPassword] = useState(DEV_PREFILL ? 'password123' : '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verify, setVerify] = useState<{ email: string; devCode?: string } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403 && data.error === 'EMAIL_NOT_VERIFIED') {
          // Compte non vérifié : (re)déclencher un code et basculer sur l'étape de validation.
          const r = await api.resendCode(data.email).catch(() => null);
          setVerify({ email: data.email, devCode: r?.devCode });
          return;
        }
        setError(data.error || 'Erreur de connexion');
        return;
      }
      await finishAuth(data, slug, router, nextPath());
    } catch {
      setError('Impossible de contacter le serveur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={verify ? undefined : 'Bon retour.'}
      subtitle={verify ? undefined : 'Connectez-vous pour réserver votre prochain créneau.'}
    >
      {verify ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <VerifyCodeForm email={verify.email} devCode={verify.devCode} onVerified={(a) => finishAuth(a, slug, router, nextPath())} />
          <button type="button" onClick={() => setVerify(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, padding: '2px 0' }}>
            Retour à la connexion
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.onAccent, background: th.accent, padding: '11px 14px', borderRadius: 12, fontWeight: 600 }}>{error}</div>
          )}
          <Field label="Adresse e-mail" icon="mail" type="email" value={email} onChange={setEmail} required autoComplete="email" />
          <Field label="Mot de passe" icon="lock" type="password" value={password} onChange={setPassword} required autoComplete="current-password" />
          <button type="button" onClick={() => router.push('/forgot-password')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, color: th.textMute, padding: '2px 0', alignSelf: 'flex-end', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Mot de passe oublié ?
          </button>
          <div style={{ height: 4 }} />
          <Btn type="submit" full icon="arrowR" disabled={loading}>
            {loading ? 'Connexion…' : 'Se connecter'}
          </Btn>
          <button type="button" onClick={() => router.push('/register')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '6px 0' }}>
            Pas encore de compte ? <span style={{ color: th.text, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>Créer un compte</span>
          </button>
          <button type="button" onClick={() => router.push('/clubs/new')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint, padding: '2px 0' }}>
            Vous gérez un club ? <span style={{ color: th.textMute, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>Créez-le</span>
          </button>
        </form>
      )}
    </AuthShell>
  );
}
```

- [ ] **Step 4: Vérifier que la suite passe**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/LoginPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add frontend/app/login/page.tsx frontend/__tests__/LoginPage.test.tsx
git commit -m "feat(auth): refonte /login sur AuthShell (prefill seedé gaté dev)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5 : Refonte `/register`

**Files:**
- Modify: `frontend/app/register/page.tsx` (réécriture complète)
- Test: `frontend/__tests__/RegisterPage.test.tsx` (existante, NE PAS modifier — c'est le filet de régression)

- [ ] **Step 1: Réécrire la page**

Remplacer **intégralement** `frontend/app/register/page.tsx` (états/handlers identiques ; le `<select>` inline devient `SelectField`) :

```tsx
'use client';
import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, AuthResponse, Sport } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { setSession } from '@/lib/session';
import { useClub } from '@/lib/ClubProvider';
import { safeNext } from '@/lib/postAuth';
import { AuthShell } from '@/components/auth/AuthShell';
import { Btn, Field, SelectField } from '@/components/ui/atoms';
import { VerifyCodeForm } from '@/components/VerifyCodeForm';

export default function RegisterPage() {
  const router = useRouter();
  const { th } = useTheme();
  const { slug } = useClub();
  const nextPath = () => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') || undefined : undefined);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [step, setStep]           = useState<'form' | 'verify'>('form');
  const [pending, setPending]     = useState<{ email: string; devCode?: string } | null>(null);
  const [sports, setSports]       = useState<Sport[]>([]);
  const [preferredSportId, setPreferredSportId] = useState('');

  useEffect(() => {
    api.getSports().then(setSports).catch(() => {});
  }, []);

  // Compte activé après validation du code → ouvre la session et redirige.
  const finish = async (auth: AuthResponse) => {
    setSession(auth.token, null);
    if (slug) await api.joinClub(slug, auth.token).catch(() => {}); // adhésion auto au club du host
    router.push(slug ? (safeNext(nextPath()) || '/') : '/clubs');
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Mot de passe : 8 caractères minimum.'); return; }
    setLoading(true);
    try {
      const r = await api.register({ email, password, firstName, lastName, ...(preferredSportId ? { preferredSportId } : {}) });
      setPending({ email: r.email, devCode: r.devCode });
      setStep('verify');
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg.includes('déjà utilisé') ? 'Cet email a déjà un compte. Connectez-vous.' : msg);
    } finally {
      setLoading(false);
    }
  }

  const onVerify = step === 'verify' && pending;

  return (
    <AuthShell
      title={onVerify ? undefined : 'Créez votre compte joueur.'}
      subtitle={onVerify ? undefined : 'Un seul compte pour réserver dans tous les clubs de la plateforme.'}
    >
      {onVerify ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <VerifyCodeForm email={pending.email} devCode={pending.devCode} onVerified={finish} />
          <button type="button" onClick={() => { setStep('form'); setError(null); }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, padding: '2px 0' }}>
            Modifier l&apos;adresse e-mail
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.onAccent, background: th.accent, padding: '11px 14px', borderRadius: 12, fontWeight: 600 }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}><Field label="Prénom" value={firstName} onChange={setFirstName} required autoComplete="given-name" /></div>
            <div style={{ flex: 1 }}><Field label="Nom" value={lastName} onChange={setLastName} required autoComplete="family-name" /></div>
          </div>
          <Field label="Adresse e-mail" icon="mail" type="email" value={email} onChange={setEmail} required autoComplete="email" />
          <Field label="Mot de passe (8+ caractères)" icon="lock" type="password" value={password} onChange={setPassword} required autoComplete="new-password" />
          {sports.length > 0 && (
            <SelectField label="Sport préféré (facultatif)" value={preferredSportId} onChange={setPreferredSportId}>
              <option value="">— Aucun —</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.icon ? `${s.icon} ` : ''}{s.name}</option>)}
            </SelectField>
          )}
          <div style={{ height: 4 }} />
          <Btn type="submit" full icon="arrowR" disabled={loading}>{loading ? 'Envoi du code…' : 'Créer mon compte'}</Btn>
          <button type="button" onClick={() => router.push('/login')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '6px 0' }}>
            Déjà un compte ? <span style={{ color: th.text, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>Se connecter</span>
          </button>
        </form>
      )}
    </AuthShell>
  );
}
```

- [ ] **Step 2: Vérifier la suite existante (filet de régression)**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/RegisterPage.test.tsx`
Expected: PASS (3 tests, inchangés) — la suite mocke déjà `useClub` avec `club: null`, `assetUrl` n'est jamais invoqué.

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add frontend/app/register/page.tsx
git commit -m "feat(auth): refonte /register sur AuthShell

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6 : Refonte `/forgot-password`

**Files:**
- Modify: `frontend/app/forgot-password/page.tsx` (réécriture complète)
- Test: `frontend/__tests__/ForgotPassword.test.tsx` (existante, NE PAS modifier)

- [ ] **Step 1: Réécrire la page**

```tsx
'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { finishAuth } from '@/lib/postAuth';
import { AuthShell } from '@/components/auth/AuthShell';
import { Btn, Field } from '@/components/ui/atoms';
import { ResetPasswordForm } from '@/components/ResetPasswordForm';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { th } = useTheme();
  const { slug } = useClub();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Une fois le code demandé, on passe à l'étape de saisie (réponse neutre : on ne révèle rien).
  const [sent, setSent] = useState<{ email: string; devCode?: string } | null>(null);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api.forgotPassword(email.trim());
      setSent({ email: email.trim(), devCode: r.devCode });
    } catch {
      setError('Impossible de contacter le serveur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={sent ? undefined : 'Mot de passe oublié ?'}
      subtitle={sent ? undefined : 'Indiquez votre adresse e-mail : nous vous enverrons un code pour choisir un nouveau mot de passe.'}
    >
      {sent ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, background: th.surface2, borderRadius: 12, padding: '11px 14px', lineHeight: 1.5 }}>
            Si un compte existe avec cet email, un code de réinitialisation vient d’être envoyé.
          </div>
          <ResetPasswordForm email={sent.email} devCode={sent.devCode} onReset={(a) => finishAuth(a, slug, router)} />
          <button type="button" onClick={() => router.push('/login')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, padding: '2px 0' }}>
            Retour à la connexion
          </button>
        </div>
      ) : (
        <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.onAccent, background: th.accent, padding: '11px 14px', borderRadius: 12, fontWeight: 600 }}>{error}</div>
          )}
          <Field label="Adresse e-mail" icon="mail" type="email" value={email} onChange={setEmail} required autoComplete="email" />
          <div style={{ height: 4 }} />
          <Btn type="submit" full icon="arrowR" disabled={loading}>
            {loading ? 'Envoi…' : 'Envoyer le code'}
          </Btn>
          <button type="button" onClick={() => router.push('/login')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '6px 0' }}>
            Retour à la <span style={{ color: th.text, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>connexion</span>
          </button>
        </form>
      )}
    </AuthShell>
  );
}
```

- [ ] **Step 2: Vérifier la suite existante**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/ForgotPassword.test.tsx`
Expected: PASS (3 tests, inchangés)

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add frontend/app/forgot-password/page.tsx
git commit -m "feat(auth): refonte /forgot-password sur AuthShell

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7 : Refonte `/clubs/new` (panneau B2B)

**Files:**
- Modify: `frontend/app/clubs/new/page.tsx` (réécriture complète)
- Test: `frontend/__tests__/NewClubPage.test.tsx` (nouveau)

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
// frontend/__tests__/NewClubPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import NewClubPage from '../app/clubs/new/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { PANEL_COPY } from '../lib/authShell';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null, loading: false }) }));
jest.mock('../lib/api', () => ({
  api: { getSports: jest.fn(), register: jest.fn(), createClub: jest.fn(), adminAddSport: jest.fn() },
  assetUrl: (p: string | null) => p,
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const SPORTS = [
  { id: 'sport-padel', key: 'padel', name: 'Padel', resourceNoun: 'terrain', defaultSlotStepMin: 90, defaultDurationsMin: [90], icon: '🎾', surfaces: [], published: true, hasLighting: false },
];

describe('Page création de club (NewClubPage)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getSports.mockResolvedValue(SPORTS);
  });

  it('rend le titre, le panneau B2B et le formulaire complet', async () => {
    render(<ThemeProvider><NewClubPage /></ThemeProvider>);
    expect(screen.getByRole('heading', { name: "Créez l'espace de votre club." })).toBeInTheDocument();
    expect(screen.getByText(PANEL_COPY.club.headline)).toBeInTheDocument(); // panneau Palova B2B
    expect(screen.getByLabelText('Prénom')).toBeInTheDocument();
    expect(screen.getByLabelText('Nom du club')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Sport principal')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Créer mon club' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/NewClubPage.test.tsx`
Expected: FAIL — pas de heading (l'ancienne page rend le titre dans un `div`, pas un `h1`), pas de headline B2B.

- [ ] **Step 3: Réécrire la page**

```tsx
'use client';
import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, AuthResponse, Sport } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { setSession } from '@/lib/session';
import { clubUrl } from '@/lib/clubUrl';
import { AuthShell } from '@/components/auth/AuthShell';
import { Btn, Field, SelectField } from '@/components/ui/atoms';
import { VerifyCodeForm } from '@/components/VerifyCodeForm';

export default function NewClubPage() {
  const router = useRouter();
  const { th } = useTheme();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [clubName, setClubName]   = useState('');
  const [city, setCity]           = useState('');
  const [sports, setSports]       = useState<Sport[]>([]);
  const [sportId, setSportId]     = useState('');
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [step, setStep]           = useState<'form' | 'verify'>('form');
  const [pending, setPending]     = useState<{ email: string; devCode?: string } | null>(null);

  useEffect(() => {
    api.getSports().then((s) => { setSports(s); if (s[0]) setSportId(s[0].id); }).catch(() => setSports([]));
  }, []);

  // Après validation du code : le compte gérant est actif → on crée son club et on bascule sur l'admin.
  const finishClub = async (auth: AuthResponse) => {
    try {
      const club = await api.createClub({ name: clubName, city: city || undefined }, auth.token);
      if (sportId) {
        try { await api.adminAddSport(club.id, sportId, auth.token); } catch { /* sport activable plus tard */ }
      }
      setSession(auth.token, club.id);
      window.location.assign(clubUrl(club.slug, '/admin/onboarding'));
    } catch (err) {
      const msg = (err as Error).message;
      throw new Error(
        msg === 'SLUG_TAKEN' ? 'Un club porte déjà ce nom. Essayez une variante.'
        : msg === 'VALIDATION_ERROR' ? 'Champs du club invalides.'
        : msg,
      );
    }
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Mot de passe : 8 caractères minimum.'); return; }
    setLoading(true);
    try {
      const r = await api.register({ email, password, firstName, lastName });
      setPending({ email: r.email, devCode: r.devCode });
      setStep('verify');
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg.includes('déjà utilisé') ? 'Cet email a déjà un compte. Connectez-vous, puis créez votre club.' : msg);
    } finally {
      setLoading(false);
    }
  }

  const onVerify = step === 'verify' && pending;
  const sectionLabel = { fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' as const, color: th.textFaint };

  return (
    <AuthShell
      audience="club"
      title={onVerify ? undefined : "Créez l'espace de votre club."}
      subtitle={onVerify ? undefined : 'Quelques infos et votre club est en ligne. Vous gérez ensuite tout vous-même : sports, terrains, tarifs, réservations.'}
    >
      {onVerify ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <VerifyCodeForm email={pending.email} devCode={pending.devCode} onVerified={finishClub} />
          <button type="button" onClick={() => { setStep('form'); setError(null); }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, padding: '2px 0' }}>
            Modifier les informations
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.onAccent, background: th.accent, padding: '11px 14px', borderRadius: 12, fontWeight: 600 }}>{error}</div>
          )}

          <div style={{ ...sectionLabel, marginTop: 4 }}>Gérant</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}><Field label="Prénom" value={firstName} onChange={setFirstName} required autoComplete="given-name" /></div>
            <div style={{ flex: 1 }}><Field label="Nom" value={lastName} onChange={setLastName} required autoComplete="family-name" /></div>
          </div>
          <Field label="Adresse e-mail" icon="mail" type="email" value={email} onChange={setEmail} required autoComplete="email" />
          <Field label="Mot de passe (8+ caractères)" icon="lock" type="password" value={password} onChange={setPassword} required autoComplete="new-password" />

          <div style={{ ...sectionLabel, marginTop: 8 }}>Club</div>
          <Field label="Nom du club" icon="pin" value={clubName} onChange={setClubName} required />
          <Field label="Ville" value={city} onChange={setCity} />
          <SelectField label="Sport principal" value={sportId} onChange={setSportId}>
            {sports.map((s) => <option key={s.id} value={s.id}>{s.icon ? `${s.icon} ` : ''}{s.name}</option>)}
          </SelectField>

          <div style={{ height: 4 }} />
          <Btn type="submit" full icon="arrowR" disabled={loading}>
            {loading ? 'Envoi du code…' : 'Créer mon club'}
          </Btn>
          <button type="button" onClick={() => router.push('/login')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '6px 0' }}>
            Vous avez déjà un compte ? <span style={{ color: th.text, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>Se connecter</span>
          </button>
        </form>
      )}
    </AuthShell>
  );
}
```

- [ ] **Step 4: Vérifier que la suite passe**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/NewClubPage.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add frontend/app/clubs/new/page.tsx frontend/__tests__/NewClubPage.test.tsx
git commit -m "feat(auth): refonte /clubs/new sur AuthShell (panneau B2B)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8 : Vérification finale + documentation

**Files:**
- Modify: `CLAUDE.md` (racine du repo)

- [ ] **Step 1: Toutes les suites concernées (scoped — jamais la suite complète)**

Run:
```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/authShell.test.ts __tests__/AuthShell.test.tsx __tests__/LoginPage.test.tsx __tests__/NewClubPage.test.tsx __tests__/RegisterPage.test.tsx __tests__/ForgotPassword.test.tsx __tests__/VerifyCodeForm.test.tsx
```
Expected: PASS partout.

- [ ] **Step 2: Gate de types complet**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -iE "authShell|AuthShell|atoms|app/(login|register|forgot-password|clubs/new)" ; echo done`
Expected: `done` seul (les erreurs éventuelles d'autres fichiers WIP parallèles ne nous concernent pas).

- [ ] **Step 3: Vérification visuelle (recommandé)**

Avec la pile dev lancée (`start.ps1`), utiliser le skill `verify` pour screenshoter
`http://localhost:3000/login`, `/register`, `/forgot-password`, `/clubs/new` en mobile ET desktop,
thèmes clair et sombre, et un hôte club (`Host: padel-arena-paris.localhost`) pour l'identité club.
Points à contrôler : pas de scroll horizontal mobile, panneau visible seulement ≥ 800 px,
formulaire register entièrement scrollable en desktop (pas de haut clippé), lisibilité de l'encre
sur le lavis club.

- [ ] **Step 4: Documenter dans CLAUDE.md**

Ajouter dans `CLAUDE.md` (racine), à la suite de la section « Vitrine palova.fr » :

```markdown
## Refonte pages d'auth — écran scindé « brume bleue » (2026-07-06) ✅ implémenté

Les 4 pages d'auth (`/login`, `/register`, `/forgot-password`, `/clubs/new`) partagent la coquille
**`components/auth/AuthShell.tsx`** (remplace `Screen` + hero inline ; logique des pages intacte) :
**desktop ≥ 800 px** = écran scindé — panneau de marque constant à gauche (44 %, `HERO_GRADIENT` +
`HERO_INK`, filigrane logo, promesse + chips par audience `player`/`club`), titre de page + formulaire
(max 460 px, centré `margin:auto`) à droite ; **mobile** = bandeau de marque compact puis colonne.
Bascule **CSS pure** (classes `.auth-*` de `globals.css` — pas de `useIsDesktop`, pas de flash).
**Hôte club** = identité club complète dans le panneau (tuile logo, nom, ville, lavis clair
`clubPanelWash(accentColor)` — jamais de panneau sombre) ; `audience:'club'` (`/clubs/new`) prime et
garde le panneau Palova B2B. Étapes verify/reset : `title` omis (les formulaires portent leur heading).
Helpers purs `lib/authShell.ts` (`PANEL_COPY`, `CLUB_PANEL_LINE`, `clubPanelWash`). Au passage :
préremplissage login seedé **gaté hors production**, `SelectField` extrait dans `atoms.tsx` (utilisé
par register + clubs/new). Tests : `authShell`/`AuthShell`/`LoginPage`/`NewClubPage` (nouveaux),
`RegisterPage`/`ForgotPassword`/`VerifyCodeForm` (inchangés). Spec & plan :
`docs/superpowers/{specs,plans}/2026-07-06-refonte-pages-auth*`.
```

- [ ] **Step 5: Commit final**

```bash
git branch --show-current
git add CLAUDE.md
git commit -m "docs: section CLAUDE.md refonte pages auth

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
