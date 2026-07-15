import { rootForHost } from './roots';

const MAX_AGE = 60 * 60 * 24 * 7; // 7 jours, aligné sur l'expiry JWT

// Domaine du cookie calculé à l'écriture selon l'hôte courant : la session est posée
// sur la racine du domaine visité (`.palova.fr` OU `.palova.app`) → login indépendant
// par domaine. localhost / hôte inconnu → pas d'attribut `domain` (cookie hôte-only).
function cookieDomainAttr(): string {
  if (typeof window === 'undefined') return '';
  const root = rootForHost(window.location.host);
  return root && root !== 'localhost' ? `; domain=.${root}` : '';
}

function writeCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}${cookieDomainAttr()}; path=/; SameSite=Lax; max-age=${maxAge}`;
}

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Écrit la session partagée (token + club géré optionnel). */
export function setSession(token: string, clubId?: string | null) {
  writeCookie('token', token, MAX_AGE);
  if (clubId) writeCookie('clubId', clubId, MAX_AGE);
  else writeCookie('clubId', '', 0);
}

export function clearSession() {
  writeCookie('token', '', 0);
  writeCookie('clubId', '', 0);
}

/** true si le cookie de session est *host-only* sur cet hôte (donc NON partageable entre
 *  sous-domaines) — cas de `localhost` en dev : Chrome refuse tout cookie `*.localhost`.
 *  Miroir exact de `cookieDomainAttr` (host-only ⇔ pas d'attribut `domain`). Sert au
 *  « pont de session » de postAuth pour contourner le hop plateforme→club en dev. */
export function sessionCookieIsHostOnly(host: string): boolean {
  const root = rootForHost(host);
  return !root || root === 'localhost';
}
