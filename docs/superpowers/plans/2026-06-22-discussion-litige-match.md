# Discussion / commentaires sur un match en litige — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour implémenter ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Goal:** Permettre aux 4 joueurs d'un match **et au staff du club** d'échanger des messages (fil de discussion) sur un match en litige ; la contestation capture un motif obligatoire (1er message).

**Architecture:** Nouveau modèle `MatchComment` (1 message = 1 ligne) rattaché au `Match`. Le service `MatchService` gagne `assertMatchAccess`/`listComments`/`addComment` et `dispute` exige désormais un message (créé comme 1er commentaire en transaction). 3 routes joueur/staff. Emails best-effort à chaque message (4 joueurs + staff − auteur). Front : composant partagé `MatchDiscussion`, motif obligatoire au « Contester », fil côté joueur et staff.

**Tech Stack:** Backend Express 5 + Prisma 7 (adapter-pg), Jest + `jest-mock-extended` (Prisma mocké), supertest. Frontend Next.js 16 + React 19 + Tailwind v4, React Testing Library.

**Spec :** `docs/superpowers/specs/2026-06-22-discussion-litige-match-design.md`

**Worktree :** `C:/dev/palova-wt-litige-discussion`, branche `feat/match-litige-discussion` (basée sur `main`). Toutes les commandes ci-dessous se lancent depuis ce worktree.

---

## Structure des fichiers

**Backend**
- `backend/prisma/schema.prisma` — modèle `MatchComment` + relations `Match.comments`, `User.matchComments`.
- `backend/prisma/migrations/<ts>_add_match_comments/` — migration additive (générée).
- `backend/src/services/match.service.ts` — `assertMatchAccess`, `listComments`, `addComment` ; `dispute(message)`.
- `backend/src/email/templates/emails.ts` — `MatchCommentEmailInput` + `buildMatchCommentEmail`.
- `backend/src/email/notifications.ts` — `notifyNewMatchComment`.
- `backend/src/routes/matches.ts` — body `{message}` sur dispute + `GET`/`POST /:id/comments` + map d'erreurs.
- `backend/src/routes/me.ts` — `commentCount` sur `/matches`.
- `backend/src/routes/admin.ts` — `commentCount` sur `/matches`.
- Tests : `backend/src/services/__tests__/match.service.test.ts`, `backend/src/routes/__tests__/match.routes.test.ts`, `backend/src/email/__tests__/emails.test.ts`.

**Frontend**
- `frontend/lib/api.ts` — types `MatchComment`/`MatchThread`, méthodes, signature `disputeMatch`, `commentCount`.
- `frontend/components/match/MatchDiscussion.tsx` — composant partagé (nouveau).
- `frontend/components/match/MyMatchesList.tsx` — motif au « Contester » + toggle discussion.
- `frontend/app/admin/matches/page.tsx` — fil dans Litiges + archive lecture seule.
- Tests : `frontend/__tests__/MatchDiscussion.test.tsx`, `frontend/__tests__/MyMatchesList.test.tsx`.

---

## Task 0 : Préparer le worktree

**Files:** aucun (setup).

- [ ] **Step 1 : Installer les dépendances (worktree neuf)**

Run :
```bash
cd /c/dev/palova-wt-litige-discussion/backend && npm ci
cd /c/dev/palova-wt-litige-discussion/frontend && npm ci
```
Expected : installation OK dans les deux dossiers.

- [ ] **Step 2 : Générer le client Prisma + vérifier la connexion DB**

Run : `cd /c/dev/palova-wt-litige-discussion/backend && npx prisma generate`
Expected : `Generated Prisma Client`. (Le `.env` a déjà été copié dans le worktree, `DATABASE_URL` = base dev locale.)

---

## Task 1 : Modèle `MatchComment` + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<ts>_add_match_comments/migration.sql` (généré)

- [ ] **Step 1 : Ajouter la relation sur `Match`**

Dans `backend/prisma/schema.prisma`, modèle `Match`, après la ligne `players     MatchPlayer[]` ajouter :
```prisma
  comments    MatchComment[]
```

- [ ] **Step 2 : Ajouter la relation sur `User`**

Dans le modèle `User`, après `matchPlayers    MatchPlayer[]` ajouter :
```prisma
  matchComments   MatchComment[]
```

- [ ] **Step 3 : Ajouter le modèle `MatchComment`**

Juste après le modèle `MatchPlayer` (avant `model EmailVerification`), ajouter :
```prisma
/// Message d'un fil de discussion attaché à un match (litige). 4 joueurs + staff.
model MatchComment {
  id        String   @id @default(cuid())
  matchId   String   @map("match_id")
  userId    String   @map("user_id")
  body      String
  createdAt DateTime @default(now()) @map("created_at")

  match Match @relation(fields: [matchId], references: [id], onDelete: Cascade)
  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([matchId, createdAt])
  @@map("match_comments")
}
```

- [ ] **Step 4 : Créer et appliquer la migration**

Run : `cd /c/dev/palova-wt-litige-discussion/backend && npx prisma migrate dev --name add_match_comments`
Expected : nouvelle migration `<ts>_add_match_comments` créée + appliquée, `Prisma Client` régénéré.
> Si Prisma signale une dérive et propose un `reset` : **ne pas reset**. Faire à la place
> `npx prisma migrate dev --create-only --name add_match_comments` puis `npx prisma migrate deploy`.

- [ ] **Step 5 : Vérifier le schéma**

Run : `cd /c/dev/palova-wt-litige-discussion/backend && npx prisma validate`
Expected : `The schema is valid`.

- [ ] **Step 6 : Commit**

```bash
cd /c/dev/palova-wt-litige-discussion
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(match): modèle MatchComment + migration add_match_comments"
```

---

## Task 2 : Service — `assertMatchAccess`, `listComments`, `addComment` (TDD)

**Files:**
- Modify: `backend/src/services/match.service.ts`
- Test: `backend/src/services/__tests__/match.service.test.ts`

- [ ] **Step 1 : Étendre le mock des notifications en tête du fichier de test**

Dans `match.service.test.ts`, remplacer la 1re ligne :
```ts
jest.mock('../../email/notifications', () => ({ __esModule: true, notifyMatchPendingConfirmation: jest.fn() }));
```
par :
```ts
jest.mock('../../email/notifications', () => ({
  __esModule: true,
  notifyMatchPendingConfirmation: jest.fn(),
  notifyNewMatchComment: jest.fn(),
}));
```

