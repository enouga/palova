# Système de niveau réservé au padel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le limiteur « Limiter le niveau des joueurs » d'une *Partie ouverte* ne doit s'afficher et ne stocker une fourchette de niveau que pour le padel (grille Padel Magazine).

**Architecture:** Une règle pure et unique `sportHasLevels(sportKey)` (= `sportKey === 'padel'`), dupliquée à l'identique côté front (`frontend/lib/level.ts`) et back (`backend/src/services/rating/level.ts`). Le front l'utilise pour cacher le bloc niveau dans `BookingModal` ; le back l'utilise comme garde de défense en profondeur dans `applyHoldSetup` qui force `targetLevelMin/Max = null` hors padel.

**Tech Stack:** TypeScript, React 19, Next.js 16 (front, Jest + RTL) ; Express 5, Prisma 7 (back, Jest + prismaMock).

**Contexte spec :** `docs/superpowers/specs/2026-06-25-niveau-reserve-au-padel-design.md`.

**Pré-requis env (Windows/OneDrive) :** si une désync OneDrive a amputé `node_modules`, faire `npm install` + `npx prisma generate` dans `backend/` avant de lancer les tests backend. Aucune migration dans ce plan.

---

## Vue d'ensemble des fichiers

| Fichier | Rôle | Action |
|---|---|---|
| `backend/src/services/rating/level.ts` | Module pur du référentiel niveaux | **Modifier** — ajouter `LEVEL_SPORT_KEY` + `sportHasLevels` |
| `backend/src/services/rating/__tests__/level.test.ts` | Tests du module | **Modifier** — bloc `sportHasLevels` |
| `backend/src/services/reservation.service.ts` | `applyHoldSetup` | **Modifier** — include sport + garde niveau |
| `backend/src/services/__tests__/reservation.service.test.ts` | Tests service | **Modifier** — `baseReservation` + 1 cas non-padel |
| `frontend/lib/level.ts` | Miroir d'affichage du référentiel | **Modifier** — `LEVEL_SPORT_KEY` + `sportHasLevels` |
| `frontend/__tests__/level.test.ts` | Test du helper front | **Créer** |
| `frontend/components/BookingModal.tsx` | Modale de réservation | **Modifier** — gate sport sur le bloc niveau |
| `frontend/__tests__/BookingModal.test.tsx` | Tests de la modale | **Modifier** — 1 cas existant + 3 nouveaux |

L'ordre des tâches garantit qu'après **chaque** commit la suite concernée est verte.

---

## Task 1 : Helper backend `sportHasLevels`

