import { getCookie, writeCookie } from './session';

/** Cookie qui mémorise le choix de l'utilisateur sur les cookies de mesure d'audience.
 *  Strictement fonctionnel (exempté de consentement). Partagé sur `.palova.fr` via la
 *  logique de domaine de session.ts → consenti une fois pour tous les sous-domaines. */
export const CONSENT_COOKIE = 'palova_consent';

/** Bumper si GA se met à collecter autre chose → la bannière réapparaît pour re-recueillir. */
export const CONSENT_VERSION = 1;

/** Event window émis par « Gérer les cookies » (Footer) pour rouvrir la bannière. */
export const CONSENT_EVENT = 'palova:open-consent';

// 6 mois : re-demande périodique (recommandation CNIL, borne max 13 mois).
const MAX_AGE = 60 * 60 * 24 * 180;

export type ConsentValue = 'granted' | 'denied';

/** Choix courant, ou null si absent OU version périmée (→ bannière à réafficher). */
export function readConsent(): ConsentValue | null {
  const raw = getCookie(CONSENT_COOKIE);
  if (!raw) return null;
  const [value, version] = raw.split(':');
  if (version !== String(CONSENT_VERSION)) return null;
  if (value !== 'granted' && value !== 'denied') return null;
  return value;
}

/** Persiste le choix (valeur + version) dans le cookie partagé. */
export function writeConsent(value: ConsentValue): void {
  writeCookie(CONSENT_COOKIE, `${value}:${CONSENT_VERSION}`, MAX_AGE);
}
