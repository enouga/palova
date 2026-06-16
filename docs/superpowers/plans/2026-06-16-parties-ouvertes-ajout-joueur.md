# Parties ouvertes — ajout d'un joueur par l'organisateur — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'organisateur d'une partie ouverte d'ajouter un membre du club sur une place libre.

**Architecture:** Miroir du `joinOpenMatch` côté back (transaction Serializable + `FOR UPDATE`, recalcul des parts, notification best-effort), avec contrôle « acteur = organisateur » et « cible = membre actif ». Front : les pastilles « Place libre » deviennent un déclencheur d'ajout pour l'organisateur, qui ouvre l'annuaire de membres (`PartnerSearch`).

**Tech Stack:** Express 5 + Prisma 7 (back), Next.js 16 + React 19 (front), Jest (back & front).

Spec : `docs/superpowers/specs/2026-06-16-parties-ouvertes-ajout-joueur-design.md`.

---

### Task 1 : Notification `notifyOpenMatchAdded` (backend)

**Files:**
- Modify: `backend/src/email/notifications.ts` (après `notifyOpenMatchRemoved`, ~ligne 326)

Réutilise le builder **existant et déjà testé** `buildMatchInviteEmail` (« Vous avez été ajouté à une partie »). Pas de nouveau builder, donc pas de test dédié (cohérent avec `notifyOpenMatchJoin`/`Removed`/`Left`, non testées unitairement — couvertes via le mock du service + les tests de builders).

- [ ] **Step 1 : Ajouter la fonction**

```ts
/** Prévient un joueur que l'organisateur l'a ajouté à une partie ouverte. */
export async function notifyOpenMatchAdded(reservationId: string, addedUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: { select: { name: true, club: { select: { name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } },
      participants: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
    },
  });
  if (!resa) return;
  const organizer = resa.participants.find((p) => p.isOrganizer)?.user;
  const added = resa.participants.find((p) => p.userId === addedUserId)?.user;
  if (!added?.email) return;
  const club = resa.resource.club;
  const mail = buildMatchInviteEmail({
    recipientFirstName: added.firstName,
    byName: organizer ? fullName(organizer) : null,
    resourceName: resa.resource.name,
    dateLabel: formatDateRangeFr(resa.startTime, resa.endTime, club.timezone),
    clubName: club.name,
    url: clubAppUrl(club.slug, '/parties'),
    brand: brandOf(club),
  });
  await sendMail({ to: added.email, subject: mail.subject, html: mail.html, text: mail.text });
}
```

(Tous les helpers — `buildMatchInviteEmail`, `fullName`, `formatDateRangeFr`, `clubAppUrl`, `brandOf`, `sendMail`, `prisma` — sont déjà importés dans ce fichier.)

- [ ] **Step 2 : Vérifier la compilation**

Run: `npm run --prefix backend build` _(ou)_ `cd backend && npx tsc --noEmit`
Expected: PASS (aucune erreur de type).

- [ ] **Step 3 : Commit**

```bash
git add backend/src/email/notifications.ts
git commit -m "feat(open-match): notifyOpenMatchAdded (reuse buildMatchInviteEmail)"
```

---

### Task 2 : Service `addOpenMatchPlayer` (backend, TDD)

**Files:**
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`
- Modify: `backend/src/services/openMatch.service.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

En haut du fichier de test, ajouter le mock de la nouvelle notif (au mock `jest.mock('../../email/notifications', …)` existant) :

```ts
const mockNotifyAdded = jest.fn();
```
Dans le factory `jest.mock('../../email/notifications', () => ({ … }))`, ajouter la clé :
```ts
  notifyOpenMatchAdded: (...args: unknown[]) => mockNotifyAdded(...args),
```
Dans `beforeEach`, ajouter :
```ts
    mockNotifyAdded.mockReset().mockResolvedValue(undefined);
```

Puis ajouter ce `describe` (avant la fermeture du `describe('OpenMatchService')`) :

