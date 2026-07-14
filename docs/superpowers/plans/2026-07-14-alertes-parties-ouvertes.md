# Alertes parties ouvertes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un joueur de créer une alerte ponctuelle datée (« je cherche une partie jeudi 18h–21h ») et d'être notifié (in-app + push + email) dès qu'une partie ouverte à son niveau apparaît ou libère une place dans sa fenêtre.

**Architecture:** Événementiel inline (approche A). Deux tables Prisma (`MatchAlert`, `MatchAlertHit`). Un matcheur `matchAndNotify(reservationId)` déclenché en best-effort à 4 points où l'état d'une partie change (confirmation, publication après coup, 2 chemins de libération de place). Notification via l'infra `dispatch` existante + 19ᵉ email personnalisable. UI : bouton + chips sur `/parties`, pill « pris » cliquable sur Réserver. Conversion local→UTC côté backend (luxon, comme `adminRescheduleReservation`).

**Tech Stack:** TypeScript, Prisma 7 (driver adapter pg), Express, luxon, Jest (prisma mocké via `jest-mock-extended`), Next.js 16, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-14-alertes-parties-ouvertes-design.md`

**Conventions vérifiées dans le code :**
- Tests backend : `import '../../__mocks__/prisma'` + `prismaMock`, notifications mockées par `jest.mock('../../email/notifications', …)`.
- Erreurs = `throw new Error('CODE')`, mappées en HTTP dans `ERROR_STATUS` de `backend/src/routes/clubs.ts`.
- Notifs best-effort après commit via `this.safeNotify(() => …)`.
- Conversion date locale : `DateTime.fromISO(\`${date}T${hh:mm}\`, { zone: tz }).toUTC().toJSDate()`.
- Frontend tz display : `Intl.DateTimeFormat` (pas de luxon côté front).
- `db push` INTERDIT (base dev partagée + dérive). Migration additive = `prisma db execute` du SQL en DEV, `migrate deploy` en prod. Toujours `npx prisma generate` après.

---

## File Structure

**Backend — créés :**
- `backend/src/services/matchAlert.service.ts` — CRUD alertes + validation + `purgeExpired` + `matchAndNotify` (matcheur + notif).
- `backend/src/services/__tests__/matchAlert.service.test.ts` — tests du service (prisma mocké).
- `backend/prisma/migrations/manual/add_match_alerts.sql` — SQL additif (référence prod + `db execute` dev).

**Backend — modifiés :**
- `backend/prisma/schema.prisma` — 2 modèles + back-relations User/Club/Reservation.
- `backend/src/email/registry.ts` — entrée `open_match.alert` dans `EMAIL_DEFS`.
- `backend/src/email/notifications.ts` — exporte `levelRangeLabel` ; `notifyOpenMatchProposed` gagne `excludeUserIds`.
- `backend/src/services/reservation.service.ts` — 4 appels : `confirmReservation`, `setReservationVisibility`, `removeOwnReservationParticipant`, `removeReservationParticipant`.
- `backend/src/services/openMatch.service.ts` — 1 appel dans `removeOpenMatchPlayer` (couvre aussi `leaveOpenMatch`).
- `backend/src/routes/clubs.ts` — 3 routes + entrées `ERROR_STATUS`.
- `backend/src/jobs/cleanup.job.ts` — purge des alertes expirées.
- `backend/src/email/__tests__/notifications.openmatch-proposed.test.ts` — cas `excludeUserIds`.

**Frontend — créés :**
- `frontend/lib/matchAlerts.ts` — helpers purs (fenêtre depuis un créneau, libellé de chip).
- `frontend/__tests__/matchAlerts.test.ts`
- `frontend/components/openmatch/MatchAlertSheet.tsx` — feuille de création.
- `frontend/__tests__/MatchAlertSheet.test.tsx`

**Frontend — modifiés :**
- `frontend/lib/api.ts` — type `MatchAlert` + 3 méthodes.
- `frontend/components/openmatch/OpenMatches.tsx` — bouton, chips, état vide.
- `frontend/components/ClubReserve.tsx` — pill « pris » cliquable (padel) → feuille pré-remplie.
- `frontend/components/reserve/SportGrid.tsx` — cellule « pris » cliquable (padel).
- `frontend/__tests__/OpenMatches.test.tsx`, `frontend/__tests__/ClubReserve.*.test.tsx` (mocks des nouveaux `api.*`).

---

## Task 1 : Modèles Prisma + migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (après le modèle `OpenMatchMessage`, ~ligne 1437 ; back-relations User ~ligne 521, Club ~ligne 353, Reservation ~ligne 757)
- Create: `backend/prisma/migrations/manual/add_match_alerts.sql`

- [ ] **Step 1 : Ajouter les 2 modèles au schema**

Après le modèle `OpenMatchMessage` (`@@map("open_match_messages")`) :

```prisma
/// Alerte ponctuelle datée : un joueur veut être prévenu qu'une partie ouverte (padel)
/// à son niveau s'ouvre — ou libère une place — dans une fenêtre horaire précise.
/// Active tant que windowEnd > now (pas de champ statut) ; purgée par le job minute.
model MatchAlert {
  id          String   @id @default(cuid())
  userId      String   @map("user_id")
  clubId      String   @map("club_id")
  windowStart DateTime @map("window_start") @db.Timestamptz
  windowEnd   DateTime @map("window_end") @db.Timestamptz
  createdAt   DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  club Club @relation(fields: [clubId], references: [id], onDelete: Cascade)
  hits MatchAlertHit[]

  @@index([clubId, windowEnd])
  @@index([userId])
  @@map("match_alerts")
}

/// Déduplication : mémorise qu'une alerte a déjà sonné pour une partie donnée
/// (une place libérée deux fois dans la même partie ne re-notifie pas).
model MatchAlertHit {
  id            String   @id @default(cuid())
  alertId       String   @map("alert_id")
  reservationId String   @map("reservation_id")
  createdAt     DateTime @default(now()) @map("created_at")

  alert       MatchAlert  @relation(fields: [alertId], references: [id], onDelete: Cascade)
  reservation Reservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)

  @@unique([alertId, reservationId])
  @@index([reservationId])
  @@map("match_alert_hits")
}
```

- [ ] **Step 2 : Ajouter les back-relations**

Dans `model User` (après `openMatchMessages       OpenMatchMessage[]`, ~ligne 508) :
```prisma
  matchAlerts             MatchAlert[]
```

Dans `model Club` (après `memberSnapshots      ClubMemberSnapshot[]`, ~ligne 353) :
```prisma
  matchAlerts          MatchAlert[]
```

Dans `model Reservation` (après `openMatchMessages  OpenMatchMessage[]`, ~ligne 757) :
```prisma
  matchAlertHits     MatchAlertHit[]
```

- [ ] **Step 3 : Écrire le SQL additif de migration**

Create `backend/prisma/migrations/manual/add_match_alerts.sql` :
```sql
-- add_match_alerts : alertes ponctuelles datées pour parties ouvertes.
CREATE TABLE IF NOT EXISTS "match_alerts" (
  "id"           TEXT NOT NULL,
  "user_id"      TEXT NOT NULL,
  "club_id"      TEXT NOT NULL,
  "window_start" TIMESTAMPTZ NOT NULL,
  "window_end"   TIMESTAMPTZ NOT NULL,
  "created_at"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "match_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "match_alerts_club_id_window_end_idx" ON "match_alerts"("club_id", "window_end");
CREATE INDEX IF NOT EXISTS "match_alerts_user_id_idx" ON "match_alerts"("user_id");

CREATE TABLE IF NOT EXISTS "match_alert_hits" (
  "id"             TEXT NOT NULL,
  "alert_id"       TEXT NOT NULL,
  "reservation_id" TEXT NOT NULL,
  "created_at"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "match_alert_hits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "match_alert_hits_alert_id_reservation_id_key" ON "match_alert_hits"("alert_id", "reservation_id");
CREATE INDEX IF NOT EXISTS "match_alert_hits_reservation_id_idx" ON "match_alert_hits"("reservation_id");

DO $$ BEGIN
  ALTER TABLE "match_alerts" ADD CONSTRAINT "match_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "match_alerts" ADD CONSTRAINT "match_alerts_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "match_alert_hits" ADD CONSTRAINT "match_alert_hits_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "match_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "match_alert_hits" ADD CONSTRAINT "match_alert_hits_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 4 : Appliquer en DEV + régénérer le client**

Run (depuis `backend/`) :
```bash
npx prisma db execute --file prisma/migrations/manual/add_match_alerts.sql --schema prisma/schema.prisma
npx prisma generate
```
Expected: `Script executed successfully.` puis `Generated Prisma Client`.

> ⚠️ Si `--schema` échoue (Prisma 7 lit `prisma.config.ts`), lancer sans le flag `--schema`. NE PAS utiliser `db push`.

- [ ] **Step 5 : Vérifier la compilation TypeScript du client généré**

Run (depuis `backend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -i "matchAlert" || echo "OK: pas d'erreur matchAlert"
```
Expected: `OK: pas d'erreur matchAlert` (les modèles `matchAlert`/`matchAlertHit` existent sur le client).

- [ ] **Step 6 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/manual/add_match_alerts.sql
git commit -m "feat(alertes): modeles MatchAlert + MatchAlertHit (migration additive)"
```

---

## Task 2 : `MatchAlertService` — CRUD + validation

**Files:**
- Create: `backend/src/services/matchAlert.service.ts`
- Test: `backend/src/services/__tests__/matchAlert.service.test.ts`

- [ ] **Step 1 : Écrire les tests CRUD (échouants)**

Create `backend/src/services/__tests__/matchAlert.service.test.ts` :
```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

// Mocks module-scoped STABLES (réutilisés par le describe matchAndNotify de la Task 3) :
// le service fait `new RatingService()` en interne → il FAUT que la factory renvoie
// toujours la même fn, sinon on ne peut pas piloter les niveaux depuis les tests.
const dispatchMock = jest.fn();
const getLevelsBySportMock = jest.fn();
jest.mock('../notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));
jest.mock('../rating.service', () => ({
  RatingService: jest.fn().mockImplementation(() => ({ getLevelsBySport: getLevelsBySportMock })),
}));

import { MatchAlertService } from '../matchAlert.service';

const CLUB = { id: 'club-demo', status: 'ACTIVE' } as any;

describe('MatchAlertService — create/list/remove', () => {
  let service: MatchAlertService;
  beforeEach(() => {
    service = new MatchAlertService();
    prismaMock.club.findUnique.mockResolvedValue(CLUB);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.matchAlert.count.mockResolvedValue(0 as any);
  });

  it('crée une alerte : convertit la fenêtre locale en UTC (fuseau du club)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE', timezone: 'Europe/Paris' } as any);
    prismaMock.matchAlert.create.mockResolvedValue({ id: 'a1', windowStart: new Date('2026-07-16T16:00:00Z'), windowEnd: new Date('2026-07-16T19:00:00Z') } as any);

    const created = await service.create('arena', 'u1', { date: '2026-07-16', from: '18:00', to: '21:00' });

    expect(prismaMock.matchAlert.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'u1', clubId: 'club-demo',
        // 18:00 Europe/Paris (UTC+2 en été) = 16:00 UTC
        windowStart: new Date('2026-07-16T16:00:00.000Z'),
        windowEnd: new Date('2026-07-16T19:00:00.000Z'),
      }),
    }));
    expect(created).toEqual({ id: 'a1', windowStart: '2026-07-16T16:00:00.000Z', windowEnd: '2026-07-16T19:00:00.000Z' });
  });

  it('refuse une fenêtre inversée (to <= from)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE', timezone: 'Europe/Paris' } as any);
    await expect(service.create('arena', 'u1', { date: '2026-07-16', from: '21:00', to: '18:00' }))
      .rejects.toThrow('ALERT_WINDOW_INVALID');
  });

  it('refuse une fenêtre déjà passée', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE', timezone: 'Europe/Paris' } as any);
    await expect(service.create('arena', 'u1', { date: '2020-01-01', from: '18:00', to: '21:00' }))
      .rejects.toThrow('ALERT_WINDOW_INVALID');
  });

  it('refuse au-delà de 5 alertes actives', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE', timezone: 'Europe/Paris' } as any);
    prismaMock.matchAlert.count.mockResolvedValue(5 as any);
    await expect(service.create('arena', 'u1', { date: '2026-07-16', from: '18:00', to: '21:00' }))
      .rejects.toThrow('ALERT_LIMIT_REACHED');
  });

  it('refuse un membre BLOCKED', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE', timezone: 'Europe/Paris' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED' } as any);
    await expect(service.create('arena', 'u1', { date: '2026-07-16', from: '18:00', to: '21:00' }))
      .rejects.toThrow('MEMBERSHIP_BLOCKED');
  });

  it('listMine ne renvoie que les alertes actives, triées', async () => {
    prismaMock.matchAlert.findMany.mockResolvedValue([
      { id: 'a1', windowStart: new Date('2026-07-16T16:00:00Z'), windowEnd: new Date('2026-07-16T19:00:00Z') },
    ] as any);
    const list = await service.listMine('arena', 'u1');
    expect(prismaMock.matchAlert.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clubId: 'club-demo', userId: 'u1', windowEnd: expect.objectContaining({ gt: expect.any(Date) }) }),
      orderBy: { windowStart: 'asc' },
    }));
    expect(list).toEqual([{ id: 'a1', windowStart: '2026-07-16T16:00:00.000Z', windowEnd: '2026-07-16T19:00:00.000Z' }]);
  });

  it('remove ne supprime que sa propre alerte (idempotent)', async () => {
    prismaMock.matchAlert.deleteMany.mockResolvedValue({ count: 1 } as any);
    const r = await service.remove('arena', 'u1', 'a1');
    expect(prismaMock.matchAlert.deleteMany).toHaveBeenCalledWith({ where: { id: 'a1', userId: 'u1', clubId: 'club-demo' } });
    expect(r).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2 : Lancer les tests (échec attendu)**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/matchAlert.service.test.ts
```
Expected: FAIL — `Cannot find module '../matchAlert.service'`.

- [ ] **Step 3 : Écrire le service (CRUD + validation seulement)**

Create `backend/src/services/matchAlert.service.ts` :
```ts
import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';

export const MAX_ACTIVE_ALERTS = 5;
export const MAX_WINDOW_DAYS = 7;
export const MAX_LEAD_DAYS = 30;

export interface AlertWindowInput { date: string; from: string; to: string; } // date=YYYY-MM-DD, from/to=HH:mm (heure du club)

interface AlertDTO { id: string; windowStart: string; windowEnd: string; }

const toDTO = (a: { id: string; windowStart: Date; windowEnd: Date }): AlertDTO => ({
  id: a.id, windowStart: a.windowStart.toISOString(), windowEnd: a.windowEnd.toISOString(),
});

export class MatchAlertService {
  /** Résout un club ACTIVE + garantit l'adhésion (créée si absente, refus BLOCKED). */
  private async resolveClub(slug: string, userId: string): Promise<{ id: string; timezone: string }> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true, timezone: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const member = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: club.id } }, select: { status: true },
    });
    if (member?.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');
    if (!member) await prisma.clubMembership.create({ data: { userId, clubId: club.id } });
    return { id: club.id, timezone: club.timezone };
  }

  async create(slug: string, userId: string, input: AlertWindowInput): Promise<AlertDTO> {
    const club = await this.resolveClub(slug, userId);

    const start = DateTime.fromISO(`${input.date}T${input.from}`, { zone: club.timezone });
    const end   = DateTime.fromISO(`${input.date}T${input.to}`,   { zone: club.timezone });
    if (!start.isValid || !end.isValid || end <= start) throw new Error('ALERT_WINDOW_INVALID');

    const now = DateTime.now().setZone(club.timezone);
    if (end <= now) throw new Error('ALERT_WINDOW_INVALID');                       // fenêtre déjà passée
    if (end.diff(start, 'days').days > MAX_WINDOW_DAYS) throw new Error('ALERT_WINDOW_INVALID');
    if (start.diff(now, 'days').days > MAX_LEAD_DAYS) throw new Error('ALERT_WINDOW_INVALID');

    const active = await prisma.matchAlert.count({ where: { userId, clubId: club.id, windowEnd: { gt: new Date() } } });
    if (active >= MAX_ACTIVE_ALERTS) throw new Error('ALERT_LIMIT_REACHED');

    const created = await prisma.matchAlert.create({
      data: { userId, clubId: club.id, windowStart: start.toUTC().toJSDate(), windowEnd: end.toUTC().toJSDate() },
      select: { id: true, windowStart: true, windowEnd: true },
    });
    return toDTO(created);
  }

  async listMine(slug: string, userId: string): Promise<AlertDTO[]> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const rows = await prisma.matchAlert.findMany({
      where: { clubId: club.id, userId, windowEnd: { gt: new Date() } },
      orderBy: { windowStart: 'asc' },
      select: { id: true, windowStart: true, windowEnd: true },
    });
    return rows.map(toDTO);
  }

  async remove(slug: string, userId: string, alertId: string): Promise<{ ok: true }> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } });
    if (!club) throw new Error('CLUB_NOT_FOUND');
    await prisma.matchAlert.deleteMany({ where: { id: alertId, userId, clubId: club.id } });
    return { ok: true };
  }

  /** Purge les alertes expirées (appelé par le job minute). */
  async purgeExpired(): Promise<number> {
    const res = await prisma.matchAlert.deleteMany({ where: { windowEnd: { lt: new Date() } } });
    return res.count;
  }
}
```

- [ ] **Step 4 : Lancer les tests (succès attendu)**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/matchAlert.service.test.ts
```
Expected: PASS (7 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/matchAlert.service.ts backend/src/services/__tests__/matchAlert.service.test.ts
git commit -m "feat(alertes): MatchAlertService CRUD + validation fenetre"
```

---

## Task 3 : `MatchAlertService.matchAndNotify` — le matcheur

**Files:**
- Modify: `backend/src/services/matchAlert.service.ts`
- Modify: `backend/src/email/notifications.ts` (exporter `levelRangeLabel`)
- Test: `backend/src/services/__tests__/matchAlert.service.test.ts` (ajouts)

- [ ] **Step 1 : Exporter `levelRangeLabel` depuis notifications.ts**

Modify `backend/src/email/notifications.ts` ligne 22 : `function levelRangeLabel(` → `export function levelRangeLabel(`.

- [ ] **Step 2 : Écrire les tests du matcheur (ajouts, échouants)**

Ajouter à `backend/src/services/__tests__/matchAlert.service.test.ts` (les mocks `dispatchMock`/`getLevelsBySportMock` sont déclarés en tête du fichier — Task 2 Step 1) :
```ts
const CLUB_FULL = {
  id: 'club-demo', name: 'Padel Arena', slug: 'arena', logoUrl: null, accentColor: '#d6ff3f',
  timezone: 'Europe/Paris', address: null, city: null, contactPhone: null, contactEmail: null,
};

// Partie PUBLIC/CONFIRMED padel, format double (4 joueurs), 1 participant → 3 places.
// startTime 18:30, endTime 20:00 (heure du club Europe/Paris = UTC+2 → 16:30/18:00 UTC).
// Le select du matcheur charge resource.name + resource.club (EMAIL_CLUB_SELECT) → fixture complète.
function joinableMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1', status: 'CONFIRMED', visibility: 'PUBLIC',
    startTime: new Date('2026-07-16T16:30:00Z'), endTime: new Date('2026-07-16T18:00:00Z'),
    targetLevelMin: 2, targetLevelMax: 5,
    resource: { clubId: 'club-demo', name: 'Court 1', attributes: { format: 'double' }, club: CLUB_FULL, clubSport: { sport: { key: 'padel' } } },
    participants: [{ userId: 'orga' }],
    ...overrides,
  };
}
// Alerte de u1 couvrant 18:00–21:00 (club) = 16:00–19:00 UTC → contient la partie.
const alertRow = (id: string, userId: string) => ({
  id, userId, windowStart: new Date('2026-07-16T16:00:00Z'), windowEnd: new Date('2026-07-16T19:00:00Z'),
});

describe('MatchAlertService.matchAndNotify', () => {
  let service: MatchAlertService;
  beforeEach(() => {
    service = new MatchAlertService();
    dispatchMock.mockReset().mockResolvedValue(undefined);
    getLevelsBySportMock.mockReset().mockResolvedValue({});
    prismaMock.reservation.findUnique.mockResolvedValue(joinableMatch() as any);
    prismaMock.matchAlert.findMany.mockResolvedValue([alertRow('a1', 'u1')] as any);
    prismaMock.matchAlertHit.findMany.mockResolvedValue([] as any);
    prismaMock.matchAlertHit.createMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'u1' }] as any);
    // Le matcheur charge firstName/email des destinataires retenus : renvoie un user par id demandé.
    prismaMock.user.findMany.mockImplementation((args: any) =>
      Promise.resolve((args.where.id.in as string[]).map((id) => ({ id, firstName: id, email: `${id}@x.fr` }))) as any);
  });

  it('notifie le titulaire d\'une alerte in-range et crée le hit', async () => {
    getLevelsBySportMock.mockResolvedValue({ 'u1:padel': { level: 3 } }); // dans [2,5]
    const notified = await service.matchAndNotify('res-1');
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', category: 'MY_GAMES', type: 'open_match.alert', clubId: 'club-demo',
    }));
    expect(prismaMock.matchAlertHit.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ alertId: 'a1', reservationId: 'res-1' }], skipDuplicates: true,
    }));
    expect(notified).toEqual(['u1']);
  });

  it('partie sans fourchette (ouverte à tous) → notifie même un joueur non calibré', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(joinableMatch({ targetLevelMin: null, targetLevelMax: null }) as any);
    getLevelsBySportMock.mockResolvedValue({}); // niveau inconnu
    const notified = await service.matchAndNotify('res-1');
    expect(notified).toEqual(['u1']);
  });

  it('partie avec fourchette → exclut le niveau hors fourchette', async () => {
    getLevelsBySportMock.mockResolvedValue({ 'u1:padel': { level: 7 } }); // hors [2,5]
    const notified = await service.matchAndNotify('res-1');
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(notified).toEqual([]);
  });

  it('exclut l\'organisateur / un participant déjà présent', async () => {
    prismaMock.matchAlert.findMany.mockResolvedValue([alertRow('a1', 'orga')] as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'orga' }] as any);
    getLevelsBySportMock.mockResolvedValue({ 'orga:padel': { level: 3 } });
    const notified = await service.matchAndNotify('res-1');
    expect(notified).toEqual([]);
  });

  it('exclut une alerte déjà notifiée (hit existant)', async () => {
    prismaMock.matchAlertHit.findMany.mockResolvedValue([{ alertId: 'a1' }] as any);
    getLevelsBySportMock.mockResolvedValue({ 'u1:padel': { level: 3 } });
    const notified = await service.matchAndNotify('res-1');
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(notified).toEqual([]);
  });

  it('exclut un membre non ACTIVE (BLOCKED / absent de la requête ACTIVE)', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([] as any); // aucun ACTIVE
    getLevelsBySportMock.mockResolvedValue({ 'u1:padel': { level: 3 } });
    const notified = await service.matchAndNotify('res-1');
    expect(notified).toEqual([]);
  });

  it('ne fait rien si la partie est complète', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(joinableMatch({
      participants: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }],
    }) as any);
    const notified = await service.matchAndNotify('res-1');
    expect(prismaMock.matchAlert.findMany).not.toHaveBeenCalled();
    expect(notified).toEqual([]);
  });

  it('ne fait rien pour une partie non joignable (PRIVATE / non-padel / passée)', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(joinableMatch({ visibility: 'PRIVATE' }) as any);
    expect(await service.matchAndNotify('res-1')).toEqual([]);
    prismaMock.reservation.findUnique.mockResolvedValue(joinableMatch({ resource: { clubId: 'club-demo', attributes: { format: 'double' }, clubSport: { sport: { key: 'tennis' } } } }) as any);
    expect(await service.matchAndNotify('res-1')).toEqual([]);
    prismaMock.reservation.findUnique.mockResolvedValue(joinableMatch({ startTime: new Date('2000-01-01T10:00:00Z') }) as any);
    expect(await service.matchAndNotify('res-1')).toEqual([]);
  });

  it('un utilisateur avec 2 alertes couvrantes → notifié une seule fois, 2 hits', async () => {
    prismaMock.matchAlert.findMany.mockResolvedValue([alertRow('a1', 'u1'), alertRow('a2', 'u1')] as any);
    getLevelsBySportMock.mockResolvedValue({ 'u1:padel': { level: 3 } });
    const notified = await service.matchAndNotify('res-1');
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.matchAlertHit.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([{ alertId: 'a1', reservationId: 'res-1' }, { alertId: 'a2', reservationId: 'res-1' }]),
    }));
    expect(notified).toEqual(['u1']);
  });

  it('best-effort : un échec de dispatch pour un destinataire ne casse pas les autres', async () => {
    prismaMock.matchAlert.findMany.mockResolvedValue([alertRow('a1', 'u1'), alertRow('a2', 'u2')] as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }] as any);
    getLevelsBySportMock.mockResolvedValue({ 'u1:padel': { level: 3 }, 'u2:padel': { level: 3 } });
    dispatchMock.mockImplementation((a: { userId: string }) => a.userId === 'u1' ? Promise.reject(new Error('SMTP')) : Promise.resolve());
    const notified = await service.matchAndNotify('res-1');
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(notified).toContain('u2');
  });
});
```

- [ ] **Step 3 : Lancer les tests (échec attendu)**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/matchAlert.service.test.ts -t matchAndNotify
```
Expected: FAIL — `service.matchAndNotify is not a function`.

