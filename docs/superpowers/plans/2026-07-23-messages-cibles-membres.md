# Messages ciblés aux membres — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Envoyer la diffusion club à une sélection de membres (depuis la liste ou la fiche), avec un type Info/Commercial, un consentement « Offres du club », des variables `{{prenom}}`/`{{nom}}` et un historique par membre — v1 email + notification app, SMS grisé.

**Architecture:** Généralisation de `BroadcastService.send` (ciblage intersecté ACTIVE, catégorie `CLUB_OFFERS` pour le commercial, substitution par destinataire via `substituteText`/`substituteHtml` du registre d'emails, persistance des destinataires) + une table `ClubBroadcastRecipient`. Côté front : cases sur la liste des membres → sessionStorage → composer broadcast enrichi.

**Tech Stack:** identique au plan fiche 360 (Prisma 7 SQL à la main + `db execute`, Jest via `node node_modules/jest/bin/jest.js`, `tsc --noEmit` en gate séparée).

**Spec:** `docs/superpowers/specs/2026-07-23-messages-cibles-membres-design.md`

**Prérequis:** le plan `2026-07-23-fiche-membre-360.md` est exécuté (la Task 8 d'ici pose la carte Contact sur la fiche 360).

**Règles transverses:** jamais `migrate dev`/`db push` ; commits par chemins explicites (WIP parallèle) ; `EMAIL_BROADCAST_ENABLED` (front) reste l'interrupteur du canal email — on n'y touche pas.

---

## File structure

**Backend**
- Modify: `backend/prisma/schema.prisma` — enum `NotificationCategory` + `CLUB_OFFERS`, `ClubBroadcast.kind`, model `ClubBroadcastRecipient`
- Create: `backend/prisma/migrations/20260723110000_add_targeted_broadcasts/migration.sql`
- Modify: `backend/src/services/broadcast.service.ts` — send ciblé + kind + substitution + recipients + `audience()` + `receivedBy()`
- Modify: `backend/src/routes/admin.ts` — body étendu, `POST /broadcast/audience`, `GET /members/:userId/broadcasts`
- Modify: `backend/src/routes/unsubscribe.ts` — `&cat=offers` → catégorie `CLUB_OFFERS`

**Frontend**
- Modify: `frontend/lib/api.ts` — types + `broadcastAudience` + `adminGetMemberBroadcasts`
- Modify: `frontend/lib/broadcast.ts` — helpers sessionStorage destinataires
- Modify: `frontend/lib/notifications.ts` — catégorie `CLUB_OFFERS` (« Offres du club »)
- Modify: `frontend/components/admin/members/MemberRow.tsx` — case à cocher (prop additive)
- Modify: `frontend/app/admin/members/page.tsx` — sélection + barre flottante
- Modify: `frontend/app/admin/broadcast/page.tsx` — chips destinataires, type, audience, variables, SMS grisé
- Create: `frontend/components/admin/members/MemberContactCard.tsx` — carte Contact de la fiche 360 (bouton message + derniers reçus)
- Modify: `frontend/app/admin/members/[userId]/page.tsx` — monte la carte Contact

---

### Task 1: Migration `add_targeted_broadcasts`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260723110000_add_targeted_broadcasts/migration.sql`

- [ ] **Step 1: Schéma**

```prisma
// enum NotificationCategory : ajouter en fin
  CLUB_OFFERS

// model ClubBroadcast : ajouter
  kind           String   @default("INFO") // INFO | COMMERCIAL (catégorie de consentement)
  recipients     ClubBroadcastRecipient[]

/// Destinataire d'une diffusion club — trace « à qui le club a adressé le message »
/// (avant filtrage par préférences). Sert l'historique par membre de la fiche 360.
model ClubBroadcastRecipient {
  id          String @id @default(cuid())
  broadcastId String @map("broadcast_id")
  userId      String @map("user_id")

  broadcast ClubBroadcast @relation(fields: [broadcastId], references: [id], onDelete: Cascade)
  user      User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([broadcastId, userId])
  @@index([userId])
  @@map("club_broadcast_recipients")
}

// model User : ajouter la relation inverse
  broadcastReceipts           ClubBroadcastRecipient[]
```

- [ ] **Step 2: Migration SQL**

Create `backend/prisma/migrations/20260723110000_add_targeted_broadcasts/migration.sql` :

```sql
-- Messages ciblés (spec 2026-07-23-messages-cibles-membres). Additif pur.
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'CLUB_OFFERS';
ALTER TABLE "club_broadcasts" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'INFO';

CREATE TABLE IF NOT EXISTS "club_broadcast_recipients" (
    "id" TEXT NOT NULL,
    "broadcast_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    CONSTRAINT "club_broadcast_recipients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "club_broadcast_recipients_broadcast_id_user_id_key"
    ON "club_broadcast_recipients"("broadcast_id", "user_id");
CREATE INDEX IF NOT EXISTS "club_broadcast_recipients_user_id_idx" ON "club_broadcast_recipients"("user_id");
ALTER TABLE "club_broadcast_recipients"
    ADD CONSTRAINT "club_broadcast_recipients_broadcast_id_fkey"
    FOREIGN KEY ("broadcast_id") REFERENCES "club_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "club_broadcast_recipients"
    ADD CONSTRAINT "club_broadcast_recipients_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

(Postgres accepte `ALTER TYPE … ADD VALUE` dans ce script tant que la valeur n'est pas utilisée dans la même transaction — c'est le cas.)

- [ ] **Step 3: Appliquer + générer**

Run (depuis `backend/`) :
```bash
npx prisma db execute --file prisma/migrations/20260723110000_add_targeted_broadcasts/migration.sql
npx prisma generate
```
Expected: `Script executed` puis `Generated Prisma Client`.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260723110000_add_targeted_broadcasts/migration.sql
git commit -m "feat(broadcast): categorie CLUB_OFFERS + kind + table des destinataires (migration)"
```

---

### Task 2: Backend — `send` ciblé, typé, substitué, tracé

**Files:**
- Modify: `backend/src/services/broadcast.service.ts`
- Modify: `backend/src/routes/admin.ts:1520-1538` (POST /broadcast)
- Test: `backend/src/services/__tests__/broadcast.service.test.ts`

- [ ] **Step 1: Tests qui échouent**

Ajouter à `broadcast.service.test.ts` (réutiliser le harness de mocks du fichier — mock prisma + mock `./notification/dispatcher` ; ajouter au mock prisma `clubBroadcastRecipient: { createMany: jest.fn() }` si absent, et `lastName: 'X'` aux fixtures membres) :

```ts
describe('BroadcastService — envoi ciblé', () => {
  it('recipientUserIds : intersecté avec les adhésions ACTIVES du club', async () => {
    await new BroadcastService().send('club-demo', 'staff-1', {
      title: 'Hello', bodyHtml: '<p>corps</p>', recipientUserIds: ['u1', 'u-hors-club'],
    });
    expect(prisma.clubMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clubId: 'club-demo', status: 'ACTIVE', userId: { in: ['u1', 'u-hors-club'] } }),
    }));
  });

  it('liste ciblée vide après intersection → VALIDATION_ERROR', async () => {
    (prisma.clubMembership.findMany as jest.Mock).mockResolvedValue([]);
    await expect(new BroadcastService().send('club-demo', 'staff-1', {
      title: 'Hello', bodyHtml: '<p>x</p>', recipientUserIds: ['u-fantome'],
    })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('COMMERCIAL : catégorie CLUB_OFFERS au dispatch + lien de désinscription &cat=offers', async () => {
    await new BroadcastService().send('club-demo', 'staff-1', {
      title: 'Promo', bodyHtml: '<p>-20%</p>', kind: 'COMMERCIAL',
    });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ category: 'CLUB_OFFERS' }));
    const emailArg = (dispatch as jest.Mock).mock.calls[0][0].email;
    expect(emailArg.html).toContain('cat=offers');
  });

  it('INFO (défaut) : catégorie CLUB_MESSAGES inchangée, pas de cat sur le lien', async () => {
    await new BroadcastService().send('club-demo', 'staff-1', { title: 'Info', bodyHtml: '<p>x</p>' });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ category: 'CLUB_MESSAGES' }));
  });

  it('substitue {{prenom}}/{{nom}} par destinataire (titre + corps + notif)', async () => {
    (prisma.clubMembership.findMany as jest.Mock).mockResolvedValue([
      { user: { id: 'u1', email: 'a@a.fr', firstName: 'Ines', lastName: 'Andre' } },
    ]);
    await new BroadcastService().send('club-demo', 'staff-1', {
      title: 'Coucou {{prenom}}', bodyHtml: '<p>Bonjour {{prenom}} {{nom}}</p>',
    });
    const call = (dispatch as jest.Mock).mock.calls[0][0];
    expect(call.title).toBe('Coucou Ines');
    expect(call.body).toContain('Bonjour Ines Andre');
    expect(call.email.html).toContain('Ines');
  });

  it('persiste kind + une ligne destinataire par membre visé', async () => {
    (prisma.clubMembership.findMany as jest.Mock).mockResolvedValue([
      { user: { id: 'u1', email: 'a@a.fr', firstName: 'A', lastName: 'A' } },
      { user: { id: 'u2', email: 'b@b.fr', firstName: 'B', lastName: 'B' } },
    ]);
    await new BroadcastService().send('club-demo', 'staff-1', { title: 'T', bodyHtml: '<p>x</p>', kind: 'COMMERCIAL' });
    expect(prisma.clubBroadcast.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'COMMERCIAL', recipientCount: 2 }),
    }));
    expect(prisma.clubBroadcastRecipient.createMany).toHaveBeenCalledWith({
      data: [{ broadcastId: expect.any(String), userId: 'u1' }, { broadcastId: expect.any(String), userId: 'u2' }],
      skipDuplicates: true,
    });
  });
});
```

Run: `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/broadcast.service.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implémenter le service**

Dans `backend/src/services/broadcast.service.ts` :

1. Import : `import { sanitizeBodyHtml, htmlToText, substituteText, substituteHtml } from '../email/registry';` (vérifier que `substituteText`/`substituteHtml` sont bien exportés par `registry.ts` — le registre les utilise pour les emails personnalisables ; s'ils sont privés, les exporter).

2. `SendInput` :

```ts
interface SendInput {
  title: string;
  bodyHtml: string;
  url?: string | null;
  channels?: Partial<BroadcastChannels> | null;
  /** Ciblage : null/absent = tous les membres actifs (comportement historique). */
  recipientUserIds?: string[] | null;
  /** COMMERCIAL = catégorie de consentement CLUB_OFFERS (offres) ; défaut INFO. */
  kind?: 'INFO' | 'COMMERCIAL';
}
```

3. Corps de `send` — remplacer le chargement des membres, la création et la boucle :

```ts
    const kind: 'INFO' | 'COMMERCIAL' = input.kind === 'COMMERCIAL' ? 'COMMERCIAL' : 'INFO';
    const category = kind === 'COMMERCIAL' ? 'CLUB_OFFERS' as const : 'CLUB_MESSAGES' as const;
    const targeted = Array.isArray(input.recipientUserIds) && input.recipientUserIds.length > 0
      ? input.recipientUserIds : null;

    const [{ brand, slug }, members] = await Promise.all([
      this.loadBrand(clubId),
      prisma.clubMembership.findMany({
        where: { clubId, status: 'ACTIVE', ...(targeted ? { userId: { in: targeted } } : {}) },
        select: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
    ]);
    // Un ciblage qui ne résout aucun membre actif du club = erreur (jamais d'envoi hors club).
    if (targeted && members.length === 0) throw new Error('VALIDATION_ERROR');

    const broadcast = await prisma.clubBroadcast.create({
      data: { clubId, sentByUserId, title, body: plainBody, bodyHtml: safeHtml,
        url: input.url ?? null, recipientCount: members.length, kind },
    });
    // Trace « à qui le club a adressé le message » (avant filtrage par préférences).
    await prisma.clubBroadcastRecipient.createMany({
      data: members.map((m) => ({ broadcastId: broadcast.id, userId: m.user.id })),
      skipDuplicates: true,
    });

    const targetUrl = input.url ?? clubAppUrl(slug, '/');
    const optOuts = await prisma.notificationPreference.count({
      where: { category, channel: 'EMAIL', enabled: false, userId: { in: members.map((m) => m.user.id) } },
    });

    const allowChannels = { inapp: ch.inApp, email: ch.email, push: ch.push };
    for (const m of members) {
      // Substitution par destinataire — le gabarit stocké (audit) garde les {{placeholders}}.
      const vars = { prenom: m.user.firstName, nom: m.user.lastName };
      const perTitle = substituteText(title, vars);
      const perHtml = substituteHtml(safeHtml, vars);
      const perPlain = substituteText(plainBody, vars);
      let email = null as { to: string; subject: string; html: string; text: string } | null;
      if (ch.email && m.user.email) {
        const unsubscribeUrl = apiPublicUrl(
          `/api/unsubscribe?token=${unsubscribeToken(m.user.id)}${kind === 'COMMERCIAL' ? '&cat=offers' : ''}`);
        const built = buildBroadcastEmail({ title: perTitle, bodyHtml: perHtml, url: targetUrl, brand: { ...brand, unsubscribeUrl } });
        email = { to: m.user.email, subject: built.subject, html: built.html, text: built.text };
      }
      await dispatch({
        userId: m.user.id, clubId, category, type: 'club.broadcast',
        title: perTitle, body: perPlain, url: targetUrl, email, allowChannels,
      });
    }
```

4. Route `POST /broadcast` (`admin.ts`) — relayer les nouveaux champs :

```ts
    const { title, bodyHtml, url, channels, recipientUserIds, kind } = req.body;
    const result = await broadcastService.send(
      req.membership!.clubId, req.user!.id,
      { title, bodyHtml, url: typeof url === 'string' ? url : null,
        recipientUserIds: Array.isArray(recipientUserIds) ? recipientUserIds.map(String) : null,
        kind: kind === 'COMMERCIAL' ? 'COMMERCIAL' : 'INFO',
        channels: channels && typeof channels === 'object'
          ? { email: !!channels.email, inApp: !!channels.inApp, push: !!channels.push }
          : undefined },
    );
```

- [ ] **Step 3: Vérifier le vert**

Run: `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/broadcast.service.test.ts`
Expected: PASS (anciens cas compris — compléter `lastName` dans les fixtures existantes si TS/mocks râlent).

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/broadcast.service.ts backend/src/routes/admin.ts backend/src/services/__tests__/broadcast.service.test.ts
git commit -m "feat(broadcast): envoi cible (kind INFO/COMMERCIAL, variables par destinataire, destinataires persistes)"
```

---

### Task 3: Backend — désinscription par catégorie (`&cat=offers`)

**Files:**
- Modify: `backend/src/routes/unsubscribe.ts`
- Test: `backend/src/routes/__tests__/unsubscribe.routes.test.ts`

- [ ] **Step 1: Tests qui échouent**

```ts
it('cat=offers → coupe CLUB_OFFERS (email), pas CLUB_MESSAGES', async () => {
  const res = await request(app).get(`/api/unsubscribe?token=${unsubscribeToken('u1')}&cat=offers`);
  expect(res.status).toBe(200);
  expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { userId_category_channel: { userId: 'u1', category: 'CLUB_OFFERS', channel: 'EMAIL' } },
  }));
});

it('cat=offers + action=resubscribe → réactive CLUB_OFFERS', async () => {
  const res = await request(app).get(`/api/unsubscribe?token=${unsubscribeToken('u1')}&cat=offers&action=resubscribe`);
  expect(res.status).toBe(200);
  expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
    update: { enabled: true },
  }));
});
```

Run: `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/routes/__tests__/unsubscribe.routes.test.ts` → FAIL.

- [ ] **Step 2: Implémenter**

Dans `backend/src/routes/unsubscribe.ts` :

```ts
const category = String(req.query.cat ?? '') === 'offers' ? 'CLUB_OFFERS' as const : 'CLUB_MESSAGES' as const;
// upsert : remplacer la catégorie codée en dur par `category`
// resubUrl : conserver le paramètre — ajouter `${String(req.query.cat ?? '') === 'offers' ? '&cat=offers' : ''}`
```

Adapter le libellé de la page HTML : « les offres du club » quand `cat=offers`, « les messages du club » sinon.

- [ ] **Step 3: Vert + commit**

Run: `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/routes/__tests__/unsubscribe.routes.test.ts` → PASS.

```bash
git add backend/src/routes/unsubscribe.ts backend/src/routes/__tests__/unsubscribe.routes.test.ts
git commit -m "feat(broadcast): desinscription par categorie (cat=offers -> CLUB_OFFERS)"
```

---

### Task 4: Backend — aperçu d'audience + messages reçus par membre

**Files:**
- Modify: `backend/src/services/broadcast.service.ts` (méthodes `audience`, `receivedBy`)
- Modify: `backend/src/routes/admin.ts` (2 routes)
- Test: `backend/src/routes/__tests__/admin.broadcast.routes.test.ts`

- [ ] **Step 1: Tests qui échouent**

Dans `admin.broadcast.routes.test.ts` (harness supertest existant) :

```ts
it('POST /broadcast/audience compte email/cloche/exclus pour un envoi COMMERCIAL', async () => {
  (prisma.clubMembership.findMany as jest.Mock).mockResolvedValue([
    { userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' },
  ]);
  (prisma.notificationPreference.findMany as jest.Mock).mockResolvedValue([
    { userId: 'u2', category: 'CLUB_OFFERS', channel: 'EMAIL', enabled: false },
    { userId: 'u3', category: 'CLUB_OFFERS', channel: 'EMAIL', enabled: false },
    { userId: 'u3', category: 'CLUB_OFFERS', channel: 'INAPP', enabled: false },
  ]);
  const res = await request(app).post(`/api/clubs/${CLUB}/admin/broadcast/audience`)
    .set('Authorization', `Bearer ${token}`).send({ kind: 'COMMERCIAL' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ total: 3, email: 1, inApp: 2, excluded: 1 });
});

it('GET /members/:userId/broadcasts liste les envois adressés au membre', async () => {
  (prisma.clubBroadcastRecipient.findMany as jest.Mock).mockResolvedValue([
    { broadcast: { id: 'b1', title: 'Promo', kind: 'COMMERCIAL', createdAt: new Date('2026-07-20') } },
  ]);
  const res = await request(app).get(`/api/clubs/${CLUB}/admin/members/u1/broadcasts`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body[0]).toMatchObject({ id: 'b1', title: 'Promo', kind: 'COMMERCIAL' });
});
```

Run: `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/routes/__tests__/admin.broadcast.routes.test.ts` → FAIL.

- [ ] **Step 2: Implémenter**

Service :

```ts
  /** Aperçu d'audience : qui recevra quoi, selon la catégorie de l'envoi. Approximation
   *  sans le canal push (dépend des subscriptions appareil). */
  async audience(clubId: string, input: { recipientUserIds?: string[] | null; kind?: 'INFO' | 'COMMERCIAL' }) {
    const category = input.kind === 'COMMERCIAL' ? 'CLUB_OFFERS' : 'CLUB_MESSAGES';
    const targeted = Array.isArray(input.recipientUserIds) && input.recipientUserIds.length > 0 ? input.recipientUserIds : null;
    const members = await prisma.clubMembership.findMany({
      where: { clubId, status: 'ACTIVE', ...(targeted ? { userId: { in: targeted } } : {}) },
      select: { userId: true },
    });
    const ids = members.map((m) => m.userId);
    const offRows = ids.length ? await prisma.notificationPreference.findMany({
      where: { userId: { in: ids }, category, enabled: false, channel: { in: ['EMAIL', 'INAPP'] } },
      select: { userId: true, channel: true },
    }) : [];
    const emailOff = new Set(offRows.filter((r) => r.channel === 'EMAIL').map((r) => r.userId));
    // La cloche CLUB_MESSAGES est verrouillée ON (cf. preferences.ts) — seul CLUB_OFFERS peut la couper.
    const inAppOff = category === 'CLUB_OFFERS'
      ? new Set(offRows.filter((r) => r.channel === 'INAPP').map((r) => r.userId))
      : new Set<string>();
    const excluded = ids.filter((id) => emailOff.has(id) && inAppOff.has(id)).length;
    return { total: ids.length, email: ids.length - emailOff.size, inApp: ids.length - inAppOff.size, excluded };
  }

  /** Les derniers envois adressés à un membre du club (historique fiche 360). */
  async receivedBy(clubId: string, userId: string, take = 10) {
    const rows = await prisma.clubBroadcastRecipient.findMany({
      where: { userId, broadcast: { clubId } },
      orderBy: { broadcast: { createdAt: 'desc' } },
      take,
      select: { broadcast: { select: { id: true, title: true, kind: true, createdAt: true } } },
    });
    return rows.map((r) => r.broadcast);
  }
```

Routes (`admin.ts`, à côté des routes broadcast — gate STAFF) :

```ts
router.post('/broadcast/audience', requireClubMember('STAFF'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { recipientUserIds, kind } = req.body;
    res.json(await broadcastService.audience(req.membership!.clubId, {
      recipientUserIds: Array.isArray(recipientUserIds) ? recipientUserIds.map(String) : null,
      kind: kind === 'COMMERCIAL' ? 'COMMERCIAL' : 'INFO',
    }));
  } catch (err) { handleError(err, res, next); }
});

router.get('/members/:userId/broadcasts', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await broadcastService.receivedBy(req.membership!.clubId, asString(req.params.userId)));
  } catch (err) { handleError(err, res, next); }
});
```

(⚠️ Déclarer `GET /members/:userId/broadcasts` AVANT toute route `/members/:userId/:reste` générique si une telle route existait — vérifier l'ordre dans le fichier ; les routes membres existantes sont toutes suffixées, pas de conflit attendu.)

- [ ] **Step 3: Vert + commit**

Run: `cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/routes/__tests__/admin.broadcast.routes.test.ts` → PASS.

```bash
git add backend/src/services/broadcast.service.ts backend/src/routes/admin.ts backend/src/routes/__tests__/admin.broadcast.routes.test.ts
git commit -m "feat(broadcast): apercu d'audience + historique des envois par membre"
```

---

### Task 5: Frontend — API, helpers, catégorie de préférence

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/lib/broadcast.ts`
- Modify: `frontend/lib/notifications.ts`
- Test: `frontend/__tests__/broadcast.test.ts`

- [ ] **Step 1: Tests helpers (échec d'abord)**

Dans `frontend/__tests__/broadcast.test.ts` :

```ts
import { storePendingRecipients, readPendingRecipients, BROADCAST_RECIPIENTS_KEY } from '../lib/broadcast';

describe('destinataires en attente (sessionStorage)', () => {
  beforeEach(() => sessionStorage.clear());
  it('aller-retour + consommation (la lecture vide la clé)', () => {
    storePendingRecipients([{ userId: 'u1', name: 'Ines A.' }]);
    expect(readPendingRecipients()).toEqual([{ userId: 'u1', name: 'Ines A.' }]);
    expect(sessionStorage.getItem(BROADCAST_RECIPIENTS_KEY)).toBeNull();
  });
  it('clé absente ou corrompue → null', () => {
    expect(readPendingRecipients()).toBeNull();
    sessionStorage.setItem(BROADCAST_RECIPIENTS_KEY, '{oops');
    expect(readPendingRecipients()).toBeNull();
  });
});
```

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/broadcast.test.ts` → FAIL.

- [ ] **Step 2: Implémenter**

`frontend/lib/broadcast.ts` :

```ts
export interface BroadcastRecipient { userId: string; name: string }
export const BROADCAST_RECIPIENTS_KEY = 'palova:broadcast-recipients';

/** Dépose la sélection de la liste des membres pour le composer (jamais l'URL — 200 ids n'y tiennent pas). */
export function storePendingRecipients(list: BroadcastRecipient[]): void {
  try { sessionStorage.setItem(BROADCAST_RECIPIENTS_KEY, JSON.stringify(list)); } catch { /* stockage plein/privé */ }
}

/** Lit ET consomme la sélection (one-shot : un refresh du composer ne re-cible pas par surprise). */
export function readPendingRecipients(): BroadcastRecipient[] | null {
  try {
    const raw = sessionStorage.getItem(BROADCAST_RECIPIENTS_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(BROADCAST_RECIPIENTS_KEY);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
```

`frontend/lib/api.ts` :

```ts
// ClubBroadcastItem : ajouter
  kind: 'INFO' | 'COMMERCIAL';

// sendClubBroadcast : élargir le body
  sendClubBroadcast: (clubId: string, body: { title: string; bodyHtml: string; url?: string;
    channels?: { email: boolean; inApp: boolean; push: boolean };
    recipientUserIds?: string[]; kind?: 'INFO' | 'COMMERCIAL' }, token: string) => /* inchangé */

// nouvelles méthodes (à côté des broadcast)
  broadcastAudience: (clubId: string, body: { recipientUserIds?: string[]; kind: 'INFO' | 'COMMERCIAL' }, token: string) =>
    request<{ total: number; email: number; inApp: number; excluded: number }>(
      `/api/clubs/${clubId}/admin/broadcast/audience`, { method: 'POST', body: JSON.stringify(body) }, token),
  adminGetMemberBroadcasts: (clubId: string, userId: string, token: string) =>
    request<Array<{ id: string; title: string; kind: 'INFO' | 'COMMERCIAL'; createdAt: string }>>(
      `/api/clubs/${clubId}/admin/members/${userId}/broadcasts`, {}, token),
```

`frontend/lib/notifications.ts` — type + entrée (après CLUB_MESSAGES) :

```ts
export type NotifCategory = /* … existants … */ | 'CLUB_OFFERS';

  { key: 'CLUB_OFFERS', label: 'Offres du club', desc: 'Promotions et offres commerciales de vos clubs' },
```

(La grille `/me/notifications/settings` itère `CATEGORY_META` — l'entrée apparaît sans autre changement.)

- [ ] **Step 3: Vert + commit**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/broadcast.test.ts` → PASS. Puis `node node_modules/typescript/bin/tsc --noEmit`.

```bash
git add frontend/lib/api.ts frontend/lib/broadcast.ts frontend/lib/notifications.ts frontend/__tests__/broadcast.test.ts
git commit -m "feat(broadcast): api ciblage/audience + helpers sessionStorage + categorie Offres du club"
```

---

### Task 6: Frontend — sélection sur la liste des membres

**Files:**
- Modify: `frontend/components/admin/members/MemberRow.tsx`
- Modify: `frontend/app/admin/members/page.tsx`
- Test: `frontend/__tests__/AdminMembersFilters.test.tsx`

- [ ] **Step 1: Tests qui échouent**

Dans `AdminMembersFilters.test.tsx` :

```tsx
it('cocher des membres fait apparaître la barre « N sélectionnés » et navigue vers le composer', async () => {
  renderPage(); // helper existant de la suite
  const boxes = await screen.findAllByRole('checkbox', { name: /Sélectionner/ });
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[1]);
  expect(screen.getByText('2 sélectionnés')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Envoyer un message/ }));
  expect(JSON.parse(sessionStorage.getItem('palova:broadcast-recipients') ?? 'null')).toHaveLength(2);
  expect(pushMock).toHaveBeenCalledWith('/admin/broadcast');
});

it('« Tout sélectionner » coche les membres visibles du filtre courant', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('checkbox', { name: /Tout sélectionner/ }));
  expect(screen.getByText(/sélectionnés/)).toBeInTheDocument();
});
```

⚠️ `storePendingRecipients` consomme la clé à la lecture — le test lit `sessionStorage` directement (pas via `readPendingRecipients`).

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminMembersFilters.test.tsx` → FAIL.

- [ ] **Step 2: MemberRow — case à cocher (prop additive)**

```tsx
// props : ajouter
  checked?: boolean;
  onToggleCheck?: () => void;

// rendu : tout premier enfant de la rangée, avant <Avatar> —
  {onToggleCheck && (
    <input type="checkbox" checked={!!checked} aria-label={`Sélectionner ${m.firstName} ${m.lastName}`}
      onClick={(e) => e.stopPropagation()} onChange={onToggleCheck}
      style={{ width: 17, height: 17, accentColor: th.accent, cursor: 'pointer', flex: 'none' }} />
  )}
```

- [ ] **Step 3: Page — état de sélection + barre flottante**

Dans `frontend/app/admin/members/page.tsx` :

```tsx
import { storePendingRecipients } from '@/lib/broadcast';

const [sel, setSel] = useState<Set<string>>(new Set());
const toggleSel = (userId: string) => setSel((s) => {
  const n = new Set(s); if (n.has(userId)) n.delete(userId); else n.add(userId); return n;
});
const allVisibleSelected = visible.length > 0 && visible.every((m) => sel.has(m.userId));
const toggleAll = () => setSel(allVisibleSelected ? new Set() : new Set(visible.map((m) => m.userId)));
const openComposer = () => {
  const list = visible.filter((m) => sel.has(m.userId))
    .map((m) => ({ userId: m.userId, name: `${m.firstName} ${m.lastName.charAt(0)}.` }));
  storePendingRecipients(list);
  router.push('/admin/broadcast');
};
```

- `MemberRow` reçoit `checked={sel.has(m.userId)} onToggleCheck={() => toggleSel(m.userId)}`.
- Au-dessus de la liste (à côté des segments) : `<label><input type="checkbox" aria-label="Tout sélectionner" checked={allVisibleSelected} onChange={toggleAll} /> Tout sélectionner ({visible.length})</label>`.
- Barre flottante (rendue si `sel.size > 0`) :

```tsx
<div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 40,
  background: '#1d2433', color: '#fff', borderRadius: 999, padding: '10px 18px',
  display: 'flex', alignItems: 'center', gap: 14, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
  boxShadow: '0 6px 20px rgba(0,0,0,.3)' }}>
  {sel.size} sélectionné{sel.size > 1 ? 's' : ''}
  <button onClick={openComposer} style={{ border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '7px 14px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>✉ Envoyer un message</button>
  <button onClick={() => setSel(new Set())} aria-label="Annuler la sélection" style={{ border: 'none', background: 'transparent', color: '#fff', opacity: 0.7, cursor: 'pointer', fontSize: 16 }}>✕</button>
</div>
```

- [ ] **Step 4: Vert + commit**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminMembersFilters.test.tsx` → PASS.

```bash
git add frontend/components/admin/members/MemberRow.tsx frontend/app/admin/members/page.tsx frontend/__tests__/AdminMembersFilters.test.tsx
git commit -m "feat(members): selection multiple + barre flottante Envoyer un message"
```

---

### Task 7: Frontend — composer enrichi

**Files:**
- Modify: `frontend/app/admin/broadcast/page.tsx`
- Test: `frontend/__tests__/AdminBroadcast.test.tsx`

- [ ] **Step 1: Tests qui échouent**

Dans `AdminBroadcast.test.tsx` (harness existant ; ajouter aux mocks `api.broadcastAudience` → `{ total: 12, email: 10, inApp: 12, excluded: 2 }`) :

```tsx
it('sans sélection : « Tous les membres actifs », envoi sans recipientUserIds', async () => {
  renderPage();
  expect(await screen.findByText(/Tous les membres actifs/)).toBeInTheDocument();
  // … remplir titre + corps, envoyer, puis :
  await waitFor(() => expect(mockApi.sendClubBroadcast).toHaveBeenCalledWith(
    'club-1', expect.objectContaining({ kind: 'INFO', recipientUserIds: undefined }), 'tok'));
});

it('sélection en attente : chips destinataires + envoi ciblé', async () => {
  sessionStorage.setItem('palova:broadcast-recipients', JSON.stringify([{ userId: 'u1', name: 'Ines A.' }]));
  renderPage();
  expect(await screen.findByText('1 destinataire')).toBeInTheDocument();
  expect(screen.getByText('Ines A.')).toBeInTheDocument();
  // … envoi → recipientUserIds: ['u1']
});

it('type Commercial : bandeau d'audience avec exclus', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Commercial' }));
  expect(await screen.findByText(/2 ne recevront rien/)).toBeInTheDocument();
  await waitFor(() => expect(mockApi.broadcastAudience).toHaveBeenCalledWith(
    'club-1', expect.objectContaining({ kind: 'COMMERCIAL' }), 'tok'));
});

