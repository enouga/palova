# Badges sport & club — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher le **sport** (si le club est multi-sport) et le **club** (dans les vues multi-clubs) sur toutes les surfaces qui listent/affichent tournois, events, parties ouvertes et cours.

**Architecture:** Plomberie **uniforme** — on sérialise un champ additif `sport: { key, name }` sur chaque DTO concerné (relations déjà présentes → **aucune migration**), et un **helper front pur** (`lib/sportBadge.ts`) décide de l'affichage. Le club est déjà présent dans les vues multi-clubs ; on n'y touche que pour garder la cohérence.

**Tech Stack:** Backend Express + Prisma (tests Jest avec `prismaMock`). Frontend Next.js 16 / React 19 (tests RTL + Jest).

---

## Conventions

- **Forme du sport** partout : `sport: { key: string; name: string } | null` (`null` autorisé là où `clubSportId` est nullable — events, cours).
- **Tests backend** : style existant — `prismaMock.<model>.<method>.mockResolvedValue(...)` puis assertion `toMatchObject`. Les fixtures doivent inclure le `clubSport: { sport: { key, name } }` imbriqué que le service aplatit.
- **Commits** : un par tâche, terminés par la ligne `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Vérif** : à la fin, `npm test` ciblé (suites touchées) + `npx tsc --noEmit` des deux côtés.

---

## Task 1 : `OpenMatch.sport` (parties ouvertes)

**Files:**
- Modify: `backend/src/services/openMatch.service.ts:60` (select) et `:91-113` (DTO)
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans le `describe` de `listOpenMatches` (mirror des mocks existants) :

```ts
it('expose le sport du terrain sur chaque partie', async () => {
  prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
  prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
  prismaMock.reservation.findMany.mockResolvedValue([{
    id: 'r1', startTime: new Date('2030-01-01T10:00:00Z'), endTime: new Date('2030-01-01T11:00:00Z'),
    targetLevelMin: null, targetLevelMax: null,
    resource: { id: 'court-1', name: 'Court 1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel', name: 'Padel' } } },
    participants: [], openMatchInterests: [], openMatchMessages: [],
  }] as any);

  const [match] = await service.listOpenMatches('demo', 'viewer');

  expect(match.sport).toEqual({ key: 'padel', name: 'Padel' });
});
```

- [ ] **Step 2: Lancer le test → échec**

Run: `cd backend && npx jest openMatch.service -t "expose le sport"`
Expected: FAIL (`match.sport` is undefined).

- [ ] **Step 3: Ajouter `name` au select**

`openMatch.service.ts:60` — passer `sport: { select: { key: true } }` à `sport: { select: { key: true, name: true } }` :

```ts
resource: { select: { id: true, name: true, attributes: true, clubSport: { select: { sport: { select: { key: true, name: true } } } } } },
```

- [ ] **Step 4: Ajouter `sport` au DTO**

Dans le `return matches.map((m) => { ... })` (`openMatch.service.ts:91`), ajouter après `resourceName: m.resource.name,` :

```ts
        sport: { key: m.resource.clubSport.sport.key, name: m.resource.clubSport.sport.name },
```

- [ ] **Step 5: Lancer le test → succès**

Run: `cd backend && npx jest openMatch.service`
Expected: PASS (toute la suite).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(parties): expose le sport du terrain sur OpenMatch"
```

---

## Task 2 : Sport sur les tournois (liste publique, national, « Mes tournois »)

> `getById` (détail) inclut **déjà** `clubSport.sport.{key,name}` → le détail n'a pas besoin de changement backend.

**Files:**
- Modify: `backend/src/services/tournament.service.ts` — `listPublicByClubSlug` (~293), `listNationalTournaments` (~309), `listUserRegistrations` (~365)
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1: Tests qui échouent**

Dans `describe('TournamentService — admin & lectures')`, étendre le test `listPublicByClubSlug` existant (ou en ajouter un) :

```ts
it('listPublicByClubSlug expose le sport', async () => {
  prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
  prismaMock.tournament.findMany.mockResolvedValue([
    { id: 't1', clubSport: { sport: { key: 'padel', name: 'Padel' } } },
  ] as any);
  (prismaMock.tournamentRegistration.groupBy as jest.Mock).mockResolvedValue([]);

  const [t] = await service.listPublicByClubSlug('club-demo');

  expect(t.sport).toEqual({ key: 'padel', name: 'Padel' });
  expect((t as any).clubSport).toBeUndefined(); // aplati, pas de fuite de forme
});
```

Dans `describe('TournamentService.listNationalTournaments')`, étendre une fixture existante pour inclure `clubSport` et assert :

