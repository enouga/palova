# Validation d'un match : visibilité + relance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Montrer, sur un match padel en attente, qui a validé le résultat et quand il se validera automatiquement, et permettre de relancer les joueurs en attente.

**Architecture:** Additif, aucune migration (les champs `MatchPlayer.confirmation` et `Match.confirmDeadline` existent déjà). Backend : enrichir le DTO `GET /api/me/matches`, ajouter une route `POST /api/matches/:id/remind` (garde participant + PENDING + anti-spam Redis) et une fonction de notification ciblée `notifyMatchReminder`. Frontend : enrichir `MyMatchesList` (pastilles de validation, compteur « N/4 », compte à rebours d'auto-validation, bouton « Relancer »).

**Tech Stack:** Express + Prisma 7 (backend), Jest + supertest, Next 16 + React (frontend), Redis (rate-limit fail-open).

**Spec :** `docs/superpowers/specs/2026-07-21-match-validation-visibilite-relance-design.md`

**Commandes de test (shims npx cassés sur ce poste — appeler jest/tsc directement) :**
- Backend jest : `cd backend && node node_modules/jest/bin/jest.js <chemin/test>`
- Frontend jest : `cd frontend && node node_modules/jest/bin/jest.js <__tests__/Fichier>`
- Type-check : `cd <backend|frontend> && node node_modules/typescript/bin/tsc --noEmit`

---

## File Structure

- **Modify** `backend/src/routes/me.ts:283-312` — exposer `confirmation` par joueur + `confirmDeadline` dans `GET /api/me/matches`.
- **Modify** `backend/src/email/notifications.ts` (après `notifyMatchPendingConfirmation`, ~ligne 1325) — nouvelle `notifyMatchReminder`.
- **Modify** `backend/src/services/match.service.ts` — import `assertRateLimit` + `notifyMatchReminder` ; nouvelle méthode `remind`.
- **Modify** `backend/src/routes/matches.ts` — `RATE_LIMITED: 429` dans `matchError` + route `POST /:id/remind`.
- **Modify** `frontend/lib/api.ts` — `MyMatchPlayer.confirmation`, `MyMatch.confirmDeadline`, méthode `remindMatch`.
- **Modify** `frontend/components/match/MyMatchesList.tsx` — pastilles, compteur, compte à rebours, bouton Relancer.
- **Tests** (modify) : `backend/src/routes/__tests__/me.routes.test.ts`, `backend/src/email/__tests__/notifications.match.test.ts`, `backend/src/services/__tests__/match.service.test.ts`, `backend/src/routes/__tests__/match.routes.test.ts`, `frontend/__tests__/MyMatchesList.test.tsx`.

---

## Task 1 : DTO — exposer `confirmation` par joueur + `confirmDeadline`

**Files:**
- Modify: `backend/src/routes/me.ts:283-312`
- Test: `backend/src/routes/__tests__/me.routes.test.ts:206`

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `me.routes.test.ts`, ajouter ce test dans le `describe('GET /api/me/matches')` (après le test ligne 241) :

```ts
it('expose confirmDeadline + confirmation par joueur', async () => {
  prismaMock.matchPlayer.findMany.mockResolvedValue([
    {
      confirmation: 'PENDING', team: 2, ratingAfter: null,
      match: {
        id: 'm3', status: 'PENDING', sets: [[6, 4], [6, 3]],
        playedAt: new Date('2026-06-20T16:30:00Z'), winningTeam: 1, competitive: true,
        confirmDeadline: new Date('2026-06-23T16:30:00Z'), reservationId: 'r1',
        club: { name: 'Padel Arena Paris' }, sport: { name: 'Padel' },
        reservation: { resource: { name: 'Court 2' } },
        players: [
          { userId: 'u1', team: 2, confirmation: 'PENDING', user: { firstName: 'Eric', lastName: 'N' } },
          { userId: 'u2', team: 2, confirmation: 'CONFIRMED', user: { firstName: 'Marie', lastName: 'D' } },
          { userId: 'u3', team: 1, confirmation: 'PENDING', user: { firstName: 'Paul', lastName: 'R' } },
          { userId: 'u4', team: 1, confirmation: 'CONFIRMED', user: { firstName: 'Lea', lastName: 'M' } },
        ],
        _count: { comments: 0 },
      },
    },
  ] as any);
  const res = await request(app).get('/api/me/matches').set('Authorization', `Bearer ${token()}`);
  expect(res.status).toBe(200);
  expect(res.body[0].confirmDeadline).toBe('2026-06-23T16:30:00.000Z');
  expect(res.body[0].players).toEqual(expect.arrayContaining([
    expect.objectContaining({ userId: 'u2', confirmation: 'CONFIRMED' }),
    expect.objectContaining({ userId: 'u3', confirmation: 'PENDING' }),
  ]));
});
```

- [ ] **Step 2 : Lancer le test → échoue**

Run: `cd backend && node node_modules/jest/bin/jest.js src/routes/__tests__/me.routes.test.ts -t "confirmDeadline"`
Expected: FAIL (`confirmDeadline` = `undefined`, players sans `confirmation`).

- [ ] **Step 3 : Implémenter**

Dans `backend/src/routes/me.ts`, au `select` des players (ligne ~292), ajouter `confirmation: true` :

```ts
            players: { select: { userId: true, team: true, confirmation: true, user: { select: { firstName: true, lastName: true } } } },
```

Puis dans le `res.json(rows.map(...))`, ajouter `confirmDeadline` à la sortie du match (juste après `playedAt: r.match.playedAt,`) :

```ts
      matchId: r.match.id, status: r.match.status, sets: r.match.sets, playedAt: r.match.playedAt,
      confirmDeadline: r.match.confirmDeadline,
```

Et ajouter `confirmation` dans le map des players :

```ts
      players: r.match.players.map((p) => ({
        userId: p.userId, team: p.team, firstName: p.user.firstName, lastName: p.user.lastName,
        isMe: p.userId === meId, confirmation: p.confirmation,
      })),
```

- [ ] **Step 4 : Lancer le test → passe**

Run: `cd backend && node node_modules/jest/bin/jest.js src/routes/__tests__/me.routes.test.ts`
Expected: PASS (tous les tests du fichier, y compris les anciens).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts
git commit -m "feat(matchs): expose confirmation par joueur + confirmDeadline dans GET /api/me/matches"
```

---

## Task 2 : Notification ciblée `notifyMatchReminder`

**Files:**
- Modify: `backend/src/email/notifications.ts` (après `notifyMatchPendingConfirmation`, ~ligne 1325)
- Test: `backend/src/email/__tests__/notifications.match.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `notifications.match.test.ts`, importer la nouvelle fonction (ajouter à l'import existant depuis `../notifications`) puis ajouter ce `describe` :

```ts
describe('notifyMatchReminder → dispatch ciblé', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('ne dispatch qu aux destinataires fournis, réutilise le type match.pending_confirmation', async () => {
    prismaMock.match.findUnique.mockResolvedValue({
      id: 'match-1', sets: [[6, 4], [6, 3]], club,
      createdByUserId: 'author-uid',
      creator: { firstName: 'Paul', lastName: 'Martin' },
      players: [
        { userId: 'author-uid', user: { email: 'paul@x.fr', firstName: 'Paul' } },
        { userId: 'player2', user: { email: 'alice@x.fr', firstName: 'Alice' } },
        { userId: 'player3', user: { email: 'bob@x.fr', firstName: 'Bob' } },
        { userId: 'player4', user: { email: 'carol@x.fr', firstName: 'Carol' } },
      ],
    } as any);

    await notifyMatchReminder('match-1', ['player3']);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'player3', category: 'MY_MATCHES', type: 'match.pending_confirmation',
      email: expect.objectContaining({ to: 'bob@x.fr' }),
    }));
  });

  it('ne fait rien si la liste de destinataires est vide', async () => {
    await notifyMatchReminder('match-1', []);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
```

Mettre à jour la ligne d'import du fichier de test :

```ts
import { notifyMatchPendingConfirmation, notifyMatchReminder, notifyReservationRefunded, notifyMatchResultPrompt } from '../notifications';
```

- [ ] **Step 2 : Lancer → échoue**

Run: `cd backend && node node_modules/jest/bin/jest.js src/email/__tests__/notifications.match.test.ts -t "notifyMatchReminder"`
Expected: FAIL (`notifyMatchReminder` n'existe pas).

- [ ] **Step 3 : Implémenter**

Dans `backend/src/email/notifications.ts`, juste après la fin de `notifyMatchPendingConfirmation` (ligne ~1325), ajouter :

```ts
/**
 * Relance MANUELLE : renvoie aux destinataires fournis (joueurs encore en attente, hors
 * l'émetteur) la demande de confirmation du résultat. Réutilise l'email `match.pending_confirmation`
 * (option A, pas de nouveau type). PAS de coalescing : une relance doit toujours repartir.
 * Peut lever (DB/SMTP) ; l'appelant (match.service) enveloppe en best-effort.
 */
export async function notifyMatchReminder(matchId: string, recipientUserIds: string[]): Promise<void> {
  if (recipientUserIds.length === 0) return;
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      club: { select: EMAIL_CLUB_SELECT },
      creator: { select: { firstName: true, lastName: true } },
      players: { select: { userId: true, user: { select: { email: true, firstName: true } } } },
    },
  });
  if (!match) return;

  const targets = new Set(recipientUserIds);
  const scoreLine = setsToScoreLine(match.sets);
  const brand = brandFromClub(match.club);
  const matchUrl = clubAppUrl(match.club.slug, '/me/matches');
  const authorName = fullName(match.creator);
  const override = await emailTemplates.getOverride(match.club.id, 'match.pending_confirmation');

  for (const mp of match.players) {
    if (!targets.has(mp.userId)) continue;
    if (!mp.user.email) continue;
    const mail = renderClubEmail('match.pending_confirmation', {
      prenom: mp.user.firstName, auteur: authorName, score: scoreLine, lien: matchUrl,
    }, brand, override);
    await dispatch({
      userId: mp.userId,
      clubId: match.club.id,
      category: 'MY_MATCHES',
      type: 'match.pending_confirmation',
      title: 'Rappel : confirme le résultat',
      body: `Rappel — ${authorName} attend ta validation du score (${scoreLine}).`,
      url: matchUrl,
      email: { to: mp.user.email, subject: mail.subject, html: mail.html, text: mail.text },
    });
  }
}
```

- [ ] **Step 4 : Lancer → passe**

Run: `cd backend && node node_modules/jest/bin/jest.js src/email/__tests__/notifications.match.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/email/notifications.ts backend/src/email/__tests__/notifications.match.test.ts
git commit -m "feat(matchs): notifyMatchReminder (relance ciblee, reutilise l'email match.pending_confirmation)"
```

---

## Task 3 : `MatchService.remind` (garde participant + PENDING + anti-spam)

**Files:**
- Modify: `backend/src/services/match.service.ts` (imports lignes 10-14 ; nouvelle méthode après `autoValidateDue`, ~ligne 260)
- Test: `backend/src/services/__tests__/match.service.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

En tête de `match.service.test.ts`, (a) ajouter `notifyMatchReminder: jest.fn(),` au mock `../../email/notifications`, et (b) ajouter un mock du rate-limit **avant** les imports :

```ts
jest.mock('../rateLimit', () => ({ assertRateLimit: jest.fn() }));
```

Puis, après les imports existants, récupérer les mocks typés :

```ts
import { assertRateLimit } from '../rateLimit';
import { notifyMatchReminder } from '../../email/notifications';
const assertRateLimitMock = assertRateLimit as jest.Mock;
const notifyMatchReminderMock = notifyMatchReminder as jest.Mock;
```

Ajouter ce `describe` :

```ts
describe('remind', () => {
  const pendingMatch = {
    status: 'PENDING',
    players: [
      { userId: 'u1', confirmation: 'CONFIRMED' }, // auteur
      { userId: 'u2', confirmation: 'PENDING' },
      { userId: 'u3', confirmation: 'CONFIRMED' },
      { userId: 'u4', confirmation: 'PENDING' },
    ],
  };

  beforeEach(() => {
    assertRateLimitMock.mockReset().mockResolvedValue(undefined);
    notifyMatchReminderMock.mockReset();
  });

  it('cible uniquement les PENDING hors l émetteur', async () => {
    prismaMock.match.findUnique.mockResolvedValue(pendingMatch as any);
    const out = await service.remind('m1', 'u1');
    expect(out).toEqual({ reminded: 2 });
    expect(assertRateLimitMock).toHaveBeenCalledWith('match:remind', 'm1', 1, 12 * 3600);
    expect(notifyMatchReminderMock).toHaveBeenCalledWith('m1', ['u2', 'u4']);
  });

  it('403 si l émetteur n est pas joueur du match', async () => {
    prismaMock.match.findUnique.mockResolvedValue(pendingMatch as any);
    await expect(service.remind('m1', 'intrus')).rejects.toThrow('NOT_A_MATCH_PLAYER');
  });

  it('409 si le match n est pas PENDING', async () => {
    prismaMock.match.findUnique.mockResolvedValue({ ...pendingMatch, status: 'CONFIRMED' } as any);
    await expect(service.remind('m1', 'u1')).rejects.toThrow('MATCH_NOT_PENDING');
  });

  it('reminded:0 sans consommer le quota si personne d autre n est en attente', async () => {
    prismaMock.match.findUnique.mockResolvedValue({
      status: 'PENDING',
      players: [
        { userId: 'u1', confirmation: 'PENDING' }, // le viewer
        { userId: 'u2', confirmation: 'CONFIRMED' },
        { userId: 'u3', confirmation: 'CONFIRMED' },
        { userId: 'u4', confirmation: 'CONFIRMED' },
      ],
    } as any);
    const out = await service.remind('m1', 'u1');
    expect(out).toEqual({ reminded: 0 });
    expect(assertRateLimitMock).not.toHaveBeenCalled();
    expect(notifyMatchReminderMock).not.toHaveBeenCalled();
  });

  it('propage RATE_LIMITED', async () => {
    prismaMock.match.findUnique.mockResolvedValue(pendingMatch as any);
    assertRateLimitMock.mockRejectedValue(new Error('RATE_LIMITED'));
    await expect(service.remind('m1', 'u1')).rejects.toThrow('RATE_LIMITED');
  });
});
```

- [ ] **Step 2 : Lancer → échoue**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/match.service.test.ts -t "remind"`
Expected: FAIL (`service.remind` n'existe pas).

- [ ] **Step 3 : Implémenter**

Dans `match.service.ts` :

Import du rate-limit (près des autres imports, ligne ~14) :

```ts
import { assertRateLimit } from './rateLimit';
```

Ajouter `notifyMatchReminder` à l'import existant (ligne 10) :

```ts
import { notifyMatchPendingConfirmation, notifyNewMatchComment, notifyMatchReminder } from '../email/notifications';
```

Ajouter la méthode juste après `autoValidateDue` (ligne ~260) :

```ts
  /**
   * Relance MANUELLE des joueurs qui n'ont pas encore validé un match PENDING. Ouvert à tout
   * joueur du match ; ne notifie que les joueurs encore en attente, hors l'émetteur ; anti-spam
   * 1 relance / 12 h PAR MATCH (fail-open si Redis KO).
   */
  async remind(matchId: string, byUserId: string): Promise<{ reminded: number }> {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { status: true, players: { select: { userId: true, confirmation: true } } },
    });
    if (!match) throw new Error('MATCH_NOT_FOUND');
    if (!match.players.some((p) => p.userId === byUserId)) throw new Error('NOT_A_MATCH_PLAYER');
    if (match.status !== 'PENDING') throw new Error('MATCH_NOT_PENDING');

    const recipients = match.players
      .filter((p) => p.confirmation === 'PENDING' && p.userId !== byUserId)
      .map((p) => p.userId);
    if (recipients.length === 0) return { reminded: 0 };

    await assertRateLimit('match:remind', matchId, 1, 12 * 3600);
    this.safeNotify(() => notifyMatchReminder(matchId, recipients));
    return { reminded: recipients.length };
  }
```

- [ ] **Step 4 : Lancer → passe**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/match.service.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/match.service.ts backend/src/services/__tests__/match.service.test.ts
git commit -m "feat(matchs): MatchService.remind (participant + PENDING + anti-spam 1/12h)"
```

---

## Task 4 : Route `POST /api/matches/:id/remind`

**Files:**
- Modify: `backend/src/routes/matches.ts:14-23` (map d'erreurs) et `:37` (nouvelle route)
- Test: `backend/src/routes/__tests__/match.routes.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `match.routes.test.ts` : (a) ajouter `notifyMatchReminder: jest.fn(),` au mock `../../email/notifications` (ligne 7), (b) mocker le rate-limit en tête du fichier :

```ts
const assertRateLimitMock = jest.fn();
jest.mock('../../services/rateLimit', () => ({ assertRateLimit: (...a: unknown[]) => assertRateLimitMock(...a) }));
```

Ajouter ce `describe` :

```ts
describe('POST /api/matches/:id/remind', () => {
  const pending = {
    status: 'PENDING',
    players: [
      { userId: 'u1', confirmation: 'CONFIRMED' },
      { userId: 'u2', confirmation: 'PENDING' },
      { userId: 'u3', confirmation: 'CONFIRMED' },
      { userId: 'u4', confirmation: 'PENDING' },
    ],
  };
  beforeEach(() => assertRateLimitMock.mockReset().mockResolvedValue(undefined));

  it('401 sans token', async () => {
    const res = await request(app).post('/api/matches/m1/remind');
    expect(res.status).toBe(401);
  });

  it('200 { reminded } pour un joueur du match', async () => {
    prismaMock.match.findUnique.mockResolvedValue(pending as any);
    const res = await request(app).post('/api/matches/m1/remind').set('Authorization', `Bearer ${token('u1')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reminded: 2 });
  });

  it('403 si non-joueur', async () => {
    prismaMock.match.findUnique.mockResolvedValue(pending as any);
    const res = await request(app).post('/api/matches/m1/remind').set('Authorization', `Bearer ${token('intrus')}`);
    expect(res.status).toBe(403);
  });

  it('409 si match non PENDING', async () => {
    prismaMock.match.findUnique.mockResolvedValue({ ...pending, status: 'CONFIRMED' } as any);
    const res = await request(app).post('/api/matches/m1/remind').set('Authorization', `Bearer ${token('u1')}`);
    expect(res.status).toBe(409);
  });

  it('429 si rate-limited', async () => {
    prismaMock.match.findUnique.mockResolvedValue(pending as any);
    assertRateLimitMock.mockRejectedValue(new Error('RATE_LIMITED'));
    const res = await request(app).post('/api/matches/m1/remind').set('Authorization', `Bearer ${token('u1')}`);
    expect(res.status).toBe(429);
  });
});
```

- [ ] **Step 2 : Lancer → échoue**

Run: `cd backend && node node_modules/jest/bin/jest.js src/routes/__tests__/match.routes.test.ts -t "remind"`
Expected: FAIL (route 404, et 429 non mappé).

- [ ] **Step 3 : Implémenter**

Dans `backend/src/routes/matches.ts`, ajouter `RATE_LIMITED: 429` au map de `matchError` :

```ts
    LEVEL_SYSTEM_DISABLED: 403, FORBIDDEN: 403, MATCH_NOT_DISPUTED: 409, RATE_LIMITED: 429,