**Files:**
- Modify: `backend/src/services/rating/level.ts`
- Test: `backend/src/services/rating/__tests__/level.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `backend/src/services/rating/__tests__/level.test.ts`, ajouter `sportHasLevels` à l'import existant (ligne 1-4) et ajouter un bloc `describe` à la fin du fichier.

Remplacer la ligne d'import :
```ts
import {
  ratingToLevel, levelToRating, isProvisional, namedTier, TIERS,
  DEFAULT_RD, SKIP_DEFAULT_LEVEL,
} from '../level';
```
par :
```ts
import {
  ratingToLevel, levelToRating, isProvisional, namedTier, TIERS,
  DEFAULT_RD, SKIP_DEFAULT_LEVEL, sportHasLevels,
} from '../level';
```

Ajouter à la fin du fichier :
```ts
describe('sportHasLevels', () => {
  it('padel a des niveaux', () => expect(sportHasLevels('padel')).toBe(true));
  it('tennis n a pas de niveaux', () => expect(sportHasLevels('tennis')).toBe(false));
  it('sport indéfini → pas de niveaux', () => expect(sportHasLevels(undefined)).toBe(false));
  it('null → pas de niveaux', () => expect(sportHasLevels(null)).toBe(false));
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run (dans `backend/`) : `npx jest src/services/rating/__tests__/level.test.ts -t sportHasLevels`
Expected : FAIL — `sportHasLevels is not a function` (ou erreur de compilation TS « no exported member »).

- [ ] **Step 3 : Implémenter le helper**

Dans `backend/src/services/rating/level.ts`, ajouter à la fin du fichier (après `namedTier`) :
```ts
/** Clé du sport qui porte le système de niveau (grille Padel Magazine). */
export const LEVEL_SPORT_KEY = 'padel';

/** Ce sport utilise-t-il le système de niveau ? (padel uniquement) */
export function sportHasLevels(sportKey?: string | null): boolean {
  return sportKey === LEVEL_SPORT_KEY;
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run : `npx jest src/services/rating/__tests__/level.test.ts -t sportHasLevels`
Expected : PASS (4 assertions).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/rating/level.ts backend/src/services/rating/__tests__/level.test.ts
git commit -m "feat(niveau): helper backend sportHasLevels (padel only)"
```

---

## Task 2 : Garde backend dans `applyHoldSetup`

`applyHoldSetup` doit lire la clé du sport du terrain et forcer `targetLevelMin/Max = null` quand le sport n'a pas de niveaux.

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (imports + `applyHoldSetup`, ~ lignes 325-364)
- Test: `backend/src/services/__tests__/reservation.service.test.ts` (bloc `applyHoldSetup`, ~ lignes 2064-2122)

- [ ] **Step 1 : Adapter le test existant + écrire le cas non-padel**

Le `baseReservation` du bloc `applyHoldSetup` n'a pas de `clubSport` ; après la garde, son sport serait `undefined` → niveau strippé → le cas de régression « met à jour visibilité/niveau » casserait. Il faut donc lui donner un sport padel, puis ajouter un cas tennis.

Dans `backend/src/services/__tests__/reservation.service.test.ts`, remplacer la déclaration de `baseReservation` (dans `describe('applyHoldSetup', …)`) :
```ts
    const baseReservation = {
      id: 'res-1', userId: 'user-1', status: 'PENDING',
      createdAt: new Date(), totalPrice: 20,
      resource: { clubId: 'club-1', attributes: { format: 'double' } },
    };
```
par :
```ts
    const baseReservation = {
      id: 'res-1', userId: 'user-1', status: 'PENDING',
      createdAt: new Date(), totalPrice: 20,
      resource: { clubId: 'club-1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
    };
```

Puis ajouter ce test juste après le cas `'remplace les participants et met à jour visibilité/niveau'` (avant `'rejette TOO_MANY_PLAYERS…'`) :
```ts
    it('hors padel : ignore la fourchette de niveau (targetLevel forcé à null)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        resource: { clubId: 'club-1', attributes: { format: 'double' }, clubSport: { sport: { key: 'tennis' } } },
      } as any);
      prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'user-2' }] as any);
      const tx = {
        reservationParticipant: { deleteMany: jest.fn(), createMany: jest.fn() },
        reservation: { update: jest.fn().mockResolvedValue({ id: 'res-1', status: 'PENDING' }) },
      };
      (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(tx));

      await service.applyHoldSetup('res-1', 'user-1', {
        partnerUserIds: ['user-2'], visibility: 'PUBLIC',
        targetLevelMin: 3, targetLevelMax: 5,
      });

      expect(tx.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'res-1' },
        data: expect.objectContaining({ visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null }),
      }));
    });
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run (dans `backend/`) : `npx jest src/services/__tests__/reservation.service.test.ts -t applyHoldSetup`
Expected : le nouveau cas tennis FAIL (le service persiste encore `targetLevelMin: 3, targetLevelMax: 5` au lieu de `null`). Le cas padel de régression reste vert.

- [ ] **Step 3 : Implémenter la garde**

Dans `backend/src/services/reservation.service.ts` :

(a) Ajouter l'import en tête, après la ligne 17 (`import { HOLD_TTL_SECONDS } from './holdWindow';`) :
```ts
import { sportHasLevels } from './rating/level';
```

(b) Dans `applyHoldSetup`, étendre l'`include` du `findUnique` (actuellement `include: { resource: { select: { clubId: true, attributes: true } } },`) pour récupérer la clé du sport :
```ts
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: {
          select: {
            clubId: true,
            attributes: true,
            clubSport: { select: { sport: { select: { key: true } } } },
          },
        },
      },
    });
