# Heure d'ouverture des réservations configurable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à chaque club de configurer le moment où une nouvelle journée devient réservable (mode d'ouverture + heures de release public/abonnés).

**Architecture:** Une fonction pure `maxBookableInstant` (point de vérité unique) calcule le dernier instant réservable selon 3 modes. Le backend l'applique de façon autoritative dans `holdSlot`, le frontend la mirroir pour griser les jours/créneaux non encore ouverts. Migration additive avec défauts reproduisant le comportement actuel (rétrocompat totale).

**Tech Stack:** Prisma 7 (Postgres) + Luxon (backend), Next.js + Intl.DateTimeFormat (frontend), Jest des deux côtés.

**Spec:** `docs/superpowers/specs/2026-06-15-heure-ouverture-reservations-design.md`

---

## File Structure

**Backend**
- `backend/prisma/schema.prisma` — *modifier* : enum `BookingReleaseMode` + 3 champs `Club`.
- `backend/prisma/migrations/<ts>_add_booking_release_hour/migration.sql` — *créer* (ou via `migrate dev`).
- `backend/src/services/booking-window.ts` — *créer* : `maxBookableInstant` + type `BookingReleaseMode`.
- `backend/src/services/__tests__/booking-window.test.ts` — *créer*.
- `backend/src/services/reservation.service.ts` — *modifier* : `holdSlot` select + `assertMembershipAndWindow`.
- `backend/src/services/__tests__/reservation.service.test.ts` — *modifier* : tests de câblage.
- `backend/src/services/club.service.ts` — *modifier* : selects + `updateClub`.
- `backend/src/services/__tests__/club.service.test.ts` — *modifier* : tests `updateClub`.

**Frontend**
- `frontend/lib/api.ts` — *modifier* : types `BookingReleaseMode`, `ClubDetail`, `ClubAdminDetail`, `UpdateClubBody`.
- `frontend/lib/bookingWindow.ts` — *créer* : miroir du calcul de fenêtre (Intl, sans Luxon).
- `frontend/__tests__/bookingWindow.test.ts` — *créer*.
- `frontend/components/ClubReserve.tsx` — *modifier* : `maxKey` + gating par créneau.
- `frontend/app/admin/settings/page.tsx` — *modifier* : UI mode + heures + body de sauvegarde.

---

## Task 1 : Modèle de données (enum + champs Club + migration)

**Files:**
- Modify: `backend/prisma/schema.prisma` (enums ~ligne 102 ; modèle `Club` ~ligne 142)
- Create: `backend/prisma/migrations/<ts>_add_booking_release_hour/migration.sql`

- [ ] **Step 1 : Ajouter l'enum Prisma**

Dans `backend/prisma/schema.prisma`, juste après le bloc `enum ClubEventStatus { ... }` (vers la ligne 106), ajouter :

```prisma
/// Mode d'ouverture des nouvelles réservations dans la fenêtre d'un club.
enum BookingReleaseMode {
  DAY_AT_HOUR    // toute la nouvelle journée s'ouvre à l'heure de release
  ROLLING_SLOT   // chaque créneau s'ouvre exactement W jours avant son horaire (heure ignorée)
  WINDOW_SHIFT   // réservable jusqu'à J+W à l'heure de release pile
}
```

- [ ] **Step 2 : Ajouter les 3 champs au modèle `Club`**

Dans `model Club`, juste après la ligne `memberBookingDays Int       @default(14) @map("member_booking_days")  // fenêtre élargie pour les abonnés` (ligne 142), ajouter :

```prisma
  // Ouverture des réservations dans la fenêtre. Défaut DAY_AT_HOUR + 0h = ouverture à minuit (comportement historique).
  bookingReleaseMode BookingReleaseMode @default(DAY_AT_HOUR) @map("booking_release_mode")
  publicReleaseHour  Int                @default(0)          @map("public_release_hour") // heure (0-23) d'ouverture grand public
  memberReleaseHour  Int                @default(0)          @map("member_release_hour") // heure (0-23) d'ouverture abonnés
```

- [ ] **Step 3 : Générer la migration + le client Prisma**

Run (depuis `backend/`, Postgres up) :
```bash
cd backend && npx prisma migrate dev --name add_booking_release_hour
```
Expected : crée `prisma/migrations/<ts>_add_booking_release_hour/migration.sql`, applique, régénère le client.