- [ ] **Step 4 : Implémenter le matcheur**

Ajouter les imports en tête de `backend/src/services/matchAlert.service.ts` :
```ts
import { playerCount } from '../utils/courtType';
import { RatingService } from './rating.service';
import { inRange } from './rating/range';
import { dispatch } from './notification/dispatcher';
import { renderClubEmail, brandFromClub } from '../email/registry';
import { emailTemplates } from './emailTemplate.service';
import { clubAppUrl, formatDateRangeFr } from '../email/links';
import { placesPhrase, levelRangeLabel, EMAIL_CLUB_SELECT } from '../email/notifications';
```

Ajouter un champ privé à la classe :
```ts
  private ratingService = new RatingService();
```

Ajouter la méthode dans la classe `MatchAlertService` :
```ts
  /**
   * Notifie les titulaires d'alertes actives dont la fenêtre CONTIENT cette partie
   * (padel, PUBLIC/CONFIRMED, à venir, ≥1 place). Niveau : fourchette contenant le
   * niveau connu, OU partie sans fourchette (ouverte à tous → tout le monde). Crée un
   * hit par (alerte, partie) pour ne jamais re-notifier. Renvoie les userId notifiés
   * (pour dédupliquer avec notifyOpenMatchProposed). Best-effort par destinataire.
   */
  async matchAndNotify(reservationId: string): Promise<string[]> {
    const resa = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true, status: true, visibility: true, startTime: true, endTime: true,
        targetLevelMin: true, targetLevelMax: true,
        resource: {
          select: {
            clubId: true, attributes: true,
            club: { select: EMAIL_CLUB_SELECT },
            clubSport: { select: { sport: { select: { key: true } } } },
          },
        },
        participants: { select: { userId: true } },
      },
    });
    if (!resa) return [];

    // Auto-garde : uniquement une vraie partie ouverte padel, à venir, avec place libre.
    const sportKey = resa.resource.clubSport.sport.key;
    if (resa.visibility !== 'PUBLIC' || resa.status !== 'CONFIRMED' || sportKey !== 'padel') return [];
    if (resa.startTime.getTime() <= Date.now()) return [];
    const maxPlayers = playerCount((resa.resource.attributes as { format?: string } | null)?.format);
    if (maxPlayers - resa.participants.length <= 0) return [];

    // Alertes actives du club dont la fenêtre CONTIENT entièrement la partie.
    const alerts = await prisma.matchAlert.findMany({
      where: {
        clubId: resa.resource.clubId,
        windowStart: { lte: resa.startTime },
        windowEnd:   { gte: resa.endTime },
      },
      select: { id: true, userId: true },
    });
    if (alerts.length === 0) return [];

    // Retire l'organisateur / participants présents.
    const present = new Set(resa.participants.map((p) => p.userId));
    let candidates = alerts.filter((a) => !present.has(a.userId));
    if (candidates.length === 0) return [];

    // Retire les alertes déjà notifiées pour cette partie (hit existant).
    const hits = await prisma.matchAlertHit.findMany({
      where: { reservationId, alertId: { in: candidates.map((a) => a.id) } },
      select: { alertId: true },
    });
    const hitSet = new Set(hits.map((h) => h.alertId));
    candidates = candidates.filter((a) => !hitSet.has(a.id));
    if (candidates.length === 0) return [];

    // Ne garde que les membres ACTIVE (un BLOCKED / retiré ne reçoit rien).
    const userIds = [...new Set(candidates.map((a) => a.userId))];
    const active = await prisma.clubMembership.findMany({
      where: { clubId: resa.resource.clubId, status: 'ACTIVE', userId: { in: userIds } },
      select: { userId: true },
    });
    const activeSet = new Set(active.map((m) => m.userId));

    // Niveaux (batch). Sans fourchette → tout le monde ; avec fourchette → niveau connu in-range.
    const levels = await this.ratingService.getLevelsBySport(userIds.map((userId) => ({ userId, sportKey })));
    const min = resa.targetLevelMin, max = resa.targetLevelMax;
    const levelOk = (userId: string): boolean => {
      if (min == null && max == null) return true;
      const lvl = levels[`${userId}:${sportKey}`]?.level ?? null;
      return lvl != null && inRange(lvl, min, max);
    };

    // Regroupe par utilisateur retenu : hits pour TOUTES ses alertes couvrantes, 1 notif.
    const keep = candidates.filter((a) => activeSet.has(a.userId) && levelOk(a.userId));
    if (keep.length === 0) return [];

    await prisma.matchAlertHit.createMany({
      data: keep.map((a) => ({ alertId: a.id, reservationId })),
      skipDuplicates: true,
    });

    const club = resa.resource.club;
    const brand = brandFromClub(club);
    const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
    const levelLabel = levelRangeLabel(min, max);
    const spotsLeft = maxPlayers - resa.participants.length;
    const url = clubAppUrl(club.slug, `/parties/${resa.id}`);
    const override = await emailTemplates.getOverride(club.id, 'open_match.alert');

    // Une notif par utilisateur retenu (on a besoin de son prénom/email → requête légère).
    const notifyIds = [...new Set(keep.map((a) => a.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: notifyIds } },
      select: { id: true, firstName: true, email: true },
    });

    const notified: string[] = [];
    for (const u of users) {
      if (!u.email) continue;
      const mail = renderClubEmail('open_match.alert', {
        prenom: u.firstName, terrain: (resa as any).resource?.name ?? '', date: dateLabel,
        club: club.name, niveau: levelLabel, phrase_places: placesPhrase(spotsLeft), lien: url,
      }, brand, override);
      try {
        await dispatch({
          userId: u.id, clubId: club.id, category: 'MY_GAMES', type: 'open_match.alert',
          title: 'Une partie correspond à ton alerte',
          body: `Une partie ouverte du ${dateLabel} correspond à ton alerte.`,
          url, data: { matchId: resa.id },
          email: { to: u.email, subject: mail.subject, html: mail.html, text: mail.text },
        });
        notified.push(u.id);
      } catch (err) {
        console.error('[matchAndNotify] envoi destinataire échoué', { userId: u.id, err });
      }
    }
    return notified;
  }
```

