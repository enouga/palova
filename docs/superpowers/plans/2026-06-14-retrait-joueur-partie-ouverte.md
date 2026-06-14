# Retrait de joueur d'une partie ouverte (+ emails) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'organisateur d'une partie ouverte de retirer n'importe quel joueur, au non-organisateur de se retirer lui-même, avec un email d'alerte à la bonne personne — et afficher les joueurs par nom dans `/parties`.

**Architecture:** Un point d'entrée backend unifié `removeOpenMatchPlayer(slug, id, actor, target)` (transaction Serializable + FOR UPDATE, recalcul des parts via `applyShares`) qui gère départ volontaire ET retrait par l'organisateur ; `leaveOpenMatch` devient un wrapper. Emails best-effort après commit (nodemailer existant). Front : `/parties` affiche les joueurs en pilules nom+prénom avec croix de retrait pour l'organisateur.

**Tech Stack:** Express 5, Prisma 7 (Serializable tx), nodemailer, Next.js 16 + React 19 (styles inline + tokens `th.*`), Jest + jest-mock-extended.

> ⚠️ Dépôt en évolution parallèle : `git status` avant chaque commit, `git add` **uniquement** les fichiers listés dans l'étape.

---

### Task 1: Backend — `removeOpenMatchPlayer` + wrapper `leaveOpenMatch`

**Files:**
- Modify: `palova/backend/src/services/openMatch.service.ts` (import notif ligne 4 ; remplacer `leaveOpenMatch` lignes ~122-148 ; ajouter `userId` aux players de `listOpenMatches` ~78)
- Test: `palova/backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1: Mettre à jour le mock notifications + ajouter les tests (échec attendu)**

Dans le test, remplacer le bloc `jest.mock('../../email/notifications', …)` (lignes 5-8) par :

```ts
const mockNotifyJoin = jest.fn();
const mockNotifyLeft = jest.fn();
const mockNotifyRemoved = jest.fn();
jest.mock('../../email/notifications', () => ({
  notifyOpenMatchJoin: (...args: unknown[]) => mockNotifyJoin(...args),
  notifyOpenMatchLeft: (...args: unknown[]) => mockNotifyLeft(...args),
  notifyOpenMatchRemoved: (...args: unknown[]) => mockNotifyRemoved(...args),
}));
```

Dans `beforeEach`, après `mockNotifyJoin.mockReset()…`, ajouter :

```ts
    mockNotifyLeft.mockReset().mockResolvedValue(undefined);
    mockNotifyRemoved.mockReset().mockResolvedValue(undefined);
