# Lien vivant — carte OG dynamique du partage de partie : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'aperçu WhatsApp d'un lien de partie ouverte devient une carte-image 1200×630 de l'état réel du match (équipes G/D, avatars, places restantes, niveau, couleurs du club), avec URL de partage versionnée par état pour contourner le cache des crawlers.

**Architecture:** Un service backend de rendu sharp (`matchCard.service.ts`, calqué sur `icon.service.ts` : cache disque par hash d'état, repli PNG embarqué, jamais de 500) derrière une route publique `card.png`. Le hash d'état (`cardVersion`) est calculé par un module pur, exposé dans le DTO des parties, et consommé côté front pour versionner l'`og:image` et l'URL de partage (`?s=`). Aucune migration.

**Tech Stack:** Express 5, Prisma 7 (mocks jest existants), sharp (SVG→PNG), Luxon, Next.js 16 (`generateMetadata`), React Testing Library.

**Spec :** `docs/superpowers/specs/2026-07-02-lien-vivant-partage-partie-design.md`

**Écarts assumés vs spec (décidés au plan) :**
- Le hash vit dans un module pur dédié `matchCardState.ts` (pas dans `matchCard.service.ts`) pour que `openMatch.service.ts` puisse l'importer **sans charger sharp** ni créer de cycle (`matchCard.service` importe `OpenMatchService`).
- Polices prod : paquet Debian `fonts-dejavu-core` dans le Dockerfile (image `node:22-bookworm`) au lieu d'un fichier de police embarqué + `FONTCONFIG_PATH` — plus simple, même garantie.
- Pastille d'initiales : contraste via `readableTextOn` (déjà exporté par `src/email/templates/layout.ts`), pas de nouveau helper.

**⚠️ Contexte repo :**
- L'arbre de travail contient du WIP utilisateur non lié (voir `git status`). **Ne committer que les fichiers du plan**, jamais `git add -A`. Vérifier `git branch --show-current` = `main` avant chaque commit (l'utilisateur change parfois de branche en parallèle).
- Les tests frontend qui touchent `OpenMatchCard.test.tsx` / `OpenMatchDetail.test.tsx` : ces fichiers sont en cours de modification par l'utilisateur — **relire le fichier au moment de la tâche** et adapter les stubs existants plutôt que coller aveuglément.
- Backend : lancer les tests depuis `backend/`, frontend depuis `frontend/`.
- `frontend` jest ne type-check pas (ts-jest isolatedModules) : la passe `npx tsc --noEmit` de la tâche 12 est obligatoire.

---

### Task 1 : Module pur du hash d'état (`matchCardState.ts`)

**Files:**
- Create: `backend/src/services/matchCardState.ts`
- Test: `backend/src/services/__tests__/matchCardState.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// backend/src/services/__tests__/matchCardState.test.ts
import { matchCardStateHash, MatchCardState } from '../matchCardState';

const base = (): MatchCardState => ({
  players: [
    { userId: 'u1', team: 1, slot: 0, avatarUrl: null, level: { level: 6.1 } },
    { userId: 'u2', team: 2, slot: 0, avatarUrl: '/uploads/avatars/u2.jpg', level: null },
  ],
  spotsLeft: 2,
  targetLevelMin: 6,
  targetLevelMax: 7,
  startTime: '2026-07-04T16:00:00.000Z',
  endTime: '2026-07-04T17:30:00.000Z',
  resourceName: 'Court 2',
  accentColor: '#0f6bff',
  logoUrl: null,
});

describe('matchCardStateHash', () => {
  it('est stable : même état → même hash, forme 12 hex', () => {
    expect(matchCardStateHash(base())).toBe(matchCardStateHash(base()));
    expect(matchCardStateHash(base())).toMatch(/^[0-9a-f]{12}$/);
  });

  it('change quand un joueur rejoint', () => {
    const joined = base();
    joined.players.push({ userId: 'u3', team: 1, slot: 1, avatarUrl: null, level: null });
    joined.spotsLeft = 1;
    expect(matchCardStateHash(joined)).not.toBe(matchCardStateHash(base()));
  });

  it("change quand un joueur change d'équipe ou de place", () => {
    const moved = base();
    moved.players[0] = { ...moved.players[0], team: 2, slot: 1 };
    expect(matchCardStateHash(moved)).not.toBe(matchCardStateHash(base()));
  });

  it('change quand la fourchette de niveau change', () => {
    expect(matchCardStateHash({ ...base(), targetLevelMin: null, targetLevelMax: null }))
      .not.toBe(matchCardStateHash(base()));
  });

  it('change avec la couleur ou le logo du club (re-branding)', () => {
    expect(matchCardStateHash({ ...base(), accentColor: '#ff7a4d' })).not.toBe(matchCardStateHash(base()));
    expect(matchCardStateHash({ ...base(), logoUrl: '/uploads/logos/x.png' })).not.toBe(matchCardStateHash(base()));
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run (dans `backend/`) : `npx jest src/services/__tests__/matchCardState.test.ts`
Attendu : FAIL — `Cannot find module '../matchCardState'`.

- [ ] **Step 3 : Implémentation minimale**

```ts
// backend/src/services/matchCardState.ts
import crypto from 'crypto';

// Version de rendu de la carte OG de partie : à incrémenter quand le VISUEL change,
// pour invalider le cache disque ET les aperçus WhatsApp (le hash — donc l'URL
// og:image et l'URL de partage ?s= — change avec).
export const CARD_RENDER_VERSION = 'v1';

// Champs qui influencent le rendu de la carte. Toute évolution du visuel qui consomme
// un nouveau champ doit l'ajouter ici, sinon le cache servirait des cartes périmées.
export interface MatchCardState {
  players: Array<{
    userId: string;
    team: number | null;
    slot?: number | null;
    avatarUrl: string | null;
    level?: { level: number } | null;
  }>;
  spotsLeft: number;
  targetLevelMin: number | null;
  targetLevelMax: number | null;
  startTime: string; // ISO
  endTime: string; // ISO
  resourceName: string;
  accentColor: string;
  logoUrl: string | null;
}

