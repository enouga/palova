# Dupliquer un tournoi / un event — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un bouton « Dupliquer » sur chaque carte de `/admin/tournaments` et `/admin/events` qui rouvre le formulaire de création pré-rempli à partir de l'épreuve existante.

**Architecture :** 100 % frontend. Un helper pur `shiftDatesToNextFuture` (décalage des dates à la prochaine occurrence hebdo future) + une fonction `startDuplicate` par page qui pose l'état `form` du formulaire déjà présent, en mode création. La sauvegarde emprunte le chemin `adminCreate*` existant, qui repasse par toutes les gardes serveur.

**Tech Stack :** Next.js (client component), React state, Jest + React Testing Library, TypeScript.

⚠️ **Working tree partagé** : d'autres fichiers non liés (`backend/src/**`) sont modifiés en parallèle dans le working tree. À chaque commit, `git add` **uniquement les chemins exacts** listés — jamais `git add -A` / `git add .`. Ne jamais `git stash`.

⚠️ **Outils** : les shims `npx` sont cassés sur ce poste. Lancer Jest via `node node_modules/jest/bin/jest.js` et tsc via `node node_modules/typescript/bin/tsc`, **depuis le dossier `frontend/`**.

---

## File Structure

- **Create** `frontend/lib/duplicateAgenda.ts` — helper pur de décalage de dates (une responsabilité : « recaler des dates datetime-local à leur prochaine occurrence hebdo future »).
- **Create** `frontend/__tests__/duplicateAgenda.test.ts` — tests unitaires du helper.
- **Modify** `frontend/app/admin/tournaments/page.tsx` — import du helper, fonction `startDuplicate`, bouton « Dupliquer » dans les actions de carte.
- **Modify** `frontend/app/admin/events/page.tsx` — idem, + `setRecurring(false)`.
- **Modify** `frontend/__tests__/AdminTournaments.test.tsx` — bloc « Dupliquer un tournoi ».
- **Modify** `frontend/__tests__/AdminEvents.test.tsx` — bloc « Dupliquer un event ».

---

## Task 1 : Helper pur `shiftDatesToNextFuture`

**Files:**
- Create: `frontend/lib/duplicateAgenda.ts`
- Test: `frontend/__tests__/duplicateAgenda.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Create `frontend/__tests__/duplicateAgenda.test.ts` :

```ts
import { shiftDatesToNextFuture } from '../lib/duplicateAgenda';

// `now` et les chaînes sont interprétés dans le fuseau local du runner ; le
// round-trip local→Date→local s'annule, donc jour de semaine et heure (HH:MM)
// sont préservés indépendamment du fuseau.

