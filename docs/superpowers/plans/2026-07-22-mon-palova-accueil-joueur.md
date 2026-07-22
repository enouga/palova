# Mon Palova — accueil personnel du joueur (Lot 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `palova.fr` connecté devient « Mon Palova » — hero prochaine partie, agenda tous clubs, parties à rejoindre, mes clubs, portefeuille cross-club, niveau, porte Découvrir — avec carte Gestion pour les gérants ; l'anonyme garde la vitrine actuelle.

**Architecture:** `PlatformLanding` devient un routeur de visages (anonyme → `AnonymousView` inchangée ; connecté → `MonPalova`). `MonPalova` est un orchestrateur qui charge l'agenda (4 payloads) et les adhésions UNE fois, et compose des sections autonomes (`components/platform/home/*`) qui self-fetchent le reste — une brique en échec n'éteint jamais la page. Un seul endpoint backend nouveau : `GET /api/me/wallet` (agrégat cross-club abonnements + carnets). `ManagerView` et la redirection `/decouvrir` disparaissent. `/decouvrir` n'est PAS touchée.

**Tech Stack:** Next.js 16 (Turbopack), Express + Prisma 7 (adapter pg), Jest + RTL. ⚠️ Shims `.bin` cassés : `node node_modules/jest/bin/jest.js` et `node node_modules/typescript/bin/tsc`. Jest front ne type-check pas → `tsc --noEmit` séparé. Jest backend : `--testPathPatterns` (pas `--testPathPattern`).

**Spec:** `docs/superpowers/specs/2026-07-22-mon-palova-accueil-joueur-design.md`

**⚠️ Règles de session :** Eric a du WIP non commité dans le repo (club.service, clubhouse, SettingsVisibility…) — **`git add` UNIQUEMENT les fichiers listés dans chaque tâche, jamais `git add -A`**. Jamais de `git stash`. Full-run jest front interdit (flake BookingModal connu) — suites ciblées seulement.

---

## Fichiers (vue d'ensemble)

