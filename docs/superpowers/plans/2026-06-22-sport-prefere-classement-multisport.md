# Sport préféré & classement multi-sport — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à chaque joueur de choisir un *sport préféré* (inscription/profil) qui pré-remplit les filtres de navigation, et rendre le système de classement Glicko-2 réellement multi-sport (le niveau suit le sport du contexte ; vues perso avec sélecteur de sport).

**Architecture:** Le moteur de rating est déjà générique par `sportId` ; le travail est surtout (a) ajouter `User.preferredSportId` + `ClubEvent.clubSportId` (2 migrations additives), (b) remplacer les `'padel'` codés en dur par le sport du contexte côté affichage, (c) ajouter des défauts/sélecteurs côté front. Aucune régression : `preferredSportId = null` ⇒ comportement actuel (fallback `'padel'` / premier sport).

**Tech Stack:** Backend Express 5 + Prisma 7 (tests Jest, Prisma mocké via `prismaMock`). Frontend Next.js 16 + React 19 (tests RTL/Jest). Spec : `docs/superpowers/specs/2026-06-22-sport-prefere-classement-multisport-design.md`.

**Convention TDD du repo :** tests backend mockent Prisma (`backend/src/__mocks__`, `prismaMock`). Gate = `cd backend && npm test` et `cd frontend && npm test` ; `tsc` doit rester clean. Commits fréquents, un par task.

---

## Lot 1 — Donnée `preferredSport` + capture (inscription & profil)

### Task 1.1 : Migration `add_user_preferred_sport`

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `User`, model `Sport`)
- Create: `backend/prisma/migrations/<timestamp>_add_user_preferred_sport/migration.sql` (généré par Prisma)

- [ ] **Step 1 : Éditer le schéma**

Dans `model User`, ajouter le champ + relation (à côté de `locale` / `showInLeaderboard`) :

```prisma
  preferredSportId String? @map("preferred_sport_id")
  preferredSport   Sport?  @relation("UserPreferredSport", fields: [preferredSportId], references: [id], onDelete: SetNull)
```

Dans `model Sport`, ajouter la relation inverse (à côté des autres relations `User[]`/`ClubSport[]`) :

```prisma
  preferredByUsers User[] @relation("UserPreferredSport")
```

- [ ] **Step 2 : Générer la migration**

Si Docker (Postgres) est up :
Run: `cd backend && npx prisma migrate dev --name add_user_preferred_sport`
Expected: migration créée + appliquée + `prisma generate` OK.

Si Postgres est down (cf. CLAUDE.md, garde-fou IA) : créer à la main le dossier `backend/prisma/migrations/<timestamp>_add_user_preferred_sport/migration.sql` avec :

```sql
ALTER TABLE "users" ADD COLUMN "preferred_sport_id" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_preferred_sport_id_fkey"
  FOREIGN KEY ("preferred_sport_id") REFERENCES "sports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```
puis `cd backend && npx prisma generate`.

- [ ] **Step 3 : Vérifier la compilation**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS (le client Prisma connaît `preferredSportId` / `preferredSport`).

- [ ] **Step 4 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(rating): User.preferredSportId (migration additive)"
```

---

### Task 1.2 : `GET /me/profile` renvoie + `PATCH /me` accepte `preferredSportId`

**Files:**
- Modify: `backend/src/routes/me.ts` (`PROFILE_SELECT`, handler `PATCH /`)
- Test: `backend/src/routes/__tests__/me.routes.test.ts`

- [ ] **Step 1 : Écrire les tests (échouent)**

Ajouter dans `me.routes.test.ts` (suivre le style existant : `prismaMock`, `token()`) :

```ts
it('PATCH /api/me enregistre preferredSportId après vérif du sport', async () => {
  prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel', published: true } as any);
  prismaMock.user.update.mockResolvedValue({ id: 'u1', preferredSport: { id: 'sport-padel', key: 'padel', name: 'Padel' } } as any);
  const res = await request(app).patch('/api/me')
    .set('Authorization', `Bearer ${token()}`).send({ preferredSportId: 'sport-padel' });
  expect(res.status).toBe(200);
  expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ preferredSportId: 'sport-padel' }),
  }));
});

it('PATCH /api/me rejette un preferredSportId inconnu', async () => {
  prismaMock.sport.findUnique.mockResolvedValue(null);
  const res = await request(app).patch('/api/me')
    .set('Authorization', `Bearer ${token()}`).send({ preferredSportId: 'sport-xxx' });
  expect(res.status).toBe(400);
});

