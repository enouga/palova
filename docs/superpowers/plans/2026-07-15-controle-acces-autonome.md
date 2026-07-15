# Contrôle d'accès autonome (Akiles + code fixe) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un code d'accès lié à chaque réservation COURT confirmée — mode `AKILES` (member temporaire + PIN via l'API Akiles, OAuth par club) et mode `STATIC_CODE` (digicode fixe du club affiché aux joueurs), diffusé dans l'app, par email dédié et dans les rappels.

**Architecture:** Approche A de la spec `docs/superpowers/specs/2026-07-15-controle-acces-autonome-design.md` : appels Akiles **inline best-effort** (pattern `safeNotify`) accrochés à la confirmation/annulation/déplacement, table `AccessGrant` pour tracer l'état externe, rattrapage auto par le `cleanup.job` minute. Config par club dans `ClubAccessConfig` (table séparée, refresh token chiffré AES-256-GCM). Le mode statique n'a ni grant ni retry : code lu en live.

**Tech Stack:** Prisma 7 (SQL additif à la main, `prisma db execute` en dev / `migrate deploy` en prod), Express, `jsonwebtoken` (state OAuth), `node:crypto` (AES-256-GCM), luxon (fuseaux), fetch natif (API Akiles), Next.js 16 + React Testing Library.

**Rappels d'environnement (mémoires projet) :**
- Shims `node_modules/.bin` cassés → lancer jest/tsc par `node node_modules/jest/bin/jest.js …` et `node node_modules/typescript/bin/tsc --noEmit` depuis `backend/` ou `frontend/`.
- Jamais `prisma migrate dev` ni `db push` (dérive de la base dev) : SQL à la main + `npx prisma db execute` + `npx prisma generate`.
- Eric travaille en parallèle dans le repo : **committer uniquement les fichiers du task** (`git add` explicite), vérifier `git branch --show-current` avant chaque commit.
- `registry.ts`, `notifications.ts` et leurs tests sont modifiés par un WIP parallèle : rebaser mentalement sur l'état du fichier au moment de l'exécution (ajouter l'entrée/fonction, ne rien réécrire d'autre).

---

## Fichiers

**Backend — créés** : `prisma/migrations/20260715120000_add_access_control/migration.sql`, `src/utils/secretBox.ts` (+ test), `src/services/access/akilesClient.ts` (+ test), `src/services/access/accessCode.ts` (+ test), `src/services/access/access.service.ts` (+ test), `src/routes/access.ts` (+ test routes admin).
**Backend — modifiés** : `prisma/schema.prisma`, `src/app.ts`, `src/routes/admin.ts`, `src/services/reservation.service.ts`, `src/services/openMatch.service.ts`, `src/email/registry.ts`, `src/email/notifications.ts`, `src/jobs/cleanup.job.ts`, `.env.prod.example`, `docker-compose.prod.yml`, `backend/.env` (dev).
**Frontend — créés** : `lib/access.ts` (+ test), `app/admin/access/page.tsx` (+ test `__tests__/AdminAccess.test.tsx`).
**Frontend — modifiés** : `lib/api.ts`, `app/admin/layout.tsx` (+ test), `components/booking/BookingSuccess.tsx` (+ test), `components/reservations/MyAgendaListItem.tsx`, `components/calendar/DayPanel.tsx`, `components/openmatch/OpenMatchCard.tsx` (+ tests).

---

### Task 1 : Migration `add_access_control` + schéma Prisma

**Files:**
- Create: `backend/prisma/migrations/20260715120000_add_access_control/migration.sql`
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1 : Écrire le SQL de migration**

```sql
-- Contrôle d'accès autonome : config par club + grants Akiles par réservation.
CREATE TYPE "AccessProviderKind" AS ENUM ('AKILES', 'STATIC_CODE');
CREATE TYPE "AccessGrantStatus" AS ENUM ('ACTIVE', 'FAILED', 'REVOKED', 'REVOKE_FAILED');

CREATE TABLE "club_access_configs" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "provider" "AccessProviderKind" NOT NULL,
    "static_code" TEXT,
    "akiles_refresh_token" TEXT,
    "akiles_org_name" TEXT,
    "akiles_default_group_id" TEXT,
    "resource_groups" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "club_access_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "club_access_configs_club_id_key" ON "club_access_configs"("club_id");
ALTER TABLE "club_access_configs" ADD CONSTRAINT "club_access_configs_club_id_fkey"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "access_grants" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "status" "AccessGrantStatus" NOT NULL,
    "code" TEXT,
    "akiles_member_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "access_grants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "access_grants_reservation_id_key" ON "access_grants"("reservation_id");
CREATE INDEX "access_grants_status_updated_at_idx" ON "access_grants"("status", "updated_at");
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 2 : Ajouter les modèles au schéma Prisma**

Dans `backend/prisma/schema.prisma`, après le modèle `MatchAlertHit` (fin des modèles), ajouter :

```prisma
// --- Contrôle d'accès autonome (Akiles + code fixe) ---

enum AccessProviderKind {
  AKILES
  STATIC_CODE
}

enum AccessGrantStatus {
  ACTIVE        // member + PIN créés chez Akiles
  FAILED        // création/màj en échec, en attente de retry
  REVOKED       // révoqué (annulation) — état terminal
  REVOKE_FAILED // DELETE member en échec, en attente de retry
}

model ClubAccessConfig {
  id                   String             @id @default(cuid())
  clubId               String             @unique @map("club_id")
  provider             AccessProviderKind
  staticCode           String?            @map("static_code")
  akilesRefreshToken   String?            @map("akiles_refresh_token") // CHIFFRÉ AES-256-GCM (secretBox), jamais en clair
  akilesOrgName        String?            @map("akiles_org_name")
  akilesDefaultGroupId String?            @map("akiles_default_group_id")
  resourceGroups       Json?              @map("resource_groups") // { [resourceId]: memberGroupId }
  createdAt            DateTime           @default(now()) @map("created_at")
  updatedAt            DateTime           @updatedAt @map("updated_at")

  club Club @relation(fields: [clubId], references: [id], onDelete: Cascade)

  @@map("club_access_configs")
}

model AccessGrant {
  id             String            @id @default(cuid())
  reservationId  String            @unique @map("reservation_id")
  clubId         String            @map("club_id")
  status         AccessGrantStatus
  code           String?
  akilesMemberId String?           @map("akiles_member_id")
  attempts       Int               @default(0)
  lastError      String?           @map("last_error")
  createdAt      DateTime          @default(now()) @map("created_at")
  updatedAt      DateTime          @updatedAt @map("updated_at")

  reservation Reservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)

  @@index([status, updatedAt])
  @@map("access_grants")
}
```

Puis ajouter les relations inverses : dans `model Club`, une ligne `accessConfig ClubAccessConfig?` ; dans `model Reservation` (à côté de `matchAlertHits MatchAlertHit[]`), une ligne `accessGrant AccessGrant?`.

- [ ] **Step 3 : Appliquer en dev + régénérer le client**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend
npx prisma db execute --file prisma/migrations/20260715120000_add_access_control/migration.sql
npx prisma generate
```
Attendu : exécution sans erreur, client régénéré.

- [ ] **Step 4 : Vérifier le typage**

```powershell
node node_modules/typescript/bin/tsc --noEmit
```
Attendu : mêmes erreurs qu'avant le task (aucune nouvelle — le WIP parallèle peut en avoir).

- [ ] **Step 5 : Commit**

```powershell
git add backend/prisma/schema.prisma backend/prisma/migrations/20260715120000_add_access_control/migration.sql
git commit -m "feat(acces): migration add_access_control (ClubAccessConfig + AccessGrant)"
```

---

### Task 2 : `secretBox` — chiffrement AES-256-GCM

**Files:**
- Create: `backend/src/utils/secretBox.ts`
- Test: `backend/src/utils/__tests__/secretBox.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
import { seal, open } from '../secretBox';

describe('secretBox', () => {
  const KEY = Buffer.alloc(32, 7).toString('base64');

  beforeEach(() => { process.env.ACCESS_ENCRYPTION_KEY = KEY; });
  afterEach(() => { delete process.env.ACCESS_ENCRYPTION_KEY; });

  it('chiffre puis déchiffre à l identique', () => {
    const sealed = seal('rt_secret_token');
    expect(sealed).not.toContain('rt_secret_token');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(open(sealed)).toBe('rt_secret_token');
  });

  it('deux seal du même texte diffèrent (IV aléatoire)', () => {
    expect(seal('abc')).not.toBe(seal('abc'));
  });

  it('refuse un texte altéré', () => {
    const sealed = seal('abc');
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(() => open(tampered)).toThrow();
  });

  it('clé absente → erreur explicite', () => {
    delete process.env.ACCESS_ENCRYPTION_KEY;
    expect(() => seal('abc')).toThrow('ACCESS_ENCRYPTION_KEY');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend
node node_modules/jest/bin/jest.js src/utils/__tests__/secretBox.test.ts
```
Attendu : FAIL (module introuvable).

- [ ] **Step 3 : Implémenter**

