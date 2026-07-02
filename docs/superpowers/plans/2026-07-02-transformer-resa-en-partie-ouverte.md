# Transformer une réservation en partie ouverte — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'organisateur d'une réservation padel confirmée de la basculer en « partie ouverte » (PUBLIC ↔ PRIVATE) après coup, avec une fourchette de niveau optionnelle.

**Architecture:** Une seule bascule de visibilité owner-only sur une résa `CONFIRMED`/future/padel/place-libre. Backend : méthode de service `setReservationVisibility` (simple `update`, ni verrou Redis ni mutation de participants) + route `POST /reservations/:id/visibility`. Frontend : composant `OpenMatchToggle` (bouton « Ouvrir » → feuille de niveau → « Publier » ; état public → chip + « Fermer » + partage) branché dans `ReservationPlayersInline` (déjà rendu par le calendrier et la liste). **Aucune migration** : `visibility`/`targetLevelMin`/`targetLevelMax` existent déjà sur `Reservation` et sont déjà émis par `listUserReservations`.

**Tech Stack:** Express 5, Prisma 7, Jest/supertest (backend) ; Next.js 16, React 19, React Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-07-02-transformer-resa-en-partie-ouverte-design.md`

---

## Notes transverses (à lire avant de commencer)

- **Codes d'erreur** : `UNAUTHORIZED` (403), `RESERVATION_NOT_FOUND` (404), `RESERVATION_NOT_ACTIVE` (409), `RESERVATION_IN_PAST` (409), `OPEN_MATCH_PADEL_ONLY` (400), `VALIDATION_ERROR` (400) — **tous déjà présents** dans `ERROR_STATUS` de `backend/src/routes/reservations.ts`. Aucun mapping à ajouter.
- **`sportHasLevels`** est déjà importé dans `reservation.service.ts` (utilisé par `applyHoldSetup`). Ne pas ré-importer.
- **Commandes de test** (répertoires respectifs) :
  - Backend : `cd backend && npx jest reservation.service` puis `npx jest reservations.routes`
  - Frontend : `cd frontend && npx jest OpenMatchToggle` puis `npx jest ReservationPlayersInline`
  - Type-check frontend (jest ne type-check pas) : `cd frontend && npx tsc --noEmit`
  - Type-check backend : `cd backend && npx tsc --noEmit`

---

## Task 1 : Service `ReservationService.setReservationVisibility`

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (ajouter la méthode juste après `setReservationTeams`, vers la ligne 1504)
- Test: `backend/src/services/__tests__/reservation.service.test.ts` (nouveau `describe`, à placer juste après le `describe('setReservationTeams', …)` qui se termine vers la ligne 1959)

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter ce bloc dans `reservation.service.test.ts`, à l'intérieur du `describe('ReservationService', …)` externe, après le `describe('setReservationTeams', …)` :

```ts
  describe('setReservationVisibility', () => {
    const reservationId = 'res-1';
    const ownerUserId = 'user-1';
    const future = () => new Date(Date.now() + 48 * 3600 * 1000);
    const past = () => new Date(Date.now() - 3600 * 1000);
    const row = (over: any = {}) => ({
      id: reservationId, userId: ownerUserId, status: 'CONFIRMED', startTime: future(),
      resource: { clubSport: { sport: { key: 'padel' } } }, ...over,
    });

    it('ouvre une résa padel confirmée future en PUBLIC avec la fourchette de niveau', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row() as any);
      prismaMock.reservation.update.mockResolvedValue({ id: reservationId, visibility: 'PUBLIC', targetLevelMin: 2, targetLevelMax: 5 } as any);

      const out = await service.setReservationVisibility(reservationId, ownerUserId, { visibility: 'PUBLIC', targetLevelMin: 2, targetLevelMax: 5 });

      expect(prismaMock.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { visibility: 'PUBLIC', targetLevelMin: 2, targetLevelMax: 5 },
      }));
      expect(out.visibility).toBe('PUBLIC');
    });

    it('efface la fourchette de niveau en repassant PRIVATE', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ visibility: 'PUBLIC' }) as any);
      prismaMock.reservation.update.mockResolvedValue({ id: reservationId, visibility: 'PRIVATE', targetLevelMin: null, targetLevelMax: null } as any);

      await service.setReservationVisibility(reservationId, ownerUserId, { visibility: 'PRIVATE' });

      expect(prismaMock.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { visibility: 'PRIVATE', targetLevelMin: null, targetLevelMax: null },
      }));
    });

    it('refuse un non-propriétaire (UNAUTHORIZED)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row() as any);
      await expect(service.setReservationVisibility(reservationId, 'autre', { visibility: 'PUBLIC' }))
        .rejects.toThrow('UNAUTHORIZED');
    });

    it('refuse une résa non confirmée (RESERVATION_NOT_ACTIVE)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ status: 'PENDING' }) as any);
      await expect(service.setReservationVisibility(reservationId, ownerUserId, { visibility: 'PUBLIC' }))
        .rejects.toThrow('RESERVATION_NOT_ACTIVE');
    });

    it('refuse une résa passée (RESERVATION_IN_PAST)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ startTime: past() }) as any);
      await expect(service.setReservationVisibility(reservationId, ownerUserId, { visibility: 'PUBLIC' }))
        .rejects.toThrow('RESERVATION_IN_PAST');
    });

    it('refuse PUBLIC sur un sport non-padel (OPEN_MATCH_PADEL_ONLY)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ resource: { clubSport: { sport: { key: 'tennis' } } } }) as any);
      await expect(service.setReservationVisibility(reservationId, ownerUserId, { visibility: 'PUBLIC' }))
        .rejects.toThrow('OPEN_MATCH_PADEL_ONLY');
    });
  });
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd backend && npx jest reservation.service -t "setReservationVisibility"`
Expected: FAIL — `service.setReservationVisibility is not a function`.

- [ ] **Step 3 : Implémenter la méthode**

Dans `backend/src/services/reservation.service.ts`, juste après la fin de `setReservationTeams` (après le `}` de la ligne ~1504, avant le commentaire `/** Réservations d'un joueur … */`), insérer :

```ts
  /**
   * Ouvre/ferme une réservation confirmée en « partie ouverte » (bascule de visibilité,
   * après coup — la contrepartie post-confirmation d'applyHoldSetup). Owner-only. La place
   * étant déjà tenue par une résa CONFIRMED, on ne pose aucun verrou Redis et on ne touche
   * pas aux participants : simple update. PUBLIC réservé au padel ; la fourchette de niveau
   * (grille Padel Magazine) ne vaut qu'en padel et est effacée en repassant PRIVATE.
   */
  async setReservationVisibility(
    reservationId: string,
    userId: string,
    input: { visibility: 'PRIVATE' | 'PUBLIC'; targetLevelMin?: number | null; targetLevelMax?: number | null },
  ) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { resource: { select: { clubSport: { select: { sport: { select: { key: true } } } } } } },
    });
    if (!reservation)                       throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)      throw new Error('UNAUTHORIZED');
    if (reservation.status !== 'CONFIRMED') throw new Error('RESERVATION_NOT_ACTIVE');
    if (reservation.startTime.getTime() <= Date.now()) throw new Error('RESERVATION_IN_PAST');

    const sportKey = reservation.resource.clubSport.sport.key;
    if (input.visibility === 'PUBLIC' && !sportHasLevels(sportKey)) throw new Error('OPEN_MATCH_PADEL_ONLY');

    // Fourchette de niveau conservée uniquement en PUBLIC + padel ; sinon effacée.
    const keepLevel = input.visibility === 'PUBLIC' && sportHasLevels(sportKey);

    return prisma.reservation.update({
      where: { id: reservationId },
      data: {
        visibility: input.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
        targetLevelMin: keepLevel ? (input.targetLevelMin ?? null) : null,
        targetLevelMax: keepLevel ? (input.targetLevelMax ?? null) : null,
      },
      select: { id: true, visibility: true, targetLevelMin: true, targetLevelMax: true },
    });
  }
