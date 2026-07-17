# Refonte visuelle « Mon profil » — carte de joueur brume bleue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rhabiller `/me/profile` dans le langage éditorial premium du site — hero « carte de joueur » brume bleue, cartes à ombre douce, champs à label intégré, interrupteurs — sans toucher à la mécanique onglets/brouillon/SaveBar.

**Architecture:** Un nouveau composant `ProfileHero` absorbe le titre `<h1>`, la carte « Identité » et les `PillTabs` de la page. Deux fichiers de primitifs (`CardKicker`, `ProfileFields`) portent le nouveau langage et sont consommés par les 5 onglets. `SwitchRow` déménage de `components/admin/settings/` vers `components/ui/` (précédent : la SaveBar). Un seul ajout backend additif : `since` dans le payload membership.

**Tech Stack:** Next.js 16 (client components), React 19, TypeScript, styles inline pilotés par `useTheme()` (design system `lib/theme.ts`), Jest + React Testing Library, Prisma 7 côté backend.

**Spec :** `docs/superpowers/specs/2026-07-17-profil-redesign-carte-joueur-design.md`

---

## Contexte indispensable pour l'implémenteur

**Le contrat de test de la page est un piège.** `frontend/__tests__/MeProfile.test.tsx` utilise `await screen.findByRole('region', { name: 'Identité' })` comme sentinelle « la page est chargée » dans ~14 tests. Or la carte `<section aria-label="Identité">` disparaît (absorbée par le hero). La sentinelle devient `{ name: 'Informations' }`. La Task 5 fait cette bascule en une fois — ne pas la faire plus tôt.

**Règle de la page (à ne pas casser)** : tout ce qui est un *champ* passe par la SaveBar ; ce qui est une *action* (photo, mot de passe, suppression) garde son chemin propre. `buildProfileBody` (`frontend/lib/meProfile.ts`) reste l'unique source de vérité des champs enregistrés — ce plan n'y ajoute aucun champ.

**Accessibilité = contrat de test.** Les `aria-label` actuels (`Téléphone`, `Date de naissance`, `Langue`, `N° de licence / adhérent`, `Mot de passe actuel`, `Nouveau mot de passe`, `Confirmer le nouveau mot de passe`, `Choisir une photo de profil`) doivent survivre à l'identique. Dans les nouveaux champs, le libellé visuel est `aria-hidden` et l'input porte l'`aria-label` — sinon double annonce.

**Commandes** (les shims `npx` sont cassés sur ce poste, cf. mémoire) :
```bash
# Frontend, depuis frontend/
node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MeProfile.test.tsx
node node_modules/typescript/bin/tsc --noEmit
# Backend, depuis backend/
npx jest src/services/__tests__/club.service.test.ts
```
⚠️ `jest __tests__/meProfile.test.ts` attrape AUSSI `MeProfile.test.tsx` (Windows insensible à la casse) → toujours `--runTestsByPath` pour cibler un fichier.

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `backend/src/services/club.service.ts` | **Modifier** `getMyMembership` : expose `since` |
| `frontend/lib/api.ts` | **Modifier** : `MyClubMembership.since?: string` |
| `frontend/lib/meProfile.ts` | **Modifier** : helper pur `memberSinceYear` |
| `frontend/components/ui/SwitchRow.tsx` | **Créer** (déplacé depuis `admin/settings/`) |
| `frontend/components/profile/CardKicker.tsx` | **Créer** : tiret accent + libellé petites capitales |
| `frontend/components/profile/ProfileFields.tsx` | **Créer** : `FieldShell`, `ProfileInput`, `ProfileSelect`, `PillChoice` |
| `frontend/components/profile/ProfileHero.tsx` | **Créer** : hero brume bleue + onglets dossier |
| `frontend/components/profile/shared.ts` | **Modifier** : carte à ombre douce |
| `frontend/app/me/profile/page.tsx` | **Modifier** : câble le hero, garde l'état membership |
| `frontend/components/profile/tabs/*.tsx` | **Modifier** : consomment les nouveaux primitifs |

---

### Task 1 : Backend — `since` dans le payload membership

**Files:**
- Modify: `backend/src/services/club.service.ts:941-950`
- Modify: `backend/src/services/__tests__/club.service.test.ts:186-190`
- Modify: `frontend/lib/api.ts:2499-2503`

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `backend/src/services/__tests__/club.service.test.ts`, remplacer le test existant `'getMyMembership renvoie la licence du joueur'` (lignes 186-190) par :

```ts
  it('getMyMembership renvoie la licence et la date d’adhésion (since)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({
      membershipNo: 'LIC-9', status: 'ACTIVE', isSubscriber: false,
      createdAt: new Date('2024-03-01T10:00:00.000Z'),
    } as any);

    const m = await service.getMyMembership('demo', 'caller');

    expect(m).toEqual({
      membershipNo: 'LIC-9', status: 'ACTIVE', isSubscriber: false,
      since: '2024-03-01T10:00:00.000Z',
    });
    // `createdAt` brut ne fuite pas — le payload public expose `since`.
    expect(m).not.toHaveProperty('createdAt');
  });
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

```bash
cd backend && npx jest src/services/__tests__/club.service.test.ts -t "date d’adhésion"
```
Attendu : FAIL — l'objet reçu n'a pas `since` (il contient `createdAt` non sélectionné → `undefined`, et pas de clé `since`).

- [ ] **Step 3 : Implémenter**

Dans `backend/src/services/club.service.ts`, remplacer le corps de `getMyMembership` (lignes 941-950) par :

```ts
  async getMyMembership(slug: string, userId: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: club.id } },
      select: { membershipNo: true, status: true, isSubscriber: true, createdAt: true },
    });
    if (!m) throw new Error('MEMBERSHIP_REQUIRED');
    // `createdAt` (= date d'adhésion) sort sous le nom métier `since`, comme Member.since.
    const { createdAt, ...rest } = m;
    return { ...rest, since: createdAt.toISOString() };
  }