- Create: `backend/src/services/wallet.service.ts` + test
- Modify: `backend/src/routes/me.ts` (+ route wallet) + `backend/src/routes/__tests__/me.routes.test.ts`
- Modify: `frontend/lib/api.ts` (types + `getMyWallet`)
- Create: `frontend/lib/monPalova.ts` + `frontend/__tests__/monPalova.test.ts`
- Create: `frontend/components/platform/home/{HomeHero,HomeAgenda,HomeMatchesRail,MyClubsRow,WalletCard,LevelCard,ManagedClubsCard,DiscoverPill}.tsx` + `frontend/components/platform/MonPalova.tsx` + tests
- Modify: `frontend/components/PlatformLanding.tsx` (routeur de visages, `ManagerView` supprimé) + `frontend/__tests__/PlatformLanding.test.tsx`
- Modify: `frontend/lib/postAuth.ts` (exporter `goToClubAdmin`)
- Modify: `frontend/app/me/reservations/page.tsx` (ligne d'info → `platformUrl('/')`) + `frontend/__tests__/MyReservationsScoping.test.tsx`
- Modify: `CLAUDE.md` (note d'évolution, fin de chantier)

Briques réutilisées telles quelles (ne PAS modifier) : `ResultsToRecord` (self-fetch `/api/me/matches/to-record`, s'auto-masque), `NationalOpenMatches` (rail pur, props `{ matches }`), `LocationSearchPill`, `LevelChip`, `CardStripe`/`Chip`, helpers `buildAgendaList`/`agendaItemClub`/`clubMarker` (lib/calendar), `platformUrl`/`clubUrl`, `HERO_GRADIENT`/`HERO_INK`/`HERO_INK_MUTED` (AgendaHero), `packageLabel` (lib/packages).

---

### Task 1: Backend — `WalletService.listMyWallet` (TDD)

**Files:**
- Create: `backend/src/services/wallet.service.ts`
- Test: `backend/src/services/__tests__/wallet.service.test.ts`

- [ ] **Step 1: Écrire la suite de tests (rouge)**

```ts
// backend/src/services/__tests__/wallet.service.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { WalletService } from '../wallet.service';

const CLUB_A = { slug: 'padel-arena-paris', name: 'Padel Arena Paris', accentColor: '#5e93da' };
const CLUB_B = { slug: 'bordeaux-pala', name: 'Bordeaux Pala', accentColor: '#7c5cff' };

describe('WalletService.listMyWallet', () => {
  let service: WalletService;
  beforeEach(() => { jest.clearAllMocks(); service = new WalletService(); });

  it('groupe abonnements + carnets par club, clubs sans rien omis', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      { id: 's1', status: 'ACTIVE', expiresAt: new Date('2027-01-01'), plan: { name: 'Illimité' }, club: CLUB_A },
    ] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([
      { id: 'p1', kind: 'ENTRIES', creditsRemaining: 8, template: { name: 'Carnet 10', sportKeys: ['padel'] }, club: CLUB_B },
      { id: 'p2', kind: 'WALLET', amountRemaining: '45', template: { name: 'Porte-monnaie', sportKeys: [] }, club: CLUB_A },
    ] as any);

    const out = await service.listMyWallet('u1');

    expect(out).toHaveLength(2);
    const a = out.find((e) => e.club.slug === 'padel-arena-paris')!;
    expect(a.club).toEqual(CLUB_A);
    expect(a.subscriptions.map((s: any) => s.id)).toEqual(['s1']);
    expect(a.packages.map((p: any) => p.id)).toEqual(['p2']);
    const b = out.find((e) => e.club.slug === 'bordeaux-pala')!;
    expect(b.subscriptions).toEqual([]);
    expect(b.packages.map((p: any) => p.id)).toEqual(['p1']);
    // le club n'est pas dupliqué dans chaque item (extrait au niveau du groupe)
    expect((a.subscriptions[0] as any).club).toBeUndefined();
  });

  it('ne demande que les abonnements ACTIFS non expirés de clubs ACTIVE', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);

    await service.listMyWallet('u1');

    const subArgs = (prismaMock.subscription.findMany as jest.Mock).mock.calls[0][0];
    expect(subArgs.where.userId).toBe('u1');
    expect(subArgs.where.status).toBe('ACTIVE');
    expect(subArgs.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(subArgs.where.club).toEqual({ status: 'ACTIVE' });
  });

  it('ne demande que les carnets utilisables (non expirés ET solde > 0), miroir de listMyPackagesBySlug', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);

    await service.listMyWallet('u1');

    const packArgs = (prismaMock.memberPackage.findMany as jest.Mock).mock.calls[0][0];
    expect(packArgs.where.userId).toBe('u1');
    expect(packArgs.where.club).toEqual({ status: 'ACTIVE' });
    expect(packArgs.where.AND).toEqual([
      { OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
      { OR: [{ creditsRemaining: { gte: 1 } }, { amountRemaining: { gt: 0 } }] },
    ]);
  });

  it('aucun solde nulle part → tableau vide', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    expect(await service.listMyWallet('u1')).toEqual([]);
  });
});
```

- [ ] **Step 2: Vérifier le rouge**

Run: `cd backend && node node_modules/jest/bin/jest.js --testPathPatterns "wallet.service"`
Expected: FAIL — `Cannot find module '../wallet.service'`.

- [ ] **Step 3: Implémenter le service**

```ts
// backend/src/services/wallet.service.ts
import { prisma } from '../db/prisma';

const WALLET_CLUB_SELECT = { slug: true, name: true, accentColor: true } as const;
type WalletClub = { slug: string; name: string; accentColor: string };

/**
 * Portefeuille cross-club du joueur pour « Mon Palova » : abonnements ACTIFS non expirés
 * + carnets/porte-monnaie utilisables, groupés par club ACTIVE. Miroir cross-club des
 * lectures club-scopées (`listMySubscriptionsBySlug` / `listMyPackagesBySlug`) — mêmes
 * filtres d'utilisabilité, clubs sans rien omis. Lecture seule, aucune migration.
 */
export class WalletService {
  async listMyWallet(userId: string) {
    const now = new Date();
    const [subs, packs] = await Promise.all([
      prisma.subscription.findMany({
        where: { userId, status: 'ACTIVE', expiresAt: { gt: now }, club: { status: 'ACTIVE' } },
        orderBy: { startedAt: 'desc' },
        include: { plan: { select: { name: true } }, club: { select: WALLET_CLUB_SELECT } },
      }),
      prisma.memberPackage.findMany({
        where: {
          userId,
          club: { status: 'ACTIVE' },
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            { OR: [{ creditsRemaining: { gte: 1 } }, { amountRemaining: { gt: 0 } }] },
          ],
        },
        orderBy: { purchasedAt: 'asc' },
        include: { template: { select: { name: true, sportKeys: true } }, club: { select: WALLET_CLUB_SELECT } },
      }),
    ]);

    const byClub = new Map<string, { club: WalletClub; subscriptions: unknown[]; packages: unknown[] }>();
    const bucket = (club: WalletClub) => {
      let b = byClub.get(club.slug);
      if (!b) { b = { club, subscriptions: [], packages: [] }; byClub.set(club.slug, b); }
      return b;
    };
    for (const { club, ...s } of subs) bucket(club).subscriptions.push(s);
    for (const { club, ...p } of packs) bucket(club).packages.push(p);
    return [...byClub.values()];
  }
}

export const walletService = new WalletService();
```

- [ ] **Step 4: Vérifier le vert**

Run: `cd backend && node node_modules/jest/bin/jest.js --testPathPatterns "wallet.service"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/wallet.service.ts backend/src/services/__tests__/wallet.service.test.ts
git commit -m "feat(me): WalletService — portefeuille cross-club (Mon Palova)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Backend — route `GET /api/me/wallet` (TDD)

**Files:**
- Modify: `backend/src/routes/me.ts`
- Test: `backend/src/routes/__tests__/me.routes.test.ts`

- [ ] **Step 1: Tests de route (rouge)** — ajouter à la fin des describes de `me.routes.test.ts` (mocks/`token()` déjà en place dans ce fichier) :

```ts
describe('GET /api/me/wallet', () => {
  it('401 sans token', async () => {
    const res = await request(app).get('/api/me/wallet');
    expect(res.status).toBe(401);
  });

  it("renvoie l'agrégat cross-club du service", async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      { id: 's1', status: 'ACTIVE', expiresAt: new Date('2027-01-01'), plan: { name: 'Illimité' },
        club: { slug: 'padel-arena-paris', name: 'Padel Arena Paris', accentColor: '#5e93da' } },
    ] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);

    const res = await request(app).get('/api/me/wallet').set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].club.slug).toBe('padel-arena-paris');
    expect(res.body[0].subscriptions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Vérifier le rouge**

Run: `cd backend && node node_modules/jest/bin/jest.js --testPathPatterns "me.routes" -t "wallet"`
Expected: FAIL — 404 sur la route (pas encore déclarée).

- [ ] **Step 3: Ajouter la route** dans `backend/src/routes/me.ts` (style du fichier : `AuthRequest`/`Response`/`NextFunction`, cf. `/matches/to-record` ~l.318) — import en tête `import { walletService } from '../services/wallet.service';` puis, à côté des autres routes lecture :

```ts
// Portefeuille cross-club (Mon Palova) : abonnements + carnets utilisables, groupés par club.
router.get('/wallet', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await walletService.listMyWallet(req.user!.id));
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Vérifier le vert + build**

Run: `cd backend && node node_modules/jest/bin/jest.js --testPathPatterns "me.routes"` → PASS (toute la suite).
Run: `cd backend && node node_modules/typescript/bin/tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts
git commit -m "feat(me): route GET /api/me/wallet

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Front — types + `api.getMyWallet`

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Types** — près de `MemberPackage`/`Subscription` (~l.2040-2139) :

```ts
// --- Mon Palova : portefeuille cross-club ---
export interface MyWalletClub { slug: string; name: string; accentColor: string }
export interface MyWalletEntry {
  club: MyWalletClub;
  subscriptions: Subscription[];
  packages: MemberPackage[];
}
```

- [ ] **Step 2: Méthode** — dans l'objet `api`, à côté de `getMyMemberships` :

```ts
getMyWallet: (token: string) => request<MyWalletEntry[]>('/api/me/wallet', {}, token),
```

- [ ] **Step 3: Type-check + commit**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit` → exit 0.

```bash
git add frontend/lib/api.ts
git commit -m "feat(me): api.getMyWallet + types MyWalletEntry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Helpers purs `lib/monPalova.ts` (TDD)

**Files:**
- Create: `frontend/lib/monPalova.ts`
- Test: `frontend/__tests__/monPalova.test.ts`

- [ ] **Step 1: Tests (rouge)**

```ts
// frontend/__tests__/monPalova.test.ts
import { splitHomeAgenda, startsInLabel, sortMatchesForHome, ratingToLevel, agendaItemHeading, agendaWhenLabel } from '@/lib/monPalova';
import { buildAgendaList } from '@/lib/calendar';
import { MyReservation, NationalOpenMatch } from '@/lib/api';

const NOW = new Date('2026-07-22T12:00:00.000Z');

function res(id: string, startIso: string, slug = 'padel-arena'): MyReservation {
  const end = new Date(new Date(startIso).getTime() + 3600e3).toISOString();
  return {
    id, startTime: startIso, endTime: end, status: 'CONFIRMED', totalPrice: '25',
    resource: { id: `c-${id}`, name: `Court ${id}`, club: { name: 'Padel Arena', slug, timezone: 'Europe/Paris' } },
    capacity: 4, participants: [],
  };
}

describe('splitHomeAgenda', () => {
  it('hero = 1re entrée à venir, next = les 3 suivantes (jamais de doublon)', () => {
    const list = buildAgendaList(
      [res('1', '2026-07-23T10:00:00.000Z'), res('2', '2026-07-24T10:00:00.000Z'),
       res('3', '2026-07-25T10:00:00.000Z'), res('4', '2026-07-26T10:00:00.000Z'),
       res('5', '2026-07-27T10:00:00.000Z')],
      [], [], [], NOW,
    );
    const { hero, next } = splitHomeAgenda(list);
    expect(hero!.id).toBe('1');
    expect(next.map((i) => i.id)).toEqual(['2', '3', '4']);
  });

  it('exclut le passé ; agenda vide → hero null, next []', () => {
    const list = buildAgendaList([res('old', '2026-07-01T10:00:00.000Z')], [], [], [], NOW);
    expect(splitHomeAgenda(list)).toEqual({ hero: null, next: [] });
  });
});

describe('startsInLabel', () => {
  it('« dans X min » sous 1 h, « dans X h » sous 48 h, « J-x » au-delà, null si commencé', () => {
    expect(startsInLabel('2026-07-22T12:30:00.000Z', NOW)).toBe('dans 30 min');
    expect(startsInLabel('2026-07-23T10:00:00.000Z', NOW)).toBe('dans 22 h');
    expect(startsInLabel('2026-07-26T12:00:00.000Z', NOW)).toBe('J-4');
    expect(startsInLabel('2026-07-22T11:00:00.000Z', NOW)).toBeNull();
  });
});

describe('sortMatchesForHome', () => {
  const m = (id: string, slug: string) => ({ id, club: { slug } } as NationalOpenMatch);
  it('mes clubs d\'abord (ordre du flux conservé), cap 6', () => {
    const out = sortMatchesForHome(
      [m('a', 'x'), m('b', 'mine'), m('c', 'y'), m('d', 'mine'), m('e', 'z'), m('f', 'x'), m('g', 'y')],
      new Set(['mine']),
    );
    expect(out.map((x) => x.id)).toEqual(['b', 'd', 'a', 'c', 'e', 'f']);
  });
});

describe('ratingToLevel', () => {
  it('mappe MyRating → UserLevel ; null si pas de niveau', () => {
    expect(ratingToLevel({ calibrated: true, level: 6, tier: 'Confirmé', isProvisional: false, reliability: 93, matchesPlayed: 17 }))
      .toEqual({ level: 6, tier: 'Confirmé', isProvisional: false, reliability: 93 });
    expect(ratingToLevel({ calibrated: false, level: null, tier: '—', isProvisional: true, reliability: 0, matchesPlayed: 0 })).toBeNull();
    expect(ratingToLevel(null)).toBeNull();
  });
});

describe('agendaItemHeading / agendaWhenLabel', () => {
  it('titre par kind + horaire au fuseau du club de l\'entrée', () => {
    const [item] = buildAgendaList([res('1', '2026-07-23T16:00:00.000Z')], [], [], [], NOW);
    expect(agendaItemHeading(item).title).toBe('Court 1');
    expect(agendaWhenLabel(item)).toMatch(/jeu\. 23 juil\. · 18h00/); // 16h UTC = 18h Paris
  });
});
```

- [ ] **Step 2: Rouge** — `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/monPalova.test.ts` → FAIL (module absent).

- [ ] **Step 3: Implémenter**

```ts
// frontend/lib/monPalova.ts
import { AgendaListItem, agendaItemClub } from '@/lib/calendar';
import { MyRating, NationalOpenMatch, UserLevel } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

export interface HomeAgendaSplit { hero: AgendaListItem | null; next: AgendaListItem[] }

/** Hero = 1re entrée à venir ; next = les `count` suivantes (le hero n'y figure jamais). */
export function splitHomeAgenda(list: AgendaListItem[], count = 3): HomeAgendaSplit {
  const upcoming = list.filter((i) => !i.past);
  return { hero: upcoming[0] ?? null, next: upcoming.slice(1, 1 + count) };
}

/** Chip de compte à rebours du hero — null dès que c'est commencé (le hero garde l'entrée). */
export function startsInLabel(startIso: string, now: Date): string | null {
  const diff = new Date(startIso).getTime() - now.getTime();
  if (diff <= 0) return null;
  if (diff < HOUR) return `dans ${Math.max(1, Math.round(diff / MIN))} min`;
  if (diff < 48 * HOUR) return `dans ${Math.round(diff / HOUR)} h`;
  return `J-${Math.floor(diff / DAY)}`;
}

/** Rail « Parties à rejoindre » : mes clubs d'abord (ordre du flux conservé), puis le reste, cap. */
export function sortMatchesForHome(matches: NationalOpenMatch[], myClubSlugs: Set<string>, cap = 6): NationalOpenMatch[] {
  const mine = matches.filter((m) => myClubSlugs.has(m.club.slug));
  const others = matches.filter((m) => !myClubSlugs.has(m.club.slug));
  return [...mine, ...others].slice(0, cap);
}

/** `LevelChip` attend un UserLevel — MyRating (level nullable) doit être mappé. */
export function ratingToLevel(r: MyRating | null): UserLevel | null {
  if (!r || r.level == null) return null;
  return { level: r.level, tier: r.tier, isProvisional: r.isProvisional, reliability: r.reliability };
}

/** Titre + lien profond d'une entrée d'agenda (cartes du hero et de « À venir »). */
export function agendaItemHeading(item: AgendaListItem): { title: string; href: string } {
  const slug = agendaItemClub(item).slug;
  if (item.kind === 'reservation') return { title: item.r.resource.name, href: '/me/reservations' };
  if (item.kind === 'tournament') return { title: item.reg.tournament.name, href: clubUrl(slug, `/tournois/${item.reg.tournament.id}`) };
  if (item.kind === 'event') return { title: item.ev.event.name, href: clubUrl(slug, `/events/${item.ev.event.id}`) };
  return { title: `Cours · ${item.enrollment.lesson.coach.name}`, href: `/cours/${item.enrollment.lesson.id}` };
}

/** « jeu. 23 juil. · 18h00 » au fuseau du club de CHAQUE entrée (multi-clubs = multi-fuseaux). */
export function agendaWhenLabel(item: AgendaListItem): string {
  const tz = item.kind === 'reservation' ? item.r.resource.club.timezone
    : item.kind === 'tournament' ? item.reg.tournament.club.timezone
    : item.kind === 'lesson' ? item.enrollment.lesson.club.timezone
    : item.ev.event.club.timezone;
  const d = new Date(item.start);
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(d);
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(d).replace(':', 'h');
  return `${date} · ${hour}`;
}
```

- [ ] **Step 4: Vert** — même commande → PASS. Puis `node node_modules/typescript/bin/tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/monPalova.ts frontend/__tests__/monPalova.test.ts
git commit -m "feat(home): helpers purs Mon Palova (split agenda, countdown, tri rail, mapping rating)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `HomeHero` (TDD)

**Files:**
- Create: `frontend/components/platform/home/HomeHero.tsx`
- Test: `frontend/__tests__/HomeHero.test.tsx`

- [ ] **Step 1: Tests (rouge)**

```tsx
// frontend/__tests__/HomeHero.test.tsx
import { render, screen } from '@testing-library/react';
import { HomeHero } from '../components/platform/home/HomeHero';
import { ThemeProvider } from '../lib/ThemeProvider';
import { buildAgendaList } from '../lib/calendar';
import { MyReservation } from '../lib/api';

const NOW = Date.parse('2026-07-22T12:00:00.000Z');
const resa: MyReservation = {
  id: 'r1', startTime: '2026-07-23T10:00:00.000Z', endTime: '2026-07-23T11:00:00.000Z',
  status: 'CONFIRMED', totalPrice: '25', capacity: 4, participants: [],
  resource: { id: 'c1', name: 'Terrain 3', club: { name: 'Padel Arena Paris', slug: 'padel-arena-paris', timezone: 'Europe/Paris' } },
};
const [entry] = buildAgendaList([resa], [], [], [], new Date(NOW));

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('HomeHero', () => {
  it('salue par prénom et met la prochaine entrée en vedette avec compte à rebours', () => {
    wrap(<HomeHero firstName="Eric" entry={entry} now={NOW} />);
    expect(screen.getByText(/Bonjour Eric/)).toBeInTheDocument();
    expect(screen.getByText(/Terrain 3/)).toBeInTheDocument();
    expect(screen.getByText('Padel Arena Paris')).toBeInTheDocument();
    expect(screen.getByText(/dans 22 h/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Gérer/ })).toHaveAttribute('href', '/me/reservations');
  });

  it('agenda vide → invitation « Trouve ta prochaine partie » + CTA Découvrir (jamais de hero creux)', () => {
    wrap(<HomeHero firstName="Eric" entry={null} now={NOW} />);
    expect(screen.getByText(/Trouve ta prochaine partie/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Découvrir/ })).toHaveAttribute('href', '/decouvrir');
  });

  it('horloge non résolue (now null) → pas de chip compte à rebours (hydration-safe)', () => {
    wrap(<HomeHero firstName={null} entry={entry} now={null} />);
    expect(screen.queryByText(/dans \d/)).toBeNull();
    expect(screen.getByText(/Terrain 3/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rouge** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/HomeHero.test.tsx` → FAIL (module absent).

- [ ] **Step 3: Implémenter**

```tsx
// frontend/components/platform/home/HomeHero.tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { AgendaListItem, agendaItemClub } from '@/lib/calendar';
import { agendaItemHeading, agendaWhenLabel, startsInLabel } from '@/lib/monPalova';

// Hero « prochaine partie » de Mon Palova — brume bleue (jamais de panneau sombre),
// fallback invitation quand l'agenda est vide. `now` null tant que l'horloge client
// n'est pas posée (hydration-safe) → pas de compte à rebours sur ce premier rendu.
export function HomeHero({ firstName, entry, now }: {
  firstName: string | null;
  entry: AgendaListItem | null;
  now: number | null;
}) {
  const { th } = useTheme();
  const chip = { display: 'inline-flex', alignItems: 'center', background: '#ffffffcc', borderRadius: 999, padding: '5px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: HERO_INK, textDecoration: 'none' } as const;
  const countdown = entry && now != null ? startsInLabel(entry.start, new Date(now)) : null;
  const heading = entry ? agendaItemHeading(entry) : null;

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, background: HERO_GRADIENT, padding: '24px 22px', color: HERO_INK }}>
      <div style={{ fontFamily: th.fontBrand, fontSize: 13, letterSpacing: 2.5, textTransform: 'uppercase', color: HERO_INK_MUTED }}>
        {firstName ? `Bonjour ${firstName}` : 'Bonjour'}
      </div>
      {entry && heading ? (
        <>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 'clamp(21px, 5.4vw, 27px)', letterSpacing: -0.5, marginTop: 7, lineHeight: 1.15 }}>
            {heading.title} · {agendaWhenLabel(entry)}
          </div>
          <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: HERO_INK_MUTED, marginTop: 4 }}>
            {agendaItemClub(entry).name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {countdown && <span style={chip}>⏱ {countdown}</span>}
            <a href={heading.href} style={chip}>Gérer →</a>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 'clamp(21px, 5.4vw, 27px)', letterSpacing: -0.5, marginTop: 7, lineHeight: 1.15 }}>
            Trouve ta prochaine partie
          </div>
          <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: HERO_INK_MUTED, marginTop: 4 }}>
            Parties ouvertes, tournois et clubs partout en France.
          </div>
          <div style={{ marginTop: 12 }}>
            <a href="/decouvrir" style={chip}>Découvrir →</a>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Vert** — même commande → PASS. **Step 5: Commit**

```bash
git add frontend/components/platform/home/HomeHero.tsx frontend/__tests__/HomeHero.test.tsx
git commit -m "feat(home): HomeHero — prochaine partie en vedette + fallback invitation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `HomeAgenda` — « À venir · tous clubs » (TDD)

**Files:**
- Create: `frontend/components/platform/home/HomeAgenda.tsx`
- Test: `frontend/__tests__/HomeAgenda.test.tsx`

- [ ] **Step 1: Tests (rouge)**

```tsx
// frontend/__tests__/HomeAgenda.test.tsx
import { render, screen } from '@testing-library/react';
import { HomeAgenda } from '../components/platform/home/HomeAgenda';
import { ThemeProvider } from '../lib/ThemeProvider';
import { buildAgendaList } from '../lib/calendar';
import { MyReservation } from '../lib/api';

const NOW = new Date('2026-07-22T12:00:00.000Z');
const res = (id: string, slug: string, name: string, accentColor?: string): MyReservation => ({
  id, startTime: '2026-07-23T10:00:00.000Z', endTime: '2026-07-23T11:00:00.000Z',
  status: 'CONFIRMED', totalPrice: '25', capacity: 4, participants: [],
  resource: { id: `c-${id}`, name, club: { name: slug, slug, timezone: 'Europe/Paris', ...(accentColor ? { accentColor } : {}) } },
});

describe('HomeAgenda', () => {
  it('cartes avec marqueur club (liseré + chip — plateforme : marqueur partout) et lien Tout voir', () => {
    const items = buildAgendaList([res('1', 'padel-arena', 'Court A', '#5e93da'), res('2', 'bordeaux', 'Court B', '#7c5cff')], [], [], [], NOW);
    const { container } = render(<ThemeProvider><HomeAgenda items={items} /></ThemeProvider>);
    expect(screen.getByText('Court A')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-club-stripe]')).toHaveLength(2);
    expect(screen.getByText('bordeaux').tagName).toBe('SPAN'); // chip club
    expect(screen.getByRole('link', { name: /Tout voir/ })).toHaveAttribute('href', '/me/reservations');
  });

  it('aucune entrée → rien (la section disparaît, le hero fallback fait l\'invitation)', () => {
    const { container } = render(<ThemeProvider><HomeAgenda items={[]} /></ThemeProvider>);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Rouge** — `--runTestsByPath __tests__/HomeAgenda.test.tsx` → FAIL.

- [ ] **Step 3: Implémenter**

```tsx
// frontend/components/platform/home/HomeAgenda.tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { CardStripe, Chip } from '@/components/ui/atoms';
import { AgendaListItem, agendaItemClub, clubMarker } from '@/lib/calendar';
import { agendaItemHeading, agendaWhenLabel } from '@/lib/monPalova';
import { SectionHeader } from '@/components/platform/home/SectionHeader';

// « À venir · tous clubs » : les entrées APRÈS celle du hero (jamais de doublon), en
// cartes-liens read-only — les actions (annuler, joueurs, chat) vivent sur Mes réservations.
// Marqueur club systématique (plateforme = localSlug null → clubMarker partout).
export function HomeAgenda({ items }: { items: AgendaListItem[] }) {
  const { th } = useTheme();
  if (items.length === 0) return null;
  return (
    <section>
      <SectionHeader kicker="À venir · tous clubs" moreLabel="Tout voir →" moreHref="/me/reservations" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item) => {
          const marker = clubMarker(agendaItemClub(item), null);
          const heading = agendaItemHeading(item);
          return (
            <a key={`${item.kind}-${item.id}`} href={heading.href}
              style={{ position: 'relative', overflow: 'hidden', display: 'block', textDecoration: 'none', background: th.surface, borderRadius: 16, padding: '12px 14px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
              {marker && <CardStripe color={marker.accent} />}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>{heading.title}</span>
                {marker && <Chip color={marker.accent}>{marker.name}</Chip>}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 3 }}>{agendaWhenLabel(item)}</div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
```

Et le petit en-tête de section partagé (créé ici, réutilisé par les tâches suivantes) :

**Create:** `frontend/components/platform/home/SectionHeader.tsx`

```tsx
// frontend/components/platform/home/SectionHeader.tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';

/** Kicker éditorial des sections de Mon Palova : tiret accent + petites capitales + lien « plus ». */
export function SectionHeader({ kicker, moreLabel, moreHref }: { kicker: string; moreLabel?: string; moreHref?: string }) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 9px' }}>
      <span aria-hidden style={{ width: 14, height: 3, borderRadius: 2, background: th.accent }} />
      <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.8, textTransform: 'uppercase', color: th.textMute }}>{kicker}</span>
      {moreLabel && moreHref && (
        <a href={moreHref} style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.textMute, textDecoration: 'underline', textUnderlineOffset: 3 }}>{moreLabel}</a>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Vert** → PASS. **Step 5: Commit**

```bash
git add frontend/components/platform/home/HomeAgenda.tsx frontend/components/platform/home/SectionHeader.tsx frontend/__tests__/HomeAgenda.test.tsx
git commit -m "feat(home): HomeAgenda — a venir tous clubs, cartes-liens marquees par club

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `HomeMatchesRail` — « Parties à rejoindre » (TDD)

**Files:**
- Create: `frontend/components/platform/home/HomeMatchesRail.tsx`
- Test: `frontend/__tests__/HomeMatchesRail.test.tsx`

- [ ] **Step 1: Tests (rouge)** — le composant self-fetch `listNationalOpenMatches` (public) ; `NationalOpenMatches` (rail pur) est réutilisé tel quel.

```tsx
// frontend/__tests__/HomeMatchesRail.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { HomeMatchesRail } from '../components/platform/home/HomeMatchesRail';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: { listNationalOpenMatches: jest.fn() },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const match = (id: string, slug: string) => ({
  id, resourceName: 'T1', sport: { key: 'padel', name: 'Padel' },
  startTime: '2026-07-23T18:00:00.000Z', endTime: '2026-07-23T19:30:00.000Z',
  maxPlayers: 4, spotsLeft: 2, full: false, targetLevelMin: null, targetLevelMax: null,
  players: [], club: { slug, name: slug, city: null, timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: null, longitude: null, department: null, departmentCode: null },
});

describe('HomeMatchesRail', () => {
  it('affiche le rail (mes clubs d\'abord) + lien « Toutes »', async () => {
    mocked.listNationalOpenMatches.mockResolvedValue([match('m1', 'autre'), match('m2', 'mien')] as never);
    render(<ThemeProvider><HomeMatchesRail myClubSlugs={new Set(['mien'])} /></ThemeProvider>);
    await waitFor(() => expect(screen.getByRole('link', { name: /Toutes/ })).toHaveAttribute('href', '/decouvrir#parties'));
    // tri : la carte de MON club sort en premier dans le DOM
    const links = Array.from(document.querySelectorAll('a[href*="/parties/"]')).map((a) => a.getAttribute('href'));
    expect(links[0]).toContain('/parties/m2');
  });

  it('flux vide → rien du tout (pas d\'en-tête orphelin)', async () => {
    mocked.listNationalOpenMatches.mockResolvedValue([] as never);
    const { container } = render(<ThemeProvider><HomeMatchesRail myClubSlugs={new Set()} /></ThemeProvider>);
    await waitFor(() => expect(mocked.listNationalOpenMatches).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('fetch en échec → rien (jamais d\'erreur qui casse la page)', async () => {
    mocked.listNationalOpenMatches.mockRejectedValue(new Error('boom'));
    const { container } = render(<ThemeProvider><HomeMatchesRail myClubSlugs={new Set()} /></ThemeProvider>);
    await waitFor(() => expect(mocked.listNationalOpenMatches).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Rouge** → FAIL (module absent).

- [ ] **Step 3: Implémenter**

```tsx
// frontend/components/platform/home/HomeMatchesRail.tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, NationalOpenMatch } from '@/lib/api';
import { NationalOpenMatches } from '@/components/platform/NationalOpenMatches';
import { SectionHeader } from '@/components/platform/home/SectionHeader';
import { sortMatchesForHome } from '@/lib/monPalova';

// Rail « Parties à rejoindre » : flux national public, mes clubs d'abord, cap 6.
// Section autonome : échec réseau → section absente, jamais d'erreur de page.
export function HomeMatchesRail({ myClubSlugs }: { myClubSlugs: Set<string> }) {
  const [matches, setMatches] = useState<NationalOpenMatch[] | null>(null);
  useEffect(() => {
    api.listNationalOpenMatches().then(setMatches).catch(() => setMatches([]));
  }, []);
  const sorted = useMemo(() => sortMatchesForHome(matches ?? [], myClubSlugs), [matches, myClubSlugs]);
  if (sorted.length === 0) return null;
  return (
    <section>
      <SectionHeader kicker="Parties à rejoindre" moreLabel="Toutes →" moreHref="/decouvrir#parties" />
      <NationalOpenMatches matches={sorted} />
    </section>
  );
}
```

- [ ] **Step 4: Vert** → PASS. **Step 5: Commit**

```bash
git add frontend/components/platform/home/HomeMatchesRail.tsx frontend/__tests__/HomeMatchesRail.test.tsx
git commit -m "feat(home): rail Parties a rejoindre (flux national, mes clubs d'abord)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: `MyClubsRow` — « Mes clubs » (TDD)

**Files:**
- Create: `frontend/components/platform/home/MyClubsRow.tsx`
- Test: `frontend/__tests__/MyClubsRow.test.tsx`

- [ ] **Step 1: Tests (rouge)** — reçoit les adhésions en prop (l'orchestrateur les charge une fois, elles servent aussi au tri du rail).

```tsx
// frontend/__tests__/MyClubsRow.test.tsx
import { render, screen } from '@testing-library/react';
import { MyClubsRow } from '../components/platform/home/MyClubsRow';
import { ThemeProvider } from '../lib/ThemeProvider';
import { PlayerMembership } from '../lib/api';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p, api: {} }));

const membership = (slug: string, status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE'): PlayerMembership => ({
  clubId: `id-${slug}`, slug, isSubscriber: false, status,
  club: { id: `id-${slug}`, slug, name: slug.toUpperCase(), city: 'Paris', region: null, latitude: null, longitude: null,
    description: null, accentColor: '#5e93da', logoUrl: null, coverImageUrl: null, sports: [], resourceCount: 3 },
});

describe('MyClubsRow', () => {
  it('cartes des adhésions ACTIVE (lien vers l\'app du club) + carte « Trouver un club »', () => {
    render(<ThemeProvider><MyClubsRow memberships={[membership('padel-arena'), membership('bloque', 'BLOCKED')]} /></ThemeProvider>);
    const club = screen.getByRole('link', { name: /PADEL-ARENA/ });
    expect(club.getAttribute('href')).toContain('padel-arena.');
    expect(screen.queryByText('BLOQUE')).toBeNull(); // BLOCKED filtré
    expect(screen.getByRole('link', { name: /Trouver un club/ })).toHaveAttribute('href', '/decouvrir#clubs');
  });

  it('aucune adhésion → la carte « Trouver un club » reste (invitation)', () => {
    render(<ThemeProvider><MyClubsRow memberships={[]} /></ThemeProvider>);
    expect(screen.getByRole('link', { name: /Trouver un club/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rouge** → FAIL.

- [ ] **Step 3: Implémenter**

```tsx
// frontend/components/platform/home/MyClubsRow.tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { PlayerMembership, assetUrl } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';
import { inkOn } from '@/lib/theme';
import { SectionHeader } from '@/components/platform/home/SectionHeader';

// « Mes clubs » : un tap → le Club-house du club (session partagée .palova.fr en prod).
// Toujours rendue : sans adhésion, la carte « + Trouver un club » est l'invitation.
export function MyClubsRow({ memberships }: { memberships: PlayerMembership[] }) {
  const { th } = useTheme();
  const active = memberships.filter((m) => m.status === 'ACTIVE');
  const card = { flex: '0 0 132px', display: 'block', textDecoration: 'none', background: th.surface, borderRadius: 14, padding: '11px 12px', boxShadow: `inset 0 0 0 1px ${th.line}`, textAlign: 'center' as const };
  return (
    <section>
      <SectionHeader kicker="Mes clubs" />
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {active.map((m) => (
          <a key={m.slug} href={clubUrl(m.slug, '/')} style={card}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 11, margin: '0 auto 7px', background: m.club.accentColor, overflow: 'hidden' }}>
              {m.club.logoUrl
                ? <img src={assetUrl(m.club.logoUrl) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 14, color: inkOn(m.club.accentColor) }}>{m.club.name.charAt(0)}</span>}
            </span>
            <span style={{ display: 'block', fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, color: th.text }}>{m.club.name}</span>
            {m.club.city && <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 11, color: th.textMute, marginTop: 1 }}>{m.club.city}</span>}
          </a>
        ))}
        <a href="/decouvrir#clubs" style={{ ...card, boxShadow: `inset 0 0 0 1.5px ${th.line}` }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 11, margin: '0 auto 7px', background: th.surface2, fontSize: 17, color: th.textMute }}>+</span>
          <span style={{ display: 'block', fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, color: th.textMute }}>Trouver un club</span>
        </a>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Vert** → PASS. **Step 5: Commit**

```bash
git add frontend/components/platform/home/MyClubsRow.tsx frontend/__tests__/MyClubsRow.test.tsx
git commit -m "feat(home): rangee Mes clubs (cartes accentColor -> app du club)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `WalletCard` + `LevelCard` (TDD)

**Files:**
- Create: `frontend/components/platform/home/WalletCard.tsx`
- Create: `frontend/components/platform/home/LevelCard.tsx`
- Test: `frontend/__tests__/WalletCard.test.tsx`, `frontend/__tests__/LevelCard.test.tsx`

- [ ] **Step 1: Tests (rouge)**

```tsx
// frontend/__tests__/WalletCard.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { WalletCard } from '../components/platform/home/WalletCard';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p, api: { getMyWallet: jest.fn() } }));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const ENTRY = {
  club: { slug: 'padel-arena', name: 'Padel Arena', accentColor: '#5e93da' },
  subscriptions: [{ id: 's1', planId: 'pl1', status: 'ACTIVE', startedAt: '2026-01-01', expiresAt: '2026-09-12T00:00:00.000Z',
    monthlyPriceSnapshot: '39', sportKeys: ['padel'], offPeakOnly: false, benefit: 'FREE', discountPercent: null,
    dailyCap: null, weeklyCap: null, plan: { name: 'Padel illimité' } }],
  packages: [{ id: 'p1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 8, amountTotal: null, amountRemaining: null,
    purchasedAt: '2026-06-01', expiresAt: null, template: { name: 'Carnet 10', sportKeys: ['padel'] } }],
};

describe('WalletCard', () => {
  it('liste abonnements + carnets avec la chip du club', async () => {
    mocked.getMyWallet.mockResolvedValue([ENTRY] as never);
    render(<ThemeProvider><WalletCard token="tok" /></ThemeProvider>);
    expect(await screen.findByText(/Padel illimité/)).toBeInTheDocument();
    expect(screen.getByText(/Carnet 10/)).toBeInTheDocument();
    expect(screen.getAllByText('Padel Arena').length).toBeGreaterThan(0);
  });

  it('portefeuille vide → rien', async () => {
    mocked.getMyWallet.mockResolvedValue([] as never);
    const { container } = render(<ThemeProvider><WalletCard token="tok" /></ThemeProvider>);
    await waitFor(() => expect(mocked.getMyWallet).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
```

```tsx
// frontend/__tests__/LevelCard.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { LevelCard } from '../components/platform/home/LevelCard';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p, api: { getMyRating: jest.fn() } }));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

describe('LevelCard', () => {
  it('pastille niveau + matchs joués + lien profil', async () => {
    mocked.getMyRating.mockResolvedValue({ calibrated: true, level: 6, tier: 'Confirmé', isProvisional: false, reliability: 93, matchesPlayed: 17 } as never);
    render(<ThemeProvider><LevelCard token="tok" /></ThemeProvider>);
    expect(await screen.findByText(/17 matchs joués/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ma progression/ })).toHaveAttribute('href', '/me/profile?tab=niveau');
  });

  it('pas de rating (level null) → rien', async () => {
    mocked.getMyRating.mockResolvedValue({ calibrated: false, level: null, tier: '—', isProvisional: true, reliability: 0, matchesPlayed: 0 } as never);
    const { container } = render(<ThemeProvider><LevelCard token="tok" /></ThemeProvider>);
    await waitFor(() => expect(mocked.getMyRating).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Rouge** — `--runTestsByPath __tests__/WalletCard.test.tsx __tests__/LevelCard.test.tsx` → FAIL.

- [ ] **Step 3: Implémenter**

```tsx
// frontend/components/platform/home/WalletCard.tsx
'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, MyWalletEntry } from '@/lib/api';
import { Chip } from '@/components/ui/atoms';
import { packageLabel } from '@/lib/packages';
import { SectionHeader } from '@/components/platform/home/SectionHeader';

function fmtDay(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

// « Mon portefeuille » : abonnements + carnets tous clubs, chip accentColor par club
// (même langage que le marqueur d'agenda). Section absente si tout est vide.
export function WalletCard({ token }: { token: string }) {
  const { th } = useTheme();
  const [entries, setEntries] = useState<MyWalletEntry[] | null>(null);
  useEffect(() => {
    api.getMyWallet(token).then(setEntries).catch(() => setEntries([]));
  }, [token]);
  if (!entries || entries.length === 0) return null;
  const line = { background: th.surface, borderRadius: 14, padding: '10px 13px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: 8 };
  const label = { fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text } as const;
  const sub = { fontFamily: th.fontUI, fontSize: 12, color: th.textMute } as const;
  return (
    <section>
      <SectionHeader kicker="Mon portefeuille" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.flatMap((e) => [
          ...e.subscriptions.map((s) => (
            <div key={`s-${s.id}`} style={line}>
              <span style={label}>⚡ {s.plan.name}</span>
              <Chip color={e.club.accentColor}>{e.club.name}</Chip>
              <span style={sub}>jusqu&apos;au {fmtDay(s.expiresAt)}</span>
            </div>
          )),
          ...e.packages.map((p) => (
            <div key={`p-${p.id}`} style={line}>
              <span style={label}>🎟 {packageLabel(p)}</span>
              <Chip color={e.club.accentColor}>{e.club.name}</Chip>
              {p.expiresAt && <span style={sub}>jusqu&apos;au {fmtDay(p.expiresAt)}</span>}
            </div>
          )),
        ])}
      </div>
    </section>
  );
}
```

> ⚠️ Vérifier la signature réelle de `packageLabel` dans `frontend/lib/packages.ts` avant usage (elle sert déjà au `ProfileMenu` avec un `MemberPackage`) ; si elle attend d'autres champs, adapter l'appel — ne PAS modifier `lib/packages.ts`.

```tsx
// frontend/components/platform/home/LevelCard.tsx
'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, MyRating } from '@/lib/api';
import { LevelChip } from '@/components/player/LevelChip';
import { ratingToLevel } from '@/lib/monPalova';
import { SectionHeader } from '@/components/platform/home/SectionHeader';

// « Mon niveau » (padel, global) : pastille + volume de matchs + lien vers la courbe du profil.
// Section absente tant qu'aucun niveau n'existe.
export function LevelCard({ token }: { token: string }) {
  const { th } = useTheme();
  const [rating, setRating] = useState<MyRating | null>(null);
  useEffect(() => {
    api.getMyRating(token, 'padel').then(setRating).catch(() => setRating(null));
  }, [token]);
  const level = ratingToLevel(rating);
  if (!level) return null;
  return (
    <section>
      <SectionHeader kicker="Mon niveau" />
      <div style={{ background: th.surface, borderRadius: 14, padding: '11px 13px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <LevelChip level={level} />
        <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>{rating!.matchesPlayed} matchs joués</span>
        <a href="/me/profile?tab=niveau" style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.textMute, textDecoration: 'underline', textUnderlineOffset: 3 }}>Ma progression →</a>
      </div>
    </section>
  );
}
```

> Note (écart spec assumé) : la spec évoquait une « tendance +0,3 ce mois si l'historique le permet » — v1 = volume de matchs + lien vers la courbe (`/me/profile?tab=niveau`), la tendance demanderait un fetch d'historique supplémentaire pour une ligne. À réévaluer en polish.
> ⚠️ `LevelChip` s'auto-masque si le club courant a `levelSystemEnabled:false` via `useLevelSystemEnabled()` — sur l'hôte plateforme (pas de club) vérifier qu'il rend bien ; si le hook exige un club, afficher la pastille maison (rond accent + niveau) au lieu de `LevelChip`, sans modifier `LevelChip`.

- [ ] **Step 4: Vert** → PASS (4 tests). **Step 5: Commit**

```bash
git add frontend/components/platform/home/WalletCard.tsx frontend/components/platform/home/LevelCard.tsx frontend/__tests__/WalletCard.test.tsx frontend/__tests__/LevelCard.test.tsx
git commit -m "feat(home): WalletCard (portefeuille cross-club) + LevelCard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: `ManagedClubsCard` + export `goToClubAdmin` (TDD)

**Files:**
- Modify: `frontend/lib/postAuth.ts` (exporter `goToClubAdmin`, aucune logique changée)
- Create: `frontend/components/platform/home/ManagedClubsCard.tsx`
- Test: `frontend/__tests__/ManagedClubsCard.test.tsx`

- [ ] **Step 1: Exporter `goToClubAdmin`** — dans `frontend/lib/postAuth.ts`, remplacer `function goToClubAdmin(` par `export function goToClubAdmin(` (l.21 ; la doc du pont de session dev reste valable). `__tests__/postAuth.test.ts` reste vert (aucun changement de comportement).

- [ ] **Step 2: Tests (rouge)**

```tsx
// frontend/__tests__/ManagedClubsCard.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ManagedClubsCard } from '../components/platform/home/ManagedClubsCard';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p, api: { getMyClubs: jest.fn() } }));
const goToClubAdmin = jest.fn();
jest.mock('../lib/postAuth', () => ({ goToClubAdmin: (...a: unknown[]) => goToClubAdmin(...a) }));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

describe('ManagedClubsCard', () => {
  it('un bouton « Gérer » par club géré, navigation via goToClubAdmin (pont de session dev inclus)', async () => {
    mocked.getMyClubs.mockResolvedValue([{ clubId: 'c1', slug: 'padel-arena', name: 'Padel Arena', role: 'OWNER' }] as never);
    render(<ThemeProvider><ManagedClubsCard token="tok" /></ThemeProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /Gérer Padel Arena/ }));
    expect(goToClubAdmin).toHaveBeenCalledWith('padel-arena', 'tok', 'c1');
  });

  it('aucun club géré → rien (le joueur pur ne voit jamais cette carte)', async () => {
    mocked.getMyClubs.mockResolvedValue([] as never);
    const { container } = render(<ThemeProvider><ManagedClubsCard token="tok" /></ThemeProvider>);
    await waitFor(() => expect(mocked.getMyClubs).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 3: Rouge** → FAIL. **Step 4: Implémenter**

```tsx
// frontend/components/platform/home/ManagedClubsCard.tsx
'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ManagedClub } from '@/lib/api';
import { goToClubAdmin } from '@/lib/postAuth';
import { Icon } from '@/components/ui/Icon';

// Carte Gestion (remplace l'ancien ManagerView) : un bouton par club géré, au-dessus du
// hero. Sobre — le Lot 2 l'enrichira en panneau pouls/KPIs. Absente pour le joueur pur.
export function ManagedClubsCard({ token }: { token: string }) {
  const { th } = useTheme();
  const [clubs, setClubs] = useState<ManagedClub[] | null>(null);
  useEffect(() => {
    api.getMyClubs(token).then(setClubs).catch(() => setClubs([]));
  }, [token]);
  if (!clubs || clubs.length === 0) return null;
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '12px 14px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.8, textTransform: 'uppercase', color: th.textMute, marginBottom: 8 }}>Gestion</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {clubs.map((c) => (
          <button key={c.clubId} onClick={() => goToClubAdmin(c.slug, token, c.clubId)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', cursor: 'pointer', borderRadius: 11, padding: '10px 13px', background: th.ink, color: th.mode === 'floodlit' ? th.text : '#f7f5ee', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, textAlign: 'left' }}>
            <Icon name="arrowR" size={15} color="currentColor" />Gérer {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Vert** → PASS. Lancer aussi `--runTestsByPath __tests__/postAuth.test.ts` → PASS (export sans changement).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/postAuth.ts frontend/components/platform/home/ManagedClubsCard.tsx frontend/__tests__/ManagedClubsCard.test.tsx
git commit -m "feat(home): carte Gestion (remplace ManagerView) + export goToClubAdmin

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: `DiscoverPill` + orchestrateur `MonPalova` (TDD)

**Files:**
- Create: `frontend/components/platform/home/DiscoverPill.tsx`
- Create: `frontend/components/platform/MonPalova.tsx`
- Test: `frontend/__tests__/MonPalova.test.tsx`

- [ ] **Step 1: `DiscoverPill`** (pas de test dédié — couvert par la suite MonPalova) — miroir de l'usage vitrine (`AnonymousView.tsx:93-94`) :

```tsx
// frontend/components/platform/home/DiscoverPill.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocationSearchPill } from '@/components/discover/LocationSearchPill';

// Porte vers /decouvrir (pré-rempli ?q= / géoloc ?pres=1) — pas une recherche embarquée.
export function DiscoverPill() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const goSearch = () => router.push(`/decouvrir${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
  return (
    <LocationSearchPill value={q} onChange={setQ} onSubmit={goSearch}
      onNearMe={() => router.push('/decouvrir?pres=1')} nearActive={false} locating={false} />
  );
}
```

- [ ] **Step 2: Tests de l'orchestrateur (rouge)**

```tsx
// frontend/__tests__/MonPalova.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MonPalova } from '../components/platform/MonPalova';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true, clubId: null }) }));
// Sections lourdes déjà testées isolément → stubs (le test vérifie l'ORCHESTRATION).
jest.mock('../components/match/ResultsToRecord', () => ({ ResultsToRecord: () => <div data-testid="results" /> }));
jest.mock('../components/platform/home/HomeMatchesRail', () => ({ HomeMatchesRail: () => <div data-testid="rail" /> }));
jest.mock('../components/platform/home/WalletCard', () => ({ WalletCard: () => <div data-testid="wallet" /> }));
jest.mock('../components/platform/home/LevelCard', () => ({ LevelCard: () => <div data-testid="level" /> }));
jest.mock('../components/platform/home/ManagedClubsCard', () => ({ ManagedClubsCard: () => <div data-testid="managed" /> }));
jest.mock('../components/platform/home/DiscoverPill', () => ({ DiscoverPill: () => <div data-testid="discover" /> }));
jest.mock('../components/ProfileMenu', () => ({ ProfileMenu: () => <div data-testid="profile" /> }));

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    getMyProfile: jest.fn(), getMyReservations: jest.fn(), getMyTournaments: jest.fn(),
    getMyEvents: jest.fn(), getMyLessons: jest.fn(), getMyMemberships: jest.fn(),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const future = new Date(Date.now() + 24 * 3600e3).toISOString();
const futureEnd = new Date(Date.now() + 25 * 3600e3).toISOString();
const resa = (id: string, start = future) => ({
  id, startTime: start, endTime: futureEnd, status: 'CONFIRMED', totalPrice: '25', capacity: 4, participants: [],
  resource: { id: `c-${id}`, name: `Court ${id}`, club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris', accentColor: '#5e93da' } },
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getMyProfile.mockResolvedValue({ firstName: 'Eric' } as never);
  mocked.getMyReservations.mockResolvedValue([resa('1'), resa('2')] as never);
  mocked.getMyTournaments.mockResolvedValue([] as never);
  mocked.getMyEvents.mockResolvedValue([] as never);
  mocked.getMyLessons.mockResolvedValue([] as never);
  mocked.getMyMemberships.mockResolvedValue([] as never);
});

const wrap = () => render(<ThemeProvider><MonPalova /></ThemeProvider>);

describe('MonPalova', () => {
  it('rend le hero (1re entrée), l\'agenda « À venir » (les suivantes) et toutes les sections', async () => {
    wrap();
    expect(await screen.findByText(/Bonjour Eric/)).toBeInTheDocument();
    expect(screen.getByText(/Court 1/)).toBeInTheDocument();   // hero
    expect(screen.getByText('Court 2')).toBeInTheDocument();   // À venir (pas de doublon du hero)
    for (const id of ['managed', 'results', 'rail', 'wallet', 'level', 'discover']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /Trouver un club/ })).toBeInTheDocument(); // MyClubsRow
  });

  it('une brique agenda en échec n\'éteint pas la page (hero fallback + autres sections vivantes)', async () => {
    mocked.getMyReservations.mockRejectedValue(new Error('boom'));
    wrap();
    expect(await screen.findByText(/Trouve ta prochaine partie/)).toBeInTheDocument();
    expect(screen.getByTestId('rail')).toBeInTheDocument();
  });

  it('agenda vide → hero invitation, pas de section « À venir »', async () => {
    mocked.getMyReservations.mockResolvedValue([] as never);
    wrap();
    expect(await screen.findByText(/Trouve ta prochaine partie/)).toBeInTheDocument();
    expect(screen.queryByText(/À venir · tous clubs/i)).toBeNull();
  });
});
```

- [ ] **Step 3: Rouge** → FAIL (module absent).

- [ ] **Step 4: Implémenter l'orchestrateur**

```tsx
// frontend/components/platform/MonPalova.tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, MyReservation, MyTournamentRegistration, MyEventRegistration, MyLessonEnrollment, PlayerMembership } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { buildAgendaList } from '@/lib/calendar';
import { splitHomeAgenda } from '@/lib/monPalova';
import { HomeHero } from '@/components/platform/home/HomeHero';
import { HomeAgenda } from '@/components/platform/home/HomeAgenda';
import { HomeMatchesRail } from '@/components/platform/home/HomeMatchesRail';
import { MyClubsRow } from '@/components/platform/home/MyClubsRow';
import { WalletCard } from '@/components/platform/home/WalletCard';
import { LevelCard } from '@/components/platform/home/LevelCard';
import { ManagedClubsCard } from '@/components/platform/home/ManagedClubsCard';
import { DiscoverPill } from '@/components/platform/home/DiscoverPill';
import { ResultsToRecord } from '@/components/match/ResultsToRecord';

// « Mon Palova » — accueil plateforme du joueur connecté (spec 2026-07-22). Orchestrateur :
// charge l'agenda (4 payloads, allSettled — une brique en échec n'éteint rien) + le profil
// + les adhésions UNE fois ; le reste est self-fetché par les sections. Ordre des sections
// = spec (Gestion, hero, résultats, à venir, parties, clubs, portefeuille, niveau, découvrir).
export function MonPalova() {
  const { token } = useAuth();
  const { th } = useTheme();
  const [firstName, setFirstName] = useState<string | null>(null);
  const [reservations, setReservations] = useState<MyReservation[]>([]);
  const [tournaments, setTournaments] = useState<MyTournamentRegistration[]>([]);
  const [events, setEvents] = useState<MyEventRegistration[]>([]);
  const [lessons, setLessons] = useState<MyLessonEnrollment[]>([]);
  const [memberships, setMemberships] = useState<PlayerMembership[]>([]);

  // Horloge posée en effet — jamais de new Date() au rendu (hydration-safe).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const h = setInterval(tick, 60_000);
    return () => clearInterval(h);
  }, []);

  useEffect(() => {
    if (!token) return;
    api.getMyProfile(token).then((p) => setFirstName(p.firstName)).catch(() => {});
    api.getMyReservations(token).then(setReservations).catch(() => {});
    api.getMyTournaments(token).then(setTournaments).catch(() => {});
    api.getMyEvents(token).then(setEvents).catch(() => {});
    api.getMyLessons(token).then(setLessons).catch(() => {});
    api.getMyMemberships(token).then(setMemberships).catch(() => {});
  }, [token]);

  const nowDate = useMemo(() => new Date(now ?? 0), [now]);
  const agenda = useMemo(() => buildAgendaList(reservations, tournaments, events, lessons, nowDate), [reservations, tournaments, events, lessons, nowDate]);
  const { hero, next } = useMemo(() => splitHomeAgenda(agenda), [agenda]);
  const myClubSlugs = useMemo(() => new Set(memberships.filter((m) => m.status === 'ACTIVE').map((m) => m.slug)), [memberships]);

  if (!token) return null; // gardé par PlatformLanding — jamais atteint en pratique

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <div style={{ padding: '28px 20px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Logotype size={22} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ThemeToggle />
              <ProfileMenu />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26, padding: '10px 20px 0', maxWidth: 760, margin: '0 auto' }}>
          <ManagedClubsCard token={token} />
          <HomeHero firstName={firstName} entry={hero} now={now} />
          <ResultsToRecord token={token} />
          <HomeAgenda items={next} />
          <HomeMatchesRail myClubSlugs={myClubSlugs} />
          <MyClubsRow memberships={memberships} />
          <WalletCard token={token} />
          <LevelCard token={token} />
          <DiscoverPill />
        </div>
      </div>
    </Screen>
  );
}
```

> ⚠️ `Screen` clampe déjà la largeur — si le `maxWidth: 760` fait doublon visuel, l'ajuster à la vérif CDP (pas une assertion de test).

- [ ] **Step 5: Vert** — `--runTestsByPath __tests__/MonPalova.test.tsx` → PASS. Puis `tsc --noEmit` → 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/platform/home/DiscoverPill.tsx frontend/components/platform/MonPalova.tsx frontend/__tests__/MonPalova.test.tsx
git commit -m "feat(home): orchestrateur Mon Palova (sections autonomes, agenda partage)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: `PlatformLanding` routeur de visages + retarget ligne d'info (TDD)

**Files:**
- Modify: `frontend/components/PlatformLanding.tsx`
- Modify: `frontend/__tests__/PlatformLanding.test.tsx`
- Modify: `frontend/app/me/reservations/page.tsx` (1 ligne)
- Modify: `frontend/__tests__/MyReservationsScoping.test.tsx` (1 assertion)

- [ ] **Step 1: Réécrire les tests `PlatformLanding` (rouge)** — remplacer les cas 2 et 3 :

```tsx
// frontend/__tests__/PlatformLanding.test.tsx — nouvelle forme
import { render, screen } from '@testing-library/react';
import PlatformLanding from '../components/PlatformLanding';
import { ThemeProvider } from '../lib/ThemeProvider';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: jest.fn() }) }));
jest.mock('@/components/platform/AnonymousView', () => ({ __esModule: true, default: () => <div data-testid="anon" /> }));
jest.mock('@/components/platform/MonPalova', () => ({ MonPalova: () => <div data-testid="mon-palova" /> }));
const useAuthMock = jest.fn();
jest.mock('@/lib/useAuth', () => ({ useAuth: () => useAuthMock() }));

const wrap = () => render(<ThemeProvider><PlatformLanding /></ThemeProvider>);

describe('PlatformLanding', () => {
  beforeEach(() => jest.clearAllMocks());

  it('visiteur non connecté → AnonymousView, jamais de redirection /login', () => {
    useAuthMock.mockReturnValue({ token: null, ready: true, clubId: null });
    wrap();
    expect(screen.getByTestId('anon')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('connecté → Mon Palova (plus JAMAIS de redirection /decouvrir ni d\'écran « Vos clubs »)', () => {
    useAuthMock.mockReturnValue({ token: 'tok', ready: true, clubId: null });
    wrap();
    expect(screen.getByTestId('mon-palova')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText(/Vos clubs\./)).toBeNull();
  });

  it('session non résolue → squelette (ni vitrine ni accueil)', () => {
    useAuthMock.mockReturnValue({ token: null, ready: false, clubId: null });
    wrap();
    expect(screen.queryByTestId('anon')).toBeNull();
    expect(screen.queryByTestId('mon-palova')).toBeNull();
  });
});
```

- [ ] **Step 2: Rouge** — `--runTestsByPath __tests__/PlatformLanding.test.tsx` → FAIL (MonPalova pas branché, redirect encore là).

- [ ] **Step 3: Réécrire `PlatformLanding.tsx`** — le fichier entier devient (ManagerView, Header, redirection et fetch `getMyClubs` supprimés ; `PlatformSkeleton` conservé) :

```tsx
// frontend/components/PlatformLanding.tsx
'use client';

import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import AnonymousView from '@/components/platform/AnonymousView';
import { MonPalova } from '@/components/platform/MonPalova';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';

// Accueil plateforme (palova.fr) — routeur de visages (spec Mon Palova 2026-07-22) :
//  - visiteur → vitrine AnonymousView (surface SEO, inchangée)
//  - connecté → Mon Palova (accueil personnel ; la carte Gestion y couvre les gérants,
//    l'ancien ManagerView et la redirection /decouvrir ont disparu)
export default function PlatformLanding() {
  const { token, ready } = useAuth();
  if (!ready) return <PlatformSkeleton />;
  if (!token) return <AnonymousView />;
  return <MonPalova />;
}

function PlatformSkeleton() {
  const { th } = useTheme();
  return (
    <Screen>
      <div style={{ padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 28 }}>
          <Logotype size={26} />
          <ThemeToggle />
        </div>
      </div>
      <div style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
    </Screen>
  );
}
```

- [ ] **Step 4: Retarget de la ligne d'info** — dans `frontend/app/me/reservations/page.tsx`, remplacer `platformUrl('/me/reservations')` par `platformUrl('/')` (lien « Tout voir sur Palova → »). Dans `frontend/__tests__/MyReservationsScoping.test.tsx`, adapter l'assertion :

```ts
// avant :
expect(link.getAttribute('href')).toContain('/me/reservations');
// après (Mon Palova vit à la racine plateforme) :
expect(link.getAttribute('href')).toMatch(/^https?:\/\/[^/]+\/$/);
```

- [ ] **Step 5: Vert** — `--runTestsByPath __tests__/PlatformLanding.test.tsx __tests__/MyReservationsScoping.test.tsx` → PASS. Puis `tsc --noEmit` → 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/PlatformLanding.tsx frontend/__tests__/PlatformLanding.test.tsx frontend/app/me/reservations/page.tsx frontend/__tests__/MyReservationsScoping.test.tsx
git commit -m "feat(home): PlatformLanding -> routeur de visages (Mon Palova), ligne d'info vers la racine

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Vérifications finales + doc

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Type-checks** — `cd frontend && node node_modules/typescript/bin/tsc --noEmit` → 0 ; `cd backend && node node_modules/typescript/bin/tsc --noEmit` → 0.

- [ ] **Step 2: Suites ciblées** (jamais de full-run front) :

```bash
cd backend && node node_modules/jest/bin/jest.js --testPathPatterns "wallet.service|me.routes"
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath \
  __tests__/monPalova.test.ts __tests__/HomeHero.test.tsx __tests__/HomeAgenda.test.tsx \
  __tests__/HomeMatchesRail.test.tsx __tests__/MyClubsRow.test.tsx __tests__/WalletCard.test.tsx \
  __tests__/LevelCard.test.tsx __tests__/ManagedClubsCard.test.tsx __tests__/MonPalova.test.tsx \
  __tests__/PlatformLanding.test.tsx __tests__/MyReservationsScoping.test.tsx \
  __tests__/postAuth.test.ts __tests__/AnonymousView.test.tsx __tests__/calendar.test.ts
```
Expected: tout PASS. (⚠️ `monPalova` vs `MonPalova` : Windows insensible à la casse — `--runTestsByPath` cible les deux fichiers explicitement, pas de motif.)

- [ ] **Step 3: Vérification visuelle CDP** (skill `verify` ; backend + frontend lancés) :
  - `http://localhost:3000/` connecté `test@palova.fr` → Mon Palova complet (hero + sections) ;
  - même URL avec `owner@palova.fr` → carte Gestion au-dessus du hero ;
  - anonyme (sans cookie) → vitrine inchangée ;
  - clair + sombre, desktop 1280 + mobile 390 en `mobile:false` (aucun débordement horizontal — surveiller la rangée Mes clubs et le rail parties, tous deux en scroll interne) ;
  - compte « neuf » (créer un user sans résa via l'API register OU mocker : à défaut, vérifier le fallback hero en supprimant le cookie ≠ possible — utiliser un compte seedé sans résas futures type `joueur@palova.fr` si dispo) → hero « Trouve ta prochaine partie ».
  - la ligne d'info de `/me/reservations` (hôte club, réglage OFF) mène à `palova.fr/`.

- [ ] **Step 4: Note CLAUDE.md** — nouvelle section « ## Mon Palova — accueil plateforme du joueur (2026-07-22) ✅ implémenté » résumant : routeur de visages PlatformLanding (anon → vitrine ; connecté → Mon Palova ; ManagerView supprimé, carte Gestion), les 8 sections + ordre, endpoint `GET /api/me/wallet`, `/decouvrir` intacte, ligne d'info re-ciblée racine, helpers `lib/monPalova.ts`, composants `components/platform/home/*`, Lots 2-3 parqués, chemin de la spec.

- [ ] **Step 5: Commit final**

```bash
git add CLAUDE.md
git commit -m "docs: note d'evolution Mon Palova (accueil plateforme joueur)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review (fait à l'écriture)

- **Couverture spec** : sections 0-8 → Tasks 5-11 ; wallet → 1-3 ; plomberie (PlatformLanding, ligne d'info, ManagerView) → 12 ; PWA/postAuth → aucun changement requis (vérifié : postAuth pousse déjà le joueur vers `/`). Écart assumé documenté : LevelCard sans « tendance mensuelle » (note dans Task 9).
- **Types transverses** : `MyWalletEntry` (Task 3) consommé par `WalletCard` (Task 9) ; `splitHomeAgenda`/`agendaItemHeading`/`agendaWhenLabel`/`startsInLabel`/`sortMatchesForHome`/`ratingToLevel` (Task 4) consommés par Tasks 5-7, 9, 11 — noms identiques partout.
- **Pièges connus rappelés dans les tâches** : add ciblé (WIP Eric), pas de full-run front, shims .bin, `--testPathPatterns`, `LevelChip`/`useLevelSystemEnabled` sur hôte plateforme (garde-fou Task 9), `packageLabel` signature à vérifier (Task 9), casse Windows des fichiers de test (Task 13).
