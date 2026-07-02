# Rejoindre par place libre — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un non-participant (anonyme compris) rejoint une partie ouverte en tapant une place libre du mini-terrain — à cette place précise (team+slot persistés) — et le bouton « Rejoindre » de la barre d'actions disparaît.

**Architecture:** `POST /open-matches/:id/join` gagne un body additif `{ team?, slot? }` validé dans la transaction Serializable existante contre le layout effectif (`effectiveTeams`). Côté front, `MatchTeams` gagne une prop `onJoinFree` (cellule libre → bouton « Rejoindre »), câblée par `OpenMatchCard` pour le viewer non-inscrit ; `useOpenMatchActions.join` transporte la cible, y compris à travers l'avertissement de niveau.

**Tech Stack:** Express 5 + Prisma 7 (backend), Next.js 16 + React 19 (frontend), Jest des deux côtés. Aucune migration (colonnes `team`/`slot` déjà en base).

**Spec :** `docs/superpowers/specs/2026-07-02-rejoindre-par-place-libre-design.md`

**⚠️ Contexte repo :**
- Le working tree contient du WIP préexistant sur `frontend/components/match/MatchTeams.tsx` (alignement cosmétique `cellMinH`) et `frontend/components/ClubNav.tsx`. La Task 1 committe le WIP MatchTeams séparément pour garder le diff de la feature propre. **Ne jamais stager `ClubNav.tsx`** (hors périmètre).
- Avant CHAQUE commit : `git branch --show-current` doit répondre `main` et on stage uniquement les fichiers listés (l'utilisateur édite le repo en parallèle).
- Les tests frontend ne type-checkent pas (ts-jest isolatedModules) : `npx tsc --noEmit` est un gate séparé.

---

### Task 1: Committer le WIP cosmétique préexistant de MatchTeams

Le fichier `frontend/components/match/MatchTeams.tsx` porte 3 hunks non commités (hauteur de cellule uniforme `cellMinH`, contenu épinglé en haut). C'est du travail fini et autonome ; on le committe seul pour que le commit de la feature ne mélange rien.

**Files:**
- Commit (sans modification): `frontend/components/match/MatchTeams.tsx`

- [ ] **Step 1: Vérifier que le WIP est bien le hunk cosmétique attendu**

Run: `git diff --stat frontend/components/match/MatchTeams.tsx`
Expected: `1 file changed` avec ~14 insertions / ~3 deletions (hunks `cellMinH`, `minHeight`, `flex-start`). Si le diff a changé de nature (l'utilisateur a retravaillé le fichier), STOP et demander.

- [ ] **Step 2: Committer**

```bash
git add frontend/components/match/MatchTeams.tsx
git commit -m "fix(match-teams): hauteur de cellule uniforme, contenu épinglé en haut (colonnes alignées)"
```

---

### Task 2: Backend — `joinOpenMatch` accepte une place cible

**Files:**
- Modify: `backend/src/services/openMatch.service.ts` (méthode `joinOpenMatch`, lignes ~187-222)
- Test: `backend/src/services/__tests__/openMatch.service.test.ts` (describe `joinOpenMatch`, après le test `MEMBERSHIP_BLOCKED` ~ligne 355)

- [ ] **Step 1: Écrire les tests qui échouent**

Dans le `describe('joinOpenMatch', …)` existant (réutiliser les helpers locaux `lockRow`/`happyTx`/`resource`), ajouter :

```typescript
    it('join ciblé : crée le participant avec team/slot explicites', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true, team: 1, slot: 0 },
      ] as any);
      prismaMock.reservationParticipant.create.mockResolvedValue({ id: 'p2' } as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.joinOpenMatch('club-demo', 'm1', 'user-3', { team: 2, slot: 1 });

      expect(prismaMock.reservationParticipant.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ reservationId: 'm1', userId: 'user-3', team: 2, slot: 1 }),
      }));
    });

    it('join ciblé sans slot : team explicite, slot null (dérivé à la lecture)', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true, team: 1, slot: 0 },
      ] as any);
      prismaMock.reservationParticipant.create.mockResolvedValue({ id: 'p2' } as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.joinOpenMatch('club-demo', 'm1', 'user-3', { team: 2 });

      expect(prismaMock.reservationParticipant.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ team: 2, slot: null }),
      }));
    });

    it('lève TEAM_SLOT_TAKEN si la place visée est occupée (slot explicite)', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true, team: 1, slot: 0 },
      ] as any);

      await expect(service.joinOpenMatch('club-demo', 'm1', 'user-3', { team: 1, slot: 0 }))
        .rejects.toThrow('TEAM_SLOT_TAKEN');
      expect(prismaMock.reservationParticipant.create).not.toHaveBeenCalled();
    });

    it('lève TEAM_SLOT_TAKEN aussi contre le layout dérivé (participant sans team/slot explicites)', async () => {
      happyTx(); lockRow(); resource();
      // org sans team/slot → le layout effectif le place en (1, G) : cette place n'est PAS libre.
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true, team: null, slot: null },
      ] as any);

      await expect(service.joinOpenMatch('club-demo', 'm1', 'user-3', { team: 1, slot: 0 }))
        .rejects.toThrow('TEAM_SLOT_TAKEN');
    });

    it('lève TEAM_SIDE_FULL si le côté visé est plein', async () => {
      happyTx(); lockRow(); resource(); // double → half = 2
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true, team: 1, slot: 0 },
        { id: 'p2', userId: 'user-2', isOrganizer: false, team: 1, slot: 1 },
      ] as any);

      await expect(service.joinOpenMatch('club-demo', 'm1', 'user-3', { team: 1 }))
        .rejects.toThrow('TEAM_SIDE_FULL');
    });

    it('lève TEAM_INVALID sur team hors {1,2} ou slot hors bornes', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true, team: 1, slot: 0 },
      ] as any);

      await expect(service.joinOpenMatch('club-demo', 'm1', 'user-3', { team: 3 }))
        .rejects.toThrow('TEAM_INVALID');
      await expect(service.joinOpenMatch('club-demo', 'm1', 'user-3', { team: 1, slot: 5 }))
        .rejects.toThrow('TEAM_INVALID');
    });

    it('sans cible : participant créé sans team/slot (comportement historique)', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
      ] as any);
      prismaMock.reservationParticipant.create.mockResolvedValue({ id: 'p2' } as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.joinOpenMatch('club-demo', 'm1', 'user-3');

      const data = (prismaMock.reservationParticipant.create as jest.Mock).mock.calls[0][0].data;
      expect(data.team).toBeUndefined();
      expect(data.slot).toBeUndefined();
    });
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run (depuis `backend/`): `npx jest src/services/__tests__/openMatch.service.test.ts -t "join"`
Expected: les 6 nouveaux tests FAIL (la signature n'accepte pas de 4ᵉ argument / pas de validation TEAM_*), les tests existants PASS.

- [ ] **Step 3: Implémenter**

Dans `backend/src/services/openMatch.service.ts`, remplacer la méthode `joinOpenMatch` entière par :

```typescript
  /**
   * Rejoindre une partie ouverte : transaction Serializable + FOR UPDATE (anti sur-réservation).
   * `target` (tap sur une place libre) = place précise demandée, validée contre le layout
   * effectif — celui que le front affiche : TEAM_INVALID / TEAM_SIDE_FULL / TEAM_SLOT_TAKEN.
   * Sans `target`, comportement historique (team/slot null, dérivés à la lecture).
   */
  async joinOpenMatch(
    slug: string,
    reservationId: string,
    userId: string,
    target?: { team: number; slot?: number },
  ) {
    const club = await ensureActiveMembership(slug, userId);

    const result = await prisma.$transaction(async (tx) => {
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
        orderBy: { joinedAt: 'asc' },
        select: { id: true, userId: true, isOrganizer: true, team: true, slot: true },
      });
      if (parts.length >= maxPlayers) throw new Error('MATCH_FULL');
      if (parts.some((p) => p.userId === userId)) throw new Error('ALREADY_JOINED');

      // Place ciblée : validée contre le layout effectif (même dérivation que le DTO,
      // ordre joinedAt) — une place « libre » à l'écran l'est aussi ici, sinon course perdue.
      let placement: { team: number; slot: number | null } | undefined;
      if (target) {
        const half = Math.max(1, Math.floor(maxPlayers / 2));
        if (target.team !== 1 && target.team !== 2) throw new Error('TEAM_INVALID');
        if (target.slot !== undefined && (!Number.isInteger(target.slot) || target.slot < 0 || target.slot >= half)) throw new Error('TEAM_INVALID');
        const layout = effectiveTeams(parts, maxPlayers);
        if (layout.filter((p) => p.team === target.team).length >= half) throw new Error('TEAM_SIDE_FULL');
        if (target.slot !== undefined && layout.some((p) => p.team === target.team && p.slot === target.slot)) throw new Error('TEAM_SLOT_TAKEN');
        placement = { team: target.team, slot: target.slot ?? null };
      }

      const created = await tx.reservationParticipant.create({
        data: { reservationId, userId, isOrganizer: false, share: new Prisma.Decimal(0), ...(placement ?? {}) },
      });
      const priceCents = Math.round(Number(r.total_price) * 100);
      await this.applyShares(tx, [...parts.map((p) => ({ id: p.id, isOrganizer: p.isOrganizer })), { id: created.id, isOrganizer: false }], priceCents);
      return { id: reservationId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    // Après commit, best-effort : prévenir l'organisateur qu'un joueur a rejoint.
    await this.safeNotify(() => notifyOpenMatchJoin(reservationId, userId));
    return result;
  }
```

Notes : `effectiveTeams` est déjà importé en tête de fichier (ligne 6). Le `findMany` gagne `orderBy: { joinedAt: 'asc' }` + les champs `team`/`slot` (sans effet sur le comportement historique — `applyShares` est insensible à l'ordre).

- [ ] **Step 4: Vérifier que la suite passe**

Run (depuis `backend/`): `npx jest src/services/__tests__/openMatch.service.test.ts`
Expected: PASS (tous, anciens et nouveaux).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(open-match): joinOpenMatch accepte une place cible (team/slot) validée dans la transaction"
```

---

### Task 3: Backend — la route `/join` relaie le body `{ team?, slot? }`

**Files:**
- Modify: `backend/src/routes/clubs.ts` (route `POST /:slug/open-matches/:id/join`, lignes ~279-282)
- Test: `backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Dans le describe qui contient déjà le test `MATCH_NOT_JOINABLE → 409` (~ligne 191, il dispose de `base`, `token()` et du mock `joinOpenMatch` ; le user du token est `u1`), ajouter :

```typescript
  it('POST /join relaie la place ciblée { team, slot } au service', async () => {
    const res = await request(app)
      .post(`${base}/join`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ team: 2, slot: 1 });
    expect(res.status).toBe(200);
    expect(joinOpenMatch).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'u1', { team: 2, slot: 1 });
  });

  it('POST /join sans body → cible undefined (comportement historique)', async () => {
    const res = await request(app)
      .post(`${base}/join`)
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(joinOpenMatch).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'u1', undefined);
  });

  it('TEAM_SLOT_TAKEN → 400', async () => {
    joinOpenMatch.mockRejectedValue(new Error('TEAM_SLOT_TAKEN'));
    const res = await request(app)
      .post(`${base}/join`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ team: 1, slot: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TEAM_SLOT_TAKEN');
  });
```

(Adapter `expect.any(String)` en `SLUG`/`MATCH_ID` si ces constantes sont visibles dans ce describe — regarder les tests voisins et faire pareil.)

- [ ] **Step 2: Vérifier qu'ils échouent**

Run (depuis `backend/`): `npx jest src/routes/__tests__/clubs.openmatch-chat.routes.test.ts`
Expected: les 2 premiers nouveaux tests FAIL (le service est appelé avec 3 arguments, pas 4). Le test 400 passe peut-être déjà (mapping existant) — c'est OK.

- [ ] **Step 3: Implémenter**

Dans `backend/src/routes/clubs.ts`, remplacer la route join par :

```typescript
router.post('/:slug/open-matches/:id/join', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Body additif { team?, slot? } : place ciblée (tap sur une place libre). Sans team → join historique.
    const body = (req.body ?? {}) as { team?: unknown; slot?: unknown };
    const target = body.team !== undefined && body.team !== null
      ? { team: Number(body.team), slot: body.slot === undefined || body.slot === null ? undefined : Number(body.slot) }
      : undefined;
    res.json(await openMatchService.joinOpenMatch(asString(req.params.slug), asString(req.params.id), req.user!.id, target));
  }
  catch (err) { handleError(err, res, next); }
});
```

`TEAM_INVALID`/`TEAM_SIDE_FULL`/`TEAM_SLOT_TAKEN` sont déjà mappés 400 dans la table d'erreurs du fichier (lignes ~68-70) — rien d'autre à faire. Un `team` non numérique devient `NaN` → `TEAM_INVALID` par le service.

- [ ] **Step 4: Vérifier que la suite passe + tsc**

Run (depuis `backend/`): `npx jest src/routes/__tests__/clubs.openmatch-chat.routes.test.ts; npx tsc --noEmit`
Expected: PASS, 0 erreur TS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts
git commit -m "feat(open-match): body { team?, slot? } sur POST /open-matches/:id/join"
```

