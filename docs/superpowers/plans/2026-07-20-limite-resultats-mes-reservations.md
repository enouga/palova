# Limiter l'affichage de « Passées » sur Mes réservations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'onglet « Passées » de `/me/reservations` n'affiche que les 20 réservations les plus
récentes au départ, avec un bouton « Charger plus » pour révéler 20 de plus à chaque clic, au
lieu de monter toutes les cartes d'un coup (192 constatées).

**Architecture:** Le fetch réseau (`api.getMyReservations`) reste inchangé — il alimente aussi
le Calendrier, qui a besoin de tout l'historique pour naviguer dans les mois passés. Seul le
rendu de l'onglet « Passées » est fenêtré côté client (`Array.slice`), avec un garde-fou
serveur (`take: 500`) indépendant contre une croissance illimitée sur plusieurs années.

**Tech Stack:** Next.js 16 (React, TypeScript) côté frontend, Express + Prisma côté backend,
Jest + React Testing Library pour les tests des deux côtés.

**Spec de référence :** `docs/superpowers/specs/2026-07-20-limite-resultats-mes-reservations-design.md`

---

### Task 1: Garde-fou serveur sur `listUserReservations`

**Files:**
- Modify: `backend/src/services/reservation.service.ts:1686-1703`
- Test: `backend/src/services/__tests__/reservation.service.test.ts:2011-2201` (bloc `describe('listUserReservations', ...)`)

- [ ] **Step 1: Écrire le test qui échoue**

Dans `backend/src/services/__tests__/reservation.service.test.ts`, ajouter ce test juste avant
la ligne `});` qui ferme le bloc `describe('listUserReservations', ...)` (ligne 2201 — le
dernier test existant du bloc se termine à la ligne 2200 par
`      }\n    });`, insérer le nouveau test après cette accolade et avant le `});` du describe) :

```ts
    it('borne la requête à 500 réservations (garde-fou anti-croissance illimitée)', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([baseReservation()] as any);
      prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }] as any);
      prismaMock.playerRating.findMany.mockResolvedValue([] as any);

      await service.listUserReservations('user-1');

      expect(prismaMock.reservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 500 }),
      );
    });
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Depuis `backend/`, exécuter :

```bash
node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/reservation.service.test.ts -t "garde-fou"
```

Résultat attendu : **FAIL** — `expect(jest.fn()).toHaveBeenCalledWith(...)` échoue car l'appel
réel ne contient pas `take: 500` (le `findMany` actuel n'a pas de `take` du tout).

- [ ] **Step 3: Implémenter le garde-fou**

Dans `backend/src/services/reservation.service.ts`, la méthode `listUserReservations`
commence ainsi :

```ts
  async listUserReservations(userId: string) {
    const rows = await prisma.reservation.findMany({
      where: { userId },
      orderBy: { startTime: 'desc' },
      include: {
```

Remplacer par (ajout de la ligne `take: 500,` après `orderBy`) :

```ts
  async listUserReservations(userId: string) {
    const rows = await prisma.reservation.findMany({
      where: { userId },
      orderBy: { startTime: 'desc' },
      take: 500,
      include: {
```

- [ ] **Step 4: Relancer le test et vérifier qu'il passe**

Depuis `backend/` :

```bash
node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/reservation.service.test.ts -t "garde-fou"
```

Résultat attendu : **PASS** (1 test).

- [ ] **Step 5: Relancer tout le bloc `listUserReservations` pour vérifier l'absence de régression**

Depuis `backend/` :

```bash
node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/reservation.service.test.ts -t "listUserReservations"
```

Résultat attendu : **PASS** — 8 tests (les 7 existants + le nouveau), aucun ne vérifie la
forme exacte de l'appel `findMany` en dehors du nouveau test, donc l'ajout de `take: 500` ne
casse aucune assertion existante.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "fix(reservations): plafonner listUserReservations a 500 lignes (garde-fou)"
```

---

### Task 2: Pagination « Charger plus » de l'onglet Passées

**Files:**
- Modify: `frontend/app/me/reservations/page.tsx`
- Test: Create `frontend/__tests__/MyReservationsPagination.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/MyReservationsPagination.test.tsx` avec ce contenu complet :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import MyReservationsPage from '../app/me/reservations/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/me/reservations',
}));

jest.mock('../lib/useAuth', () => ({
  useAuth: () => ({ token: 'abc', ready: true, clubId: null }),
  logout: jest.fn(),
}));
jest.mock('../components/ClubNav', () => ({ ClubNav: () => <div data-testid="nav" /> }));
jest.mock('../components/ProfileMenu', () => ({ ProfileMenu: () => <div data-testid="profile" /> }));

// Vue plateforme (pas de club courant) : évite d'avoir à mocker getMyQuotaStatus.
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null }) }));

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    getMyReservations: jest.fn(),
    getMyTournaments: jest.fn().mockResolvedValue([]),
    getMyEvents: jest.fn().mockResolvedValue([]),
    getMyLessons: jest.fn().mockResolvedValue([]),
    cancelReservation: jest.fn(),
    getMyMatches: jest.fn().mockResolvedValue([]),
    recordMatchResult: jest.fn(),
    getMyQuotaStatus: jest.fn().mockResolvedValue(null),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