describe('shiftDatesToNextFuture', () => {
  it('source récente : décale d’une seule semaine (même jour, même heure)', () => {
    const now = new Date('2026-07-20T10:00');
    const res = shiftDatesToNextFuture(
      { startTime: '2026-07-18T20:00', endTime: '2026-07-18T23:00', registrationDeadline: '2026-07-16T18:00' },
      now,
    );
    expect(res.registrationDeadline).toBe('2026-07-23T18:00');
    expect(res.startTime).toBe('2026-07-25T20:00');
    expect(res.endTime).toBe('2026-07-25T23:00');
  });

  it('source ancienne : tombe à la PROCHAINE occurrence future, même jour de semaine', () => {
    const now = new Date('2026-07-20T10:00');
    const src = { startTime: '2025-03-15T14:00', endTime: null, registrationDeadline: '2025-03-15T12:00' };
    const res = shiftDatesToNextFuture(src, now);
    const shifted = new Date(res.registrationDeadline);
    // futur
    expect(shifted.getTime()).toBeGreaterThan(now.getTime());
    // même jour de semaine que la source
    expect(shifted.getDay()).toBe(new Date('2025-03-15T12:00').getDay());
    // heure locale préservée
    expect(res.registrationDeadline.endsWith('T12:00')).toBe(true);
    // « la plus proche » : reculer d’une semaine repasse dans le passé
    const earlier = new Date(shifted);
    earlier.setDate(earlier.getDate() - 7);
    expect(earlier.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('pivote sur la limite d’inscription : le début seul serait déjà futur mais la limite non', () => {
    const now = new Date('2026-07-20T10:00');
    // début à J-1 (bientôt futur avec +7), mais limite 14 j avant le début → doit décaler plus
    const src = { startTime: '2026-07-19T20:00', endTime: null, registrationDeadline: '2026-07-05T18:00' };
    const res = shiftDatesToNextFuture(src, now);
    // limite : 05→12 (<20), 12→19 (<20), 19→26 (>20) ⇒ N=3
    expect(res.registrationDeadline).toBe('2026-07-26T18:00');
    // même N=3 sur le début : 19 juillet + 21 j = 9 août
    expect(res.startTime).toBe('2026-08-09T20:00');
    // écart limite→début (14 j) préservé
    const gap = (new Date(res.startTime).getTime() - new Date(res.registrationDeadline).getTime()) / 86_400_000;
    expect(Math.round(gap)).toBe(14);
  });

  it('endTime absent (null) est laissé tel quel', () => {
    const now = new Date('2026-07-20T10:00');
    const res = shiftDatesToNextFuture(
      { startTime: '2026-07-18T20:00', endTime: null, registrationDeadline: '2026-07-16T18:00' },
      now,
    );
    expect(res.endTime).toBeNull();
  });

  it('endTime vide ("") est laissé tel quel', () => {
    const now = new Date('2026-07-20T10:00');
    const res = shiftDatesToNextFuture(
      { startTime: '2026-07-18T20:00', endTime: '', registrationDeadline: '2026-07-16T18:00' },
      now,
    );
    expect(res.endTime).toBe('');
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu’il échoue**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/duplicateAgenda.test.ts`
Expected: FAIL — `Cannot find module '../lib/duplicateAgenda'`.

- [ ] **Step 3 : Implémenter le helper**

Create `frontend/lib/duplicateAgenda.ts` :

```ts
// Décale les dates d'une épreuve (tournoi / event) vers leur prochaine
// occurrence FUTURE, en gardant le même jour de semaine et la même heure
// locale. Sert au bouton « Dupliquer » de /admin/{tournaments,events} : le
// duplicata d'une épreuve passée doit tomber dans le futur, prêt à publier.
//
// Les chaînes sont au format "datetime-local" (YYYY-MM-DDTHH:MM), heure locale
// du navigateur — même format que l'état `form` des deux pages admin.

export type AgendaDates = {
  startTime: string;
  endTime: string | null;
  registrationDeadline: string;
};

// Ajoute weeks*7 jours à une chaîne datetime-local en préservant l'heure locale.
// Le décalage se fait sur les composantes calendaires (setDate), pas en
// millisecondes, pour que « 20h00 » reste « 20h00 » à travers un changement
// d'heure d'été/hiver. Chaîne vide/invalide → renvoyée telle quelle.
function addWeeksLocal(local: string, weeks: number): string {
  const d = new Date(local);
  if (isNaN(d.getTime())) return local;
  d.setDate(d.getDate() + weeks * 7);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Plus petit N ≥ 1 tel que `local` décalé de N semaines soit strictement futur.
// Itératif sur le calendrier (exact vis-à-vis des semaines à cheval sur un
// changement d'heure) ; le nombre d'itérations est borné par l'ancienneté de la
// source (négligeable).
function weeksUntilFuture(local: string, now: Date): number {
  const base = new Date(local);
  if (isNaN(base.getTime())) return 1;
  let n = 1;
  const probe = new Date(base);
  probe.setDate(probe.getDate() + 7);
  while (probe.getTime() <= now.getTime()) {
    n += 1;
    probe.setDate(probe.getDate() + 7);
  }
  return n;
}

// Décale les trois dates du MÊME nombre de semaines, calculé pour que la limite
// d'inscription (le jalon le plus précoce) tombe dans le futur — le début et la
// fin, qui lui sont postérieurs, le sont alors nécessairement aussi. Préserve le
// jour de semaine, l'heure locale et les écarts entre les trois jalons.
export function shiftDatesToNextFuture(dates: AgendaDates, now: Date): AgendaDates {
  const weeks = weeksUntilFuture(dates.registrationDeadline, now);
  return {
    startTime: addWeeksLocal(dates.startTime, weeks),
    endTime: dates.endTime ? addWeeksLocal(dates.endTime, weeks) : dates.endTime,
    registrationDeadline: addWeeksLocal(dates.registrationDeadline, weeks),
  };
}
```

- [ ] **Step 4 : Lancer le test, vérifier qu’il passe**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/duplicateAgenda.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/duplicateAgenda.ts frontend/__tests__/duplicateAgenda.test.ts
git commit -m "feat(admin): helper de decalage des dates pour dupliquer une epreuve

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 : Bouton « Dupliquer » sur `/admin/tournaments`

**Files:**
- Modify: `frontend/app/admin/tournaments/page.tsx`
- Test: `frontend/__tests__/AdminTournaments.test.tsx`

- [ ] **Step 1 : Écrire les tests qui échouent**

Append à la fin de `frontend/__tests__/AdminTournaments.test.tsx` (le helper `iso` et la fabrique `tournament` sont déjà définis dans le fichier) :

```ts
describe('Dupliquer un tournoi', () => {
  it('ouvre le formulaire en création, nom suffixé « (copie) », dates futures', async () => {
    adminGetTournaments.mockResolvedValue([
      tournament({
        id: 't1', name: 'Open Test', category: 'P250', gender: 'MIXED', status: 'PUBLISHED',
        startTime: iso(-30), endTime: null, registrationDeadline: iso(-33), maxTeams: 16, entryFee: '20',
      }),
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Dupliquer/ }));

    // mode création (pas édition)
    expect(screen.queryByText('Modifier le tournoi')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Créer/ })).toBeInTheDocument();
    // nom copié + suffixe
    expect(screen.getByDisplayValue('Open Test (copie)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
    await waitFor(() => expect(adminCreateTournament).toHaveBeenCalled());
    expect(adminUpdateTournament).not.toHaveBeenCalled();
    const [, body] = adminCreateTournament.mock.calls[0];
    expect(body.name).toBe('Open Test (copie)');
    expect(body.category).toBe('P250');
    expect(body.maxTeams).toBe(16);
    expect(new Date(body.registrationDeadline).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(body.startTime).getTime()).toBeGreaterThan(Date.now());
  });

  it('ne copie pas le prépaiement quand Stripe est inactif', async () => {
    adminGetClub.mockResolvedValue({ stripeAccountStatus: 'NONE' });
    adminGetTournaments.mockResolvedValue([
      tournament({
        id: 't1', name: 'Open Test', status: 'PUBLISHED',
        startTime: iso(-30), registrationDeadline: iso(-33), requirePrepayment: true,
      }),
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Dupliquer/ }));
    fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
    await waitFor(() => expect(adminCreateTournament).toHaveBeenCalled());
    const [, body] = adminCreateTournament.mock.calls[0];
    expect(body.requirePrepayment).toBe(false);
  });

  it('ne copie pas un J/A absent du vivier', async () => {
    adminGetReferees.mockResolvedValue([{ userId: 'u1', firstName: 'Léa', lastName: 'Girard', avatarUrl: null }]);
    adminGetTournaments.mockResolvedValue([
      tournament({
        id: 't1', name: 'Open Test', status: 'PUBLISHED',
        startTime: iso(-30), registrationDeadline: iso(-33), refereeUserId: 'u9', // hors vivier
      }),
    ]);
    renderPage();

    // s'assurer que le vivier est chargé avant de dupliquer (le select J/A de la carte le prouve)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Léa Girard' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Dupliquer/ }));
    fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
    await waitFor(() => expect(adminCreateTournament).toHaveBeenCalled());
    const [, body] = adminCreateTournament.mock.calls[0];
    expect(body.refereeUserId).toBeNull();
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier qu’ils échouent**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminTournaments.test.tsx -t "Dupliquer"`
Expected: FAIL — aucun bouton `Dupliquer` (`Unable to find role="button" and name /Dupliquer/`).

- [ ] **Step 3 : Ajouter l’import du helper**

Modify `frontend/app/admin/tournaments/page.tsx`, sous l’import de `datetimeLocal` (`isoToLocalInput` y est déjà importé) :

```tsx
import { shiftDatesToNextFuture } from '@/lib/duplicateAgenda';
```

- [ ] **Step 4 : Ajouter la fonction `startDuplicate`**

Modify `frontend/app/admin/tournaments/page.tsx` — juste après la fonction `startEdit` (elle se termine à l’accolade avant `const publish`) :

```tsx
  const startDuplicate = (t: Tournament) => {
    setError(null);
    setEditingId(null); // mode création : la sauvegarde empruntera adminCreateTournament
    const dates = shiftDatesToNextFuture(
      {
        startTime: isoToLocalInput(t.startTime),
        endTime: t.endTime ? isoToLocalInput(t.endTime) : null,
        registrationDeadline: isoToLocalInput(t.registrationDeadline),
      },
      new Date(),
    );
    setForm({
      clubSportId: t.clubSportId, name: `${t.name} (copie)`, category: t.category,
      gender: t.gender, openToWomen: t.openToWomen,
      description: t.description ?? '', contactInfo: t.contactInfo ?? '',
      // J/A copié seulement s'il est encore dans le vivier (sinon REFEREE_INVALID à la création)
      refereeUserId: t.refereeUserId && referees.some((r) => r.userId === t.refereeUserId) ? t.refereeUserId : null,
      startTime: dates.startTime, endTime: dates.endTime, registrationDeadline: dates.registrationDeadline,
      maxTeams: t.maxTeams, entryFee: t.entryFee != null ? Number(t.entryFee) : null,
      // prépaiement copié seulement si Stripe est encore actif
      requirePrepayment: (t.requirePrepayment ?? false) && stripeActive,
    });
  };
```

- [ ] **Step 5 : Ajouter le bouton dans les actions de carte**

Modify `frontend/app/admin/tournaments/page.tsx` — dans `renderCard`, juste après le bouton « Modifier » (`<button onClick={() => startEdit(t)} style={ghost}>Modifier</button>`) :

```tsx
        <button onClick={() => startDuplicate(t)} style={ghost}>Dupliquer</button>
```

- [ ] **Step 6 : Lancer les tests, vérifier qu’ils passent**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminTournaments.test.tsx`
Expected: PASS (toute la suite, dont les 3 nouveaux « Dupliquer »).

- [ ] **Step 7 : Commit**

```bash
git add frontend/app/admin/tournaments/page.tsx frontend/__tests__/AdminTournaments.test.tsx
git commit -m "feat(admin): bouton Dupliquer sur les cartes de tournoi

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 : Bouton « Dupliquer » sur `/admin/events`

**Files:**
- Modify: `frontend/app/admin/events/page.tsx`
- Test: `frontend/__tests__/AdminEvents.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Append à la fin de `frontend/__tests__/AdminEvents.test.tsx` :

```ts
describe('Dupliquer un event', () => {
  const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

  it('ouvre la création pré-remplie, nom « (copie) », sans récurrence, dates futures', async () => {
    adminGetEvents.mockResolvedValue([
      {
        id: 'e1', name: 'Mêlée Test', kind: 'MELEE', description: '', status: 'PUBLISHED',
        startTime: iso(-20), endTime: null, registrationDeadline: iso(-22),
        capacity: 12, price: '8', memberOnly: true, clubSportId: null,
        requirePrepayment: false, confirmedCount: 0, waitlistCount: 0,
      },
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Dupliquer/ }));

    // mode création (pas édition)
    expect(screen.queryByText("Modifier l'event")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Créer/ })).toBeInTheDocument();
    // nom copié + suffixe
    expect(screen.getByDisplayValue('Mêlée Test (copie)')).toBeInTheDocument();
    // la récurrence n'est pas héritée
    expect(screen.getByRole('checkbox', { name: /Se répète chaque semaine/ })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
    await waitFor(() => expect(adminCreateEvent).toHaveBeenCalled());
    expect(adminUpdateEvent).not.toHaveBeenCalled();
    expect(adminCreateEventSeries).not.toHaveBeenCalled();
    const [, body] = adminCreateEvent.mock.calls[0];
    expect(body.name).toBe('Mêlée Test (copie)');
    expect(body.capacity).toBe(12);
    expect(body.memberOnly).toBe(true);
    expect(new Date(body.startTime).getTime()).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu’il échoue**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminEvents.test.tsx -t "Dupliquer"`
Expected: FAIL — aucun bouton `Dupliquer`.

- [ ] **Step 3 : Ajouter l’import du helper**

Modify `frontend/app/admin/events/page.tsx`, sous l’import de `datetimeLocal` (`isoToLocalInput` y est déjà importé) :

```tsx
import { shiftDatesToNextFuture } from '@/lib/duplicateAgenda';
```

- [ ] **Step 4 : Ajouter la fonction `startDuplicate`**

Modify `frontend/app/admin/events/page.tsx` — juste après la fonction `startEdit` (elle se termine à l’accolade avant `const openDetail`) :

```tsx
  const startDuplicate = (ev: ClubEvent) => {
    setError(null);
    setEditingId(null);   // mode création : la sauvegarde empruntera adminCreateEvent
    setRecurring(false);  // un duplicata est un ponctuel, jamais une série
    const dates = shiftDatesToNextFuture(
      {
        startTime: isoToLocalInput(ev.startTime),
        endTime: ev.endTime ? isoToLocalInput(ev.endTime) : null,
        registrationDeadline: isoToLocalInput(ev.registrationDeadline),
      },
      new Date(),
    );
    setForm({
      name: `${ev.name} (copie)`, kind: ev.kind, description: ev.description ?? '',
      startTime: dates.startTime, endTime: dates.endTime, registrationDeadline: dates.registrationDeadline,
      capacity: ev.capacity, price: ev.price != null ? Number(ev.price) : null, memberOnly: ev.memberOnly,
      clubSportId: ev.clubSportId ?? null, requirePrepayment: (ev.requirePrepayment ?? false) && stripeActive,
    });
  };
```

- [ ] **Step 5 : Ajouter le bouton dans les actions de carte**

Modify `frontend/app/admin/events/page.tsx` — dans `renderCard`, juste après le bouton « Modifier » (`<button onClick={() => startEdit(e)} style={ghost}>Modifier</button>`) :

```tsx
        <button onClick={() => startDuplicate(e)} style={ghost}>Dupliquer</button>
```

- [ ] **Step 6 : Lancer les tests, vérifier qu’ils passent**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminEvents.test.tsx`
Expected: PASS (toute la suite, dont le nouveau « Dupliquer un event »).

- [ ] **Step 7 : Commit**

```bash
git add frontend/app/admin/events/page.tsx frontend/__tests__/AdminEvents.test.tsx
git commit -m "feat(admin): bouton Dupliquer sur les cartes d'event

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 : Vérification finale

**Files:** aucun (vérification seule).

- [ ] **Step 1 : Type-check du frontend (scopé aux fichiers touchés)**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "duplicateAgenda|admin/tournaments|admin/events" || echo "OK: aucune erreur sur les fichiers de la feature"`
Expected: `OK: aucune erreur sur les fichiers de la feature` (le WIP parallèle peut produire du bruit hors périmètre — on ne regarde que nos fichiers).

- [ ] **Step 2 : Lancer les trois suites ensemble**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/duplicateAgenda.test.ts __tests__/AdminTournaments.test.tsx __tests__/AdminEvents.test.tsx`
Expected: PASS (3 suites vertes).

- [ ] **Step 3 : Vérification visuelle (optionnelle, recommandée)**

Utiliser la skill `verify` pour ouvrir `/admin/tournaments` et `/admin/events`, cliquer « Dupliquer » sur une carte, confirmer que le formulaire s’ouvre pré-rempli en « Nouveau … » avec le nom suffixé « (copie) » et des dates dans le futur. (Nécessite la stack dev lancée via `start.ps1`.)

---

## Self-Review (rempli à l’écriture du plan)

- **Couverture spec :** déclencheur (Task 2/3 bouton), champs copiés (startDuplicate), nom « (copie) » (startDuplicate + tests), statut brouillon (mode création, `Créer (brouillon)`), dates → prochaine occurrence future (Task 1 helper + tests), récurrence décochée (Task 3 `setRecurring(false)` + test), J/A filtré (Task 2 startDuplicate + test), prépaiement filtré Stripe (Task 2/3 startDuplicate + test tournoi), bouton sur toutes les cartes (aucun gating de statut sur le bouton). ✔ Couvert.
- **Placeholders :** aucun — tout le code (helper, tests, diffs) est fourni intégralement.
- **Cohérence de types :** `shiftDatesToNextFuture(dates: AgendaDates, now: Date)` défini en Task 1, appelé à l’identique en Task 2 et 3 ; `AgendaDates.endTime: string | null` compatible avec `t.endTime ? isoToLocalInput(...) : null`. Les champs de `CreateTournamentBody` / `CreateEventBody` posés dans `startDuplicate` reprennent exactement ceux de `startEdit` (mêmes clés).
