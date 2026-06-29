# Parties ouvertes visibles & rejoignables par les non-membres — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la liste des parties ouvertes visible de tout le monde (anonyme inclus) et permettre à un non-membre de la rejoindre (adhésion créée à la volée ; anonyme invité à créer un compte / se connecter).

**Architecture:** Lecture publique via un nouveau middleware `optionalAuth` sur `GET /:slug/open-matches` + `listOpenMatches(slug, viewerUserId|null)` qui résout le club ACTIVE sans exiger l'adhésion. Rejoindre/intérêt garantissent l'adhésion (`ensureActiveMembership`, miroir de l'auto-adhésion à la réservation). Frontend : `/parties` devient public, la carte adapte le bouton « Rejoindre » (anonyme → dialog d'auth), un `?next=` ramène l'anonyme sur `/parties` après authentification. **Aucune migration.**

**Tech Stack:** Express 5 + Prisma 7 (backend), Next.js 16 + React 19 (frontend), Jest + Testing Library.

**Référence spec :** `docs/superpowers/specs/2026-06-29-parties-ouvertes-visibles-non-membres-design.md`

> ⚠️ **OneDrive / Prisma** : si les tests backend échouent sur un client Prisma amputé, faire `npm install` + `npx prisma generate` dans `backend/` (cf. CLAUDE.md). Couper OneDrive pendant le dev.

---

## Task 1: Service — lecture publique + adhésion garantie

**Files:**
- Modify: `backend/src/services/openMatch.service.ts`
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1: Écrire/мettre à jour les tests qui échouent**

Dans `openMatch.service.test.ts`, **remplacer** le test existant (≈ lignes 76-79) :

```typescript
    it('lève MEMBERSHIP_REQUIRED si le viewer n est pas membre actif', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
      await expect(service.listOpenMatches('club-demo', 'viewer')).rejects.toThrow('MEMBERSHIP_REQUIRED');
    });
```

par :

```typescript
    it('ne requiert PAS d adhésion : un non-membre ou un anonyme voit la liste', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any); // non-membre
      prismaMock.reservation.findMany.mockResolvedValue([] as any);
      await expect(service.listOpenMatches('club-demo', 'viewer')).resolves.toEqual([]);
      await expect(service.listOpenMatches('club-demo', null)).resolves.toEqual([]);
    });

    it('viewer anonyme (null) : tous les flags viewer sont false', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        {
          id: 'm1', startTime: future(48), endTime: future(49),
          resource: { id: 'court-1', name: 'Court 1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
          participants: [{ userId: 'org', isOrganizer: true, user: { firstName: 'O', lastName: 'A', avatarUrl: null } }],
          openMatchInterests: [{ userId: 'org', user: { firstName: 'O', lastName: 'A', avatarUrl: null } }],
          openMatchMessages: [],
        },
      ] as any);

      const out = await service.listOpenMatches('club-demo', null);

      expect(out[0].viewerIsParticipant).toBe(false);
      expect(out[0].viewerIsOrganizer).toBe(false);
      expect(out[0].viewerIsInterested).toBe(false);
      expect(out[0].interestedCount).toBe(1);
    });
```

Dans le `describe('joinOpenMatch')`, ajouter (après le test `lève CLUB_MISMATCH`) :

```typescript
    it('un non-membre qui rejoint voit son adhésion ACTIVE créée à la volée', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any); // non-membre
      prismaMock.clubMembership.create.mockResolvedValue({} as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'org', isOrganizer: true }] as any);
      prismaMock.reservationParticipant.create.mockResolvedValue({ id: 'p2' } as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.joinOpenMatch('club-demo', 'm1', 'user-new');

      expect(prismaMock.clubMembership.create).toHaveBeenCalledWith({ data: { userId: 'user-new', clubId: 'club-demo' } });
      expect(prismaMock.reservationParticipant.create).toHaveBeenCalled();
    });

    it('un membre BLOCKED ne peut pas rejoindre (MEMBERSHIP_BLOCKED)', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED' } as any);
      await expect(service.joinOpenMatch('club-demo', 'm1', 'user-3')).rejects.toThrow('MEMBERSHIP_BLOCKED');
      expect(prismaMock.reservationParticipant.create).not.toHaveBeenCalled();
    });
```

