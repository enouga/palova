# Onboarding création de club — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wizard immersif 5 étapes à la création d'un club (aperçu téléphone vivant + final festif) + checklist « Guide de démarrage » dérivée de l'état réel sur le dashboard admin.

**Architecture:** Aucune migration. Un seul endpoint backend read-only (`GET /api/clubs/:clubId/admin/onboarding-status`, `OnboardingService` à base de `count()`). Tout le wizard réutilise les routes admin existantes (`adminUpdateClub`, `adminAddSport`, `adminCreateResource`, `uploadClubLogo`) ; chaque étape enregistre immédiatement. Helpers purs testés dans `frontend/lib/onboarding.ts`.

**Tech Stack:** Express 5 + Prisma 7 (mock `jest-mock-extended`), Next.js 16 client components + inline styles `th.*`, Jest/RTL.

**Spec:** `docs/superpowers/specs/2026-07-06-onboarding-club-design.md`

**Conventions repo (rappels):**
- Backend, lancer un test : depuis `backend/`, `npx jest src/services/__tests__/onboarding.service.test.ts` (si le shim `.cmd` casse : `node node_modules/jest/bin/jest.js <motif>`).
- Frontend, lancer un test : depuis `frontend/`, `node node_modules/jest/bin/jest.js onboarding` ; types : `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (jest ne type-checke pas).
- Les tests front qui mockent `@/lib/api` doivent exposer `assetUrl` (via `...jest.requireActual('@/lib/api')`).
- Commits en français, style `feat(onboarding): …`.

---

## File Structure

**Backend**
- Create `backend/src/services/onboarding.service.ts` — `OnboardingService.getStatus(clubId)` (dérivation pure de l'état réel).
- Create `backend/src/services/__tests__/onboarding.service.test.ts`
- Modify `backend/src/routes/admin.ts` — import + instance + route `GET /onboarding-status` (après le bloc présentation, ~l.1234).
- Create `backend/src/routes/__tests__/admin.onboarding.routes.test.ts`

**Frontend**
- Modify `frontend/lib/api.ts` — type `OnboardingStatus` + méthode `adminGetOnboardingStatus`.
- Create `frontend/lib/onboarding.ts` — helpers purs (checklist, presets, `resourceNames`, types wizard).
- Create `frontend/__tests__/onboarding.test.ts`
- Create `frontend/components/admin/StartChecklist.tsx` + `frontend/__tests__/StartChecklist.test.tsx`
- Modify `frontend/app/admin/page.tsx` — monter la carte checklist.
- Create `frontend/components/onboarding/LivePhonePreview.tsx` (+ test)
- Create `frontend/components/onboarding/OnboardingWizard.tsx` (shell) et `StepIdentity.tsx`, `StepSports.tsx`, `StepCourts.tsx`, `StepRules.tsx`, `StepLaunch.tsx` + `frontend/__tests__/OnboardingWizard.test.tsx`
- Create `frontend/app/admin/onboarding/page.tsx`
- Modify `frontend/app/admin/layout.tsx` — bypass sidebar pour `/admin/onboarding` (après la garde).
- Modify `frontend/app/clubs/new/page.tsx:41` — redirection vers `/admin/onboarding`.

---

### Task 1: Backend — `OnboardingService.getStatus`

**Files:**
- Create: `backend/src/services/onboarding.service.ts`
- Test: `backend/src/services/__tests__/onboarding.service.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// backend/src/services/__tests__/onboarding.service.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { OnboardingService } from '../onboarding.service';

describe('OnboardingService.getStatus', () => {
  let service: OnboardingService;
  beforeEach(() => { service = new OnboardingService(); });

  const mockCounts = (c: {
    sports?: number; resources?: number; photos?: number;
    templates?: number; plans?: number; tournaments?: number; events?: number;
  }) => {
    prismaMock.clubSport.count.mockResolvedValue(c.sports ?? 0);
    prismaMock.resource.count.mockResolvedValue(c.resources ?? 0);
    prismaMock.clubPhoto.count.mockResolvedValue(c.photos ?? 0);
    prismaMock.packageTemplate.count.mockResolvedValue(c.templates ?? 0);
    prismaMock.subscriptionPlan.count.mockResolvedValue(c.plans ?? 0);
    prismaMock.tournament.count.mockResolvedValue(c.tournaments ?? 0);
    prismaMock.clubEvent.count.mockResolvedValue(c.events ?? 0);
  };

  it('club nu : tout à faux/zéro', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      logoUrl: null, presentationText: null, stripeAccountStatus: 'NONE',
    } as any);
    mockCounts({});
    const s = await service.getStatus('c1');
    expect(s).toEqual({
      hasLogo: false, sportsCount: 0, resourcesCount: 0,
      hasPresentation: false, stripeStatus: 'NONE', offersCount: 0, eventsCount: 0,
    });
  });

  it('club configuré : dérive logo, présentation (texte OU photos), offres et events cumulés', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      logoUrl: '/uploads/logo.png', presentationText: '  ', stripeAccountStatus: 'ACTIVE',
    } as any);
    mockCounts({ sports: 2, resources: 4, photos: 3, templates: 1, plans: 2, tournaments: 1, events: 1 });
    const s = await service.getStatus('c1');
    expect(s.hasLogo).toBe(true);
    // presentationText blanc mais 3 photos → présentation considérée faite
    expect(s.hasPresentation).toBe(true);
    expect(s.sportsCount).toBe(2);
    expect(s.resourcesCount).toBe(4);
    expect(s.stripeStatus).toBe('ACTIVE');
    expect(s.offersCount).toBe(3);   // templates + plans
    expect(s.eventsCount).toBe(2);   // tournois + events
    // seules les ressources actives et les offres actives comptent
    expect(prismaMock.resource.count).toHaveBeenCalledWith({ where: { clubId: 'c1', isActive: true } });
    expect(prismaMock.packageTemplate.count).toHaveBeenCalledWith({ where: { clubId: 'c1', isActive: true } });
    expect(prismaMock.subscriptionPlan.count).toHaveBeenCalledWith({ where: { clubId: 'c1', isActive: true } });
  });

  it('presentationText non vide suffit sans photo', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      logoUrl: null, presentationText: 'Bienvenue', stripeAccountStatus: 'PENDING',
    } as any);
    mockCounts({});
    const s = await service.getStatus('c1');
    expect(s.hasPresentation).toBe(true);
    expect(s.stripeStatus).toBe('PENDING');
  });

  it('club inconnu → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(service.getStatus('nope')).rejects.toThrow('CLUB_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run (depuis `backend/`): `npx jest src/services/__tests__/onboarding.service.test.ts`
Expected: FAIL — `Cannot find module '../onboarding.service'`.

- [ ] **Step 3: Implémenter le service**

```ts
// backend/src/services/onboarding.service.ts
import { prisma } from '../db/prisma';

/**
 * Statut d'avancement du paramétrage d'un club, dérivé de l'état réel.
 * Rien n'est stocké : la checklist du dashboard se coche toute seule.
 */
export class OnboardingService {
  async getStatus(clubId: string) {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { logoUrl: true, presentationText: true, stripeAccountStatus: true },
    });
    if (!club) throw new Error('CLUB_NOT_FOUND');

    const [sportsCount, resourcesCount, photosCount, templatesCount, plansCount, tournamentsCount, clubEventsCount] = await Promise.all([
      prisma.clubSport.count({ where: { clubId } }),
      prisma.resource.count({ where: { clubId, isActive: true } }),
      prisma.clubPhoto.count({ where: { clubId } }),
      prisma.packageTemplate.count({ where: { clubId, isActive: true } }),
      prisma.subscriptionPlan.count({ where: { clubId, isActive: true } }),
      prisma.tournament.count({ where: { clubId } }),
      prisma.clubEvent.count({ where: { clubId } }),
    ]);

    return {
      hasLogo: !!club.logoUrl,
      sportsCount,
      resourcesCount,
      hasPresentation: (club.presentationText ?? '').trim().length > 0 || photosCount > 0,
      stripeStatus: club.stripeAccountStatus,
      offersCount: templatesCount + plansCount,
      eventsCount: tournamentsCount + clubEventsCount,
    };
  }
}
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `npx jest src/services/__tests__/onboarding.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/onboarding.service.ts backend/src/services/__tests__/onboarding.service.test.ts
git commit -m "feat(onboarding): OnboardingService.getStatus (statut derive de l'etat reel du club)"
```

---

### Task 2: Backend — route `GET /onboarding-status`

**Files:**
- Modify: `backend/src/routes/admin.ts` (imports ~l.31, instances ~l.53, route après le bloc présentation ~l.1234)
- Test: `backend/src/routes/__tests__/admin.onboarding.routes.test.ts`

- [ ] **Step 1: Écrire le test de route qui échoue**

```ts
// backend/src/routes/__tests__/admin.onboarding.routes.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

let getStatusImpl = jest.fn();

jest.mock('../../services/onboarding.service', () => ({
  OnboardingService: jest.fn().mockImplementation(() => ({
    getStatus: (...a: any[]) => getStatusImpl(...a),
  })),
}));

import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const auth = { Authorization: `Bearer ${jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!)}` };
const url = '/api/clubs/club-demo/admin/onboarding-status';

beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'ADMIN' } as any);
  prismaMock.user.findUnique.mockResolvedValue({ email: 'owner@x.fr' } as any);
  getStatusImpl = jest.fn().mockResolvedValue({
    hasLogo: true, sportsCount: 1, resourcesCount: 4,
    hasPresentation: false, stripeStatus: 'NONE', offersCount: 0, eventsCount: 0,
  });
});