```ts
it('expose le sport sur chaque tournoi national', async () => {
  prismaMock.tournament.findMany.mockResolvedValue([
    { id: 't1', club: { slug: 'demo', name: 'Demo', city: 'Paris', department: 'Paris', departmentCode: '75', timezone: 'Europe/Paris', accentColor: '#000', logoUrl: null, latitude: null, longitude: null },
      clubSport: { sport: { key: 'tennis', name: 'Tennis' } } },
  ] as any);
  (prismaMock.tournamentRegistration.groupBy as jest.Mock).mockResolvedValue([]);

  const [t] = await svc.listNationalTournaments();

  expect(t.sport).toEqual({ key: 'tennis', name: 'Tennis' });
});
```

Dans le test `listUserRegistrations`, ajouter `clubSport` à la fixture `tournament` et assert `reg.tournament.sport` :

```ts
// dans la fixture existante : tournament: { clubId: 'club-demo', club: { slug: 'demo' }, clubSport: { sport: { key: 'padel', name: 'Padel' } } }
expect(reg.tournament.sport).toEqual({ key: 'padel', name: 'Padel' });
```

- [ ] **Step 2: Lancer → échec**

Run: `cd backend && npx jest tournament.service -t "sport"`
Expected: FAIL.

- [ ] **Step 3: `listPublicByClubSlug` — include + flatten**

Remplacer le corps (`tournament.service.ts:293-297`) :

```ts
    const tournaments = await prisma.tournament.findMany({
      where: { clubId: club.id, status: 'PUBLISHED' },
      orderBy: { startTime: 'asc' },
      include: { clubSport: { select: { sport: { select: { key: true, name: true } } } } },
    });
    const withCounts = await this.withCounts(tournaments);
    return withCounts.map(({ clubSport, ...t }) => ({ ...t, sport: clubSport?.sport ?? null }));
```

- [ ] **Step 4: `listNationalTournaments` — include + flatten**

Dans le `include` (`tournament.service.ts:315-317`), ajouter `clubSport` ; puis aplatir le retour :

```ts
      include: {
        club: { select: { slug: true, name: true, city: true, department: true, departmentCode: true, timezone: true, accentColor: true, logoUrl: true, latitude: true, longitude: true } },
        clubSport: { select: { sport: { select: { key: true, name: true } } } },
      },
      orderBy: { startTime: 'asc' },
    });
    const withCounts = await this.withCounts(tournaments);
    return withCounts.map(({ clubSport, ...t }) => ({ ...t, sport: clubSport?.sport ?? null }));
```

(Remplace la ligne `return this.withCounts(tournaments);`.)

- [ ] **Step 5: `listUserRegistrations` — include + flatten du tournoi embarqué**

Dans le `include` (`tournament.service.ts:369`), ajouter `clubSport` au `tournament` :

```ts
        tournament: { include: { club: { select: { slug: true, name: true, timezone: true } }, clubSport: { select: { sport: { select: { key: true, name: true } } } } } },
```

Puis, dans le `return regs.map((r) => ({ ... }))`, aplatir le tournoi :

```ts
    return regs.map((r) => {
      const { clubSport, ...tournament } = r.tournament;
      return {
        ...r,
        tournament: { ...tournament, sport: clubSport?.sport ?? null },
        captain: { ...r.captain, phone: r.captainUserId === userId ? r.captain.phone : null },
        partner: { ...r.partner, phone: r.partnerUserId === userId ? r.partner.phone : null },
        captainLicense: licByKey.get(`${r.captainUserId}:${r.tournament.clubId}`) ?? null,
        partnerLicense: licByKey.get(`${r.partnerUserId}:${r.tournament.clubId}`) ?? null,
      };
    });
```

- [ ] **Step 6: Lancer → succès**

Run: `cd backend && npx jest tournament.service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): expose le sport (liste publique, national, mes tournois)"
```

---

## Task 3 : Sport sur les events (liste publique, détail, « Mes events »)

> `ClubEvent.clubSportId` est **nullable** → `sport` peut être `null`.

**Files:**
- Modify: `backend/src/services/event.service.ts` — `listPublicByClubSlug` (~283), `getById` (~294), `listUserRegistrations` (~332)
- Test: `backend/src/services/__tests__/event.service.test.ts`

- [ ] **Step 1: Tests qui échouent**

```ts
it('listPublicByClubSlug expose le sport (null si clubSport absent)', async () => {
  prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
  prismaMock.clubEvent.findMany.mockResolvedValue([
    { id: 'e1', clubSport: { sport: { key: 'padel', name: 'Padel' } } },
    { id: 'e2', clubSport: null },
  ] as any);
  (prismaMock.eventRegistration.groupBy as jest.Mock).mockResolvedValue([]);

  const res = await service.listPublicByClubSlug('demo');

  expect(res[0].sport).toEqual({ key: 'padel', name: 'Padel' });
  expect(res[1].sport).toBeNull();
});
```

(et un assert analogue sur `getById` + sur `listUserRegistrations` → `reg.event.sport`).