Dans le `describe('OpenMatchService — intérêt')`, ajouter :

```typescript
    it('setInterested crée l adhésion d un non-membre à la volée', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
      prismaMock.clubMembership.create.mockResolvedValue({} as any);
      prismaMock.reservation.findUnique.mockResolvedValue({
        visibility: 'PUBLIC', status: 'CONFIRMED', startTime: future(),
        resource: { clubId: 'club-demo' }, participants: [],
      } as any);
      prismaMock.openMatchInterest.upsert.mockResolvedValue({} as any);

      await service.setInterested('club-demo', 'm1', 'user-new');

      expect(prismaMock.clubMembership.create).toHaveBeenCalledWith({ data: { userId: 'user-new', clubId: 'club-demo' } });
      expect(prismaMock.openMatchInterest.upsert).toHaveBeenCalled();
    });
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

Run: `cd backend && npx jest openMatch.service -t "non-membre"`
Expected: FAIL (listOpenMatches lève encore MEMBERSHIP_REQUIRED ; join/setInterested ne créent pas d'adhésion car `resolveActiveMember` lève sur `null`).

- [ ] **Step 3: Implémenter les helpers + brancher**

Dans `openMatch.service.ts`, **ajouter** ces deux méthodes juste après `resolveActiveMember` (ne pas supprimer `resolveActiveMember` : encore utilisé par remove/add/leave/removeInterested) :

```typescript
  /** Résout un club ACTIVE par slug, SANS exiger d'adhésion (lecture publique des parties). */
  private async resolveActiveClub(slug: string): Promise<{ id: string }> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return { id: club.id };
  }

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

Modifier la signature et le corps de `listOpenMatches` :

```typescript
  /** Parties ouvertes à venir d'un club, visibles de tous (membre, non-membre ou anonyme). */
  async listOpenMatches(slug: string, viewerUserId: string | null) {
    const club = await this.resolveActiveClub(slug);
```

Et, dans le `return matches.map((m) => { ... })`, remplacer les trois flags viewer :

```typescript
        viewerIsParticipant: viewerUserId != null && m.participants.some((p) => p.userId === viewerUserId),
        viewerIsOrganizer: viewerUserId != null && m.participants.some((p) => p.userId === viewerUserId && p.isOrganizer),
```

et (plus bas, dans le même objet) :

```typescript
        viewerIsInterested: viewerUserId != null && m.openMatchInterests.some((i) => i.userId === viewerUserId),
```

Dans `joinOpenMatch`, remplacer la 1re ligne :

```typescript
    const club = await this.ensureActiveMembership(slug, userId);
```

Dans `setInterested`, remplacer la 1re ligne :

```typescript
    const club = await this.ensureActiveMembership(slug, userId);
```

- [ ] **Step 4: Lancer toute la suite du service**

Run: `cd backend && npx jest openMatch.service`
Expected: PASS (tous les tests, dont les nouveaux et les anciens happy-paths inchangés).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(parties): lecture publique des parties + adhesion garantie au join/interet"
```

---

## Task 2: Middleware `optionalAuth` + route GET publique

**Files:**
- Modify: `backend/src/middleware/auth.ts`
- Modify: `backend/src/routes/clubs.ts:206-209`
- Test: `backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts`

- [ ] **Step 1: Écrire les tests de route qui échouent**

Dans `clubs.openmatch-chat.routes.test.ts`, modifier la factory de mock (≈ lignes 7-21) pour **hoister** `listOpenMatches` et `joinOpenMatch` afin de les capturer :

```typescript
jest.mock('../../services/openMatch.service', () => {
  const listOpenMatches  = jest.fn().mockResolvedValue([]);
  const joinOpenMatch    = jest.fn().mockResolvedValue({});
  const setInterested    = jest.fn().mockResolvedValue({ id: 'match-1' });
  const removeInterested = jest.fn().mockResolvedValue({ id: 'match-1' });
  return {
    OpenMatchService: jest.fn().mockImplementation(() => ({
      listOpenMatches,
      joinOpenMatch,
      leaveOpenMatch:      jest.fn().mockResolvedValue({}),
      removeOpenMatchPlayer: jest.fn().mockResolvedValue({}),
      addOpenMatchPlayer:  jest.fn().mockResolvedValue({}),
      setInterested,
      removeInterested,
    })),
  };
});
```

Sous les captures existantes (≈ lignes 48-50), ajouter :

```typescript
const listOpenMatches = omInst.listOpenMatches as jest.Mock;
const joinOpenMatch    = omInst.joinOpenMatch    as jest.Mock;
```

Dans le `beforeEach` (après les autres `mockResolvedValue`), ajouter :

```typescript
  listOpenMatches.mockResolvedValue([]);
  joinOpenMatch.mockResolvedValue({});
