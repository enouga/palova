# Sections du Club-house configurables (admin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre aux admins de club de choisir quelles sections du Club-house sont affichées et dans quel ordre (drag-and-drop + ↑↓), via une colonne Json `Club.clubHouseSections` (null = ordre adaptatif actuel).

**Architecture:** Colonne Json additive normalisée côté backend (`normalizeClubHouseSections`, pattern `normalizeQuickPaymentMethods`), exposée dans les payloads public (`getClubBySlug` → `ClubDetail`) et admin (`getClubForAdmin`/`updateClub`). Côté page, helpers purs `resolveSections`/`hiddenSectionKeys` dans `lib/clubhouse.ts` (config null → les deux ordres adaptatifs historiques) ; les fetchs des sections masquées sont sautés. Côté admin, nouvelle carte `ClubHouseSectionsCard` dans `/admin/club` (drag natif HTML5 pattern `/admin/courts` + boutons ↑↓ + interrupteurs, persistance immédiate à chaque geste, reset → PATCH null).

**Tech Stack:** Express 5 + Prisma 7 (Json?), Next.js 16 + React 19, Jest (ts-jest sans type-check → tsc --noEmit en garde séparée).

**Spec:** `docs/superpowers/specs/2026-07-05-club-house-sections-configurables-design.md`

---

## ⚠️ Contexte d'exécution (à lire avant Task 1)

1. **Le repo principal porte du WIP utilisateur non commité** sur des fichiers que ce plan modifie (`backend/prisma/schema.prisma`, `backend/src/services/club.service.ts`, `backend/src/services/__tests__/club.service.test.ts`, `CLAUDE.md`…). **Recommandé : exécuter dans un worktree isolé** (mémoire `worktree-setup-palova` : junction `node_modules` depuis le repo principal, copie de `backend/.env` + `frontend/.env.local` ; baseline connue = 3 échecs `icon.routes`). Si exécution dans le repo principal : à CHAQUE commit, `git add` uniquement les fichiers listés par la task, puis `git diff --cached` — **si du WIP étranger apparaît dans le staged d'un fichier partagé, STOP et demander au user**.
2. **Shims npm cassés** (mémoire) : `npx jest`/`npx tsc` échouent. Utiliser directement `node node_modules/jest/bin/jest.js`, `node node_modules/typescript/bin/tsc`, `node node_modules/prisma/build/index.js`.
3. **Base dev en dérive** : jamais `prisma migrate dev` ni `db push`. Migration = dossier + SQL additif appliqué via `prisma db execute` (prod : `migrate deploy`).
4. Avant chaque commit : `git branch --show-current` doit répondre `main` (ou la branche du worktree) — le user change parfois de branche en parallèle.
5. La suite frontend complète a un flake connu BookingModal : vérifier par **suites scopées** uniquement.

---

### Task 1 : Migration + schéma Prisma

**Files:**
- Create: `backend/prisma/migrations/20260705140000_add_club_house_sections/migration.sql`
- Modify: `backend/prisma/schema.prisma` (modèle `Club`, après le bloc `bookingQuotas` ~ligne 271)

- [ ] **Step 1 : Écrire la migration SQL**

Créer `backend/prisma/migrations/20260705140000_add_club_house_sections/migration.sql` :

```sql
-- Sections du Club-house configurables par le club (ordre + visibilité).
-- null = ordre adaptatif par défaut (visiteur/membre).
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "club_house_sections" JSONB;
```

- [ ] **Step 2 : Ajouter la colonne au schéma**

Dans `backend/prisma/schema.prisma`, modèle `Club`, juste après la ligne `bookingQuotas    Json?      @map("booking_quotas")` :

```prisma
  // Sections du Club-house : ordre + visibilité choisis par l'admin, appliqués à tous.
  // Tableau ordonné [{ "key": "matches", "visible": true }, ...] — clés connues :
  // matches/agenda/posters/top/offers/clubCard/announcements + sponsors (visibilité
  // seule, position fixe en bas). null = ordre adaptatif par défaut (visiteur/membre).
  clubHouseSections Json? @map("club_house_sections")
```

- [ ] **Step 3 : Appliquer en DEV + régénérer le client**

```bash
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/prisma/build/index.js db execute --file prisma/migrations/20260705140000_add_club_house_sections/migration.sql --schema prisma/schema.prisma
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/prisma/build/index.js generate
```

Expected : `db execute` silencieux (ou « Script executed »), `generate` se termine sans erreur.

- [ ] **Step 4 : Commit**

```bash
git add backend/prisma/migrations/20260705140000_add_club_house_sections/migration.sql backend/prisma/schema.prisma
git diff --cached --stat   # vérifier : PAS de WIP étranger dans schema.prisma, sinon STOP
git commit -m "feat(club-house): colonne Club.clubHouseSections (migration additive)"
```

---

### Task 2 : Backend — normalizer + exposition (TDD)

**Files:**
- Modify: `backend/src/services/club.service.ts` (normalizer vers ~ligne 55 après `normalizeQuickPaymentMethods` ; selects `getClubBySlug` ~l.184 et `getClubForAdmin` ~l.261 ; `updateClub` params ~l.285 + data ~l.344)
- Test: `backend/src/services/__tests__/club.service.test.ts` (append en fin de fichier)

- [ ] **Step 1 : Écrire les tests (échouent)**

Ajouter en fin de `backend/src/services/__tests__/club.service.test.ts` :