```

(c) Juste après le calcul de `priceCents` (ligne `const priceCents = …`), ajouter le calcul de la garde niveau :
```ts
    // Le système de niveau (grille Padel Magazine) ne vaut que pour le padel :
    // hors padel, on ignore toute fourchette demandée.
    const levelOk = sportHasLevels(reservation.resource.clubSport?.sport?.key);
```

(d) Dans le `tx.reservation.update`, remplacer les deux lignes de niveau :
```ts
          targetLevelMin: setup.targetLevelMin ?? null,
          targetLevelMax: setup.targetLevelMax ?? null,
```
par :
```ts
          targetLevelMin: levelOk ? (setup.targetLevelMin ?? null) : null,
          targetLevelMax: levelOk ? (setup.targetLevelMax ?? null) : null,
```

- [ ] **Step 4 : Lancer pour vérifier que tout passe**

Run : `npx jest src/services/__tests__/reservation.service.test.ts -t applyHoldSetup`
Expected : PASS (cas padel + cas tennis + cas d'erreur existants).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(niveau): applyHoldSetup ignore la fourchette de niveau hors padel"
```

---

## Task 3 : Helper front `sportHasLevels`

**Files:**
- Modify: `frontend/lib/level.ts`
- Test: `frontend/__tests__/level.test.ts` (créer)

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/level.test.ts` :
```ts
import { sportHasLevels } from '../lib/level';

