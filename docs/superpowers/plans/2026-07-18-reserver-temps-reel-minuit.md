# Réserver temps réel + rendez-vous d'ouverture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La grille Réserver se met à jour en direct (canal SSE par club) et le nouveau jour de réservation s'ouvre tout seul à l'heure de release, avec compte à rebours — plus aucune raison de marteler F5 à minuit.

**Architecture:** 5ᵉ canal SSE « club » dans le SSEService (émission jumelle des événements de créneau aux mêmes points d'écriture que l'invalidation du cache de dispo, invalidation TOUJOURS avant broadcast) + route publique `GET /:slug/availability/stream`. Côté client : une EventSource par onglet, patch local pur pour `slot_held/confirmed` (règle de chevauchement), refetch débouncé pour `slot_released`, pastille « En direct », jour verrouillé 🔒 + compte à rebours + ouverture auto avec jitter 0-3 s.

**Tech Stack:** Express + SSEService maison (backend), React/Next 16 + helpers purs testés (frontend), Jest des deux côtés. Aucune migration, aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/2026-07-18-reserver-temps-reel-minuit-design.md`

**Contexte repo à connaître :**
- Lancer un test backend : `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/...` (les shims `.bin` sont cassés — mémoire « Broken node_modules/.bin shims »).
- Frontend : `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/...` ; type-check séparé `node node_modules/typescript/bin/tsc --noEmit` (ts-jest ne type-check pas).
- Suite backend complète : seuls les échecs `icon.routes` (5) sont la baseline connue des worktrees.
- ⚠️ `frontend/components/reserve/SportGrid.tsx` est en WIP dans une AUTRE session (lot C audit UI) — **ne pas le modifier** dans ce plan. Le flip live y marchera sans animation ; la transition CSS y sera ajoutée après le merge du lot C.
- ⚠️ Jamais de `git stash`. Commits sur la branche courante du worktree.

---

### Task 1 : Canal SSE « club » dans SSEService

**Files:**
- Create: `backend/src/services/__tests__/sse.service.club.test.ts`
- Modify: `backend/src/services/sse.service.ts` (ajouter après le bloc `conversationClients`, ~ligne 196)

- [ ] **Step 1 : Écrire les tests (RED)**

```ts
// backend/src/services/__tests__/sse.service.club.test.ts
import { SSEService } from '../sse.service';
import type { Response } from 'express';

// Fausse Response Express : on capture les writes et le handler 'close'.
function fakeRes() {
  const listeners: Record<string, () => void> = {};
  const res = {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    on: jest.fn((ev: string, cb: () => void) => { listeners[ev] = cb; }),
  } as unknown as Response;
  return { res, close: () => listeners['close']?.() };
}