**Si Postgres est indisponible**, fallback manuel :
1. Créer le dossier `backend/prisma/migrations/20260615120000_add_booking_release_hour/` et le fichier `migration.sql` :
```sql
-- Ouverture des réservations configurable par club (mode + heures de release).
-- Additif : défauts = comportement historique (ouverture à minuit, journée entière).
CREATE TYPE "BookingReleaseMode" AS ENUM ('DAY_AT_HOUR', 'ROLLING_SLOT', 'WINDOW_SHIFT');

ALTER TABLE "clubs" ADD COLUMN "booking_release_mode" "BookingReleaseMode" NOT NULL DEFAULT 'DAY_AT_HOUR';
ALTER TABLE "clubs" ADD COLUMN "public_release_hour" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "clubs" ADD COLUMN "member_release_hour" INTEGER NOT NULL DEFAULT 0;
```
2. Run : `cd backend && npx prisma generate`
Expected : client régénéré avec `BookingReleaseMode` et les 3 champs.

- [ ] **Step 4 : Vérifier que la compilation TS voit les nouveaux champs**

Run : `cd backend && npx tsc --noEmit`
Expected : PASS (aucune erreur liée à `bookingReleaseMode`).

- [ ] **Step 5 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): ajoute mode + heures d'ouverture des réservations au Club"
```

---

## Task 2 : Helper pur `maxBookableInstant` (backend, TDD)

**Files:**
- Create: `backend/src/services/booking-window.ts`
- Test: `backend/src/services/__tests__/booking-window.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `backend/src/services/__tests__/booking-window.test.ts` :

```ts
import { DateTime } from 'luxon';
import { maxBookableInstant } from '../booking-window';

const tz = 'Europe/Paris';
const at = (iso: string) => DateTime.fromISO(iso, { zone: tz });

describe('maxBookableInstant', () => {
  describe('DAY_AT_HOUR', () => {
    it('rétrocompat : H=0 ⇒ fin de journée de aujourd’hui + W', () => {
      const max = maxBookableInstant(at('2026-06-15T06:00'), 7, 'DAY_AT_HOUR', 0);
      expect(max.toISO()).toBe(at('2026-06-22T00:00').endOf('day').toISO());
    });
    it('avant l’heure de release ⇒ W-1 jours', () => {
      const max = maxBookableInstant(at('2026-06-15T06:00'), 7, 'DAY_AT_HOUR', 8);
      expect(max.toISODate()).toBe('2026-06-21');
    });
    it('à/après l’heure de release ⇒ W jours', () => {
      const max = maxBookableInstant(at('2026-06-15T08:00'), 7, 'DAY_AT_HOUR', 8);
      expect(max.toISODate()).toBe('2026-06-22');
    });
    it('W=0 : le jour même reste ouvert même avant l’heure', () => {
      const max = maxBookableInstant(at('2026-06-15T06:00'), 0, 'DAY_AT_HOUR', 8);
      expect(max.toISODate()).toBe('2026-06-15');
    });
  });
  describe('ROLLING_SLOT', () => {
    it('ouvre exactement W jours après l’instant courant (heure ignorée)', () => {
      const max = maxBookableInstant(at('2026-06-15T18:30'), 7, 'ROLLING_SLOT', 8);
      expect(max.toISO()).toBe(at('2026-06-22T18:30').toISO());
    });
  });
  describe('WINDOW_SHIFT', () => {
    it('coupe à J+W à H:00', () => {
      const max = maxBookableInstant(at('2026-06-15T18:30'), 7, 'WINDOW_SHIFT', 8);
      expect(max.toISO()).toBe(at('2026-06-22T08:00').toISO());
    });
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run : `cd backend && npx jest booking-window`
Expected : FAIL avec « Cannot find module '../booking-window' ».

- [ ] **Step 3 : Implémenter le helper**

Créer `backend/src/services/booking-window.ts` :

```ts
import { DateTime } from 'luxon';

export type BookingReleaseMode = 'DAY_AT_HOUR' | 'ROLLING_SLOT' | 'WINDOW_SHIFT';

/**
 * Dernier instant réservable selon le mode d'ouverture du club.
 * Un créneau démarrant à `startLocal` est autorisé ssi `startLocal <= retour`.
 * `now` doit être exprimé dans le fuseau du club.
 *
 * Rétrocompat : DAY_AT_HOUR + releaseHour=0 ⇒ fin de journée de aujourd'hui+W
 * (la fenêtre glisse à minuit, comportement historique).
 */
