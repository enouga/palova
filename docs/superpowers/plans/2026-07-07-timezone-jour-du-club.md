# Timezone — jour du club — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** rendre l'app correcte pour un club dans n'importe quel fuseau IANA — « jour
courant » au fuseau du club côté front, fuseau validé côté backend, legacy UTC+2 supprimé.

**Architecture :** un helper pur Intl `lib/clubDay.ts` (pattern `en-CA` déjà utilisé par
`lib/calendar.ts` et `lib/bookingWindow.ts`) remplace les « aujourd'hui = jour UTC » des
7 surfaces vivantes ; validation `IANAZone.isValidZone` (Luxon, déjà en dépendance) à
l'écriture de `Club.timezone` ; sélecteur de fuseaux dans `/admin/settings`. Aucune
migration, aucun endpoint nouveau.

**Tech stack :** Next.js 16 / React 19 (front, Intl natif — pas de Luxon au front),
Express 5 + Prisma 7 + Luxon (back), Jest des deux côtés.

**Spec (fait foi, committée `109787d`) :** `docs/superpowers/specs/2026-07-07-timezone-jour-du-club-design.md`

**Acquis d'exploration (ne pas re-auditer) :**
- Backend availability/pricing/quotas/récurrence/emails : DÉJÀ tz-aware (Luxon + `club.timezone`).
- `frontend/lib/bookingWindow.ts` : DÉJÀ correct (ancré `dayKeyInTz(now, tz)`) — il ne
  lui manque qu'un test non-Paris.
- `frontend/lib/calendar.ts:66` (`keyOfUtc`) : arithmétique UTC volontaire post-clé
  tz-aware — NE PAS TOUCHER. `todayKey()` (l.61, fuseau navigateur) : choix assumé du
  calendrier personnel multi-clubs — NE PAS TOUCHER.
- `lib/clubhouse.ts` exporte `todayISO`/`addDaysISO` consommés UNIQUEMENT par
  `components/ClubHouse.tsx:8,113`.
- Sur les pages admin, `useClub().club` est non-null au mount (gating du layout admin) ;
  dans `ClubReserve`, `club` est disponible dans le corps du composant.
- ⚠️ Repo édité en parallèle par l'utilisateur : `git status` avant chaque commit,
  n'ajouter QUE les fichiers de la tâche.

---

### Task 1 : helper pur `lib/clubDay.ts` (TDD)

**Files :** Create `frontend/lib/clubDay.ts` · Create `frontend/__tests__/clubDay.test.ts`

- [ ] **Step 1 — test qui échoue** (`frontend/__tests__/clubDay.test.ts`) :

```ts
import { clubDayISO, addDaysISO } from '../lib/clubDay';

describe('clubDayISO', () => {
  it('donne le jour local du club, pas le jour UTC (Paris, 23h30 UTC = lendemain)', () => {
    expect(clubDayISO('Europe/Paris', new Date('2026-06-14T23:30:00.000Z'))).toBe('2026-06-15');
  });
  it('club à l’ouest de l’UTC : le soir local, le jour UTC est déjà demain', () => {
    expect(clubDayISO('America/Toronto', new Date('2026-06-15T01:30:00.000Z'))).toBe('2026-06-14');
  });
  it('UTC+4 sans DST (Indian/Reunion)', () => {
    expect(clubDayISO('Indian/Reunion', new Date('2026-01-31T21:00:00.000Z'))).toBe('2026-02-01');
  });
  it('milieu de journée : identique au jour UTC', () => {
    expect(clubDayISO('Europe/Paris', new Date('2026-06-15T12:00:00.000Z'))).toBe('2026-06-15');
  });
  it('fuseau invalide → repli UTC sans throw', () => {
    expect(clubDayISO('Europe/Pariss', new Date('2026-06-15T12:00:00.000Z'))).toBe('2026-06-15');
    expect(clubDayISO(null, new Date('2026-06-15T12:00:00.000Z'))).toBe('2026-06-15');
  });
});

describe('addDaysISO', () => {
  it('ajoute en calendaire pur (fin de mois, bissextile)', () => {
    expect(addDaysISO('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysISO('2026-06-15', -1)).toBe('2026-06-14');
    expect(addDaysISO('2026-06-15', 0)).toBe('2026-06-15');
  });
});
```