- [ ] **Step 2: Lancer → échec**

Run: `cd backend && npx jest event.service -t "sport"`
Expected: FAIL.

- [ ] **Step 3: `listPublicByClubSlug` — include + flatten**

```ts
    const events = await prisma.clubEvent.findMany({
      where: { clubId: club.id, status: 'PUBLISHED' },
      orderBy: { startTime: 'asc' },
      include: { clubSport: { select: { sport: { select: { key: true, name: true } } } } },
    });
    const withCounts = await this.withCounts(events);
    return withCounts.map(({ clubSport, ...e }) => ({ ...e, sport: clubSport?.sport ?? null }));
```

- [ ] **Step 4: `getById` — include + flatten**

```ts
    const e = await prisma.clubEvent.findUnique({
      where: { id: eventId },
      include: {
        club: { select: { slug: true, name: true, timezone: true } },
        clubSport: { select: { sport: { select: { key: true, name: true } } } },
      },
    });
    if (!e || e.status === 'DRAFT') throw new Error('EVENT_NOT_FOUND');
    const [withCount] = await this.withCounts([e]);
    const { clubSport, ...rest } = withCount;
    return { ...rest, sport: clubSport?.sport ?? null };
```

- [ ] **Step 5: `listUserRegistrations` — include + flatten de l'event embarqué**

```ts
  async listUserRegistrations(userId: string) {
    const regs = await prisma.eventRegistration.findMany({
      where: { userId, status: { not: 'CANCELLED' } },
      orderBy: { event: { startTime: 'asc' } },
      include: { event: { include: {
        club: { select: { slug: true, name: true, timezone: true } },
        clubSport: { select: { sport: { select: { key: true, name: true } } } },
      } } },
    });
    return regs.map((r) => {
      const { clubSport, ...event } = r.event;
      return { ...r, event: { ...event, sport: clubSport?.sport ?? null } };
    });
  }
```

- [ ] **Step 6: Lancer → succès**

Run: `cd backend && npx jest event.service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/event.service.ts backend/src/services/__tests__/event.service.test.ts
git commit -m "feat(events): expose le sport (liste publique, detail, mes events)"
```

---

## Task 4 : Sport sur `MyReservation.resource` (calendrier)

**Files:**
- Modify: `backend/src/services/reservation.service.ts` — `listUserReservations` (select `sport.name` + DTO)
- Test: `backend/src/services/__tests__/reservation.service.test.ts`

- [ ] **Step 1: Test qui échoue**

```ts
it('listUserReservations expose le sport du terrain', async () => {
  prismaMock.reservation.findMany.mockResolvedValue([{
    id: 'r1', userId: 'u1', startTime: new Date('2030-01-01T10:00:00Z'), endTime: new Date('2030-01-01T11:00:00Z'),
    resource: {
      id: 'court-1', name: 'Court 1', attributes: { format: 'double' },
      clubSport: { sport: { key: 'padel', name: 'Padel' } },
      club: { name: 'Demo', slug: 'demo', timezone: 'Europe/Paris', playerChangeCutoffHours: 1, cancellationCutoffHours: 24 },
    },
    participants: [],
  }] as any);

  const [r] = await service.listUserReservations('u1');

  expect(r.resource.sport).toEqual({ key: 'padel', name: 'Padel' });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd backend && npx jest reservation.service -t "expose le sport"`
Expected: FAIL.

- [ ] **Step 3: Ajouter `name` au select**

Dans `listUserReservations`, le `resource.select` → `clubSport: { select: { sport: { select: { key: true, name: true } } } }`.

- [ ] **Step 4: Ajouter `sport` au DTO**

Dans le `return rows.map(...)`, le bloc `resource: resourcePublic` devient :

```ts
        resource: { ...resourcePublic, sport: { key: clubSport.sport.key, name: clubSport.sport.name } },
```

- [ ] **Step 5: Lancer → succès**

Run: `cd backend && npx jest reservation.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(reservations): expose le sport du terrain sur MyReservation"
```

---

## Task 5 : Sport sur les cours (`mapToPublicRow`)

> Tous les `PublicLessonRow` passent par `mapToPublicRow` (source unique). On ajoute le sport via `reservation.resource.clubSport.sport`, sélectionné aux 3 sites d'hydratation.

**Files:**
- Modify: `backend/src/services/lesson.service.ts` — type `PublicLessonRow` (~10-30), `mapToPublicRow` (input type + sortie ~365), selects de `getPublicLesson` (~606), `listPublicByClubSlug` (~649), `listUserEnrollments` futureLessons (~712)
- Test: `backend/src/services/__tests__/lesson.service.test.ts`

- [ ] **Step 1: Test qui échoue**