```

Ajouter la route après la route `dispute` (ligne 37) :

```ts
router.post('/:id/remind', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await matchService.remind(asString(req.params.id), req.user!.id)); }
  catch (err) { matchError(err, res, next); }
});
```

- [ ] **Step 4 : Lancer → passe**

Run: `cd backend && node node_modules/jest/bin/jest.js src/routes/__tests__/match.routes.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/matches.ts backend/src/routes/__tests__/match.routes.test.ts
git commit -m "feat(matchs): route POST /api/matches/:id/remind"
```

---

## Task 5 : Frontend — types + client API

**Files:**
- Modify: `frontend/lib/api.ts:1299-1336` (types) et `:129-132` (méthode)

- [ ] **Step 1 : Implémenter les types**

Dans `frontend/lib/api.ts`, enrichir `MyMatchPlayer` (ligne 1299) :

```ts
export interface MyMatchPlayer {
  userId: string;
  team: number;
  firstName: string;
  lastName: string;
  isMe: boolean;
  confirmation?: 'PENDING' | 'CONFIRMED' | 'DISPUTED';
}
```

Enrichir `MyMatch` (ligne 1319) — ajouter `confirmDeadline?: string;` après `playedAt` :

```ts
  playedAt: string;
  confirmDeadline?: string;
