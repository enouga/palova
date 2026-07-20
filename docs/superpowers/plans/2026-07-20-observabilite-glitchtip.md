# Observabilité v1 — GlitchTip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre visible en production chaque erreur applicative (back + front) et toute indisponibilité de l'API `/health`, avec alerte email — via GlitchTip hébergé (protocole Sentry).

**Architecture:** Backend Express : un `initSentry()` no-op sans DSN, un helper `reportError()` branché sur le middleware d'erreur, les filets process, les catch best-effort (safeNotify, crons, webhooks Stripe). Frontend Next 16 : `@sentry/nextjs` en init **manuelle** (sans `withSentryConfig`, donc sans risque Turbopack) via `instrumentation-client.ts` + `onRequestError`. Tout est inactif si le DSN est absent (dev). L'uptime `/health` est surveillé par le moniteur intégré de GlitchTip (config manuelle côté Eric).

**Tech Stack:** `@sentry/node` (back), `@sentry/nextjs` (front), jest + ts-jest (back node / front jsdom), Docker Compose, GlitchTip SaaS.

**Spec de référence :** `docs/superpowers/specs/2026-07-20-observabilite-glitchtip-design.md`

---

## File Structure

**Backend — créés :**
- `backend/src/observability/sentry.ts` — `initSentry()` (no-op sans DSN) + `isSentryEnabled()`.
- `backend/src/observability/reportError.ts` — `reportError(err, context?)` : capture GlitchTip si actif + `console.error` toujours.
- `backend/src/observability/errorHandler.ts` — middleware Express extrait (testable), remplace la lambda inline de `app.ts`.
- `backend/src/observability/__tests__/sentry.test.ts`
- `backend/src/observability/__tests__/reportError.test.ts`
- `backend/src/observability/__tests__/errorHandler.test.ts`

**Backend — modifiés :**
- `backend/src/app.ts` — appel `initSentry()`, middleware extrait, filets process capturent.
- Les 6 définitions de `safeNotify` (une par fichier) : `event.service.ts`, `tournament.service.ts`, `lesson.service.ts`, `match.service.ts` (forme `.catch()` one-liner, distincte des 5 autres en `try/catch`), `openMatch.service.ts`, `reservation.service.ts`.
- Les 4 jobs cron : `cleanup.job.ts`, `reminders.job.ts`, `platformBilling.job.ts`, `clubJanitor.job.ts`.
- Les 2 webhooks Stripe : `stripe-webhooks.ts`, `platform-billing-webhooks.ts`.
- `backend/package.json` — dépendance `@sentry/node`.

**Frontend — créés :**
- `frontend/lib/observability.ts` — `initSentry(dsn)` gardé, testable.
- `frontend/instrumentation-client.ts` — init client.
- `frontend/__tests__/observability.test.ts`

**Frontend — modifiés :**
- `frontend/instrumentation.ts` — init serveur (runtime nodejs) + `onRequestError`, en **préservant** le filet EPIPE existant.
- `frontend/package.json` — dépendance `@sentry/nextjs`.

**Infra — modifiés :**
- `.env.prod.example`, `docker-compose.prod.yml`, `frontend/Dockerfile`.

**Docs — modifié :**
- `frontend/lib/platformContent.ts` — GlitchTip ajouté aux sous-traitants (Confidentialité).

---

## Task 1 : Backend — `initSentry()` (module d'init gardé)

**Files:**
- Create: `backend/src/observability/sentry.ts`
- Test: `backend/src/observability/__tests__/sentry.test.ts`
- Modify: `backend/package.json` (dépendance)

- [ ] **Step 1 : Installer `@sentry/node`**

Run:
```bash
cd backend && npm install @sentry/node
```
Expected : `@sentry/node` ajouté à `dependencies` dans `backend/package.json`, `npm` termine sans erreur.

- [ ] **Step 2 : Écrire le test (échoue)**

Create `backend/src/observability/__tests__/sentry.test.ts` :

```ts
jest.mock('@sentry/node');
import * as Sentry from '@sentry/node';

describe('initSentry', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    (Sentry.init as jest.Mock).mockClear();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => { process.env = OLD_ENV; });

  it("ne fait rien quand GLITCHTIP_DSN est absent", () => {
    delete process.env.GLITCHTIP_DSN;
    const { initSentry, isSentryEnabled } = require('../sentry');
    initSentry();
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(isSentryEnabled()).toBe(false);
  });

  it("initialise Sentry une seule fois quand le DSN est présent", () => {
    process.env.GLITCHTIP_DSN = 'https://k@glitchtip.example/1';
    const { initSentry, isSentryEnabled } = require('../sentry');
    initSentry();
    initSentry(); // second appel = no-op
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(isSentryEnabled()).toBe(true);
  });
});
```

