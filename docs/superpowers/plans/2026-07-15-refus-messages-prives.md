# Refus des messages privés (opt-out messagerie) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player refuse to be contacted by strangers in the private messaging system — a profile toggle `acceptsDirectMessages` gates the *creation* of new conversations only, with confirmed friends always able to write regardless of the toggle.

**Architecture:** Additive `User.acceptsDirectMessages` boolean (default `true`), checked in `MessagingService.getOrCreateConversation` right after the existing `assertNotBlocked` block (same request, no cost in the default/common case). A confirmed `Friendship` bypasses the refusal. Three frontend call sites of `openConversation` that currently swallow errors silently get a shared error-message mapper (`dmErrorMessage`) so `DM_DISABLED` (and the pre-existing `USER_BLOCKED`/`NOT_CO_MEMBERS`) surface as readable text instead of doing nothing.

**Tech Stack:** Express + Prisma 7 (Postgres) backend, Next.js 16 + React frontend, Jest (ts-jest) on both sides.

**Spec:** `docs/superpowers/specs/2026-07-15-refus-messages-prives-design.md`

---

## File Structure

Backend:
- `backend/prisma/migrations/20260715090000_add_dm_opt_out/migration.sql` — **create**, additive column.
- `backend/prisma/schema.prisma` — **modify**, `User.acceptsDirectMessages` field.
- `backend/src/services/messaging.service.ts` — **modify**, new private `assertAcceptsMessages`, wired into `getOrCreateConversation`.
- `backend/src/services/__tests__/messaging.service.test.ts` — **modify**.
- `backend/src/routes/conversations.ts` — **modify**, `ERROR_STATUS` map.
- `backend/src/routes/__tests__/conversations.routes.test.ts` — **modify**.
- `backend/src/routes/me.ts` — **modify**, `PROFILE_SELECT` + `PATCH /` body handling.
- `backend/src/routes/__tests__/me.routes.test.ts` — **modify**.

Frontend:
- `frontend/lib/api.ts` — **modify**, `MyProfile.acceptsDirectMessages` + `updateMyProfile` body type.
- `frontend/lib/messages.ts` — **modify**, `DM_ERRORS` + `dmErrorMessage`.
- `frontend/__tests__/messages.test.ts` — **modify**.
- `frontend/app/me/profile/page.tsx` — **modify**, new toggle + handler, tweaked help text.
- `frontend/__tests__/MeProfile.test.tsx` — **modify**.
- `frontend/components/messages/NewConversationPanel.tsx` — **modify**, specific error message.
- `frontend/__tests__/NewConversationPanel.test.tsx` — **modify**.
- `frontend/components/messages/MessagesHub.tsx` — **modify**, deeplink error banner.
- `frontend/__tests__/MessagesHub.test.tsx` — **modify**.
- `frontend/components/messages/DmWidgetHost.tsx` — **modify**, error panel in the widget.
- `frontend/__tests__/DmWidgetHost.test.tsx` — **modify**.

---

### Task 1: Database migration — `User.acceptsDirectMessages`

**Files:**
- Create: `backend/prisma/migrations/20260715090000_add_dm_opt_out/migration.sql`
- Modify: `backend/prisma/schema.prisma:474`

**Prerequisite:** Postgres must be running (`"C:\Program Files\Docker\Docker\resources\bin\docker-compose-v1.exe" up -d` from the repo root, per `CLAUDE.md`).

- [ ] **Step 1: Add the field to the schema**

In `backend/prisma/schema.prisma`, the `User` model currently has (line 474):

```prisma
  acceptsFriendRequests Boolean @default(true) @map("accepts_friend_requests")
```

Add a new line right after it:

```prisma
  acceptsFriendRequests Boolean @default(true) @map("accepts_friend_requests")
  acceptsDirectMessages Boolean @default(true) @map("accepts_direct_messages")
```

- [ ] **Step 2: Write the migration SQL**

Create `backend/prisma/migrations/20260715090000_add_dm_opt_out/migration.sql`:

```sql
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accepts_direct_messages" BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 3: Apply the migration and regenerate the Prisma client**

Run (from `backend/`):

```bash
npx prisma db execute --file prisma/migrations/20260715090000_add_dm_opt_out/migration.sql
npx prisma generate
```

Expected: both commands exit 0. `npx prisma generate` regenerates `@prisma/client` types so `acceptsDirectMessages` is available on `User` selects.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260715090000_add_dm_opt_out
git commit -m "feat(db): add User.acceptsDirectMessages opt-out column"
```

---

### Task 2: `MessagingService` — gate new-conversation creation

**Files:**
- Modify: `backend/src/services/messaging.service.ts:87-99` (new private method, next to `assertNotBlocked`/`assertCanWrite`)
- Modify: `backend/src/services/messaging.service.ts:129-141` (`getOrCreateConversation`)
- Test: `backend/src/services/__tests__/messaging.service.test.ts` (including its `U` fixture at line 14)

- [ ] **Step 1: Fix the test fixture so existing tests keep passing under the new gate**

In `backend/src/services/__tests__/messaging.service.test.ts:14`, the shared user fixture doesn't set `acceptsDirectMessages`, which would make every existing test that relies on it look like a refused/opted-out user once the gate exists. Update it once, at the source:

```ts
const U = (id: string) => ({ id, firstName: 'P', lastName: id.toUpperCase(), avatarUrl: null, acceptsDirectMessages: true });
```

(This is a one-line change to the existing `const U = (id: string) => ({ id, firstName: 'P', lastName: id.toUpperCase(), avatarUrl: null });` at line 14.)

- [ ] **Step 2: Write the failing tests**

In `backend/src/services/__tests__/messaging.service.test.ts`, inside the `describe('MessagingService — getOrCreateConversation', ...)` block (the one whose `beforeEach` is at lines 18-26), add these tests right before its closing `});` (line 88):