- [ ] **Step 2 : Écrire les tests (échouent)**

Ajouter à la fin de `match.service.test.ts` :
```ts
describe('commentaires de litige', () => {
  const disputedMatch = {
    id: 'm1', clubId: 'c1', status: 'DISPUTED',
    players: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }],
  };

  it('listComments : joueur autorisé, messages triés + isStaff par auteur', async () => {
    prismaMock.match.findUnique.mockResolvedValue(disputedMatch as any);
    prismaMock.matchComment.findMany.mockResolvedValue([
      { id: 'k1', userId: 'u1', body: 'Le score est faux', createdAt: new Date('2026-06-11T10:00:00Z'),
        user: { firstName: 'Manon', lastName: 'Membre', avatarUrl: null } },
      { id: 'k2', userId: 's1', body: 'On regarde', createdAt: new Date('2026-06-11T11:00:00Z'),
        user: { firstName: 'Sam', lastName: 'Staff', avatarUrl: null } },
    ] as any);
    prismaMock.clubMember.findMany.mockResolvedValue([{ userId: 's1' }] as any);
    const res = await service.listComments('m1', 'u1');
    expect(res.status).toBe('DISPUTED');
    expect(res.comments).toHaveLength(2);
    expect(res.comments[0].isStaff).toBe(false);
    expect(res.comments[1].isStaff).toBe(true);
    expect(res.comments[1].author.firstName).toBe('Sam');
  });

  it('assertMatchAccess : staff (non-joueur) autorisé', async () => {
    prismaMock.match.findUnique.mockResolvedValue(disputedMatch as any);
    prismaMock.clubMember.findUnique.mockResolvedValue({ role: 'ADMIN' } as any);
    prismaMock.matchComment.findMany.mockResolvedValue([] as any);
    prismaMock.clubMember.findMany.mockResolvedValue([{ userId: 's1' }] as any);
    await expect(service.listComments('m1', 's1')).resolves.toBeDefined();
  });

  it('assertMatchAccess : tiers (ni joueur ni staff) → FORBIDDEN', async () => {
    prismaMock.match.findUnique.mockResolvedValue(disputedMatch as any);
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    await expect(service.listComments('m1', 'uX')).rejects.toThrow('FORBIDDEN');
  });

  it('listComments : match inexistant → MATCH_NOT_FOUND', async () => {
    prismaMock.match.findUnique.mockResolvedValue(null as any);
    await expect(service.listComments('mZ', 'u1')).rejects.toThrow('MATCH_NOT_FOUND');
  });

  it('addComment : joueur écrit sur un match DISPUTED', async () => {
    prismaMock.match.findUnique.mockResolvedValue(disputedMatch as any);
    prismaMock.matchComment.create.mockResolvedValue({ id: 'k9' } as any);
    await service.addComment('m1', 'u2', '  Je conteste aussi  ');
    expect(prismaMock.matchComment.create).toHaveBeenCalledWith({
      data: { matchId: 'm1', userId: 'u2', body: 'Je conteste aussi' },
    });
  });

  it('addComment : refusé si le match n est pas en litige (lecture seule)', async () => {
    prismaMock.match.findUnique.mockResolvedValue({ ...disputedMatch, status: 'CONFIRMED' } as any);
    await expect(service.addComment('m1', 'u2', 'trop tard')).rejects.toThrow('MATCH_NOT_DISPUTED');
  });

  it('addComment : refuse un corps vide', async () => {
    await expect(service.addComment('m1', 'u2', '   ')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('addComment : refuse un corps > 1000 caractères', async () => {
    await expect(service.addComment('m1', 'u2', 'x'.repeat(1001))).rejects.toThrow('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 3 : Lancer les tests (échouent)**

Run : `cd /c/dev/palova-wt-litige-discussion/backend && npx jest match.service -t "commentaires de litige"`
Expected : FAIL (`service.listComments`/`addComment` n'existent pas).

- [ ] **Step 4 : Implémenter dans `match.service.ts`**

Ajouter `notifyNewMatchComment` à l'import existant des notifications (en haut du fichier) :
```ts
import { notifyMatchPendingConfirmation, notifyNewMatchComment } from '../email/notifications';
```
Puis, dans la classe `MatchService`, ajouter ces méthodes (par ex. après `dispute`) :
```ts
  /** Autorise l'accès au fil d'un match : l'un des 4 joueurs, OU un staff du club. Sinon jette. */
  private async assertMatchAccess(matchId: string, userId: string) {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, clubId: true, status: true, players: { select: { userId: true } } },
    });
    if (!match) throw new Error('MATCH_NOT_FOUND');
    const isPlayer = match.players.some((p) => p.userId === userId);
    if (!isPlayer) {
      const staff = await prisma.clubMember.findUnique({
        where: { userId_clubId: { userId, clubId: match.clubId } },
        select: { role: true },
      });
      if (!staff) throw new Error('FORBIDDEN'); // toute adhésion ClubMember = staff (OWNER/ADMIN/STAFF)
    }
    return match;
  }

  /** Fil de discussion d'un match (lecture). `isStaff` qualifie l'AUTEUR de chaque message. */
  async listComments(matchId: string, userId: string) {
    const match = await this.assertMatchAccess(matchId, userId);
    const [comments, staff] = await Promise.all([
      prisma.matchComment.findMany({
        where: { matchId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, userId: true, body: true, createdAt: true,
          user: { select: { firstName: true, lastName: true, avatarUrl: true } },
        },
      }),
      prisma.clubMember.findMany({ where: { clubId: match.clubId }, select: { userId: true } }),
    ]);
    const staffIds = new Set(staff.map((s) => s.userId));
    return {
      status: match.status,
      comments: comments.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt,
        isStaff: staffIds.has(c.userId),
        author: { firstName: c.user.firstName, lastName: c.user.lastName, avatarUrl: c.user.avatarUrl },
      })),
    };
  }

  /** Ajoute un message au fil. Écriture autorisée seulement tant que le match est DISPUTED. */
  async addComment(matchId: string, userId: string, body: string): Promise<void> {
    const trimmed = (body ?? '').trim();
    if (!trimmed || trimmed.length > 1000) throw new Error('VALIDATION_ERROR');
    const match = await this.assertMatchAccess(matchId, userId);
    if (match.status !== 'DISPUTED') throw new Error('MATCH_NOT_DISPUTED');
    await prisma.matchComment.create({ data: { matchId, userId, body: trimmed } });
    this.safeNotify(() => notifyNewMatchComment(matchId, userId, { isFirst: false }));
  }
