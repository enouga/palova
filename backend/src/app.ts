import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { initSentry } from './observability/sentry';
import { reportError } from './observability/reportError';
import { errorHandler } from './observability/errorHandler';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRouter from './routes/auth';
import meRouter from './routes/me';
import sportsRouter from './routes/sports';
import clubsRouter from './routes/clubs';
import adminRouter from './routes/admin';
import resourcesRouter from './routes/resources';
import reservationsRouter from './routes/reservations';
import matchesRouter from './routes/matches';
import openMatchesRouter from './routes/openMatches';
import tournamentsRouter from './routes/tournaments';
import eventsRouter from './routes/events';
import lessonsRouter from './routes/lessons';
import platformRouter from './routes/platform';
import notificationsRouter from './routes/notifications';
import { meMessagingRouter, conversationsRouter } from './routes/conversations';
import pushRouter from './routes/push';
import unsubscribeRouter from './routes/unsubscribe';
import { authMiddleware } from './middleware/auth';
import { requireSuperAdmin } from './middleware/requireSuperAdmin';
import { startCleanupJob } from './jobs/cleanup.job';
import { startReminderJob } from './jobs/reminders.job';
import { startPlatformBillingJob } from './jobs/platformBilling.job';
import { startClubJanitorJob } from './jobs/clubJanitor.job';
import { prisma } from './db/prisma';
import { redis } from './redis/client';
import { UPLOADS_DIR, ensureUploadDirs } from './utils/uploads';
import stripeWebhooksRouter from './routes/stripe-webhooks';
import platformBillingWebhooksRouter from './routes/platform-billing-webhooks';

// Observabilité : à initialiser AVANT toute construction d'app. No-op sans GLITCHTIP_DSN.
initSentry();

const app = express();

// Derrière un seul proxy inverse (Caddy) : req.ip = vraie IP client (dernier saut de
// X-Forwarded-For), résistant au spoofing. Indispensable au rate limiting par IP.
app.set('trust proxy', 1);

// En-têtes de sécurité HTTP de base (HSTS/nosniff/frameguard/referrer…). Caddy pose déjà
// les mêmes en prod (Caddyfile § security_headers) — ce filet couvre le dev (backend servi
// nu sur :3001, sans Caddy devant) et tout accès direct au backend en prod. `crossOriginResourcePolicy`
// est desserré en 'cross-origin' : l'API sert des images consommées cross-origin par le
// frontend (avatars, logos, icônes PWA, cartes OG de partage) sur d'AUTRES domaines/sous-domaines
// (palova.fr, *.palova.fr, palova.app, *.palova.app) — le défaut 'same-origin' de helmet
// casserait leur chargement dans le navigateur.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Domaines racines acceptés (multi-domaines, ex. "palova.fr,palova.app"). Repli
// rétro-compat sur l'ancienne variable singulière, puis localhost (dev).
function rootDomains(): string[] {
  const list = (process.env.FRONTEND_ROOT_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : [(process.env.FRONTEND_ROOT_DOMAIN || 'localhost').toLowerCase()];
}

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // outils non-navigateur / same-origin
    try {
      const host = new URL(origin).hostname;
      const roots = rootDomains();
      if (roots.some((r) => host === r || host.endsWith(`.${r}`))) return cb(null, true);
    } catch { /* origine illisible */ }
    cb(null, false);
  },
}));
// Stripe webhooks — raw body requis pour la vérification de signature
app.use('/api/stripe/webhooks', express.raw({ type: 'application/json' }), stripeWebhooksRouter);
// Webhook Stripe Billing plateforme (abonnements SaaS des clubs) — hors /api/platform,
// qui est monté derrière authMiddleware + requireSuperAdmin.
app.use('/api/billing/webhooks', express.raw({ type: 'application/json' }), platformBillingWebhooksRouter);

app.use(express.json());

// Fichiers uploadés (avatars). Cache long : les noms de fichiers sont horodatés.
ensureUploadDirs();
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '365d', immutable: true }));

app.use('/api/unsubscribe',   unsubscribeRouter);
app.use('/api/auth',          authRouter);
app.use('/api/me',            meRouter);
app.use('/api/me',            notificationsRouter);
app.use('/api/me',            meMessagingRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/sports',        sportsRouter);
app.use('/api/push',          pushRouter);
app.use('/api/resources',     resourcesRouter);
app.use('/api/reservations',  reservationsRouter);
app.use('/api/matches',       matchesRouter);
app.use('/api/open-matches',  openMatchesRouter);
app.use('/api/tournaments',   tournamentsRouter);
app.use('/api/events',        eventsRouter);
app.use('/api/lessons',       lessonsRouter);
app.use('/api/platform', authMiddleware, requireSuperAdmin, platformRouter);
// Admin scopé par club — monté AVANT /api/clubs (plus spécifique).
app.use('/api/clubs/:clubId/admin', adminRouter);
app.use('/api/clubs',         clubsRouter);

// Santé PROFONDE : vérifie réellement Postgres et Redis (un /health « ok » en dur
// pouvait être vert base morte). 503 si une dépendance critique est injoignable.
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: (err as Error).message });
  }
});

// Validation des certificats TLS « à la demande » de Caddy (sous-domaines clubs en prod).
// Caddy appelle GET /internal/tls-check?domain=<host> ; on n'autorise que nos domaines
// racines (palova.fr, palova.app, …) et leurs sous-domaines.
app.get('/internal/tls-check', (req: Request, res: Response) => {
  const domain = String(req.query.domain || '').toLowerCase();
  const ok = rootDomains().some(
    (root) =>
      domain === root ||
      domain === `www.${root}` ||
      domain === `api.${root}` ||
      domain.endsWith(`.${root}`),
  );
  res.sendStatus(ok ? 200 : 403);
});

app.use(errorHandler);

const PORT = parseInt(process.env.PORT || '3001', 10);

if (require.main === module) {
  // Filet de sécurité process (le serveur héberge aussi les crons + les flux SSE) :
  // une promesse rejetée non gérée ne doit pas tuer le process en silence, et une
  // exception non capturée doit le faire sortir proprement (redémarrage Docker).
  process.on('unhandledRejection', (reason) => {
    reportError(reason, { source: 'unhandledRejection' });
  });
  process.on('uncaughtException', (err) => {
    reportError(err, { source: 'uncaughtException' });
    // Laisse à GlitchTip une chance de recevoir l'événement avant l'arrêt (best-effort ;
    // Sentry.close résout immédiatement si le SDK n'est pas initialisé).
    void Sentry.close(2000).finally(() => process.exit(1));
  });

  Promise.all([prisma.$connect(), redis.connect()])
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Backend démarré sur http://localhost:${PORT}`);
        startCleanupJob();
        startReminderJob();
        startPlatformBillingJob();
        startClubJanitorJob();
      });
    })
    .catch(console.error);
}

export default app;