```ts
  it('refuse la création si la cible a coupé les messages et n\'est pas amie', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...U('u2'), deletedAt: null, acceptsDirectMessages: false } as any);
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    prismaMock.friendship.findUnique.mockResolvedValue(null);
    await expect(service.getOrCreateConversation('u1', 'u2')).rejects.toThrow('DM_DISABLED');
  });

  it('autorise la création si la cible a coupé les messages MAIS amitié confirmée', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...U('u2'), deletedAt: null, acceptsDirectMessages: false } as any);
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    prismaMock.conversation.create.mockResolvedValue({ id: 'c1', clubId: 'club-demo', lastMessageAt: null } as any);
    prismaMock.friendship.findUnique.mockResolvedValue({ status: 'ACCEPTED' } as any);
    await expect(service.getOrCreateConversation('u1', 'u2')).resolves.toMatchObject({ id: 'c1' });
  });

  it('une demande d\'amitié PENDING (pas encore acceptée) ne suffit pas à contourner le refus', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...U('u2'), deletedAt: null, acceptsDirectMessages: false } as any);
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    prismaMock.friendship.findUnique.mockResolvedValue({ status: 'PENDING' } as any);
    await expect(service.getOrCreateConversation('u1', 'u2')).rejects.toThrow('DM_DISABLED');
  });

  it('une conversation déjà EXISTANTE reste accessible même si la cible a coupé les messages depuis (pas de requête friendship)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...U('u2'), deletedAt: null, acceptsDirectMessages: false } as any);
    prismaMock.conversation.findUnique.mockResolvedValue({ id: 'c1', clubId: 'club-demo', lastMessageAt: null } as any);
    const conv = await service.getOrCreateConversation('u1', 'u2');
    expect(conv.id).toBe('c1');
    expect(prismaMock.friendship.findUnique).not.toHaveBeenCalled();
  });

  it('acceptsDirectMessages true (défaut) : aucune requête friendship, création normale', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    prismaMock.conversation.create.mockResolvedValue({ id: 'c1', clubId: 'club-demo', lastMessageAt: null } as any);
    const conv = await service.getOrCreateConversation('u1', 'u2');
    expect(conv.id).toBe('c1');
    expect(prismaMock.friendship.findUnique).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run the tests, confirm the 3 refusal-related ones fail**

Run (from `backend/`):

```bash
node node_modules/jest/bin/jest.js src/services/__tests__/messaging.service.test.ts -t "refuse la création|autorise la création|amitié PENDING"
```

Expected: FAIL — `getOrCreateConversation` currently never throws `DM_DISABLED` (the gate doesn't exist yet). The other 2 new tests (existing-conversation, default-true) pass already since no friendship query happens today either way — that's expected, they're regression guards for after the implementation lands.

- [ ] **Step 4: Implement the gate**

In `backend/src/services/messaging.service.ts`, the `assertNotBlocked` method is at lines 87-90:

```ts
  /** Blocage dans un sens OU l'autre → USER_BLOCKED (générique, sens non révélé). */
  private async assertNotBlocked(a: string, b: string): Promise<void> {
    if (await this.pairBlocked(a, b)) throw new Error('USER_BLOCKED');
  }
```

Add a new private method right after it:

```ts
  /** Refus général de nouveaux messages : la cible doit accepter, SAUF amitié confirmée
   *  (qui passe toujours). Ne s'applique qu'à la CRÉATION d'une conversation — appelée
   *  uniquement quand !conv dans getOrCreateConversation, jamais sur une conversation existante. */
  private async assertAcceptsMessages(a: string, b: string, otherAccepts: boolean): Promise<void> {
    if (otherAccepts) return;
    const fr = await prisma.friendship.findUnique({ where: { userAId_userBId: canonical(a, b) }, select: { status: true } });
    if (fr?.status === 'ACCEPTED') return;
    throw new Error('DM_DISABLED');
  }