describe('sportHasLevels', () => {
  it('padel → true', () => expect(sportHasLevels('padel')).toBe(true));
  it('tennis → false', () => expect(sportHasLevels('tennis')).toBe(false));
  it('undefined → false', () => expect(sportHasLevels(undefined)).toBe(false));
  it('null → false', () => expect(sportHasLevels(null)).toBe(false));
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run (dans `frontend/`) : `npx jest __tests__/level.test.ts`
Expected : FAIL — module `../lib/level` n'exporte pas `sportHasLevels`.

- [ ] **Step 3 : Implémenter le helper**

Dans `frontend/lib/level.ts`, ajouter à la fin du fichier (après `tierForLevel`) :
```ts
/** Clé du sport qui porte le système de niveau (grille Padel Magazine). */
export const LEVEL_SPORT_KEY = 'padel';

/** Ce sport utilise-t-il le système de niveau ? (padel uniquement) */
export function sportHasLevels(sportKey?: string | null): boolean {
  return sportKey === LEVEL_SPORT_KEY;
}
```

- [ ] **Step 4 : Lancer pour vérifier que ça passe**

Run : `npx jest __tests__/level.test.ts`
Expected : PASS (4 assertions).

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/level.ts frontend/__tests__/level.test.ts
git commit -m "feat(niveau): helper front sportHasLevels (padel only)"
```

---

## Task 4 : Gate sport sur le bloc niveau de `BookingModal`

Le bloc « Limiter le niveau », l'envoi de `targetLevel*` et le préchargement `getMyRating` doivent être conditionnés à `sportHasLevels(sportKey)` en plus de `levelEnabled`.

**Files:**
- Modify: `frontend/components/BookingModal.tsx`
- Test: `frontend/__tests__/BookingModal.test.tsx`

- [ ] **Step 1 : Mettre à jour le test de régression + écrire les nouveaux**

Dans `frontend/__tests__/BookingModal.test.tsx` :

(a) Le test existant `'partie ouverte, niveau ON et limite active : applyHoldSetup avec targetLevelMin/Max'` rend la modale **sans** `sportKey` ; après la garde il faut un terrain padel. Remplacer, dans ce test, la ligne :
```ts
    renderModal({ slug: 'club-demo', maxPlayers: 4 });
```
par :
```ts
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
```

(b) Ajouter ces trois tests à la fin du `describe('BookingModal — page unique', …)` (avant l'accolade fermante du `describe`) :
```ts
  it('partie ouverte sur un terrain padel : le limiteur de niveau s affiche', async () => {
    mockClub = { levelSystemEnabled: true };
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
    fireEvent.click(await screen.findByRole('button', { name: /Partie ouverte/ }));
    expect(screen.getByText(/Limiter le niveau/)).toBeInTheDocument();
  });

  it('partie ouverte sur un terrain non-padel : pas de limiteur de niveau', async () => {
    mockClub = { levelSystemEnabled: true };
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'tennis' });
    fireEvent.click(await screen.findByRole('button', { name: /Partie ouverte/ }));
    expect(screen.queryByText(/Limiter le niveau/)).toBeNull();
  });

  it('partie ouverte non-padel : applyHoldSetup sans targetLevelMin/Max', async () => {
    mockClub = { levelSystemEnabled: true };
    (api.searchClubMembers as jest.Mock).mockResolvedValue([{ id: 'user-2', firstName: 'Marc', lastName: 'Dupont' }]);
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'tennis' });
    fireEvent.focus(await screen.findByPlaceholderText(/membres/i));
    fireEvent.mouseDown(await screen.findByText('Marc Dupont'));
    fireEvent.click(screen.getByRole('button', { name: /Partie ouverte/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(api.applyHoldSetup).toHaveBeenCalled());
    const setup = (api.applyHoldSetup as jest.Mock).mock.calls[0][2];
    expect(setup).not.toHaveProperty('targetLevelMin');
    expect(setup).not.toHaveProperty('targetLevelMax');
  });
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run (dans `frontend/`) : `npx jest __tests__/BookingModal.test.tsx`
Expected : le cas `'… terrain non-padel : pas de limiteur de niveau'` FAIL (le limiteur s'affiche encore pour tennis) et `'… non-padel : applyHoldSetup sans targetLevelMin/Max'` FAIL (targetLevel encore envoyé). Le cas padel passe.

- [ ] **Step 3 : Implémenter le gate sport**

Dans `frontend/components/BookingModal.tsx` :

(a) Ajouter l'import, à la suite des imports `@/lib/*` (par ex. après la ligne `import { loadLevelPref, saveLevelPref } from '@/lib/levelPrefs';`) :
```ts
import { sportHasLevels } from '@/lib/level';
```

(b) Juste après `const levelEnabled = useLevelSystemEnabled();`, ajouter le dérivé :
```ts
  // Le système de niveau (grille Padel Magazine) ne vaut que pour le padel.
  const levelForSport = levelEnabled && sportHasLevels(sportKey);
```

(c) Dans l'effet de préchargement de la fourchette (`useEffect` avec `loadLevelPref`/`getMyRating`), remplacer la garde :
```ts
    if (!showPartners || !levelEnabled) return;
```
par :
```ts
    if (!showPartners || !levelForSport) return;
```
et le tableau de dépendances :
```ts
  }, [showPartners, token, levelEnabled]); // eslint-disable-line react-hooks/exhaustive-deps
```
par :
```ts
  }, [showPartners, token, levelForSport]); // eslint-disable-line react-hooks/exhaustive-deps
```

(d) Dans `persistHoldSetup`, remplacer :
```ts
    const limiting = visibility === 'PUBLIC' && levelEnabled && levelLimited;
    await api.applyHoldSetup(reservation.id, token, {
      partnerUserIds: partners.map((p) => p.id),
      visibility,
      ...(visibility === 'PUBLIC' && levelEnabled
        ? { targetLevelMin: limiting ? levelMin : null, targetLevelMax: limiting ? levelMax : null }
        : {}),
    });
```
par :
```ts
    const limiting = visibility === 'PUBLIC' && levelForSport && levelLimited;
    await api.applyHoldSetup(reservation.id, token, {
      partnerUserIds: partners.map((p) => p.id),
      visibility,
      ...(visibility === 'PUBLIC' && levelForSport
        ? { targetLevelMin: limiting ? levelMin : null, targetLevelMax: limiting ? levelMax : null }
        : {}),
    });
```

(e) Dans le rendu de la section partenaires, remplacer la garde du bloc niveau :
```tsx
                    {visibility === 'PUBLIC' && levelEnabled && (
```
par :
```tsx
                    {visibility === 'PUBLIC' && levelForSport && (
```

- [ ] **Step 4 : Lancer pour vérifier que tout passe**

Run : `npx jest __tests__/BookingModal.test.tsx`
Expected : PASS (anciens cas + les 3 nouveaux). En particulier, le cas padel affiche toujours le limiteur, le cas tennis ne l'affiche plus, et `applyHoldSetup` n'a plus `targetLevel*` hors padel.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/BookingModal.tsx frontend/__tests__/BookingModal.test.tsx
git commit -m "feat(niveau): BookingModal masque le limiteur de niveau hors padel"
```

---

## Task 5 : Vérification finale + note CLAUDE.md

- [ ] **Step 1 : Suite backend complète (zone touchée)**

Run (dans `backend/`) : `npx jest src/services/rating src/services/__tests__/reservation.service.test.ts`
Expected : PASS.

- [ ] **Step 2 : Suite front complète (zone touchée)**

Run (dans `frontend/`) : `npx jest __tests__/level.test.ts __tests__/BookingModal.test.tsx`
Expected : PASS.

- [ ] **Step 3 : Lint des fichiers modifiés**

Run (dans `frontend/`) : `npx eslint components/BookingModal.tsx lib/level.ts`
Expected : aucune nouvelle erreur (les commentaires `eslint-disable-line` existants couvrent les deps d'effet).

- [ ] **Step 4 : Note d'évolution dans `CLAUDE.md`**

Sous la section « Réserver — sélecteur de sport multi-sports » (ou « modale de réservation en page unique »), ajouter une ligne d'évolution :
```markdown
> **Évolution (2026-06-25) — niveau réservé au padel :** le bloc « Limiter le niveau des joueurs » d'une *Partie ouverte* (BookingModal) ne s'affiche que pour le padel (grille Padel Magazine). Règle pure unique `sportHasLevels(sportKey) = (sportKey === 'padel')` — front `lib/level.ts`, miroir back `services/rating/level.ts`. Garde serveur dans `applyHoldSetup` (force `targetLevelMin/Max = null` hors padel, défense en profondeur). Hors périmètre (sûr) : `/parties` (les parties non-padel n'ont pas de fourchette → « ouvertes à tous »), profil déjà padel-only. Spec & plan : `docs/superpowers/{specs,plans}/2026-06-25-niveau-reserve-au-padel*`.
```

- [ ] **Step 5 : Commit**

```bash
git add CLAUDE.md
git commit -m "docs(niveau): note d'évolution — niveau réservé au padel"
```

---

## Self-Review (effectuée à l'écriture du plan)

- **Couverture spec :** Changement 1 (front BookingModal) → Task 4 ; Changement 2 (garde backend) → Task 2 ; règle centralisée → Tasks 1 & 3 ; tests des trois surfaces → présents dans chaque tâche ; note CLAUDE.md → Task 5. Aucun trou.
- **Pièges intégrés :** le test front existant `niveau ON` rendait sans `sportKey` → corrigé en Task 4 step 1(a) ; le `baseReservation` backend n'avait pas de `clubSport` → corrigé en Task 2 step 1.
- **Cohérence des noms :** `sportHasLevels` / `LEVEL_SPORT_KEY` identiques front et back ; `levelForSport` est le seul dérivé front ; `levelOk` le seul dérivé back. Pas de divergence de signatures.
- **Pas de placeholder :** tout le code est fourni intégral.