/** Hash court et stable de l'état visuel d'une partie (12 hex). Pur, déterministe. */
export function matchCardStateHash(s: MatchCardState): string {
  const canonical = JSON.stringify({
    v: CARD_RENDER_VERSION,
    players: s.players.map((p) => [p.userId, p.team ?? null, p.slot ?? null, p.avatarUrl ?? null, p.level?.level ?? null]),
    spots: s.spotsLeft,
    lvl: [s.targetLevelMin, s.targetLevelMax],
    t: [s.startTime, s.endTime],
    r: s.resourceName,
    brand: [s.accentColor, s.logoUrl ?? null],
  });
  return crypto.createHash('md5').update(canonical).digest('hex').slice(0, 12);
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npx jest src/services/__tests__/matchCardState.test.ts`
Attendu : PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/matchCardState.ts backend/src/services/__tests__/matchCardState.test.ts
git commit -m "feat(og-card): hash d'état pur de la carte OG de partie (matchCardState)"
```

---

### Task 2 : Miroir backend de `colorForSeed`

**Files:**
- Create: `backend/src/utils/playerColors.ts`
- Test: `backend/src/utils/__tests__/playerColors.test.ts` (créer le dossier `__tests__` s'il n'existe pas)

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// backend/src/utils/__tests__/playerColors.test.ts
import { PLAYER_COLORS, colorForSeed } from '../playerColors';

describe('colorForSeed (miroir de frontend/lib/playerColors.ts)', () => {
  it('renvoie une couleur de la palette, stable pour un même seed', () => {
    const c = colorForSeed('user-42');
    expect(PLAYER_COLORS).toContain(c);
    expect(colorForSeed('user-42')).toBe(c);
  });

  it('seed vide → première couleur', () => {
    expect(colorForSeed('')).toBe(PLAYER_COLORS[0]);
  });

  it('distribue : au moins 2 couleurs distinctes sur 20 seeds', () => {
    const set = new Set(Array.from({ length: 20 }, (_, i) => colorForSeed(`seed-${i}`)));
    expect(set.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx jest src/utils/__tests__/playerColors.test.ts`
Attendu : FAIL — `Cannot find module '../playerColors'`.

- [ ] **Step 3 : Implémentation (copie conforme du front)**

```ts
// backend/src/utils/playerColors.ts
// ⚠️ MIROIR de frontend/lib/playerColors.ts — garder les deux synchronisés
// (même avertissement que slugify / lib/slug.ts). Sert au rendu serveur de la
// carte OG de partie (pastilles d'initiales identiques à celles de l'app).

export const PLAYER_COLORS = [
  '#5e93da', // bleu
  '#ff7a4d', // corail
  '#2bb6a3', // turquoise
  '#9b8cf0', // violet
  '#ef6f9e', // rose
  '#5bbd6e', // vert
  '#e6a93c', // ambre
  '#7b7fe0', // indigo
] as const;

// Hash FNV-1a 32 bits : stable, bien distribué, sans dépendance.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Couleur stable de la palette pour un seed donné (seed vide → première couleur). */
export function colorForSeed(seed: string): string {
  if (!seed) return PLAYER_COLORS[0];
  return PLAYER_COLORS[fnv1a(seed) % PLAYER_COLORS.length];
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npx jest src/utils/__tests__/playerColors.test.ts`
Attendu : PASS (3 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/utils/playerColors.ts backend/src/utils/__tests__/playerColors.test.ts
git commit -m "feat(og-card): miroir backend de colorForSeed (pastilles d'initiales)"
```

---

### Task 3 : `cardVersion` dans le DTO des parties

**Files:**
- Modify: `backend/src/services/openMatch.service.ts` (`resolveActiveClub`, `toDTO`, les 2 appels à `toDTO`)
- Test: `backend/src/services/__tests__/openMatch.service.test.ts` (ajout d'un bloc)

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter dans le `describe('listOpenMatches', …)` existant de
`backend/src/services/__tests__/openMatch.service.test.ts` (les mocks `beforeEach`
existants suffisent — `club.findUnique` renvoie déjà `{ id: 'club-demo', status: 'ACTIVE' }`) :

```ts
    it('expose cardVersion : stable pour un même état, change après un join', async () => {
      const t0 = future(48); const t1 = future(49);
      const org = { userId: 'org', isOrganizer: true, team: null, user: { firstName: 'Org', lastName: 'A', avatarUrl: null } };
      const row = {
        id: 'm1', startTime: t0, endTime: t1,
        resource: { id: 'court-1', name: 'Court 1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel', name: 'Padel' } } },
        participants: [org], openMatchMessages: [],
      };
      prismaMock.reservation.findMany.mockResolvedValue([row] as any);
      const [a] = await service.listOpenMatches('club-demo', null);
      const [b] = await service.listOpenMatches('club-demo', null);
      expect(a.cardVersion).toMatch(/^[0-9a-f]{12}$/);
      expect(b.cardVersion).toBe(a.cardVersion);

      const joiner = { userId: 'u2', isOrganizer: false, team: null, user: { firstName: 'V', lastName: 'B', avatarUrl: null } };
      prismaMock.reservation.findMany.mockResolvedValue([{ ...row, participants: [org, joiner] }] as any);
      const [c] = await service.listOpenMatches('club-demo', null);
      expect(c.cardVersion).not.toBe(a.cardVersion);
    });
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx jest src/services/__tests__/openMatch.service.test.ts -t cardVersion`
Attendu : FAIL — `cardVersion` est `undefined`.

- [ ] **Step 3 : Implémentation**

Dans `backend/src/services/openMatch.service.ts` :

a) Ajouter l'import (après l'import `membership`) :

```ts
import { matchCardStateHash } from './matchCardState';
```

b) Étendre `resolveActiveClub` (les champs alimentent le hash de la carte OG) :

```ts
  /** Résout un club ACTIVE par slug, SANS exiger d'adhésion (lecture publique des parties). */
  private async resolveActiveClub(slug: string): Promise<{ id: string; accentColor: string; logoUrl: string | null }> {
    const club = await prisma.club.findUnique({
      where: { slug },
      select: { id: true, status: true, accentColor: true, logoUrl: true },
    });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return { id: club.id, accentColor: club.accentColor, logoUrl: club.logoUrl };
  }
```

c) `toDTO` : nouveau paramètre `club` + calcul du `cardVersion` (le corps actuel est
réorganisé pour nommer `spotsLeft` et `players` avant le `return`) :

```ts
  /** Sérialise une réservation-partie en DTO. Partagé par listOpenMatches et getOpenMatch. */
  private toDTO(
    m: MatchRow,
    levels: Record<string, UserLevel>,
    unreadCount: number,
    viewerUserId: string | null,
    club: { accentColor: string; logoUrl: string | null },
  ) {
    const maxPlayers = playerCount((m.resource.attributes as { format?: string } | null)?.format);
    const teamed = effectiveTeams(m.participants, maxPlayers);
    const sportKey = m.resource.clubSport.sport.key;
    const spotsLeft = Math.max(0, maxPlayers - m.participants.length);
    const players = teamed.map((p) => ({
      userId: p.userId, firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl, isOrganizer: p.isOrganizer,
      level: levels[`${p.userId}:${sportKey}`] ?? null,
      team: p.team,
      slot: p.slot,
    }));
    return {
      id: m.id,
      resourceName: m.resource.name,
      sport: { key: m.resource.clubSport.sport.key, name: m.resource.clubSport.sport.name },
      startTime: m.startTime.toISOString(),
      endTime: m.endTime.toISOString(),
      maxPlayers,
      spotsLeft,
      full: m.participants.length >= maxPlayers,
      viewerIsParticipant: viewerUserId != null && m.participants.some((p) => p.userId === viewerUserId),
      viewerIsOrganizer: viewerUserId != null && m.participants.some((p) => p.userId === viewerUserId && p.isOrganizer),
      targetLevelMin: m.targetLevelMin ?? null,
      targetLevelMax: m.targetLevelMax ?? null,
      players,
      lastMessageAt: m.openMatchMessages[0]?.createdAt.toISOString() ?? null,
      unreadCount,
      // Hash d'état de la carte OG : versionne l'og:image et l'URL de partage (?s=).
      cardVersion: matchCardStateHash({
        players: players.map((p) => ({ userId: p.userId, team: p.team, slot: p.slot, avatarUrl: p.avatarUrl, level: p.level })),
        spotsLeft,
        targetLevelMin: m.targetLevelMin ?? null,
        targetLevelMax: m.targetLevelMax ?? null,
        startTime: m.startTime.toISOString(),
        endTime: m.endTime.toISOString(),
        resourceName: m.resource.name,
        accentColor: club.accentColor,
        logoUrl: club.logoUrl,
      }),
    };
  }
```

d) Les deux appels passent le club (déjà résolu par `resolveActiveClub`) :

- dans `listOpenMatches` :
  `return matches.map((m) => this.toDTO(m, levels, unreadByMatch.get(m.id) ?? 0, viewerUserId, club));`
- dans `getOpenMatch` (dernière ligne) :
  `return this.toDTO(m, levels, unreadCount, viewerUserId, club);`

- [ ] **Step 4 : Vérifier le vert (toute la suite — non-régression)**

Run : `npx jest src/services/__tests__/openMatch.service.test.ts`
Attendu : PASS (tous les tests, dont le nouveau).
Note : les mocks existants renvoient un club sans `accentColor`/`logoUrl` (`undefined`) —
le hash les sérialise en `null`/`undefined` sans erreur, c'est voulu.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(og-card): cardVersion (hash d'état) dans le DTO des parties ouvertes"
```

---

### Task 4 : `OGCARDS_DIR` + PNG de repli embarqué

**Files:**
- Modify: `backend/src/utils/uploads.ts`
- Create: `backend/scripts/generate-og-fallback.ts`
- Create (généré) : `backend/assets/og-card-fallback.png`

- [ ] **Step 1 : `OGCARDS_DIR` dans uploads.ts**

Dans `backend/src/utils/uploads.ts`, ajouter après la ligne `COVERS_DIR` :

```ts
export const OGCARDS_DIR = path.join(UPLOADS_DIR, 'ogcards'); // cache des cartes OG de parties
```

et dans `ensureUploadDirs()` :

```ts
  fs.mkdirSync(OGCARDS_DIR, { recursive: true });
```

- [ ] **Step 2 : Script de génération du repli**

```ts
// backend/scripts/generate-og-fallback.ts
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Génère l'image de repli 1200×630 de la carte OG de partie (servie quand le rendu
// dynamique échoue : match introuvable, sharp KO…). PNG committé dans le repo.
// À relancer si le visuel de repli change : npx ts-node scripts/generate-og-fallback.ts

const OUT = path.join(__dirname, '..', 'assets', 'og-card-fallback.png');
const FONT = "'DejaVu Sans', 'Segoe UI', Arial, sans-serif";

const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1d3557"/>
      <stop offset="1" stop-color="#0e1b2e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="600" y="290" text-anchor="middle" font-family="${FONT}" font-size="64" font-weight="700" fill="#ffffff">Partie ouverte</text>
  <text x="600" y="360" text-anchor="middle" font-family="${FONT}" font-size="30" fill="rgba(255,255,255,0.75)">Rejoignez le match sur Palova</text>
</svg>`;

sharp(Buffer.from(svg)).png().toBuffer().then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log(`OK -> ${OUT} (${buf.byteLength} octets)`);
});
```

- [ ] **Step 3 : Générer et vérifier**

Run (dans `backend/`) : `npx ts-node scripts/generate-og-fallback.ts`
Attendu : `OK -> …\assets\og-card-fallback.png (…octets)` et le fichier existe (> 10 Ko).

- [ ] **Step 4 : Commit**

```bash
git add backend/src/utils/uploads.ts backend/scripts/generate-og-fallback.ts backend/assets/og-card-fallback.png
git commit -m "feat(og-card): dossier de cache ogcards + PNG de repli embarqué"
```

---

### Task 5 : Service de rendu `matchCard.service.ts`

**Files:**
- Modify: `backend/src/services/icon.service.ts` (exporter `fetchLogo` : `async function fetchLogo` → `export async function fetchLogo` — aucun autre changement)
- Create: `backend/src/services/matchCard.service.ts`
- Test: `backend/src/services/__tests__/matchCard.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// backend/src/services/__tests__/matchCard.service.test.ts
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Uploads dans un tmpdir jetable (même patron que icon.routes.test.ts).
jest.mock('../../utils/uploads', () => {
  const fsm = require('fs') as typeof import('fs');
  const osm = require('os') as typeof import('os');
  const pathm = require('path') as typeof import('path');
  const UPLOADS_DIR = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'palova-ogcards-'));
  const dirs = {
    UPLOADS_DIR,
    AVATARS_DIR: pathm.join(UPLOADS_DIR, 'avatars'),
    ICONS_DIR: pathm.join(UPLOADS_DIR, 'icons'),
    SPONSORS_DIR: pathm.join(UPLOADS_DIR, 'sponsors'),
    LOGOS_DIR: pathm.join(UPLOADS_DIR, 'logos'),
    COVERS_DIR: pathm.join(UPLOADS_DIR, 'covers'),
    OGCARDS_DIR: pathm.join(UPLOADS_DIR, 'ogcards'),
  };
  for (const d of Object.values(dirs)) fsm.mkdirSync(d, { recursive: true });
  return { ...dirs, ensureUploadDirs: () => {}, EXT_BY_MIME: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } };
});

jest.mock('../openMatch.service', () => {
  const getOpenMatch = jest.fn();
  return { OpenMatchService: jest.fn().mockImplementation(() => ({ getOpenMatch })) };
});

import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { OGCARDS_DIR, AVATARS_DIR } from '../../utils/uploads';
import { OpenMatchService } from '../openMatch.service';
import { matchCardService, fallbackCardPath } from '../matchCard.service';

const getOpenMatch = (new (OpenMatchService as any)()).getOpenMatch as jest.Mock;

const clubStub = {
  slug: 'demo', name: 'Padel Arena', status: 'ACTIVE', timezone: 'Europe/Paris',
  accentColor: '#0f6bff', logoUrl: null,
};

const dtoStub = {
  id: 'm1', resourceName: 'Court 2', sport: { key: 'padel', name: 'Padel' },
  startTime: '2026-07-04T16:00:00.000Z', endTime: '2026-07-04T17:30:00.000Z',
  maxPlayers: 4, spotsLeft: 2, full: false,
  viewerIsParticipant: false, viewerIsOrganizer: false,
  targetLevelMin: 6, targetLevelMax: 7,
  players: [
    { userId: 'u1', firstName: 'Éric', lastName: 'N', avatarUrl: null, isOrganizer: true, level: { level: 6.1, tier: 'Confirmé', isProvisional: false, reliability: 1 }, team: 1, slot: 0 },
    { userId: 'u2', firstName: 'Léa', lastName: 'B', avatarUrl: null, isOrganizer: false, level: null, team: 2, slot: 0 },
  ],
  lastMessageAt: null, unreadCount: 0, cardVersion: 'abc123def456',
};

describe('MatchCardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.club.findUnique.mockResolvedValue(clubStub as any);
    getOpenMatch.mockResolvedValue(dtoStub);
    for (const f of fs.readdirSync(OGCARDS_DIR)) fs.unlinkSync(path.join(OGCARDS_DIR, f));
  });

  it('rend un PNG 1200×630 nommé <matchId>-<cardVersion>.png', async () => {
    const p = await matchCardService.getMatchCardPath('demo', 'm1');
    expect(path.basename(p)).toBe('m1-abc123def456.png');
    expect(path.dirname(p)).toBe(OGCARDS_DIR);
    const meta = await sharp(p).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
  });

  it('hit de cache : le fichier existant est servi sans re-rendu', async () => {
    const cached = path.join(OGCARDS_DIR, 'm1-abc123def456.png');
    fs.writeFileSync(cached, 'SENTINEL');
    const p = await matchCardService.getMatchCardPath('demo', 'm1');
    expect(p).toBe(cached);
    expect(fs.readFileSync(cached, 'utf8')).toBe('SENTINEL'); // pas réécrit
  });

  it("purge les anciens états du même match (pas ceux d'autres matchs)", async () => {
    fs.writeFileSync(path.join(OGCARDS_DIR, 'm1-oldhash000000.png'), 'old');
    fs.writeFileSync(path.join(OGCARDS_DIR, 'm2-otherhash0000.png'), 'other');
    await matchCardService.getMatchCardPath('demo', 'm1');
    expect(fs.existsSync(path.join(OGCARDS_DIR, 'm1-oldhash000000.png'))).toBe(false);
    expect(fs.existsSync(path.join(OGCARDS_DIR, 'm2-otherhash0000.png'))).toBe(true);
  });

  it('compose la photo des joueurs qui en ont une (PNG toujours 1200×630)', async () => {
    const avatar = path.join(AVATARS_DIR, 'u1.jpg');
    await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 60, b: 60 } } }).jpeg().toFile(avatar);
    getOpenMatch.mockResolvedValue({
      ...dtoStub,
      cardVersion: 'withavatar12',
      players: [{ ...dtoStub.players[0], avatarUrl: '/uploads/avatars/u1.jpg' }, dtoStub.players[1]],
    });
    const p = await matchCardService.getMatchCardPath('demo', 'm1');
    const meta = await sharp(p).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
  });

  it('match introuvable → PNG de repli (jamais de throw)', async () => {
    getOpenMatch.mockRejectedValue(new Error('RESERVATION_NOT_FOUND'));
    await expect(matchCardService.getMatchCardPath('demo', 'nope')).resolves.toBe(fallbackCardPath());
  });

  it('club inconnu ou suspendu → PNG de repli', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(matchCardService.getMatchCardPath('ghost', 'm1')).resolves.toBe(fallbackCardPath());
    prismaMock.club.findUnique.mockResolvedValue({ ...clubStub, status: 'SUSPENDED' } as any);
    await expect(matchCardService.getMatchCardPath('demo', 'm1')).resolves.toBe(fallbackCardPath());
  });

  it('id non sûr pour un nom de fichier → repli sans requête', async () => {
    await expect(matchCardService.getMatchCardPath('demo', '../../etc/passwd')).resolves.toBe(fallbackCardPath());
    expect(prismaMock.club.findUnique).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx jest src/services/__tests__/matchCard.service.test.ts`
Attendu : FAIL — `Cannot find module '../matchCard.service'`.

- [ ] **Step 3 : Exporter `fetchLogo` puis implémenter le service**

Dans `backend/src/services/icon.service.ts`, ligne `async function fetchLogo(url: string)` →
`export async function fetchLogo(url: string)` (le commentaire et le corps ne bougent pas).

```ts
// backend/src/services/matchCard.service.ts
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';
import { OGCARDS_DIR, UPLOADS_DIR } from '../utils/uploads';
import { colorForSeed } from '../utils/playerColors';
import { readableTextOn } from '../email/templates/layout';
import { clubAppUrl } from '../email/links';
import { fetchLogo } from './icon.service';
import { OpenMatchService } from './openMatch.service';

// Carte Open Graph d'une partie ouverte (1200×630) : l'aperçu WhatsApp montre l'état
// RÉEL du match — équipes G/D, avatars, places restantes, niveau, date — aux couleurs
// du club. Cache disque par état (uploads/ogcards/<matchId>-<cardVersion>.png), purge
// des états précédents, repli PNG embarqué sur toute erreur (jamais de 500 pour un
// crawler). Patron : icon.service.ts.

export const CARD_W = 1200;
export const CARD_H = 630;
const FONT = "'DejaVu Sans', 'Segoe UI', Arial, sans-serif";
const AVATAR = 112; // diamètre px des avatars sur la carte

export function fallbackCardPath(): string {
  return path.join(process.cwd(), 'assets', 'og-card-fallback.png');
}

type MatchDTO = Awaited<ReturnType<OpenMatchService['getOpenMatch']>>;
type CardClub = { slug: string; name: string; timezone: string; accentColor: string; logoUrl: string | null };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clamp = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const fmtLevel = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

// Assombrit un hex #rrggbb (facteur 0..1) — bas du dégradé de fond. Hex invalide → nuit.
function darken(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return '#0e1b2e';
  const n = parseInt(m[1], 16);
  const ch = (x: number) => Math.round(x * (1 - f)).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

function levelRangeLabel(min: number | null, max: number | null): string | null {
  if (min != null && max != null) return `Niveau ${fmtLevel(min)} à ${fmtLevel(max)}`;
  if (min != null) return `Niveau ${fmtLevel(min)} et +`;
  if (max != null) return `Niveau ${fmtLevel(max)} et -`;
  return null;
}

/** Avatar local (/uploads/…) recadré rond, ou null (photo distante/illisible → pastille). */
async function circleAvatar(avatarUrl: string, size: number): Promise<Buffer | null> {
  try {
    if (!avatarUrl.startsWith('/uploads/')) return null;
    const filePath = path.resolve(UPLOADS_DIR, avatarUrl.replace(/^\/uploads\//, ''));
    if (!filePath.startsWith(path.resolve(UPLOADS_DIR))) return null; // anti-traversée
    const img = await sharp(await fs.promises.readFile(filePath))
      .resize(size, size, { fit: 'cover' }).png().toBuffer();
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
    return await sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  } catch { return null; }
}

/** Rendu complet de la carte (SVG de base + photos composées par-dessus les pastilles). */
async function renderCard(dto: MatchDTO, club: CardClub): Promise<Buffer> {
  const zone = club.timezone || 'Europe/Paris';
  const start = DateTime.fromISO(dto.startTime, { zone }).setLocale('fr');
  const end = DateTime.fromISO(dto.endTime, { zone });
  const whenLabel = `${start.toFormat('ccc d LLL')} · ${start.toFormat("HH'h'mm")} – ${end.toFormat("HH'h'mm")} · ${clamp(dto.resourceName, 20)}`;

  const half = Math.max(1, Math.floor(dto.maxPlayers / 2));
  const byPos = new Map(dto.players.map((p) => [`${p.team}:${p.slot}`, p]));
  const rowY = (s: number) => (half === 1 ? 320 : 240 + s * 170); // centre du cercle avatar
  const colX = (team: 1 | 2) => (team === 1 ? 330 : 870);

  const parts: string[] = [];
  const overlays: Array<{ url: string; x: number; y: number }> = [];

  parts.push(`<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${esc(club.accentColor || '#1d3557')}"/>
    <stop offset="1" stop-color="${darken(club.accentColor || '#1d3557', 0.65)}"/>
  </linearGradient></defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>`);

  // En-tête : tuile logo + nom du club + date/heure/terrain.
  parts.push(`<rect x="48" y="44" width="84" height="84" rx="18" fill="#ffffff"/>`);
  parts.push(`<text x="152" y="88" font-family="${FONT}" font-size="34" font-weight="700" fill="#ffffff">${esc(clamp(club.name, 28))}</text>`);
  parts.push(`<text x="152" y="124" font-family="${FONT}" font-size="24" fill="rgba(255,255,255,0.82)">${esc(whenLabel)}</text>`);

  // VS central.
  parts.push(`<circle cx="600" cy="320" r="46" fill="rgba(255,255,255,0.14)"/>
  <text x="600" y="331" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="#ffffff">VS</text>`);

  // Équipes : pastille initiales (ou cercle pointillé « Libre ») + prénom + niveau.
  for (const team of [1, 2] as const) {
    parts.push(`<text x="${colX(team)}" y="172" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="600" fill="rgba(255,255,255,0.65)">Éq. ${team}</text>`);
    for (let s = 0; s < half; s++) {
      const cx = colX(team); const cy = rowY(s);
      const p = byPos.get(`${team}:${s}`);
      if (!p) {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${AVATAR / 2}" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="3" stroke-dasharray="8 8"/>
        <text x="${cx}" y="${cy + AVATAR / 2 + 36}" text-anchor="middle" font-family="${FONT}" font-size="26" fill="rgba(255,255,255,0.6)">Libre</text>`);
        continue;
      }
      const color = colorForSeed(p.userId);
      const initials = `${(p.firstName[0] || '').toUpperCase()}${(p.lastName[0] || '').toUpperCase()}`;
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${AVATAR / 2}" fill="${color}"/>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="700" fill="${readableTextOn(color)}">${esc(initials)}</text>
      <text x="${cx}" y="${cy + AVATAR / 2 + 36}" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="600" fill="#ffffff">${esc(clamp(p.firstName, 14))}</text>`);
      if (p.level) parts.push(`<text x="${cx}" y="${cy + AVATAR / 2 + 66}" text-anchor="middle" font-family="${FONT}" font-size="20" fill="rgba(255,255,255,0.7)">Niv. ${fmtLevel(p.level.level)}</text>`);
      if (p.avatarUrl) overlays.push({ url: p.avatarUrl, x: cx - AVATAR / 2, y: cy - AVATAR / 2 });
    }
  }

  // Bandeau bas : places · niveau · domaine du club.
  const placesLabel = dto.full ? 'Complet' : `${dto.spotsLeft} place${dto.spotsLeft > 1 ? 's' : ''} restante${dto.spotsLeft > 1 ? 's' : ''}`;
  const domain = clubAppUrl(club.slug).replace(/^https?:\/\//, '');
  const footer = [placesLabel, levelRangeLabel(dto.targetLevelMin ?? null, dto.targetLevelMax ?? null), domain].filter(Boolean).join('  ·  ');
  parts.push(`<rect x="0" y="${CARD_H - 84}" width="${CARD_W}" height="84" fill="rgba(0,0,0,0.28)"/>
  <text x="600" y="${CARD_H - 32}" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="#ffffff">${esc(footer)}</text>`);

  const svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">${parts.join('\n')}</svg>`;

  const composites: sharp.OverlayOptions[] = [];
  if (club.logoUrl) {
    try {
      const logo = await fetchLogo(club.logoUrl);
      composites.push({
        input: await sharp(logo).resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
        left: 58, top: 54,
      });
    } catch { /* logo injoignable → tuile blanche vide, pas bloquant */ }
  }
  for (const o of overlays) {
    const buf = await circleAvatar(o.url, AVATAR);
    if (buf) composites.push({ input: buf, left: o.x, top: o.y });
  }

  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  return composites.length ? sharp(base).composite(composites).png().toBuffer() : base;
}