- [ ] **Step 2 — vérifier l'échec** : `cd frontend && npm test -- clubDay` → FAIL
  (« Cannot find module '../lib/clubDay' »).
- [ ] **Step 3 — implémentation** (`frontend/lib/clubDay.ts`) :

```ts
// Jour calendaire « du club » — helpers purs, hydration-safe (l'appelant passe `at`).
// Même pattern Intl 'en-CA' (→ YYYY-MM-DD) que lib/calendar.ts et lib/bookingWindow.ts.

/** Jour courant (YYYY-MM-DD) au fuseau IANA du club. Fuseau invalide/absent → repli UTC (jamais de crash). */
export function clubDayISO(tz: string | null | undefined, at: Date): string {
  if (tz) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(at);
    } catch { /* fuseau invalide → repli UTC */ }
  }
  return at.toISOString().slice(0, 10);
}

/** Décale une clé YYYY-MM-DD de `n` jours (arithmétique calendaire pure, sans fuseau). */
export function addDaysISO(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
```

- [ ] **Step 4 — vérifier le vert** : `npm test -- clubDay` → PASS.
- [ ] **Step 5 — commit** : `git add frontend/lib/clubDay.ts frontend/__tests__/clubDay.test.ts`
  puis `git commit -m "feat(tz): helper pur jour du club (clubDayISO/addDaysISO)"`.

### Task 2 : Réserver + Club-house au jour du club

**Files :** Modify `frontend/components/ClubReserve.tsx:24,54,320` ·
`frontend/lib/clubhouse.ts:9-19` · `frontend/components/ClubHouse.tsx:8,113` ·
`frontend/__tests__/ClubHouse.test.tsx:117`

- [ ] `ClubReserve.tsx` : supprimer la fonction locale `todayISO()` (l.24) ; importer
  `clubDayISO` ; l.54 → `useState(() => clubDayISO(club.timezone, new Date()))` ;
  l.320 → `scarcityLabel(bookableCount, date === clubDayISO(club.timezone, new Date(nowMs ?? Date.now())))`
  (utiliser `nowMs` s'il est dans la portée — sinon `new Date()`).
- [ ] `lib/clubhouse.ts` : SUPPRIMER `todayISO` et `addDaysISO` (l.9-19, déplacés dans
  `clubDay.ts`).
- [ ] `ClubHouse.tsx` : retirer `todayISO, addDaysISO` de l'import `@/lib/clubhouse` (l.8),
  ajouter `import { clubDayISO, addDaysISO } from '@/lib/clubDay';` ; l.113 →
  `addDaysISO(clubDayISO(club.timezone, new Date()), d)`.
- [ ] `__tests__/ClubHouse.test.tsx:117` : remplacer
  `const today = new Date().toISOString().slice(0, 10);` par
  `const today = clubDayISO('Europe/Paris', new Date());` (import depuis `../lib/clubDay` ;
  le club mocké de la suite est en Europe/Paris — sinon utiliser le tz du mock).
- [ ] Vérifier : `npm test -- ClubHouse clubhouse ClubReserve` → PASS ;
  `node node_modules/typescript/bin/tsc --noEmit` → 0 erreur.
- [ ] Commit : `git commit -m "fix(tz): Reserver et Club-house au jour du club (plus de jour UTC)"`.

### Task 3 : pages admin au jour du club

**Files :** Modify `frontend/app/admin/page.tsx:57` · `app/admin/caisse/page.tsx:23` ·
`app/admin/encaissement/page.tsx:27` · `app/admin/reservations/page.tsx:24` ·
`app/admin/planning/page.tsx:60`

- [ ] Dans chacune des 5 pages : supprimer la fonction locale `todayISO()` / le calcul
  `new Date().toISOString().slice(0, 10)` ; importer `clubDayISO` de `@/lib/clubDay` ;
  remplacer l'init par `clubDayISO(club?.timezone, new Date())` (le `club` de `useClub()`
  est déjà présent dans ces pages ; garde `?.` = repli UTC du helper). Cas particuliers :
  - `app/admin/page.tsx:57` : `const today = ...` est calculé dans le corps → même
    remplacement inline.
  - `app/admin/planning/page.tsx` : ne toucher QUE `todayISO` (l.60) — `shiftDate` (l.62)
    et `fmtDay` (l.69) sont de l'arithmétique calendaire pure, corrects.