```

- [ ] **Step 5 : Lancer les tests (passent)**

Run : `cd /c/dev/palova-wt-litige-discussion/backend && npx jest match.service -t "commentaires de litige"`
Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
cd /c/dev/palova-wt-litige-discussion
git add backend/src/services/match.service.ts backend/src/services/__tests__/match.service.test.ts
git commit -m "feat(match): listComments + addComment + assertMatchAccess (joueur/staff, lecture seule hors litige)"
```

---

## Task 3 : Service — `dispute` exige un motif (TDD)

**Files:**
- Modify: `backend/src/services/match.service.ts`
- Test: `backend/src/services/__tests__/match.service.test.ts`

- [ ] **Step 1 : Adapter le test existant + ajouter les nouveaux**

Dans `match.service.test.ts`, le test `'contester met le match en DISPUTED, pas de finalisation'` appelle `service.dispute('m1', 'u4')` — la signature change. Remplacer ce test par :
```ts
  it('contester met le match en DISPUTED + crée le 1er message, pas de finalisation', async () => {
    prismaMock.match.findUnique.mockResolvedValue(matchRow() as any);
    const tx = {
      matchPlayer: { update: jest.fn().mockResolvedValue({}) },
      match: { update: jest.fn().mockResolvedValue({}) },
      matchComment: { create: jest.fn().mockResolvedValue({}) },
    };
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    await service.dispute('m1', 'u4', '  Le 2e set était 6-4 pas 6-3  ');
    expect(tx.match.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'DISPUTED' } }));
    expect(tx.matchComment.create).toHaveBeenCalledWith({
      data: { matchId: 'm1', userId: 'u4', body: 'Le 2e set était 6-4 pas 6-3' },
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('contester refuse un motif vide', async () => {
    await expect(service.dispute('m1', 'u4', '   ')).rejects.toThrow('VALIDATION_ERROR');
  });
```

- [ ] **Step 2 : Lancer les tests (échouent)**

Run : `cd /c/dev/palova-wt-litige-discussion/backend && npx jest match.service -t "contester"`
Expected : FAIL (signature `dispute` à 2 args, pas de transaction).

- [ ] **Step 3 : Réécrire `dispute` dans `match.service.ts`**

Remplacer la méthode `dispute` actuelle par :
```ts
  /** Le joueur conteste : motif obligatoire (= 1er message), match → DISPUTED, aucun impact niveaux. */
  async dispute(matchId: string, userId: string, message: string): Promise<void> {
    const trimmed = (message ?? '').trim();
    if (!trimmed || trimmed.length > 1000) throw new Error('VALIDATION_ERROR');
    await this.loadPending(matchId, userId);
    await prisma.$transaction(async (tx) => {
      await tx.matchPlayer.update({
        where: { matchId_userId: { matchId, userId } },
        data: { confirmation: 'DISPUTED' },
      });
      await tx.match.update({ where: { id: matchId }, data: { status: 'DISPUTED' } });
      await tx.matchComment.create({ data: { matchId, userId, body: trimmed } });
    });
    this.safeNotify(() => notifyNewMatchComment(matchId, userId, { isFirst: true }));
  }
```

- [ ] **Step 4 : Lancer les tests (passent)**

Run : `cd /c/dev/palova-wt-litige-discussion/backend && npx jest match.service`
Expected : PASS (toute la suite match.service).

- [ ] **Step 5 : Commit**

```bash
cd /c/dev/palova-wt-litige-discussion
git add backend/src/services/match.service.ts backend/src/services/__tests__/match.service.test.ts
git commit -m "feat(match): dispute exige un motif, créé comme 1er message du fil (transaction)"
```

---

## Task 4 : Email — builder + notifier (TDD)

**Files:**
- Modify: `backend/src/email/templates/emails.ts`
- Modify: `backend/src/email/notifications.ts`
- Test: `backend/src/email/__tests__/emails.test.ts`

- [ ] **Step 1 : Écrire le test du builder (échoue)**

Ajouter à la fin de `backend/src/email/__tests__/emails.test.ts` :
```ts
import { buildMatchCommentEmail } from '../templates/emails';

describe('buildMatchCommentEmail', () => {
  const base = {
    recipientFirstName: 'Karim', authorName: 'Manon Membre', scoreLine: '6-4 / 6-3',
    excerpt: 'Le 2e set était faux', matchUrl: 'https://club.palova.fr/me/reservations',
    brand: { name: 'Padel Arena', logoUrl: null, accentColor: '#5e93da' },
  };
  it('1er message → sujet de contestation', () => {
    const mail = buildMatchCommentEmail({ ...base, isFirst: true });
    expect(mail.subject).toContain('a contesté le résultat');
    expect(mail.html).toContain('Manon Membre');
    expect(mail.text).toContain('Le 2e set était faux');
  });
  it('message suivant → sujet « nouveau message »', () => {
    const mail = buildMatchCommentEmail({ ...base, isFirst: false });
    expect(mail.subject).toContain('Nouveau message');
  });
  it('échappe le HTML du contenu', () => {
    const mail = buildMatchCommentEmail({ ...base, isFirst: false, excerpt: '<script>x</script>' });
    expect(mail.html).not.toContain('<script>x</script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2 : Lancer le test (échoue)**

Run : `cd /c/dev/palova-wt-litige-discussion/backend && npx jest emails -t buildMatchCommentEmail`
Expected : FAIL (`buildMatchCommentEmail` non exporté).

- [ ] **Step 3 : Ajouter le builder dans `emails.ts`**

À la fin de `backend/src/email/templates/emails.ts` :
```ts
export interface MatchCommentEmailInput {
  recipientFirstName: string;
  authorName: string;
  isFirst: boolean;
  scoreLine: string;
  excerpt: string;
  matchUrl: string;
  brand: Brand;
}

