# Interrupteur club « système de niveau » — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un club peut désactiver le système de niveau de joueur (`Club.levelSystemEnabled`) ; OFF ⇒ tout l'affichage de niveau masqué + saisie de résultats bloquée + leaderboard/back-office matchs inaccessibles.

**Architecture:** Un booléen additif sur `Club` (défaut `true`), exposé dans le payload public du club (donc lisible partout via `useClub()`). Backend : gate `403 LEVEL_SYSTEM_DISABLED` sur les chemins actifs (création de match, leaderboard, back-office matchs). Frontend : les 2 primitives d'affichage (`LevelChip`, `LevelBadge`) s'auto-masquent via un hook `useLevelSystemEnabled()` ; les surfaces actives (onglet Classement, matchmaking, reco « Pour toi », entrées « Saisir le résultat », onglet « Matchs », nav admin) sont gatées chez leurs parents.

**Tech Stack:** Backend Express 5 + Prisma 7 (adapter-pg) + Jest (`prismaMock`/supertest). Frontend Next.js 16 + React 19 + RTL.

**Spec :** `docs/superpowers/specs/2026-06-17-interrupteur-niveau-club-design.md`

**Convention de statut HTTP (décision d'implémentation) :** un seul code d'erreur `LEVEL_SYSTEM_DISABLED` → **403** partout (consolide les 404/403 de la spec ; les surfaces de lecture ne sont de toute façon plus appelées par le front quand OFF).

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `backend/prisma/schema.prisma` + migration `add_level_system_enabled` | colonne `Club.levelSystemEnabled Boolean @default(true)` |
| `backend/src/services/club.service.ts` | exposer le flag (public + update admin) + gate leaderboard |
| `backend/src/services/match.service.ts` | gate `createFromReservation` |
| `backend/src/routes/reservations.ts` | mapping erreur `LEVEL_SYSTEM_DISABLED` → 403 |
| `backend/src/routes/clubs.ts` | mapping erreur leaderboard → 403 |
| `backend/src/routes/admin.ts` | gate des 3 routes `/matches` → 403 |
| `frontend/lib/api.ts` | champ `levelSystemEnabled` sur `ClubDetail`/`ClubAdminDetail`/`UpdateClubBody` |
| `frontend/lib/useLevelSystem.ts` (nouveau) | hook `useLevelSystemEnabled()` |
| `frontend/components/player/{LevelChip,LevelBadge}.tsx` | auto-masquage |
| `frontend/components/openmatch/OpenMatches.tsx`, `OpenMatchCard.tsx` | gate Classement/matchmaking/Pour toi/record |
| `frontend/components/ClubHouse.tsx` | gate `MatchesForYou` |
| `frontend/app/me/reservations/page.tsx` | gate onglet « Matchs » + entrées record |
| `frontend/app/me/profile/page.tsx` | gate section niveau (badge/calibration/courbe) |
| `frontend/app/admin/layout.tsx` | masquer le lien nav « Matchs » |
| `frontend/app/admin/settings/page.tsx` | case à cocher |

**Environnement :** Postgres via `docker-compose-v1.exe up -d`. Back tests `cd backend && npm test` (Prisma mocké). Front tests `cd frontend && npm test`. **On travaille directement sur `main` ; le fichier `frontend/components/clubhouse/PartnerOffers.tsx` est un WIP utilisateur non lié — NE JAMAIS le stager/commiter. Chaque commit `git add` UNIQUEMENT ses fichiers.**

---

## Task 1 : Schéma — `Club.levelSystemEnabled`

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `Club`)
- Create (généré): `backend/prisma/migrations/<ts>_add_level_system_enabled/migration.sql`

- [ ] **Step 1 : Ajouter la colonne**

Dans `model Club { … }`, à côté des autres flags (ex. après `showOtherClubsReservations`) :

```prisma
  levelSystemEnabled Boolean @default(true) @map("level_system_enabled")
```

- [ ] **Step 2 : Générer + appliquer la migration**

Run: `cd backend && npx prisma migrate dev --name add_level_system_enabled`
Expected: `migration.sql` = `ALTER TABLE "clubs" ADD COLUMN "level_system_enabled" BOOLEAN NOT NULL DEFAULT true;` (additif, pas de prompt destructif ; si reset proposé → STOP/BLOCKED).