export class MatchCardService {
  private openMatches = new OpenMatchService();

  /** Chemin absolu du PNG à servir. Ne lève JAMAIS : toute erreur → PNG de repli. */
  async getMatchCardPath(slug: string, matchId: string): Promise<string> {
    try {
      // L'id entre dans un nom de fichier : garde stricte avant toute requête.
      if (!/^[A-Za-z0-9_-]+$/.test(matchId)) return fallbackCardPath();
      const club = await prisma.club.findUnique({
        where: { slug },
        select: { slug: true, name: true, status: true, timezone: true, accentColor: true, logoUrl: true },
      });
      if (!club || club.status !== 'ACTIVE') return fallbackCardPath();
      const dto = await this.openMatches.getOpenMatch(slug, matchId, null);
      const cached = path.join(OGCARDS_DIR, `${matchId}-${dto.cardVersion}.png`);
      if (fs.existsSync(cached)) return cached;
      const png = await renderCard(dto, club);
      fs.mkdirSync(OGCARDS_DIR, { recursive: true });
      fs.writeFileSync(cached, png);
      // Purge best-effort des états précédents du même match.
      for (const f of fs.readdirSync(OGCARDS_DIR)) {
        if (f.startsWith(`${matchId}-`) && f !== path.basename(cached)) {
          try { fs.unlinkSync(path.join(OGCARDS_DIR, f)); } catch { /* déjà parti */ }
        }
      }
      return cached;
    } catch {
      return fallbackCardPath();
    }
  }
}