```

Ne PAS toucher `setMyMembership` : la page ignore sa réponse (`.then(() => setLicenceServer(value))`), et `since` est optionnel côté front.

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

```bash
cd backend && npx jest src/services/__tests__/club.service.test.ts
```
Attendu : PASS (toute la suite, y compris `MEMBERSHIP_REQUIRED` et `setMyMembership`).

- [ ] **Step 5 : Exposer le champ côté front**

Dans `frontend/lib/api.ts`, remplacer l'interface `MyClubMembership` (lignes 2499-2503) par :

```ts
export interface MyClubMembership {
  membershipNo: string | null;
  status: 'ACTIVE' | 'BLOCKED';
  isSubscriber: boolean;
  since?: string; // ISO, date d'adhésion (additif — le PATCH licence ne le renvoie pas)
}
```

- [ ] **Step 6 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts frontend/lib/api.ts
git commit -m "feat(profil): expose la date d'adhesion (since) dans le payload membership

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2 : Déménager `SwitchRow` vers `components/ui/`

Une page joueur ne doit pas importer un composant d'admin (même mouvement que la SaveBar le 17/07). Aucun changement d'API.

**Files:**
- Create: `frontend/components/ui/SwitchRow.tsx`
- Delete: `frontend/components/admin/settings/SwitchRow.tsx`
- Modify: `frontend/components/admin/settings/SettingsVisibility.tsx`, `SettingsPricing.tsx`, `SettingsCollect.tsx`, `SettingsBooking.tsx`
- Modify: `frontend/__tests__/SwitchRow.test.tsx`

- [ ] **Step 1 : Déplacer le fichier tel quel**

```bash
cd "C:/ProjetsIA/05_PERSO/RESERVE/palova"
git mv frontend/components/admin/settings/SwitchRow.tsx frontend/components/ui/SwitchRow.tsx
```
Le contenu du fichier ne change pas d'une ligne.

- [ ] **Step 2 : Mettre à jour les 5 importeurs**

Dans chacun de `frontend/components/admin/settings/{SettingsVisibility,SettingsPricing,SettingsCollect,SettingsBooking}.tsx`, remplacer la ligne d'import :

```ts
import { SwitchRow } from '@/components/admin/settings/SwitchRow';
```
par :
```ts
import { SwitchRow } from '@/components/ui/SwitchRow';
```

⚠️ Si un fichier utilise un chemin relatif (`from './SwitchRow'`), le remplacer par le chemin absolu ci-dessus. Vérifier qu'il ne reste aucune référence :
```bash
cd frontend && grep -rn "admin/settings/SwitchRow\|from './SwitchRow'" components __tests__
```
Attendu : aucune sortie.

Dans `frontend/__tests__/SwitchRow.test.tsx`, remplacer l'import du composant par `../components/ui/SwitchRow`.

- [ ] **Step 3 : Lancer les suites concernées**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/SwitchRow.test.tsx __tests__/AdminSettings.test.tsx
```
Attendu : PASS — aucun changement de comportement.

- [ ] **Step 4 : Commit**

```bash
git add -A frontend/components/ui/SwitchRow.tsx frontend/components/admin/settings frontend/__tests__/SwitchRow.test.tsx
git commit -m "refactor(ui): SwitchRow passe de admin/settings a components/ui

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3 : Primitifs — `CardKicker` + champs à label intégré

**Files:**
- Create: `frontend/components/profile/CardKicker.tsx`
- Create: `frontend/components/profile/ProfileFields.tsx`
- Create: `frontend/__tests__/ProfileFields.test.tsx`
- Modify: `frontend/components/profile/shared.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/ProfileFields.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { CardKicker } from '../components/profile/CardKicker';
import { ProfileInput, ProfileSelect, PillChoice } from '../components/profile/ProfileFields';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('CardKicker', () => {
  it('affiche le libellé', () => {
    wrap(<CardKicker>Informations</CardKicker>);
    expect(screen.getByText('Informations')).toBeInTheDocument();
  });
});

describe('ProfileInput', () => {
  it('expose son libellé à l’accessibilité et remonte la saisie', () => {
    const onChange = jest.fn();
    wrap(<ProfileInput label="Téléphone" value="06" onChange={onChange} />);
    const input = screen.getByLabelText('Téléphone');
    expect(input).toHaveValue('06');
    fireEvent.change(input, { target: { value: '0700000000' } });
    expect(onChange).toHaveBeenCalledWith('0700000000');
  });

  it('n’annonce le libellé qu’une fois (le libellé visuel est aria-hidden)', () => {
    wrap(<ProfileInput label="Téléphone" value="" onChange={() => {}} />);
    // Un seul nœud accessible nommé « Téléphone » : l'input. Le libellé peint est masqué.
    expect(screen.getAllByLabelText('Téléphone')).toHaveLength(1);
  });

  it('le focus se reflète sur le bloc (anneau d’accent)', () => {
    const { container } = wrap(<ProfileInput label="Téléphone" value="" onChange={() => {}} />);
    const shell = container.firstElementChild as HTMLElement;
    const atRest = shell.style.boxShadow;
    fireEvent.focus(screen.getByLabelText('Téléphone'));
    expect(shell.style.boxShadow).not.toBe(atRest);
    fireEvent.blur(screen.getByLabelText('Téléphone'));
    expect(shell.style.boxShadow).toBe(atRest);
  });
});

describe('ProfileSelect', () => {
  it('rend ses options et remonte le choix', () => {
    const onChange = jest.fn();
    wrap(<ProfileSelect label="Langue" value="fr" onChange={onChange}
      options={[{ value: 'fr', label: 'Français' }, { value: 'es', label: 'Español' }]} />);
    const select = screen.getByLabelText('Langue');
    expect(select).toHaveValue('fr');
    fireEvent.change(select, { target: { value: 'es' } });
    expect(onChange).toHaveBeenCalledWith('es');
  });
});