- [ ] **Step 3 : Vérifier l'échec**

Run:
```bash
cd backend && node node_modules/jest/bin/jest.js src/observability/__tests__/sentry.test.ts
```
Expected : FAIL — « Cannot find module '../sentry' ».

- [ ] **Step 4 : Implémenter `sentry.ts`**

Create `backend/src/observability/sentry.ts` :

```ts
import * as Sentry from '@sentry/node';

let initialized = false;

/**
 * Initialise la capture d'erreurs GlitchTip. No-op si GLITCHTIP_DSN est absent (dev,
 * tests) ou si déjà initialisé. Appelé une fois au démarrage, tout en haut de app.ts.
 * tracesSampleRate: 0 → on ne consomme le quota que pour des erreurs, jamais du tracing.
 */
export function initSentry(): void {
  const dsn = process.env.GLITCHTIP_DSN;
  if (!dsn || initialized) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    // Flux fermé côté client (SSE/streaming) — bruit sans valeur, comme côté front.
    ignoreErrors: ['EPIPE'],
  });
  initialized = true;
}

export function isSentryEnabled(): boolean {
  return initialized;
}
```

- [ ] **Step 5 : Vérifier le succès**

Run:
```bash
cd backend && node node_modules/jest/bin/jest.js src/observability/__tests__/sentry.test.ts
```
Expected : PASS (2 tests).

- [ ] **Step 6 : Commit**

```bash
cd backend && git add package.json package-lock.json src/observability/sentry.ts src/observability/__tests__/sentry.test.ts
git commit -m "feat(obs): initSentry() gardé par GLITCHTIP_DSN (@sentry/node)"
```

---

## Task 2 : Backend — helper `reportError()`

**Files:**
- Create: `backend/src/observability/reportError.ts`
- Test: `backend/src/observability/__tests__/reportError.test.ts`

- [ ] **Step 1 : Écrire le test (échoue)**

Create `backend/src/observability/__tests__/reportError.test.ts` :

```ts
jest.mock('@sentry/node');
jest.mock('../sentry');
import * as Sentry from '@sentry/node';
import { isSentryEnabled } from '../sentry';
import { reportError } from '../reportError';

describe('reportError', () => {
  let errSpy: jest.SpyInstance;
  beforeEach(() => {
    (Sentry.captureException as jest.Mock).mockClear();
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  it('capture vers Sentry AVEC le contexte quand le SDK est actif', () => {
    (isSentryEnabled as jest.Mock).mockReturnValue(true);
    const e = new Error('boom');
    reportError(e, { source: 'test', userId: 'u1' });
    expect(Sentry.captureException).toHaveBeenCalledWith(e, { extra: { source: 'test', userId: 'u1' } });
    expect(errSpy).toHaveBeenCalled(); // log local conservé
  });

  it('ne capture PAS quand le SDK est inactif, mais logge localement', () => {
    (isSentryEnabled as jest.Mock).mockReturnValue(false);
    reportError(new Error('boom'), { source: 'test' });
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run:
```bash
cd backend && node node_modules/jest/bin/jest.js src/observability/__tests__/reportError.test.ts
```
Expected : FAIL — « Cannot find module '../reportError' ».

- [ ] **Step 3 : Implémenter `reportError.ts`**

Create `backend/src/observability/reportError.ts` :

```ts
import * as Sentry from '@sentry/node';
import { isSentryEnabled } from './sentry';

/**
 * Remonte une erreur best-effort vers GlitchTip (si actif) SANS jamais changer le flux
 * de contrôle de l'appelant. Logge TOUJOURS en local : en dev (SDK off) c'est la seule
 * trace ; en prod ça reste dans les logs Docker à côté de la remontée GlitchTip.
 * `context` (source, route, userId…) part dans `extra`. Ne jamais y mettre d'email (RGPD).
 */
export function reportError(err: unknown, context?: Record<string, unknown>): void {
  if (isSentryEnabled()) {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  }
  const label = context && typeof context.source === 'string' ? context.source : '';
  console.error('[reportError]', label, err instanceof Error ? err.message : err);
}
```

- [ ] **Step 4 : Vérifier le succès**

Run:
```bash
cd backend && node node_modules/jest/bin/jest.js src/observability/__tests__/reportError.test.ts
```
Expected : PASS (2 tests).

- [ ] **Step 5 : Commit**

```bash
cd backend && git add src/observability/reportError.ts src/observability/__tests__/reportError.test.ts
git commit -m "feat(obs): helper reportError (capture GlitchTip + log local)"
```

---

## Task 3 : Backend — middleware d'erreur extrait + testable

**Files:**
- Create: `backend/src/observability/errorHandler.ts`
- Test: `backend/src/observability/__tests__/errorHandler.test.ts`

- [ ] **Step 1 : Écrire le test (échoue)**

Create `backend/src/observability/__tests__/errorHandler.test.ts` :

```ts
jest.mock('../reportError');
import { reportError } from '../reportError';
import { errorHandler } from '../errorHandler';
import type { Request, Response, NextFunction } from 'express';

