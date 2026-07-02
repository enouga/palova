# Chat de partie ouverte ouvert à tous — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ouvrir le chat de partie ouverte à tout utilisateur connecté et supprimer entièrement le bouton/concept « Ça m'intéresse ».

**Architecture :** Backend Express + Prisma (services `OpenMatchService` / `OpenMatchChatService`, notifications, routes) ; frontend Next.js/React (`OpenMatchCard`, `OpenMatches`, `lib/api.ts`). La garde d'accès du chat passe de « participant OU intéressé » à « adhésion ACTIVE créée à la volée ». Les notifs de message ciblent désormais « participants ∪ auteurs de messages ». Le modèle `OpenMatchInterest` (table `open_match_interests`) est supprimé.

**Tech Stack :** TypeScript, Prisma 7 (PostgreSQL), Express 5, Jest + jest-mock-extended (backend) ; React 19, React Testing Library (frontend).

**Spec :** `docs/superpowers/specs/2026-07-01-chat-partie-ouverte-ouvert-a-tous-design.md`

---

## Notes d'exécution (à lire avant de commencer)

- **Arbre de travail sale :** le dépôt contient déjà des fichiers modifiés/non suivis sans rapport. **Chaque commit ne doit `git add` que les fichiers listés dans son étape** — jamais `git add -A`/`git add .`.
- **Ordre imposé par le typage :** on retire d'abord toutes les *références au code* de `openMatchInterest` (Tâches 1→4), **puis** on supprime le modèle Prisma + on régénère le client (Tâche 5). Régénérer avant d'avoir retiré les usages casserait la compilation TS.
- **Commandes** depuis `backend/` ou `frontend/` selon la tâche. Tests backend : `npx jest <chemin>` ; tests frontend : `npx jest <chemin>` (dans `frontend/`).
- **Migration Prisma :** base dev en dérive → **ne pas** utiliser `migrate dev`. On applique le SQL de suppression via `prisma db execute` en dev, et on dépose un fichier de migration pour `migrate deploy` en prod (cf. Tâche 5).

---

## Task 1 : Helper partagé `ensureActiveMembership`

But : factoriser « club ACTIVE + adhésion ACTIVE créée à la volée (refus BLOCKED) » pour le réutiliser dans le join **et** dans la garde du chat.

**Files:**
- Create: `backend/src/services/membership.ts`
- Modify: `backend/src/services/openMatch.service.ts` (retirer la méthode privée `ensureActiveMembership`, importer le helper)
- Test: `backend/src/services/__tests__/membership.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Create `backend/src/services/__tests__/membership.test.ts` :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { ensureActiveMembership } from '../membership';

describe('ensureActiveMembership', () => {
  it('CLUB_NOT_FOUND si le club est absent ou suspendu', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(ensureActiveMembership('demo', 'u1')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('MEMBERSHIP_BLOCKED si le membre est BLOCKED', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED' } as any);
    await expect(ensureActiveMembership('demo', 'u1')).rejects.toThrow('MEMBERSHIP_BLOCKED');
  });

  it('crée l adhésion si absente et renvoie { id: clubId }', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    prismaMock.clubMembership.create.mockResolvedValue({ id: 'm1' } as any);
    const out = await ensureActiveMembership('demo', 'u1');
    expect(prismaMock.clubMembership.create).toHaveBeenCalledWith({ data: { userId: 'u1', clubId: 'club-1' } });
    expect(out).toEqual({ id: 'club-1' });
  });

  it('ne crée rien si le membre existe déjà (ACTIVE)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    const out = await ensureActiveMembership('demo', 'u1');
    expect(prismaMock.clubMembership.create).not.toHaveBeenCalled();
    expect(out).toEqual({ id: 'club-1' });
  });
});
```

- [ ] **Step 2 : Lancer le test → échec**

Run (depuis `backend/`) : `npx jest src/services/__tests__/membership.test.ts`
Expected : FAIL (`Cannot find module '../membership'`).

- [ ] **Step 3 : Créer le helper**

Create `backend/src/services/membership.ts` :

```ts
import { prisma } from '../db/prisma';

/**
 * Résout un club ACTIVE par slug et GARANTIT l'adhésion ACTIVE de l'appelant :
 * créée si absente (comme à la 1re réservation), refus si BLOCKED.
 * Renvoie l'id du club. Utilisé par le join de partie ouverte et l'accès au chat.
 */
export async function ensureActiveMembership(slug: string, userId: string): Promise<{ id: string }> {
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
  if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
  const member = await prisma.clubMembership.findUnique({
    where: { userId_clubId: { userId, clubId: club.id } },
    select: { status: true },
  });
  if (member?.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');
  if (!member) await prisma.clubMembership.create({ data: { userId, clubId: club.id } });
  return { id: club.id };
}
```