export function maxBookableInstant(
  now: DateTime,
  windowDays: number,
  mode: BookingReleaseMode,
  releaseHour: number,
): DateTime {
  const W = Math.max(0, Math.trunc(windowDays || 0));
  const H = Math.min(23, Math.max(0, Math.trunc(releaseHour || 0)));

  if (mode === 'ROLLING_SLOT') {
    return now.plus({ days: W });
  }
  if (mode === 'WINDOW_SHIFT') {
    return now.startOf('day').plus({ days: W }).set({ hour: H, minute: 0, second: 0, millisecond: 0 });
  }
  // DAY_AT_HOUR (défaut). Plancher 0 : avec W=0 le jour même reste ouvert.
  const released = now.hour >= H ? W : Math.max(0, W - 1);
  return now.startOf('day').plus({ days: released }).endOf('day');
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run : `cd backend && npx jest booking-window`
Expected : PASS (6 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/booking-window.ts backend/src/services/__tests__/booking-window.test.ts
git commit -m "feat: helper maxBookableInstant (3 modes d'ouverture)"
```

---

## Task 3 : Câbler le helper dans `reservation.service` (TDD)

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (import ; `holdSlot` select ~ligne 178 ; `assertMembershipAndWindow` ~lignes 85-105)
- Test: `backend/src/services/__tests__/reservation.service.test.ts`

- [ ] **Step 1 : Écrire les tests de câblage qui échouent**

Dans `backend/src/services/__tests__/reservation.service.test.ts`, ajouter en tête de fichier (après les autres imports, ligne 6) :

```ts
import { Settings } from 'luxon';
```

Puis ajouter ce bloc `describe` à l'intérieur du `describe('ReservationService', () => { ... })` racine (par ex. juste après la fermeture du `describe('holdSlot', ...)`) :

```ts
  describe('assertMembershipAndWindow — heure d’ouverture', () => {
    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.reservationParticipant.createMany.mockResolvedValue({ count: 1 } as any);
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
      prismaMock.reservation.create.mockResolvedValue({
        id: 'res-x', status: 'PENDING', totalPrice: 25, createdAt: new Date(),
        startTime: new Date(), endTime: new Date(),
      } as any);
    });
    afterEach(() => { Settings.now = () => Date.now(); });

    const clubWith = (over: Record<string, unknown>) => ({
      price: 25, clubId: 'club-demo',
      club: {
        timezone: 'Europe/Paris', publicBookingDays: 7, memberBookingDays: 14,
        bookingReleaseMode: 'DAY_AT_HOUR', publicReleaseHour: 0, memberReleaseHour: 0, ...over,
      },
    });

    it('DAY_AT_HOUR : refuse la journée lointaine AVANT l’heure de release', async () => {
      Settings.now = () => new Date('2026-06-15T04:00:00.000Z').getTime(); // 06:00 Paris < 8h
      prismaMock.resource.findUniqueOrThrow.mockResolvedValue(
        clubWith({ bookingReleaseMode: 'DAY_AT_HOUR', publicReleaseHour: 8 }) as any);
      const start = new Date('2026-06-22T09:00:00.000Z'); // J+7
      await expect(service.holdSlot({
        resourceId: 'court-1', userId: 'user-1', startTime: start, endTime: new Date(start.getTime() + 3_600_000),
      })).rejects.toThrow('BOOKING_TOO_FAR');
    });

    it('DAY_AT_HOUR : ouvre la journée lointaine APRÈS l’heure de release', async () => {
      Settings.now = () => new Date('2026-06-15T07:00:00.000Z').getTime(); // 09:00 Paris ≥ 8h
      prismaMock.resource.findUniqueOrThrow.mockResolvedValue(
        clubWith({ bookingReleaseMode: 'DAY_AT_HOUR', publicReleaseHour: 8 }) as any);
      const start = new Date('2026-06-22T09:00:00.000Z'); // J+7
      const r = await service.holdSlot({
        resourceId: 'court-1', userId: 'user-1', startTime: start, endTime: new Date(start.getTime() + 3_600_000),
      });
      expect(r.status).toBe('PENDING');
    });
  });
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run : `cd backend && npx jest reservation.service -t "heure d’ouverture"`
Expected : FAIL (le 1er test ne lève pas `BOOKING_TOO_FAR` : la logique d'heure n'existe pas encore).

- [ ] **Step 3 : Importer le helper dans le service**

Dans `backend/src/services/reservation.service.ts`, après la ligne `import { PackageService } from './package.service';` (ligne 8), ajouter :

```ts
import { maxBookableInstant } from './booking-window';
```

- [ ] **Step 4 : Ajouter les champs au `select` du club dans `holdSlot`**

Dans `holdSlot`, remplacer la ligne (≈178) :

```ts
          club: { select: { timezone: true, offPeakHours: true, publicBookingDays: true, memberBookingDays: true, bookingQuotas: true } },
```

par :

```ts
          club: { select: { timezone: true, offPeakHours: true, publicBookingDays: true, memberBookingDays: true, bookingQuotas: true, bookingReleaseMode: true, publicReleaseHour: true, memberReleaseHour: true } },
```