```

Then in `getOrCreateConversation` (lines 129-141), the current code is:

```ts
  async getOrCreateConversation(meId: string, otherUserId: string, clubSlug?: string | null): Promise<ConversationSummaryDTO> {
    if (!otherUserId || otherUserId === meId) throw new Error('CANNOT_MESSAGE_SELF');
    const other = await prisma.user.findUnique({ where: { id: otherUserId }, select: { ...USER_SELECT, deletedAt: true } });
    if (!other || other.deletedAt) throw new Error('CONVERSATION_NOT_FOUND');

    const pair = canonical(meId, otherUserId);
    let conv = await prisma.conversation.findUnique({
      where: { userAId_userBId: pair },
      select: { id: true, clubId: true, lastMessageAt: true },
    });
    if (!conv) {
      const clubId = await this.sharedActiveClubId(meId, otherUserId, clubSlug);
      await this.assertNotBlocked(meId, otherUserId);
      await assertRateLimit('dm:newconv', meId, 15, 3600);
```

Replace the `other` lookup and the `if (!conv)` block's start with:

```ts
  async getOrCreateConversation(meId: string, otherUserId: string, clubSlug?: string | null): Promise<ConversationSummaryDTO> {
    if (!otherUserId || otherUserId === meId) throw new Error('CANNOT_MESSAGE_SELF');
    const other = await prisma.user.findUnique({
      where: { id: otherUserId },
      select: { ...USER_SELECT, deletedAt: true, acceptsDirectMessages: true },
    });
    if (!other || other.deletedAt) throw new Error('CONVERSATION_NOT_FOUND');

    const pair = canonical(meId, otherUserId);
    let conv = await prisma.conversation.findUnique({
      where: { userAId_userBId: pair },
      select: { id: true, clubId: true, lastMessageAt: true },
    });
    if (!conv) {
      const clubId = await this.sharedActiveClubId(meId, otherUserId, clubSlug);
      await this.assertNotBlocked(meId, otherUserId);
      await this.assertAcceptsMessages(meId, otherUserId, other.acceptsDirectMessages);
      await assertRateLimit('dm:newconv', meId, 15, 3600);
```

(The rest of the method — `create`, the `P2002` catch, `conversationParticipant.createMany`, the return — is unchanged.)

- [ ] **Step 5: Run all messaging service tests**

Run (from `backend/`):

```bash
node node_modules/jest/bin/jest.js src/services/__tests__/messaging.service.test.ts
```

Expected: PASS, all tests including the 5 new ones.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/messaging.service.ts backend/src/services/__tests__/messaging.service.test.ts
git commit -m "feat(messaging): gate new conversations on acceptsDirectMessages, friends bypass"
```

---

### Task 3: Route error mapping — `DM_DISABLED` → 409

**Files:**
- Modify: `backend/src/routes/conversations.ts:12-22`
- Test: `backend/src/routes/__tests__/conversations.routes.test.ts:103-112`

- [ ] **Step 1: Write the failing assertion**

In `backend/src/routes/__tests__/conversations.routes.test.ts`, the existing test at lines 103-112 is:

```ts
  it('mapping erreurs : NOT_CO_MEMBERS 403, USER_BLOCKED 409, CANNOT_MESSAGE_SELF 400, CONVERSATION_NOT_FOUND 404', async () => {
    for (const [code, status] of [
      ['NOT_CO_MEMBERS', 403], ['USER_BLOCKED', 409], ['CANNOT_MESSAGE_SELF', 400], ['CONVERSATION_NOT_FOUND', 404],
    ] as const) {
      mocks.getOrCreateConversation.mockRejectedValue(new Error(code));
      const res = await request(app).post('/api/me/conversations').send({ otherUserId: 'u2' }).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(status);
      expect(res.body).toEqual({ error: code });
    }
  });
```

Change the title and the array to add `DM_DISABLED`:

```ts
  it('mapping erreurs : NOT_CO_MEMBERS 403, USER_BLOCKED 409, DM_DISABLED 409, CANNOT_MESSAGE_SELF 400, CONVERSATION_NOT_FOUND 404', async () => {
    for (const [code, status] of [
      ['NOT_CO_MEMBERS', 403], ['USER_BLOCKED', 409], ['DM_DISABLED', 409], ['CANNOT_MESSAGE_SELF', 400], ['CONVERSATION_NOT_FOUND', 404],
    ] as const) {
      mocks.getOrCreateConversation.mockRejectedValue(new Error(code));
      const res = await request(app).post('/api/me/conversations').send({ otherUserId: 'u2' }).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(status);
      expect(res.body).toEqual({ error: code });
    }
  });
```

- [ ] **Step 2: Run it, confirm it fails on `DM_DISABLED`**

Run (from `backend/`):

```bash
node node_modules/jest/bin/jest.js src/routes/__tests__/conversations.routes.test.ts -t "mapping erreurs"
```

Expected: FAIL — `DM_DISABLED` isn't in `ERROR_STATUS`, so `handleError` calls `next(err)` and the response is a 500, not 409.

- [ ] **Step 3: Add the mapping**

In `backend/src/routes/conversations.ts`, the `ERROR_STATUS` map is:

```ts
const ERROR_STATUS: Record<string, number> = {
  CONVERSATION_NOT_FOUND: 404,
  MESSAGE_NOT_FOUND:      404,
  NOT_CO_MEMBERS:         403,
  NOT_ALLOWED:            403,
  USER_BLOCKED:           409,
  CANNOT_MESSAGE_SELF:    400,
  CANNOT_BLOCK_SELF:      400,
  VALIDATION_ERROR:       400,
  RATE_LIMITED:           429,
};
```

Add `DM_DISABLED: 409,` next to `USER_BLOCKED`:

```ts
const ERROR_STATUS: Record<string, number> = {
  CONVERSATION_NOT_FOUND: 404,
  MESSAGE_NOT_FOUND:      404,
  NOT_CO_MEMBERS:         403,
  NOT_ALLOWED:            403,
  USER_BLOCKED:           409,
  DM_DISABLED:            409,
  CANNOT_MESSAGE_SELF:    400,
  CANNOT_BLOCK_SELF:      400,
  VALIDATION_ERROR:       400,
  RATE_LIMITED:           429,
};
```

- [ ] **Step 4: Run the test again**

Run (from `backend/`):

```bash
node node_modules/jest/bin/jest.js src/routes/__tests__/conversations.routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/conversations.ts backend/src/routes/__tests__/conversations.routes.test.ts
git commit -m "feat(routes): map DM_DISABLED to 409"
```

---

### Task 4: `PATCH /api/me` accepts `acceptsDirectMessages`

**Files:**
- Modify: `backend/src/routes/me.ts:31-36` (`PROFILE_SELECT`)
- Modify: `backend/src/routes/me.ts:113-148` (`PATCH /`)
- Test: `backend/src/routes/__tests__/me.routes.test.ts`

- [ ] **Step 1: Write the failing tests**

In `backend/src/routes/__tests__/me.routes.test.ts`, insert these two tests right before the closing `});` of `describe('PATCH /api/me', ...)` (line 121, right after the existing `acceptsFriendRequests` pair at lines 110-120):

```ts
  it('PATCH /api/me accepte acceptsDirectMessages (booléen)', async () => {
    prismaMock.user.update.mockResolvedValue({ ...PROFILE, acceptsDirectMessages: false } as any);
    const res = await request(app).patch('/api/me').send({ acceptsDirectMessages: false }).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { acceptsDirectMessages: false } }));
  });

  it('PATCH /api/me rejette acceptsDirectMessages non booléen', async () => {
    const res = await request(app).patch('/api/me').send({ acceptsDirectMessages: 'non' }).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 2: Run, confirm failure**

Run (from `backend/`):

```bash
node node_modules/jest/bin/jest.js src/routes/__tests__/me.routes.test.ts -t "acceptsDirectMessages"
```

Expected: FAIL — the route silently ignores `acceptsDirectMessages` today (not in the destructured body, not validated, not written), so `prismaMock.user.update` is called with `data: {}` instead of `{ acceptsDirectMessages: false }`, and the "rejette" test gets 200 instead of 400.

- [ ] **Step 3: Implement**

In `backend/src/routes/me.ts`, `PROFILE_SELECT` (lines 31-36):

```ts
const PROFILE_SELECT = {
  id: true, email: true, firstName: true, lastName: true, phone: true, sex: true,
  birthDate: true, avatarUrl: true, locale: true, isSuperAdmin: true, showInLeaderboard: true,
  autoMatchProposals: true, acceptsFriendRequests: true,
  preferredSport: { select: { id: true, key: true, name: true } },
} as const;
```

becomes:

```ts
const PROFILE_SELECT = {
  id: true, email: true, firstName: true, lastName: true, phone: true, sex: true,
  birthDate: true, avatarUrl: true, locale: true, isSuperAdmin: true, showInLeaderboard: true,
  autoMatchProposals: true, acceptsFriendRequests: true, acceptsDirectMessages: true,
  preferredSport: { select: { id: true, key: true, name: true } },
} as const;
```

In the `PATCH /` handler (lines 115-148), the destructuring/type/validation is:

```ts
    const { phone, sex, birthDate, locale, showInLeaderboard, autoMatchProposals, acceptsFriendRequests, preferredSportId } = req.body;
    const data: { phone?: string | null; sex?: 'MALE' | 'FEMALE' | null; birthDate?: Date | null; locale?: string | null; showInLeaderboard?: boolean; autoMatchProposals?: boolean; acceptsFriendRequests?: boolean; preferredSportId?: string | null } = {};
```

becomes:

```ts
    const { phone, sex, birthDate, locale, showInLeaderboard, autoMatchProposals, acceptsFriendRequests, acceptsDirectMessages, preferredSportId } = req.body;
    const data: { phone?: string | null; sex?: 'MALE' | 'FEMALE' | null; birthDate?: Date | null; locale?: string | null; showInLeaderboard?: boolean; autoMatchProposals?: boolean; acceptsFriendRequests?: boolean; acceptsDirectMessages?: boolean; preferredSportId?: string | null } = {};
```

And right after the existing `acceptsFriendRequests` block:

```ts
    if (acceptsFriendRequests !== undefined) {
      if (typeof acceptsFriendRequests !== 'boolean') return void res.status(400).json({ error: 'acceptsFriendRequests invalide' });
      data.acceptsFriendRequests = acceptsFriendRequests;
    }
```

add:

```ts
    if (acceptsFriendRequests !== undefined) {
      if (typeof acceptsFriendRequests !== 'boolean') return void res.status(400).json({ error: 'acceptsFriendRequests invalide' });
      data.acceptsFriendRequests = acceptsFriendRequests;
    }
    if (acceptsDirectMessages !== undefined) {
      if (typeof acceptsDirectMessages !== 'boolean') return void res.status(400).json({ error: 'acceptsDirectMessages invalide' });
      data.acceptsDirectMessages = acceptsDirectMessages;
    }
```

- [ ] **Step 4: Run**

Run (from `backend/`):

```bash
node node_modules/jest/bin/jest.js src/routes/__tests__/me.routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts
git commit -m "feat(me): PATCH /api/me accepts acceptsDirectMessages"
```

---

### Task 5: Frontend types — `MyProfile` + `updateMyProfile`

**Files:**
- Modify: `frontend/lib/api.ts:715-716` (`updateMyProfile`)
- Modify: `frontend/lib/api.ts:2260-2275` (`MyProfile`)

No dedicated test file — this is a pure type change, verified by `tsc` in Task 11 and exercised indirectly by Task 7's tests.

- [ ] **Step 1: Extend `MyProfile`**

In `frontend/lib/api.ts`, the interface (lines 2260-2275) is:

```ts
export interface MyProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  sex: Sex | null;
  birthDate: string | null;
  avatarUrl: string | null;
  locale: string | null;
  isSuperAdmin: boolean;
  showInLeaderboard: boolean;
  autoMatchProposals: boolean;
  acceptsFriendRequests: boolean;
  preferredSport: { id: string; key: string; name: string } | null;
}
```

Add `acceptsDirectMessages: boolean;` right after `acceptsFriendRequests`:

```ts
export interface MyProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  sex: Sex | null;
  birthDate: string | null;
  avatarUrl: string | null;
  locale: string | null;
  isSuperAdmin: boolean;
  showInLeaderboard: boolean;
  autoMatchProposals: boolean;
  acceptsFriendRequests: boolean;
  acceptsDirectMessages: boolean;
  preferredSport: { id: string; key: string; name: string } | null;
}
```

- [ ] **Step 2: Extend `updateMyProfile`'s body type**

Line 715-716 is:

```ts
  updateMyProfile: (body: { phone?: string | null; sex?: Sex | null; birthDate?: string | null; locale?: string | null; showInLeaderboard?: boolean; autoMatchProposals?: boolean; acceptsFriendRequests?: boolean; preferredSportId?: string | null }, token: string) =>
    request<MyProfile>('/api/me', { method: 'PATCH', body: JSON.stringify(body) }, token),
```

Add `acceptsDirectMessages?: boolean;` to the body type:

```ts
  updateMyProfile: (body: { phone?: string | null; sex?: Sex | null; birthDate?: string | null; locale?: string | null; showInLeaderboard?: boolean; autoMatchProposals?: boolean; acceptsFriendRequests?: boolean; acceptsDirectMessages?: boolean; preferredSportId?: string | null }, token: string) =>
    request<MyProfile>('/api/me', { method: 'PATCH', body: JSON.stringify(body) }, token),
```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): expose acceptsDirectMessages on MyProfile/updateMyProfile"
```

---

### Task 6: `lib/messages.ts` — `dmErrorMessage`

**Files:**
- Modify: `frontend/lib/messages.ts`
- Test: `frontend/__tests__/messages.test.ts`

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/messages.test.ts`, the import at line 1 is:

```ts
import { inboxPreview, dayKey, dayLabel, isReadByOther, applyReactionToggle } from '@/lib/messages';
```

Change it to:

```ts
import { inboxPreview, dayKey, dayLabel, isReadByOther, applyReactionToggle, dmErrorMessage } from '@/lib/messages';
```

Then append this new `describe` block at the end of the file (after the closing `});` of `describe('applyReactionToggle (patch local optimiste)', ...)`):

```ts
describe('dmErrorMessage', () => {
  it('mappe les codes connus vers un message lisible', () => {
    expect(dmErrorMessage(new Error('DM_DISABLED'))).toBe("Ce joueur n'accepte pas les messages privés.");
    expect(dmErrorMessage(new Error('USER_BLOCKED'))).toBe("Impossible d'écrire à ce joueur.");
    expect(dmErrorMessage(new Error('NOT_CO_MEMBERS'))).toBe("Vous n'avez plus de club en commun avec ce joueur.");
  });
  it('repli générique sur un code inconnu ou une valeur qui n\'est pas une Error', () => {
    expect(dmErrorMessage(new Error('BOOM'))).toBe("Impossible d'ouvrir cette conversation.");
    expect(dmErrorMessage('pas une Error')).toBe("Impossible d'ouvrir cette conversation.");
  });
});
```

- [ ] **Step 2: Run, confirm it fails**

Run (from `frontend/`):

```bash
node node_modules/jest/bin/jest.js __tests__/messages.test.ts
```

Expected: FAIL to even compile/run — `dmErrorMessage` doesn't exist yet in `lib/messages.ts`.

- [ ] **Step 3: Implement**

At the end of `frontend/lib/messages.ts` (after the `openDm` function), add:

```ts
/** Codes d'erreur de la messagerie mappés en texte lisible (au moment de la création d'une conversation). */
export const DM_ERRORS: Record<string, string> = {
  DM_DISABLED: "Ce joueur n'accepte pas les messages privés.",
  USER_BLOCKED: "Impossible d'écrire à ce joueur.",
  NOT_CO_MEMBERS: "Vous n'avez plus de club en commun avec ce joueur.",
};

