# Notifications — Lot 1 : socle + cloche in-app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire le socle du système de notifications — modèle de données, dispatcher multi-canal (cloche in-app + email), flux SSE par-utilisateur, API, cloche front + page liste + écran de préférences — et migrer la **famille « parties ouvertes »** des emails vers ce dispatcher pour prouver le pipeline de bout en bout, sans double envoi.

**Architecture :** Un dispatcher unique `dispatch()` (best-effort, appelé après commit) crée une ligne `Notification` (source de vérité = cloche), la pousse en live via SSE, et envoie l'email si le canal est activé dans les préférences du destinataire. Résolution des préférences = fonction pure (défaut ON / opt-out, `CLUB_MESSAGES`+`INAPP` verrouillé). Push **hors Lot 1** (le canal existe dans l'enum mais reste inactif, aucun abonnement).

**Tech Stack :** Express 5, Prisma 7 (PostgreSQL), SSE (service existant généralisé), Next.js 16 / React 19, Jest + supertest (back), React Testing Library (front).

**Spec :** `docs/superpowers/specs/2026-06-23-notifications-design.md`. Ce lot couvre les sections 3, 4, 5, 6 (famille parties ouvertes), 7.1, 7.2, 9, 11, 12 (partiel).

**Conventions du repo à respecter :**
- Prisma 7 : le client passe par l'adapter `PrismaPg` (`src/db/prisma.ts`) — ne jamais instancier `new PrismaClient()` nu.
- Tests back : `import '../../__mocks__/prisma'` + `prismaMock`, token via `jwt.sign({ id, email }, process.env.JWT_SECRET!, …)`, `supertest(app)`.
- Best-effort des notifications : un échec de canal ne lève jamais et ne casse jamais l'action déclenchante (pattern `safeNotify` existant).
- Front : styles inline avec les tokens `th` de `useTheme()`, token d'auth via `useAuth()`.

---

## File Structure

**Backend**
- `prisma/schema.prisma` — *modifier* : enums `NotificationCategory`/`NotificationChannel`, modèles `Notification`/`NotificationPreference`, relations `User`.
- `src/services/notification/preferences.ts` — *créer* : résolution pure des canaux.
- `src/services/notification/dispatcher.ts` — *créer* : `dispatch()` (fan-out in-app + email + SSE).
- `src/services/sse.service.ts` — *modifier* : canal par-utilisateur (`addUserClient`/`notifyUser`).
- `src/routes/notifications.ts` — *créer* : endpoints `/api/me/notifications*` + préférences + stream.
- `src/app.ts` — *modifier* : monter le routeur.

**Frontend**
- `frontend/lib/api.ts` — *modifier* : méthodes + types notifications.
- `frontend/lib/notifications.ts` — *créer* : métadonnées catégories/canaux + résolution miroir.
- `frontend/components/notifications/NotificationBell.tsx` — *créer* : cloche + panneau + live SSE.
- `frontend/components/ClubNav.tsx` — *modifier* : insérer la cloche à côté de `ProfileMenu`.
- `frontend/app/me/notifications/page.tsx` — *créer* : liste complète.
- `frontend/app/me/notifications/settings/page.tsx` — *créer* : grille de préférences.

---

## Task 1 : Modèle de données + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create (généré) : `prisma/migrations/*_add_notifications/`

- [ ] **Step 1 : Ajouter enums + modèles à la fin de `schema.prisma`**

```prisma
enum NotificationCategory {
  MY_GAMES
  MY_REGISTRATIONS
  MY_MATCHES
  PAYMENTS
  CLUB_MESSAGES
  ORGANIZER
  REMINDERS
}

enum NotificationChannel {
  INAPP
  PUSH
  EMAIL
}

/// Notification in-app (source de vérité de la cloche). Créée par le dispatcher pour
/// chaque destinataire dont le canal INAPP est actif. clubId = contexte (sans FK, léger).
model Notification {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  clubId    String?  @map("club_id")
  category  NotificationCategory
  type      String
  title     String
  body      String
  url       String?
  data      Json?
  readAt    DateTime? @map("read_at")
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, readAt])
  @@index([userId, createdAt])
  @@map("notifications")
}

/// Écart au défaut (opt-out) : une ligne = ce canal explicitement (dés)activé pour cette
/// catégorie. Pas de ligne = canal activé. CLUB_MESSAGES+INAPP n'est jamais stocké (forcé ON).
model NotificationPreference {
  id       String  @id @default(cuid())
  userId   String  @map("user_id")
  category NotificationCategory
  channel  NotificationChannel
  enabled  Boolean

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, category, channel])
  @@map("notification_preferences")
}
```

- [ ] **Step 2 : Déclarer les relations inverses sur `User`**

Dans le modèle `User`, ajouter ces deux lignes au bloc des relations (après `lessonEnrollments LessonEnrollment[]`) :

```prisma
  notifications           Notification[]
  notificationPreferences NotificationPreference[]
```

- [ ] **Step 3 : Générer la migration + le client**

Run (dossier `backend/`) :
```bash
npx prisma migrate dev --name add_notifications
```
Expected : migration créée et appliquée, `Generated Prisma Client` affiché. La DB locale (Docker) doit tourner.

- [ ] **Step 4 : Vérifier la compilation des types**

Run : `npx tsc --noEmit`
Expected : aucune erreur (les types `prisma.notification` / `prisma.notificationPreference` existent).

- [ ] **Step 5 : Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(notif): modèles Notification + NotificationPreference (migration additive)"
```

---

## Task 2 : Résolution pure des préférences

**Files:**
- Create: `src/services/notification/preferences.ts`
- Test: `src/services/notification/__tests__/preferences.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```typescript
import { channelEnabled, resolveChannels, PrefRow } from '../preferences';

describe('preferences', () => {
  it('défaut ON quand aucune ligne (opt-out)', () => {
    expect(channelEnabled([], 'MY_GAMES', 'EMAIL')).toBe(true);
    expect(channelEnabled([], 'MY_GAMES', 'INAPP')).toBe(true);
  });

  it('une ligne enabled=false désactive le canal', () => {
    const prefs: PrefRow[] = [{ category: 'MY_GAMES', channel: 'EMAIL', enabled: false }];
    expect(channelEnabled(prefs, 'MY_GAMES', 'EMAIL')).toBe(false);
    expect(channelEnabled(prefs, 'MY_GAMES', 'INAPP')).toBe(true);
  });

  it('CLUB_MESSAGES + INAPP est toujours ON, même si une ligne dit false', () => {
    const prefs: PrefRow[] = [{ category: 'CLUB_MESSAGES', channel: 'INAPP', enabled: false }];
    expect(channelEnabled(prefs, 'CLUB_MESSAGES', 'INAPP')).toBe(true);
  });

  it('resolveChannels : push inactif sans abonnement', () => {
    expect(resolveChannels([], 'MY_GAMES', false)).toEqual({ inapp: true, email: true, push: false });
    expect(resolveChannels([], 'MY_GAMES', true)).toEqual({ inapp: true, email: true, push: true });
  });
});
```