```

Ajouter la méthode `remindMatch` juste après `disputeMatch` (ligne 132) :

```ts
  remindMatch: (matchId: string, token: string) =>
    request<{ reminded: number }>(`/api/matches/${matchId}/remind`, { method: 'POST' }, token),
```

- [ ] **Step 2 : Type-check**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "api\.ts" || echo "OK"`
Expected: `OK` (aucune erreur sur api.ts).

- [ ] **Step 3 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(matchs): types confirmation/confirmDeadline + api.remindMatch"
```

---

## Task 6 : Frontend — `MyMatchesList` (pastilles + compteur + compte à rebours + Relancer)

**Files:**
- Modify: `frontend/components/match/MyMatchesList.tsx`
- Test: `frontend/__tests__/MyMatchesList.test.tsx`

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `MyMatchesList.test.tsx` : (a) ajouter `remindMatch: jest.fn().mockResolvedValue({ reminded: 1 }),` au mock `api` ; (b) ajouter `confirmation` aux joueurs du fixture `base` et un `confirmDeadline` :

```ts
// dans `base` : confirmDeadline + confirmation par joueur
  confirmDeadline: '2026-06-23T16:30:00Z',
  players: [
    { userId: 'u1', team: 2, firstName: 'Eric', lastName: 'Nougayrede', isMe: true, confirmation: 'CONFIRMED' },
    { userId: 'u2', team: 2, firstName: 'Marie', lastName: 'Durand', isMe: false, confirmation: 'CONFIRMED' },
    { userId: 'u3', team: 1, firstName: 'Paul', lastName: 'Roy', isMe: false, confirmation: 'PENDING' },
    { userId: 'u4', team: 1, firstName: 'Lea', lastName: 'Martin', isMe: false, confirmation: 'PENDING' },
  ],
