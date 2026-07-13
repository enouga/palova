# Rôles admin vs staff — gating dashboard/sidebar + explication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le staff ne voit plus le guide de démarrage, la bannière abonnement ni l'entrée sidebar « Abonnement Palova » (gating intentionnel côté front), et la règle « compte gérant obligatoire / le staff voit moins » est expliquée à la création du club et dans la FAQ plateforme.

**Architecture:** Le layout `/admin` récupère le rôle du viewer depuis le `getMyClubs` qu'il appelle déjà pour sa garde, et l'expose via un contexte `AdminRoleContext` défini dans `frontend/lib/adminRole.ts` (avec le helper pur `isClubAdmin`). Sidebar et dashboard consomment ce contexte. Les textes d'explication sont ajoutés à `/clubs/new`, à l'écran final du wizard d'onboarding et à `PLATFORM_FAQ`. **100 % frontend, aucune migration, aucun changement backend** (les gardes serveur `requireClubMember('ADMIN')` restent la défense en profondeur).

**Tech Stack:** Next.js 16 / React 19, Jest + React Testing Library (ts-jest, PAS de type-check → `tsc --noEmit` en garde séparée).

**Spec:** `docs/superpowers/specs/2026-07-13-roles-admin-staff-dashboard-design.md`

---

## ⚠️ Notes d'environnement (Windows, ce repo)

- **Shims `node_modules/.bin` cassés** : `npx jest` / `npx tsc` échouent. Lancer directement :
  `node node_modules/jest/bin/jest.js …` et `node node_modules/typescript/bin/tsc --noEmit`.
- **Le cwd PowerShell se réinitialise à chaque commande** : préfixer chaque commande par
  `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; …` (PS 5.1 : pas de `&&`, utiliser `;`).
- **WIP parallèle dans l'arbre de travail** (BookingModal, reservation.service…) : ne JAMAIS
  `git add -A`. Chaque commit n'ajoute QUE les fichiers de sa tâche. Vérifier `git branch --show-current`
  = `main` avant chaque commit.
- ts-jest ne type-checke pas : `tsc --noEmit` peut remonter des erreurs du WIP parallèle —
  ne s'occuper que des erreurs dans les fichiers touchés par ce plan.

## File Structure

| Fichier | Rôle |
|---|---|
| **Create** `frontend/lib/adminRole.ts` | Type `ClubStaffRole`, helper pur `isClubAdmin`, contexte `AdminRoleContext` + hook `useAdminRole` |
| **Create** `frontend/__tests__/adminRole.test.ts` | Tests du helper pur |
| **Modify** `frontend/app/admin/layout.tsx` | Garde retient le rôle, fournit le contexte, gate l'entrée « Abonnement Palova » |
| **Modify** `frontend/__tests__/AdminLayout.test.tsx` | Rôle dans les mocks + describe « entrées gatées par rôle » |
| **Modify** `frontend/app/admin/page.tsx` | `StartChecklist`/`BillingBanner` gatés sur `isClubAdmin(role)` |
| **Create** `frontend/__tests__/AdminDashboard.test.tsx` | STAFF → composants non montés (0 appel API) ; ADMIN → montés |
| **Modify** `frontend/app/clubs/new/page.tsx` | Ligne d'explication sous le bloc « Gérant » |
| **Modify** `frontend/__tests__/NewClubPage.test.tsx` | Assertion du texte |
| **Modify** `frontend/components/onboarding/StepLaunch.tsx` | Mention « Invitez votre équipe » sur l'écran final |
| **Modify** `frontend/__tests__/StepRulesLaunch.test.tsx` | Assertion de la mention |
| **Modify** `frontend/lib/platformContent.ts` | Entrée FAQ « Gérant, admin, staff : qui voit quoi ? » |

---

### Task 1: Helper pur + contexte `lib/adminRole.ts`

**Files:**
- Create: `frontend/lib/adminRole.ts`
- Test: `frontend/__tests__/adminRole.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/adminRole.test.ts` :

```ts
import { isClubAdmin } from '../lib/adminRole';

describe('isClubAdmin', () => {
  it('OWNER et ADMIN sont admins', () => {
    expect(isClubAdmin('OWNER')).toBe(true);
    expect(isClubAdmin('ADMIN')).toBe(true);
  });

  it('STAFF, null et undefined ne le sont pas', () => {
    expect(isClubAdmin('STAFF')).toBe(false);
    expect(isClubAdmin(null)).toBe(false);
    expect(isClubAdmin(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/adminRole.test.ts`