- [ ] **Step 3 : Régénérer + typecheck**

Run: `cd backend && npx prisma generate && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(niveau): Club.levelSystemEnabled (migration additive, défaut true)"
```

---

## Task 2 : Backend — exposer le flag (payload public + update admin)

**Files:**
- Modify: `backend/src/services/club.service.ts` (`getClubBySlug` ~141-168 ; `updateClub` ~193-256)
- Test: `backend/src/services/__tests__/club.service.test.ts` (ou le fichier de tests existant du club service ; sinon ajouter au plus proche)

- [ ] **Step 1 : Écrire les tests qui échouent**

Repérer le fichier de tests de `ClubService` (`grep -rl "getClubBySlug\|updateClub" backend/src/**/__tests__`). Y ajouter :

```typescript
describe('levelSystemEnabled exposition', () => {
  it('getClubBySlug renvoie levelSystemEnabled', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      id: 'c1', slug: 'demo', name: 'Demo', levelSystemEnabled: false, clubSports: [],
    } as any);
    const res = await service.getClubBySlug('demo');
    expect(res!.levelSystemEnabled).toBe(false);
  });

  it('updateClub accepte levelSystemEnabled', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await service.updateClub('c1', { levelSystemEnabled: false } as any);
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.levelSystemEnabled).toBe(false);
  });
});
```

> Adapter le nom de l'instance (`service`/`clubService`) et la forme du mock à ce que le fichier de tests utilise déjà (regarder un test voisin de `getClubBySlug`).

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd backend && npm test -- club.service.test.ts -t levelSystemEnabled`
Expected: FAIL (champ absent du `select` / non whitelu).

- [ ] **Step 3 : Implémenter**

Dans `getClubBySlug`, ajouter `levelSystemEnabled: true` au bloc `select` (à côté de `showOtherClubsReservations`), et au mapping de retour si la méthode reconstruit un objet (sinon le `select` suffit).

Dans `updateClub` : ajouter au type des params `levelSystemEnabled?: boolean;` et, dans le spread `data`, la même garde whitelist que les autres booléens :

```typescript
...(typeof params.levelSystemEnabled === 'boolean' ? { levelSystemEnabled: params.levelSystemEnabled } : {}),
```

Vérifier aussi que la méthode admin qui lit le club (`adminGetClub`/équivalent renvoyant `ClubAdminDetail`) **inclut** `levelSystemEnabled` (l'ajouter à son `select` si elle en a un).

- [ ] **Step 4 : Vérifier le succès**

Run: `cd backend && npm test -- club.service.test.ts` puis `npx tsc --noEmit`
Expected: PASS + tsc clean.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(niveau): exposer levelSystemEnabled (club public + update admin)"
```

---

## Task 3 : Backend — bloquer la saisie de résultat

