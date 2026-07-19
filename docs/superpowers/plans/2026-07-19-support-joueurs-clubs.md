# Support joueurs & clubs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support à 2 étages — page `/aide` publique côté joueur (contact club + FAQ club existante) et formulaire `/admin/support` côté club qui crée une issue GitHub dans le repo privé dédié `enouga/palova-support` via l'API (token bot, fallback email, accusé de réception).

**Architecture:** Aucune migration, rien en base — GitHub Issues est la source de vérité des tickets. Backend : un `SupportService` (builder d'issue pur + `createTicket` avec fetch natif + repli email) derrière une route admin gatée STAFF avec rate-limit Redis. Frontend : `/aide` réutilise `FaqView`/`getClubPresentation` existants ; `/admin/support` réutilise `PLATFORM_FAQ` via une prop additive de `FaqView`.

**Tech Stack:** Express + Prisma (mocké en test), fetch natif + AbortController (pattern `geo.service.ts`), nodemailer `sendMail`, Next.js 16, Jest + supertest + RTL.

**Spec:** `docs/superpowers/specs/2026-07-19-support-joueurs-clubs-design.md`

**⚠️ Conventions repo :**
- Jest/tsc : les shims `node_modules/.bin` sont cassés → `node node_modules/jest/bin/jest.js --runTestsByPath <fichier>` et `node node_modules/typescript/bin/tsc --noEmit` (cwd `backend/` ou `frontend/`). `--runTestsByPath` obligatoire pour cibler UN fichier (piège casse Windows).
- Jamais de `git stash` (pile partagée entre worktrees). Commits fréquents à la place.
- Prérequis manuels d'Eric (spec §6, PAS dans ce plan) : créer le repo `enouga/palova-support` + 4 labels, générer le PAT fine-grained Issues-only, poser les env prod sur la VM.

## File Structure

**Backend**
- Create `backend/src/email/templates/support.ts` — builder pur `buildSupportAckEmail`
- Create `backend/src/services/support.service.ts` — `SUPPORT_CATEGORIES`, `buildIssuePayload` (pur), `SupportService.createTicket`
- Create `backend/src/services/__tests__/support.service.test.ts`
- Modify `backend/src/routes/admin.ts` — route `POST /support/tickets` + `RATE_LIMITED`/`SUPPORT_UNAVAILABLE` dans `ERROR_STATUS`
- Create `backend/src/routes/__tests__/admin.support.routes.test.ts`
- Modify `.env.prod.example` + `docker-compose.prod.yml` — 3 variables

**Frontend**
- Modify `frontend/lib/authGate.ts` — `/aide` dans `PUBLIC_PATHS`
- Modify `frontend/lib/api.ts` — `SupportTicketCategory` + `adminCreateSupportTicket`
- Modify `frontend/components/content/FaqView.tsx` — props additives `source`/`heading`
- Create `frontend/app/aide/page.tsx` — page Aide joueur
- Modify `frontend/components/ProfileMenu.tsx` + `frontend/components/Footer.tsx` — liens Aide
- Create `frontend/app/admin/support/page.tsx` — page Support club
- Modify `frontend/app/admin/layout.tsx` — entrée nav Support
- Tests : create `frontend/__tests__/AidePage.test.tsx`, `frontend/__tests__/AdminSupport.test.tsx` ; modify `authGate.test.ts`, `ProfileMenu.test.tsx`, `AdminLayout.test.tsx`

**Docs** : Modify `CLAUDE.md` (nouvelle section feature)

---

### Task 0 : Branche isolée

- [ ] **Step 1 : Créer la branche de travail**

Utiliser le skill `superpowers:using-git-worktrees` (worktree recommandé — la branche courante porte du WIP Découvrir). Base : `main`. Nom : `feat/support-clubs`. Setup worktree selon la mémoire « Worktree setup for palova » (junction node_modules, copie `backend/.env` + `frontend/.env.local`). Aucune migration à appliquer pour cette feature.

---

### Task 1 : Builder d'accusé de réception `buildSupportAckEmail` (pur)

**Files:**
- Create: `backend/src/email/templates/support.ts`
- Test: `backend/src/email/__tests__/support-emails.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// backend/src/email/__tests__/support-emails.test.ts
import { buildSupportAckEmail } from '../templates/support';
import { PALOVA_BRAND } from '../templates/layout';

describe('buildSupportAckEmail', () => {
  it('inclut le numéro de ticket dans le sujet et le corps', () => {
    const m = buildSupportAckEmail({ number: 42, subject: 'Planning cassé', clubName: 'Padel Arena Paris', brand: PALOVA_BRAND });
    expect(m.subject).toBe('Votre demande #42 a bien été reçue');
    expect(m.html).toContain('#42');
    expect(m.text).toContain('#42');
    expect(m.html).toContain('Planning cassé');
  });

  it('sans numéro (repli email) : sujet sans référence', () => {
    const m = buildSupportAckEmail({ number: null, subject: 'Question tarifs', clubName: 'Padel Arena Paris', brand: PALOVA_BRAND });
    expect(m.subject).toBe('Votre demande a bien été reçue');
    expect(m.html).not.toContain('#');
  });

  it('échappe le HTML du sujet saisi', () => {
    const m = buildSupportAckEmail({ number: 1, subject: '<img src=x>', clubName: 'Club', brand: PALOVA_BRAND });
    expect(m.html).not.toContain('<img src=x>');
    expect(m.html).toContain('&lt;img');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run (cwd `backend/`): `node node_modules/jest/bin/jest.js --runTestsByPath src/email/__tests__/support-emails.test.ts`
Expected: FAIL — `Cannot find module '../templates/support'`

- [ ] **Step 3 : Implémenter le builder**

```ts
// backend/src/email/templates/support.ts
// Accusé de réception d'un ticket support club → Palova. Identité PALOVA (jamais brandé
// club : c'est Palova qui répond au club) — hors registre des emails personnalisables.
import { Brand, escapeHtml, renderLayout } from './layout';
import type { BuiltEmail } from './emails';

export interface SupportAckInput {
  number: number | null;   // null = ticket parti par le repli email, pas de n° GitHub
  subject: string;
  clubName: string;
  brand: Brand;
}

export function buildSupportAckEmail(i: SupportAckInput): BuiltEmail {
  const ref = i.number != null ? ` #${i.number}` : '';
  const subject = `Votre demande${ref} a bien été reçue`;
  const introHtml = `<p style="margin:0;">Nous avons bien reçu votre demande${ref ? ` <strong>${escapeHtml(ref.trim())}</strong>` : ''} « ${escapeHtml(i.subject)} » pour ${escapeHtml(i.clubName)}. Nous revenons vers vous par email au plus vite.</p>`;
  const html = renderLayout({
    brand: i.brand,
    preheader: subject,
    heading: 'Demande transmise à Palova',
    introHtml,
    footerNote: 'Cet email est un accusé de réception automatique.',
  });
  const text = [
    `Nous avons bien reçu votre demande${ref} « ${i.subject} » pour ${i.clubName}.`,
    'Nous revenons vers vous par email au plus vite.',
  ].join('\n');
  return { subject, html, text };
}
```

Note : si `BuiltEmail` n'est pas exporté par `./emails`, regarder comment `templates/moderation.ts` le résout et faire pareil (dernier recours : interface locale `{ subject: string; html: string; text: string }`). Vérifier aussi la signature exacte de `renderLayout` dans `layout.ts` (champs `preheader`/`heading`/`introHtml`/`footerNote` — pattern `buildVerificationEmail` dans `emails.ts:34-56`).

- [ ] **Step 4 : Vérifier que ça passe**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath src/email/__tests__/support-emails.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5 : Commit**

```bash
git add backend/src/email/templates/support.ts backend/src/email/__tests__/support-emails.test.ts
git commit -m "feat(support): accuse de reception email (builder pur, identite Palova)"
```

---

### Task 2 : `SupportService` — builder d'issue pur + `createTicket`

**Files:**
- Create: `backend/src/services/support.service.ts`
- Test: `backend/src/services/__tests__/support.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// backend/src/services/__tests__/support.service.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

jest.mock('../../email/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));
const { sendMail } = require('../../email/mailer');

import { SupportService, buildIssuePayload } from '../support.service';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const CTX = { clubName: 'Padel Arena Paris', clubSlug: 'padel-arena-paris', senderName: 'Jean Dupont', senderEmail: 'jean@x.fr', senderRole: 'STAFF', activeMemberCount: 87 as number | null };
const INPUT = { category: 'BUG' as const, subject: 'Planning cassé', description: 'Le planning ne charge plus\nsur mobile.' };

describe('buildIssuePayload (pur)', () => {
  it('construit titre, label et body avec description citée', () => {
    const p = buildIssuePayload(CTX, INPUT, '2026-07-19T10:00:00.000Z');
    expect(p.title).toBe('[Bug] Planning cassé — Padel Arena Paris');
    expect(p.labels).toEqual(['bug']);
    expect(p.body).toContain('**Club** : Padel Arena Paris (padel-arena-paris.palova.fr)');
    expect(p.body).toContain('**Expéditeur** : Jean Dupont (jean@x.fr) — STAFF');
    expect(p.body).toContain('**Membres actifs** : 87');
    expect(p.body).toContain('> Le planning ne charge plus');
    expect(p.body).toContain('> sur mobile.');
  });

  it('membres actifs inconnus → « ? » (jamais bloquant)', () => {
    const p = buildIssuePayload({ ...CTX, activeMemberCount: null }, INPUT, '2026-07-19T10:00:00.000Z');
    expect(p.body).toContain('**Membres actifs** : ?');
  });
});

describe('SupportService.createTicket', () => {
  let service: SupportService;

  beforeEach(() => {
    service = new SupportService();
    fetchMock.mockReset();
    (sendMail as jest.Mock).mockClear().mockResolvedValue(undefined);
    process.env.GITHUB_SUPPORT_TOKEN = 'ghp_test';
    process.env.GITHUB_SUPPORT_REPO = 'enouga/palova-support';
    prismaMock.club.findUnique.mockResolvedValue({ name: 'Padel Arena Paris', slug: 'padel-arena-paris', activeMemberCount: 87 } as any);
    prismaMock.user.findUnique.mockResolvedValue({ deletedAt: null, firstName: 'Jean', lastName: 'Dupont', email: 'jean@x.fr' } as any);
    prismaMock.clubMember.findUnique.mockResolvedValue({ role: 'STAFF' } as any);
  });

  afterEach(() => {
    delete process.env.GITHUB_SUPPORT_TOKEN;
    delete process.env.GITHUB_SUPPORT_REPO;
  });

  it('succès GitHub : appelle l API avec token + payload, renvoie le numéro, accuse réception', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ number: 42 }) });
    const r = await service.createTicket('club-demo', 'user-1', INPUT);
    expect(r).toEqual({ number: 42 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/enouga/palova-support/issues');
    expect(opts.headers.Authorization).toBe('Bearer ghp_test');
    const body = JSON.parse(opts.body);
    expect(body.title).toBe('[Bug] Planning cassé — Padel Arena Paris');
    expect(body.labels).toEqual(['bug']);
    await new Promise((r2) => setImmediate(r2)); // accusé best-effort
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'jean@x.fr', subject: expect.stringContaining('#42') }));
  });

  it('GitHub en échec : repli email au support, renvoie number null', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const r = await service.createTicket('club-demo', 'user-1', INPUT);
    expect(r).toEqual({ number: null });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'contact@palova.fr', subject: '[Bug] Planning cassé — Padel Arena Paris' }));
  });

  it('GitHub ET repli email en échec : SUPPORT_UNAVAILABLE', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    (sendMail as jest.Mock).mockRejectedValue(new Error('smtp down'));
    await expect(service.createTicket('club-demo', 'user-1', INPUT)).rejects.toThrow('SUPPORT_UNAVAILABLE');
  });

  it('sans token (dev) : pas de fetch, pas de repli, number null', async () => {
    delete process.env.GITHUB_SUPPORT_TOKEN;
    const r = await service.createTicket('club-demo', 'user-1', INPUT);
    expect(r).toEqual({ number: null });
    expect(fetchMock).not.toHaveBeenCalled();
    await new Promise((r2) => setImmediate(r2));
    // seul l'accusé part (pas le repli contact@)
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect((sendMail as jest.Mock).mock.calls[0][0].to).toBe('jean@x.fr');
  });

  it('échec de l accusé de réception : le ticket réussit quand même', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ number: 7 }) });
    (sendMail as jest.Mock).mockRejectedValue(new Error('smtp down'));
    await expect(service.createTicket('club-demo', 'user-1', INPUT)).resolves.toEqual({ number: 7 });
  });

  it.each([
    [{ ...INPUT, category: 'NOPE' as never }],
    [{ ...INPUT, subject: 'ab' }],
    [{ ...INPUT, subject: 'x'.repeat(121) }],
    [{ ...INPUT, description: 'court' }],
    [{ ...INPUT, description: 'x'.repeat(5001) }],
  ])('validation refusée → VALIDATION_ERROR (%#)', async (bad) => {
    await expect(service.createTicket('club-demo', 'user-1', bad)).rejects.toThrow('VALIDATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/support.service.test.ts`
Expected: FAIL — `Cannot find module '../support.service'`

- [ ] **Step 3 : Implémenter le service**

```ts
// backend/src/services/support.service.ts
// Tickets support club → Palova : crée une issue GitHub dans le repo privé dédié
// (GITHUB_SUPPORT_REPO) via un fine-grained PAT scopé Issues-only — le staff club ne
// voit jamais GitHub. Rien n'est stocké en base : GitHub Issues est la source de vérité.
import { prisma } from '../db/prisma';
import { sendMail } from '../email/mailer';
import { PALOVA_BRAND } from '../email/templates/layout';
import { buildSupportAckEmail } from '../email/templates/support';

export type SupportCategory = 'BUG' | 'QUESTION' | 'SUGGESTION' | 'BILLING';

export const SUPPORT_CATEGORIES: Record<SupportCategory, { label: string; ghLabel: string }> = {
  BUG:        { label: 'Bug',         ghLabel: 'bug' },
  QUESTION:   { label: 'Question',    ghLabel: 'question' },
  SUGGESTION: { label: 'Suggestion',  ghLabel: 'suggestion' },
  BILLING:    { label: 'Facturation', ghLabel: 'facturation' },
};

export interface SupportTicketInput { category: SupportCategory; subject: string; description: string }
export interface TicketContext {
  clubName: string; clubSlug: string;
  senderName: string; senderEmail: string; senderRole: string;
  /** Palier billing observé (Club.activeMemberCount) — contexte de tri, null si inconnu. */
  activeMemberCount: number | null;
}

const GITHUB_TIMEOUT_MS = 10_000;

/** Payload d'issue GitHub. La description est citée (`> `) : neutralise titres/mentions markdown. */
export function buildIssuePayload(ctx: TicketContext, input: SupportTicketInput, nowIso: string): { title: string; body: string; labels: string[] } {
  const meta = SUPPORT_CATEGORIES[input.category];
  const quoted = input.description.split('\n').map((l) => `> ${l}`).join('\n');
  return {
    title: `[${meta.label}] ${input.subject} — ${ctx.clubName}`,
    labels: [meta.ghLabel],
    body: [
      `**Club** : ${ctx.clubName} (${ctx.clubSlug}.palova.fr)`,
      `**Expéditeur** : ${ctx.senderName} (${ctx.senderEmail}) — ${ctx.senderRole}`,
      `**Catégorie** : ${meta.label}`,
      `**Membres actifs** : ${ctx.activeMemberCount ?? '?'}`,
      `**Date** : ${nowIso}`,
      '',
      '---',
      '',
      quoted,
    ].join('\n'),
  };
}

function assertValidInput(input: SupportTicketInput): void {
  const subject = (input.subject ?? '').trim();
  const description = (input.description ?? '').trim();
  if (!SUPPORT_CATEGORIES[input.category]) throw new Error('VALIDATION_ERROR');
  if (subject.length < 3 || subject.length > 120) throw new Error('VALIDATION_ERROR');
  if (description.length < 10 || description.length > 5000) throw new Error('VALIDATION_ERROR');
}

export class SupportService {
  async createTicket(clubId: string, userId: string, input: SupportTicketInput): Promise<{ number: number | null }> {
    assertValidInput(input);
    const [club, user, member] = await Promise.all([
      prisma.club.findUnique({ where: { id: clubId }, select: { name: true, slug: true, activeMemberCount: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } }),
      prisma.clubMember.findUnique({ where: { userId_clubId: { userId, clubId } }, select: { role: true } }),
    ]);
    if (!club || !user) throw new Error('VALIDATION_ERROR');

    const clean: SupportTicketInput = { ...input, subject: input.subject.trim(), description: input.description.trim() };
    const payload = buildIssuePayload({
      clubName: club.name, clubSlug: club.slug,
      senderName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
      senderEmail: user.email, senderRole: member?.role ?? 'STAFF',
      activeMemberCount: club.activeMemberCount ?? null,
    }, clean, new Date().toISOString());

    let number: number | null = null;
    try {
      number = await this.createGithubIssue(payload);
    } catch (err) {
      // Repli : jamais de ticket perdu — le contenu part par email au support Palova.
      console.error('[support] issue GitHub échouée, repli email', (err as Error).message);
      const fallbackTo = process.env.SUPPORT_FALLBACK_EMAIL || 'contact@palova.fr';
      try {
        await sendMail({ to: fallbackTo, subject: payload.title, text: payload.body });
      } catch (e2) {
        console.error('[support] repli email échoué aussi', (e2 as Error).message);
        throw new Error('SUPPORT_UNAVAILABLE');
      }
    }

    const ack = buildSupportAckEmail({ number, subject: clean.subject, clubName: club.name, brand: PALOVA_BRAND });
    sendMail({ to: user.email, subject: ack.subject, html: ack.html, text: ack.text })
      .catch((e) => console.error('[support] accusé de réception échoué', (e as Error).message));

    return { number };
  }

  /** null = GitHub non configuré (dev) ; throw = configuré mais en échec (→ repli). */
  private async createGithubIssue(p: { title: string; body: string; labels: string[] }): Promise<number | null> {
    const token = process.env.GITHUB_SUPPORT_TOKEN;
    const repo = process.env.GITHUB_SUPPORT_REPO;
    if (!token || !repo) {
      console.log('[support:dev] GitHub non configuré — ticket loggé :', p.title);
      return null;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GITHUB_TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(p),
      });
      if (!res.ok) throw new Error(`GITHUB_HTTP_${res.status}`);
      const data = (await res.json()) as { number?: number };
      return typeof data.number === 'number' ? data.number : null;
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4 : Vérifier que ça passe**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/support.service.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/support.service.ts backend/src/services/__tests__/support.service.test.ts
git commit -m "feat(support): SupportService — issue GitHub + repli email, jamais de ticket perdu"
```

---

### Task 3 : Route `POST /api/clubs/:clubId/admin/support/tickets`

**Files:**
- Modify: `backend/src/routes/admin.ts` (table `ERROR_STATUS` ~l.70-132, instanciations de services en tête, nouvelle route en fin de fichier avant l'export)
- Test: `backend/src/routes/__tests__/admin.support.routes.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// backend/src/routes/__tests__/admin.support.routes.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import '../../__mocks__/redis'; // cache auth (merge perfs 2026-07-18) — inoffensif si inutile
import request from 'supertest';
import jwt from 'jsonwebtoken';

const assertRateLimitMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/rateLimit', () => ({ assertRateLimit: (...a: unknown[]) => assertRateLimitMock(...a) }));
jest.mock('../../email/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));

import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant');
const token = jwt.sign({ id: 'user-1', email: 'jean@x.fr' }, SECRET, { expiresIn: '1h' });
const url = '/api/clubs/club-demo/admin/support/tickets';
const BODY = { category: 'BUG', subject: 'Planning cassé', description: 'Le planning ne charge plus sur mobile.' };

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const asMember = (role = 'STAFF') => prismaMock.clubMember.findUnique.mockResolvedValue({ role } as any);

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ number: 42 }) });
  assertRateLimitMock.mockClear().mockResolvedValue(undefined);
  process.env.GITHUB_SUPPORT_TOKEN = 'ghp_test';
  process.env.GITHUB_SUPPORT_REPO = 'enouga/palova-support';
  prismaMock.club.findUnique.mockResolvedValue({ name: 'Padel Arena Paris', slug: 'padel-arena-paris' } as any);
  prismaMock.user.findUnique.mockResolvedValue({ deletedAt: null, firstName: 'Jean', lastName: 'Dupont', email: 'jean@x.fr' } as any);
});

afterEach(() => { delete process.env.GITHUB_SUPPORT_TOKEN; delete process.env.GITHUB_SUPPORT_REPO; });

describe('POST /admin/support/tickets', () => {
  it('201 pour un STAFF, renvoie le numéro, applique le rate limit', async () => {
    asMember('STAFF');
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`).send(BODY);
    expect(res.status).toBe(201);
    expect(res.body.number).toBe(42);
    expect(assertRateLimitMock).toHaveBeenCalledWith('support', 'user-1', 5, 3600);
  });

  it('403 si non membre du club', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`).send(BODY);
    expect(res.status).toBe(403);
  });

  it('400 sur catégorie inconnue', async () => {
    asMember('STAFF');
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`).send({ ...BODY, category: 'NOPE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('429 quand le rate limit lève', async () => {
    asMember('STAFF');
    assertRateLimitMock.mockRejectedValue(new Error('RATE_LIMITED'));
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`).send(BODY);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('RATE_LIMITED');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath src/routes/__tests__/admin.support.routes.test.ts`
Expected: FAIL — 404 sur la route (elle n'existe pas encore)

- [ ] **Step 3 : Implémenter la route**

Dans `backend/src/routes/admin.ts` :

1. Imports (en tête, avec les autres) :
```ts
import { SupportService } from '../services/support.service';
import { assertRateLimit } from '../services/rateLimit';
```
2. Instanciation (avec les autres services, ex. près de `broadcastService`) :
```ts
const supportService = new SupportService();
```
3. Dans la table `ERROR_STATUS` (~l.70-132), ajouter :
```ts
  RATE_LIMITED:           429,
  SUPPORT_UNAVAILABLE:    502,
```
(vérifier que `VALIDATION_ERROR: 400` y est déjà — oui.)

4. La route, en fin de fichier avant l'export (le `router.use(authMiddleware, requireClubMember('STAFF'))` global couvre déjà l'auth ; gate explicite par cohérence avec `/broadcast`) :
```ts
// --- Support : ticket club → Palova (issue GitHub, cf. support.service) ---
router.post('/support/tickets', requireClubMember('STAFF'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    await assertRateLimit('support', req.user!.id, 5, 3600);
    const { category, subject, description } = req.body;
    const result = await supportService.createTicket(req.membership!.clubId, req.user!.id, { category, subject, description });
    res.status(201).json(result);
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4 : Vérifier que ça passe + non-régression backend**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath src/routes/__tests__/admin.support.routes.test.ts`
Expected: PASS (4 tests)
Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: 0 erreur (scoper la lecture aux fichiers de cette feature si du WIP parallèle traîne)

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.support.routes.test.ts
git commit -m "feat(support): route POST /admin/support/tickets (STAFF, rate limit 5/h)"
```

---

### Task 4 : Config prod (env + docker-compose)

**Files:**
- Modify: `.env.prod.example`
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1 : Documenter les variables dans `.env.prod.example`**

Ajouter (à la suite des blocs existants, style des commentaires SMTP) :
```bash
# --- Support club → Palova (issues GitHub) ---
# Fine-grained PAT scopé au SEUL repo palova-support, permission Issues: Read & write.
# TOKEN/REPO absents → mode console (dev) : le ticket est loggé, pas d'issue ni d'email.
# SUPPORT_FALLBACK_EMAIL = destinataire du repli quand GitHub est configuré mais en échec.
GITHUB_SUPPORT_TOKEN=
GITHUB_SUPPORT_REPO=enouga/palova-support
SUPPORT_FALLBACK_EMAIL=contact@palova.fr
```

- [ ] **Step 2 : Transmettre au conteneur backend dans `docker-compose.prod.yml`**

Dans le service backend, ajouter les 3 variables à la liste `environment:` en copiant EXACTEMENT la syntaxe des lignes `SMTP_*` existantes (même style `VAR: ${VAR}` ou `- VAR=${VAR}` selon le fichier).

- [ ] **Step 3 : Commit**

```bash
git add .env.prod.example docker-compose.prod.yml
git commit -m "chore(support): variables GitHub support transmises au conteneur prod"
```

---

### Task 5 : Front — api, chemin public, `FaqView` paramétrable

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/lib/authGate.ts:3-7`
- Modify: `frontend/components/content/FaqView.tsx:42-52,83-85`
- Test: `frontend/__tests__/authGate.test.ts` (modif)

- [ ] **Step 1 : Test authGate qui échoue**

Dans `frontend/__tests__/authGate.test.ts`, ajouter au bloc existant sur `isPublicPath` :
```ts
it('/aide est public (page Aide joueur)', () => {
  expect(isPublicPath('/aide')).toBe(true);
  expect(isClubPublicPath('/aide')).toBe(true);
  expect(isPlatformPublicPath('/aide')).toBe(true);
});
```

Run (cwd `frontend/`): `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/authGate.test.ts`
Expected: FAIL (`/aide` non public)

- [ ] **Step 2 : Implémenter les 3 modifs**

`frontend/lib/authGate.ts` — ajouter `'/aide'` à `PUBLIC_PATHS` :
```ts
export const PUBLIC_PATHS = [
  '/login', '/register', '/clubs/new', '/forgot-password',
  '/parties', '/club', '/session-bridge', '/aide',
  '/faq', '/cgv', '/mentions-legales', '/confidentialite', '/offres', '/tarifs',
];
```

`frontend/lib/api.ts` — type + méthode (dans la zone admin, près des autres méthodes admin) :
```ts
export type SupportTicketCategory = 'BUG' | 'QUESTION' | 'SUGGESTION' | 'BILLING';
```
```ts
  adminCreateSupportTicket: (clubId: string, body: { category: SupportTicketCategory; subject: string; description: string }, token: string) =>
    request<{ number: number | null }>(`/api/clubs/${clubId}/admin/support/tickets`, { method: 'POST', body: JSON.stringify(body) }, token),
```

`frontend/components/content/FaqView.tsx` — props additives rétro-compatibles (défauts = comportement actuel, aucun call-site existant à toucher) :
```tsx
export function FaqView({ source = 'auto', heading = 'Questions fréquentes' }: { source?: 'auto' | 'platform'; heading?: string | null } = {}) {
```
Dans le `useEffect` (l.48-52), remplacer la condition plateforme :
```tsx
    if (source === 'platform' || !slug) {
      setEntries(PLATFORM_FAQ.map((e, i) => ({ id: `p${i}`, ...e })));
      return;
    }
```
et ajouter `source` aux deps : `}, [slug, source]);`
Dans le rendu (l.85), conditionner le titre :
```tsx
      {heading && <h1 style={{ fontFamily: th.fontUI, fontSize: 28, fontWeight: 800, letterSpacing: -0.4, color: th.text, margin: '0 0 -4px' }}>{heading}</h1>}
```

- [ ] **Step 3 : Vérifier**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/authGate.test.ts`
Expected: PASS
Run: `node node_modules/jest/bin/jest.js FaqView ClubFaq` (suites existantes touchant FaqView, si elles existent — sinon sauter)
Expected: PASS (rétro-compatibilité)

- [ ] **Step 4 : Commit**

```bash
git add frontend/lib/api.ts frontend/lib/authGate.ts frontend/components/content/FaqView.tsx frontend/__tests__/authGate.test.ts
git commit -m "feat(support): api ticket + /aide public + FaqView source/heading parametrables"
```

---

### Task 6 : Page joueur `/aide` + liens ProfileMenu & Footer

**Files:**
- Create: `frontend/app/aide/page.tsx`
- Modify: `frontend/components/ui/Icon.tsx` (nouvelle icône `phone`)
- Modify: `frontend/components/ProfileMenu.tsx:161-178`
- Modify: `frontend/components/Footer.tsx:20-27`
- Test: `frontend/__tests__/AidePage.test.tsx` (create), `frontend/__tests__/ProfileMenu.test.tsx` (modif)

- [ ] **Step 1 : Écrire les tests qui échouent**

```tsx
// frontend/__tests__/AidePage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import AidePage from '@/app/aide/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

const replaceMock = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: replaceMock, push: jest.fn() }) }));