/** Email « nouveau message sur le litige » (ou « a contesté » pour le 1er message). */
export function buildMatchCommentEmail(i: MatchCommentEmailInput): BuiltEmail {
  const subject = i.isFirst
    ? `${i.authorName} a contesté le résultat de votre match`
    : 'Nouveau message sur le litige de votre match';
  const heading = i.isFirst ? 'Résultat contesté' : 'Nouveau message';
  const lead = i.isFirst
    ? `<strong>${escapeHtml(i.authorName)}</strong> a contesté le résultat (<strong>${escapeHtml(i.scoreLine)}</strong>) et a laissé un message :`
    : `<strong>${escapeHtml(i.authorName)}</strong> a écrit dans la discussion du litige (<strong>${escapeHtml(i.scoreLine)}</strong>) :`;
  const introHtml =
    `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(i.recipientFirstName)},</p>` +
    `<p style="margin:0 0 12px;">${lead}</p>` +
    `<p style="margin:0;padding:12px 14px;background:#f4f4f5;border-radius:8px;font-style:italic;">${escapeHtml(i.excerpt)}</p>`;
  const html = renderLayout({
    brand: i.brand, preheader: subject, heading, introHtml,
    ctaLabel: 'Voir la discussion', ctaUrl: i.matchUrl,
  });
  const text = [
    `Bonjour ${i.recipientFirstName},`, '',
    i.isFirst
      ? `${i.authorName} a contesté le résultat (${i.scoreLine}) et a laissé un message :`
      : `${i.authorName} a écrit dans la discussion du litige (${i.scoreLine}) :`,
    `« ${i.excerpt} »`, '',
    `Voir la discussion : ${i.matchUrl}`,
  ].join('\n');
  return { subject, html, text };
}
```

- [ ] **Step 4 : Lancer le test (passe)**

Run : `cd /c/dev/palova-wt-litige-discussion/backend && npx jest emails -t buildMatchCommentEmail`
Expected : PASS.

- [ ] **Step 5 : Ajouter le notifier dans `notifications.ts`**

Dans l'import depuis `./templates/emails`, ajouter `buildMatchCommentEmail`. Puis ajouter à la fin du fichier :
```ts
/**
 * Prévient les autres participants d'un litige (4 joueurs + staff OWNER/ADMIN/STAFF − l'auteur)
 * qu'un nouveau message a été posté. Peut lever ; l'appelant enveloppe en best-effort.
 */
export async function notifyNewMatchComment(
  matchId: string, authorUserId: string, opts: { isFirst: boolean },
): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      club: { select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } },
      players: { include: { user: { select: { id: true, email: true, firstName: true } } } },
    },
  });
  if (!match) return;

  const last = await prisma.matchComment.findFirst({
    where: { matchId, userId: authorUserId },
    orderBy: { createdAt: 'desc' },
    select: { body: true, user: { select: { firstName: true, lastName: true } } },
  });
  if (!last) return;

  const authorName = fullName(last.user);
  const excerpt = last.body.length > 280 ? last.body.slice(0, 277) + '…' : last.body;
  const scoreLine = setsToScoreLine(match.sets);
  const brand = brandOf(match.club);
  const matchUrl = clubAppUrl(match.club.slug, '/me/reservations');

  const staff = await prisma.clubMember.findMany({
    where: { clubId: match.club.id, role: { in: [ClubRole.OWNER, ClubRole.ADMIN, ClubRole.STAFF] } },
    select: { userId: true, user: { select: { email: true, firstName: true } } },
  });

  // Destinataires dédupliqués par email, l'auteur exclu.
  const recipients = new Map<string, { email: string; firstName: string }>();
  for (const mp of match.players) {
    const u = mp.user;
    if (u.id !== authorUserId && u.email) recipients.set(u.email, { email: u.email, firstName: u.firstName });
  }
  for (const s of staff) {
    if (s.userId !== authorUserId && s.user?.email) {
      recipients.set(s.user.email, { email: s.user.email, firstName: s.user.firstName });
    }
  }

  for (const r of recipients.values()) {
    const mail = buildMatchCommentEmail({
      recipientFirstName: r.firstName, authorName, isFirst: opts.isFirst,
      scoreLine, excerpt, matchUrl, brand,
    });
    await sendMail({ to: r.email, subject: mail.subject, html: mail.html, text: mail.text });
  }
}
```
> `ClubRole`, `prisma`, `sendMail`, `brandOf`, `clubAppUrl`, `fullName`, `setsToScoreLine` sont déjà importés/définis dans ce fichier.

- [ ] **Step 6 : Compiler le backend (vérifie l'intégration)**

Run : `cd /c/dev/palova-wt-litige-discussion/backend && npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 7 : Commit**

```bash
cd /c/dev/palova-wt-litige-discussion
git add backend/src/email/templates/emails.ts backend/src/email/notifications.ts backend/src/email/__tests__/emails.test.ts
git commit -m "feat(match): email à chaque message de litige (notifyNewMatchComment)"
```

---

## Task 5 : Routes — body dispute + endpoints commentaires (TDD)

**Files:**
- Modify: `backend/src/routes/matches.ts`
- Test: `backend/src/routes/__tests__/match.routes.test.ts`

- [ ] **Step 1 : Écrire les tests de routes (échouent)**

Ajouter à `backend/src/routes/__tests__/match.routes.test.ts` (suivre le harnais déjà présent dans ce fichier : import de `prismaMock`, `app`, et `token()` signé avec `JWT_SECRET`). S'inspirer de `me.routes.test.ts` si besoin du gabarit `token`.
```ts
describe('GET /api/matches/:id/comments', () => {
  it('renvoie le fil pour un joueur du match', async () => {
    prismaMock.match.findUnique.mockResolvedValue({
      id: 'm1', clubId: 'c1', status: 'DISPUTED', players: [{ userId: 'u1' }],
    } as any);
    prismaMock.matchComment.findMany.mockResolvedValue([] as any);
    prismaMock.clubMember.findMany.mockResolvedValue([] as any);
    const res = await request(app).get('/api/matches/m1/comments').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISPUTED');
  });

  it('403 pour un tiers', async () => {
    prismaMock.match.findUnique.mockResolvedValue({ id: 'm1', clubId: 'c1', status: 'DISPUTED', players: [{ userId: 'uX' }] } as any);
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).get('/api/matches/m1/comments').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });
});

describe('POST /api/matches/:id/comments', () => {
  it('409 si le match n est pas en litige', async () => {
    prismaMock.match.findUnique.mockResolvedValue({ id: 'm1', clubId: 'c1', status: 'CONFIRMED', players: [{ userId: 'u1' }] } as any);
    const res = await request(app).post('/api/matches/m1/comments')
      .set('Authorization', `Bearer ${token()}`).send({ body: 'salut' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('MATCH_NOT_DISPUTED');
  });
});

describe('POST /api/matches/:id/dispute', () => {
  it('400 si le motif est absent', async () => {
    prismaMock.match.findUnique.mockResolvedValue({ id: 'm1', status: 'PENDING', players: [{ userId: 'u1', confirmation: 'PENDING' }] } as any);
    const res = await request(app).post('/api/matches/m1/dispute')
      .set('Authorization', `Bearer ${token()}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});