**Files:**
- Modify: `backend/src/services/match.service.ts` (`createFromReservation` ~22-79)
- Modify: `backend/src/routes/reservations.ts` (map d'erreurs ~11-44)
- Test: `backend/src/services/__tests__/match.service.test.ts` + `backend/src/routes/__tests__/<reservations-match>.routes.test.ts`

- [ ] **Step 1 : Écrire le test service qui échoue**

Dans `match.service.test.ts`, le `RES` mocké (haut du fichier) ressemble à `{ resource: { clubId, clubSport: { sportId } }, participants: [...] }`. Ajouter, dans un nouveau test de `createFromReservation`, un club OFF :

```typescript
it('refuse la saisie si le système de niveau est désactivé pour le club', async () => {
  prismaMock.reservation.findUnique.mockResolvedValue({
    ...RES,
    resource: { clubId: 'c1', clubSport: { sportId: 'sport-padel' }, club: { levelSystemEnabled: false } },
  } as any);
  await expect(service.createFromReservation('r1', 'u1', { teams, sets, now: NOW }))
    .rejects.toThrow('LEVEL_SYSTEM_DISABLED');
});
```

Et s'assurer que le `RES` par défaut (cas nominal) expose `resource.club.levelSystemEnabled: true` pour ne pas casser les tests existants : modifier la constante `RES` du haut du fichier pour ajouter `club: { levelSystemEnabled: true }` dans `resource`.

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd backend && npm test -- match.service.test.ts -t "système de niveau"`
Expected: FAIL (pas de garde).

- [ ] **Step 3 : Implémenter le gate service**

Dans `createFromReservation`, ajouter `club: { select: { levelSystemEnabled: true } }` au `select` de `resource` du `findUnique`, puis après les validations existantes (participant + passé), avant la création :

```typescript
if (!reservation.resource.club.levelSystemEnabled) throw new Error('LEVEL_SYSTEM_DISABLED');
```

- [ ] **Step 4 : Mapper l'erreur dans la route + test route**

Dans `backend/src/routes/reservations.ts`, ajouter à la map d'erreurs (lignes ~11-44) :

```typescript
  LEVEL_SYSTEM_DISABLED: 403,
```

Dans le fichier de tests de route couvrant `POST /:id/match` (repérer via `grep -rl "/:id/match\|createFromReservation" backend/src/routes/__tests__`), ajouter :

```typescript
it('POST /:id/match → 403 si système de niveau désactivé', async () => {
  jest.spyOn(require('../../services/match.service').matchService, 'createFromReservation')
    .mockRejectedValue(new Error('LEVEL_SYSTEM_DISABLED'));
  const res = await request(app)
    .post('/api/reservations/r1/match')
    .set('Authorization', `Bearer ${token()}`)
    .send({ teams: { 1: ['u1','u2'], 2: ['u3','u4'] }, sets: [[6,4],[6,3]] });
  expect(res.status).toBe(403);
});
```

> Adapter `token()`/le helper d'auth au pattern du fichier. Si la route utilise l'instance `matchService` exportée, le `spyOn` cible la bonne instance (le singleton existe depuis la feature précédente).

- [ ] **Step 5 : Vérifier**

Run: `cd backend && npm test -- match.service.test.ts` puis le fichier de route, puis `npm test` complet, puis `npx tsc --noEmit`.
Expected: tout vert.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/services/match.service.ts backend/src/routes/reservations.ts backend/src/services/__tests__/match.service.test.ts backend/src/routes/__tests__/
git commit -m "feat(niveau): bloquer la saisie de résultat si club OFF (403)"
```

---

## Task 4 : Backend — gate leaderboard + back-office matchs

**Files:**
- Modify: `backend/src/services/club.service.ts` (`clubLeaderboard` ~387)
- Modify: `backend/src/routes/clubs.ts` (map d'erreurs ~30-49)
- Modify: `backend/src/routes/admin.ts` (3 routes `/matches` ~718-748)
- Test: `club.service.test.ts` + `match-admin.routes.test.ts` + (route leaderboard si testée)

- [ ] **Step 1 : Tests qui échouent**

`club.service.test.ts` :
```typescript
it('clubLeaderboard refuse si le club a désactivé le niveau', async () => {
  prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', levelSystemEnabled: false } as any);
  // (mocker la vérif de membership comme les autres tests du leaderboard)
  await expect(service.clubLeaderboard('demo', 'u1')).rejects.toThrow('LEVEL_SYSTEM_DISABLED');
});
```

`match-admin.routes.test.ts` (le club OFF doit 403 sur la liste) :
```typescript
it('GET /admin/matches → 403 si club OFF', async () => {
  prismaMock.club.findUnique.mockResolvedValue({ levelSystemEnabled: false } as any);
  const res = await request(app).get('/api/clubs/c1/admin/matches?status=DISPUTED')
    .set('Authorization', `Bearer ${token()}`);
  expect(res.status).toBe(403);
});
```

> Vérifier la forme du mock de club déjà utilisée par ces fichiers et l'aligner. Pour la liste admin existante (cas ON), s'assurer que `prismaMock.club.findUnique` renvoie `levelSystemEnabled: true` (ou que le gate lit le flag via une requête distincte mockée à `true`).

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd backend && npm test -- club.service.test.ts -t leaderboard` et `npm test -- match-admin.routes.test.ts -t "club OFF"`
Expected: FAIL.

- [ ] **Step 3 : Implémenter**

`clubLeaderboard` : ajouter `levelSystemEnabled: true` au `select` du `club.findUnique`, et après la résolution du club (avant de calculer) :
```typescript
if (!club.levelSystemEnabled) throw new Error('LEVEL_SYSTEM_DISABLED');
```

`clubs.ts` map d'erreurs : ajouter `LEVEL_SYSTEM_DISABLED: 403,`.

`admin.ts` — gate des 3 routes `/matches`. Ajouter un petit helper en haut du fichier (ou inline dans chaque handler) :
```typescript
async function assertLevelSystem(clubId: string): Promise<void> {
  const c = await prisma.club.findUnique({ where: { id: clubId }, select: { levelSystemEnabled: true } });
  if (!c || !c.levelSystemEnabled) throw new Error('LEVEL_SYSTEM_DISABLED');
}
```
Au début de chaque handler `/matches` (`GET`, `/:matchId/resolve`, `/:matchId/void`), avant l'appel service :
```typescript
await assertLevelSystem(asString(req.params.clubId));
```
Et dans chaque `catch`, ajouter le mapping :
```typescript
if (err instanceof Error && err.message === 'LEVEL_SYSTEM_DISABLED') { res.status(403).json({ error: 'LEVEL_SYSTEM_DISABLED' }); return; }
```

- [ ] **Step 4 : Vérifier**

Run: `cd backend && npm test` puis `npx tsc --noEmit`
Expected: tout vert (anciens tests admin matches : leur mock de `prisma.club.findUnique` doit renvoyer `levelSystemEnabled: true` — les ajuster si besoin).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/routes/clubs.ts backend/src/routes/admin.ts backend/src/services/__tests__/club.service.test.ts backend/src/routes/__tests__/match-admin.routes.test.ts
git commit -m "feat(niveau): gate 403 leaderboard + back-office matchs si club OFF"
```

---

## Task 5 : Frontend — types + hook `useLevelSystemEnabled`

**Files:**
- Modify: `frontend/lib/api.ts` (`ClubDetail` ~643 ; `ClubAdminDetail` ~817 ; `UpdateClubBody` ~901)
- Create: `frontend/lib/useLevelSystem.ts`
- Test: `frontend/__tests__/useLevelSystem.test.tsx` (nouveau)

- [ ] **Step 1 : Test qui échoue**

```tsx
// frontend/__tests__/useLevelSystem.test.tsx
import { renderHook } from '@testing-library/react';
import { useLevelSystemEnabled } from '../lib/useLevelSystem';

const clubVal: { club: { levelSystemEnabled?: boolean } | null } = { club: null };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => clubVal }));

it('true quand club null (rétrocompat)', () => {
  clubVal.club = null;
  expect(renderHook(() => useLevelSystemEnabled()).result.current).toBe(true);
});
it('true quand activé', () => {
  clubVal.club = { levelSystemEnabled: true };
  expect(renderHook(() => useLevelSystemEnabled()).result.current).toBe(true);
});
it('false quand désactivé', () => {
  clubVal.club = { levelSystemEnabled: false };
  expect(renderHook(() => useLevelSystemEnabled()).result.current).toBe(false);
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd frontend && npm test -- useLevelSystem`
Expected: FAIL (module absent).

- [ ] **Step 3 : Implémenter**

```typescript
// frontend/lib/useLevelSystem.ts
'use client';
import { useClub } from './ClubProvider';

/** Le système de niveau est-il actif pour le club courant ? club absent/inconnu → considéré actif (rétrocompat). */
export function useLevelSystemEnabled(): boolean {
  const { club } = useClub();
  return club?.levelSystemEnabled !== false;
}
```

Dans `frontend/lib/api.ts` : ajouter `levelSystemEnabled: boolean;` à `ClubDetail`, `levelSystemEnabled: boolean;` à `ClubAdminDetail`, et `levelSystemEnabled?: boolean;` à `UpdateClubBody`.

- [ ] **Step 4 : Vérifier**

Run: `cd frontend && npm test -- useLevelSystem` puis `npx tsc --noEmit` (ignorer les erreurs dans `.next/`)
Expected: PASS + pas d'erreur hors `.next/`.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/api.ts frontend/lib/useLevelSystem.ts frontend/__tests__/useLevelSystem.test.tsx
git commit -m "feat(niveau): type levelSystemEnabled + hook useLevelSystemEnabled"
```

---

## Task 6 : Frontend — auto-masquage des primitives d'affichage

**Files:**
- Modify: `frontend/components/player/LevelChip.tsx`, `frontend/components/player/LevelBadge.tsx`
- Test: `frontend/__tests__/LevelChip.test.tsx` (nouveau ; couvre les deux)

- [ ] **Step 1 : Test qui échoue**

```tsx
// frontend/__tests__/LevelChip.test.tsx
import { render, screen } from '@testing-library/react';
import { LevelChip } from '../components/player/LevelChip';
import { LevelBadge } from '../components/player/LevelBadge';

const clubVal: { club: { levelSystemEnabled?: boolean } | null } = { club: { levelSystemEnabled: true } };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => clubVal }));