/** Message affichable pour une erreur d'ouverture de conversation (repli générique sinon). */
export function dmErrorMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : '';
  return DM_ERRORS[code] ?? "Impossible d'ouvrir cette conversation.";
}
```

- [ ] **Step 4: Run**

Run (from `frontend/`):

```bash
node node_modules/jest/bin/jest.js __tests__/messages.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/messages.ts frontend/__tests__/messages.test.ts
git commit -m "feat(messages): add dmErrorMessage code-to-text mapper"
```

---

### Task 7: Profile page — "Recevoir des messages privés" toggle

**Files:**
- Modify: `frontend/app/me/profile/page.tsx:183-189` (new handler)
- Modify: `frontend/app/me/profile/page.tsx:505-517` (new field + tweaked help text)
- Test: `frontend/__tests__/MeProfile.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/MeProfile.test.tsx`, the shared `profile` fixture (lines 43-47) is:

```ts
const profile = {
  id: 'u1', email: 'eric@palova.fr', firstName: 'Eric', lastName: 'Nougayrede', phone: '0609032635', sex: 'MALE',
  birthDate: '1973-07-08T00:00:00.000Z', avatarUrl: null, locale: 'fr', isSuperAdmin: false, showInLeaderboard: false,
  autoMatchProposals: false, acceptsFriendRequests: false,
};
```

Add `acceptsDirectMessages: true,`:

```ts
const profile = {
  id: 'u1', email: 'eric@palova.fr', firstName: 'Eric', lastName: 'Nougayrede', phone: '0609032635', sex: 'MALE',
  birthDate: '1973-07-08T00:00:00.000Z', avatarUrl: null, locale: 'fr', isSuperAdmin: false, showInLeaderboard: false,
  autoMatchProposals: false, acceptsFriendRequests: false, acceptsDirectMessages: true,
};
```

Then, right after the existing test `'active « Autoriser les demandes d\'ami » ...'` (lines 153-161), add:

```ts
  it('désactive « Recevoir des messages privés » appelle updateMyProfile({ acceptsDirectMessages: false })', async () => {
    api.updateMyProfile.mockResolvedValue({ ...profile, acceptsDirectMessages: false });
    wrap();
    const group = await screen.findByRole('group', { name: /recevoir des messages privés/i });
    fireEvent.click(within(group).getByText('Non'));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith({ acceptsDirectMessages: false }, 'abc'));
    await waitFor(() => expect(within(group).getByText('Non')).toHaveStyle({ fontWeight: 700 }));
  });