- [ ] **Step 5 : Mettre à jour la signature + le corps de `assertMembershipAndWindow`**

Remplacer la signature (≈86) :

```ts
    resource: { clubId: string; club: { timezone: string; publicBookingDays: number; memberBookingDays: number } },
```

par :

```ts
    resource: { clubId: string; club: { timezone: string; publicBookingDays: number; memberBookingDays: number; bookingReleaseMode: 'DAY_AT_HOUR' | 'ROLLING_SLOT' | 'WINDOW_SHIFT'; publicReleaseHour: number; memberReleaseHour: number } },
```

Puis remplacer le bloc de calcul de fenêtre (≈94-99) :

```ts
    const isSubscriber = membership?.isSubscriber ?? false;
    const windowDays = isSubscriber ? resource.club.memberBookingDays : resource.club.publicBookingDays;
    const tz = resource.club.timezone;
    const maxDate = DateTime.now().setZone(tz).startOf('day').plus({ days: windowDays }).endOf('day');
    const startLocal = DateTime.fromJSDate(startTime).setZone(tz);
    if (startLocal > maxDate) throw new Error('BOOKING_TOO_FAR');
```

par :

```ts
    const isSubscriber = membership?.isSubscriber ?? false;
    const windowDays  = isSubscriber ? resource.club.memberBookingDays : resource.club.publicBookingDays;
    const releaseHour = isSubscriber ? resource.club.memberReleaseHour  : resource.club.publicReleaseHour;
    const tz = resource.club.timezone;
    const now = DateTime.now().setZone(tz);
    const maxInstant = maxBookableInstant(now, windowDays, resource.club.bookingReleaseMode, releaseHour);
    const startLocal = DateTime.fromJSDate(startTime).setZone(tz);
    if (startLocal > maxInstant) throw new Error('BOOKING_TOO_FAR');
```

- [ ] **Step 6 : Lancer les tests de câblage + la suite du service**

Run : `cd backend && npx jest reservation.service`
Expected : PASS (les nouveaux tests + tous les tests `holdSlot` existants — l'ancien test « BOOKING_TOO_FAR si +60 jours » reste vert car le mode par défaut `DAY_AT_HOUR` est lu via les mocks existants, et le helper traite un mode/heure absents comme DAY_AT_HOUR + 0h).

- [ ] **Step 7 : Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat: applique le mode d'ouverture des réservations dans holdSlot"
```

---

## Task 4 : Exposer + persister les champs dans `club.service` (TDD)

**Files:**
- Modify: `backend/src/services/club.service.ts` (`getClubBySlug` ~ligne 143 ; `getClubForAdmin` ~ligne 169 ; `updateClub` ~lignes 177-206)
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1 : Écrire les tests `updateClub` qui échouent**

Dans `backend/src/services/__tests__/club.service.test.ts`, ajouter à la fin du fichier :

```ts
describe('ClubService — updateClub heures d’ouverture', () => {
  let svc: ClubService;
  beforeEach(() => { svc = new ClubService(); });

  it('clampe les heures de release (0-23) et accepte un mode valide', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { bookingReleaseMode: 'WINDOW_SHIFT', publicReleaseHour: 30, memberReleaseHour: -2 });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.bookingReleaseMode).toBe('WINDOW_SHIFT');
    expect(arg.data.publicReleaseHour).toBe(23);
    expect(arg.data.memberReleaseHour).toBe(0);
  });

  it('ignore un mode invalide', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { bookingReleaseMode: 'NOPE' as any });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.bookingReleaseMode).toBeUndefined();
  });

  it('ignore les heures absentes', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { name: 'X' });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.publicReleaseHour).toBeUndefined();
    expect(arg.data.memberReleaseHour).toBeUndefined();
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run : `cd backend && npx jest club.service -t "heures d’ouverture"`
Expected : FAIL (`updateClub` ne connaît pas encore `bookingReleaseMode` / `publicReleaseHour`).

- [ ] **Step 3 : Exposer les champs dans `getClubBySlug` (détail public)**

Dans `getClubBySlug`, remplacer la ligne (≈143) :

```ts
        publicBookingDays: true, memberBookingDays: true,
```

par :

```ts
        publicBookingDays: true, memberBookingDays: true,
        bookingReleaseMode: true, publicReleaseHour: true, memberReleaseHour: true,
```

- [ ] **Step 4 : Exposer les champs dans `getClubForAdmin`**

Dans `getClubForAdmin`, remplacer la ligne (≈169) :

```ts
        listedInDirectory: true, publicBookingDays: true, memberBookingDays: true, offPeakHours: true,
```

par :