- [ ] **Step 4 : Lancer le test → succès**

Run : `npx jest src/services/__tests__/membership.test.ts`
Expected : PASS (4 tests).

- [ ] **Step 5 : Remplacer la méthode privée par le helper dans `OpenMatchService`**

Dans `backend/src/services/openMatch.service.ts` :

1. Ajouter l'import en tête (après la ligne `import { effectiveTeams, applyTeams } from './matchTeams';`) :

```ts
import { ensureActiveMembership } from './membership';
```

2. **Supprimer** la méthode privée `ensureActiveMembership` (le bloc de commentaire + méthode, lignes ~32-43) :

```ts
  /** Résout un club ACTIVE et GARANTIT l'adhésion ACTIVE de l'appelant : créée si absente
   *  (comme à la 1re réservation), refus si BLOCKED. Utilisé par join / setInterested. */
  private async ensureActiveMembership(slug: string, userId: string): Promise<{ id: string }> {
    const club = await this.resolveActiveClub(slug);
    const member = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: club.id } },
      select: { status: true },
    });
    if (member?.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');
    if (!member) await prisma.clubMembership.create({ data: { userId, clubId: club.id } });
    return { id: club.id };
  }
```

3. Dans `joinOpenMatch`, remplacer `const club = await this.ensureActiveMembership(slug, userId);` par :

```ts
    const club = await ensureActiveMembership(slug, userId);
```

(Le reste de `joinOpenMatch` utilise `club.id` — inchangé.)

- [ ] **Step 6 : Vérifier que le join compile et que sa suite passe encore**

Run : `npx jest src/services/__tests__/openMatch.service.test.ts -t "joinOpenMatch"`
Expected : PASS (les tests de join utilisent déjà `club.findUnique`/`clubMembership.findUnique`, comportement identique).

- [ ] **Step 7 : Commit**

```bash
git add backend/src/services/membership.ts backend/src/services/__tests__/membership.test.ts backend/src/services/openMatch.service.ts
git commit -m "refactor(open-match): extraire ensureActiveMembership en helper partagé"
```

---

## Task 2 : Ouvrir l'accès au chat (garde `assertChatAccess`)

But : autoriser tout utilisateur connecté (adhésion créée à la volée, BLOCKED refusé) à lire/écrire ; retirer la condition « participant OU intéressé ».

**Files:**
- Modify: `backend/src/services/openMatchChat.service.ts:37-72` (`assertChatAccess`)
- Test: `backend/src/services/__tests__/openMatchChat.service.test.ts` (bloc « access guard »)

- [ ] **Step 1 : Réécrire les tests d'accès (rouges d'abord)**

Dans `backend/src/services/__tests__/openMatchChat.service.test.ts`, **remplacer entièrement** le bloc `describe('access guard', …)` (lignes ~40-83) par :

```ts
  describe('access guard', () => {
    it('permet à un participant de lire les messages', async () => {
      primeAccessOk({ participantUserId: 'viewer', isOrganizer: false });
      prismaMock.openMatchMessage.findMany.mockResolvedValue([] as any);

      const result = await service.listMessages('club-demo', 'resa-1', 'viewer');
      expect(result).toEqual([]);
    });

    it('permet à un membre NON participant de lire (chat ouvert à tous)', async () => {
      prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
      prismaMock.reservation.findUnique.mockResolvedValue({
        visibility: 'PUBLIC',
        status: 'CONFIRMED',
        resource: { clubId: 'club-1' },
        participants: [{ userId: 'org', isOrganizer: true }], // 'stranger' absent de la liste
      } as any);
      prismaMock.openMatchMessage.findMany.mockResolvedValue([] as any);

      const result = await service.listMessages('club-demo', 'resa-1', 'stranger');
      expect(result).toEqual([]);
    });

    it('crée l adhésion à la volée pour un non-membre puis autorise l accès', async () => {
      prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
      prismaMock.clubMembership.create.mockResolvedValue({ id: 'm1' } as any);
      prismaMock.reservation.findUnique.mockResolvedValue({
        visibility: 'PUBLIC',
        status: 'CONFIRMED',
        resource: { clubId: 'club-1' },
        participants: [{ userId: 'org', isOrganizer: true }],
      } as any);
      prismaMock.openMatchMessage.findMany.mockResolvedValue([] as any);

      const result = await service.listMessages('club-demo', 'resa-1', 'newcomer');
      expect(prismaMock.clubMembership.create).toHaveBeenCalledWith({ data: { userId: 'newcomer', clubId: 'club-1' } });
      expect(result).toEqual([]);
    });

    it('refuse un membre BLOCKED → MEMBERSHIP_BLOCKED', async () => {
      prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED' } as any);

      await expect(
        service.listMessages('club-demo', 'resa-1', 'blocked-user'),
      ).rejects.toThrow('MEMBERSHIP_BLOCKED');
    });
  });
```