---

### Task 4: Frontend — `api.joinOpenMatch` + type `JoinTarget`

**Files:**
- Modify: `frontend/lib/api.ts` (méthode `joinOpenMatch` ~ligne 265, type près des types OpenMatch)

- [ ] **Step 1: Ajouter le type et la signature**

Près des types des parties ouvertes (chercher `OpenMatchPlayer` ou `export interface OpenMatch`), ajouter :

```typescript
/** Place ciblée au moment de rejoindre une partie ouverte (tap sur une place libre). */
export type JoinTarget = { team: 1 | 2; slot: number };
```

Et remplacer la méthode :

```typescript
  joinOpenMatch: (slug: string, id: string, token: string, target?: JoinTarget) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/join`, { method: 'POST', ...(target ? { body: JSON.stringify(target) } : {}) }, token),
```

(Le helper `request` pose déjà `Content-Type: application/json`.)

- [ ] **Step 2: Type-check**

Run (depuis `frontend/`): `npx tsc --noEmit`
Expected: 0 erreur (l'appel existant à 3 arguments reste valide).

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): joinOpenMatch accepte une place cible JoinTarget"
```

---

### Task 5: Frontend — `MatchTeams` : prop `onJoinFree` (cellule libre → « Rejoindre »)

**Files:**
- Modify: `frontend/components/match/MatchTeams.tsx`
- Test: `frontend/__tests__/MatchTeams.test.tsx`