it('PATCH /api/me efface le sport préféré avec null', async () => {
  prismaMock.user.update.mockResolvedValue({ id: 'u1', preferredSport: null } as any);
  const res = await request(app).patch('/api/me')
    .set('Authorization', `Bearer ${token()}`).send({ preferredSportId: null });
  expect(res.status).toBe(200);
  expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ preferredSportId: null }),
  }));
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `cd backend && npm test -- me.routes`
Expected: FAIL (preferredSportId non géré).

- [ ] **Step 3 : Implémenter**

Dans `me.ts`, étendre `PROFILE_SELECT` :

```ts
const PROFILE_SELECT = {
  id: true, email: true, firstName: true, lastName: true, phone: true, sex: true,
  birthDate: true, avatarUrl: true, locale: true, isSuperAdmin: true, showInLeaderboard: true,
  preferredSport: { select: { id: true, key: true, name: true } },
} as const;
```

Dans le handler `PATCH /`, ajouter le type + la branche de validation (après le bloc `showInLeaderboard`, avant le `prisma.user.update`) :

```ts
// dans le type `data` :
//   preferredSportId?: string | null;
const { phone, sex, birthDate, locale, showInLeaderboard, preferredSportId } = req.body;
// ...
if (preferredSportId !== undefined) {
  if (preferredSportId === null) {
    data.preferredSportId = null;
  } else {
    if (typeof preferredSportId !== 'string') return void res.status(400).json({ error: 'preferredSportId invalide' });
    const sport = await prisma.sport.findUnique({ where: { id: preferredSportId }, select: { id: true, published: true } });
    if (!sport || !sport.published) return void res.status(400).json({ error: 'preferredSportId invalide' });
    data.preferredSportId = preferredSportId;
  }
}
```

- [ ] **Step 4 : Lancer → succès**

Run: `cd backend && npm test -- me.routes`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts
git commit -m "feat(profil): GET/PATCH /me expose et accepte preferredSportId"
```

---

### Task 1.3 : `POST /auth/register` accepte un `preferredSportId` optionnel

**Files:**
- Modify: `backend/src/routes/auth.ts` (handler `POST /register`)
- Test: `backend/src/routes/__tests__/auth.routes.test.ts`

- [ ] **Step 1 : Lire le handler register** pour repérer l'objet `data` du `prisma.user.create` et les champs déjà lus du body (email, password, firstName, lastName, phone).

- [ ] **Step 2 : Écrire le test (échoue)**

Ajouter dans `auth.routes.test.ts` (suivre le style des tests register existants, qui mockent `prismaMock.user.create`) :

```ts
it('register enregistre le preferredSportId fourni', async () => {
  prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel', published: true } as any);
  // ... mocks existants du flux register (user inexistant, create, code email) ...
  await request(app).post('/api/auth/register').send({
    email: 'p@x.fr', password: 'password123', firstName: 'P', lastName: 'Q', preferredSportId: 'sport-padel',
  });
  expect(prismaMock.user.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ preferredSportId: 'sport-padel' }),
  }));
});
```

- [ ] **Step 3 : Lancer → échec**

Run: `cd backend && npm test -- auth.routes`
Expected: FAIL.

- [ ] **Step 4 : Implémenter**

Dans le handler register, lire `preferredSportId` du body et, s'il est fourni et valide, l'ajouter au `data` du `create` :

```ts
const { preferredSportId } = req.body;
let validPreferredSportId: string | null = null;
if (typeof preferredSportId === 'string' && preferredSportId) {
  const sport = await prisma.sport.findUnique({ where: { id: preferredSportId }, select: { id: true, published: true } });
  if (sport && sport.published) validPreferredSportId = sport.id;
}
// ... dans prisma.user.create({ data: { ...champs existants, preferredSportId: validPreferredSportId } })
```

(Un id invalide est **ignoré**, pas bloquant — l'inscription ne doit jamais échouer pour ça.)

- [ ] **Step 5 : Lancer → succès**

Run: `cd backend && npm test -- auth.routes`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/routes/auth.ts backend/src/routes/__tests__/auth.routes.test.ts
git commit -m "feat(auth): register accepte un preferredSportId optionnel"
```

---

### Task 1.4 : Types & client API frontend

**Files:**
- Modify: `frontend/lib/api.ts` (`MyProfile`, `RegisterBody`, `updateMyProfile`)

- [ ] **Step 1 : Étendre les types**