it('interrupteur SMS présent et désactivé (« bientôt disponible »)', async () => {
  renderPage();
  expect(await screen.findByText(/SMS/)).toBeInTheDocument();
  expect(screen.getByText(/bientôt disponible/i)).toBeInTheDocument();
});

it('retirer le dernier destinataire désactive l'envoi (jamais de bascule silencieuse vers tous)', async () => {
  sessionStorage.setItem('palova:broadcast-recipients', JSON.stringify([{ userId: 'u1', name: 'Ines A.' }]));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Retirer Ines A./ }));
  expect(screen.getByText(/Aucun destinataire/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Revenir à tous les membres/ }));
  expect(screen.getByText(/Tous les membres actifs/)).toBeInTheDocument();
});
```

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminBroadcast.test.tsx` → FAIL.

- [ ] **Step 2: Implémenter**

Dans `frontend/app/admin/broadcast/page.tsx` :

1. États : `const [recipients, setRecipients] = useState<BroadcastRecipient[] | null>(null);` (null = tous), init au montage : `useEffect(() => { const p = readPendingRecipients(); if (p && p.length) setRecipients(p); }, []);` — `const [kind, setKind] = useState<'INFO' | 'COMMERCIAL'>('INFO');` — `const [aud, setAud] = useState<{ total: number; email: number; inApp: number; excluded: number } | null>(null);`