```

> Note : `sportHasLevels(key)` équivaut ici à `key === 'padel'`. On l'utilise pour rester cohérent avec `applyHoldSetup`.

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd backend && npx jest reservation.service -t "setReservationVisibility"`
Expected: PASS (6 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(open-match): setReservationVisibility — bascule PUBLIC/PRIVATE d'une résa confirmée"
```

---

## Task 2 : Route `POST /api/reservations/:id/visibility`

**Files:**
- Modify: `backend/src/routes/reservations.ts` (ajouter la route après le handler `/:id/setup`, vers la ligne 158)
- Test: `backend/src/routes/__tests__/reservations.routes.test.ts` (nouveau `describe` à la fin du fichier)

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à la fin de `reservations.routes.test.ts` (le `token` de tête est signé avec `id: 'user-1'`, on le réutilise) :

```ts
describe('POST /api/reservations/:id/visibility', () => {
  const futureStart = () => new Date(Date.now() + 48 * 3600 * 1000);

  it('200 : ouvre la partie (PUBLIC) et transmet la fourchette', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'res-1', userId: 'user-1', status: 'CONFIRMED', startTime: futureStart(),
      resource: { clubSport: { sport: { key: 'padel' } } },
    } as any);
    prismaMock.reservation.update.mockResolvedValue({ id: 'res-1', visibility: 'PUBLIC', targetLevelMin: 2, targetLevelMax: 5 } as any);

    const res = await request(app).post('/api/reservations/res-1/visibility').set('Authorization', `Bearer ${token}`)
      .send({ visibility: 'PUBLIC', targetLevelMin: 2, targetLevelMax: 5 });

    expect(res.status).toBe(200);
    expect(res.body.visibility).toBe('PUBLIC');
  });

  it('400 si visibility est invalide', async () => {
    const res = await request(app).post('/api/reservations/res-1/visibility').set('Authorization', `Bearer ${token}`)
      .send({ visibility: 'SECRET' });
    expect(res.status).toBe(400);
  });

  it('403 si ce n est pas le propriétaire (UNAUTHORIZED)', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'res-1', userId: 'autre', status: 'CONFIRMED', startTime: futureStart(),
      resource: { clubSport: { sport: { key: 'padel' } } },
    } as any);
    const res = await request(app).post('/api/reservations/res-1/visibility').set('Authorization', `Bearer ${token}`)
      .send({ visibility: 'PUBLIC' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd backend && npx jest reservations.routes -t "visibility"`
Expected: FAIL — le 200 renvoie 404 (route inexistante → catch-all) ou le body ne contient pas `visibility`.

- [ ] **Step 3 : Implémenter la route**

Dans `backend/src/routes/reservations.ts`, juste après le handler `router.post('/:id/setup', …)` (fin ligne ~158) et avant `router.delete('/:id', …)`, insérer :

```ts
// Bascule de visibilité (transformer une résa confirmée en partie ouverte, ou refermer).
// Owner-only ; validation calquée sur /setup. Aucune mutation de participants.
router.post('/:id/visibility', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { visibility, targetLevelMin, targetLevelMax } = req.body ?? {};
    if (visibility !== 'PRIVATE' && visibility !== 'PUBLIC') {
      return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    }
    if (targetLevelMin !== undefined && targetLevelMin !== null) {
      if (typeof targetLevelMin !== 'number' || targetLevelMin < 0 || targetLevelMin > 8) {
        return void res.status(400).json({ error: 'VALIDATION_ERROR' });
      }
    }
    if (targetLevelMax !== undefined && targetLevelMax !== null) {
      if (typeof targetLevelMax !== 'number' || targetLevelMax < 0 || targetLevelMax > 8) {
        return void res.status(400).json({ error: 'VALIDATION_ERROR' });
      }
    }
    if (targetLevelMin != null && targetLevelMax != null && targetLevelMin > targetLevelMax) {
      return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    }
    const updated = await reservationService.setReservationVisibility(asString(req.params.id), req.user!.id, {
      visibility,
      targetLevelMin: targetLevelMin === undefined ? undefined : (targetLevelMin === null ? null : Number(targetLevelMin)),
      targetLevelMax: targetLevelMax === undefined ? undefined : (targetLevelMax === null ? null : Number(targetLevelMax)),
    });
    res.json(updated);
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd backend && npx jest reservations.routes -t "visibility"`
Expected: PASS (3 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/reservations.ts backend/src/routes/__tests__/reservations.routes.test.ts
git commit -m "feat(open-match): POST /reservations/:id/visibility (owner-only)"
```

---

## Task 3 : Exposer `visibility`/`targetLevel*` côté client (type + api + garde de contrat)

`listUserReservations` utilise `include` **sans** `select` de tête → tous les scalaires de `Reservation` (dont `visibility`, `targetLevelMin`, `targetLevelMax`) sont **déjà** émis via `...rest`. Cette tâche : (a) verrouille ce contrat par un test, (b) déclare les champs dans le type frontend, (c) ajoute la méthode `api.setReservationVisibility`.

**Files:**
- Test: `backend/src/services/__tests__/reservation.service.test.ts` (ajout d'un `it` dans le `describe('listUserReservations', …)`, vers la ligne 1689)
- Modify: `frontend/lib/api.ts` (interface `MyReservation` ~ligne 882 ; méthode dans l'objet `api` après `setReservationTeams` ~ligne 258)

- [ ] **Step 1 : Écrire le test de contrat (backend)**

Dans `reservation.service.test.ts`, à l'intérieur de `describe('listUserReservations', …)`, ajouter après le premier `it(…)` (celui qui finit ligne ~1689) :

```ts
    it('expose visibility et la fourchette de niveau (partie ouverte)', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        { ...baseReservation(), visibility: 'PUBLIC', targetLevelMin: 2, targetLevelMax: 5 },
      ] as any);
      prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }] as any);
      prismaMock.playerRating.findMany.mockResolvedValue([] as any);

      const out = await service.listUserReservations('user-1');

      expect((out[0] as any).visibility).toBe('PUBLIC');
      expect((out[0] as any).targetLevelMin).toBe(2);
      expect((out[0] as any).targetLevelMax).toBe(5);
    });
```

- [ ] **Step 2 : Lancer le test — il doit PASSER immédiatement (garde de contrat)**

Run: `cd backend && npx jest reservation.service -t "expose visibility"`
Expected: PASS (les champs transitent déjà par `...rest`). Si ce test échoue un jour, c'est qu'un `select` a été introduit dans `listUserReservations` — il faudra y ré-ajouter explicitement `visibility, targetLevelMin, targetLevelMax`.

- [ ] **Step 3 : Déclarer les champs dans `MyReservation` (frontend)**

Dans `frontend/lib/api.ts`, dans l'interface `MyReservation` (ligne ~882), ajouter les 3 champs additifs juste après `capacity: number;` :

```ts
export interface MyReservation {
  id: string;
  startTime: string;
  endTime: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  totalPrice: string;
  resource: { id: string; name: string; sport?: { key: string; name: string } | null; club: { name: string; slug: string; timezone: string; playerChangeCutoffHours?: number; cancellationCutoffHours?: number } };
  capacity: number;
  visibility?: 'PRIVATE' | 'PUBLIC';
  targetLevelMin?: number | null;
  targetLevelMax?: number | null;
  participants: { id: string; userId: string; isOrganizer: boolean; firstName: string; lastName: string; avatarUrl: string | null; level?: UserLevel | null; team?: 1 | 2 | null; slot?: number | null }[];
}
```

- [ ] **Step 4 : Ajouter la méthode `api.setReservationVisibility`**

Dans `frontend/lib/api.ts`, dans l'objet `api`, juste après `setReservationTeams: (…)` (ligne ~258), ajouter :

```ts
  setReservationVisibility: (
    reservationId: string,
    visibility: 'PRIVATE' | 'PUBLIC',
    token: string,
    opts?: { targetLevelMin?: number | null; targetLevelMax?: number | null },
  ) =>
    request<{ id: string; visibility: 'PRIVATE' | 'PUBLIC'; targetLevelMin: number | null; targetLevelMax: number | null }>(
      `/api/reservations/${reservationId}/visibility`,
      { method: 'POST', body: JSON.stringify({ visibility, ...opts }) },
      token,
    ),
```

- [ ] **Step 5 : Type-check + commit**

Run: `cd backend && npx jest reservation.service -t "expose visibility"` → PASS
Run: `cd frontend && npx tsc --noEmit` → aucune erreur nouvelle sur `lib/api.ts`

```bash
git add backend/src/services/__tests__/reservation.service.test.ts frontend/lib/api.ts
git commit -m "feat(open-match): expose visibility/targetLevel sur MyReservation + api.setReservationVisibility"
```

---

## Task 4 : Composant `OpenMatchToggle`

**Files:**
- Create: `frontend/components/reservations/OpenMatchToggle.tsx`
- Test: `frontend/__tests__/OpenMatchToggle.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/OpenMatchToggle.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OpenMatchToggle } from '../components/reservations/OpenMatchToggle';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    setReservationVisibility: jest.fn().mockResolvedValue({ id: 'r1', visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null }),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const now = Date.now();
const future = new Date(now + 48 * 3600e3).toISOString();

const resa = (over: Record<string, unknown> = {}) => ({
  id: 'r1', startTime: future, endTime: future, status: 'CONFIRMED', totalPrice: '25',
  resource: { id: 'res1', name: 'Terrain 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Club', slug: 'demo', timezone: 'Europe/Paris' } },
  capacity: 4,
  participants: [
    { id: 'p-org', userId: 'u-org', isOrganizer: true, firstName: 'Org', lastName: 'A', avatarUrl: null },
    { id: 'p2', userId: 'u2', isOrganizer: false, firstName: 'Ines', lastName: 'B', avatarUrl: null },
  ],
  ...over,
}) as never;

const wrap = (over = {}, onChanged = () => {}) =>
  render(<ThemeProvider><OpenMatchToggle reservation={resa(over)} token="abc" now={now} onChanged={onChanged} /></ThemeProvider>);

describe('OpenMatchToggle', () => {
  beforeEach(() => jest.clearAllMocks());

  it('padel confirmée future avec place libre → propose « Ouvrir aux joueurs du club »', () => {
    wrap();
    expect(screen.getByRole('button', { name: /Ouvrir aux joueurs du club/ })).toBeInTheDocument();
  });

  it('ne rend rien pour un sport non-padel', () => {
    const { container } = wrap({
      resource: { id: 'res1', name: 'Court', sport: { key: 'tennis', name: 'Tennis' }, club: { name: 'Club', slug: 'demo', timezone: 'Europe/Paris' } },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('ne rend rien quand la partie est complète', () => {
    const full = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, userId: `u${i}`, isOrganizer: i === 0, firstName: 'P', lastName: `${i}`, avatarUrl: null }));
    const { container } = wrap({ participants: full });
    expect(container).toBeEmptyDOMElement();
  });

  it('ouvre la feuille et publie sans fourchette de niveau', async () => {
    const onChanged = jest.fn();
    wrap({}, onChanged);
    fireEvent.click(screen.getByRole('button', { name: /Ouvrir aux joueurs du club/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Publier$/ }));
    await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalledWith('r1', 'PUBLIC', 'abc', { targetLevelMin: null, targetLevelMax: null }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('publie avec une fourchette quand « Limiter le niveau » est activé', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /Ouvrir aux joueurs du club/ }));
    fireEvent.click(screen.getByRole('switch', { name: /Limiter le niveau/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Publier$/ }));
    await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalledWith('r1', 'PUBLIC', 'abc', { targetLevelMin: 3, targetLevelMax: 6 }));
  });

  it('partie ouverte → chip « Ouverte » + « Fermer » (repasse en privé)', async () => {
    const onChanged = jest.fn();
    wrap({ visibility: 'PUBLIC' }, onChanged);
    expect(screen.getByText('Ouverte')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Fermer$/ }));
    await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalledWith('r1', 'PRIVATE', 'abc'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx jest OpenMatchToggle`
Expected: FAIL — `Cannot find module '../components/reservations/OpenMatchToggle'`.

- [ ] **Step 3 : Implémenter le composant**

Créer `frontend/components/reservations/OpenMatchToggle.tsx` :

```tsx
'use client';
import { useState } from 'react';
import { api, MyReservation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Chip } from '@/components/ui/atoms';
import { LevelRangeSlider } from '@/components/player/LevelRangeSlider';
import { MatchShareButton } from '@/components/openmatch/MatchShareButton';
import { sportHasLevels } from '@/lib/level';

const ERR: Record<string, string> = {
  UNAUTHORIZED: "Seul l'organisateur peut ouvrir cette partie.",
  RESERVATION_NOT_ACTIVE: "Cette réservation n'est pas ouvrable.",
  RESERVATION_IN_PAST: 'Trop tard pour ouvrir cette partie.',
  OPEN_MATCH_PADEL_ONLY: 'Seules les parties de padel peuvent être ouvertes.',
};
const msg = (e: string) => ERR[e] ?? e;

// Bascule « partie ouverte » d'une réservation confirmée : ouvrir (avec fourchette de
// niveau optionnelle, padel) → visible/rejoignable sur /parties ; refermer sans toucher
// aux joueurs déjà inscrits. Ne s'affiche que si l'action a un sens (voir `canOpen`).
export function OpenMatchToggle({ reservation, token, now, onChanged }: {
  reservation: MyReservation;
  token: string;
  now: number;
  onChanged: () => void;
}) {
  const { th } = useTheme();
  const [sheet, setSheet] = useState(false); // feuille d'ouverture dépliée ?
  const [limit, setLimit] = useState(false); // « Limiter le niveau » activé ?
  const [lmin, setLmin] = useState(3);
  const [lmax, setLmax] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPadel = sportHasLevels(reservation.resource.sport?.key);
  const isPublic = reservation.visibility === 'PUBLIC';
  const future = new Date(reservation.startTime).getTime() > now;
  const spotsLeft = Math.max(0, (reservation.capacity ?? 0) - (reservation.participants?.length ?? 0));
  const canOpen = isPadel && reservation.status === 'CONFIRMED' && future && spotsLeft > 0;

  // Rien à proposer si ce n'est ni ouvert (→ « Fermer ») ni ouvrable (→ « Ouvrir »).
  if (!isPublic && !canOpen) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); setSheet(false); onChanged(); }
    catch (e) { setError(msg((e as Error).message)); }
    finally { setBusy(false); }
  };

  const publish = () => run(() => api.setReservationVisibility(
    reservation.id, 'PUBLIC', token,
    limit ? { targetLevelMin: lmin, targetLevelMax: lmax } : { targetLevelMin: null, targetLevelMax: null },
  ));
  const close = () => run(() => api.setReservationVisibility(reservation.id, 'PRIVATE', token));

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/parties/${reservation.id}` : `/parties/${reservation.id}`;

  const switchBtn = (
    <button type="button" role="switch" aria-checked={limit} aria-label="Limiter le niveau"
      onClick={() => setLimit((v) => !v)}
      style={{ width: 40, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', background: limit ? th.accent : th.surface2, position: 'relative', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: limit ? 19 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
    </button>
  );

  return (
    <div style={{ marginTop: 10 }}>
      {error && (
        <div style={{ marginBottom: 8, background: th.accent, color: th.onAccent, borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      {isPublic ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Chip tone="accent">Ouverte</Chip>
          <MatchShareButton url={shareUrl} title={reservation.resource.name} style={{ height: 34 }} />
          <button type="button" onClick={close} disabled={busy}
            style={{ marginLeft: 'auto', border: `1px solid ${th.line}`, background: 'transparent', cursor: busy ? 'not-allowed' : 'pointer', borderRadius: 9, padding: '6px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>
            Fermer
          </button>
        </div>
      ) : !sheet ? (
        <button type="button" onClick={() => setSheet(true)} disabled={busy}
          style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 10, padding: '8px 14px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text }}>
          Ouvrir aux joueurs du club
        </button>
      ) : (
        <div style={{ border: `1px solid ${th.line}`, borderRadius: 14, padding: 14, background: th.surface }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            {switchBtn}
            <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text, fontWeight: 600 }}>Limiter le niveau des joueurs</span>
          </label>
          {limit && (
            <div style={{ marginTop: 12 }}>
              <LevelRangeSlider min={lmin} max={lmax} onChange={(a, b) => { setLmin(a); setLmax(b); }} disabled={busy} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
            <button type="button" onClick={publish} disabled={busy}
              style={{ border: 'none', cursor: busy ? 'not-allowed' : 'pointer', borderRadius: 10, padding: '9px 16px', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>
              Publier
            </button>
            <button type="button" onClick={() => setSheet(false)} disabled={busy}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontFamily: th.fontUI, fontSize: 13 }}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd frontend && npx jest OpenMatchToggle`
Expected: PASS (6 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/reservations/OpenMatchToggle.tsx frontend/__tests__/OpenMatchToggle.test.tsx
git commit -m "feat(open-match): composant OpenMatchToggle (ouvrir/fermer une résa)"
```

---

## Task 5 : Brancher `OpenMatchToggle` dans `ReservationPlayersInline`

`ReservationPlayersInline` est rendu par `DayPanel` (onglet Calendrier) **et** `MyAgendaListItem` (onglet Liste) uniquement pour les réservations futures dont on est propriétaire, avec `token`. Y insérer le toggle couvre les deux surfaces.

**Files:**
- Modify: `frontend/components/reservations/ReservationPlayersInline.tsx` (import + rendu)
- Test: `frontend/__tests__/ReservationPlayersInline.test.tsx` (compléter le mock `api` + un test d'intégration)

- [ ] **Step 1 : Écrire le test d'intégration qui échoue**

Dans `frontend/__tests__/ReservationPlayersInline.test.tsx` :

1. Compléter le mock `api` (bloc `jest.mock('../lib/api', …)`, lignes 5-14) en ajoutant la méthode :

```ts
    setReservationVisibility: jest.fn().mockResolvedValue({ id: 'r1', visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null }),
```

2. Ajouter ce test à la fin du `describe('ReservationPlayersInline', …)` (la variable `padel` est déjà définie plus haut dans le fichier) :

```ts
  it('padel : propose d’ouvrir la partie aux joueurs du club', () => {
    wrap(padel);
    expect(screen.getByRole('button', { name: /Ouvrir aux joueurs du club/ })).toBeInTheDocument();
  });
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx jest ReservationPlayersInline -t "Ouvrir la partie"`
Expected: FAIL — bouton absent (toggle pas encore branché).

- [ ] **Step 3 : Brancher le composant**

Dans `frontend/components/reservations/ReservationPlayersInline.tsx` :

1. Ajouter l'import après la ligne 11 (`import { teamSlotMaps } from '@/lib/matchSlots';`) :

```ts
import { OpenMatchToggle } from './OpenMatchToggle';
```

2. Rendre le toggle en **premier enfant** du `<div style={{ marginTop: 9 }}>` retourné (juste avant le bloc `{error && (…)}`, ligne ~90) :

```tsx
  return (
    <div style={{ marginTop: 9 }}>
      <OpenMatchToggle reservation={reservation} token={token} now={now} onChanged={onChanged} />
      {error && (
```

(le reste du composant est inchangé.)

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `cd frontend && npx jest ReservationPlayersInline`
Expected: PASS (tous, y compris le nouveau). Les tests non-padel ne rendent pas le toggle (sport absent → `sportHasLevels(undefined) === false`).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/reservations/ReservationPlayersInline.tsx frontend/__tests__/ReservationPlayersInline.test.tsx
git commit -m "feat(open-match): branche OpenMatchToggle dans ReservationPlayersInline (calendrier + liste)"
```

---

## Task 6 : Vérification complète

- [ ] **Step 1 : Suites backend impactées**

Run: `cd backend && npx jest reservation.service reservations.routes`
Expected: PASS.

- [ ] **Step 2 : Suites frontend impactées (dont les montages réels)**

Run: `cd frontend && npx jest OpenMatchToggle ReservationPlayersInline DayPanel MyAgendaListItem`
Expected: PASS. (`DayPanel` passe un `token` mais ne mocke pas `api` — sans souci car `OpenMatchToggle` ne fait aucun appel au rendu ; `MyAgendaListItem` utilise `token:null` → l'éditeur inline n'est pas rendu.)

- [ ] **Step 3 : Type-check des deux paquets**

Run: `cd backend && npx tsc --noEmit`
Run: `cd frontend && npx tsc --noEmit`
Expected: aucune nouvelle erreur (des erreurs pré-existantes hors de nos fichiers peuvent subsister ; vérifier qu'aucune ne cite nos fichiers modifiés).

- [ ] **Step 4 : Vérification manuelle (verify skill)**

Ouvrir l'app (`docker-compose-v1 up -d`, backend `npm run dev`, frontend `npm run dev`), se connecter avec `test@palova.fr` / `password123`, réserver un terrain **padel** futur, puis dans « Mes réservations » (Calendrier ou Liste) :
1. cliquer « Ouvrir aux joueurs du club » → activer « Limiter le niveau » → régler → « Publier » ;
2. vérifier que la partie apparaît sur `/parties` avec la fourchette de niveau ;
3. revenir, vérifier le chip « Ouverte » + « Partager », cliquer « Fermer » → la partie disparaît de `/parties`, les participants restent.

- [ ] **Step 5 : Commit final éventuel** (si des ajustements ont été nécessaires)

```bash
git add -A
git commit -m "test(open-match): vérification bascule visibilité résa"
```

---

## Self-Review (rempli par l'auteur du plan)

**Couverture spec :**
- Bascule PUBLIC/PRIVATE owner-only → Task 1 + 2. ✅
- Gardes padel/confirmée/future/place-libre → Task 1 (backend) + Task 4 `canOpen` (UI). ✅
- Fourchette de niveau padel-only, effacée en PRIVATE → Task 1 (`keepLevel`). ✅
- Feuille de niveau optionnelle réutilisant `LevelRangeSlider` → Task 4. ✅
- Réversibilité (ouvrir ↔ fermer) → Task 4 (branche `isPublic`). ✅
- `MyReservation` expose `visibility`/`targetLevel*` → Task 3. ✅
- Présent dans calendrier **et** liste → Task 5 (via `ReservationPlayersInline`). ✅
- Aucune migration → confirmé (colonnes existantes). ✅
- Partage à l'état public → Task 4 (`MatchShareButton`). ✅

**Placeholders :** aucun — chaque étape porte le code réel.

**Cohérence des types :** `setReservationVisibility(reservationId, userId, { visibility, targetLevelMin?, targetLevelMax? })` identique entre service (Task 1), route (Task 2) et api client (Task 3). Le composant (Task 4) appelle `api.setReservationVisibility(id, 'PUBLIC'|'PRIVATE', token, opts?)`, signature respectée. `MyReservation.visibility` optionnel, lu comme `=== 'PUBLIC'`.

**Hors périmètre (rappel) :** pas de notification « nouvelle partie », pas d'auto-équipes, pas d'ouverture non-padel/pleine/passée, pas de SSE liste, pas d'ouverture depuis le planning admin.
