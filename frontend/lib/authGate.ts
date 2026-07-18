// Chemins accessibles sans être connecté (portes d'entrée de l'app + pages de
// contenu public : légales, FAQ, offres/tarifs — lisibles par tout visiteur).
export const PUBLIC_PATHS = [
  '/login', '/register', '/clubs/new', '/forgot-password',
  '/parties', '/club', '/session-bridge',
  '/faq', '/cgu', '/cgv', '/mentions-legales', '/confidentialite', '/offres', '/tarifs',
];

/** true si le chemin est public (exact ou sous-chemin d'un PUBLIC_PATHS). */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/** true si le chemin est accessible sans login sur l'HÔTE PLATEFORME (la racine `/` = vitrine
 * marketing, en plus des pages publiques communes). N'affecte PAS les sous-domaines club. */
export function isPlatformPublicPath(pathname: string): boolean {
  // `/` = vitrine, `/tournois` = calendrier national public (la fiche /tournois/[id] vit sur l'hôte club).
  return pathname === '/' || pathname === '/tournois' || isPublicPath(pathname);
}

/** true si le chemin est accessible sans login sur un HÔTE CLUB : la racine `/` est le
 * Club-house — la VITRINE du club (parties ouvertes, offres, présentation) — visible de
 * tout visiteur, comme /parties et /club ; les blocs personnels s'y masquent sans session. */
export function isClubPublicPath(pathname: string): boolean {
  // La racine = Club-house (vitrine publique). Les fiches tournoi/event et leurs listes sont
  // liées depuis cette vitrine et conçues pour l'anonyme (CTA « Se connecter pour s'inscrire ») :
  // sans ça, un visiteur qui clique un event « à la une » tombait sur /login (cul-de-sac).
  return pathname === '/'
    || pathname === '/tournois' || pathname.startsWith('/tournois/')
    || pathname === '/events' || pathname.startsWith('/events/')
    || isPublicPath(pathname);
}