let clubCtx: any = {
  slug: 'padel-arena-paris',
  club: { id: 'club-demo', name: 'Padel Arena Paris', address: '12 rue du Padel', city: 'Paris' },
};
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => clubCtx }));

jest.mock('@/lib/api', () => ({
  assetUrl: (u: string) => u,
  api: {
    getClubPresentation: jest.fn(),
    getClubFaq: jest.fn(),
  },
}));

const PRES = {
  presentationText: null, coverImageUrl: null, address: '12 rue du Padel', city: 'Paris',
  latitude: null, longitude: null, contactPhone: '01 23 45 67 89', contactEmail: 'accueil@arena.fr',
  openingHoursText: 'Tous les jours 8h–22h', foundedYear: null, amenities: [], photos: [],
};

function renderPage(pres = PRES) {
  const { api } = require('@/lib/api');
  api.getClubPresentation.mockResolvedValue(pres);
  api.getClubFaq.mockResolvedValue({ socle: [{ id: 's1', category: 'Réserver un terrain', question: 'Comment réserver ?', answer: 'Sur le site.' }], custom: [] });
  return render(<ThemeProvider><AidePage /></ThemeProvider>);
}

beforeEach(() => {
  replaceMock.mockClear();
  clubCtx = { slug: 'padel-arena-paris', club: { id: 'club-demo', name: 'Padel Arena Paris', address: '12 rue du Padel', city: 'Paris' } };
});