describe('SSEService — canal disponibilités club', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('addClubClient pose les headers SSE et envoie l\'événement connected', () => {
    const { res, close } = fakeRes();
    SSEService.getInstance().addClubClient('club-t1', res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.flushHeaders).toHaveBeenCalled();
    expect((res.write as jest.Mock).mock.calls[0][0]).toContain('"type":"connected"');
    close();
  });

  it('broadcastClub écrit le payload à tous les clients du club, pas aux autres clubs', () => {
    const a = fakeRes(); const b = fakeRes(); const other = fakeRes();
    const sse = SSEService.getInstance();
    sse.addClubClient('club-t2', a.res);
    sse.addClubClient('club-t2', b.res);
    sse.addClubClient('club-autre', other.res);
    (a.res.write as jest.Mock).mockClear();
    (b.res.write as jest.Mock).mockClear();
    (other.res.write as jest.Mock).mockClear();

    sse.broadcastClub('club-t2', { type: 'slot_held', resourceId: 'r1' });

    expect(a.res.write).toHaveBeenCalledWith(expect.stringContaining('"type":"slot_held"'));
    expect(b.res.write).toHaveBeenCalledWith(expect.stringContaining('"type":"slot_held"'));
    expect(other.res.write).not.toHaveBeenCalled();
    a.close(); b.close(); other.close();
  });

  it('la déconnexion retire le client : plus aucun write après close', () => {
    const { res, close } = fakeRes();
    const sse = SSEService.getInstance();
    sse.addClubClient('club-t3', res);
    close();
    (res.write as jest.Mock).mockClear();

    sse.broadcastClub('club-t3', { type: 'slot_released', resourceId: 'r1' });

    expect(res.write).not.toHaveBeenCalled();
  });

  it('heartbeat : un ping toutes les 30 s, coupé au close', () => {
    const { res, close } = fakeRes();
    SSEService.getInstance().addClubClient('club-t4', res);
    (res.write as jest.Mock).mockClear();

    jest.advanceTimersByTime(30_000);
    expect(res.write).toHaveBeenCalledWith(': ping\n\n');

    close();
    (res.write as jest.Mock).mockClear();
    jest.advanceTimersByTime(60_000);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('un write qui jette est toléré et le client mort est purgé', () => {
    const dead = fakeRes(); const alive = fakeRes();
    const sse = SSEService.getInstance();
    sse.addClubClient('club-t5', dead.res);
    sse.addClubClient('club-t5', alive.res);
    (dead.res.write as jest.Mock).mockImplementation(() => { throw new Error('EPIPE'); });
    (alive.res.write as jest.Mock).mockClear();

    sse.broadcastClub('club-t5', { type: 'slot_confirmed', resourceId: 'r1' });
    expect(alive.res.write).toHaveBeenCalled();

    // 2ᵉ broadcast : le mort a été purgé, plus d'appel sur lui.
    (dead.res.write as jest.Mock).mockClear();
    sse.broadcastClub('club-t5', { type: 'slot_confirmed', resourceId: 'r1' });
    expect(dead.res.write).not.toHaveBeenCalled();
    alive.close();
  });
});
```

- [ ] **Step 2 : Vérifier le RED**

Run: `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/sse.service.club.test.ts`
Expected: FAIL — `addClubClient is not a function`.

- [ ] **Step 3 : Implémenter (GREEN)** — ajouter à la fin de la classe `SSEService` (avant l'accolade fermante, après `getConversationUserIds`), calqué au caractère près sur le canal `clients` :

```ts
  // ------------------------------------------------------------------ Canal club
  // Disponibilités d'un club en direct (grille Réserver) : clubId -> Set<Response>.
  // Émission jumelle des événements de créneau par terrain — le client de la page
  // Réserver ouvre UNE connexion par onglet au lieu d'une par terrain.
  private clubClients: Map<string, Set<Response>> = new Map();

  /** Abonne un client au flux des disponibilités d'un club (page Réserver). */
  addClubClient(clubId: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const keepAlive = setInterval(() => {
      // Garde : un write sur socket morte peut jeter en synchrone → sans ce try/catch,
      // l'exception non capturée ferait sortir le process (cf. handler uncaughtException).
      try { res.write(': ping\n\n'); } catch { /* socket morte : le handler 'close' nettoiera */ }
    }, 30_000);

    if (!this.clubClients.has(clubId)) this.clubClients.set(clubId, new Set());
    this.clubClients.get(clubId)!.add(res);

    res.on('close', () => {
      clearInterval(keepAlive);
      this.clubClients.get(clubId)?.delete(res);
      if (this.clubClients.get(clubId)?.size === 0) this.clubClients.delete(clubId);
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', clubId })}\n\n`);
  }

  /** Diffuse un événement de créneau à tous les clients Réserver d'un club (best-effort). */
  broadcastClub(clubId: string, event: SSEEvent): void {
    const clients = this.clubClients.get(clubId);
    if (!clients?.size) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const dead: Response[] = [];
    clients.forEach((res) => { try { res.write(payload); } catch { dead.push(res); } });
    dead.forEach((res) => clients.delete(res));
  }
```

Note : le test « connected » utilise `type: 'connected'` sans `resourceId` — le type `SSEEvent` a `resourceId: string` requis. Le `connected` du canal club n'est pas un `SSEEvent` (comme les canaux match/conversation qui écrivent un objet libre) : écrire l'objet littéral directement comme ci-dessus, sans annotation.

- [ ] **Step 4 : Vérifier le GREEN**

Run: `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/sse.service.club.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/sse.service.ts backend/src/services/__tests__/sse.service.club.test.ts
git commit -m "feat(backend): canal SSE disponibilites par club (SSEService.addClubClient/broadcastClub)"
```

---

### Task 2 : Route publique `GET /:slug/availability/stream`

**Files:**
- Create: `backend/src/routes/__tests__/clubs.availability-stream.routes.test.ts`
- Modify: `backend/src/routes/clubs.ts` (juste APRÈS la route `GET /:slug/availability`, ~ligne 185 ; `SSEService` est déjà importé ligne 31)

- [ ] **Step 1 : Écrire les tests (RED)**

```ts
// backend/src/routes/__tests__/clubs.availability-stream.routes.test.ts
import request from 'supertest';
import app from '../../app';

jest.mock('../../db/prisma', () => ({
  __esModule: true,
  prisma: { club: { findUnique: jest.fn() } },
}));
import { prisma } from '../../db/prisma';

// addClubClient garde la réponse ouverte à vie (SSE) : le mock la termine
// immédiatement pour que supertest rende la main.
const mockAddClubClient = jest.fn((_clubId: string, res: { end: () => void }) => { res.end(); });
jest.mock('../../services/sse.service', () => ({
  SSEService: { getInstance: jest.fn(() => ({ addClubClient: mockAddClubClient })) },
}));

describe('routes clubs — GET /api/clubs/:slug/availability/stream', () => {
  beforeEach(() => {
    mockAddClubClient.mockClear();
    (prisma.club.findUnique as jest.Mock).mockReset();
  });

  it('abonne le client au canal du club (public, sans auth)', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ id: 'club-1', status: 'ACTIVE' });

    const res = await request(app).get('/api/clubs/padel-arena/availability/stream');

    expect(res.status).toBe(200);
    expect(mockAddClubClient).toHaveBeenCalledWith('club-1', expect.anything());
  });

  it('404 pour un slug inconnu', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app).get('/api/clubs/inconnu/availability/stream');
    expect(res.status).toBe(404);
    expect(mockAddClubClient).not.toHaveBeenCalled();
  });

  it('404 pour un club suspendu', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ id: 'club-1', status: 'SUSPENDED' });
    const res = await request(app).get('/api/clubs/suspendu/availability/stream');
    expect(res.status).toBe(404);
    expect(mockAddClubClient).not.toHaveBeenCalled();
  });
});
```

⚠️ Ce fichier mocke `prisma` avec un objet minimal (`club.findUnique` seul) — suffisant car cette suite ne touche aucune autre route. Ne pas copier le mock `user.findUnique` des autres suites : aucune requête authentifiée ici.

- [ ] **Step 2 : Vérifier le RED**

Run: `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/routes/__tests__/clubs.availability-stream.routes.test.ts`
Expected: FAIL — 404 sur la route inexistante (Express tombe dans le 404 global) pour le premier test.

- [ ] **Step 3 : Implémenter la route (GREEN)** — dans `clubs.ts`, juste après le bloc de la route `/:slug/availability` :

```ts
// Flux SSE des disponibilités du club (grille Réserver en direct). Public comme
// la route availability ci-dessus et le flux par terrain /api/resources/:id/stream.
router.get('/:slug/availability/stream', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const club = await prisma.club.findUnique({ where: { slug: asString(req.params.slug) }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') return void res.status(404).json({ error: 'CLUB_NOT_FOUND' });
    SSEService.getInstance().addClubClient(club.id, res);
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4 : Vérifier le GREEN**

Run: `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/routes/__tests__/clubs.availability-stream.routes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/routes/__tests__/clubs.availability-stream.routes.test.ts
git commit -m "feat(backend): route publique GET /:slug/availability/stream (SSE club)"
```

---

### Task 3 : Émission jumelle `broadcastClub` aux points d'écriture

Chaque site qui fait aujourd'hui `invalidateClubAvailability(clubId)` + `SSEService.broadcast(resourceId, event)` doit émettre le même événement vers le canal club. On factorise dans un helper privé de `ReservationService` : **invalidation d'abord, puis les deux broadcasts** (garde-fou de la spec — un client qui refetch en réaction doit trouver le cache frais).

**Files:**
- Modify: `backend/src/services/__tests__/reservation.service.test.ts` (mock sse + nouveaux asserts)
- Modify: `backend/src/services/__tests__/reservation.series.test.ts` (idem)
- Modify: `backend/src/jobs/__tests__/cleanup.job.test.ts` (idem)
- Modify: `backend/src/services/reservation.service.ts`
- Modify: `backend/src/jobs/cleanup.job.ts`

- [ ] **Step 1 : Étendre les mocks SSE des 3 suites (RED)**

Dans `reservation.service.test.ts`, remplacer le mock sse existant :

```ts
const mockBroadcast = jest.fn();
const mockBroadcastClub = jest.fn();

jest.mock('../sse.service', () => ({
  SSEService: { getInstance: jest.fn(() => ({ broadcast: mockBroadcast, broadcastClub: mockBroadcastClub })) },
}));
```

et ajouter `mockBroadcastClub.mockReset();` dans le `beforeEach` racine (à côté de `mockBroadcast.mockReset()`).

Même changement dans `cleanup.job.test.ts` (le mock sse y existe déjà — ajouter `broadcastClub: mockBroadcastClub` + reset). Dans `reservation.series.test.ts`, il n'y a PAS de mock sse aujourd'hui (le vrai service broadcast dans le vide) — en ajouter un, même forme, en tête de fichier avec le reset dans le `beforeEach` global existant.

- [ ] **Step 2 : Ajouter les tests de câblage (RED)** — un test par flux, calqués sur les tests « invalide le cache » déjà présents (mêmes fixtures, copiées à l'identique, seule l'assertion change). Dans `reservation.service.test.ts` :

```ts
// Dans describe('holdSlot') :
it('émet slot_held sur le canal club après un hold réussi', async () => {
  redisMock.set.mockResolvedValue('OK');
  prismaMock.reservation.count.mockResolvedValue(0);
  prismaMock.resource.findUniqueOrThrow.mockResolvedValue({ price: 25, clubId: 'club-demo', club: { timezone: 'Europe/Paris', publicBookingDays: 7, memberBookingDays: 14 } } as any);
  prismaMock.reservation.create.mockResolvedValue({
    id: 'res-1', ...baseParams, status: 'PENDING', totalPrice: 25, createdAt: new Date(),
  } as any);

  await service.holdSlot(baseParams);

  expect(mockBroadcastClub).toHaveBeenCalledWith('club-demo', expect.objectContaining({ type: 'slot_held', resourceId: 'court-1' }));
});

// Dans describe('cancelReservation') :
it("émet slot_released sur le canal club à l'annulation", async () => {
  const future = new Date(Date.now() + 3_600_000);
  prismaMock.reservation.findUnique.mockResolvedValue({
    id: 'res-1', resourceId: 'court-1', userId: 'user-1', status: 'CONFIRMED',
    startTime: future, endTime: new Date(future.getTime() + 3_600_000),
    resource: { clubId: 'club-demo', club: { cancellationCutoffHours: 0, refundOnCancelWithinCutoff: false } },
  } as any);
  prismaMock.reservation.update.mockResolvedValue({
    id: 'res-1', status: 'CANCELLED', resourceId: 'court-1',
    startTime: future, endTime: new Date(future.getTime() + 3_600_000),
  } as any);
  redisMock.del.mockResolvedValue(1);

  await service.cancelReservation('res-1', 'user-1');

  expect(mockBroadcastClub).toHaveBeenCalledWith('club-demo', expect.objectContaining({ type: 'slot_released' }));
});

// Dans describe('confirmReservation avec paymentSource') :
it('émet slot_confirmed sur le canal club après confirmation', async () => {
  prismaMock.reservation.findUnique.mockResolvedValue(pendingResa() as any);
  mockHappyTx();
  prismaMock.memberPackage.findUnique.mockResolvedValue({ id: 'pkg-1', clubId: 'club-demo', userId: 'user-1', kind: 'ENTRIES' } as any);
  prismaMock.memberPackage.updateMany.mockResolvedValue({ count: 1 } as any);
  prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
  prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);
  prismaMock.reservation.update.mockResolvedValue({
    id: 'res-1', resourceId: 'court-1', status: 'CONFIRMED',
    startTime: new Date(), endTime: new Date(),
  } as any);

  await service.confirmReservation('res-1', 'user-1', { paymentSource: { packageId: 'pkg-1' } });

  expect(mockBroadcastClub).toHaveBeenCalledWith('club-demo', expect.objectContaining({ type: 'slot_confirmed' }));
});

// Dans describe('adminCreateReservation') :
it('émet slot_confirmed sur le canal club après création', async () => {
  mockResource();
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.reservation.count.mockResolvedValue(0 as any);
  prismaMock.reservation.create.mockResolvedValue({ id: 'r-new', resourceId: 'court-1', startTime: new Date(), endTime: new Date() } as any);

  await service.adminCreateReservation({ ...base, title: 'Maintenance' });

  expect(mockBroadcastClub).toHaveBeenCalledWith('club-demo', expect.objectContaining({ type: 'slot_confirmed', reservationId: 'r-new' }));
});

// Dans describe('adminRescheduleReservation') :
it('émet released + confirmed sur le canal club après déplacement', async () => {
  prismaMock.reservation.findUnique.mockResolvedValue(existing() as any);
  mockTarget();
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.reservation.count.mockResolvedValue(0 as any);
  prismaMock.reservation.update.mockResolvedValue({
    id: 'res-1', resourceId: 'court-2',
    startTime: new Date('2026-06-16T16:00:00.000Z'), endTime: new Date('2026-06-16T17:30:00.000Z'),
  } as any);

  await service.adminRescheduleReservation(reschedule);

  expect(mockBroadcastClub).toHaveBeenCalledWith('club-demo', expect.objectContaining({ type: 'slot_released' }));
  expect(mockBroadcastClub).toHaveBeenCalledWith('club-demo', expect.objectContaining({ type: 'slot_confirmed' }));
});
```

Dans `reservation.series.test.ts` (mêmes fixtures que les tests « invalide le cache » du fichier) :

```ts
// Dans describe('ReservationService.adminCreateSeries') :
it('émet slot_confirmed sur le canal club pour chaque occurrence créée', async () => {
  prismaMock.reservation.count.mockResolvedValue(0 as any);

  await service.adminCreateSeries({
    clubId: 'club-demo', resourceId: 'res1', type: 'COACHING',
    weekday: 2, startLocal: '18:00', durationMin: 90,
    startDate: '2026-06-02', endDate: '2026-06-16',
  });

  expect(mockBroadcastClub).toHaveBeenCalledTimes(3); // 3 occurrences
  expect(mockBroadcastClub).toHaveBeenCalledWith('club-demo', expect.objectContaining({ type: 'slot_confirmed' }));
});

// Dans describe('ReservationService.adminCancelSeries') :
it("émet slot_released sur le canal club à l'annulation d'une série", async () => {
  prismaMock.reservationSeries.findUnique.mockResolvedValue({ id: 'ser1', clubId: 'club-demo' } as any);
  prismaMock.reservation.findMany.mockResolvedValue([
    { id: 'r1', resourceId: 'res1', startTime: new Date('2999-01-01T10:00:00Z'), endTime: new Date('2999-01-01T11:00:00Z') },
  ] as any);
  prismaMock.reservation.updateMany.mockResolvedValue({ count: 1 } as any);
  prismaMock.reservationSeries.update.mockResolvedValue({ id: 'ser1' } as any);

  await service.adminCancelSeries('ser1', 'club-demo');

  expect(mockBroadcastClub).toHaveBeenCalledWith('club-demo', expect.objectContaining({ type: 'slot_released', reservationId: 'r1' }));
});
```

Dans `cleanup.job.test.ts`, étendre le test existant « annule les PENDING expirés… » avec :

```ts
expect(mockBroadcastClub).toHaveBeenCalledWith('club-a', expect.objectContaining({ type: 'slot_released', reservationId: 'r1' }));
expect(mockBroadcastClub).toHaveBeenCalledWith('club-a', expect.objectContaining({ type: 'slot_released', reservationId: 'r2' }));
```

- [ ] **Step 3 : Vérifier le RED**

Run: `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/reservation.service.test.ts src/services/__tests__/reservation.series.test.ts src/jobs/__tests__/cleanup.job.test.ts`
Expected: FAIL — exactement les 8 nouveaux asserts (`mockBroadcastClub` jamais appelé) ; tout le reste vert.

- [ ] **Step 4 : Implémenter (GREEN)** — dans `reservation.service.ts`, ajouter un helper privé (près de `performCancel`) :

```ts
  /**
   * Publication d'un changement de disponibilité : purge du micro-cache PUIS
   * émission de l'événement — par terrain (page /courts/[id]) ET par club
   * (grille Réserver en direct). L'ordre invalidation → broadcast est un
   * invariant : un client qui refetch en réaction doit trouver le cache frais.
   */
  private publishSlotChange(clubId: string, resourceId: string, event: SSEEvent): void {
    invalidateClubAvailability(clubId);
    const sse = SSEService.getInstance();
    sse.broadcast(resourceId, event);
    sse.broadcastClub(clubId, event);
  }
```

(importer le type : `import { SSEService, SSEEvent } from './sse.service';` — `SSEEvent` est déjà exporté).

Puis remplacer, à CHAQUE site, la paire `invalidateClubAvailability(...)` + `SSEService.getInstance().broadcast(...)` par un appel unique. Les 8 sites, avec l'événement construit en variable :

1. **holdSlot** (~l.305) :
```ts
      this.publishSlotChange(resource.clubId, resourceId, {
        type: 'slot_held',
        resourceId,
        reservationId: reservation.id,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        expiresAt: new Date(Date.now() + HOLD_EXPIRY_MS).toISOString(),
      });
```
2. **confirmReservation** (~l.663, après `redis.del`) :
```ts
    this.publishSlotChange(reservation.resource.clubId, confirmed.resourceId, {
      type: 'slot_confirmed',
      resourceId:    confirmed.resourceId,
      reservationId: confirmed.id,
      startTime:     confirmed.startTime.toISOString(),
      endTime:       confirmed.endTime.toISOString(),
    });
```
(reprendre les champs EXACTS de l'événement actuellement construit à cet endroit — ne rien renommer).
3. **performCancel** : idem avec `reservation.resource.clubId` et l'événement `slot_released` existant.
4. **adminCreateReservation** : `this.publishSlotChange(clubId, resourceId, { ...événement slot_confirmed existant });`
5. **adminRescheduleReservation** : DEUX appels (released sur l'ancien terrain, confirmed sur le nouveau) — l'invalidation double est inoffensive :
```ts
    this.publishSlotChange(clubId, reservation.resourceId, { ...événement slot_released existant });
    this.publishSlotChange(clubId, resourceId, { ...événement slot_confirmed existant });
```
6. **adminCreateSeries** (boucle) : `this.publishSlotChange(params.clubId, params.resourceId, {...});` par occurrence ; SUPPRIMER le `if (createdList.length > 0) invalidateClubAvailability(params.clubId);` devenu redondant.
7. **adminCancelSeries** (boucle) : `this.publishSlotChange(series.clubId, r.resourceId, {...});` par occurrence ; SUPPRIMER le `if (future.length > 0) invalidateClubAvailability(series.clubId);` redondant.
8. **cleanup.job.ts** `releaseExpiredHolds` (hors classe — inline) : dans la boucle `Promise.all`, remplacer le broadcast par :
```ts
      const event = {
        type:          'slot_released' as const,
        resourceId:    r.resourceId,
        reservationId: r.id,
        startTime:     r.startTime.toISOString(),
        endTime:       r.endTime.toISOString(),
      };
      SSEService.getInstance().broadcast(r.resourceId, event);
      SSEService.getInstance().broadcastClub(r.resource.clubId, event);
```
et GARDER la boucle d'invalidation dédupliquée existante (`for (const clubId of new Set(...)) invalidateClubAvailability(clubId);`) mais la DÉPLACER AVANT le `Promise.all` (invariant invalidation → broadcast).

- [ ] **Step 5 : Vérifier le GREEN**

Run: `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/reservation.service.test.ts src/services/__tests__/reservation.series.test.ts src/jobs/__tests__/cleanup.job.test.ts`
Expected: PASS intégral (les anciens tests broadcast/invalidation restent verts — le helper appelle les mêmes fonctions avec les mêmes arguments).

- [ ] **Step 6 : Type-check + commit**

Run: `cd backend; node node_modules/typescript/bin/tsc --noEmit` → aucun résultat.

```bash
git add backend/src/services/reservation.service.ts backend/src/jobs/cleanup.job.ts backend/src/services/__tests__/reservation.service.test.ts backend/src/services/__tests__/reservation.series.test.ts backend/src/jobs/__tests__/cleanup.job.test.ts
git commit -m "feat(backend): emission jumelle des evenements de creneau sur le canal club (publishSlotChange)"
```

---

### Task 4 : Helper pur `applySlotEvent` (patch local du live)

**Files:**
- Create: `frontend/lib/reserveLive.ts`
- Create: `frontend/__tests__/reserveLive.test.ts`

- [ ] **Step 1 : Écrire les tests (RED)**

```ts
// frontend/__tests__/reserveLive.test.ts
import { applySlotEvent, type SlotStreamEvent } from '@/lib/reserveLive';
import type { ClubAvailability } from '@/lib/api';

const slot = (start: string, end: string, available = true) => ({
  startTime: start, endTime: end, available, price: '25.00', offPeak: false,
});
const avail = (): Record<string, ClubAvailability[]> => ({
  'cs-padel': [
    {
      resource: { id: 'r1', name: 'Padel 1' } as any,
      slots: [
        slot('2026-07-19T06:00:00.000Z', '2026-07-19T07:00:00.000Z'),
        slot('2026-07-19T07:00:00.000Z', '2026-07-19T08:00:00.000Z'),
      ],
    },
    {
      resource: { id: 'r2', name: 'Padel 2' } as any,
      slots: [slot('2026-07-19T06:00:00.000Z', '2026-07-19T07:00:00.000Z')],
    },
  ],
});
const ev = (type: SlotStreamEvent['type'], over: Partial<SlotStreamEvent> = {}): SlotStreamEvent => ({
  type, resourceId: 'r1',
  startTime: '2026-07-19T06:00:00.000Z', endTime: '2026-07-19T07:00:00.000Z',
  ...over,
});

describe('applySlotEvent', () => {
  it('slot_held grise le créneau chevauchant du bon terrain, pas les autres', () => {
    const out = applySlotEvent(avail(), ev('slot_held'));
    expect(out.changed).toBe(true);
    expect(out.needsRefetch).toBe(false);
    expect(out.next['cs-padel'][0].slots[0].available).toBe(false); // r1 6h → pris
    expect(out.next['cs-padel'][0].slots[1].available).toBe(true);  // r1 7h intact
    expect(out.next['cs-padel'][1].slots[0].available).toBe(true);  // r2 intact
  });

  it('une résa de 1h30 grise les DEUX créneaux 1h qu\'elle chevauche', () => {
    const out = applySlotEvent(avail(), ev('slot_confirmed', {
      startTime: '2026-07-19T06:30:00.000Z', endTime: '2026-07-19T08:00:00.000Z',
    }));
    expect(out.next['cs-padel'][0].slots[0].available).toBe(false);
    expect(out.next['cs-padel'][0].slots[1].available).toBe(false);
  });

  it('slot_released ne patche PAS mais demande un refetch (créneau peut rester couvert par une autre résa)', () => {
    const base = avail();
    base['cs-padel'][0].slots[0].available = false;
    const out = applySlotEvent(base, ev('slot_released'));
    expect(out.changed).toBe(false);
    expect(out.needsRefetch).toBe(true);
    expect(out.next['cs-padel'][0].slots[0].available).toBe(false); // inchangé
  });

  it('un événement qui ne touche aucun créneau chargé (autre jour/terrain inconnu) est un no-op strict', () => {
    const src = avail();
    const outDay = applySlotEvent(src, ev('slot_released', {
      startTime: '2026-07-20T06:00:00.000Z', endTime: '2026-07-20T07:00:00.000Z',
    }));
    expect(outDay.needsRefetch).toBe(false);
    expect(outDay.next).toBe(src); // même référence : pas de re-render

    const outRes = applySlotEvent(src, ev('slot_held', { resourceId: 'r-inconnu' }));
    expect(outRes.changed).toBe(false);
    expect(outRes.next).toBe(src);
  });

  it('held sur un créneau déjà pris : no-op strict (même référence)', () => {
    const base = avail();
    base['cs-padel'][0].slots[0].available = false;
    const out = applySlotEvent(base, ev('slot_held'));
    expect(out.changed).toBe(false);
    expect(out.next).toBe(base);
  });

  it('connected / événement sans horaires : no-op', () => {
    const src = avail();
    const out = applySlotEvent(src, { type: 'connected', resourceId: '' });
    expect(out.next).toBe(src);
    expect(out.needsRefetch).toBe(false);
  });
});
```

- [ ] **Step 2 : Vérifier le RED**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/reserveLive.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3 : Implémenter (GREEN)**

```ts
// frontend/lib/reserveLive.ts
import type { ClubAvailability } from '@/lib/api';

// Événement du canal SSE club (miroir de SSEEvent backend, champs utiles seulement).
export interface SlotStreamEvent {
  type: 'slot_held' | 'slot_confirmed' | 'slot_released' | 'connected';
  resourceId: string;
  startTime?: string;
  endTime?: string;
}

export interface ApplyResult {
  next: Record<string, ClubAvailability[]>;
  changed: boolean;      // au moins un créneau a flippé (held/confirmed)
  needsRefetch: boolean; // slot_released touchant un créneau chargé → refetch débouncé
}

/**
 * Patch local d'un événement de créneau sur l'état `availBySport` de la page Réserver.
 * - held/confirmed : tout créneau CHEVAUCHANT [startTime, endTime) du bon terrain passe
 *   pris — chevauchement, pas égalité (une résa 1h30 bloque les créneaux 1h recouverts).
 *   Patch sûr sans connaître les autres résas : une résa active chevauchante suffit.
 * - released : PAS de patch local (le créneau peut rester couvert par une autre résa
 *   que le client ne connaît pas) → needsRefetch, le parent refetch débouncé (le cache
 *   serveur est invalidé AVANT le broadcast, le refetch obtient l'état frais).
 * - Un événement qui ne chevauche aucun créneau chargé (autre jour, terrain absent)
 *   est un no-op strict : même référence renvoyée, aucun re-render.
 */
export function applySlotEvent(
  avail: Record<string, ClubAvailability[]>,
  ev: SlotStreamEvent,
): ApplyResult {
  if (!ev.startTime || !ev.endTime || ev.type === 'connected') {
    return { next: avail, changed: false, needsRefetch: false };
  }
  const evStart = new Date(ev.startTime).getTime();
  const evEnd = new Date(ev.endTime).getTime();
  const overlaps = (s: { startTime: string; endTime: string }) =>
    new Date(s.startTime).getTime() < evEnd && new Date(s.endTime).getTime() > evStart;

  if (ev.type === 'slot_released') {
    const touches = Object.values(avail).some((list) =>
      list.some((a) => a.resource.id === ev.resourceId && a.slots.some(overlaps)));
    return { next: avail, changed: false, needsRefetch: touches };
  }

  // slot_held / slot_confirmed → créneaux chevauchants pris.
  let changed = false;
  const next: Record<string, ClubAvailability[]> = {};
  for (const [sportId, list] of Object.entries(avail)) {
    let listChanged = false;
    const newList = list.map((a) => {
      if (a.resource.id !== ev.resourceId) return a;
      let slotChanged = false;
      const slots = a.slots.map((s) => {
        if (!s.available || !overlaps(s)) return s;
        slotChanged = true;
        return { ...s, available: false };
      });
      if (!slotChanged) return a;
      listChanged = true;
      return { ...a, slots };
    });
    next[sportId] = listChanged ? newList : list;
    if (listChanged) changed = true;
  }
  return changed
    ? { next, changed: true, needsRefetch: false }
    : { next: avail, changed: false, needsRefetch: false };
}
```

- [ ] **Step 4 : Vérifier le GREEN**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/reserveLive.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/reserveLive.ts frontend/__tests__/reserveLive.test.ts
git commit -m "feat(frontend): applySlotEvent - patch local pur des evenements de creneau"
```

---

### Task 5 : Helpers purs `nextOpening` + `formatCountdown` (rendez-vous)

**Files:**
- Modify: `frontend/lib/bookingWindow.ts` (ajouter à la fin ; réutilise les helpers privés du fichier `dayKeyInTz`, `minutesInTz`, `addDaysToKey` — vérifier leurs noms exacts en tête de fichier avant d'écrire)
- Modify: `frontend/__tests__/bookingWindow.test.ts` (nouveau bloc describe)

- [ ] **Step 1 : Écrire les tests (RED)** — ajouter à la fin du fichier de test existant :

```ts
import { nextOpening, formatCountdown } from '@/lib/bookingWindow';

describe('nextOpening (rendez-vous d\'ouverture)', () => {
  const tz = 'Europe/Paris';

  it('DAY_AT_HOUR H=0 avant minuit : ouvre au prochain minuit local, jour = aujourd\'hui + W', () => {
    // 2026-07-18 23:30 Paris (été, UTC+2) = 21:30 UTC
    const now = new Date('2026-07-18T21:30:00.000Z');
    const o = nextOpening(now, tz, 7, 'DAY_AT_HOUR', 0)!;
    // prochain minuit local = 2026-07-19T00:00 Paris = 18T22:00Z
    expect(o.opensAtMs).toBe(new Date('2026-07-18T22:00:00.000Z').getTime());
    expect(o.dayKey).toBe('2026-07-26'); // 19 juillet + 7 jours
  });

  it('DAY_AT_HOUR H=8 : à 7h59 ouvre à 8h du même jour ; à 8h01 ouvre demain 8h', () => {
    const before = nextOpening(new Date('2026-07-18T05:59:00.000Z'), tz, 7, 'DAY_AT_HOUR', 8)!; // 07:59 Paris
    expect(before.opensAtMs).toBe(new Date('2026-07-18T06:00:00.000Z').getTime()); // 08:00 Paris
    expect(before.dayKey).toBe('2026-07-25');

    const after = nextOpening(new Date('2026-07-18T06:01:00.000Z'), tz, 7, 'DAY_AT_HOUR', 8)!; // 08:01 Paris
    expect(after.opensAtMs).toBe(new Date('2026-07-19T06:00:00.000Z').getTime()); // demain 08:00
    expect(after.dayKey).toBe('2026-07-26');
  });

  it('WINDOW_SHIFT : bascule au prochain minuit local', () => {
    const o = nextOpening(new Date('2026-07-18T10:00:00.000Z'), tz, 14, 'WINDOW_SHIFT', 12)!;
    expect(o.opensAtMs).toBe(new Date('2026-07-18T22:00:00.000Z').getTime()); // minuit Paris
    expect(o.dayKey).toBe('2026-08-02'); // 19 juillet + 14
  });

  it('ROLLING_SLOT (fenêtre glissante continue) : pas de rendez-vous', () => {
    expect(nextOpening(new Date(), tz, 7, 'ROLLING_SLOT', 0)).toBeNull();
  });

  it('fenêtre de 0 jour : pas de rendez-vous', () => {
    expect(nextOpening(new Date(), tz, 0, 'DAY_AT_HOUR', 0)).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('format hh:mm:ss au-delà d\'une heure, mm:ss en dessous', () => {
    expect(formatCountdown(3 * 3600_000 + 12 * 60_000 + 45_000)).toBe('03:12:45');
    expect(formatCountdown(12 * 60_000 + 5_000)).toBe('12:05');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-500)).toBe('00:00');
  });
});
```

- [ ] **Step 2 : Vérifier le RED**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/bookingWindow.test.ts`
Expected: FAIL — `nextOpening` non exporté ; les tests existants du fichier restent verts.

- [ ] **Step 3 : Implémenter (GREEN)** — ajouter à la fin de `frontend/lib/bookingWindow.ts` :

```ts
export interface NextOpening {
  opensAtMs: number; // instant de la prochaine bascule de fenêtre
  dayKey: string;    // jour 'YYYY-MM-DD' qui devient réservable à cet instant
}

/** Prochain instant local à HH:00 (tz du club), corrigé des bascules DST. */
function nextLocalInstantAtHour(now: Date, tz: string, H: number): number {
  const target = H * 60;
  let deltaMin = target - minutesInTz(now, tz);
  if (deltaMin <= 0) deltaMin += 1440;
  let t = now.getTime() + deltaMin * 60_000;
  // Correction DST : si l'heure locale atteinte n'est pas H:00 pile, ajuste de
  // l'écart constaté (normalisé sur [-12h, +12h] pour gérer le tour de minuit).
  let miss = target - minutesInTz(new Date(t), tz);
  if (miss > 720) miss -= 1440;
  if (miss < -720) miss += 1440;
  return t + miss * 60_000;
}

/**
 * Rendez-vous d'ouverture de la fenêtre de réservation — miroir de `bookingWindow`
 * ci-dessus : le prochain instant où un NOUVEAU jour devient réservable, et lequel.
 * ROLLING_SLOT (glissement continu, pas de bascule) et fenêtre nulle → null.
 * La fenêtre est celle DU JOUEUR : l'appelant passe les valeurs membre ou public.
 */
export function nextOpening(
  now: Date, tz: string, windowDays: number, mode: BookingReleaseMode, releaseHour: number,
): NextOpening | null {
  const W = Math.max(0, Math.trunc(windowDays || 0));
  const H = Math.min(23, Math.max(0, Math.trunc(releaseHour || 0)));
  if (mode === 'ROLLING_SLOT' || W === 0) return null;
  // DAY_AT_HOUR : bascule à la prochaine occurrence de H heure locale.
  // WINDOW_SHIFT : le max avance au changement de jour → bascule au prochain minuit local.
  const opensAtMs = nextLocalInstantAtHour(now, tz, mode === 'WINDOW_SHIFT' ? 0 : H);
  return { opensAtMs, dayKey: addDaysToKey(dayKeyInTz(new Date(opensAtMs), tz), W) };
}

/** 'hh:mm:ss' au-delà d'une heure, 'mm:ss' sinon — pour le compte à rebours. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}
```

⚠️ Si les helpers privés du fichier s'appellent autrement que `minutesInTz`/`dayKeyInTz`/`addDaysToKey`, reprendre les noms réels — NE PAS les dupliquer.

- [ ] **Step 4 : Vérifier le GREEN**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/bookingWindow.test.ts`
Expected: PASS intégral (anciens + nouveaux).

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/bookingWindow.ts frontend/__tests__/bookingWindow.test.ts
git commit -m "feat(frontend): nextOpening + formatCountdown - rendez-vous d'ouverture de la fenetre"
```

---

### Task 6 : Composants `LiveDot` + `OpeningCountdown` + URL du flux

**Files:**
- Create: `frontend/components/reserve/LiveDot.tsx`
- Create: `frontend/components/reserve/OpeningCountdown.tsx`
- Create: `frontend/__tests__/OpeningCountdown.test.tsx`
- Modify: `frontend/lib/api.ts` (à côté de `notificationsStreamUrl`, ~ligne 2956)

- [ ] **Step 1 : Test du composant countdown (RED)**

```tsx
// frontend/__tests__/OpeningCountdown.test.tsx
import { render, screen } from '@testing-library/react';
import { OpeningPanel, OpeningBanner } from '@/components/reserve/OpeningCountdown';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: new Proxy({}, { get: (_t, p) => (typeof p === 'string' && p === 'mode' ? 'light' : '#000') }) }),
}));

describe('OpeningCountdown', () => {
  const opensAt = new Date('2026-07-18T22:00:00.000Z').getTime();

  it('OpeningPanel affiche le jour, le compte à rebours et la promesse d\'apparition auto', () => {
    render(<OpeningPanel dayLabel="samedi 19 juillet" opensAtMs={opensAt} nowMs={opensAt - (3 * 3600_000 + 12 * 60_000 + 45_000)} />);
    expect(screen.getByText(/samedi 19 juillet/)).toBeInTheDocument();
    expect(screen.getByText('03:12:45')).toBeInTheDocument();
    expect(screen.getByText(/apparaîtront ici automatiquement/i)).toBeInTheDocument();
  });

  it('OpeningBanner (compte à rebours court) affiche mm:ss', () => {
    render(<OpeningBanner dayLabel="samedi 19 juillet" opensAtMs={opensAt} nowMs={opensAt - 125_000} />);
    expect(screen.getByText(/02:05/)).toBeInTheDocument();
  });

  it('OpeningBanner variante « ouvert » : bouton qui remonte onGoToDay', () => {
    const go = jest.fn();
    render(<OpeningBanner dayLabel="samedi 19 juillet" opensAtMs={opensAt} nowMs={opensAt + 1000} onGoToDay={go} />);
    screen.getByRole('button', { name: /sont ouverts/i }).click();
    expect(go).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Vérifier le RED**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpeningCountdown.test.tsx`
Expected: FAIL — module absent.

- [ ] **Step 3 : Implémenter (GREEN)** — composants purs (le timer vit dans ClubReserve, qui passe `nowMs`) :

```tsx
// frontend/components/reserve/OpeningCountdown.tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { formatCountdown } from '@/lib/bookingWindow';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';

// Panneau plein cadre affiché À LA PLACE de la grille quand le joueur a sélectionné
// le jour verrouillé 🔒 : le rendez-vous remplace l'attente anxieuse (brume bleue,
// jamais de panneau sombre — préférence design du repo).
export function OpeningPanel({ dayLabel, opensAtMs, nowMs }: {
  dayLabel: string; opensAtMs: number; nowMs: number;
}) {
  const { th } = useTheme();
  return (
    <div style={{
      background: HERO_GRADIENT, borderRadius: 18, padding: '34px 22px', textAlign: 'center',
      fontFamily: th.fontUI,
    }}>
      <div style={{ fontSize: 14, color: HERO_INK_MUTED, marginBottom: 6 }}>
        Les créneaux du <strong style={{ color: HERO_INK }}>{dayLabel}</strong> ouvrent dans
      </div>
      <div aria-live="off" style={{ fontFamily: th.fontDisplay, fontSize: 44, fontWeight: 700, color: HERO_INK, letterSpacing: 1 }}>
        {formatCountdown(opensAtMs - nowMs)}
      </div>
      <div style={{ fontSize: 13, color: HERO_INK_MUTED, marginTop: 8 }}>
        Ils apparaîtront ici automatiquement — inutile de rafraîchir la page.
      </div>
    </div>
  );
}

// Bandeau discret au-dessus de la grille quand l'ouverture est < 1 h (ou vient d'avoir
// lieu : variante « ouvert » avec bouton). `onGoToDay` absent = pas encore ouvert.
export function OpeningBanner({ dayLabel, opensAtMs, nowMs, onGoToDay }: {
  dayLabel: string; opensAtMs: number; nowMs: number; onGoToDay?: () => void;
}) {
  const { th } = useTheme();
  const opened = nowMs >= opensAtMs;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      background: th.surface2, borderRadius: 12, padding: '9px 13px', marginBottom: 12,
      fontFamily: th.fontUI, fontSize: 13, color: th.textMute,
    }}>
      {opened && onGoToDay ? (
        <button type="button" onClick={onGoToDay} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.accent,
        }}>
          Les créneaux du {dayLabel} sont ouverts →
        </button>
      ) : (
        <>
          <span aria-hidden>⏱</span>
          <span>Ouverture des créneaux du <strong style={{ color: th.text }}>{dayLabel}</strong> dans</span>
          <span style={{ fontFamily: th.fontMono, fontWeight: 700, color: th.text }}>{formatCountdown(opensAtMs - nowMs)}</span>
        </>
      )}
    </div>
  );
}
```

```tsx
// frontend/components/reserve/LiveDot.tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';

// Pastille « la grille vit toute seule » : point accent qui pulse. En coupure,
// EventSource se reconnecte nativement → « Reconnexion… » (jamais d'état figé muet).
export function LiveDot({ status }: { status: 'live' | 'reconnecting' }) {
  const { th } = useTheme();
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: th.fontUI, fontSize: 12, color: th.textMute, whiteSpace: 'nowrap',
    }}>
      <style>{`@keyframes pl-live-pulse{0%,100%{opacity:1}50%{opacity:.35}}
        @media (prefers-reduced-motion: reduce){.pl-live-dot{animation:none !important}}`}</style>
      <span className="pl-live-dot" aria-hidden style={{
        width: 7, height: 7, borderRadius: '50%',
        background: status === 'live' ? th.accent : th.textFaint,
        animation: status === 'live' ? 'pl-live-pulse 2s ease-in-out infinite' : 'none',
      }} />
      {status === 'live' ? 'En direct' : 'Reconnexion…'}
    </span>
  );
}
```

Dans `frontend/lib/api.ts`, à côté des autres helpers `*StreamUrl` :

```ts
/** Flux SSE public des disponibilités d'un club (grille Réserver en direct). */
export function clubAvailabilityStreamUrl(slug: string): string {
  return `${BASE_URL}/api/clubs/${slug}/availability/stream`;
}
```

- [ ] **Step 4 : Vérifier le GREEN**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpeningCountdown.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/reserve/LiveDot.tsx frontend/components/reserve/OpeningCountdown.tsx frontend/__tests__/OpeningCountdown.test.tsx frontend/lib/api.ts
git commit -m "feat(frontend): LiveDot, OpeningPanel/OpeningBanner et clubAvailabilityStreamUrl"
```

---

### Task 7 : Jour verrouillé 🔒 dans DateSelector

**Files:**
- Modify: `frontend/components/DateSelector.tsx`
- Create: `frontend/__tests__/DateSelector.locked.test.tsx`

- [ ] **Step 1 : Tests (RED)**

```tsx
// frontend/__tests__/DateSelector.locked.test.tsx
import { render, screen } from '@testing-library/react';
import DateSelector from '@/components/DateSelector';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: new Proxy({}, { get: (_t, p) => (typeof p === 'string' && p === 'neon' ? false : '#000') }) }),
}));