```ts
// MyProfile (≈ ligne 1353) — ajouter :
  preferredSport: { id: string; key: string; name: string } | null;

// RegisterBody (≈ ligne 898) — ajouter :
  preferredSportId?: string;
```

- [ ] **Step 2 : Étendre `updateMyProfile`** pour accepter `preferredSportId` :

```ts
updateMyProfile: (body: { phone?: string | null; sex?: Sex | null; birthDate?: string | null; locale?: string | null; showInLeaderboard?: boolean; preferredSportId?: string | null }, token: string) =>
  request<MyProfile>('/api/me', { method: 'PATCH', body: JSON.stringify(body) }, token),
```

- [ ] **Step 3 : Vérifier la compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): types preferredSport (MyProfile, RegisterBody, updateMyProfile)"
```

---

### Task 1.5 : Sélecteur « Sport préféré » au profil

**Files:**
- Modify: `frontend/app/me/profile/page.tsx`
- Test: `frontend/__tests__/MeProfile.test.tsx`

- [ ] **Step 1 : Écrire le test (échoue)**

Le test mocke `lib/api` (déjà le cas dans `MeProfile.test.tsx`). Vérifier qu'au changement de sport, `updateMyProfile` est appelé avec `preferredSportId` :

```tsx
it('enregistre le sport préféré', async () => {
  // getMyProfile renvoie preferredSport null ; getSports renvoie [padel, tennis]
  // (compléter les mocks existants du fichier)
  render(<MeProfilePage />);
  const select = await screen.findByLabelText(/sport préféré/i);
  fireEvent.change(select, { target: { value: 'sport-tennis' } });
  await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
    expect.objectContaining({ preferredSportId: 'sport-tennis' }), expect.any(String)));
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `cd frontend && npm test -- MeProfile`
Expected: FAIL (pas de champ « Sport préféré »).

- [ ] **Step 3 : Implémenter**

Charger les sports (`api.getSports()`) dans le `useEffect` de chargement, ajouter un état `sports`, et une section/`<select>` « Sport préféré » qui appelle `updateMyProfile({ preferredSportId })`. Modèle :

```tsx
const [sports, setSports] = useState<Sport[]>([]);
useEffect(() => { api.getSports().then(setSports).catch(() => {}); }, []);

const handlePreferredSport = async (id: string) => {
  if (!token) return;
  setProfile(await api.updateMyProfile({ preferredSportId: id || null }, token));
};

// dans le rendu (près des autres champs identité) :
<label htmlFor="pref-sport" style={fieldLabel}>Sport préféré</label>
<select id="pref-sport" value={profile?.preferredSport?.id ?? ''} onChange={(e) => handlePreferredSport(e.target.value)} style={fieldInput}>
  <option value="">Aucun</option>
  {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
</select>
```