export const matchCardService = new MatchCardService();
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npx jest src/services/__tests__/matchCard.service.test.ts`
Attendu : PASS (7 tests). Si le test « photo » échoue sur Windows à cause d'un chemin,
vérifier que `AVATARS_DIR` du mock est bien sous le `UPLOADS_DIR` mocké (le guard
anti-traversée compare des chemins résolus).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/matchCard.service.ts backend/src/services/__tests__/matchCard.service.test.ts backend/src/services/icon.service.ts
git commit -m "feat(og-card): service de rendu de la carte OG de partie (sharp, cache disque, repli)"
```

---

### Task 6 : Route publique `card.png`

**Files:**
- Modify: `backend/src/routes/clubs.ts` (import + route après le `GET /:slug/open-matches/:id` existant, ~l.268)
- Test: `backend/src/routes/__tests__/clubs.matchcard.routes.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// backend/src/routes/__tests__/clubs.matchcard.routes.test.ts
import '../../__mocks__/prisma';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// PNG 1×1 réel : on teste la plomberie HTTP (statut, en-têtes), pas le rendu.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'palova-card-'));
const PNG_PATH = path.join(TMP, 'card.png');
fs.writeFileSync(PNG_PATH, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
));

jest.mock('../../services/matchCard.service', () => {
  const getMatchCardPath = jest.fn();
  return {
    MatchCardService: jest.fn(),
    matchCardService: { getMatchCardPath },
    fallbackCardPath: jest.fn(),
  };
});

import app from '../../app';
import { matchCardService } from '../../services/matchCard.service';

const getMatchCardPath = matchCardService.getMatchCardPath as jest.Mock;

describe('GET /api/clubs/:slug/open-matches/:id/card.png', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMatchCardPath.mockResolvedValue(PNG_PATH);
  });

  it('200 image/png public (sans token), Cache-Control court', async () => {
    const res = await request(app).get('/api/clubs/demo/open-matches/m1/card.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(getMatchCardPath).toHaveBeenCalledWith('demo', 'm1');
  });

  it('accepte le paramètre de cache-busting ?v= (ignoré)', async () => {
    const res = await request(app).get('/api/clubs/demo/open-matches/m1/card.png?v=abc123def456');
    expect(res.status).toBe(200);
    expect(getMatchCardPath).toHaveBeenCalledWith('demo', 'm1');
  });

  it('le service renvoie le repli (id inconnu) → toujours 200 PNG', async () => {
    // getMatchCardPath ne throw jamais : il renvoie déjà le chemin du repli.
    const res = await request(app).get('/api/clubs/demo/open-matches/inconnu/card.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx jest src/routes/__tests__/clubs.matchcard.routes.test.ts`