function keyPlus(days: number): string {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('DateSelector — jour verrouillé', () => {
  it('rend le jour verrouillé cliquable avec un cadenas, et remonte onSelectLocked', () => {
    const onLocked = jest.fn();
    render(<DateSelector value={keyPlus(0)} onChange={() => {}} maxKey={keyPlus(6)} lockedKey={keyPlus(7)} onSelectLocked={onLocked} />);

    const locked = screen.getByRole('button', { name: /ouvre bientôt/i });
    expect(locked).not.toBeDisabled();
    locked.click();
    expect(onLocked).toHaveBeenCalled();
  });

  it('sans lockedKey : comportement inchangé (les jours au-delà de maxKey sont désactivés)', () => {
    render(<DateSelector value={keyPlus(0)} onChange={() => {}} maxKey={keyPlus(6)} days={8} />);
    expect(screen.queryByRole('button', { name: /ouvre bientôt/i })).toBeNull();
  });
});
```

- [ ] **Step 2 : Vérifier le RED**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DateSelector.locked.test.tsx`
Expected: FAIL — pas de bouton « ouvre bientôt ».

- [ ] **Step 3 : Implémenter (GREEN)** — modifications de `DateSelector.tsx` :

1. Props :
```ts
  /** Jour « bientôt ouvert » (cadenas 🔒, cliquable) affiché APRÈS maxKey. Optionnel. */
  lockedKey?: string;
  /** Tap sur le jour verrouillé (affiche le compte à rebours côté parent). */
  onSelectLocked?: () => void;
```
(et les déstructurer dans la signature du composant).

2. Étendre la bande pour couvrir le jour verrouillé — remplacer le calcul de `windowDays` :
```ts
  const lastKey = lockedKey && (!maxKey || lockedKey > maxKey) ? lockedKey : maxKey;
  const windowDays = lastKey ? Math.round((keyToDate(lastKey).getTime() - today.getTime()) / MS_PER_DAY) + 1 : 0;
```

3. Dans le `list.map`, avant `const disabled = ...` :
```ts
          const isLocked = lockedKey === key;
```
puis adapter :
```ts
          const disabled = isPast || (tooFar && !isLocked);
```
et sur le `<button>` : `onClick={() => { if (isLocked) { onSelectLocked?.(); return; } if (!disabled) onChange(key); }}`, `aria-label={isLocked ? `${WEEKDAYS[d.getDay()]} ${d.getDate()} (ouvre bientôt)` : `${WEEKDAYS[d.getDay()]} ${d.getDate()}`}`, `aria-pressed={isSel}` inchangé. Style : quand `isLocked`, garder `opacity: 0.75` (ni grisé comme un désactivé, ni plein comme un ouvert) et remplacer le point apricot du bas par un cadenas :
```tsx
              {isLocked
                ? <span aria-hidden style={{ fontSize: 10, lineHeight: '5px' }}>🔒</span>
                : <span style={{ /* pastille point existante inchangée */ }} />}
```

- [ ] **Step 4 : Vérifier le GREEN + non-régression**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DateSelector.locked.test.tsx`
Expected: PASS. Puis `node node_modules/jest/bin/jest.js -t "DateSelector"` pour toute suite existante du composant.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/DateSelector.tsx frontend/__tests__/DateSelector.locked.test.tsx
git commit -m "feat(frontend): jour verrouille cliquable (cadenas) dans DateSelector"
```

---

### Task 8 : Stub EventSource global + mocks api des suites existantes

ClubReserve va ouvrir une EventSource au montage : **toutes** les suites qui montent ClubReserve casseraient (jsdom n'a pas EventSource ; leurs mocks `@/lib/api` n'exportent pas `clubAvailabilityStreamUrl`). On prépare le terrain AVANT de câbler (mémoire « ClubNav real-mount test suites » : c'est le piège récurrent du repo).

**Files:**
- Modify: `frontend/jest.setup.ts`
- Modify: `frontend/__tests__/ClubReserve.alerts.test.tsx`, `ClubReserve.balances.test.tsx`, `ClubReserve.deeplink.test.tsx`, `ClubReserve.error.test.tsx`, `ClubReserve.pastslots.test.tsx`, `ClubReserve.persport.test.tsx`, `ClubReserve.view.test.tsx`

- [ ] **Step 1 : Stub EventSource inerte dans `jest.setup.ts`** (à côté des stubs IntersectionObserver/ResizeObserver/matchMedia existants) :

```ts
// jsdom n'implémente pas EventSource. Stub inerte pour les composants qui ouvrent
// un flux SSE au montage (ClubReserve…) ; les suites qui testent le flux lui-même
// (chat, live) définissent leur propre fake par-dessus.
if (typeof (global as any).EventSource === 'undefined') {
  class EventSourceStub {
    onmessage: unknown = null;
    onerror: unknown = null;
    onopen: unknown = null;
    close(): void { /* inerte */ }
    addEventListener(): void { /* inerte */ }
    removeEventListener(): void { /* inerte */ }
  }
  (global as any).EventSource = EventSourceStub;
}
```

- [ ] **Step 2 : Ajouter `clubAvailabilityStreamUrl` aux mocks `@/lib/api` des 7 suites** — dans chaque fichier listé, repérer le bloc `jest.mock('@/lib/api', () => ({ ... }))` et ajouter au niveau des exports du module (même niveau que `assetUrl`, PAS dans l'objet `api`) :

```ts
  clubAvailabilityStreamUrl: (slug: string) => `http://test/api/clubs/${slug}/availability/stream`,
```

⚠️ Vérifier par grep qu'aucune autre suite ne monte ClubReserve : `grep -l "ClubReserve" frontend/__tests__/*.tsx` — traiter toute suite supplémentaire trouvée à l'identique.

- [ ] **Step 3 : Vérifier que les 7 suites restent vertes**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubReserve.alerts.test.tsx __tests__/ClubReserve.balances.test.tsx __tests__/ClubReserve.deeplink.test.tsx __tests__/ClubReserve.error.test.tsx __tests__/ClubReserve.pastslots.test.tsx __tests__/ClubReserve.persport.test.tsx __tests__/ClubReserve.view.test.tsx`
Expected: PASS intégral (aucun comportement ne change encore).

- [ ] **Step 4 : Commit**

```bash
git add frontend/jest.setup.ts frontend/__tests__/ClubReserve.*.test.tsx
git commit -m "test(frontend): stub EventSource global + clubAvailabilityStreamUrl dans les mocks ClubReserve"
```

---

### Task 9 : Câblage ClubReserve — grille vivante (flux + patch + pastille)

**Files:**
- Modify: `frontend/components/ClubReserve.tsx`
- Create: `frontend/__tests__/ClubReserve.live.test.tsx`

- [ ] **Step 1 : Tests (RED)** — reprendre le harnais d'une suite real-mount existante (bloc `jest.mock` de `ClubReserve.view.test.tsx` : mêmes mocks `@/lib/api` avec `getClubAvailability` contrôlé, ThemeProvider, useAuth, ClubNav réel avec ses mocks — copier le fichier et adapter). Y ajouter un fake EventSource capturant :

```tsx
// En tête de ClubReserve.live.test.tsx (après les jest.mock copiés) :
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  constructor(url: string) { this.url = url; FakeEventSource.instances.push(this); }
  close() { this.closed = true; }
  emit(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}
beforeEach(() => { FakeEventSource.instances = []; (global as any).EventSource = FakeEventSource; });
```

Cas à couvrir (structure : monter la page comme dans ClubReserve.view, attendre l'affichage des créneaux mockés) :

```tsx
it('ouvre le flux SSE du club et affiche « En direct »', async () => {
  // ... montage standard ...
  await screen.findByText(/En direct/);
  expect(FakeEventSource.instances).toHaveLength(1);
  expect(FakeEventSource.instances[0].url).toContain('/availability/stream');
});

it('slot_held reçu → le créneau passe pris sans aucun refetch', async () => {
  // getClubAvailability mocké : 1 terrain r1, créneau 2026-07-19T06:00Z libre.
  // ... montage, attendre le chip du créneau ...
  const calls = (api.getClubAvailability as jest.Mock).mock.calls.length;
  act(() => FakeEventSource.instances[0].emit({
    type: 'slot_held', resourceId: 'r1',
    startTime: '2026-07-19T06:00:00.000Z', endTime: '2026-07-19T07:00:00.000Z',
  }));
  // Le chip du créneau devient non réservable (même sélecteur que ClubReserve.pastslots
  // pour un créneau pris : bouton désactivé/barré).
  // ... assertion sur le chip ...
  expect((api.getClubAvailability as jest.Mock).mock.calls.length).toBe(calls); // zéro refetch
});

it('slot_released reçu → refetch débouncé de la dispo', async () => {
  jest.useFakeTimers();
  // ... montage ...
  const calls = (api.getClubAvailability as jest.Mock).mock.calls.length;
  act(() => FakeEventSource.instances[0].emit({
    type: 'slot_released', resourceId: 'r1',
    startTime: '2026-07-19T06:00:00.000Z', endTime: '2026-07-19T07:00:00.000Z',
  }));
  act(() => { jest.advanceTimersByTime(600); });
  expect((api.getClubAvailability as jest.Mock).mock.calls.length).toBeGreaterThan(calls);
  jest.useRealTimers();
});

it('erreur de flux → « Reconnexion… », reconnexion → resync + « En direct »', async () => {
  // ... montage ...
  act(() => { FakeEventSource.instances[0].onerror?.(); });
  await screen.findByText(/Reconnexion/);
  const calls = (api.getClubAvailability as jest.Mock).mock.calls.length;
  act(() => { FakeEventSource.instances[0].onopen?.(); });
  await screen.findByText(/En direct/);
  expect((api.getClubAvailability as jest.Mock).mock.calls.length).toBeGreaterThan(calls); // resync
});
```

- [ ] **Step 2 : Vérifier le RED**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubReserve.live.test.tsx`
Expected: FAIL — aucune EventSource ouverte, pas de « En direct ».

- [ ] **Step 3 : Implémenter (GREEN)** — dans `ClubReserve.tsx` :

1. Imports : `import { applySlotEvent, type SlotStreamEvent } from '@/lib/reserveLive';`, `import { LiveDot } from '@/components/reserve/LiveDot';`, ajouter `clubAvailabilityStreamUrl` à l'import `@/lib/api`.

2. État + refs (près des autres états) :
```ts
  // Flux SSE des disponibilités du club : la grille vit toute seule (patch local),
  // le F5 devient inutile. 'reconnecting' = EventSource en re-tentative native.
  const [liveStatus, setLiveStatus] = useState<'live' | 'reconnecting'>('live');
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadAllRef = useRef(reloadAll);
  reloadAllRef.current = reloadAll;
```

3. Effet du flux (après l'effet `reloadAll` existant) :
```ts
  // Une EventSource par onglet sur l'onglet Réserver. Patch local pour held/confirmed ;
  // released → refetch débouncé (le cache serveur, invalidé avant broadcast, est frais).
  // Jamais de onerror→close : reconnexion native, puis resync au retour.
  useEffect(() => {
    if (tab !== 'book') return;
    let wasDown = false;
    const es = new EventSource(clubAvailabilityStreamUrl(club.slug));
    es.onmessage = (msg) => {
      let ev: SlotStreamEvent;
      try { ev = JSON.parse(msg.data); } catch { return; }
      setAvailBySport((prev) => {
        const { next, needsRefetch } = applySlotEvent(prev, ev);
        if (needsRefetch && !refetchTimer.current) {
          refetchTimer.current = setTimeout(() => {
            refetchTimer.current = null;
            reloadAllRef.current();
          }, 500);
        }
        return next;
      });
    };
    es.onerror = () => { wasDown = true; setLiveStatus('reconnecting'); };
    es.onopen = () => {
      setLiveStatus('live');
      if (wasDown) { wasDown = false; reloadAllRef.current(); } // resync post-coupure
    };
    return () => {
      es.close();
      if (refetchTimer.current) { clearTimeout(refetchTimer.current); refetchTimer.current = null; }
    };
  }, [tab, club.slug]);
```

4. Rendu : dans la rangée SportPicker/ViewToggle (repérer le rendu de `<ViewToggle`), insérer `<LiveDot status={liveStatus} />` juste avant le toggle.

5. Animation cartes : sur le style inline des pills de créneau de la vue cartes (repérer le rendu des chips libres/pris dans ClubReserve), s'assurer que `transition` inclut `background .35s ease, box-shadow .35s ease, color .35s ease` (compléter la transition existante si présente). **Ne pas toucher SportGrid.tsx** (WIP autre session — le flip y sera sans animation pour l'instant).

- [ ] **Step 4 : Vérifier le GREEN + non-régression**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubReserve.live.test.tsx` → PASS.
Run: les 7 suites ClubReserve de la Task 8 → PASS (le stub inerte absorbe le flux).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/ClubReserve.tsx frontend/__tests__/ClubReserve.live.test.tsx
git commit -m "feat(frontend): grille Reserver en direct - flux SSE club, patch local, pastille En direct"
```

---

### Task 10 : Câblage ClubReserve — rendez-vous d'ouverture

**Files:**
- Modify: `frontend/components/ClubReserve.tsx`
- Create: `frontend/__tests__/ClubReserve.opening.test.tsx`

- [ ] **Step 1 : Tests (RED)** — même harnais que ClubReserve.live (copier), club mocké avec `bookingReleaseMode: 'DAY_AT_HOUR'`, `publicReleaseHour: 0`, `publicBookingDays: 7`. Cas :

```tsx
it('affiche le jour verrouillé 🔒 et, au tap, le compte à rebours plein cadre', async () => {
  // ... montage ...
  const locked = await screen.findByRole('button', { name: /ouvre bientôt/i });
  act(() => { locked.click(); });
  expect(await screen.findByText(/apparaîtront ici automatiquement/i)).toBeInTheDocument();
});

it('bandeau de compte à rebours quand l\'ouverture est à moins d\'une heure', async () => {
  jest.useFakeTimers({ now: /* instant à 30 min du prochain minuit local Europe/Paris */ });
  // ... montage ...
  expect(await screen.findByText(/Ouverture des créneaux du/i)).toBeInTheDocument();
  jest.useRealTimers();
});