(Réutiliser les styles d'input existants de la page.)

- [ ] **Step 4 : Lancer → succès**

Run: `cd frontend && npm test -- MeProfile`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/me/profile/page.tsx frontend/__tests__/MeProfile.test.tsx
git commit -m "feat(profil): sélecteur de sport préféré"
```

---

### Task 1.6 : Sélecteur « Sport préféré » (optionnel) à l'inscription

**Files:**
- Modify: `frontend/app/register/page.tsx` (et `frontend/app/clubs/new/page.tsx` si le formulaire d'inscription y est dupliqué — sinon ignorer)
- Test: test du composant de formulaire d'inscription concerné

- [ ] **Step 1 : Lire** le formulaire d'inscription (étape 1) pour repérer l'état du formulaire et l'appel `api.register(body)`.

- [ ] **Step 2 : Écrire le test (échoue)** : sélectionner un sport puis soumettre appelle `api.register` avec `preferredSportId`.

- [ ] **Step 3 : Implémenter** : charger `api.getSports()`, ajouter un `<select>` optionnel « Sport préféré (facultatif) », inclure `preferredSportId` (ou `undefined`) dans le body passé à `api.register`.

- [ ] **Step 4 : Lancer → succès** (`cd frontend && npm test -- register` ou le nom du test).

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/register frontend/app/clubs/new frontend/__tests__
git commit -m "feat(inscription): choix optionnel du sport préféré"
```

---

## Lot 2 — Filtres pré-remplis (défaut modifiable)

### Task 2.1 : Annuaire des clubs — défaut = sport préféré

**Files:**
- Modify: `frontend/components/ClubDirectory.tsx`
- Test: `frontend/__tests__/ClubDirectory.test.tsx` (créer si absent)

- [ ] **Step 1 : Écrire le test (échoue)**

Mock `lib/api` : `getMyProfile` → `{ preferredSport: { key: 'tennis' } }`, `getSports` → padel+tennis, `useAuth` → token présent. Vérifier qu'après montage, `listClubs` est appelé avec `sport: 'tennis'` et que la puce Tennis est active.

```tsx
it('initialise le filtre sur le sport préféré', async () => {
  render(<ClubDirectory />);
  await waitFor(() => expect(api.listClubs).toHaveBeenCalledWith(expect.objectContaining({ sport: 'tennis' })));
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `cd frontend && npm test -- ClubDirectory`
Expected: FAIL.

- [ ] **Step 3 : Implémenter**

Utiliser `useAuth()` (`@/lib/useAuth`) pour récupérer le token, charger le profil s'il existe, et initialiser `sport` :

```tsx
import { useAuth } from '@/lib/useAuth';
// ...
const { token } = useAuth();
useEffect(() => {
  if (!token) return;
  api.getMyProfile(token).then((p) => {
    if (p.preferredSport?.key) setSport((cur) => cur || p.preferredSport!.key);
  }).catch(() => {});
}, [token]);
```

(Le `cur || …` n'écrase pas un choix manuel déjà fait par l'utilisateur. Le filtre reste librement modifiable via les puces existantes.)

- [ ] **Step 4 : Lancer → succès** ; **Step 5 : Commit**

```bash
git add frontend/components/ClubDirectory.tsx frontend/__tests__/ClubDirectory.test.tsx
git commit -m "feat(annuaire): filtre par défaut = sport préféré (modifiable)"
```

---

### Task 2.2 : Page Réserver — sport sélectionné par défaut = sport préféré (si offert)

**Files:**
- Modify: `frontend/components/ClubReserve.tsx`
- Test: `frontend/__tests__/ClubReserve.persport.test.tsx` (ajouter un cas)

- [ ] **Step 1 : Écrire le test (échoue)**

Club proposant padel + tennis ; profil `preferredSport.key = 'tennis'` ⇒ la section tennis est sélectionnée par défaut. Si le club ne propose pas le sport préféré ⇒ `clubSports[0]` (comportement actuel).

- [ ] **Step 2 : Lancer → échec** (`cd frontend && npm test -- ClubReserve`).

- [ ] **Step 3 : Implémenter**

Remplacer l'initialisation `selectedSportId` par un calcul qui privilégie le sport préféré s'il fait partie des `clubSports`. Charger le profil via `useAuth().token` :

```tsx
const { token } = useAuth();
// init actuel : useState(club.clubSports[0]?.id ?? '')
useEffect(() => {
  if (!token) return;
  api.getMyProfile(token).then((p) => {
    const match = club.clubSports.find((cs) => cs.sport.key === p.preferredSport?.key);
    if (match) setSelectedSportId((cur) => cur === (club.clubSports[0]?.id ?? '') ? match.id : cur);
  }).catch(() => {});
}, [token, club.clubSports]);
```

(N'écrase pas un changement manuel de l'utilisateur — on ne réécrit que tant que la valeur est encore le défaut initial. Fallback inchangé si aucun match.)

- [ ] **Step 4 : Lancer → succès** ; **Step 5 : Commit**

```bash
git add frontend/components/ClubReserve.tsx frontend/__tests__/ClubReserve.persport.test.tsx
git commit -m "feat(réserver): sport par défaut = sport préféré si proposé par le club"
```

---

## Lot 3 — Classement contextuel (le niveau suit le sport du contexte)

### Task 3.1 : Helper `RatingService.getLevelsBySport` (multi-sport)

**Files:**
- Modify: `backend/src/services/rating.service.ts`
- Test: `backend/src/services/__tests__/rating.service.test.ts`

- [ ] **Step 1 : Écrire le test (échoue)**

```ts
it('getLevelsBySport mappe les niveaux par (userId, sportKey)', async () => {
  prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }, { id: 'sport-tennis', key: 'tennis' }] as any);
  prismaMock.playerRating.findMany.mockResolvedValue([
    { userId: 'u1', sportId: 'sport-padel', displayLevel: 4, isProvisional: false },
    { userId: 'u1', sportId: 'sport-tennis', displayLevel: 6, isProvisional: true },
  ] as any);
  const map = await service.getLevelsBySport([
    { userId: 'u1', sportKey: 'padel' }, { userId: 'u1', sportKey: 'tennis' },
  ]);
  expect(map['u1:padel'].level).toBe(4);
  expect(map['u1:tennis'].level).toBe(6);
});