describe('PillChoice', () => {
  it('rend un groupe de pills et remonte le choix', () => {
    const onChange = jest.fn();
    wrap(<PillChoice label="Sexe" value="MALE" onChange={onChange}
      options={[{ value: 'MALE', label: 'Homme' }, { value: 'FEMALE', label: 'Femme' }]} />);
    const group = screen.getByRole('group', { name: 'Sexe' });
    fireEvent.click(within(group).getByRole('button', { name: 'Femme' }));
    expect(onChange).toHaveBeenCalledWith('FEMALE');
  });

  it('marque la pill active (aria-pressed)', () => {
    wrap(<PillChoice label="Sexe" value="MALE" onChange={() => {}}
      options={[{ value: 'MALE', label: 'Homme' }, { value: 'FEMALE', label: 'Femme' }]} />);
    expect(screen.getByRole('button', { name: 'Homme' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Femme' })).toHaveAttribute('aria-pressed', 'false');
  });
});
```

Ajouter `within` à l'import de `@testing-library/react` en tête de fichier :
```tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ProfileFields.test.tsx
```
Attendu : FAIL — « Cannot find module '../components/profile/CardKicker' ».

- [ ] **Step 3 : Créer `CardKicker.tsx`**

```tsx
'use client';
import { ReactNode } from 'react';
import { ACCENTS } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeProvider';

/**
 * Kicker éditorial d'une carte : tiret accent + libellé en petites capitales.
 * Remplace les anciens `cardTitle` gris. `tone='coral'` est réservé aux zones
 * sensibles (suppression de compte) — il colore aussi le texte.
 */
export function CardKicker({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'coral' }) {
  const { th } = useTheme();
  const dash = tone === 'coral' ? ACCENTS.coral : th.accent;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span aria-hidden style={{ width: 16, height: 3, borderRadius: 2, background: dash, flexShrink: 0 }} />
      <span style={{
        fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 1.2,
        textTransform: 'uppercase', color: tone === 'coral' ? ACCENTS.coral : th.textFaint,
      }}>{children}</span>
    </div>
  );
}
```

- [ ] **Step 4 : Créer `ProfileFields.tsx`**

```tsx
'use client';
import { CSSProperties, ReactNode, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

/**
 * Bloc de champ « label intégré » : le libellé vit DANS le bloc, en petites capitales.
 * Le libellé peint est `aria-hidden` — c'est le champ qui porte l'`aria-label`, sinon
 * un lecteur d'écran annoncerait deux fois le même mot.
 * `focused` colore le bord + le libellé (piloté par le champ qui vit dedans).
 */
export function FieldShell({ label, focused, children }: { label: string; focused?: boolean; children: ReactNode }) {
  const { th } = useTheme();
  return (
    <div style={{
      background: th.surface2, borderRadius: 13, padding: '15px 12px 10px', position: 'relative',
      boxShadow: focused
        ? `inset 0 0 0 1.5px ${th.accent}, 0 0 0 3px ${th.accent}29`
        : `inset 0 0 0 1px ${th.lineStrong}`,
      transition: 'box-shadow .15s',
    }}>
      <span aria-hidden style={{
        position: 'absolute', top: 6, left: 12, fontFamily: th.fontUI, fontSize: 9.5, fontWeight: 700,
        letterSpacing: 0.5, textTransform: 'uppercase', color: focused ? th.accent : th.textFaint,
      }}>{label}</span>
      {children}
    </div>
  );
}

/** Style du champ nu posé dans un FieldShell : le bloc porte la bordure, pas l'input. */
function useBareStyle(): CSSProperties {
  const { th } = useTheme();
  return {
    width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', outline: 'none',
    padding: 0, margin: 0, fontFamily: th.fontUI, fontSize: 14, color: th.text,
  };
}

export function ProfileInput({ label, value, onChange, type = 'text', placeholder, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: 'text' | 'password'; placeholder?: string; autoComplete?: string;
}) {
  const [focused, setFocused] = useState(false);
  const bare = useBareStyle();
  return (
    <FieldShell label={label} focused={focused}>
      <input
        type={type} value={value} placeholder={placeholder} autoComplete={autoComplete} aria-label={label}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value)} style={bare}
      />
    </FieldShell>
  );
}

export function ProfileSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [focused, setFocused] = useState(false);
  const bare = useBareStyle();
  return (
    <FieldShell label={label} focused={focused}>
      <select
        value={value} aria-label={label}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...bare, cursor: 'pointer' }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </FieldShell>
  );
}

/** Choix court (2-4 valeurs) rendu en pills DANS le bloc de champ : sexe, sport préféré… */
export function PillChoice<T extends string>({ label, value, onChange, options }: {
  label: string; value: T | null; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  const { th } = useTheme();
  return (
    <FieldShell label={label}>
      <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 3 }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value} type="button" aria-pressed={active} onClick={() => onChange(o.value)}
              style={{
                cursor: 'pointer', border: 'none', borderRadius: 999, padding: '6px 15px',
                fontFamily: th.fontUI, fontSize: 12.5, fontWeight: active ? 700 : 600,
                background: active ? th.accent : th.surfaceHi,
                color: active ? th.onAccent : th.textMute,
              }}
            >{o.label}</button>
          );
        })}
      </div>
    </FieldShell>
  );
}
```

- [ ] **Step 5 : Passer la carte à l'ombre douce**

Dans `frontend/components/profile/shared.ts`, remplacer la définition de `card` dans `useProfileStyles` (lignes 18-21) par :

```ts
  // Ombre douce (même recette que cardStyle() du Club-house) — fini le liseré inset gris.
  const card: CSSProperties = {
    background: th.surface, borderRadius: 18,
    boxShadow: th.mode === 'floodlit'
      ? `0 14px 34px rgba(0,0,0,0.42), inset 0 0 0 1px ${th.line}`
      : '0 14px 34px rgba(24,21,16,0.08), 0 1px 2px rgba(24,21,16,0.05)',
    padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14,
  };
```

Ne rien supprimer d'autre dans ce fichier pour l'instant (`cardTitle`/`input` restent utilisés par les onglets non encore migrés — la Task 9 fait le ménage).

- [ ] **Step 6 : Lancer les tests, vérifier qu'ils passent**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ProfileFields.test.tsx
```
Attendu : PASS (7 tests).

- [ ] **Step 7 : Commit**

```bash
git add frontend/components/profile/CardKicker.tsx frontend/components/profile/ProfileFields.tsx frontend/components/profile/shared.ts frontend/__tests__/ProfileFields.test.tsx
git commit -m "feat(profil): primitifs CardKicker + champs a label integre, carte a ombre douce

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4 : Helper pur `memberSinceYear`

**Files:**
- Modify: `frontend/lib/meProfile.ts`
- Modify: `frontend/__tests__/meProfile.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à la fin de `frontend/__tests__/meProfile.test.ts` :

```ts
describe('memberSinceYear', () => {
  it('extrait l’année d’un ISO', () => {
    expect(memberSinceYear('2024-03-01T10:00:00.000Z')).toBe(2024);
  });

  it('renvoie null sans date', () => {
    expect(memberSinceYear(null)).toBeNull();
    expect(memberSinceYear(undefined)).toBeNull();
    expect(memberSinceYear('')).toBeNull();
  });

  it('renvoie null sur une date illisible', () => {
    expect(memberSinceYear('bientôt')).toBeNull();
  });
});
```

Ajouter `memberSinceYear` à l'import existant de `../lib/meProfile` en tête du fichier.

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/meProfile.test.ts
```
Attendu : FAIL — « memberSinceYear is not a function ».

- [ ] **Step 3 : Implémenter**

Ajouter à la fin de `frontend/lib/meProfile.ts` :

```ts
/**
 * Année d'adhésion pour la chip « Membre depuis {année} ».
 * Lit les 4 premiers caractères de l'ISO plutôt que `new Date()` : pur, sans fuseau
 * (un 31/12 23h UTC ne bascule pas d'année selon le fuseau du lecteur), donc stable.
 */
