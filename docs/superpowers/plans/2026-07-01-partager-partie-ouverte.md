# Partager une partie ouverte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de partager une partie ouverte via un lien stable vers une page dédiée `/parties/[id]` (avec aperçu Open Graph), depuis un bouton « Partager » présent sur chaque carte de la liste et sur la page.

**Architecture:** Backend — nouvel endpoint public `GET /api/clubs/:slug/open-matches/:id` réutilisant un mapper DTO partagé avec la liste. Frontend — la logique d'actions d'`OpenMatches` est extraite dans un hook `useOpenMatchActions` + un composant `OpenMatchModals`, réutilisés par la liste ET une nouvelle page détail `/parties/[id]` (composant serveur `generateMetadata` + enfant client). Partage : Web Share API avec repli copie-lien.

**Tech Stack:** Express 5 + Prisma 7 (backend), Next.js 16 App Router + React 19 (frontend), Jest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-01-partager-partie-ouverte-design.md`

---

## Préambule — environnement

- Le repo valide est `C:\ProjetsIA\05_PERSO\RESERVE\palova` (jamais la copie OneDrive).
- Backend : `cd backend` ; tests `npx jest <motif>`. Frontend : `cd frontend` ; tests `npx jest <motif>`.
- Avant de commencer, vérifier une base verte des suites qu'on va toucher :
  - `cd backend && npx jest openMatch.service`
  - `cd frontend && npx jest OpenMatches`

---

## Task 1 : Backend — mapper DTO partagé + `getOpenMatch`

**Files:**
- Modify: `backend/src/services/openMatch.service.ts`
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1 : Écrire les tests d'abord**

Ajouter, à la fin du `describe('OpenMatchService', () => { ... })` (avant sa `})` fermante), un nouveau bloc. Il réutilise les mocks `beforeEach` existants (`prismaMock.club.findUnique` → club ACTIVE, `notification.findMany` → `[]`, ratings `[]`).

```ts
  describe('getOpenMatch', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      id: 'm1', startTime: future(48), endTime: future(49),
      visibility: 'PUBLIC', status: 'CONFIRMED',
      targetLevelMin: null, targetLevelMax: null,
      resource: { id: 'court-1', name: 'Court 1', attributes: { format: 'double' }, clubId: 'club-demo', clubSport: { sport: { key: 'padel', name: 'Padel' } } },
      participants: [
        { userId: 'org', isOrganizer: true, team: null, user: { firstName: 'Org', lastName: 'A', avatarUrl: null } },
      ],
      openMatchInterests: [],
      openMatchMessages: [],
      ...over,
    });

    it('renvoie la partie avec les flags du viewer (membre)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row() as any);
      const out = await service.getOpenMatch('club-demo', 'm1', 'org');
      expect(out.id).toBe('m1');
      expect(out.resourceName).toBe('Court 1');
      expect(out.sport).toEqual({ key: 'padel', name: 'Padel' });
      expect(out.maxPlayers).toBe(4);
      expect(out.spotsLeft).toBe(3);
      expect(out.viewerIsOrganizer).toBe(true);
      expect(out.viewerIsParticipant).toBe(true);
      for (const p of out.players) expect([1, 2]).toContain(p.team);
    });

    it('renvoie la partie pour un viewer anonyme (flags à false)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row() as any);
      const out = await service.getOpenMatch('club-demo', 'm1', null);
      expect(out.viewerIsParticipant).toBe(false);
      expect(out.viewerIsOrganizer).toBe(false);
      expect(out.viewerIsInterested).toBe(false);
      expect(out.unreadCount).toBe(0);
    });

    it('autorise une partie déjà passée (lien partagé résout toujours)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ startTime: new Date(Date.now() - 3_600_000), endTime: new Date() }) as any);
      const out = await service.getOpenMatch('club-demo', 'm1', null);
      expect(out.id).toBe('m1');
    });

    it('404 RESERVATION_NOT_FOUND si introuvable', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(null as any);
      await expect(service.getOpenMatch('club-demo', 'nope', null)).rejects.toThrow('RESERVATION_NOT_FOUND');
    });

    it('404 si visibilité non PUBLIC', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ visibility: 'PRIVATE' }) as any);
      await expect(service.getOpenMatch('club-demo', 'm1', null)).rejects.toThrow('RESERVATION_NOT_FOUND');
    });

    it('404 si la partie appartient à un autre club', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ resource: { id: 'c', name: 'X', attributes: {}, clubId: 'autre-club', clubSport: { sport: { key: 'padel', name: 'Padel' } } } }) as any);
      await expect(service.getOpenMatch('club-demo', 'm1', null)).rejects.toThrow('RESERVATION_NOT_FOUND');
    });

    it('404 si le sport n’est pas le padel', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ resource: { id: 'c', name: 'X', attributes: {}, clubId: 'club-demo', clubSport: { sport: { key: 'tennis', name: 'Tennis' } } } }) as any);
      await expect(service.getOpenMatch('club-demo', 'm1', null)).rejects.toThrow('RESERVATION_NOT_FOUND');
    });
  });