- [ ] **Step 2 : Lancer le test (échoue)**

Run : `npx jest preferences -- --runTestsByPath src/services/notification/__tests__/preferences.test.ts`
Expected : FAIL (`Cannot find module '../preferences'`).

- [ ] **Step 3 : Implémenter**

```typescript
import { NotificationCategory, NotificationChannel } from '@prisma/client';

export interface PrefRow {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

/** Canal activé par défaut (opt-out). CLUB_MESSAGES+INAPP est toujours forcé ON. */
export function channelEnabled(
  prefs: PrefRow[],
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  if (category === 'CLUB_MESSAGES' && channel === 'INAPP') return true;
  const row = prefs.find((p) => p.category === category && p.channel === channel);
  return row ? row.enabled : true;
}

export interface ResolvedChannels { inapp: boolean; email: boolean; push: boolean; }

/** Push effectif seulement si le destinataire a au moins un abonnement (hasPushSub). */
export function resolveChannels(
  prefs: PrefRow[],
  category: NotificationCategory,
  hasPushSub: boolean,
): ResolvedChannels {
  return {
    inapp: channelEnabled(prefs, category, 'INAPP'),
    email: channelEnabled(prefs, category, 'EMAIL'),
    push: channelEnabled(prefs, category, 'PUSH') && hasPushSub,
  };
}
```

- [ ] **Step 4 : Lancer le test (passe)**

Run : `npx jest preferences -- --runTestsByPath src/services/notification/__tests__/preferences.test.ts`
Expected : PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add src/services/notification/preferences.ts src/services/notification/__tests__/preferences.test.ts
git commit -m "feat(notif): résolution pure des préférences (opt-out + verrou CLUB_MESSAGES)"
```

---

## Task 3 : Canal SSE par-utilisateur

**Files:**
- Modify: `src/services/sse.service.ts`
- Test: `src/services/__tests__/sse.user.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```typescript
import { SSEService } from '../sse.service';

function fakeRes() {
  const handlers: Record<string, () => void> = {};
  return {
    setHeader: jest.fn(), flushHeaders: jest.fn(),
    write: jest.fn(), end: jest.fn(),
    on: (ev: string, cb: () => void) => { handlers[ev] = cb; },
    _close: () => handlers['close']?.(),
  } as any;
}

describe('SSEService canal utilisateur', () => {
  it('notifyUser écrit le payload aux clients de cet utilisateur', () => {
    const svc = SSEService.getInstance();
    const res = fakeRes();
    svc.addUserClient('user-1', res);
    res.write.mockClear();
    svc.notifyUser('user-1', { type: 'notification' });
    expect(res.write).toHaveBeenCalledWith('data: {"type":"notification"}\n\n');
  });

  it('notifyUser ne fait rien pour un utilisateur sans client', () => {
    expect(() => SSEService.getInstance().notifyUser('inconnu', { type: 'x' })).not.toThrow();
  });

  it('la fermeture retire le client', () => {
    const svc = SSEService.getInstance();
    const res = fakeRes();
    svc.addUserClient('user-2', res);
    expect(svc.getUserClientCount('user-2')).toBe(1);
    res._close();
    expect(svc.getUserClientCount('user-2')).toBe(0);
  });
});
```

- [ ] **Step 2 : Lancer le test (échoue)**

Run : `npx jest sse.user -- --runTestsByPath src/services/__tests__/sse.user.test.ts`
Expected : FAIL (`addUserClient is not a function`).

- [ ] **Step 3 : Implémenter — ajouter dans la classe `SSEService`**

Ajouter le champ après `private clients: Map<...>` :
```typescript
  private userClients: Map<string, Set<Response>> = new Map();
```

Ajouter ces méthodes dans la classe (après `getClientCount`) :
```typescript
  /** Abonne un client au flux de SES propres notifications (cloche en live). */
  addUserClient(userId: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 30_000);

    if (!this.userClients.has(userId)) this.userClients.set(userId, new Set());
    this.userClients.get(userId)!.add(res);

    res.on('close', () => {
      clearInterval(keepAlive);
      this.userClients.get(userId)?.delete(res);
      if (this.userClients.get(userId)?.size === 0) this.userClients.delete(userId);
    });

    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  }

  /** Pousse un évènement aux flux ouverts d'un utilisateur (best-effort). */
  notifyUser(userId: string, data: unknown): void {
    const clients = this.userClients.get(userId);
    if (!clients?.size) return;
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    const dead: Response[] = [];
    clients.forEach((res) => { try { res.write(payload); } catch { dead.push(res); } });
    dead.forEach((res) => clients.delete(res));
  }

  getUserClientCount(userId: string): number {
    return this.userClients.get(userId)?.size ?? 0;
  }
```

- [ ] **Step 4 : Lancer le test (passe)**

Run : `npx jest sse.user -- --runTestsByPath src/services/__tests__/sse.user.test.ts`
Expected : PASS (3 tests).

- [ ] **Step 5 : Commit**

```bash
git add src/services/sse.service.ts src/services/__tests__/sse.user.test.ts
git commit -m "feat(notif): canal SSE par-utilisateur (addUserClient/notifyUser)"
```

---

## Task 4 : Dispatcher

**Files:**
- Create: `src/services/notification/dispatcher.ts`
- Test: `src/services/notification/__tests__/dispatcher.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```typescript
import '../../../__mocks__/prisma';
import { prismaMock } from '../../../__mocks__/prisma';

jest.mock('../../../email/mailer', () => ({ sendMail: jest.fn() }));
jest.mock('../../sse.service', () => ({
  SSEService: { getInstance: () => ({ notifyUser: jest.fn() }) },
}));

import { dispatch } from '../dispatcher';
import { sendMail } from '../../../email/mailer';

const base = {
  userId: 'user-1', clubId: 'club-demo', category: 'MY_GAMES' as const,
  type: 'open_match.joined', title: 'T', body: 'B', url: '/parties',
};