```

Ajouter ces tests :

```ts
it('affiche le compteur de validations et le compte à rebours d auto-validation', () => {
  renderWithTheme(<MyMatchesList matches={matches as any} token="t" onChanged={jest.fn()} />);
  expect(screen.getByText('2/4 validé')).toBeInTheDocument();
  expect(screen.getByText(/Se valide automatiquement/i)).toBeInTheDocument();
});

it('relance les joueurs en attente au clic', async () => {
  renderWithTheme(<MyMatchesList matches={matches as any} token="t" onChanged={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Relancer/i }));
  await waitFor(() => expect(api.remindMatch).toHaveBeenCalledWith('m1', 't'));
  expect(await screen.findByText(/Relance envoyée/i)).toBeInTheDocument();
});

it('affiche « déjà relancé » sur 429', async () => {
  (api.remindMatch as jest.Mock).mockRejectedValueOnce(new Error('RATE_LIMITED'));
  renderWithTheme(<MyMatchesList matches={matches as any} token="t" onChanged={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Relancer/i }));
  expect(await screen.findByText(/Déjà relancé/i)).toBeInTheDocument();
});

it('pas de bouton Relancer si tous les autres ont validé', () => {
  const done = [{ ...base, players: base.players.map((p) => ({ ...p, confirmation: 'CONFIRMED' })) }];
  renderWithTheme(<MyMatchesList matches={done as any} token="t" onChanged={jest.fn()} />);
  expect(screen.queryByRole('button', { name: /Relancer/i })).toBeNull();
});
```

- [ ] **Step 2 : Lancer → échoue**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/MyMatchesList.test.tsx`
Expected: FAIL (compteur / bouton absents).