export function memberSinceYear(since: string | null | undefined): number | null {
  if (!since) return null;
  const y = Number(since.slice(0, 4));
  return Number.isInteger(y) && y > 1900 ? y : null;
}
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/meProfile.test.ts
```
Attendu : PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/meProfile.ts frontend/__tests__/meProfile.test.ts
git commit -m "feat(profil): helper pur memberSinceYear

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5 : Le hero « carte de joueur »

**Files:**
- Create: `frontend/components/profile/ProfileHero.tsx`
- Create: `frontend/__tests__/ProfileHero.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/ProfileHero.test.tsx` :

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
];

const base = {
  profile, avatarSrc: null, initials: 'EN', uploading: false,
  fileRef: createRef<HTMLInputElement>(), onPickAvatar: jest.fn(),
  kicker: 'Padel Arena Paris', level: null, isSubscriber: false, memberSince: null,
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
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ProfileHero.test.tsx
```
Attendu : FAIL — « Cannot find module '../components/profile/ProfileHero' ».

- [ ] **Step 3 : Implémenter le hero**

Créer `frontend/components/profile/ProfileHero.tsx` :

```tsx
'use client';
import { RefObject } from 'react';
import type { MyProfile } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
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
    display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, padding: '4px 9px',
    fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, background: bg, color,
  } as const);

  return (
    <div style={{ background: HERO_GRADIENT, padding: compact ? '14px 20px 0' : '20px 20px 0' }}>
      <div style={{
        fontFamily: th.fontUI, fontSize: 10, fontWeight: 700, letterSpacing: 1.4,
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
              <div style={{ fontFamily: th.fontUI, fontSize: 12, color: HERO_INK_MUTED, marginTop: 3 }}>
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

      {/* Onglets « dossier » : l'actif prend le fond de page → il s'y soude visuellement. */}
      <div className="sp-scroll-x" style={{ marginTop: compact ? 12 : 18 }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {tabs.map((t) => {
            const active = t.key === activeTab;
            return (
              <button
                key={t.key} type="button" onClick={() => onTab(t.key)}
                style={{
                  border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700,
                  padding: active ? '9px 15px' : '9px 12px',
                  borderRadius: active ? '11px 11px 0 0' : 0,
                  background: active ? th.bg : 'transparent',
                  color: active ? th.text : HERO_INK_MUTED,
                }}
              >{t.label}</button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ProfileHero.test.tsx
```
Attendu : PASS (9 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/profile/ProfileHero.tsx frontend/__tests__/ProfileHero.test.tsx
git commit -m "feat(profil): hero carte de joueur (brume bleue, badge niveau, onglets dossier)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6 : Câbler le hero dans la page + retirer la carte « Identité »

C'est la task qui bascule la sentinelle des tests. Le hero et la carte Identité ne doivent jamais coexister (doublon d'avatar et d'input fichier).

**Files:**
- Modify: `frontend/app/me/profile/page.tsx`
- Modify: `frontend/components/profile/tabs/ProfileIdentity.tsx`
- Modify: `frontend/__tests__/MeProfile.test.tsx`

- [ ] **Step 1 : Mettre à jour les tests (ils échoueront)**

Dans `frontend/__tests__/MeProfile.test.tsx` :

**(a)** Remplacer TOUTES les occurrences de la sentinelle (~14). La carte « Identité » disparaît ; « Informations » est la première carte de l'onglet. Utiliser l'outil **Edit avec `replace_all: true`** (et non un script shell : l'accent de « Identité » ne survit pas au quoting Git Bash sur ce poste) :

- `old_string` : `'region', { name: 'Identité' }`
- `new_string` : `'region', { name: 'Informations' }`

Contrôler ensuite qu'il ne reste aucune sentinelle « Identité » :
```bash
cd frontend && grep -n "region', { name: 'Ident" __tests__/MeProfile.test.tsx
```
Attendu : aucune sortie.

**(b)** Remplacer le test `'affiche l’identité et l’email non modifiable'` (lignes ~276-283) par :
```tsx
  it('le hero affiche l’identité ; l’email n’est plus un champ', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    expect(screen.getByText('Eric Nougayrede')).toBeInTheDocument();
    expect(screen.getByText('eric@palova.fr')).toBeInTheDocument();
    // L'astuce « L'email ne peut pas être modifié » n'a plus lieu d'être : plus aucun champ email.
    expect(screen.queryByText('L’email ne peut pas être modifié.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Téléphone')).toHaveValue('0609032635');
  });
```

**(c)** Ajouter, à la fin du `describe('Page Mon profil — licence (seconde ressource)')`, les tests du hero câblé :
```tsx
  it('le hero porte les chips du membre (abonné, année d’adhésion)', async () => {
    api.getMyClubMembership.mockResolvedValue({
      membershipNo: 'LIC42', status: 'ACTIVE', isSubscriber: true, since: '2024-03-01T00:00:00.000Z',
    });
    wrap();
    expect(await screen.findByText('Membre depuis 2024')).toBeInTheDocument();
    expect(screen.getByText(/Abonné/)).toBeInTheDocument();
    expect(screen.getByText('Club Démo')).toBeInTheDocument(); // kicker = nom du club
  });

  it('le hero porte le badge de niveau du joueur', async () => {
    api.getMyRating.mockResolvedValue({ calibrated: true, level: 6.2, tier: 'Confirmé', isProvisional: false, reliability: 90 });
    wrap();
    expect(await screen.findByLabelText('Niveau 6.2')).toBeInTheDocument();
  });
```

**(d)** Dans le `beforeEach` du describe licence, ajouter `since` au mock membership :
```tsx
    api.getMyClubMembership.mockResolvedValue({ membershipNo: 'LIC42', status: 'ACTIVE', isSubscriber: true, since: '2024-03-01T00:00:00.000Z' });
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MeProfile.test.tsx
```
Attendu : FAIL — pas de région « Informations » (la carte s'appelle encore « Identité »), pas de chips, pas de badge.

- [ ] **Step 3 : Retirer la carte « Identité » de `ProfileIdentity`**

Dans `frontend/components/profile/tabs/ProfileIdentity.tsx` :
- Supprimer entièrement le premier `<section style={card} aria-label="Identité">…</section>` (lignes 37-64) — avatar, input fichier, bouton photo et les 3 `readonlyRow` migrent dans le hero.
- Supprimer le helper local `readonlyRow` (lignes 28-33), désormais inutilisé.
- Retirer des props : `avatarSrc`, `initials`, `uploading`, `fileRef`, `onPickAvatar` (le hero les porte). L'interface `Props` devient :

```tsx
interface Props extends ProfileTabProps {
  sports: Sport[];
  /** Licence : seconde ressource, rendue seulement si membre d'un club. */
  licence: string | null;
  clubName: string | null;
  onLicence: (v: string) => void;
}
```
et la signature :
```tsx
export function ProfileIdentity({ profile, set, sports, licence, clubName, onLicence }: Props) {
```
- Retirer les imports devenus inutiles (`RefObject`).
- Le reste du fichier (Sport préféré / Informations / Licence) est inchangé à cette étape — la Task 7 le restyle.

- [ ] **Step 4 : Câbler le hero dans la page**

Dans `frontend/app/me/profile/page.tsx` :

**(a)** Imports — ajouter :
```tsx
import { MyClubMembership } from '@/lib/api'; // à fusionner dans l'import existant de '@/lib/api'
import { ProfileHero } from '@/components/profile/ProfileHero';
```
et retirer `PillTabs` de l'import de `@/components/ui/atoms` (il reste `BackButton`, `ThemeToggle`).

**(b)** État — sous la ligne `const [licenceDraft, setLicenceDraft] = useState<string>('');` ajouter :
```tsx
  // Adhésion complète (chips du hero) — la licence en est extraite comme 2ᵉ ressource.
  const [membership, setMembership] = useState<MyClubMembership | null>(null);
```

**(c)** Dans `load()`, poser l'adhésion. Remplacer le bloc `if (slug) { … } else { setLicenceServer(null); }` par :
```tsx
      if (slug) {
        const m = await api.getMyClubMembership(slug, token).catch(() => null);
        setMembership(m);
        const lic = m ? (m.membershipNo ?? '') : null;
        setLicenceServer(lic);
        setLicenceDraft(lic ?? '');
        if (m) {
          // Best-effort : ne bloquent jamais le profil.
          api.getMyClubPackages(slug, token).then(setWalletPackages).catch(() => {});
          api.getMyClubSubscriptions(slug, token).then(setWalletSubs).catch(() => {});
          api.getMyPayments(slug, token).then(setPayments).catch(() => {});
        }
      } else {
        setMembership(null);
        setLicenceServer(null);
      }
```

**(d)** Supprimer le bloc du titre `<div style={{ padding: '18px 20px 0', … }}>Mon profil</div>` (lignes 240-242) — le hero porte le nom du joueur.

**(e)** Remplacer le bloc de rendu `{loading || !draft ? … : (…)}` (lignes 250-282) par :
```tsx
        {loading || !draft ? (
          <div style={{ padding: '24px 20px', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
        ) : (
          <>
            <ProfileHero
              profile={draft}
              avatarSrc={avatarSrc} initials={initials} uploading={uploading}
              fileRef={fileRef} onPickAvatar={pickAvatar}
              kicker={club?.name ?? 'Palova'}
              level={club?.levelSystemEnabled !== false ? (rating?.level ?? null) : null}
              isSubscriber={!!membership?.isSubscriber}
              memberSince={membership?.since ?? null}
              tabs={tabs} activeTab={activeTab} onTab={changeTab}
              compact={activeTab !== 'identite'}
            />
            <div style={{ padding: '16px 20px 0' }}>
              {activeTab === 'identite' && (
                <ProfileIdentity
                  profile={draft} set={set} sports={sports}
                  licence={isMember ? licenceDraft : null} clubName={club?.name ?? null} onLicence={setLicence}
                />
              )}
              {activeTab === 'niveau' && (
                <ProfileLevel
                  sports={sports} ratingSport={ratingSport} onRatingSport={setRatingSport}
                  rating={rating} history={history} matchStats={matchStats} clubName={club?.name ?? null}
                  calibrating={calibrating} ratingBusy={ratingBusy}
                  onStartCalibrate={() => setCalibrating(true)} onCalibrate={handleCalibrate}
                />
              )}
              {activeTab === 'preferences' && <ProfilePreferences profile={draft} set={set} />}
              {activeTab === 'portefeuille' && slug && (
                <ProfileWallet slug={slug} token={token} packages={walletPackages} subscriptions={walletSubs} payments={payments} />
              )}
              {activeTab === 'securite' && <ProfileSecurity token={token} />}

              <SaveBar dirty={dirty} saving={saving} error={saveError} saved={justSaved} onSave={save} onCancel={cancel} />
            </div>
          </>
        )}
```

⚠️ `tabs`, `activeTab`, `changeTab`, `avatarSrc` et `initials` sont déjà calculés plus haut dans le composant (lignes 205-221) — ne rien dupliquer.

- [ ] **Step 5 : Lancer les tests, vérifier qu'ils passent**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MeProfile.test.tsx
```
Attendu : PASS. En cas d'échec sur `getByText('Eric Nougayrede')`, vérifier que le hero reçoit `profile={draft}` (et non `server`).

- [ ] **Step 6 : Commit**

```bash
git add frontend/app/me/profile/page.tsx frontend/components/profile/tabs/ProfileIdentity.tsx frontend/__tests__/MeProfile.test.tsx
git commit -m "feat(profil): le hero remplace le titre, la carte Identite et les PillTabs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7 : Onglet Identité — champs à label intégré

**Files:**
- Modify: `frontend/components/profile/tabs/ProfileIdentity.tsx`
- Modify: `frontend/__tests__/MeProfile.test.tsx`

- [ ] **Step 1 : Adapter le test du sport préféré (il échouera)**

Le sport préféré passe de `PillTabs` à `PillChoice` (pills dans un champ). Le test actuel cherche `within(region).getByText('Padel')` dans la région « Sport préféré » — `PillChoice` rend un `role="group"` nommé « Sport préféré » à l'intérieur de la carte. Dans `frontend/__tests__/MeProfile.test.tsx`, remplacer le test `'le sport préféré est différé et part en preferredSportId'` par :

```tsx
  it('le sport préféré est différé et part en preferredSportId', async () => {
    api.getSports.mockResolvedValue([PADEL]);
    wrap();
    const group = await screen.findByRole('group', { name: 'Sport préféré' });
    fireEvent.click(within(group).getByRole('button', { name: 'Padel' }));
    expect(api.updateMyProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ preferredSportId: 'sport-padel' }), 'abc',
    ));
  });
```

Ajouter le test du sexe (aujourd'hui non couvert, et sa mécanique change) :
```tsx
  it('le sexe se choisit en pills et part dans le même PATCH', async () => {
    wrap();
    const group = await screen.findByRole('group', { name: 'Sexe' });
    fireEvent.click(within(group).getByRole('button', { name: 'Femme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ sex: 'FEMALE' }), 'abc',
    ));
  });
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MeProfile.test.tsx -t "sport préféré"
```
Attendu : FAIL — pas de `role="group"` nommé « Sport préféré » avec un bouton (aujourd'hui c'est un `<div role="group">` autour de `PillTabs`, dont les pills ne sont pas dans un `FieldShell`… le test peut passer par accident sur le sport ; le test « Sexe » échoue à coup sûr : aucun `role="group"` nommé « Sexe » n'existe).

- [ ] **Step 3 : Réécrire `ProfileIdentity.tsx`**

Contenu complet du fichier après refonte :

```tsx
'use client';
import type { Sex, Sport } from '@/lib/api';
import { DateField } from '@/components/ui/DateField';
import { CardKicker } from '@/components/profile/CardKicker';
import { FieldShell, PillChoice, ProfileInput } from '@/components/profile/ProfileFields';
import { ProfileTabProps, useProfileStyles } from '@/components/profile/shared';

interface Props extends ProfileTabProps {
  sports: Sport[];
  /** Licence : seconde ressource, rendue seulement si membre d'un club. */
  licence: string | null;
  clubName: string | null;
  onLicence: (v: string) => void;
}

const NO_SPORT = '__none__';

export function ProfileIdentity({ profile, set, sports, licence, clubName, onLicence }: Props) {
  const { th, card } = useProfileStyles();
  const hint = { fontFamily: th.fontUI, fontSize: 12, color: th.textFaint };

  return (
    <>
      {sports.length > 0 && (
        <section style={card} aria-label="Sport préféré">
          <CardKicker>Sport préféré</CardKicker>
          <PillChoice
            label="Sport préféré"
            value={profile.preferredSport?.id ?? NO_SPORT}
            onChange={(id) => set('preferredSport', id === NO_SPORT ? null : (sports.find((s) => s.id === id) ?? null))}
            options={[...sports.map((s) => ({ value: s.id, label: s.name })), { value: NO_SPORT, label: 'Aucun' }]}
          />
          <span style={hint}>Met en avant ce sport dans l&apos;app.</span>
        </section>
      )}

      <section style={card} aria-label="Informations">
        <CardKicker>Informations</CardKicker>
        <ProfileInput label="Téléphone" value={profile.phone ?? ''} onChange={(v) => set('phone', v)} placeholder="06 09 03 26 35" />
        <FieldShell label="Date de naissance">
          <DateField
            value={profile.birthDate ? profile.birthDate.slice(0, 10) : ''}
            onChange={(d) => set('birthDate', d || null)}
            width="100%" ariaLabel="Date de naissance"
          />
        </FieldShell>
        <PillChoice<Sex>
          label="Sexe" value={profile.sex} onChange={(v) => set('sex', v)}
          options={[{ value: 'MALE', label: 'Homme' }, { value: 'FEMALE', label: 'Femme' }]}
        />
      </section>

      {licence !== null && (
        <section style={card} aria-label="Licence">
          <CardKicker>Licence{clubName ? ` · ${clubName}` : ''}</CardKicker>
          <ProfileInput label="N° de licence / adhérent" value={licence} onChange={onLicence} placeholder="Ex. 7512345" />
        </section>
      )}
    </>
  );
}
```

⚠️ `PillChoice` prend `value: T | null` — pour le sport, la valeur « aucun » est la sentinelle `NO_SPORT` (et non `''`, qui rendrait la pill « Aucun » jamais active puisque `'' === null` est faux). Vérifier que `set('preferredSport', …)` reçoit bien `null` pour cette valeur.

⚠️ `DateField` posé dans un `FieldShell` : le shell ne pilote pas son focus (le `DateField` a son propre chrome). C'est assumé — il garde son `ariaLabel`.

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MeProfile.test.tsx
```
Attendu : PASS (dont « Annuler restaure aussi la licence » et « la licence passe par la barre »).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/profile/tabs/ProfileIdentity.tsx frontend/__tests__/MeProfile.test.tsx
git commit -m "feat(profil): onglet Identite aux champs a label integre

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8 : Onglet Préférences — interrupteurs

**Files:**
- Modify: `frontend/components/profile/tabs/ProfilePreferences.tsx`
- Modify: `frontend/__tests__/MeProfile.test.tsx`

- [ ] **Step 1 : Adapter le test (il échouera)**

Dans `frontend/__tests__/MeProfile.test.tsx`, remplacer le test `'les préférences sont différées : aucun appel réseau avant Enregistrer'` par :

```tsx
  it('les préférences sont différées : aucun appel réseau avant Enregistrer', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    goTab('Préférences');
    const sw = await screen.findByRole('switch', { name: /Propose-moi les parties à mon niveau/ });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(api.updateMyProfile).not.toHaveBeenCalled();
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ autoMatchProposals: true }), 'abc',
    ));
  });

  it('les 4 préférences sont des interrupteurs, pas des boutons Oui/Non', async () => {
    wrap();
    await screen.findByRole('region', { name: 'Informations' });
    goTab('Préférences');
    await screen.findByRole('region', { name: 'Préférences' });
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Oui' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MeProfile.test.tsx -t "préférences"
```
Attendu : FAIL — « Unable to find role="switch" ».

- [ ] **Step 3 : Réécrire `ProfilePreferences.tsx`**

Contenu complet du fichier après refonte :

```tsx
'use client';
import { ReactNode } from 'react';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { CardKicker } from '@/components/profile/CardKicker';
import { ProfileSelect } from '@/components/profile/ProfileFields';
import { ProfileTabProps, useProfileStyles } from '@/components/profile/shared';

const LOCALE_OPTIONS = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];

// ⚠️ Pas de sélecteur de thème ici : il n'a aucun état serveur, il ne peut donc pas passer
// par la SaveBar — et par la règle de la page (« un contrôle hors barre n'a pas le droit
// d'être habillé en champ »), il ne peut pas rester dans cette carte. Le ThemeToggle de
// l'en-tête (ClubNav, ou en-tête plateforme de la page) le couvre déjà.
export function ProfilePreferences({ profile, set }: ProfileTabProps) {
  const { th, card } = useProfileStyles();
  const hint = { fontFamily: th.fontUI, fontSize: 12, color: th.textFaint };

  // Lignes d'interrupteurs séparées par des filets fins ; la dernière n'en porte pas.
  const row = (node: ReactNode, last = false) => (
    <div style={{ borderBottom: last ? 'none' : `1px solid ${th.line}`, padding: '4px 0' }}>{node}</div>
  );

  return (
    <section style={card} aria-label="Préférences">
      <CardKicker>Préférences</CardKicker>

      <ProfileSelect label="Langue" value={profile.locale ?? 'fr'} onChange={(v) => set('locale', v)} options={LOCALE_OPTIONS} />
      <span style={{ ...hint, marginTop: -6 }}>L’interface reste en français pour l’instant.</span>

      <div style={{ marginTop: 4 }}>
        {row(
          <SwitchRow
            checked={profile.showInLeaderboard} onChange={(v) => set('showInLeaderboard', v)}
            title="Apparaître dans les classements"
          />,
        )}
        {row(
          <SwitchRow
            checked={profile.autoMatchProposals} onChange={(v) => set('autoMatchProposals', v)}
            title="Propose-moi les parties à mon niveau"
            description="Reçois une notification quand une partie ouverte à ton niveau est créée dans ton club. Tu rejoins en un tap — jamais d’inscription automatique."
          />,
        )}
        {row(
          <SwitchRow
            checked={profile.acceptsFriendRequests} onChange={(v) => set('acceptsFriendRequests', v)}
            title="Autoriser les demandes d'ami"
            description="Ce réglage ne concerne que les amitiés — la messagerie privée se règle séparément ci-dessous."
          />,
        )}
        {row(
          <SwitchRow
            checked={profile.acceptsDirectMessages} onChange={(v) => set('acceptsDirectMessages', v)}
            title="Recevoir des messages privés"
            description="Vos amis confirmés peuvent toujours vous écrire, même désactivé."
          />,
          true,
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MeProfile.test.tsx
```
Attendu : PASS (dont « la langue est différée » et « aucun sélecteur de thème »).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/profile/tabs/ProfilePreferences.tsx frontend/__tests__/MeProfile.test.tsx
git commit -m "feat(profil): preferences en interrupteurs a filets fins

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9 : Onglets Sécurité, Niveau, Portefeuille — kickers et champs

**Files:**
- Modify: `frontend/components/profile/tabs/ProfileSecurity.tsx`
- Modify: `frontend/components/profile/tabs/ProfileLevel.tsx`
- Modify: `frontend/components/profile/tabs/ProfileWallet.tsx`
- Modify: `frontend/components/profile/shared.ts`

- [ ] **Step 1 : Réécrire `ProfileSecurity.tsx`**

Seules changent la présentation (kickers, `ProfileInput`, kicker coral) et le style du bandeau d'erreur. La logique (validation 8 caractères, correspondance, appel API) est **inchangée**.

Remplacer le bloc `return (…)` (lignes 42-77) par :

```tsx
  return (
    <>
      <section style={card} aria-label="Mot de passe">
        <CardKicker>Mot de passe</CardKicker>
        <ProfileInput label="Mot de passe actuel" type="password" autoComplete="current-password"
          value={currentPassword} onChange={edit(setCurrentPassword)} />
        <ProfileInput label="Nouveau mot de passe" type="password" autoComplete="new-password"
          value={newPassword} onChange={edit(setNewPassword)} placeholder="8 caractères minimum" />
        <ProfileInput label="Confirmer le nouveau mot de passe" type="password" autoComplete="new-password"
          value={confirmPassword} onChange={edit(setConfirmPassword)} />
        {error && (
          <div style={{
            fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: inkOn(ACCENTS.coral),
            background: ACCENTS.coral, borderRadius: 11, padding: '9px 12px',
          }}>{error}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={changePassword} disabled={saving} style={primaryBtn(saving)}>Modifier le mot de passe</button>
          {saved && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute }}>Modifié ✓</span>}
        </div>
      </section>

      <section style={card} aria-label="Supprimer mon compte">
        <CardKicker tone="coral">Zone sensible</CardKicker>
        <DeleteAccountSection token={token} />
      </section>
    </>
  );
```

⚠️ `ProfileInput.onChange` livre une `string`, alors que le helper local `edit` attend un `ChangeEvent`. Remplacer le helper (lignes 23-25) par :
```tsx
  // ProfileInput livre la valeur, pas l'évènement.
  const edit = (fn: (v: string) => void) => (v: string) => { fn(v); setSaved(false); setError(null); };
```

Imports à ajuster en tête de fichier :
```tsx
import { ACCENTS, inkOn } from '@/lib/theme';
import { CardKicker } from '@/components/profile/CardKicker';
import { ProfileInput } from '@/components/profile/ProfileFields';
```
et la déstructuration devient : `const { th, card, primaryBtn } = useProfileStyles();` (plus de `cardTitle`/`label`/`input`).

⚠️ La `<section aria-label="Supprimer mon compte">` garde son `aria-label` (contrat de test possible) même si le kicker peint affiche « Zone sensible ». `DeleteAccountSection` n'est pas modifié.

- [ ] **Step 2 : `ProfileLevel.tsx` — kicker**

Dans `frontend/components/profile/tabs/ProfileLevel.tsx` :
- Remplacer `const { th, card, cardTitle, label } = useProfileStyles();` par `const { th, card, label } = useProfileStyles();`
- Remplacer `<div style={cardTitle}>Mon niveau · {levelSportName}</div>` par `<CardKicker>Mon niveau · {levelSportName}</CardKicker>`
- Ajouter l'import `import { CardKicker } from '@/components/profile/CardKicker';`

(`label` reste utilisé par le bloc `showLevelSportPicker`, aujourd'hui derrière un drapeau `false`.)

- [ ] **Step 3 : `ProfileWallet.tsx` — kickers**

Remplacer le contenu de `frontend/components/profile/tabs/ProfileWallet.tsx` par :

```tsx
'use client';
import type { MemberPackage, MyPayment, Subscription } from '@/lib/api';
import { WalletSection } from '@/components/profile/WalletSection';
import { PaymentMethodSection } from '@/components/profile/PaymentMethodSection';
import { PaymentsHistory } from '@/components/profile/PaymentsHistory';
import { CardKicker } from '@/components/profile/CardKicker';
import { useProfileStyles } from '@/components/profile/shared';

interface Props {
  slug: string;
  token: string;
  packages: MemberPackage[];
  subscriptions: Subscription[];
  payments: MyPayment[];
}

export function ProfileWallet({ slug, token, packages, subscriptions, payments }: Props) {
  const { card } = useProfileStyles();
  return (
    <>
      <section style={card} aria-label="Portefeuille">
        <CardKicker>Portefeuille</CardKicker>
        <WalletSection packages={packages} subscriptions={subscriptions} />
      </section>

      <section style={card} aria-label="Méthodes de paiement">
        <CardKicker>Méthodes de paiement</CardKicker>
        <PaymentMethodSection slug={slug} token={token} />
      </section>

      <section style={card} aria-label="Mes paiements">
        <CardKicker>Mes paiements</CardKicker>
        <PaymentsHistory payments={payments} />
      </section>
    </>
  );
}
```

- [ ] **Step 4 : Nettoyer `shared.ts` (code mort)**

Plus aucun onglet n'utilise `cardTitle` ni `input`. Vérifier :
```bash
cd frontend && grep -rn "cardTitle\|\binput\b" components/profile
```
Attendu : aucune occurrence dans les onglets (hors `ProfileFields.tsx` qui a ses propres styles). Retirer alors `cardTitle` et `input` de `useProfileStyles` (déclarations ET objet retourné) dans `frontend/components/profile/shared.ts`. Garder `th`, `card`, `label`, `primaryBtn`.

- [ ] **Step 5 : Lancer les suites**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MeProfile.test.tsx __tests__/ProfileFields.test.tsx __tests__/ProfileHero.test.tsx __tests__/meProfile.test.ts
```
Attendu : PASS partout — en particulier les 3 tests de mot de passe (« garde son bouton propre », « refuse une confirmation », « refuse un mot de passe trop court »).

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/profile
git commit -m "feat(profil): kickers et champs sur Securite, Niveau, Portefeuille + menage shared

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10 : Gate de types + suites complètes

Jest ne type-checke pas (ts-jest + isolatedModules) — `tsc` est la vraie gate.

- [ ] **Step 1 : Vérifier les types**

```bash
cd frontend && node node_modules/typescript/bin/tsc --noEmit
```
Attendu : aucune erreur **dans les fichiers de ce chantier**. ⚠️ Le repo porte un WIP parallèle : filtrer avec
```bash
cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "profile|ProfileHero|ProfileFields|CardKicker|SwitchRow|meProfile|api.ts"
```
Attendu : aucune sortie. Corriger toute erreur listée avant de continuer.

- [ ] **Step 2 : Lancer les suites voisines qui touchent aux fichiers déplacés**

```bash
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/SwitchRow.test.tsx __tests__/AdminSettings.test.tsx __tests__/AdminSettings.refresh.test.tsx __tests__/SaveBar.test.tsx
```
Attendu : PASS — le déménagement de `SwitchRow` ne change aucun comportement.

- [ ] **Step 3 : Backend**

```bash
cd backend && npx jest src/services/__tests__/club.service.test.ts
```
Attendu : PASS.

- [ ] **Step 4 : Commit (si des correctifs de types ont été nécessaires)**

```bash
git add -A frontend
git commit -m "fix(profil): corrections de types apres refonte

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(Si `tsc` était déjà propre et qu'aucun fichier n'a changé, sauter ce commit.)

---

### Task 11 : Vérification visuelle (CDP)

Une refonte purement visuelle ne se valide pas aux tests unitaires. **REQUIRED SUB-SKILL : `verify`** (skill du projet : screenshots Chrome headless + CDP, session authentifiée).

- [ ] **Step 1 : Relancer la stack**

```bash
cd "C:/ProjetsIA/05_PERSO/RESERVE/palova" && powershell -File start.ps1
```
⚠️ Obligatoire : Turbopack peut servir un CSS/chunk périmé après édition (piège documenté).

- [ ] **Step 2 : Capturer les 4 combinaisons sur l'hôte club**

Via la skill `verify`, sur `padel-arena-paris.localhost:3000/me/profile` (compte `test@palova.fr` / `password123`) :
- thème **clair** et **sombre**
- desktop **1280** et mobile **390**

⚠️ Piège d'émulation connu : en mobile, utiliser `mobile:false` + largeur fixe 390 — sinon l'émulation réajuste le viewport et **masque** un débordement horizontal réel.

Contrôler sur chaque capture :
1. Le hero est en brume bleue dans les DEUX thèmes, texte lisible (encre fixe).
2. L'onglet actif se soude au fond de page (clair ET sombre).
3. Les champs à label intégré sont lisibles sur la carte (le liseré `lineStrong` doit rester visible en thème clair).
4. Aucun débordement horizontal : `document.documentElement.scrollWidth <= window.innerWidth`.
5. Le badge de niveau et la pastille 📷 ne se chevauchent pas avec l'avatar 80 px.

- [ ] **Step 3 : Vérifier les onglets et l'hôte plateforme**

- Parcourir les 5 onglets (`?tab=identite|niveau|preferences|portefeuille|securite`) : le hero compact doit rester lisible et les onglets accessibles.
- Sur l'hôte plateforme `localhost:3000/me/profile` : kicker « Palova », pas de chips ni d'onglet Portefeuille.

- [ ] **Step 4 : Corriger les écarts visuels, recapturer, commit**

```bash
git add -A frontend
git commit -m "fix(profil): ajustements visuels apres verification CDP

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5 : Documenter dans CLAUDE.md**

Ajouter, à la fin de la section « Icône & menu profil (v1) » de `C:\ProjetsIA\05_PERSO\RESERVE\palova\CLAUDE.md`, un paragraphe d'évolution daté (`> **Évolution (2026-07-17) — profil « carte de joueur » …**`) résumant : hero `ProfileHero` (absorbe titre + carte Identité + PillTabs), primitifs `CardKicker`/`ProfileFields`, `SwitchRow` déménagé dans `components/ui/`, `since` additif dans le payload membership, et le piège de la sentinelle de test (`region 'Identité'` → `'Informations'`). Citer la spec.

```bash
git add CLAUDE.md
git commit -m "docs(claude): profil carte de joueur

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Points de vigilance (récapitulatif)

1. **La sentinelle de test** `region 'Identité'` → `'Informations'` : Task 6, en une fois.
2. **Encre fixe** dans le hero : `HERO_INK`/`HERO_INK_MUTED`, jamais `th.text` (illisible en thème sombre sur un dégradé clair).
3. **`aria-label` = contrat** : le libellé peint est `aria-hidden`, l'input porte le label.
4. **`buildProfileBody` n'est pas touché** — aucun champ nouveau ; si un champ éditable en sortait, il serait silencieusement non-sauvé.
5. **`save()` ne repose jamais `draft`** (seulement `server`) et **l'avatar ne patche que `avatarUrl`** — deux régressions déjà couvertes par des tests ; ne pas les casser en refactorant la page.
6. **`PillChoice` du sport** : sentinelle `NO_SPORT`, pas `''`.
7. **`DateField`/`TimePicker`/`SaveBar`/`PillTabs`/`Segmented`** : composants partagés, hors périmètre.