```
> Le `token()` du fichier signe `{ id: 'u1', ... }` ; les mocks ci-dessus mettent `u1` comme joueur pour les cas autorisés.

- [ ] **Step 2 : Lancer (échouent)**

Run : `cd /c/dev/palova-wt-litige-discussion/backend && npx jest match.routes`
Expected : FAIL (routes/commportements absents).

- [ ] **Step 3 : Modifier `backend/src/routes/matches.ts`**

Étendre la map d'erreurs (ajouter `FORBIDDEN` et `MATCH_NOT_DISPUTED`) :
```ts
  const map: Record<string, number> = {
    VALIDATION_ERROR: 400, RESERVATION_NOT_FOUND: 404, NOT_A_COURT_RESERVATION: 400,
    NOT_A_PARTICIPANT: 403, NEEDS_FOUR_PLAYERS: 400, MATCH_NOT_PLAYED_YET: 400,
    MATCH_ALREADY_EXISTS: 409, MATCH_NOT_FOUND: 404, NOT_A_MATCH_PLAYER: 403, MATCH_NOT_PENDING: 409,
    LEVEL_SYSTEM_DISABLED: 403, FORBIDDEN: 403, MATCH_NOT_DISPUTED: 409,
  };
```
Remplacer la route dispute et ajouter les deux routes commentaires :
```ts
router.post('/:id/dispute', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = req.body as { message?: unknown };
    const message = typeof b.message === 'string' ? b.message : '';
    await matchService.dispute(asString(req.params.id), req.user!.id, message);
    res.json({ ok: true });
  } catch (err) { matchError(err, res, next); }
});

router.get('/:id/comments', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await matchService.listComments(asString(req.params.id), req.user!.id)); }
  catch (err) { matchError(err, res, next); }
});

router.post('/:id/comments', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = req.body as { body?: unknown };
    const body = typeof b.body === 'string' ? b.body : '';
    await matchService.addComment(asString(req.params.id), req.user!.id, body);
    res.json({ ok: true });
  } catch (err) { matchError(err, res, next); }
});
```

- [ ] **Step 4 : Lancer (passent)**

Run : `cd /c/dev/palova-wt-litige-discussion/backend && npx jest match.routes`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
cd /c/dev/palova-wt-litige-discussion
git add backend/src/routes/matches.ts backend/src/routes/__tests__/match.routes.test.ts
git commit -m "feat(match): routes GET/POST comments + motif obligatoire sur dispute"
```

---

## Task 6 : `commentCount` sur les payloads (TDD léger)

**Files:**
- Modify: `backend/src/routes/me.ts`
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/src/routes/__tests__/match-admin.routes.test.ts` (assertion ajoutée)

- [ ] **Step 1 : `/me/matches` — exposer `commentCount`**

Dans `backend/src/routes/me.ts`, route `GET /matches`, ajouter dans le `select` du `match` (à côté de `players: {...}`) :
```ts
            _count: { select: { comments: true } },
```
Et dans le `res.json(rows.map(...))`, ajouter au littéral retourné :
```ts
      commentCount: r.match._count.comments,
```

- [ ] **Step 2 : `/admin/matches` — exposer `commentCount`**

Dans `backend/src/routes/admin.ts`, route `GET /matches`, ajouter au `select` :
```ts
        _count: { select: { comments: true } },
```
Et remplacer `res.json(matches);` par :
```ts
    res.json(matches.map((m) => ({
      id: m.id, status: m.status, sets: m.sets, playedAt: m.playedAt,
      winningTeam: m.winningTeam, confirmDeadline: m.confirmDeadline,
      players: m.players, commentCount: m._count.comments,
    })));
```

- [ ] **Step 3 : Ajouter une assertion dans le test admin existant**

Dans `backend/src/routes/__tests__/match-admin.routes.test.ts`, repérer un test qui mocke `prismaMock.match.findMany` et l'objet match renvoyé : ajouter `_count: { comments: 2 }` à l'objet mocké, puis asserter `expect(res.body[0].commentCount).toBe(2);` dans ce test (ou un nouveau `it`).

- [ ] **Step 4 : Lancer les tests + compiler**

Run :
```bash
cd /c/dev/palova-wt-litige-discussion/backend && npx jest match-admin.routes me.routes && npx tsc --noEmit
```
Expected : PASS + aucune erreur TS.

- [ ] **Step 5 : Commit**

```bash
cd /c/dev/palova-wt-litige-discussion
git add backend/src/routes/me.ts backend/src/routes/admin.ts backend/src/routes/__tests__/match-admin.routes.test.ts
git commit -m "feat(match): commentCount additif sur /me/matches et /admin/matches"
```

---

## Task 7 : Front — types & méthodes API

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1 : Ajouter les types**

Dans `frontend/lib/api.ts`, près de `MyMatch`, ajouter :
```ts
export interface MatchComment {
  id: string;
  body: string;
  createdAt: string;
  isStaff: boolean;
  author: { firstName: string; lastName: string; avatarUrl: string | null };
}
export interface MatchThread {
  status: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'CANCELLED';
  comments: MatchComment[];
}
```
Ajouter `commentCount: number;` au type `MyMatch` (après `players: MyMatchPlayer[];`) et au type `ClubMatch` (après `players: ClubMatchPlayer[];`).

- [ ] **Step 2 : Modifier `disputeMatch` + ajouter les méthodes**

Dans l'objet `api`, remplacer `disputeMatch` et ajouter les deux méthodes :
```ts
  disputeMatch: (matchId: string, message: string, token: string) =>
    request<{ ok: true }>(`/api/matches/${matchId}/dispute`, { method: 'POST', body: JSON.stringify({ message }) }, token),
  getMatchComments: (matchId: string, token: string) =>
    request<MatchThread>(`/api/matches/${matchId}/comments`, {}, token),
  postMatchComment: (matchId: string, body: string, token: string) =>
    request<{ ok: true }>(`/api/matches/${matchId}/comments`, { method: 'POST', body: JSON.stringify({ body }) }, token),
