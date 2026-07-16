# Réglages — Sports en enregistrement différé — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire de l'onglet « Sports » de `/admin/settings` un onglet à enregistrement différé (brouillon + barre `SaveBar` unique), à l'identique des 5 autres onglets, au lieu d'enregistrer chaque clic immédiatement.

**Architecture:** Un nouvel endpoint backend atomique (`PUT /api/clubs/:clubId/admin/sports`, une transaction Prisma) applique en un coup tout le lot de changements Sports (ajout de sport + durées). Côté front, l'état Sports (`sportsServer`/`sportsDraft`) est levé de `SettingsSports.tsx` vers `app/admin/settings/page.tsx`, symétrique du couple `server`/`draft` du Club ; `SettingsSports` devient un composant purement contrôlé. Le clic « Enregistrer » de la page lance le PATCH Club (si modifié) et le nouveau batch Sports (si modifié) en parallèle, chacun indépendant.

**Tech Stack:** Express + Prisma (backend), Next.js + React (frontend), Jest partout.

Spec de référence : `docs/superpowers/specs/2026-07-16-reglages-sports-enregistrement-differe-design.md`.

---

### Task 1: Backend — `ClubService.applySportsBatch` (transaction atomique)

**Files:**
- Modify: `backend/src/services/club.service.ts:97` (ajout d'une constante module-scope), `:865-899` (refactor `listClubSports` + nouvelle méthode `applySportsBatch`)
- Test: `backend/src/services/__tests__/club.service.test.ts` (nouveau `describe` après celui de `addClubSport`, ligne 513)

- [ ] **Step 1: Écrire les tests (échouent — la méthode n'existe pas encore)**

Dans `backend/src/services/__tests__/club.service.test.ts`, insérer ce bloc juste après la ligne 513 (`});` qui ferme `describe('ClubService.addClubSport — gate published', ...)`), avant `describe('ClubService — updateClub heures d'ouverture', ...)` :

```ts
describe('ClubService.applySportsBatch', () => {
  let svc: ClubService;
  beforeEach(() => {
    svc = new ClubService();
    prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
  });

  it('crée un nouveau sport et met à jour un sport déjà activé dans le même lot', async () => {
    prismaMock.clubSport.findMany
      .mockResolvedValueOnce([{ sportId: 'padel' }] as any) // sports déjà activés
      .mockResolvedValueOnce([{ id: 'cs-padel', sport: { id: 'padel' } }] as any); // liste finale renvoyée
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'tennis', published: true } as any);
    prismaMock.clubSport.create.mockResolvedValue({} as any);
    prismaMock.clubSport.update.mockResolvedValue({} as any);

    await svc.applySportsBatch('club-1', [
      { sportId: 'tennis', durationsMin: [] },
      { sportId: 'padel', durationsMin: [60, 90] },
    ]);

    expect(prismaMock.clubSport.create).toHaveBeenCalledWith({ data: { clubId: 'club-1', sportId: 'tennis' } });
    expect(prismaMock.clubSport.update).toHaveBeenCalledWith({
      where: { clubId_sportId: { clubId: 'club-1', sportId: 'padel' } },
      data: { durationsMin: [60, 90] },
    });
  });

  it('refuse un sport non publié (SPORT_NOT_FOUND) sans rien appliquer', async () => {
    prismaMock.clubSport.findMany.mockResolvedValueOnce([] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'tennis', published: false } as any);

    await expect(svc.applySportsBatch('club-1', [{ sportId: 'tennis', durationsMin: [] }]))
      .rejects.toThrow('SPORT_NOT_FOUND');
    expect(prismaMock.clubSport.create).not.toHaveBeenCalled();
  });

  it('refuse des durées invalides (VALIDATION_ERROR) sans rien appliquer', async () => {
    prismaMock.clubSport.findMany.mockResolvedValueOnce([{ sportId: 'padel' }] as any);

    await expect(svc.applySportsBatch('club-1', [{ sportId: 'padel', durationsMin: [10] }]))
      .rejects.toThrow('VALIDATION_ERROR');
    expect(prismaMock.clubSport.update).not.toHaveBeenCalled();
  });

  it('refuse de vider les durées d\'un sport déjà activé (VALIDATION_ERROR)', async () => {
    prismaMock.clubSport.findMany.mockResolvedValueOnce([{ sportId: 'padel' }] as any);

    await expect(svc.applySportsBatch('club-1', [{ sportId: 'padel', durationsMin: [] }]))
      .rejects.toThrow('VALIDATION_ERROR');
    expect(prismaMock.clubSport.update).not.toHaveBeenCalled();
  });

  it('annule tout le lot si le DEUXIÈME item est invalide (rien appliqué, même pas le premier)', async () => {
    prismaMock.clubSport.findMany.mockResolvedValueOnce([{ sportId: 'padel' }] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'tennis', published: true } as any);

    await expect(svc.applySportsBatch('club-1', [
      { sportId: 'tennis', durationsMin: [] },
      { sportId: 'padel', durationsMin: [10] }, // invalide
    ])).rejects.toThrow('VALIDATION_ERROR');
    expect(prismaMock.clubSport.create).not.toHaveBeenCalled();
    expect(prismaMock.clubSport.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts -t "applySportsBatch"`
Expected: FAIL — `svc.applySportsBatch is not a function`

- [ ] **Step 3: Implémenter `applySportsBatch` + factoriser le select partagé**

Dans `backend/src/services/club.service.ts`, remplacer (autour de la ligne 97, juste avant `interface CreateClubParams`) :

```ts
interface CreateClubParams {
```

par :

```ts
/** Select partagé par listClubSports et applySportsBatch (même forme de sortie). */
const CLUB_SPORT_SELECT = {
  id: true, slotStepMin: true, durationsMin: true,
  sport: { select: { id: true, key: true, name: true, resourceNoun: true, defaultDurationsMin: true, surfaces: true, hasLighting: true } },
};

interface CreateClubParams {
```

Puis remplacer le bloc (lignes 865-875) :

```ts
  /** Sports activés par un club (avec leurs ressources, y compris inactives). */
  async listClubSports(clubId: string) {
    return prisma.clubSport.findMany({
      where: { clubId },
      select: {
        id: true, slotStepMin: true, durationsMin: true,
        sport: { select: { id: true, key: true, name: true, resourceNoun: true, defaultDurationsMin: true, surfaces: true, hasLighting: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
```

par :

```ts
  /** Sports activés par un club (avec leurs ressources, y compris inactives). */
  async listClubSports(clubId: string) {
    return prisma.clubSport.findMany({ where: { clubId }, select: CLUB_SPORT_SELECT, orderBy: { createdAt: 'asc' } });
  }

  /**
   * Applique un lot de changements Sports (ajout de sport + durées proposées) en une seule
   * transaction — tout ou rien. `items` = uniquement les lignes qui diffèrent de la baseline
   * (le diff est calculé côté front, cf. `buildSportsBatchBody`). Enregistrement différé de
   * l'onglet Sports de /admin/settings (avant : chaque action était persistée immédiatement).
   */
  async applySportsBatch(clubId: string, items: { sportId: string; durationsMin: number[] }[]) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.clubSport.findMany({ where: { clubId }, select: { sportId: true } });
      const existingIds = new Set(existing.map((e) => e.sportId));

      // 1) Valider TOUT le lot avant d'appliquer quoi que ce soit (tout ou rien).
      const plan: { sportId: string; already: boolean; durationsMin: number[] }[] = [];
      for (const item of items) {
        const already = existingIds.has(item.sportId);
        let valid: number[] = [];
        if (item.durationsMin.length > 0) {
          valid = Array.from(new Set(item.durationsMin))
            .filter((d) => Number.isInteger(d) && d >= 15 && d <= 240 && d % 15 === 0)
            .sort((a, b) => a - b);
          if (valid.length === 0) throw new Error('VALIDATION_ERROR');
        } else if (already) {
          throw new Error('VALIDATION_ERROR'); // un sport déjà activé garde au moins une durée
        }
        if (!already) {
          const sport = await tx.sport.findUnique({ where: { id: item.sportId }, select: { id: true, published: true } });
          if (!sport || !sport.published) throw new Error('SPORT_NOT_FOUND');
        }
        plan.push({ sportId: item.sportId, already, durationsMin: valid });
      }

      // 2) Appliquer — le lot entier est déjà validé.
      for (const p of plan) {
        if (p.already) {
          await tx.clubSport.update({
            where: { clubId_sportId: { clubId, sportId: p.sportId } },
            data: { durationsMin: p.durationsMin },
          });
        } else {
          await tx.clubSport.create({
            data: { clubId, sportId: p.sportId, ...(p.durationsMin.length ? { durationsMin: p.durationsMin } : {}) },
          });
        }
      }

      return tx.clubSport.findMany({ where: { clubId }, select: CLUB_SPORT_SELECT, orderBy: { createdAt: 'asc' } });
    });
  }
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts`
Expected: PASS (tout le fichier, pas seulement le nouveau bloc — vérifie que le refactor de `listClubSports` n'a rien cassé)

- [ ] **Step 5: Type-check backend**

Run: `cd backend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "$(cat <<'EOF'
feat(sports): applySportsBatch atomique (Reglages Sports enregistrement differe)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Backend — route `PUT /api/clubs/:clubId/admin/sports`

**Files:**
- Modify: `backend/src/routes/admin.ts:279-286` (ajout d'une route juste après le `PATCH /sports/:clubSportId` existant)
- Test: Create `backend/src/routes/__tests__/admin.sports.routes.test.ts`

- [ ] **Step 1: Écrire le test de route (échoue — 404, la route n'existe pas)**

Create `backend/src/routes/__tests__/admin.sports.routes.test.ts` :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'staff1', email: 's@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'staff1', clubId: 'club-demo', role: 'STAFF' } as any);
  prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
});

describe('PUT /api/clubs/:clubId/admin/sports', () => {
  it('401 sans token', async () => {
    const res = await request(app).put(`${base}/sports`).send({ items: [] });
    expect(res.status).toBe(401);
  });

  it('400 si items n\'est pas un tableau', async () => {
    const res = await request(app).put(`${base}/sports`).set(auth).send({});
    expect(res.status).toBe(400);
  });

  it('200 : applique le lot et renvoie la liste à jour', async () => {
    prismaMock.clubSport.findMany
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
        id: 'cs-1', slotStepMin: null, durationsMin: [60],
        sport: { id: 'tennis', key: 'tennis', name: 'Tennis', resourceNoun: 'Court', defaultDurationsMin: [60], surfaces: [], hasLighting: false },
      }] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'tennis', published: true } as any);
    prismaMock.clubSport.create.mockResolvedValue({} as any);

    const res = await request(app).put(`${base}/sports`).set(auth).send({ items: [{ sportId: 'tennis', durationsMin: [60] }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      id: 'cs-1', slotStepMin: null, durationsMin: [60],
      sport: { id: 'tennis', key: 'tennis', name: 'Tennis', resourceNoun: 'Court', defaultDurationsMin: [60], surfaces: [], hasLighting: false },
    }]);
  });

  it('400 VALIDATION_ERROR : durée invalide', async () => {
    prismaMock.clubSport.findMany.mockResolvedValueOnce([{ sportId: 'padel' }] as any);
    const res = await request(app).put(`${base}/sports`).set(auth).send({ items: [{ sportId: 'padel', durationsMin: [10] }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `cd backend && node node_modules/jest/bin/jest.js src/routes/__tests__/admin.sports.routes.test.ts`
Expected: FAIL (404 sur la route `PUT /sports`, elle n'existe pas encore)

- [ ] **Step 3: Ajouter la route**

Dans `backend/src/routes/admin.ts`, remplacer (lignes 279-286) :

```ts
// Durées proposées pour un sport du club.
router.patch('/sports/:clubSportId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    if (!Array.isArray(req.body.durationsMin)) return void res.status(400).json({ error: 'durationsMin (number[]) requis' });
    const cs = await clubService.updateClubSport(asString(req.params.clubSportId), req.membership!.clubId, req.body.durationsMin.map(Number));
    res.json(cs);
  } catch (err) { handleError(err, res, next); }
});
```

par :

```ts
// Durées proposées pour un sport du club.
router.patch('/sports/:clubSportId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    if (!Array.isArray(req.body.durationsMin)) return void res.status(400).json({ error: 'durationsMin (number[]) requis' });
    const cs = await clubService.updateClubSport(asString(req.params.clubSportId), req.membership!.clubId, req.body.durationsMin.map(Number));
    res.json(cs);
  } catch (err) { handleError(err, res, next); }
});

