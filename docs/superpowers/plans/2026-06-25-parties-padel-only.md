# Parties ouvertes réservées au padel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limiter les « parties ouvertes » (matchmaking) au seul padel — onglet, liste, création — tout en gardant le classement multi-sport.

**Architecture :** Une règle en dur, sans réglage admin. Source de vérité = le filtre backend sur `listOpenMatches`. Le frontend en découle (onglet masqué, page redirigée, option de création cachée). Plus une correction de bug : les surfaces « parties » lisent le niveau **padel** et non le sport préféré. Zéro migration.

**Tech Stack :** Backend Express 5 + Prisma 7 (Jest + prismaMock). Frontend Next.js 16 + React 19 (Jest + React Testing Library).

**Spec :** `docs/superpowers/specs/2026-06-25-parties-padel-only-design.md`

---

## Carte des fichiers

| Fichier | Rôle | Action |
|---|---|---|
| `frontend/lib/sport.ts` | Helper pur `clubHasPadel` | **Créer** |
| `frontend/__tests__/sport.test.ts` | Tests du helper | **Créer** |
| `frontend/components/ClubNav.tsx` | Onglet « Parties » gaté padel | Modifier (l.35) |
| `frontend/app/parties/page.tsx` | Garde d'accès direct (redirect) | Modifier |
| `backend/src/services/openMatch.service.ts` | Filtre padel sur la liste | Modifier (l.56) |
| `backend/src/services/__tests__/openMatch.service.test.ts` | Test du filtre | Modifier |
| `frontend/components/openmatch/OpenMatches.tsx` | Niveau padel | Modifier (l.57) |
| `frontend/components/ClubHouse.tsx` | Niveau padel | Modifier (l.83) |
| `frontend/__tests__/OpenMatches.test.tsx` | Assertion niveau padel | Modifier |
| `frontend/components/BookingModal.tsx` | Cacher « Partie ouverte » hors padel | Modifier |
| `frontend/__tests__/BookingModal.test.tsx` | Test visibilité par sport | Modifier |
| `backend/src/services/reservation.service.ts` | Garde `OPEN_MATCH_PADEL_ONLY` | Modifier (l.325-364) |
| `backend/src/routes/reservations.ts` | Code erreur → 400 | Modifier (l.26+) |
| `backend/src/services/__tests__/reservation.service.test.ts` | Test de la garde | Modifier |

---

## Task 1 : Helper `clubHasPadel`

**Files:**
- Create: `frontend/lib/sport.ts`
- Test: `frontend/__tests__/sport.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/sport.test.ts` :

```ts
import { clubHasPadel, PADEL_KEY } from '../lib/sport';

describe('clubHasPadel', () => {
  it('vrai si un sport du club a la clé padel', () => {
    expect(clubHasPadel({ clubSports: [{ sport: { key: 'padel' } }] })).toBe(true);
  });

  it('vrai sur un club multi-sport contenant le padel', () => {
    expect(clubHasPadel({ clubSports: [{ sport: { key: 'tennis' } }, { sport: { key: 'padel' } }] })).toBe(true);
  });

  it('faux si aucun sport padel', () => {
    expect(clubHasPadel({ clubSports: [{ sport: { key: 'tennis' } }, { sport: { key: 'squash' } }] })).toBe(false);
  });

  it('faux si clubSports absent ou vide', () => {
    expect(clubHasPadel({})).toBe(false);
    expect(clubHasPadel({ clubSports: [] })).toBe(false);
  });

  it('expose la constante PADEL_KEY', () => {
    expect(PADEL_KEY).toBe('padel');
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run (depuis `frontend/`) : `npx jest sport.test.ts`
Expected : FAIL — `Cannot find module '../lib/sport'`.

- [ ] **Step 3 : Implémenter le helper**

Créer `frontend/lib/sport.ts` :

```ts
// Détection « le club propose-t-il le padel ? ». Les parties ouvertes (matchmaking)
// sont réservées au padel ; ce helper pilote l'onglet, la garde de page et la création.
export const PADEL_KEY = 'padel';

