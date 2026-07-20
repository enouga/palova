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