Attendu : FAIL — 404 (route inexistante).

- [ ] **Step 3 : Implémenter la route**

Dans `backend/src/routes/clubs.ts` :

a) Ajouter l'import à côté des autres services :

```ts
import { matchCardService } from '../services/matchCard.service';
```

b) Ajouter la route **juste après** le bloc `GET /:slug/open-matches/:id` (~l.268) :

```ts
// Carte Open Graph de la partie (aperçu de lien WhatsApp/réseaux) — publique, PNG,
// repli embarqué : ne renvoie JAMAIS d'erreur à un crawler. L'URL est versionnée par
// ?v=<cardVersion> côté consommateur (pur cache-busting, paramètre ignoré ici).
router.get('/:slug/open-matches/:id/card.png', async (req: Request, res: Response) => {
  const filePath = await matchCardService.getMatchCardPath(asString(req.params.slug), asString(req.params.id));
  res.sendFile(filePath, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' } });
});
```

(`Request` est déjà importé — la route icône l'utilise.)

- [ ] **Step 4 : Vérifier le vert + non-régression routes voisines**

Run : `npx jest src/routes/__tests__/clubs.matchcard.routes.test.ts src/routes/__tests__/clubs.openmatch-chat.routes.test.ts`
Attendu : PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/routes/__tests__/clubs.matchcard.routes.test.ts
git commit -m "feat(og-card): route publique GET /:slug/open-matches/:id/card.png"
```

---

### Task 7 : Frontend — type `cardVersion` + helpers `matchShare.ts`

**Files:**
- Modify: `frontend/lib/api.ts` (interface `OpenMatch`, ~l.1197)
- Create: `frontend/lib/matchShare.ts`
- Test: `frontend/__tests__/matchShare.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// frontend/__tests__/matchShare.test.ts
import { matchShareText, matchShareUrl } from '../lib/matchShare';
import type { OpenMatch } from '../lib/api';

const match = (over: Partial<OpenMatch> = {}): OpenMatch => ({
  id: 'm1', resourceName: 'Court 2',
  startTime: '2026-07-04T16:00:00.000Z', endTime: '2026-07-04T17:30:00.000Z',
  maxPlayers: 4, spotsLeft: 2, full: false,
  viewerIsParticipant: false, viewerIsOrganizer: false,
  players: [], targetLevelMin: 6, targetLevelMax: 7,
  lastMessageAt: null, unreadCount: 0, cardVersion: 'abc123def456',
  ...over,
});

describe('matchShareUrl', () => {
  it("versionne l'URL par l'état (?s=cardVersion)", () => {
    expect(matchShareUrl('https://demo.palova.fr', match()))
      .toBe('https://demo.palova.fr/parties/m1?s=abc123def456');
  });
  it('sans cardVersion (vieux backend) → URL nue', () => {
    expect(matchShareUrl('https://demo.palova.fr', match({ cardVersion: undefined })))
      .toBe('https://demo.palova.fr/parties/m1');
  });
});

describe('matchShareText', () => {
  it('compose date · places · niveau · club (fuseau du club)', () => {
    const text = matchShareText(match(), 'Padel Arena', 'Europe/Paris');
    expect(text).toContain('sam.');       // 2026-07-04 = samedi
    expect(text).toContain('juil.');
    expect(text).toContain('18:00');      // 16:00 UTC = 18h00 à Paris
    expect(text).toContain('2 places');
    expect(text).toContain('Niveau 6 à 7');
    expect(text).toContain('Padel Arena');
  });
  it('singulier, complet, sans niveau, sans club', () => {
    expect(matchShareText(match({ spotsLeft: 1 }), null, 'Europe/Paris')).toContain('1 place');
    expect(matchShareText(match({ full: true, spotsLeft: 0 }), null, 'Europe/Paris')).toContain('Complet');
    const noLevel = matchShareText(match({ targetLevelMin: null, targetLevelMax: null }), null, 'Europe/Paris');
    expect(noLevel).not.toContain('Niveau');
    expect(noLevel).not.toContain('null');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run (dans `frontend/`) : `npx jest __tests__/matchShare.test.ts`
Attendu : FAIL — `Cannot find module '../lib/matchShare'`.

- [ ] **Step 3 : Implémenter**

a) `frontend/lib/api.ts` — dans `export interface OpenMatch { … }` (~l.1212), ajouter après `unreadCount: number;` :

```ts
  cardVersion?: string; // hash d'état de la carte OG — versionne l'URL de partage (?s=) et l'og:image
```

b) Nouveau `frontend/lib/matchShare.ts` :

```ts
import type { OpenMatch } from '@/lib/api';
import { rangeLabel } from '@/lib/levelMatch';

// Partage d'une partie ouverte : URL versionnée par l'état + texte enrichi.
// L'URL porte ?s=<cardVersion> pour que WhatsApp (qui fige l'aperçu PAR URL) re-crawle
// à chaque partage d'un nouvel état — les vieux messages gardent l'aperçu de l'époque.

/** URL à partager pour une partie (page /parties/[id], versionnée par l'état). */
export function matchShareUrl(origin: string, match: Pick<OpenMatch, 'id' | 'cardVersion'>): string {
  const v = match.cardVersion ? `?s=${match.cardVersion}` : '';
  return `${origin}/parties/${match.id}${v}`;
}

/** Texte de partage (canaux sans aperçu riche : SMS…) : date · places · niveau · club. */
export function matchShareText(match: OpenMatch, clubName: string | null, timezone: string): string {
  const when = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone,
  }).format(new Date(match.startTime));
  const places = match.full ? 'Complet' : `${match.spotsLeft} place${match.spotsLeft > 1 ? 's' : ''}`;
  const level = (match.targetLevelMin != null || match.targetLevelMax != null)
    ? rangeLabel(match.targetLevelMin ?? null, match.targetLevelMax ?? null)
    : null;
  return [when, places, level, clubName].filter(Boolean).join(' · ');
}
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npx jest __tests__/matchShare.test.ts`
Attendu : PASS. (Si l'assertion `18:00` échoue selon la version ICU de node, remplacer
par `expect(text).toMatch(/18[h:]00/)` — ne pas affaiblir davantage.)

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/api.ts frontend/lib/matchShare.ts frontend/__tests__/matchShare.test.ts
git commit -m "feat(og-card): cardVersion côté front + helpers matchShareUrl/matchShareText"
```

---

### Task 8 : `MatchShareButton.text` + `ShareActions.shareUrl/shareText`

**Files:**
- Modify: `frontend/components/openmatch/MatchShareButton.tsx`
- Modify: `frontend/components/tournament/ShareActions.tsx`
- Test: `frontend/__tests__/MatchShareButton.test.tsx` (ajout d'un cas)
- Test: `frontend/__tests__/ShareActions.test.tsx` (nouveau)

- [ ] **Step 1 : Écrire les tests qui échouent**

a) Ajouter à la fin du `describe` de `frontend/__tests__/MatchShareButton.test.tsx` :

```tsx
  it('transmet le texte enrichi à navigator.share quand fourni', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    (navigator as any).share = share;
    wrap(<MatchShareButton url="https://demo.palova.fr/parties/m1?s=abc" title="T" text="sam. 4 juil. · 2 places" />);
    fireEvent.click(screen.getByRole('button', { name: /partager/i }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({
      title: 'T', text: 'sam. 4 juil. · 2 places', url: 'https://demo.palova.fr/parties/m1?s=abc',
    }));
  });
```

b) Nouveau `frontend/__tests__/ShareActions.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ShareActions } from '../components/tournament/ShareActions';
import { ThemeProvider } from '../lib/ThemeProvider';

const item = {
  id: 'm1', name: 'Partie ouverte · Court 2', description: 'x',
  startTime: '2026-07-04T16:00:00.000Z', endTime: '2026-07-04T17:30:00.000Z',
  club: { name: 'Arena' },
};

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('ShareActions', () => {
  afterEach(() => { delete (navigator as any).share; });

  it('partage shareUrl + shareText quand fournis', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    (navigator as any).share = share;
    wrap(<ShareActions item={item as any} uidPrefix="match"
      shareUrl="https://demo.palova.fr/parties/m1?s=abc" shareText="sam. 4 juil. · 2 places" />);
    fireEvent.click(screen.getByRole('button', { name: /partager/i }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({
      title: 'Partie ouverte · Court 2', text: 'sam. 4 juil. · 2 places',
      url: 'https://demo.palova.fr/parties/m1?s=abc',
    }));
  });

  it('sans props → comportement historique (location.href, pas de text)', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    (navigator as any).share = share;
    wrap(<ShareActions item={item as any} />);
    fireEvent.click(screen.getByRole('button', { name: /partager/i }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({
      title: 'Partie ouverte · Court 2', url: window.location.href,
    }));
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx jest __tests__/MatchShareButton.test.tsx __tests__/ShareActions.test.tsx`
Attendu : FAIL — prop `text`/`shareUrl` inconnues (TS ne bloque pas en jest ;
l'échec vient des assertions `toHaveBeenCalledWith`).

- [ ] **Step 3 : Implémenter**

a) `MatchShareButton.tsx` — signature et `share()` :

```tsx
export function MatchShareButton({ url, title, text, style, compact = false }: { url: string; title: string; text?: string; style?: React.CSSProperties; compact?: boolean }) {
```

et dans `share()`, remplacer l'appel `navigator.share` :

```tsx
    if (typeof navigator.share === 'function') {
      await navigator.share(text ? { title, text, url } : { title, url }).catch(() => {}); // AbortError (feuille refermée) : silencieux
      return;
    }
```

(le repli presse-papier copie toujours l'URL seule — inchangé).

b) `ShareActions.tsx` — signature et `share()` :

```tsx
export function ShareActions({ item, uidPrefix = 'tournament', shareUrl, shareText }: { item: AgendaICSItem; uidPrefix?: 'tournament' | 'event' | 'match'; shareUrl?: string; shareText?: string }) {
```

```tsx
  const share = async () => {
    const url = shareUrl ?? window.location.href;
    if (typeof navigator.share === 'function') {
      // AbortError quand l'utilisateur referme la feuille de partage : silencieux.
      await navigator.share(shareText ? { title: item.name, text: shareText, url } : { title: item.name, url }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard indisponible (contexte non sécurisé) : on n'affiche rien */ }
  };
```

(`downloadICS` inchangé.)

- [ ] **Step 4 : Vérifier le vert**

Run : `npx jest __tests__/MatchShareButton.test.tsx __tests__/ShareActions.test.tsx`
Attendu : PASS (anciens cas inclus — le partage sans `text` envoie toujours `{ title, url }`).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/openmatch/MatchShareButton.tsx frontend/components/tournament/ShareActions.tsx frontend/__tests__/MatchShareButton.test.tsx frontend/__tests__/ShareActions.test.tsx
git commit -m "feat(og-card): texte de partage enrichi + URL surchargable (MatchShareButton, ShareActions)"
```

---

### Task 9 : Câblage carte de liste + page détail

⚠️ `OpenMatchCard.tsx`/`OpenMatchDetail.tsx` et leurs tests sont touchés par du WIP
utilisateur : **relire les fichiers avant d'éditer** et intégrer les changements au code
tel qu'il est à ce moment-là.

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx` (~l.126, le `<MatchShareButton>`)
- Modify: `frontend/components/openmatch/OpenMatchDetail.tsx` (~l.76, le `<ShareActions>`)
- Test: `frontend/__tests__/OpenMatchCard.test.tsx` (adapter le cas « URL attendue »)
- Test: `frontend/__tests__/OpenMatchDetail.test.tsx` (si un cas de partage existe, l'adapter)

- [ ] **Step 1 : Adapter le test carte (échec d'abord)**

Dans `frontend/__tests__/OpenMatchCard.test.tsx`, localiser le test existant du bouton
« Partager » (URL attendue) ; s'assurer que le stub de match inclut `cardVersion: 'abc123def456'`
et que l'assertion devient :

```tsx
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/parties/m1?s=abc123def456'),
      text: expect.stringContaining('place'),
    })));
```

Run : `npx jest __tests__/OpenMatchCard.test.tsx -t Partager`
Attendu : FAIL (URL sans `?s=`, pas de `text`).

- [ ] **Step 2 : Câbler `OpenMatchCard`**

a) Import en tête de fichier :

```tsx
import { matchShareUrl, matchShareText } from '@/lib/matchShare';
```

b) Remplacer le `<MatchShareButton …>` (~l.126) par :

```tsx
        <MatchShareButton
          compact
          style={actionBtn}
          title={`Partie ouverte · ${m.resourceName}`}
          text={matchShareText(m, null, timezone)}
          url={typeof window !== 'undefined' ? matchShareUrl(window.location.origin, m) : `/parties/${m.id}`}
        />
```

(`timezone` est déjà une prop d'`OpenMatchCard` ; `clubName` volontairement `null` sur
les cartes — le lien porte déjà le sous-domaine du club.)

- [ ] **Step 3 : Câbler `OpenMatchDetail`**

a) Import :

```tsx
import { matchShareUrl, matchShareText } from '@/lib/matchShare';
```

b) Sur le `<ShareActions …>` (~l.76), ajouter les deux props — le `item={…}` reprend le
bloc existant tel quel (état actuel du fichier ; le relire avant d'éditer) :

```tsx
            <ShareActions
              uidPrefix="match"
              shareUrl={typeof window !== 'undefined' ? matchShareUrl(window.location.origin, match) : undefined}
              shareText={matchShareText(match, club.name, club.timezone)}
              item={{
                id: match.id,
                name: `Partie ouverte · ${match.resourceName}`,
                description: [
                  match.full ? 'Complet' : `${match.spotsLeft} place${match.spotsLeft > 1 ? 's' : ''}`,
                  (match.targetLevelMin != null || match.targetLevelMax != null) ? rangeLabel(match.targetLevelMin ?? null, match.targetLevelMax ?? null) : null,
                  club.name,
                ].filter(Boolean).join(' · '),
                startTime: match.startTime,
                endTime: match.endTime,
                club: { name: club.name },
              }}
            />
```

- [ ] **Step 4 : Vérifier le vert (suites impactées)**

Run : `npx jest __tests__/OpenMatchCard __tests__/OpenMatchDetail.test.tsx __tests__/OpenMatches.test.tsx`
Attendu : PASS. (Ces suites montent le vrai `ClubNav` — si un mock `lib/api` casse, c'est
qu'il lui manque une méthode récemment ajoutée, cf. note mémoire ; compléter le mock,
ne pas retirer l'appel.)

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/components/openmatch/OpenMatchDetail.tsx frontend/__tests__/OpenMatchCard.test.tsx frontend/__tests__/OpenMatchDetail.test.tsx
git commit -m "feat(og-card): URL de partage versionnée ?s= + texte enrichi (carte + page détail)"
```

---

### Task 10 : `generateMetadata` — og:image carte 1200×630

**Files:**
- Modify: `frontend/app/parties/[id]/page.tsx` (l.22 et le bloc `return`)
- Test: `frontend/__tests__/OpenMatchPageMetadata.test.ts` (nouveau)

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// frontend/__tests__/OpenMatchPageMetadata.test.ts
/** Teste generateMetadata (composant serveur) en isolant next/headers et l'enfant client. */

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: (k: string) => (k === 'x-club-slug' ? 'demo' : null) })),
}));
jest.mock('../components/openmatch/OpenMatchDetail', () => ({ OpenMatchDetail: () => null }));
jest.mock('../lib/api', () => ({
  api: { getClub: jest.fn(), getOpenMatch: jest.fn() },
  assetUrl: (u: string) => u,
}));