describe('GET /api/clubs/:clubId/admin/onboarding-status', () => {
  it('401 sans token', async () => {
    expect((await request(app).get(url)).status).toBe(401);
  });

  it('403 pour STAFF', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
    expect((await request(app).get(url).set(auth)).status).toBe(403);
  });

  it('200 pour ADMIN, renvoie le statut du service', async () => {
    const res = await request(app).get(url).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.resourcesCount).toBe(4);
    expect(getStatusImpl).toHaveBeenCalledWith('club-demo');
  });

  it('404 si le service jette CLUB_NOT_FOUND', async () => {
    getStatusImpl.mockRejectedValue(new Error('CLUB_NOT_FOUND'));
    expect((await request(app).get(url).set(auth)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `npx jest src/routes/__tests__/admin.onboarding.routes.test.ts`
Expected: FAIL — le service existe (Task 1) mais la route non : le test « 200 pour ADMIN » reçoit un 404.

- [ ] **Step 3: Brancher la route dans `admin.ts`**

Ajouter l'import à côté des autres imports de services (~l.31) :

```ts
import { OnboardingService } from '../services/onboarding.service';
```

Ajouter l'instance à côté des autres (~l.53) :

```ts
const onboardingService = new OnboardingService();
```

Ajouter la route juste après le bloc « Page club (présentation + galerie) » (après le `router.delete('/photos/:id', …)`, ~l.1234) :

```ts
// ---- Guide de démarrage (onboarding) ----
router.get('/onboarding-status', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await onboardingService.getStatus(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
```

Note : `CLUB_NOT_FOUND: 404` existe déjà dans `ERROR_STATUS` — rien à ajouter.

- [ ] **Step 4: Vérifier que le test passe**

Run: `npx jest src/routes/__tests__/admin.onboarding.routes.test.ts`
Expected: PASS (4 tests). Puis suite backend complète : `npm test` → tout vert.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.onboarding.routes.test.ts
git commit -m "feat(onboarding): route GET /api/clubs/:clubId/admin/onboarding-status"
```

---

### Task 3: Front — type API + helpers purs `lib/onboarding.ts`

**Files:**
- Modify: `frontend/lib/api.ts` (méthode après `adminGetClub` ~l.299, type après `ClubAdminDetail` ~l.1436)
- Create: `frontend/lib/onboarding.ts`
- Test: `frontend/__tests__/onboarding.test.ts`

- [ ] **Step 1: Écrire le test des helpers qui échoue**

```ts
// frontend/__tests__/onboarding.test.ts
import {
  buildChecklist, checklistProgress, resourceNames,
  BOOKING_PRESETS, CANCEL_PRESETS, STEP_ORDER, ONBOARDING_HIDDEN_KEY,
} from '@/lib/onboarding';
import { OnboardingStatus } from '@/lib/api';

const bare: OnboardingStatus = {
  hasLogo: false, sportsCount: 0, resourcesCount: 0,
  hasPresentation: false, stripeStatus: 'NONE', offersCount: 0, eventsCount: 0,
};

describe('buildChecklist', () => {
  it('club nu : 8 jalons, seul « Créer votre club » est fait', () => {
    const items = buildChecklist(bare);
    expect(items).toHaveLength(8);
    expect(items[0]).toMatchObject({ key: 'club', done: true, href: null });
    expect(items.filter((i) => i.done)).toHaveLength(1);
    expect(checklistProgress(items)).toEqual({ done: 1, total: 8 });
  });

  it('dérive chaque jalon de son état + href vers la bonne page admin', () => {
    const items = buildChecklist({
      hasLogo: true, sportsCount: 1, resourcesCount: 4,
      hasPresentation: true, stripeStatus: 'ACTIVE', offersCount: 2, eventsCount: 1,
    });
    expect(items.every((i) => i.done)).toBe(true);
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.logo.href).toBe('/admin/settings');
    expect(byKey.sports.href).toBe('/admin/sports');
    expect(byKey.courts.href).toBe('/admin/courts');
    expect(byKey.page.href).toBe('/admin/club');
    expect(byKey.stripe.href).toBe('/admin/payments');
    expect(byKey.offers.href).toBe('/admin/packages');
    expect(byKey.event.href).toBe('/admin/events');
  });

  it('Stripe PENDING ne suffit pas', () => {
    const items = buildChecklist({ ...bare, stripeStatus: 'PENDING' });
    expect(items.find((i) => i.key === 'stripe')!.done).toBe(false);
  });
});

describe('resourceNames', () => {
  it('capitalise le noun et numérote à partir de l’existant', () => {
    expect(resourceNames('piste', 0, 2)).toEqual(['Piste 1', 'Piste 2']);
    expect(resourceNames('piste', 4, 3)).toEqual(['Piste 5', 'Piste 6', 'Piste 7']);
    expect(resourceNames('terrain', 0, 1)).toEqual(['Terrain 1']);
    expect(resourceNames('piste', 2, 0)).toEqual([]);
  });
});

describe('presets & constantes', () => {
  it('BOOKING_PRESETS : abonnés = 2× public', () => {
    expect(BOOKING_PRESETS.map((p) => p.publicDays)).toEqual([7, 14, 30]);
    BOOKING_PRESETS.forEach((p) => expect(p.memberDays).toBe(p.publicDays * 2));
  });
  it('CANCEL_PRESETS : 0 / 4 / 24 h', () => {
    expect(CANCEL_PRESETS.map((p) => p.hours)).toEqual([0, 4, 24]);
  });
  it('STEP_ORDER : 5 étapes dans l’ordre de la spec', () => {
    expect(STEP_ORDER).toEqual(['identity', 'sports', 'courts', 'rules', 'launch']);
  });
  it('clé localStorage par club', () => {
    expect(ONBOARDING_HIDDEN_KEY('c1')).toBe('palova:onboarding-hidden:c1');
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run (depuis `frontend/`): `node node_modules/jest/bin/jest.js onboarding.test`
Expected: FAIL — `Cannot find module '@/lib/onboarding'`.

- [ ] **Step 3: Ajouter le type + la méthode dans `lib/api.ts`**

Type, à insérer juste **après** la fermeture de `ClubAdminDetail` (~l.1436) :

```ts
/** Statut d'avancement du paramétrage (guide de démarrage), dérivé de l'état réel. */
export interface OnboardingStatus {
  hasLogo: boolean;
  sportsCount: number;
  resourcesCount: number;
  hasPresentation: boolean;
  stripeStatus: 'NONE' | 'PENDING' | 'ACTIVE' | 'RESTRICTED';
  offersCount: number;
  eventsCount: number;
}
```

Méthode, à insérer dans l'objet `api` juste **après** `adminGetClub` (~l.299) :

```ts
  adminGetOnboardingStatus: (clubId: string, token: string) =>
    request<OnboardingStatus>(`/api/clubs/${clubId}/admin/onboarding-status`, {}, token),
```

- [ ] **Step 4: Créer `frontend/lib/onboarding.ts`**

```ts
// frontend/lib/onboarding.ts
// Helpers PURS de l'onboarding club (wizard + checklist). Aucune horloge, aucun fetch.
import { OnboardingStatus } from '@/lib/api';

export type StepKey = 'identity' | 'sports' | 'courts' | 'rules' | 'launch';
export const STEP_ORDER: StepKey[] = ['identity', 'sports', 'courts', 'rules', 'launch'];

/** Un sport tel qu'affiché dans le téléphone d'aperçu du wizard. */
export interface PreviewSport {
  key: string;
  name: string;
  icon: string | null;
  noun: string;          // resourceNoun du sport (« piste », « terrain »…)
  courtCount: number;
  minPrice: number | null;
}

/** L'état injecté dans LivePhonePreview — dérivé du club + sports + ressources. */
export interface PreviewState {
  name: string;
  slug: string;
  logoUrl: string | null;
  accentColor: string;
  sports: PreviewSport[];
}

export interface ChecklistItem {
  key: 'club' | 'logo' | 'sports' | 'courts' | 'page' | 'stripe' | 'offers' | 'event';
  label: string;
  done: boolean;
  href: string | null;   // page admin idoine ; null = pas de lien (déjà fait par nature)
}

/** Les 8 jalons du guide de démarrage, dérivés du statut serveur. */
export function buildChecklist(s: OnboardingStatus): ChecklistItem[] {
  return [
    { key: 'club',   label: 'Créer votre club',                          done: true,                          href: null },
    { key: 'logo',   label: 'Logo & couleur',                            done: s.hasLogo,                     href: '/admin/settings' },
    { key: 'sports', label: 'Vos sports',                                done: s.sportsCount > 0,             href: '/admin/sports' },
    { key: 'courts', label: 'Vos terrains',                              done: s.resourcesCount > 0,          href: '/admin/courts' },
    { key: 'page',   label: 'Votre page club (photos, présentation)',    done: s.hasPresentation,             href: '/admin/club' },
    { key: 'stripe', label: 'Le paiement en ligne (Stripe)',             done: s.stripeStatus === 'ACTIVE',   href: '/admin/payments' },
    { key: 'offers', label: 'Vos formules (carnets, abonnements)',       done: s.offersCount > 0,             href: '/admin/packages' },
    { key: 'event',  label: 'Votre premier tournoi ou event',            done: s.eventsCount > 0,             href: '/admin/events' },
  ];
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

export interface BookingPreset { label: string; publicDays: number; memberDays: number }
/** Étape 4 — fenêtre de réservation : abonnés = 2× la fenêtre publique. */
export const BOOKING_PRESETS: BookingPreset[] = [
  { label: '7 jours',  publicDays: 7,  memberDays: 14 },
  { label: '14 jours', publicDays: 14, memberDays: 28 },
  { label: '30 jours', publicDays: 30, memberDays: 60 },
];

export interface CancelPreset { label: string; hours: number }
/** Étape 4 — délai d'annulation. */
export const CANCEL_PRESETS: CancelPreset[] = [
  { label: 'Jusqu’au début', hours: 0 },
  { label: '4 h avant',      hours: 4 },
  { label: '24 h avant',     hours: 24 },
];

/** « Piste 5, Piste 6… » : numérote à la suite des ressources existantes. */
export function resourceNames(noun: string, existingCount: number, count: number): string[] {
  const cap = noun.charAt(0).toUpperCase() + noun.slice(1);
  return Array.from({ length: count }, (_, i) => `${cap} ${existingCount + i + 1}`);
}

/** Clé localStorage du masquage de la checklist (par club, par appareil). */
export const ONBOARDING_HIDDEN_KEY = (clubId: string) => `palova:onboarding-hidden:${clubId}`;
```

- [ ] **Step 5: Vérifier que le test passe + types**

Run: `node node_modules/jest/bin/jest.js onboarding.test`
Expected: PASS.
Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: 0 erreur (scoper la lecture aux fichiers du lot si du WIP parallèle traîne).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/api.ts frontend/lib/onboarding.ts frontend/__tests__/onboarding.test.ts
git commit -m "feat(onboarding): helpers purs checklist/presets + api.adminGetOnboardingStatus"
```

---

### Task 4: Front — carte `StartChecklist` + montage dashboard

**Files:**
- Create: `frontend/components/admin/StartChecklist.tsx`
- Modify: `frontend/app/admin/page.tsx` (import + montage après le `<p>` de la date, l.71)
- Test: `frontend/__tests__/StartChecklist.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
// frontend/__tests__/StartChecklist.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StartChecklist } from '@/components/admin/StartChecklist';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ONBOARDING_HIDDEN_KEY } from '@/lib/onboarding';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: { adminGetOnboardingStatus: jest.fn() },
}));
import { api } from '@/lib/api';

const partial = {
  hasLogo: true, sportsCount: 1, resourcesCount: 4,
  hasPresentation: false, stripeStatus: 'NONE', offersCount: 0, eventsCount: 0,
};
const complete = {
  hasLogo: true, sportsCount: 1, resourcesCount: 4,
  hasPresentation: true, stripeStatus: 'ACTIVE', offersCount: 1, eventsCount: 1,
};

const wrap = () => render(
  <ThemeProvider><StartChecklist clubId="c1" token="t" /></ThemeProvider>,
);

describe('StartChecklist', () => {
  beforeEach(() => { jest.clearAllMocks(); window.localStorage.clear(); });

  it('affiche la progression, les jalons faits barrés et les ouverts en lien', async () => {
    (api.adminGetOnboardingStatus as jest.Mock).mockResolvedValue(partial);
    wrap();
    expect(await screen.findByText('4/8')).toBeInTheDocument();
    // jalon fait : présent, jalon ouvert : lien vers sa page admin
    expect(screen.getByText('Vos terrains')).toBeInTheDocument();
    const stripe = screen.getByText('Le paiement en ligne (Stripe)').closest('a')!;
    expect(stripe).toHaveAttribute('href', '/admin/payments');
    // lien de réouverture du wizard
    expect(screen.getByText(/Rouvrir le guide/).closest('a')).toHaveAttribute('href', '/admin/onboarding');
  });

  it('la croix masque la carte et persiste en localStorage', async () => {
    (api.adminGetOnboardingStatus as jest.Mock).mockResolvedValue(partial);
    wrap();
    await screen.findByText('4/8');
    fireEvent.click(screen.getByLabelText('Masquer le guide de démarrage'));
    expect(screen.queryByText('4/8')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(ONBOARDING_HIDDEN_KEY('c1'))).toBe('hidden');
  });

  it('déjà masquée : ne fetch pas, ne rend rien', async () => {
    window.localStorage.setItem(ONBOARDING_HIDDEN_KEY('c1'), 'hidden');
    (api.adminGetOnboardingStatus as jest.Mock).mockResolvedValue(partial);
    const { container } = wrap();
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(api.adminGetOnboardingStatus).not.toHaveBeenCalled();
  });

  it('club complet (8/8) : ne rend rien', async () => {
    (api.adminGetOnboardingStatus as jest.Mock).mockResolvedValue(complete);
    const { container } = wrap();
    await waitFor(() => expect(api.adminGetOnboardingStatus).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('erreur API : ne rend rien (jamais de carte cassée)', async () => {
    (api.adminGetOnboardingStatus as jest.Mock).mockRejectedValue(new Error('boom'));
    const { container } = wrap();
    await waitFor(() => expect(api.adminGetOnboardingStatus).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `node node_modules/jest/bin/jest.js StartChecklist`
Expected: FAIL — `Cannot find module '@/components/admin/StartChecklist'`.

- [ ] **Step 3: Implémenter la carte**

```tsx
// frontend/components/admin/StartChecklist.tsx
'use client';
import { useEffect, useState } from 'react';
import { api, OnboardingStatus } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { buildChecklist, checklistProgress, ONBOARDING_HIDDEN_KEY } from '@/lib/onboarding';

/**
 * Carte « Guide de démarrage » du dashboard admin.
 * Dérivée de l'état réel (onboarding-status) : se coche toute seule, disparaît à 8/8,
 * masquable par appareil (localStorage). Ne rend rien tant qu'elle n'est pas sûre d'être utile.
 */
export function StartChecklist({ clubId, token }: { clubId: string; token: string }) {
  const { th } = useTheme();
  const [hidden, setHidden] = useState<boolean | null>(null); // null = pas encore lu (hydration-safe)
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  useEffect(() => {
    setHidden(window.localStorage.getItem(ONBOARDING_HIDDEN_KEY(clubId)) === 'hidden');
  }, [clubId]);

  useEffect(() => {
    if (hidden !== false) return;
    api.adminGetOnboardingStatus(clubId, token).then(setStatus).catch(() => setStatus(null));
  }, [hidden, clubId, token]);

  if (hidden !== false || !status) return null;
  const items = buildChecklist(status);
  const { done, total } = checklistProgress(items);
  if (done === total) return null;

  const dismiss = () => {
    window.localStorage.setItem(ONBOARDING_HIDDEN_KEY(clubId), 'hidden');
    setHidden(true);
  };

  const accent = th.accent;
  const R = 24;
  const C = 2 * Math.PI * R;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #101623, #1a2438)', borderRadius: 16,
      padding: '18px 20px', marginBottom: 18, position: 'relative',
      boxShadow: '0 10px 30px rgba(20,40,80,.18)',
    }}>
      <button type="button" onClick={dismiss} aria-label="Masquer le guide de démarrage"
        style={{ position: 'absolute', top: 10, right: 12, background: 'transparent', border: 'none', color: '#5d6676', fontSize: 15, cursor: 'pointer', padding: 4 }}>
        ✕
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 58, height: 58, flexShrink: 0 }}>
          <svg width={58} height={58} viewBox="0 0 58 58" aria-hidden>
            <circle cx={29} cy={29} r={R} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={6} />
            <circle cx={29} cy={29} r={R} fill="none" stroke={accent} strokeWidth={6} strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - done / total)} transform="rotate(-90 29 29)" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 800 }}>
            {done}/{total}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ color: '#fff', fontFamily: th.fontDisplay, fontSize: 18, fontWeight: 600 }}>Votre club prend forme 🚀</div>
          <div style={{ color: '#94a0b8', fontFamily: th.fontUI, fontSize: 12.5, marginTop: 3 }}>
            Encore {total - done} étape{total - done > 1 ? 's' : ''} pour un club irrésistible.{' '}
            <a href="/admin/onboarding" style={{ color: accent, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>
              Rouvrir le guide guidé →
            </a>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 7, marginTop: 14 }}>
        {items.map((it) => it.done ? (
          <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 8, background: `${accent}14`, borderRadius: 9, padding: '8px 10px' }}>
            <span aria-hidden style={{ color: accent, fontSize: 12 }}>✓</span>
            <span style={{ color: '#8f9bb0', fontFamily: th.fontUI, fontSize: 12.5, textDecoration: 'line-through' }}>{it.label}</span>
          </div>
        ) : (
          <a key={it.key} href={it.href ?? '#'} style={{
            display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.09)', borderRadius: 9, padding: '8px 10px', textDecoration: 'none',
          }}>
            <span aria-hidden style={{ color: '#7a8aa5', fontSize: 12 }}>○</span>
            <span style={{ color: '#e8ecf4', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>{it.label}</span>
            <span aria-hidden style={{ marginLeft: 'auto', color: accent, fontSize: 12 }}>→</span>
          </a>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `node node_modules/jest/bin/jest.js StartChecklist`
Expected: PASS (5 tests).

- [ ] **Step 5: Monter la carte sur le dashboard**

Dans `frontend/app/admin/page.tsx` :

Ajouter l'import (après la l.8) :

```tsx
import { StartChecklist } from '@/components/admin/StartChecklist';
```

Insérer entre le `</p>` de la date (l.71) et la rangée de StatCards (l.73) :

```tsx
      {clubId && token && <StartChecklist clubId={clubId} token={token} />}
```

- [ ] **Step 6: Vérifier types + suites**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: 0 erreur.
Run: `node node_modules/jest/bin/jest.js StartChecklist onboarding.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/admin/StartChecklist.tsx frontend/app/admin/page.tsx frontend/__tests__/StartChecklist.test.tsx
git commit -m "feat(onboarding): carte Guide de demarrage sur le dashboard admin"
```

---

### Task 5: Front — `LivePhonePreview` (le téléphone vivant)

**Files:**
- Create: `frontend/components/onboarding/LivePhonePreview.tsx`
- Test: `frontend/__tests__/LivePhonePreview.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
// frontend/__tests__/LivePhonePreview.test.tsx
import { render, screen } from '@testing-library/react';
import { LivePhonePreview } from '@/components/onboarding/LivePhonePreview';
import { PreviewState } from '@/lib/onboarding';

const base: PreviewState = {
  name: 'Padel Riviera', slug: 'padel-riviera',
  logoUrl: null, accentColor: '#d6ff3f', sports: [],
};

describe('LivePhonePreview', () => {
  it('affiche nom, URL du club et les placeholders quand rien n’est configuré', () => {
    render(<LivePhonePreview preview={base} />);
    expect(screen.getByText('Padel Riviera')).toBeInTheDocument();
    expect(screen.getByText('padel-riviera.palova.fr')).toBeInTheDocument();
    expect(screen.getByText(/apparaîtront à l’étape 2/)).toBeInTheDocument();
    expect(screen.getByText(/étape 3…/)).toBeInTheDocument();
    // monogramme (pas de logo) : première lettre du nom
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('affiche les chips sports et la ligne terrains quand configurés', () => {
    render(<LivePhonePreview preview={{
      ...base,
      logoUrl: '/uploads/logo.png',
      sports: [
        { key: 'padel', name: 'Padel', icon: '🎾', noun: 'piste', courtCount: 4, minPrice: 25 },
        { key: 'tennis', name: 'Tennis', icon: null, noun: 'court', courtCount: 0, minPrice: null },
      ],
    }} />);
    expect(screen.getByText(/Padel/)).toBeInTheDocument();
    expect(screen.getByText(/4 pistes · dès 25 €/)).toBeInTheDocument();
    // le sport sans terrain n'apparaît pas dans la section terrains
    expect(screen.queryByText(/0 court/)).not.toBeInTheDocument();
    // logo affiché → une balise img est rendue à la place du monogramme
    expect(document.querySelector('img')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `node node_modules/jest/bin/jest.js LivePhonePreview`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le composant**

```tsx
// frontend/components/onboarding/LivePhonePreview.tsx
'use client';
import { ReactNode } from 'react';
import { assetUrl } from '@/lib/api';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { inkOn } from '@/lib/theme';
import { PreviewState } from '@/lib/onboarding';

function PreviewCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 9, padding: '8px 9px', boxShadow: '0 1px 5px rgba(20,40,80,.08)' }}>
      <div style={{ fontSize: 8.5, color: '#98a3b5', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>{title}</div>
      {children}
    </div>
  );
}

const hint = (text: string) => (
  <div style={{ fontSize: 9.5, color: '#b6bfcd', marginTop: 3, fontStyle: 'italic' }}>{text}</div>
);

/** Pluriel naïf suffisant pour les nouns du catalogue (piste→pistes, court→courts, terrain→terrains). */
const plural = (noun: string, n: number) => (n > 1 ? `${noun}s` : noun);

/**
 * Le « téléphone vivant » du wizard : un mini club-house qui se construit au fil des étapes.
 * Purement présentationnel — tout vient de PreviewState.
 */
export function LivePhonePreview({ preview }: { preview: PreviewState }) {
  const accent = preview.accentColor;
  const withCourts = preview.sports.filter((s) => s.courtCount > 0);
  return (
    <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
      <div aria-hidden style={{ position: 'absolute', inset: -30, background: `radial-gradient(circle at 50% 45%, ${accent}26, transparent 65%)` }} />
      <div style={{ width: 230, background: '#f4f7fc', borderRadius: 28, border: '6px solid #232936', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,.55)', position: 'relative' }}>
        <div style={{ background: HERO_GRADIENT, padding: '18px 14px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {preview.logoUrl ? (
              <img src={assetUrl(preview.logoUrl) ?? ''} alt=""
                style={{ width: 34, height: 34, borderRadius: 10, objectFit: 'contain', background: '#fff', flexShrink: 0 }} />
            ) : (
              <span style={{ width: 34, height: 34, borderRadius: 10, background: accent, color: inkOn(accent), display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16, flexShrink: 0 }}>
                {(preview.name[0] ?? '?').toUpperCase()}
              </span>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: HERO_INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview.name}</div>
              <div style={{ fontSize: 9.5, color: HERO_INK_MUTED }}>{preview.slug}.palova.fr</div>
            </div>
          </div>
          <div style={{ marginTop: 11, background: 'rgba(255,255,255,.55)', borderRadius: 9, padding: '7px 9px', fontSize: 10, color: HERO_INK, fontWeight: 700 }}>
            Réserver un terrain →
          </div>
        </div>

        <div style={{ padding: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PreviewCard title="Vos sports">
            {preview.sports.length === 0 ? hint('apparaîtront à l’étape 2…') : (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
                {preview.sports.map((s) => (
                  <span key={s.key} style={{ background: accent, color: inkOn(accent), borderRadius: 12, padding: '3px 9px', fontSize: 9.5, fontWeight: 700 }}>
                    {s.icon ? `${s.icon} ` : ''}{s.name}
                  </span>
                ))}
              </div>
            )}
          </PreviewCard>
          <PreviewCard title="Vos terrains">
            {withCourts.length === 0 ? hint('étape 3…') : (
              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {withCourts.map((s) => (
                  <div key={s.key} style={{ fontSize: 9.5, color: '#333' }}>
                    {s.icon ? `${s.icon} ` : ''}{s.name} · {s.courtCount} {plural(s.noun, s.courtCount)}{s.minPrice != null ? ` · dès ${s.minPrice} €` : ''}
                  </div>
                ))}
              </div>
            )}
          </PreviewCard>
        </div>
        <div style={{ padding: '0 0 9px', textAlign: 'center', fontSize: 9, color: '#98a3b5' }}>Aperçu en direct ✨</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `node node_modules/jest/bin/jest.js LivePhonePreview`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/onboarding/LivePhonePreview.tsx frontend/__tests__/LivePhonePreview.test.tsx
git commit -m "feat(onboarding): LivePhonePreview, le telephone d'apercu vivant du wizard"
```

---

### Task 6: Front — briques UI du wizard (`wizardUi`) + `StepIdentity`

Les étapes sont des composants **autonomes** (props + callbacks, aucune dépendance au shell) — le shell qui les assemble arrive en Task 9, une fois les 5 étapes écrites.

**Contrat commun des étapes** (à respecter dans les Tasks 6-8) :
- `clubId: string`, `token: string` — cible des appels API ;
- `advance: () => void` — passer à l'étape suivante (appelé après succès du save, ou par « Passer cette étape ») ;
- chaque étape possède ses états `busy`/`error` locaux et n'envoie **que ses champs**.

**Files:**
- Create: `frontend/components/onboarding/wizardUi.tsx`
- Create: `frontend/components/onboarding/StepIdentity.tsx`
- Test: `frontend/__tests__/StepIdentity.test.tsx`

- [ ] **Step 1: Créer les briques partagées `wizardUi.tsx`**

```tsx
// frontend/components/onboarding/wizardUi.tsx
'use client';
import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';

/** Palette fixe du wizard (fond sombre théâtral, volontairement indépendante du thème clair/sombre). */
export const WIZ = {
  bg: '#0d1017',
  bg2: '#131b2c',
  text: '#ffffff',
  mute: '#9aa3b5',
  faint: '#6b7383',
  line: 'rgba(255,255,255,.18)',
  card: 'rgba(255,255,255,.06)',
} as const;

/** Surtitre accent + titre display + sous-titre rassurant d'une étape. */
export function WizHeader({ surtitle, title, sub, accent }: { surtitle: string; title: ReactNode; sub?: string; accent: string }) {
  const { th } = useTheme();
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ color: accent, fontFamily: th.fontUI, fontSize: 11, letterSpacing: 2.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>{surtitle}</div>
      <div style={{ color: WIZ.text, fontFamily: th.fontDisplay, fontSize: 32, lineHeight: 1.08, fontWeight: 600 }}>{title}</div>
      {sub && <div style={{ color: WIZ.mute, fontFamily: th.fontUI, fontSize: 13.5, lineHeight: 1.5, marginTop: 8 }}>{sub}</div>}
    </div>
  );
}

export function WizLabel({ children }: { children: ReactNode }) {
  const { th } = useTheme();
  return <div style={{ color: WIZ.mute, fontFamily: th.fontUI, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>{children}</div>;
}

export function WizError({ children }: { children: ReactNode }) {
  const { th } = useTheme();
  return (
    <div role="alert" style={{ background: 'rgba(255,122,77,.14)', color: '#ffb59d', borderRadius: 10, padding: '10px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
      {children}
    </div>
  );
}

/** CTA « Continuer → » (garde busy) + « Passer cette étape » discret. */
export function WizActions({ accent, busy, onNext, onSkip, nextLabel = 'Continuer →' }: {
  accent: string; busy: boolean; onNext: () => void; onSkip?: () => void; nextLabel?: string;
}) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 22, flexWrap: 'wrap' }}>
      <button type="button" onClick={onNext} disabled={busy} style={{
        background: accent, color: inkOn(accent), border: 'none', borderRadius: 12,
        padding: '12px 26px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 800,
        cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
      }}>
        {busy ? 'Enregistrement…' : nextLabel}
      </button>
      {onSkip && (
        <button type="button" onClick={onSkip} disabled={busy}
          style={{ background: 'transparent', border: 'none', color: WIZ.mute, fontFamily: th.fontUI, fontSize: 13, cursor: 'pointer' }}>
          Passer cette étape
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Écrire le test de `StepIdentity` qui échoue**

```tsx
// frontend/__tests__/StepIdentity.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StepIdentity } from '@/components/onboarding/StepIdentity';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ClubAdminDetail } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    adminUpdateClub: jest.fn(),
    uploadClubLogo: jest.fn(),
  },
}));
import { api } from '@/lib/api';

const club = {
  id: 'c1', slug: 'padel-riviera', name: 'Padel Riviera',
  logoUrl: null, accentColor: '#d6ff3f', defaultThemeMode: 'floodlit',
} as unknown as ClubAdminDetail;

const setup = () => {
  const onLocal = jest.fn();
  const onPatched = jest.fn();
  const advance = jest.fn();
  render(
    <ThemeProvider>
      <StepIdentity club={club} clubId="c1" token="t" onLocal={onLocal} onPatched={onPatched} advance={advance} />
    </ThemeProvider>,
  );
  return { onLocal, onPatched, advance };
};

describe('StepIdentity', () => {
  beforeEach(() => jest.clearAllMocks());

  it('choisir une couleur remonte instantanément via onLocal (aperçu vivant)', () => {
    const { onLocal } = setup();
    fireEvent.click(screen.getByLabelText('Accent #5e93da'));
    expect(onLocal).toHaveBeenCalledWith({ accentColor: '#5e93da' });
  });

  it('Continuer → persiste accent + thème, propage le club serveur et avance', async () => {
    (api.adminUpdateClub as jest.Mock).mockResolvedValue({ ...club, accentColor: '#d6ff3f' });
    const { onPatched, advance } = setup();
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith(
      'c1', { accentColor: '#d6ff3f', defaultThemeMode: 'floodlit' }, 't',
    ));
    expect(onPatched).toHaveBeenCalled();
    expect(advance).toHaveBeenCalled();
  });

  it('échec API → message, on reste sur l’étape', async () => {
    (api.adminUpdateClub as jest.Mock).mockRejectedValue(new Error('boom'));
    const { advance } = setup();
    fireEvent.click(screen.getByText('Continuer →'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it('upload logo → uploadClubLogo puis onLocal({ logoUrl })', async () => {
    (api.uploadClubLogo as jest.Mock).mockResolvedValue({ logoUrl: '/uploads/x.png' });
    const { onLocal } = setup();
    const input = screen.getByLabelText('Importer votre logo') as HTMLInputElement;
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(api.uploadClubLogo).toHaveBeenCalledWith('c1', file, 't'));
    expect(onLocal).toHaveBeenCalledWith({ logoUrl: '/uploads/x.png' });
  });

  it('Passer cette étape → avance sans appel API', () => {
    const { advance } = setup();
    fireEvent.click(screen.getByText('Passer cette étape'));
    expect(api.adminUpdateClub).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Vérifier qu'il échoue**

Run: `node node_modules/jest/bin/jest.js StepIdentity`
Expected: FAIL — module introuvable.

- [ ] **Step 4: Implémenter `StepIdentity`**

```tsx
// frontend/components/onboarding/StepIdentity.tsx
'use client';
import { useRef, useState } from 'react';
import { api, assetUrl, ClubAdminDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { WIZ, WizHeader, WizLabel, WizError, WizActions } from './wizardUi';

const LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function StepIdentity({ club, clubId, token, onLocal, onPatched, advance }: {
  club: ClubAdminDetail;
  clubId: string;
  token: string;
  onLocal: (patch: Partial<ClubAdminDetail>) => void;   // maj instantanée (aperçu vivant), sans réseau
  onPatched: (club: ClubAdminDetail) => void;           // vérité serveur après save
  advance: () => void;
}) {
  const { th } = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accent = club.accentColor;

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > MAX_LOGO_BYTES) { setError('Image trop lourde (2 Mo max)'); return; }
    setError(null);
    setUploading(true);
    try {
      const res = await api.uploadClubLogo(clubId, file, token);
      onLocal({ logoUrl: res.logoUrl });
    } catch (e) { setError((e as Error).message); }
    finally { setUploading(false); }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.adminUpdateClub(clubId, { accentColor: club.accentColor, defaultThemeMode: club.defaultThemeMode }, token);
      onPatched(updated);
      advance();
    } catch { setError('Impossible d’enregistrer. Réessayez.'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <WizHeader accent={accent} surtitle={`Identité · ${club.name}`}
        title={<>Donnez un visage<br />à votre club.</>}
        sub="Logo et couleur — c’est ce que vos joueurs verront en premier. Tout reste modifiable." />

      {error && <WizError>{error}</WizError>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        {club.logoUrl ? (
          <img src={assetUrl(club.logoUrl) ?? ''} alt="Logo du club"
            style={{ width: 64, height: 64, borderRadius: 16, objectFit: 'contain', background: '#fff', opacity: uploading ? 0.5 : 1, flexShrink: 0 }} />
        ) : (
          <span style={{ width: 64, height: 64, borderRadius: 16, background: accent, color: inkOn(accent), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 24, flexShrink: 0 }}>
            {(club.name[0] ?? '?').toUpperCase()}
          </span>
        )}
        <div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
            aria-label="Importer votre logo"
            onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
            style={{ border: `1.5px dashed ${WIZ.line}`, background: 'transparent', borderRadius: 11, padding: '9px 16px', color: '#cfd6e2', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {uploading ? 'Envoi…' : club.logoUrl ? '📷 Changer le logo' : '📷 Importer votre logo'}
          </button>
          <div style={{ color: WIZ.faint, fontFamily: th.fontUI, fontSize: 11, marginTop: 5 }}>
            {club.logoUrl ? 'JPEG, PNG ou WebP · 2 Mo max' : 'ou gardez le monogramme, très chic aussi'}
          </div>
        </div>
      </div>

      <WizLabel>Votre couleur</WizLabel>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.values(ACCENTS).map((hex) => (
          <button key={hex} type="button" onClick={() => onLocal({ accentColor: hex })} aria-label={`Accent ${hex}`}
            style={{
              width: 34, height: 34, borderRadius: 10, background: hex, cursor: 'pointer',
              border: 'none',
              outline: accent.toLowerCase() === hex.toLowerCase() ? '2px solid #fff' : 'none', outlineOffset: 2,
            }} />
        ))}
      </div>

      <WizLabel>Ambiance de l’app</WizLabel>
      <div style={{ display: 'flex', gap: 8 }}>
        {([['floodlit', 'Sombre 🌙'], ['daylight', 'Clair ☀️']] as const).map(([mode, label]) => (
          <button key={mode} type="button" onClick={() => onLocal({ defaultThemeMode: mode })}
            style={{
              borderRadius: 20, padding: '7px 16px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: club.defaultThemeMode === mode ? accent : WIZ.card,
              color: club.defaultThemeMode === mode ? inkOn(accent) : WIZ.mute,
              border: `1px solid ${club.defaultThemeMode === mode ? accent : WIZ.line}`,
            }}>
            {label}
          </button>
        ))}
      </div>

      <WizActions accent={accent} busy={busy} onNext={save} onSkip={advance} />
    </div>
  );
}
```

- [ ] **Step 5: Vérifier que le test passe**

Run: `node node_modules/jest/bin/jest.js StepIdentity`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/onboarding/wizardUi.tsx frontend/components/onboarding/StepIdentity.tsx frontend/__tests__/StepIdentity.test.tsx
git commit -m "feat(onboarding): briques UI du wizard + etape Identite (logo, couleur, theme)"
```

---

### Task 7: Front — `StepSports` + `StepCourts`

**Files:**
- Create: `frontend/components/onboarding/StepSports.tsx`
- Create: `frontend/components/onboarding/StepCourts.tsx`
- Test: `frontend/__tests__/StepSportsCourts.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
// frontend/__tests__/StepSportsCourts.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StepSports } from '@/components/onboarding/StepSports';
import { StepCourts } from '@/components/onboarding/StepCourts';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { AdminClubSport, AdminResource, Sport } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    adminAddSport: jest.fn(),
    adminCreateResource: jest.fn(),
  },
}));
import { api } from '@/lib/api';

const catalog = [
  { id: 's-padel', key: 'padel', name: 'Padel', resourceNoun: 'piste', icon: '🎾', surfaces: [], published: true, hasLighting: true, defaultSlotStepMin: 30, defaultDurationsMin: [60, 90] },
  { id: 's-tennis', key: 'tennis', name: 'Tennis', resourceNoun: 'court', icon: null, surfaces: [], published: true, hasLighting: true, defaultSlotStepMin: 30, defaultDurationsMin: [60] },
] as unknown as Sport[];

const padelCs = {
  id: 'cs-padel', slotStepMin: null, durationsMin: [],
  sport: { id: 's-padel', key: 'padel', name: 'Padel', resourceNoun: 'piste', defaultDurationsMin: [60, 90], surfaces: [], hasLighting: true },
} as unknown as AdminClubSport;

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('StepSports', () => {
  beforeEach(() => jest.clearAllMocks());

  it('le sport déjà actif est coché et non décochable ; en ajouter un appelle adminAddSport', async () => {
    (api.adminAddSport as jest.Mock).mockResolvedValue({ id: 'cs-tennis', sport: catalog[1] });
    const onAdded = jest.fn(); const advance = jest.fn();
    wrap(<StepSports clubName="Padel Riviera" catalog={catalog} clubSports={[padelCs]} clubId="c1" token="t" onAdded={onAdded} advance={advance} />);
    // Padel actif : le bouton est désactivé
    expect(screen.getByRole('checkbox', { name: /Padel/ })).toBeDisabled();
    // cocher Tennis puis continuer
    fireEvent.click(screen.getByRole('checkbox', { name: /Tennis/ }));
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(api.adminAddSport).toHaveBeenCalledWith('c1', 's-tennis', 't'));
    expect(onAdded).toHaveBeenCalled();
    expect(advance).toHaveBeenCalled();
  });

  it('sans nouveau sport coché, Continuer avance sans appel API', async () => {
    const advance = jest.fn();
    wrap(<StepSports clubName="Padel Riviera" catalog={catalog} clubSports={[padelCs]} clubId="c1" token="t" onAdded={jest.fn()} advance={advance} />);
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(advance).toHaveBeenCalled());
    expect(api.adminAddSport).not.toHaveBeenCalled();
  });
});

describe('StepCourts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('crée N terrains numérotés à la suite de l’existant, avec prix et couverture', async () => {
    (api.adminCreateResource as jest.Mock).mockImplementation((_c, body) => Promise.resolve({
      id: `r-${body.name}`, name: body.name, price: String(body.price), isActive: true,
      attributes: body.attributes, clubSport: padelCs,
    }));
    const onCreated = jest.fn(); const advance = jest.fn();
    wrap(<StepCourts clubName="Padel Riviera" clubSports={[padelCs]} resources={[]} clubId="c1" token="t" onCreated={onCreated} advance={advance} />);
    // stepper : 2 par défaut → prix requis
    fireEvent.change(screen.getByLabelText('Prix au créneau (€) — Padel'), { target: { value: '25' } });
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(advance).toHaveBeenCalled());
    expect(api.adminCreateResource).toHaveBeenCalledTimes(2);
    expect(api.adminCreateResource).toHaveBeenNthCalledWith(1, 'c1',
      { clubSportId: 'cs-padel', name: 'Piste 1', price: 25, attributes: { coverage: 'indoor' } }, 't');
    expect(api.adminCreateResource).toHaveBeenNthCalledWith(2, 'c1',
      { clubSportId: 'cs-padel', name: 'Piste 2', price: 25, attributes: { coverage: 'indoor' } }, 't');
    expect(onCreated).toHaveBeenCalledTimes(2);
  });

  it('affiche l’existant et numérote à la suite', async () => {
    (api.adminCreateResource as jest.Mock).mockImplementation((_c, body) => Promise.resolve({
      id: `r-${body.name}`, name: body.name, price: String(body.price), isActive: true,
      attributes: body.attributes, clubSport: padelCs,
    }));
    const existing = [
      { id: 'r1', name: 'Piste 1', clubSport: padelCs, price: '25', isActive: true, attributes: {} },
      { id: 'r2', name: 'Piste 2', clubSport: padelCs, price: '25', isActive: true, attributes: {} },
    ] as unknown as AdminResource[];
    const advance = jest.fn();
    wrap(<StepCourts clubName="Padel Riviera" clubSports={[padelCs]} resources={existing} clubId="c1" token="t" onCreated={jest.fn()} advance={advance} />);
    expect(screen.getByText(/déjà 2 pistes/)).toBeInTheDocument();
    // en ajouter 1 : le compteur démarre à 0 quand il y a de l'existant
    fireEvent.click(screen.getByLabelText('Ajouter un terrain — Padel'));
    fireEvent.change(screen.getByLabelText('Prix au créneau (€) — Padel'), { target: { value: '30' } });
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(api.adminCreateResource).toHaveBeenCalledWith('c1',
      { clubSportId: 'cs-padel', name: 'Piste 3', price: 30, attributes: { coverage: 'indoor' } }, 't'));
  });

  it('prix manquant avec un compteur > 0 → erreur, aucun appel', async () => {
    const advance = jest.fn();
    wrap(<StepCourts clubName="Padel Riviera" clubSports={[padelCs]} resources={[]} clubId="c1" token="t" onCreated={jest.fn()} advance={advance} />);
    fireEvent.click(screen.getByText('Continuer →'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(api.adminCreateResource).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it('échec partiel : les créations réussies sont propagées, erreur affichée, pas d’avance', async () => {
    (api.adminCreateResource as jest.Mock)
      .mockResolvedValueOnce({ id: 'r-a', name: 'Piste 1', price: '25', isActive: true, attributes: {}, clubSport: padelCs })
      .mockRejectedValueOnce(new Error('boom'));
    const onCreated = jest.fn(); const advance = jest.fn();
    wrap(<StepCourts clubName="Padel Riviera" clubSports={[padelCs]} resources={[]} clubId="c1" token="t" onCreated={onCreated} advance={advance} />);
    fireEvent.change(screen.getByLabelText('Prix au créneau (€) — Padel'), { target: { value: '25' } });
    fireEvent.click(screen.getByText('Continuer →'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(advance).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `node node_modules/jest/bin/jest.js StepSportsCourts`
Expected: FAIL — modules introuvables.

- [ ] **Step 3: Implémenter `StepSports`**

```tsx
// frontend/components/onboarding/StepSports.tsx
'use client';
import { useState } from 'react';
import { api, AdminClubSport, Sport } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { WIZ, WizHeader, WizError, WizActions } from './wizardUi';

export function StepSports({ clubName, catalog, clubSports, clubId, token, onAdded, advance }: {
  clubName: string;
  catalog: Sport[];
  clubSports: AdminClubSport[];
  clubId: string;
  token: string;
  onAdded: (cs: AdminClubSport) => void;
  advance: () => void;
}) {
  const { th } = useTheme();
  const activeIds = new Set(clubSports.map((cs) => cs.sport.id));
  const [selected, setSelected] = useState<Set<string>>(new Set(activeIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Étape volontairement sobre : pill active = blanc plein, lisible quel que soit l'accent
  // (les chips sports de l'aperçu portent déjà la couleur du club).

  const toggle = (id: string) => {
    if (activeIds.has(id)) return; // déjà actif : non décochable (pas de retrait de sport dans le wizard)
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Séquentiel : en cas d'échec au milieu, les sports déjà ajoutés ont été propagés
      // via onAdded → au retry, activeIds (recalculé au re-render) les exclut.
      for (const id of selected) {
        if (activeIds.has(id)) continue;
        const cs = await api.adminAddSport(clubId, id, token);
        onAdded(cs);
      }
      advance();
    } catch { setError('Impossible d’ajouter un sport. Réessayez.'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <WizHeader accent="#ffffff" surtitle={`Vos sports · ${clubName}`}
        title={<>Que joue-t-on<br />chez vous ?</>}
        sub="Cochez tout ce que votre club propose. Vous pourrez en ajouter d’autres plus tard." />

      {error && <WizError>{error}</WizError>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Sports proposés">
        {catalog.map((s) => {
          const isActive = activeIds.has(s.id);
          const isOn = selected.has(s.id);
          return (
            <button key={s.id} type="button" role="checkbox" aria-checked={isOn} disabled={isActive}
              aria-label={`${s.name}${isActive ? ' (déjà actif)' : ''}`}
              onClick={() => toggle(s.id)}
              style={{
                borderRadius: 20, padding: '9px 18px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700,
                cursor: isActive ? 'default' : 'pointer',
                background: isOn ? '#ffffff' : WIZ.card,
                color: isOn ? inkOn('#ffffff') : WIZ.mute,
                border: `1px solid ${isOn ? '#ffffff' : WIZ.line}`,
                opacity: isActive ? 0.85 : 1,
              }}>
              {s.icon ? `${s.icon} ` : ''}{s.name}{isOn ? ' ✓' : ''}
            </button>
          );
        })}
      </div>

      <WizActions accent="#ffffff" busy={busy} onNext={save} onSkip={advance} />
    </div>
  );
}
```

- [ ] **Step 4: Implémenter `StepCourts`**

```tsx
// frontend/components/onboarding/StepCourts.tsx
'use client';
import { useState } from 'react';
import { api, AdminClubSport, AdminResource } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { resourceNames } from '@/lib/onboarding';
import { WIZ, WizHeader, WizError, WizActions } from './wizardUi';

type Draft = { count: number; price: string; coverage: 'indoor' | 'outdoor' };

const plural = (noun: string, n: number) => (n > 1 ? `${noun}s` : noun);

export function StepCourts({ clubName, clubSports, resources, clubId, token, onCreated, advance }: {
  clubName: string;
  clubSports: AdminClubSport[];
  resources: AdminResource[];
  clubId: string;
  token: string;
  onCreated: (r: AdminResource) => void;
  advance: () => void;
}) {
  const { th } = useTheme();
  const existingCount = (csId: string) => resources.filter((r) => r.clubSport.id === csId).length;
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(
    clubSports.map((cs) => [cs.id, { count: existingCount(cs.id) > 0 ? 0 : 2, price: '', coverage: 'indoor' as const }]),
  ));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setDraft = (csId: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [csId]: { ...d[csId], ...patch } }));

  const priceOf = (d: Draft) => Number(d.price.replace(',', '.'));

  const save = async () => {
    // Validation : un prix est requis dès qu'on crée des terrains pour un sport.
    for (const cs of clubSports) {
      const d = drafts[cs.id];
      if (d && d.count > 0 && (!Number.isFinite(priceOf(d)) || priceOf(d) <= 0)) {
        setError(`Indiquez un prix au créneau pour ${cs.sport.name}.`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      for (const cs of clubSports) {
        const d = drafts[cs.id];
        if (!d || d.count <= 0) continue;
        let created = existingCount(cs.id);
        let doneHere = 0;
        try {
          for (let i = 0; i < d.count; i++) {
            const name = resourceNames(cs.sport.resourceNoun, created, 1)[0];
            const r = await api.adminCreateResource(clubId, {
              clubSportId: cs.id, name, price: priceOf(d), attributes: { coverage: d.coverage },
            }, token);
            onCreated(r);
            created += 1;
            doneHere += 1;
          }
        } catch (e) {
          // Échec partiel : on décrémente ce qui a réussi pour que le retry reprenne
          // exactement au terrain qui a échoué (les ressources créées sont déjà remontées via onCreated).
          setDraft(cs.id, { count: d.count - doneHere });
          throw e;
        }
      }
      advance();
    } catch { setError('La création d’un terrain a échoué. Réessayez — rien n’est perdu.'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <WizHeader accent="#ffffff" surtitle={`Vos terrains · ${clubName}`}
        title={<>Vos terrains,<br />en 30 secondes.</>}
        sub="On les crée en série (« Piste 1, Piste 2… ») — noms, horaires et tarifs affinables ensuite dans Ressources." />

      {error && <WizError>{error}</WizError>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {clubSports.map((cs) => {
          const d = drafts[cs.id] ?? { count: 0, price: '', coverage: 'indoor' as const };
          const existing = existingCount(cs.id);
          return (
            <div key={cs.id} style={{ background: WIZ.card, border: `1px solid ${WIZ.line}`, borderRadius: 14, padding: 16 }}>
              <div style={{ color: WIZ.text, fontFamily: th.fontUI, fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{cs.sport.name}</div>
              {existing > 0 && (
                <div style={{ color: WIZ.mute, fontFamily: th.fontUI, fontSize: 12.5, marginBottom: 8 }}>
                  déjà {existing} {plural(cs.sport.resourceNoun, existing)} ✓ — ajoutez-en si besoin
                </div>
              )}
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: WIZ.mute, fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                    {existing > 0 ? 'À ajouter' : `Combien de ${plural(cs.sport.resourceNoun, 2)} ?`}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" aria-label={`Retirer un terrain — ${cs.sport.name}`} disabled={d.count <= 0}
                      onClick={() => setDraft(cs.id, { count: Math.max(0, d.count - 1) })}
                      style={{ width: 34, height: 34, borderRadius: 9, background: 'transparent', color: WIZ.text, border: `1px solid ${WIZ.line}`, cursor: 'pointer', fontSize: 17 }}>−</button>
                    <span style={{ color: WIZ.text, fontFamily: th.fontDisplay, fontSize: 24, fontWeight: 600, minWidth: 26, textAlign: 'center' }}>{d.count}</span>
                    <button type="button" aria-label={`Ajouter un terrain — ${cs.sport.name}`} disabled={d.count >= 20}
                      onClick={() => setDraft(cs.id, { count: Math.min(20, d.count + 1) })}
                      style={{ width: 34, height: 34, borderRadius: 9, background: 'transparent', color: WIZ.text, border: `1px solid ${WIZ.line}`, cursor: 'pointer', fontSize: 17 }}>+</button>
                  </div>
                </div>
                <div>
                  <div style={{ color: WIZ.mute, fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                    Prix au créneau (€)
                  </div>
                  <input aria-label={`Prix au créneau (€) — ${cs.sport.name}`} inputMode="decimal" value={d.price} placeholder="25"
                    onChange={(e) => setDraft(cs.id, { price: e.target.value })}
                    style={{ display: 'block', width: 110, height: 40, padding: '0 12px', borderRadius: 10, background: 'rgba(255,255,255,.08)', color: WIZ.text, border: `1px solid ${WIZ.line}`, fontFamily: th.fontUI, fontSize: 15 }} />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([['indoor', 'Intérieur'], ['outdoor', 'Extérieur']] as const).map(([cov, label]) => (
                    <button key={cov} type="button" onClick={() => setDraft(cs.id, { coverage: cov })}
                      style={{
                        borderRadius: 18, padding: '8px 14px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                        background: d.coverage === cov ? '#ffffff' : 'transparent',
                        color: d.coverage === cov ? inkOn('#ffffff') : WIZ.mute,
                        border: `1px solid ${d.coverage === cov ? '#ffffff' : WIZ.line}`,
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <WizActions accent="#ffffff" busy={busy} onNext={save} onSkip={advance} />
    </div>
  );
}
```

- [ ] **Step 5: Vérifier que le test passe**

Run: `node node_modules/jest/bin/jest.js StepSportsCourts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/onboarding/StepSports.tsx frontend/components/onboarding/StepCourts.tsx frontend/__tests__/StepSportsCourts.test.tsx
git commit -m "feat(onboarding): etapes Sports (pills catalogue) et Terrains express (creation en serie)"
```

---

### Task 8: Front — `StepRules` + `StepLaunch` (final festif)

**Files:**
- Create: `frontend/components/onboarding/StepRules.tsx`
- Create: `frontend/components/onboarding/StepLaunch.tsx`
- Test: `frontend/__tests__/StepRulesLaunch.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
// frontend/__tests__/StepRulesLaunch.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StepRules } from '@/components/onboarding/StepRules';
import { StepLaunch } from '@/components/onboarding/StepLaunch';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ClubAdminDetail } from '@/lib/api';
import { PreviewState } from '@/lib/onboarding';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: { adminUpdateClub: jest.fn() },
}));
import { api } from '@/lib/api';

const club = {
  id: 'c1', slug: 'padel-riviera', name: 'Padel Riviera',
  logoUrl: null, accentColor: '#d6ff3f', defaultThemeMode: 'floodlit',
  publicBookingDays: 7, memberBookingDays: 14, cancellationCutoffHours: 0,
  listedInDirectory: true, stripeAccountStatus: 'NONE',
} as unknown as ClubAdminDetail;

const preview: PreviewState = {
  name: 'Padel Riviera', slug: 'padel-riviera', logoUrl: null, accentColor: '#d6ff3f',
  sports: [{ key: 'padel', name: 'Padel', icon: '🎾', noun: 'piste', courtCount: 4, minPrice: 25 }],
};

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('StepRules', () => {
  beforeEach(() => jest.clearAllMocks());

  it('presets pré-sélectionnés depuis le club, save envoie les 3 champs', async () => {
    (api.adminUpdateClub as jest.Mock).mockResolvedValue(club);
    const onPatched = jest.fn(); const advance = jest.fn();
    wrap(<StepRules club={club} clubId="c1" token="t" onPatched={onPatched} advance={advance} />);
    fireEvent.click(screen.getByText('14 jours'));
    fireEvent.click(screen.getByText('24 h avant'));
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith(
      'c1', { publicBookingDays: 14, memberBookingDays: 28, cancellationCutoffHours: 24 }, 't',
    ));
    expect(onPatched).toHaveBeenCalled();
    expect(advance).toHaveBeenCalled();
  });

  it('Passer cette étape → avance sans appel', () => {
    const advance = jest.fn();
    wrap(<StepRules club={club} clubId="c1" token="t" onPatched={jest.fn()} advance={advance} />);
    fireEvent.click(screen.getByText('Passer cette étape'));
    expect(api.adminUpdateClub).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalled();
  });
});

describe('StepLaunch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } });
  });

  it('mise en ligne → persiste listedInDirectory puis affiche le final festif', async () => {
    (api.adminUpdateClub as jest.Mock).mockResolvedValue(club);
    const onFinished = jest.fn();
    wrap(<StepLaunch club={club} preview={preview} clubId="c1" token="t" onPatched={jest.fn()} onFinished={onFinished} />);
    fireEvent.click(screen.getByText(/Mettre mon club en ligne/));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith('c1', { listedInDirectory: true }, 't'));
    expect(onFinished).toHaveBeenCalled();
    // le final : titre, URL copiable, récap, CTAs
    expect(screen.getByText(/en ligne\./)).toBeInTheDocument();
    expect(screen.getByText('padel-riviera.palova.fr')).toBeInTheDocument();
    expect(screen.getByText('✓ Padel · 4 pistes')).toBeInTheDocument();
    expect(screen.getByText(/Paiement en ligne · plus tard/)).toBeInTheDocument();
    expect(screen.getByText(/Découvrir mon club-house/).closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText(/Aller à l’espace de gestion/).closest('a')).toHaveAttribute('href', '/admin');
  });

  it('décocher l’annuaire → envoie listedInDirectory: false', async () => {
    (api.adminUpdateClub as jest.Mock).mockResolvedValue({ ...club, listedInDirectory: false });
    wrap(<StepLaunch club={club} preview={preview} clubId="c1" token="t" onPatched={jest.fn()} onFinished={jest.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /annuaire/i }));
    fireEvent.click(screen.getByText(/Mettre mon club en ligne/));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith('c1', { listedInDirectory: false }, 't'));
  });

  it('copier l’URL du club', async () => {
    (api.adminUpdateClub as jest.Mock).mockResolvedValue(club);
    wrap(<StepLaunch club={club} preview={preview} clubId="c1" token="t" onPatched={jest.fn()} onFinished={jest.fn()} />);
    fireEvent.click(screen.getByText(/Mettre mon club en ligne/));
    await screen.findByText('padel-riviera.palova.fr');
    fireEvent.click(screen.getByText(/Copier/));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('padel-riviera')));
    expect(await screen.findByText(/Copié/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `node node_modules/jest/bin/jest.js StepRulesLaunch`
Expected: FAIL — modules introuvables.

- [ ] **Step 3: Implémenter `StepRules`**

```tsx
// frontend/components/onboarding/StepRules.tsx
'use client';
import { useState } from 'react';
import { api, ClubAdminDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { BOOKING_PRESETS, CANCEL_PRESETS } from '@/lib/onboarding';
import { WIZ, WizHeader, WizLabel, WizError, WizActions } from './wizardUi';

export function StepRules({ club, clubId, token, onPatched, advance }: {
  club: ClubAdminDetail;
  clubId: string;
  token: string;
  onPatched: (club: ClubAdminDetail) => void;
  advance: () => void;
}) {
  const { th } = useTheme();
  const accent = club.accentColor;
  const [bookingIdx, setBookingIdx] = useState(() => {
    const i = BOOKING_PRESETS.findIndex((p) => p.publicDays === club.publicBookingDays && p.memberDays === club.memberBookingDays);
    return i >= 0 ? i : 0;
  });
  const [cancelIdx, setCancelIdx] = useState(() => {
    const i = CANCEL_PRESETS.findIndex((p) => p.hours === club.cancellationCutoffHours);
    return i >= 0 ? i : 0;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const b = BOOKING_PRESETS[bookingIdx];
      const c = CANCEL_PRESETS[cancelIdx];
      const updated = await api.adminUpdateClub(clubId, {
        publicBookingDays: b.publicDays, memberBookingDays: b.memberDays, cancellationCutoffHours: c.hours,
      }, token);
      onPatched(updated);
      advance();
    } catch { setError('Impossible d’enregistrer. Réessayez.'); }
    finally { setBusy(false); }
  };

  const presetBtn = (active: boolean) => ({
    borderRadius: 12, padding: '10px 16px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
    cursor: 'pointer', textAlign: 'left' as const,
    background: active ? accent : WIZ.card,
    color: active ? inkOn(accent) : WIZ.mute,
    border: `1px solid ${active ? accent : WIZ.line}`,
  });

  return (
    <div>
      <WizHeader accent={accent} surtitle={`Règles clés · ${club.name}`}
        title={<>Deux règles,<br />et c’est réglé.</>}
        sub="Le reste (heures creuses, quotas, ouverture des créneaux) vous attend dans Réglages, avec des défauts raisonnables." />

      {error && <WizError>{error}</WizError>}

      <WizLabel>Réserver à l’avance (fenêtre publique)</WizLabel>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {BOOKING_PRESETS.map((p, i) => (
          <button key={p.label} type="button" onClick={() => setBookingIdx(i)} style={presetBtn(i === bookingIdx)}>
            {p.label}
            <span style={{ display: 'block', fontSize: 11, fontWeight: 600, opacity: 0.75 }}>abonnés : {p.memberDays} j</span>
          </button>
        ))}
      </div>

      <WizLabel>Annulation possible jusqu’à</WizLabel>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {CANCEL_PRESETS.map((p, i) => (
          <button key={p.label} type="button" onClick={() => setCancelIdx(i)} style={presetBtn(i === cancelIdx)}>
            {p.label}
          </button>
        ))}
      </div>

      <WizActions accent={accent} busy={busy} onNext={save} onSkip={advance} />
    </div>
  );
}
```

- [ ] **Step 4: Implémenter `StepLaunch` (formulaire + final festif)**

```tsx
// frontend/components/onboarding/StepLaunch.tsx
'use client';
import { useState } from 'react';
import { api, ClubAdminDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { clubUrl } from '@/lib/clubUrl';
import { PreviewState } from '@/lib/onboarding';
import { LivePhonePreview } from './LivePhonePreview';
import { WIZ, WizHeader, WizError } from './wizardUi';

const plural = (noun: string, n: number) => (n > 1 ? `${noun}s` : noun);

// Confettis déterministes (pas de Math.random au rendu — positions dérivées de l'index).
const CONFETTI_COLORS = Object.values(ACCENTS);
const CONFETTI = Array.from({ length: 16 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  delay: (i % 7) * 0.3,
  duration: 2.8 + (i % 5) * 0.45,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  round: i % 3 === 0,
}));

export function StepLaunch({ club, preview, clubId, token, onPatched, onFinished }: {
  club: ClubAdminDetail;
  preview: PreviewState;
  clubId: string;
  token: string;
  onPatched: (club: ClubAdminDetail) => void;
  onFinished: () => void;
}) {
  const { th } = useTheme();
  const accent = club.accentColor;
  const [listed, setListed] = useState(club.listedInDirectory);
  const [phase, setPhase] = useState<'form' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const launch = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.adminUpdateClub(clubId, { listedInDirectory: listed }, token);
      onPatched(updated);
      setPhase('done');
      onFinished();
    } catch { setError('Impossible d’enregistrer. Réessayez.'); }
    finally { setBusy(false); }
  };

  const copy = () => {
    navigator.clipboard.writeText(clubUrl(club.slug, '/')).then(() => setCopied(true)).catch(() => {});
  };

  if (phase === 'form') {
    return (
      <div>
        <WizHeader accent={accent} surtitle={`Mise en ligne · ${club.name}`}
          title={<>Prêt pour le<br />coup d’envoi ?</>}
          sub="Dernier choix : votre visibilité sur Palova. Ensuite, place au jeu." />
        {error && <WizError>{error}</WizError>}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', marginBottom: 8 }}>
          <input type="checkbox" checked={listed} aria-label="Afficher mon club dans l’annuaire Palova"
            onChange={(e) => setListed(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: accent, cursor: 'pointer', marginTop: 2 }} />
          <span>
            <span style={{ display: 'block', color: WIZ.text, fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600 }}>Afficher mon club dans l’annuaire Palova</span>
            <span style={{ display: 'block', color: WIZ.mute, fontFamily: th.fontUI, fontSize: 12.5, marginTop: 3 }}>
              Décoché, votre club reste accessible par son adresse directe.
            </span>
          </span>
        </label>
        <div style={{ marginTop: 22 }}>
          <button type="button" onClick={launch} disabled={busy} style={{
            background: accent, color: inkOn(accent), border: 'none', borderRadius: 13,
            padding: '13px 28px', fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 800,
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          }}>
            {busy ? 'Mise en ligne…' : 'Mettre mon club en ligne 🎉'}
          </button>
        </div>
      </div>
    );
  }

  // ---- Final festif ----
  const courtsTotal = preview.sports.reduce((n, s) => n + s.courtCount, 0);
  return (
    <div style={{ position: 'relative', textAlign: 'center', padding: '30px 0 10px' }}>
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes ob-fall {
            from { transform: translateY(-8vh) rotate(0deg); opacity: 1; }
            to   { transform: translateY(85vh) rotate(340deg); opacity: 0; }
          }
          .ob-confetti { animation-name: ob-fall; animation-timing-function: linear; animation-iteration-count: 1; animation-fill-mode: both; }
        }
      `}</style>
      <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {CONFETTI.map((c, i) => (
          <span key={i} className="ob-confetti" style={{
            position: 'absolute', top: 0, left: `${c.left}%`,
            width: c.round ? 7 : 8, height: c.round ? 7 : 14,
            borderRadius: c.round ? '50%' : 2, background: c.color,
            animationDelay: `${c.delay}s`, animationDuration: `${c.duration}s`,
          }} />
        ))}
      </div>

      <div style={{ color: WIZ.mute, fontFamily: th.fontUI, fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>
        Félicitations 🎉
      </div>
      <div style={{ color: WIZ.text, fontFamily: th.fontDisplay, fontSize: 38, fontWeight: 600, lineHeight: 1.1 }}>
        {club.name}<br />est <em style={{ color: accent }}>en ligne.</em>
      </div>

      <div style={{ marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 10, background: WIZ.card, border: `1px solid ${WIZ.line}`, borderRadius: 24, padding: '9px 18px' }}>
        <span style={{ color: accent, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>{club.slug}.palova.fr</span>
        <button type="button" onClick={copy} style={{ background: 'transparent', border: 'none', borderLeft: `1px solid ${WIZ.line}`, paddingLeft: 10, color: WIZ.mute, fontFamily: th.fontUI, fontSize: 12, cursor: 'pointer' }}>
          {copied ? 'Copié ✓' : '📋 Copier'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
        <span style={{ background: `${accent}20`, color: accent, borderRadius: 16, padding: '4px 12px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700 }}>✓ Identité</span>
        {preview.sports.map((s) => (
          <span key={s.key} style={{ background: `${accent}20`, color: accent, borderRadius: 16, padding: '4px 12px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700 }}>
            {s.courtCount > 0 ? `✓ ${s.name} · ${s.courtCount} ${plural(s.noun, s.courtCount)}` : `✓ ${s.name}`}
          </span>
        ))}
        {courtsTotal === 0 && (
          <span style={{ background: 'rgba(255,255,255,.08)', color: WIZ.mute, borderRadius: 16, padding: '4px 12px', fontFamily: th.fontUI, fontSize: 11.5 }}>Terrains · plus tard</span>
        )}
        {club.stripeAccountStatus !== 'ACTIVE' && (
          <span style={{ background: 'rgba(255,255,255,.08)', color: WIZ.mute, borderRadius: 16, padding: '4px 12px', fontFamily: th.fontUI, fontSize: 11.5 }}>Paiement en ligne · plus tard</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 24 }}>
        <a href="/" style={{ background: accent, color: inkOn(accent), borderRadius: 13, padding: '12px 24px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}>
          Découvrir mon club-house →
        </a>
        <a href="/admin" style={{ border: `1.5px solid ${WIZ.line}`, color: WIZ.text, borderRadius: 13, padding: '12px 24px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, textDecoration: 'none' }}>
          Aller à l’espace de gestion
        </a>
      </div>

      <div style={{ marginTop: 30, display: 'flex', justifyContent: 'center', opacity: 0.95 }}>
        <LivePhonePreview preview={preview} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Vérifier que le test passe**

Run: `node node_modules/jest/bin/jest.js StepRulesLaunch`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/onboarding/StepRules.tsx frontend/components/onboarding/StepLaunch.tsx frontend/__tests__/StepRulesLaunch.test.tsx
git commit -m "feat(onboarding): etapes Regles cles (presets) et Mise en ligne (final festif confettis)"
```

---

### Task 9: Front — shell `OnboardingWizard`, route `/admin/onboarding`, bypass sidebar, redirection création

**Files:**
- Create: `frontend/components/onboarding/OnboardingWizard.tsx`
- Create: `frontend/app/admin/onboarding/page.tsx`
- Modify: `frontend/app/admin/layout.tsx` (bypass plein écran après la garde, ~l.86)
- Modify: `frontend/app/clubs/new/page.tsx:41` (redirection)
- Test: `frontend/__tests__/OnboardingWizard.test.tsx`

- [ ] **Step 1: Écrire le test d'intégration du wizard qui échoue**

```tsx
// frontend/__tests__/OnboardingWizard.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { ThemeProvider } from '@/lib/ThemeProvider';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: jest.fn(), back: jest.fn() }) }));
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1', name: 'Padel Riviera' } }) }));

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    adminGetClub: jest.fn(),
    adminGetSports: jest.fn(),
    adminGetResources: jest.fn(),
    getSports: jest.fn(),
    adminUpdateClub: jest.fn(),
    adminAddSport: jest.fn(),
    adminCreateResource: jest.fn(),
    uploadClubLogo: jest.fn(),
  },
}));
import { api } from '@/lib/api';

const club = {
  id: 'c1', slug: 'padel-riviera', name: 'Padel Riviera',
  logoUrl: null, accentColor: '#d6ff3f', defaultThemeMode: 'floodlit',
  publicBookingDays: 7, memberBookingDays: 14, cancellationCutoffHours: 0,
  listedInDirectory: true, stripeAccountStatus: 'NONE',
};
const padelCs = {
  id: 'cs-padel', slotStepMin: null, durationsMin: [],
  sport: { id: 's-padel', key: 'padel', name: 'Padel', resourceNoun: 'piste', defaultDurationsMin: [60], surfaces: [], hasLighting: true },
};
const catalog = [
  { id: 's-padel', key: 'padel', name: 'Padel', resourceNoun: 'piste', icon: '🎾', surfaces: [], published: true, hasLighting: true, defaultSlotStepMin: 30, defaultDurationsMin: [60] },
];

const wrap = () => render(<ThemeProvider><OnboardingWizard /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminGetClub as jest.Mock).mockResolvedValue(club);
  (api.adminGetSports as jest.Mock).mockResolvedValue([padelCs]);
  (api.adminGetResources as jest.Mock).mockResolvedValue([]);
  (api.getSports as jest.Mock).mockResolvedValue(catalog);
  (api.adminUpdateClub as jest.Mock).mockResolvedValue(club);
});

describe('OnboardingWizard', () => {
  it('charge l’état réel puis affiche l’étape 1 avec l’aperçu vivant', async () => {
    wrap();
    expect(await screen.findByText(/Donnez un visage/)).toBeInTheDocument();
    // l'aperçu montre le club + placeholder terrains ; le sport actif y apparaît déjà
    expect(screen.getByText('padel-riviera.palova.fr')).toBeInTheDocument();
    expect(screen.getByText(/étape 3…/)).toBeInTheDocument();
    expect(screen.getByText('1/5')).toBeInTheDocument();
  });

  it('« Configurer plus tard » sort vers /admin', async () => {
    wrap();
    await screen.findByText(/Donnez un visage/);
    fireEvent.click(screen.getByText(/Configurer plus tard/));
    expect(push).toHaveBeenCalledWith('/admin');
  });

  it('parcours complet en sautant : les 5 étapes défilent jusqu’au final', async () => {
    wrap();
    await screen.findByText(/Donnez un visage/);
    fireEvent.click(screen.getByText('Passer cette étape'));            // → sports
    expect(await screen.findByText(/Que joue-t-on/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Passer cette étape'));            // → terrains
    expect(await screen.findByText(/Vos terrains,/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Passer cette étape'));            // → règles
    expect(await screen.findByText(/Deux règles,/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Passer cette étape'));            // → mise en ligne
    expect(await screen.findByText(/coup d’envoi/)).toBeInTheDocument();
    expect(screen.getByText('5/5')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Mettre mon club en ligne/));
    expect(await screen.findByText(/en ligne\./)).toBeInTheDocument();
    // le final masque la barre de progression
    expect(screen.queryByText('5/5')).not.toBeInTheDocument();
  });

  it('valider l’étape 1 persiste puis avance ; l’accent choisi se propage à l’aperçu', async () => {
    wrap();
    await screen.findByText(/Donnez un visage/);
    fireEvent.click(screen.getByLabelText('Accent #5e93da'));
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith(
      'c1', { accentColor: '#5e93da', defaultThemeMode: 'floodlit' }, 't',
    ));
    expect(await screen.findByText(/Que joue-t-on/)).toBeInTheDocument();
  });

  it('les terrains créés à l’étape 3 apparaissent dans l’aperçu', async () => {
    (api.adminCreateResource as jest.Mock).mockImplementation((_c, body) => Promise.resolve({
      id: `r-${body.name}`, name: body.name, price: String(body.price), isActive: true,
      attributes: body.attributes, clubSport: padelCs,
    }));
    wrap();
    await screen.findByText(/Donnez un visage/);
    fireEvent.click(screen.getByText('Passer cette étape'));            // → sports
    await screen.findByText(/Que joue-t-on/);
    fireEvent.click(screen.getByText('Passer cette étape'));            // → terrains
    await screen.findByText(/Vos terrains,/);
    fireEvent.change(screen.getByLabelText('Prix au créneau (€) — Padel'), { target: { value: '25' } });
    fireEvent.click(screen.getByText('Continuer →'));
    await screen.findByText(/Deux règles,/);
    // l'aperçu du téléphone reflète les 2 pistes créées (défaut stepper = 2)
    expect(screen.getByText(/2 pistes · dès 25 €/)).toBeInTheDocument();
  });

  it('échec de chargement → message, pas de crash', async () => {
    (api.adminGetClub as jest.Mock).mockRejectedValue(new Error('boom'));
    wrap();
    expect(await screen.findByText(/Impossible de charger votre club/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `node node_modules/jest/bin/jest.js OnboardingWizard`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le shell**

```tsx
// frontend/components/onboarding/OnboardingWizard.tsx
'use client';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ClubAdminDetail, AdminClubSport, AdminResource, Sport } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { STEP_ORDER, StepKey, PreviewState } from '@/lib/onboarding';
import { Logotype } from '@/components/ui/atoms';
import { LivePhonePreview } from './LivePhonePreview';
import { WIZ } from './wizardUi';
import { StepIdentity } from './StepIdentity';
import { StepSports } from './StepSports';
import { StepCourts } from './StepCourts';
import { StepRules } from './StepRules';
import { StepLaunch } from './StepLaunch';

/**
 * Wizard d'onboarding plein écran (« aperçu vivant ») : 5 étapes, chaque validation
 * enregistre immédiatement via les routes admin existantes. Ré-ouvrable et idempotent :
 * tout est pré-rempli depuis l'état réel du club.
 */
export function OnboardingWizard() {
  const router = useRouter();
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club: hostClub } = useClub();
  const clubId = hostClub?.id;

  const [club, setClub] = useState<ClubAdminDetail | null>(null);
  const [clubSports, setClubSports] = useState<AdminClubSport[]>([]);
  const [resources, setResources] = useState<AdminResource[]>([]);
  const [catalog, setCatalog] = useState<Sport[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [finished, setFinished] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 860px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!ready || !token || !clubId) return;
    Promise.all([
      api.adminGetClub(clubId, token),
      api.adminGetSports(clubId, token),
      api.adminGetResources(clubId, token),
      api.getSports(),
    ]).then(([c, cs, res, cat]) => {
      setClub(c); setClubSports(cs); setResources(res); setCatalog(cat);
    }).catch(() => setLoadError(true));
  }, [ready, token, clubId]);

  const preview: PreviewState | null = useMemo(() => {
    if (!club) return null;
    return {
      name: club.name, slug: club.slug, logoUrl: club.logoUrl, accentColor: club.accentColor,
      sports: clubSports.map((cs) => {
        const list = resources.filter((r) => r.clubSport.id === cs.id && r.isActive);
        const prices = list.map((r) => Number(r.price)).filter((n) => Number.isFinite(n) && n > 0);
        const cat = catalog.find((s) => s.id === cs.sport.id);
        return {
          key: cs.sport.key, name: cs.sport.name, icon: cat?.icon ?? null,
          noun: cs.sport.resourceNoun, courtCount: list.length,
          minPrice: prices.length ? Math.min(...prices) : null,
        };
      }),
    };
  }, [club, clubSports, resources, catalog]);

  if (!club || !clubId || !token || !preview) {
    return (
      <div style={{ minHeight: '100vh', background: WIZ.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: WIZ.mute, fontFamily: th.fontUI, fontSize: 14, padding: 24, textAlign: 'center' }}>
        {loadError ? 'Impossible de charger votre club. Rechargez la page.' : 'Chargement…'}
      </div>
    );
  }

  const advance = () => setStepIdx((i) => Math.min(i + 1, STEP_ORDER.length - 1));
  const step: StepKey = STEP_ORDER[stepIdx];
  const onLocal = (patch: Partial<ClubAdminDetail>) => setClub((c) => (c ? { ...c, ...patch } : c));

  let stepEl: ReactNode;
  if (step === 'identity') {
    stepEl = <StepIdentity club={club} clubId={clubId} token={token} onLocal={onLocal} onPatched={setClub} advance={advance} />;
  } else if (step === 'sports') {
    stepEl = <StepSports clubName={club.name} catalog={catalog} clubSports={clubSports} clubId={clubId} token={token}
      onAdded={(cs) => setClubSports((l) => [...l, cs])} advance={advance} />;
  } else if (step === 'courts') {
    stepEl = <StepCourts clubName={club.name} clubSports={clubSports} resources={resources} clubId={clubId} token={token}
      onCreated={(r) => setResources((l) => [...l, r])} advance={advance} />;
  } else if (step === 'rules') {
    stepEl = <StepRules club={club} clubId={clubId} token={token} onPatched={setClub} advance={advance} />;
  } else {
    stepEl = <StepLaunch club={club} preview={preview} clubId={clubId} token={token} onPatched={setClub} onFinished={() => setFinished(true)} />;
  }

  return (
    <div style={{ minHeight: '100vh', background: `linear-gradient(160deg, ${WIZ.bg} 0%, ${WIZ.bg2} 100%)`, display: 'flex', flexDirection: 'column' }}>
      <style>{`@keyframes ob-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }`}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 26px', gap: 12 }}>
        <Logotype size={20} color="#fff" />
        {!finished && (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center' }} aria-label={`Étape ${stepIdx + 1} sur ${STEP_ORDER.length}`}>
            {STEP_ORDER.map((k, i) => (
              <span key={k} style={{ width: 34, height: 4, borderRadius: 2, background: i <= stepIdx ? club.accentColor : WIZ.line }} />
            ))}
            <span style={{ color: WIZ.faint, fontFamily: th.fontUI, fontSize: 11.5, marginLeft: 6 }}>{stepIdx + 1}/{STEP_ORDER.length}</span>
          </div>
        )}
        {!finished ? (
          <button type="button" onClick={() => router.push('/admin')}
            style={{ background: 'transparent', border: 'none', color: WIZ.mute, fontFamily: th.fontUI, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Configurer plus tard →
          </button>
        ) : <span />}
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 34, padding: '10px 34px 30px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
        <div key={`${step}-${finished ? 'fin' : 'wiz'}`} style={{ flex: '1 1 340px', maxWidth: finished ? 720 : 440, animation: 'ob-rise .35s ease both' }}>
          {stepEl}
        </div>
        {!finished && isDesktop && (
          <div style={{ flex: '1 1 280px', display: 'flex', justifyContent: 'center' }}>
            <LivePhonePreview preview={preview} />
          </div>
        )}
        {!finished && !isDesktop && (
          <div style={{ flexBasis: '100%' }}>
            <button type="button" onClick={() => setPreviewOpen((v) => !v)}
              style={{ background: 'transparent', border: `1px solid ${WIZ.line}`, color: WIZ.mute, borderRadius: 10, padding: '8px 14px', fontFamily: th.fontUI, fontSize: 12.5, cursor: 'pointer' }}>
              {previewOpen ? 'Masquer l’aperçu' : 'Voir l’aperçu ✨'}
            </button>
            {previewOpen && <div style={{ marginTop: 16 }}><LivePhonePreview preview={preview} /></div>}
          </div>
        )}
      </div>
    </div>
  );
}
```

Note : `Logotype` accepte `size`/`color` (cf. `components/ui/atoms.tsx:14`) — vérifier la prop `color` à l'implémentation ; si elle n'existe pas, l'omettre (le logotype par défaut reste lisible).

- [ ] **Step 4: Créer la page + le bypass sidebar + la redirection**

Page :

```tsx
// frontend/app/admin/onboarding/page.tsx
'use client';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

export default function AdminOnboardingPage() {
  return <OnboardingWizard />;
}
```

Dans `frontend/app/admin/layout.tsx`, juste **après** le bloc de garde (`if (!ready || !token || !club || allowed !== true) { … }`, ~l.80-86), ajouter :

```tsx
  // Le wizard d'onboarding est plein écran : pas de chrome admin (la garde ci-dessus s'applique déjà).
  if (pathname === '/admin/onboarding') return <>{children}</>;
```

Dans `frontend/app/clubs/new/page.tsx` l.41, remplacer :

```tsx
      window.location.assign(clubUrl(club.slug, '/admin'));
```

par :

```tsx
      window.location.assign(clubUrl(club.slug, '/admin/onboarding'));
```

- [ ] **Step 5: Vérifier que tout passe**

Run: `node node_modules/jest/bin/jest.js OnboardingWizard`
Expected: PASS (6 tests).
Run: `node node_modules/jest/bin/jest.js AdminLayout`
Expected: PASS (le mock `usePathname` renvoie `/admin` → chrome inchangée).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/onboarding/OnboardingWizard.tsx frontend/app/admin/onboarding/page.tsx frontend/app/admin/layout.tsx frontend/app/clubs/new/page.tsx frontend/__tests__/OnboardingWizard.test.tsx
git commit -m "feat(onboarding): wizard 5 etapes plein ecran sur /admin/onboarding + redirection a la creation"
```

---

### Task 10: Vérifications finales

- [ ] **Step 1: Types + suites complètes du lot**

Depuis `frontend/` :

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/jest/bin/jest.js onboarding StartChecklist LivePhonePreview StepIdentity StepSportsCourts StepRulesLaunch OnboardingWizard AdminLayout
```

Expected: 0 erreur de type (scoper la lecture aux fichiers du lot si du WIP parallèle traîne), toutes les suites PASS.

Depuis `backend/` :

```bash
npm test
```

Expected: tout vert (⚠️ rappel : la suite front complète a un flake connu BookingModal hors périmètre — vérifier par suites scopées, pas par `npx jest` global).

- [ ] **Step 2: Smoke test manuel (optionnel mais recommandé)**

Piles dev lancées (`start.ps1` ou backend/frontend `npm run dev`) :
1. `curl http://localhost:3001/health` → OK, puis en connecté OWNER sur `padel-arena-paris` : `GET /api/clubs/club-demo/admin/onboarding-status` → JSON des compteurs.
2. Ouvrir `http://padel-arena-paris.lvh.me:3000/admin/onboarding` (hôte club) → wizard plein écran, aperçu pré-rempli (logo/sports/terrains existants), « déjà N pistes ✓ » à l'étape 3.
3. Dashboard `/admin` → carte « Guide de démarrage » avec l'anneau de progression ; croix → disparaît ; recharger → toujours masquée.
4. Le skill `verify` (screenshots Chrome headless) peut servir à valider visuellement les deux écrans.

- [ ] **Step 3: Commit final éventuel (ajustements du smoke) puis fin de branche**

Suivre le skill `superpowers:finishing-a-development-branch` (merge/PR au choix de l'utilisateur).

---

## Notes de fin

- **Aucune migration Prisma** — ne pas lancer `prisma migrate dev` (dérive connue de la base dev ; rien n'est requis ici).
- **Idempotence** : rouvrir le wizard sur un club configuré ne crée rien tant qu'on n'appuie pas sur + à l'étape 3 ; valider sans changement = PATCH des mêmes valeurs (no-op sûr).
- **Hors périmètre v1** (rappel spec) : QR code, persistance serveur du masquage checklist, étapes Stripe/offres/page club dans le wizard, emails de relance, onboarding joueur, retrait de sport.

