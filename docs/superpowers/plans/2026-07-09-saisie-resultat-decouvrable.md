# Saisie du résultat découvrable + équipes pré-remplies — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la saisie du résultat d'un match padel découvrable (bandeaux Club-house + Parties + section « À saisir » + notification post-match) et supprimer la re-saisie des équipes déjà connues.

**Architecture :** Un nouvel endpoint backend `GET /api/me/matches/to-record` liste les réservations padel jouées (< 7 j, 4 participants, sans résultat) où le joueur est **participant** (pas seulement organisateur) — c'est indispensable car `listUserReservations` ne renvoie que les réservations dont on est l'organisateur. Un composant frontend partagé `ResultsToRecord` consomme cet endpoint et est posé sur 3 surfaces. La modale `MatchResultModal` gagne un mode « résumé + Modifier » quand les équipes sont pré-remplies. Une passe supplémentaire du job cron de rappels existant envoie une notification (cloche + push) ~15 min après la fin du match.

**Tech Stack :** Express 5 + Prisma 7 (backend), Next.js 16 + React 19 (frontend), Jest + React Testing Library, node-cron.

**Référence spec :** `docs/superpowers/specs/2026-07-09-saisie-resultat-decouvrable-design.md`

**Notes d'environnement (mémoire projet) :**
- Backend jest/tsc via shims cassés → lancer `node node_modules/jest/bin/jest.js <chemin>` et `node node_modules/typescript/bin/tsc --noEmit` **depuis** `backend/` (idem `frontend/`). Le cwd PowerShell se réinitialise à chaque commande → toujours `cd` dans la même commande.
- Frontend jest ne type-check PAS (`isolatedModules`) → toujours un passage `tsc --noEmit` séparé.
- Suites *real-mount* `ClubNav` (`ClubReserve.*`, `OpenMatches`) : elles montent le vrai `ClubNav`/`OpenMatches` et mockent `lib/api` — tout nouvel `api.*` ajouté à un composant qu'elles montent casse leur mock. Ce plan ajoute `api.getMatchesToRecord` consommé par `ClubHouse` et `OpenMatches` → penser aux mocks (Tasks 6, 8, 9).

---

## File Structure

**Backend :**
- `backend/src/services/match.service.ts` — MODIFIER : ajouter `listToRecord(userId, now)`.
- `backend/src/routes/me.ts` — MODIFIER : ajouter `GET /matches/to-record`.
- `backend/src/email/notifications.ts` — MODIFIER : ajouter `notifyMatchResultPrompt(reservationId)`.
- `backend/src/jobs/reminders.job.ts` — MODIFIER : ajouter la passe post-match.
- Tests : `match.service.test.ts`, `me.routes.test.ts`, `notifications.match.test.ts`, `reminders.job.test.ts` (tous existants, à étendre).

**Frontend :**
- `frontend/lib/api.ts` — MODIFIER : type `MatchToRecord` + `api.getMatchesToRecord`.
- `frontend/components/match/MatchResultModal.tsx` — MODIFIER : mode « résumé + Modifier ».
- `frontend/components/match/ResultsToRecord.tsx` — CRÉER : composant partagé (fetch + cartes + modale).
- `frontend/components/ClubHouse.tsx` — MODIFIER : monter `ResultsToRecord`.
- `frontend/components/openmatch/OpenMatches.tsx` — MODIFIER : monter `ResultsToRecord` (vues parties + matchs).
- `frontend/app/me/matches/page.tsx` — MODIFIER : monter `ResultsToRecord`.
- `frontend/app/me/reservations/page.tsx` — MODIFIER : passer `initialTeams` à la modale.
- Tests : `MatchResultModal.test.tsx` (étendre), `ResultsToRecord.test.tsx` (créer).

---

## Task 1 : Backend — `MatchService.listToRecord`