import { generateMetadata } from '../app/parties/[id]/page';
import { api } from '../lib/api';

const getClub = api.getClub as jest.Mock;
const getOpenMatch = api.getOpenMatch as jest.Mock;

const matchStub = {
  id: 'm1', resourceName: 'Court 2',
  startTime: '2026-07-04T16:00:00.000Z', endTime: '2026-07-04T17:30:00.000Z',
  maxPlayers: 4, spotsLeft: 2, full: false, players: [],
  viewerIsParticipant: false, viewerIsOrganizer: false,
  targetLevelMin: 6, targetLevelMax: 7, lastMessageAt: null, unreadCount: 0,
  cardVersion: 'abc123def456',
};

describe('generateMetadata /parties/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getClub.mockResolvedValue({ name: 'Padel Arena', timezone: 'Europe/Paris' });
    getOpenMatch.mockResolvedValue(matchStub);
  });

  it("og:image = carte dynamique versionnée, format summary_large_image", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'm1' }) });
    const img = (meta.openGraph?.images as Array<{ url: string; width?: number; height?: number }>)[0];
    expect(img.url).toContain('/api/clubs/demo/open-matches/m1/card.png?v=abc123def456');
    expect(img.width).toBe(1200);
    expect(img.height).toBe(630);
    expect((meta.twitter as { card?: string }).card).toBe('summary_large_image');
  });

  it('échec du fetch → repli neutre sans throw', async () => {
    getOpenMatch.mockRejectedValue(new Error('boom'));
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'm1' }) });
    expect(meta.title).toBe('Partie ouverte · Palova');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npx jest __tests__/OpenMatchPageMetadata.test.ts`
Attendu : FAIL — l'`og:image` actuelle est `…/icon/512.png` (et `twitter.card` = `summary`).

- [ ] **Step 3 : Implémenter**

Dans `frontend/app/parties/[id]/page.tsx`, remplacer les lignes `const image = …` et le `return { … }` :

```ts
    const image = `${API_URL}/api/clubs/${slug}/open-matches/${id}/card.png${match.cardVersion ? `?v=${match.cardVersion}` : ''}`;
    return {
      title,
      description,
      openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }], type: 'website' },
      twitter: { card: 'summary_large_image', title, description, images: [image] },
    };