```ts
import crypto from 'crypto';

// Chiffrement au repos des secrets tiers (refresh token Akiles).
// Format stocké : v1:<iv>:<tag>:<ciphertext> (base64) — versionné pour rotation future.
// AUCUN repli en clair : clé absente → erreur explicite.

function key(): Buffer {
  const raw = process.env.ACCESS_ENCRYPTION_KEY;
  if (!raw) throw new Error('ACCESS_ENCRYPTION_KEY manquante (32 octets base64)');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('ACCESS_ENCRYPTION_KEY invalide (32 octets base64 attendus)');
  return buf;
}

export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function open(sealed: string): string {
  const [version, ivB64, tagB64, dataB64] = sealed.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('SECRET_FORMAT_INVALID');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4 : Vérifier le succès** — même commande, attendu : PASS (4 tests).

- [ ] **Step 5 : Commit**

```powershell
git add backend/src/utils/secretBox.ts backend/src/utils/__tests__/secretBox.test.ts
git commit -m "feat(acces): secretBox AES-256-GCM pour les secrets tiers"
```

---

### Task 3 : `AkilesClient` — client HTTP (OAuth + REST v2)

**Files:**
- Create: `backend/src/services/access/akilesClient.ts`
- Test: `backend/src/services/access/__tests__/akilesClient.test.ts`

⚠️ **Vérification préalable (5 min)** : ouvrir https://docs.akiles.app/dev/api/authentication/ et https://docs.akiles.app/dev/api/reference/ et confirmer (1) les URLs exactes d'autorisation et d'échange de token OAuth, (2) les chemins/champs `POST /members`, `POST /members/{id}/group_associations`, `POST /members/{id}/pins`, `GET /member_groups`, (3) si un endpoint expose le nom d'organisation. Ajuster les constantes ci-dessous si besoin — le reste du plan ne dépend que de la façade `AkilesClient`.

- [ ] **Step 1 : Écrire le test qui échoue** (fetch mocké global)

```ts
import { AkilesClient, akilesAuthorizeUrl } from '../akilesClient';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) });