**Files:**
- Modify: `backend/src/services/match.service.ts` (ajout d'une méthode dans la classe)
- Test: `backend/src/services/__tests__/match.service.test.ts`

Contexte : le mock Prisma est `prismaMock` (voir tête du fichier de test). `effectiveTeams` vit dans `backend/src/services/matchTeams.ts` et `playerCount` dans `backend/src/utils/courtType.ts`. La méthode ne fait qu'une requête `reservation.findMany` puis mappe.

- [ ] **Step 1: Écrire les tests d'abord**

Ajouter à la fin de `backend/src/services/__tests__/match.service.test.ts` :

```typescript
describe('listToRecord', () => {
  const NOW2 = new Date('2026-06-11T10:00:00Z');
  const baseReservation = () => ({
    id: 'r1',
    startTime: new Date('2026-06-10T18:00:00Z'),
    endTime: new Date('2026-06-10T19:30:00Z'),
    resource: {
      name: 'Court 1',
      attributes: { format: 'DOUBLE' },
      clubSport: { sport: { key: 'padel', name: 'Padel' } },
      club: { slug: 'arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
    },
    participants: [
      { userId: 'u1', isOrganizer: true, team: 1, slot: 0, user: { firstName: 'A', lastName: 'A', avatarUrl: null } },
      { userId: 'u2', isOrganizer: false, team: 1, slot: 1, user: { firstName: 'B', lastName: 'B', avatarUrl: null } },
      { userId: 'u3', isOrganizer: false, team: 2, slot: 0, user: { firstName: 'C', lastName: 'C', avatarUrl: null } },
      { userId: 'u4', isOrganizer: false, team: 2, slot: 1, user: { firstName: 'D', lastName: 'D', avatarUrl: null } },
    ],
    matches: [],
  });

  it('renvoie une entrée avec équipes concrètes pour un participant non-organisateur', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([baseReservation()] as any);
    const rows = await service.listToRecord('u3', NOW2);
    expect(rows).toHaveLength(1);
    expect(rows[0].reservationId).toBe('r1');
    expect(rows[0].club.slug).toBe('arena');
    expect(rows[0].resourceName).toBe('Court 1');
    expect(rows[0].sport.key).toBe('padel');
    expect(rows[0].players).toHaveLength(4);
    const u1 = rows[0].players.find((p) => p.userId === 'u1')!;
    expect(u1.team).toBe(1);
    expect(u1.slot).toBe(0);
  });

  it('exclut les réservations avec un Match non annulé', async () => {
    const r = baseReservation();
    r.matches = [{ status: 'PENDING' }] as any;
    prismaMock.reservation.findMany.mockResolvedValue([r] as any);
    const rows = await service.listToRecord('u1', NOW2);
    expect(rows).toHaveLength(0);
  });

  it('ré-inclut une réservation dont le seul Match est CANCELLED', async () => {
    const r = baseReservation();
    r.matches = [{ status: 'CANCELLED' }] as any;
    prismaMock.reservation.findMany.mockResolvedValue([r] as any);
    const rows = await service.listToRecord('u1', NOW2);
    expect(rows).toHaveLength(1);
  });

  it('exclut les réservations à moins de 4 participants', async () => {
    const r = baseReservation();
    r.participants = r.participants.slice(0, 3);
    prismaMock.reservation.findMany.mockResolvedValue([r] as any);
    const rows = await service.listToRecord('u1', NOW2);
    expect(rows).toHaveLength(0);
  });

  it('interroge la fenêtre 7 jours et le club à niveau activé', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([] as any);
    await service.listToRecord('u1', NOW2);
    const arg = (prismaMock.reservation.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.type).toBe('COURT');
    expect(arg.where.status).toBe('CONFIRMED');
    expect(arg.where.endTime.lte).toEqual(NOW2);
    expect(arg.where.endTime.gte).toEqual(new Date(NOW2.getTime() - 7 * 24 * 3600 * 1000));
    expect(arg.where.participants.some.userId).toBe('u1');
    expect(arg.where.resource.club.levelSystemEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `cd backend; node node_modules/jest/bin/jest.js src/services/__tests__/match.service.test.ts`
Expected: FAIL — `service.listToRecord is not a function`.

- [ ] **Step 3: Implémenter `listToRecord`**

Dans `backend/src/services/match.service.ts`, ajouter les imports en tête (après les imports existants) :

```typescript
import { effectiveTeams } from './matchTeams';
import { playerCount } from '../utils/courtType';
```

Puis ajouter cette méthode dans la classe `MatchService` (par ex. juste après `createFromReservation`) :

```typescript
  /**
   * Réservations padel jouées (< 7 j) où `userId` est PARTICIPANT (pas seulement organisateur),
   * à 4 joueurs, sans résultat non annulé, club à niveau activé — prêtes à saisir.
   * Le côté/slot d'équipe est résolu à la lecture (effectiveTeams), comme listUserReservations.
   */
  async listToRecord(userId: string, now: Date) {
    const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const rows = await prisma.reservation.findMany({
      where: {
        type: 'COURT',
        status: 'CONFIRMED',
        endTime: { lte: now, gte: from },
        participants: { some: { userId } },
        resource: { club: { levelSystemEnabled: true } },
      },
      orderBy: { endTime: 'desc' },
      select: {
        id: true, startTime: true, endTime: true,
        resource: {
          select: {
            name: true, attributes: true,
            clubSport: { select: { sport: { select: { key: true, name: true } } } },
            club: { select: { slug: true, name: true, timezone: true } },
          },
        },
        participants: {
          orderBy: { joinedAt: 'asc' },
          select: { userId: true, isOrganizer: true, team: true, slot: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        },
        matches: { where: { status: { not: 'CANCELLED' } }, select: { status: true } },
      },
    });

    return rows
      .filter((r) => r.participants.length === 4 && r.matches.length === 0)
      .map((r) => {
        const capacity = playerCount((r.resource.attributes as { format?: string } | null)?.format);
        const teamed = effectiveTeams(r.participants, capacity);
        return {
          reservationId: r.id,
          startTime: r.startTime,
          endTime: r.endTime,
          club: { slug: r.resource.club.slug, name: r.resource.club.name, timezone: r.resource.club.timezone },
          resourceName: r.resource.name,
          sport: { key: r.resource.clubSport.sport.key, name: r.resource.clubSport.sport.name },
          players: teamed.map((p) => ({
            userId: p.userId, isOrganizer: p.isOrganizer,
            firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl,
            team: p.team, slot: p.slot,
          })),
        };
      });
  }
```

Note : `matches` est la relation `Reservation.matches` (inverse de `Match.reservation`). Le filtre `where: { status: { not: 'CANCELLED' } }` fait que `r.matches` ne contient que les résultats actifs → `length === 0` signifie « saisissable ».

- [ ] **Step 4: Lancer les tests → succès attendu**

Run: `cd backend; node node_modules/jest/bin/jest.js src/services/__tests__/match.service.test.ts`
Expected: PASS (tous, dont les 5 nouveaux).

- [ ] **Step 5: Vérifier les types**

Run: `cd backend; node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur sur `match.service.ts`. (S'il reste des erreurs préexistantes sur d'autres fichiers, les ignorer.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/match.service.ts backend/src/services/__tests__/match.service.test.ts
git commit -m "feat(match): listToRecord — reservations jouees pretes a saisir"
```

---

## Task 2 : Backend — route `GET /api/me/matches/to-record`

**Files:**
- Modify: `backend/src/routes/me.ts` (nouvelle route après `GET /matches`, ligne ~286)
- Test: `backend/src/routes/__tests__/me.routes.test.ts`

Contexte : `matchService` n'est pas encore instancié dans `me.ts`. `MatchService` s'importe depuis `../services/match.service`. Le mock Prisma renvoie ce qu'on lui dit ; on teste la forme et l'auth.

- [ ] **Step 1: Écrire le test d'abord**

Ajouter à `backend/src/routes/__tests__/me.routes.test.ts` (nouveau `describe` en fin de fichier) :

```typescript
describe('GET /api/me/matches/to-record', () => {
  it('401 sans token', async () => {
    const res = await request(app).get('/api/me/matches/to-record');
    expect(res.status).toBe(401);
  });

  it('renvoie la liste des matchs à saisir', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([{
      id: 'r1',
      startTime: new Date('2026-06-10T18:00:00Z'),
      endTime: new Date('2026-06-10T19:30:00Z'),
      resource: {
        name: 'Court 1', attributes: { format: 'DOUBLE' },
        clubSport: { sport: { key: 'padel', name: 'Padel' } },
        club: { slug: 'arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
      },
      participants: [
        { userId: 'u1', isOrganizer: true, team: 1, slot: 0, user: { firstName: 'A', lastName: 'A', avatarUrl: null } },
        { userId: 'u2', isOrganizer: false, team: 1, slot: 1, user: { firstName: 'B', lastName: 'B', avatarUrl: null } },
        { userId: 'u3', isOrganizer: false, team: 2, slot: 0, user: { firstName: 'C', lastName: 'C', avatarUrl: null } },
        { userId: 'u4', isOrganizer: false, team: 2, slot: 1, user: { firstName: 'D', lastName: 'D', avatarUrl: null } },
      ],
      matches: [],
    }] as any);
    const res = await request(app).get('/api/me/matches/to-record').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].reservationId).toBe('r1');
    expect(res.body[0].players).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `cd backend; node node_modules/jest/bin/jest.js src/routes/__tests__/me.routes.test.ts -t "to-record"`
Expected: FAIL — 404 (route inexistante) au lieu de 200/401.

- [ ] **Step 3: Ajouter la route**

Dans `backend/src/routes/me.ts`, ajouter en tête l'import et l'instance (près des autres services, lignes ~8-26) :

```typescript
import { MatchService } from '../services/match.service';
```
```typescript
const matchService = new MatchService();
```

Puis, **juste après** le bloc `router.get('/matches', …)` (qui se termine ligne ~286), ajouter :

```typescript
// Réservations padel jouées, prêtes à saisir (participant, pas seulement organisateur).
router.get('/matches/to-record', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await matchService.listToRecord(req.user!.id, new Date()));
  } catch (err) { next(err); }
});
```

⚠️ **Ordre des routes** : `/matches/to-record` doit être déclarée **après** `/matches` mais ce n'est pas un conflit (chemins distincts, pas de param). Aucune route `/matches/:x` n'existe dans `me.ts`, donc pas de capture parasite.

- [ ] **Step 4: Lancer le test → succès attendu**

Run: `cd backend; node node_modules/jest/bin/jest.js src/routes/__tests__/me.routes.test.ts -t "to-record"`
Expected: PASS (2 tests).

- [ ] **Step 5: Vérifier les types + suite complète du fichier**

Run: `cd backend; node node_modules/typescript/bin/tsc --noEmit; node node_modules/jest/bin/jest.js src/routes/__tests__/me.routes.test.ts`
Expected: pas de nouvelle erreur de type ; tous les tests du fichier passent.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts
git commit -m "feat(api): GET /api/me/matches/to-record"
```

---

## Task 3 : Backend — notifier `notifyMatchResultPrompt`

**Files:**
- Modify: `backend/src/email/notifications.ts` (nouvelle fonction exportée)
- Test: `backend/src/email/__tests__/notifications.match.test.ts`

Contexte : `dispatch` accepte un `email` optionnel — on l'omet → cloche + push seulement, pas d'email, pas d'entrée dans le registre. `clubAppUrl(slug, path)` construit l'URL du sous-domaine club. Le test mocke `dispatch`.

- [ ] **Step 1: Écrire le test d'abord**

Ajouter à `backend/src/email/__tests__/notifications.match.test.ts` (importer aussi la nouvelle fonction en tête) :

```typescript
import { notifyMatchResultPrompt } from '../notifications';
```
```typescript
describe('notifyMatchResultPrompt → dispatch', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('dispatch MY_MATCHES/match.to_record aux 4 joueurs, sans email', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'resa-1',
      resource: { name: 'Court 1', club, clubSport: { sport: { key: 'padel' } } },
      participants: [
        { userId: 'p1', user: { firstName: 'Alice' } },
        { userId: 'p2', user: { firstName: 'Bob' } },
        { userId: 'p3', user: { firstName: 'Carol' } },
        { userId: 'p4', user: { firstName: 'David' } },
      ],
      matches: [],
    } as any);

    await notifyMatchResultPrompt('resa-1');

    expect(dispatchMock).toHaveBeenCalledTimes(4);
    const call = dispatchMock.mock.calls[0][0];
    expect(call.category).toBe('MY_MATCHES');
    expect(call.type).toBe('match.to_record');
    expect(call.clubId).toBe('club-1');
    expect(call.email).toBeUndefined();
    expect(call.url).toContain('/me/matches');
  });

  it('ne dispatch rien si un Match non annulé existe', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'resa-1',
      resource: { name: 'Court 1', club, clubSport: { sport: { key: 'padel' } } },
      participants: [
        { userId: 'p1', user: { firstName: 'Alice' } },
        { userId: 'p2', user: { firstName: 'Bob' } },
        { userId: 'p3', user: { firstName: 'Carol' } },
        { userId: 'p4', user: { firstName: 'David' } },
      ],
      matches: [{ status: 'PENDING' }],
    } as any);

    await notifyMatchResultPrompt('resa-1');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
```

Note : `club` est déjà défini en tête du fichier de test (`{ id: 'club-1', … }`).

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `cd backend; node node_modules/jest/bin/jest.js src/email/__tests__/notifications.match.test.ts -t "notifyMatchResultPrompt"`
Expected: FAIL — `notifyMatchResultPrompt is not a function`.

- [ ] **Step 3: Implémenter le notifier**

Dans `backend/src/email/notifications.ts`, ajouter cette fonction (par ex. juste après `notifyMatchPendingConfirmation`, ~ligne 1024) :

```typescript
/**
 * Invite chacun des 4 joueurs à saisir le résultat après un match padel joué.
 * Cloche + push seulement (pas d'email → pas de type dans le registre).
 * Re-vérifie les gardes ; ne fait rien si le match n'est plus saisissable.
 */
export async function notifyMatchResultPrompt(reservationId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: {
        select: {
          name: true,
          clubSport: { select: { sport: { select: { key: true } } } },
          club: { select: { id: true, slug: true, levelSystemEnabled: true } },
        },
      },
      participants: { select: { userId: true } },
      matches: { where: { status: { not: 'CANCELLED' } }, select: { status: true } },
    },
  });
  if (!resa) return;
  if (resa.participants.length !== 4) return;
  if (resa.matches.length > 0) return;
  if (!resa.resource.club.levelSystemEnabled) return;
  if (resa.resource.clubSport.sport.key !== 'padel') return;

  const url = clubAppUrl(resa.resource.club.slug, '/me/matches');
  for (const p of resa.participants) {
    await dispatch({
      userId: p.userId,
      clubId: resa.resource.club.id,
      category: 'MY_MATCHES',
      type: 'match.to_record',
      title: "Comment s'est passé votre match ?",
      body: `Saisissez le résultat de votre partie sur ${resa.resource.name}.`,
      url,
    });
  }
}
```

- [ ] **Step 4: Lancer le test → succès attendu**

Run: `cd backend; node node_modules/jest/bin/jest.js src/email/__tests__/notifications.match.test.ts`
Expected: PASS (dont les 2 nouveaux).

- [ ] **Step 5: Vérifier les types**

Run: `cd backend; node node_modules/typescript/bin/tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 6: Commit**