```

- [ ] **Step 2 : Lancer les tests → échec attendu**

Run: `cd backend && npx jest openMatch.service -t getOpenMatch`
Expected: FAIL — `service.getOpenMatch is not a function`.

- [ ] **Step 3 : Refactor + implémentation**

Dans `openMatch.service.ts` :

(a) Juste après les imports (avant `export class OpenMatchService`), ajouter le `include` partagé + son type :

```ts
// Include commun à la liste et à la lecture unitaire d'une partie ouverte.
const MATCH_INCLUDE = {
  resource: { select: { id: true, name: true, attributes: true, clubId: true, clubSport: { select: { sport: { select: { key: true, name: true } } } } } },
  participants: {
    orderBy: { joinedAt: 'asc' },
    select: { userId: true, isOrganizer: true, team: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
  },
  openMatchInterests: {
    orderBy: { createdAt: 'asc' },
    select: { userId: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
  },
  openMatchMessages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
} satisfies Prisma.ReservationInclude;

type MatchRow = Prisma.ReservationGetPayload<{ include: typeof MATCH_INCLUDE }>;
```

(b) Ajouter la méthode privée `toDTO` dans la classe (copie exacte de l'objet construit aujourd'hui dans `listOpenMatches().map`, paramétrée) :

```ts
  /** Sérialise une réservation-partie en DTO. Partagé par listOpenMatches et getOpenMatch. */
  private toDTO(m: MatchRow, levels: Record<string, number | null>, unreadCount: number, viewerUserId: string | null) {
    const maxPlayers = playerCount((m.resource.attributes as { format?: string } | null)?.format);
    const teamed = effectiveTeams(m.participants, maxPlayers);
    const sportKey = m.resource.clubSport.sport.key;
    return {
      id: m.id,
      resourceName: m.resource.name,
      sport: { key: m.resource.clubSport.sport.key, name: m.resource.clubSport.sport.name },
      startTime: m.startTime.toISOString(),
      endTime: m.endTime.toISOString(),
      maxPlayers,
      spotsLeft: Math.max(0, maxPlayers - m.participants.length),
      full: m.participants.length >= maxPlayers,
      viewerIsParticipant: viewerUserId != null && m.participants.some((p) => p.userId === viewerUserId),
      viewerIsOrganizer: viewerUserId != null && m.participants.some((p) => p.userId === viewerUserId && p.isOrganizer),
      targetLevelMin: m.targetLevelMin ?? null,
      targetLevelMax: m.targetLevelMax ?? null,
      players: teamed.map((p) => ({
        userId: p.userId, firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl, isOrganizer: p.isOrganizer,
        level: levels[`${p.userId}:${sportKey}`] ?? null,
        team: p.team,
      })),
      interestedCount: m.openMatchInterests.length,
      viewerIsInterested: viewerUserId != null && m.openMatchInterests.some((i) => i.userId === viewerUserId),
      interested: m.openMatchInterests.slice(0, 5).map((i) => ({
        userId: i.userId, firstName: i.user.firstName, lastName: i.user.lastName, avatarUrl: i.user.avatarUrl, isOrganizer: false,
      })),
      lastMessageAt: m.openMatchMessages[0]?.createdAt.toISOString() ?? null,
      unreadCount,
    };
  }
```

(c) Réécrire `listOpenMatches` pour utiliser `MATCH_INCLUDE` et `toDTO`. Remplacer le bloc `include: { ... }` de son `findMany` par `include: MATCH_INCLUDE,` (retirer le commentaire `// targetLevelMin...`), puis remplacer tout le `return matches.map((m) => { ... });` final par :

```ts
    return matches.map((m) => this.toDTO(m, levels, unreadByMatch.get(m.id) ?? 0, viewerUserId));
```

(Le reste de `listOpenMatches` — collecte des `pairs`, `getLevelsBySport`, `unreadNotifs`/`unreadByMatch` — reste inchangé.)

(d) Ajouter la méthode publique `getOpenMatch`, juste après `listOpenMatches` :

```ts
  /** Lecture d'UNE partie ouverte (page /parties/[id]) — publique, autorise les parties passées. */
  async getOpenMatch(slug: string, id: string, viewerUserId: string | null) {
    const club = await this.resolveActiveClub(slug);
    const m = await prisma.reservation.findUnique({ where: { id }, include: MATCH_INCLUDE });
    if (
      !m ||
      m.visibility !== 'PUBLIC' ||
      m.status !== 'CONFIRMED' ||
      m.resource.clubId !== club.id ||
      m.resource.clubSport.sport.key !== 'padel'
    ) throw new Error('RESERVATION_NOT_FOUND');

    const sportKey = m.resource.clubSport.sport.key;
    const pairs = m.participants.map((p) => ({ userId: p.userId, sportKey }));
    const levels = pairs.length > 0 ? await this.ratingService.getLevelsBySport(pairs) : {};

    const unreadNotifs = viewerUserId != null
      ? await prisma.notification.findMany({
          where: { userId: viewerUserId, type: 'open_match.message', readAt: null, clubId: club.id },
          select: { data: true },
        })
      : [];
    const unreadCount = unreadNotifs.filter((n) => (n.data as { matchId?: string } | null)?.matchId === id).length;

    return this.toDTO(m, levels, unreadCount, viewerUserId);
  }
```

- [ ] **Step 4 : Lancer les tests → succès**

Run: `cd backend && npx jest openMatch.service`
Expected: PASS (les tests `getOpenMatch` ET les `listOpenMatches` existants restent verts — le mapper est byte-identique).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(open-match): getOpenMatch service + mapper DTO partagé"
```

---

## Task 2 : Backend — route `GET /:slug/open-matches/:id`

**Files:**
- Modify: `backend/src/routes/clubs.ts` (près de la ligne 241, après `/open-matches/unread-count`)
- Test: `backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts`

- [ ] **Step 1 : Écrire le test d'abord**

Ouvrir `clubs.openmatch-chat.routes.test.ts`, repérer comment `openMatchService` est mocké (chercher `jest.mock` du service) et comment un test GET public existant est structuré (le GET liste public 200). Ajouter un bloc :

```ts
  describe('GET /api/clubs/:slug/open-matches/:id', () => {
    it('200 en public (sans token) et délègue au service', async () => {
      (openMatchService.getOpenMatch as jest.Mock).mockResolvedValue({ id: 'm1', resourceName: 'Court 1' });
      const res = await request(app).get('/api/clubs/demo/open-matches/m1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('m1');
      expect(openMatchService.getOpenMatch).toHaveBeenCalledWith('demo', 'm1', null);
    });

    it('404 quand le service lève RESERVATION_NOT_FOUND', async () => {
      (openMatchService.getOpenMatch as jest.Mock).mockRejectedValue(new Error('RESERVATION_NOT_FOUND'));
      const res = await request(app).get('/api/clubs/demo/open-matches/nope');
      expect(res.status).toBe(404);
    });
  });
```

> Si le mock du service dans ce fichier ne déclare pas encore `getOpenMatch`, l'ajouter à l'objet mock (`getOpenMatch: jest.fn()`). Vérifier aussi que `handleError` mappe bien `RESERVATION_NOT_FOUND` → 404 (c'est déjà le cas ailleurs dans le code open-match). Si un autre nom d'export/mock est utilisé (`openMatchService` vs autre), s'aligner sur l'existant du fichier.

- [ ] **Step 2 : Lancer → échec**

Run: `cd backend && npx jest clubs.openmatch-chat -t "open-matches/:id"`
Expected: FAIL — route inexistante (404 « Cannot GET » ou body vide).

- [ ] **Step 3 : Ajouter la route**

Dans `clubs.ts`, **immédiatement après** le bloc `router.get('/:slug/open-matches/unread-count', ...)` (≈ ligne 241) et **avant** `router.post('/:slug/open-matches/:id/join', ...)` :

```ts
// Lecture publique d'une partie ouverte (page /parties/[id]). Déclarée APRÈS /unread-count
// pour que ce segment ne soit pas capturé comme un id.
router.get('/:slug/open-matches/:id', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.getOpenMatch(asString(req.params.slug), asString(req.params.id), req.user?.id ?? null)); }
  catch (err) { handleError(err, res, next); }
});
```

(`optionalAuth` est déjà importé — il sert à `/open-matches`.)

- [ ] **Step 4 : Lancer → succès**

Run: `cd backend && npx jest clubs.openmatch-chat`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts
git commit -m "feat(open-match): route GET /open-matches/:id (publique)"
```