```ts
        listedInDirectory: true, publicBookingDays: true, memberBookingDays: true, offPeakHours: true,
        bookingReleaseMode: true, publicReleaseHour: true, memberReleaseHour: true,
```

- [ ] **Step 5 : Accepter + valider les champs dans `updateClub`**

Dans la signature de `updateClub` (objet `params`), après la ligne `listedInDirectory?: boolean; publicBookingDays?: number; memberBookingDays?: number;` (≈180), ajouter :

```ts
    bookingReleaseMode?: 'DAY_AT_HOUR' | 'ROLLING_SLOT' | 'WINDOW_SHIFT';
    publicReleaseHour?: number;
    memberReleaseHour?: number;
```

Juste après la ligne `const clamp = (n: number) => Math.max(0, Math.min(365, Math.trunc(n)));` (≈186), ajouter :

```ts
    const clampHour = (n: number) => Math.max(0, Math.min(23, Math.trunc(n)));
    const VALID_RELEASE_MODES = new Set(['DAY_AT_HOUR', 'ROLLING_SLOT', 'WINDOW_SHIFT']);
```

Dans l'objet `data`, après la ligne `...(typeof params.memberBookingDays === 'number' ? { memberBookingDays: clamp(params.memberBookingDays) } : {}),` (≈202), ajouter :

```ts
        ...(params.bookingReleaseMode !== undefined && VALID_RELEASE_MODES.has(params.bookingReleaseMode) ? { bookingReleaseMode: params.bookingReleaseMode } : {}),
        ...(typeof params.publicReleaseHour === 'number' ? { publicReleaseHour: clampHour(params.publicReleaseHour) } : {}),
        ...(typeof params.memberReleaseHour === 'number' ? { memberReleaseHour: clampHour(params.memberReleaseHour) } : {}),
```

- [ ] **Step 6 : Lancer les tests**

Run : `cd backend && npx jest club.service`
Expected : PASS (nouveaux tests + existants).