Dans le bloc `describe('OpenMatchChatService - suppression', …)`, **supprimer** les deux lignes devenues invalides (`deleteMessage` n'appelle pas la garde et le modèle disparaît) :

- ligne ~157 : `prismaMock.openMatchInterest.findUnique.mockResolvedValue({ id: 'interest-1' } as any);`
- ligne ~177 : `prismaMock.openMatchInterest.findUnique.mockResolvedValue({ id: 'interest-1' } as any);`

(Ces tests de suppression restent valides : `deleteMessage` a sa propre garde staff/auteur/organisateur, inchangée.)

- [ ] **Step 2 : Lancer les tests → échec**

Run : `npx jest src/services/__tests__/openMatchChat.service.test.ts -t "access guard"`
Expected : FAIL — le test « non participant » lève encore `CHAT_FORBIDDEN`, le test « non-membre » lève `MEMBERSHIP_REQUIRED`.

- [ ] **Step 3 : Réécrire `assertChatAccess`**

Dans `backend/src/services/openMatchChat.service.ts`, ajouter en tête l'import :

```ts
import { ensureActiveMembership } from './membership';
```

Puis remplacer la méthode `assertChatAccess` (lignes ~38-72) par :

```ts
  /** Accès au chat : adhésion ACTIVE (créée à la volée, refus BLOCKED) + résa PUBLIC/CONFIRMED.
   *  Ouvert à tout utilisateur connecté du club — plus de condition participant/intéressé. */
  private async assertChatAccess(slug: string, reservationId: string, userId: string): Promise<ChatContext> {
    const { id: clubId } = await ensureActiveMembership(slug, userId);

    const resa = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        visibility: true, status: true,
        resource: { select: { clubId: true } },
        participants: { select: { userId: true, isOrganizer: true } },
      },
    });
    if (!resa || resa.resource.clubId !== clubId) throw new Error('RESERVATION_NOT_FOUND');
    if (resa.visibility !== 'PUBLIC' || resa.status !== 'CONFIRMED') throw new Error('MATCH_NOT_JOINABLE');

    const part = resa.participants.find((p) => p.userId === userId);
    return { clubId, isParticipant: !!part, isOrganizer: !!part?.isOrganizer };
  }
```

- [ ] **Step 4 : Lancer les tests → succès**

Run : `npx jest src/services/__tests__/openMatchChat.service.test.ts`
Expected : PASS (access guard réécrit + postMessage/suppression/markRead/unreadCount inchangés).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/openMatchChat.service.ts backend/src/services/__tests__/openMatchChat.service.test.ts
git commit -m "feat(open-match): ouvrir le chat à tout membre (adhésion à la volée)"
```

---

## Task 3 : Destinataires des notifs de message = participants ∪ auteurs de messages

But : remplacer la source « intéressés » par « auteurs distincts de messages du chat ».

**Files:**
- Modify: `backend/src/email/notifications.ts:424-477` (`notifyOpenMatchChatMessage`)
- Test: `backend/src/email/__tests__/notifications.openmatch-chat.test.ts`

- [ ] **Step 1 : Mettre à jour les tests (rouges d'abord)**

Dans `backend/src/email/__tests__/notifications.openmatch-chat.test.ts` :

1. Test « notifie les membres du chat… » : remplacer la ligne 42
```ts
  prismaMock.openMatchInterest.findMany.mockResolvedValue([{ userId: 'curious' }] as any);
```
par (auteurs distincts de messages ; l'auteur du message courant peut y figurer, il est filtré ensuite) :
```ts
  prismaMock.openMatchMessage.findMany.mockResolvedValue([{ userId: 'author' }, { userId: 'curious' }] as any);
```

2. Test « envoie une notif par message… » : remplacer la ligne 84
```ts
  prismaMock.openMatchInterest.findMany.mockResolvedValue([] as any);
```
par :
```ts
  prismaMock.openMatchMessage.findMany.mockResolvedValue([{ userId: 'author' }] as any);
```

3. Test « ne fait rien si le message est introuvable… » : remplacer la ligne 116
```ts
  prismaMock.openMatchInterest.findMany.mockResolvedValue([] as any);
```
par :
```ts
  prismaMock.openMatchMessage.findMany.mockResolvedValue([] as any);
```

- [ ] **Step 2 : Lancer → échec**

Run : `npx jest src/email/__tests__/notifications.openmatch-chat.test.ts`
Expected : FAIL — le code lit encore `prisma.openMatchInterest.findMany` (mock non fourni → recipients incomplets / erreurs).

- [ ] **Step 3 : Réécrire la source des destinataires**

Dans `backend/src/email/notifications.ts`, fonction `notifyOpenMatchChatMessage`, remplacer :

```ts
  const interests = await prisma.openMatchInterest.findMany({ where: { reservationId }, select: { userId: true } });
  const connected = SSEService.getInstance().getMatchUserIds(reservationId);

  const recipients = new Set<string>();
  for (const p of resa.participants) recipients.add(p.userId);
  for (const i of interests) recipients.add(i.userId);
  recipients.delete(authorUserId);
```

par :

```ts
  // Destinataires = participants ∪ personnes ayant déjà écrit dans ce chat.
  const chatters = await prisma.openMatchMessage.findMany({
    where: { reservationId },
    distinct: ['userId'],
    select: { userId: true },
  });
  const connected = SSEService.getInstance().getMatchUserIds(reservationId);

  const recipients = new Set<string>();
  for (const p of resa.participants) recipients.add(p.userId);
  for (const c of chatters) recipients.add(c.userId);
  recipients.delete(authorUserId);
```

- [ ] **Step 4 : Lancer → succès**

Run : `npx jest src/email/__tests__/notifications.openmatch-chat.test.ts`
Expected : PASS (targets `['absent','curious']`, un dispatch par message, garde résa/message).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/email/notifications.ts backend/src/email/__tests__/notifications.openmatch-chat.test.ts
git commit -m "feat(open-match): notifs de chat = participants + auteurs de messages"
```

---

## Task 4 : Supprimer le concept « intéressé » (code back + routes + front API)

But : retirer `setInterested`/`removeInterested`, les champs DTO, les `deleteMany`, `notifyOpenMatchInterest`, les 2 routes et les méthodes front. **Aucune référence au code `openMatchInterest` ne doit subsister après cette tâche** (le modèle Prisma est encore là, inutilisé — supprimé en Tâche 5).

**Files:**
- Modify: `backend/src/services/openMatch.service.ts`
- Modify: `backend/src/email/notifications.ts` (supprimer `notifyOpenMatchInterest`)
- Modify: `backend/src/routes/clubs.ts:269-275`
- Modify: `backend/src/services/__tests__/openMatch.service.test.ts`
- Modify: `backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1 : `OpenMatchService` — retirer l'intérêt du DTO et les méthodes**

Dans `backend/src/services/openMatch.service.ts` :

1. Import ligne 4 — retirer `notifyOpenMatchInterest` :
```ts
import { notifyOpenMatchJoin, notifyOpenMatchLeft, notifyOpenMatchRemoved, notifyOpenMatchAdded } from '../email/notifications';
```

2. Dans `listOpenMatches`, **supprimer** l'include `openMatchInterests` (lignes ~86-89) :
```ts
        openMatchInterests: {
          orderBy: { createdAt: 'asc' },
          select: { userId: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        },
```

3. Dans le `return` du `.map(...)`, **supprimer** les 3 champs (lignes ~144-148) :
```ts
        interestedCount: m.openMatchInterests.length,
        viewerIsInterested: viewerUserId != null && m.openMatchInterests.some((i) => i.userId === viewerUserId),
        interested: m.openMatchInterests.slice(0, 5).map((i) => ({
          userId: i.userId, firstName: i.user.firstName, lastName: i.user.lastName, avatarUrl: i.user.avatarUrl, isOrganizer: false,
        })),
```

4. Dans `joinOpenMatch`, **supprimer** le commentaire + `deleteMany` (lignes ~182-183) :
```ts
      // Devenu participant : son éventuel « intérêt » est redondant.
      await tx.openMatchInterest.deleteMany({ where: { reservationId, userId } });
```

5. Dans `addOpenMatchPlayer`, **supprimer** (ligne ~282) :
```ts
      await tx.openMatchInterest.deleteMany({ where: { reservationId, userId: targetUserId } });
```

6. **Supprimer** entièrement les méthodes `setInterested` et `removeInterested` (lignes ~317-354, du commentaire `/** Marque l'appelant « intéressé »… */` jusqu'à la fin de `removeInterested`).

- [ ] **Step 2 : Supprimer `notifyOpenMatchInterest`**

Dans `backend/src/email/notifications.ts`, **supprimer** toute la fonction `notifyOpenMatchInterest` (le bloc de commentaire `/** Prévient l'organisateur qu'un membre est « intéressé »… */` + la fonction, lignes ~389-417).

- [ ] **Step 3 : Supprimer les 2 routes d'intérêt**

Dans `backend/src/routes/clubs.ts`, **supprimer** le bloc (lignes ~269-275) :
```ts
// « Ça m'intéresse » sur une partie ouverte (n'occupe pas de place, débloque le chat).
router.post('/:slug/open-matches/:id/interest', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.setInterested(asString(req.params.slug), asString(req.params.id), req.user!.id)); }
  catch (e) { next(e); }
});
router.delete('/:slug/open-matches/:id/interest', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.removeInterested(asString(req.params.slug), asString(req.params.id), req.user!.id)); }
  catch (e) { next(e); }
});
```

Mettre à jour le commentaire ligne ~279 : `// Chat de la partie ouverte (inscrits + intéressés).` → `// Chat de la partie ouverte (tout membre connecté).`