```

- [ ] **Step 3 : Compiler le front**

Run : `cd /c/dev/palova-wt-litige-discussion/frontend && npx tsc --noEmit`
Expected : erreurs UNIQUEMENT là où `disputeMatch(id, token)` est encore appelé à 2 args (corrigé en Task 9) — noter ces emplacements. Aucune autre erreur.

- [ ] **Step 4 : Commit**

```bash
cd /c/dev/palova-wt-litige-discussion
git add frontend/lib/api.ts
git commit -m "feat(match): API front fil de discussion (types + méthodes, disputeMatch(message))"
```

---

## Task 8 : Front — composant `MatchDiscussion` (TDD)

**Files:**
- Create: `frontend/components/match/MatchDiscussion.tsx`
- Test: `frontend/__tests__/MatchDiscussion.test.tsx`

- [ ] **Step 1 : Écrire le test (échoue)**

Créer `frontend/__tests__/MatchDiscussion.test.tsx`.
> ⚠️ `MatchDiscussion` rend `Avatar`, qui utilise `useTheme()` → il FAUT wrapper `<ThemeProvider>` (sinon `useTheme must be used within <ThemeProvider>`). Le mock de `@/lib/api` DOIT exposer `assetUrl` (utilisé par `Avatar`).
```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { MatchDiscussion } from '@/components/match/MatchDiscussion';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  assetUrl: (u: string | null) => u, // requis par Avatar
  api: {
    getMatchComments: jest.fn(),
    postMatchComment: jest.fn(),
  },
}));
import { api } from '@/lib/api';

const renderWithTheme = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

const thread = {
  status: 'DISPUTED' as const,
  comments: [
    { id: 'k1', body: 'Le score est faux', createdAt: '2026-06-11T10:00:00Z', isStaff: false,
      author: { firstName: 'Manon', lastName: 'Membre', avatarUrl: null } },
    { id: 'k2', body: 'On vérifie', createdAt: '2026-06-11T11:00:00Z', isStaff: true,
      author: { firstName: 'Sam', lastName: 'Staff', avatarUrl: null } },
  ],
};

it('affiche les messages et le badge Staff', async () => {
  (api.getMatchComments as jest.Mock).mockResolvedValue(thread);
  renderWithTheme(<MatchDiscussion matchId="m1" token="t" canWrite={false} />);
  expect(await screen.findByText('Le score est faux')).toBeInTheDocument();
  expect(screen.getByText('On vérifie')).toBeInTheDocument();
  expect(screen.getByText('Staff')).toBeInTheDocument();
  expect(screen.getByText('Discussion close.')).toBeInTheDocument();
});

it('envoie un message quand canWrite', async () => {
  (api.getMatchComments as jest.Mock).mockResolvedValue(thread);
  (api.postMatchComment as jest.Mock).mockResolvedValue({ ok: true });
  renderWithTheme(<MatchDiscussion matchId="m1" token="t" canWrite />);
  await screen.findByText('Le score est faux');
  fireEvent.change(screen.getByPlaceholderText('Votre message…'), { target: { value: 'Je confirme le 6-4' } });
  fireEvent.click(screen.getByText('Envoyer'));
  await waitFor(() => expect(api.postMatchComment).toHaveBeenCalledWith('m1', 'Je confirme le 6-4', 't'));
});
```

- [ ] **Step 2 : Lancer (échoue)**

Run : `cd /c/dev/palova-wt-litige-discussion/frontend && npx jest MatchDiscussion`
Expected : FAIL (composant absent).

- [ ] **Step 3 : Créer `frontend/components/match/MatchDiscussion.tsx`**

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, MatchComment } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';

// Fil de discussion d'un match en litige. Réutilisé côté joueur et côté staff.
export function MatchDiscussion({ matchId, token, canWrite }: { matchId: string; token: string; canWrite: boolean }) {
  const [comments, setComments] = useState<MatchComment[] | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.getMatchComments(matchId, token).then((t) => setComments(t.comments)).catch(() => setComments([]));
  }, [matchId, token]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try { await api.postMatchComment(matchId, text, token); setBody(''); load(); }
    finally { setBusy(false); }
  };

  if (comments === null) return <p className="p-2 text-sm opacity-60">Chargement…</p>;

  return (
    <div className="mt-2 rounded-lg bg-black/[0.03] p-3">
      <div className="space-y-3">
        {comments.length === 0 && <p className="text-sm opacity-60">Aucun message.</p>}
        {comments.map((c) => (
          <div key={c.id} className="flex gap-2">
            <Avatar firstName={c.author.firstName} lastName={c.author.lastName} avatarUrl={c.author.avatarUrl} size={28} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold">{c.author.firstName} {c.author.lastName}</span>
                {c.isStaff && <span className="rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase">Staff</span>}
                <span className="opacity-50">
                  {new Date(c.createdAt).toLocaleDateString('fr-FR')} {new Date(c.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{c.body}</p>
            </div>
          </div>
        ))}
      </div>
      {canWrite ? (
        <div className="mt-3 flex gap-2">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={2}
            placeholder="Votre message…" className="flex-1 rounded-lg border p-2 text-sm" style={{ borderColor: 'rgba(0,0,0,0.15)' }} />
          <button type="button" disabled={busy || !body.trim()} onClick={send}
            className="self-end rounded-lg bg-black px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Envoyer</button>
        </div>
      ) : (
        <p className="mt-3 text-xs opacity-50">Discussion close.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4 : Lancer (passe)**

Run : `cd /c/dev/palova-wt-litige-discussion/frontend && npx jest MatchDiscussion`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
cd /c/dev/palova-wt-litige-discussion
git add frontend/components/match/MatchDiscussion.tsx frontend/__tests__/MatchDiscussion.test.tsx
git commit -m "feat(match): composant MatchDiscussion (fil de litige réutilisable)"
```

---

## Task 9 : Front — `MyMatchesList` : motif au « Contester » + toggle discussion (TDD)

**Files:**
- Modify: `frontend/components/match/MyMatchesList.tsx`
- Modify (existant): `frontend/__tests__/MyMatchesList.test.tsx`