> Note : `resa.resource.name` n'est pas dans le select ci-dessus. Ajouter `name: true` au `select` de `resource` (à côté de `clubId`) pour la variable `{{terrain}}`.

- [ ] **Step 5 : Ajouter `name: true` au select resource**

Dans le `select` de `resource` de `matchAndNotify`, remplacer `clubId: true, attributes: true,` par `clubId: true, name: true, attributes: true,` et remplacer `terrain: (resa as any).resource?.name ?? ''` par `terrain: resa.resource.name`.

- [ ] **Step 6 : Lancer les tests (succès attendu)**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/matchAlert.service.test.ts
```
Expected: PASS (tous les tests, CRUD + matchAndNotify).

- [ ] **Step 7 : Commit**

```bash
git add backend/src/services/matchAlert.service.ts backend/src/services/__tests__/matchAlert.service.test.ts backend/src/email/notifications.ts
git commit -m "feat(alertes): matchAndNotify (matcheur + notif, dedup par hit)"
```

---

## Task 4 : Email `open_match.alert` (19ᵉ type personnalisable)

**Files:**
- Modify: `backend/src/email/registry.ts` (dans `EMAIL_DEFS`, après `open_match.proposed`)
- Test: `backend/src/email/__tests__/registry.test.ts`

- [ ] **Step 1 : Écrire le test (échouant)**

Vérifier d'abord la forme du test existant :
```bash
node node_modules/jest/bin/jest.js src/email/__tests__/registry.test.ts --listTests
```
Ajouter à `backend/src/email/__tests__/registry.test.ts` (adapter les imports au style du fichier) :
```ts
import { EMAIL_DEFS, renderClubEmail, sampleVars, PALOVA_BRAND } from '../registry';