2. Audience débouncée (400 ms, pattern de l'aperçu existant) sur `[recipients, kind, clubId, token]` → `api.broadcastAudience(clubId, { recipientUserIds: recipients?.map((r) => r.userId), kind }, token)` → `setAud`, échec → `setAud(null)`.

3. Bloc destinataires (au-dessus du formulaire) :

```tsx
<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
  {recipients === null ? (
    <Chip tone="mute">Tous les membres actifs ({recipientCount})</Chip>
  ) : recipients.length === 0 ? (
    <>
      <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.danger }}>Aucun destinataire.</span>
      <button onClick={() => setRecipients(null)} style={ghostBtn}>Revenir à tous les membres</button>
    </>
  ) : (
    <>
      <Chip tone="accent">{recipients.length} destinataire{recipients.length > 1 ? 's' : ''}</Chip>
      {recipients.map((r) => (
        <span key={r.userId} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: th.surface2, borderRadius: 999, padding: '3px 10px', fontFamily: th.fontUI, fontSize: 12.5, color: th.text }}>
          {r.name}
          <button aria-label={`Retirer ${r.name}`} onClick={() => setRecipients(recipients.filter((x) => x.userId !== r.userId))}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute }}>✕</button>
        </span>
      ))}
      <button onClick={() => setRecipients(null)} style={ghostBtn}>Tout le club</button>
    </>
  )}
</div>
```

4. Type : `<Segmented value={kind} onChange={setKind} options={[{ value: 'INFO', label: 'Info club' }, { value: 'COMMERCIAL', label: 'Commercial' }]} />` + bandeau si `kind === 'COMMERCIAL' && aud` :

```tsx
<div style={{ background: `${th.accentWarm}26`, borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 12.5, color: th.text }}>
  {aud.email} recevront l'email · {aud.inApp} la notification{aud.excluded > 0 ? ` · ${aud.excluded} ne recevront rien (offres refusées)` : ''}
</div>
```

5. Variables : `vars={[{ key: 'prenom', label: 'Prénom', sample: 'Camille' }, { key: 'nom', label: 'Nom', sample: 'Durand' }]}` sur `RichEmailEditor` (le bouton « ＠ Insérer une info » apparaît, gate `vars.length > 0` déjà en place). Passer les mêmes valeurs d'exemple à l'aperçu ? Non — l'aperçu serveur rend les `{{clés}}` telles quelles, acceptable.

6. SMS : après les 3 `SwitchRow` existants :

```tsx
<div style={{ opacity: 0.45, pointerEvents: 'none' }}>
  <SwitchRow label="SMS — bientôt disponible" checked={false} onChange={() => {}} />
</div>
```

7. `canSend` : ajouter `&& (recipients === null || recipients.length > 0)`. `handleConfirm` : body `+ { recipientUserIds: recipients ? recipients.map((r) => r.userId) : undefined, kind }`. Le texte de confirmation (`ConfirmDialog`) affiche la cible : « à N membres sélectionnés » / « à tous les membres actifs (N) ».

8. Historique : afficher `item.kind === 'COMMERCIAL' ? 'Commercial' : 'Info'` en chip sur chaque carte.

- [ ] **Step 3: Vert + commit**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminBroadcast.test.tsx` → PASS. Puis tsc.

```bash
git add frontend/app/admin/broadcast/page.tsx frontend/__tests__/AdminBroadcast.test.tsx
git commit -m "feat(broadcast): composer cible (chips, type Info/Commercial, audience, variables, SMS grise)"
```

---

### Task 8: Frontend — carte Contact de la fiche 360

**Files:**
- Create: `frontend/components/admin/members/MemberContactCard.tsx`
- Modify: `frontend/app/admin/members/[userId]/page.tsx`
- Test: `frontend/__tests__/MemberHistory.test.tsx`

- [ ] **Step 1: Tests qui échouent**

Dans `MemberHistory.test.tsx` (mock `api.adminGetMemberBroadcasts` → `[{ id: 'b1', title: 'Promo carnets', kind: 'COMMERCIAL', createdAt: '2026-07-20T10:00:00Z' }]`) :

```tsx
it('carte Contact : « Envoyer un message » dépose le destinataire et navigue vers le composer', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Envoyer un message/ }));
  expect(JSON.parse(sessionStorage.getItem('palova:broadcast-recipients') ?? 'null'))
    .toEqual([{ userId: 'u1', name: 'Ines A.' }]);
  expect(pushMock).toHaveBeenCalledWith('/admin/broadcast');
});