it('getLevelsBySport renvoie {} pour une liste vide', async () => {
  expect(await service.getLevelsBySport([])).toEqual({});
});
```

- [ ] **Step 2 : Lancer → échec** (`cd backend && npm test -- rating.service`).

- [ ] **Step 3 : Implémenter** dans `RatingService` :

```ts
/** Niveaux d'un lot de paires (userId, sportKey). Clé de retour : `${userId}:${sportKey}`. Un seul findMany. */
async getLevelsBySport(pairs: { userId: string; sportKey: string }[]): Promise<Record<string, UserLevel>> {
  if (pairs.length === 0) return {};
  const sportKeys = [...new Set(pairs.map((p) => p.sportKey))];
  const sports = await prisma.sport.findMany({ where: { key: { in: sportKeys } }, select: { id: true, key: true } });
  const keyById = new Map(sports.map((s) => [s.id, s.key]));
  const userIds = [...new Set(pairs.map((p) => p.userId))];
  const rows = await prisma.playerRating.findMany({
    where: { sportId: { in: sports.map((s) => s.id) }, userId: { in: userIds } },
    select: { userId: true, sportId: true, displayLevel: true, isProvisional: true },
  });
  const map: Record<string, UserLevel> = {};
  for (const r of rows) {
    const key = keyById.get(r.sportId);
    if (key) map[`${r.userId}:${key}`] = { level: r.displayLevel, tier: namedTier(r.displayLevel), isProvisional: r.isProvisional };
  }
  return map;
}
```

- [ ] **Step 4 : Lancer → succès** ; **Step 5 : Commit**

```bash
git add backend/src/services/rating.service.ts backend/src/services/__tests__/rating.service.test.ts
git commit -m "feat(rating): helper getLevelsBySport (niveaux multi-sport en un appel)"
```

---

### Task 3.2 : « Mes réservations » — niveau au sport de chaque terrain

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (`listUserReservations`, ≈1236–1268)
- Test: `backend/src/services/__tests__/reservation.service.test.ts`

- [ ] **Step 1 : Écrire le test (échoue)**

Deux réservations de sports différents (padel, tennis) ⇒ chaque participant reçoit le niveau du sport de SA réservation. Mocker `getLevelsBySport` (ou `prismaMock.sport.findMany` + `playerRating.findMany`).

- [ ] **Step 2 : Lancer → échec** (`cd backend && npm test -- reservation.service`).

- [ ] **Step 3 : Implémenter**

Dans l'`include`, exposer le sport du terrain :

```ts
resource: { select: { id: true, name: true, attributes: true,
  clubSport: { select: { sport: { select: { key: true } } } },
  club: { select: { name: true, slug: true, timezone: true, playerChangeCutoffHours: true, cancellationCutoffHours: true } } } },
```

Remplacer l'enrichissement `getLevelsForUsers(..., 'padel')` par des paires (participant, sport de la résa) :

```ts
const pairs = rows.flatMap((r) => r.participants.map((p) => ({ userId: p.userId, sportKey: r.resource.clubSport.sport.key })));
const levels = await this.ratingService.getLevelsBySport(pairs);
```

Dans le `map` de sortie, retirer `clubSport` de l'objet `resource` exposé (rester rétrocompatible) et lire le niveau par sport :

```ts
const { attributes, clubSport, ...resourcePublic } = resource;
const sportKey = clubSport.sport.key;
// participants[].level = levels[`${p.userId}:${sportKey}`] ?? null
```

- [ ] **Step 4 : Lancer → succès** ; **Step 5 : Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(rating): niveaux de Mes réservations au sport du terrain"
```

---

### Task 3.3 : Parties ouvertes — niveau au sport du terrain

**Files:**
- Modify: `backend/src/services/openMatch.service.ts` (`listOpenMatches`, ≈49–96)
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1 : Écrire le test (échoue)** : deux parties ouvertes de sports différents ⇒ niveaux corrects par partie.

- [ ] **Step 2 : Lancer → échec** (`cd backend && npm test -- openMatch.service`).

- [ ] **Step 3 : Implémenter**

Ajouter le sport à l'`include` :

```ts
resource: { select: { id: true, name: true, attributes: true, clubSport: { select: { sport: { select: { key: true } } } } } },
```

Remplacer l'enrichissement :

```ts
const pairs = matches.flatMap((m) => m.participants.map((p) => ({ userId: p.userId, sportKey: m.resource.clubSport.sport.key })));
const levels = await this.ratingService.getLevelsBySport(pairs);
// players[].level = levels[`${p.userId}:${m.resource.clubSport.sport.key}`] ?? null
```

