// Chemins accessibles sans être connecté (portes d'entrée de l'app + pages de
// contenu public : légales, FAQ, offres/tarifs — lisibles par tout visiteur).
export const PUBLIC_PATHS = [
  '/login', '/register', '/clubs/new', '/forgot-password',
  '/parties', '/club', '/session-bridge',
  '/faq', '/cgu', '/cgv', '/mentions-legales', '/confidentialite', '/offres', '/tarifs',
  '/aide',
];

/** true si le chemin est public (exact ou sous-chemin d'un PUBLIC_PATHS). */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/** Query string à accoler à `/login` pour revenir à la page demandée après connexion
 *  (`?next=<chemin encodé>`) — posée par le proxy quand il verrouille un chemin privé, pour
 *  qu'un lien de mail (ex. `/me/matches`) ouvert sans session ne se perde pas au login.
 *  Le chemin est same-origin par construction (pathname+search de la requête) et `safeNext`
 *  (postAuth) le revalide côté client (anti open-redirect). Vide pour la racine `/` (rien
 *  d'utile à restaurer — et la racine ne déclenche de toute façon jamais ce verrou). */
export function loginRedirectQuery(pathname: string, search = ''): string {
  if (pathname === '/') return '';
  return `?next=${encodeURIComponent(pathname + search)}`;
}

/** true si le chemin est accessible sans login sur l'HÔTE PLATEFORME (la racine `/` = vitrine
 * marketing, en plus des pages publiques communes). N'affecte PAS les sous-domaines club. */
export function isPlatformPublicPath(pathname: string): boolean {
  // `/` = vitrine, `/tournois` = calendrier national public (la fiche /tournois/[id] vit sur l'hôte club).
  // `/decouvrir` = la page vit réellement ici, sur l'hôte plateforme.
  return pathname === '/' || pathname === '/tournois' || pathname === '/decouvrir' || isPublicPath(pathname);
}

/** true si le chemin est accessible sans login sur un HÔTE CLUB : la racine `/` est le
 * Club-house — la VITRINE du club (parties ouvertes, offres, présentation) — visible de
 * tout visiteur, comme /parties et /club ; les blocs personnels s'y masquent sans session. */
export function isClubPublicPath(pathname: string): boolean {
  // La racine = Club-house (vitrine publique). Les fiches tournoi/event et leurs listes sont
  // liées depuis cette vitrine et conçues pour l'anonyme (CTA « Se connecter pour s'inscrire ») :
  // sans ça, un visiteur qui clique un event « à la une » tombait sur /login (cul-de-sac).
  // `/decouvrir` n'a rien à faire sur un hôte club — la page se renvoie elle-même vers la
  // plateforme dès son montage — mais cette redirection doit pouvoir s'exécuter sans passer
  // par /login d'abord, donc elle doit rester publique ici aussi.
  return pathname === '/'
    || pathname === '/tournois' || pathname.startsWith('/tournois/')
    || pathname === '/events' || pathname.startsWith('/events/')
    || pathname === '/decouvrir'
    || isPublicPath(pathname);
}