```bash
git add backend/src/email/notifications.ts backend/src/email/__tests__/notifications.match.test.ts
git commit -m "feat(notif): notifyMatchResultPrompt (cloche + push, sans email)"
```

---

## Task 4 : Backend — passe post-match du job de rappels

**Files:**
- Modify: `backend/src/jobs/reminders.job.ts`
- Test: `backend/src/jobs/__tests__/reminders.job.test.ts`

Contexte : `runReminders(now)` boucle déjà sur `REMINDER_WINDOWS` (sur `startTime`). On ajoute une passe distincte sur `endTime` avec lead 15 min, tranche `[now − 30 min, now − 15 min]`. Idempotence par tranche (même compromis best-effort que le reste du job).

- [ ] **Step 1: Écrire les tests d'abord**

Ajouter à `backend/src/jobs/__tests__/reminders.job.test.ts` — d'abord importer le notifier et le mocker :

Remplacer le bloc `jest.mock` du haut par :

```typescript
jest.mock('../../email/notifications', () => ({
  notifyReservationReminder: jest.fn(),
  notifyMatchResultPrompt: jest.fn(),
}));

import { notifyReservationReminder, notifyMatchResultPrompt } from '../../email/notifications';
```

Puis ajouter un `describe` :

```typescript
describe('runReminders — passe post-match', () => {
  const promptMock = notifyMatchResultPrompt as jest.Mock;
  const fixedNow2 = new Date('2026-07-01T12:00:00Z');

  beforeEach(() => {
    promptMock.mockReset();
    (notifyReservationReminder as jest.Mock).mockReset();
    // 1er appel findMany = fenêtre J-1, 2e = H-2, 3e = passe post-match.
    prismaMock.reservation.findMany.mockResolvedValue([{ id: 'rp1' }] as any);
  });

  it('notifie le résultat pour les réservations finies dans la tranche [-30min, -15min]', async () => {
    await runReminders(fixedNow2);
    expect(promptMock).toHaveBeenCalledWith('rp1');
    // La requête post-match cible endTime dans la bonne tranche.
    const postCall = (prismaMock.reservation.findMany as jest.Mock).mock.calls.find(
      (c) => c[0]?.where?.endTime,
    );
    expect(postCall).toBeTruthy();
    const expectedFrom = new Date(fixedNow2.getTime() - 30 * 60000);
    const expectedTo = new Date(fixedNow2.getTime() - 15 * 60000);
    expect(postCall[0].where.endTime).toEqual({ gt: expectedFrom, lte: expectedTo });
    expect(postCall[0].where.status).toBe('CONFIRMED');
  });

  it('un échec de notification post-match ne casse pas le job', async () => {
    promptMock.mockRejectedValueOnce(new Error('boom'));
    await expect(runReminders(fixedNow2)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `cd backend; node node_modules/jest/bin/jest.js src/jobs/__tests__/reminders.job.test.ts`
Expected: FAIL — `notifyMatchResultPrompt` jamais appelé (passe absente).

- [ ] **Step 3: Ajouter la passe post-match**

Dans `backend/src/jobs/reminders.job.ts` :

Modifier l'import :

```typescript
import { notifyReservationReminder, notifyMatchResultPrompt } from '../email/notifications';
```

Ajouter une constante sous `REMINDER_PERIOD_MIN` :

```typescript
// Invitation à saisir le résultat : lead 15 min après la fin du match (le temps de sortir
// du terrain). Tranche = [now − (lead + période), now − lead] = [-30min, -15min].
export const RESULT_PROMPT_LEAD_MIN = 15;
```

Dans `runReminders`, **après** la boucle `for (const w of REMINDER_WINDOWS) { … }`, ajouter :

```typescript
  // Passe post-match : réservations dont la fin tombe dans la tranche écoulée.
  const postFrom = new Date(now.getTime() - (RESULT_PROMPT_LEAD_MIN + REMINDER_PERIOD_MIN) * 60000);
  const postTo = new Date(now.getTime() - RESULT_PROMPT_LEAD_MIN * 60000);
  const played = await prisma.reservation.findMany({
    where: { status: 'CONFIRMED', type: 'COURT', endTime: { gt: postFrom, lte: postTo } },
    select: { id: true },
  });
  for (const r of played) {
    try {
      await notifyMatchResultPrompt(r.id);
    } catch (e) {
      console.error('[reminders:post-match]', (e as Error).message);
    }
  }