- [ ] **Step 4 : Lancer → succès** ; **Step 5 : Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(rating): niveaux des parties ouvertes au sport du terrain"
```

---

### Task 3.4 : Tournois — niveau au sport du tournoi

**Files:**
- Modify: `backend/src/services/tournament.service.ts` (≈184, fonction listant les participants avec niveaux)
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1 : Écrire le test (échoue)** : tournoi dont `clubSport.sport.key = 'tennis'` ⇒ `getLevelsForUsers` appelé avec `'tennis'`.

- [ ] **Step 2 : Lancer → échec** (`cd backend && npm test -- tournament.service`).

- [ ] **Step 3 : Implémenter**

Charger le sport du tournoi (ajouter au `select`/`include` du tournoi : `clubSport: { select: { sport: { select: { key: true } } } }`) puis remplacer `'padel'` par `tournament.clubSport.sport.key` dans l'appel `getLevelsForUsers`.

- [ ] **Step 4 : Lancer → succès** ; **Step 5 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(rating): niveaux des tournois au sport du tournoi"
```

---

## Lot 4 — Events : sport optionnel + niveau conditionnel

### Task 4.1 : Migration `add_event_sport`

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `ClubEvent`, model `ClubSport`)
- Create: migration `add_event_sport`

- [ ] **Step 1 : Éditer le schéma**

Dans `model ClubEvent`, ajouter :

```prisma
  clubSportId String?    @map("club_sport_id")
  clubSport   ClubSport? @relation(fields: [clubSportId], references: [id], onDelete: Restrict)
```

Dans `model ClubSport`, ajouter la relation inverse (à côté de la relation `Tournament[]`) :

```prisma
  clubEvents ClubEvent[]
```

- [ ] **Step 2 : Générer la migration**

Run: `cd backend && npx prisma migrate dev --name add_event_sport`
(ou migration SQL manuelle `ALTER TABLE "club_events" ADD COLUMN "club_sport_id" TEXT;` + FK vers `club_sports("id")` ON DELETE RESTRICT, si DB down — confirmer les noms de tables dans une migration existante.)

- [ ] **Step 3 : Vérifier** `cd backend && npx tsc --noEmit` → PASS.

- [ ] **Step 4 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(events): ClubEvent.clubSportId optionnel (migration additive)"
```

---

### Task 4.2 : Service events — création/édition du sport + niveau conditionnel

**Files:**
- Modify: `backend/src/services/event.service.ts` (création/MAJ + enrichissement niveaux ≈168 + `listParticipants`)
- Test: `backend/src/services/__tests__/event.service.test.ts`

- [ ] **Step 1 : Écrire les tests (échouent)**

```ts
it('event AVEC sport : niveaux au sport de l’event', async () => {
  // event.clubSport.sport.key = 'padel' → getLevelsForUsers('…','padel')
});
it('event SANS sport : aucun niveau (level null)', async () => {
  // clubSportId null → pas d'appel getLevelsForUsers, participants level null
});
it('création/MAJ accepte clubSportId (validé membre du club) ou null', async () => { /* … */ });
```

- [ ] **Step 2 : Lancer → échec** (`cd backend && npm test -- event.service`).

- [ ] **Step 3 : Implémenter**

- Création/MAJ : accepter `clubSportId?: string | null` ; si fourni, vérifier qu'il appartient au club (`prisma.clubSport.findFirst({ where: { id, clubId } })`) sinon `VALIDATION_ERROR`.
- Lecture des participants : charger `clubSport.sport.key` ; si présent → `getLevelsForUsers(userIds, key)` ; sinon → map vide, chaque participant `level: null`.

```ts
const sportKey = event.clubSport?.sport.key ?? null;
const levels = sportKey && allUserIds.length ? await ratingService.getLevelsForUsers(allUserIds, sportKey) : {};
// participant.level = levels[userId] ?? null
```

- [ ] **Step 4 : Lancer → succès** ; **Step 5 : Commit**

```bash
git add backend/src/services/event.service.ts backend/src/services/__tests__/event.service.test.ts
git commit -m "feat(events): sport optionnel + niveaux conditionnés au sport de l'event"
```

---

### Task 4.3 : Admin events — champ « Sport » + route

**Files:**
- Modify: `backend/src/routes/events.ts` (routes admin create/update — forward `clubSportId`)
- Modify: `frontend/app/admin/events/page.tsx` (sélecteur de sport, optionnel)
- Modify: `frontend/lib/api.ts` (types/payloads admin events + `ClubEvent` public si besoin du sport côté front)
- Test: route admin events + composant admin events

- [ ] **Step 1 : Écrire les tests (échouent)** : la route admin create/update transmet `clubSportId` au service ; le formulaire admin envoie `clubSportId` (ou null).

- [ ] **Step 2 : Lancer → échec**.

- [ ] **Step 3 : Implémenter** : ajouter `clubSportId` aux payloads de route et au formulaire admin (`<select>` alimenté par les `clubSports` du club, option « Tous sports » = null). Suivre le pattern existant du champ sport des tournois (`/admin/tournaments`).

- [ ] **Step 4 : Lancer → succès** ; **Step 5 : Commit**

```bash
git add backend/src/routes/events.ts frontend/app/admin/events frontend/lib/api.ts backend/src/routes/__tests__ frontend/__tests__
git commit -m "feat(events): choix du sport dans l'admin events"
```

---

## Lot 5 — Vues perso multi-sport (défaut préféré + sélecteur)

### Task 5.1 : `me/rating*` — défaut = sport préféré du joueur

**Files:**
- Modify: `backend/src/routes/me.ts` (`/rating`, `/rating/history`, `/rating/calibrate`)
- Test: `backend/src/routes/__tests__/rating.routes.test.ts`

- [ ] **Step 1 : Écrire le test (échoue)**

Sans `?sport`, l'utilisateur dont `preferredSport.key = 'tennis'` ⇒ `getForDisplay` appelé avec `'tennis'` ; fallback `'padel'` si pas de préférence.

- [ ] **Step 2 : Lancer → échec** (`cd backend && npm test -- rating.routes`).

- [ ] **Step 3 : Implémenter**

Créer un util partagé `backend/src/services/rating/preferredSport.ts` :

```ts
import { prisma } from '../../db/prisma';