- [ ] **Step 1: Écrire les tests qui échouent**

Le fixture du fichier (`players`) a a+b en équipe 1 et c en équipe 2 → une seule place libre : équipe 2, place D (slot 1). Ajouter au describe :

```tsx
  it('onJoinFree : la place libre devient un bouton « Rejoindre » qui émet (équipe, place)', () => {
    const onJoinFree = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} onJoinFree={onJoinFree} />);
    const cells = screen.getAllByRole('button', { name: /Rejoindre l'équipe/ });
    expect(cells).toHaveLength(1); // a+b (éq.1) + c (éq.2) → une seule place libre (éq.2, D)
    expect(screen.queryByText('Place libre')).not.toBeInTheDocument();
    fireEvent.click(cells[0]);
    expect(onJoinFree).toHaveBeenCalledWith(2, 1);
  });

  it("priorité organisateur : editable + onAddToTeam gagne sur onJoinFree", () => {
    const onAdd = jest.fn(), onJoinFree = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} editable onAddToTeam={onAdd} onJoinFree={onJoinFree} />);
    expect(screen.queryByRole('button', { name: /Rejoindre l'équipe/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Ajouter un joueur à l'équipe 2" }));
    expect(onAdd).toHaveBeenCalledWith(2, 1);
    expect(onJoinFree).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run (depuis `frontend/`): `npx jest __tests__/MatchTeams.test.tsx`
Expected: les 2 nouveaux FAIL (prop inconnue → cellules inertes), le reste PASS.

- [ ] **Step 3: Implémenter**

Dans `MatchTeams.tsx` :

1. Ajouter la prop à la destructuration (`players, capacity, friendIds, size = 'md', busy = false, onRemove, canRemove, onReplace, canReplace, onAddToTeam, editable = false, onSetTeams, onJoinFree, activeTarget`) et au type :

```typescript
  /** Tap sur une place libre : côté + emplacement visé (0=G, 1=D). */
  onAddToTeam?: (team: 1 | 2, slot?: number) => void;
  /** Tap sur une place libre pour SE rajouter (viewer non-participant) — indépendant d'`editable`. */
  onJoinFree?: (team: 1 | 2, slot: number) => void;