```

- [ ] **Step 2: Run, confirm failure**

Run (from `frontend/`):

```bash
node node_modules/jest/bin/jest.js __tests__/MeProfile.test.tsx -t "Recevoir des messages privés"
```

Expected: FAIL — no such group/toggle exists in the page yet.

- [ ] **Step 3: Implement the handler**

In `frontend/app/me/profile/page.tsx`, right after `changeAcceptsFriendRequests` (lines 183-189):

```ts
  const changeAcceptsFriendRequests = async (next: boolean) => {
    if (!token || !profile) return;
    setError(null);
    setProfile({ ...profile, acceptsFriendRequests: next }); // optimiste
    try { setProfile(await api.updateMyProfile({ acceptsFriendRequests: next }, token)); }
    catch (e) { setError((e as Error).message); }
  };
```

add:

```ts
  const changeAcceptsDirectMessages = async (next: boolean) => {
    if (!token || !profile) return;
    setError(null);
    setProfile({ ...profile, acceptsDirectMessages: next }); // optimiste
    try { setProfile(await api.updateMyProfile({ acceptsDirectMessages: next }, token)); }
    catch (e) { setError((e as Error).message); }
  };
```

- [ ] **Step 4: Implement the field + tweak the friend-requests help text**

The current block (lines 505-518) is:

```tsx
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={label}>Autoriser les demandes d&apos;ami</span>
                  <div role="group" aria-label="Autoriser les demandes d'ami">
                    <Segmented<'oui' | 'non'>
                      value={profile.acceptsFriendRequests ? 'oui' : 'non'}
                      onChange={(v) => changeAcceptsFriendRequests(v === 'oui')}
                      options={[{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }]}
                    />
                  </div>
                  <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>
                    La messagerie reste ouverte à tous les membres du club ; ce réglage ne concerne que les amitiés.
                  </span>
                </div>
              </section>
```

Replace it with:

```tsx
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={label}>Autoriser les demandes d&apos;ami</span>
                  <div role="group" aria-label="Autoriser les demandes d'ami">
                    <Segmented<'oui' | 'non'>
                      value={profile.acceptsFriendRequests ? 'oui' : 'non'}
                      onChange={(v) => changeAcceptsFriendRequests(v === 'oui')}
                      options={[{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }]}
                    />
                  </div>
                  <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>
                    Ce réglage ne concerne que les amitiés — la messagerie privée se règle séparément ci-dessous.
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={label}>Recevoir des messages privés</span>
                  <div role="group" aria-label="Recevoir des messages privés">
                    <Segmented<'oui' | 'non'>
                      value={profile.acceptsDirectMessages ? 'oui' : 'non'}
                      onChange={(v) => changeAcceptsDirectMessages(v === 'oui')}
                      options={[{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }]}
                    />
                  </div>
                  <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>
                    Vos amis confirmés peuvent toujours vous écrire, même désactivé.
                  </span>
                </div>
              </section>