- [ ] **Step 3 : Implémenter**

Dans `frontend/components/match/MyMatchesList.tsx` :

Ajouter `useEffect` à l'import React (ligne 2) :

```ts
import { useState, useEffect } from 'react';
```

Dans le composant `MyMatchesList`, après les états existants (ligne ~72), ajouter :

```ts
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  const [remindBusy, setRemindBusy] = useState<string | null>(null);
  const [remindMsg, setRemindMsg] = useState<{ id: string; text: string } | null>(null);

  const remind = async (id: string) => {
    setRemindBusy(id);
    setRemindMsg(null);
    try {
      await api.remindMatch(id, token);
      setRemindMsg({ id, text: 'Relance envoyée ✓' });
    } catch (e) {
      const msg = (e as Error).message || '';
      setRemindMsg({ id, text: msg.includes('RATE_LIMITED') ? 'Déjà relancé, réessaie plus tard.' : 'Échec de la relance.' });
    } finally {
      setRemindBusy(null);
    }
  };
```

Dans le `matches.map`, après le calcul de `result` (ligne ~97), ajouter les dérivés :

```ts
        const confirmedCount = (m.players ?? []).filter((p) => p.confirmation === 'CONFIRMED').length;
        const pendingOthers = (m.players ?? []).filter((p) => !p.isMe && p.confirmation === 'PENDING');
        const showValidation = m.status === 'PENDING';
        const autoValidateText = showValidation && m.confirmDeadline
          ? (now != null && new Date(m.confirmDeadline).getTime() <= now
              ? 'Validation en cours…'
              : `Se valide automatiquement le ${formatDateTime(m.confirmDeadline)}`)
          : null;
```