---

## Task 3 : Frontend — `api.getOpenMatch` + `.ics` `uidPrefix: 'match'`

**Files:**
- Modify: `frontend/lib/api.ts:260` (section « Parties ouvertes »)
- Modify: `frontend/lib/tournament.ts:139` (`buildAgendaICS`) + `frontend/components/tournament/ShareActions.tsx:10`
- Test: `frontend/__tests__/tournament.test.ts`

- [ ] **Step 1 : Test d'abord (uidPrefix 'match')**

Dans `tournament.test.ts`, repérer les tests `buildAgendaICS` existants et en ajouter un :

```ts
  it('buildAgendaICS accepte uidPrefix "match" et préfixe l’UID', () => {
    const item = { id: 'm1', name: 'Partie ouverte · Court 2', description: null, startTime: '2026-07-05T12:00:00.000Z', endTime: '2026-07-05T13:30:00.000Z', club: { name: 'Padel Arena' } };
    const ics = buildAgendaICS(item, 'https://demo.palova.fr/parties/m1', new Date('2026-07-01T00:00:00Z'), 'match');
    expect(ics).toContain('UID:match-m1@palova');
    expect(ics).toContain('SUMMARY:Partie ouverte');
  });
```

- [ ] **Step 2 : Lancer → échec**

Run: `cd frontend && npx jest tournament.test -t "uidPrefix"`
Expected: FAIL (type/valeur : `'match'` non assignable).

- [ ] **Step 3 : Implémenter**

Dans `frontend/lib/tournament.ts`, élargir le type du paramètre `uidPrefix` de `buildAgendaICS` :

```ts
  uidPrefix: 'tournament' | 'event' | 'match' = 'tournament',
```

Dans `frontend/components/tournament/ShareActions.tsx`, élargir la prop :

```ts
export function ShareActions({ item, uidPrefix = 'tournament' }: { item: AgendaICSItem; uidPrefix?: 'tournament' | 'event' | 'match' }) {
```

Dans `frontend/lib/api.ts`, ajouter après `getOpenMatches` (≈ ligne 261) :

```ts
  getOpenMatch: (slug: string, id: string, token?: string) =>
    request<OpenMatch>(`/api/clubs/${slug}/open-matches/${id}`, {}, token),
```

- [ ] **Step 4 : Lancer → succès**

Run: `cd frontend && npx jest tournament.test`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/api.ts frontend/lib/tournament.ts frontend/components/tournament/ShareActions.tsx frontend/__tests__/tournament.test.ts
git commit -m "feat(open-match): api.getOpenMatch + ICS uidPrefix 'match'"
```

---

## Task 4 : Frontend — composant `MatchShareButton`

Bouton « Partager » autonome (Web Share + repli copie-lien), pour les cartes de la liste (où l'URL de page ≠ URL de la partie, donc URL explicite requise).

**Files:**
- Create: `frontend/components/openmatch/MatchShareButton.tsx`
- Test: `frontend/__tests__/MatchShareButton.test.tsx`

- [ ] **Step 1 : Test d'abord**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MatchShareButton } from '../components/openmatch/MatchShareButton';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('MatchShareButton', () => {
  afterEach(() => { delete (navigator as any).share; });

  it('appelle navigator.share quand disponible', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    (navigator as any).share = share;
    wrap(<MatchShareButton url="https://demo.palova.fr/parties/m1" title="Partie ouverte · Court 2" />);
    fireEvent.click(screen.getByRole('button', { name: /partager/i }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: 'Partie ouverte · Court 2', url: 'https://demo.palova.fr/parties/m1' }));
  });

  it('repli sur le presse-papier et affiche « Lien copié ! »', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    wrap(<MatchShareButton url="https://demo.palova.fr/parties/m1" title="X" />);
    fireEvent.click(screen.getByRole('button', { name: /partager/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://demo.palova.fr/parties/m1'));
    expect(await screen.findByText('Lien copié !')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `cd frontend && npx jest MatchShareButton`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';

// Partage d'une partie ouverte : Web Share API, repli copie du lien.
// L'URL est explicite (les cartes de liste ne sont pas à l'URL de la partie).
export function MatchShareButton({ url, title, style }: { url: string; title: string; style?: React.CSSProperties }) {
  const { th } = useTheme();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const share = async () => {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title, url }).catch(() => {}); // AbortError (feuille refermée) : silencieux
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch { /* presse-papier indisponible (contexte non sécurisé) : rien */ }
  };

  return (
    <Btn variant="surface" icon="share" style={style} onClick={share}>
      {copied ? 'Lien copié !' : 'Partager'}
    </Btn>
  );
}
```

> Vérifier que l'atome `Btn` accepte `icon` et `variant="surface"` (il est déjà utilisé ainsi dans `OpenMatchCard`). Vérifier que l'icône `share` existe dans `components/ui/Icon.tsx` (utilisée par `ShareActions`).

- [ ] **Step 4 : Lancer → succès**

Run: `cd frontend && npx jest MatchShareButton`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/openmatch/MatchShareButton.tsx frontend/__tests__/MatchShareButton.test.tsx
git commit -m "feat(open-match): composant MatchShareButton"
```

---

## Task 5 : Frontend — bouton « Partager » sur `OpenMatchCard`

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx`
- Test: `frontend/__tests__/OpenMatchCard.test.tsx` (existant)

- [ ] **Step 1 : Test d'abord**

Dans `OpenMatchCard.test.tsx`, repérer un rendu existant de la carte (avec ses props). Ajouter un test qui vérifie la présence du bouton « Partager » y compris en anonyme. Réutiliser le helper de rendu du fichier ; à défaut, s'aligner sur les props déjà passées dans les autres tests du fichier.