```

Ajouter un nouveau `describe` avant la fin du fichier (après le `describe('leaveOpenMatch', …)`) :

```ts
  describe('removeOpenMatchPlayer', () => {
    const lockRow = () => (prismaMock.$queryRaw as jest.Mock).mockResolvedValue([{ id: 'm1', start_time: future(48), resource_id: 'court-1', total_price: '24' }]);
    const happyTx = () => prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    const parts = () => prismaMock.reservationParticipant.findMany.mockResolvedValue([
      { id: 'p1', userId: 'org', isOrganizer: true },
      { id: 'p2', userId: 'user-3', isOrganizer: false },
      { id: 'p3', userId: 'user-4', isOrganizer: false },
    ] as any);

    it('l organisateur retire un joueur, re-répartit et notifie le joueur retiré', async () => {
      happyTx(); lockRow(); parts();
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
      prismaMock.reservationParticipant.delete.mockResolvedValue({} as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.removeOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3');

      expect(prismaMock.reservationParticipant.delete).toHaveBeenCalledWith({ where: { id: 'p2' } });
      const updates = (prismaMock.reservationParticipant.update as jest.Mock).mock.calls;
      expect(updates).toHaveLength(2); // org + user-4 → 12 € chacun
      expect(updates.every((c) => Number(c[0].data.share) === 12)).toBe(true);
      expect(mockNotifyRemoved).toHaveBeenCalledWith('m1', 'user-3');
      expect(mockNotifyLeft).not.toHaveBeenCalled();
    });

    it('un non-organisateur ne peut pas retirer un autre joueur (NOT_ORGANIZER)', async () => {
      happyTx(); lockRow(); parts();
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
      await expect(service.removeOpenMatchPlayer('club-demo', 'm1', 'user-3', 'user-4')).rejects.toThrow('NOT_ORGANIZER');
      expect(prismaMock.reservationParticipant.delete).not.toHaveBeenCalled();
    });

    it('on ne peut pas retirer l organisateur (CANNOT_REMOVE_ORGANIZER)', async () => {
      happyTx(); lockRow(); parts();
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
      await expect(service.removeOpenMatchPlayer('club-demo', 'm1', 'org', 'org')).rejects.toThrow('ORGANIZER_CANNOT_LEAVE');
    });

    it('départ volontaire : notifie l organisateur', async () => {
      happyTx(); lockRow(); parts();
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
      prismaMock.reservationParticipant.delete.mockResolvedValue({} as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.removeOpenMatchPlayer('club-demo', 'm1', 'user-3', 'user-3');

      expect(mockNotifyLeft).toHaveBeenCalledWith('m1', 'user-3');
      expect(mockNotifyRemoved).not.toHaveBeenCalled();
    });

    it('un échec d email ne fait pas échouer le retrait', async () => {
      happyTx(); lockRow(); parts();
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
      prismaMock.reservationParticipant.delete.mockResolvedValue({} as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);
      mockNotifyRemoved.mockRejectedValue(new Error('SMTP down'));

      await expect(service.removeOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).resolves.toBeDefined();
    });
  });
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `cd palova/backend && npx jest src/services/__tests__/openMatch.service.test.ts`
Expected: FAIL (`removeOpenMatchPlayer is not a function`).

- [ ] **Step 3: Implémenter le service**

Dans `openMatch.service.ts` ligne 4, remplacer l'import par :

```ts
import { notifyOpenMatchJoin, notifyOpenMatchLeft, notifyOpenMatchRemoved } from '../email/notifications';
```

Dans `listOpenMatches`, remplacer le `players: m.participants.map(...)` (~78-80) par (ajout de `userId`) :

```ts
        players: m.participants.map((p) => ({
          userId: p.userId, firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl, isOrganizer: p.isOrganizer,
        })),
```

Remplacer toute la méthode `leaveOpenMatch` (lignes ~122-148) par :

```ts
  /**
   * Retrait d'un joueur d'une partie ouverte.
   * - target == acteur : départ volontaire (« Quitter »).
   * - target ≠ acteur : seul l'organisateur peut retirer un autre joueur (NOT_ORGANIZER sinon).
   * On ne retire jamais l'organisateur (il annule la résa pour dissoudre la partie).
   */
  async removeOpenMatchPlayer(slug: string, reservationId: string, actorUserId: string, targetUserId: string) {
    const club = await this.resolveActiveMember(slug, actorUserId);

    const outcome = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ start_time: Date; resource_id: string; total_price: string }>>`
        SELECT start_time, resource_id, total_price FROM reservations WHERE id = ${reservationId} FOR UPDATE
      `;
      const r = locked[0];
      if (!r) throw new Error('RESERVATION_NOT_FOUND');
      const resource = await tx.resource.findUnique({ where: { id: r.resource_id }, select: { clubId: true } });
      if (!resource || resource.clubId !== club.id) throw new Error('CLUB_MISMATCH');
      if (new Date(r.start_time).getTime() <= Date.now()) throw new Error('MATCH_IN_PAST');

      const parts = await tx.reservationParticipant.findMany({
        where: { reservationId },
        select: { id: true, userId: true, isOrganizer: true },
      });
      const actor = parts.find((p) => p.userId === actorUserId);
      if (!actor) throw new Error('PARTICIPANT_NOT_FOUND');
      const isSelf = actorUserId === targetUserId;
      if (!isSelf && !actor.isOrganizer) throw new Error('NOT_ORGANIZER');

      const target = parts.find((p) => p.userId === targetUserId);
      if (!target) throw new Error('PARTICIPANT_NOT_FOUND');
      if (target.isOrganizer) throw new Error(isSelf ? 'ORGANIZER_CANNOT_LEAVE' : 'CANNOT_REMOVE_ORGANIZER');

      await tx.reservationParticipant.delete({ where: { id: target.id } });
      const remaining = parts.filter((p) => p.id !== target.id).map((p) => ({ id: p.id, isOrganizer: p.isOrganizer }));
      await this.applyShares(tx, remaining, Math.round(Number(r.total_price) * 100));
      return { isSelf };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    // Best-effort après commit : prévenir la bonne personne.
    if (outcome.isSelf) await this.safeNotify(() => notifyOpenMatchLeft(reservationId, targetUserId));
    else                await this.safeNotify(() => notifyOpenMatchRemoved(reservationId, targetUserId));
    return { id: reservationId };
  }

  /** Quitter une partie ouverte (départ volontaire) — délègue au retrait unifié. */
  async leaveOpenMatch(slug: string, reservationId: string, userId: string) {
    return this.removeOpenMatchPlayer(slug, reservationId, userId, userId);
  }
```

- [ ] **Step 4: Lancer les tests → succès (Task 1 ne dépend pas encore des vraies notif, mockées)**

Run: `cd palova/backend && npx jest src/services/__tests__/openMatch.service.test.ts`
Expected: PASS (tous, y compris les anciens `leaveOpenMatch`).

- [ ] **Step 5: Commit**

```bash
cd palova/backend && git add src/services/openMatch.service.ts src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(parties): retrait unifié d'un joueur (organisateur ou soi-même)"
```

---

### Task 2: Backend — builders email + fonctions notify

**Files:**
- Modify: `palova/backend/src/email/templates/emails.ts` (ajouter 2 builders après `buildMatchInviteEmail`, ~ligne 242)
- Modify: `palova/backend/src/email/notifications.ts` (import builders + 2 fonctions dans la section « Parties ouvertes »)
- Test: `palova/backend/src/email/__tests__/emails.test.ts`

- [ ] **Step 1: Tests des builders (échec attendu)**

Ajouter dans `emails.test.ts` (adapter `brand`/imports au style existant du fichier) :

```ts
import { buildMatchRemovedEmail, buildMatchLeftEmail } from '../templates/emails';

describe('buildMatchRemovedEmail', () => {
  it('email au joueur retiré, avec club et lien', () => {
    const m = buildMatchRemovedEmail({ recipientFirstName: 'Léa', resourceName: 'Court 1', dateLabel: 'lun. 16 juin, 18h00 → 19h00', clubName: 'Padel Arena Paris', url: 'https://x/parties', brand: { name: 'Padel Arena Paris', accent: '#5e93da', logoUrl: null } as any });
    expect(m.subject).toContain('Padel Arena Paris');
    expect(m.text).toContain('Court 1');
    expect(m.html).toContain('Léa');
  });
});

describe('buildMatchLeftEmail', () => {
  it('email à l organisateur avec le nom du partant', () => {
    const m = buildMatchLeftEmail({ organizerFirstName: 'Tom', leaverName: 'Léa Martin', resourceName: 'Court 1', dateLabel: 'lun. 16 juin', clubName: 'Padel Arena Paris', spotsLeft: 1, url: 'https://x/parties', brand: { name: 'Padel Arena Paris', accent: '#5e93da', logoUrl: null } as any });
    expect(m.subject).toContain('Léa Martin');
    expect(m.text).toContain('1 place');
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd palova/backend && npx jest src/email/__tests__/emails.test.ts`
Expected: FAIL (`buildMatchRemovedEmail` introuvable).

- [ ] **Step 3: Ajouter les builders** dans `emails.ts` juste après `buildMatchInviteEmail` (avant `function stripTags`) :

```ts
export interface MatchRemovedEmailInput {
  recipientFirstName: string; resourceName: string; dateLabel: string; clubName: string; url: string; brand: Brand;
}

/** Email à un joueur retiré d'une partie par l'organisateur. */
export function buildMatchRemovedEmail(i: MatchRemovedEmailInput): BuiltEmail {
  const subject = `Vous avez été retiré·e d'une partie — ${i.clubName}`;
  const heading = 'Changement dans une partie';
  const intro = "L'organisateur vous a retiré·e de cette partie de padel.";
  const infoRows: InfoRow[] = [
    { label: 'Terrain', value: i.resourceName },
    { label: 'Date', value: i.dateLabel },
    { label: 'Club', value: i.clubName },
  ];
  const introHtml = `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(i.recipientFirstName)},</p><p style="margin:0;">${escapeHtml(intro)}</p>`;
  const html = renderLayout({ brand: i.brand, preheader: subject, heading, introHtml, infoRows, ctaLabel: 'Voir les parties ouvertes', ctaUrl: i.url });
  const text = [`Bonjour ${i.recipientFirstName},`, '', intro, '', `Terrain : ${i.resourceName}`, `Date : ${i.dateLabel}`, `Club : ${i.clubName}`, '', `Parties ouvertes : ${i.url}`].join('\n');
  return { subject, html, text };
}

export interface MatchLeftEmailInput {
  organizerFirstName: string; leaverName: string; resourceName: string; dateLabel: string; clubName: string; spotsLeft: number; url: string; brand: Brand;
}

/** Email à l'organisateur quand un joueur quitte sa partie ouverte. */
export function buildMatchLeftEmail(i: MatchLeftEmailInput): BuiltEmail {
  const subject = `${i.leaverName} a quitté votre partie`;
  const heading = 'Un joueur a quitté votre partie';
  const intro = `<strong>${escapeHtml(i.leaverName)}</strong> a quitté votre partie ouverte. Il reste ${i.spotsLeft} place${i.spotsLeft > 1 ? 's' : ''}.`;
  const infoRows: InfoRow[] = [
    { label: 'Terrain', value: i.resourceName },
    { label: 'Date', value: i.dateLabel },
    { label: 'Club', value: i.clubName },
  ];
  const introHtml = `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(i.organizerFirstName)},</p><p style="margin:0;">${intro}</p>`;
  const html = renderLayout({ brand: i.brand, preheader: subject, heading, introHtml, infoRows, ctaLabel: 'Voir la partie', ctaUrl: i.url });
  const text = [`Bonjour ${i.organizerFirstName},`, '', stripTags(intro), '', `Terrain : ${i.resourceName}`, `Date : ${i.dateLabel}`, `Club : ${i.clubName}`, '', `Voir la partie : ${i.url}`].join('\n');
  return { subject, html, text };
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd palova/backend && npx jest src/email/__tests__/emails.test.ts`
Expected: PASS.

- [ ] **Step 5: Ajouter les fonctions notify** dans `notifications.ts`. D'abord ajouter `buildMatchRemovedEmail, buildMatchLeftEmail` à l'import depuis `./templates/emails`. Puis, dans la section « Parties ouvertes » (après `notifyMatchPartnersInvited`) :

```ts
/** Prévient un joueur que l'organisateur l'a retiré d'une partie ouverte. */
export async function notifyOpenMatchRemoved(reservationId: string, removedUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { resource: { select: { name: true, club: { select: { name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } } },
  });
  if (!resa) return;
  const member = await prisma.user.findUnique({ where: { id: removedUserId }, select: { firstName: true, email: true } });
  if (!member?.email) return;
  const club = resa.resource.club;
  const mail = buildMatchRemovedEmail({
    recipientFirstName: member.firstName,
    resourceName: resa.resource.name,
    dateLabel: formatDateRangeFr(resa.startTime, resa.endTime, club.timezone),
    clubName: club.name, url: clubAppUrl(club.slug, '/parties'), brand: brandOf(club),
  });
  await sendMail({ to: member.email, subject: mail.subject, html: mail.html, text: mail.text });
}

/** Prévient l'organisateur qu'un joueur a quitté sa partie ouverte. */
export async function notifyOpenMatchLeft(reservationId: string, leaverUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: { select: { name: true, attributes: true, club: { select: { name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } },
      participants: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
    },
  });
  if (!resa) return;
  const organizer = resa.participants.find((p) => p.isOrganizer)?.user;
  if (!organizer?.email) return;
  const leaver = await prisma.user.findUnique({ where: { id: leaverUserId }, select: { firstName: true, lastName: true } });
  if (!leaver) return;
  const club = resa.resource.club;
  const maxPlayers = playerCount((resa.resource.attributes as { format?: string } | null)?.format);
  const mail = buildMatchLeftEmail({
    organizerFirstName: organizer.firstName,
    leaverName: fullName(leaver),
    resourceName: resa.resource.name,
    dateLabel: formatDateRangeFr(resa.startTime, resa.endTime, club.timezone),
    clubName: club.name,
    spotsLeft: Math.max(0, maxPlayers - resa.participants.length),
    url: clubAppUrl(club.slug, '/parties'),
    brand: brandOf(club),
  });
  await sendMail({ to: organizer.email, subject: mail.subject, html: mail.html, text: mail.text });
}
```

- [ ] **Step 6: Typecheck + tests email**

Run: `cd palova/backend && npx tsc --noEmit && npx jest src/email`
Expected: PASS, aucune erreur de type.

- [ ] **Step 7: Commit**

```bash
cd palova/backend && git add src/email/templates/emails.ts src/email/notifications.ts src/email/__tests__/emails.test.ts
git commit -m "feat(parties): emails retrait/départ d'une partie ouverte"
```

---

### Task 3: Backend — route + codes d'erreur

**Files:**
- Modify: `palova/backend/src/routes/clubs.ts` (ERROR_STATUS ~24-39 ; route après la route leave ~155)

- [ ] **Step 1: Ajouter les codes d'erreur** dans `ERROR_STATUS` (après `ORGANIZER_CANNOT_LEAVE`) :

```ts
  NOT_ORGANIZER:          403,
  CANNOT_REMOVE_ORGANIZER: 409,
```

- [ ] **Step 2: Ajouter la route** juste après la route `DELETE '/:slug/open-matches/:id/join'` :

```ts
router.delete('/:slug/open-matches/:id/participants/:userId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.removeOpenMatchPlayer(asString(req.params.slug), asString(req.params.id), req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 3: Typecheck**

Run: `cd palova/backend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
cd palova/backend && git add src/routes/clubs.ts
git commit -m "feat(parties): route DELETE participants/:userId + codes d'erreur"
```

---

### Task 4: Frontend — client API + type

**Files:**
- Modify: `palova/frontend/lib/api.ts` (type `OpenMatchPlayer` ~547 ; helper après `leaveOpenMatch` ~105)

- [ ] **Step 1: Ajouter `userId` au type joueur** — dans `OpenMatchPlayer` (ligne ~547), ajouter en première ligne du corps :

```ts
  userId: string;
```

- [ ] **Step 2: Ajouter le helper** après `leaveOpenMatch` (~105) :

```ts
  removeOpenMatchPlayer: (slug: string, id: string, userId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/participants/${userId}`, { method: 'DELETE' }, token),
```

- [ ] **Step 3: Typecheck**

Run: `cd palova/frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
cd palova/frontend && git add lib/api.ts
git commit -m "feat(parties): api removeOpenMatchPlayer + userId joueur"
```

---

### Task 5: Frontend — affichage par noms + retrait organisateur

**Files:**
- Modify: `palova/frontend/components/openmatch/OpenMatches.tsx` (map d'erreurs ~12-20 ; bloc joueurs/actions ~90-108)

- [ ] **Step 1: Ajouter les messages d'erreur** dans `JOIN_ERRORS` :

```ts
  NOT_ORGANIZER:          "Seul l'organisateur peut retirer un joueur.",
  CANNOT_REMOVE_ORGANIZER: "L'organisateur ne peut pas être retiré.",
  MATCH_IN_PAST:          'Cette partie a déjà eu lieu.',
  PARTICIPANT_NOT_FOUND:  "Ce joueur n'est plus dans la partie.",
```

- [ ] **Step 2: Remplacer le bloc joueurs + actions** (le `<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>` qui contient les avatars et les boutons, ~90-108) par :

```tsx
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, flexWrap: 'wrap' }}>
                    {m.players.map((p) => (
                      <span key={p.userId} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: p.isOrganizer ? `${th.accent}22` : th.surface2,
                        border: `1px solid ${p.isOrganizer ? th.accent : th.line}`,
                        borderRadius: 999, padding: '5px 11px',
                        fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text,
                      }}>
                        {p.firstName} {p.lastName}
                        {p.isOrganizer && <span style={{ fontSize: 10, fontWeight: 700, color: th.accent, textTransform: 'uppercase', letterSpacing: 0.3 }}>orga</span>}
                        {m.viewerIsOrganizer && !p.isOrganizer && (
                          <button type="button" disabled={busy} aria-label={`Retirer ${p.firstName} ${p.lastName}`} title="Retirer ce joueur"
                            onClick={() => act(m, () => api.removeOpenMatchPlayer(club.slug, m.id, p.userId, token!))}
                            style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textMute, fontSize: 15, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
                        )}
                      </span>
                    ))}
                    {Array.from({ length: m.spotsLeft }).map((_, i) => (
                      <span key={`e${i}`} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '5px 12px', border: `1.5px dashed ${th.lineStrong}`, fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>Place libre</span>
                    ))}
                  </div>
                  {m.viewerIsOrganizer ? (
                    <Chip tone="line" icon="check">Vous organisez</Chip>
                  ) : m.viewerIsParticipant ? (
                    <Btn variant="surface" disabled={busy} onClick={() => act(m, () => api.leaveOpenMatch(club.slug, m.id, token!))}>Quitter</Btn>
                  ) : (
                    <Btn icon="plus" disabled={busy || m.full} onClick={() => act(m, () => api.joinOpenMatch(club.slug, m.id, token!))}>Rejoindre</Btn>
                  )}
                </div>
