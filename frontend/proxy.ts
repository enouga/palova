import { NextRequest, NextResponse } from 'next/server';
import { isClubPublicPath, isPlatformPublicPath } from './lib/authGate';
import { clubSlugFromHost } from './lib/host';
import { ROOT_DOMAINS, rootForHost, CANONICAL_ROOT } from './lib/roots';

function portSuffix(host: string): string {
  const i = host.indexOf(':');
  return i >= 0 ? host.slice(i) : '';
}

export function proxy(request: NextRequest) {
  // Verrou d'accès privé (Basic Auth) — actif uniquement si SITE_USER/SITE_PASS sont définis
  // (donc inactif en local, et trivial à retirer en supprimant ces variables d'env).
  const U = process.env.SITE_USER, P = process.env.SITE_PASS;
  if (U && P) {
    const [scheme, encoded] = (request.headers.get('authorization') || '').split(' ');
    let okAuth = false;
    if (scheme === 'Basic' && encoded) {
      const [user, pass] = atob(encoded).split(':');
      okAuth = user === U && pass === P;
    }
    if (!okAuth) {
      return new NextResponse('Authentification requise', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="palova", charset="UTF-8"' },
      });
    }
  }

  const host = request.headers.get('host') || '';
  const url = request.nextUrl;
  // Racine du domaine effectivement visité (.fr ou .app) : les redirections same-host
  // doivent rester sur ce domaine, jamais sauter d'un domaine racine à l'autre.
  const currentRoot = rootForHost(host) || CANONICAL_ROOT;
  const slug = clubSlugFromHost(host, ROOT_DOMAINS);

  // Verrou de connexion : sans cookie `token` et hors page publique → /login (même hôte).
  const token = request.cookies.get('token')?.value;
  const redirectToLogin = () => {
    const to = url.clone();
    to.pathname = '/login';
    to.search = '';
    return NextResponse.redirect(to);
  };

  if (!slug) {
    // HOST PLATEFORME — rétro-compat /c/<slug> → racine du sous-domaine club
    const m = url.pathname.match(/^\/c\/([^/]+)\/?$/);
    if (m) return NextResponse.redirect(`${url.protocol}//${m[1]}.${currentRoot}${portSuffix(host)}/`);
    if (!token && !isPlatformPublicPath(url.pathname)) return redirectToLogin();
    // Hôte plateforme : on retire les en-têtes internes (sinon un client peut les forger
    // et déclencher la redirection d'alias du layout — vecteur d'open redirect / cache poisoning).
    const cleaned = new Headers(request.headers);
    cleaned.delete('x-club-slug');
    cleaned.delete('x-club-path');
    return NextResponse.next({ request: { headers: cleaned } });
  }

  // HOST CLUB
  // L'annuaire et la création de club n'existent que sur la plateforme.
  if (url.pathname === '/clubs' || url.pathname.startsWith('/clubs/')) {
    return NextResponse.redirect(`${url.protocol}//${currentRoot}${portSuffix(host)}${url.pathname}`);
  }
  if (!token && !isClubPublicPath(url.pathname)) return redirectToLogin();
  // Injecte le slug + le chemin complet pour le layout serveur (résolution d'alias → redirection 308).
  const headers = new Headers(request.headers);
  headers.set('x-club-slug', slug);
  headers.set('x-club-path', url.pathname + url.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