Expected: FAIL — `Cannot find module '../lib/adminRole'`

- [ ] **Step 3: Implémenter**

Créer `frontend/lib/adminRole.ts` :

```ts
'use client';
import { createContext, useContext } from 'react';

/** Rôle back-office d'un membre du club (miroir de ManagedClub.role, lib/api.ts). */
export type ClubStaffRole = 'OWNER' | 'ADMIN' | 'STAFF';

/**
 * Le viewer voit-il les éléments réservés aux admins (guide de démarrage, abonnement
 * Palova) ? Miroir front des gardes serveur requireClubMember('ADMIN').
 */
export function isClubAdmin(role: ClubStaffRole | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/**
 * Rôle du viewer sur le club courant, posé par le layout /admin (qui le lit dans le
 * getMyClubs de sa garde d'accès — aucun appel API supplémentaire). null = inconnu,
 * traité partout comme « pas admin » (sûr par défaut).
 */
export const AdminRoleContext = createContext<ClubStaffRole | null>(null);
export function useAdminRole() { return useContext(AdminRoleContext); }
```

- [ ] **Step 4: Vérifier qu'il passe**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/adminRole.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova
git branch --show-current   # doit afficher: main
git add frontend/lib/adminRole.ts frontend/__tests__/adminRole.test.ts
git commit -m @'
feat(roles): helper isClubAdmin + contexte AdminRole (lib/adminRole)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 2: Layout admin — rôle exposé + « Abonnement Palova » masqué au staff

**Files:**
- Modify: `frontend/app/admin/layout.tsx` (garde ~l.69-80, section Finances ~l.152-158, returns ~l.117 et ~l.183)
- Test: `frontend/__tests__/AdminLayout.test.tsx`

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `frontend/__tests__/AdminLayout.test.tsx` :

**(a)** Mettre à jour les DEUX `beforeEach` existants (describe « toggle de la sidebar » et
« sections repliables ») — le mock `getMyClubs` porte désormais un rôle :

```ts
api.getMyClubs.mockResolvedValue([{ clubId: 'c1', role: 'OWNER' }]);
```

**(b)** Ajouter un nouveau describe en fin de fichier :

```tsx
describe('AdminLayout — entrées gatées par rôle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockClubCtx.slug = 'demo';
    mockClubCtx.club = clubOn;
  });

  it('OWNER : entrée « Abonnement Palova » présente', async () => {
    api.getMyClubs.mockResolvedValue([{ clubId: 'c1', role: 'OWNER' }]);
    await wrap();
    expect(screen.getByText('Abonnement Palova')).toBeInTheDocument();
  });

  it('ADMIN : entrée « Abonnement Palova » présente', async () => {
    api.getMyClubs.mockResolvedValue([{ clubId: 'c1', role: 'ADMIN' }]);
    await wrap();
    expect(screen.getByText('Abonnement Palova')).toBeInTheDocument();
  });

  it('STAFF : pas d’entrée « Abonnement Palova » (le reste de Finances est rendu)', async () => {
    api.getMyClubs.mockResolvedValue([{ clubId: 'c1', role: 'STAFF' }]);
    await wrap();
    expect(screen.getByText('Paiements')).toBeInTheDocument(); // la section Finances est là
    expect(screen.queryByText('Abonnement Palova')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Vérifier que les nouveaux tests échouent**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/AdminLayout.test.tsx`
Expected: FAIL — le test STAFF échoue (« Abonnement Palova » encore présent) ; les tests existants et OWNER/ADMIN passent.

- [ ] **Step 3: Implémenter dans `app/admin/layout.tsx`**

**(a)** Ajouter l'import (après la ligne `import { Icon, type IconName } from '@/components/ui/Icon';`) :

```ts
import { AdminRoleContext, isClubAdmin, type ClubStaffRole } from '@/lib/adminRole';
```

**(b)** Ajouter l'état du rôle (à côté de `const [allowed, setAllowed] = useState<boolean | null>(null);`) :

```ts
const [role, setRole] = useState<ClubStaffRole | null>(null);
```

**(c)** Remplacer le corps du `.then` de la garde :

```ts
    api.getMyClubs(token)
      .then((cs) => setAllowed(cs.some((c) => c.clubId === club.id)))
      .catch(() => setAllowed(false));
```