```

(Le composant `Avatar` n'est alors plus utilisé dans ce fichier — retirer son import ligne 8 pour éviter l'erreur lint « unused ».)

- [ ] **Step 3: Typecheck + tests front**

Run: `cd palova/frontend && npx tsc --noEmit && npx jest`
Expected: PASS, aucune erreur.

- [ ] **Step 4: Commit**

```bash
cd palova/frontend && git add components/openmatch/OpenMatches.tsx
git commit -m "feat(parties): joueurs en pilules nom+prénom + retrait par l'organisateur"
```

---

### Task 6: Vérification finale

- [ ] **Step 1: Suites complètes**

Run: `cd palova/backend && npx jest` puis `cd palova/frontend && npx jest`
Expected: tout vert (back + front).

- [ ] **Step 2: Typecheck des deux côtés**

Run: `cd palova/backend && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Test manuel (3 comptes même club)**

Démarrer Docker + back + front (`palova/CLAUDE.md`). A crée une partie **ouverte** (PUBLIC), B et C rejoignent.
- En **A** sur `/parties` : retirer C → C reçoit l'email, compo à jour, joueurs affichés par nom.
- En **B** : « Quitter » → A (organisateur) reçoit l'email.
- Vérifier orga mis en avant + « Place libre » en pointillés.

---

## Self-review
- **Spec coverage** : organisateur retire (Task 1/3/5) ; non-orga se retire (wrapper leave, Task 1) ; emails bon destinataire (Task 2) ; affichage par noms (Task 5) ; route (Task 3) ; userId exposé (Task 1 listOpenMatches + Task 4 type). ✓
- **Placeholders** : aucun — tout le code est fourni. ✓
- **Cohérence des types/signatures** : `removeOpenMatchPlayer(slug,id,actor,target)` partout ; `leaveOpenMatch` conserve sa signature (wrapper) → routes/tests existants inchangés ; `OpenMatchPlayer.userId` ajouté côté back (mapping) ET front (type). Codes d'erreur (`NOT_ORGANIZER`, `CANNOT_REMOVE_ORGANIZER`, `ORGANIZER_CANNOT_LEAVE`) cohérents service ↔ ERROR_STATUS ↔ JOIN_ERRORS. ✓