/** Sport à utiliser pour une vue perso : l'override (?sport=) s'il est fourni, sinon le sport préféré du joueur, sinon 'padel'. */
export async function resolvePreferredSportKey(userId: string, override?: unknown): Promise<string> {
  if (typeof override === 'string' && override) return override;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { preferredSport: { select: { key: true } } } });
  return u?.preferredSport?.key ?? 'padel';
}
```

Dans `me.ts`, importer `resolvePreferredSportKey` et, dans les 3 handlers, remplacer `… ? req.query.sport : 'padel'` (et `req.body.sport`) par `await resolvePreferredSportKey(req.user!.id, req.query.sport /* ou req.body.sport */)`.

- [ ] **Step 4 : Lancer → succès** ; **Step 5 : Commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/rating.routes.test.ts
git commit -m "feat(rating): défaut des vues perso = sport préféré (fallback padel)"
```

---

### Task 5.2 : Leaderboard club — défaut = sport préféré du caller

**Files:**
- Modify: `backend/src/routes/clubs.ts` (≈181, handler leaderboard) — résolution du sport
- Test: `backend/src/routes/__tests__/` (test du leaderboard) ou `club.service.test.ts`

- [ ] **Step 1 : Écrire le test (échoue)** : sans `?sport`, leaderboard utilise le sport préféré du caller (fallback padel).

- [ ] **Step 2 : Lancer → échec**.

- [ ] **Step 3 : Implémenter**

Dans le handler leaderboard : si `req.query.sport` absent, résoudre le sport préféré du caller avant d'appeler `clubService.clubLeaderboard(slug, userId, sportKey)`. La signature service reste inchangée. Pour ne pas dupliquer la logique, **extraire `resolveSport` de la Task 5.1 dans un util partagé** (ex. `backend/src/services/rating/preferredSport.ts` : `resolvePreferredSportKey(userId, override?)`) et l'importer dans `me.ts` ET `clubs.ts`.