describe('errorHandler', () => {
  beforeEach(() => (reportError as jest.Mock).mockClear());

  it('capture avec le contexte requête puis répond 500', () => {
    const req = { originalUrl: '/api/x', method: 'POST', user: { id: 'u1' } } as unknown as Request;
    const json = jest.fn();
    const status = jest.fn(() => ({ json })) as unknown as Response['status'];
    const res = { status } as unknown as Response;
    const err = new Error('boom');

    errorHandler(err, req, res, (() => {}) as NextFunction);

    expect(reportError).toHaveBeenCalledWith(err, {
      source: 'express', route: '/api/x', method: 'POST', userId: 'u1',
    });
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Erreur interne du serveur' });
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run:
```bash
cd backend && node node_modules/jest/bin/jest.js src/observability/__tests__/errorHandler.test.ts
```
Expected : FAIL — « Cannot find module '../errorHandler' ».

- [ ] **Step 3 : Implémenter `errorHandler.ts`**

Create `backend/src/observability/errorHandler.ts` :

```ts
import { Request, Response, NextFunction } from 'express';
import { reportError } from './reportError';

/**
 * Gestionnaire d'erreur Express terminal. Remonte l'exception (avec route/méthode/userId,
 * jamais l'email — RGPD) vers GlitchTip, puis rend le 500 générique habituel. Seules les
 * vraies exceptions passent ici : les erreurs métier 4xx sont traduites en amont par les
 * routes et n'atteignent jamais ce middleware (donc ne polluent pas le quota).
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  reportError(err, {
    source: 'express',
    route: req.originalUrl,
    method: req.method,
    userId: (req as { user?: { id?: string } }).user?.id,
  });
  res.status(500).json({ error: 'Erreur interne du serveur' });
}
```

- [ ] **Step 4 : Vérifier le succès**

Run:
```bash
cd backend && node node_modules/jest/bin/jest.js src/observability/__tests__/errorHandler.test.ts
```
Expected : PASS (1 test).

- [ ] **Step 5 : Commit**

```bash
cd backend && git add src/observability/errorHandler.ts src/observability/__tests__/errorHandler.test.ts
git commit -m "feat(obs): middleware errorHandler extrait et testable"
```

---

## Task 4 : Backend — brancher l'observabilité dans `app.ts`

**Files:**
- Modify: `backend/src/app.ts`

- [ ] **Step 1 : Ajouter les imports**

Dans `backend/src/app.ts`, après la ligne `import 'dotenv/config';` (ligne 1), ajouter :

```ts
import * as Sentry from '@sentry/node';
import { initSentry } from './observability/sentry';
import { reportError } from './observability/reportError';
import { errorHandler } from './observability/errorHandler';
```

- [ ] **Step 2 : Initialiser Sentry avant l'app**

Toujours dans `app.ts`, juste avant `const app = express();` (ligne 33), ajouter :

```ts
// Observabilité : à initialiser AVANT toute construction d'app. No-op sans GLITCHTIP_DSN.
initSentry();
```

- [ ] **Step 3 : Remplacer le middleware d'erreur inline**

Remplacer le bloc actuel (lignes 119-122) :

```ts
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});
```

par :

```ts
app.use(errorHandler);
```

- [ ] **Step 4 : Capturer dans les filets process**

Remplacer le bloc `process.on('unhandledRejection'…)` / `process.on('uncaughtException'…)` (lignes 130-136) :

```ts
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    process.exit(1);
  });
```

par :

```ts
  process.on('unhandledRejection', (reason) => {
    reportError(reason, { source: 'unhandledRejection' });
  });
  process.on('uncaughtException', (err) => {
    reportError(err, { source: 'uncaughtException' });
    // Laisse à GlitchTip une chance de recevoir l'événement avant l'arrêt (best-effort ;
    // Sentry.close résout immédiatement si le SDK n'est pas initialisé).
    void Sentry.close(2000).finally(() => process.exit(1));
  });
```

- [ ] **Step 5 : Nettoyer les imports inutilisés**

Le `NextFunction` importé ligne 2 n'est peut-être plus utilisé après l'extraction (`Request`/`Response` restent utilisés par `/health` et `/internal/tls-check`). Vérifier via tsc à l'étape suivante ; si `NextFunction` devient inutilisé, le retirer de l'import ligne 2.

- [ ] **Step 6 : Vérifier tsc + la suite `/health` (non-régression)**

Run:
```bash
cd backend && node node_modules/typescript/bin/tsc --noEmit
node node_modules/jest/bin/jest.js src/routes/__tests__/health.routes.test.ts src/__tests__/app.domains.test.ts
```
Expected : tsc sans erreur ; les 2 suites PASS (le middleware et les filets sont inertes tant que le DSN est absent).

- [ ] **Step 7 : Commit**

```bash
cd backend && git add src/app.ts
git commit -m "feat(obs): app.ts — init, errorHandler, filets process capturent"
```

---

## Task 5 : Backend — `reportError` dans les 6 `safeNotify`

Chaque service a une méthode privée `safeNotify` (ou `match.service` une variante sync) dont le `catch` fait un `console.error`. On y remonte l'erreur : un échec SMTP/DB de notification est best-effort **par design** mais doit devenir **visible**. Le flux de contrôle ne change pas.

**Files:** Modify (une méthode chacun) :
- `backend/src/services/event.service.ts:141`
- `backend/src/services/tournament.service.ts:208`
- `backend/src/services/lesson.service.ts:150`
- `backend/src/services/match.service.ts:149`
- `backend/src/services/openMatch.service.ts:88`
- `backend/src/services/reservation.service.ts:48`

- [ ] **Step 1 : Ajouter l'import dans chaque fichier**

En tête de chacun des 6 fichiers, ajouter (adapter le nombre de `../` — tous sont dans `src/services/`, donc `../observability/reportError`) :

```ts
import { reportError } from '../observability/reportError';
```

- [ ] **Step 2 : Remplacer le corps du `catch` de chaque `safeNotify`**

Dans chaque méthode `safeNotify`, remplacer la ligne `console.error('[notifications] …', err);` du `catch` par :

```ts
      reportError(err, { source: 'safeNotify' });
```

Exemple concret — `event.service.ts` (lignes 141-147) devient :

```ts
  private async safeNotify(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      reportError(err, { source: 'safeNotify:event' });
    }
  }
```

Faire de même dans `tournament.service.ts` (`source: 'safeNotify:tournament'`), `lesson.service.ts` (`:lesson`), `openMatch.service.ts` (`:openMatch`), `reservation.service.ts` (`:reservation`) — tous en `try/catch`.

**Cas particulier — `match.service.ts:149-151`** : ici `safeNotify` est un one-liner avec `.catch()`, pas un `try/catch`. Le remplacer par :

```ts
  private safeNotify(fn: () => Promise<void>): void {
    Promise.resolve(fn()).catch((err) => reportError(err, { source: 'safeNotify:match' }));
  }
```

Ne pas toucher au reste des méthodes.

- [ ] **Step 3 : Vérifier tsc + suites de services impactées**

Run:
```bash
cd backend && node node_modules/typescript/bin/tsc --noEmit
node node_modules/jest/bin/jest.js src/services/__tests__/event.service.test.ts src/services/__tests__/tournament.service.test.ts src/services/__tests__/reservation.service.test.ts src/services/__tests__/openMatch.service.test.ts
```
Expected : tsc sans erreur ; suites PASS (le comportement best-effort est inchangé — `reportError` ne lève jamais). Note : `reportError` fera un `console.error` en test — c'est attendu et sans incidence sur les assertions.

- [ ] **Step 4 : Commit**

```bash
cd backend && git add src/services/event.service.ts src/services/tournament.service.ts src/services/lesson.service.ts src/services/match.service.ts src/services/openMatch.service.ts src/services/reservation.service.ts
git commit -m "feat(obs): safeNotify remonte vers GlitchTip (6 services)"
```

---

## Task 6 : Backend — `reportError` dans les 4 jobs cron

Les blocs `try/catch` des crons avalent aujourd'hui leurs erreurs en `console.error` (invisibles en prod) : un cron rate silencieusement. On remonte **les catch** vers GlitchTip. Règle : **remplacer chaque `console.error` situé dans un `catch` par `reportError`**, laisser intacts tous les `console.log` (opération normale) et le `console.warn` de `ensurePlatformPrices` (échec attendu en dev).

**Files:** Modify :
- `backend/src/jobs/cleanup.job.ts` (4 catch dans `startCleanupJob`)
- `backend/src/jobs/reminders.job.ts` (catch par item + le `.catch` de `startReminderJob`)
- `backend/src/jobs/platformBilling.job.ts` (2 catch)
- `backend/src/jobs/clubJanitor.job.ts` (catch par club + le `.catch` de `startClubJanitorJob` + le `.catch` email superadmin)

- [ ] **Step 1 : Ajouter l'import dans chaque fichier**

En tête des 4 fichiers (tous dans `src/jobs/`) :

```ts
import { reportError } from '../observability/reportError';
```

- [ ] **Step 2 : `cleanup.job.ts` — remonter les 4 catch de `startCleanupJob`**

Remplacer les 4 blocs `catch (err) { console.error('[…]', (err as Error).message); }` (lignes ~76-98) par leur équivalent :

```ts
    } catch (err) {
      reportError(err, { source: 'cleanup:releaseExpiredHolds' });
    }
```
```ts
    } catch (err) {
      reportError(err, { source: 'cleanup:autoValidateDue' });
    }
```
```ts
    } catch (err) {
      reportError(err, { source: 'cleanup:releaseExpiredRegistrations' });
    }
```
```ts
    } catch (err) {
      reportError(err, { source: 'cleanup:purgeExpiredAlerts' });
    }
```
Laisser tous les `console.log('[cleanup] …')` / `[match] …` (opération normale) intacts.

- [ ] **Step 3 : `reminders.job.ts` — remonter les catch par item + le catch racine**

Dans `runReminders`, remplacer chaque `catch (e) { console.error('[reminders…]', (e as Error).message); }` (lignes 48, 65, 76, 91, 104, 120) par :

```ts
      } catch (e) {
        reportError(e, { source: 'reminders' });
      }
```

Et dans `startReminderJob` (ligne 128), remplacer :

```ts
    runReminders(new Date()).catch((e) => console.error('[reminders]', e));
```
par :
```ts
    runReminders(new Date()).catch((e) => reportError(e, { source: 'reminders:run' }));
```
Laisser le `console.log('[reminders] Job de rappels démarré…')` intact.

- [ ] **Step 4 : `platformBilling.job.ts` — remonter les 2 catch**

Remplacer :
```ts
    catch (err) { console.error('[billing] refresh nocturne :', err); }
```
par :
```ts
    catch (err) { reportError(err, { source: 'billing:refreshAllClubs' }); }
```
et :
```ts
    catch (err) { console.error('[billing] évaluation mensuelle :', err); }
```
par :
```ts
    catch (err) { reportError(err, { source: 'billing:runMonthlyEvaluation' }); }
```
Laisser le `console.warn('[billing] ensurePlatformPrices ignoré …')` intact (échec attendu sans clé Stripe en dev).

- [ ] **Step 5 : `clubJanitor.job.ts` — remonter les 3 catch**

- Le `.catch` email superadmin (ligne 54) :
```ts
              .catch((err) => reportError(err, { source: 'janitor:superadminEmail' })),
```
- Le catch par club (lignes 66-68) :
```ts
    } catch (err) {
      reportError(err, { source: 'janitor:club' });
    }
```
- Le `.catch` de `startClubJanitorJob` (ligne 75) :
```ts
    runClubJanitor(new Date()).catch((err) => reportError(err, { source: 'janitor:run' }));
```
Laisser le `console.log('[janitor] Job de ménage…')` intact.

- [ ] **Step 6 : Vérifier tsc + aucun `console.error` résiduel dans un catch de job**

Run:
```bash
cd backend && node node_modules/typescript/bin/tsc --noEmit
node node_modules/jest/bin/jest.js src/jobs
```
Expected : tsc sans erreur ; les suites de `src/jobs` PASS.

Puis vérifier qu'il ne reste aucun `console.error` dans les 4 fichiers (les remontées passent toutes par `reportError`) :
```bash
cd backend && grep -n "console.error" src/jobs/cleanup.job.ts src/jobs/reminders.job.ts src/jobs/platformBilling.job.ts src/jobs/clubJanitor.job.ts
```
Expected : aucune ligne retournée.

- [ ] **Step 7 : Commit**

```bash
cd backend && git add src/jobs/cleanup.job.ts src/jobs/reminders.job.ts src/jobs/platformBilling.job.ts src/jobs/clubJanitor.job.ts
git commit -m "feat(obs): les 4 jobs cron remontent leurs erreurs vers GlitchTip"
```

---

## Task 7 : Backend — `reportError` dans les 2 webhooks Stripe

Les catch des webhooks logguent avant de répondre. On les rend visibles sans changer la logique HTTP (rejeu Stripe inchangé).

**Files:** Modify :
- `backend/src/routes/stripe-webhooks.ts`
- `backend/src/routes/platform-billing-webhooks.ts`

- [ ] **Step 1 : Repérer les `console.error` de ces deux fichiers**

Run:
```bash
cd backend && grep -n "console.error" src/routes/stripe-webhooks.ts src/routes/platform-billing-webhooks.ts
```
Noter chaque ligne (2 dans `stripe-webhooks.ts`, 1 dans `platform-billing-webhooks.ts`).

- [ ] **Step 2 : Ajouter l'import (les deux fichiers sont dans `src/routes/`)**

```ts
import { reportError } from '../observability/reportError';
```

- [ ] **Step 3 : Remplacer chaque `console.error` de catch par `reportError`**

Pour chaque occurrence trouvée à l'étape 1, remplacer le `console.error('[…]', err…)` par :

```ts
    reportError(err, { source: 'stripe-webhook' });
```
(dans `platform-billing-webhooks.ts` : `source: 'billing-webhook'`).

Ne rien changer d'autre : ni le `res.status(...)`, ni la logique `isTerminalBusinessError`, ni la vérification de signature (le `catch {}` de signature ligne 32 ne logge pas — le laisser tel quel).

- [ ] **Step 4 : Vérifier tsc + suites webhooks**

Run:
```bash
cd backend && node node_modules/typescript/bin/tsc --noEmit
node node_modules/jest/bin/jest.js src/routes/__tests__/stripe-webhooks.test.ts src/routes/__tests__/platform-billing.webhook.test.ts
```
Expected : tsc sans erreur ; suites PASS (si les noms exacts diffèrent, lancer `node node_modules/jest/bin/jest.js webhook` pour les cibler).

- [ ] **Step 5 : Commit**

```bash
cd backend && git add src/routes/stripe-webhooks.ts src/routes/platform-billing-webhooks.ts
git commit -m "feat(obs): webhooks Stripe remontent leurs erreurs vers GlitchTip"
```

---

## Task 8 : Frontend — `initSentry()` gardé + package

⚠️ **Avant de coder**, lire la doc du SDK installé (convention imposée par `frontend/AGENTS.md` — ce n'est pas le Next.js « connu ») : `node_modules/@sentry/nextjs` (README/CHANGELOG) et `node_modules/next/dist/docs/` pour `instrumentation-client.ts` et `onRequestError`. But : confirmer que l'init **manuelle** (sans `withSentryConfig`) est supportée et que `Sentry.captureRequestError` existe. On n'utilise **pas** le plugin de build → aucun risque Turbopack.

**Files:**
- Create: `frontend/lib/observability.ts`
- Test: `frontend/__tests__/observability.test.ts`
- Modify: `frontend/package.json` (dépendance)

- [ ] **Step 1 : Installer `@sentry/nextjs`**

Run:
```bash
cd frontend && npm install @sentry/nextjs
```
Expected : `@sentry/nextjs` ajouté à `dependencies`.

- [ ] **Step 2 : Écrire le test (échoue)**

Create `frontend/__tests__/observability.test.ts` :

```ts
jest.mock('@sentry/nextjs');
import * as Sentry from '@sentry/nextjs';
import { initSentry } from '@/lib/observability';

describe('initSentry (frontend)', () => {
  beforeEach(() => (Sentry.init as jest.Mock).mockClear());

  it('ne fait rien sans DSN', () => {
    expect(initSentry(undefined)).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initialise avec un DSN', () => {
    expect(initSentry('https://k@glitchtip.example/2')).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3 : Vérifier l'échec**

Run:
```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/observability.test.ts
```
Expected : FAIL — « Cannot find module '@/lib/observability' ».

- [ ] **Step 4 : Implémenter `lib/observability.ts`**

Create `frontend/lib/observability.ts` :

```ts
import * as Sentry from '@sentry/nextjs';

/**
 * Init GlitchTip (protocole Sentry) côté front. No-op sans DSN (dev). Renvoie true si
 * l'init a eu lieu. Init MANUELLE : on n'utilise pas withSentryConfig (plugin de build),
 * donc aucune dépendance à Turbopack. tracesSampleRate: 0 → erreurs seulement.
 */
export function initSentry(dsn: string | undefined): boolean {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
  });
  return true;
}
```

- [ ] **Step 5 : Vérifier le succès**

Run:
```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/observability.test.ts
```
Expected : PASS (2 tests).

- [ ] **Step 6 : Commit**

```bash
cd frontend && git add package.json package-lock.json lib/observability.ts __tests__/observability.test.ts
git commit -m "feat(obs): initSentry frontend gardé par NEXT_PUBLIC_GLITCHTIP_DSN"
```

---

## Task 9 : Frontend — brancher client + serveur (instrumentation)

**Files:**
- Create: `frontend/instrumentation-client.ts`
- Modify: `frontend/instrumentation.ts`

- [ ] **Step 1 : Créer l'entrée client**

Create `frontend/instrumentation-client.ts` :

```ts
// Point d'entrée client Next (exécuté au boot du bundle navigateur). Capture les crashs
// React et erreurs JS non gérées. No-op sans NEXT_PUBLIC_GLITCHTIP_DSN (dev).
import { initSentry } from '@/lib/observability';

initSentry(process.env.NEXT_PUBLIC_GLITCHTIP_DSN);
```

- [ ] **Step 2 : Étendre `instrumentation.ts` (init serveur + onRequestError, EPIPE préservé)**

Remplacer **tout** le contenu de `frontend/instrumentation.ts` par :

```ts
import * as Sentry from '@sentry/nextjs';
import { initSentry } from '@/lib/observability';

// Hook standard Next : capture les erreurs survenant pendant le rendu serveur / les
// route handlers. Named export reconnu automatiquement par Next.
export const onRequestError = Sentry.captureRequestError;

export function register() {
  // process.on n'existe que dans le runtime Node.js, pas dans l'Edge Runtime.
  // Next compile instrumentation.ts pour les deux → on garde l'API Node derrière ce test.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Capture serveur (SSR / handlers). No-op sans DSN.
    initSentry(process.env.NEXT_PUBLIC_GLITCHTIP_DSN);

    // Suppress EPIPE errors from broken streaming connections in Next.js 16 dev mode.
    // These occur when the browser closes a connection while the server is still streaming.
    process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') return; // flux fermé côté client (streaming) — sans gravité
      // Toute AUTRE exception non capturée = état indéfini : la logguer et sortir proprement
      // (le gestionnaire de process / Docker redémarre) plutôt que de la laisser filer.
      console.error('[instrumentation] uncaughtException', err);
      process.exit(1);
    });
  }
}
```

- [ ] **Step 3 : Vérifier tsc + que la suite front reste verte**

Run:
```bash
cd frontend && node node_modules/typescript/bin/tsc --noEmit
node node_modules/jest/bin/jest.js __tests__/observability.test.ts
```
Expected : tsc sans erreur ; suite PASS. (Le build Next complet est vérifié en Task 12.)

- [ ] **Step 4 : Commit**

```bash
cd frontend && git add instrumentation-client.ts instrumentation.ts
git commit -m "feat(obs): capture front client + serveur (onRequestError), EPIPE préservé"
```

---

## Task 10 : Infra — variables d'environnement (prod)

**Files:**
- Modify: `.env.prod.example`
- Modify: `docker-compose.prod.yml`
- Modify: `frontend/Dockerfile`

- [ ] **Step 1 : `.env.prod.example` — documenter les 2 variables**

Ajouter à la fin de `.env.prod.example` :

```bash
# --- Observabilité (GlitchTip, protocole Sentry) ---
# DSN backend (projet « palova-backend » dans GlitchTip). Absent → capture inactive.
GLITCHTIP_DSN=
# DSN frontend (projet « palova-frontend »). NEXT_PUBLIC_* → GELÉE au build : un changement
# impose un rebuild du front. Absent → capture front inactive.
NEXT_PUBLIC_GLITCHTIP_DSN=
```

- [ ] **Step 2 : `docker-compose.prod.yml` — câbler le backend**

Dans le service `backend`, bloc `environment`, ajouter après `SUPPORT_FALLBACK_EMAIL` (ligne 74) :

```yaml
      # Observabilité GlitchTip (capture d'erreurs backend). Absent → inactif.
      GLITCHTIP_DSN: ${GLITCHTIP_DSN}