describe("email open_match.alert", () => {
  it('est déclaré avec ses variables et rend un sujet substitué', () => {
    const def = EMAIL_DEFS['open_match.alert'];
    expect(def).toBeDefined();
    expect(def.group).toBe('parties');
    const keys = def.vars.map((v) => v.key).sort();
    expect(keys).toEqual(['club', 'date', 'lien', 'niveau', 'phrase_places', 'prenom', 'terrain'].sort());
    const mail = renderClubEmail('open_match.alert', sampleVars(def), PALOVA_BRAND);
    expect(mail.subject).toContain('alerte');
    expect(mail.html).toContain(sampleVars(def).terrain);
  });
});
```

- [ ] **Step 2 : Lancer le test (échec attendu)**

Run: `node node_modules/jest/bin/jest.js src/email/__tests__/registry.test.ts -t "open_match.alert"`
Expected: FAIL — `def` undefined.

- [ ] **Step 3 : Ajouter l'entrée dans EMAIL_DEFS**

Dans `backend/src/email/registry.ts`, juste après le bloc `'open_match.proposed': { … },` :
```ts
  'open_match.alert': {
    type: 'open_match.alert', group: 'parties',
    title: 'Partie — alerte horaire',
    description: 'Au joueur ayant créé une alerte, quand une partie correspond à son créneau.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'jeudi 16 juillet 2026 · 18h30 → 20h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'niveau', label: 'Fourchette de niveau', sample: 'Niveau 2 à 5' },
      { key: 'phrase_places', label: 'Places restantes (auto)', sample: 'Il reste 2 places.' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/parties/1' },
    ],
    defaults: {
      subject: 'Une partie pour ton alerte — {{club}}',
      heading: 'Ça joue à ton créneau ! 🔔',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>Une partie ouverte correspond à ton alerte et cherche des joueurs. {{phrase_places}}</p>',
      ctaLabel: 'Voir la partie',
    },
    infoRows: (v) => [row('Terrain', v.terrain), row('Date', v.date), row('Niveau', v.niveau), row('Club', v.club)],
  },
```

- [ ] **Step 4 : Lancer le test (succès attendu)**

Run: `node node_modules/jest/bin/jest.js src/email/__tests__/registry.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/email/registry.ts backend/src/email/__tests__/registry.test.ts
git commit -m "feat(alertes): email open_match.alert personnalisable (19e type)"
```

---

## Task 5 : `notifyOpenMatchProposed` gagne `excludeUserIds`

**Files:**
- Modify: `backend/src/email/notifications.ts` (fonction `notifyOpenMatchProposed`, ~ligne 467)
- Test: `backend/src/email/__tests__/notifications.openmatch-proposed.test.ts`

- [ ] **Step 1 : Ajouter le test (échouant)**

Ajouter à `backend/src/email/__tests__/notifications.openmatch-proposed.test.ts`, dans le `describe` existant :
```ts
  it('exclut les userId déjà notifiés par une alerte (excludeUserIds)', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(publicRangedReservation() as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { userId: 'alerted', user: { firstName: 'Al', lastName: 'Erted', email: 'al@x.fr' } },
      { userId: 'other',   user: { firstName: 'Ot', lastName: 'Her',   email: 'ot@x.fr' } },
    ] as any);
    getLevelsBySportMock.mockResolvedValue({ 'alerted:padel': { level: 3 }, 'other:padel': { level: 3 } });

    await notifyOpenMatchProposed('res-1', ['alerted']);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'other' }));
  });