it('à zéro : bascule automatique sur le nouveau jour (jitter mocké) et refetch', async () => {
  jest.useFakeTimers({ now: /* 5 s avant le prochain minuit local */ });
  jest.spyOn(Math, 'random').mockReturnValue(0); // jitter déterministe = 0 ms
  // ... montage, tap sur le jour verrouillé (panneau affiché) ...
  const calls = (api.getClubAvailability as jest.Mock).mock.calls.length;
  act(() => { jest.advanceTimersByTime(6_000); }); // franchit minuit + jitter
  // Le panneau a disparu, la grille du nouveau jour est demandée :
  expect(screen.queryByText(/apparaîtront ici automatiquement/i)).toBeNull();
  expect((api.getClubAvailability as jest.Mock).mock.calls.length).toBeGreaterThan(calls);
  jest.useRealTimers();
});

it('club en ROLLING_SLOT : ni cadenas ni bandeau', async () => {
  // club mocké avec bookingReleaseMode: 'ROLLING_SLOT'
  // ... montage ...
  expect(screen.queryByRole('button', { name: /ouvre bientôt/i })).toBeNull();
  expect(screen.queryByText(/Ouverture des créneaux/i)).toBeNull();
});
```

(Pour les instants « à N min du prochain minuit local », calculer dans le test : `const nextMidnight = new Date(); nextMidnight.setHours(24, 0, 0, 0);` — jsdom tourne en TZ du runner ; fixer la TZ du club mocké à la même valeur que le runner via `timezone: Intl.DateTimeFormat().resolvedOptions().timeZone` pour rendre le test indépendant de la machine.)

- [ ] **Step 2 : Vérifier le RED**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubReserve.opening.test.tsx`
Expected: FAIL — pas de cadenas ni de panneau.