- [ ] **Step 4 : Nettoyer les tests service**

Dans `backend/src/services/__tests__/openMatch.service.test.ts` :

1. **Supprimer** entièrement le bloc `describe('OpenMatchService — intérêt', …)` (à partir de la ligne ~482 jusqu'à sa `});` fermante).
2. Dans le test de `listOpenMatches` qui vérifie l'intérêt (celui avec `viewerIsOrganizer`/`viewerIsInterested`/`interestedCount`, lignes ~121-123), **supprimer** les deux assertions :
```ts
      expect(out[0].viewerIsInterested).toBe(false);
      expect(out[0].interestedCount).toBe(1);
```
3. Retirer, dans **tous** les objets `reservation.findMany` mockés de ce fichier, la clé `openMatchInterests: [...]` (elle n'est plus lue ; lancer les tests et laisser TS/jest confirmer qu'il n'en reste aucune référence lue). Ces objets sont castés `as any` → leur présence résiduelle n'est pas bloquante, mais on les retire pour la propreté.

- [ ] **Step 5 : Nettoyer les tests de routes**

Dans `backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts` :

1. Retirer les mocks `setInterested`/`removeInterested` : lignes ~10-11 (déclarations `const`), ~20-21 (dans l'implémentation du service mocké), ~59-60 (récupération `omInst.*`), ~81-82 (reset dans `beforeEach`).
2. **Supprimer** les deux `describe` d'intérêt : `POST …/interest` (~93-106) et `DELETE …/interest` (~109-116), ainsi que le commentaire de section `// ─── Interest (ça m'intéresse) ───` (~91).

- [ ] **Step 6 : Front API — retirer types + méthodes**

Dans `frontend/lib/api.ts` :

1. **Supprimer** les méthodes (lignes ~272-275) :
```ts
  setInterested: (slug: string, id: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/interest`, { method: 'POST' }, token),
  removeInterested: (slug: string, id: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/interest`, { method: 'DELETE' }, token),
```

2. Dans l'interface `OpenMatch`, **supprimer** les 3 champs (lignes ~1196-1198) :
```ts
  interestedCount: number;
  viewerIsInterested: boolean;
  interested: OpenMatchPlayer[];
```

- [ ] **Step 7 : Vérifier back (compile + suites touchées)**

Run (depuis `backend/`) :
```
npx tsc --noEmit
npx jest src/services/__tests__/openMatch.service.test.ts src/routes/__tests__/clubs.openmatch-chat.routes.test.ts
```
Expected : `tsc` **0 erreur** ; jest PASS. (Si `tsc` signale un `openMatchInterest` résiduel, le corriger — il ne doit plus y avoir aucune référence de code.)

- [ ] **Step 8 : Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/email/notifications.ts backend/src/routes/clubs.ts backend/src/services/__tests__/openMatch.service.test.ts backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts frontend/lib/api.ts
git commit -m "feat(open-match): supprimer le concept « intéressé » (code + routes + API)"
```

---

## Task 5 : Supprimer le modèle Prisma `OpenMatchInterest` + migration

But : retirer la table `open_match_interests` du schéma et de la base.

**Files:**
- Modify: `backend/prisma/schema.prisma` (retrait modèle + 2 relations)
- Create: `backend/prisma/migrations/20260701000000_drop_open_match_interests/migration.sql`

- [ ] **Step 1 : Retirer les relations et le modèle du schéma**

Dans `backend/prisma/schema.prisma` :

1. Modèle `User` — supprimer la ligne (~465) : `openMatchInterests      OpenMatchInterest[]`
2. Modèle `Reservation` — supprimer la ligne (~704) : `openMatchInterests OpenMatchInterest[]`
3. **Supprimer** entièrement le modèle `OpenMatchInterest` (lignes ~1300-1312) :
```prisma
model OpenMatchInterest {
  id            String   @id @default(cuid())
  reservationId String   @map("reservation_id")
  userId        String   @map("user_id")
  createdAt     DateTime @default(now()) @map("created_at")

  reservation Reservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)
  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([reservationId, userId])
  @@index([reservationId])
  @@map("open_match_interests")
}
```

- [ ] **Step 2 : Créer le fichier de migration (prod)**

Create `backend/prisma/migrations/20260701000000_drop_open_match_interests/migration.sql` :

```sql
-- Suppression de la table « intéressé » des parties ouvertes (chat ouvert à tous).
DROP TABLE IF EXISTS "open_match_interests";
```

- [ ] **Step 3 : Régénérer le client Prisma**

Run (depuis `backend/`) : `npx prisma generate`
Expected : succès ; le type `PrismaClient` n'expose plus `openMatchInterest`.

- [ ] **Step 4 : Appliquer la suppression en base dev**

Run (depuis `backend/`) :
```
npx prisma db execute --file prisma/migrations/20260701000000_drop_open_match_interests/migration.sql --schema prisma/schema.prisma
```
Expected : succès (ou no-op si la table est déjà absente). ⚠️ **Ne pas** lancer `prisma migrate dev` (base dev en dérive). En prod : `prisma migrate deploy`.

- [ ] **Step 5 : Vérifier compilation + suites backend open-match**

Run (depuis `backend/`) :
```
npx tsc --noEmit
npx jest src/services/__tests__/openMatchChat.service.test.ts src/services/__tests__/openMatch.service.test.ts src/services/__tests__/membership.test.ts src/email/__tests__/notifications.openmatch-chat.test.ts src/routes/__tests__/clubs.openmatch-chat.routes.test.ts
```
Expected : `tsc` 0 erreur (plus aucun `prismaMock.openMatchInterest` valide → si une référence subsiste, la supprimer) ; jest PASS.

- [ ] **Step 6 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260701000000_drop_open_match_interests/migration.sql
git commit -m "feat(open-match): drop table open_match_interests"
```

---

## Task 6 : Frontend — `OpenMatchCard` (retrait bouton/chip, « Discuter » pour tous)

But : supprimer le bouton d'intérêt et le chip, ouvrir « Discuter » à l'anonyme (→ invite) et au connecté (→ chat).

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx`
- Test: `frontend/__tests__/OpenMatchCard.test.tsx`

- [ ] **Step 1 : Réécrire les tests (rouges d'abord)**

Dans `frontend/__tests__/OpenMatchCard.test.tsx` :

1. Dans le mock `makeMatch` (objet de base), **supprimer** les lignes (~35-37) :
```ts
    interestedCount: 0,
    viewerIsInterested: false,
    interested: [],
```
2. Dans `makeProps` (defaults), **supprimer** la ligne (~61) : `onToggleInterest: jest.fn(),`
3. **Supprimer** les tests devenus caducs : « affiche « Ça m'intéresse »… » (~69-82), « active le bouton « Discuter » quand viewerIsInterested… » (~84-93), « désactive le bouton « Discuter » pour un non-participant non-intéressé » (~95-…), « affiche « 3 intéressés »… » (~147-155).
4. **Ajouter** un test « Discuter pour connecté » :
```ts
  it('« Discuter » est actif pour un utilisateur connecté et appelle onOpenChat', () => {
    const match = makeMatch({ viewerIsParticipant: false });
    const onOpenChat = jest.fn();
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match, { onOpenChat })} />
      </ThemeProvider>
    );
    const btn = screen.getByRole('button', { name: /Discuter/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onOpenChat).toHaveBeenCalledWith(match);
  });
```
5. **Remplacer** le test anonyme (~157-170) par :
```ts
  it('anonyme : « Rejoindre » appelle onAuthPrompt, et « Discuter » ouvre aussi l invite', () => {
    const match = makeMatch();
    const onAuthPrompt = jest.fn(), onJoin = jest.fn(), onOpenChat = jest.fn();
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match, { onAuthPrompt, onJoin, onOpenChat, isAnonymous: true })} />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /Rejoindre/i }));
    expect(onAuthPrompt).toHaveBeenCalledWith(match);
    expect(onJoin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Discuter/i }));
    expect(onAuthPrompt).toHaveBeenCalledTimes(2);
    expect(onOpenChat).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Ça m'intéresse/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2 : Lancer → échec**

Run (depuis `frontend/`) : `npx jest __tests__/OpenMatchCard.test.tsx`
Expected : FAIL (les nouveaux tests ne passent pas ; l'ancien rendu masque « Discuter » à l'anonyme, garde le bouton d'intérêt).

- [ ] **Step 3 : Modifier `OpenMatchCard.tsx`**

Dans `frontend/components/openmatch/OpenMatchCard.tsx` :

1. **Supprimer** la prop `onToggleInterest` de l'interface `OpenMatchCardProps` (ligne ~34) et de la déstructuration du composant (ligne ~49).
2. **Supprimer** le `interestTint` et le commentaire (lignes ~60-64), ainsi que `const canChat = …` (ligne ~65). Garder `chatTint`. Remplacer le bloc commentaire+tints par :
```ts
  // Émeraude = Discuter (action secondaire), distincte de l'accent plein « Rejoindre ».
  const chatTint = tint(ACCENTS.emerald);
```
3. **Supprimer** le chip « intéressés » (lignes ~76-78) :
```tsx
          {m.interestedCount > 0 && (
            <Chip tone="line" icon="users">{m.interestedCount} intéressé{m.interestedCount > 1 ? 's' : ''}</Chip>
          )}
```
4. Remplacer le bloc « Discuter » (lignes ~112-123) — retirer le garde `!isAnonymous`, rendre le bouton toujours actif, router l'anonyme vers `onAuthPrompt` :
```tsx
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <Btn variant="surface" style={{ ...actionBtn, ...chatTint }} onClick={() => (isAnonymous ? onAuthPrompt(m) : onOpenChat(m))}>
            Discuter
          </Btn>
          {!isAnonymous && m.unreadCount > 0 && (
            <span aria-label={`${m.unreadCount} non lus`} style={{ position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#e5484d', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>
              {m.unreadCount > 99 ? '99+' : m.unreadCount}
            </span>
          )}
        </span>
```
5. **Supprimer** entièrement le bloc du bouton d'intérêt (lignes ~124-134) :
```tsx
        {!isAnonymous && !m.viewerIsParticipant && (
          m.viewerIsInterested ? (
            <Btn variant="surface" style={{ ...actionBtn, ...interestTint }} disabled={busy} onClick={() => onToggleInterest(m)}>
              <Icon name="check" size={18} color={interestTint.color} />Intéressé
            </Btn>
          ) : (
            <Btn variant="surface" style={actionBtn} disabled={busy} onClick={() => onToggleInterest(m)}>
              {"Ça m'intéresse"}
            </Btn>
          )
        )}
```
6. Mettre à jour le commentaire de la barre d'actions (ligne ~109-110) : retirer la mention « intérêt ».

- [ ] **Step 4 : Lancer → succès**

Run : `npx jest __tests__/OpenMatchCard.test.tsx`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/__tests__/OpenMatchCard.test.tsx
git commit -m "feat(open-match): carte — Discuter ouvert à tous, retrait du bouton d'intérêt"
```

---

## Task 7 : Frontend — `OpenMatches` (câblage) + mocks des suites restantes

But : retirer `toggleInterest`/`onToggleInterest` et purger les champs `interested*` des mocks des suites frontend.

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx`
- Test: `frontend/__tests__/OpenMatches.test.tsx`
- Test: `frontend/__tests__/OpenMatchCard.friends.test.tsx`
- Test: `frontend/__tests__/MatchesForYou.test.tsx`
- Test: `frontend/__tests__/recommend.test.ts`

- [ ] **Step 1 : Mettre à jour `OpenMatches.test.tsx` (rouges d'abord)**

Dans `frontend/__tests__/OpenMatches.test.tsx` :

1. Mock `api` — supprimer les lignes ~26-27 :
```ts
    setInterested:    jest.fn().mockResolvedValue({}),
    removeInterested: jest.fn().mockResolvedValue({}),
```
2. Factory `match()` — retirer de la ligne ~63 les champs `interestedCount: 0, viewerIsInterested: false, interested: [],` (garder `lastMessageAt: null, unreadCount: 0,`).
3. **Supprimer** le test « cliquer « Ça m intéresse » appelle setInterested… » (~190-196).
4. Tests « Discuter … » (~199-210) : remplacer `match({ viewerIsInterested: true })` par `match()` aux deux endroits (Discuter est désormais toujours disponible pour un connecté).

- [ ] **Step 2 : Purger les autres factories de mocks**

- `frontend/__tests__/OpenMatchCard.friends.test.tsx` ligne ~14 : retirer `interestedCount: 0, viewerIsInterested: false, interested: [],`.
- `frontend/__tests__/MatchesForYou.test.tsx` ligne ~14 : idem.
- `frontend/__tests__/recommend.test.ts` ligne ~13 : idem.

- [ ] **Step 3 : Lancer → échec**

Run (depuis `frontend/`) : `npx jest __tests__/OpenMatches.test.tsx`
Expected : FAIL — `OpenMatches.tsx` référence encore `toggleInterest`/`onToggleInterest`.

- [ ] **Step 4 : Modifier `OpenMatches.tsx`**

Dans `frontend/components/openmatch/OpenMatches.tsx` :

1. **Supprimer** le handler `toggleInterest` (lignes ~116-117) :
```ts
  const toggleInterest = (m: OpenMatch) =>
    act(m, () => (m.viewerIsInterested ? api.removeInterested(club.slug, m.id, token!) : api.setInterested(club.slug, m.id, token!)));
```
2. **Supprimer** les deux passages de prop `onToggleInterest={toggleInterest}` (les deux `<OpenMatchCard …>` : sections « Pour toi » ~189 et « Autres » ~233).

- [ ] **Step 5 : Lancer → succès**

Run : `npx jest __tests__/OpenMatches.test.tsx __tests__/OpenMatchCard.friends.test.tsx __tests__/MatchesForYou.test.tsx __tests__/recommend.test.ts`
Expected : PASS.

- [ ] **Step 6 : Vérifier compilation frontend**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : 0 erreur (aucun `interested*`/`onToggleInterest`/`setInterested`/`removeInterested` résiduel).

- [ ] **Step 7 : Commit**

```bash
git add frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/OpenMatches.test.tsx frontend/__tests__/OpenMatchCard.friends.test.tsx frontend/__tests__/MatchesForYou.test.tsx frontend/__tests__/recommend.test.ts
git commit -m "feat(open-match): câblage front — retrait de « Ça m'intéresse »"
```

---

## Task 8 : Documentation (CLAUDE.md)

But : refléter le nouveau comportement dans la doc projet.

**Files:**
- Modify: `CLAUDE.md` (section « Chat de partie ouverte + « Ça m'intéresse » »)

- [ ] **Step 1 : Mettre à jour la section**

Dans `CLAUDE.md`, ajouter une note d'évolution datée sous la section « Chat de partie ouverte » (ne pas réécrire l'historique) :

```markdown
> **Évolution (2026-07-01) — chat ouvert à tous, suppression de « Ça m'intéresse » :** le bouton/état « intéressé » (`OpenMatchInterest`, table `open_match_interests`) est **entièrement supprimé** (modèle drop, routes `/interest`, notif organisateur `notifyOpenMatchInterest`, champs DTO `interestedCount`/`viewerIsInterested`/`interested`). Le **chat d'une partie ouverte est désormais accessible à tout utilisateur connecté** : la garde `assertChatAccess` exige une **adhésion ACTIVE créée à la volée** (helper partagé `backend/src/services/membership.ts`, refus `BLOCKED`) + résa PUBLIC/CONFIRMED, sans condition participant/intéressé. Un **anonyme** qui clique « Discuter » voit l'invite `AuthPromptDialog`. Les **notifs de nouveau message** ciblent désormais **participants ∪ auteurs de messages** (− auteur − connectés SSE). Migration destructive `drop_open_match_interests` (dev : `prisma db execute` ; prod : `migrate deploy`). Spec & plan : `docs/superpowers/{specs,plans}/2026-07-01-chat-partie-ouverte-ouvert-a-tous*`.
```

- [ ] **Step 2 : Commit**

```bash
git add CLAUDE.md
git commit -m "docs: chat de partie ouverte ouvert à tous"
```

---

## Task 9 : Vérification finale

But : garantir que l'ensemble compile et que les suites impactées passent.

- [ ] **Step 1 : Backend — compilation + suites open-match**

Run (depuis `backend/`) :
```
npx tsc --noEmit
npx jest src/services/__tests__/membership.test.ts src/services/__tests__/openMatchChat.service.test.ts src/services/__tests__/openMatch.service.test.ts src/email/__tests__/notifications.openmatch-chat.test.ts src/routes/__tests__/clubs.openmatch-chat.routes.test.ts
```
Expected : `tsc` 0 erreur ; toutes les suites PASS.

- [ ] **Step 2 : Frontend — compilation + suites open-match**

Run (depuis `frontend/`) :
```
npx tsc --noEmit
npx jest __tests__/OpenMatchCard.test.tsx __tests__/OpenMatchCard.friends.test.tsx __tests__/OpenMatches.test.tsx __tests__/MatchesForYou.test.tsx __tests__/recommend.test.ts
```
Expected : `tsc` 0 erreur ; toutes les suites PASS.

- [ ] **Step 3 : Recherche de références orphelines**

Run (à la racine) : `git grep -n "openMatchInterest\|interestedCount\|viewerIsInterested\|setInterested\|removeInterested\|notifyOpenMatchInterest"`
Expected : **seules** les occurrences dans `docs/superpowers/**` (specs/plans historiques) et la note d'évolution `CLAUDE.md`. Aucune dans `backend/src/**` ou `frontend/{lib,components,__tests__}/**`.

> **Note :** la suite complète frontend (`npx jest`) présente un flake d'isolation pré-existant sur `BookingModal` (~6 échecs) sans rapport avec cette feature — vérifier par suites ciblées + `tsc`, pas par le run complet.

---

## Self-Review (effectuée)

- **Couverture spec :** accès chat (T2), notifs (T3), suppression modèle/routes/DTO/notif (T4-T5), front carte + câblage (T6-T7), helper partagé (T1), doc (T8). ✅
- **Placeholders :** aucun — chaque étape porte le code réel. ✅
- **Cohérence des types :** `ensureActiveMembership(slug, userId) → { id: string }` utilisé identiquement en T1 (join) et T2 (chat) ; `notifyOpenMatchChatMessage` garde sa signature. ✅
- **Ordre :** usages retirés (T1-T4) avant le drop schéma + `prisma generate` (T5) → pas de fenêtre de compilation cassée. ✅