- [ ] **Step 1 : Étendre le test EXISTANT (échoue)**

Le fichier `frontend/__tests__/MyMatchesList.test.tsx` existe déjà (wrapper `renderWithTheme` via `<ThemeProvider>`, mock `@/lib/api` avec `assetUrl`/`confirmMatch`/`disputeMatch`). Le modifier ainsi :

(a) **Mock api** — ajouter `getMatchComments` (le toggle discussion charge le fil). Remplacer la ligne `api: {...}` du `jest.mock('@/lib/api', …)` par :
```ts
  api: {
    confirmMatch: jest.fn().mockResolvedValue({ ok: true }),
    disputeMatch: jest.fn().mockResolvedValue({ ok: true }),
    getMatchComments: jest.fn().mockResolvedValue({ status: 'DISPUTED', comments: [] }),
  },
```

(b) **Nouveaux tests** — ajouter à la fin du fichier (réutilise `renderWithTheme`, `api`, `base` déjà définis en haut) :
```tsx
it('le « Contester » exige un motif avant envoi', async () => {
  renderWithTheme(<MyMatchesList matches={[{ ...base }] as any} token="t" onChanged={() => {}} />);
  fireEvent.click(screen.getByText('Contester'));
  const send = screen.getByRole('button', { name: 'Envoyer la contestation' });
  expect(send).toBeDisabled(); // désactivé tant que le motif est vide
  fireEvent.change(screen.getByPlaceholderText(/Expliquez le litige/i), { target: { value: 'Score faux' } });
  expect(send).not.toBeDisabled();
  fireEvent.click(send);
  await waitFor(() => expect(api.disputeMatch).toHaveBeenCalledWith('m1', 'Score faux', 't'));
});

it('un match en litige propose la discussion', () => {
  const disputed = { ...base, status: 'DISPUTED', needsMyConfirmation: false, commentCount: 2 };
  renderWithTheme(<MyMatchesList matches={[disputed] as any} token="t" onChanged={() => {}} />);
  expect(screen.getByText(/Discussion/)).toBeInTheDocument();
});
```
> Note : les `base` existants n'ont pas de `commentCount` → `undefined > 0` est `false`, donc les anciens tests (PENDING/CONFIRMED non-litige) n'affichent pas de fil et restent verts.

- [ ] **Step 2 : Lancer (échoue)**

Run : `cd /c/dev/palova-wt-litige-discussion/frontend && npx jest MyMatchesList`
Expected : FAIL.

- [ ] **Step 3 : Modifier `MyMatchesList.tsx`**

Ajouter l'import du composant en tête :
```tsx
import { MatchDiscussion } from '@/components/match/MatchDiscussion';
```
Remplacer le corps du composant `MyMatchesList` (la fonction) par cette version (mêmes helpers `PlayerChip`/`resultLabel`/`formatDateTime` conservés au-dessus) :
```tsx
export function MyMatchesList({ matches, token, onChanged }: { matches: MyMatch[]; token: string; onChanged: () => void }) {
  const { th } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [openThread, setOpenThread] = useState<string | null>(null);

  const confirm = async (id: string) => {
    setBusy(id);
    try { await api.confirmMatch(id, token); onChanged(); }
    finally { setBusy(null); }
  };
  const submitDispute = async (id: string) => {
    const msg = reason.trim();
    if (!msg) return;
    setBusy(id);
    try { await api.disputeMatch(id, msg, token); setDisputingId(null); setReason(''); onChanged(); }
    finally { setBusy(null); }
  };

  if (!matches.length) return <p className="p-4 text-sm opacity-60">Aucun match enregistré.</p>;
  return (
    <ul className="space-y-2">
      {matches.map((m) => {
        const { partners, opponents } = splitTeams(m.players ?? [], m.myTeam);
        const result = resultLabel(m);
        const resultColor = result.tone === 'win' ? ACCENTS.emerald : result.tone === 'loss' ? ACCENTS.coral : th.textMute;
        const hasThread = m.status === 'DISPUTED' || m.commentCount > 0;
        return (
          <li key={m.matchId} className="rounded-xl border p-3" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">{scoreLine(m.sets)}</span>
              <span className="text-xs font-semibold" style={{ color: resultColor }}>{result.text}</span>
            </div>

            <div className="mt-2 space-y-1 text-sm">
              {partners.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="opacity-50">Avec</span>
                  {partners.map((p) => <PlayerChip key={p.userId} p={p} />)}
                </div>
              )}
              {opponents.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="opacity-50">Contre</span>
                  {opponents.map((p) => <PlayerChip key={p.userId} p={p} />)}
                </div>
              )}
            </div>

            <div className="mt-2 text-xs opacity-60">{formatDateTime(m.playedAt)} · {m.sport.name}</div>
            <div className="text-xs opacity-60">{m.club.name}{m.resource ? ` · ${m.resource.name}` : ''}</div>

            {m.needsMyConfirmation && disputingId !== m.matchId && (
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy === m.matchId} onClick={() => confirm(m.matchId)}
                  className="rounded-lg bg-black px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Confirmer</button>
                <button type="button" disabled={busy === m.matchId} onClick={() => { setDisputingId(m.matchId); setReason(''); }}
                  className="rounded-lg bg-black/10 px-3 py-1.5 text-sm disabled:opacity-40">Contester</button>
              </div>
            )}

            {disputingId === m.matchId && (
              <div className="mt-2 space-y-2">
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2}
                  placeholder="Expliquez le litige (score, joueurs…)" autoFocus
                  className="w-full rounded-lg border p-2 text-sm" style={{ borderColor: 'rgba(0,0,0,0.15)' }} />
                <div className="flex gap-2">
                  <button type="button" disabled={busy === m.matchId || !reason.trim()} onClick={() => submitDispute(m.matchId)}
                    className="rounded-lg bg-black px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                    aria-label="Envoyer la contestation">Envoyer la contestation</button>
                  <button type="button" onClick={() => { setDisputingId(null); setReason(''); }}
                    className="rounded-lg bg-black/10 px-3 py-1.5 text-sm">Annuler</button>
                </div>
              </div>
            )}

            {hasThread && (
              <div className="mt-2">
                <button type="button" onClick={() => setOpenThread(openThread === m.matchId ? null : m.matchId)}
                  className="text-sm font-semibold underline opacity-80">
                  💬 Discussion{m.commentCount > 0 ? ` (${m.commentCount})` : ''}
                </button>
                {openThread === m.matchId && (
                  <MatchDiscussion matchId={m.matchId} token={token} canWrite={m.status === 'DISPUTED'} />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4 : Lancer (passe) + compiler**

Run : `cd /c/dev/palova-wt-litige-discussion/frontend && npx jest MyMatchesList && npx tsc --noEmit`
Expected : PASS + plus d'erreur `disputeMatch` (les appels restants à 2 args ont disparu).

- [ ] **Step 5 : Commit**

```bash
cd /c/dev/palova-wt-litige-discussion
git add frontend/components/match/MyMatchesList.tsx frontend/__tests__/MyMatchesList.test.tsx
git commit -m "feat(match): motif obligatoire au Contester + toggle discussion (joueur)"
```

---

## Task 10 : Front — discussion dans le back-office `/admin/matches`

**Files:**
- Modify: `frontend/app/admin/matches/page.tsx`
- Modify (existant): `frontend/__tests__/AdminMatches.test.tsx`

- [ ] **Step 1 : Importer le composant + un état de fil ouvert**

En tête de `frontend/app/admin/matches/page.tsx`, ajouter :
```tsx
import { MatchDiscussion } from '@/components/match/MatchDiscussion';
```
Dans le composant, après les `useState` existants, ajouter :
```tsx
  const [openThread, setOpenThread] = useState<string | null>(null);
