# Observabilité v1 — GlitchTip (erreurs + uptime)

**Date :** 2026-07-20
**Statut :** spec validée, plan à écrire
**Contexte :** ligne « Observabilité — Absent » de l'audit fonctionnel & prod du 2026-07-17.
Aujourd'hui, une erreur en production est invisible jusqu'au message d'un utilisateur :
aucun outil de capture d'erreurs (back ni front), 76 `console.*` bruts, aucun alerting.
Le `/health` profond (`app.ts:94`, teste réellement Postgres + Redis) existe mais
personne ne le surveille.

## Objectif

Rendre visible en production (1) chaque erreur applicative back et front, avec sa stack
et son contexte, et (2) toute indisponibilité de l'API — avec **alerte email** dans les
deux cas. Cible : passer de « invisible jusqu'au message d'un utilisateur » à « une alerte
email arrive dans la minute ».

## Décisions de cadrage

- **Outil : GlitchTip hébergé.** Open source (MIT), SaaS, plan gratuit (~1 000 événements/mois,
  suffisant au démarrage). Parle le **protocole Sentry** → on utilise les SDK `@sentry/*`
  standards ; migrer vers Sentry SaaS ou une instance auto-hébergée un jour = changer une
  variable d'environnement (le DSN), aucune réécriture de code.
- **Uptime intégré à GlitchTip.** GlitchTip embarque un moniteur d'uptime : il sondera
  `https://api.palova.fr/health` (sonde **externe à la VM** — c'est le point exact qui
  manquait) et alertera par email. **Un seul outil, un seul tableau de bord, une seule
  config d'alertes.** Pas d'UptimeRobot ni de moniteur tiers.
- **Périmètre = erreurs + uptime.** On ne remplace **pas** les 76 `console.*` par un logger
  structuré (pino) — hors périmètre, décision explicite. On ne branche pas de tracing ni de
  session replay (coûteux en quota, sans valeur au démarrage).
- **Inactif en dev.** Le SDK ne s'initialise que si le DSN est présent dans l'environnement.
  En développement, aucun DSN → zéro envoi réseau, zéro bruit.

## Architecture

Trois volets : backend, frontend, infra/config. Les deux volets code sont indépendants
(l'un peut être livré et vérifié sans l'autre).

### 1. Backend (Express) — `@sentry/node`

**Initialisation.** Un module `src/observability/sentry.ts` exporte `initSentry()`, appelé
**tout en haut de `app.ts`**, avant la construction de l'app. `initSentry()` est un **no-op
si `GLITCHTIP_DSN` est absent** (dev, tests). Configuration :
- `dsn: process.env.GLITCHTIP_DSN`
- `environment: process.env.NODE_ENV`
- `tracesSampleRate: 0` — pas de tracing de perf (on ne consomme le quota que pour des erreurs).
- `ignoreErrors` : `EPIPE` et les erreurs de flux SSE avortés (mêmes causes que déjà filtrées
  dans `instrumentation.ts` côté front) — bruit sans valeur.
- Scrub : ne jamais envoyer d'email utilisateur (RGPD). On attache `userId` quand disponible,
  jamais l'adresse email ni le corps des requêtes.

**Points de capture (3 catégories).**

1. **Middleware d'erreur global** (`app.ts:119`). Aujourd'hui il logge `err.message` **sans
   stack** et rend un 500. On capture l'exception complète vers GlitchTip **avant** le
   `res.status(500)` habituel, avec le contexte requête (route, méthode, `userId` si présent
   sur `req.user`). Comportement HTTP inchangé (toujours `{ error: 'Erreur interne du serveur' }`).
   **Seules les vraies exceptions (500) remontent** — les erreurs métier 4xx (levées et
   traduites en codes par les routes) ne passent pas par ce middleware, donc ne polluent
   jamais le quota.

2. **Filets process** (`app.ts:130-136`). `unhandledRejection` et `uncaughtException` loggent
   déjà ; on ajoute la capture GlitchTip avant le log/exit existant. (Le filet EPIPE de
   `frontend/instrumentation.ts` reste tel quel.)