```tsx
  it('affiche un bouton Partager (même en anonyme)', () => {
    renderCard({ isAnonymous: true }); // helper local du fichier ; sinon render(<OpenMatchCard .../>)
    expect(screen.getByRole('button', { name: /partager/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2 : Lancer → échec**

Run: `cd frontend && npx jest OpenMatchCard.test -t "Partager"`
Expected: FAIL — pas de bouton Partager.

- [ ] **Step 3 : Implémenter**

Dans `OpenMatchCard.tsx` :

(a) importer le bouton en haut :

```tsx
import { MatchShareButton } from '@/components/openmatch/MatchShareButton';
```

(b) Dans la barre d'actions (le `div` à `marginTop: 14, paddingTop: 14, borderTop...`, ≈ ligne 114), ajouter le bouton **avant** le `<span style={{ marginLeft: 'auto' ... }}>` (donc dans le groupe gauche, visible de tous — y compris `isAnonymous`) :

```tsx
        <MatchShareButton
          style={actionBtn}
          title={`Partie ouverte · ${m.resourceName}`}
          url={typeof window !== 'undefined' ? `${window.location.origin}/parties/${m.id}` : `/parties/${m.id}`}
        />
```

- [ ] **Step 4 : Lancer → succès**

Run: `cd frontend && npx jest OpenMatchCard.test`
Expected: PASS (tous les tests de la carte restent verts).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/__tests__/OpenMatchCard.test.tsx
git commit -m "feat(open-match): bouton Partager sur la carte de partie"
```

---

## Task 6 : Frontend — extraire `useOpenMatchActions` + `OpenMatchModals`, refactor `OpenMatches`

Refactor **sans changement de comportement** : la logique d'actions et les 4 modales sont extraites d'`OpenMatches` pour être réutilisées par la page détail. Le filet de sécurité est la suite existante `OpenMatches.test.tsx`.

**Files:**
- Create: `frontend/components/openmatch/useOpenMatchActions.ts`
- Create: `frontend/components/openmatch/OpenMatchModals.tsx`
- Modify: `frontend/components/openmatch/OpenMatches.tsx`
- Test (safety net, existant) : `frontend/__tests__/OpenMatches.test.tsx`

- [ ] **Step 1 : Confirmer la base verte**

Run: `cd frontend && npx jest OpenMatches`
Expected: PASS (baseline avant refactor).

- [ ] **Step 2 : Créer le hook `useOpenMatchActions.ts`**

```tsx
'use client';
import { useState } from 'react';
import { api, ClubDetail, OpenMatch } from '@/lib/api';
import { MatchPlayerData } from '@/components/match/MatchTeams';
import type { PlayerPillData } from '@/components/player/PlayerPills';
import { inRange } from '@/lib/levelMatch';

// Libellés d'erreur partagés (liste + page détail).
export const JOIN_ERRORS: Record<string, string> = {
  MATCH_FULL:            'Cette partie est complète.',
  MATCH_IN_PAST:         'Cette partie a déjà eu lieu.',
  MATCH_NOT_JOINABLE:    "Cette partie n'est plus ouverte.",
  ALREADY_JOINED:        'Vous participez déjà à cette partie.',
  ORGANIZER_CANNOT_LEAVE: "Vous organisez cette partie : annulez la réservation pour la retirer.",
  MEMBERSHIP_REQUIRED:   'Réservé aux membres du club.',
  MEMBERSHIP_BLOCKED:    'Votre accès au club est bloqué.',
  NOT_ORGANIZER:          "Seul l'organisateur peut retirer un joueur.",
  CANNOT_REMOVE_ORGANIZER: "L'organisateur ne peut pas être retiré.",
  PARTICIPANT_NOT_FOUND:  "Ce joueur n'est plus dans la partie.",
  ALREADY_PARTICIPANT:   'Vous participez déjà à cette partie.',
  CHAT_FORBIDDEN:        'Réservé aux inscrits et aux intéressés.',
  NOT_ALLOWED:           'Action non autorisée.',
  RESERVATION_NOT_FOUND: "Cette partie n'existe plus.",
};

// Logique d'actions d'une partie ouverte (rejoindre/quitter/équipes/chat/intérêt/résultat)
// + cibles de modales. `reload` recharge la source (liste complète OU partie unique).
export function useOpenMatchActions({ club, token, myLevel, reload }: {
  club: ClubDetail; token: string | null; myLevel: number | null; reload: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [recordingFor, setRecordingFor] = useState<OpenMatch | null>(null);
  const [joinWarning, setJoinWarning] = useState<OpenMatch | null>(null);
  const [chatting, setChatting] = useState<OpenMatch | null>(null);
  const [authPrompt, setAuthPrompt] = useState<OpenMatch | null>(null);

  const act = async (m: OpenMatch, fn: () => Promise<unknown>) => {
    if (!token) return;
    setBusyId(m.id); setError('');
    try { await fn(); await reload(); }
    catch (e) { setError(JOIN_ERRORS[(e as Error).message] ?? (e as Error).message); }
    finally { setBusyId(null); }
  };

  const addPlayerToTeam = (m: OpenMatch, memberId: string, team?: 1 | 2) => {
    setAddingId(null);
    act(m, async () => {
      await api.addOpenMatchPlayer(club.slug, m.id, memberId, token!);
      if (team) {
        const map: Record<string, 1 | 2> = { ...Object.fromEntries(m.players.map((p) => [p.userId, (p.team ?? 1) as 1 | 2])), [memberId]: team };
        await api.setOpenMatchTeams(club.slug, m.id, map, token!);
      }
    });
  };

  const replacePlayer = (m: OpenMatch, oldPlayer: MatchPlayerData, memberId: string) => {
    setAddingId(null);
    act(m, async () => {
      await api.removeOpenMatchPlayer(club.slug, m.id, oldPlayer.userId, token!);
      await api.addOpenMatchPlayer(club.slug, m.id, memberId, token!);
      const map: Record<string, 1 | 2> = { ...Object.fromEntries(m.players.filter((p) => p.userId !== oldPlayer.userId).map((p) => [p.userId, (p.team ?? 1) as 1 | 2])), [memberId]: oldPlayer.team };
      await api.setOpenMatchTeams(club.slug, m.id, map, token!);
    });
  };

  const toggleInterest = (m: OpenMatch) =>
    act(m, () => (m.viewerIsInterested ? api.removeInterested(club.slug, m.id, token!) : api.setInterested(club.slug, m.id, token!)));

  const openChat = (m: OpenMatch) => {
    setChatting(m);
    if (token) api.markOpenMatchChatRead(club.slug, m.id, token)
      .then(() => { reload(); window.dispatchEvent(new Event('palova:openmatch-unread')); })
      .catch(() => {});
  };

  const join = (m: OpenMatch) => {
    if (!inRange(myLevel, m.targetLevelMin ?? null, m.targetLevelMax ?? null)) setJoinWarning(m);
    else act(m, () => api.joinOpenMatch(club.slug, m.id, token!));
  };
  const confirmJoin = (m: OpenMatch) => { setJoinWarning(null); act(m, () => api.joinOpenMatch(club.slug, m.id, token!)); };
  const leave = (m: OpenMatch) => act(m, () => api.leaveOpenMatch(club.slug, m.id, token!));
  const removePlayer = (m: OpenMatch, p: PlayerPillData) => act(m, () => api.removeOpenMatchPlayer(club.slug, m.id, p.userId, token!));
  const setTeams = (m: OpenMatch, teams: Record<string, 1 | 2>) => act(m, () => api.setOpenMatchTeams(club.slug, m.id, teams, token!));
  const onToggleAdd = (m: OpenMatch) => setAddingId((prev) => (prev === m.id ? null : m.id));
  const onCancelAdd = () => setAddingId(null);

  return {
    busyId, error, addingId, recordingFor, joinWarning, chatting, authPrompt,
    setError, setAddingId, setRecordingFor, setJoinWarning, setChatting, setAuthPrompt,
    join, confirmJoin, leave, removePlayer, setTeams, addPlayerToTeam, replacePlayer,
    toggleInterest, openChat, onToggleAdd, onCancelAdd,
  };
}

export type OpenMatchActions = ReturnType<typeof useOpenMatchActions>;
```