```

- [ ] **Step 4 : Vérifier le vert**

Run : `npx jest __tests__/OpenMatchPageMetadata.test.ts`
Attendu : PASS (2 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/parties/[id]/page.tsx frontend/__tests__/OpenMatchPageMetadata.test.ts
git commit -m "feat(og-card): og:image = carte dynamique 1200x630 (summary_large_image)"
```

---

### Task 11 : Polices prod (Dockerfile) + documentation

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `CLAUDE.md` (section « Partage d'une partie ouverte (v1) »)

- [ ] **Step 1 : Dockerfile**

Dans `backend/Dockerfile`, après `WORKDIR /app`, ajouter :

```dockerfile
# Polices pour le rendu SVG→PNG des cartes OG de parties (sharp/librsvg) —
# sans elles le texte des cartes ne se rasterise pas.
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2 : CLAUDE.md**

À la fin de la section « ## Partage d'une partie ouverte (v1) ✅ implémenté », ajouter :

```markdown
> **Évolution (2026-07-02) — « lien vivant » (carte OG dynamique) :** l'aperçu WhatsApp du lien devient une **carte-image 1200×630 de l'état réel du match** (équipes G/D avec avatars ou pastilles d'initiales `colorForSeed` — miroir backend `src/utils/playerColors.ts`, ⚠️ à garder synchro avec `frontend/lib/playerColors.ts` —, places restantes, fourchette niveau, date au fuseau du club, dégradé accentColor + logo). Backend : `matchCard.service.ts` (rendu sharp calqué sur `icon.service.ts`, cache disque `uploads/ogcards/<matchId>-<cardVersion>.png` avec purge des états précédents, **repli PNG embarqué `assets/og-card-fallback.png` — jamais de 500 pour un crawler**, garde anti-traversée sur id/avatars), hash d'état pur `matchCardState.ts` (`CARD_RENDER_VERSION` à incrémenter quand le visuel change), **`cardVersion` additif dans le DTO** des parties (`toDTO`), route publique `GET /:slug/open-matches/:id/card.png` (`Cache-Control: public, max-age=300`, `?v=` ignoré). **Cache WhatsApp contourné** : l'URL partagée est versionnée **`/parties/{id}?s=<cardVersion>`** (helpers purs `frontend/lib/matchShare.ts` : `matchShareUrl`/`matchShareText`) — chaque partage d'un nouvel état force un re-crawl ; `generateMetadata` pointe `og:image` sur `card.png?v=` (1200×630, `summary_large_image`). `MatchShareButton` gagne `text?`, `ShareActions` gagne `shareUrl?`/`shareText?` (fiches tournoi/event inchangées). **Aucune migration.** ⚠️ Prod : `fonts-dejavu-core` installé dans l'image Docker backend (sinon cartes sans texte). Spec & plan : `docs/superpowers/{specs,plans}/2026-07-02-lien-vivant-partage-partie*`.
```

- [ ] **Step 3 : Commit**

```bash
git add backend/Dockerfile CLAUDE.md
git commit -m "docs(og-card): polices Docker + doc CLAUDE.md du lien vivant"
```

---

### Task 12 : Vérification finale

- [ ] **Step 1 : Suite backend complète**

Run (dans `backend/`) : `npm test`
Attendu : PASS. (En worktree isolé, 3 échecs `icon.routes` sont la base connue — dans le
repo principal, tout doit être vert.)

- [ ] **Step 2 : Type-check backend**

Run : `npx tsc --noEmit`
Attendu : aucune erreur (au moins aucune dans les fichiers du plan — du WIP utilisateur
peut coexister ; ne corriger que ce que le plan a introduit).

- [ ] **Step 3 : Suites frontend ciblées**

Run (dans `frontend/`) : `npx jest matchShare MatchShareButton ShareActions OpenMatchCard OpenMatchDetail OpenMatches OpenMatchPageMetadata`
Attendu : PASS. (La suite complète `npx jest` a un flake BookingModal connu — ne pas s'y fier.)

- [ ] **Step 4 : Type-check frontend**

Run : `npx tsc --noEmit`
Attendu : aucune erreur dans les fichiers du plan (jest ne type-check pas — cette passe est
le vrai portail de types).

- [ ] **Step 5 : Vérification E2E manuelle (smoke)**

1. Redémarrer le backend (réflexe anti « backend orphelin » : une nouvelle route qui 404
   alors que les anciennes répondent = vieux process).
2. `curl -o card.png "http://localhost:3001/api/clubs/<slug>/open-matches/<id>/card.png"`
   sur une partie ouverte existante (id visible dans `/parties`) → ouvrir `card.png` :
   carte 1200×630 avec équipes/places/niveau.
3. `curl "http://localhost:3001/api/clubs/<slug>/open-matches/id-bidon/card.png" -o fb.png`
   → image de repli (200).
4. Sur `/parties`, cliquer « Partager » (navigateur sans Web Share → « Lien copié ! ») et
   vérifier que l'URL copiée finit par `?s=<12 hex>`.

- [ ] **Step 6 : Rapport final**

Résumer : tests backend/frontend passés, type-checks OK, smoke E2E fait. Signaler tout
écart. Ne PAS merger/pousser sans demande explicite.