```ts
describe('normalizeClubHouseSections', () => {
  const { normalizeClubHouseSections } = require('../club.service');
  const { Prisma } = require('@prisma/client');

  it('garde les entrées valides dans l\'ordre fourni et complète les clés manquantes en fin (visibles)', () => {
    expect(normalizeClubHouseSections([
      { key: 'top', visible: false },
      { key: 'matches', visible: true },
    ])).toEqual([
      { key: 'top', visible: false },
      { key: 'matches', visible: true },
      { key: 'agenda', visible: true },
      { key: 'posters', visible: true },
      { key: 'offers', visible: true },
      { key: 'clubCard', visible: true },
      { key: 'announcements', visible: true },
      { key: 'sponsors', visible: true },
    ]);
  });

  it('rejette les clés inconnues et dédoublonne (première occurrence gagne)', () => {
    const out = normalizeClubHouseSections([
      { key: 'hero', visible: false },
      { key: 'matches', visible: false },
      { key: 'matches', visible: true },
      'nimporte',
    ]) as { key: string; visible: boolean }[];
    expect(out.find((e) => e.key === 'matches')).toEqual({ key: 'matches', visible: false });
    expect(out.some((e) => e.key === 'hero')).toBe(false);
    expect(out).toHaveLength(8);
  });

  it('visible absent ou non-false → true', () => {
    const out = normalizeClubHouseSections([{ key: 'agenda' }]) as { key: string; visible: boolean }[];
    expect(out[0]).toEqual({ key: 'agenda', visible: true });
  });

  it('non-tableau ou rien de valide → DbNull (reset)', () => {
    expect(normalizeClubHouseSections(null)).toBe(Prisma.DbNull);
    expect(normalizeClubHouseSections('x')).toBe(Prisma.DbNull);
    expect(normalizeClubHouseSections([])).toBe(Prisma.DbNull);
    expect(normalizeClubHouseSections([{ key: 'inconnu', visible: true }])).toBe(Prisma.DbNull);
  });
});

describe('ClubService — sections du Club-house', () => {
  let svc: ClubService;
  beforeEach(() => { svc = new ClubService(); });

  it('updateClub écrit la config normalisée (complète, clés inconnues rejetées)', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { clubHouseSections: [{ key: 'top', visible: false }, { key: 'nope', visible: true }] } as any);
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.clubHouseSections[0]).toEqual({ key: 'top', visible: false });
    expect(arg.data.clubHouseSections).toHaveLength(8);
    expect((arg.data.clubHouseSections as any[]).some((e) => e.key === 'nope')).toBe(false);
  });

  it('updateClub null → DbNull (retour à l\'ordre adaptatif)', async () => {
    const { Prisma } = require('@prisma/client');
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { clubHouseSections: null } as any);
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.clubHouseSections).toBe(Prisma.DbNull);
  });

  it('getClubBySlug expose clubHouseSections', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ status: 'ACTIVE', clubSports: [] } as any);
    await svc.getClubBySlug('demo');
    const arg = (prismaMock.club.findUnique as jest.Mock).mock.calls[0][0];
    expect(arg.select.clubHouseSections).toBe(true);
  });

  it('getClubForAdmin expose clubHouseSections', async () => {
    prismaMock.club.findUniqueOrThrow.mockResolvedValue({} as any);
    await svc.getClubForAdmin('club-1');
    const arg = (prismaMock.club.findUniqueOrThrow as jest.Mock).mock.calls[0][0];
    expect(arg.select.clubHouseSections).toBe(true);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

```bash
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts
```

Expected : FAIL — `normalizeClubHouseSections is not a function` + selects sans `clubHouseSections`.

- [ ] **Step 3 : Implémenter le normalizer**

Dans `backend/src/services/club.service.ts`, juste après `normalizeQuickPaymentMethods` (~ligne 55) :

```ts
/** Clés de sections du Club-house configurables par le club (ordre + visibilité). */
const CLUB_HOUSE_SECTION_KEYS = ['matches', 'agenda', 'posters', 'top', 'offers', 'clubCard', 'announcements', 'sponsors'] as const;

/** Valide/normalise la config des sections du Club-house. null/invalide → DbNull (= ordre
 *  adaptatif par défaut). Clé inconnue rejetée, doublon ignoré (1re occurrence gagne),
 *  clés connues manquantes complétées en fin (visibles) → la config stockée est toujours
 *  complète. Miroir lecture : frontend/lib/clubhouse.ts (resolveSections). */
export function normalizeClubHouseSections(input: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!Array.isArray(input)) return Prisma.DbNull;
  const allowed = new Set<string>(CLUB_HOUSE_SECTION_KEYS);
  const seen = new Set<string>();
  const out: { key: string; visible: boolean }[] = [];
  for (const e of input) {
    const key = (e as { key?: unknown } | null)?.key;
    if (typeof key !== 'string' || !allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, visible: (e as { visible?: unknown }).visible !== false });
  }
  if (out.length === 0) return Prisma.DbNull;
  for (const key of CLUB_HOUSE_SECTION_KEYS) if (!seen.has(key)) out.push({ key, visible: true });
  return out as unknown as Prisma.InputJsonValue;
}
```

- [ ] **Step 4 : Brancher selects + updateClub**

Toujours dans `club.service.ts` :

1. **`getClubBySlug`** : dans le `select`, après `refundOnCancelWithinCutoff: true,` ajouter :
```ts
        clubHouseSections: true,
```
2. **`getClubForAdmin`** : dans le `select`, après `quickPaymentMethods: true,` ajouter :
```ts
        clubHouseSections: true,