```ts
it('getPublicLesson expose le sport du terrain', async () => {
  prismaMock.lesson.findUnique.mockResolvedValue({
    id: 'l1', clubId: 'club-demo', lessonKind: 'COLLECTIVE', seriesId: null, capacity: 4, allowSelfEnroll: true,
    coach: { name: 'Coach', photoUrl: null },
    reservation: { startTime: new Date('2030-01-01T10:00:00Z'), endTime: new Date('2030-01-01T11:00:00Z'), resource: { name: 'Court 1', clubSport: { sport: { key: 'padel', name: 'Padel' } } } },
    series: null,
    club: { slug: 'demo', name: 'Demo', timezone: 'Europe/Paris' },
  } as any);
  prismaMock.lessonEnrollment.groupBy.mockResolvedValue([] as any);

  const row = await service.getPublicLesson('l1');

  expect(row.sport).toEqual({ key: 'padel', name: 'Padel' });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd backend && npx jest lesson.service -t "expose le sport"`
Expected: FAIL.

- [ ] **Step 3: Type `PublicLessonRow` (+ champ sport)**

Dans la déclaration de type en tête de fichier (le bloc `reservation: { ... resource: { name: string } }`), ajouter en frère de `reservation` :

```ts
  sport: { key: string; name: string } | null;
```

- [ ] **Step 4: `mapToPublicRow` — input type + sortie**

Dans le paramètre `lesson`, élargir `resource` :

```ts
      reservation: { startTime: Date; endTime: Date; resource: { name: string; clubSport: { sport: { key: string; name: string } } | null } };
```

Et dans l'objet retourné, ajouter après `reservation: { ... }` :

```ts
      sport: lesson.reservation.resource.clubSport?.sport ?? null,
```

- [ ] **Step 5: Ajouter le select aux 3 sites**

Aux `resource: { select: { name: true } }` de `getPublicLesson`, `listPublicByClubSlug`, et `listUserEnrollments` (futureLessons), remplacer par :

```ts
            resource: { select: { name: true, clubSport: { select: { sport: { select: { key: true, name: true } } } } } },
```

- [ ] **Step 6: Lancer → succès**

Run: `cd backend && npx jest lesson.service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/lesson.service.ts backend/src/services/__tests__/lesson.service.test.ts
git commit -m "feat(cours): expose le sport du terrain sur les seances (mapToPublicRow)"
```

---

## Task 6 : Helper de gating pur `lib/sportBadge.ts`

**Files:**
- Create: `frontend/lib/sportBadge.ts`
- Test: `frontend/__tests__/sportBadge.test.ts`

- [ ] **Step 1: Test qui échoue**

```ts
import { clubIsMultiSport, setSpansMultipleSports } from '@/lib/sportBadge';

describe('sportBadge', () => {
  it('clubIsMultiSport : ≥2 sports => true', () => {
    expect(clubIsMultiSport(null)).toBe(false);
    expect(clubIsMultiSport({ clubSports: [] })).toBe(false);
    expect(clubIsMultiSport({ clubSports: [{ id: 'a' }] })).toBe(false);
    expect(clubIsMultiSport({ clubSports: [{ id: 'a' }, { id: 'b' }] })).toBe(true);
  });

  it('setSpansMultipleSports : ≥2 clés distinctes non nulles => true', () => {
    expect(setSpansMultipleSports([])).toBe(false);
    expect(setSpansMultipleSports(['padel', 'padel'])).toBe(false);
    expect(setSpansMultipleSports(['padel', null, undefined])).toBe(false);
    expect(setSpansMultipleSports(['padel', 'tennis'])).toBe(true);
    expect(setSpansMultipleSports(['padel', null, 'tennis'])).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd frontend && npx jest sportBadge`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

```ts
// Décide de l'affichage du badge sport selon le périmètre de la vue.
// - Surfaces mono-club : on compare au nombre de sports actifs du club.
// - Surfaces cross-club : on compare au nombre de sports distincts de l'ensemble affiché.

export function clubIsMultiSport(club: { clubSports: { id: string }[] } | null | undefined): boolean {
  return (club?.clubSports.length ?? 0) > 1;
}

export function setSpansMultipleSports(sportKeys: (string | null | undefined)[]): boolean {
  const distinct = new Set(sportKeys.filter((k): k is string => !!k));
  return distinct.size > 1;
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx jest sportBadge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/sportBadge.ts frontend/__tests__/sportBadge.test.ts
git commit -m "feat(agenda): helper pur de gating du badge sport"
```

---

## Task 7 : Types front `lib/api.ts` (champs `sport` additifs)

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Ajouter les champs sport (tous additifs)**

Ajouts (forme `sport: { key: string; name: string } | null`, ou `... | undefined` quand peuplé seulement par certains endpoints) :