```

Puis ajouter un nouveau bloc de tests (avant la dernière `});` de fermeture du `describe` racine) :

```typescript
  describe('lecture publique de la liste', () => {
    const list = `/api/clubs/${SLUG}/open-matches`;

    it('GET sans Authorization → 200 + liste, viewer null (anonyme)', async () => {
      listOpenMatches.mockResolvedValue([{ id: 'm1' }]);
      const res = await request(app).get(list);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: 'm1' }]);
      expect(listOpenMatches).toHaveBeenCalledWith(SLUG, null);
    });

    it('GET avec Authorization → 200 + userId transmis', async () => {
      const res = await request(app).get(list).set('Authorization', `Bearer ${token()}`);
      expect(res.status).toBe(200);
      expect(listOpenMatches).toHaveBeenCalledWith(SLUG, 'u1');
    });

    it('POST /join sans Authorization reste protégé → 401', async () => {
      const res = await request(app).post(`${list}/${MATCH_ID}/join`);
      expect(res.status).toBe(401);
      expect(joinOpenMatch).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

Run: `cd backend && npx jest clubs.openmatch-chat.routes -t "lecture publique"`
Expected: FAIL — le GET sans Authorization renvoie 401 (route encore en `authMiddleware`).

- [ ] **Step 3: Ajouter `optionalAuth`**

Dans `backend/src/middleware/auth.ts`, ajouter sous `authMiddleware` :

```typescript
/**
 * Authentification facultative : pose req.user si un Bearer valide est présent,
 * sinon laisse passer en anonyme (jamais de 401). Pour les lectures publiques.
 */
export function optionalAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as { id: string; email: string };
      req.user = { id: payload.id, email: payload.email };
    } catch { /* token invalide → on continue en anonyme */ }
  }
  next();
}
```

- [ ] **Step 4: Brancher la route GET**

Dans `backend/src/routes/clubs.ts`, ajouter `optionalAuth` à l'import du middleware d'auth (la ligne qui importe déjà `authMiddleware` depuis `'../middleware/auth'`), puis remplacer la route `GET /:slug/open-matches` (≈ lignes 206-209) par :

```typescript
// Parties ouvertes du club : lecture PUBLIQUE (membre, non-membre ou anonyme).
router.get('/:slug/open-matches', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.listOpenMatches(asString(req.params.slug), req.user?.id ?? null)); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 5: Lancer les tests de route**

Run: `cd backend && npx jest clubs.openmatch-chat.routes`
Expected: PASS (anciens + nouveaux).

- [ ] **Step 6: Commit**

```bash
git add backend/src/middleware/auth.ts backend/src/routes/clubs.ts backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts
git commit -m "feat(parties): optionalAuth + route GET open-matches publique"
```

---

## Task 3: Frontend — `/parties` public + `getOpenMatches` sans token

**Files:**
- Modify: `frontend/lib/authGate.ts:3-6`
- Modify: `frontend/lib/api.ts:251-252`
- Test: `frontend/__tests__/authGate.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Dans `frontend/__tests__/authGate.test.ts`, dans le `describe('isPublicPath')`, ajouter dans le `it` qui liste les chemins publics (ou en ajouter un nouveau) :

```typescript
  it('rend /parties public (parties ouvertes visibles sans login)', () => {
    expect(isPublicPath('/parties')).toBe(true);
  });
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `cd frontend && npx jest authGate -t "/parties public"`
Expected: FAIL (`isPublicPath('/parties')` vaut `false`).

- [ ] **Step 3: Ajouter `/parties` aux chemins publics**

Dans `frontend/lib/authGate.ts`, ajouter `'/parties'` à `PUBLIC_PATHS` :

```typescript
export const PUBLIC_PATHS = [
  '/login', '/register', '/clubs/new', '/forgot-password',
  '/parties',
  '/faq', '/cgv', '/mentions-legales', '/confidentialite', '/offres', '/tarifs',
];
```

- [ ] **Step 4: Rendre le token facultatif dans `getOpenMatches`**

Dans `frontend/lib/api.ts`, remplacer (≈ lignes 250-252) :

```typescript
  // --- Parties ouvertes (visibles de tous ; token facultatif) ---
  getOpenMatches: (slug: string, token?: string) =>
    request<OpenMatch[]>(`/api/clubs/${slug}/open-matches`, {}, token),
```

- [ ] **Step 5: Lancer le test + tsc**

Run: `cd frontend && npx jest authGate && npx tsc --noEmit`
Expected: PASS + aucune erreur de type.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/authGate.ts frontend/lib/api.ts frontend/__tests__/authGate.test.ts
git commit -m "feat(parties): /parties public + getOpenMatches sans token"
```

---

## Task 4: Composant `AuthPromptDialog`

**Files:**
- Create: `frontend/components/openmatch/AuthPromptDialog.tsx`
- Test: `frontend/__tests__/AuthPromptDialog.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/AuthPromptDialog.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthPromptDialog } from '../components/openmatch/AuthPromptDialog';
import { ThemeProvider } from '../lib/ThemeProvider';

describe('AuthPromptDialog', () => {
  const setup = () => {
    const onRegister = jest.fn(), onLogin = jest.fn(), onClose = jest.fn();
    render(
      <ThemeProvider>
        <AuthPromptDialog detail="Terrain 1" onRegister={onRegister} onLogin={onLogin} onClose={onClose} />
      </ThemeProvider>
    );
    return { onRegister, onLogin, onClose };
  };

  it('propose de créer un compte ou de se connecter', () => {
    setup();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Terrain 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Créer un compte/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /déjà un compte/i })).toBeInTheDocument();
  });

  it('déclenche onRegister puis onLogin au clic', () => {
    const { onRegister, onLogin } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Créer un compte/i }));
    expect(onRegister).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /déjà un compte/i }));
    expect(onLogin).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `cd frontend && npx jest AuthPromptDialog`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Créer le composant**

Créer `frontend/components/openmatch/AuthPromptDialog.tsx` :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';

interface AuthPromptDialogProps {
  /** Ligne de contexte (ex. « Terrain 1 »). */
  detail?: string;
  onRegister: () => void;
  onLogin: () => void;
  onClose: () => void;
}

/**
 * Invite un visiteur anonyme à s'inscrire / se connecter pour rejoindre une partie.
 * Top-sheet calqué sur ConfirmDialog (même langage visuel que les modales).
 */
export function AuthPromptDialog({ detail, onRegister, onLogin, onClose }: AuthPromptDialogProps) {
  const { th } = useTheme();
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
      <div role="dialog" aria-modal="true" style={{ position: 'relative', width: '100%', maxWidth: 480, margin: '0 auto', background: th.bgElev, borderRadius: '0 0 28px 28px', padding: '12px 20px 36px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)' }}>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, letterSpacing: -0.3 }}>Rejoindre la partie</div>
        {detail && (
          <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text, marginTop: 14, background: th.surface2, borderRadius: 14, padding: '13px 16px' }}>{detail}</div>
        )}
        <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 14, lineHeight: 1.45 }}>
          Créez un compte (ou connectez-vous) pour vous ajouter à cette partie.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 24 }}>
          <Btn icon="arrowR" onClick={onRegister}>Créer un compte</Btn>
          <Btn variant="surface" onClick={onLogin}>J&apos;ai déjà un compte</Btn>
        </div>
        <div style={{ width: 38, height: 5, borderRadius: 3, background: th.lineStrong, margin: '18px auto 0' }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Lancer le test**

Run: `cd frontend && npx jest AuthPromptDialog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/AuthPromptDialog.tsx frontend/__tests__/AuthPromptDialog.test.tsx
git commit -m "feat(parties): dialog d auth pour rejoindre une partie en anonyme"
```

---

## Task 5: `OpenMatchCard` — mode anonyme

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx`
- Test: `frontend/__tests__/OpenMatchCard.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Dans `frontend/__tests__/OpenMatchCard.test.tsx`, ajouter `onAuthPrompt` aux props par défaut de `makeProps` (dans l'objet retourné, à côté de `onOpenChat`) :

```tsx
    onAuthPrompt: jest.fn(),
```

Puis ajouter ce test dans le `describe('OpenMatchCard')` :

```tsx
  it('anonyme : « Rejoindre » appelle onAuthPrompt (pas onJoin) et masque Discuter / Ça m\'intéresse', () => {
    const match = makeMatch();
    const onAuthPrompt = jest.fn(), onJoin = jest.fn();
    render(
      <ThemeProvider>
        <OpenMatchCard {...makeProps(match, { isAnonymous: true, onAuthPrompt, onJoin })} />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /Rejoindre/ }));
    expect(onAuthPrompt).toHaveBeenCalledWith(match);
    expect(onJoin).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Discuter/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ça m'intéresse/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `cd frontend && npx jest OpenMatchCard -t "anonyme"`
Expected: FAIL (props `isAnonymous`/`onAuthPrompt` inexistantes ; Discuter/intérêt encore rendus).

- [ ] **Step 3: Implémenter le mode anonyme**

Dans `OpenMatchCard.tsx`, ajouter à l'interface `OpenMatchCardProps` (après `hasUnread: boolean;`) :

```tsx
  /** Visiteur non connecté : « Rejoindre » invite à s'inscrire ; actions membres masquées. */
  isAnonymous?: boolean;
  onAuthPrompt: (m: OpenMatch) => void;
```

Dans la déstructuration des props de la fonction, ajouter `isAnonymous = false, onAuthPrompt,` (par ex. à la fin, après `onToggleInterest, onOpenChat, hasUnread,`).

Remplacer le bouton « Rejoindre » :

```tsx
            <Btn icon="plus" disabled={busy || m.full} onClick={() => (isAnonymous ? onAuthPrompt(m) : onJoin(m))}>Rejoindre</Btn>
```

Envelopper le bouton « Discuter » dans une garde `!isAnonymous` :

```tsx
          {!isAnonymous && (
            <Btn variant="surface" disabled={!(m.viewerIsParticipant || m.viewerIsInterested)} onClick={() => onOpenChat(m)}>
              Discuter{hasUnread ? ' •' : ''}
            </Btn>
          )}
```

Modifier la garde du bouton « Ça m'intéresse » :

```tsx
          {!isAnonymous && !m.viewerIsParticipant && (
            <Btn variant={m.viewerIsInterested ? 'primary' : 'surface'} disabled={busy} onClick={() => onToggleInterest(m)}>
              {m.viewerIsInterested ? 'Intéressé ✓' : "Ça m'intéresse"}
            </Btn>
          )}
```

- [ ] **Step 4: Lancer la suite de la carte**

Run: `cd frontend && npx jest OpenMatchCard`
Expected: PASS (anciens + nouveau).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/__tests__/OpenMatchCard.test.tsx
git commit -m "feat(parties): OpenMatchCard mode anonyme (Rejoindre -> prompt auth)"
```

---

## Task 6: `OpenMatches` — liste publique + wiring du prompt

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx`
- Test: `frontend/__tests__/OpenMatches.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Dans `frontend/__tests__/OpenMatches.test.tsx`, ajouter ce test dans le `describe('OpenMatches')` :

```tsx
  it('anonyme : affiche la liste, charge sans token, et « Rejoindre » ouvre le prompt d\'auth', async () => {
    document.cookie = 'token=; max-age=0; path=/'; // pas de session
    mocked.getOpenMatches.mockResolvedValue([match()] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    expect(await screen.findByText('Terrain 1')).toBeInTheDocument();
    await waitFor(() => expect(mocked.getOpenMatches).toHaveBeenCalledWith('demo', undefined));

    fireEvent.click(screen.getByRole('button', { name: /Rejoindre/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mocked.joinOpenMatch).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `cd frontend && npx jest OpenMatches -t "anonyme"`
Expected: FAIL (sans token, le composant n'affiche pas la liste — il rend « Connectez-vous pour voir les parties ouvertes. »).

- [ ] **Step 3: Implémenter la liste publique + le prompt**

Dans `OpenMatches.tsx` :

a) Ajouter les imports en tête :

```tsx
import { useRouter } from 'next/navigation';
import { AuthPromptDialog } from '@/components/openmatch/AuthPromptDialog';
```

b) Dans le composant, ajouter sous `const { token, ready } = useAuth();` :

```tsx
  const router = useRouter();
```

c) Ajouter un état (à côté des autres `useState`) :

```tsx
  const [authPrompt, setAuthPrompt] = useState<OpenMatch | null>(null);
```

d) Remplacer `load` :

```tsx
  const load = useCallback(async () => {
    setLoading(true);
    try { setMatches(await api.getOpenMatches(club.slug, token ?? undefined)); }
    catch { setMatches([]); }
    finally { setLoading(false); }
  }, [club.slug, token]);
```

e) Masquer le toggle Classement pour l'anonyme : remplacer `{levelEnabled && (` (celui qui entoure le `<Segmented<'parties' | 'classement'>`) par :

```tsx
        {levelEnabled && token && (
```

f) Masquer le filtre « À mon niveau » pour l'anonyme : remplacer `{levelEnabled && (` (celui qui entoure le `<label>` du filtre « À mon niveau ») par :

```tsx
          {levelEnabled && token && (
```

g) Retirer la branche `!token` du bloc d'affichage. Remplacer :

```tsx
          {!ready || loading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
          ) : !token ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>Connectez-vous pour voir les parties ouvertes.</div>
          ) : otherMatches.length === 0 ? (
```

par :

```tsx
          {!ready || loading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
          ) : otherMatches.length === 0 ? (
```

h) Dans la **section « Pour toi »** (cartes recommandées), ajouter aux props de `<OpenMatchCard>` (à côté de `onOpenChat`/`hasUnread`) :

