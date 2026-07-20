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