```ts
  describe('addOpenMatchPlayer', () => {
    const lockRow = (over: Record<string, unknown> = {}) =>
      (prismaMock.$queryRaw as jest.Mock).mockResolvedValue([{
        id: 'm1', status: 'CONFIRMED', visibility: 'PUBLIC', start_time: future(48), resource_id: 'court-1', total_price: '24', ...over,
      }]);
    const happyTx = () => prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    const resource = (over: Record<string, unknown> = {}) =>
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo', attributes: { format: 'double' }, ...over } as any);

    it('l organisateur ajoute un membre actif, re-répartit (24 € / 3 = 8 €) et notifie le joueur ajouté', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);
      prismaMock.reservationParticipant.create.mockResolvedValue({ id: 'p3' } as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3');

      expect(prismaMock.reservationParticipant.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ reservationId: 'm1', userId: 'user-3', isOrganizer: false }),
      }));
      const updates = (prismaMock.reservationParticipant.update as jest.Mock).mock.calls;
      expect(updates).toHaveLength(3);
      expect(updates.every((c) => Number(c[0].data.share) === 8)).toBe(true);
      expect(mockNotifyAdded).toHaveBeenCalledWith('m1', 'user-3');
    });

    it('un non-organisateur ne peut pas ajouter (NOT_ORGANIZER)', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
        { id: 'p2', userId: 'user-3', isOrganizer: false },
      ] as any);
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'user-3', 'user-4')).rejects.toThrow('NOT_ORGANIZER');
      expect(prismaMock.reservationParticipant.create).not.toHaveBeenCalled();
    });

    it('refuse une cible non-membre (MEMBERSHIP_REQUIRED)', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'org', isOrganizer: true }] as any);
      // 1er appel = acteur (resolveActiveMember) ACTIVE ; 2e = cible (dans la tx) null
      (prismaMock.clubMembership.findUnique as jest.Mock).mockReset()
        .mockResolvedValueOnce({ status: 'ACTIVE' } as any)
        .mockResolvedValueOnce(null as any);
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).rejects.toThrow('MEMBERSHIP_REQUIRED');
      expect(prismaMock.reservationParticipant.create).not.toHaveBeenCalled();
    });

    it('refuse une cible bloquée (MEMBERSHIP_BLOCKED)', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'org', isOrganizer: true }] as any);
      (prismaMock.clubMembership.findUnique as jest.Mock).mockReset()
        .mockResolvedValueOnce({ status: 'ACTIVE' } as any)
        .mockResolvedValueOnce({ status: 'BLOCKED' } as any);
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).rejects.toThrow('MEMBERSHIP_BLOCKED');
    });

    it('refuse une cible déjà présente (ALREADY_JOINED)', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
        { id: 'p2', userId: 'user-3', isOrganizer: false },
      ] as any);
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).rejects.toThrow('ALREADY_JOINED');
    });

    it('refuse si la partie est complète (MATCH_FULL)', async () => {
      happyTx(); lockRow(); resource({ attributes: { format: 'single' } }); // max 2
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).rejects.toThrow('MATCH_FULL');
      expect(prismaMock.reservationParticipant.create).not.toHaveBeenCalled();
    });

    it('refuse une partie passée (MATCH_IN_PAST)', async () => {
      happyTx(); lockRow({ start_time: new Date(Date.now() - 3_600_000) }); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'org', isOrganizer: true }] as any);
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).rejects.toThrow('MATCH_IN_PAST');
    });

    it('un échec d email ne fait pas échouer l ajout', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'org', isOrganizer: true }] as any);
      prismaMock.reservationParticipant.create.mockResolvedValue({ id: 'p3' } as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);
      mockNotifyAdded.mockRejectedValue(new Error('SMTP down'));
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).resolves.toBeDefined();
    });
  });
```

- [ ] **Step 2 : Lancer les tests (échec attendu)**

Run: `cd backend && npx jest openMatch.service -t addOpenMatchPlayer`
Expected: FAIL (`service.addOpenMatchPlayer is not a function`).

- [ ] **Step 3 : Implémenter la méthode**