export const clubHasPadel = (club: { clubSports?: { sport: { key: string } }[] }): boolean =>
  club.clubSports?.some((cs) => cs.sport.key === PADEL_KEY) ?? false;
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run : `npx jest sport.test.ts`
Expected : PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/sport.ts frontend/__tests__/sport.test.ts
git commit -m "feat(parties): helper clubHasPadel (parties padel-only)"
```

---

## Task 2 : Onglet « Parties » gaté sur le padel

**Files:**
- Modify: `frontend/components/ClubNav.tsx` (import + ligne 35)

> Logique couverte par le test unitaire de Task 1 (`clubHasPadel`). ClubNav est de la pure présentation câblée sur ce helper ; vérification par typecheck/lint (pas de test d'intégration ClubNav dans le repo).

- [ ] **Step 1 : Importer le helper**

Dans `frontend/components/ClubNav.tsx`, après la ligne `import { Icon, IconName } from '@/components/ui/Icon';` :

```ts
import { clubHasPadel } from '@/lib/sport';
```

- [ ] **Step 2 : Gater l'onglet Parties**

Remplacer la ligne 35 :

```tsx
    { label: 'Parties', href: '/parties', icon: 'users', match: (p) => p.startsWith('/parties'), show: ready && !!token },
```

par :

```tsx
    { label: 'Parties', href: '/parties', icon: 'users', match: (p) => p.startsWith('/parties'), show: ready && !!token && clubHasPadel(club) },
```

- [ ] **Step 3 : Vérifier le typecheck**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : aucune erreur sur `ClubNav.tsx`.

- [ ] **Step 4 : Commit**

```bash
git add frontend/components/ClubNav.tsx
git commit -m "feat(parties): onglet Parties masqué sur un club sans padel"
```

---

## Task 3 : Garde d'accès direct `/parties`

**Files:**
- Modify: `frontend/app/parties/page.tsx`

> Empêche une page orpheline si un membre d'un club sans padel ouvre `/parties` via bookmark/lien profond.

- [ ] **Step 1 : Ajouter la redirection**

Remplacer tout le contenu de `frontend/app/parties/page.tsx` par :

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { clubHasPadel } from '@/lib/sport';
import { OpenMatches } from '@/components/openmatch/OpenMatches';

// /parties = découverte des parties ouvertes du club (réservé aux membres).
// Padel uniquement : un club sans padel n'a pas d'onglet Parties ; un accès direct
// (bookmark / lien profond) est redirigé vers l'accueil du club.
export default function PartiesPage() {
  const { club, loading } = useClub();
  const { th } = useTheme();
  const router = useRouter();

  const noPadel = !!club && !clubHasPadel(club);
  useEffect(() => { if (noPadel) router.replace('/'); }, [noPadel, router]);

  if (loading) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (!club) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textMute }}>Club introuvable.</div>;
  if (noPadel) return <div style={{ minHeight: '100vh', background: th.bg }} />;
  return <OpenMatches club={club} />;
}
```

- [ ] **Step 2 : Vérifier le typecheck**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add frontend/app/parties/page.tsx
git commit -m "feat(parties): redirige /parties vers l'accueil si le club n'a pas de padel"
```

---

## Task 4 : Filtre padel sur la liste backend

**Files:**
- Modify: `backend/src/services/openMatch.service.ts:56`
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1 : Mettre à jour le test existant + ajouter un test dédié**

Dans `backend/src/services/__tests__/openMatch.service.test.ts`, remplacer l'assertion `where` du test « liste les parties PUBLIC/CONFIRMED… » (ligne ~51) :

```ts
      expect(where).toEqual(expect.objectContaining({ visibility: 'PUBLIC', status: 'CONFIRMED', resource: { clubId: 'club-demo' } }));