devient :

```ts
    api.getMyClubs(token)
      .then((cs) => {
        const mine = cs.find((c) => c.clubId === club.id);
        setAllowed(!!mine);
        setRole(mine?.role ?? null);
      })
      .catch(() => setAllowed(false));
```

**(d)** L'early-return du wizard fournit aussi le contexte :

```tsx
  // Le wizard d'onboarding est plein écran : pas de chrome admin (la garde ci-dessus s'applique déjà).
  if (pathname === '/admin/onboarding') return <AdminRoleContext.Provider value={role}>{children}</AdminRoleContext.Provider>;
```

**(e)** Gater l'entrée billing dans la section Finances (même pattern que le lien « Matchs ») :

```ts
    { title: 'Finances', color: '#5bbd6e', items: [
      { href: '/admin/reservations', label: 'Paiements',         icon: 'ticket' },
      { href: '/admin/payments',     label: 'Paiement en ligne', icon: 'lock' },
      { href: '/admin/comptabilite', label: 'Comptabilité',     icon: 'chart' },
      { href: '/admin/packages',     label: 'Offres prépayées', icon: 'card' },
      // Réservé aux admins : la page /admin/billing répond 403 au staff (requireClubMember('ADMIN')).
      ...(isClubAdmin(role)
        ? [{ href: '/admin/billing', label: 'Abonnement Palova', icon: 'wallet' } as NavItem]
        : []),
    ] },
```

**(f)** Envelopper le return principal dans le provider (ligne `return (` du grand JSX) :

```tsx
  return (
    <AdminRoleContext.Provider value={role}>
    <AdminChromeContext.Provider value={{ collapsed, setCollapsed }}>
    …(JSX existant inchangé)…
    </AdminChromeContext.Provider>
    </AdminRoleContext.Provider>
  );
```

