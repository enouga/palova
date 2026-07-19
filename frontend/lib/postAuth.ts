import { api, AuthResponse } from '@/lib/api';
import { setSession, sessionCookieIsHostOnly } from '@/lib/session';
import { clubUrl } from '@/lib/clubUrl';
import { hardNavigate, currentHost } from '@/lib/nav';

/** Minimum requis du routeur Next : on n'utilise que push(). */
type Pushable = { push: (href: string) => void };

/** URL du pont de session (dev localhost) : le token voyage dans le FRAGMENT (`#`, jamais
 *  envoyé au serveur ni journalisé) vers le sous-domaine club, qui reposera le cookie.
 *  Contourne l'impossibilité (Chrome) de partager un cookie entre sous-domaines `*.localhost`. */
function sessionBridgeUrl(slug: string, to: string, token: string, clubId?: string | null): string {
  const frag = new URLSearchParams({ token, to });
  if (clubId) frag.set('clubId', clubId);
  return `${clubUrl(slug, '/session-bridge')}#${frag.toString()}`;
}

/** Navigation plateforme → admin d'un club (sous-domaine). En dev (cookie host-only sur
 *  `*.localhost`) le cookie de session ne suit pas le sous-domaine : on passe par le pont.
 *  En prod (`.palova.fr`), le cookie couvre déjà `*.palova.fr` → redirection directe. */
function goToClubAdmin(slug: string, token: string, clubId?: string | null): void {
  hardNavigate(
    sessionCookieIsHostOnly(currentHost())
      ? sessionBridgeUrl(slug, '/admin', token, clubId)
      : clubUrl(slug, '/admin'),
  );
}

/** N'autorise qu'un chemin interne (même origine) comme cible de redirection post-auth.
 *  Rejette les URL absolues, le protocol-relative (`//`) et la ruse backslash (`/\`) — anti open-redirect (CWE-601). */
export function safeNext(next?: string): string | undefined {
  return next && /^\/(?![/\\])/.test(next) ? next : undefined;
}

// Routage post-authentification (login réussi, code email validé, ou reset de mot de passe)
// selon le rôle et le contexte d'hôte (plateforme vs sous-domaine club).
// Extrait de /login pour être partagé avec /forgot-password.
export async function finishAuth(auth: AuthResponse, slug: string | null, router: Pushable, next?: string): Promise<void> {
  if (!slug && auth.user?.isSuperAdmin) {
    setSession(auth.token, null);
    router.push('/superadmin');
    return;
  }
  const memberships = await api.getMyClubs(auth.token).catch(() => []);
  if (slug) {
    await api.joinClub(slug, auth.token).catch(() => {}); // adhésion automatique au club du host
    const m = memberships.find((x) => x.slug === slug);
    setSession(auth.token, m?.clubId ?? null);
    router.push(m ? '/admin' : (safeNext(next) || '/')); // staff du club → back-office, sinon next (ou réservation)
  } else {
    const managed = memberships[0];
    setSession(auth.token, managed?.clubId ?? null);
    if (managed) goToClubAdmin(managed.slug, auth.token, managed.clubId);
    else router.push('/'); // joueur (pas staff) → accueil plateforme personnalisé (« Vos clubs » + annuaire)
  }
}