```

- [ ] **Step 2 : Litiges — afficher le fil (écriture staff)**

Dans le `<li>` du segment `DISPUTED`, juste avant la rangée de boutons `Valider / Annuler` (`<div style={{ display: 'flex', gap: 8, marginTop: 12 }}>`), insérer :
```tsx
                  <MatchDiscussion matchId={m.id} token={token} canWrite />
```

- [ ] **Step 3 : Matchs confirmés — archive en lecture seule**

Dans le `<li>` du segment `CONFIRMED`, juste avant la rangée du bouton « Annuler le match », insérer :
```tsx
                  {m.commentCount > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <button type="button" onClick={() => setOpenThread(openThread === m.id ? null : m.id)}
                        style={{ fontFamily: th.fontUI, fontSize: 13, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: th.text }}>
                        💬 Voir la discussion ({m.commentCount})
                      </button>
                      {openThread === m.id && <MatchDiscussion matchId={m.id} token={token} canWrite={false} />}
                    </div>
                  )}
```

- [ ] **Step 4 : Mettre à jour le mock du test EXISTANT `AdminMatches.test.tsx`**

La page rend désormais `<MatchDiscussion>` dans les litiges (qui appelle `api.getMatchComments` et rend `Avatar` → `assetUrl`). Le mock `jest.mock('../lib/api', …)` du fichier `frontend/__tests__/AdminMatches.test.tsx` doit exposer ces fonctions. Remplacer le bloc `jest.mock('../lib/api', …)` par :
```ts
jest.mock('../lib/api', () => ({
  __esModule: true,
  assetUrl: (u: string | null) => u,
  api: {
    getClubMatches: (...a: unknown[]) => getClubMatches(...a),
    resolveClubMatch: (...a: unknown[]) => resolveClubMatch(...a),
    voidClubMatch: (...a: unknown[]) => voidClubMatch(...a),
    getMatchComments: jest.fn().mockResolvedValue({ status: 'DISPUTED', comments: [] }),
    postMatchComment: jest.fn().mockResolvedValue({ ok: true }),
  },
}));
```
> Les matchs mockés du test n'ont pas de `commentCount` → l'archive « Voir la discussion » (gardée par `commentCount > 0`) ne s'affiche pas dans le segment « Matchs confirmés », donc les tests existants restent inchangés ; côté Litiges, `MatchDiscussion` se charge avec un fil vide.

- [ ] **Step 5 : Lancer le test admin (vert) + compiler**

Run : `cd /c/dev/palova-wt-litige-discussion/frontend && npx jest AdminMatches && npx tsc --noEmit`
Expected : PASS + aucune erreur TS.

- [ ] **Step 6 : Commit**

```bash
cd /c/dev/palova-wt-litige-discussion
git add frontend/app/admin/matches/page.tsx frontend/__tests__/AdminMatches.test.tsx
git commit -m "feat(match): fil de litige côté staff + archive lecture seule (/admin/matches)"
```

---

## Task 11 : Gate complet + vérification manuelle

**Files:** aucun (validation).

- [ ] **Step 1 : Suite de tests backend**

Run : `cd /c/dev/palova-wt-litige-discussion/backend && npx jest`
Expected : tout vert.

- [ ] **Step 2 : Suite de tests frontend**

Run : `cd /c/dev/palova-wt-litige-discussion/frontend && npx jest`
Expected : tout vert.

- [ ] **Step 3 : Type-check des deux côtés**

Run :
```bash
cd /c/dev/palova-wt-litige-discussion/backend && npx tsc --noEmit
cd /c/dev/palova-wt-litige-discussion/frontend && npx tsc --noEmit
```
Expected : aucune erreur.

- [ ] **Step 4 : Vérification navigateur (manuelle)**

La migration `add_match_comments` est déjà appliquée sur la base dev (Task 1). Avec un match en litige (ex. le seed de démo crée déjà un litige Hugo/…), se connecter :
- joueur `membre@padel-arena-paris.fr` → /me/reservations → Matchs : « Contester » exige un motif ; un litige montre « 💬 Discussion » + permet d'écrire.
- staff `owner@padel-arena-paris.fr` → /admin/matches → Litiges : le motif + le fil s'affichent, on peut répondre, puis Valider/Annuler ; en « Matchs confirmés », « Voir la discussion » est en lecture seule.

- [ ] **Step 5 : Revue de code finale**

Invoquer `superpowers:requesting-code-review` sur le diff de la branche (back + front), corriger les retours, puis proposer le merge via `superpowers:finishing-a-development-branch`.

---

## Notes de déploiement

- **Une seule migration additive** `add_match_comments` (création de table) → s'applique au boot via `prisma migrate deploy`. Rien à câbler côté env.
- Aucune variable d'environnement nouvelle (emails via l'infra SMTP existante).
- Front : rebuild standard (nouveau composant), pas de dépendance ajoutée.