```
3. **`updateClub`** : dans l'interface des params, après `quickPaymentMethods?: string[];` ajouter :
```ts
    clubHouseSections?: unknown;
```
   et dans le `data` du `prisma.club.update`, après la ligne `quickPaymentMethods` :
```ts
        ...(params.clubHouseSections !== undefined ? { clubHouseSections: normalizeClubHouseSections(params.clubHouseSections) } : {}),
```

Aucune modification de route : `PATCH /api/clubs/:clubId/admin` relaie déjà `req.body` entier à `updateClub`.

- [ ] **Step 5 : Vérifier le passage**

```bash
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts
```

Expected : PASS (toute la suite).

- [ ] **Step 6 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git diff --cached --stat   # si du WIP étranger est stagé (fichiers déjà modifiés avant nous) → STOP, demander au user
git commit -m "feat(club-house): normalizeClubHouseSections + exposition public/admin/updateClub"
```

---

### Task 3 : Front — types api.ts + helpers purs lib/clubhouse.ts (TDD)

**Files:**
- Modify: `frontend/lib/api.ts` (types près de `ClubDetail` ~l.1129, `ClubAdminDetail` ~l.1388, `UpdateClubBody` ~l.1486)
- Modify: `frontend/lib/clubhouse.ts` (helpers en fin de fichier + import)
- Test: `frontend/__tests__/clubhouse.test.ts`

- [ ] **Step 1 : Ajouter les types dans `lib/api.ts`**

Juste avant `export interface ClubDetail {` :

```ts
// Sections du Club-house configurables par le club (ordre + visibilité).
// 'sponsors' = visibilité seule (position fixe en bas de page).
export type ClubHouseSectionKey = 'matches' | 'agenda' | 'posters' | 'top' | 'offers' | 'clubCard' | 'announcements' | 'sponsors';
export interface ClubHouseSectionSetting { key: ClubHouseSectionKey; visible: boolean; }
```

Dans `ClubDetail`, après `refundOnCancelWithinCutoff: boolean;` (champ **optionnel** — tolérance backend pas encore déployé) :

```ts
  clubHouseSections?: ClubHouseSectionSetting[] | null; // null/absent = ordre adaptatif par défaut
```

Dans `ClubAdminDetail`, après `quickPaymentMethods: PaymentMethod[];` :

```ts
  clubHouseSections?: ClubHouseSectionSetting[] | null;
```