- [ ] **Step 4: Vérifier que tout passe**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/AdminLayout.test.tsx`
Expected: PASS (toutes les suites du fichier, dont les 3 nouvelles)

- [ ] **Step 5: Commit**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova
git branch --show-current   # main
git add frontend/app/admin/layout.tsx frontend/__tests__/AdminLayout.test.tsx
git commit -m @'
feat(roles): sidebar admin - Abonnement Palova masque au staff (role via layout)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 3: Dashboard — guide + bannière réservés aux admins

**Files:**
- Modify: `frontend/app/admin/page.tsx` (imports + l.75-76)
- Test: Create `frontend/__tests__/AdminDashboard.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/AdminDashboard.test.tsx` :

```tsx
import { render, screen, act } from '@testing-library/react';
import AdminDashboard from '../app/admin/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { AdminRoleContext, type ClubStaffRole } from '../lib/adminRole';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo' }, loading: false }),
}));
jest.mock('../lib/api', () => ({
  api: {
    adminGetReservations: jest.fn(),
    adminGetOnboardingStatus: jest.fn(),
    adminGetBilling: jest.fn(),
  },
  assetUrl: (p: string | null) => p,
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const mount = async (role: ClubStaffRole) => {
  render(
    <ThemeProvider>
      <AdminRoleContext.Provider value={role}>
        <AdminDashboard />
      </AdminRoleContext.Provider>
    </ThemeProvider>,
  );
  await act(async () => {});
};

describe('AdminDashboard — gating par rôle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    api.adminGetReservations.mockResolvedValue({ reservations: [], summary: { paidTotal: 0, total: 0 } });
    // Jamais résolu : on teste le MONTAGE (l'appel part ou pas), pas le rendu interne
    // (couvert par StartChecklist.test) — et la forme d'OnboardingStatus n'importe pas ici.
    api.adminGetOnboardingStatus.mockReturnValue(new Promise(() => {}));
    api.adminGetBilling.mockResolvedValue({ state: 'TO_REGULARIZE', activeMembers: 60, monthlyPriceCents: 2900 });
  });

  it('STAFF : ni guide ni bannière — aucun appel onboarding-status/billing', async () => {
    await mount('STAFF');
    expect(screen.getByText('Tableau de bord')).toBeInTheDocument();
    expect(api.adminGetOnboardingStatus).not.toHaveBeenCalled();
    expect(api.adminGetBilling).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument(); // pas de bannière
  });

  it('ADMIN : guide + bannière montés (appels effectués, bannière rendue)', async () => {
    await mount('ADMIN');
    expect(api.adminGetOnboardingStatus).toHaveBeenCalled();
    expect(api.adminGetBilling).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toBeInTheDocument(); // bannière TO_REGULARIZE
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/AdminDashboard.test.tsx`
Expected: FAIL — le test STAFF échoue (`adminGetOnboardingStatus`/`adminGetBilling` appelés) ; le test ADMIN passe déjà.

- [ ] **Step 3: Implémenter dans `app/admin/page.tsx`**

**(a)** Ajouter l'import :

```ts
import { isClubAdmin, useAdminRole } from '@/lib/adminRole';
```

**(b)** Lire le rôle dans le composant (à côté de `const { club } = useClub();`) :

```ts
const role = useAdminRole();
```

**(c)** Remplacer :

```tsx
      {clubId && token && <StartChecklist clubId={clubId} token={token} />}
      {clubId && token && <BillingBanner clubId={clubId} token={token} />}
```

par :

```tsx
      {/* Réservé aux admins : le backend répond 403 au staff sur ces deux endpoints. */}
      {isClubAdmin(role) && clubId && token && <StartChecklist clubId={clubId} token={token} />}
      {isClubAdmin(role) && clubId && token && <BillingBanner clubId={clubId} token={token} />}
```

- [ ] **Step 4: Vérifier que tout passe**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/AdminDashboard.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova
git branch --show-current   # main
git add frontend/app/admin/page.tsx frontend/__tests__/AdminDashboard.test.tsx
git commit -m @'
feat(roles): dashboard - guide de demarrage + banniere abonnement reserves aux admins

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 4: `/clubs/new` — explication du compte gérant

**Files:**
- Modify: `frontend/app/clubs/new/page.tsx` (après le champ mot de passe, ~l.100)
- Test: `frontend/__tests__/NewClubPage.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Dans `frontend/__tests__/NewClubPage.test.tsx`, ajouter dans le describe existant :

```tsx
  it('explique que le compte créé est le compte gérant (admin) du club', async () => {
    render(<ThemeProvider><NewClubPage /></ThemeProvider>);
    expect(screen.getByText(/compte gérant \(administrateur\)/)).toBeInTheDocument();
    expect(screen.getByText(/nommer des admins et du staff/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Sport principal')).toBeInTheDocument());
  });
```

(Le `waitFor` final laisse la promesse `getSports` se résoudre — évite le warning act.)

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/NewClubPage.test.tsx`
Expected: FAIL — `Unable to find an element with the text: /compte gérant \(administrateur\)/`

- [ ] **Step 3: Implémenter**

Dans `frontend/app/clubs/new/page.tsx`, juste APRÈS la ligne du champ mot de passe :

```tsx
          <Field label="Mot de passe (8+ caractères)" icon="lock" type="password" value={password} onChange={setPassword} required autoComplete="new-password" />
```

insérer :

```tsx
          <p style={{ margin: 0, fontFamily: th.fontUI, fontSize: 12.5, lineHeight: 1.55, color: th.textMute }}>
            Ce compte sera le <strong style={{ color: th.text, fontWeight: 700 }}>compte gérant (administrateur)</strong> de
            votre club : lui seul gère l’abonnement Palova et pilote la configuration. Vous pourrez ensuite
            nommer des admins et du staff depuis la page Membres — le staff gère le quotidien sans voir ces informations.
          </p>
```

(Apostrophes typographiques `’` comme le reste du fichier.)

- [ ] **Step 4: Vérifier que tout passe**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/NewClubPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova
git branch --show-current   # main
git add frontend/app/clubs/new/page.tsx frontend/__tests__/NewClubPage.test.tsx
git commit -m @'
feat(roles): explication compte gerant a la creation du club (/clubs/new)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 5: Wizard d'onboarding — rappel équipe sur l'écran final

**Files:**
- Modify: `frontend/components/onboarding/StepLaunch.tsx` (phase `done`, entre le bloc CTAs et le `LivePhonePreview`)
- Test: `frontend/__tests__/StepRulesLaunch.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Dans `frontend/__tests__/StepRulesLaunch.test.tsx`, test « mise en ligne → … final festif »,
ajouter après l'assertion des CTAs (`…Aller à l’espace de gestion…`) :

```tsx
    // rappel rôles : inviter son équipe, le staff voit moins
    expect(screen.getByText(/Invitez votre équipe/)).toBeInTheDocument();
    expect(screen.getByText(/ne voit ni l’abonnement Palova ni ce guide/)).toBeInTheDocument();
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/StepRulesLaunch.test.tsx`
Expected: FAIL — `Unable to find an element with the text: /Invitez votre équipe/`

- [ ] **Step 3: Implémenter**

Dans `frontend/components/onboarding/StepLaunch.tsx`, phase `done`, juste APRÈS le `</div>` du
bloc des deux CTAs (`Découvrir mon club-house` / `Aller à l’espace de gestion`) et AVANT le
`<div>` du `LivePhonePreview`, insérer :

```tsx
      <p style={{ margin: '18px auto 0', maxWidth: 520, color: WIZ.mute, fontFamily: th.fontUI, fontSize: 12.5, lineHeight: 1.55 }}>
        Invitez votre équipe : nommez des admins ou du staff depuis la page Membres. Le staff gère
        le quotidien (planning, caisse) mais ne voit ni l’abonnement Palova ni ce guide.
      </p>
```

- [ ] **Step 4: Vérifier que tout passe**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/StepRulesLaunch.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova
git branch --show-current   # main
git add frontend/components/onboarding/StepLaunch.tsx frontend/__tests__/StepRulesLaunch.test.tsx
git commit -m @'
feat(roles): rappel equipe (admins/staff) sur l ecran final du wizard onboarding

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 6: FAQ plateforme — « Gérant, admin, staff : qui voit quoi ? »

**Files:**
- Modify: `frontend/lib/platformContent.ts` (tableau `PLATFORM_FAQ`, rubrique `Démarrer`)

- [ ] **Step 1: Ajouter l'entrée**

Dans `PLATFORM_FAQ`, juste APRÈS l'entrée `'Mes adhérents doivent-ils installer une application ?'`,
insérer :

```ts
  { category: 'Démarrer', question: 'Gérant, admin, staff : qui voit quoi ?', answer: 'Chaque club a obligatoirement un compte gérant, créé en même temps que le club (il ne peut pas être supprimé). Le gérant a tous les droits, dont la gestion de l\'abonnement Palova. Il peut nommer des admins (toute la gestion du club) et du staff depuis la page Membres, bouton « Rôle… ». Le staff gère le quotidien (planning, caisse, réservations, membres) mais ne voit ni l\'abonnement Palova, ni le guide de démarrage, ni les outils réservés aux admins.' },
```

(Données statiques : pas de test dédié — la FaqView rend `PLATFORM_FAQ` telle quelle.)

- [ ] **Step 2: Type-check du fichier**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur dans `lib/platformContent.ts` (ignorer les éventuelles erreurs du WIP parallèle dans d'autres fichiers).

- [ ] **Step 3: Commit**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova
git branch --show-current   # main
git add frontend/lib/platformContent.ts
git commit -m @'
docs(faq): entree Gerant, admin, staff - qui voit quoi (FAQ plateforme)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 7: Vérification finale

- [ ] **Step 1: Suites scoping du plan**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/adminRole.test.ts __tests__/AdminLayout.test.tsx __tests__/AdminDashboard.test.tsx __tests__/NewClubPage.test.tsx __tests__/StepRulesLaunch.test.tsx`
Expected: PASS (5 suites). ⚠️ Ne PAS lancer la suite complète pour valider : flake d'isolation
BookingModal connu sur le full-run.

- [ ] **Step 2: Type-check**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur dans les fichiers du plan (`lib/adminRole.ts`, `app/admin/layout.tsx`,
`app/admin/page.tsx`, `app/clubs/new/page.tsx`, `components/onboarding/StepLaunch.tsx`,
`lib/platformContent.ts`). Les erreurs éventuelles d'autres fichiers relèvent du WIP parallèle.

- [ ] **Step 3 (optionnel mais recommandé): Vérification visuelle**

Avec la skill `verify` (stack locale) :
- `/admin` connecté en gérant (`club-owner` seedé) : guide + bannière visibles, « Abonnement Palova » dans Finances.
- `/admin` connecté en staff : ni guide ni bannière, pas d'entrée « Abonnement Palova ».
  (Pour créer un staff en dev : page Membres → bouton « Rôle… » sur un membre.)
- `/clubs/new` : la ligne d'explication sous le bloc Gérant, sans débordement mobile (390px).
- `/faq` sur l'hôte plateforme : nouvelle entrée dans « Démarrer ».