- [ ] Vérifier : `npm test -- AdminReservations caisse collect` (suites qui montent ces
  pages/helpers) puis tsc frontend → PASS.
- [ ] Commit : `git commit -m "fix(tz): pages admin (dashboard, caisses, planning) au jour du club"`.

### Task 4 : validation IANA backend (TDD)

**Files :** Modify `backend/src/services/club.service.ts` (création l.133 + `updateClub`) ·
Modify `backend/src/routes/admin.ts` (ERROR_STATUS l.65-123) · Modify
`backend/src/services/__tests__/club.service.test.ts` · Audit `backend/src/services/platform.service.ts`

- [ ] **Step 1 — tests qui échouent** (bloc à ajouter dans `club.service.test.ts`,
  suivre les patterns du fichier — prismaMock déjà en place ; adapter la signature exacte
  d'`updateClub` au fichier réel, brancher au même endroit que `normalizeOffPeakHours`) :

```ts
describe('timezone validation', () => {
  it('refuse un fuseau IANA invalide à la mise à jour', async () => {
    await expect(service.updateClub('club-demo', { timezone: 'Europe/Pariss' } as any))
      .rejects.toThrow('TIMEZONE_INVALID');
  });
  it('accepte un fuseau valide et le trim', async () => {
    prismaMock.club.update.mockResolvedValue({ id: 'club-demo' } as any);
    await service.updateClub('club-demo', { timezone: ' Indian/Reunion ' } as any);
    expect(prismaMock.club.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ timezone: 'Indian/Reunion' }),
    }));
  });
  it('chaîne vide → champ ignoré (fuseau existant conservé)', async () => {
    prismaMock.club.update.mockResolvedValue({ id: 'club-demo' } as any);
    await service.updateClub('club-demo', { timezone: '  ' } as any);
    const data = prismaMock.club.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('timezone');
  });
});
```

- [ ] **Step 2 — échec** : `cd backend && npx jest src/services/__tests__/club.service.test.ts` → FAIL.
- [ ] **Step 3 — implémentation** dans `club.service.ts` :

```ts
import { IANAZone } from 'luxon';

/** Fuseau IANA validé/trimé ; undefined = champ absent ou vide (ignoré). */
function normalizeTimezone(tz: unknown): string | undefined {
  if (tz == null) return undefined;
  const s = String(tz).trim();
  if (!s) return undefined;
  if (!IANAZone.isValidZone(s)) throw new Error('TIMEZONE_INVALID');
  return s;
}
```

Branché : dans `updateClub` (n'écrire `timezone` que si `normalizeTimezone` renvoie une
valeur) et à la création (l.133 : `timezone: normalizeTimezone(params.timezone) || 'Europe/Paris'`).

- [ ] **Step 4 — vert** : mêmes commandes → PASS.
- [ ] `admin.ts` ERROR_STATUS : ajouter `TIMEZONE_INVALID: 400`. Si la création de club
  publique/superadmin passe par d'autres routers (`clubs.ts`/`platform.ts`) et accepte
  un `timezone`, ajouter le mapping là aussi (vérifier par grep `timezone` dans
  `platform.service.ts` — si le champ n'y est pas exposé, rien à faire).
- [ ] Vérifier : `npx jest` (suite backend complète) + `npx tsc --noEmit` → PASS.
- [ ] Commit : `git commit -m "feat(tz): validation IANA de Club.timezone (400 TIMEZONE_INVALID)"`.

### Task 5 : sélecteur de fuseau dans `/admin/settings`

**Files :** Create `frontend/lib/timezones.ts` · Create `frontend/__tests__/timezones.test.ts` ·
Modify `frontend/app/admin/settings/page.tsx:176`

- [ ] **Helper pur** `frontend/lib/timezones.ts` :

```ts
/** Fuseaux « courants » pour un produit FR (métropole + DOM-TOM + voisins). Repli si Intl.supportedValuesOf absent. */
export const COMMON_TIMEZONES = [
  'Europe/Paris', 'America/Guadeloupe', 'America/Martinique', 'America/Cayenne',
  'Indian/Reunion', 'Indian/Mayotte', 'Pacific/Noumea', 'Pacific/Tahiti',
  'Europe/Brussels', 'Europe/Madrid', 'Europe/London', 'America/Montreal',
];

export interface TimezoneGroup { label: string; zones: string[] }

/** Groupes pour le <select> : « Courants » d'abord, puis tous les fuseaux IANA par continent.
 *  `current` est toujours présent (injecté en tête si inconnu) — jamais de reset silencieux. */
export function timezoneGroups(current: string): TimezoneGroup[] {
  const all: string[] = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone') : [...COMMON_TIMEZONES];
  const known = new Set([...all, ...COMMON_TIMEZONES]);
  const groups = new Map<string, string[]>();
  for (const z of all) {
    const continent = z.includes('/') ? z.slice(0, z.indexOf('/')) : 'Autres';
    if (!groups.has(continent)) groups.set(continent, []);
    groups.get(continent)!.push(z);
  }
  return [
    ...(known.has(current) ? [] : [{ label: 'Fuseau actuel', zones: [current] }]),
    { label: 'Courants', zones: COMMON_TIMEZONES },
    ...[...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([label, zones]) => ({ label, zones })),
  ];
}
```

- [ ] **Test** `frontend/__tests__/timezones.test.ts` : « Courants » en premier groupe
  (ou après « Fuseau actuel ») ; `Europe/Paris` dedans ; `current` inconnu (`'Foo/Bar'`)
  → groupe « Fuseau actuel » en tête ; groupes continents triés ; repli couvert en
  stubant `Intl.supportedValuesOf` à `undefined`.
- [ ] `app/admin/settings/page.tsx:176` : remplacer l'`<input value={club.timezone}>` par
  un `<select>` natif stylé comme les champs voisins (même objet `field`), options via
  `timezoneGroups(club.timezone)` en `<optgroup>` ; le PATCH existant est inchangé.
  Ajouter le mapping FR du code d'erreur : `TIMEZONE_INVALID` → « Fuseau horaire invalide »
  dans le dico d'erreurs de la page (ou le message brut si la page n'a pas de dico).
- [ ] Vérifier : `npm test -- timezones` + tsc frontend + suite settings si elle existe
  (`npm test -- AdminSettings` — sinon ignorer).
- [ ] Commit : `git commit -m "feat(tz): selecteur de fuseau IANA dans /admin/settings"`.

### Task 6 : suppression du legacy

**Files :** Delete `frontend/patch/` · `frontend/app/courts/` · `frontend/components/CourtCalendar.tsx`

- [ ] Greps de contrôle AVANT suppression (tout doit être vide hors des fichiers supprimés
  eux-mêmes et des docs) : `rg "CourtCalendar" frontend --glob '!patch/**'`,
  `rg "'/courts|\"/courts" frontend/app frontend/components frontend/lib --glob '!app/courts/**'`
  (attention aux faux positifs `resource`/`courts` dans des libellés), `rg "from.*patch" frontend`.
- [ ] Supprimer les 3 cibles (+ leurs tests s'il en existe — `rg CourtCalendar frontend/__tests__`).
- [ ] Vérifier : suite front complète `npm test` (⚠️ flake BookingModal connu en full-suite →
  re-lancer les suites en échec isolément pour confirmer) + tsc frontend → PASS.
- [ ] Commit : `git commit -m "chore(tz): suppression du legacy UTC+2 (patch/, /courts, CourtCalendar)"`.

### Task 7 : tests non-Paris backend + bookingWindow + surface caisse

**Files :** Modify `backend/src/services/__tests__/availability.service.test.ts` ·
`backend/src/services/__tests__/pricing.test.ts` · test front de `bookingWindow`
(`frontend/__tests__/bookingWindow.test.ts` s'il existe, sinon le créer) · suite caisse existante

- [ ] `availability.service.test.ts` : dupliquer le cas nominal avec
  `club: { timezone: 'Indian/Reunion', … }` → terrain 8h-22h : premier slot à
  `04:00:00.000Z` (UTC+4, pas de DST) ; et `America/Toronto` en janvier (UTC-5) →
  premier slot `13:00:00.000Z`.
- [ ] `pricing.test.ts` : un cas heures creuses avec `Indian/Reunion` (créneau 14h-15h
  locales = 10:00Z, creux si la plage creuse locale le couvre).
- [ ] Front `bookingWindow` : cas `America/Toronto` — à 23h30 UTC un mardi (= 19h30
  locales mardi), `maxDayKey` doit être ancré sur le mardi local, pas le mercredi UTC.
- [ ] Front surface (spec §8) : dans la suite de la page caisse (`AdminReservations` ou
  suite caisse existante), un cas avec club mocké `America/Toronto` + `jest.useFakeTimers()`
  réglé à 01:30Z : le jour affiché/requêté est la VEILLE locale Toronto (assertion sur le
  paramètre `date` passé à l'api mockée).
- [ ] Vérifier : `npx jest src/services/__tests__/availability.service.test.ts
  src/services/__tests__/pricing.test.ts` (backend) et `npm test -- bookingWindow` (front) → PASS.
- [ ] Commit : `git commit -m "test(tz): cas non-Paris (Indian/Reunion, America/Toronto)"`.

### Task 8 : docs + gates finales

**Files :** Modify `CLAUDE.md` · `backend/README.md:213,279` · `STACK.md:162`

- [ ] CLAUDE.md : « **Créneaux** : 8h–22h heure Paris (UTC+2 hardcodé) » → « **Créneaux** :
  bornes `openHour`/`closeHour` par terrain, au fuseau du club (`club.timezone` IANA,
  DST géré par Luxon ; jour courant côté front via `lib/clubDay.ts`) » ; retirer l'item
  de backlog « Timezone dynamique … » ; retirer `courts/page.tsx` / `courts/[id]/page.tsx`
  du schéma d'architecture (et l'item backlog « Authentification réelle … DEMO_TOKEN »
  s'il ne référence que ces pages).
- [ ] `backend/README.md` : l.213 et l.279 — remplacer les mentions `UTC_OFFSET = 2` par
  la réalité (conversion au fuseau du club via Luxon). `STACK.md:162` : item traité (le
  cocher ou le supprimer).
- [ ] **Gates finales** : `cd backend && npx jest && npx tsc --noEmit` ;
  `cd frontend && npm test && node node_modules/typescript/bin/tsc --noEmit`.
- [ ] Commit : `git commit -m "docs(tz): CLAUDE.md/README/STACK a jour (timezone dynamique soldee)"`.

### Vérification end-to-end

1. `start.ps1` (pile complète) ; dans `/admin/settings` du club seedé, passer le fuseau à
   `America/Toronto` → la page Réserver, la caisse et le planning affichent le jour
   local Toronto (à vérifier le soir Paris : les pages doivent rester sur le jour Toronto,
   pas basculer sur demain) ; heures des créneaux affichées au fuseau du club.
2. Saisir un fuseau invalide via l'API (curl PATCH admin `{"timezone":"Europe/Pariss"}`)
   → 400 `TIMEZONE_INVALID` ; le sélecteur UI ne permet pas de le faire.
3. Remettre `Europe/Paris` ; vérifier visuellement Réserver + club-house (skill `verify`).