// Enregistrement différé (onglet Sports de /admin/settings) : applique tout le lot en une transaction.
router.put('/sports', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    if (!Array.isArray(req.body.items)) return void res.status(400).json({ error: 'items (array) requis' });
    const items = req.body.items.map((it: { sportId?: unknown; durationsMin?: unknown }) => ({
      sportId: asString(it?.sportId),
      durationsMin: Array.isArray(it?.durationsMin) ? it.durationsMin.map(Number) : [],
    }));
    res.json(await clubService.applySportsBatch(req.membership!.clubId, items));
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `cd backend && node node_modules/jest/bin/jest.js src/routes/__tests__/admin.sports.routes.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check backend**

Run: `cd backend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.sports.routes.test.ts
git commit -m "$(cat <<'EOF'
feat(sports): route PUT /admin/sports (batch atomique)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Frontend — `lib/api.ts` : type + méthode `adminApplySportsBatch`

**Files:**
- Modify: `frontend/lib/api.ts:398-403` (méthode), `:1742-1747` (type)

- [ ] **Step 1: Ajouter le type `SportsBatchItem`**

Dans `frontend/lib/api.ts`, remplacer (lignes 1742-1747) :

```ts
export interface AdminClubSport {
  id: string;
  slotStepMin: number | null;
  durationsMin: number[];
  sport: { id: string; key: string; name: string; resourceNoun: string; defaultDurationsMin: number[]; surfaces: string[]; hasLighting: boolean };
}
```

par :

```ts
export interface AdminClubSport {
  id: string;
  slotStepMin: number | null;
  durationsMin: number[];
  sport: { id: string; key: string; name: string; resourceNoun: string; defaultDurationsMin: number[]; surfaces: string[]; hasLighting: boolean };
}

/** Ligne de lot pour PUT /admin/sports — un sport ajouté ou dont les durées ont changé. */
export interface SportsBatchItem {
  sportId: string;
  durationsMin: number[];
}
```

- [ ] **Step 2: Ajouter la méthode `adminApplySportsBatch`**

Dans `frontend/lib/api.ts`, remplacer (lignes 398-403, incluant la ligne vide qui suit `adminAddSport`) :

```ts
  adminAddSport: (clubId: string, sportId: string, token: string) =>
    request<AdminClubSport>(`/api/clubs/${clubId}/admin/sports`, { method: 'POST', body: JSON.stringify({ sportId }) }, token),

  adminUpdateClubSport: (clubId: string, clubSportId: string, durationsMin: number[], token: string) =>
    request<AdminClubSport>(`/api/clubs/${clubId}/admin/sports/${clubSportId}`, { method: 'PATCH', body: JSON.stringify({ durationsMin }) }, token),

```

par :

```ts
  adminAddSport: (clubId: string, sportId: string, token: string) =>
    request<AdminClubSport>(`/api/clubs/${clubId}/admin/sports`, { method: 'POST', body: JSON.stringify({ sportId }) }, token),

  adminUpdateClubSport: (clubId: string, clubSportId: string, durationsMin: number[], token: string) =>
    request<AdminClubSport>(`/api/clubs/${clubId}/admin/sports/${clubSportId}`, { method: 'PATCH', body: JSON.stringify({ durationsMin }) }, token),

  // Enregistrement différé (onglet Sports de /admin/settings) : `items` = uniquement les lignes modifiées.
  adminApplySportsBatch: (clubId: string, items: SportsBatchItem[], token: string) =>
    request<AdminClubSport[]>(`/api/clubs/${clubId}/admin/sports`, { method: 'PUT', body: JSON.stringify({ items }) }, token),

```

Note : `adminAddSport`/`adminUpdateClubSport` restent utilisées telles quelles par `components/onboarding/StepSports.tsx` et `app/clubs/new/page.tsx` (enregistrement immédiat assumé pour ces flux, hors périmètre de ce plan) — ne pas les retirer.

- [ ] **Step 3: Type-check frontend**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur (pas de test dédié — méthode de plomberie sans logique, exercée par les tests de Task 6)

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(sports): api.adminApplySportsBatch (client du batch atomique)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Frontend — helpers purs de brouillon dans `lib/adminSettings.ts`

**Files:**
- Modify: `frontend/lib/adminSettings.ts`
- Test: `frontend/__tests__/adminSettings.test.ts`

- [ ] **Step 1: Écrire les tests (échouent — les helpers n'existent pas)**

Dans `frontend/__tests__/adminSettings.test.ts`, remplacer les imports (lignes 1-5) :

```ts
import {
  SETTINGS_TABS, parseTab, buildUpdateBody, isDirty, offPeakChipLabel,
  DAY_PRESETS_PUBLIC, DAY_PRESETS_MEMBER,
} from '@/lib/adminSettings';
import type { ClubAdminDetail } from '@/lib/api';
```

par :

```ts
import {
  SETTINGS_TABS, parseTab, buildUpdateBody, isDirty, offPeakChipLabel,
  DAY_PRESETS_PUBLIC, DAY_PRESETS_MEMBER,
  toSportsDraft, addSportDraft, toggleDurationDraft, sportsDirty, buildSportsBatchBody,
} from '@/lib/adminSettings';
import type { ClubAdminDetail, AdminClubSport } from '@/lib/api';
```

Puis ajouter, à la toute fin du fichier (après le `});` qui ferme `describe('adminSettings helpers', ...)`) :

```ts

const PADEL_CS: AdminClubSport = {
  id: 'cs-padel', slotStepMin: null, durationsMin: [90],
  sport: { id: 'padel', key: 'padel', name: 'Padel', resourceNoun: 'Court', defaultDurationsMin: [90], surfaces: [], hasLighting: false },
};

describe('adminSettings — brouillon Sports', () => {
  it('toSportsDraft convertit la liste serveur en brouillon éditable', () => {
    expect(toSportsDraft([PADEL_CS])).toEqual([{ sportId: 'padel', clubSportId: 'cs-padel', durationsMin: [90] }]);
  });

  it('addSportDraft ajoute un sport absent, idempotent si déjà présent', () => {
    const draft = toSportsDraft([PADEL_CS]);
    const withTennis = addSportDraft(draft, 'tennis');
    expect(withTennis).toEqual([...draft, { sportId: 'tennis', clubSportId: null, durationsMin: [] }]);
    expect(addSportDraft(withTennis, 'tennis')).toBe(withTennis); // idempotent, pas de doublon
  });

  it('toggleDurationDraft bascule une durée et refuse de tout décocher', () => {
    const draft = toSportsDraft([PADEL_CS]); // durationsMin: [90]
    const toggled = toggleDurationDraft(draft, 'padel', [90], 60); // ajoute 60
    expect(toggled[0].durationsMin).toEqual([60, 90]);

    const oneLeft = toggleDurationDraft(toggled, 'padel', [90], 60); // retire 60
    expect(oneLeft[0].durationsMin).toEqual([90]);

    const refused = toggleDurationDraft(oneLeft, 'padel', [90], 90); // tenter de retirer la dernière
    expect(refused[0].durationsMin).toEqual([90]); // refusé : au moins une durée
  });

  it('sportsDirty est faux pour un brouillon identique, vrai après ajout ou changement de durées', () => {
    const server = [PADEL_CS];
    expect(sportsDirty(server, toSportsDraft(server))).toBe(false);
    expect(sportsDirty(server, addSportDraft(toSportsDraft(server), 'tennis'))).toBe(true);
    expect(sportsDirty(server, toggleDurationDraft(toSportsDraft(server), 'padel', [90], 60))).toBe(true);
  });

  it('buildSportsBatchBody ne renvoie que les lignes modifiées', () => {
    const server = [PADEL_CS];
    expect(buildSportsBatchBody(server, toSportsDraft(server))).toEqual([]); // rien de modifié

    const withTennis = addSportDraft(toSportsDraft(server), 'tennis');
    expect(buildSportsBatchBody(server, withTennis)).toEqual([{ sportId: 'tennis', durationsMin: [] }]);

    const toggled = toggleDurationDraft(toSportsDraft(server), 'padel', [90], 60);
    expect(buildSportsBatchBody(server, toggled)).toEqual([{ sportId: 'padel', durationsMin: [60, 90] }]);
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/adminSettings.test.ts`
Expected: FAIL — `toSportsDraft is not a function` (et les autres imports manquants)

- [ ] **Step 3: Implémenter les helpers**

Dans `frontend/lib/adminSettings.ts`, remplacer la ligne d'import (ligne 2) :

```ts
import type { ClubAdminDetail, UpdateClubBody, OffPeakRange } from '@/lib/api';
```

par :

```ts
import type { ClubAdminDetail, UpdateClubBody, OffPeakRange, AdminClubSport, SportsBatchItem } from '@/lib/api';
import { effectiveDurations } from '@/lib/duration';
```

Puis ajouter, à la toute fin du fichier (après la fonction `offPeakChipLabel`) :

```ts

/** Ligne de brouillon Sports : `clubSportId: null` = sport ajouté, pas encore côté serveur. */
export interface SportsDraftItem {
  sportId: string;
  clubSportId: string | null;
  durationsMin: number[];
}

/** Convertit la liste serveur (AdminClubSport[]) en brouillon éditable. */
export function toSportsDraft(list: AdminClubSport[]): SportsDraftItem[] {
  return list.map((s) => ({ sportId: s.sport.id, clubSportId: s.id, durationsMin: s.durationsMin }));
}

/** Ajoute un sport au brouillon (idempotent — pas de doublon si déjà présent). */
export function addSportDraft(items: SportsDraftItem[], sportId: string): SportsDraftItem[] {
  if (items.some((i) => i.sportId === sportId)) return items;
  return [...items, { sportId, clubSportId: null, durationsMin: [] }];
}

/** Bascule une durée pour un sport du brouillon ; refuse de vider l'ensemble (au moins une durée). */
export function toggleDurationDraft(
  items: SportsDraftItem[], sportId: string, defaultDurationsMin: number[], min: number,
): SportsDraftItem[] {
  return items.map((item) => {
    if (item.sportId !== sportId) return item;
    const cur = new Set(effectiveDurations(item.durationsMin, defaultDurationsMin));
    if (cur.has(min)) cur.delete(min); else cur.add(min);
    if (cur.size === 0) return item;
    return { ...item, durationsMin: Array.from(cur).sort((a, b) => a - b) };
  });
}

function normalizeSportsForCompare(items: { sportId: string; durationsMin: number[] }[]) {
  return items
    .map((i) => ({ sportId: i.sportId, durationsMin: [...i.durationsMin].sort((a, b) => a - b) }))
    .sort((a, b) => a.sportId.localeCompare(b.sportId));
}

/** Vrai si le brouillon Sports diffère de la baseline serveur (ajout de sport ou durées modifiées). */
export function sportsDirty(server: AdminClubSport[], draft: SportsDraftItem[]): boolean {
  const serverItems = server.map((s) => ({ sportId: s.sport.id, durationsMin: s.durationsMin }));
  const draftItems = draft.map((d) => ({ sportId: d.sportId, durationsMin: d.durationsMin }));
  return JSON.stringify(normalizeSportsForCompare(serverItems)) !== JSON.stringify(normalizeSportsForCompare(draftItems));
}

/** Ne renvoie QUE les lignes du brouillon qui diffèrent de la baseline (jamais la liste entière). */
export function buildSportsBatchBody(server: AdminClubSport[], draft: SportsDraftItem[]): SportsBatchItem[] {
  const baselineBySport = new Map(server.map((s) => [s.sport.id, s.durationsMin]));
  const out: SportsBatchItem[] = [];
  for (const item of draft) {
    const baseline = baselineBySport.get(item.sportId);
    const changed = baseline === undefined
      || JSON.stringify([...baseline].sort((a, b) => a - b)) !== JSON.stringify([...item.durationsMin].sort((a, b) => a - b));
    if (changed) out.push({ sportId: item.sportId, durationsMin: item.durationsMin });
  }
  return out;
}
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/adminSettings.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check frontend**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/adminSettings.ts frontend/__tests__/adminSettings.test.ts
git commit -m "$(cat <<'EOF'
feat(sports): helpers purs de brouillon Sports (adminSettings.ts)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Frontend — `SettingsSports.tsx` devient un composant contrôlé

**Files:**
- Modify: `frontend/components/admin/settings/SettingsSports.tsx` (réécriture complète)
- Test: `frontend/__tests__/SettingsSports.test.tsx` (réécriture complète)

- [ ] **Step 1: Réécrire le test en composant contrôlé (échoue — l'ancien composant attend encore `useAuth`/`api`)**

Remplacer tout le contenu de `frontend/__tests__/SettingsSports.test.tsx` par :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsSports } from '@/components/admin/settings/SettingsSports';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: () => '' }) }) }));

const CATALOG = [
  { id: 'padel', name: 'Padel', icon: null, defaultDurationsMin: [90] },
  { id: 'tennis', name: 'Tennis', icon: '🎾', defaultDurationsMin: [60] },
];
const ITEMS = [{ sportId: 'padel', clubSportId: 'cs1', durationsMin: [90] }];

describe('SettingsSports (composant contrôlé)', () => {
  it('liste les sports activés avec leurs durées et propose les sports du catalogue à ajouter', () => {
    render(<SettingsSports catalog={CATALOG} items={ITEMS} onAdd={jest.fn()} onToggleDuration={jest.fn()} />);
    expect(screen.getByText('Padel')).toBeInTheDocument();
    expect(screen.getByText('Proposés par le club')).toBeInTheDocument();
    // Durées cochables du padel : 30 min, 1 h, 1 h 30, 2 h.
    expect(screen.getByRole('button', { name: '1 h 30' })).toBeInTheDocument();
    // Tennis (non activé) est proposé à l'ajout.
    expect(screen.getByRole('button', { name: /Tennis/ })).toBeInTheDocument();
  });

  it('appelle onAdd au clic sur un sport du catalogue, sans appel réseau', () => {
    const onAdd = jest.fn();
    render(<SettingsSports catalog={CATALOG} items={ITEMS} onAdd={onAdd} onToggleDuration={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Tennis/ }));
    expect(onAdd).toHaveBeenCalledWith('tennis');
  });

  it('appelle onToggleDuration au clic sur une durée', () => {
    const onToggleDuration = jest.fn();
    render(<SettingsSports catalog={CATALOG} items={ITEMS} onAdd={jest.fn()} onToggleDuration={onToggleDuration} />);
    fireEvent.click(screen.getByRole('button', { name: '1 h' }));
    expect(onToggleDuration).toHaveBeenCalledWith('padel', 60);
  });

  it('brouillon vide : message dédié + tout le catalogue proposé à l\'ajout', () => {
    render(<SettingsSports catalog={CATALOG} items={[]} onAdd={jest.fn()} onToggleDuration={jest.fn()} />);
    expect(screen.getByText(/Aucun sport activé/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Padel/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tennis/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/SettingsSports.test.tsx`
Expected: FAIL (le composant attend encore 0 props et appelle `useAuth`/`useClub`/`api`)

- [ ] **Step 3: Réécrire le composant**

Remplacer tout le contenu de `frontend/components/admin/settings/SettingsSports.tsx` par :

```tsx
'use client';
import { useSettingsStyles } from './shared';
import { durationLabel, effectiveDurations, proposableDurations } from '@/lib/duration';
import { SportsDraftItem } from '@/lib/adminSettings';

/** Sous-ensemble du catalogue plateforme dont ce composant a besoin. */
export interface SportsCatalogEntry {
  id: string;
  name: string;
  icon: string | null;
  defaultDurationsMin: number[];
}

interface Props {
  catalog: SportsCatalogEntry[];
  items: SportsDraftItem[];
  onAdd: (sportId: string) => void;
  onToggleDuration: (sportId: string, min: number) => void;
}

// Onglet « Sports » des Réglages. Composant CONTRÔLÉ : la page orchestratrice
// (app/admin/settings/page.tsx) possède le brouillon et l'enregistrement différé (SaveBar) —
// ce composant n'appelle jamais l'API lui-même (avant le 2026-07-16 : enregistrement immédiat).
export function SettingsSports({ catalog, items, onAdd, onToggleDuration }: Props) {
  const { th, card, h2, hint } = useSettingsStyles();
  const bySportId = new Map(catalog.map((s) => [s.id, s]));
  const enabledIds = new Set(items.map((i) => i.sportId));
  const available = catalog.filter((s) => !enabledIds.has(s.id));

  return (
    <>
      <div style={card}>
        <h2 style={{ ...h2, marginBottom: 14 }}>Proposés par le club</h2>
        {items.length === 0 ? (
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: 0 }}>Aucun sport activé pour l&apos;instant.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {items.map((item) => {
              const sport = bySportId.get(item.sportId);
              if (!sport) return null;
              const eff = effectiveDurations(item.durationsMin, sport.defaultDurationsMin);
              return (
                <div key={item.sportId} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 700, color: th.text, minWidth: 110 }}>{sport.name}</span>
                  <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>Durées proposées :</span>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    {proposableDurations(sport.defaultDurationsMin).map((m) => {
                      const on = eff.includes(m);
                      return (
                        <button key={m} onClick={() => onToggleDuration(item.sportId, m)}
                          style={{ border: on ? 'none' : `1px solid ${th.line}`, cursor: 'pointer', borderRadius: 9, padding: '7px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, background: on ? th.accent : 'transparent', color: on ? th.onAccent : th.textMute }}>
                          {durationLabel(m)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={h2}>Ajouter un sport</h2>
        <p style={hint}>Depuis le catalogue de la plateforme.</p>
        {available.length === 0 ? (
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: 0 }}>Tous les sports du catalogue sont déjà activés.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {available.map((s) => (
              <button key={s.id} onClick={() => onAdd(s.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1px dashed ${th.lineStrong}`, background: 'transparent', cursor: 'pointer', borderRadius: 12, padding: '9px 14px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text }}>
                {s.icon ? `${s.icon} ` : ''}{s.name}
                <span style={{ color: th.accent, fontWeight: 700 }}>+</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/SettingsSports.test.tsx`
Expected: PASS

- [ ] **Step 5: Type-check frontend**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: des erreurs vont apparaître sur `app/admin/settings/page.tsx` (qui rend encore `<SettingsSports />` sans props) — c'est attendu, corrigé à la Task 6. Vérifier qu'il n'y a **aucune autre** erreur ailleurs.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/admin/settings/SettingsSports.tsx frontend/__tests__/SettingsSports.test.tsx
git commit -m "$(cat <<'EOF'
refactor(sports): SettingsSports devient un composant controle (props brouillon)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Frontend — câbler la page `app/admin/settings/page.tsx`

**Files:**
- Modify: `frontend/app/admin/settings/page.tsx`
- Modify: `frontend/__tests__/AdminSettings.test.tsx`
- Modify: `frontend/__tests__/AdminSettings.refresh.test.tsx`

- [ ] **Step 1: Mettre à jour les mocks + ajouter les tests de comportement différé (échouent)**

Dans `frontend/__tests__/AdminSettings.test.tsx`, remplacer le mock d'API (lignes 10-17) :

```ts
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    adminGetClub: jest.fn(), adminUpdateClub: jest.fn().mockResolvedValue({}),
    uploadClubLogo: jest.fn(), uploadClubCover: jest.fn(),
    adminGetSports: jest.fn().mockResolvedValue([]), getSports: jest.fn().mockResolvedValue([]),
  },
}));
```

par :

```ts
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    adminGetClub: jest.fn(), adminUpdateClub: jest.fn().mockResolvedValue({}),
    uploadClubLogo: jest.fn(), uploadClubCover: jest.fn(),
    adminGetSports: jest.fn().mockResolvedValue([]), getSports: jest.fn().mockResolvedValue([]),
    adminApplySportsBatch: jest.fn().mockResolvedValue([]),
  },
}));
```

Puis dans le `beforeEach` (lignes 36-41), remplacer :

```ts
  beforeEach(() => {
    refreshMock.mockReset();
    (mocked.adminGetClub as jest.Mock).mockResolvedValue({ ...CLUB });
    (mocked.adminUpdateClub as jest.Mock).mockClear().mockResolvedValue({});
    window.history.replaceState(null, '', '/admin/settings');
  });