```

- [ ] **Step 2 : Lancer le test (échec attendu)**

Run: `node node_modules/jest/bin/jest.js src/email/__tests__/notifications.openmatch-proposed.test.ts -t excludeUserIds`
Expected: FAIL — `alerted` est encore notifié (2 appels).

- [ ] **Step 3 : Modifier la signature + le filtre**

Dans `backend/src/email/notifications.ts`, fonction `notifyOpenMatchProposed` :

Signature (~ligne 467) :
```ts
export async function notifyOpenMatchProposed(reservationId: string, excludeUserIds: string[] = []): Promise<void> {
```

Juste après la construction de `present` (`const present = new Set(resa.participants.map((p) => p.userId));`), ajouter les ids exclus :
```ts
  for (const id of excludeUserIds) present.add(id);
```

(Le filtre `candidates = optedIn.filter((m) => !present.has(m.userId))` existant couvre alors l'exclusion.)

- [ ] **Step 4 : Lancer la suite (succès attendu)**

Run: `node node_modules/jest/bin/jest.js src/email/__tests__/notifications.openmatch-proposed.test.ts`
Expected: PASS (tous les cas, dont le nouveau + les anciens `notifyOpenMatchProposed('res-1')` sans 2ᵉ argument).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/email/notifications.ts backend/src/email/__tests__/notifications.openmatch-proposed.test.ts
git commit -m "feat(alertes): notifyOpenMatchProposed exclut les userId deja alertes"
```

---

## Task 6 : Câbler les 4 points d'accroche

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (imports + 4 sites)
- Modify: `backend/src/services/openMatch.service.ts` (1 site)
- Test: `backend/src/services/__tests__/reservation.service.test.ts`, `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1 : Importer le service dans reservation.service.ts**

En tête de `backend/src/services/reservation.service.ts`, après l'import `RefundService` (~ligne 15) :
```ts
import { MatchAlertService } from './matchAlert.service';
```
Dans la classe (près des autres services instanciés, ex. après `private ratingService`) ajouter :
```ts
  private matchAlerts = new MatchAlertService();
```
(Vérifier le nom exact du champ existant pour l'emplacement — sinon instancier en tête de méthode.)

- [ ] **Step 2 : Hook confirmReservation (avec dédup)**

Dans `confirmReservation`, remplacer la ligne existante `await this.safeNotify(() => notifyOpenMatchProposed(reservationId));` (~ligne 675) par :
```ts
    // D'abord les alertes horaires (plus spécifiques), puis les propositions « à mon niveau »
    // en excluant ceux déjà prévenus par une alerte (jamais 2 emails pour la même partie).
    let alerted: string[] = [];
    try { alerted = await this.matchAlerts.matchAndNotify(reservationId); }
    catch (err) { console.error('[reservation] matchAndNotify (confirm) échoué', err); }
    await this.safeNotify(() => notifyOpenMatchProposed(reservationId, alerted));
```

- [ ] **Step 3 : Hook setReservationVisibility → PUBLIC**

Dans `setReservationVisibility`, après le `prisma.reservation.update({ … })` final (avant le `return`, ou en gardant le résultat), déclencher le matcheur seulement au passage PUBLIC. Remplacer la fin :
```ts
    const updated = await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        visibility: input.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
        targetLevelMin: keepLevel ? (input.targetLevelMin ?? null) : null,
        targetLevelMax: keepLevel ? (input.targetLevelMax ?? null) : null,
      },
      select: { id: true, visibility: true, targetLevelMin: true, targetLevelMax: true },
    });
    if (updated.visibility === 'PUBLIC') {
      await this.safeNotify(() => this.matchAlerts.matchAndNotify(reservationId).then(() => undefined));
    }
    return updated;
```

- [ ] **Step 4 : Hook removeOwnReservationParticipant + removeReservationParticipant**

Dans `removeOwnReservationParticipant`, après `await this.applyRemoveParticipant(reservation, participantId);` :
```ts
    await this.safeNotify(() => this.matchAlerts.matchAndNotify(reservationId).then(() => undefined));
```
Idem dans `removeReservationParticipant`, après `await this.applyRemoveParticipant(reservation, participantId);`.

- [ ] **Step 5 : Hook openMatch removeOpenMatchPlayer**

Dans `backend/src/services/openMatch.service.ts`, importer en tête :
```ts
import { MatchAlertService } from './matchAlert.service';
```
Ajouter un champ à la classe `OpenMatchService` (près de `private ratingService`) :
```ts
  private matchAlerts = new MatchAlertService();
```
Dans `removeOpenMatchPlayer`, après le bloc de notif best-effort existant (après les `notifyOpenMatchLeft/Removed`, avant `return { id: reservationId };`) :
```ts
    // Une place vient de se libérer : prévenir les alertes horaires correspondantes.
    await this.safeNotify(() => this.matchAlerts.matchAndNotify(reservationId).then(() => undefined));
```
(`leaveOpenMatch` délègue à `removeOpenMatchPlayer` → couvert automatiquement.)

- [ ] **Step 6 : Tests de câblage (échouants)**

Dans `backend/src/services/__tests__/reservation.service.test.ts`, repérer comment `notifyOpenMatchProposed` est déjà mocké (bloc `jest.mock('../../email/notifications', …)`). Ajouter au mock du service :
```ts
const matchAndNotifyMock = jest.fn().mockResolvedValue([]);
jest.mock('../matchAlert.service', () => ({
  MatchAlertService: jest.fn().mockImplementation(() => ({ matchAndNotify: matchAndNotifyMock })),
}));
```
Ajouter un test dans le describe de `confirmReservation` (adapter au harnais existant — la suite utilise déjà des fixtures de confirmation) :
```ts
it('confirmReservation déclenche matchAndNotify puis notifyOpenMatchProposed(exclus)', async () => {
  matchAndNotifyMock.mockReset().mockResolvedValue(['alerted-user']);
  // … arranger la confirmation d'une résa PUBLIC padel comme les cas voisins …
  // après confirmation :
  expect(matchAndNotifyMock).toHaveBeenCalledWith(expect.any(String));
  // notifyOpenMatchProposed reçoit le tableau d'exclusion
});
```
> Si le harnais de `confirmReservation` est lourd à reproduire, cibler plutôt `removeOwnReservationParticipant` (plus simple) pour l'assertion `expect(matchAndNotifyMock).toHaveBeenCalled()`. L'essentiel est de prouver le câblage, pas de re-tester le matcheur.

Dans `backend/src/services/__tests__/openMatch.service.test.ts`, ajouter le même `jest.mock('../matchAlert.service', …)` et, dans le describe de `leaveOpenMatch`/`removeOpenMatchPlayer`, une assertion `expect(matchAndNotifyMock).toHaveBeenCalledWith('res-…')` après un départ réussi.

- [ ] **Step 7 : Lancer les suites impactées**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/reservation.service.test.ts src/services/__tests__/openMatch.service.test.ts
```
Expected: PASS (nouveaux tests + anciens verts — vérifier qu'aucun ancien test de `confirmReservation` ne casse à cause du nouveau flux ; le mock `matchAndNotify` renvoie `[]` par défaut).

- [ ] **Step 8 : Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/openMatch.service.ts backend/src/services/__tests__/reservation.service.test.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(alertes): declenche matchAndNotify aux 4 points (confirm/publish/2x place liberee)"
```

---

## Task 7 : Routes + ERROR_STATUS

**Files:**
- Modify: `backend/src/routes/clubs.ts` (imports, instance, `ERROR_STATUS`, 3 routes)
- Test: `backend/src/routes/__tests__/clubs.match-alerts.routes.test.ts` (créer, mirroir des routes existantes)

- [ ] **Step 1 : Importer + instancier le service**

Dans `backend/src/routes/clubs.ts`, après `import { OfferService } … ;` :
```ts
import { MatchAlertService } from '../services/matchAlert.service';
```
Après `const offerService = new OfferService();` :
```ts
const matchAlertService = new MatchAlertService();
```

- [ ] **Step 2 : Ajouter les codes d'erreur**

Dans `ERROR_STATUS`, ajouter :
```ts
  ALERT_LIMIT_REACHED:   409,
  ALERT_WINDOW_INVALID:  400,
```

- [ ] **Step 3 : Ajouter les 3 routes**

Après le bloc `--- Amis / suivi ---` (ou près des routes open-matches, ~ligne 327) :
```ts
// --- Alertes de parties ouvertes (recherche ponctuelle datée) ---
router.get('/:slug/match-alerts', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await matchAlertService.listMine(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});
router.post('/:slug/match-alerts', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await matchAlertService.create(asString(req.params.slug), req.user!.id, {
      date: asString(req.body?.date), from: asString(req.body?.from), to: asString(req.body?.to),
    }));
  } catch (err) { handleError(err, res, next); }
});
router.delete('/:slug/match-alerts/:id', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await matchAlertService.remove(asString(req.params.slug), req.user!.id, asString(req.params.id))); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4 : Écrire les tests de routes**

Créer `backend/src/routes/__tests__/clubs.match-alerts.routes.test.ts` en s'inspirant d'un test de routes existant (`clubs.openmatch-chat.routes.test.ts`) : construire une app express avec le routeur, mocker `MatchAlertService`, vérifier :
- `POST /:slug/match-alerts` 200 renvoie l'alerte créée ;
- `POST` avec `ALERT_WINDOW_INVALID` → 400 ; `ALERT_LIMIT_REACHED` → 409 ;
- `GET` 200 renvoie la liste ; `DELETE` 200.