- `OpenMatch` : ajouter `sport: { key: string; name: string };` (toujours présent — padel).
- `Tournament` : ajouter `sport?: { key: string; name: string } | null;` (peuplé par la liste publique / mes tournois ; le détail garde `clubSport`).
- `ClubEvent` : ajouter `sport?: { key: string; name: string } | null;`.
- `NationalTournament` : hérite de `Tournament` → ajouter `sport: { key: string; name: string } | null;` (surcharge non-optionnelle, toujours peuplé).
- `MyReservation.resource` : ajouter `sport: { key: string; name: string } | null;` à l'objet `resource`.
- `MyLessonSummary` (la forme de `lesson` dans `MyLessonEnrollment`) **et** `LessonSummary` : ajouter `sport: { key: string; name: string } | null;`.

> Le `tournament`/`event` embarqués dans `MyTournamentRegistration`/`MyEventRegistration` sont typés `Tournament & {...}` / `ClubEvent & {...}` → le champ `sport?` ci-dessus suffit (mais il est en réalité peuplé).

- [ ] **Step 2: Vérifier la compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (aucune régression — champs optionnels/additifs).

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(agenda): types sport additifs sur OpenMatch/Tournament/ClubEvent/MyReservation/Lesson"
```

---

## Task 8 : `AgendaCard` — chip sport optionnel

**Files:**
- Modify: `frontend/components/agenda/AgendaCard.tsx`
- Test: `frontend/__tests__/AgendaCard.test.tsx` (existant — sinon créer)

- [ ] **Step 1: Test qui échoue**

```tsx
it('affiche le chip sport quand sportLabel est fourni, sinon non', () => {
  const base = { icon: 'trophy' as const, accent: '#000', tag: 'P500', title: 'Open', dateLabel: 'jeu.', deadline: '2030-01-01T00:00:00Z', now: null, ratio: null, places: { text: '4 places', urgent: false }, onClick: () => {} };
  const { rerender, queryByText } = render(<ThemeProvider><AgendaCard {...base} sportLabel="Tennis" /></ThemeProvider>);
  expect(queryByText('Tennis')).toBeInTheDocument();
  rerender(<ThemeProvider><AgendaCard {...base} sportLabel={null} /></ThemeProvider>);
  expect(queryByText('Tennis')).not.toBeInTheDocument();
});
```

(Mirror le wrapper `ThemeProvider` des autres tests du dossier ; importer `render` de `@testing-library/react`.)

- [ ] **Step 2: Lancer → échec**

Run: `cd frontend && npx jest AgendaCard`
Expected: FAIL (`sportLabel` inconnu / chip absent).

- [ ] **Step 3: Ajouter la prop + le chip**

Dans `AgendaCardProps`, ajouter :

```ts
  sportLabel?: string | null;  // « Tennis » — chip sport (vue multi-sport / multi-club)
```

Ajouter `sportLabel` à la déstructuration des props. Dans la première rangée (celle du `tag`), insérer le chip **avant** le `<span>{tag}</span>` :

```tsx
          {sportLabel && (
            <span data-testid="sport-badge" style={{
              fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.3, whiteSpace: 'nowrap',
              borderRadius: 999, padding: '2px 8px', background: th.surface2, color: th.textMute, boxShadow: `inset 0 0 0 1px ${th.line}`,
            }}>{sportLabel}</span>
          )}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx jest AgendaCard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/agenda/AgendaCard.tsx frontend/__tests__/AgendaCard.test.tsx
git commit -m "feat(agenda): AgendaCard accepte un chip sport optionnel"
```

---

## Task 9 : Page `/events` — câblage du chip sport

**Files:**
- Modify: `frontend/app/events/page.tsx`

- [ ] **Step 1: Calculer le flag multi-sport**

Après `const { club, loading } = useClub();`, importer le helper et calculer :

```ts
import { clubIsMultiSport } from '@/lib/sportBadge';
// ...
const multiSport = clubIsMultiSport(club);
```

- [ ] **Step 2: Passer `sportLabel` aux 3 `AgendaCard`**

- Carte tournoi : `sportLabel={multiSport ? (item.tournament.sport?.name ?? null) : null}`
- Carte event : `sportLabel={multiSport ? (item.event.sport?.name ?? null) : null}`
- Carte cours : `sportLabel={multiSport ? (item.lesson.sport?.name ?? null) : null}`

- [ ] **Step 3: Vérifier types + suite events**

Run: `cd frontend && npx tsc --noEmit && npx jest events`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/events/page.tsx
git commit -m "feat(events): chip sport sur les cartes si club multi-sport"
```

---

## Task 10 : Calendrier national + accueil — chip sport (vue multi-club)

**Files:**
- Modify: `frontend/components/calendar/TournamentFinder.tsx`, `frontend/components/calendar/UpcomingTournaments.tsx`

- [ ] **Step 1: `TournamentFinder` — gating par l'ensemble affiché**

Importer `setSpansMultipleSports` ; avant le `results?.map(...)` :

