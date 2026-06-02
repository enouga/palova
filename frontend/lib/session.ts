const COOKIE_DOMAIN = process.env.NEXT_PUBLIC_COOKIE_DOMAIN || 'localhost';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 jours, aligné sur l'expiry JWT

function writeCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; domain=${COOKIE_DOMAIN}; path=/; SameSite=Lax; max-age=${maxAge}`;
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