- [ ] **Step 3 : Implémenter (GREEN)** — dans `ClubReserve.tsx` :

1. Imports : `nextOpening` depuis `@/lib/bookingWindow`, `OpeningPanel, OpeningBanner` depuis `@/components/reserve/OpeningCountdown`.

2. États + dérivés (après le calcul de `win`) :
```ts
  // Rendez-vous d'ouverture : prochaine bascule de la fenêtre DU JOUEUR (abonné ou non).
  // clock=null au premier rendu (hydration-safe) ; le timer 1 s ne tourne que si un
  // rendez-vous existe ET est utile (panneau affiché ou ouverture < 1 h).
  const opening = nextOpening(new Date(clock ?? Date.now()), club.timezone, windowDays, club.bookingReleaseMode, releaseHour);
  const [clock, setClock] = useState<number | null>(null);
  const [lockedSelected, setLockedSelected] = useState(false);
  const [justOpenedDay, setJustOpenedDay] = useState<string | null>(null);
```
⚠️ Ordre de déclaration : `clock` AVANT `opening` (le dérivé le lit). Écrire :
```ts
  const [clock, setClock] = useState<number | null>(null);
  const [lockedSelected, setLockedSelected] = useState(false);
  const [justOpenedDay, setJustOpenedDay] = useState<string | null>(null);
  const opening = clock === null
    ? null // avant l'hydratation, pas de rendez-vous affiché (cohérent SSR)
    : nextOpening(new Date(clock), club.timezone, windowDays, club.bookingReleaseMode, releaseHour);
  const bannerVisible = opening !== null && !lockedSelected && opening.opensAtMs - clock! < 3_600_000;
```