```ts
import express from 'express';
import request from 'supertest';

const create = jest.fn(), listMine = jest.fn(), remove = jest.fn();
jest.mock('../../services/matchAlert.service', () => ({
  MatchAlertService: jest.fn().mockImplementation(() => ({ create, listMine, remove })),
}));
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { req.user = { id: 'u1' }; next(); },
  optionalAuth: (req: any, _res: any, next: any) => { req.user = { id: 'u1' }; next(); },
}));
// … mocker les autres services importés par clubs.ts si nécessaire (voir clubs.openmatch-chat.routes.test.ts) …

import clubsRouter from '../clubs';

const app = express();
app.use(express.json());
app.use('/api/clubs', clubsRouter);

describe('routes match-alerts', () => {
  beforeEach(() => { create.mockReset(); listMine.mockReset(); remove.mockReset(); });

  it('POST crée une alerte (200)', async () => {
    create.mockResolvedValue({ id: 'a1', windowStart: '2026-07-16T16:00:00.000Z', windowEnd: '2026-07-16T19:00:00.000Z' });
    const res = await request(app).post('/api/clubs/arena/match-alerts').send({ date: '2026-07-16', from: '18:00', to: '21:00' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('a1');
    expect(create).toHaveBeenCalledWith('arena', 'u1', { date: '2026-07-16', from: '18:00', to: '21:00' });
  });

  it('POST fenêtre invalide → 400', async () => {
    create.mockRejectedValue(new Error('ALERT_WINDOW_INVALID'));
    const res = await request(app).post('/api/clubs/arena/match-alerts').send({ date: 'x', from: 'y', to: 'z' });
    expect(res.status).toBe(400);
  });

  it('POST limite atteinte → 409', async () => {
    create.mockRejectedValue(new Error('ALERT_LIMIT_REACHED'));
    const res = await request(app).post('/api/clubs/arena/match-alerts').send({ date: '2026-07-16', from: '18:00', to: '21:00' });
    expect(res.status).toBe(409);
  });

  it('GET liste (200) et DELETE (200)', async () => {
    listMine.mockResolvedValue([{ id: 'a1' }]);
    remove.mockResolvedValue({ ok: true });
    expect((await request(app).get('/api/clubs/arena/match-alerts')).status).toBe(200);
    expect((await request(app).delete('/api/clubs/arena/match-alerts/a1')).status).toBe(200);
  });
});
```
> ⚠️ `clubs.ts` importe beaucoup de services : reprendre EXACTEMENT la liste des `jest.mock('../../services/…')` du fichier `clubs.openmatch-chat.routes.test.ts` pour que le routeur s'importe sans effet de bord (Stripe, prisma, etc.).

- [ ] **Step 5 : Lancer les tests de routes**

Run: `node node_modules/jest/bin/jest.js src/routes/__tests__/clubs.match-alerts.routes.test.ts`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/routes/__tests__/clubs.match-alerts.routes.test.ts
git commit -m "feat(alertes): routes GET/POST/DELETE /clubs/:slug/match-alerts"
```

---

## Task 8 : Purge des alertes expirées (job minute)

**Files:**
- Modify: `backend/src/jobs/cleanup.job.ts`
- Test: `backend/src/jobs/__tests__/cleanup.job.test.ts` (si la fonction est extraite/testable)

- [ ] **Step 1 : Brancher la purge dans le job**

Dans `backend/src/jobs/cleanup.job.ts`, importer :
```ts
import { MatchAlertService } from '../services/matchAlert.service';
```
En tête du module (près de `const matchService = …`) :
```ts
const matchAlertService = new MatchAlertService();
```
À la fin du callback `cron.schedule('* * * * *', …)`, après le bloc `releaseExpiredRegistrations` :
```ts
    try {
      const purged = await matchAlertService.purgeExpired();
      if (purged > 0) console.log(`[cleanup] ${purged} alerte(s) de partie expirée(s) purgée(s)`);
    } catch (err) {
      console.error('[cleanup] alertes:', (err as Error).message);
    }
```

- [ ] **Step 2 : Vérifier la compilation**

Run (depuis `backend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -i "cleanup\|matchAlert" || echo "OK"
```
Expected: `OK`.

- [ ] **Step 3 : Commit**

```bash
git add backend/src/jobs/cleanup.job.ts
git commit -m "feat(alertes): purge des alertes expirees dans le job minute"
```

---

## Task 9 : Frontend — helpers purs + api.ts

**Files:**
- Create: `frontend/lib/matchAlerts.ts`
- Test: `frontend/__tests__/matchAlerts.test.ts`
- Modify: `frontend/lib/api.ts` (type + 3 méthodes)

- [ ] **Step 1 : Écrire les tests des helpers (échouants)**

Create `frontend/__tests__/matchAlerts.test.ts` :
```ts
import { slotToAlertWindow, alertChipLabel } from '@/lib/matchAlerts';

describe('slotToAlertWindow — fenêtre ±1h autour d\'un créneau (fuseau du club)', () => {
  const tz = 'Europe/Paris'; // été = UTC+2

  it('élargit d\'1h de chaque côté et rend date + HH:MM locaux', () => {
    // créneau 18:30→20:00 local = 16:30Z→18:00Z ; ±1h = 17:30→21:00 local
    const w = slotToAlertWindow('2026-07-16T16:30:00.000Z', '2026-07-16T18:00:00.000Z', tz);
    expect(w).toEqual({ date: '2026-07-16', from: '17:30', to: '21:00' });
  });

  it('borne early : un créneau 08:00 local reste le même jour à 07:00', () => {
    // 08:00 local = 06:00Z ; -1h = 07:00 local
    const w = slotToAlertWindow('2026-07-16T06:00:00.000Z', '2026-07-16T07:00:00.000Z', tz);
    expect(w.from).toBe('07:00');
    expect(w.date).toBe('2026-07-16');
  });
});

describe('alertChipLabel', () => {
  it('rend « jeu. 16 juil. · 18h30 → 20h00 »', () => {
    const label = alertChipLabel({ id: 'a', windowStart: '2026-07-16T16:30:00.000Z', windowEnd: '2026-07-16T18:00:00.000Z' }, 'Europe/Paris');
    expect(label).toContain('18h30');
    expect(label).toContain('20h00');
  });
});
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/matchAlerts.test.ts
```
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Écrire les helpers**

Create `frontend/lib/matchAlerts.ts` :
```ts
import type { MatchAlert } from '@/lib/api';

const MS_HOUR = 3_600_000;

// Parties/heures d'un instant UTC dans un fuseau donné (sans luxon — Intl seul).
function localParts(iso: string, tz: string): { date: string; hm: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(d);
  const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
  return { date, hm };
}

/**
 * Fenêtre d'alerte pré-remplie autour d'un créneau : élargie d'1 h de chaque côté
 * (arithmétique pure sur les instants UTC → toujours correcte), puis exprimée en
 * date + HH:MM locaux du club. Les créneaux réservables (8h–22h) ne franchissent
 * jamais minuit après ±1 h → la date reste constante (hypothèse assumée).
 */
export function slotToAlertWindow(startIso: string, endIso: string, tz: string): { date: string; from: string; to: string } {
  const start = new Date(new Date(startIso).getTime() - MS_HOUR);
  const end   = new Date(new Date(endIso).getTime() + MS_HOUR);
  const s = localParts(start.toISOString(), tz);
  const e = localParts(end.toISOString(), tz);
  return { date: s.date, from: s.hm, to: e.hm };
}