```

- [ ] **Step 5: Run**

Run (from `frontend/`):

```bash
node node_modules/jest/bin/jest.js __tests__/MeProfile.test.tsx
```

Expected: PASS, all tests including the existing `acceptsFriendRequests` one (its help-text change isn't asserted by any test, so it stays green).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/me/profile/page.tsx frontend/__tests__/MeProfile.test.tsx
git commit -m "feat(profile): add 'Recevoir des messages privés' toggle"
```

---

### Task 8: `NewConversationPanel` — specific error message

**Files:**
- Modify: `frontend/components/messages/NewConversationPanel.tsx:1-53`
- Test: `frontend/__tests__/NewConversationPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/NewConversationPanel.test.tsx`, add this test after the existing `'échec de openConversation affiche une erreur et laisse le panneau ouvert'` test (lines 80-87):

```ts
it('échec DM_DISABLED affiche le message spécifique', async () => {
  apiMock.openConversation.mockRejectedValue(new Error('DM_DISABLED'));
  renderPanel();
  fireEvent.click(await screen.findByText('Léa M'));
  expect(await screen.findByText("Ce joueur n'accepte pas les messages privés.")).toBeInTheDocument();
  expect(onOpened).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, confirm failure**

Run (from `frontend/`):

```bash
node node_modules/jest/bin/jest.js __tests__/NewConversationPanel.test.tsx -t "DM_DISABLED"
```

Expected: FAIL — today the panel always shows the generic "Impossible d'ouvrir cette conversation." regardless of the error code.

- [ ] **Step 3: Implement**

In `frontend/components/messages/NewConversationPanel.tsx`, add the import at the top (line 1-7):

```tsx
'use client';
import { useEffect, useState } from 'react';
import { api, ClubMemberSearchResult, ConversationSummary, Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
```

becomes:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { api, ClubMemberSearchResult, ConversationSummary, Friend } from '@/lib/api';
import { dmErrorMessage } from '@/lib/messages';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
```

Then the `select` function (lines 43-53) is:

```tsx
  const select = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      const conversation = await api.openConversation(userId, token, slug);
      onOpened(conversation);
    } catch {
      setError("Impossible d'ouvrir cette conversation.");
      setBusyId(null);
    }
  };
```

Change the `catch` clause to use the mapper:

```tsx
  const select = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      const conversation = await api.openConversation(userId, token, slug);
      onOpened(conversation);
    } catch (err) {
      setError(dmErrorMessage(err));
      setBusyId(null);
    }
  };
```

- [ ] **Step 4: Run all panel tests**

Run (from `frontend/`):

```bash
node node_modules/jest/bin/jest.js __tests__/NewConversationPanel.test.tsx
```

Expected: PASS — including the pre-existing generic-error test (`new Error('boom')` still falls through `dmErrorMessage`'s fallback to the same generic string).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/messages/NewConversationPanel.tsx frontend/__tests__/NewConversationPanel.test.tsx
git commit -m "feat(messages): NewConversationPanel shows specific DM error messages"
```

---

### Task 9: `MessagesHub` — deeplink error banner

**Files:**
- Modify: `frontend/components/messages/MessagesHub.tsx`
- Test: `frontend/__tests__/MessagesHub.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `frontend/__tests__/MessagesHub.test.tsx`, add these two tests after the existing `'deeplink initialWith → openConversation puis fil ouvert'` test (lines 58-62):

```ts
it('deeplink refusé (DM_DISABLED) affiche un bandeau d\'erreur explicite', async () => {
  apiMock.openConversation.mockRejectedValue(new Error('DM_DISABLED'));
  renderHub({ initialWith: 'u9' });
  expect(await screen.findByRole('alert')).toHaveTextContent("Ce joueur n'accepte pas les messages privés.");
});

it('sélectionner une conversation après un deeplink refusé efface le bandeau', async () => {
  apiMock.openConversation.mockRejectedValue(new Error('DM_DISABLED'));
  renderHub({ initialWith: 'u9' });
  await screen.findByRole('alert');
  fireEvent.click(await screen.findByText('Marie Dupont'));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});
```

- [ ] **Step 2: Run, confirm failure**

Run (from `frontend/`):

```bash
node node_modules/jest/bin/jest.js __tests__/MessagesHub.test.tsx -t "deeplink refusé|efface le bandeau"
```

Expected: FAIL — today a rejected deeplink is swallowed by `.catch(() => {})`, no `role="alert"` element ever renders.

- [ ] **Step 3: Implement**

In `frontend/components/messages/MessagesHub.tsx`, add the import at the top (line 1-12):

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, notificationsStreamUrl, ConversationSummary, DmMeta, DmUserInfo } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
```

becomes:

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, notificationsStreamUrl, ConversationSummary, DmMeta, DmUserInfo } from '@/lib/api';
import { dmErrorMessage } from '@/lib/messages';
import { useTheme } from '@/lib/ThemeProvider';
```

Add a new state next to `newOpen` (line 33):

```ts
  const [newOpen, setNewOpen] = useState(false);
```

becomes:

```ts
  const [newOpen, setNewOpen] = useState(false);
  const [deeplinkError, setDeeplinkError] = useState<string | null>(null);
```

The deeplink effect (lines 58-65) is:

```ts
  // Deeplink ?with= : get-or-create puis ouverture.
  useEffect(() => {
    if (!initialWith) return;
    api.openConversation(initialWith, token, clubSlug)
      .then((c) => { setSelected(c); reload(); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWith, token, clubSlug]);
```

becomes:

```ts
  // Deeplink ?with= : get-or-create puis ouverture.
  useEffect(() => {
    if (!initialWith) return;
    api.openConversation(initialWith, token, clubSlug)
      .then((c) => { setDeeplinkError(null); setSelected(c); reload(); })
      .catch((err) => setDeeplinkError(dmErrorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWith, token, clubSlug]);
```

The `list`'s `ConversationList` (line 138) is:

```tsx
        <ConversationList conversations={conversations} selectedId={selected?.id ?? null} now={now} onSelect={setSelected} />
```

becomes:

```tsx
        <ConversationList conversations={conversations} selectedId={selected?.id ?? null} now={now}
          onSelect={(c) => { setDeeplinkError(null); setSelected(c); }} />
```

The `NewConversationPanel`'s `onOpened` (line 167) is:

```tsx
          onOpened={(c) => { setSelected(c); reload(); setNewOpen(false); }}
```

becomes:

```tsx
          onOpened={(c) => { setDeeplinkError(null); setSelected(c); reload(); setNewOpen(false); }}
```

Finally, the `return` statement (lines 143-162) is:

```tsx
  return (
    <div style={{ border: `1px solid ${th.line}`, borderRadius: 16, background: th.bg, overflow: 'hidden',
      display: 'flex', height: 'min(680px, calc(100vh - 220px))', minHeight: 380 }}>
      {isDesktop ? (
        <>
          <div style={{ width: 320, borderRight: `1px solid ${th.line}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{list}</div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {thread ?? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: th.fontUI, fontSize: 14, color: th.textFaint }}>
                Sélectionnez une conversation
              </div>
            )}
          </div>
        </>
      ) : (
        // minWidth:0 — sans lui, le min-content du composer (textarea+boutons) remonte via
        // min-width:auto et pousse tout le fil hors de la carte sur mobile (bulles rognées).
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{selected ? thread : list}</div>
      )}

      {newOpen && clubSlug && (
```

Replace it with (note `flexDirection: 'column'` added to the outer container, and the desktop/mobile block wrapped in a new `flex:1` row div):

```tsx
  return (
    <div style={{ border: `1px solid ${th.line}`, borderRadius: 16, background: th.bg, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', height: 'min(680px, calc(100vh - 220px))', minHeight: 380 }}>
      {deeplinkError && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          padding: '8px 14px', background: '#e5484d1a', borderBottom: `1px solid ${th.line}`,
          fontFamily: th.fontUI, fontSize: 13, color: '#e5484d' }}>
          <span>{deeplinkError}</span>
          <button type="button" aria-label="Fermer" onClick={() => setDeeplinkError(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#e5484d', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {isDesktop ? (
          <>
            <div style={{ width: 320, borderRight: `1px solid ${th.line}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{list}</div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {thread ?? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: th.fontUI, fontSize: 14, color: th.textFaint }}>
                  Sélectionnez une conversation
                </div>
              )}
            </div>
          </>
        ) : (
          // minWidth:0 — sans lui, le min-content du composer (textarea+boutons) remonte via
          // min-width:auto et pousse tout le fil hors de la carte sur mobile (bulles rognées).
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{selected ? thread : list}</div>
        )}
      </div>

      {newOpen && clubSlug && (
```

(Everything after `{newOpen && clubSlug && (` — the `NewConversationPanel`, `ConfirmDialog`, blocked-members dialog, and the closing `</div>` of the outer container — is unchanged and stays where it is, still a sibling inside the same outer `<div>`.)

- [ ] **Step 4: Run all MessagesHub tests**

Run (from `frontend/`):

```bash
node node_modules/jest/bin/jest.js __tests__/MessagesHub.test.tsx
```

Expected: PASS, all tests (the layout restructuring doesn't change any existing assertion — desktop/mobile branch content and behavior are identical, just now inside an extra wrapper row).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/messages/MessagesHub.tsx frontend/__tests__/MessagesHub.test.tsx
git commit -m "feat(messages): MessagesHub shows a dismissible error banner on a refused deeplink"
```

---

### Task 10: `DmWidgetHost` — error panel in the desktop widget

**Files:**
- Modify: `frontend/components/messages/DmWidgetHost.tsx` (full file, 77 lines)
- Test: `frontend/__tests__/DmWidgetHost.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/DmWidgetHost.test.tsx`, add this test after the existing `'desktop : palova:open-dm ouvre le widget ancré avec le fil'` test (lines 41-52):

```ts
it('desktop : conversation refusée (DM_DISABLED) affiche un message d\'erreur fermable', async () => {
  (window.matchMedia as unknown as jest.Mock) = jest.fn().mockReturnValue({
    matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  });
  apiMock.openConversation.mockRejectedValue(new Error('DM_DISABLED'));
  render(<ThemeProvider><DmWidgetHost /></ThemeProvider>);
  emitOpen('u2');
  expect(await screen.findByRole('alert')).toHaveTextContent("Ce joueur n'accepte pas les messages privés.");
  fireEvent.click(screen.getByRole('button', { name: /fermer/i }));
  expect(screen.queryByRole('alert')).toBeNull();
});
```

- [ ] **Step 2: Run, confirm failure**

Run (from `frontend/`):

```bash
node node_modules/jest/bin/jest.js __tests__/DmWidgetHost.test.tsx -t "DM_DISABLED"
```

Expected: FAIL — today a rejected `openConversation` is swallowed (`.catch(() => {})`) and the component returns `null` (no `conv` was ever set), so nothing renders.

- [ ] **Step 3: Implement**

Replace the full contents of `frontend/components/messages/DmWidgetHost.tsx` with:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ConversationSummary } from '@/lib/api';
import { dmErrorMessage } from '@/lib/messages';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { useClub } from '@/lib/ClubProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { MessageThread } from './MessageThread';

// Hôte GLOBAL du widget de conversation (monté une fois dans le layout racine).
// Écoute l'event window `palova:open-dm` ({ detail: { userId, draft? } }) émis par openDm() :
// desktop → widget ancré bas-droite (pattern OpenMatchChatSheet, la page reste cliquable) ;
// mobile → navigation vers /me/messages?with=. Rien n'est rendu hors connexion.
// L'id du viewer est résolu via getMyProfile AU PREMIER open seulement (mémorisé) —
// pas d'appel systématique au montage : le host est sur toutes les pages.
export function DmWidgetHost() {
  const { th } = useTheme();
  const router = useRouter();
  const { token, ready } = useAuth();
  const { slug } = useClub();
  const isDesktop = useIsDesktop();
  const [conv, setConv] = useState<ConversationSummary | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const viewerAsked = useRef(false);

  useEffect(() => {
    if (!ready || !token) return;
    const onOpen = (e: Event) => {
      const { userId, draft: draftText } = (e as CustomEvent<{ userId?: string; draft?: string }>).detail ?? {};
      if (!userId) return;
      if (!isDesktop) {
        router.push(`/me/messages?with=${userId}${draftText ? `&draft=${encodeURIComponent(draftText)}` : ''}`);
        return;
      }
      if (!viewerAsked.current) {
        viewerAsked.current = true;
        api.getMyProfile(token).then((p) => setViewerId(p.id)).catch(() => { viewerAsked.current = false; });
      }
      setDraft(draftText);
      setError(null);
      api.openConversation(userId, token, slug ?? null)
        .then((c) => setConv(c))
        .catch((err) => { setConv(null); setError(dmErrorMessage(err)); });
    };
    window.addEventListener('palova:open-dm', onOpen);
    return () => window.removeEventListener('palova:open-dm', onOpen);
  }, [ready, token, isDesktop, router, slug]);

  if (!ready || !token || !isDesktop) return null;
  if (!error && !(conv && viewerId)) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end',
      justifyContent: 'flex-end', padding: 24, pointerEvents: 'none' }}>
      <div style={{ background: th.bg, display: 'flex', flexDirection: 'column', pointerEvents: 'auto',
        // minWidth:0 — item d'un flex row : sans lui, min-width:auto laisse le min-content
        // du composer gonfler le panneau au-delà des 380px voulus.
        width: 'min(380px, 92vw)', minWidth: 0, borderRadius: 20, boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
        ...(error ? {} : { height: 'min(520px, 80vh)' }) }}>
        {error ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 16 }}>
            <span role="alert" style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text, flex: 1 }}>{error}</span>
            <button type="button" aria-label="Fermer" onClick={() => setError(null)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 20 }}>×</button>
          </div>
        ) : conv && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${th.line}` }}>
              <Avatar firstName={conv.other.firstName} lastName={conv.other.lastName} avatarUrl={conv.other.avatarUrl}
                size={28} color={colorForSeed(conv.other.userId)} />
              <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: th.text, flex: 1 }}>
                {conv.other.firstName} {conv.other.lastName}
              </span>
              <button type="button" aria-label="Ouvrir la messagerie" title="Ouvrir la messagerie"
                onClick={() => { setConv(null); router.push(`/me/messages?with=${conv.other.userId}`); }}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 15 }}>⤢</button>
              <button type="button" aria-label="Fermer" onClick={() => setConv(null)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 20 }}>×</button>
            </div>
            <MessageThread conversationId={conv.id} token={token} viewerUserId={viewerId!} other={conv.other} initialDraft={draft} />
          </>
        )}
      </div>
    </div>
  );
}
```

Notes on this diff versus the original:
- `error` state added, reset to `null` right before each new `openConversation` attempt.
- `openConversation`'s `.catch(() => {})` becomes `.catch((err) => { setConv(null); setError(dmErrorMessage(err)); })`.
- The early-return guard changes from `!conv || !viewerId` to a two-line form that still requires `conv && viewerId` for the success path (byte-for-byte same gating as before), but now also renders when `error` is set even though `conv`/`viewerId` are absent.
- `viewerId!` — safe: the second guard (`if (!error && !(conv && viewerId)) return null;`) has already ensured that when we reach the `conv &&` branch, `viewerId` is non-null.

- [ ] **Step 4: Run all DmWidgetHost tests**

Run (from `frontend/`):

```bash
node node_modules/jest/bin/jest.js __tests__/DmWidgetHost.test.tsx
```

Expected: PASS, all 3 tests (the 2 pre-existing + the new one).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/messages/DmWidgetHost.tsx frontend/__tests__/DmWidgetHost.test.tsx
git commit -m "feat(messages): DmWidgetHost shows a dismissible error panel on a refused conversation"
```