3. Horloge (effet) :
```ts
  // Horloge du compte à rebours, posée en effet (jamais de Date.now() au rendu initial).
  useEffect(() => {
    setClock(Date.now());
    const id = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
```

4. Ouverture à zéro (effet) :
```ts
  // Franchissement du rendez-vous : jitter aléatoire 0-3 s (étale la pointe serveur),
  // puis refetch + bascule sur le nouveau jour si le joueur attendait sur le panneau.
  const firedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!opening || clock === null) return;
    if (clock < opening.opensAtMs || firedFor.current === opening.dayKey) return;
    firedFor.current = opening.dayKey;
    const openedDay = opening.dayKey;
    const t = setTimeout(() => {
      reloadAllRef.current();
      setJustOpenedDay(openedDay);
      if (lockedSelected) { setLockedSelected(false); setDate(openedDay); }
    }, Math.round(Math.random() * 3_000));
    return () => clearTimeout(t);
  }, [clock, opening, lockedSelected]);
```

5. Rendu :
- `DateSelector` : ajouter `lockedKey={opening ? opening.dayKey : undefined}` et `onSelectLocked={() => setLockedSelected(true)}` ; quand l'utilisateur choisit une date normale (`onChange`), faire aussi `setLockedSelected(false); setJustOpenedDay(null);`.
- Au-dessus de la grille : `{bannerVisible && <OpeningBanner dayLabel={fmtDayLabel(opening!.dayKey)} opensAtMs={opening!.opensAtMs} nowMs={clock!} />}` et, si `justOpenedDay && !lockedSelected && date !== justOpenedDay`, la variante ouverte : `<OpeningBanner dayLabel={fmtDayLabel(justOpenedDay)} opensAtMs={0} nowMs={1} onGoToDay={() => { setDate(justOpenedDay); setJustOpenedDay(null); }} />`.
- À la place des sections de créneaux quand `lockedSelected && opening` : `<OpeningPanel dayLabel={fmtDayLabel(opening.dayKey)} opensAtMs={opening.opensAtMs} nowMs={clock!} />`.
- Helper local de libellé (dans ClubReserve, à côté de `formatHour`) :
```ts
function fmtDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d));
}
```