/** Libellé de chip « jeu. 16 juil. · 18h30 → 20h00 » (fuseau du club). */
export function alertChipLabel(alert: MatchAlert, tz: string): string {
  const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(alert.windowStart));
  const hm = (iso: string) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
  return `${day} · ${hm(alert.windowStart)} → ${hm(alert.windowEnd)}`;
}
```

- [ ] **Step 4 : Ajouter le type + les méthodes à api.ts**

Dans `frontend/lib/api.ts`, près de `export interface OpenMatch` (~ligne 1511) :
```ts
export interface MatchAlert {
  id: string;
  windowStart: string; // ISO UTC
  windowEnd: string;   // ISO UTC
}
```
Dans l'objet `api`, après `getOpenMatchUnread` (~ligne 293) :
```ts
  listMyMatchAlerts: (slug: string, token: string) =>
    request<MatchAlert[]>(`/api/clubs/${slug}/match-alerts`, {}, token),
  createMatchAlert: (slug: string, body: { date: string; from: string; to: string }, token: string) =>
    request<MatchAlert>(`/api/clubs/${slug}/match-alerts`, { method: 'POST', body: JSON.stringify(body) }, token),
  deleteMatchAlert: (slug: string, id: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${slug}/match-alerts/${id}`, { method: 'DELETE' }, token),
```

- [ ] **Step 5 : Lancer les tests + tsc**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/matchAlerts.test.ts
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -i "matchAlert" || echo "OK tsc"
```
Expected: tests PASS ; `OK tsc`.

- [ ] **Step 6 : Commit**

```bash
git add frontend/lib/matchAlerts.ts frontend/__tests__/matchAlerts.test.ts frontend/lib/api.ts
git commit -m "feat(alertes): helpers purs matchAlerts + api.ts (type + 3 methodes)"
```

---

## Task 10 : `MatchAlertSheet` (feuille de création)

**Files:**
- Create: `frontend/components/openmatch/MatchAlertSheet.tsx`
- Test: `frontend/__tests__/MatchAlertSheet.test.tsx`

- [ ] **Step 1 : Repérer le pattern bottom-sheet + TimePicker/DateTimeField existants**

```bash
cd frontend && sed -n '1,40p' components/ui/DateTimeField.tsx
```
Noter les props (`date`, `time`, `onChange`, `defaultTime`…) pour les réutiliser.

- [ ] **Step 2 : Écrire le test (échouant)**

Create `frontend/__tests__/MatchAlertSheet.test.tsx` :
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MatchAlertSheet } from '@/components/openmatch/MatchAlertSheet';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: { createMatchAlert: jest.fn() },
  assetUrl: (u: string) => u,
}));
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: () => '#000' }) }) }));

const club = { slug: 'arena', timezone: 'Europe/Paris' } as any;

describe('MatchAlertSheet', () => {
  beforeEach(() => (api.createMatchAlert as jest.Mock).mockReset());

  it('crée une alerte avec date/from/to et appelle onCreated', async () => {
    (api.createMatchAlert as jest.Mock).mockResolvedValue({ id: 'a1', windowStart: '2026-07-16T16:00:00Z', windowEnd: '2026-07-16T19:00:00Z' });
    const onCreated = jest.fn();
    render(<MatchAlertSheet club={club} token="t" initial={{ date: '2026-07-16', from: '18:00', to: '21:00' }} onClose={() => {}} onCreated={onCreated} />);
    fireEvent.click(screen.getByRole('button', { name: /créer l.alerte/i }));
    await waitFor(() => expect(api.createMatchAlert).toHaveBeenCalledWith('arena', { date: '2026-07-16', from: '18:00', to: '21:00' }, 't'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('affiche le message d\'erreur ALERT_LIMIT_REACHED', async () => {
    (api.createMatchAlert as jest.Mock).mockRejectedValue(new Error('ALERT_LIMIT_REACHED'));
    render(<MatchAlertSheet club={club} token="t" initial={{ date: '2026-07-16', from: '18:00', to: '21:00' }} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /créer l.alerte/i }));
    await waitFor(() => expect(screen.getByText(/déjà 5 alertes/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 3 : Lancer (échec attendu)**

Run: `node node_modules/jest/bin/jest.js __tests__/MatchAlertSheet.test.tsx`
Expected: FAIL — module introuvable.

- [ ] **Step 4 : Écrire le composant**

Create `frontend/components/openmatch/MatchAlertSheet.tsx` — bottom-sheet (mirroir de `OpenMatchChatSheet` pour l'ossature : backdrop `position:fixed`, panneau `th.bg`, fermeture Échap/backdrop). Contenu : titre « Créer une alerte », champ date (input `type="date"`), deux `DateTimeField`/`TimePicker` (from/to) OU deux inputs `type="time"` simples si `DateTimeField` est surdimensionné, récap « Une partie à votre niveau le {date} entre {from} et {to} », bannière d'erreur, CTA « Créer l'alerte ». Mapping d'erreurs :
```tsx
const ALERT_ERRORS: Record<string, string> = {
  ALERT_LIMIT_REACHED: 'Vous avez déjà 5 alertes actives. Supprimez-en une pour en créer une nouvelle.',
  ALERT_WINDOW_INVALID: 'Choisissez une plage horaire valide, dans le futur.',
  MEMBERSHIP_BLOCKED: 'Votre accès à ce club est suspendu.',
  CLUB_NOT_FOUND: 'Club introuvable.',
};
```
Squelette :
```tsx
'use client';
import { useState } from 'react';
import { api, ClubDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

interface Props {
  club: Pick<ClubDetail, 'slug' | 'timezone'>;
  token: string;
  initial: { date: string; from: string; to: string };
  onClose: () => void;
  onCreated: () => void;
}
const ALERT_ERRORS: Record<string, string> = { /* … cf. ci-dessus … */ };

export function MatchAlertSheet({ club, token, initial, onClose, onCreated }: Props) {
  const { th } = useTheme();
  const [date, setDate] = useState(initial.date);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api.createMatchAlert(club.slug, { date, from, to }, token);
      onCreated();
    } catch (e) {
      setError(ALERT_ERRORS[(e as Error).message] ?? 'Impossible de créer l’alerte pour le moment.');
    } finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-label="Créer une alerte" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: th.bg, width: '100%', maxWidth: 520, borderRadius: '18px 18px 0 0', padding: 20 }}>
        <h2 style={{ fontFamily: th.fontDisplay, fontSize: 20, color: th.text, margin: '0 0 12px' }}>Créer une alerte</h2>
        <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, margin: '0 0 14px' }}>
          On vous prévient dès qu’une partie à votre niveau s’ouvre — ou libère une place — sur ce créneau.
        </p>
        <label style={{ display: 'block', fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginBottom: 4 }}>Jour</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          style={{ width: '100%', padding: '9px 10px', borderRadius: 10, border: `1px solid ${th.line}`, background: th.surface, color: th.text, fontFamily: th.fontUI, fontSize: 14 }} />
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>De</label>
            <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>À</label>
            <input type="time" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
        {error && <div style={{ marginTop: 12, background: th.accent, color: th.onAccent, borderRadius: 10, padding: '9px 12px', fontFamily: th.fontUI, fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} disabled={busy} style={{ flex: 1 }}>Annuler</button>
          <button onClick={submit} disabled={busy} style={{ flex: 2 }}>{busy ? 'Création…' : 'Créer l’alerte'}</button>
        </div>
      </div>
    </div>
  );
}
```
> Styliser les boutons/inputs selon le design system du projet (reprendre les styles d'un composant voisin, ex. `OpenMatchChatSheet`). L'important pour les tests : le bouton « Créer l’alerte » et le message d'erreur.

- [ ] **Step 5 : Lancer les tests (succès attendu)**

Run: `node node_modules/jest/bin/jest.js __tests__/MatchAlertSheet.test.tsx`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/openmatch/MatchAlertSheet.tsx frontend/__tests__/MatchAlertSheet.test.tsx
git commit -m "feat(alertes): MatchAlertSheet (feuille de creation)"
```

---