```

par :

```ts
      expect(where).toEqual(expect.objectContaining({
        visibility: 'PUBLIC', status: 'CONFIRMED',
        resource: { clubId: 'club-demo', clubSport: { sport: { key: 'padel' } } },
      }));
```

Puis, juste après ce test (dans le `describe('listOpenMatches', …)`), ajouter :

```ts
    it('ne remonte que les parties padel (filtre clubSport.sport.key)', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([] as any);
      await service.listOpenMatches('club-demo', 'viewer');
      const where = (prismaMock.reservation.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.resource.clubSport.sport.key).toBe('padel');
    });
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run (depuis `backend/`) : `npx jest openMatch.service`
Expected : FAIL — le `where` actuel vaut `resource: { clubId: 'club-demo' }`, sans `clubSport`.

- [ ] **Step 3 : Ajouter le filtre padel**

Dans `backend/src/services/openMatch.service.ts`, méthode `listOpenMatches`, remplacer la ligne 56 :

```ts
        resource: { clubId: club.id },
```

par :

```ts
        resource: { clubId: club.id, clubSport: { sport: { key: 'padel' } } },
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run : `npx jest openMatch.service`
Expected : PASS (toute la suite `OpenMatchService`).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(parties): listOpenMatches ne remonte que les parties padel"
```

---

## Task 5 : Niveau padel sur les surfaces « parties »

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx:57`
- Modify: `frontend/components/ClubHouse.tsx:83`
- Test: `frontend/__tests__/OpenMatches.test.tsx`

> `GET /api/me/rating` sans paramètre renvoie le niveau du **sport préféré**. Les parties étant padel-only, on demande explicitement le niveau padel.

- [ ] **Step 1 : Ajouter l'assertion qui échoue**

Dans `frontend/__tests__/OpenMatches.test.tsx`, ajouter ce test à la fin du `describe('OpenMatches', …)` :

```tsx
  it('lit le niveau PADEL (pas le sport préféré)', async () => {
    mocked.getOpenMatches.mockResolvedValue([] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);
    await waitFor(() => expect(mocked.getMyRating).toHaveBeenCalledWith('abc', 'padel'));
  });
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run (depuis `frontend/`) : `npx jest OpenMatches.test`
Expected : FAIL — `getMyRating` est appelé avec `('abc')`, pas `('abc', 'padel')`.

- [ ] **Step 3 : Passer 'padel' dans OpenMatches**

Dans `frontend/components/openmatch/OpenMatches.tsx`, ligne 57, remplacer :

```ts
    api.getMyRating(token).then((r) => setMyLevel(r?.level ?? null)).catch(() => {});
```

par :

```ts
    api.getMyRating(token, 'padel').then((r) => setMyLevel(r?.level ?? null)).catch(() => {});
```

- [ ] **Step 4 : Passer 'padel' dans ClubHouse (même correction)**

Dans `frontend/components/ClubHouse.tsx`, ligne 83, remplacer :

```ts
  useEffect(() => { if (!token) return; api.getMyRating(token).then((r) => setMyLevel(r?.level ?? null)).catch(() => {}); }, [token]);
```

par :

```ts
  useEffect(() => { if (!token) return; api.getMyRating(token, 'padel').then((r) => setMyLevel(r?.level ?? null)).catch(() => {}); }, [token]);
```

- [ ] **Step 5 : Lancer les tests, vérifier le succès**