it('affiche les coordonnées du club (tel, email, horaires) et l encart Palova', async () => {
  renderPage();
  await waitFor(() => expect(screen.getByText('01 23 45 67 89')).toBeInTheDocument());
  expect(screen.getByRole('link', { name: /01 23 45 67 89/ })).toHaveAttribute('href', 'tel:0123456789');
  expect(screen.getByRole('link', { name: /accueil@arena\.fr/ })).toHaveAttribute('href', 'mailto:accueil@arena.fr');
  expect(screen.getByText(/Tous les jours 8h–22h/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /contact@palova\.fr/ })).toHaveAttribute('href', 'mailto:contact@palova.fr');
});

it('masque les lignes absentes et affiche le repli accueil sans aucune coordonnée', async () => {
  renderPage({ ...PRES, contactPhone: null, contactEmail: null, openingHoursText: null });
  await waitFor(() => expect(screen.getByText(/à l'accueil du club/i)).toBeInTheDocument());
  expect(screen.queryByRole('link', { name: /tel:/ })).not.toBeInTheDocument();
});

it('rend la FAQ du club (socle)', async () => {
  renderPage();
  await waitFor(() => expect(screen.getByText('Comment réserver ?')).toBeInTheDocument());
});

it('hôte plateforme : redirige vers /faq', async () => {
  clubCtx = { slug: null, club: null };
  renderPage();
  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/faq'));
});
```

Dans `frontend/__tests__/ProfileMenu.test.tsx`, ajouter un cas (suivre le harness existant de la suite — ouverture du menu comprise) :
```tsx
it('propose un lien Aide', async () => {
  // ...ouvrir le menu comme les autres cas de la suite...
  expect(await screen.findByText('Aide')).toBeInTheDocument();
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AidePage.test.tsx`
Expected: FAIL — `Cannot find module '@/app/aide/page'`

- [ ] **Step 3 : Implémenter la page + les liens**

D'abord l'icône `phone` dans `frontend/components/ui/Icon.tsx` (aucune icône téléphone n'existe ; suivre le pattern des cases existants) : ajouter `'phone'` au type `IconName` (l.3-9) et le glyphe dans le `switch` :
```tsx
    case 'phone': glyph = <path d="M7 4.5c.6 1.8 1.4 3.4 2.4 4.9l-1.7 1.7c1.4 2.6 3.6 4.8 6.2 6.2l1.7-1.7c1.5 1 3.1 1.8 4.9 2.4V21c-9.4-.6-16.9-8.1-17.5-17.5H7z" {...p} />; break;
```
(le rendu exact du glyphe importe peu — vérifier visuellement à la Task 8 ; l'important est que `IconName` compile.)

Puis la page :

```tsx
// frontend/app/aide/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type ClubPresentation } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { ContentShell } from '@/components/content/ContentShell';
import { FaqView } from '@/components/content/FaqView';
import { Icon } from '@/components/ui/Icon';

/** Aide joueur : le club est l'interlocuteur de 1er niveau (modèle 2 étages). */
export default function AidePage() {
  const { slug, club } = useClub();
  const router = useRouter();
  const { th } = useTheme();
  const [pres, setPres] = useState<ClubPresentation | null>(null);

  // Hôte plateforme : l'aide joueur n'a pas de club → la FAQ plateforme fait foi.
  useEffect(() => { if (slug === null) router.replace('/faq'); }, [slug, router]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    api.getClubPresentation(slug).then((p) => { if (!cancelled) setPres(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);

  if (slug === null) return null;

  const phone = pres?.contactPhone?.trim() || null;
  const email = pres?.contactEmail?.trim() || null;
  const hours = pres?.openingHoursText?.trim() || null;
  const card: React.CSSProperties = { background: th.surface, border: `1px solid ${th.line}`, borderRadius: 14, padding: '16px 18px' };
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 14.5, color: th.text };

  return (
    <ContentShell>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <h1 style={{ fontFamily: th.fontUI, fontSize: 28, fontWeight: 800, letterSpacing: -0.4, color: th.text, margin: 0 }}>Aide</h1>

        <section aria-label="Contacter le club" style={card}>
          <h2 style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text, margin: '0 0 10px' }}>
            Contacter {club?.name ?? 'le club'}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {club?.address && (
              <div style={row}><Icon name="pin" size={16} color={th.textMute} />{club.address}{club.city ? `, ${club.city}` : ''}</div>
            )}
            {phone && (
              <div style={row}><Icon name="phone" size={16} color={th.textMute} />
                <a href={`tel:${phone.replace(/\s/g, '')}`} style={{ color: th.accent, fontWeight: 600 }}>{phone}</a></div>
            )}
            {email && (
              <div style={row}><Icon name="mail" size={16} color={th.textMute} />
                <a href={`mailto:${email}`} style={{ color: th.accent, fontWeight: 600 }}>{email}</a></div>
            )}
            {hours && (
              <div style={row}><Icon name="clock" size={16} color={th.textMute} />{hours}</div>
            )}
            {!phone && !email && (
              <p style={{ margin: 0, fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
                Renseignez-vous directement à l'accueil du club.
              </p>
            )}
          </div>
        </section>

        <section aria-label="Compte Palova" style={{ ...card, background: th.surface2 }}>
          <p style={{ margin: 0, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
            Un problème avec votre <strong style={{ color: th.text }}>compte Palova</strong> (connexion, données personnelles) ?
            {' '}Écrivez-nous à <a href="mailto:contact@palova.fr" style={{ color: th.accent, fontWeight: 600 }}>contact@palova.fr</a>.
          </p>
        </section>

        <FaqView />
      </div>
    </ContentShell>
  );
}
```

`frontend/components/ProfileMenu.tsx` — dans le bloc Liens (l.161-178), ajouter avant l'entrée « Notifications » :
```tsx
            <MenuItem th={th} icon="info" label="Aide" onClick={() => go(slug ? '/aide' : '/faq')} />
```

`frontend/components/Footer.tsx` — dans la branche club des `links` (l.21-27), ajouter en tête :
```tsx
        { href: '/aide', label: 'Aide' },
```

- [ ] **Step 4 : Vérifier**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AidePage.test.tsx __tests__/ProfileMenu.test.tsx`
Expected: PASS. (Le lien Aide du ProfileMenu n'appelle aucune API — aucun mock nouveau requis dans sa suite.)

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/aide/page.tsx frontend/components/ui/Icon.tsx frontend/components/ProfileMenu.tsx frontend/components/Footer.tsx frontend/__tests__/AidePage.test.tsx frontend/__tests__/ProfileMenu.test.tsx
git commit -m "feat(support): page /aide joueur (contact club + FAQ) + liens ProfileMenu/Footer"
```

---

### Task 7 : Page club `/admin/support` + entrée nav

**Files:**
- Create: `frontend/app/admin/support/page.tsx`
- Modify: `frontend/app/admin/layout.tsx:149-203` (sections nav)
- Test: `frontend/__tests__/AdminSupport.test.tsx` (create), `frontend/__tests__/AdminLayout.test.tsx` (modif)

- [ ] **Step 1 : Écrire les tests qui échouent**

```tsx
// frontend/__tests__/AdminSupport.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminSupportPage from '@/app/admin/support/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ slug: 'padel-arena-paris', club: { id: 'club-demo', name: 'Padel Arena Paris', accentColor: '#d6ff3f' } }) }));

jest.mock('@/lib/api', () => ({
  assetUrl: (u: string) => u,
  api: { adminCreateSupportTicket: jest.fn() },
}));

function renderPage() {
  return render(<ThemeProvider><AdminSupportPage /></ThemeProvider>);
}

function fillAndSubmit() {
  fireEvent.click(screen.getByRole('button', { name: 'Bug' }));
  fireEvent.change(screen.getByLabelText('Sujet'), { target: { value: 'Planning cassé' } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Le planning ne charge plus sur mobile.' } });
  fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));
}

it('affiche la FAQ gérant (PLATFORM_FAQ) et la note de transparence', () => {
  renderPage();
  expect(screen.getByText("Qu'est-ce que Palova ?")).toBeInTheDocument();
  expect(screen.getByText(/votre nom, votre email et le nom du club sont transmis/i)).toBeInTheDocument();
});

it('envoie le ticket et affiche le numéro', async () => {
  const { api } = require('@/lib/api');
  api.adminCreateSupportTicket.mockResolvedValue({ number: 42 });
  renderPage();
  fillAndSubmit();
  await waitFor(() => expect(api.adminCreateSupportTicket).toHaveBeenCalledWith(
    'club-demo',
    { category: 'BUG', subject: 'Planning cassé', description: 'Le planning ne charge plus sur mobile.' },
    't',
  ));
  expect(await screen.findByText(/#42/)).toBeInTheDocument();
});

it('succès sans numéro (repli backend) : message sans référence', async () => {
  const { api } = require('@/lib/api');
  api.adminCreateSupportTicket.mockResolvedValue({ number: null });
  renderPage();
  fillAndSubmit();
  const status = await screen.findByRole('status');
  expect(status.textContent).toMatch(/demande transmise/i);
  expect(status.textContent).not.toContain('#');
});

it('RATE_LIMITED → message dédié', async () => {
  const { api } = require('@/lib/api');
  api.adminCreateSupportTicket.mockRejectedValue(new Error('RATE_LIMITED'));
  renderPage();
  fillAndSubmit();
  expect(await screen.findByText(/réessayez dans une heure/i)).toBeInTheDocument();
});

it('validation locale : sujet trop court → pas d appel API', () => {
  const { api } = require('@/lib/api');
  renderPage();
  fireEvent.change(screen.getByLabelText('Sujet'), { target: { value: 'ab' } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Une description valide.' } });
  fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));
  expect(screen.getByText(/3 caractères min/i)).toBeInTheDocument();
  expect(api.adminCreateSupportTicket).not.toHaveBeenCalled();
});
```

Dans `frontend/__tests__/AdminLayout.test.tsx`, ajouter (suivre le harness existant — ⚠️ mocks `useRouter`/`useClub` à identité stable, cf. note en tête de suite) :
```tsx
it('affiche l entrée Support pour tous les rôles', async () => {
  // ...render du layout comme les autres cas (rôle STAFF suffit)...
  expect(await screen.findByText('Support')).toBeInTheDocument();
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminSupport.test.tsx`
Expected: FAIL — `Cannot find module '@/app/admin/support/page'`

- [ ] **Step 3 : Implémenter la page + la nav**

```tsx
// frontend/app/admin/support/page.tsx
'use client';

import { useState } from 'react';
import { api, type SupportTicketCategory } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { FaqView } from '@/components/content/FaqView';

const CATEGORIES: { key: SupportTicketCategory; label: string }[] = [
  { key: 'BUG', label: 'Bug' },
  { key: 'QUESTION', label: 'Question' },
  { key: 'SUGGESTION', label: 'Suggestion' },
  { key: 'BILLING', label: 'Facturation' },
];

const ERRORS: Record<string, string> = {
  RATE_LIMITED: 'Vous avez envoyé beaucoup de demandes — réessayez dans une heure.',
  VALIDATION_ERROR: 'Vérifiez le sujet (3 caractères min.) et la description (10 caractères min.).',
  SUPPORT_UNAVAILABLE: "Impossible d'envoyer votre demande. Réessayez, ou écrivez-nous à contact@palova.fr.",
};

export default function AdminSupportPage() {
  const { token } = useAuth();
  const { club } = useClub();
  const { th } = useTheme();
  const [category, setCategory] = useState<SupportTicketCategory>('QUESTION');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ number: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!club || !token || busy) return;
    setSent(null);
    if (subject.trim().length < 3 || description.trim().length < 10) { setError(ERRORS.VALIDATION_ERROR); return; }
    setBusy(true); setError(null);
    try {
      const res = await api.adminCreateSupportTicket(club.id, { category, subject: subject.trim(), description: description.trim() }, token);
      setSent(res); setSubject(''); setDescription('');
    } catch (e) {
      setError(ERRORS[(e as Error).message] ?? ERRORS.SUPPORT_UNAVAILABLE);
    } finally { setBusy(false); }
  };

  const card: React.CSSProperties = { background: th.surface, border: `1px solid ${th.line}`, borderRadius: 14, padding: 18 };
  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
    border: `1px solid ${th.line}`, background: th.bg, color: th.text, fontFamily: th.fontUI, fontSize: 14.5,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
      <h1 style={{ fontFamily: th.fontUI, fontSize: 24, fontWeight: 800, color: th.text, margin: 0 }}>Support</h1>

      {/* FAQ d'abord (déflection, cf. spec §2) : la moitié des questions ont déjà leur réponse. */}
      <section aria-label="Questions fréquentes">
        <h2 style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text, margin: '0 0 12px' }}>Questions fréquentes</h2>
        <FaqView source="platform" heading={null} />
      </section>

      <section aria-label="Nous écrire" style={card}>
        <h2 style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text, margin: '0 0 4px' }}>Nous écrire</h2>
        <p style={{ margin: '0 0 14px', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
          Un bug, une question, une idée ? L'équipe Palova vous répond par email.
        </p>

        {sent && (
          <div role="status" style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: `${th.accent}22`, color: th.text, fontFamily: th.fontUI, fontSize: 14, fontWeight: 600 }}>
            Demande{sent.number != null ? ` #${sent.number}` : ''} transmise — nous vous répondrons par email.
          </div>
        )}
        {error && (
          <div role="alert" style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: `${th.danger}1e`, color: th.danger, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {CATEGORIES.map((c) => (
            <button key={c.key} onClick={() => setCategory(c.key)} aria-pressed={category === c.key}
              style={{
                padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
                border: `1.5px solid ${category === c.key ? th.accent : th.line}`,
                background: category === c.key ? `${th.accent}22` : 'transparent', color: th.text,
              }}>
              {c.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input aria-label="Sujet" placeholder="Sujet" maxLength={120} value={subject}
            onChange={(e) => { setSubject(e.target.value); setError(null); }} style={input} />
          <textarea aria-label="Description" placeholder="Décrivez votre demande (que faisiez-vous, sur quelle page, que s'est-il passé ?)"
            maxLength={5000} rows={6} value={description}
            onChange={(e) => { setDescription(e.target.value); setError(null); }} style={{ ...input, resize: 'vertical' }} />
        </div>

        <p style={{ margin: '10px 0 14px', fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
          Votre nom, votre email et le nom du club sont transmis avec votre demande pour que nous puissions vous répondre.
        </p>

        <button onClick={submit} disabled={busy}
          style={{
            padding: '10px 20px', borderRadius: 12, border: 'none', cursor: busy ? 'default' : 'pointer',
            background: th.accent, color: '#fff', fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, opacity: busy ? 0.6 : 1,
          }}>
          {busy ? 'Envoi…' : 'Envoyer'}
        </button>
      </section>
    </div>
  );
}
```

Notes d'implémentation :
- `th.danger` : vérifier que le token existe dans `lib/theme.ts` (utilisé ailleurs, ex. fiche membre) — sinon `ACCENTS.coral`.
- Bouton « Envoyer » : encre sur accent — si le repo utilise `inkOn(th.accent)` pour ça (cf. pills Réserver), l'utiliser au lieu de `#fff`.

`frontend/app/admin/layout.tsx` — ajouter une section sans titre en FIN du tableau `sections` (l.149-203, après la section Configuration) :
```tsx
    { items: [
      { href: '/admin/support', label: 'Support', icon: 'mail' },
    ] },
```
(`mail` est un `IconName` existant ; `info` est déjà pris par « Contenu & mentions ».)

- [ ] **Step 4 : Vérifier**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AdminSupport.test.tsx __tests__/AdminLayout.test.tsx`
Expected: PASS

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/admin/support/page.tsx frontend/app/admin/layout.tsx frontend/__tests__/AdminSupport.test.tsx frontend/__tests__/AdminLayout.test.tsx
git commit -m "feat(support): page /admin/support (FAQ gerant + formulaire ticket) + entree nav"
```

---

### Task 8 : Vérification finale + documentation

**Files:**
- Modify: `CLAUDE.md` (nouvelle section)

- [ ] **Step 1 : Type-check des deux projets**

Run (cwd `backend/`): `node node_modules/typescript/bin/tsc --noEmit`
Run (cwd `frontend/`): `node node_modules/typescript/bin/tsc --noEmit`
Expected: 0 erreur imputable à cette feature (scoper la lecture des erreurs aux fichiers touchés si du WIP parallèle traîne — mémoire « Frontend jest doesn't type-check »).

- [ ] **Step 2 : Suites scoped complètes**

Run (cwd `backend/`): `node node_modules/jest/bin/jest.js --runTestsByPath src/email/__tests__/support-emails.test.ts src/services/__tests__/support.service.test.ts src/routes/__tests__/admin.support.routes.test.ts`
Run (cwd `frontend/`): `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/authGate.test.ts __tests__/AidePage.test.tsx __tests__/AdminSupport.test.tsx __tests__/AdminLayout.test.tsx __tests__/ProfileMenu.test.tsx`
Expected: tout PASS.

- [ ] **Step 3 : Vérification visuelle (skill `verify`)**

Utiliser le skill `verify` : `/aide` (hôte club, connecté ET anonyme), `/admin/support` (owner@palova.fr), clair + sombre, desktop 1280 + mobile 390 (`mobile:false` + width fixe — mémoire « Verify: mobile overflow emulation trap »). Vérifier : aucun débordement horizontal, formulaire soumis en dev → log `[support:dev]` dans `logs/backend.log` + bandeau succès sans numéro.

- [ ] **Step 4 : Section CLAUDE.md**

Ajouter une section « ## Support joueurs & clubs (v1) ✅ implémenté » au niveau des autres sections feature, résumant : modèle 2 étages, `/aide` (public, FaqView + présentation), `/admin/support` (PLATFORM_FAQ + formulaire → `SupportService` → issue GitHub `GITHUB_SUPPORT_REPO`, PAT Issues-only, repli email, accusé Palova, rate limit 5/h), env (`GITHUB_SUPPORT_TOKEN`/`GITHUB_SUPPORT_REPO`/`SUPPORT_FALLBACK_EMAIL`), aucune migration, hors v1 (suivi in-app, pièces jointes, sync réponses), pointeur spec/plan.

- [ ] **Step 5 : Commit final**

```bash
git add CLAUDE.md
git commit -m "docs(support): section CLAUDE.md support joueurs & clubs"
```

Puis suivre le skill `superpowers:finishing-a-development-branch` (merge/PR au choix d'Eric).