// N réservations passées, chacune avec un nom de terrain unique pour pouvoir les compter.
function pastReservations(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const end = new Date(Date.now() - (i + 1) * 3600e3 * 24); // i+1 jours dans le passé
    return {
      id: `past-${i}`,
      startTime: new Date(end.getTime() - 3600e3).toISOString(),
      endTime: end.toISOString(),
      status: 'CONFIRMED',
      totalPrice: '25.00',
      resource: { id: `court-${i}`, name: `Court ${i}`, club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris' } },
    };
  });
}

async function openPast() {
  render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
  fireEvent.click(await screen.findByText(/Passées/));
}

describe('Mes réservations — pagination de l\'onglet Passées', () => {
  beforeEach(() => {
    mocked.getMyReservations.mockResolvedValue(pastReservations(50) as never);
  });

  it('n\'affiche que les 20 premières réservations passées au départ', async () => {
    await openPast();
    expect(await screen.findByText('Court 0')).toBeInTheDocument();
    expect(screen.getAllByText(/^Court \d+$/)).toHaveLength(20);
    expect(screen.getByText('Charger plus')).toBeInTheDocument();
  });

  it('« Charger plus » révèle 20 réservations de plus par clic, puis disparaît', async () => {
    await openPast();
    await screen.findByText('Court 0');

    fireEvent.click(screen.getByText('Charger plus'));
    expect(screen.getAllByText(/^Court \d+$/)).toHaveLength(40);
    expect(screen.getByText('Charger plus')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Charger plus'));
    expect(screen.getAllByText(/^Court \d+$/)).toHaveLength(50);
    expect(screen.queryByText('Charger plus')).toBeNull();
  });

  it('n\'affecte pas l\'onglet « À venir » (pas de fenêtre appliquée)', async () => {
    const future = new Date(Date.now() + 24 * 3600e3);
    mocked.getMyReservations.mockResolvedValue([
      ...pastReservations(30),
      {
        id: 'up-1',
        startTime: future.toISOString(),
        endTime: new Date(future.getTime() + 3600e3).toISOString(),
        status: 'CONFIRMED',
        totalPrice: '25.00',
        resource: { id: 'court-up', name: 'Court Futur', club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris' } },
      },
    ] as never);
    render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
    fireEvent.click(await screen.findByText(/À venir/));
    expect(await screen.findByText('Court Futur')).toBeInTheDocument();
    expect(screen.queryByText('Charger plus')).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Depuis `frontend/` :

```bash
node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MyReservationsPagination.test.tsx
```

Résultat attendu : **FAIL** sur les 2 premiers tests — `screen.getAllByText(/^Court \d+$/)`
renvoie 50 éléments (pas 20 ni 40), et `screen.getByText('Charger plus')` lève
`TestingLibraryElementError: Unable to find an element`. Le 3ᵉ test (« À venir ») passe déjà
puisqu'aucune fenêtre n'existe encore nulle part.

- [ ] **Step 3: Ajouter l'état de pagination dans `page.tsx`**

Dans `frontend/app/me/reservations/page.tsx`, juste avant `export default function
MyReservationsPage()` (ligne 35), ajouter la constante de module :

```ts
const PAST_PAGE_SIZE = 20;
```

Dans le composant, juste après la déclaration de `quotaStatus` (ligne 63 :
`const [quotaStatus, setQuotaStatus] = useState<MyQuotaStatus | null>(null);`), ajouter le
nouvel état :

```ts
  // Fenêtre d'affichage de « Passées » — le fetch reste complet (nécessaire au Calendrier),
  // seul le nombre de cartes RENDUES est limité, révélé par tranches via « Charger plus ».
  const [pastVisible, setPastVisible] = useState(PAST_PAGE_SIZE);
```

- [ ] **Step 4: Remettre la fenêtre à la première page à chaque rechargement réussi**

Dans la fonction `load` (lignes 72-89), le bloc `try` actuel est :

```ts
    try {
      setError(null);
      const [reservations, tournaments, events, myLessons] = await Promise.all([
        api.getMyReservations(t),
        api.getMyTournaments(t).catch(() => []), // agenda sans tournois si l'appel échoue
        api.getMyEvents(t).catch(() => []),      // agenda sans events si l'appel échoue
        api.getMyLessons(t).catch(() => []),     // agenda sans cours si l'appel échoue
      ]);
      setItems(reservations);
      setRegs(tournaments);
      setEvts(events);
      setLessons(myLessons);
    }
```

Ajouter la remise à zéro juste après `setLessons(myLessons);` :

```ts
    try {
      setError(null);
      const [reservations, tournaments, events, myLessons] = await Promise.all([
        api.getMyReservations(t),
        api.getMyTournaments(t).catch(() => []), // agenda sans tournois si l'appel échoue
        api.getMyEvents(t).catch(() => []),      // agenda sans events si l'appel échoue
        api.getMyLessons(t).catch(() => []),     // agenda sans cours si l'appel échoue
      ]);
      setItems(reservations);
      setRegs(tournaments);
      setEvts(events);
      setLessons(myLessons);
      setPastVisible(PAST_PAGE_SIZE);
    }
```

- [ ] **Step 5: Fenêtrer la liste « Passées »**

Toujours dans `page.tsx`, la ligne actuelle (juste après le calcul de `past`, autour de la
ligne 123) :

```ts
  const list = tab === 'past' ? past : upcoming;
```

Remplacer par :

```ts
  const visiblePast = useMemo(() => past.slice(0, pastVisible), [past, pastVisible]);
  const list = tab === 'past' ? visiblePast : upcoming;
```

- [ ] **Step 6: Ajouter le bouton « Charger plus »**

Toujours dans `page.tsx`, le bloc de rendu de la liste (branche `list.length === 0 ? (...) : (
list.map(...) )`) est actuellement :

```tsx
          ) : (
            list.map((it) => (
              <MyAgendaListItem
                key={`${it.kind}-${it.id}`}
                item={it}
                now={now ?? Date.now()}
                localSlug={slug ?? null}
                token={token}
                onCancel={setConfirmCancel}
                onPlayersChanged={() => { if (token) load(token); }}
                onOpenChat={setChatFor}
                canRecord={(r) => now != null && canRecordResult(r, new Date(now)) && !matchFor(r.id)}
                onRecordResult={levelEnabled ? (r) => setRecordingFor(r) : undefined}
                existingMatchStatus={it.kind === 'reservation' ? matchFor(it.r.id)?.status : undefined}
                showSport={showSport}
              />
            ))
          )}
```

Remplacer par (le `list.map(...)` devient le premier enfant d'un fragment, suivi du bouton
conditionnel) :

```tsx
          ) : (
            <>
              {list.map((it) => (
                <MyAgendaListItem
                  key={`${it.kind}-${it.id}`}
                  item={it}
                  now={now ?? Date.now()}
                  localSlug={slug ?? null}
                  token={token}
                  onCancel={setConfirmCancel}
                  onPlayersChanged={() => { if (token) load(token); }}
                  onOpenChat={setChatFor}
                  canRecord={(r) => now != null && canRecordResult(r, new Date(now)) && !matchFor(r.id)}
                  onRecordResult={levelEnabled ? (r) => setRecordingFor(r) : undefined}
                  existingMatchStatus={it.kind === 'reservation' ? matchFor(it.r.id)?.status : undefined}
                  showSport={showSport}
                />
              ))}
              {tab === 'past' && pastVisible < past.length && (
                <button onClick={() => setPastVisible((v) => v + PAST_PAGE_SIZE)} style={{
                  gridColumn: '1 / -1', marginTop: 4, width: '100%', padding: '10px 0', borderRadius: 10,
                  border: `1px solid ${th.line}`, background: th.surface, color: th.text, cursor: 'pointer',
                  fontFamily: th.fontUI, fontWeight: 600,
                }}>Charger plus</button>
              )}
            </>
          )}
```

- [ ] **Step 7: Relancer le test et vérifier qu'il passe**

Depuis `frontend/` :

```bash
node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MyReservationsPagination.test.tsx
```

Résultat attendu : **PASS** — 3 tests.

- [ ] **Step 8: Vérifier l'absence de régression sur les suites existantes de la page**

Depuis `frontend/` :

```bash
node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MyReservationsScoping.test.tsx __tests__/MyReservationsCalendar.test.tsx __tests__/MyReservationsChat.test.tsx
```

Résultat attendu : **PASS** sur les 3 fichiers — ces suites n'ont pas plus de 20 réservations
passées dans leurs fixtures, donc la fenêtre à 20 ne change rien à ce qu'elles observent.

- [ ] **Step 9: Vérifier les types**

Depuis `frontend/` :

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Résultat attendu : aucune erreur ne mentionne `app/me/reservations/page.tsx` (des erreurs
préexistantes sans rapport ailleurs dans le projet, s'il y en a, ne sont pas de la
responsabilité de cette tâche).

- [ ] **Step 10: Commit**

```bash
git add frontend/app/me/reservations/page.tsx frontend/__tests__/MyReservationsPagination.test.tsx
git commit -m "feat(reservations): limiter l affichage de Passees a 20 + Charger plus"
```

---

### Task 3: Vérification visuelle

**Files:** aucun (vérification uniquement, pas de code)

- [ ] **Step 1: Démarrer la stack de dev si elle ne tourne pas déjà**

Suivre `CLAUDE.md` (§ Démarrage) : Docker (Postgres + Redis), puis `npm run dev` dans
`backend/` et `frontend/`.

- [ ] **Step 2: Vérifier visuellement avec le skill `verify`**

Invoquer le skill `verify` sur la page `/me/reservations`, onglet « Passées », avec un compte
ayant un historique de plus de 20 réservations (compte de test `test@palova.fr` / mot de passe
`password123` — si son historique a moins de 20 réservations passées, créer/seeder
suffisamment de réservations `CONFIRMED` avec `startTime`/`endTime` passés pour un utilisateur
de test, ou réduire temporairement `PAST_PAGE_SIZE` à 2 dans `page.tsx` le temps de la capture
puis le remettre à 20).

Vérifier : au chargement, au plus 20 cartes sont visibles dans l'onglet Passées ; le bouton
« Charger plus » est visible et stylé de façon cohérente avec le reste de l'app (comparer avec
`/me/notifications`) ; un clic révèle 20 cartes de plus ; le bouton disparaît une fois tout
l'historique affiché. Vérifier en thème clair **et** sombre, viewport desktop (1280) **et**
mobile (390) — aucun débordement horizontal, le bouton reste pleine largeur sous les cartes.

- [ ] **Step 3: Consigner le résultat**

Si tout est conforme, ne rien committer de plus (étape de vérification uniquement). Si un
écart visuel apparaît, revenir à la Task 2 pour l'ajuster avant de considérer le travail
terminé.