```tsx
                  isAnonymous={false}
                  onAuthPrompt={setAuthPrompt}
```

i) Dans la **section « Autres »** (`otherMatches.map`), remplacer `token={token!}` par `token={token ?? ''}` et ajouter aux props de `<OpenMatchCard>` :

```tsx
              isAnonymous={!token}
              onAuthPrompt={setAuthPrompt}
```

j) Ajouter le rendu du dialog, juste après le bloc `{chatting && token && ( ... )}` :

```tsx
      {authPrompt && (
        <AuthPromptDialog
          detail={authPrompt.resourceName}
          onRegister={() => router.push('/register?next=/parties')}
          onLogin={() => router.push('/login?next=/parties')}
          onClose={() => setAuthPrompt(null)}
        />
      )}
```

- [ ] **Step 4: Lancer la suite OpenMatches**

Run: `cd frontend && npx jest OpenMatches`
Expected: PASS (anciens — qui posent un cookie `token=abc` — + le nouveau test anonyme).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "feat(parties): liste publique + prompt d auth dans OpenMatches"
```

---

## Task 7: `ClubNav` — onglet « Parties » visible en anonyme

**Files:**
- Modify: `frontend/components/ClubNav.tsx:36`
- Modify: `frontend/app/parties/page.tsx:9-11` (commentaire)
- Test: `frontend/__tests__/ClubNav.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Dans `frontend/__tests__/ClubNav.test.tsx`, ajouter dans le `describe('ClubNav')` :