## Task 11 : Intégration `/parties` (bouton + chips + état vide)

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx`
- Test: `frontend/__tests__/OpenMatches.test.tsx`

- [ ] **Step 1 : Charger les alertes + états**

Dans `OpenMatches.tsx`, ajouter les imports :
```ts
import { MatchAlertSheet } from '@/components/openmatch/MatchAlertSheet';
import { alertChipLabel } from '@/lib/matchAlerts';
import type { MatchAlert } from '@/lib/api';
```
États (près des autres `useState`) :
```ts
const [alerts, setAlerts] = useState<MatchAlert[]>([]);
const [alertSheet, setAlertSheet] = useState<{ date: string; from: string; to: string } | null>(null);
```
Chargement (nouvel effet, gaté sur token) :
```ts
const loadAlerts = useCallback(() => {
  if (!token) { setAlerts([]); return; }
  api.listMyMatchAlerts(club.slug, token).then(setAlerts).catch(() => setAlerts([]));
}, [token, club.slug]);
useEffect(() => { loadAlerts(); }, [loadAlerts]);
```

- [ ] **Step 2 : Bouton « Créer une alerte » + chips**

Sous le paragraphe d'intro (après le bloc `<label>… À mon niveau</label>`, dans le `<div style={{ padding: '18px 20px 0' }}>`), pour un utilisateur connecté :
```tsx
{token && (
  <div style={{ marginTop: 14 }}>
    <button
      onClick={() => setAlertSheet({ date: new Date().toISOString().slice(0, 10), from: '18:00', to: '21:00' })}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: `1px solid ${th.line}`, background: th.surface, borderRadius: 999, padding: '8px 14px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text }}>
      🔔 Créer une alerte
    </button>
    {alerts.length > 0 && (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {alerts.map((al) => (
          <span key={al.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: th.surface2, borderRadius: 999, padding: '6px 10px 6px 12px', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
            {alertChipLabel(al, club.timezone)}
            <button aria-label="Supprimer l'alerte" onClick={async () => {
              setAlerts((xs) => xs.filter((x) => x.id !== al.id)); // optimiste
              try { await api.deleteMatchAlert(club.slug, al.id, token); } catch { loadAlerts(); }
            }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontSize: 15, lineHeight: 1 }}>✕</button>
          </span>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3 : Rappel dans l'état vide**

Dans le bloc d'état vide `'Aucune partie à ton niveau…' / 'Aucune partie ouverte…'` (~ligne 193), ajouter sous le texte, pour un connecté :
```tsx
{token && (
  <div style={{ marginTop: 12 }}>
    <button onClick={() => setAlertSheet({ date: new Date().toISOString().slice(0, 10), from: '18:00', to: '21:00' })}
      style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '9px 16px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>
      🔔 Créer une alerte
    </button>
  </div>
)}
```

- [ ] **Step 4 : Monter la feuille**

Avant `</Screen>` (à côté de `<OpenMatchModals … />`) :
```tsx
{alertSheet && token && (
  <MatchAlertSheet club={club} token={token} initial={alertSheet}
    onClose={() => setAlertSheet(null)}
    onCreated={() => { setAlertSheet(null); loadAlerts(); }} />
)}
```

- [ ] **Step 5 : Adapter les tests OpenMatches**

Dans `frontend/__tests__/OpenMatches.test.tsx`, ajouter au mock `@/lib/api` les méthodes `listMyMatchAlerts: jest.fn().mockResolvedValue([])`, `createMatchAlert: jest.fn()`, `deleteMatchAlert: jest.fn()`. Ajouter un test :
```tsx
it('affiche le bouton « Créer une alerte » pour un connecté', async () => {
  // … rendre OpenMatches avec token …
  expect(await screen.findByRole('button', { name: /créer une alerte/i })).toBeInTheDocument();
});
```
> ⚠️ `OpenMatches` monte le vrai `ClubNav` : conserver les mocks `api.getMyClubs`, etc. déjà présents dans la suite.

- [ ] **Step 6 : Lancer les tests + tsc**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/OpenMatches.test.tsx
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -i "OpenMatches\|matchAlert" || echo "OK tsc"
```
Expected: PASS ; `OK tsc`.

- [ ] **Step 7 : Commit**

```bash
git add frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "feat(alertes): /parties — bouton, chips et etat vide"
```

---

## Task 12 : Intégration Réserver (pill « pris » cliquable, padel)

**Files:**
- Modify: `frontend/components/ClubReserve.tsx`
- Modify: `frontend/components/reserve/SportGrid.tsx`
- Test: `frontend/__tests__/ClubReserve.alerts.test.tsx` (nouveau)

- [ ] **Step 1 : État + feuille dans ClubReserve**

Dans `frontend/components/ClubReserve.tsx`, imports :
```ts
import { MatchAlertSheet } from '@/components/openmatch/MatchAlertSheet';
import { slotToAlertWindow } from '@/lib/matchAlerts';
```
État (près des autres `useState`) :
```ts
const [alertSheet, setAlertSheet] = useState<{ date: string; from: string; to: string } | null>(null);
```
Handler (après `onSlot`) :
```ts
const onTakenSlot = useCallback((startIso: string, endIso: string) => {
  if (!token) return; // anonyme : pas d'alerte (le bouton n'apparaît pas)
  setAlertSheet(slotToAlertWindow(startIso, endIso, club.timezone));
}, [token, club.timezone]);
```

- [ ] **Step 2 : Rendre la pill « pris » cliquable pour le padel**

Dans le `renderSlot` (~ligne 350), la branche « pris/passé » est un `<span>`. La transformer en `<button>` cliquable uniquement si : padel (`cs.sport.key === 'padel'`), NON passé (`!isPast`), et connecté (`token`). Remplacer le `<span key={s.startTime} …>` de la branche `else` par :
```tsx
const canAlert = cs.sport.key === 'padel' && !isPast && !!token;
return canAlert ? (
  <button key={s.startTime} type="button" title="Créneau pris — être alerté si une partie s'ouvre"
    onClick={() => onTakenSlot(s.startTime, s.endTime)}
    style={{ border: 'none', borderRadius: 999, padding: '9px 4px', background: 'transparent', boxShadow: `inset 0 0 0 1.5px ${th.line}`, color: th.textFaint, fontFamily: th.fontMono, fontSize: 13, fontWeight: 600, textAlign: 'center', textDecoration: `line-through ${th.textFaint}`, cursor: 'pointer' }}>
    {formatHour(s.startTime, club.timezone)}
  </button>
) : (
  <span key={s.startTime} title={isPast ? 'Passé' : 'Réservé'}
    style={{ borderRadius: 999, padding: '9px 4px', background: 'transparent', boxShadow: `inset 0 0 0 1.5px ${th.line}`, color: th.textFaint, fontFamily: th.fontMono, fontSize: 13, fontWeight: 600, textAlign: 'center', textDecoration: `line-through ${th.textFaint}`, cursor: 'not-allowed' }}>
    {formatHour(s.startTime, club.timezone)}
  </span>
);
```
> Vérifier que `s.endTime` existe sur `TimeSlot` (sinon dériver `endIso` via la durée sélectionnée `selDur` : `new Date(new Date(s.startTime).getTime() + selDur*60000).toISOString()`).

- [ ] **Step 3 : Monter la feuille dans ClubReserve**

Avant la fermeture du composant (près du `BookingModal`/fin du JSX) :
```tsx
{alertSheet && token && (
  <MatchAlertSheet club={club} token={token} initial={alertSheet}
    onClose={() => setAlertSheet(null)} onCreated={() => setAlertSheet(null)} />
)}
```

- [ ] **Step 4 : Même geste en vue grille (SportGrid)**

Dans `frontend/components/reserve/SportGrid.tsx`, la matrice a des cellules « pris ». Ajouter une prop optionnelle `onTakenSlot?: (startIso: string, endIso: string) => void` et, pour une cellule prise padel non passée, rendre la cellule cliquable appelant `onTakenSlot`. Passer `onTakenSlot={onTakenSlot}` depuis `ClubReserve` au `<SportGrid …>` (~ligne 297). Si la structure de `SportGrid` ne porte pas le sport/instants facilement, limiter cette étape à la vue cartes et documenter la vue grille comme suivi (mais préférer la parité).

- [ ] **Step 5 : Écrire le test (nouveau)**

Create `frontend/__tests__/ClubReserve.alerts.test.tsx` : monter `ClubReserve` avec un club padel + une dispo où un créneau padel est `available:false` (pris) et à venir, cliquer dessus, vérifier l'ouverture de la feuille (`api.createMatchAlert` mocké). Reprendre le harnais des suites `ClubReserve.*` existantes (mêmes mocks `api.getClubAvailability`, `api.getMyClubs`, etc.).
```tsx
it('cliquer un créneau padel « pris » ouvre la feuille d\'alerte', async () => {
  // dispo : un slot pris à venir sur un terrain padel
  // … render ClubReserve avec token …
  const taken = await screen.findByTitle(/être alerté/i);
  fireEvent.click(taken);
  expect(await screen.findByRole('dialog', { name: /créer une alerte/i })).toBeInTheDocument();
});
```

- [ ] **Step 6 : Lancer les tests + tsc + suites Réserver voisines**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/ClubReserve.alerts.test.tsx __tests__/ClubReserve.view.test.tsx __tests__/ClubReserve.pastslots.test.tsx
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -i "ClubReserve\|SportGrid\|matchAlert" || echo "OK tsc"
```
Expected: PASS ; `OK tsc`. (Les suites voisines restent vertes — la branche « available » est inchangée.)

- [ ] **Step 7 : Commit**

```bash
git add frontend/components/ClubReserve.tsx frontend/components/reserve/SportGrid.tsx frontend/__tests__/ClubReserve.alerts.test.tsx
git commit -m "feat(alertes): Reserver — creneau pris (padel) ouvre une alerte pre-remplie"
```

---

## Task 13 : Vérification finale + mise à jour CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (ajouter une section « Alertes parties ouvertes »)

- [ ] **Step 1 : Suite backend complète**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js 2>&1 | tail -25
```
Expected: suites vertes (au moins toutes celles touchées : matchAlert.service, notifications.openmatch-proposed, registry, reservation.service, openMatch.service, clubs.match-alerts.routes).

- [ ] **Step 2 : Suite frontend ciblée + tsc global**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/matchAlerts.test.ts __tests__/MatchAlertSheet.test.tsx __tests__/OpenMatches.test.tsx __tests__/ClubReserve.alerts.test.tsx
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -iE "error TS" | grep -iE "matchAlert|OpenMatches|ClubReserve|SportGrid" || echo "OK tsc ciblé"
```
Expected: PASS ; `OK tsc ciblé`.
> Rappel mémoire : la suite frontend complète a un flake pré-existant sur `BookingModal` (~6 échecs d'isolation) — vérifier par suites ciblées + tsc, pas par `jest` global.

- [ ] **Step 3 : Documenter dans CLAUDE.md**

Ajouter une section « ## Alertes parties ouvertes (v1) ✅ implémenté » résumant : modèles `MatchAlert`/`MatchAlertHit` (migration additive `add_match_alerts`, DEV `prisma db execute`), matcheur `MatchAlertService.matchAndNotify` déclenché aux 4 points (confirm/publish/2× place libérée), dédup par hit + `notifyOpenMatchProposed(excludeUserIds)`, email `open_match.alert` (19ᵉ type), routes `/clubs/:slug/match-alerts`, purge job minute, UI `/parties` (bouton/chips) + Réserver (pill pris padel), hors-v1 (récurrent, reschedule, partie précise). Pointer la spec & ce plan.

- [ ] **Step 4 : Commit final**

```bash
git add CLAUDE.md
git commit -m "docs(alertes): section CLAUDE.md pour les alertes de parties ouvertes"
```

---

## Notes de vérification manuelle (après implémentation, hors TDD)

- Smoke local : sur `arena` (club-demo est padel), créer une alerte via `/parties` couvrant un créneau, puis publier une partie ouverte à ce créneau (interrupteur « Partie ouverte » à la réservation) → la cloche doit sonner.
- Vérifier CDP clair + sombre, mobile 390 + desktop 1280 (feuille sans débordement horizontal).
- ⚠️ SMTP prod à brancher pour l'email (comme toutes les notifs email).
- Un joueur `autoMatchProposals=ON` avec une alerte couvrante ne reçoit qu'UN email (l'alerte), pas deux.