```

2. Dans `renderFree`, insérer une branche APRÈS le bloc `if (editable && onAddToTeam) { … }` et AVANT le `return` de la cellule inerte :

```tsx
    if (onJoinFree) {
      return (
        <button type="button" disabled={busy}
          aria-label={`Rejoindre l'équipe ${side}`}
          onClick={() => onJoinFree(side, slotIdx)}
          style={{ ...base, cursor: busy ? 'default' : 'pointer' }}>
          {badge}
          <span aria-hidden="true" style={{ width: av, height: av, borderRadius: '50%', border: `1.5px dashed ${teamColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: teamColor, fontSize: 17, lineHeight: 1 }}>+</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: teamColor }}>Rejoindre</span>
        </button>
      );
    }
```

3. Compléter le commentaire d'en-tête du composant (bloc « En `editable`… ») avec une phrase : `// Hors editable, si onJoinFree est fourni (viewer non-participant), chaque place libre est un bouton « Rejoindre » ciblé → onJoinFree(team, slot).`

- [ ] **Step 4: Vérifier que la suite passe**

Run (depuis `frontend/`): `npx jest __tests__/MatchTeams.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/match/MatchTeams.tsx frontend/__tests__/MatchTeams.test.tsx
git commit -m "feat(match-teams): prop onJoinFree — place libre cliquable « Rejoindre » (team, slot)"
```

---

### Task 6: Frontend — `OpenMatchCard` : cellules « Rejoindre », bouton de barre supprimé

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx`
- Test: `frontend/__tests__/OpenMatchCard.test.tsx`

- [ ] **Step 1: Adapter/écrire les tests**

Le fixture `makeMatch()` a un seul joueur (org, équipe 1 → place G dérivée) → cellules libres rendues dans l'ordre : (éq.1, D), (éq.2, G), (éq.2, D).

1. **Modifier** le test anonyme existant (`'anonyme : « Rejoindre » appelle onAuthPrompt…'`) : remplacer la ligne `fireEvent.click(screen.getByRole('button', { name: /Rejoindre/ }));` par :

```tsx
    fireEvent.click(screen.getAllByRole('button', { name: /Rejoindre l'équipe/ })[0]);
```

2. **Ajouter** :

```tsx
  it('non-participant : tap sur une place libre rejoint à cette place précise', () => {
    const match = makeMatch();
    const onJoin = jest.fn();
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match, { onJoin })} />
      </ThemeProvider>
    );
    // org occupe (éq.1, G) → la 1re cellule libre rendue est (éq.1, D).
    fireEvent.click(screen.getAllByRole('button', { name: /Rejoindre l'équipe/ })[0]);
    expect(onJoin).toHaveBeenCalledWith(match, { team: 1, slot: 1 });
  });

  it("le bouton « Rejoindre » de la barre d'actions n'existe plus", () => {
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(makeMatch())} />
      </ThemeProvider>
    );
    // Nom exact : ne matche pas les cellules « Rejoindre l'équipe N ».
    expect(screen.queryByRole('button', { name: 'Rejoindre' })).not.toBeInTheDocument();
  });

  it('partie passée ou complète : aucune cellule « Rejoindre »', () => {
    const past = new Date(Date.now() - 3600e3).toISOString();
    const { unmount } = render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(makeMatch({ startTime: past, endTime: past }))} />
      </ThemeProvider>
    );
    expect(screen.queryByRole('button', { name: /Rejoindre/ })).not.toBeInTheDocument();
    unmount();
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(makeMatch({ full: true, spotsLeft: 0 }))} />
      </ThemeProvider>
    );
    expect(screen.queryByRole('button', { name: /Rejoindre/ })).not.toBeInTheDocument();
  });

  it('participant : cellules libres inertes + bouton « Quitter »', () => {
    const match = makeMatch({ viewerIsParticipant: true });
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match)} />
      </ThemeProvider>
    );
    expect(screen.queryByRole('button', { name: /Rejoindre/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quitter/ })).toBeInTheDocument();
    expect(screen.getAllByText('Place libre').length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run (depuis `frontend/`): `npx jest __tests__/OpenMatchCard.test.tsx`
Expected: les nouveaux/modifiés FAIL (pas de cellules cliquables ; le bouton barre existe encore).

- [ ] **Step 3: Implémenter**

Dans `OpenMatchCard.tsx` :

1. Import : `import { OpenMatch, JoinTarget } from '@/lib/api';`
2. Type de prop : `onJoin: (m: OpenMatch, target?: JoinTarget) => void;`
3. Dans le corps du composant, avant le `return`, ajouter :

```tsx
  // Le mini-terrain est LE geste pour rejoindre : cellules libres cliquables pour un viewer
  // non-inscrit, sur une partie à venir et non complète (l'anonyme est renvoyé vers l'invite).
  const joinable = !m.viewerIsOrganizer && !m.viewerIsParticipant && !m.full
    && new Date(m.startTime).getTime() > Date.now();
```

4. Sur `<MatchTeams …>`, ajouter la prop :

```tsx
        onJoinFree={joinable ? ((team, slot) => (isAnonymous ? onAuthPrompt(m) : onJoin(m, { team, slot }))) : undefined}
```

5. Dans la barre d'actions, remplacer le bloc :

```tsx
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }}>
          {m.viewerIsOrganizer ? (
            <Chip tone="line" icon="check">Vous organisez</Chip>
          ) : m.viewerIsParticipant ? (
            <Btn variant="surface" style={actionBtn} disabled={busy} onClick={() => onLeave(m)}>Quitter</Btn>
          ) : (
            <Btn icon="plus" style={actionBtn} disabled={busy || m.full} onClick={() => (isAnonymous ? onAuthPrompt(m) : onJoin(m))}>Rejoindre</Btn>
          )}
        </span>
```

par :

```tsx
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }}>
          {m.viewerIsOrganizer ? (
            <Chip tone="line" icon="check">Vous organisez</Chip>
          ) : m.viewerIsParticipant ? (
            <Btn variant="surface" style={actionBtn} disabled={busy} onClick={() => onLeave(m)}>Quitter</Btn>
          ) : null}
        </span>
```

6. Mettre à jour le commentaire de la prop `isAnonymous` : `/** Visiteur non connecté : taper une place libre invite à s'inscrire ; actions membres masquées. */`

- [ ] **Step 4: Vérifier que la suite passe**

Run (depuis `frontend/`): `npx jest __tests__/OpenMatchCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/__tests__/OpenMatchCard.test.tsx
git commit -m "feat(open-match): rejoindre en tapant une place libre — bouton « Rejoindre » retiré de la carte"
```

---

### Task 7: Frontend — hook + modales : la cible traverse la garde de niveau

**Files:**
- Modify: `frontend/components/openmatch/useOpenMatchActions.ts`
- Modify: `frontend/components/openmatch/OpenMatchModals.tsx`
- Test: `frontend/__tests__/OpenMatches.test.tsx`

- [ ] **Step 1: Adapter/écrire les tests**

Le fixture `match()` d'`OpenMatches.test.tsx` a un seul joueur org sans `team` → carte le place en (éq.1, G) ; 1re cellule libre = (éq.1, D) → cible `{ team: 1, slot: 1 }`.

1. **Modifier** le test `'liste les parties et permet de rejoindre'` : remplacer les 2 dernières lignes par :

```tsx
    fireEvent.click(screen.getAllByRole('button', { name: /Rejoindre l'équipe/ })[0]);
    await waitFor(() => expect(mocked.joinOpenMatch).toHaveBeenCalledWith('demo', 'm1', 'abc', { team: 1, slot: 1 }));
```

2. **Remplacer** le test `'désactive « Rejoindre » quand la partie est complète'` par :

```tsx
  it('partie complète : chip « Complet », aucune cellule ni bouton « Rejoindre »', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ full: true, spotsLeft: 0 })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    expect(await screen.findByText('Complet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rejoindre/ })).not.toBeInTheDocument();
  });
```

3. **Modifier** le test anonyme (`'anonyme : affiche la liste…'`) : remplacer `fireEvent.click(screen.getByRole('button', { name: /Rejoindre/ }));` par :

```tsx
    fireEvent.click(screen.getAllByRole('button', { name: /Rejoindre l'équipe/ })[0]);
```

4. **Ajouter** le test de la garde de niveau :

```tsx
  it('niveau hors fourchette : avertissement, puis « Rejoindre quand même » rejoint à la place tapée', async () => {
    mocked.getMyRating.mockResolvedValue({ level: 3 } as never);
    mocked.getOpenMatches.mockResolvedValue([match({ targetLevelMin: 6, targetLevelMax: 8 })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    fireEvent.click((await screen.findAllByRole('button', { name: /Rejoindre l'équipe/ }))[0]);
    expect(await screen.findByText('Niveau hors fourchette')).toBeInTheDocument();
    expect(mocked.joinOpenMatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Rejoindre quand même/ }));
    await waitFor(() => expect(mocked.joinOpenMatch).toHaveBeenCalledWith('demo', 'm1', 'abc', { team: 1, slot: 1 }));
  });
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run (depuis `frontend/`): `npx jest __tests__/OpenMatches.test.tsx`
Expected: FAIL — les cellules n'appellent pas encore `onJoin` avec cible transportée par le hook… en réalité les Tasks 5-6 rendent déjà les cellules actives : ici échoue surtout l'assertion à 4 arguments (`join` n'envoie pas de cible) et le test de garde de niveau (cible perdue). Les autres suites du fichier doivent rester vertes.

- [ ] **Step 3: Implémenter le hook**

Dans `useOpenMatchActions.ts` :

1. Import : `import { api, ClubDetail, OpenMatch, JoinTarget } from '@/lib/api';`
2. Compléter `JOIN_ERRORS` (après `TEAM_SLOT_TAKEN`) :

```typescript
  TEAM_SIDE_FULL:        'Cette équipe est complète.',
  TEAM_INVALID:          'Place invalide.',
```

3. L'état d'avertissement transporte la cible :

```typescript
  const [joinWarning, setJoinWarning] = useState<{ match: OpenMatch; target?: JoinTarget } | null>(null);
```

4. `act` recharge la grille quand la place a été prise entre-temps (l'écran doit refléter l'occupation réelle) :

```typescript
  const act = async (m: OpenMatch, fn: () => Promise<unknown>) => {
    if (!token) return;
    setBusyId(m.id); setError('');
    try { await fn(); await reload(); }
    catch (e) {
      const code = (e as Error).message;
      setError(JOIN_ERRORS[code] ?? code);
      if (code === 'TEAM_SLOT_TAKEN') await reload().catch(() => {});
    }
    finally { setBusyId(null); }
  };
```

5. `join`/`confirmJoin` :

```typescript
  const join = (m: OpenMatch, target?: JoinTarget) => {
    if (!inRange(myLevel, m.targetLevelMin ?? null, m.targetLevelMax ?? null)) setJoinWarning({ match: m, target });
    else act(m, () => api.joinOpenMatch(club.slug, m.id, token!, target));
  };
  const confirmJoin = (w: { match: OpenMatch; target?: JoinTarget }) => {
    setJoinWarning(null);
    act(w.match, () => api.joinOpenMatch(club.slug, w.match.id, token!, w.target));
  };
```

- [ ] **Step 4: Implémenter la modale**

Dans `OpenMatchModals.tsx`, adapter le bloc `joinWarning` :

```tsx
      {a.joinWarning && (
        <ConfirmDialog
          title="Niveau hors fourchette"
          message="Cette partie est hors de ta fourchette de niveau. Rejoindre quand même ?"
          confirmLabel="Rejoindre quand même"
          cancelLabel="Annuler"
          busy={a.busyId === a.joinWarning.match.id}
          onConfirm={() => a.confirmJoin(a.joinWarning!)}
          onCancel={() => a.setJoinWarning(null)}
        />
      )}
```

- [ ] **Step 5: Vérifier qu'il n'y a pas d'autre consommateur**

Run: `rg -n "joinWarning|confirmJoin" frontend --glob '!**/node_modules/**'`
Expected: uniquement `useOpenMatchActions.ts`, `OpenMatchModals.tsx` (et d'éventuels tests déjà adaptés). Tout autre site → l'adapter à la forme `{ match, target? }`.

- [ ] **Step 6: Vérifier que les suites passent + tsc**

Run (depuis `frontend/`): `npx jest __tests__/OpenMatches.test.tsx __tests__/OpenMatchDetail.test.tsx; npx tsc --noEmit`
Expected: PASS, 0 erreur TS.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/openmatch/useOpenMatchActions.ts frontend/components/openmatch/OpenMatchModals.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "feat(open-match): la place tapée traverse la garde de niveau ; reload si place prise"
```

---

### Task 8: Vérification finale

**Files:** aucun nouveau — gates de sortie.

- [ ] **Step 1: Suites backend complètes**

Run (depuis `backend/`): `npx jest`
Expected: PASS (baseline connue : 3 échecs `icon.routes` possibles en worktree — ignorer uniquement ceux-là s'ils préexistent).

- [ ] **Step 2: Suites frontend ciblées**

Run (depuis `frontend/`):
`npx jest __tests__/MatchTeams.test.tsx __tests__/OpenMatchCard.test.tsx __tests__/OpenMatches.test.tsx __tests__/OpenMatchDetail.test.tsx`
Expected: PASS. (Ne pas se fier au full-run `npx jest` : flake BookingModal connu hors périmètre.)

- [ ] **Step 3: Type-check des deux côtés**

Run: `npx tsc --noEmit` dans `backend/` puis `frontend/`.
Expected: 0 erreur.

- [ ] **Step 4: Chasse aux usages morts**

Run: `rg -n "onJoin\b|Rejoindre" frontend/components/openmatch frontend/components/match`
Expected: plus aucun `<Btn …>Rejoindre</Btn>` dans la carte ; `onJoin` uniquement avec la nouvelle signature.

- [ ] **Step 5: Vérifier l'état git**

Run: `git status --porcelain; git log --oneline -6`
Expected: seuls `frontend/components/ClubNav.tsx` (WIP préexistant, intouché) reste modifié ; les commits des Tasks 1-7 sont présents.