```

par :

```ts
  beforeEach(() => {
    refreshMock.mockReset();
    (mocked.adminGetClub as jest.Mock).mockResolvedValue({ ...CLUB });
    (mocked.adminUpdateClub as jest.Mock).mockClear().mockResolvedValue({});
    (mocked.adminApplySportsBatch as jest.Mock).mockClear().mockResolvedValue([]);
    window.history.replaceState(null, '', '/admin/settings');
  });
```

Puis ajouter, juste après le test `'renders the Sports tab content when selected'` (après la ligne `});` qui le ferme, avant `it('opens on the tab named in ?tab= at mount', ...)`) :

```ts

  it('Sports : ajouter un sport est différé (aucun appel réseau) jusqu\'à Enregistrer', async () => {
    (mocked.getSports as jest.Mock).mockResolvedValueOnce([
      { id: 'padel', name: 'Padel', icon: null, defaultDurationsMin: [90] },
      { id: 'tennis', name: 'Tennis', icon: '🎾', defaultDurationsMin: [60] },
    ]);
    (mocked.adminGetSports as jest.Mock).mockResolvedValueOnce([
      { id: 'cs1', slotStepMin: null, durationsMin: [90], sport: { id: 'padel', key: 'padel', name: 'Padel', resourceNoun: 'Court', defaultDurationsMin: [90], surfaces: [], hasLighting: false } },
    ]);

    wrap();
    await screen.findByText('Profil');
    fireEvent.click(screen.getByRole('button', { name: 'Sports' }));
    fireEvent.click(await screen.findByRole('button', { name: /Tennis/ }));

    expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
    expect(mocked.adminApplySportsBatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminApplySportsBatch)
      .toHaveBeenCalledWith('c1', [{ sportId: 'tennis', durationsMin: [] }], 'tok'));
    expect(await screen.findByText(/Enregistré/)).toBeInTheDocument();
  });

  it('Sports : Annuler défait un ajout de sport sans appel réseau', async () => {
    (mocked.getSports as jest.Mock).mockResolvedValueOnce([
      { id: 'padel', name: 'Padel', icon: null, defaultDurationsMin: [90] },
      { id: 'tennis', name: 'Tennis', icon: '🎾', defaultDurationsMin: [60] },
    ]);
    (mocked.adminGetSports as jest.Mock).mockResolvedValueOnce([]);

    wrap();
    await screen.findByText('Profil');
    fireEvent.click(screen.getByRole('button', { name: 'Sports' }));
    fireEvent.click(await screen.findByRole('button', { name: /Tennis/ }));
    expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
    expect(mocked.adminApplySportsBatch).not.toHaveBeenCalled();
    // Tennis redevient proposé à l'ajout (le brouillon est revenu à la baseline vide).
    expect(await screen.findByRole('button', { name: /Tennis/ })).toBeInTheDocument();
  });