```

Note : `notifyMatchResultPrompt` re-vérifie 4 joueurs / pas de résultat / padel / niveau activé → la requête large ici (`type: COURT`) est filtrée finement par le notifier.

- [ ] **Step 4: Lancer les tests → succès attendu**

Run: `cd backend; node node_modules/jest/bin/jest.js src/jobs/__tests__/reminders.job.test.ts`
Expected: PASS (anciens + nouveaux). Note : le test existant « queries correct startTime bounds » itère sur `REMINDER_WINDOWS` et vérifie des appels `startTime` — il reste vert car on n'a pas touché ces appels.

- [ ] **Step 5: Vérifier les types**

Run: `cd backend; node node_modules/typescript/bin/tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 6: Commit**

```bash
git add backend/src/jobs/reminders.job.ts backend/src/jobs/__tests__/reminders.job.test.ts
git commit -m "feat(jobs): passe post-match — invite a saisir le resultat"
```

---

## Task 5 : Frontend — type + client API

**Files:**
- Modify: `frontend/lib/api.ts` (type `MatchToRecord` + méthode `getMatchesToRecord`)

Pas de test dédié (couvert par les tests de composants). Suivre le style des autres entrées `api.*`.

- [ ] **Step 1: Ajouter le type**

Dans `frontend/lib/api.ts`, près de `MyMatch`/`MyReservation` (~ligne 1080), ajouter :