Dans `openMatch.service.ts` : importer la notif (compléter l'import ligne 4) :
```ts
import { notifyOpenMatchJoin, notifyOpenMatchLeft, notifyOpenMatchRemoved, notifyOpenMatchAdded } from '../email/notifications';
```
Ajouter la méthode après `removeOpenMatchPlayer` (avant `leaveOpenMatch`) :
```ts
  /**
   * Ajout d'un joueur à une partie ouverte par l'organisateur.
   * Seul l'organisateur peut ajouter (NOT_ORGANIZER sinon) ; la cible doit être membre ACTIVE.
   * Miroir du join : transaction Serializable + FOR UPDATE, recalcul des parts, notif best-effort.
   */
  async addOpenMatchPlayer(slug: string, reservationId: string, organizerUserId: string, targetUserId: string) {
    const club = await this.resolveActiveMember(slug, organizerUserId);

    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string; visibility: string; start_time: Date; resource_id: string; total_price: string }>>`
        SELECT status, visibility, start_time, resource_id, total_price FROM reservations WHERE id = ${reservationId} FOR UPDATE
      `;
      const r = locked[0];
      if (!r) throw new Error('RESERVATION_NOT_FOUND');

      const resource = await tx.resource.findUnique({ where: { id: r.resource_id }, select: { clubId: true, attributes: true } });
      if (!resource || resource.clubId !== club.id) throw new Error('CLUB_MISMATCH');
      if (r.visibility !== 'PUBLIC' || r.status !== 'CONFIRMED') throw new Error('MATCH_NOT_JOINABLE');
      if (new Date(r.start_time).getTime() <= Date.now()) throw new Error('MATCH_IN_PAST');

      const maxPlayers = playerCount((resource.attributes as { format?: string } | null)?.format);
      const parts = await tx.reservationParticipant.findMany({
        where: { reservationId },
        select: { id: true, userId: true, isOrganizer: true },
      });
      const actor = parts.find((p) => p.userId === organizerUserId);
      if (!actor || !actor.isOrganizer) throw new Error('NOT_ORGANIZER');

      const targetMembership = await tx.clubMembership.findUnique({
        where: { userId_clubId: { userId: targetUserId, clubId: club.id } },
        select: { status: true },
      });
      if (!targetMembership) throw new Error('MEMBERSHIP_REQUIRED');
      if (targetMembership.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');

      if (parts.some((p) => p.userId === targetUserId)) throw new Error('ALREADY_JOINED');
      if (parts.length >= maxPlayers) throw new Error('MATCH_FULL');

      const created = await tx.reservationParticipant.create({
        data: { reservationId, userId: targetUserId, isOrganizer: false, share: new Prisma.Decimal(0) },
      });
      const priceCents = Math.round(Number(r.total_price) * 100);
      await this.applyShares(tx, [...parts.map((p) => ({ id: p.id, isOrganizer: p.isOrganizer })), { id: created.id, isOrganizer: false }], priceCents);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    await this.safeNotify(() => notifyOpenMatchAdded(reservationId, targetUserId));
    return { id: reservationId };
  }
```

- [ ] **Step 4 : Lancer les tests (succès attendu)**

Run: `cd backend && npx jest openMatch.service`
Expected: PASS (tous les tests `addOpenMatchPlayer` + les existants).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(open-match): addOpenMatchPlayer (organisateur ajoute un membre)"
```

---

### Task 3 : Route HTTP (backend)

**Files:**
- Modify: `backend/src/routes/clubs.ts` (après la route `DELETE …/participants/:userId`, ~ligne 164)

- [ ] **Step 1 : Ajouter la route**

```ts
router.post('/:slug/open-matches/:id/participants', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.addOpenMatchPlayer(asString(req.params.slug), asString(req.params.id), req.user!.id, asString((req.body as { userId?: unknown }).userId))); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add backend/src/routes/clubs.ts
git commit -m "feat(open-match): POST .../participants (ajout d'un joueur)"
```

---

### Task 4 : Client API (frontend)

**Files:**
- Modify: `frontend/lib/api.ts` (juste après `removeOpenMatchPlayer`, ~ligne 160)

- [ ] **Step 1 : Ajouter la méthode**

```ts
  addOpenMatchPlayer: (slug: string, id: string, userId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/participants`, { method: 'POST', body: JSON.stringify({ userId }) }, token),
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(open-match): api.addOpenMatchPlayer"
```

---

### Task 5 : UI `OpenMatches` (frontend, TDD)

**Files:**
- Test: `frontend/__tests__/OpenMatches.test.tsx`
- Modify: `frontend/components/openmatch/OpenMatches.tsx`

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans le `jest.mock('../lib/api', …)` du fichier de test, ajouter au bloc `api: { … }` :
```ts
    searchClubMembers: jest.fn().mockResolvedValue([]),
    addOpenMatchPlayer: jest.fn().mockResolvedValue({ id: 'm1' }),
```
Ajouter ces deux tests dans le `describe('OpenMatches')` :

```ts
  it('permet à l organisateur d ajouter un joueur sur une place libre', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ viewerIsParticipant: true, viewerIsOrganizer: true, spotsLeft: 2 })] as never);
    (mocked.searchClubMembers as jest.Mock).mockResolvedValue([{ id: 'u-new', firstName: 'New', lastName: 'Player' }]);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter un joueur' }));
    fireEvent.focus(screen.getByPlaceholderText(/membres/i));
    fireEvent.mouseDown(await screen.findByText('New Player'));
    await waitFor(() => expect(mocked.addOpenMatchPlayer).toHaveBeenCalledWith('demo', 'm1', 'u-new', 'abc'));
  });

  it('ne montre pas « Ajouter un joueur » à un non-organisateur', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ viewerIsParticipant: true, viewerIsOrganizer: false, spotsLeft: 2 })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);
    expect(await screen.findByText('Terrain 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter un joueur' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2 : Lancer les tests (échec attendu)**

Run: `cd frontend && npx jest OpenMatches`
Expected: FAIL (pas de bouton « Ajouter un joueur »).

- [ ] **Step 3 : Implémenter l'UI**

En tête de `OpenMatches.tsx`, ajouter l'import et l'état :
```ts
import { PartnerSearch } from '@/components/tournament/PartnerSearch';
```
Dans le composant, à côté des autres `useState` :
```ts
  const [addingId, setAddingId] = useState<string | null>(null);
```

Remplacer la boucle des « Place libre » (le `Array.from({ length: m.spotsLeft }).map(...)`) par :
```tsx
                    {Array.from({ length: m.spotsLeft }).map((_, i) => (
                      m.viewerIsOrganizer && i === 0 ? (
                        <button key="add" type="button" disabled={busy} aria-label="Ajouter un joueur"
                          onClick={() => setAddingId(addingId === m.id ? null : m.id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 12px 4px 4px', border: `1.5px dashed ${th.accent}`, background: 'transparent', cursor: busy ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.accent }}>
                          <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, border: `1.5px dashed ${th.accent}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, lineHeight: 1 }}>+</span>
                          Ajouter un joueur
                        </button>
                      ) : (
                        <span key={`e${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 12px 4px 4px', border: `1.5px dashed ${th.lineStrong}`, fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
                          <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, border: `1.5px dashed ${th.lineStrong}` }} />
                          Place libre
                        </span>
                      )
                    ))}
```

Juste après le `</div>` qui ferme la rangée joueurs+action (la `<div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>`), toujours dans la carte, ajouter :
```tsx
                {m.viewerIsOrganizer && addingId === m.id && (
                  <div style={{ marginTop: 12 }}>
                    <PartnerSearch
                      slug={club.slug} token={token!} selected={null}
                      excludeIds={m.players.map((p) => p.userId)}
                      onSelect={(member) => { setAddingId(null); act(m, () => api.addOpenMatchPlayer(club.slug, m.id, member.id, token!)); }}
                      onClear={() => {}}
                      disabled={busy}
                    />
                    <button type="button" onClick={() => setAddingId(null)} style={{ marginTop: 8, border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13 }}>Annuler</button>
                  </div>
                )}
```

- [ ] **Step 4 : Lancer les tests (succès attendu)**

Run: `cd frontend && npx jest OpenMatches`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "feat(open-match): l'organisateur ajoute un joueur depuis la carte de partie"
```

---

### Task 6 : Gate complet

- [ ] **Step 1 : Back**

Run: `cd backend && npx jest`
Expected: PASS (tout vert).

- [ ] **Step 2 : Front (tests + types)**

Run: `cd frontend && npx jest && npx tsc --noEmit`
Expected: PASS (tout vert, aucune erreur de type).

- [ ] **Step 3 : Revue finale**

Demander une revue (superpowers:requesting-code-review) avant merge.

---

## Notes

- **Migration : aucune** (additif pur sur `ReservationParticipant`).
- **Retrait existant : non touché.**
- L'email d'ajout réutilise `buildMatchInviteEmail` (même libellé que l'invitation de partenaire à la réservation).