it('carte Contact : liste les derniers messages reçus', async () => {
  renderPage();
  expect(await screen.findByText('Promo carnets')).toBeInTheDocument();
});
```

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MemberHistory.test.tsx` → FAIL.

- [ ] **Step 2: Implémenter**

`MemberContactCard.tsx` :

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { storePendingRecipients } from '@/lib/broadcast';

export function MemberContactCard({ userId, firstName, lastName, email, phone, received }: {
  userId: string; firstName: string; lastName: string; email: string; phone: string | null;
  received: Array<{ id: string; title: string; kind: 'INFO' | 'COMMERCIAL'; createdAt: string }>;
}) {
  const { th } = useTheme();
  const router = useRouter();
  const fmt = (iso: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(iso));
  const message = () => {
    storePendingRecipients([{ userId, name: `${firstName} ${lastName.charAt(0)}.` }]);
    router.push('/admin/broadcast');
  };
  return (
    <section aria-label="Contact" style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: th.shadow }}>
      <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 16, margin: '0 0 8px', color: th.text }}>Contact</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={message} style={{ border: 'none', cursor: 'pointer', borderRadius: 10, padding: '9px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, background: th.accent, color: th.onAccent }}>✉ Envoyer un message</button>
        <a href={`mailto:${email}`} style={{ alignSelf: 'center', fontFamily: th.fontUI, fontSize: 13, color: th.accent, fontWeight: 700, textDecoration: 'none' }}>Email</a>
        {phone && <a href={`tel:${phone}`} style={{ alignSelf: 'center', fontFamily: th.fontUI, fontSize: 13, color: th.accent, fontWeight: 700, textDecoration: 'none' }}>Appeler</a>}
      </div>
      {received.length > 0 && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${th.line}`, paddingTop: 8 }}>
          {received.slice(0, 3).map((b) => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</span>
              <span>{fmt(b.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

Dans la page fiche : charger `received` dans le `Promise.all` du `load()` (`api.adminGetMemberBroadcasts(clubId, userId, token).catch(() => [])` — tolérant à l'échec) et monter `<MemberContactCard userId={m.userId} firstName={m.firstName} lastName={m.lastName} email={m.email} phone={m.phone} received={received} />` dans la colonne gauche (emplacement réservé au plan fiche 360).

- [ ] **Step 3: Vert + commit**

Run: `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MemberHistory.test.tsx` → PASS.

```bash
git add frontend/components/admin/members/MemberContactCard.tsx frontend/app/admin/members/[userId]/page.tsx frontend/__tests__/MemberHistory.test.tsx
git commit -m "feat(members): carte Contact (message cible 1 destinataire + derniers messages recus)"
```

---

### Task 9: Vérifications finales

- [ ] **Step 1: Suites ciblées**

```bash
cd backend; node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/broadcast.service.test.ts src/routes/__tests__/admin.broadcast.routes.test.ts src/routes/__tests__/unsubscribe.routes.test.ts
cd ../frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/broadcast.test.ts __tests__/AdminBroadcast.test.tsx __tests__/AdminMembersFilters.test.tsx __tests__/MemberHistory.test.tsx
```
Expected: tout PASS.

- [ ] **Step 2: Type-check**

```bash
cd backend; node node_modules/typescript/bin/tsc --noEmit
cd ../frontend; node node_modules/typescript/bin/tsc --noEmit
```

- [ ] **Step 3: Vérification visuelle (skill `verify`)**

Stack relancée (`start.ps1`), CDP clair + sombre, 1280 + 390 (`mobile:false`) : sélection sur `/admin/members` (cases + barre flottante), composer avec chips/type/bandeau audience/SMS grisé, envoi ciblé réel à 2 membres seedés (vérifier cloche + historique), bouton message depuis la fiche, préférence « Offres du club » visible dans `/me/notifications/settings`. Aucun débordement horizontal.

- [ ] **Step 4: Retouches éventuelles + commit final**

---

## Self-review du plan (fait à l'écriture)

- Spec couverte : migration (T1), send ciblé/kind/variables/recipients + unsub cat (T2-T3), audience + reçus par membre (T4), api/helpers/catégorie front (T5), sélection liste (T6), composer (T7), fiche membre (T8), vérifs (T9). SMS : uniquement l'interrupteur grisé (T7) — rien d'autre, conforme.
- Cohérence de types : `kind: 'INFO' | 'COMMERCIAL'` partout ; `BroadcastRecipient { userId, name }` ; `readPendingRecipients` consomme la clé (les tests de T6 lisent sessionStorage brut, ceux de T7 la posent avant `renderPage`).
- Dépendance explicite au plan fiche 360 (T8 utilise `MemberHistory` page + emplacement carte Contact).
- Point de vigilance : `substituteText`/`substituteHtml` doivent être exportés de `email/registry.ts` (ils existent — vérifier l'export, sinon l'ajouter, une ligne).