- [ ] **Step 4 : Vérifier le GREEN + non-régression complète ClubReserve**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubReserve.opening.test.tsx` → PASS.
Run: `node node_modules/jest/bin/jest.js -t "ClubReserve"` (toutes suites) → PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/ClubReserve.tsx frontend/__tests__/ClubReserve.opening.test.tsx
git commit -m "feat(frontend): rendez-vous d'ouverture - jour verrouille, compte a rebours, ouverture auto avec jitter"
```

---

### Task 11 : Vérification finale, CLAUDE.md, suites complètes

**Files:**
- Modify: `CLAUDE.md` (paragraphe d'évolution sous la section « Perfs rush de minuit (2026-07-18) »)

- [ ] **Step 1 : Type-check des deux côtés**

Run: `cd backend; node node_modules/typescript/bin/tsc --noEmit` → rien.
Run: `cd frontend; node node_modules/typescript/bin/tsc --noEmit` → rien (scoper au grep des fichiers touchés si du WIP parallèle pollue — mémoire « Frontend jest doesn't type-check »).

- [ ] **Step 2 : Suites complètes**

Run: `cd backend; node node_modules/jest/bin/jest.js` → seuls les 5 échecs `icon.routes` (baseline worktree).
Run: `cd frontend; node node_modules/jest/bin/jest.js` → vert, au flake BookingModal près (baseline connue : ~6 échecs full-suite qui passent en isolation — mémoire « Frontend full-suite BookingModal flake » ; vérifier en relançant les suites BookingModal seules).

- [ ] **Step 3 : Ajouter l'évolution à CLAUDE.md** — sous le bloc « Perfs rush de minuit (2026-07-18) », ajouter :

```markdown
> **Évolution (2026-07-XX) — Réserver en temps réel + rendez-vous d'ouverture (correctifs 5-6 de l'audit) :** 5ᵉ canal SSE **par club** (`SSEService.addClubClient`/`broadcastClub`, route publique `GET /:slug/availability/stream`) — émission jumelle des événements de créneau via le helper **`publishSlotChange`** de `ReservationService` (invalidation du cache TOUJOURS avant broadcast, invariant) + le job cleanup. Front : `ClubReserve` ouvre UNE EventSource par onglet, **patch local pur** `applySlotEvent` (`lib/reserveLive.ts`) pour `slot_held/confirmed` (règle de chevauchement), **refetch débouncé 500 ms** pour `slot_released` (le client ne peut pas déduire seul la libération d'un créneau couvert par plusieurs résas), pastille `LiveDot` « ● En direct / Reconnexion… » (resync par `reloadAll` au retour), transition CSS du flip (cartes seulement — SportGrid était en WIP lot C). **Rendez-vous d'ouverture** : `nextOpening`/`formatCountdown` (`lib/bookingWindow.ts`, DAY_AT_HOUR = prochaine occurrence du releaseHour local, WINDOW_SHIFT = prochain minuit, **ROLLING_SLOT/W=0 → null** = pas de rendez-vous), jour verrouillé 🔒 cliquable dans `DateSelector` (`lockedKey`/`onSelectLocked`), panneau compte à rebours plein cadre (`OpeningPanel`, brume bleue) + bandeau < 1 h (`OpeningBanner`), **ouverture auto avec jitter 0-3 s** + bascule sur le nouveau jour. ⚠️ jsdom : stub `EventSource` global ajouté à `jest.setup.ts` (inerte, écrasable par les fakes locaux) ; tout mock `@/lib/api` d'une suite montant ClubReserve doit exporter `clubAvailabilityStreamUrl`. Spec & plan : `docs/superpowers/{specs,plans}/2026-07-18-reserver-temps-reel-minuit*`.
```
(remplacer 2026-07-XX par la date du jour de l'exécution).

- [ ] **Step 4 : Commit final**

```bash
git add CLAUDE.md
git commit -m "docs: evolution CLAUDE.md - Reserver temps reel + rendez-vous d'ouverture"
```

- [ ] **Step 5 : Vérification visuelle (avec Eric)** — lancer la stack dev (`start.ps1`), ouvrir `padel-arena-paris.localhost:3000/reserver` dans deux navigateurs : un hold dans l'un doit griser le créneau dans l'autre en < 1 s ; pastille « En direct » visible ; simuler l'ouverture en avançant l'horloge du club de test ou en réglant `publicReleaseHour`. Vérifier clair + sombre, desktop 1280 + mobile 390 (`mobile:false` pour attraper un débordement — mémoire dédiée).

---

## Self-review (fait à l'écriture)

- **Couverture spec** : canal club (T1), route (T2), émission jumelle + invariant ordre (T3), patch local/chevauchement/released-refetch (T4, T9), pastille + reconnexion/resync (T6, T9), nextOpening 3 modes + fenêtre par joueur (T5), cadenas + panneau + bandeau + jitter + bascule (T7, T10), hors périmètre respecté (SportGrid non touché), tests listés (T1-T10), CLAUDE.md (T11). Pas d'écart identifié.
- **Placeholders** : les « … montage standard … » des suites ClubReserve renvoient à un harnais EXISTANT à copier (fichier nommé : `ClubReserve.view.test.tsx`) — pointeur exact, pas un TBD.
- **Cohérence des noms** : `addClubClient`/`broadcastClub` (T1→T2→T3), `publishSlotChange` (T3), `applySlotEvent`/`SlotStreamEvent` (T4→T9), `nextOpening`/`formatCountdown` (T5→T6→T10), `lockedKey`/`onSelectLocked` (T7→T10), `clubAvailabilityStreamUrl` (T6→T8→T9) — vérifiés identiques.