describe('dispatch', () => {
  beforeEach(() => {
    prismaMock.notificationPreference.findMany.mockResolvedValue([] as any);
    prismaMock.notification.create.mockResolvedValue({ id: 'n1' } as any);
    (sendMail as jest.Mock).mockResolvedValue(undefined);
  });

  it('crée la Notification in-app (défaut ON)', async () => {
    await dispatch(base);
    expect(prismaMock.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', category: 'MY_GAMES', type: 'open_match.joined' }),
    }));
  });

  it('envoie l email quand un payload email est fourni et le canal actif', async () => {
    await dispatch({ ...base, email: { to: 'u@x.fr', subject: 'S', html: '<b/>', text: 'S' } });
    expect(sendMail).toHaveBeenCalledWith({ to: 'u@x.fr', subject: 'S', html: '<b/>', text: 'S' });
  });

  it('respecte l opt-out email (ligne enabled=false) sans bloquer la cloche', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue(
      [{ category: 'MY_GAMES', channel: 'EMAIL', enabled: false }] as any);
    await dispatch({ ...base, email: { to: 'u@x.fr', subject: 'S', html: '', text: 'S' } });
    expect(sendMail).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).toHaveBeenCalled();
  });

  it('opt-out INAPP : pas de Notification créée', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue(
      [{ category: 'MY_GAMES', channel: 'INAPP', enabled: false }] as any);
    await dispatch(base);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('best-effort : un échec email ne lève pas', async () => {
    (sendMail as jest.Mock).mockRejectedValue(new Error('SMTP down'));
    await expect(dispatch({ ...base, email: { to: 'u@x.fr', subject: 'S', html: '', text: 'S' } }))
      .resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2 : Lancer le test (échoue)**

Run : `npx jest dispatcher -- --runTestsByPath src/services/notification/__tests__/dispatcher.test.ts`
Expected : FAIL (`Cannot find module '../dispatcher'`).

- [ ] **Step 3 : Implémenter**

```typescript
import { NotificationCategory, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { sendMail } from '../../email/mailer';
import { SSEService } from '../sse.service';
import { resolveChannels } from './preferences';

export interface DispatchEmail { to: string; subject: string; html: string; text: string; }

export interface DispatchInput {
  userId: string;
  clubId?: string | null;
  category: NotificationCategory;
  type: string;
  title: string;
  body: string;
  url?: string | null;
  data?: Prisma.InputJsonValue;
  /** Payload email optionnel : si fourni ET canal EMAIL actif, on l'envoie. */
  email?: DispatchEmail | null;
}

/**
 * Aiguille une notification vers les canaux activés du destinataire (best-effort).
 * À appeler APRÈS commit. Ne lève jamais : chaque canal est isolé.
 * Lot 1 : push inactif (aucun abonnement) — le canal existe mais n'est jamais effectif.
 */
export async function dispatch(input: DispatchInput): Promise<void> {
  let channels;
  try {
    const prefs = await prisma.notificationPreference.findMany({
      where: { userId: input.userId, category: input.category },
      select: { category: true, channel: true, enabled: true },
    });
    channels = resolveChannels(prefs, input.category, false);
  } catch (e) {
    console.error('[notif:prefs]', (e as Error).message);
    return;
  }

  if (channels.inapp) {
    try {
      await prisma.notification.create({
        data: {
          userId: input.userId,
          clubId: input.clubId ?? null,
          category: input.category,
          type: input.type,
          title: input.title,
          body: input.body,
          url: input.url ?? null,
          data: input.data ?? undefined,
        },
      });
      SSEService.getInstance().notifyUser(input.userId, { type: 'notification' });
    } catch (e) {
      console.error('[notif:inapp]', (e as Error).message);
    }
  }

  if (channels.email && input.email) {
    try {
      await sendMail(input.email);
    } catch (e) {
      console.error('[notif:email]', (e as Error).message);
    }
  }
}
```

- [ ] **Step 4 : Lancer le test (passe)**

Run : `npx jest dispatcher -- --runTestsByPath src/services/notification/__tests__/dispatcher.test.ts`
Expected : PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add src/services/notification/dispatcher.ts src/services/notification/__tests__/dispatcher.test.ts
git commit -m "feat(notif): dispatcher multi-canal best-effort (in-app + email + SSE)"
```

---

## Task 5 : Routes API + montage

**Files:**
- Create: `src/routes/notifications.ts`
- Modify: `src/app.ts`
- Test: `src/routes/__tests__/notifications.routes.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');
const token = jwt.sign({ id: 'user-1', email: 'u@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = `Bearer ${token}`;

describe('Notifications API', () => {
  it('GET /api/me/notifications renvoie items + nextCursor', async () => {
    prismaMock.notification.findMany.mockResolvedValue([
      { id: 'n1', userId: 'user-1', category: 'MY_GAMES', type: 't', title: 'T', body: 'B',
        url: null, data: null, clubId: null, readAt: null, createdAt: new Date() },
    ] as any);
    const res = await request(app).get('/api/me/notifications').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body).toHaveProperty('nextCursor');
  });

  it('GET /unread-count renvoie le compte', async () => {
    prismaMock.notification.count.mockResolvedValue(3 as any);
    const res = await request(app).get('/api/me/notifications/unread-count').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
  });

  it('POST /:id/read marque lue (404 si pas à moi)', async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 } as any);
    const res = await request(app).post('/api/me/notifications/n9/read').set('Authorization', auth);
    expect(res.status).toBe(404);
  });

  it('PUT /notification-preferences ignore le verrou CLUB_MESSAGES+INAPP', async () => {
    prismaMock.$transaction.mockResolvedValue([] as any);
    const res = await request(app).put('/api/me/notification-preferences').set('Authorization', auth)
      .send({ preferences: [
        { category: 'MY_GAMES', channel: 'EMAIL', enabled: false },
        { category: 'CLUB_MESSAGES', channel: 'INAPP', enabled: false },
      ] });
    // $transaction est mocké : on vérifie le 200 + l'absence d'erreur (le filtrage du
    // verrou CLUB_MESSAGES+INAPP est couvert plus finement au niveau de la route).
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /notifications/stream sans token → 401', async () => {
    const res = await request(app).get('/api/me/notifications/stream');
    expect(res.status).toBe(401);
  });

  it('401 sans Authorization', async () => {
    const res = await request(app).get('/api/me/notifications');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2 : Lancer le test (échoue)**

Run : `npx jest notifications.routes -- --runTestsByPath src/routes/__tests__/notifications.routes.test.ts`
Expected : FAIL (les routes 404 → assertions cassent).

- [ ] **Step 3 : Implémenter `src/routes/notifications.ts`**

```typescript
import { Router, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../db/prisma';
import { SSEService } from '../services/sse.service';
import { NotificationCategory, NotificationChannel } from '@prisma/client';

const router = Router();
const PAGE = 20;

// Liste paginée (cursor = createdAt ISO de la dernière notif reçue).
router.get('/notifications', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cursor = typeof req.query.cursor === 'string' ? new Date(req.query.cursor) : null;
    const items = await prisma.notification.findMany({
      where: { userId: req.user!.id, ...(cursor && !isNaN(cursor.getTime()) ? { createdAt: { lt: cursor } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: PAGE + 1,
    });
    const hasMore = items.length > PAGE;
    const page = hasMore ? items.slice(0, PAGE) : items;
    res.json({
      items: page,
      nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    });
  } catch (err) { next(err); }
});

router.get('/notifications/unread-count', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const count = await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } });
    res.json({ count });
  } catch (err) { next(err); }
});

router.post('/notifications/read-all', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/notifications/:id/read', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { id: String(req.params.id), userId: req.user!.id },
      data: { readAt: new Date() },
    });
    if (result.count === 0) return void res.status(404).json({ error: 'NOTIFICATION_NOT_FOUND' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Préférences : on renvoie les écarts au défaut (lignes stockées).
router.get('/notification-preferences', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const preferences = await prisma.notificationPreference.findMany({
      where: { userId: req.user!.id },
      select: { category: true, channel: true, enabled: true },
    });
    res.json({ preferences });
  } catch (err) { next(err); }
});

const CATEGORIES = Object.values(NotificationCategory);
const CHANNELS = Object.values(NotificationChannel);

// Remplace l'ensemble des préférences (delete + recréation). Le verrou CLUB_MESSAGES+INAPP
// est filtré (jamais stocké à false : il est forcé ON côté résolution).
router.put('/notification-preferences', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { preferences?: Array<{ category: string; channel: string; enabled: boolean }> };
    const incoming = Array.isArray(body.preferences) ? body.preferences : [];
    const rows = incoming.filter((p) =>
      CATEGORIES.includes(p.category as NotificationCategory) &&
      CHANNELS.includes(p.channel as NotificationChannel) &&
      typeof p.enabled === 'boolean' &&
      !(p.category === 'CLUB_MESSAGES' && p.channel === 'INAPP'),
    );
    await prisma.$transaction([
      prisma.notificationPreference.deleteMany({ where: { userId: req.user!.id } }),
      ...(rows.length
        ? [prisma.notificationPreference.createMany({
            data: rows.map((p) => ({
              userId: req.user!.id,
              category: p.category as NotificationCategory,
              channel: p.channel as NotificationChannel,
              enabled: p.enabled,
            })),
          })]
        : []),
    ]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// SSE : EventSource ne peut pas poser d'en-tête Authorization → token en query.
router.get('/notifications/stream', (req: AuthRequest, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  let userId: string;
  try {
    userId = (jwt.verify(token, process.env.JWT_SECRET!) as { id: string }).id;
  } catch {
    return void res.status(401).end();
  }
  SSEService.getInstance().addUserClient(userId, res);
});

export default router;
```

- [ ] **Step 4 : Monter le routeur dans `src/app.ts`**

Ajouter l'import (avec les autres routes) :
```typescript
import notificationsRouter from './routes/notifications';
```
Et le montage **juste après** `app.use('/api/me', meRouter);` (ligne ~57) :
```typescript
app.use('/api/me', notificationsRouter);
```

- [ ] **Step 5 : Lancer les tests (passent)**

Run : `npx jest notifications.routes -- --runTestsByPath src/routes/__tests__/notifications.routes.test.ts`
Expected : PASS (6 tests).

- [ ] **Step 6 : Commit**

```bash
git add src/routes/notifications.ts src/app.ts src/routes/__tests__/notifications.routes.test.ts
git commit -m "feat(notif): routes /api/me/notifications (liste, lecture, préférences, stream SSE)"
```

---

## Task 6 : Méthodes & types API front + métadonnées catégories

**Files:**
- Modify: `frontend/lib/api.ts`
- Create: `frontend/lib/notifications.ts`

- [ ] **Step 1 : Ajouter les types + méthodes dans `frontend/lib/api.ts`**

Ajouter ces types (près des autres interfaces exportées) :
```typescript
export interface AppNotification {
  id: string; clubId: string | null; category: string; type: string;
  title: string; body: string; url: string | null; data: unknown;
  readAt: string | null; createdAt: string;
}
export interface NotificationPage { items: AppNotification[]; nextCursor: string | null; }
export interface NotifPrefRow { category: string; channel: string; enabled: boolean }
```

Ajouter ces méthodes dans l'objet `api` (après `getMyReservations`) :
```typescript
  getNotifications: (token: string, cursor?: string) =>
    request<NotificationPage>(`/api/me/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {}, token),
  getUnreadCount: (token: string) =>
    request<{ count: number }>('/api/me/notifications/unread-count', {}, token),
  markNotificationRead: (id: string, token: string) =>
    request<{ ok: boolean }>(`/api/me/notifications/${id}/read`, { method: 'POST' }, token),
  markAllNotificationsRead: (token: string) =>
    request<{ ok: boolean }>('/api/me/notifications/read-all', { method: 'POST' }, token),
  getNotificationPreferences: (token: string) =>
    request<{ preferences: NotifPrefRow[] }>('/api/me/notification-preferences', {}, token),
  updateNotificationPreferences: (preferences: NotifPrefRow[], token: string) =>
    request<{ ok: boolean }>('/api/me/notification-preferences', { method: 'PUT', body: JSON.stringify({ preferences }) }, token),
```

Ajouter en bas du fichier (URL du flux SSE, utilisée par la cloche) :
```typescript
export function notificationsStreamUrl(token: string): string {
  return `${BASE_URL}/api/me/notifications/stream?token=${encodeURIComponent(token)}`;
}
```

- [ ] **Step 2 : Créer `frontend/lib/notifications.ts` (métadonnées + résolution miroir)**

```typescript
import { NotifPrefRow } from './api';

export type NotifCategory =
  | 'MY_GAMES' | 'MY_REGISTRATIONS' | 'MY_MATCHES' | 'PAYMENTS'
  | 'CLUB_MESSAGES' | 'ORGANIZER' | 'REMINDERS';
export type NotifChannel = 'INAPP' | 'PUSH' | 'EMAIL';

export interface CategoryMeta { key: NotifCategory; label: string; desc: string; staffOnly?: boolean }

// Ordre d'affichage dans la grille de préférences.
export const CATEGORY_META: CategoryMeta[] = [
  { key: 'MY_GAMES', label: 'Mes parties', desc: 'Ajout/retrait, arrivée/départ d’un joueur, statut de mes réservations' },
  { key: 'MY_REGISTRATIONS', label: 'Mes inscriptions', desc: 'Tournois, events, cours : confirmation, liste d’attente, annulation' },
  { key: 'MY_MATCHES', label: 'Mes matchs', desc: 'Confirmation de résultat, litige' },
  { key: 'PAYMENTS', label: 'Paiements', desc: 'Remboursements' },
  { key: 'CLUB_MESSAGES', label: 'Messages du club', desc: 'Annonces de l’équipe du club' },
  { key: 'ORGANIZER', label: 'Activité de mes events', desc: 'Inscriptions/désinscriptions sur ce que j’organise', staffOnly: true },
  { key: 'REMINDERS', label: 'Rappels', desc: 'Avant une partie ou un event' },
];

export const CHANNELS: NotifChannel[] = ['INAPP', 'PUSH', 'EMAIL'];
export const CHANNEL_LABEL: Record<NotifChannel, string> = { INAPP: 'Cloche', PUSH: 'Push', EMAIL: 'Email' };

/** Verrou : CLUB_MESSAGES + INAPP est toujours ON, non modifiable. */
export function isLocked(category: NotifCategory, channel: NotifChannel): boolean {
  return category === 'CLUB_MESSAGES' && channel === 'INAPP';
}

/** État effectif d'une case (miroir de la résolution backend, opt-out). */
export function effective(prefs: NotifPrefRow[], category: NotifCategory, channel: NotifChannel): boolean {
  if (isLocked(category, channel)) return true;
  const row = prefs.find((p) => p.category === category && p.channel === channel);
  return row ? row.enabled : true;
}
```

- [ ] **Step 3 : Vérifier la compilation**

Run (dossier `frontend/`) : `npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add frontend/lib/api.ts frontend/lib/notifications.ts
git commit -m "feat(notif): client API + métadonnées catégories/canaux (front)"
```

---

## Task 7 : Cloche de notifications + intégration header

**Files:**
- Create: `frontend/components/notifications/NotificationBell.tsx`
- Modify: `frontend/components/ClubNav.tsx`
- Test: `frontend/__tests__/NotificationBell.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { NotificationBell } from '@/components/notifications/NotificationBell';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: {
  text: '#000', textMute: '#666', textFaint: '#999', surface: '#fff', surface2: '#f3f3f3',
  surfaceHi: '#eee', line: '#ddd', accent: '#d6ff3f', onAccent: '#000', fontUI: 'sans-serif', shadowSoft: 'none',
} }) }));
jest.mock('@/lib/api', () => ({
  api: {
    getUnreadCount: jest.fn().mockResolvedValue({ count: 2 }),
    getNotifications: jest.fn().mockResolvedValue({ items: [
      { id: 'n1', title: 'Nouveau joueur', body: 'Marie a rejoint ta partie', url: '/parties',
        readAt: null, createdAt: new Date().toISOString(), category: 'MY_GAMES', type: 'x', clubId: null, data: null },
    ], nextCursor: null }),
    markNotificationRead: jest.fn().mockResolvedValue({ ok: true }),
    markAllNotificationsRead: jest.fn().mockResolvedValue({ ok: true }),
  },
  notificationsStreamUrl: () => 'http://x/stream',
}));