```typescript
export interface MatchToRecordPlayer {
  userId: string;
  isOrganizer: boolean;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  team: 1 | 2;
  slot: number;
}

export interface MatchToRecord {
  reservationId: string;
  startTime: string;
  endTime: string;
  club: { slug: string; name: string; timezone: string };
  resourceName: string;
  sport: { key: string; name: string };
  players: MatchToRecordPlayer[];
}
```

- [ ] **Step 2: Ajouter la méthode API**

Dans le bloc `// --- Résultats de matchs (Lot 2) ---` (après `getMyMatches`, ~ligne 121) :

```typescript
  getMatchesToRecord: (token: string) => request<MatchToRecord[]>('/api/me/matches/to-record', {}, token),
```

- [ ] **Step 3: Vérifier les types**

Run: `cd frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): type MatchToRecord + getMatchesToRecord"
```

---

## Task 6 : Frontend — `MatchResultModal` mode « résumé + Modifier »

**Files:**
- Modify: `frontend/components/match/MatchResultModal.tsx`
- Test: `frontend/__tests__/MatchResultModal.test.tsx`

Contexte : la modale reçoit `initialTeams?: Record<string, 1 | 2>`. Quand il couvre les 4 joueurs en 2/2, on affiche un résumé + « Modifier les équipes ». Sinon, l'écran d'affectation actuel (inchangé). L'état `team` est déjà pré-rempli depuis `initialTeams`.

- [ ] **Step 1: Écrire les tests d'abord**

Ajouter à `frontend/__tests__/MatchResultModal.test.tsx` :

```typescript
const fullTeams = { u1: 1, u2: 1, u3: 2, u4: 2 } as Record<string, 1 | 2>;

describe('MatchResultModal — mode résumé', () => {
  it('montre le résumé et cache les boutons 1/2 quand les équipes sont complètes', () => {
    render(<ThemeProvider><MatchResultModal
      reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}}
      initialTeams={fullTeams} /></ThemeProvider>);
    // Résumé visible, affectation cachée.
    expect(screen.getByText('Modifier les équipes')).toBeInTheDocument();
    expect(screen.queryByTestId('team1-u1')).toBeNull();
    // Les sets restent accessibles.
    expect(screen.getByTestId('set0-team1-plus')).toBeInTheDocument();
  });

  it('« Modifier les équipes » révèle l\'affectation pré-remplie', () => {
    render(<ThemeProvider><MatchResultModal
      reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}}
      initialTeams={fullTeams} /></ThemeProvider>);
    fireEvent.click(screen.getByText('Modifier les équipes'));
    expect(screen.getByTestId('team1-u1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('team2-u3')).toHaveAttribute('data-active', 'true');
  });

  it('enregistre directement depuis le mode résumé', async () => {
    const onSaved = jest.fn();
    render(<ThemeProvider><MatchResultModal
      reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={onSaved}
      initialTeams={fullTeams} /></ThemeProvider>);
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set0-team1-plus'));
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
    const call = (api.recordMatchResult as jest.Mock).mock.calls.at(-1)!;
    expect(call[1].teams[1]).toEqual(expect.arrayContaining(['u1', 'u2']));
    expect(call[1].teams[2]).toEqual(expect.arrayContaining(['u3', 'u4']));
  });

  it('affiche l\'affectation directe si initialTeams incomplet', () => {
    render(<ThemeProvider><MatchResultModal
      reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}}
      initialTeams={{ u1: 1, u2: 1 }} /></ThemeProvider>);
    expect(screen.queryByText('Modifier les équipes')).toBeNull();
    expect(screen.getByTestId('team1-u1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `cd frontend; node node_modules/jest/bin/jest.js __tests__/MatchResultModal.test.tsx -t "mode résumé"`
Expected: FAIL — « Modifier les équipes » introuvable.

- [ ] **Step 3: Implémenter le mode résumé**

Dans `frontend/components/match/MatchResultModal.tsx` :

Après la ligne `const [team, setTeam] = useState…` (ligne 33), ajouter la dérivation du mode et l'état d'édition :

```typescript
  // Équipes pré-remplies complètes (4 joueurs, 2/2) → mode résumé compact ; sinon affectation.
  const preFilled2v2 = (() => {
    if (!initialTeams) return false;
    const assigned = players.filter((p) => initialTeams[p.userId] === 1 || initialTeams[p.userId] === 2);
    if (assigned.length !== players.length || players.length !== 4) return false;
    return assigned.filter((p) => initialTeams[p.userId] === 1).length === 2
      && assigned.filter((p) => initialTeams[p.userId] === 2).length === 2;
  })();
  const [editingTeams, setEditingTeams] = useState(false);
  const showAssignment = !preFilled2v2 || editingTeams;