- [ ] **Step 3 : Créer `OpenMatchModals.tsx`**

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { ClubDetail } from '@/lib/api';
import { OpenMatchActions } from '@/components/openmatch/useOpenMatchActions';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { OpenMatchChatSheet } from '@/components/openmatch/OpenMatchChatSheet';
import { AuthPromptDialog } from '@/components/openmatch/AuthPromptDialog';

// Les 4 modales d'une partie ouverte, partagées par la liste et la page détail.
export function OpenMatchModals({ club, token, viewerUserId, canModerate, actions: a, reload, authNextPath }: {
  club: ClubDetail; token: string | null; viewerUserId: string; canModerate: boolean;
  actions: OpenMatchActions; reload: () => Promise<void>; authNextPath: string;
}) {
  const router = useRouter();
  return (
    <>
      {a.recordingFor && token && (
        <MatchResultModal
          reservationId={a.recordingFor.id}
          players={a.recordingFor.players.map(({ userId, firstName, lastName, avatarUrl }) => ({ userId, firstName, lastName, avatarUrl }))}
          token={token}
          context={{ whenIso: a.recordingFor.startTime, tz: club.timezone, courtName: a.recordingFor.resourceName }}
          initialTeams={Object.fromEntries(a.recordingFor.players.filter((p) => p.team === 1 || p.team === 2).map((p) => [p.userId, p.team as 1 | 2]))}
          onClose={() => a.setRecordingFor(null)}
          onSaved={() => { a.setRecordingFor(null); reload(); }}
        />
      )}
      {a.joinWarning && (
        <ConfirmDialog
          title="Niveau hors fourchette"
          message="Cette partie est hors de ta fourchette de niveau. Rejoindre quand même ?"
          confirmLabel="Rejoindre quand même"
          cancelLabel="Annuler"
          busy={a.busyId === a.joinWarning.id}
          onConfirm={() => a.confirmJoin(a.joinWarning!)}
          onCancel={() => a.setJoinWarning(null)}
        />
      )}
      {a.chatting && token && (
        <OpenMatchChatSheet
          slug={club.slug} token={token} reservationId={a.chatting.id} viewerUserId={viewerUserId}
          viewerIsOrganizer={a.chatting.viewerIsOrganizer}
          canModerate={canModerate}
          title={`${a.chatting.resourceName} · ${new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: club.timezone }).format(new Date(a.chatting.startTime)).replace(':', 'h')}`}
          timezone={club.timezone}
          onClose={() => { a.setChatting(null); reload(); window.dispatchEvent(new Event('palova:openmatch-unread')); }}
        />
      )}
      {a.authPrompt && (
        <AuthPromptDialog
          detail={a.authPrompt.resourceName}
          onRegister={() => router.push(`/register?next=${authNextPath}`)}
          onLogin={() => router.push(`/login?next=${authNextPath}`)}
          onClose={() => a.setAuthPrompt(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4 : Refactor `OpenMatches.tsx` pour consommer le hook + les modales**

Modifications :

1. **Imports** : retirer les imports désormais portés par le hook/modales s'ils ne servent plus directement (`inRange` reste utilisé par `visibleMatches`/`recommended` → **garder**). Ajouter :

```tsx
import { useOpenMatchActions } from '@/components/openmatch/useOpenMatchActions';
import { OpenMatchModals } from '@/components/openmatch/OpenMatchModals';
```

Retirer les imports devenus inutiles dans OpenMatches (déplacés dans `OpenMatchModals`) : `MatchResultModal`, `ConfirmDialog`, `AuthPromptDialog`, `OpenMatchChatSheet`, ainsi que `useRouter`/`router` (l'AuthPrompt navigue depuis les modales) et **`MatchPlayerData`** (le hook porte désormais `replacePlayer`/`removePlayer` ; plus référencé ici → retirer sinon `noUnusedLocals` casse `tsc`). `recommendMatches`, `Leaderboard`, `Segmented`, `ClubNav`, `Screen`, `inRange` : **garder** (encore utilisés par `visibleMatches`/`recommended`/le rendu).

2. **Supprimer** la constante locale `JOIN_ERRORS` (désormais dans le hook).

3. **Supprimer** les états d'action locaux : `busyId, error, addingId, recordingFor, joinWarning, chatting, authPrompt` — et les fonctions `act, addPlayerToTeam, replacePlayer, openChat, toggleInterest, handleJoin`. **Garder** : `matches, loading, myLevel, filterMyLevel, view, viewerUserId, canModerate, friendIds` et leurs effets, `load`, l'effet SSE (qui appelle `load`).

4. **Instancier le hook** juste après `load`/les effets :

```tsx
  const a = useOpenMatchActions({ club, token, myLevel, reload: load });
```

5. **Adapter les props des `OpenMatchCard`** (les deux emplacements — « Pour toi » et « Autres ») en remplaçant les anciens handlers par ceux du hook :

```tsx
  busy={a.busyId === m.id} addingOpen={a.addingId === m.id}
  onJoin={a.join}
  onLeave={a.leave}
  onRemovePlayer={a.removePlayer}
  onSetTeams={a.setTeams}
  onAddPlayer={a.addPlayerToTeam}
  onReplacePlayer={a.replacePlayer}
  onToggleAdd={a.onToggleAdd}
  onCancelAdd={a.onCancelAdd}
  onRecordResult={(mm) => a.setRecordingFor(mm)}
  canRecordResult={levelEnabled}
  onToggleInterest={a.toggleInterest}
  onOpenChat={a.openChat}
  showSport={multiSport}
  isAnonymous={!token}
  onAuthPrompt={a.setAuthPrompt}
```

(Dans la section « Pour toi », `isAnonymous={false}` était forcé car ce bloc n'existe que si `token` — on peut y mettre `isAnonymous={!token}` aussi, équivalent puisque le bloc est gardé par `token &&`.)

6. **Bandeau d'erreur** : remplacer `{error && (` par `{a.error && (` et `{error}` par `{a.error}`.

7. **Remplacer tout le bloc des 4 modales** en bas du `return` (depuis `{recordingFor && token && (` jusqu'au `)}` de l'AuthPromptDialog inclus) par :

```tsx
      <OpenMatchModals club={club} token={token} viewerUserId={viewerUserId} canModerate={canModerate} actions={a} reload={load} authNextPath="/parties" />
```

- [ ] **Step 5 : Lancer la suite (non-régression)**

Run: `cd frontend && npx jest OpenMatches`
Expected: PASS — comportement identique.

> Si un test échoue à cause d'un mock manquant (`api.*` appelé par une brique déplacée), aligner le mock du test comme avant — mais aucune nouvelle fonction `api.*` n'est introduite ici, donc les mocks existants suffisent.

- [ ] **Step 6 : Vérifier les types**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 7 : Commit**

```bash
git add frontend/components/openmatch/useOpenMatchActions.ts frontend/components/openmatch/OpenMatchModals.tsx frontend/components/openmatch/OpenMatches.tsx
git commit -m "refactor(open-match): hook useOpenMatchActions + OpenMatchModals partagés"
```

---

## Task 7 : Frontend — composant client `OpenMatchDetail`

**Files:**
- Create: `frontend/components/openmatch/OpenMatchDetail.tsx`
- Test: `frontend/__tests__/OpenMatchDetail.test.tsx`

- [ ] **Step 1 : Test d'abord**

Le composant monte le **vrai** `ClubNav` → le mock `lib/api` doit couvrir tout ce que `ClubNav` charge (reprendre le bloc de mock d'`OpenMatches.test.tsx`) + `getOpenMatch`. On mocke `useClub` pour fournir un club padel.

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { OpenMatchDetail } from '../components/openmatch/OpenMatchDetail';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  usePathname: () => '/parties/m1',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

const club = { id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris', clubSports: [{ sport: { key: 'padel' } }], levelSystemEnabled: true } as never;
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club, loading: false, slug: 'demo' }) }));

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  notificationsStreamUrl: () => 'http://x/stream',
  chatStreamUrl: () => 'http://x/stream',
  api: {
    getMyProfile: jest.fn().mockResolvedValue({ id: 'u1', firstName: 'T', lastName: 'U', email: 't@x.fr', avatarUrl: null }),
    getMyClubs: jest.fn().mockResolvedValue([]),
    getMyRating: jest.fn().mockResolvedValue(null),
    getMyMemberships: jest.fn().mockResolvedValue([]),
    listFollowing: jest.fn().mockResolvedValue([]),
    listClubFriends: jest.fn().mockResolvedValue([]),
    getMyReservations: jest.fn().mockResolvedValue([]),
    getMyTournaments: jest.fn().mockResolvedValue([]),
    getMyEvents: jest.fn().mockResolvedValue([]),
    getMyLessons: jest.fn().mockResolvedValue([]),
    getUnreadCount: jest.fn().mockResolvedValue({ count: 0 }),
    getNotifications: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    markNotificationRead: jest.fn().mockResolvedValue({ ok: true }),
    markAllNotificationsRead: jest.fn().mockResolvedValue({ ok: true }),
    getOpenMatchUnread: jest.fn().mockResolvedValue({ count: 0 }),
    getOpenMatch: jest.fn(),
  },
}));
beforeAll(() => { (global as any).EventSource = class { onmessage: any = null; onerror: any = null; close() {} }; });
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const future = new Date(Date.now() + 48 * 3600e3).toISOString();
const match = {
  id: 'm1', resourceName: 'Terrain 1', startTime: future, endTime: future, sport: { key: 'padel', name: 'Padel' },
  maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
  players: [{ userId: 'u-org', firstName: 'Org', lastName: 'A', avatarUrl: null, isOrganizer: true, team: 1 }],
  interestedCount: 0, viewerIsInterested: false, interested: [], lastMessageAt: null, unreadCount: 0,
};

describe('OpenMatchDetail', () => {
  beforeEach(() => { document.cookie = 'token=abc; path=/'; jest.clearAllMocks(); });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('affiche la carte de la partie et la barre de partage', async () => {
    mocked.getOpenMatch.mockResolvedValue(match as never);
    render(<ThemeProvider><OpenMatchDetail matchId="m1" /></ThemeProvider>);
    expect(await screen.findByText('Terrain 1')).toBeInTheDocument();
    expect(screen.getByText('Ajouter au calendrier')).toBeInTheDocument();
  });

  it('affiche un état « n’existe plus » sur 404', async () => {
    mocked.getOpenMatch.mockRejectedValue(new Error('RESERVATION_NOT_FOUND'));
    render(<ThemeProvider><OpenMatchDetail matchId="nope" /></ThemeProvider>);
    expect(await screen.findByText(/n'existe plus/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `cd frontend && npx jest OpenMatchDetail`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, OpenMatch } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { Icon } from '@/components/ui/Icon';
import { clubHasPadel } from '@/lib/sport';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { rangeLabel } from '@/lib/levelMatch';
import { OpenMatchCard } from '@/components/openmatch/OpenMatchCard';
import { OpenMatchModals } from '@/components/openmatch/OpenMatchModals';
import { useOpenMatchActions } from '@/components/openmatch/useOpenMatchActions';
import { ShareActions } from '@/components/tournament/ShareActions';

// /parties/[id] — vue détaillée d'une partie ouverte (cible d'un lien partagé).
export function OpenMatchDetail({ matchId }: { matchId: string }) {
  const { club, loading } = useClub();
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const router = useRouter();

  const [match, setMatch] = useState<OpenMatch | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>('loading');
  const [myLevel, setMyLevel] = useState<number | null>(null);
  const [viewerUserId, setViewerUserId] = useState('');
  const [canModerate, setCanModerate] = useState(false);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());

  const noPadel = !!club && !clubHasPadel(club);
  useEffect(() => { if (noPadel) router.replace('/'); }, [noPadel, router]);

  const reload = useCallback(async () => {
    if (!club) return;
    try { setMatch(await api.getOpenMatch(club.slug, matchId, token ?? undefined)); setStatus('ready'); }
    catch { setStatus('notfound'); }
  }, [club, matchId, token]);

  useEffect(() => { if (ready && club) reload(); }, [ready, club, reload]);

  useEffect(() => { if (token) api.getMyRating(token, 'padel').then((r) => setMyLevel(r?.level ?? null)).catch(() => {}); }, [token]);
  useEffect(() => { if (token) api.getMyProfile(token).then((p) => setViewerUserId(p.id)).catch(() => {}); }, [token]);
  useEffect(() => { if (token && club) api.getMyClubs(token).then((list) => setCanModerate(list.some((c) => c.slug === club.slug && (c.role === 'OWNER' || c.role === 'ADMIN')))).catch(() => {}); }, [token, club]);
  useEffect(() => { if (token) api.listFollowing(token).then((fs) => setFriendIds(new Set(fs.map((f) => f.id)))).catch(() => {}); }, [token]);

  const a = useOpenMatchActions({ club: club!, token, myLevel, reload });

  if (loading || !club) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (noPadel) return <div style={{ minHeight: '100vh', background: th.bg }} />;

  const back = (
    <Link href="/parties" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 14, color: th.textMute, textDecoration: 'none', padding: '16px 20px 0' }}>
      <Icon name="chevron-left" size={16} color={th.textMute} /> Parties
    </Link>
  );

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />
        {back}
        {status === 'loading' && (
          <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
        )}
        {status === 'notfound' && (
          <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
            Cette partie n&apos;existe plus.
          </div>
        )}
        {status === 'ready' && match && (
          <>
            <ShareActions
              uidPrefix="match"
              item={{
                id: match.id,
                name: `Partie ouverte · ${match.resourceName}`,
                description: [
                  match.full ? 'Complet' : `${match.spotsLeft} place${match.spotsLeft > 1 ? 's' : ''}`,
                  (match.targetLevelMin != null || match.targetLevelMax != null) ? rangeLabel(match.targetLevelMin ?? null, match.targetLevelMax ?? null) : null,
                  club.name,
                ].filter(Boolean).join(' · '),
                startTime: match.startTime,
                endTime: match.endTime,
                club: { name: club.name },
              }}
            />
            {a.error && (
              <div style={{ margin: '14px 20px 0', background: th.accent, color: th.onAccent, borderRadius: 12, padding: '10px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{a.error}</div>
            )}
            <div style={{ padding: '14px 20px 0' }}>
              <OpenMatchCard
                match={match} friendIds={friendIds} timezone={club.timezone} slug={club.slug} token={token ?? ''}
                busy={a.busyId === match.id} addingOpen={a.addingId === match.id}
                onJoin={a.join} onLeave={a.leave} onRemovePlayer={a.removePlayer} onSetTeams={a.setTeams}
                onAddPlayer={a.addPlayerToTeam} onReplacePlayer={a.replacePlayer}
                onToggleAdd={a.onToggleAdd} onCancelAdd={a.onCancelAdd}
                onRecordResult={(mm) => a.setRecordingFor(mm)} canRecordResult={club.levelSystemEnabled !== false}
                onToggleInterest={a.toggleInterest} onOpenChat={a.openChat}
                showSport={clubIsMultiSport(club)} isAnonymous={!token} onAuthPrompt={a.setAuthPrompt}
              />
            </div>
          </>
        )}
      </div>
      <OpenMatchModals club={club} token={token} viewerUserId={viewerUserId} canModerate={canModerate} actions={a} reload={reload} authNextPath={`/parties/${matchId}`} />
    </Screen>
  );
}
```

> Vérifier le nom de l'icône chevron dans `components/ui/Icon.tsx` (chercher `chevron`). Si l'icône « chevron-left » n'existe pas, utiliser le nom réel (ex. `chevronLeft`/`arrow-left`) ou remplacer par le texte `← Parties`.

- [ ] **Step 4 : Lancer → succès**

Run: `cd frontend && npx jest OpenMatchDetail`
Expected: PASS.

- [ ] **Step 5 : Vérifier les types**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/openmatch/OpenMatchDetail.tsx frontend/__tests__/OpenMatchDetail.test.tsx
git commit -m "feat(open-match): page détail OpenMatchDetail (carte + partage)"
```

---

## Task 8 : Frontend — page serveur `/parties/[id]` + `generateMetadata` (OG)

**Files:**
- Create: `frontend/app/parties/[id]/page.tsx`

- [ ] **Step 1 : Implémenter la page serveur**

```tsx
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { api } from '@/lib/api';
import { rangeLabel } from '@/lib/levelMatch';
import { OpenMatchDetail } from '@/components/openmatch/OpenMatchDetail';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Métadonnées Open Graph : aperçu riche du lien partagé (WhatsApp/SMS). Fetch anonyme
// (crawler) ; tout échec → repli neutre, jamais d'exception (pas de page 500 pour un aperçu).
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const slug = (await headers()).get('x-club-slug');
  if (!slug) return { title: 'Partie ouverte · Palova' };
  try {
    const [club, match] = await Promise.all([api.getClub(slug), api.getOpenMatch(slug, id)]);
    const when = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: club.timezone }).format(new Date(match.startTime));
    const places = match.full ? 'Complet' : `${match.spotsLeft} place${match.spotsLeft > 1 ? 's' : ''}`;
    const level = (match.targetLevelMin != null || match.targetLevelMax != null) ? rangeLabel(match.targetLevelMin ?? null, match.targetLevelMax ?? null) : null;
    const title = `Partie ouverte · ${match.resourceName}`;
    const description = [when, places, level, club.name].filter(Boolean).join(' · ');
    const image = `${API_URL}/api/clubs/${slug}/icon/512.png`;
    return {
      title,
      description,
      openGraph: { title, description, images: [image], type: 'website' },
      twitter: { card: 'summary', title, description, images: [image] },
    };
  } catch {
    return { title: 'Partie ouverte · Palova' };
  }
}

export default async function OpenMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpenMatchDetail matchId={id} />;
}
```

- [ ] **Step 2 : Vérifier les types + build de type**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

> Note Next 16 : `params` est une `Promise` (toujours `await`). Le fetch serveur via `api.getClub`/`api.getOpenMatch` fonctionne côté serveur (même mécanisme que `api.resolveClubSlug` dans `app/layout.tsx`).

- [ ] **Step 3 : Vérification manuelle rapide (optionnelle mais recommandée)**

Démarrer backend + frontend, ouvrir `http://<slug>.localhost:3000/parties/<id-d-une-partie-publique>` :
- la carte s'affiche, « Partager » et « Ajouter au calendrier » présents ;
- `curl -s http://<slug>.localhost:3000/parties/<id>` (ou voir le HTML) contient les balises `og:title`/`og:description`.

- [ ] **Step 4 : Commit**

```bash
git add frontend/app/parties/[id]/page.tsx
git commit -m "feat(open-match): page /parties/[id] serveur + Open Graph"
```

---

## Task 9 : Documentation — section CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1 : Ajouter une section**

Après la section « Équipes gauche/droite des matchs padel » (dernière section « ✅ implémenté »), insérer :

```markdown
## Partage d'une partie ouverte (v1) ✅ implémenté

Chaque partie ouverte (padel, `Reservation` `visibility:PUBLIC`) a une **page dédiée partageable `/parties/[id]`**. Backend : `GET /api/clubs/:slug/open-matches/:id` (`optionalAuth`, **public**, autorise les parties **passées** pour qu'un lien résolve toujours ; 404 `RESERVATION_NOT_FOUND` si non-PUBLIC / mauvais club / non-padel) ; le mapping DTO est factorisé (`MATCH_INCLUDE` + `OpenMatchService.toDTO`) et **partagé** avec `listOpenMatches` (forme de réponse inchangée). Front : `api.getOpenMatch`. **Bouton « Partager »** (Web Share API + repli copie-lien, `components/openmatch/MatchShareButton.tsx`) sur **chaque carte** de `/parties` (URL explicite `${origin}/parties/${id}`, visible de **tous** y compris anonyme) **et** sur la page détail (barre `ShareActions` réutilisée, `uidPrefix` élargi à `'match'`, + « Ajouter au calendrier » .ics). La page `app/parties/[id]/page.tsx` est un **composant serveur** avec `generateMetadata` (slug via `x-club-slug`, fetch anonyme du club + de la partie → **balises Open Graph**, image = icône club `icon/512.png` ; tout échec → repli neutre) enveloppant l'enfant client `OpenMatchDetail`. **Refactor** : la logique d'actions (`useOpenMatchActions`) et les 4 modales (`OpenMatchModals`) sont extraites d'`OpenMatches` et réutilisées par la liste et la page détail (une seule source de vérité) ; l'`AuthPromptDialog` renvoie vers `next` = chemin courant (le destinataire d'un lien revient sur la partie après login). Aucune migration. Tests : `openMatch.service` (getOpenMatch), route, `MatchShareButton`, `OpenMatchCard` (bouton), `OpenMatchDetail`, `tournament` (ICS 'match'). Spec & plan : `docs/superpowers/{specs,plans}/2026-07-01-partager-partie-ouverte*`.
```

- [ ] **Step 2 : Commit**

```bash
git add CLAUDE.md
git commit -m "docs: section partage d'une partie ouverte"
```

---

## Task 10 : Vérification finale

- [ ] **Step 1 : Suites backend touchées**

Run: `cd backend && npx jest openMatch.service clubs.openmatch-chat`
Expected: PASS.

- [ ] **Step 2 : Suites frontend touchées**

Run: `cd frontend && npx jest OpenMatches OpenMatchCard OpenMatchDetail MatchShareButton tournament.test`
Expected: PASS.

- [ ] **Step 3 : Types frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4 : Types/compilation backend**

Run: `cd backend && npx tsc --noEmit`
Expected: aucune erreur.

> ⚠️ Rappel mémoire : la suite complète `npx jest` (frontend) présente ~6 échecs `BookingModal` **pré-existants** (flake d'isolation, passe en isolé). Ne pas les confondre avec une régression de cette feature — valider par suites ciblées + tsc.

- [ ] **Step 5 : Commit final éventuel** (si des ajustements ont été nécessaires)

```bash
git add -A
git commit -m "chore(open-match): finalisation partage de partie ouverte"
```

---

## Récapitulatif des fichiers

**Backend**
- `backend/src/services/openMatch.service.ts` — `MATCH_INCLUDE`, `MatchRow`, `toDTO`, `getOpenMatch` ; `listOpenMatches` refactoré.
- `backend/src/routes/clubs.ts` — `GET /:slug/open-matches/:id`.
- Tests : `openMatch.service.test.ts`, `clubs.openmatch-chat.routes.test.ts`.

**Frontend**
- `frontend/lib/api.ts` — `getOpenMatch`.
- `frontend/lib/tournament.ts` + `components/tournament/ShareActions.tsx` — `uidPrefix: 'match'`.
- `frontend/components/openmatch/MatchShareButton.tsx` — **nouveau**.
- `frontend/components/openmatch/useOpenMatchActions.ts` — **nouveau** (hook).
- `frontend/components/openmatch/OpenMatchModals.tsx` — **nouveau**.
- `frontend/components/openmatch/OpenMatchCard.tsx` — bouton Partager.
- `frontend/components/openmatch/OpenMatches.tsx` — consomme hook + modales.
- `frontend/components/openmatch/OpenMatchDetail.tsx` — **nouveau** (client).
- `frontend/app/parties/[id]/page.tsx` — **nouveau** (serveur, OG).
- Tests : `MatchShareButton`, `OpenMatchCard`, `OpenMatchDetail`, `tournament`, `OpenMatches` (non-régression).

**Docs**
- `CLAUDE.md` — section ; specs/plans `2026-07-01-partager-partie-ouverte*`.