// EventSource n'existe pas en jsdom : stub minimal.
beforeAll(() => {
  (global as any).EventSource = class { onmessage: ((e: any) => void) | null = null; close() {} } as any;
});

describe('NotificationBell', () => {
  it('affiche le badge de non-lus', async () => {
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
  });

  it('ouvre le panneau et liste les notifications', async () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    await waitFor(() => expect(screen.getByText('Nouveau joueur')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2 : Lancer le test (échoue)**

Run (dossier `frontend/`) : `npx jest NotificationBell`
Expected : FAIL (`Cannot find module '@/components/notifications/NotificationBell'`).

- [ ] **Step 3 : Implémenter `NotificationBell.tsx`**

```typescript
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, notificationsStreamUrl, AppNotification } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';

// Cloche du header : badge de non-lus, panneau déroulant, live via SSE.
export function NotificationBell() {
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Compteur initial + abonnement live (incrémente à chaque évènement).
  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.getUnreadCount(token).then((r) => { if (alive) setUnread(r.count); }).catch(() => {});
    const es = new EventSource(notificationsStreamUrl(token));
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.type === 'notification') setUnread((n) => n + 1);
      } catch { /* ping / connected */ }
    };
    return () => { alive = false; es.close(); };
  }, [token]);

  // Fermeture au clic extérieur / Échap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!ready || !token) return null;

  const toggle = () => {
    if (!open && token) {
      setLoaded(true);
      api.getNotifications(token).then((p) => setItems(p.items)).catch(() => {});
    }
    setOpen(!open);
  };

  const openItem = async (n: AppNotification) => {
    setOpen(false);
    if (!n.readAt && token) {
      api.markNotificationRead(n.id, token).catch(() => {});
      setUnread((u) => Math.max(0, u - 1));
    }
    if (n.url) router.push(n.url);
  };

  const markAll = () => {
    if (!token) return;
    api.markAllNotificationsRead(token).catch(() => {});
    setUnread(0);
    setItems((list) => list.map((n) => ({ ...n, readAt: new Date().toISOString() })));
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={toggle} aria-label="Notifications" aria-haspopup="menu" aria-expanded={open}
        style={{
          width: 38, height: 38, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
          position: 'relative', background: open ? th.surfaceHi : th.surface2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        <Icon name="bell" size={19} color={th.text} />
        {unread > 0 && (
          <span aria-hidden="true" style={{
            position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 8, background: '#e5484d', color: '#fff', fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI,
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div role="menu" aria-label="Notifications" style={{
          position: 'absolute', right: 0, top: 46, width: 340, maxWidth: '90vw', zIndex: 60,
          background: th.surface, border: `1px solid ${th.line}`, borderRadius: 16,
          boxShadow: th.shadowSoft, overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${th.line}` }}>
            <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontFamily: th.fontUI, fontSize: 12.5 }}>
                Tout marquer comme lu
              </button>
            )}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {loaded && items.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: th.textFaint, fontFamily: th.fontUI, fontSize: 13.5 }}>Aucune notification</div>
            )}
            {items.map((n) => (
              <button key={n.id} role="menuitem" onClick={() => openItem(n)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                  background: n.readAt ? 'transparent' : th.surface2, padding: '12px 16px',
                  borderBottom: `1px solid ${th.line}`, fontFamily: th.fontUI,
                }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: th.text }}>{n.title}</div>
                <div style={{ fontSize: 12.5, color: th.textMute, marginTop: 2 }}>{n.body}</div>
              </button>
            ))}
          </div>
          <button onClick={() => { setOpen(false); router.push('/me/notifications'); }}
            style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', padding: '12px 16px', color: th.textMute, fontFamily: th.fontUI, fontSize: 13 }}>
            Voir toutes les notifications
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4 : Intégrer la cloche dans `ClubNav.tsx`**