Après le bloc club/terrain (ligne ~127, la `<div className="mt-3">…</div>`), insérer la zone « validation » (seulement pour PENDING) :

```tsx
            {showValidation && (
              <div className="mt-2" style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 700, color: th.text }}>{confirmedCount}/4 validé</span>
                {autoValidateText && <span>✅ {autoValidateText}</span>}
                {pendingOthers.length > 0 && (
                  <button type="button" disabled={remindBusy === m.matchId} onClick={() => remind(m.matchId)}
                    className="rounded-lg bg-black/10 px-3 py-1.5 text-sm disabled:opacity-40">🔔 Relancer</button>
                )}
                {remindMsg?.id === m.matchId && <span style={{ color: th.textMute }}>{remindMsg.text}</span>}
              </div>
            )}
```

Enfin, dans `ScoreboardRow`, ajouter une pastille de validation sur chaque avatar. Modifier la signature pour recevoir `showConfirmations` :

```tsx
function ScoreboardRow({ players, side, sets, th, showConfirmations }: {
  players: MyMatchPlayer[]; side: number; sets: [number, number][]; th: Theme; showConfirmations?: boolean;
}) {
```

Dans le `players.map` des avatars (ligne ~19), envelopper l'`Avatar` avec un badge en position :

```tsx
            <span key={p.userId} style={{ position: 'relative', marginLeft: i > 0 ? -7 : 0, borderRadius: '50%', boxShadow: `0 0 0 2px ${th.surface}`, lineHeight: 0 }}>
              <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={null} size={26} color={colorForSeed(p.userId)} />
              {showConfirmations && p.confirmation && (
                <span aria-hidden style={{
                  position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: '50%',
                  border: `2px solid ${th.surface}`, fontSize: 8, lineHeight: '8px', textAlign: 'center',
                  background: p.confirmation === 'CONFIRMED' ? ACCENTS.emerald : p.confirmation === 'DISPUTED' ? ACCENTS.coral : th.line,
                  color: '#fff',
                }}>{p.confirmation === 'CONFIRMED' ? '✓' : p.confirmation === 'DISPUTED' ? '!' : ''}</span>
              )}
            </span>
```