---

### Task 11: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Backend — scoped test run**

Run (from `backend/`):

```bash
node node_modules/jest/bin/jest.js src/services/__tests__/messaging.service.test.ts src/routes/__tests__/conversations.routes.test.ts src/routes/__tests__/me.routes.test.ts
```

Expected: PASS, 0 failures.

- [ ] **Step 2: Backend — type check**

Run (from `backend/`):

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: no errors. (Requires Task 1's `npx prisma generate` to have run successfully, so `acceptsDirectMessages` exists on the generated `User` type.)

- [ ] **Step 3: Frontend — scoped test run**

Run (from `frontend/`):

```bash
node node_modules/jest/bin/jest.js __tests__/messages.test.ts __tests__/MeProfile.test.tsx __tests__/NewConversationPanel.test.tsx __tests__/MessagesHub.test.tsx __tests__/DmWidgetHost.test.tsx
```

Expected: PASS, 0 failures.

- [ ] **Step 4: Frontend — type check**

Run (from `frontend/`):

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Manual sanity check (optional but recommended)**

With the dev stack running (`start.ps1` or `npm run dev` in both `backend/` and `frontend/`), verify the golden path once in a browser:
1. As one seeded user, go to `/me/profile` → Préférences → set "Recevoir des messages privés" to "Non".
2. As a different co-member (not a confirmed friend of the first), try "Écrire à" that user from any surface (e.g. `/me/messages` → "Nouveau" → search them) — confirm the attempt fails with "Ce joueur n'accepte pas les messages privés." instead of doing nothing.
3. Confirm a pre-existing conversation between two such users (if any) still opens and works normally.

This step has no pass/fail assertion to script — it's a final human look, use the `verify` skill if you want a scripted CDP walk-through instead.

- [ ] **Step 6: Review `git status`/`git log` for the branch**

```bash
git status
git log --oneline -12
```

Expected: working tree clean, one commit per task (Tasks 1 through 10 — 10 commits total), all on the current branch.

---

## Out of scope (from the spec, do not implement here)

- Finer granularity than the binary everyone/friends (e.g. an explicit allow-list) — already covered by `UserBlock` for the inverse case.
- Cutting off already-open conversations when the toggle flips to off.
- Notifying the refused sender beyond the click-time error message.
- Annotating the preference in list endpoints (`searchClubMembers`, match teams, registrants…) to grey out buttons ahead of time.
- Per-club setting — the refusal is global, like `acceptsFriendRequests`.