Importer en tête :
```typescript
import { NotificationBell } from '@/components/notifications/NotificationBell';
```
Placer `<NotificationBell />` **juste avant** `<ProfileMenu />` dans le JSX du header (rendre les deux dans un conteneur flex avec `gap: 8` s'il n'y en a pas déjà). Exemple du fragment :
```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <NotificationBell />
  <ProfileMenu />
</div>
```

- [ ] **Step 5 : Lancer le test (passe)**

Run (dossier `frontend/`) : `npx jest NotificationBell`
Expected : PASS (2 tests).

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/notifications/NotificationBell.tsx frontend/components/ClubNav.tsx frontend/__tests__/NotificationBell.test.tsx
git commit -m "feat(notif): cloche header + panneau live SSE"
```

---

## Task 8 : Page liste complète `/me/notifications`

**Files:**
- Create: `frontend/app/me/notifications/page.tsx`

- [ ] **Step 1 : Implémenter la page (client component, pagination par cursor)**

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, AppNotification } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';

export default function NotificationsPage() {
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = (c?: string) => {
    if (!token) return;
    setLoading(true);
    api.getNotifications(token, c).then((p) => {
      setItems((prev) => (c ? [...prev, ...p.items] : p.items));
      setCursor(p.nextCursor);
      if (!p.nextCursor) setDone(true);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { if (token) load(); /* eslint-disable-next-line */ }, [token]);

  if (ready && !token) { if (typeof window !== 'undefined') router.push('/login'); return null; }

  const openItem = (n: AppNotification) => {
    if (!n.readAt && token) api.markNotificationRead(n.id, token).catch(() => {});
    if (n.url) router.push(n.url);
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 22, color: th.text, marginBottom: 16 }}>Notifications</h1>
      {items.length === 0 && !loading && (
        <p style={{ color: th.textFaint, fontFamily: th.fontUI }}>Aucune notification.</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((n) => (
          <button key={n.id} onClick={() => openItem(n)} style={{
            textAlign: 'left', border: `1px solid ${th.line}`, borderRadius: 12, cursor: 'pointer',
            background: n.readAt ? th.surface : th.surface2, padding: '12px 14px', fontFamily: th.fontUI,
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: th.text }}>{n.title}</div>
            <div style={{ fontSize: 13, color: th.textMute, marginTop: 2 }}>{n.body}</div>
          </button>
        ))}
      </div>
      {!done && items.length > 0 && (
        <button onClick={() => cursor && load(cursor)} disabled={loading} style={{
          marginTop: 16, width: '100%', padding: '10px 0', borderRadius: 10, border: `1px solid ${th.line}`,
          background: th.surface, color: th.text, cursor: 'pointer', fontFamily: th.fontUI, fontWeight: 600,
        }}>{loading ? 'Chargement…' : 'Charger plus'}</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier la compilation**

Run (dossier `frontend/`) : `npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add frontend/app/me/notifications/page.tsx
git commit -m "feat(notif): page liste complète /me/notifications"
```

---

## Task 9 : Écran de préférences `/me/notifications/settings`

**Files:**
- Create: `frontend/app/me/notifications/settings/page.tsx`
- Test: `frontend/__tests__/NotificationSettings.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SettingsPage from '@/app/me/notifications/settings/page';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: {
  text: '#000', textMute: '#666', textFaint: '#999', surface: '#fff', surface2: '#f3f3f3',
  line: '#ddd', accent: '#d6ff3f', onAccent: '#000', fontUI: 'sans-serif',
} }) }));
jest.mock('@/lib/api', () => ({
  api: {
    getNotificationPreferences: jest.fn().mockResolvedValue({ preferences: [] }),
    getMyClubs: jest.fn().mockResolvedValue([]),
    updateNotificationPreferences: jest.fn().mockResolvedValue({ ok: true }),
  },
}));