```

- [ ] **Step 3 : `docker-compose.prod.yml` — câbler le build front**

Dans le service `frontend`, bloc `build.args`, ajouter après `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (ligne 103) :

```yaml
        # DSN GlitchTip front — gelé au build (comme la clé Stripe). Rebuild si changé.
        NEXT_PUBLIC_GLITCHTIP_DSN: ${NEXT_PUBLIC_GLITCHTIP_DSN}
```

- [ ] **Step 4 : `frontend/Dockerfile` — accepter le build arg**

Ajouter `ARG NEXT_PUBLIC_GLITCHTIP_DSN` après la ligne 11, et l'inclure dans le bloc `ENV` (lignes 12-14). Résultat :

```dockerfile
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ROOT_DOMAINS
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_GLITCHTIP_DSN
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_ROOT_DOMAINS=$NEXT_PUBLIC_ROOT_DOMAINS \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_GLITCHTIP_DSN=$NEXT_PUBLIC_GLITCHTIP_DSN
```

- [ ] **Step 5 : Vérifier la syntaxe compose**

Run:
```bash
cd "C:/ProjetsIA/05_PERSO/RESERVE/palova" && "C:/Program Files/Docker/Docker/resources/bin/docker-compose-v1.exe" -f docker-compose.prod.yml config >/dev/null && echo OK
```
Expected : `OK` (aucune erreur de parsing YAML). Si `docker-compose-v1.exe` n'accepte pas cette validation hors contexte, se contenter d'une relecture visuelle de l'indentation.