- [ ] **Step 4 : Lancer → succès** ; **Step 5 : Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/routes/__tests__
git commit -m "feat(leaderboard): défaut = sport préféré du membre"
```

---

### Task 5.3 : Profil — sélecteur de sport pour « Mon niveau » + calibrage par sport

**Files:**
- Modify: `frontend/app/me/profile/page.tsx`
- Test: `frontend/__tests__/MeProfile.test.tsx`

- [ ] **Step 1 : Écrire le test (échoue)** : changer le sport du sélecteur de niveau recharge `getMyRating(token, '<sport>')` et le calibrage envoie ce sport.

- [ ] **Step 2 : Lancer → échec** (`cd frontend && npm test -- MeProfile`).

- [ ] **Step 3 : Implémenter**

Ajouter un état `ratingSport` (défaut = `profile.preferredSport?.key ?? 'padel'`). Le bloc « Mon niveau » devient « Mon niveau — <select sport> » ; sur changement, appeler `getMyRating(token, ratingSport)` + `getRatingHistory(token, ratingSport)` ; `handleCalibrate` passe `ratingSport` à `calibrateRating(selfLevel, token, ratingSport)`. Liste du sélecteur = sports du catalogue (`getSports()`), libellé adapté (retirer « padel » en dur du titre).

- [ ] **Step 4 : Lancer → succès** ; **Step 5 : Commit**

```bash
git add frontend/app/me/profile/page.tsx frontend/__tests__/MeProfile.test.tsx
git commit -m "feat(profil): niveau & calibrage par sport (sélecteur)"
```

---

### Task 5.4 : Leaderboard (front) — sélecteur de sport, défaut préféré

**Files:**
- Modify: page/section du leaderboard (`/parties` bascule Classement — repérer le composant)
- Test: `frontend/__tests__/Leaderboard.test.tsx`

- [ ] **Step 1 : Écrire le test (échoue)** : sélecteur listant les sports du club ; défaut = sport préféré s'il est offert ; changement → `getClubLeaderboard(slug, token, sport)`.

- [ ] **Step 2 : Lancer → échec** (`cd frontend && npm test -- Leaderboard`).

- [ ] **Step 3 : Implémenter** : état `lbSport` (défaut préféré∩clubSports sinon 1er sport du club), `<select>`/puces des `clubSports`, recharge via `api.getClubLeaderboard(slug, token, lbSport)`.

- [ ] **Step 4 : Lancer → succès** ; **Step 5 : Commit**

```bash
git add frontend frontend/__tests__/Leaderboard.test.tsx
git commit -m "feat(leaderboard): sélecteur de sport côté front (défaut préféré)"
```

---

### Task 5.5 : Partner-picker (`searchMembers`) — défaut = sport préféré du caller

**Files:**
- Modify: `backend/src/services/club.service.ts` (`searchMembers`, ≈389 — actuellement `getLevelsForUsers(userIds, 'padel')`)
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1 : Écrire le test (échoue)** : un caller dont `preferredSport.key = 'tennis'` ⇒ les niveaux du picker sont calculés pour `'tennis'` (fallback `'padel'` si pas de préférence).

- [ ] **Step 2 : Lancer → échec** (`cd backend && npm test -- club.service`).

- [ ] **Step 3 : Implémenter**

Dans `searchMembers`, remplacer le `'padel'` codé en dur par le sport préféré du caller via `resolvePreferredSportKey(callerUserId)` (importé de `rating/preferredSport.ts`, Task 5.1). La signature publique reste inchangée.

```ts
const sportKey = await resolvePreferredSportKey(callerUserId);
const levels = await this.ratingService.getLevelsForUsers(userIds, sportKey);
```

- [ ] **Step 4 : Lancer → succès** ; **Step 5 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(rating): partner-picker au sport préféré du joueur (plus de padel en dur)"
```

---

## Vérification finale (après tous les lots)

- [ ] `cd backend && npm test` → tout vert.
- [ ] `cd frontend && npm test` → tout vert.
- [ ] `cd backend && npx tsc --noEmit` et `cd frontend && npx tsc --noEmit` → clean.
- [ ] Revue finale holistique end-to-end (cf. leçon récurrente du projet : les revues par-task manquent les bugs cross-layer — vérifier que les niveaux affichés correspondent bien au sport du contexte sur **chaque** surface, et que `preferredSport = null` reproduit le comportement actuel).
- [ ] Vérif visuelle navigateur (skill `verify`) : choisir un sport préféré, constater les défauts de filtres + le niveau par sport.
- [ ] Mémo déploiement : **2 migrations additives** (`add_user_preferred_sport`, `add_event_sport`) à appliquer au boot (`prisma migrate deploy`).

## Notes de périmètre (rappel spec)
- Match toujours = **4 joueurs** (pas de simple) → sports en simple : niveau par **calibrage** uniquement.
- `searchMembers` (partner-picker) : suit le **sport préféré du caller** (Task 5.5) ; pourra être affiné plus tard pour suivre le sport exact de la réservation en cours.
- Pas de prompt de calibrage forcé à l'inscription ; pas de dé-hardcodage des libellés « padel » cosmétiques.