- [ ] **Step 7 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat: expose et persiste le mode + heures d'ouverture (club.service)"
```

---

## Task 5 : Types frontend (`api.ts`)

**Files:**
- Modify: `frontend/lib/api.ts` (`ClubDetail` ~ligne 498 ; `ClubAdminDetail` ~ligne 656 ; `UpdateClubBody` ~ligne 688)

- [ ] **Step 1 : Ajouter le type `BookingReleaseMode`**

Dans `frontend/lib/api.ts`, juste avant `export interface ClubDetail {` (≈498), ajouter :

```ts
export type BookingReleaseMode = 'DAY_AT_HOUR' | 'ROLLING_SLOT' | 'WINDOW_SHIFT';
```

- [ ] **Step 2 : Étendre `ClubDetail`**

Dans `export interface ClubDetail`, après la ligne `memberBookingDays: number;` (≈512), ajouter :

```ts
  bookingReleaseMode: BookingReleaseMode;
  publicReleaseHour: number;
  memberReleaseHour: number;
```

- [ ] **Step 3 : Étendre `ClubAdminDetail`**

Dans `export interface ClubAdminDetail`, après la ligne `memberBookingDays: number;` (≈671), ajouter :

```ts
  bookingReleaseMode: BookingReleaseMode;
  publicReleaseHour: number;
  memberReleaseHour: number;
```

- [ ] **Step 4 : Étendre `UpdateClubBody`**

Dans `export type UpdateClubBody = Partial<{ ... }>`, après la ligne `memberBookingDays: number;` (≈699), ajouter :

```ts
  bookingReleaseMode: BookingReleaseMode;
  publicReleaseHour: number;
  memberReleaseHour: number;
```

- [ ] **Step 5 : Vérifier la compilation**

Run : `cd frontend && npx tsc --noEmit`
Expected : des erreurs UNIQUEMENT là où on consommera ces champs (ClubReserve / settings) sont attendues plus tard ; à ce stade, PASS (ajouts de types seuls).

- [ ] **Step 6 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(types): champs d'ouverture des réservations (api.ts)"
```

---

## Task 6 : Helper de fenêtre frontend `lib/bookingWindow.ts` (TDD)

**Files:**
- Create: `frontend/lib/bookingWindow.ts`
- Test: `frontend/__tests__/bookingWindow.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/bookingWindow.test.ts` :

```ts
import { bookingWindow, addDaysToKey } from '../lib/bookingWindow';

const tz = 'Europe/Paris';

describe('addDaysToKey', () => {
  it('ajoute des jours en arithmétique calendaire', () => {
    expect(addDaysToKey('2026-06-15', 7)).toBe('2026-06-22');
    expect(addDaysToKey('2026-06-30', 1)).toBe('2026-07-01');
  });
});

describe('bookingWindow', () => {
  it('DAY_AT_HOUR : avant l’heure ⇒ maxDayKey = aujourd’hui + (W-1)', () => {
    const now = new Date('2026-06-15T04:00:00.000Z'); // 06:00 Paris < 8h
    const w = bookingWindow(now, tz, 7, 'DAY_AT_HOUR', 8);
    expect(w.maxDayKey).toBe('2026-06-21');
    expect(w.slotAllowed('2026-06-21T17:00:00.000Z')).toBe(true); // journée entière ouverte
  });

  it('DAY_AT_HOUR : après l’heure ⇒ maxDayKey = aujourd’hui + W', () => {
    const now = new Date('2026-06-15T07:00:00.000Z'); // 09:00 Paris ≥ 8h
    const w = bookingWindow(now, tz, 7, 'DAY_AT_HOUR', 8);
    expect(w.maxDayKey).toBe('2026-06-22');
  });

  it('ROLLING_SLOT : un créneau au-delà de now + W jours est fermé', () => {
    const now = new Date('2026-06-15T10:00:00.000Z');
    const w = bookingWindow(now, tz, 7, 'ROLLING_SLOT', 8);
    expect(w.slotAllowed('2026-06-22T09:00:00.000Z')).toBe(true);  // ≤ now+7j
    expect(w.slotAllowed('2026-06-22T11:00:00.000Z')).toBe(false); // > now+7j
  });

  it('WINDOW_SHIFT : le dernier jour n’est ouvert que jusqu’à H:00 (heure club)', () => {
    const now = new Date('2026-06-15T10:00:00.000Z');
    const w = bookingWindow(now, tz, 7, 'WINDOW_SHIFT', 8);
    expect(w.maxDayKey).toBe('2026-06-22');
    // 2026-06-22 06:00 Paris (= 04:00Z) ≤ 8h ⇒ ouvert ; 10:00 Paris (= 08:00Z) > 8h ⇒ fermé
    expect(w.slotAllowed('2026-06-22T04:00:00.000Z')).toBe(true);
    expect(w.slotAllowed('2026-06-22T08:00:00.000Z')).toBe(false);
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run : `cd frontend && npx jest bookingWindow`
Expected : FAIL avec « Cannot find module '../lib/bookingWindow' ».

- [ ] **Step 3 : Implémenter le helper**

Créer `frontend/lib/bookingWindow.ts` :

```ts
import type { BookingReleaseMode } from './api';

const DAY_MS = 86_400_000;

/** Heure (0-23) de `now` dans le fuseau `tz`. */
function hourInTz(now: Date, tz: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(now);
  return Number(h) % 24; // '24' (minuit) → 0
}

/** Clé calendaire 'YYYY-MM-DD' de `instant` dans le fuseau `tz`. */
export function dayKeyInTz(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(instant);
}

/** Minutes depuis minuit (0-1439) de `instant` dans le fuseau `tz`. */
function minutesInTz(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(instant);
  const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value);
  return h * 60 + m;
}

/** Ajoute `n` jours à une clé 'YYYY-MM-DD' (arithmétique calendaire pure, sans fuseau). */
export function addDaysToKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export interface BookingWindow {
  /** Dernier jour sélectionnable 'YYYY-MM-DD' (pour DateSelector.maxKey). */
  maxDayKey: string;
  /** Un créneau (startTime ISO) est-il déjà ouvert à la réservation ? */
  slotAllowed: (startIso: string) => boolean;
}

/**
 * Fenêtre de réservation effective côté affichage — miroir de
 * backend `maxBookableInstant`. `now` = instant courant ; `tz` = fuseau du club.
 */