Dans `UpdateClubBody` (à l'intérieur du `Partial<{ … }>`), après `quickPaymentMethods: PaymentMethod[];` :

```ts
  clubHouseSections: ClubHouseSectionSetting[] | null;
```

- [ ] **Step 2 : Écrire les tests helpers (échouent)**

Dans `frontend/__tests__/clubhouse.test.ts`, ajouter aux imports existants du module `lib/clubhouse` : `resolveSections`, `hiddenSectionKeys`, `fullSectionSettings`, `SECTION_DEFS`, `SECTION_KEYS`, `SPONSORS_DEF` (fusionner dans l'import existant, même chemin), plus :

```ts
import type { ClubHouseSectionSetting } from '@/lib/api';
```

(adapter `@/lib/api` au style d'import du fichier : si le fichier importe en relatif, utiliser `../lib/api`). Puis ajouter en fin de fichier :

```ts
describe('resolveSections', () => {
  it('config null → ordres adaptatifs historiques (membre ≠ visiteur), sponsors visibles', () => {
    expect(resolveSections(null, true).order).toEqual(['matches', 'agenda', 'posters', 'top', 'offers', 'clubCard', 'announcements']);
    expect(resolveSections(null, false).order).toEqual(['matches', 'clubCard', 'agenda', 'posters', 'offers', 'top', 'announcements']);
    expect(resolveSections(undefined, false).sponsorsVisible).toBe(true);
  });

  it('config custom → même ordre pour tous, sections masquées exclues, sponsorsVisible', () => {
    const config: ClubHouseSectionSetting[] = [
      { key: 'top', visible: true },
      { key: 'matches', visible: false },
      { key: 'agenda', visible: true },
      { key: 'posters', visible: true },
      { key: 'offers', visible: true },
      { key: 'clubCard', visible: true },
      { key: 'announcements', visible: true },
      { key: 'sponsors', visible: false },
    ];
    const member = resolveSections(config, true);
    const visitor = resolveSections(config, false);
    expect(member.order).toEqual(visitor.order);
    expect(member.order[0]).toBe('top');
    expect(member.order).not.toContain('matches');
    expect(member.order).not.toContain('sponsors');
    expect(member.sponsorsVisible).toBe(false);
  });

  it('clé connue absente de la config → ajoutée en fin, visible (tolérance versions)', () => {
    const { order } = resolveSections([{ key: 'announcements', visible: true }], true);
    expect(order[0]).toBe('announcements');
    expect(order).toHaveLength(7);
  });

  it('clé inconnue ignorée', () => {
    const { order } = resolveSections([{ key: 'hero', visible: true } as never, { key: 'top', visible: true }], true);
    expect(order[0]).toBe('top');
    expect(order).not.toContain('hero');
  });
});

describe('hiddenSectionKeys', () => {
  it('null → rien de masqué', () => {
    expect(hiddenSectionKeys(null).size).toBe(0);
  });

  it('sections masquées + sponsors ; clés complétées = visibles', () => {
    const hidden = hiddenSectionKeys([
      { key: 'top', visible: false },
      { key: 'sponsors', visible: false },
    ]);
    expect(hidden.has('top')).toBe(true);
    expect(hidden.has('sponsors')).toBe(true);
    expect(hidden.has('matches')).toBe(false);
  });
});

describe('fullSectionSettings / SECTION_DEFS', () => {
  it('null → 8 entrées visibles, ordre par défaut membre + sponsors en fin', () => {
    const full = fullSectionSettings(null);
    expect(full).toHaveLength(8);
    expect(full[0]).toEqual({ key: 'matches', visible: true });
    expect(full[7].key).toBe('sponsors');
    expect(full.every((e) => e.visible)).toBe(true);
  });

  it('config partielle → complétée sans doublon, 1re occurrence gagne', () => {
    const full = fullSectionSettings([{ key: 'top', visible: false }, { key: 'top', visible: true }]);
    expect(full).toHaveLength(8);
    expect(full[0]).toEqual({ key: 'top', visible: false });
  });

  it('SECTION_DEFS + sponsors couvrent exactement SECTION_KEYS', () => {
    expect([...SECTION_DEFS.map((d) => d.key), SPONSORS_DEF.key].sort()).toEqual([...SECTION_KEYS].sort());
  });
});
```

- [ ] **Step 3 : Vérifier l'échec**

```bash
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/clubhouse.test.ts
```

Expected : FAIL — `resolveSections` (etc.) non exportés.

- [ ] **Step 4 : Implémenter les helpers**

Dans `frontend/lib/clubhouse.ts` : étendre l'import de tête `import { Announcement, ClubAvailability, Sponsor, TimeSlot, Tournament } from '@/lib/api';` avec `ClubHouseSectionKey, ClubHouseSectionSetting`, puis ajouter en fin de fichier :

```ts
// --- Sections configurables du Club-house (miroir écriture : backend normalizeClubHouseSections) ---

/** Toutes les clés de sections. */
export const SECTION_KEYS: ClubHouseSectionKey[] = ['matches', 'agenda', 'posters', 'top', 'offers', 'clubCard', 'announcements', 'sponsors'];

/** Libellés admin des sections réordonnables (l'ordre ici = ordre par défaut membre). */
export const SECTION_DEFS: { key: ClubHouseSectionKey; label: string; hint?: string }[] = [
  { key: 'matches', label: 'Ça joue bientôt', hint: 'Parties ouvertes qui cherchent des joueurs' },
  { key: 'agenda', label: 'Prochains events & vos réservations' },
  { key: 'posters', label: 'À l’affiche', hint: 'Annonces avec image (mosaïque)' },
  { key: 'top', label: 'Top du mois', hint: 'Podium des victoires du mois' },
  { key: 'offers', label: 'Offres du club', hint: 'Dépend aussi de « Vendre les offres en ligne » (Réglages)' },
  { key: 'clubCard', label: 'Le club', hint: 'Présentation et photos' },
  { key: 'announcements', label: 'Annonces', hint: 'Annonces sans image (liste)' },
];

/** La rivière partenaires : visibilité configurable, position fixe en bas de page. */
export const SPONSORS_DEF: { key: ClubHouseSectionKey; label: string; hint: string } =
  { key: 'sponsors', label: 'Partenaires', hint: 'Rivière de logos' };

const MEMBER_ORDER: ClubHouseSectionKey[] = ['matches', 'agenda', 'posters', 'top', 'offers', 'clubCard', 'announcements'];
const VISITOR_ORDER: ClubHouseSectionKey[] = ['matches', 'clubCard', 'agenda', 'posters', 'offers', 'top', 'announcements'];

/** Ordre + visibilité effectifs. config null → ordre adaptatif historique (visiteur/membre) ;
 *  sinon la config s'applique à tous. Clé inconnue ignorée, clé connue absente ajoutée en
 *  fin visible (une section livrée après la sauvegarde de la config s'affiche quand même). */
export function resolveSections(
  config: ClubHouseSectionSetting[] | null | undefined,
  isMember: boolean,
): { order: ClubHouseSectionKey[]; sponsorsVisible: boolean } {
  if (!Array.isArray(config) || config.length === 0) {
    return { order: isMember ? MEMBER_ORDER : VISITOR_ORDER, sponsorsVisible: true };
  }
  const seen = new Set<string>();
  const order: ClubHouseSectionKey[] = [];
  let sponsorsVisible = true;
  for (const e of config) {
    const key = e?.key as ClubHouseSectionKey | undefined;
    if (!key || seen.has(key) || !SECTION_KEYS.includes(key)) continue;
    seen.add(key);
    if (key === 'sponsors') { sponsorsVisible = e.visible !== false; continue; }
    if (e.visible !== false) order.push(key);
  }
  for (const key of SECTION_KEYS) {
    if (key !== 'sponsors' && !seen.has(key)) order.push(key);
  }
  return { order, sponsorsVisible };
}

/** Clés masquées par la config (sert à sauter les fetchs inutiles). null → rien de masqué. */
export function hiddenSectionKeys(config: ClubHouseSectionSetting[] | null | undefined): Set<ClubHouseSectionKey> {
  const { order, sponsorsVisible } = resolveSections(config, true); // la visibilité ne dépend pas de l'audience
  const hidden = new Set<ClubHouseSectionKey>();
  for (const key of SECTION_KEYS) {
    if (key === 'sponsors') { if (!sponsorsVisible) hidden.add(key); }
    else if (!order.includes(key)) hidden.add(key);
  }
  return hidden;
}

/** Liste complète (8 entrées) pour l'éditeur admin : config complétée ; null → défaut membre + sponsors en fin. */
export function fullSectionSettings(config: ClubHouseSectionSetting[] | null | undefined): ClubHouseSectionSetting[] {
  if (!Array.isArray(config) || config.length === 0) {
    return [...MEMBER_ORDER, 'sponsors' as ClubHouseSectionKey].map((key) => ({ key, visible: true }));
  }
  const seen = new Set<string>();
  const out: ClubHouseSectionSetting[] = [];
  for (const e of config) {
    const key = e?.key as ClubHouseSectionKey | undefined;
    if (!key || seen.has(key) || !SECTION_KEYS.includes(key)) continue;
    seen.add(key);
    out.push({ key, visible: e.visible !== false });
  }
  for (const key of SECTION_KEYS) if (!seen.has(key)) out.push({ key, visible: true });
  return out;
}
```

- [ ] **Step 5 : Vérifier le passage**

```bash
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/clubhouse.test.ts
```

Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
git add frontend/lib/api.ts frontend/lib/clubhouse.ts frontend/__tests__/clubhouse.test.ts
git diff --cached --stat
git commit -m "feat(club-house): types ClubHouseSectionSetting + helpers resolveSections/hiddenSectionKeys/fullSectionSettings"
```

---

### Task 4 : Rendu ClubHouse — ordre custom + fetchs sautés (TDD)

**Files:**
- Modify: `frontend/components/ClubHouse.tsx`
- Test: `frontend/__tests__/ClubHouse.test.tsx`

- [ ] **Step 1 : Écrire les tests (échouent)**

Dans `frontend/__tests__/ClubHouse.test.tsx`, ajouter après la définition de `wrap` (~ligne 42) :

```tsx
const clubWith = (sections: unknown) =>
  ({ ...(club as unknown as Record<string, unknown>), clubHouseSections: sections }) as never;
const wrapWith = (c: never) => render(<ThemeProvider><ClubHouse club={c} /></ThemeProvider>);
```

Puis, dans le `describe('ClubHouse', …)`, ajouter en fin :

```tsx
  it('config custom : ordre appliqué, section masquée absente et fetch sauté', async () => {
    fullSections();
    wrapWith(clubWith([
      { key: 'top', visible: true },
      { key: 'clubCard', visible: true },
      { key: 'matches', visible: false },
      { key: 'agenda', visible: true },
      { key: 'posters', visible: true },
      { key: 'offers', visible: true },
      { key: 'announcements', visible: true },
      { key: 'sponsors', visible: true },
    ]));
    await waitFor(() => expect(screen.getByTestId('sec-top')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('sec-club')).toBeInTheDocument());
    const ids = screen.getAllByTestId(/^sec-/).map((el) => el.getAttribute('data-testid'));
    expect(ids.indexOf('sec-top')).toBeLessThan(ids.indexOf('sec-club'));
    expect(screen.queryByTestId('sec-matches')).not.toBeInTheDocument();
    expect(mocked.getOpenMatches).not.toHaveBeenCalled();
  });

  it('sponsors masqués : rivière absente, fetch sponsors sauté ; clés manquantes complétées visibles', async () => {
    fullSections();
    wrapWith(clubWith([{ key: 'sponsors', visible: false }]));
    await waitFor(() => expect(screen.getByTestId('sec-top')).toBeInTheDocument());
    expect(screen.queryByTestId('sec-sponsors')).not.toBeInTheDocument();
    expect(mocked.getClubSponsors).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2 : Vérifier l'échec**

```bash
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/ClubHouse.test.tsx
```

Expected : FAIL — `sec-matches`/`sec-sponsors` présents, fetchs appelés.

- [ ] **Step 3 : Implémenter dans `ClubHouse.tsx`**

1. Ligne 2 : ajouter `useMemo` → `import { useCallback, useEffect, useMemo, useState } from 'react';`
2. Ligne 8 : étendre l'import de `@/lib/clubhouse` avec `resolveSections, hiddenSectionKeys`.
3. Après le `useEffect` de l'horloge (`clock`), ajouter :
```ts
  // Sections masquées par la config admin : leurs fetchs sont sautés (annonces et dispo
  // restent inconditionnels — le hero et sa chip « Prochain créneau » en dépendent).
  const hidden = useMemo(() => hiddenSectionKeys(club.clubHouseSections), [club.clubHouseSections]);
```
4. Garder **inchangés** les effets `getClubAnnouncements` et `getClubAvailability`. Remplacer les autres effets de chargement par :
```ts
  useEffect(() => {
    if (hidden.has('sponsors')) return;
    api.getClubSponsors(club.slug).then(setSpons).catch(() => setSpons([]));
  }, [club.slug, hidden]);
  useEffect(() => {
    if (hidden.has('agenda')) return;
    api.getClubTournaments(club.slug).then(setTournaments).catch(() => setTournaments([]));
  }, [club.slug, hidden]);
  useEffect(() => {
    if (hidden.has('agenda')) return;
    api.getClubEvents(club.slug).then(setEvents).catch(() => setEvents([]));
  }, [club.slug, hidden]);
  useEffect(() => {
    if (hidden.has('clubCard')) return;
    api.getClubPresentation(club.slug).then(setPresentation).catch(() => setPresentation(null));
  }, [club.slug, hidden]);
  useEffect(() => {
    if (hidden.has('offers')) return;
    api.getClubOffers(club.slug).then(setOffers).catch(() => setOffers(null));
  }, [club.slug, hidden]);
  useEffect(() => {
    if (hidden.has('top')) return;
    api.getClubTopMonth(club.slug).then(setTopMonth).catch(() => setTopMonth([]));
  }, [club.slug, hidden]);
  useEffect(() => {
    if (!token || hidden.has('offers')) { setHasSub(false); return; }
    api.getMyClubSubscriptions(club.slug, token).then((subs) => setHasSub(subs.length > 0)).catch(() => setHasSub(false));
  }, [club.slug, token, hidden]);
```
5. L'effet « Vos réservations » devient :
```ts
  useEffect(() => { if (ready && token && !hidden.has('agenda')) loadNext(); }, [ready, token, loadNext, hidden]);
```
6. L'effet parties ouvertes devient :
```ts
  useEffect(() => {
    if (!ready || hidden.has('matches')) return;
    api.getOpenMatches(club.slug, token ?? undefined).then(setOpenMatches).catch(() => setOpenMatches([]));
  }, [club.slug, token, ready, hidden]);
```
7. Remplacer le ternaire `const order = token ? […] : […];` (lignes ~183-185) par :
```ts
  // Config admin (Club.clubHouseSections) : un seul ordre pour tous ; null → ordre adaptatif.
  const { order, sponsorsVisible } = resolveSections(club.clubHouseSections, !!token);
```
8. Remplacer `<SponsorMarquee sponsors={spons} now={clock} />` par :
```tsx
      {sponsorsVisible && <SponsorMarquee sponsors={spons} now={clock} />}
```

- [ ] **Step 4 : Vérifier le passage (nouveaux cas + non-régression des cas d'ordre existants)**

```bash
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/ClubHouse.test.tsx
```

Expected : PASS (les cas « visiteur : parties en tête… » et « membre : … » couvrent le repli config null).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/ClubHouse.tsx frontend/__tests__/ClubHouse.test.tsx
git diff --cached --stat
git commit -m "feat(club-house): ordre/visibilite des sections pilotes par la config club (fetchs des sections masquees sautes)"
```

---

### Task 5 : Carte admin « Sections du Club-house » dans /admin/club (TDD)

**Files:**
- Create: `frontend/components/admin/ClubHouseSectionsCard.tsx`
- Modify: `frontend/app/admin/club/page.tsx` (import + rendu après la carte Galerie)
- Test: `frontend/__tests__/AdminClub.test.tsx`

- [ ] **Step 1 : Écrire les tests (échouent)**

Dans `frontend/__tests__/AdminClub.test.tsx` :

1. Compléter le mock `api` (dans le `jest.mock('@/lib/api', …)`) avec :
```ts
    adminGetClub: jest.fn().mockResolvedValue({ clubHouseSections: null }),
    adminUpdateClub: jest.fn().mockResolvedValue({}),
```
2. Ajouter au début du `describe('/admin/club', …)` :
```ts
  beforeEach(() => { jest.clearAllMocks(); });
```
   (`clearAllMocks` garde les implémentations `mockResolvedValue` posées au niveau module — il ne vide que l'historique d'appels.)
3. Ajouter les tests :

```tsx
  it('carte Sections : lignes + Partenaires ; masquer une section → PATCH liste complète', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Sections du Club-house')).toBeInTheDocument());
    expect(screen.getByText('Ça joue bientôt')).toBeInTheDocument();
    expect(screen.getByText('Partenaires')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Afficher Top du mois'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalled());
    const body = (api.adminUpdateClub as jest.Mock).mock.calls[0][1];
    expect(body.clubHouseSections).toHaveLength(8);
    expect(body.clubHouseSections.find((s: { key: string }) => s.key === 'top')).toEqual({ key: 'top', visible: false });
  });

  it('carte Sections : ↓ sur la première ligne → ordre permuté dans le PATCH', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Sections du Club-house')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Descendre Ça joue bientôt'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalled());
    const body = (api.adminUpdateClub as jest.Mock).mock.calls[0][1];
    expect(body.clubHouseSections[0].key).toBe('agenda');
    expect(body.clubHouseSections[1].key).toBe('matches');
  });

  it('carte Sections : config personnalisée → Réinitialiser → ConfirmDialog → PATCH null', async () => {
    (api.adminGetClub as jest.Mock).mockResolvedValueOnce({ clubHouseSections: [{ key: 'top', visible: false }] });
    wrap();
    await waitFor(() => expect(screen.getByText('Réinitialiser l’ordre par défaut')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Réinitialiser l’ordre par défaut'));
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith('c1', { clubHouseSections: null }, 't'));
    await waitFor(() => expect(screen.queryByText('Réinitialiser l’ordre par défaut')).not.toBeInTheDocument());
  });
```

⚠️ Apostrophe typographique `’` dans « Réinitialiser l’ordre par défaut » — identique au composant.

- [ ] **Step 2 : Vérifier l'échec**

```bash
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/AdminClub.test.tsx
```

Expected : FAIL — « Sections du Club-house » introuvable.

- [ ] **Step 3 : Créer `frontend/components/admin/ClubHouseSectionsCard.tsx`**

```tsx
'use client';
import { useCallback, useEffect, useState, CSSProperties } from 'react';
import { api, ClubHouseSectionKey, ClubHouseSectionSetting } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { fullSectionSettings, SECTION_DEFS, SPONSORS_DEF } from '@/lib/clubhouse';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

// Carte « Sections du Club-house » : visibilité + ordre des sections de la landing du club.
// Drag natif HTML5 (pattern /admin/courts) + boutons ↑↓ (mobile/accessibilité) + interrupteurs.
// Persistance immédiate à chaque geste (état optimiste, erreur → recharge serveur).
// Reset → PATCH clubHouseSections: null (retour à l'ordre adaptatif visiteur/membre).
export function ClubHouseSectionsCard({ clubId, token }: { clubId: string; token: string }) {
  const { th } = useTheme();
  const [items, setItems] = useState<ClubHouseSectionSetting[] | null>(null); // null = chargement
  const [customized, setCustomized] = useState(false);
  const [dragKey, setDragKey] = useState<ClubHouseSectionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    try {
      const club = await api.adminGetClub(clubId, token);
      setItems(fullSectionSettings(club.clubHouseSections));
      setCustomized(club.clubHouseSections != null);
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [clubId, token]);

  useEffect(() => { load(); }, [load]);

  // Persiste la liste complète (8 entrées) ; optimiste, recharge l'état serveur si échec.
  const persist = async (next: ClubHouseSectionSetting[]) => {
    setItems(next);
    setCustomized(true);
    try { setError(null); await api.adminUpdateClub(clubId, { clubHouseSections: next }, token); }
    catch (e) { setError((e as Error).message); await load(); }
  };

  if (!items) return null;

  const rows = items.filter((s) => s.key !== 'sponsors');
  const sponsors = items.find((s) => s.key === 'sponsors') ?? { key: 'sponsors' as ClubHouseSectionKey, visible: true };
  const rebuild = (nextRows: ClubHouseSectionSetting[], nextSponsors = sponsors) => [...nextRows, nextSponsors];

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...rows];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    persist(rebuild(next));
  };

  const onDropRow = (targetKey: ClubHouseSectionKey) => {
    if (!dragKey || dragKey === targetKey) { setDragKey(null); return; }
    const next = [...rows];
    const from = next.findIndex((r) => r.key === dragKey);
    const to = next.findIndex((r) => r.key === targetKey);
    setDragKey(null);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persist(rebuild(next));
  };

  const toggle = (key: ClubHouseSectionKey) => {
    if (key === 'sponsors') { persist(rebuild(rows, { key, visible: !sponsors.visible })); return; }
    persist(rebuild(rows.map((r) => (r.key === key ? { ...r, visible: !r.visible } : r))));
  };

  const reset = async () => {
    setConfirmReset(false);
    try {
      setError(null);
      await api.adminUpdateClub(clubId, { clubHouseSections: null }, token);
      setItems(fullSectionSettings(null));
      setCustomized(false);
    } catch (e) { setError((e as Error).message); }
  };

  const defs = new Map<ClubHouseSectionKey, { label: string; hint?: string }>(
    [...SECTION_DEFS, SPONSORS_DEF].map((d) => [d.key, d]),
  );
  const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: `1px solid ${th.line}`, background: th.bg };
  const arrowStyle = (disabled: boolean): CSSProperties => ({
    border: `1px solid ${th.line}`, background: 'transparent', cursor: disabled ? 'default' : 'pointer',
    borderRadius: 8, padding: '4px 9px', fontFamily: th.fontUI, fontSize: 12.5, color: disabled ? th.textFaint : th.text,
  });
  const toggleLabel: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, cursor: 'pointer', whiteSpace: 'nowrap' };

  return (
    <div style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 16 }}>
      <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, margin: '0 0 4px', color: th.text }}>Sections du Club-house</h2>
      <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, margin: '0 0 14px', lineHeight: 1.5 }}>
        Choisissez les sections affichées sur la page d’accueil et leur ordre (glissez, ou ↑↓).
        Le bandeau « À la une » est toujours en tête de page.
        {!customized && ' Par défaut, l’ordre s’adapte automatiquement (visiteur / membre) ; dès que vous personnalisez, le même ordre s’applique à tous.'}
      </p>
      {error && <div style={{ marginBottom: 12, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '10px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((s, idx) => {
          const def = defs.get(s.key);
          return (
            <div key={s.key} onDragOver={(e) => e.preventDefault()} onDrop={() => onDropRow(s.key)}
              style={{ ...rowStyle, opacity: dragKey === s.key ? 0.4 : (s.visible ? 1 : 0.55) }}>
              <span draggable onDragStart={() => setDragKey(s.key)} onDragEnd={() => setDragKey(null)}
                title="Glisser pour réordonner" style={{ cursor: 'grab', display: 'flex' }}>
                <Icon name="grip" size={18} color={th.textFaint} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text }}>{def?.label}</div>
                {def?.hint && <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>{def.hint}</div>}
              </div>
              <button onClick={() => move(idx, -1)} disabled={idx === 0} aria-label={`Monter ${def?.label}`} style={arrowStyle(idx === 0)}>↑</button>
              <button onClick={() => move(idx, 1)} disabled={idx === rows.length - 1} aria-label={`Descendre ${def?.label}`} style={arrowStyle(idx === rows.length - 1)}>↓</button>
              <label style={toggleLabel}>
                <input type="checkbox" checked={s.visible} onChange={() => toggle(s.key)} aria-label={`Afficher ${def?.label}`} />
                Afficher
              </label>
            </div>
          );
        })}
        <div style={{ ...rowStyle, opacity: sponsors.visible ? 1 : 0.55 }}>
          <span style={{ width: 18 }} aria-hidden />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text }}>{SPONSORS_DEF.label}</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>{SPONSORS_DEF.hint} — toujours en bas de page</div>
          </div>
          <label style={toggleLabel}>
            <input type="checkbox" checked={sponsors.visible} onChange={() => toggle('sponsors')} aria-label="Afficher Partenaires" />
            Afficher
          </label>
        </div>
      </div>
      {customized && (
        <button onClick={() => setConfirmReset(true)}
          style={{ marginTop: 12, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.accent, padding: 0 }}>
          Réinitialiser l’ordre par défaut
        </button>
      )}
      {confirmReset && (
        <ConfirmDialog
          title="Réinitialiser les sections ?"
          message="La page retrouvera l’ordre automatique (adapté visiteur / membre) avec toutes les sections affichées."
          confirmLabel="Réinitialiser"
          cancelLabel="Retour"
          onConfirm={reset}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4 : Monter la carte dans `frontend/app/admin/club/page.tsx`**

1. Ajouter l'import :
```tsx
import { ClubHouseSectionsCard } from '@/components/admin/ClubHouseSectionsCard';
```
2. Juste après le `</div>` fermant la carte Galerie (avant le bloc `{confirmDelete && …}`) :
```tsx
      {token && clubId && <ClubHouseSectionsCard clubId={clubId} token={token} />}
```

- [ ] **Step 5 : Vérifier le passage**

```bash
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/AdminClub.test.tsx
```

Expected : PASS (les 2 anciens tests + les 3 nouveaux).

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/admin/ClubHouseSectionsCard.tsx frontend/app/admin/club/page.tsx frontend/__tests__/AdminClub.test.tsx
git diff --cached --stat
git commit -m "feat(club-house): carte admin Sections du Club-house (drag natif + fleches + interrupteurs, reset)"
```

---

### Task 6 : Vérifications finales + doc

**Files:**
- Modify: `CLAUDE.md` (section « Club-house v2 » — nouvelle évolution)

- [ ] **Step 1 : Type-check des deux côtés (garde séparée — jest ne type-check pas)**

```bash
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/typescript/bin/tsc --noEmit
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/typescript/bin/tsc --noEmit
```

Expected : 0 erreur **dans les fichiers touchés par ce plan** (`club.service.ts`, `api.ts`, `clubhouse.ts`, `ClubHouse.tsx`, `ClubHouseSectionsCard.tsx`, `admin/club/page.tsx`, tests). Des erreurs dans d'autres fichiers = WIP parallèle du user → les signaler sans les corriger.

- [ ] **Step 2 : Suites scopées (non-régression)**

```bash
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts
cd /c/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/clubhouse.test.ts __tests__/ClubHouse.test.tsx __tests__/AdminClub.test.tsx __tests__/ClubHouseHero.test.tsx
```

Expected : PASS partout.

- [ ] **Step 3 : Smoke test manuel (optionnel mais recommandé)**

Backend + frontend démarrés (`start.ps1` ou manuel) :
1. `/admin/club` (club `padel-arena-paris`, `test@palova.fr`/`password123` doit être staff — sinon compte gérant du seed) → la carte « Sections du Club-house » liste 7 lignes + Partenaires.
2. Masquer « Top du mois », glisser « À l’affiche » en premier → recharger la racine du sous-domaine club : ordre appliqué, section absente.
3. « Réinitialiser l’ordre par défaut » → la page retrouve l'ordre adaptatif.

- [ ] **Step 4 : Documenter dans CLAUDE.md**

Dans la section « Club-house v2 … », ajouter à la suite des évolutions :

```markdown
> **Évolution (2026-07-05) — sections configurables par l'admin :** colonne Json additive **`Club.clubHouseSections`** (migration `add_club_house_sections`, null = ordre adaptatif visiteur/membre historique) : tableau ordonné `[{ key, visible }]` sur 8 clés (`matches/agenda/posters/top/offers/clubCard/announcements` + `sponsors` visibilité seule, position fixe en bas ; hero toujours affiché). Backend `normalizeClubHouseSections` (clés inconnues rejetées, doublons dédupliqués, clés manquantes complétées en fin visibles — config stockée toujours complète), exposée dans `getClubBySlug`/`getClubForAdmin`/`updateClub` (PATCH admin existant, aucune route nouvelle). Front : helpers purs `resolveSections`/`hiddenSectionKeys`/`fullSectionSettings` + `SECTION_DEFS` dans `lib/clubhouse.ts` ; `ClubHouse.tsx` applique l'ordre custom (un seul ordre pour tous dès personnalisation) et **saute les fetchs des sections masquées** (annonces + dispo restent inconditionnels pour le hero ; section parties masquée → chip pouls « parties » absente, cohérent). Admin : carte « Sections du Club-house » dans `/admin/club` (`components/admin/ClubHouseSectionsCard.tsx`, drag natif pattern `/admin/courts` + boutons ↑↓ mobile + interrupteurs, persistance immédiate, « Réinitialiser » → PATCH null). `offers` se cumule avec `showOffersPublicly` (Réglages). Tests : `club.service.test` (normalizer + selects), `clubhouse.test` (helpers), `ClubHouse.test` (ordre custom, fetch sauté), `AdminClub.test` (toggle/réordre/reset). Spec & plan : `docs/superpowers/{specs,plans}/2026-07-05-club-house-sections-configurables*`.
```

- [ ] **Step 5 : Commit final**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-07-05-club-house-sections-configurables.md
git diff --cached --stat   # CLAUDE.md est déjà dirty (WIP user) → si le diff stagé contient autre chose que notre bloc, STOP et demander au user
git commit -m "docs(club-house): sections configurables par l'admin — doc + plan"
```

---

## Rappels prod (au déploiement)

- `prisma migrate deploy` appliquera `20260705140000_add_club_house_sections` (SQL additif `IF NOT EXISTS`, sans risque).
- Aucune variable d'env, aucun volume, aucune route nouvelle.