```tsx
  it('montre « Parties » sans session si le club a du padel (parties ouvertes publiques)', async () => {
    const padelClub = { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: null, clubSports: [{ sport: { key: 'padel' } }] } as never;
    render(<ThemeProvider><ClubNav club={padelClub} /></ThemeProvider>);
    expect(await screen.findByText('Parties')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `cd frontend && npx jest ClubNav -t "sans session si le club a du padel"`
Expected: FAIL (l'onglet exige encore `!!token`).

- [ ] **Step 3: Rendre l'onglet visible en anonyme**

Dans `frontend/components/ClubNav.tsx`, remplacer la ligne de l'onglet « Parties » (≈ ligne 36) :

```tsx
    { label: 'Parties', href: '/parties', icon: 'users', match: (p) => p.startsWith('/parties'), show: ready && clubHasPadel(club) },
```

Dans `frontend/app/parties/page.tsx`, mettre à jour le commentaire d'en-tête (≈ lignes 9-11) :

```tsx
// /parties = découverte des parties ouvertes du club, VISIBLE DE TOUS (membre, non-membre,
// anonyme). Padel uniquement : un club sans padel n'a pas d'onglet Parties ; un accès direct
// (bookmark / lien profond) est redirigé vers l'accueil du club.
```

- [ ] **Step 4: Lancer la suite ClubNav**

Run: `cd frontend && npx jest ClubNav`
Expected: PASS (anciens — club sans padel, Parties reste masqué — + le nouveau).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ClubNav.tsx frontend/app/parties/page.tsx frontend/__tests__/ClubNav.test.tsx
git commit -m "feat(parties): onglet Parties visible en anonyme (club padel)"
```