Run : `npx jest OpenMatches.test ClubHouse`
Expected : PASS — la nouvelle assertion passe et les suites `OpenMatches` / `ClubHouse` restent vertes.

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/openmatch/OpenMatches.tsx frontend/components/ClubHouse.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "fix(parties): les recos/filtres parties lisent le niveau padel"
```

---

## Task 6 : Cacher « Partie ouverte » sur un court non-padel

**Files:**
- Modify: `frontend/components/BookingModal.tsx` (const `isPadel` + bloc visibilité l.476-503)
- Test: `frontend/__tests__/BookingModal.test.tsx`

- [ ] **Step 1 : Ajouter les tests qui échouent**

Dans `frontend/__tests__/BookingModal.test.tsx`, ajouter ce bloc à la fin du `describe('BookingModal — page unique', …)` :

```tsx
  it('propose « Partie ouverte » sur un terrain padel multi-joueurs', async () => {
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
    await screen.findByText(/Créneau bloqué/);
    expect(await screen.findByText('Partie ouverte')).toBeInTheDocument();
  });

  it('cache « Partie ouverte » sur un terrain non-padel', async () => {
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'tennis' });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.queryByText('Partie ouverte')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run (depuis `frontend/`) : `npx jest BookingModal.test`
Expected : FAIL sur « cache … non-padel » — « Partie ouverte » est rendu quel que soit le sport.

- [ ] **Step 3 : Définir `isPadel`**

Dans `frontend/components/BookingModal.tsx`, juste après la ligne 186 (`const showPartners = !!slug && cap > 1;`), ajouter :

```ts
  // Parties ouvertes = padel uniquement → l'option « Partie ouverte » n'est offerte que sur un court padel.
  const isPadel = sportKey === 'padel';
```

- [ ] **Step 4 : Gater le bloc visibilité**

Toujours dans `BookingModal.tsx`, remplacer le début du bloc (lignes 476-478) :

```tsx
                  <div style={{ marginTop: 14 }}>
                    <Segmented<'PRIVATE' | 'PUBLIC'> value={visibility} onChange={setVisibility}
                      options={[{ value: 'PRIVATE', label: 'Partie privée' }, { value: 'PUBLIC', label: 'Partie ouverte' }]} />
```

par :

```tsx
                  {isPadel && (
                  <div style={{ marginTop: 14 }}>
                    <Segmented<'PRIVATE' | 'PUBLIC'> value={visibility} onChange={setVisibility}
                      options={[{ value: 'PRIVATE', label: 'Partie privée' }, { value: 'PUBLIC', label: 'Partie ouverte' }]} />
```

Puis fermer la condition : remplacer la fin du bloc (lignes 501-505) :

```tsx
                      </div>
                    )}
                  </div>

                  {nbPlayers > 1 && (
```

par :

```tsx
                      </div>
                    )}
                  </div>
                  )}

                  {nbPlayers > 1 && (
```

> Effet : sur un court non-padel, `visibility` reste `'PRIVATE'` (valeur par défaut), donc `persistHoldSetup` n'envoie jamais `PUBLIC`.

- [ ] **Step 5 : Lancer les tests, vérifier le succès**

Run : `npx jest BookingModal.test`
Expected : PASS (toute la suite BookingModal, y compris les 2 nouveaux cas).

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/BookingModal.tsx frontend/__tests__/BookingModal.test.tsx
git commit -m "feat(parties): option « Partie ouverte » réservée aux courts padel"
```

---

## Task 7 : Défense backend `OPEN_MATCH_PADEL_ONLY`

**Files:**
- Modify: `backend/src/services/reservation.service.ts:335-364` (`applyHoldSetup`)
- Modify: `backend/src/routes/reservations.ts` (table des codes d'erreur)
- Test: `backend/src/services/__tests__/reservation.service.test.ts`

- [ ] **Step 1 : Ajouter les tests qui échouent**

Dans `backend/src/services/__tests__/reservation.service.test.ts`, mettre à jour `baseReservation` du `describe('applyHoldSetup', …)` (ligne ~2068) pour inclure le sport (padel par défaut), afin que les tests PUBLIC existants restent verts :

```ts
      resource: { clubId: 'club-1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
```

Puis ajouter ce test dans le même `describe` :

```ts
    it('refuse une partie ouverte (PUBLIC) sur un court non-padel', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        resource: { clubId: 'club-1', attributes: { format: 'double' }, clubSport: { sport: { key: 'tennis' } } },
      } as any);
      prismaMock.clubMembership.findMany.mockResolvedValue([] as any);
      await expect(
        service.applyHoldSetup('res-1', 'user-1', { visibility: 'PUBLIC' }),
      ).rejects.toThrow('OPEN_MATCH_PADEL_ONLY');
    });

    it('autorise une partie privée (PRIVATE) sur un court non-padel', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        resource: { clubId: 'club-1', attributes: { format: 'double' }, clubSport: { sport: { key: 'tennis' } } },
      } as any);
      prismaMock.clubMembership.findMany.mockResolvedValue([] as any);
      const tx = {
        reservationParticipant: { deleteMany: jest.fn(), createMany: jest.fn() },
        reservation: { update: jest.fn().mockResolvedValue({ id: 'res-1', status: 'PENDING' }) },
      };
      (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(tx));
      await expect(
        service.applyHoldSetup('res-1', 'user-1', { visibility: 'PRIVATE' }),
      ).resolves.toMatchObject({ id: 'res-1' });
    });
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run (depuis `backend/`) : `npx jest reservation.service -t applyHoldSetup`
Expected : FAIL — `applyHoldSetup` n'émet pas encore `OPEN_MATCH_PADEL_ONLY`.