3. **Catch best-effort aujourd'hui muets en prod.** Un helper **`reportError(err, context?)`**
   (`src/observability/reportError.ts`) : capture vers GlitchTip **si le SDK est initialisé**,
   sinon repli `console.error` (comportement dev inchangé). Il **remplace le `console.error`**
   dans les catch qui, en prod, avalent silencieusement des erreurs réelles :
   - Les 4 jobs cron : les blocs `try/catch` de `cleanup.job.ts` (`startCleanupJob`, 4 blocs),
     `reminders.job.ts`, `platformBilling.job.ts`, `clubJanitor.job.ts`. Une erreur de cron
     est aujourd'hui invisible et le cron « rate » silencieusement.
   - Les `safeNotify` (méthodes privées de `event.service.ts`, `tournament.service.ts`,
     `reservation.service.ts`) : un échec SMTP/DB de notification est best-effort **par
     design** (ne doit jamais casser l'inscription) mais doit devenir **visible**.
   - Les catch des webhooks Stripe (`stripe-webhooks.ts`, `platform-billing-webhooks.ts`)
     qui logguent avant de répondre.

   Règle : `reportError` ne change **jamais** le flux de contrôle (best-effort reste
   best-effort) — il ajoute seulement la visibilité.

### 2. Frontend (Next.js 16.2.6) — `@sentry/nextjs`

Capture les crashs React côté client, les erreurs JS non gérées, et les erreurs côté serveur
Next. **Inactif si `NEXT_PUBLIC_GLITCHTIP_DSN` absent** (dev).

⚠️ **Next 16 + Turbopack.** Le repo tourne sous Turbopack (bundler par défaut, cf. CLAUDE.md).
La compatibilité du plugin de build `@sentry/nextjs` avec Turbopack **doit être vérifiée en
tout début d'implémentation** (lire `node_modules/@sentry/nextjs` + `node_modules/next/dist/docs/`
avant d'écrire du code — cf. `frontend/AGENTS.md`). Deux chemins :

- **Chemin idéal** — `@sentry/nextjs` complet : `instrumentation-client.ts` +
  `Sentry.init` serveur via `instrumentation.ts`, plugin de build pour l'**upload des
  sourcemaps** (sans elles, une stack minifiée est illisible) et `tunnelRoute` (contourne les
  adblockers qui bloquent les requêtes vers un domaine tiers).
- **Chemin de repli sans friction** — si le plugin de build résiste à Turbopack :
  `@sentry/browser` initialisé dans `instrumentation-client.ts` + le hook **`onRequestError`**
  de `instrumentation.ts` (API Next standard, pas de plugin de build). Sourcemaps reportées.

**L'upload des sourcemaps est une tâche séparée et abandonnable.** Le reste de la capture
front ne doit pas en dépendre : on livre la capture d'abord, les sourcemaps ensuite (ou
jamais si Turbopack bloque — on les rebranchera au prochain passage sur le build).

### 3. Infra & configuration

**Variables d'environnement** (ajoutées à `.env.prod.example` et câblées dans
`docker-compose.prod.yml`) :
- `GLITCHTIP_DSN` — backend, service `backend` (comme les autres secrets runtime).
- `NEXT_PUBLIC_GLITCHTIP_DSN` — frontend, **gelée au build** (`NEXT_PUBLIC_*` → passée en
  `args` du build front, exactement comme `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`). Un changement
  de DSN impose un rebuild du front — documenté dans le compose.

**Actions manuelles côté GlitchTip** (documentées dans la spec, réalisées par Eric — non
codables) :
- Créer l'organisation + le projet « palova » (deux DSN : un backend, un frontend — ou un
  seul projet à deux plateformes selon ce que l'UI GlitchTip permet).
- Créer le moniteur d'uptime sur `https://api.palova.fr/health` (intervalle 1–5 min, alerte
  sur non-200).
- Configurer les alertes email (erreurs + uptime) vers l'adresse d'Eric.

**Checklist RGPD (Eric).** Ajouter GlitchTip à la liste des sous-traitants dans la politique
de confidentialité (`frontend/lib/platformContent.ts`, document Confidentialité). C'est un
destinataire de données (métadonnées d'erreur, `userId`, IP).

## Tests

- **`reportError`** : capture appelée avec le contexte quand le SDK est initialisé ; repli
  `console.error` (comportement inchangé) quand il ne l'est pas. Le SDK `@sentry/node` est
  **mocké** sous jest — jamais d'envoi réseau en test.
- **Middleware d'erreur** : capture déclenchée sur une exception (500) ; réponse HTTP
  inchangée. (Les 4xx ne passent pas par ce middleware — pas de test négatif nécessaire,
  mais on documente l'invariant.)
- **`initSentry()`** : no-op vérifiable quand `GLITCHTIP_DSN` est absent (aucun appel `init`).
- **Non-régression `/health`** : la suite existante (`health.routes.test.ts`) reste verte.
- Front : selon le chemin retenu, un test léger que l'init est gardée par la présence du DSN
  (le SDK front mocké). Pas de test d'intégration réseau.

## Hors périmètre (v1)

- Logs structurés (pino) — les 76 `console.*` restent tels quels.
- Tracing de performance, session replay, profiling.
- Auto-restart des conteneurs `unhealthy` (autoheal), supervision système de la VM
  (CPU/disque/RAM).
- Alerting avancé (seuils, agrégation, Slack) — email suffit au démarrage.
- Dashboard métier / analytics produit.

## Risques & points de vérification

1. **Turbopack × `@sentry/nextjs`** (cf. §2) — le plus gros inconnu ; à lever en premier,
   avec repli documenté.
2. **Quota gratuit** (~1 000 événements/mois). Mitigations en place : `tracesSampleRate: 0`,
   `ignoreErrors`, seules les 500/exceptions capturées, 4xx jamais. Si une erreur récurrente
   sature le quota, on la corrige (c'est le but) ou on l'ajoute à `ignoreErrors`.
3. **Dépendance externe.** GlitchTip hébergé est un service tiers ; s'il tombe, on perd la
   visibilité mais **pas** l'application (SDK best-effort, ne bloque jamais une requête).