describe('NotificationSettings', () => {
  it('affiche la grille et verrouille CLUB_MESSAGES+Cloche', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText('Messages du club')).toBeInTheDocument());
    // La case cloche des messages du club est cochée et désactivée (verrou).
    const locked = screen.getByLabelText('Messages du club – Cloche') as HTMLInputElement;
    expect(locked.checked).toBe(true);
    expect(locked.disabled).toBe(true);
  });

  it('enregistre les préférences', async () => {
    const { api } = require('@/lib/api');
    render(<SettingsPage />);
    await waitFor(() => screen.getByText('Mes parties'));
    fireEvent.click(screen.getByLabelText('Mes parties – Email'));
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(api.updateNotificationPreferences).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2 : Lancer le test (échoue)**

Run (dossier `frontend/`) : `npx jest NotificationSettings`
Expected : FAIL (`Cannot find module '@/app/me/notifications/settings/page'`).

- [ ] **Step 3 : Implémenter la page**

```typescript
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, NotifPrefRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import {
  CATEGORY_META, CHANNELS, CHANNEL_LABEL, NotifCategory, NotifChannel, effective, isLocked,
} from '@/lib/notifications';

export default function NotificationSettingsPage() {
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const [prefs, setPrefs] = useState<NotifPrefRow[]>([]);
  const [isStaff, setIsStaff] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.getNotificationPreferences(token).then((r) => setPrefs(r.preferences)).catch(() => {});
    api.getMyClubs(token).then((cl) => setIsStaff(cl.length > 0)).catch(() => {});
  }, [token]);

  const categories = useMemo(() => CATEGORY_META.filter((c) => !c.staffOnly || isStaff), [isStaff]);

  const setCell = (category: NotifCategory, channel: NotifChannel, value: boolean) => {
    if (isLocked(category, channel)) return;
    setSaved(false);
    setPrefs((prev) => {
      const rest = prev.filter((p) => !(p.category === category && p.channel === channel));
      return [...rest, { category, channel, enabled: value }];
    });
  };

  const save = () => {
    if (!token) return;
    // On stocke toutes les cases (hors verrou) comme écarts explicites.
    const rows: NotifPrefRow[] = [];
    for (const cat of categories) {
      for (const ch of CHANNELS) {
        if (isLocked(cat.key, ch)) continue;
        rows.push({ category: cat.key, channel: ch, enabled: effective(prefs, cat.key, ch) });
      }
    }
    api.updateNotificationPreferences(rows, token).then(() => setSaved(true)).catch(() => {});
  };

  if (ready && !token) return null;

  const cell: React.CSSProperties = { textAlign: 'center', padding: '10px 8px' };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 22, color: th.text, marginBottom: 4 }}>Notifications</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 16 }}>
        Choisis comment tu veux être prévenu. Le push arrive bientôt.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: th.fontUI }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '10px 8px', color: th.textFaint, fontSize: 12 }}></th>
            {CHANNELS.map((ch) => (
              <th key={ch} style={{ ...cell, color: th.textFaint, fontSize: 12, fontWeight: 600 }}>{CHANNEL_LABEL[ch]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => (
            <tr key={cat.key} style={{ borderTop: `1px solid ${th.line}` }}>
              <td style={{ padding: '12px 8px' }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: th.text }}>{cat.label}</div>
                <div style={{ fontSize: 12, color: th.textMute }}>{cat.desc}</div>
              </td>
              {CHANNELS.map((ch) => {
                const locked = isLocked(cat.key, ch);
                const pushDisabled = ch === 'PUSH'; // Lot 1 : push inactif
                return (
                  <td key={ch} style={cell}>
                    <input type="checkbox"
                      aria-label={`${cat.label} – ${CHANNEL_LABEL[ch]}`}
                      checked={effective(prefs, cat.key, ch)}
                      disabled={locked || pushDisabled}
                      onChange={(e) => setCell(cat.key, ch, e.target.checked)} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <button onClick={save} style={{
          padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
          background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontWeight: 700,
        }}>Enregistrer</button>
        {saved && <span style={{ color: th.textMute, fontFamily: th.fontUI, fontSize: 13 }}>Enregistré ✓</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : Lancer le test (passe)**

Run (dossier `frontend/`) : `npx jest NotificationSettings`
Expected : PASS (2 tests).

- [ ] **Step 5 : Ajouter l'entrée « Notifications » dans `ProfileMenu.tsx`**

Dans la liste des `MenuItem` (après « Mon profil »), ajouter :
```tsx
<MenuItem th={th} icon="bell" label="Notifications" onClick={() => go('/me/notifications/settings')} />
```

- [ ] **Step 6 : Commit**

```bash
git add frontend/app/me/notifications/settings/page.tsx frontend/__tests__/NotificationSettings.test.tsx frontend/components/ProfileMenu.tsx
git commit -m "feat(notif): écran de préférences (grille catégorie × canal, verrou club, push inactif)"
```

---

## Task 10 : Migrer la famille « parties ouvertes » vers le dispatcher

But : prouver l'unification de bout en bout — ces 5 évènements créent désormais une notif cloche **et** envoient l'email via le dispatcher (selon préférences), **sans double envoi**. On garde les builders d'email existants (`buildMatchJoinEmail`, etc.).

**Files:**
- Modify: `src/email/notifications.ts` (fonctions `notifyOpenMatchJoin`, `notifyOpenMatchLeft`, `notifyMatchPartnersInvited`, `notifyOpenMatchRemoved`, `notifyOpenMatchAdded`)
- Test: `src/email/__tests__/notifications.openmatch.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const dispatchMock = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));