describe('AkilesClient', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.AKILES_CLIENT_ID = 'cid';
    process.env.AKILES_CLIENT_SECRET = 'csec';
  });

  it('akilesAuthorizeUrl porte client_id, redirect_uri, scope offline et state', () => {
    const url = akilesAuthorizeUrl('http://cb', 'STATE');
    expect(url).toContain('client_id=cid');
    expect(url).toContain(encodeURIComponent('http://cb'));
    expect(url).toContain('offline');
    expect(url).toContain('state=STATE');
  });

  it('échange le refresh token puis appelle l API avec Bearer', async () => {
    fetchMock
      .mockReturnValueOnce(json(200, { access_token: 'at', expires_in: 3600 })) // token
      .mockReturnValueOnce(json(200, { id: 'mem_1' }));                          // createMember
    const client = new AkilesClient('rt');
    const member = await client.createMember({ name: 'Palova · Piste 1', startsAt: '2026-07-16T15:45:00Z', endsAt: '2026-07-16T17:40:00Z', reservationId: 'r1' });
    expect(member.id).toBe('mem_1');
    const apiCall = fetchMock.mock.calls[1];
    expect(apiCall[0]).toContain('/members');
    expect((apiCall[1].headers as Record<string, string>).Authorization).toBe('Bearer at');
    const body = JSON.parse(apiCall[1].body as string);
    expect(body.starts_at).toBe('2026-07-16T15:45:00Z');
    expect(body.metadata.reservationId).toBe('r1');
  });

  it('réutilise le token en cache (1 seul échange pour 2 appels)', async () => {
    fetchMock
      .mockReturnValueOnce(json(200, { access_token: 'at', expires_in: 3600 }))
      .mockReturnValueOnce(json(200, { pin: '4821' }))
      .mockReturnValueOnce(json(200, {}));
    const client = new AkilesClient('rt');
    await client.createPin('mem_1');
    await client.patchMember('mem_1', { startsAt: 'a', endsAt: 'b' });
    const tokenCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('deleteMember tolère un 404 (déjà supprimé)', async () => {
    fetchMock
      .mockReturnValueOnce(json(200, { access_token: 'at', expires_in: 3600 }))
      .mockReturnValueOnce(json(404, { error: 'not_found' }));
    const client = new AkilesClient('rt');
    await expect(client.deleteMember('mem_x')).resolves.toBeUndefined();
  });

  it('erreur API ≠ 404 → throw AKILES_<status>', async () => {
    fetchMock
      .mockReturnValueOnce(json(200, { access_token: 'at', expires_in: 3600 }))
      .mockReturnValueOnce(json(500, { error: 'boom' }));
    const client = new AkilesClient('rt');
    await expect(client.createPin('mem_1')).rejects.toThrow('AKILES_500');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

```powershell
node node_modules/jest/bin/jest.js src/services/access/__tests__/akilesClient.test.ts
```
Attendu : FAIL (module introuvable).

- [ ] **Step 3 : Implémenter**

```ts
// Client HTTP Akiles v2 — https://docs.akiles.app/dev/api/reference/
// Auth OAuth 2.0 : access token 1 h obtenu via le refresh token, caché en mémoire.
const API_BASE  = process.env.AKILES_API_BASE  ?? 'https://api.akiles.app/v2';
const AUTH_BASE = process.env.AKILES_AUTH_BASE ?? 'https://auth.akiles.app'; // vérifié à l'implémentation (doc authentication)

const clientId = () => process.env.AKILES_CLIENT_ID ?? '';
const clientSecret = () => process.env.AKILES_CLIENT_SECRET ?? '';

/** URL de la page d'autorisation Akiles (le gérant y connecte SON organisation). */
export function akilesAuthorizeUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: redirectUri,
    scope: 'full_read_write offline',
    state,
  });
  return `${AUTH_BASE}/oauth/authorize?${q.toString()}`;
}

/** Échange le code d'autorisation contre les tokens (appelé par le callback). */
export async function akilesExchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string }> {
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri,
      client_id: clientId(), client_secret: clientSecret(),
    }).toString(),
  });
  if (!res.ok) throw new Error(`AKILES_OAUTH_${res.status}`);
  const data = (await res.json()) as { refresh_token?: string };
  if (!data.refresh_token) throw new Error('AKILES_OAUTH_NO_REFRESH_TOKEN');
  return { refreshToken: data.refresh_token };
}

export class AkilesClient {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(private refreshToken: string) {}

  private async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.token;
    const res = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: this.refreshToken,
        client_id: clientId(), client_secret: clientSecret(),
      }).toString(),
    });
    if (!res.ok) throw new Error(`AKILES_TOKEN_${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    this.cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return this.cached.token;
  }

  private async call<T>(method: string, path: string, body?: unknown, tolerate404 = false): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404 && tolerate404) return undefined as T;
    if (!res.ok) throw new Error(`AKILES_${res.status}: ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  createMember(p: { name: string; startsAt: string; endsAt: string; reservationId?: string }): Promise<{ id: string }> {
    return this.call('POST', '/members', {
      name: p.name, starts_at: p.startsAt, ends_at: p.endsAt,
      metadata: p.reservationId ? { reservationId: p.reservationId } : undefined,
    });
  }
  patchMember(id: string, p: { startsAt: string; endsAt: string }): Promise<void> {
    return this.call('PATCH', `/members/${id}`, { starts_at: p.startsAt, ends_at: p.endsAt });
  }
  deleteMember(id: string): Promise<void> {
    return this.call('DELETE', `/members/${id}`, undefined, true);
  }
  listGroupAssociations(memberId: string): Promise<Array<{ id: string; member_group_id: string }>> {
    return this.call('GET', `/members/${memberId}/group_associations`);
  }
  addGroupAssociation(memberId: string, groupId: string): Promise<{ id: string }> {
    return this.call('POST', `/members/${memberId}/group_associations`, { member_group_id: groupId });
  }
  deleteGroupAssociation(memberId: string, assocId: string): Promise<void> {
    return this.call('DELETE', `/members/${memberId}/group_associations/${assocId}`, undefined, true);
  }
  createPin(memberId: string): Promise<{ pin: string }> {
    return this.call('POST', `/members/${memberId}/pins`, {});
  }
  listMemberGroups(): Promise<Array<{ id: string; name: string }>> {
    return this.call('GET', '/member_groups');
  }
}
```

Note : si la reference impose une pagination sur `GET /member_groups` (`{ data: [...] }`), adapter `listMemberGroups` pour renvoyer `data` — le test mocke la forme retenue.

- [ ] **Step 4 : Vérifier le succès** — même commande, attendu : PASS (5 tests).

- [ ] **Step 5 : Commit**

```powershell
git add backend/src/services/access/akilesClient.ts backend/src/services/access/__tests__/akilesClient.test.ts
git commit -m "feat(acces): client HTTP Akiles v2 (OAuth + members/pins/groups)"
```

---

### Task 4 : `accessCode.ts` — états d'accès par résa (helper pur + batch)

**Files:**
- Create: `backend/src/services/access/accessCode.ts`
- Test: `backend/src/services/access/__tests__/accessCode.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue** (prisma mocké, pattern des tests de services existants)

```ts
jest.mock('../../../db/prisma', () => ({
  prisma: {
    clubAccessConfig: { findMany: jest.fn() },
    accessGrant: { findMany: jest.fn() },
  },
}));
import { prisma } from '../../../db/prisma';
import { accessStatesFor, accessWindowLabel, ACCESS_WINDOW_BEFORE_MIN, ACCESS_WINDOW_AFTER_MIN } from '../accessCode';

const future = new Date(Date.now() + 3_600_000);
const row = (over: Partial<{ id: string; status: string; type: string; endTime: Date; clubId: string }> = {}) =>
  ({ id: 'r1', status: 'CONFIRMED', type: 'COURT', endTime: future, clubId: 'c1', ...over });

describe('accessStatesFor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('club sans config → aucune entrée', async () => {
    (prisma.clubAccessConfig.findMany as jest.Mock).mockResolvedValue([]);
    const map = await accessStatesFor([row()]);
    expect(map.size).toBe(0);
  });

  it('STATIC_CODE → code live du club', async () => {
    (prisma.clubAccessConfig.findMany as jest.Mock).mockResolvedValue([{ clubId: 'c1', provider: 'STATIC_CODE', staticCode: '1234' }]);
    const map = await accessStatesFor([row()]);
    expect(map.get('r1')).toEqual({ code: '1234', pending: false });
  });

  it('AKILES avec grant ACTIVE → code du grant ; sans grant → pending', async () => {
    (prisma.clubAccessConfig.findMany as jest.Mock).mockResolvedValue([{ clubId: 'c1', provider: 'AKILES', staticCode: null }]);
    (prisma.accessGrant.findMany as jest.Mock).mockResolvedValue([{ reservationId: 'r1', status: 'ACTIVE', code: '4821' }]);
    const map = await accessStatesFor([row(), row({ id: 'r2' })]);
    expect(map.get('r1')).toEqual({ code: '4821', pending: false });
    expect(map.get('r2')).toEqual({ code: null, pending: true });
  });

  it('résa passée, annulée ou non-COURT → ignorée', async () => {
    (prisma.clubAccessConfig.findMany as jest.Mock).mockResolvedValue([{ clubId: 'c1', provider: 'STATIC_CODE', staticCode: '1234' }]);
    const past = new Date(Date.now() - 1000);
    const map = await accessStatesFor([
      row({ id: 'a', endTime: past }),
      row({ id: 'b', status: 'CANCELLED' }),
      row({ id: 'c', type: 'LESSON' }),
    ]);
    expect(map.size).toBe(0);
  });
});

describe('accessWindowLabel', () => {
  it('formate la fenêtre au fuseau du club', () => {
    const start = new Date('2026-07-16T16:00:00Z'); // 18:00 Paris (été)
    const end = new Date('2026-07-16T17:30:00Z');   // 19:30 Paris
    expect(accessWindowLabel(start, end, 'Europe/Paris')).toBe('de 17:45 à 19:40');
    expect(ACCESS_WINDOW_BEFORE_MIN).toBe(15);
    expect(ACCESS_WINDOW_AFTER_MIN).toBe(10);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `node node_modules/jest/bin/jest.js src/services/access/__tests__/accessCode.test.ts` → FAIL.

- [ ] **Step 3 : Implémenter**

```ts
import { DateTime } from 'luxon';
import { prisma } from '../../db/prisma';

// Fenêtre de validité d'un accès autour du créneau (constantes v1, non configurables).
export const ACCESS_WINDOW_BEFORE_MIN = 15;
export const ACCESS_WINDOW_AFTER_MIN = 10;

export interface ReservationAccessState { code: string | null; pending: boolean }

interface RowLike { id: string; status: string; type: string; endTime: Date; clubId: string }

const eligible = (r: RowLike): boolean =>
  r.status === 'CONFIRMED' && r.type === 'COURT' && r.endTime.getTime() > Date.now();

/**
 * États d'accès d'un lot de résas (2 requêtes max) : STATIC_CODE → code live du club,
 * AKILES → code du grant ACTIVE (sinon pending). Résa inéligible ou club sans config → absente.
 */
export async function accessStatesFor(rows: RowLike[]): Promise<Map<string, ReservationAccessState>> {
  const out = new Map<string, ReservationAccessState>();
  const candidates = rows.filter(eligible);
  if (candidates.length === 0) return out;

  const clubIds = [...new Set(candidates.map((r) => r.clubId))];
  const configs = await prisma.clubAccessConfig.findMany({
    where: { clubId: { in: clubIds } },
    select: { clubId: true, provider: true, staticCode: true },
  });
  const byClub = new Map(configs.map((c) => [c.clubId, c]));

  const akilesIds = candidates.filter((r) => byClub.get(r.clubId)?.provider === 'AKILES').map((r) => r.id);
  const grants = akilesIds.length
    ? await prisma.accessGrant.findMany({
        where: { reservationId: { in: akilesIds } },
        select: { reservationId: true, status: true, code: true },
      })
    : [];
  const grantByResa = new Map(grants.map((g) => [g.reservationId, g]));

  for (const r of candidates) {
    const config = byClub.get(r.clubId);
    if (!config) continue;
    if (config.provider === 'STATIC_CODE') {
      if (config.staticCode) out.set(r.id, { code: config.staticCode, pending: false });
      continue;
    }
    const grant = grantByResa.get(r.id);
    if (grant?.status === 'ACTIVE' && grant.code) out.set(r.id, { code: grant.code, pending: false });
    else out.set(r.id, { code: null, pending: true });
  }
  return out;
}

/** « de 17:45 à 19:40 » — bornes de validité du code au fuseau du club. */
export function accessWindowLabel(start: Date, end: Date, timezone: string): string {
  const s = DateTime.fromJSDate(start, { zone: timezone }).minus({ minutes: ACCESS_WINDOW_BEFORE_MIN });
  const e = DateTime.fromJSDate(end, { zone: timezone }).plus({ minutes: ACCESS_WINDOW_AFTER_MIN });
  return `de ${s.toFormat('HH:mm')} à ${e.toFormat('HH:mm')}`;
}
```

- [ ] **Step 4 : Vérifier le succès** — même commande, PASS (6 tests).

- [ ] **Step 5 : Commit**

```powershell
git add backend/src/services/access/accessCode.ts backend/src/services/access/__tests__/accessCode.test.ts
git commit -m "feat(acces): etats d'acces par reservation (batch, static live + grants)"
```

---

### Task 5 : Email « Votre code d'accès » (registre + notification)

**Files:**
- Modify: `backend/src/email/registry.ts` (entrée `access.code` dans `EMAIL_DEFS`)
- Modify: `backend/src/email/notifications.ts` (fonction `notifyAccessCode` + code dans les rappels)
- Test: ajouts dans `backend/src/email/__tests__/registry.test.ts` (⚠️ fichier touché par le WIP parallèle — ajouter un bloc, ne rien réécrire)

- [ ] **Step 1 : Test registre (échoue)** — dans `registry.test.ts`, ajouter :

```ts
describe('access.code', () => {
  it('est déclaré et rend le code dans le sujet/corps', () => {
    const def = EMAIL_DEFS['access.code'];
    expect(def).toBeDefined();
    const vars = sampleVars(def);
    const mail = renderClubEmail('access.code', vars, PALOVA_BRAND);
    expect(mail.subject).toContain(vars.date);
    expect(mail.html).toContain(vars.code);
    expect(mail.text).toContain(vars.code);
  });
});
```
(Reprendre les imports déjà présents en tête du fichier de test.)

- [ ] **Step 2 : Vérifier l'échec** — `node node_modules/jest/bin/jest.js src/email/__tests__/registry.test.ts` → FAIL (def undefined).

- [ ] **Step 3 : Ajouter l'entrée à `EMAIL_DEFS`** (groupe `parties`, après la dernière entrée du groupe) :

```ts
'access.code': {
  type: 'access.code', group: 'parties',
  title: "Code d'accès au club",
  description: "Au joueur quand sa réservation confirmée reçoit un code d'accès (club autonome).",
  hasCta: true,
  vars: [
    { key: 'prenom', label: 'Prénom', sample: 'Léa' },
    { key: 'code', label: "Code d'accès", sample: '4821' },
    { key: 'terrain', label: 'Terrain', sample: 'Piste 1' },
    { key: 'date', label: 'Date et heure', sample: 'jeudi 16 juillet, 18:00 → 19:30' },
    { key: 'fenetre', label: 'Fenêtre de validité', sample: 'de 17:45 à 19:40' },
    { key: 'club', label: 'Nom du club', sample: 'Padel Arena' },
  ],
  defaults: {
    subject: "Votre code d'accès — {{date}}",
    heading: "Votre code d'accès",
    bodyHtml: "<p>Bonjour {{prenom}},</p><p>Voici votre code d'accès pour {{terrain}} : <strong>{{code}}</strong></p><p>Il fonctionne {{fenetre}}, directement sur le clavier à l'entrée de {{club}}.</p>",
    ctaLabel: 'Voir ma réservation',
  },
  infoRows: (v) => [row('Code', v.code), row('Terrain', v.terrain), row('Date', v.date), row('Club', v.club)],
},
```

- [ ] **Step 4 : `notifyAccessCode` dans `notifications.ts`** (après `notifyReservationReminder`) :

```ts
/**
 * Envoie le code d'accès aux joueurs d'une résa confirmée (club autonome).
 * Appelé par AccessService APRÈS grant réussi (le code est passé en argument —
 * jamais de dépendance notifications → access.service). Best-effort côté appelant.
 */
export async function notifyAccessCode(reservationId: string, code: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: { select: { name: true, club: { select: EMAIL_CLUB_SELECT } } },
      participants: { select: { user: { select: { id: true, email: true, firstName: true } } } },
    },
  });
  if (!resa || resa.status !== 'CONFIRMED') return;
  const club = resa.resource.club;
  const brand = brandFromClub(club);
  const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const fenetre = accessWindowLabel(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/me/reservations');
  const override = await emailTemplates.getOverride(club.id, 'access.code');
  for (const p of resa.participants) {
    const u = p.user;
    if (!u?.email) continue;
    const vars: Record<string, string> = {
      prenom: u.firstName, code, terrain: resa.resource.name,
      date: dateLabel, fenetre, club: club.name, lien: url,
    };
    const mail = renderClubEmail('access.code', vars, brand, override);
    await dispatch({
      userId: u.id, clubId: club.id, category: 'MY_GAMES', type: 'access.code',
      title: "Votre code d'accès",
      body: `Code ${code} — ${resa.resource.name}, ${dateLabel}.`,
      url,
      email: { to: u.email, subject: mail.subject, html: mail.html, text: mail.text },
    });
  }
}
```
Import à ajouter en tête : `import { accessWindowLabel, accessStatesFor } from '../services/access/accessCode';`

- [ ] **Step 5 : Enrichir les rappels J-1/H-2** — dans `notifyReservationReminder`, après le calcul de `dateLabel`, ajouter :

```ts
const states = await accessStatesFor([{ id: resa.id, status: resa.status, type: resa.type, endTime: resa.endTime, clubId: club.id }]);
const accessCode = states.get(resa.id)?.code ?? null;
```
et changer le `body` du dispatch en :
```ts
body: `Ta réservation ${resa.resource.name} — ${dateLabel}.${accessCode ? ` Code d'accès : ${accessCode}.` : ''}`,
```

- [ ] **Step 6 : Test notification (échoue puis passe)** — créer `backend/src/email/__tests__/notifications.access.test.ts` sur le pattern des tests notifications existants (prisma + dispatcher mockés) :

```ts
jest.mock('../../db/prisma', () => ({
  prisma: { reservation: { findUnique: jest.fn() } },
}));
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: jest.fn() }));
jest.mock('../../services/emailTemplate.service', () => ({ emailTemplates: { getOverride: jest.fn().mockResolvedValue(null) } }));
jest.mock('../../services/access/accessCode', () => ({
  accessWindowLabel: () => 'de 17:45 à 19:40',
  accessStatesFor: jest.fn().mockResolvedValue(new Map()),
}));
import { prisma } from '../../db/prisma';
import { dispatch } from '../../services/notification/dispatcher';
import { notifyAccessCode } from '../notifications';

const club = { id: 'c1', name: 'Club', slug: 'club', logoUrl: null, accentColor: '#123456', timezone: 'Europe/Paris', address: null, city: null, contactPhone: null, contactEmail: null };

describe('notifyAccessCode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('envoie une notif + email par participant avec le code', async () => {
    (prisma.reservation.findUnique as jest.Mock).mockResolvedValue({
      id: 'r1', status: 'CONFIRMED', startTime: new Date(), endTime: new Date(),
      resource: { name: 'Piste 1', club },
      participants: [
        { user: { id: 'u1', email: 'a@x.fr', firstName: 'Léa' } },
        { user: { id: 'u2', email: 'b@x.fr', firstName: 'Tom' } },
      ],
    });
    await notifyAccessCode('r1', '4821');
    expect(dispatch).toHaveBeenCalledTimes(2);
    const first = (dispatch as jest.Mock).mock.calls[0][0];
    expect(first.category).toBe('MY_GAMES');
    expect(first.body).toContain('4821');
    expect(first.email.html).toContain('4821');
  });

  it('résa non confirmée → rien', async () => {
    (prisma.reservation.findUnique as jest.Mock).mockResolvedValue({ id: 'r1', status: 'PENDING', participants: [], resource: { name: 'P', club } });
    await notifyAccessCode('r1', '4821');
    expect(dispatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7 : Lancer les deux suites**

```powershell
node node_modules/jest/bin/jest.js src/email/__tests__/registry.test.ts src/email/__tests__/notifications.access.test.ts
```
Attendu : PASS.

- [ ] **Step 8 : Commit**

```powershell
git add backend/src/email/registry.ts backend/src/email/notifications.ts backend/src/email/__tests__/registry.test.ts backend/src/email/__tests__/notifications.access.test.ts
git commit -m "feat(acces): email personnalisable access.code + code dans les rappels"
```

---

### Task 6 : `AccessService` — orchestrateur (grant/annulation/déplacement/retry/OAuth)

**Files:**
- Create: `backend/src/services/access/access.service.ts`
- Test: `backend/src/services/access/__tests__/access.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent** (prisma + AkilesClient + notifyAccessCode mockés)

```ts
jest.mock('../../../db/prisma', () => ({
  prisma: {
    clubAccessConfig: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), delete: jest.fn() },
    accessGrant: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    reservation: { findUnique: jest.fn() },
    resource: { findMany: jest.fn() },
    club: { findUnique: jest.fn() },
  },
}));
jest.mock('../../../email/notifications', () => ({ notifyAccessCode: jest.fn() }));
jest.mock('../../../utils/secretBox', () => ({ seal: (s: string) => `sealed:${s}`, open: (s: string) => s.replace('sealed:', '') }));

const clientMock = {
  createMember: jest.fn(), patchMember: jest.fn(), deleteMember: jest.fn(),
  listGroupAssociations: jest.fn(), addGroupAssociation: jest.fn(), deleteGroupAssociation: jest.fn(),
  createPin: jest.fn(), listMemberGroups: jest.fn(),
};
jest.mock('../akilesClient', () => ({
  AkilesClient: jest.fn(() => clientMock),
  akilesAuthorizeUrl: jest.fn(() => 'https://auth/akiles?x=1'),
  akilesExchangeCode: jest.fn().mockResolvedValue({ refreshToken: 'rt_new' }),
}));

import { prisma } from '../../../db/prisma';
import { notifyAccessCode } from '../../../email/notifications';
import { AccessService } from '../access.service';

const future = (h: number) => new Date(Date.now() + h * 3_600_000);
const resa = (over: Record<string, unknown> = {}) => ({
  id: 'r1', status: 'CONFIRMED', type: 'COURT',
  startTime: future(1), endTime: future(2),
  resource: { id: 'res1', name: 'Piste 1', clubId: 'c1' },
  ...over,
});
const akilesConfig = (over: Record<string, unknown> = {}) => ({
  id: 'cfg1', clubId: 'c1', provider: 'AKILES', staticCode: null,
  akilesRefreshToken: 'sealed:rt', akilesDefaultGroupId: 'grp_default', resourceGroups: null,
  ...over,
});

describe('AccessService.onConfirmed', () => {
  const svc = new AccessService();
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.reservation.findUnique as jest.Mock).mockResolvedValue(resa());
    (prisma.accessGrant.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.accessGrant.create as jest.Mock).mockResolvedValue({ id: 'g1', reservationId: 'r1', status: 'FAILED', attempts: 0, akilesMemberId: null, code: null });
    (prisma.accessGrant.update as jest.Mock).mockResolvedValue({});
    clientMock.createMember.mockResolvedValue({ id: 'mem_1' });
    clientMock.addGroupAssociation.mockResolvedValue({ id: 'assoc_1' });
    clientMock.createPin.mockResolvedValue({ pin: '4821' });
  });

  it('AKILES : crée member + association + PIN, grant ACTIVE, email envoyé', async () => {
    (prisma.clubAccessConfig.findUnique as jest.Mock).mockResolvedValue(akilesConfig());
    await svc.onConfirmed('r1');
    expect(clientMock.createMember).toHaveBeenCalled();
    expect(clientMock.addGroupAssociation).toHaveBeenCalledWith('mem_1', 'grp_default');
    expect(prisma.accessGrant.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ACTIVE', code: '4821', akilesMemberId: 'mem_1' }),
    }));
    expect(notifyAccessCode).toHaveBeenCalledWith('r1', '4821');
  });

  it('surcharge par terrain prioritaire sur le groupe par défaut', async () => {
    (prisma.clubAccessConfig.findUnique as jest.Mock).mockResolvedValue(akilesConfig({ resourceGroups: { res1: 'grp_court1' } }));
    await svc.onConfirmed('r1');
    expect(clientMock.addGroupAssociation).toHaveBeenCalledWith('mem_1', 'grp_court1');
  });

  it('STATIC_CODE : pas de grant, email direct avec le code du club', async () => {
    (prisma.clubAccessConfig.findUnique as jest.Mock).mockResolvedValue(akilesConfig({ provider: 'STATIC_CODE', staticCode: '9999' }));
    await svc.onConfirmed('r1');
    expect(clientMock.createMember).not.toHaveBeenCalled();
    expect(prisma.accessGrant.create).not.toHaveBeenCalled();
    expect(notifyAccessCode).toHaveBeenCalledWith('r1', '9999');
  });

  it('pas de config → rien ; résa LESSON → rien', async () => {
    (prisma.clubAccessConfig.findUnique as jest.Mock).mockResolvedValue(null);
    await svc.onConfirmed('r1');
    (prisma.clubAccessConfig.findUnique as jest.Mock).mockResolvedValue(akilesConfig());
    (prisma.reservation.findUnique as jest.Mock).mockResolvedValue(resa({ type: 'LESSON' }));
    await svc.onConfirmed('r1');
    expect(clientMock.createMember).not.toHaveBeenCalled();
  });

  it('échec Akiles → grant FAILED (attempts++, lastError), pas d email, throw', async () => {
    (prisma.clubAccessConfig.findUnique as jest.Mock).mockResolvedValue(akilesConfig());
    clientMock.createMember.mockRejectedValue(new Error('AKILES_500: boom'));
    await expect(svc.onConfirmed('r1')).rejects.toThrow('AKILES_500');
    expect(prisma.accessGrant.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', attempts: { increment: 1 } }),
    }));
    expect(notifyAccessCode).not.toHaveBeenCalled();
  });
});

describe('AccessService.onCancelled / onRescheduled', () => {
  const svc = new AccessService();
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.reservation.findUnique as jest.Mock).mockResolvedValue(resa({ status: 'CANCELLED' }));
    (prisma.clubAccessConfig.findUnique as jest.Mock).mockResolvedValue(akilesConfig());
    (prisma.accessGrant.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', reservationId: 'r1', status: 'ACTIVE', akilesMemberId: 'mem_1', code: '4821', attempts: 0 });
    (prisma.accessGrant.update as jest.Mock).mockResolvedValue({});
    clientMock.deleteMember.mockResolvedValue(undefined);
  });

  it('annulation : DELETE member → grant REVOKED', async () => {
    await svc.onCancelled('r1');
    expect(clientMock.deleteMember).toHaveBeenCalledWith('mem_1');
    expect(prisma.accessGrant.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REVOKED' }) }));
  });

  it('échec du DELETE → REVOKE_FAILED', async () => {
    clientMock.deleteMember.mockRejectedValue(new Error('AKILES_500: down'));
    await expect(svc.onCancelled('r1')).rejects.toThrow();
    expect(prisma.accessGrant.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REVOKE_FAILED' }) }));
  });

  it('déplacement : PATCH des dates du member existant, email NON renvoyé', async () => {
    (prisma.reservation.findUnique as jest.Mock).mockResolvedValue(resa());
    (prisma.accessGrant.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', reservationId: 'r1', status: 'ACTIVE', akilesMemberId: 'mem_1', code: '4821', attempts: 0 });
    clientMock.patchMember.mockResolvedValue(undefined);
    clientMock.listGroupAssociations.mockResolvedValue([{ id: 'assoc_1', member_group_id: 'grp_default' }]);
    const { notifyAccessCode: notif } = jest.requireMock('../../../email/notifications');
    await svc.onRescheduled('r1');
    expect(clientMock.patchMember).toHaveBeenCalled();
    expect(clientMock.createMember).not.toHaveBeenCalled();
    expect(notif).not.toHaveBeenCalled();
  });
});

describe('AccessService.retryFailed', () => {
  const svc = new AccessService();
  it('retente un grant FAILED de résa à venir (backoff dépassé)', async () => {
    jest.clearAllMocks();
    (prisma.accessGrant.findMany as jest.Mock).mockResolvedValue([
      { id: 'g1', reservationId: 'r1', status: 'FAILED', attempts: 1, updatedAt: new Date(Date.now() - 10 * 60_000) },
    ]);
    (prisma.reservation.findUnique as jest.Mock).mockResolvedValue(resa());
    (prisma.clubAccessConfig.findUnique as jest.Mock).mockResolvedValue(akilesConfig());
    (prisma.accessGrant.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', reservationId: 'r1', status: 'FAILED', attempts: 1, akilesMemberId: null, code: null });
    (prisma.accessGrant.update as jest.Mock).mockResolvedValue({});
    clientMock.createMember.mockResolvedValue({ id: 'mem_2' });
    clientMock.addGroupAssociation.mockResolvedValue({ id: 'a2' });
    clientMock.createPin.mockResolvedValue({ pin: '1111' });
    const n = await svc.retryFailed();
    expect(n).toBe(1);
    expect(clientMock.createMember).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `node node_modules/jest/bin/jest.js src/services/access/__tests__/access.service.test.ts` → FAIL.

- [ ] **Step 3 : Implémenter `access.service.ts`**

```ts
import { prisma } from '../../db/prisma';
import { seal, open } from '../../utils/secretBox';
import { AkilesClient, akilesAuthorizeUrl, akilesExchangeCode } from './akilesClient';
import { ACCESS_WINDOW_BEFORE_MIN, ACCESS_WINDOW_AFTER_MIN } from './accessCode';
import { notifyAccessCode } from '../../email/notifications';
import jwt from 'jsonwebtoken';

const MAX_ATTEMPTS = 5;
const STATE_AUDIENCE = 'akiles-oauth';

type ConfigRow = NonNullable<Awaited<ReturnType<typeof loadConfig>>>;
const loadConfig = (clubId: string) => prisma.clubAccessConfig.findUnique({ where: { clubId } });

const RESA_SELECT = {
  id: true, status: true, type: true, startTime: true, endTime: true,
  resource: { select: { id: true, name: true, clubId: true } },
} as const;

export class AccessService {
  // ------------------------------------------------------------- hooks résa
  /** Après confirmation : crée l'accès (AKILES) ou envoie le code fixe. Peut lever (appelant best-effort). */
  async onConfirmed(reservationId: string): Promise<void> {
    const resa = await prisma.reservation.findUnique({ where: { id: reservationId }, select: RESA_SELECT });
    if (!this.eligible(resa)) return;
    const config = await loadConfig(resa!.resource.clubId);
    if (!config) return;
    if (config.provider === 'STATIC_CODE') {
      if (config.staticCode) await notifyAccessCode(reservationId, config.staticCode);
      return;
    }
    await this.syncAkiles(resa!, config);
  }

  /** Après annulation : révoque le member Akiles (le code fixe n'a rien à révoquer). */
  async onCancelled(reservationId: string): Promise<void> {
    const grant = await prisma.accessGrant.findUnique({ where: { reservationId } });
    if (!grant || !grant.akilesMemberId || grant.status === 'REVOKED') return;
    const config = await loadConfig(grant.clubId ?? '');
    // Config supprimée entre-temps → on ne peut plus appeler Akiles ; le member expirera seul.
    if (!config?.akilesRefreshToken) return;
    try {
      await this.clientFor(config).deleteMember(grant.akilesMemberId);
      await prisma.accessGrant.update({ where: { id: grant.id }, data: { status: 'REVOKED', lastError: null } });
    } catch (err) {
      await prisma.accessGrant.update({
        where: { id: grant.id },
        data: { status: 'REVOKE_FAILED', attempts: { increment: 1 }, lastError: String((err as Error).message).slice(0, 500) },
      });
      throw err;
    }
  }

  /** Après déplacement : resynchronise dates + groupe (même sync idempotente que la création). */
  async onRescheduled(reservationId: string): Promise<void> {
    return this.onConfirmed(reservationId);
  }

  /** Rattrapage cron : retente FAILED (recréation) et REVOKE_FAILED (suppression). Renvoie le nb traité. */
  async retryFailed(now = new Date()): Promise<number> {
    const grants = await prisma.accessGrant.findMany({
      where: { status: { in: ['FAILED', 'REVOKE_FAILED'] }, attempts: { lt: MAX_ATTEMPTS } },
      select: { id: true, reservationId: true, status: true, attempts: true, updatedAt: true },
      take: 20,
    });
    let done = 0;
    for (const g of grants) {
      const backoffMs = 2 ** g.attempts * 60_000;
      if (now.getTime() - g.updatedAt.getTime() < backoffMs) continue;
      try {
        if (g.status === 'REVOKE_FAILED') await this.onCancelled(g.reservationId);
        else await this.onConfirmed(g.reservationId);
        done++;
      } catch { /* attempts déjà incrémenté par la branche appelée */ }
    }
    return done;
  }

  // ------------------------------------------------------------- sync Akiles
  private eligible(resa: { status: string; type: string; endTime: Date } | null): boolean {
    return !!resa && resa.status === 'CONFIRMED' && resa.type === 'COURT' && resa.endTime.getTime() > Date.now();
  }

  private clientFor(config: ConfigRow): AkilesClient {
    if (!config.akilesRefreshToken) throw new Error('ACCESS_NOT_CONNECTED');
    return new AkilesClient(open(config.akilesRefreshToken));
  }

  private groupFor(config: ConfigRow, resourceId: string): string | null {
    const overrides = (config.resourceGroups ?? {}) as Record<string, string>;
    return overrides[resourceId] ?? config.akilesDefaultGroupId;
  }

  /**
   * Création/réparation idempotente : member absent → create + groupe + PIN (+ email au 1er succès) ;
   * member présent → PATCH des dates + remplacement du groupe s'il a changé (déplacement).
   */
  private async syncAkiles(
    resa: { id: string; startTime: Date; endTime: Date; resource: { id: string; name: string; clubId: string } },
    config: ConfigRow,
  ): Promise<void> {
    let grant = await prisma.accessGrant.findUnique({ where: { reservationId: resa.id } });
    if (!grant) {
      grant = await prisma.accessGrant.create({
        data: { reservationId: resa.id, clubId: resa.resource.clubId, status: 'FAILED', attempts: 0 },
      });
    }
    try {
      const client = this.clientFor(config);
      const group = this.groupFor(config, resa.resource.id);
      if (!group) throw new Error('ACCESS_NO_GROUP');
      const startsAt = new Date(resa.startTime.getTime() - ACCESS_WINDOW_BEFORE_MIN * 60_000).toISOString();
      const endsAt = new Date(resa.endTime.getTime() + ACCESS_WINDOW_AFTER_MIN * 60_000).toISOString();

      let memberId = grant.akilesMemberId;
      let code = grant.code;
      const firstGrant = !memberId;
      if (!memberId) {
        const member = await client.createMember({ name: `Palova · ${resa.resource.name}`, startsAt, endsAt, reservationId: resa.id });
        memberId = member.id;
        await client.addGroupAssociation(memberId, group);
        code = (await client.createPin(memberId)).pin;
      } else {
        await client.patchMember(memberId, { startsAt, endsAt });
        const assocs = await client.listGroupAssociations(memberId);
        if (!assocs.some((a) => a.member_group_id === group)) {
          for (const a of assocs) await client.deleteGroupAssociation(memberId, a.id);
          await client.addGroupAssociation(memberId, group);
        }
      }

      await prisma.accessGrant.update({
        where: { id: grant.id },
        data: { status: 'ACTIVE', code, akilesMemberId: memberId, lastError: null },
      });
      if (firstGrant && code) await notifyAccessCode(resa.id, code);
    } catch (err) {
      await prisma.accessGrant.update({
        where: { id: grant.id },
        data: { status: 'FAILED', attempts: { increment: 1 }, lastError: String((err as Error).message).slice(0, 500) },
      });
      throw err;
    }
  }

  // ------------------------------------------------------------- admin / OAuth
  /** URL d'autorisation Akiles pour ce club (state JWT signé anti-CSRF, 10 min). */
  startAkilesConnect(clubId: string): string {
    const state = jwt.sign({ clubId }, process.env.JWT_SECRET!, { expiresIn: '10m', audience: STATE_AUDIENCE });
    return akilesAuthorizeUrl(this.callbackUrl(), state);
  }

  /** Callback OAuth : vérifie le state, échange le code, stocke le refresh token chiffré. Renvoie le clubId. */
  async completeAkilesConnect(state: string, code: string): Promise<string> {
    const payload = jwt.verify(state, process.env.JWT_SECRET!, { audience: STATE_AUDIENCE }) as { clubId: string };
    const { refreshToken } = await akilesExchangeCode(code, this.callbackUrl());
    await prisma.clubAccessConfig.upsert({
      where: { clubId: payload.clubId },
      create: { clubId: payload.clubId, provider: 'AKILES', akilesRefreshToken: seal(refreshToken) },
      update: { provider: 'AKILES', akilesRefreshToken: seal(refreshToken) },
    });
    return payload.clubId;
  }

  private callbackUrl(): string {
    const base = process.env.API_URL ?? 'http://localhost:3001';
    return `${base}/api/access/akiles/callback`;
  }

  /** Déconnexion : efface token + groupes (les grants existants restent, les members expirent seuls). */
  async disconnectAkiles(clubId: string): Promise<void> {
    await prisma.clubAccessConfig.update({
      where: { clubId },
      data: { akilesRefreshToken: null, akilesDefaultGroupId: null, resourceGroups: undefined, akilesOrgName: null },
    }).catch(() => undefined);
  }

  /** État complet pour la page admin (jamais le token). */
  async getAdminState(clubId: string) {
    const config = await loadConfig(clubId);
    let groups: Array<{ id: string; name: string }> = [];
    if (config?.provider === 'AKILES' && config.akilesRefreshToken) {
      try { groups = await this.clientFor(config).listMemberGroups(); } catch { groups = []; }
    }
    const failures = await prisma.accessGrant.findMany({
      where: { clubId, status: { in: ['FAILED', 'REVOKE_FAILED'] } },
      orderBy: { updatedAt: 'desc' }, take: 20,
      select: {
        id: true, status: true, attempts: true, lastError: true, updatedAt: true,
        reservation: { select: { startTime: true, resource: { select: { name: true } } } },
      },
    });
    return {
      provider: config?.provider ?? null,
      staticCode: config?.staticCode ?? null,
      akilesConnected: !!config?.akilesRefreshToken,
      akilesOrgName: config?.akilesOrgName ?? null,
      akilesDefaultGroupId: config?.akilesDefaultGroupId ?? null,
      resourceGroups: (config?.resourceGroups ?? {}) as Record<string, string>,
      groups,
      failures: failures.map((f) => ({
        id: f.id, status: f.status, attempts: f.attempts, lastError: f.lastError,
        when: f.reservation.startTime.toISOString(), resourceName: f.reservation.resource.name,
      })),
    };
  }

  /** Mise à jour de la config (provider null = désactivation). */
  async updateConfig(clubId: string, patch: {
    provider?: 'AKILES' | 'STATIC_CODE' | null;
    staticCode?: string | null;
    akilesDefaultGroupId?: string | null;
    resourceGroups?: Record<string, string> | null;
  }): Promise<void> {
    if (patch.provider === null) {
      await prisma.clubAccessConfig.delete({ where: { clubId } }).catch(() => undefined);
      return;
    }
    if (patch.staticCode !== undefined && patch.staticCode !== null) {
      const trimmed = patch.staticCode.trim();
      if (!trimmed || trimmed.length > 20) throw new Error('VALIDATION_ERROR');
      patch.staticCode = trimmed;
    }
    if (patch.resourceGroups) {
      const ids = Object.keys(patch.resourceGroups);
      if (ids.length > 0) {
        const owned = await prisma.resource.findMany({ where: { id: { in: ids }, clubId }, select: { id: true } });
        if (owned.length !== ids.length) throw new Error('VALIDATION_ERROR');
      }
    }
    const data = {
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.staticCode !== undefined ? { staticCode: patch.staticCode } : {}),
      ...(patch.akilesDefaultGroupId !== undefined ? { akilesDefaultGroupId: patch.akilesDefaultGroupId } : {}),
      ...(patch.resourceGroups !== undefined ? { resourceGroups: patch.resourceGroups ?? undefined } : {}),
    };
    await prisma.clubAccessConfig.upsert({
      where: { clubId },
      create: { clubId, provider: patch.provider ?? 'STATIC_CODE', ...data },
      update: data,
    });
  }

  /** Test de porte : member « Test Palova » de 5 min + PIN (pas de grant — expire seul). */
  async testDoor(clubId: string): Promise<{ code: string }> {
    const config = await loadConfig(clubId);
    if (!config || config.provider !== 'AKILES') throw new Error('ACCESS_NOT_CONNECTED');
    const group = config.akilesDefaultGroupId;
    if (!group) throw new Error('ACCESS_NO_GROUP');
    const client = this.clientFor(config);
    const member = await client.createMember({
      name: 'Test Palova',
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    await client.addGroupAssociation(member.id, group);
    const { pin } = await client.createPin(member.id);
    return { code: pin };
  }

  /** Retry manuel d'un grant en échec depuis la page admin. */
  async retryGrant(clubId: string, grantId: string): Promise<void> {
    const grant = await prisma.accessGrant.findUnique({ where: { id: grantId }, select: { clubId: true, reservationId: true, status: true } });
    if (!grant || grant.clubId !== clubId) throw new Error('GRANT_NOT_FOUND');
    if (grant.status === 'REVOKE_FAILED') await this.onCancelled(grant.reservationId);
    else await this.onConfirmed(grant.reservationId);
  }
}
```

Note : `onCancelled` charge la config via `grant.clubId` (déjà porté par le grant) — pas la résa (elle peut avoir été annulée par cascade RGPD).

- [ ] **Step 4 : Vérifier le succès** — même commande, PASS (~10 tests). Ajuster les mocks si un nom de champ diverge — la façade décrite ici fait foi pour les tasks suivants.

- [ ] **Step 5 : Commit**

```powershell
git add backend/src/services/access/access.service.ts backend/src/services/access/__tests__/access.service.test.ts
git commit -m "feat(acces): AccessService (grant/revocation/deplacement/retry/OAuth/test de porte)"
```

---

### Task 7 : Hooks dans `reservation.service.ts` + exposition `accessCode`

**Files:**
- Modify: `backend/src/services/reservation.service.ts`
- Test: ajouts dans `backend/src/services/__tests__/reservation.service.test.ts` (bloc nouveau, ne rien réécrire)

- [ ] **Step 1 : Brancher les hooks (best-effort)**

En tête du fichier : `import { AccessService } from './access/access.service';` et `import { accessStatesFor } from './access/accessCode';`. Dans la classe, à côté de `matchAlerts` : `private access = new AccessService();`

Insertion (5 sites) :
1. **`confirmReservation`** — juste après le broadcast SSE `slot_confirmed` (avant `notifyMatchPartnersInvited`, pour que l'email d'accès parte dès la confirmation) :
```ts
// Best-effort : code d'accès du club autonome (Akiles/code fixe). Jamais bloquant.
await this.safeNotify(() => this.access.onConfirmed(reservationId));
```
2. **`adminCreateReservation`** — après le commit de la création (la résa naît CONFIRMED), même ligne avec l'id créé.
3. **`performCancel`** — après le broadcast `slot_released` : `await this.safeNotify(() => this.access.onCancelled(reservationId));` (couvre annulation joueur, admin, RGPD).
4. **`rescheduleReservation`** — à côté de `notifyReservationRescheduled` : `await this.safeNotify(() => this.access.onRescheduled(updated.id));`
5. **`adminRescheduleReservation`** — idem au site de son notify.

- [ ] **Step 2 : Exposer `accessCode` dans `listUserReservations`**

Dans le `select` de `resource`, ajouter `clubId: true`. Après le fetch des `rows` (avant le `return rows.map(...)`) :

```ts
const accessStates = await accessStatesFor(rows.map((r) => ({
  id: r.id, status: r.status, type: r.type, endTime: r.endTime, clubId: r.resource.clubId,
})));
```
Dans le map de retour, ajouter :
```ts
accessCode: accessStates.get(r.id)?.code ?? null,
accessPending: accessStates.get(r.id)?.pending ?? false,
```
(⚠️ dans ce map, la variable de l'itération s'appelle peut-être autrement — reprendre le nom réel ; `clubId` ne doit PAS fuiter dans `resourcePublic` : il est déjà retiré si le spread `...resourcePublic` exclut les champs destructurés, sinon le destructurer explicitement.)

- [ ] **Step 3 : Exposer `accessCode` dans `listClubReservations`** (planning/Paiements admin, viewer = staff)

Même mécanique après le fetch des rows : `clubId` vient de `params.clubId`. Ajouter `accessCode` au map de retour.

- [ ] **Step 4 : Tests** — dans `reservation.service.test.ts`, bloc nouveau « contrôle d'accès » sur le pattern des blocs existants (mocks du module `./access/access.service` et `./access/accessCode`) :

```ts
jest.mock('../access/access.service', () => ({
  AccessService: jest.fn(() => ({ onConfirmed: onConfirmedMock, onCancelled: onCancelledMock, onRescheduled: onRescheduledMock })),
}));
```
Cas : (1) `confirmReservation` appelle `onConfirmed` avec l'id ; (2) un `onConfirmed` qui rejette ne fait PAS échouer la confirmation ; (3) `performCancel` appelle `onCancelled` ; (4) `listUserReservations` renvoie `accessCode` quand `accessStatesFor` fournit un code (mocker `../access/accessCode`).

- [ ] **Step 5 : Lancer la suite**

```powershell
node node_modules/jest/bin/jest.js src/services/__tests__/reservation.service.test.ts
```
Attendu : PASS (bloc nouveau + suites existantes inchangées).

- [ ] **Step 6 : Commit**

```powershell
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(acces): hooks best-effort confirmation/annulation/deplacement + accessCode dans les payloads resa"
```

---

### Task 8 : `accessCode` viewer-gated sur les parties ouvertes

**Files:**
- Modify: `backend/src/services/openMatch.service.ts`
- Test: ajout dans `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1 : Test (échoue)** — le DTO expose `accessCode` **seulement** si le viewer est participant ou organisateur, `null` sinon (mocker `./access/accessCode` comme au Task 7 ; partie CONFIRMED à venir avec code disponible → viewer participant reçoit `'4821'`, viewer étranger/anonyme reçoit `null`).

- [ ] **Step 2 : Implémenter** — dans `listOpenMatches` et `getOpenMatch` : après la construction des rows, appeler `accessStatesFor` (clubId = celui du club résolu par la méthode), puis passer le code à `toDTO` (paramètre additif `accessCode: string | null`, appliqué uniquement quand `viewerIsParticipant || viewerIsOrganizer`, sinon `null`). Le mapper national (`listNationalOpenMatches`) n'expose **jamais** `accessCode`.

- [ ] **Step 3 : Lancer** — `node node_modules/jest/bin/jest.js src/services/__tests__/openMatch.service.test.ts` → PASS.

- [ ] **Step 4 : Commit**

```powershell
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(acces): accessCode viewer-gated sur les DTO de parties ouvertes"
```

---

### Task 9 : Routes admin + callback OAuth public

**Files:**
- Modify: `backend/src/routes/admin.ts` (bloc `--- Contrôle d'accès ---` après le bloc Stripe Connect)
- Create: `backend/src/routes/access.ts`
- Modify: `backend/src/app.ts` (mount)
- Test: `backend/src/routes/__tests__/admin.access.routes.test.ts`

- [ ] **Step 1 : Tests routes (échouent)** — pattern des tests routes existants (`admin.stripe.routes.test.ts` : supertest + jwt + mocks service). Cas :
  - `GET /api/clubs/club-demo/admin/access` : 200 ADMIN, **403 STAFF** ;
  - `PATCH …/access` : 200 ADMIN (body `{ provider: 'STATIC_CODE', staticCode: '1234' }`), 400 si `staticCode` vide (`VALIDATION_ERROR` levée par le service → mock qui throw) ;
  - `POST …/access/akiles/connect` : 201 OWNER `{ url }`, **403 ADMIN** ;
  - `DELETE …/access/akiles` : 200 OWNER, 403 ADMIN ;
  - `POST …/access/test` : 200 ADMIN `{ code }` ;
  - `POST …/access/grants/g1/retry` : 200 ADMIN ;
  - `GET /api/access/akiles/callback?state=bad&code=x` : redirection (302) vers une URL contenant `error=akiles`.

- [ ] **Step 2 : Bloc admin dans `admin.ts`**

```ts
// --- Contrôle d'accès (club autonome) ---
// Config ADMIN ; connexion/déconnexion du compte Akiles réservée au GÉRANT (OWNER),
// même exigence que Stripe Connect (compte externe du club).
const accessService = new AccessService();

router.get('/access', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await accessService.getAdminState(req.membership!.clubId)); }
  catch (err) { handleError(err, res, next); }
});

router.patch('/access', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { provider, staticCode, akilesDefaultGroupId, resourceGroups } = req.body ?? {};
    if (provider !== undefined && provider !== null && !['AKILES', 'STATIC_CODE'].includes(provider)) {
      return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    }
    await accessService.updateConfig(req.membership!.clubId, { provider, staticCode, akilesDefaultGroupId, resourceGroups });
    res.json(await accessService.getAdminState(req.membership!.clubId));
  } catch (err) { handleError(err, res, next); }
});

router.post('/access/akiles/connect', requireClubMember('OWNER'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json({ url: accessService.startAkilesConnect(req.membership!.clubId) }); }
  catch (err) { handleError(err, res, next); }
});

router.delete('/access/akiles', requireClubMember('OWNER'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { await accessService.disconnectAkiles(req.membership!.clubId); res.json({ ok: true }); }
  catch (err) { handleError(err, res, next); }
});

router.post('/access/test', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await accessService.testDoor(req.membership!.clubId)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/access/grants/:id/retry', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { await accessService.retryGrant(req.membership!.clubId, asString(req.params.id)); res.json({ ok: true }); }
  catch (err) { handleError(err, res, next); }
});
```
`handleError` doit mapper : `VALIDATION_ERROR` → 400, `ACCESS_NOT_CONNECTED`/`ACCESS_NO_GROUP` → 409, `GRANT_NOT_FOUND` → 404 (compléter la table de mapping du fichier si ces codes n'y tombent pas déjà par défaut).

- [ ] **Step 3 : Callback public `backend/src/routes/access.ts`**

```ts
import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { AccessService } from '../services/access/access.service';
import { clubAppUrl } from '../email/links';

const router = Router();
const accessService = new AccessService();

/** Callback OAuth Akiles (public — la sécurité est portée par le state JWT signé). */
router.get('/akiles/callback', async (req: Request, res: Response) => {
  const state = String(req.query.state ?? '');
  const code = String(req.query.code ?? '');
  try {
    const clubId = await accessService.completeAkilesConnect(state, code);
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { slug: true } });
    res.redirect(clubAppUrl(club?.slug ?? '', '/admin/access?connected=1'));
  } catch (err) {
    console.error('[access] callback Akiles en échec :', (err as Error).message);
    res.redirect(clubAppUrl('', '/admin/access?error=akiles'));
  }
});

export default router;
```
Dans `app.ts`, à côté des autres mounts : `app.use('/api/access', accessRouter);` (+ import).

- [ ] **Step 4 : Lancer** — `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.access.routes.test.ts` → PASS.

- [ ] **Step 5 : Commit**

```powershell
git add backend/src/routes/admin.ts backend/src/routes/access.ts backend/src/app.ts backend/src/routes/__tests__/admin.access.routes.test.ts
git commit -m "feat(acces): routes admin /access* + callback OAuth Akiles"
```

---

### Task 10 : Retry dans le cron minute + variables d'env

**Files:**
- Modify: `backend/src/jobs/cleanup.job.ts`
- Modify: `.env.prod.example`, `docker-compose.prod.yml`, `backend/.env` (dev, non versionné)

- [ ] **Step 1 : Cron** — dans `cleanup.job.ts`, imports + instance (`const accessService = new AccessService();` à côté de `matchAlertService`), puis dans le `cron.schedule`, après le bloc alertes :

```ts
try {
  const retried = await accessService.retryFailed();
  if (retried > 0) console.log(`[access] ${retried} accès resynchronisé(s)`);
} catch (err) {
  console.error('[access] retry:', (err as Error).message);
}
```

- [ ] **Step 2 : Env** — ajouter à `.env.prod.example` (avec commentaires) et à la liste `environment` du backend dans `docker-compose.prod.yml` : `ACCESS_ENCRYPTION_KEY`, `AKILES_CLIENT_ID`, `AKILES_CLIENT_SECRET` (+ optionnels `AKILES_API_BASE`, `AKILES_AUTH_BASE`). Générer une clé dev pour `backend/.env` :

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- [ ] **Step 3 : Typage backend complet**

```powershell
node node_modules/typescript/bin/tsc --noEmit
```
Attendu : aucune nouvelle erreur.

- [ ] **Step 4 : Commit**

```powershell
git add backend/src/jobs/cleanup.job.ts .env.prod.example docker-compose.prod.yml
git commit -m "feat(acces): retry des grants dans le cron minute + variables d'environnement"
```

---

### Task 11 : Frontend — types API + helpers purs

**Files:**
- Modify: `frontend/lib/api.ts`
- Create: `frontend/lib/access.ts`
- Test: `frontend/__tests__/access.test.ts`

- [ ] **Step 1 : Test helpers (échoue)**

```ts
import { accessCodeLine, ACCESS_ERRORS } from '@/lib/access';

describe('accessCodeLine', () => {
  it('code présent → libellé avec le code', () => {
    expect(accessCodeLine({ accessCode: '4821' })).toBe('Code d’accès : 4821');
  });
  it('pending sans code → libellé d attente', () => {
    expect(accessCodeLine({ accessCode: null, accessPending: true })).toBe('Code d’accès en préparation…');
  });
  it('ni code ni pending → null', () => {
    expect(accessCodeLine({ accessCode: null })).toBeNull();
    expect(accessCodeLine({})).toBeNull();
  });
});

describe('ACCESS_ERRORS', () => {
  it('mappe les codes backend', () => {
    expect(ACCESS_ERRORS.ACCESS_NO_GROUP).toContain('porte');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend
node node_modules/jest/bin/jest.js __tests__/access.test.ts
```

- [ ] **Step 3 : `frontend/lib/access.ts`**

```ts
// Helpers purs du contrôle d'accès (affichage joueur + admin).

export interface AccessCodeCarrier { accessCode?: string | null; accessPending?: boolean }

/** Ligne « Code d'accès : 4821 » / « en préparation » / null si le club n'a pas la feature. */
export function accessCodeLine(r: AccessCodeCarrier): string | null {
  if (r.accessCode) return `Code d’accès : ${r.accessCode}`;
  if (r.accessPending) return 'Code d’accès en préparation…';
  return null;
}

export const ACCESS_ERRORS: Record<string, string> = {
  ACCESS_NOT_CONNECTED: "Le compte Akiles n'est pas connecté.",
  ACCESS_NO_GROUP: "Choisissez d'abord la porte par défaut du club.",
  VALIDATION_ERROR: 'Vérifiez les champs saisis.',
};
```

- [ ] **Step 4 : Types + méthodes dans `lib/api.ts`**

Ajouts de types :
```ts
export interface AccessFailure { id: string; status: string; attempts: number; lastError: string | null; when: string; resourceName: string }
export interface ClubAccessState {
  provider: 'AKILES' | 'STATIC_CODE' | null;
  staticCode: string | null;
  akilesConnected: boolean;
  akilesOrgName: string | null;
  akilesDefaultGroupId: string | null;
  resourceGroups: Record<string, string>;
  groups: { id: string; name: string }[];
  failures: AccessFailure[];
}
```
Champs additifs : `MyReservation` → `accessCode?: string | null; accessPending?: boolean;` ; `OpenMatch` → `accessCode?: string | null;` ; `ClubReservation` (ligne admin) → `accessCode?: string | null;`.

Méthodes (pattern des `admin*` existants, base `/api/clubs/${clubId}/admin`) :
```ts
adminGetAccess: (clubId: string, token: string) => …GET `/access`… as Promise<ClubAccessState>,
adminUpdateAccess: (clubId: string, patch: Partial<Pick<ClubAccessState, 'provider' | 'staticCode' | 'akilesDefaultGroupId' | 'resourceGroups'>>, token: string) => …PATCH `/access`…,
adminAccessConnectUrl: (clubId: string, token: string) => …POST `/access/akiles/connect`… as Promise<{ url: string }>,
adminAccessDisconnect: (clubId: string, token: string) => …DELETE `/access/akiles`…,
adminAccessTest: (clubId: string, token: string) => …POST `/access/test`… as Promise<{ code: string }>,
adminAccessRetryGrant: (clubId: string, grantId: string, token: string) => …POST `/access/grants/${grantId}/retry`…,
```

- [ ] **Step 5 : Lancer** — `node node_modules/jest/bin/jest.js __tests__/access.test.ts` → PASS, puis `node node_modules/typescript/bin/tsc --noEmit` (aucune nouvelle erreur).

- [ ] **Step 6 : Commit**

```powershell
git add frontend/lib/api.ts frontend/lib/access.ts frontend/__tests__/access.test.ts
git commit -m "feat(acces): types API + helpers purs cote front"
```

---

### Task 12 : Page admin `/admin/access` + entrée sidebar

**Files:**
- Create: `frontend/app/admin/access/page.tsx`
- Modify: `frontend/app/admin/layout.tsx` (entrée « Contrôle d'accès », icône `lock` — elle existe déjà dans `Icon.tsx` —, section Configuration à côté de Réglages)
- Test: `frontend/__tests__/AdminAccess.test.tsx` + cas dans `frontend/__tests__/AdminLayout.test.tsx`

- [ ] **Step 1 : Tests (échouent)** — `AdminAccess.test.tsx` sur le pattern des pages admin testées (mock `@/lib/api` **complet** avec `assetUrl`, mock `useClub`/`useAuth`/`useRouter` à identité stable — cf. mémoire AdminLayout). Cas :
  1. rend les 3 modes (Aucun / Code fixe / Akiles) avec l'état chargé de `adminGetAccess` ;
  2. mode Code fixe : saisir `1234` + Enregistrer → `adminUpdateAccess` appelé avec `{ provider: 'STATIC_CODE', staticCode: '1234' }` ;
  3. mode Akiles non connecté + viewer OWNER → bouton « Connecter mon compte Akiles » (via `useAdminRole` mocké OWNER) ; viewer ADMIN → bouton absent, message « réservé au gérant » ;
  4. connecté → select des groupes rempli depuis `groups`, changement → `adminUpdateAccess` `{ akilesDefaultGroupId: 'grp_2' }` ;
  5. bouton « Tester la porte » → `adminAccessTest` appelé, code affiché ;
  6. échec listé avec bouton Réessayer → `adminAccessRetryGrant` appelé.
  Dans `AdminLayout.test.tsx` : l'entrée « Contrôle d'accès » est visible (ADMIN) — suivre le pattern des cas de nav existants.

- [ ] **Step 2 : Implémenter la page** — client component, même squelette que `/admin/settings` (état `loading/error/saving`, `useClub()` + token, `useAdminRole()` pour le gating OWNER du bouton connexion). Structure :

```tsx
// Sections :
// 1. Cartes radio du mode (Aucun / Code fixe / Akiles) → adminUpdateAccess({ provider })
//    (passer à null = désactiver, ConfirmDialog avant).
// 2. provider === 'STATIC_CODE' : input code (≤ 20 car.) + bouton Enregistrer.
// 3. provider === 'AKILES' :
//    - !akilesConnected : isClubOwner(role) ? bouton « Connecter mon compte Akiles »
//      (adminAccessConnectUrl → window.location.href = url) : « La connexion du compte Akiles
//      est réservée au gérant du club. » ;
//    - akilesConnected : chip « Compte Akiles connecté », select porte par défaut (state.groups),
//      tableau surcharges par terrain (adminGetResources → une ligne par ressource, select
//      groupe ou « — porte par défaut », écrit resourceGroups), bouton « Tester la porte »
//      (adminAccessTest → affiche { code } 5 min), bouton « Déconnecter » (OWNER, ConfirmDialog).
// 4. state.failures.length > 0 : liste « Codes en échec » (terrain, date, lastError, attempts)
//    + bouton Réessayer par ligne (adminAccessRetryGrant puis reload).
// Query params : ?connected=1 → bannière succès ; ?error=akiles → bannière coral.
```
Reprendre les atomes/styles des pages admin voisines (`th.*`, bannière d'erreur thémée, boutons plein accent). Aucune donnée sensible affichée (jamais le token).

- [ ] **Step 3 : Entrée sidebar** — dans `app/admin/layout.tsx`, ajouter `{ href: '/admin/access', label: "Contrôle d'accès", icon: 'lock' }` dans la section Configuration (non gatée par rôle, comme Réglages — la page gère elle-même le gating OWNER du bouton).

- [ ] **Step 4 : Lancer**

```powershell
node node_modules/jest/bin/jest.js __tests__/AdminAccess.test.tsx __tests__/AdminLayout.test.tsx
```
Attendu : PASS.

- [ ] **Step 5 : Commit**

```powershell
git add frontend/app/admin/access/page.tsx frontend/app/admin/layout.tsx frontend/__tests__/AdminAccess.test.tsx frontend/__tests__/AdminLayout.test.tsx
git commit -m "feat(acces): page admin Controle d'acces (modes, OAuth Akiles, portes, test, echecs)"
```

---

### Task 13 : Surfaces joueur (succès, Mes résas, calendrier, parties)

**Files:**
- Modify: `frontend/components/booking/BookingSuccess.tsx`
- Modify: `frontend/components/reservations/MyAgendaListItem.tsx` (ou le composant de ligne réellement utilisé par `/me/reservations` — vérifier par grep `accessCode` n'existe nulle part encore)
- Modify: `frontend/components/calendar/DayPanel.tsx`
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx`
- Tests: `frontend/__tests__/BookingSuccess.test.tsx`, `frontend/__tests__/OpenMatchCard.test.tsx` (+ suite calendrier si elle monte DayPanel)

- [ ] **Step 1 : Tests (échouent)**
  - `BookingSuccess` : la résa retournée par le mock `getMyReservations` porte `accessCode: '4821'` → le code est affiché en vedette ; avec `accessPending: true` sans code → « vous le recevrez par email » ; sans les deux → aucun bloc.
  - `OpenMatchCard` : match avec `accessCode: '4821'` + viewer participant → ligne code visible ; `accessCode` absent → rien.

- [ ] **Step 2 : Implémenter**
  - **BookingSuccess** : sous le bandeau vert de confirmation, bloc conditionnel :
    ```tsx
    {resa?.accessCode && (
      <div style={{ /* pastille th.surfaceHi, radius 14, padding 14, textAlign center */ }}>
        <div style={{ fontSize: 12, color: th.textMuted }}>Code d'accès au club</div>
        <div style={{ fontFamily: th.fontDisplay, fontSize: 32, letterSpacing: 4 }}>{resa.accessCode}</div>
      </div>
    )}
    {!resa?.accessCode && resa?.accessPending && (
      <p style={{ color: th.textMuted, fontSize: 13 }}>Votre code d'accès arrive — vous le recevrez par email.</p>
    )}
    ```
  - **MyAgendaListItem / DayPanel / OpenMatchCard** : une ligne discrète `accessCodeLine(item)` (import `@/lib/access`) rendue seulement si non-null, sur les entrées à venir non annulées. Pour `OpenMatchCard`, le backend gate déjà par viewer — le composant affiche si `match.accessCode` est présent.

- [ ] **Step 3 : Lancer les suites touchées**

```powershell
node node_modules/jest/bin/jest.js __tests__/BookingSuccess.test.tsx __tests__/OpenMatchCard.test.tsx
```
Attendu : PASS (nouvelles assertions + existantes).

- [ ] **Step 4 : Commit**

```powershell
git add frontend/components/booking/BookingSuccess.tsx frontend/components/reservations/MyAgendaListItem.tsx frontend/components/calendar/DayPanel.tsx frontend/components/openmatch/OpenMatchCard.tsx frontend/__tests__/BookingSuccess.test.tsx frontend/__tests__/OpenMatchCard.test.tsx
git commit -m "feat(acces): code d'acces sur les surfaces joueur (succes, resas, calendrier, parties)"
```

---

### Task 14 : Vérifications finales

- [ ] **Step 1 : Suites scoped backend + front**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend
node node_modules/jest/bin/jest.js src/utils/__tests__/secretBox.test.ts src/services/access src/email/__tests__/registry.test.ts src/email/__tests__/notifications.access.test.ts src/services/__tests__/reservation.service.test.ts src/services/__tests__/openMatch.service.test.ts src/routes/__tests__/admin.access.routes.test.ts
cd ..\frontend
node node_modules/jest/bin/jest.js __tests__/access.test.ts __tests__/AdminAccess.test.tsx __tests__/AdminLayout.test.tsx __tests__/BookingSuccess.test.tsx __tests__/OpenMatchCard.test.tsx
```
Attendu : tout PASS. (La suite front complète a un flake BookingModal connu — vérifier par suites ciblées + tsc, cf. mémoire.)

- [ ] **Step 2 : Type-check des deux côtés**

```powershell
cd ..\backend;  node node_modules/typescript/bin/tsc --noEmit
cd ..\frontend; node node_modules/typescript/bin/tsc --noEmit
```
Attendu : aucune nouvelle erreur (comparer au bruit du WIP parallèle avant/après).

- [ ] **Step 3 : Vérification visuelle (skill `verify`)** — stack locale démarrée (`start.ps1`) : `/admin/access` (3 modes, mode statique sauvegardé), une résa confirmée en mode code fixe → code visible sur l'écran de succès + Mes réservations + email console (fallback SMTP dev). Clair + sombre, 1280 + 390 (`mobile:false` + width fixe, cf. mémoire overflow).

- [ ] **Step 4 : Smoke test API**

```powershell
curl http://localhost:3001/health
# GET /access sans droits → 401/403 ; avec un token admin de club-demo → 200 { provider: null, ... }
```

- [ ] **Step 5 : Commit final éventuel (retouches) puis point d'arrêt**
Fin du plan — la connexion d'un vrai compte Akiles (Developer Center, organisation de test, `AKILES_CLIENT_ID/SECRET` réels) est une étape **manuelle d'Eric** ; le mode code fixe est, lui, testable de bout en bout sans rien d'externe.

---

## Notes d'exécution

- **Ordre strict** Tasks 1 → 10 (backend) puis 11 → 13 (front) ; le Task 5 dépend du 4 (import `accessWindowLabel`), le 6 des 2-5, le 7-9 du 6.
- **Fichiers chauds du WIP parallèle** (`registry.ts`, `notifications.ts`, `admin/layout.tsx` + leurs tests) : relire l'état réel avant d'éditer, ajouter sans réécrire, et ne committer que ses propres hunks (`git add` de fichiers entiers uniquement si on est seul dessus — sinon `git add -p`).
- **Divergence assumée vs spec** : `akilesOrgName` reste `null` en v1 (l'UI affiche « Compte Akiles connecté ») sauf si la vérification de la doc au Task 3 révèle un endpoint organisation trivial.
- Si `handleError` ne mappe pas les nouveaux codes, compléter sa table (Task 9) plutôt que de dupliquer des `res.status(...)` par route.