```

Dans `frontend/__tests__/AdminSettings.refresh.test.tsx`, remplacer le mock d'API (lignes 10-18) :

```ts
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    adminGetClub: jest.fn(),
    adminUpdateClub: jest.fn().mockResolvedValue({}),
    uploadClubLogo: jest.fn(),
    uploadClubCover: jest.fn(),
  },
}));
```

par :

```ts
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    adminGetClub: jest.fn(),
    adminUpdateClub: jest.fn().mockResolvedValue({}),
    uploadClubLogo: jest.fn(),
    uploadClubCover: jest.fn(),
    adminGetSports: jest.fn().mockResolvedValue([]),
    getSports: jest.fn().mockResolvedValue([]),
    adminApplySportsBatch: jest.fn().mockResolvedValue([]),
  },
}));
```

- [ ] **Step 2: Lancer les deux fichiers de test, vérifier qu'ils échouent**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/AdminSettings.test.tsx __tests__/AdminSettings.refresh.test.tsx`
Expected: FAIL — les 2 nouveaux tests échouent (le batch n'est pas encore câblé, `<SettingsSports />` ne prend pas encore de props) ; les tests existants peuvent aussi échouer à la compilation TS des props de `SettingsSports`.

- [ ] **Step 3: Câbler la page**

Dans `frontend/app/admin/settings/page.tsx`, remplacer le bloc d'imports (lignes 1-18) :

```ts
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { api, ClubAdminDetail } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { PillTabs } from '@/components/ui/atoms';
import {
  SETTINGS_TABS, SettingsTabKey, parseTab, buildUpdateBody, isDirty,
} from '@/lib/adminSettings';
import { SetClubField } from '@/components/admin/settings/shared';
import { SaveBar } from '@/components/admin/settings/SaveBar';
import { SettingsIdentity } from '@/components/admin/settings/SettingsIdentity';
import { SettingsSports } from '@/components/admin/settings/SettingsSports';
import { SettingsBooking } from '@/components/admin/settings/SettingsBooking';
import { SettingsPricing } from '@/components/admin/settings/SettingsPricing';
import { SettingsCollect } from '@/components/admin/settings/SettingsCollect';
import { SettingsVisibility } from '@/components/admin/settings/SettingsVisibility';
```

par :

```ts
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { api, ClubAdminDetail, AdminClubSport, Sport } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { PillTabs } from '@/components/ui/atoms';
import {
  SETTINGS_TABS, SettingsTabKey, parseTab, buildUpdateBody, isDirty,
  SportsDraftItem, toSportsDraft, addSportDraft, toggleDurationDraft, sportsDirty, buildSportsBatchBody,
} from '@/lib/adminSettings';
import { SetClubField } from '@/components/admin/settings/shared';
import { SaveBar } from '@/components/admin/settings/SaveBar';
import { SettingsIdentity } from '@/components/admin/settings/SettingsIdentity';
import { SettingsSports } from '@/components/admin/settings/SettingsSports';
import { SettingsBooking } from '@/components/admin/settings/SettingsBooking';
import { SettingsPricing } from '@/components/admin/settings/SettingsPricing';
import { SettingsCollect } from '@/components/admin/settings/SettingsCollect';
import { SettingsVisibility } from '@/components/admin/settings/SettingsVisibility';
```

Remplacer le bloc d'état (lignes 29-41) :

```ts
  // Deux états : baseline serveur + brouillon édité. Le brouillon est dirty quand il diffère.
  const [server, setServer] = useState<ClubAdminDetail | null>(null);
  const [draft, setDraft] = useState<ClubAdminDetail | null>(null);
  const [saving, setSaving] = useState(false);
  // `error` = chargement/upload (bandeau haut) ; `saveError` = échec d'enregistrement (barre sticky).
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<SettingsTabKey>('identite');

  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
```

par :

```ts
  // Deux états : baseline serveur + brouillon édité. Le brouillon est dirty quand il diffère.
  const [server, setServer] = useState<ClubAdminDetail | null>(null);
  const [draft, setDraft] = useState<ClubAdminDetail | null>(null);
  // Sports (ClubSport) : même principe baseline/brouillon, modèle et endpoint distincts du Club.
  const [sportsServer, setSportsServer] = useState<AdminClubSport[] | null>(null);
  const [sportsDraft, setSportsDraft] = useState<SportsDraftItem[] | null>(null);
  const [sportsCatalog, setSportsCatalog] = useState<Sport[]>([]);
  const [saving, setSaving] = useState(false);
  // `error` = chargement/upload (bandeau haut) ; `saveError` = échec d'enregistrement (barre sticky).
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<SettingsTabKey>('identite');

  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
```

Remplacer `load()` (lignes 43-51) :

```ts
  const load = useCallback(async () => {
    if (!token || !clubId) return;
    try {
      setError(null);
      const c = await api.adminGetClub(clubId, token);
      setServer(c);
      setDraft(c);
    } catch (e) { setError((e as Error).message); }
  }, [token, clubId]);
```

par :

```ts
  const load = useCallback(async () => {
    if (!token || !clubId) return;
    try {
      setError(null);
      const [c, sports, catalog] = await Promise.all([
        api.adminGetClub(clubId, token),
        api.adminGetSports(clubId, token),
        api.getSports(),
      ]);
      setServer(c);
      setDraft(c);
      setSportsServer(sports);
      setSportsDraft(toSportsDraft(sports));
      setSportsCatalog(catalog);
    } catch (e) { setError((e as Error).message); }
  }, [token, clubId]);
```

Remplacer le bloc `set`/`dirty` (lignes 64-71) :

```ts
  // Éditer efface un éventuel échec d'enregistrement et le flash de succès.
  const set: SetClubField = (k, v) => {
    setSaveError(null);
    setJustSaved(false);
    setDraft((c) => (c ? { ...c, [k]: v } : c));
  };

  const dirty = !!server && !!draft && isDirty(server, draft);
```

par :

```ts
  // Éditer efface un éventuel échec d'enregistrement et le flash de succès.
  const set: SetClubField = (k, v) => {
    setSaveError(null);
    setJustSaved(false);
    setDraft((c) => (c ? { ...c, [k]: v } : c));
  };

  const addSport = (sportId: string) => {
    setSaveError(null);
    setJustSaved(false);
    setSportsDraft((items) => (items ? addSportDraft(items, sportId) : items));
  };
  const toggleSportDuration = (sportId: string, min: number) => {
    setSaveError(null);
    setJustSaved(false);
    setSportsDraft((items) => {
      if (!items) return items;
      const sport = sportsCatalog.find((s) => s.id === sportId);
      return toggleDurationDraft(items, sportId, sport?.defaultDurationsMin ?? [], min);
    });
  };

  const dirty = !!server && !!draft && !!sportsServer && !!sportsDraft &&
    (isDirty(server, draft) || sportsDirty(sportsServer, sportsDraft));
```

Remplacer `save()`/`cancel()` (lignes 113-126) :

```ts
  const save = async () => {
    if (!token || !clubId || !draft) return;
    setSaving(true);
    try {
      setSaveError(null);
      await api.adminUpdateClub(clubId, buildUpdateBody(draft), token);
      setServer(draft);           // le brouillon devient la nouvelle baseline → barre passe en « Enregistré ✓ »
      setJustSaved(true);
      refreshClub();              // rafraîchit le club partagé (réservation, tarifs…)
    } catch (e) { setSaveError((e as Error).message); }
    finally { setSaving(false); }
  };

  const cancel = () => { setDraft(server); setSaveError(null); setJustSaved(false); };
```

par :

```ts
  const save = async () => {
    if (!token || !clubId || !server || !draft || !sportsServer || !sportsDraft) return;
    setSaving(true);
    try {
      setSaveError(null);
      const clubIsDirty = isDirty(server, draft);
      const sportsIsDirty = sportsDirty(sportsServer, sportsDraft);
      const errors: string[] = [];
      const tasks: Promise<void>[] = [];

      if (clubIsDirty) {
        tasks.push(
          api.adminUpdateClub(clubId, buildUpdateBody(draft), token).then(() => {
            setServer(draft);   // le brouillon devient la nouvelle baseline
            refreshClub();       // rafraîchit le club partagé (réservation, tarifs…)
          }).catch((e) => { errors.push((e as Error).message); }),
        );
      }
      if (sportsIsDirty) {
        const items = buildSportsBatchBody(sportsServer, sportsDraft);
        tasks.push(
          api.adminApplySportsBatch(clubId, items, token).then((updated) => {
            setSportsServer(updated);
            setSportsDraft(toSportsDraft(updated));
          }).catch((e) => { errors.push((e as Error).message); }),
        );
      }

      await Promise.all(tasks);
      // Chacun réussit/échoue indépendamment (Club vs ClubSport) : le flash de succès
      // n'apparaît que si tout ce qui a été tenté a réussi.
      if (errors.length > 0) setSaveError(errors.join(' · '));
      else setJustSaved(true);
    } finally { setSaving(false); }
  };

  const cancel = () => {
    setDraft(server);
    setSportsDraft(sportsServer ? toSportsDraft(sportsServer) : null);
    setSaveError(null);
    setJustSaved(false);
  };
```

Enfin, remplacer le rendu (lignes 128-149, du garde de chargement jusqu'au rendu de `SettingsSports`) :

```ts
  if (!draft) {
    // Pas encore de brouillon : chargement en cours, ou échec de chargement (on montre l'erreur).
    return <div style={{ fontFamily: th.fontUI, color: error ? th.text : th.textFaint, padding: '32px 0' }}>{error ?? 'Chargement…'}</div>;
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 20px', color: th.text }}>Réglages du club</h1>

      {error && (
        <div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>
      )}

      <div className="sp-scroll-x" style={{ marginBottom: 20 }}>
        <PillTabs options={SETTINGS_TABS.map((t) => ({ value: t.key, label: t.label }))} value={tab} onChange={changeTab} />
      </div>

      {tab === 'identite' && (
        <SettingsIdentity club={draft} set={set} uploading={uploading}
          logoInputRef={logoInputRef} coverInputRef={coverInputRef} pickLogo={pickLogo} pickCover={pickCover} />
      )}
      {tab === 'sports' && <SettingsSports />}
```

par :

```ts
  if (!draft || !sportsDraft) {
    // Pas encore de brouillon (Club ou Sports) : chargement en cours, ou échec (on montre l'erreur).
    return <div style={{ fontFamily: th.fontUI, color: error ? th.text : th.textFaint, padding: '32px 0' }}>{error ?? 'Chargement…'}</div>;
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 20px', color: th.text }}>Réglages du club</h1>

      {error && (
        <div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>
      )}

      <div className="sp-scroll-x" style={{ marginBottom: 20 }}>
        <PillTabs options={SETTINGS_TABS.map((t) => ({ value: t.key, label: t.label }))} value={tab} onChange={changeTab} />
      </div>

      {tab === 'identite' && (
        <SettingsIdentity club={draft} set={set} uploading={uploading}
          logoInputRef={logoInputRef} coverInputRef={coverInputRef} pickLogo={pickLogo} pickCover={pickCover} />
      )}
      {tab === 'sports' && (
        <SettingsSports catalog={sportsCatalog} items={sportsDraft} onAdd={addSport} onToggleDuration={toggleSportDuration} />
      )}
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/AdminSettings.test.tsx __tests__/AdminSettings.refresh.test.tsx __tests__/SettingsSports.test.tsx __tests__/adminSettings.test.ts`
Expected: PASS (les 4 fichiers)

- [ ] **Step 5: Type-check frontend**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 6: Commit**

```bash
git add frontend/app/admin/settings/page.tsx frontend/__tests__/AdminSettings.test.tsx frontend/__tests__/AdminSettings.refresh.test.tsx
git commit -m "$(cat <<'EOF'
feat(sports): onglet Sports en enregistrement differe (SaveBar unique)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Vérification finale

- [ ] **Step 1: Suite backend complète (au moins les fichiers touchés)**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts src/routes/__tests__/admin.sports.routes.test.ts`
Expected: PASS

- [ ] **Step 2: Suite frontend complète (au moins les fichiers touchés)**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/adminSettings.test.ts __tests__/SettingsSports.test.tsx __tests__/AdminSettings.test.tsx __tests__/AdminSettings.refresh.test.tsx`
Expected: PASS

- [ ] **Step 3: Type-check des deux côtés**

Run: `cd backend && node node_modules/typescript/bin/tsc --noEmit`
Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 4: Vérification visuelle manuelle (optionnelle mais recommandée)**

Démarrer la stack (`start.ps1` ou `npm run dev` dans `backend/` et `frontend/`), ouvrir `/admin/settings?tab=sports`, ajouter un sport et cocher une durée : vérifier que la barre du bas passe en « Modifications non enregistrées », que rien n'apparaît en base tant qu'on n'a pas cliqué Enregistrer, qu'Annuler défait tout, et qu'Enregistrer applique bien (rafraîchir la page pour confirmer la persistance).

**Note pour l'engineer qui exécute ce plan (mise à jour du CLAUDE.md, à faire séparément, hors plan) :** une fois ces 6 tâches vertes, la ligne CLAUDE.md « ⚠️ Modèle d'enregistrement différent, assumé... 5 onglets à enregistrement différé + 1 à enregistrement immédiat » (section « Réglages du club en onglets... ») est devenue **fausse** — les 6 onglets sont désormais à enregistrement différé. Ne pas l'éditer dans le cadre de ce plan ; le signaler à l'utilisateur une fois l'implémentation terminée.