import { notifyOpenMatchJoin } from '../notifications';

const club = { id: 'club-demo', name: 'Padel Arena', slug: 'arena', logoUrl: null, accentColor: '#d6ff3f', timezone: 'Europe/Paris' };

describe('notifyOpenMatchJoin → dispatch', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('dispatch une notif MY_GAMES à l organisateur avec payload email', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      startTime: new Date('2026-07-01T10:00:00Z'), endTime: new Date('2026-07-01T11:30:00Z'),
      resource: { name: 'Court 1', attributes: { format: 'double' }, club },
      participants: [
        { isOrganizer: true, userId: 'orga', user: { firstName: 'Léa', lastName: 'M', email: 'lea@x.fr' } },
        { isOrganizer: false, userId: 'join', user: { firstName: 'Marie', lastName: 'D', email: 'marie@x.fr' } },
      ],
    } as any);

    await notifyOpenMatchJoin('res-1', 'join');

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'orga', category: 'MY_GAMES', type: 'open_match.joined', clubId: 'club-demo',
      email: expect.objectContaining({ to: 'lea@x.fr' }),
    }));
  });
});
```

- [ ] **Step 2 : Lancer le test (échoue)**

Run : `npx jest notifications.openmatch -- --runTestsByPath src/email/__tests__/notifications.openmatch.test.ts`
Expected : FAIL (`dispatch` non appelé — la fonction utilise encore `sendMail`).

- [ ] **Step 3 : Refactorer les 5 fonctions dans `src/email/notifications.ts`**

Ajouter l'import en tête :
```typescript
import { dispatch } from '../services/notification/dispatcher';
```

Ajouter `id: true` au `select` du club dans les 5 `include` concernés (pour disposer de `clubId`), p.ex. :
```typescript
club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } },
```

Remplacer le corps des 5 fonctions par les versions ci-dessous (chacune construit l'email via le builder existant **puis** appelle `dispatch` au lieu de `sendMail`).

`notifyOpenMatchJoin` :
```typescript
export async function notifyOpenMatchJoin(reservationId: string, joinerUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: {
        select: {
          name: true, attributes: true,
          club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } },
        },
      },
      participants: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
    },
  });
  if (!resa) return;

  const organizerP = resa.participants.find((p) => p.isOrganizer);
  const organizer = organizerP?.user;
  const joiner = resa.participants.find((p) => p.userId === joinerUserId)?.user;
  if (!organizerP || !organizer?.email || !joiner) return;

  const club = resa.resource.club;
  const maxPlayers = playerCount((resa.resource.attributes as { format?: string } | null)?.format);
  const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/parties');
  const mail = buildMatchJoinEmail({
    organizerFirstName: organizer.firstName, joinerName: fullName(joiner),
    resourceName: resa.resource.name, dateLabel, clubName: club.name,
    spotsLeft: Math.max(0, maxPlayers - resa.participants.length), url, brand: brandOf(club),
  });
  await dispatch({
    userId: organizerP.userId, clubId: club.id, category: 'MY_GAMES', type: 'open_match.joined',
    title: 'Nouveau joueur dans ta partie', body: `${fullName(joiner)} a rejoint ta partie du ${dateLabel}.`,
    url, email: { to: organizer.email, subject: mail.subject, html: mail.html, text: mail.text },
  });
}
```

`notifyOpenMatchLeft` :
```typescript
export async function notifyOpenMatchLeft(reservationId: string, leaverUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: { select: { name: true, attributes: true, club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } },
      participants: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
    },
  });
  if (!resa) return;
  const organizerP = resa.participants.find((p) => p.isOrganizer);
  if (!organizerP?.user?.email) return;
  const leaver = await prisma.user.findUnique({ where: { id: leaverUserId }, select: { firstName: true, lastName: true } });
  if (!leaver) return;
  const club = resa.resource.club;
  const maxPlayers = playerCount((resa.resource.attributes as { format?: string } | null)?.format);
  const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/parties');
  const mail = buildMatchLeftEmail({
    organizerFirstName: organizerP.user.firstName, leaverName: fullName(leaver),
    resourceName: resa.resource.name, dateLabel, clubName: club.name,
    spotsLeft: Math.max(0, maxPlayers - resa.participants.length), url, brand: brandOf(club),
  });
  await dispatch({
    userId: organizerP.userId, clubId: club.id, category: 'MY_GAMES', type: 'open_match.left',
    title: 'Un joueur a quitté ta partie', body: `${fullName(leaver)} a quitté ta partie du ${dateLabel}.`,
    url, email: { to: organizerP.user.email, subject: mail.subject, html: mail.html, text: mail.text },
  });
}
```

`notifyMatchPartnersInvited` :
```typescript
export async function notifyMatchPartnersInvited(reservationId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: { select: { name: true, club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } },
      participants: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
    },
  });
  if (!resa) return;
  const organizer = resa.participants.find((p) => p.isOrganizer)?.user;
  const byName = organizer ? fullName(organizer) : null;
  const club = resa.resource.club;
  const brand = brandOf(club);
  const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/me/reservations');

  for (const p of resa.participants) {
    if (p.isOrganizer || !p.user.email) continue;
    const mail = buildMatchInviteEmail({
      recipientFirstName: p.user.firstName, byName,
      resourceName: resa.resource.name, dateLabel, clubName: club.name, url, brand,
    });
    await dispatch({
      userId: p.userId, clubId: club.id, category: 'MY_GAMES', type: 'match.partners_invited',
      title: 'Tu as été ajouté à une partie',
      body: `${byName ? byName + ' t’a ajouté à' : 'Tu as été ajouté à'} une partie le ${dateLabel}.`,
      url, email: { to: p.user.email, subject: mail.subject, html: mail.html, text: mail.text },
    });
  }
}
```

`notifyOpenMatchRemoved` :
```typescript
export async function notifyOpenMatchRemoved(reservationId: string, removedUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { resource: { select: { name: true, club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } } },
  });
  if (!resa) return;
  const member = await prisma.user.findUnique({ where: { id: removedUserId }, select: { firstName: true, email: true } });
  if (!member?.email) return;
  const club = resa.resource.club;
  const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/parties');
  const mail = buildMatchRemovedEmail({
    recipientFirstName: member.firstName, resourceName: resa.resource.name,
    dateLabel, clubName: club.name, url, brand: brandOf(club),
  });
  await dispatch({
    userId: removedUserId, clubId: club.id, category: 'MY_GAMES', type: 'open_match.removed',
    title: 'Tu as été retiré d’une partie', body: `Tu as été retiré de la partie du ${dateLabel}.`,
    url, email: { to: member.email, subject: mail.subject, html: mail.html, text: mail.text },
  });
}
```

`notifyOpenMatchAdded` :
```typescript
export async function notifyOpenMatchAdded(reservationId: string, addedUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: { select: { name: true, club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } },
      participants: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
    },
  });
  if (!resa) return;
  const organizer = resa.participants.find((p) => p.isOrganizer)?.user;
  const added = resa.participants.find((p) => p.userId === addedUserId)?.user;
  if (!added?.email) return;
  const club = resa.resource.club;
  const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/parties');
  const mail = buildMatchInviteEmail({
    recipientFirstName: added.firstName, byName: organizer ? fullName(organizer) : null,
    resourceName: resa.resource.name, dateLabel, clubName: club.name, url, brand: brandOf(club),
  });
  await dispatch({
    userId: addedUserId, clubId: club.id, category: 'MY_GAMES', type: 'open_match.added',
    title: 'Tu as été ajouté à une partie', body: `Tu as été ajouté à la partie du ${dateLabel}.`,
    url, email: { to: added.email, subject: mail.subject, html: mail.html, text: mail.text },
  });
}
```

- [ ] **Step 4 : Lancer le test ciblé (passe)**

Run : `npx jest notifications.openmatch -- --runTestsByPath src/email/__tests__/notifications.openmatch.test.ts`
Expected : PASS (1 test).

- [ ] **Step 5 : Lancer toute la suite back (non-régression)**

Run (dossier `backend/`) : `npm test`
Expected : tous les tests verts (les tests de `openMatch.service` mockent le module `notifications`, donc inchangés ; aucun double envoi car `sendMail` n'est plus appelé directement dans ces 5 fonctions).

- [ ] **Step 6 : Commit**

```bash
git add src/email/notifications.ts src/email/__tests__/notifications.openmatch.test.ts
git commit -m "feat(notif): parties ouvertes via dispatcher (cloche + email unifiés, sans double envoi)"
```

---

## Vérification finale du lot

- [ ] **Back** : `npm test` (dossier `backend/`) → vert.
- [ ] **Front** : `npm test` (dossier `frontend/`) → vert.
- [ ] **Manuel** (optionnel, DB + back + front lancés) : ouvrir l'app connecté, rejoindre une partie ouverte avec un 2e compte → la cloche de l'organisateur s'incrémente en live, le panneau liste « Nouveau joueur dans ta partie », le clic ouvre `/parties` et marque lu ; couper « Mes parties → Email » dans `/me/notifications/settings` puis refaire → plus d'email, mais la cloche reste.

## Ce qui suit (lots ultérieurs, plans à écrire au moment voulu)

- **Lot 2** : push web (service worker `public/sw.js`, VAPID, `web-push`, abonnements, activation de la colonne Push + tuto iOS).
- **Lot 1b** : migrer les familles d'emails restantes (inscriptions tournoi/event/cours, match confirmation/litige, remboursement, organisateurs) vers le dispatcher.
- **Lot 3** : nouveaux évènements (`reservation.cancelled/.rescheduled`, `activity.cancelled_by_club`).
- **Lot 4** : broadcast admin (`ClubBroadcast`, `/admin/broadcast`).
- **Lot 5** : rappels J-1/H-2 (job node-cron).
