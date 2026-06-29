import { api, AuthResponse } from '@/lib/api';
import { setSession } from '@/lib/session';
import { clubUrl } from '@/lib/clubUrl';

/** Minimum requis du routeur Next : on n'utilise que push(). */
type Pushable = { push: (href: string) => void };

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
    router.push(m ? '/admin' : (next || '/')); // staff du club → back-office, sinon next (ou réservation)
  } else {
    const managed = memberships[0];
    setSession(auth.token, managed?.clubId ?? null);
    if (managed) window.location.assign(clubUrl(managed.slug, '/admin'));
    else router.push('/clubs');
  }
}