const lvl = { level: 4.2, tier: 'Intermédiaire', isProvisional: false };

it('LevelChip affiche le niveau quand activé', () => {
  clubVal.club = { levelSystemEnabled: true };
  render(<LevelChip level={lvl as any} />);
  expect(screen.getByText('4.2')).toBeInTheDocument();
});
it('LevelChip ne rend rien quand désactivé', () => {
  clubVal.club = { levelSystemEnabled: false };
  const { container } = render(<LevelChip level={lvl as any} />);
  expect(container).toBeEmptyDOMElement();
});
it('LevelBadge ne rend rien quand désactivé', () => {
  clubVal.club = { levelSystemEnabled: false };
  const { container } = render(<LevelBadge rating={{ level: 4.2, tier: 'Intermédiaire', isProvisional: false } as any} />);
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd frontend && npm test -- LevelChip`
Expected: FAIL (le chip s'affiche même désactivé).

- [ ] **Step 3 : Implémenter**

`LevelChip.tsx` — ajouter le hook et la garde :
```tsx
import { useLevelSystemEnabled } from '@/lib/useLevelSystem';
export function LevelChip({ level, size = 'sm' }: { level: UserLevel | null | undefined; size?: 'xs' | 'sm' }) {
  const enabled = useLevelSystemEnabled();
  if (!enabled || !level) return null;
  // …reste inchangé…
}
```
`LevelBadge.tsx` — idem au début :
```tsx
import { useLevelSystemEnabled } from '@/lib/useLevelSystem';
export function LevelBadge({ rating }: { rating: MyRating }) {
  if (!useLevelSystemEnabled()) return null;
  // …reste inchangé…
}
```

> Couvre automatiquement `PlayerPills` (qui rend `<LevelChip>`) → annuaire, parties, events, tournois, Mes réservations, BookingModal ; et le badge profil.

- [ ] **Step 4 : Vérifier**

Run: `cd frontend && npm test -- LevelChip` puis `npm test` complet (s'assurer qu'aucun test existant de PlayerPills/OpenMatch ne casse — s'ils rendent sans `ClubProvider` mocké, `useClub()` renvoie le contexte par défaut `{ club: null }` → enabled=true, donc inchangé).
Expected: vert. Si un test existant échoue parce qu'il ne mocke pas `ClubProvider` et que le composant attend un club, ajouter le mock `useClub` à ce fichier (club avec `levelSystemEnabled: true`).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/player/LevelChip.tsx frontend/components/player/LevelBadge.tsx frontend/__tests__/LevelChip.test.tsx
git commit -m "feat(niveau): LevelChip/LevelBadge s'auto-masquent si club OFF"
```

---

## Task 7 : Frontend — gate des surfaces actives (parties + club-house)

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx`, `frontend/components/openmatch/OpenMatchCard.tsx`, `frontend/components/ClubHouse.tsx`
- Test: `frontend/__tests__/OpenMatches.test.tsx` (existant) ou nouveau bloc

- [ ] **Step 1 : Test qui échoue**

Dans le test d'`OpenMatches` (mocker `useClub`/props `club`), ajouter un cas OFF :
```tsx
it('club OFF : pas d onglet « Classement » ni reco « Pour toi »', async () => {
  // rendre OpenMatches avec club.levelSystemEnabled = false (prop ou mock)
  // …setup minimal des matches…
  render(/* OpenMatches avec club OFF */);
  expect(screen.queryByText('Classement')).not.toBeInTheDocument();
  expect(screen.queryByText(/Pour toi/i)).not.toBeInTheDocument();
});
```

> Regarder comment le test existant fournit `club` (prop directe `OpenMatches({ club })`). Utiliser `{ ...club, levelSystemEnabled: false }`.

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd frontend && npm test -- OpenMatches`
Expected: FAIL.

- [ ] **Step 3 : Implémenter**

`OpenMatches.tsx` — dériver `const levelEnabled = club.levelSystemEnabled !== false;` puis :
- onglet/segment « Classement » (~lignes 91-95) : ne le rendre que si `levelEnabled` (sinon forcer `view='parties'`).
- section « Pour toi »/recommended (~115-134) : envelopper `{levelEnabled && recommended.length > 0 && (…)}`.
- fourchette cible + filtre « à mon niveau » du matchmaking : ne les rendre que si `levelEnabled`.
- bouton « Saisir le résultat » : passer la capacité au card → ajouter une prop `canRecordResult: boolean` à `OpenMatchCard` et la passer `levelEnabled` ; dans `OpenMatchCard.tsx` (~ligne 77) n'afficher le `<Btn>…Saisir le résultat</Btn>` que si `canRecordResult`.

`ClubHouse.tsx` (~ligne 123) — envelopper le bloc `MatchesForYou` :
```tsx
{club.levelSystemEnabled !== false && matchRecos.length > 0 && ( … )}
```

- [ ] **Step 4 : Vérifier**

Run: `cd frontend && npm test -- OpenMatches` puis `npm test` complet puis `npx tsc --noEmit`
Expected: vert (cas ON inchangé).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/openmatch/OpenMatches.tsx frontend/components/openmatch/OpenMatchCard.tsx frontend/components/ClubHouse.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "feat(niveau): masquer Classement/matchmaking/Pour toi/record si club OFF"
```

---

## Task 8 : Frontend — Mes réservations (onglet Matchs + record) + profil

**Files:**
- Modify: `frontend/app/me/reservations/page.tsx`, `frontend/app/me/profile/page.tsx`
- Test: `frontend/__tests__/MeReservations.test.tsx` (ou existant) + `frontend/__tests__/MeProfile.test.tsx`

- [ ] **Step 1 : Tests qui échouent**

`MeReservations` — club OFF : l'onglet « Matchs » disparaît et aucune entrée « Saisir le résultat » :
```tsx
it('club OFF : pas d onglet « Matchs »', async () => {
  // mock useClub → club.levelSystemEnabled=false ; setup minimal
  render(/* page */);
  expect(screen.queryByText('Matchs')).not.toBeInTheDocument();
});
```
`MeProfile` — club OFF : pas de section niveau :
```tsx
it('club OFF : pas de carte niveau ni courbe', async () => {
  // mock useClub → levelSystemEnabled=false
  render(/* page */);
  expect(screen.queryByText(/calibrage|niveau/i)).not.toBeInTheDocument();
});
```

> Aligner sur les mocks existants de ces deux fichiers de test (ils mockent déjà `lib/api`, `useAuth`, `ClubProvider`). Ajouter `levelSystemEnabled` au club mické.

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd frontend && npm test -- MeReservations MeProfile`
Expected: FAIL.

- [ ] **Step 3 : Implémenter**

`me/reservations/page.tsx` — `const levelEnabled = club?.levelSystemEnabled !== false;` :
- retirer l'entrée `{ value: 'matches', label: 'Matchs' }` du Segmented (~ligne 156) quand `!levelEnabled` (filtrer le tableau de segments) ; si l'onglet courant était `matches`, retomber sur le défaut.
- ne pas passer `onRecordResult` (et/ou faire que `canRecord` renvoie `false`) aux listes/`DayPanel`/`MyAgendaListItem` quand `!levelEnabled` (~lignes 186, 223) → les boutons « Saisir le résultat » disparaissent.

`me/profile/page.tsx` — envelopper la section niveau (badge + `LevelCalibration` + `LevelHistoryChart`) dans `{club?.levelSystemEnabled !== false && ( … )}` (le `LevelBadge` s'auto-masque déjà, mais on gate le wrapper pour ne pas laisser un titre/carte vide).

- [ ] **Step 4 : Vérifier**

Run: `cd frontend && npm test -- MeReservations MeProfile` puis `npm test` complet puis `npx tsc --noEmit`
Expected: vert.

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/me/reservations/page.tsx frontend/app/me/profile/page.tsx frontend/__tests__/
git commit -m "feat(niveau): masquer onglet Matchs + record + section profil si club OFF"
```

---

## Task 9 : Frontend — nav admin + case `/admin/settings`

**Files:**
- Modify: `frontend/app/admin/layout.tsx` (~75 lien « Matchs »)
- Modify: `frontend/app/admin/settings/page.tsx`
- Test: `frontend/__tests__/AdminLayout.test.tsx` (existant) + test settings si existant

- [ ] **Step 1 : Tests qui échouent**

`AdminLayout` — club OFF : pas de lien « Matchs » :
```tsx
it('club OFF : pas de lien nav « Matchs »', () => {
  // mock useClub → levelSystemEnabled=false (garder le mock useRouter/useClub STABLE comme l'exige ce fichier)
  render(/* layout */);
  expect(screen.queryByText('Matchs')).not.toBeInTheDocument();
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd frontend && npm test -- AdminLayout`
Expected: FAIL.

- [ ] **Step 3 : Implémenter**

`admin/layout.tsx` — filtrer la liste des liens : retirer l'entrée `{ href: '/admin/matches', label: 'Matchs', … }` quand `club?.levelSystemEnabled === false`. (⚠️ ce fichier exige des mocks `useRouter`/`useClub` à identité stable — voir le test existant ; le club est dans les deps d'un `useEffect`.)

`admin/settings/page.tsx` — ajouter une carte/case après le toggle `listedInDirectory` (~ligne 239), suivant le pattern existant `set('levelSystemEnabled', e.target.checked)` :
```tsx
<label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
  <input type="checkbox" checked={club.levelSystemEnabled}
    onChange={(e) => set('levelSystemEnabled', e.target.checked)} />
  <span>Activer le système de niveau de joueur</span>
</label>
```
Et ajouter `levelSystemEnabled: club.levelSystemEnabled,` au `body` envoyé à `api.adminUpdateClub` (~ligne 139-154).

- [ ] **Step 4 : Vérifier**

Run: `cd frontend && npm test -- AdminLayout` puis `npm test` complet puis `npx tsc --noEmit`
Expected: vert.

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/admin/layout.tsx frontend/app/admin/settings/page.tsx frontend/__tests__/AdminLayout.test.tsx
git commit -m "feat(niveau): nav admin Matchs masquée + case /admin/settings"
```

---

## Vérification finale (avant revue)

- [ ] `cd backend && npm test` vert + `npx tsc --noEmit` clean.
- [ ] `cd frontend && npm test` vert + `npx tsc --noEmit` clean (hors `.next/`).
- [ ] Migration `add_level_system_enabled` appliquée en dev.
- [ ] Diff relu : `frontend/components/clubhouse/PartnerOffers.tsx` JAMAIS commité.
- [ ] Sanity manuel optionnel : `/admin/settings` décocher → le niveau disparaît partout (pastilles, profil, Classement, matchmaking, « Saisir le résultat », nav admin « Matchs ») et `POST /api/reservations/:id/match` renvoie 403.

## Notes de couverture (spec → tâches)

- A. Donnée + exposition + update admin : Tasks 1, 2. ✅
- B. Backend gates (saisie 403 ; leaderboard ; back-office matchs) : Tasks 3, 4. ✅
- C. Frontend masquage (chips/badges ; profil ; parties Classement/matchmaking/Pour toi ; saisie+onglet Matchs ; nav admin) : Tasks 6, 7, 8, 9. ✅
- Défaut ON / rétrocompat (club absent → activé) : Task 1 (défaut DB) + Task 5 (hook). ✅
- Données conservées (on masque, pas de suppression) : aucune suppression dans le plan — acquis. ✅
- Enrichissement backend laissé tel quel : volontairement non gaté. ✅