```ts
const showSport = setSpansMultipleSports((results ?? []).map((r) => r.tournament.sport?.key));
```

Sur le `<AgendaCard>`, ajouter :

```tsx
sportLabel={showSport ? (t.sport?.name ?? null) : null}
```

- [ ] **Step 2: `UpcomingTournaments` — idem**

Après `const top = items.slice(0, MAX);` :

```ts
const showSport = setSpansMultipleSports(top.map((t) => t.sport?.key));
```

puis sur l'`AgendaCard` du `top.map((t) => ...)` ajouter `sportLabel={showSport ? (t.sport?.name ?? null) : null}` (importer `setSpansMultipleSports` depuis `@/lib/sportBadge`).

- [ ] **Step 3: Vérifier**

Run: `cd frontend && npx tsc --noEmit && npx jest TournamentFinder UpcomingTournaments AgendaCard`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/calendar/TournamentFinder.tsx frontend/components/calendar/UpcomingTournaments.tsx
git commit -m "feat(national): chip sport quand le calendrier couvre plusieurs sports"
```

---

## Task 11 : Heros des fiches tournoi & event — pill sport

**Files:**
- Modify: `frontend/components/tournament/TournamentHero.tsx`, `frontend/app/events/[id]/page.tsx`

- [ ] **Step 1: `TournamentHero` — pill sport conditionnelle**

`TournamentHero` reçoit `t: TournamentDetail` (qui a `t.clubSport.sport.name`). Lui passer aussi le flag multi-sport depuis la page, ou le lire via `useClub`. Choix : **prop `multiSport: boolean`** (composant pur, testable).

Signature → `export function TournamentHero({ t, now, multiSport }: { t: TournamentDetail; now: Date | null; multiSport: boolean })`. Dans `pills`, préfixer :

```tsx
      pills={[
        ...(multiSport ? [{ label: t.clubSport.sport.name }] : []),
        { label: t.category, strong: true },
        { label: GENDER_LABEL[t.gender] ?? t.gender },
        ...(t.gender === 'MEN' && t.openToWomen ? [{ label: 'Ouvert aux femmes' }] : []),
      ]}
```

Dans `app/tournois/[id]/page.tsx`, au point d'appel (`<TournamentHero t={t} now={now} />`), ajouter `multiSport={clubIsMultiSport(club)}` (le `club` vient déjà de `useClub()` sur cette page ; sinon l'ajouter).

- [ ] **Step 2: Fiche event — pill sport**

Dans `app/events/[id]/page.tsx`, calculer `const multiSport = clubIsMultiSport(club);` et modifier les `pills` du `<AgendaHero>` (ligne ~130) :

```tsx
pills={[
  ...(multiSport && event.sport ? [{ label: event.sport.name }] : []),
  { label: KIND_LABEL[event.kind], strong: true },
  ...(event.memberOnly ? [{ label: 'Réservé aux membres' }] : []),
]}
```

(`event` est de type `ClubEventDetail` → `event.sport` provient de Task 3.)

- [ ] **Step 3: Vérifier**

Run: `cd frontend && npx tsc --noEmit && npx jest tournois events`
Expected: PASS (ajuster les tests existants qui instancient `TournamentHero` pour passer `multiSport`).

- [ ] **Step 4: Commit**

```bash
git add frontend/components/tournament/TournamentHero.tsx frontend/app/tournois/[id]/page.tsx frontend/app/events/[id]/page.tsx
git commit -m "feat(fiches): pill sport sur les heros tournoi & event si club multi-sport"
```

---

## Task 12 : `OpenMatchCard` — chip sport + câblage

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx`, `frontend/components/openmatch/OpenMatches.tsx`
- Test: `frontend/__tests__/OpenMatchCard.test.tsx` (existant — sinon créer)

- [ ] **Step 1: Test qui échoue**

```tsx
it('affiche le chip sport quand showSport', () => {
  const m = { id: 'r1', resourceName: 'Court 1', startTime: '2030-01-01T10:00:00Z', endTime: '2030-01-01T11:00:00Z', maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false, players: [], interestedCount: 0, viewerIsInterested: false, interested: [], lastMessageAt: null, sport: { key: 'padel', name: 'Padel' } } as any;
  const { queryByText } = render(<ThemeProvider><OpenMatchCard match={m} timezone="Europe/Paris" slug="demo" token="t" busy={false} addingOpen={false} showSport onJoin={()=>{}} onLeave={()=>{}} onRemovePlayer={()=>{}} onAddPlayer={()=>{}} onToggleAdd={()=>{}} onCancelAdd={()=>{}} onRecordResult={()=>{}} canRecordResult={false} onToggleInterest={()=>{}} onOpenChat={()=>{}} hasUnread={false} /></ThemeProvider>);
  expect(queryByText('Padel')).toBeInTheDocument();
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd frontend && npx jest OpenMatchCard`
Expected: FAIL.