Et passer `showConfirmations={showValidation}` aux deux `<ScoreboardRow>` (lignes ~120 et ~122).

- [ ] **Step 4 : Lancer → passe**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/MyMatchesList.test.tsx`
Expected: PASS (anciens tests + nouveaux).

- [ ] **Step 5 : Type-check**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "MyMatchesList" || echo "OK"`
Expected: `OK`.

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/match/MyMatchesList.tsx frontend/__tests__/MyMatchesList.test.tsx
git commit -m "feat(matchs): MyMatchesList — qui a valide, compte a rebours auto-validation, bouton Relancer"
```

---

## Vérification finale

- [ ] **Backend — suites concernées vertes**

Run: `cd backend && node node_modules/jest/bin/jest.js src/routes/__tests__/me.routes.test.ts src/routes/__tests__/match.routes.test.ts src/services/__tests__/match.service.test.ts src/email/__tests__/notifications.match.test.ts`
Expected: PASS.

- [ ] **Frontend — suite + tsc**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/MyMatchesList.test.tsx && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "MyMatchesList|api\.ts" || echo "TSC OK"`
Expected: PASS + `TSC OK`.

- [ ] **Backend tsc**

Run: `cd backend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "match.service|matches.ts|notifications.ts|me.ts" || echo "TSC OK"`
Expected: `TSC OK`.

- [ ] **Vérif visuelle (CDP, skill `verify`)** — avec un match PENDING seedé (`backend/scripts/seed-test-matches.mjs`), charger `/me/matches` connecté et confirmer : pastilles ✓/⏳, « N/4 validé », compte à rebours, bouton Relancer (clic → « Relance envoyée »).

## Notes

- **Ordre des tâches** : 1→6 dans l'ordre (Task 3 importe la fonction de Task 2 ; Task 6 dépend des types de Task 5).
- **Aucune migration.** Aucun nouveau type d'email (option A : réutilisation de `match.pending_confirmation`).
- **Branche** : le repo est sur `feat/seo-referencement` ; committer sur la branche courante sauf indication contraire.