- [ ] **Step 6 : Commit**

```bash
cd "C:/ProjetsIA/05_PERSO/RESERVE/palova" && git add .env.prod.example docker-compose.prod.yml frontend/Dockerfile
git commit -m "chore(obs): variables GLITCHTIP_DSN (back) + NEXT_PUBLIC_GLITCHTIP_DSN (front)"
```

---

## Task 11 : Docs — GlitchTip comme sous-traitant (RGPD)

**Files:**
- Modify: `frontend/lib/platformContent.ts`

- [ ] **Step 1 : Localiser la liste des sous-traitants**

Run:
```bash
cd frontend && grep -n -i "sous-traitant\|Stripe\|OVH\|Hetzner\|destinataire" lib/platformContent.ts | head -30
```
Repérer le passage du document Confidentialité qui énumère les sous-traitants / destinataires de données (Stripe, hébergeur, SMTP…).

- [ ] **Step 2 : Ajouter GlitchTip**

Dans ce passage, ajouter une entrée décrivant GlitchTip : outil de supervision technique (capture d'erreurs applicatives), destinataire de métadonnées techniques d'erreur (horodatage, message, `userId` interne, adresse IP), finalité : détection et correction des dysfonctionnements. Suivre la forme rédactionnelle exacte des entrées voisines (même structure de phrase / champ).

- [ ] **Step 3 : Vérifier tsc + suite platformContent si elle existe**

Run:
```bash
cd frontend && node node_modules/typescript/bin/tsc --noEmit
node node_modules/jest/bin/jest.js __tests__/platformContent.test.ts
```
Expected : tsc sans erreur ; si la suite existe et fige un texte, l'ajuster ; sinon `No tests found` est acceptable.

- [ ] **Step 4 : Commit**

```bash
cd frontend && git add lib/platformContent.ts
git commit -m "docs(obs): GlitchTip ajouté aux sous-traitants (Confidentialité)"
```

---

## Task 12 : Vérification finale (suites complètes + build)

**Files:** aucun (vérification).

- [ ] **Step 1 : Suite backend complète + tsc**

Run:
```bash
cd backend && node node_modules/typescript/bin/tsc --noEmit && node node_modules/jest/bin/jest.js
```
Expected : tsc sans erreur ; suite verte. (Comparer aux flakes connus : la baseline de mémoire mentionne des échecs d'isolation non liés — si des échecs apparaissent, les relancer en isolation pour confirmer qu'ils préexistent à ce travail.)

- [ ] **Step 2 : Suite frontend + tsc**

Run:
```bash
cd frontend && node node_modules/typescript/bin/tsc --noEmit && node node_modules/jest/bin/jest.js
```
Expected : tsc sans erreur ; suite verte (voir mémoire « frontend full-suite BookingModal flake » : ~6 échecs BookingModal d'isolation préexistants, à confirmer en isolation si présents).

- [ ] **Step 3 : Build Next de production (valide instrumentation-client + onRequestError sous Turbopack)**

Run:
```bash
cd frontend && npm run build
```
Expected : build réussi. C'est la vraie preuve que l'init manuelle `@sentry/nextjs` (sans `withSentryConfig`) passe le bundler. En cas d'échec spécifiquement lié à `@sentry/nextjs`/Turbopack, relire la doc SDK (Task 8) — repli documenté dans la spec : remplacer l'import `@sentry/nextjs` de `lib/observability.ts` par `@sentry/browser` (client) et retirer `onRequestError` (serveur reporté). Ce repli reste hors périmètre tant que le build passe.

- [ ] **Step 4 : Commit éventuel + récapitulatif**

Si des ajustements ont été nécessaires, committer. Sinon, cette tâche ne produit pas de commit.

Résumé de fin de plan à afficher :
- ✅ Capture back (middleware 500, filets process, safeNotify, crons, webhooks Stripe).
- ✅ Capture front (client + serveur, sans dépendance Turbopack).
- ✅ Variables prod câblées.
- ⏭️ **Actions manuelles Eric** (non codables) : créer l'org + 2 projets GlitchTip ; renseigner `GLITCHTIP_DSN` / `NEXT_PUBLIC_GLITCHTIP_DSN` dans `.env.prod` sur la VM ; rebuild du front après ajout du DSN ; créer le **moniteur d'uptime GlitchTip sur `https://api.palova.fr/health`** (intervalle 1–5 min, alerte sur non-200) ; configurer les alertes email ; faire relire la mention GlitchTip du document Confidentialité.

---

## Hors périmètre (rappel spec)

Logs structurés (pino) ; tracing de perf / session replay ; upload des sourcemaps front (`withSentryConfig` — repli abandonnable) ; auto-restart des conteneurs `unhealthy` ; supervision système VM ; alerting avancé (Slack/seuils).