- [ ] **Step 3: Prop `showSport` + chip**

Dans `OpenMatchCardProps`, ajouter `showSport?: boolean;`. Le déstructurer. Dans l'en-tête (après le `<span>{m.resourceName}</span>`), avant le `marginLeft:'auto'` des chips, insérer :

```tsx
        {showSport && m.sport && <Chip tone="line">{m.sport.name}</Chip>}
```

- [ ] **Step 4: Câbler `OpenMatches`**

Dans `OpenMatches.tsx`, le composant a accès au club (via `useClub()` ou une prop). Calculer `const showSport = clubIsMultiSport(club);` et passer `showSport={showSport}` à chaque `<OpenMatchCard>`. (Importer `clubIsMultiSport`.)

- [ ] **Step 5: Lancer → succès**

Run: `cd frontend && npx jest OpenMatchCard OpenMatches`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/OpenMatchCard.test.tsx
git commit -m "feat(parties): chip sport sur OpenMatchCard si club multi-sport"
```

---

## Task 13 : Club-house « Prochains events » — chip sport

**Files:**
- Modify: `frontend/components/clubhouse/TournamentsAlaUne.tsx`, et le câblage dans `frontend/components/ClubHouse.tsx`

- [ ] **Step 1: Ajouter la prop `multiSport`**

`TournamentsAlaUne` rend des `AgendaItem` (tournois + events) avec une chaîne `badge` (ligne ~32) affichée dans le sous-titre (ligne ~55). Élargir la signature :

```tsx
export function TournamentsAlaUne({ items, timezone, now = null, multiSport = false }: { items: AgendaItem[]; timezone: string; now?: Date | null; multiSport?: boolean }) {
```

- [ ] **Step 2: Préfixer le sport au `badge`**

Dans le `.map`, après le calcul de `badge`, ajouter :

```tsx
          const sportName = multiSport ? ((isT ? item.tournament.sport?.name : item.event.sport?.name) ?? null) : null;
```

et dans la ligne du sous-titre (là où `{badge}` est rendu, ligne ~55), préfixer :

```tsx
                {sportName ? `${sportName} · ` : ''}{badge}
```

Dans `ClubHouse.tsx`, calculer `const multiSport = clubIsMultiSport(club);` (importer le helper) et le passer : `<TournamentsAlaUne items={nextEvents} timezone={...} now={now} multiSport={multiSport} />`.

- [ ] **Step 3: Vérifier**

Run: `cd frontend && npx tsc --noEmit && npx jest ClubHouse TournamentsAlaUne`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/clubhouse/TournamentsAlaUne.tsx frontend/components/ClubHouse.tsx
git commit -m "feat(club-house): chip sport sur les prochains events si club multi-sport"
```

---

## Task 14 : Calendrier « Mes réservations » — sport dans le sous-titre

**Files:**
- Modify: `frontend/lib/calendar.ts` (helper `agendaEntrySportKey`), `frontend/components/calendar/MyAgendaListItem.tsx`, `frontend/components/calendar/DayPanel.tsx`, `frontend/app/me/reservations/page.tsx`
- Test: `frontend/__tests__/MyAgendaListItem.test.tsx` (existant — sinon créer)

- [ ] **Step 1: Helper d'extraction de la clé sport**

Dans `lib/calendar.ts`, ajouter une fonction pure qui extrait la clé sport d'une entrée (pour `setSpansMultipleSports`) :

```ts
import type { CalendarEntry } from './calendar'; // (déjà dans le fichier — sinon inline)

export function agendaEntrySportKey(e: CalendarEntry): string | null {
  if (e.kind === 'reservation') return e.r.resource.sport?.key ?? null;
  if (e.kind === 'tournament')  return e.reg.tournament.sport?.key ?? null;
  if (e.kind === 'event')       return e.ev.event.sport?.key ?? null;
  return e.enrollment.lesson.sport?.key ?? null; // lesson
}
```

(Et l'équivalent pour `AgendaListItem` si la liste utilise ce type : `agendaListItemSportKey(item)` avec la même logique sur `item.r/.reg/.ev/.enrollment`.)

- [ ] **Step 2: Prop `showSport` + sous-titre dans `MyAgendaListItem`**

Ajouter `showSport?: boolean` aux props. Construire un préfixe sport réutilisable :

```tsx
const sportName = !showSport ? null
  : item.kind === 'reservation' ? item.r.resource.sport?.name ?? null
  : item.kind === 'tournament' ? item.reg.tournament.sport?.name ?? null
  : item.kind === 'event' ? item.ev.event.sport?.name ?? null
  : item.enrollment.lesson.sport?.name ?? null;
const sportPrefix = sportName ? `${sportName} · ` : '';
```

Puis dans les sous-titres :
- reservation : `<div style={subtitle}>{sportPrefix}{r.resource.club.name}</div>`
- tournament : `<div style={subtitle}>{sportPrefix}{t.category} · {GENDER_LABEL[t.gender] ?? t.gender} · {t.club.name}</div>`
- event : `<div style={subtitle}>{sportPrefix}{KIND_LABEL[ev.kind]} · {ev.club.name}</div>`
- lesson : ajouter, sous le titre, `{sportName && <div style={subtitle}>{sportName}</div>}`

- [ ] **Step 3: Prop `showSport` dans `DayPanel`** (même logique sur `CalendarEntry`)

Ajouter `showSport?: boolean` aux props de `DayPanel` et préfixer les sous-titres `r.resource.club.name`, `{t.category} · … · {t.club.name}`, `{KIND_LABEL[ev.kind]} · {ev.club.name}` avec le sport quand `showSport` (mêmes extractions que ci-dessus, depuis `e.r/.reg/.ev/.enrollment`).

- [ ] **Step 4: Calculer et passer `showSport` depuis la page**

Dans `app/me/reservations/page.tsx`, calculer une fois (sur l'agenda fusionné, toutes entrées) :

```ts
import { setSpansMultipleSports } from '@/lib/sportBadge';
import { agendaEntrySportKey } from '@/lib/calendar';
// entries = buildCalendarEntries(...) déjà calculé pour la grille
const showSport = useMemo(() => setSpansMultipleSports(entries.map(agendaEntrySportKey)), [entries]);
```

Passer `showSport={showSport}` à `<MyAgendaListItem>` (liste) **et** à `<DayPanel>` (grille). (Adapter au nom réel des variables d'entrées de la page.)

- [ ] **Step 5: Test (liste)**

```tsx
it('préfixe le sport au sous-titre quand showSport', () => {
  const item = { kind: 'tournament', id: 't1', start: '2030-01-01T10:00:00Z', past: false,
    reg: { status: 'CONFIRMED', tournament: { id: 't1', name: 'Open', category: 'P500', gender: 'MEN', sport: { key: 'tennis', name: 'Tennis' }, club: { slug: 'demo', name: 'Demo', timezone: 'Europe/Paris' } } } } as any;
  const { getByText } = render(<ThemeProvider><MyAgendaListItem item={item} now={Date.now()} localSlug={null} token={null} onCancel={()=>{}} onPlayersChanged={()=>{}} showSport /></ThemeProvider>);
  expect(getByText(/Tennis · P500/)).toBeInTheDocument();
});
```

- [ ] **Step 6: Lancer → succès**

Run: `cd frontend && npx jest MyAgendaListItem calendar`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/calendar.ts frontend/components/calendar/MyAgendaListItem.tsx frontend/components/calendar/DayPanel.tsx frontend/app/me/reservations/page.tsx frontend/__tests__/MyAgendaListItem.test.tsx
git commit -m "feat(calendrier): sport dans le sous-titre quand l'agenda couvre plusieurs sports"
```

---

## Task 15 : Vérification globale + doc

**Files:**
- Modify: `CLAUDE.md` (note de section)

- [ ] **Step 1: Suites ciblées backend + front**

```bash
cd backend && npx jest openMatch.service tournament.service event.service reservation.service lesson.service
cd ../frontend && npx jest sportBadge AgendaCard OpenMatchCard MyAgendaListItem events
```
Expected: PASS. (NB : la suite complète `npx jest` côté front a un flake BookingModal pré-existant — vérifier par suites ciblées, cf. memory.)

- [ ] **Step 2: Typecheck des deux côtés**

```bash
cd backend && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 3: Documenter dans `CLAUDE.md`**

Ajouter une note « Évolution (2026-06-29) — badges sport & club » sous la section pertinente (ex. « Events & animations » ou une nouvelle entrée), décrivant : champ `sport` additif sur les DTO (sans migration), helper `lib/sportBadge.ts`, surfaces touchées, règle de gating.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: badges sport & club sur parties/tournois/events/cours"
```

---

## Self-review (couverture spec → tâches)

- Plomberie uniforme `sport` : OpenMatch (T1), Tournament liste/national/mes (T2), ClubEvent liste/détail/mes (T3), MyReservation (T4), Lessons (T5). ✅
- Détail tournoi : pas de backend (déjà `clubSport.sport`) ; pill via T11. ✅
- Helper de gating pur (T6) + types (T7). ✅
- UI : AgendaCard (T8) → /events (T9), national + accueil (T10), heros (T11), parties (T12), club-house (T13), calendrier liste+DayPanel (T14). ✅
- Club en multi-club : déjà présent (national subtitle, « Mes » subtitle) ; conservé, non régressé. ✅
- Pas de migration ; nullabilité events/cours gérée (`sport: … | null`). ✅
- Tests : helper, composants, services backend. ✅
