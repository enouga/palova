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