---

## Task 8: Retour `?next=` après inscription / connexion

**Files:**
- Modify: `frontend/lib/postAuth.ts:11-29`
- Modify: `frontend/app/login/page.tsx`
- Modify: `frontend/app/register/page.tsx`
- Test: `frontend/__tests__/postAuth.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/postAuth.test.ts` :

```tsx
jest.mock('../lib/api', () => ({
  api: { getMyClubs: jest.fn(), joinClub: jest.fn().mockResolvedValue({ ok: true }) },
}));
jest.mock('../lib/session', () => ({ setSession: jest.fn() }));
jest.mock('../lib/clubUrl', () => ({ clubUrl: (s: string, p: string) => `https://${s}.test${p}` }));

import { finishAuth } from '../lib/postAuth';
import { api } from '../lib/api';

const auth = { token: 't', user: { isSuperAdmin: false } } as never;

describe('finishAuth — retour next', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hôte club, non-staff, avec next → redirige vers next', async () => {
    (api.getMyClubs as jest.Mock).mockResolvedValue([]); // pas staff de ce club
    const push = jest.fn();
    await finishAuth(auth, 'demo', { push }, '/parties');
    expect(api.joinClub).toHaveBeenCalledWith('demo', 't');
    expect(push).toHaveBeenCalledWith('/parties');
  });

  it('hôte club, non-staff, sans next → redirige vers /', async () => {
    (api.getMyClubs as jest.Mock).mockResolvedValue([]);
    const push = jest.fn();
    await finishAuth(auth, 'demo', { push });
    expect(push).toHaveBeenCalledWith('/');
  });

  it('hôte club, staff → ignore next, va sur /admin', async () => {
    (api.getMyClubs as jest.Mock).mockResolvedValue([{ slug: 'demo', clubId: 'c1', role: 'OWNER' }]);
    const push = jest.fn();
    await finishAuth(auth, 'demo', { push }, '/parties');
    expect(push).toHaveBeenCalledWith('/admin');
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `cd frontend && npx jest postAuth`
Expected: FAIL (`finishAuth` n'accepte pas de 4e argument `next` ; avec next il redirige toujours vers `/`).

- [ ] **Step 3: Threader `next` dans `finishAuth`**

Dans `frontend/lib/postAuth.ts`, remplacer la signature et la branche hôte club :

```tsx
export async function finishAuth(auth: AuthResponse, slug: string | null, router: Pushable, next?: string): Promise<void> {
  if (!slug && auth.user?.isSuperAdmin) {
    setSession(auth.token, null);
    router.push('/superadmin');
    return;
  }
  const memberships = await api.getMyClubs(auth.token).catch(() => []);
  if (slug) {
    await api.joinClub(slug, auth.token).catch(() => {}); // adhésion automatique au club du host
    const m = memberships.find((x) => x.slug === slug);
    setSession(auth.token, m?.clubId ?? null);
    router.push(m ? '/admin' : (next || '/')); // staff du club → back-office, sinon next (ou réservation)
  } else {
    const managed = memberships[0];
    setSession(auth.token, managed?.clubId ?? null);
    if (managed) window.location.assign(clubUrl(managed.slug, '/admin'));
    else router.push('/clubs');
  }
}
```

- [ ] **Step 4: Lancer le test postAuth**

Run: `cd frontend && npx jest postAuth`
Expected: PASS.

- [ ] **Step 5: Brancher `next` dans `/login`**

Dans `frontend/app/login/page.tsx`, ajouter un helper dans le composant (après `const { slug } = useClub();`) :

```tsx
  const nextPath = () => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') || undefined : undefined);
```

Remplacer l'appel dans `handleSubmit` :

```tsx
      await finishAuth(data, slug, router, nextPath());
```

Remplacer le `onVerified` du `VerifyCodeForm` :

```tsx
            <VerifyCodeForm email={verify.email} devCode={verify.devCode} onVerified={(a) => finishAuth(a, slug, router, nextPath())} />
```

- [ ] **Step 6: Brancher `next` dans `/register`**

Dans `frontend/app/register/page.tsx`, ajouter le même helper (après `const { slug } = useClub();`) :

```tsx
  const nextPath = () => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') || undefined : undefined);
```

Remplacer la redirection finale dans `finish` :

```tsx
    router.push(slug ? (nextPath() || '/') : '/clubs');
```

- [ ] **Step 7: Vérifier types + suites impactées**

Run: `cd frontend && npx tsc --noEmit && npx jest postAuth login register`
Expected: PASS / aucune erreur de type (s'il n'existe pas de suite `login`/`register`, jest l'ignore sans échec).

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/postAuth.ts frontend/app/login/page.tsx frontend/app/register/page.tsx frontend/__tests__/postAuth.test.ts
git commit -m "feat(parties): retour ?next= apres inscription/connexion (anonyme -> /parties)"
```

---

## Task 9: Vérification finale

**Files:** (aucun changement — vérification)

- [ ] **Step 1: Suites backend impactées**

Run: `cd backend && npx jest openMatch.service clubs.openmatch-chat.routes`
Expected: PASS.

- [ ] **Step 2: Suites frontend impactées**

Run: `cd frontend && npx jest authGate AuthPromptDialog OpenMatchCard OpenMatches ClubNav postAuth`
Expected: PASS.

> ⚠️ Ne PAS conclure depuis un `npx jest` complet : ~6 échecs `BookingModal` sont une flake d'isolation pré-existante (cf. mémoire `frontend-full-suite-bookingmodal-flake`). Vérifier par suites ciblées + tsc.

- [ ] **Step 3: Types**

Run: `cd frontend && npx tsc --noEmit` puis `cd backend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Mettre à jour CLAUDE.md**

Ajouter, sous la section « Chat de partie ouverte… », une note d'évolution résumant : parties ouvertes désormais **visibles de tous** (anonyme inclus, `/parties` public + `GET open-matches` en `optionalAuth` + `listOpenMatches(slug, viewerUserId|null)`), **rejoindre/intérêt garantissent l'adhésion** (`ensureActiveMembership`, refus BLOCKED), carte anonyme → `AuthPromptDialog` (`?next=/parties`), onglet ClubNav « Parties » visible en anonyme. Aucune migration.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(parties): parties ouvertes visibles & rejoignables par les non-membres"
```

---

## Self-Review — couverture spec

| Exigence spec | Tâche |
|---|---|
| `/parties` public (proxy ne renvoie plus l'anonyme vers /login) | Task 3 (PUBLIC_PATHS) |
| `GET open-matches` lecture publique (optionalAuth) | Task 2 |
| `listOpenMatches(slug, viewerUserId\|null)` flags false en anonyme | Task 1 |
| Rejoindre non-membre → adhésion à la volée | Task 1 (`ensureActiveMembership`, join) |
| `setInterested` non-membre → adhésion à la volée | Task 1 |
| BLOCKED refusé partout | Task 1 |
| `getOpenMatches` token facultatif | Task 3 |
| Anonyme : « Rejoindre » → dialog d'auth ; actions membres masquées | Tasks 4, 5, 6 |
| Anonyme : Classement / filtre niveau masqués | Task 6 |
| Onglet « Parties » accessible à l'anonyme | Task 7 |
| Retour `?next=/parties` après inscription/connexion | Task 8 |
| Noms+avatars visibles en anonyme (validé) | implicite (aucune restriction ajoutée) |
| Aucune migration | — |