```

Remplacer le bloc d'affectation (le `<div className="mb-3 flex gap-2">…</div>` des compteurs Équipe 1/2 **et** le `<div className="mb-4 flex flex-col gap-2">…</div>` de la liste des joueurs, lignes 80-113) par un rendu conditionnel :

```tsx
        {showAssignment ? (
          <>
            <div className="mb-3 flex gap-2">
              {([1, 2] as const).map((n) => {
                const count = (n === 1 ? t1 : t2).length;
                return (
                  <div key={n} className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2" style={{ background: th.surface2 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: TEAM_COLORS[n] }} />
                    <span className="text-xs font-semibold">Équipe {n}</span>
                    <span className="ml-auto text-xs" style={{ color: th.textMute }}>{count}/2</span>
                  </div>
                );
              })}
            </div>

            <div className="mb-4 flex flex-col gap-2">
              {players.map((p) => (
                <div key={p.userId} className="flex items-center gap-3">
                  <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size={30} color={colorForSeed(p.userId)} />
                  <span className="flex-1 truncate text-sm">{p.firstName} {p.lastName}</span>
                  <span className="inline-flex overflow-hidden rounded-lg" style={{ border: `1px solid ${th.lineStrong}` }}>
                    {([1, 2] as const).map((t) => {
                      const active = team[p.userId] === t;
                      return (
                        <button key={t} type="button" data-testid={`team${t}-${p.userId}`} data-active={active ? 'true' : 'false'} aria-label={`Équipe ${t}`} disabled={teamFull(t, p.userId)}
                          onClick={() => assign(p.userId, t)}
                          className="px-3 py-1 text-sm font-semibold disabled:opacity-40"
                          style={active ? { background: TEAM_COLORS[t], color: inkOn(TEAM_COLORS[t]) } : { background: th.surface2, color: th.textMute }}>
                          {t}
                        </button>
                      );
                    })}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="mb-4 flex flex-col gap-2">
            {([1, 2] as const).map((n) => {
              const names = players.filter((p) => team[p.userId] === n).map((p) => `${p.firstName} ${p.lastName}`).join(' & ');
              return (
                <div key={n} className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ background: th.surface2 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: TEAM_COLORS[n], flexShrink: 0 }} />
                  <span className="text-xs font-semibold" style={{ color: th.textMute }}>Éq. {n}</span>
                  <span className="ml-1 truncate text-sm font-medium">{names}</span>
                </div>
              );
            })}
            <button type="button" onClick={() => setEditingTeams(true)} className="self-start text-sm underline" style={{ color: th.textMute }}>
              Modifier les équipes
            </button>
          </div>
        )}
```

- [ ] **Step 4: Lancer les tests → succès attendu**

Run: `cd frontend; node node_modules/jest/bin/jest.js __tests__/MatchResultModal.test.tsx`
Expected: PASS (anciens + nouveaux). Les anciens tests n'utilisent pas `initialTeams` complet → `showAssignment` reste `true` → boutons 1/2 présents comme avant.

- [ ] **Step 5: Vérifier les types**

Run: `cd frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/match/MatchResultModal.tsx frontend/__tests__/MatchResultModal.test.tsx
git commit -m "feat(match): modale — mode resume + Modifier les equipes"
```

---

## Task 7 : Frontend — passer `initialTeams` depuis Mes réservations

**Files:**
- Modify: `frontend/app/me/reservations/page.tsx:278-287`

Contexte : c'est la correction directe de l'irritant n°2. Le rendu `<MatchResultModal>` de cette page n'a pas de `initialTeams` ; `recordingFor.participants` porte `team`. Aligner sur `OpenMatchModals.tsx:24`.

- [ ] **Step 1: Ajouter `initialTeams`**

Dans `frontend/app/me/reservations/page.tsx`, dans le bloc `{recordingFor && token && (<MatchResultModal …>)}`, ajouter la prop `initialTeams` (après `players=…`) :

```tsx
          initialTeams={Object.fromEntries(
            (recordingFor.participants ?? [])
              .filter((p) => p.team === 1 || p.team === 2)
              .map((p) => [p.userId, p.team as 1 | 2]),
          )}
```

- [ ] **Step 2: Vérifier les types**

Run: `cd frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 3: Lancer la suite de la page si elle existe**

Run: `cd frontend; node node_modules/jest/bin/jest.js __tests__ -t "reservations" 2>&1 | tail -20`
Expected: pas de régression (s'il n'y a pas de suite ciblée, ce step est informatif).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/me/reservations/page.tsx
git commit -m "fix(reservations): pre-remplir les equipes de la modale de resultat"
```

---

## Task 8 : Frontend — composant partagé `ResultsToRecord`

**Files:**
- Create: `frontend/components/match/ResultsToRecord.tsx`
- Test: `frontend/__tests__/ResultsToRecord.test.tsx`

Contexte : autonome. Fetch `api.getMatchesToRecord(token)`, filtre par `clubSlug` si fourni, rend des cartes + monte `MatchResultModal` avec `initialTeams` dérivé. Après enregistrement : refetch local + `onRecorded?.()`. `Icon` a un `trophy`. `MatchResultModal` attend `players: { userId, firstName, lastName, avatarUrl }[]`.

- [ ] **Step 1: Écrire les tests d'abord**

Créer `frontend/__tests__/ResultsToRecord.test.tsx` :

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ResultsToRecord } from '@/components/match/ResultsToRecord';

const row = {
  reservationId: 'r1', startTime: '2026-06-10T18:00:00Z', endTime: '2026-06-10T19:30:00Z',
  club: { slug: 'arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
  resourceName: 'Court 1', sport: { key: 'padel', name: 'Padel' },
  players: [
    { userId: 'u1', isOrganizer: true, firstName: 'A', lastName: 'A', avatarUrl: null, team: 1, slot: 0 },
    { userId: 'u2', isOrganizer: false, firstName: 'B', lastName: 'B', avatarUrl: null, team: 1, slot: 1 },
    { userId: 'u3', isOrganizer: false, firstName: 'C', lastName: 'C', avatarUrl: null, team: 2, slot: 0 },
    { userId: 'u4', isOrganizer: false, firstName: 'D', lastName: 'D', avatarUrl: null, team: 2, slot: 1 },
  ],
};

jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: {
    getMatchesToRecord: jest.fn(),
    recordMatchResult: jest.fn().mockResolvedValue({ id: 'm1', status: 'PENDING' }),
  },
  assetUrl: (u: string) => u,
}));
import { api } from '@/lib/api';

const wrap = (props = {}) => render(<ThemeProvider><ResultsToRecord token="t" {...props} /></ThemeProvider>);

beforeEach(() => (api.getMatchesToRecord as jest.Mock).mockReset());

it('n\'affiche rien quand la liste est vide', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([]);
  const { container } = wrap();
  await waitFor(() => expect(api.getMatchesToRecord).toHaveBeenCalled());
  expect(container.textContent).not.toContain('Résultat à saisir');
});

it('affiche une carte par match et filtre par club', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row, { ...row, reservationId: 'r2', club: { ...row.club, slug: 'autre' } }]);
  wrap({ clubSlug: 'arena' });
  await waitFor(() => expect(screen.getByText(/Court 1/)).toBeInTheDocument());
  expect(screen.getAllByText(/Résultat à saisir/)).toHaveLength(1);
});

it('ouvre la modale pré-remplie et masque la carte après enregistrement', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row]);
  const onRecorded = jest.fn();
  wrap({ onRecorded });
  await waitFor(() => expect(screen.getByText('Saisir')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Saisir'));
  // Mode résumé (équipes pré-remplies) → « Modifier les équipes » visible, pas de boutons 1/2.
  expect(screen.getByText('Modifier les équipes')).toBeInTheDocument();
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set0-team1-plus'));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
  fireEvent.click(screen.getByText('Enregistrer'));
  await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
  expect(onRecorded).toHaveBeenCalled();
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `cd frontend; node node_modules/jest/bin/jest.js __tests__/ResultsToRecord.test.tsx`
Expected: FAIL — module `ResultsToRecord` introuvable.

- [ ] **Step 3: Créer le composant**

Créer `frontend/components/match/ResultsToRecord.tsx` :

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, MatchToRecord } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { MatchResultModal } from '@/components/match/MatchResultModal';

function fmtWhen(iso: string, tz: string): string {
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
  return `${date} · ${hour}`;
}

// Prompt personnel « Résultat à saisir » : liste les matchs padel joués sans résultat et
// ouvre la modale de saisie avec les équipes pré-remplies. Rendu null si rien à saisir.
// `clubSlug` restreint au club courant ; `onRecorded` laisse la surface parente se rafraîchir.
export function ResultsToRecord({ token, clubSlug, onRecorded }: {
  token: string | null;
  clubSlug?: string;
  onRecorded?: () => void;
}) {
  const { th } = useTheme();
  const [rows, setRows] = useState<MatchToRecord[]>([]);
  const [recordingFor, setRecordingFor] = useState<MatchToRecord | null>(null);

  const reload = useCallback(() => {
    if (!token) { setRows([]); return; }
    api.getMatchesToRecord(token)
      .then((r) => setRows(clubSlug ? r.filter((m) => m.club.slug === clubSlug) : r))
      .catch(() => setRows([]));
  }, [token, clubSlug]);

  useEffect(() => { reload(); }, [reload]);

  if (!token || rows.length === 0) return null;

  const tint = (hex: string) => (th.mode === 'floodlit' ? `${hex}1f` : `${hex}55`);

  return (
    <div style={{ padding: '18px 20px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((m) => (
          <div key={m.reservationId} style={{ display: 'flex', alignItems: 'center', gap: 12, background: th.surface, borderRadius: 16, padding: 14, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 12, background: tint(ACCENTS.emerald), flexShrink: 0 }}>
              <Icon name="trophy" size={20} color={ACCENTS.emerald} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: th.text }}>Résultat à saisir</div>
              <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.resourceName} · {fmtWhen(m.startTime, m.club.timezone)}
              </div>
            </div>
            <button type="button" onClick={() => setRecordingFor(m)}
              style={{ flexShrink: 0, border: 'none', cursor: 'pointer', borderRadius: 10, padding: '8px 14px', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>
              Saisir
            </button>
          </div>
        ))}
      </div>

      {recordingFor && token && (
        <MatchResultModal
          reservationId={recordingFor.reservationId}
          players={recordingFor.players.map((p) => ({ userId: p.userId, firstName: p.firstName, lastName: p.lastName, avatarUrl: p.avatarUrl }))}
          token={token}
          context={{ whenIso: recordingFor.startTime, tz: recordingFor.club.timezone, courtName: recordingFor.resourceName }}
          initialTeams={Object.fromEntries(recordingFor.players.map((p) => [p.userId, p.team]))}
          onClose={() => setRecordingFor(null)}
          onSaved={() => { setRecordingFor(null); reload(); onRecorded?.(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Lancer les tests → succès attendu**

Run: `cd frontend; node node_modules/jest/bin/jest.js __tests__/ResultsToRecord.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Vérifier les types**

Run: `cd frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: pas de nouvelle erreur. (Vérifier que `Icon` accepte `name="trophy"` — il est déjà utilisé ailleurs.)

- [ ] **Step 6: Commit**

```bash
git add frontend/components/match/ResultsToRecord.tsx frontend/__tests__/ResultsToRecord.test.tsx
git commit -m "feat(match): composant ResultsToRecord (prompt + modale pre-remplie)"
```

---

## Task 9 : Frontend — monter `ResultsToRecord` sur les 3 surfaces

**Files:**
- Modify: `frontend/components/ClubHouse.tsx`
- Modify: `frontend/components/openmatch/OpenMatches.tsx`
- Modify: `frontend/app/me/matches/page.tsx`
- Test: suites existantes `ClubHouse.test.tsx` / `OpenMatches.test.tsx` (ajouter le mock).

Contexte : `ResultsToRecord` rend `null` sans token / sans résultat, donc l'ajout est sûr partout. Il faut **gater sur `levelSystemEnabled`** pour ne pas fetcher sur un club sans niveau. ⚠️ toute suite qui monte ces composants et mocke `lib/api` doit exposer `getMatchesToRecord`.

- [ ] **Step 1: Club-house**

Dans `frontend/components/ClubHouse.tsx` :

Import (avec les autres composants clubhouse) :

```typescript
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
```

Dans le `return` (~ligne 161-165), **juste après** `<AnnouncementKiosk … />` et **avant** `{order.map(…)}` :

```tsx
      {club.levelSystemEnabled !== false && (
        <ResultsToRecord token={token} clubSlug={club.slug} />
      )}
```

- [ ] **Step 2: Parties (`OpenMatches`)**

Dans `frontend/components/openmatch/OpenMatches.tsx` :

Import :

```typescript
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
```

Dans la vue « parties » (bloc `{!levelEnabled || !token || view === 'parties' ? (<>…`, ~ligne 130), **juste après** `<ClubNav>`… en fait après l'ouverture du fragment `<>` et avant le premier `<div style={{ padding: '18px 20px 0' }}>` (~ligne 131) :

```tsx
        {levelEnabled && (
          <ResultsToRecord token={token} clubSlug={club.slug} />
        )}
```

Dans la vue « matchs » (bloc `view === 'matchs'`, ~ligne 227), **juste après** l'ouverture du fragment `<>` et avant le `<div style={{ padding: '18px 20px 0' }}>` du titre « Mes matchs » :

```tsx
            <ResultsToRecord token={token} clubSlug={club.slug}
              onRecorded={() => api.getMyMatches(token).then(setMyMatches).catch(() => {})} />
```

Note : dans la vue « matchs », `token` est garanti non-null (le Segmented n'apparaît que `levelEnabled && token`), mais `ResultsToRecord` tolère `null` de toute façon.

- [ ] **Step 3: Page `/me/matches`**

Dans `frontend/app/me/matches/page.tsx`, dans le `return`, **juste avant** le bloc `{loading ? … : <MyMatchesList …/>}` (dans le `<div style={{ padding: '18px 20px 0' }}>`, ~ligne 77) :

```tsx
          <ResultsToRecord token={token}
            onRecorded={() => { if (token) api.getMyMatches(token).then(setMatches).catch(() => {}); }} />
```

Et l'import :

```typescript
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
```

Note : pas de `clubSlug` ici — cette page sert aussi de vue non filtrée (plateforme / clubs non padel).

- [ ] **Step 4: Ajouter le mock aux suites concernées**

Repérer les suites qui montent `ClubHouse` ou `OpenMatches` et mockent `lib/api` :

Run: `cd frontend; node node_modules/jest/bin/jest.js __tests__/ClubHouse.test.tsx __tests__/OpenMatches.test.tsx 2>&1 | tail -30`

Si elles échouent sur `getMatchesToRecord is not a function`, ajouter dans leur `jest.mock('@/lib/api', …)` :

```typescript
    getMatchesToRecord: jest.fn().mockResolvedValue([]),
```

(Le retour `[]` fait que `ResultsToRecord` rend `null` → aucune assertion existante n'est perturbée.)

- [ ] **Step 5: Lancer les suites → succès attendu**

Run: `cd frontend; node node_modules/jest/bin/jest.js __tests__/ClubHouse.test.tsx __tests__/OpenMatches.test.tsx`
Expected: PASS.

- [ ] **Step 6: Vérifier les types**

Run: `cd frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/ClubHouse.tsx frontend/components/openmatch/OpenMatches.tsx frontend/app/me/matches/page.tsx frontend/__tests__/ClubHouse.test.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "feat(match): monter ResultsToRecord (club-house, parties, mes matchs)"
```

---

## Task 10 : Vérification finale

- [ ] **Step 1: Suite backend ciblée**

Run: `cd backend; node node_modules/jest/bin/jest.js src/services/__tests__/match.service.test.ts src/routes/__tests__/me.routes.test.ts src/email/__tests__/notifications.match.test.ts src/jobs/__tests__/reminders.job.test.ts`
Expected: tout vert.

- [ ] **Step 2: Suite frontend ciblée**

Run: `cd frontend; node node_modules/jest/bin/jest.js __tests__/MatchResultModal.test.tsx __tests__/ResultsToRecord.test.tsx __tests__/ClubHouse.test.tsx __tests__/OpenMatches.test.tsx`
Expected: tout vert.

- [ ] **Step 3: Types des deux côtés**

Run: `cd backend; node node_modules/typescript/bin/tsc --noEmit`
Run: `cd frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: pas de nouvelle erreur imputable à ce travail (ignorer les erreurs préexistantes sur des fichiers non touchés — les repérer par grep sur les chemins modifiés).

- [ ] **Step 4: Vérification visuelle (skill `verify`)**

Vérifier visuellement le Club-house et `/parties` d'un club padel de dev (`padel-arena-paris`), thème clair et sombre, pour confirmer que la carte « Résultat à saisir » s'affiche correctement quand un match jouable existe (au besoin, seed/forcer une réservation passée à 4 joueurs). Confirmer que la modale s'ouvre en mode résumé.

---

## Self-Review (effectuée à l'écriture)

- **Spec §1 (initialTeams Mes réservations)** → Task 7. ✅
- **Spec §2 (modale résumé + Modifier)** → Task 6. ✅
- **Spec §3 (endpoint to-record)** → Tasks 1 (service) + 2 (route). ✅ Critères couverts : participant (some), 4 joueurs (filter), 7 jours (where.endTime.gte), level activé (where), match non annulé (matches where not CANCELLED + filter length 0), team/slot via effectiveTeams.
- **Spec §4 (ResultsToRecord + 3 surfaces)** → Tasks 8 (composant) + 9 (montage). ✅ Club-house hors sections configurables (posé avant `order.map`). Parties : vue parties + vue matchs. `/me/matches` non filtré.
- **Spec §5 (notification post-match)** → Tasks 3 (notifier, cloche+push sans email, type `match.to_record`, catégorie MY_MATCHES) + 4 (passe job sur endTime, lead 15 min). ✅
- **Spec §6 (tests)** → chaque task porte ses tests ; Task 10 = vérif globale. ✅
- **Cohérence des noms** : `listToRecord`, `getMatchesToRecord`, `MatchToRecord`, `ResultsToRecord`, `notifyMatchResultPrompt`, `match.to_record`, `RESULT_PROMPT_LEAD_MIN` — utilisés identiquement d'une task à l'autre. ✅
- **Pas de placeholder** : tout le code est écrit en entier. ✅
- **Migration** : aucune (relation `Reservation.matches` déjà existante ; catégorie `MY_MATCHES` existante ; pas d'email → pas de registre). ✅