export function bookingWindow(
  now: Date, tz: string, windowDays: number, mode: BookingReleaseMode, releaseHour: number,
): BookingWindow {
  const W = Math.max(0, Math.trunc(windowDays || 0));
  const H = Math.min(23, Math.max(0, Math.trunc(releaseHour || 0)));
  const todayKey = dayKeyInTz(now, tz);

  if (mode === 'ROLLING_SLOT') {
    const maxInstant = now.getTime() + W * DAY_MS;
    return {
      maxDayKey: addDaysToKey(todayKey, W),
      slotAllowed: (iso) => new Date(iso).getTime() <= maxInstant,
    };
  }
  if (mode === 'WINDOW_SHIFT') {
    const maxDayKey = addDaysToKey(todayKey, W);
    return {
      maxDayKey,
      slotAllowed: (iso) => {
        const k = dayKeyInTz(new Date(iso), tz);
        if (k < maxDayKey) return true;
        if (k > maxDayKey) return false;
        return minutesInTz(new Date(iso), tz) <= H * 60;
      },
    };
  }
  // DAY_AT_HOUR (défaut) : journée entière ouverte → gating au niveau du jour.
  const released = hourInTz(now, tz) >= H ? W : Math.max(0, W - 1);
  return {
    maxDayKey: addDaysToKey(todayKey, released),
    slotAllowed: () => true,
  };
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run : `cd frontend && npx jest bookingWindow`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/bookingWindow.ts frontend/__tests__/bookingWindow.test.ts
git commit -m "feat: helper frontend bookingWindow (miroir du backend)"
```

---

## Task 7 : Gating de l'affichage joueur (`ClubReserve.tsx`)

**Files:**
- Modify: `frontend/components/ClubReserve.tsx` (helper `nextDays` ~lignes 20-32 ; `windowDays`/`days` ~lignes 60-61 ; `DateSelector` ~ligne 144 ; rendu des créneaux ~ligne 184)

- [ ] **Step 1 : Importer le helper**

Dans `frontend/components/ClubReserve.tsx`, après la ligne `import { ClubNav } from '@/components/ClubNav';` (≈16), ajouter :

```ts
import { bookingWindow } from '@/lib/bookingWindow';
```

- [ ] **Step 2 : Remplacer le calcul de fenêtre**

Remplacer les lignes (≈60-61) :

```ts
  const windowDays = (isSub ? club.memberBookingDays : club.publicBookingDays);
  const days = nextDays(Math.max(1, windowDays + 1));
```

par :

```ts
  const windowDays  = isSub ? club.memberBookingDays : club.publicBookingDays;
  const releaseHour = isSub ? club.memberReleaseHour : club.publicReleaseHour;
  const win = bookingWindow(new Date(), club.timezone, windowDays, club.bookingReleaseMode, releaseHour);
```

- [ ] **Step 3 : Supprimer la fonction `nextDays` devenue inutilisée**

Supprimer le bloc (≈20-32) :

```ts
function nextDays(count: number) {
  const out: { key: string; dow: string; day: string }[] = [];
  const base = new Date();
  // ... (corps de la fonction)
  return out;
}
```

(Si une autre référence à `nextDays` subsiste — la rechercher — la migrer ; sinon le retrait évite un avertissement « unused ».)

- [ ] **Step 4 : Passer `maxKey` au `DateSelector`**

Remplacer la ligne (≈144) :

```ts
              <DateSelector value={date} onChange={setDate} days={7} maxKey={days[days.length - 1]?.key} />
```

par :

```ts
              <DateSelector value={date} onChange={setDate} days={7} maxKey={win.maxDayKey} />
```

- [ ] **Step 5 : Griser les créneaux non encore ouverts**

Remplacer la ligne d'ouverture du `.map` des créneaux (≈184) :

```ts
                                {slots.map((s) => s.available ? (
```

par :

```ts
                                {slots.map((s) => (s.available && win.slotAllowed(s.startTime)) ? (
```

(Le créneau gardé indisponible retombe automatiquement sur la branche `else` existante du ternaire — même rendu « non cliquable ».)

- [ ] **Step 6 : Vérifier compilation + tests existants de ClubReserve**

Run : `cd frontend && npx tsc --noEmit && npx jest ClubReserve`
Expected : PASS (les tests `ClubReserve.deeplink` existants restent verts ; en mode par défaut DAY_AT_HOUR + 0h, `slotAllowed` renvoie toujours `true` et `maxDayKey` = aujourd'hui + W, soit le comportement antérieur).

> Note : le mock de club des tests existants (`frontend/__tests__/ClubReserve.deeplink.test.tsx`) ne fournit pas encore les nouveaux champs. Si un test échoue sur `club.bookingReleaseMode` undefined, ajouter au mock club : `bookingReleaseMode: 'DAY_AT_HOUR', publicReleaseHour: 0, memberReleaseHour: 0` (le helper traite déjà `undefined` comme DAY_AT_HOUR + 0h, donc l'ajout est surtout pour la cohérence des types TS du test).

- [ ] **Step 7 : Commit**

```bash
git add frontend/components/ClubReserve.tsx frontend/__tests__/ClubReserve.deeplink.test.tsx
git commit -m "feat: respecte le mode d'ouverture dans l'affichage joueur (ClubReserve)"
```

---

## Task 8 : Réglages admin (`settings/page.tsx`)

**Files:**
- Modify: `frontend/app/admin/settings/page.tsx` (carte « Réservation à l'avance » ~lignes 203-210 ; `save` ~lignes 105-115)

- [ ] **Step 1 : Inclure les 3 champs dans le body de sauvegarde**

Dans `save`, dans l'objet `body: UpdateClubBody = { ... }`, après la ligne `publicBookingDays: Number(club.publicBookingDays), memberBookingDays: Number(club.memberBookingDays),` (≈110), ajouter :

```ts
        bookingReleaseMode: club.bookingReleaseMode,
        publicReleaseHour: Number(club.publicReleaseHour), memberReleaseHour: Number(club.memberReleaseHour),
```

- [ ] **Step 2 : Ajouter l'UI mode + heures dans la carte « Réservation à l'avance »**

Dans la carte existante, juste après le `<div style={{ display: 'flex', gap: 12 }}> ... </div>` qui contient « Public (jours) » / « Abonnés (jours) » (la balise fermante `</div>` ≈209), et AVANT la fermeture `</div>` de la carte (≈210), insérer :

```tsx
        <div style={{ marginTop: 16 }}>
          <span style={label}>Ouverture des nouvelles réservations</span>
          <select
            value={club.bookingReleaseMode}
            onChange={(e) => set('bookingReleaseMode', e.target.value as ClubAdminDetail['bookingReleaseMode'])}
            style={field}
          >
            <option value="DAY_AT_HOUR">Journée entière à heure fixe (à H, toute la nouvelle journée s’ouvre)</option>
            <option value="ROLLING_SLOT">Au fil de l’eau (chaque créneau s’ouvre X jours avant son horaire)</option>
            <option value="WINDOW_SHIFT">Fenêtre jusqu’à l’heure (réservable jusqu’à J+X à H:00)</option>
          </select>
          <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: '8px 0 0' }}>
            « Au fil de l’eau » n’utilise pas l’heure de release ci-dessous. Heure 0 = ouverture à minuit (comportement par défaut).
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 12, opacity: club.bookingReleaseMode === 'ROLLING_SLOT' ? 0.4 : 1 }}>
          <div style={{ flex: 1 }}>
            <span style={label}>Heure publique (0-23)</span>
            <input type="number" min={0} max={23} disabled={club.bookingReleaseMode === 'ROLLING_SLOT'}
              value={club.publicReleaseHour} onChange={(e) => set('publicReleaseHour', Number(e.target.value))} style={field} />
          </div>
          <div style={{ flex: 1 }}>
            <span style={label}>Heure abonnés (0-23)</span>
            <input type="number" min={0} max={23} disabled={club.bookingReleaseMode === 'ROLLING_SLOT'}
              value={club.memberReleaseHour} onChange={(e) => set('memberReleaseHour', Number(e.target.value))} style={field} />
          </div>
        </div>
```

- [ ] **Step 3 : Vérifier la compilation**

Run : `cd frontend && npx tsc --noEmit`
Expected : PASS.

- [ ] **Step 4 : Vérification visuelle rapide (facultatif si l'app tourne)**

Démarrer le front et ouvrir `/admin/settings` (sous-domaine d'un club). Attendu : la carte « Réservation à l'avance » affiche le sélecteur de mode + 2 champs heure ; les heures se grisent quand le mode « Au fil de l'eau » est choisi ; « Enregistrer » persiste (recharger la page conserve les valeurs).

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/admin/settings/page.tsx
git commit -m "feat: réglage admin du mode + heures d'ouverture des réservations"
```

---

## Task 9 : Vérification finale (suites complètes + build)

**Files:** aucun (vérification).

- [ ] **Step 1 : Suite backend complète**

Run : `cd backend && npx jest`
Expected : PASS (tous les tests, dont les nouveaux `booking-window`, `reservation.service`, `club.service`).

- [ ] **Step 2 : Suite frontend complète**

Run : `cd frontend && npx jest`
Expected : PASS (dont `bookingWindow`).

- [ ] **Step 3 : Type-check des deux côtés**

Run : `cd backend && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit`
Expected : PASS.

- [ ] **Step 4 : Revue finale**

Demander une revue de code (skill `superpowers:requesting-code-review`) avant de proposer le merge de la branche.

---

## Notes d'implémentation

- **Rétrocompat** : tant qu'un club reste sur `DAY_AT_HOUR` + heures `0`, `maxBookableInstant` rend `endOf('day')` de aujourd'hui+W et `slotAllowed` est toujours vrai — identique à l'actuel.
- **Fuseaux** : backend en Luxon (`setZone(tz)`), frontend en `Intl.DateTimeFormat({ timeZone: tz })`. Les deux calculent « aujourd'hui » et « l'heure » dans le fuseau du club.
- **Autorité** : `holdSlot` reste le seul point bloquant ; l'affichage joueur est best-effort. L'endpoint de dispo anonyme n'est pas modifié.
- **Duplication** : la règle vit aux deux endroits (helper backend + frontend) avec des jeux de tests jumeaux ; toute évolution future touche les deux.