- [ ] **Step 3 : Sélectionner la clé sport + ajouter la garde**

Dans `backend/src/services/reservation.service.ts`, méthode `applyHoldSetup`, remplacer le `findUnique` (lignes 335-338) :

```ts
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { resource: { select: { clubId: true, attributes: true } } },
    });
```

par :

```ts
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { resource: { select: { clubId: true, attributes: true, clubSport: { select: { sport: { select: { key: true } } } } } } },
    });
```

Puis, juste après le contrôle d'expiration (après la ligne 344 `if (age > HOLD_EXPIRY_MS) throw new Error('RESERVATION_NOT_PENDING');`), ajouter :

```ts
    // Parties ouvertes = padel uniquement : pas de visibilité PUBLIC sur un autre sport.
    if (setup.visibility === 'PUBLIC' && reservation.resource.clubSport.sport.key !== 'padel') {
      throw new Error('OPEN_MATCH_PADEL_ONLY');
    }
```

- [ ] **Step 4 : Mapper le code d'erreur en 400**

Dans `backend/src/routes/reservations.ts`, dans la table des codes d'erreur (à partir de la ligne 26, à côté de `VALIDATION_ERROR: 400`), ajouter :

```ts
  OPEN_MATCH_PADEL_ONLY:    400,
```

- [ ] **Step 5 : Lancer les tests, vérifier le succès**

Run : `npx jest reservation.service`
Expected : PASS — `applyHoldSetup` rejette PUBLIC non-padel, accepte PRIVATE non-padel, et les cas PUBLIC padel existants restent verts.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/routes/reservations.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(parties): applyHoldSetup refuse une partie ouverte hors padel (OPEN_MATCH_PADEL_ONLY)"
```

---

## Vérification finale

- [ ] **Backend** — depuis `backend/` : `npx jest` → toute la suite verte.
- [ ] **Frontend** — depuis `frontend/` : `npx jest` → toute la suite verte.
- [ ] **Typecheck frontend** — depuis `frontend/` : `npx tsc --noEmit` → aucune erreur.
- [ ] **Fumée manuelle** (optionnel) : sur un club **padel+tennis**, l'onglet Parties est visible, la liste ne montre que des parties padel, et « Partie ouverte » n'apparaît que sur un court padel ; sur un club **tennis-only**, l'onglet Parties est absent et `/parties` redirige vers `/`.

---

## Notes

- **Aucune migration** — zéro changement de schéma Prisma.
- **Classement inchangé** : `Leaderboard.tsx` garde son sélecteur de sport multi-sport (visible seulement là où l'onglet Parties l'est, donc absent d'un club sans padel — comportement assumé).
- La clé du sport padel est `'padel'` (constante `PADEL_KEY` côté front ; littéral `'padel'` côté back, cohérent avec `seed.ts`).
