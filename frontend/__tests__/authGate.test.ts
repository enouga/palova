import { isPublicPath, isPlatformPublicPath, isClubPublicPath, loginRedirectQuery } from '../lib/authGate';

describe('isPublicPath', () => {
  it('autorise les portes d\'entrée', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/register')).toBe(true);
    expect(isPublicPath('/clubs/new')).toBe(true);
    expect(isPublicPath('/login/whatever')).toBe(true);
  });

  it('autorise la réinitialisation de mot de passe (utilisateur déconnecté)', () => {
    expect(isPublicPath('/forgot-password')).toBe(true);
  });

  it('verrouille le reste du site', () => {
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/reserver')).toBe(false);
    expect(isPublicPath('/tournois')).toBe(false);
    expect(isPublicPath('/me/reservations')).toBe(false);
    expect(isPublicPath('/infos')).toBe(false);
  });

  it('distingue l\'annuaire /clubs (privé) de /clubs/new (public)', () => {
    expect(isPublicPath('/clubs')).toBe(false);
    expect(isPublicPath('/clubs/new')).toBe(true);
  });

  it('autorise les pages de contenu public (légales, FAQ, offres, tarifs)', () => {
    for (const p of ['/faq', '/cgu', '/cgv', '/mentions-legales', '/confidentialite', '/offres', '/tarifs']) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it('rend /parties public (parties ouvertes visibles sans login)', () => {
    expect(isPublicPath('/parties')).toBe(true);
  });

  it('rend /club public (présentation du club visible sans login)', () => {
    expect(isPublicPath('/club')).toBe(true);
  });

  it('ne rend PAS /decouvrir public ici (référencée explicitement par hôte, pas dans PUBLIC_PATHS)', () => {
    expect(isPublicPath('/decouvrir')).toBe(false);
  });

  it('/aide est public (page Aide joueur)', () => {
    expect(isPublicPath('/aide')).toBe(true);
    expect(isClubPublicPath('/aide')).toBe(true);
    expect(isPlatformPublicPath('/aide')).toBe(true);
  });
});

describe('isPlatformPublicPath', () => {
  it('ouvre la racine `/` (vitrine marketing) — propre à l\'hôte plateforme', () => {
    expect(isPlatformPublicPath('/')).toBe(true);
  });

  it('hérite des chemins publics communs', () => {
    expect(isPlatformPublicPath('/tarifs')).toBe(true);
    expect(isPlatformPublicPath('/login')).toBe(true);
  });

  it('garde les chemins privés verrouillés', () => {
    expect(isPlatformPublicPath('/me/reservations')).toBe(false);
    expect(isPlatformPublicPath('/superadmin')).toBe(false);
  });

  it('/tournois est public sur l\'hôte plateforme (calendrier national)', () => {
    expect(isPlatformPublicPath('/tournois')).toBe(true);
  });

  it('/tournois/abc (fiche) n\'est PAS forcé public par cette règle (vit sur l\'hôte club)', () => {
    expect(isPlatformPublicPath('/tournois/abc')).toBe(false);
  });

  it('/decouvrir est public sur l\'hôte plateforme (la page y vit réellement)', () => {
    expect(isPlatformPublicPath('/decouvrir')).toBe(true);
  });

  it('n\'altère pas isPublicPath : `/` n\'y est pas (la racine club passe par isClubPublicPath)', () => {
    expect(isPublicPath('/')).toBe(false);
  });
});

describe('isClubPublicPath', () => {
  it('ouvre la racine `/` — le Club-house est la vitrine publique du club', () => {
    expect(isClubPublicPath('/')).toBe(true);
  });

  it('hérite des chemins publics communs (/parties, /club, légales…)', () => {
    expect(isClubPublicPath('/parties')).toBe(true);
    expect(isClubPublicPath('/club')).toBe(true);
    expect(isClubPublicPath('/login')).toBe(true);
  });

  it('garde les chemins privés verrouillés', () => {
    expect(isClubPublicPath('/reserver')).toBe(false);
    expect(isClubPublicPath('/me/reservations')).toBe(false);
    expect(isClubPublicPath('/admin')).toBe(false);
  });

  it('ouvre les fiches et listes tournoi/event (liées depuis la vitrine, pensées pour l\'anonyme)', () => {
    expect(isClubPublicPath('/tournois')).toBe(true);
    expect(isClubPublicPath('/tournois/abc123')).toBe(true);
    expect(isClubPublicPath('/events')).toBe(true);
    expect(isClubPublicPath('/events/xyz789')).toBe(true);
  });

  it('/decouvrir est public sur un hôte club (la page s\'y renvoie elle-même vers la plateforme)', () => {
    expect(isClubPublicPath('/decouvrir')).toBe(true);
  });
});

describe('loginRedirectQuery', () => {
  it('mémorise le chemin demandé en ?next= (encodé)', () => {
    expect(loginRedirectQuery('/me/matches')).toBe('?next=%2Fme%2Fmatches');
  });

  it('conserve la query string du chemin d\'origine', () => {
    expect(loginRedirectQuery('/parties', '?vue=matchs')).toBe('?next=%2Fparties%3Fvue%3Dmatchs');
  });

  it('round-trip : /login lit le next décodé via URLSearchParams (comme nextPath)', () => {
    const q = loginRedirectQuery('/me/matches', '?vue=matchs');
    expect(new URLSearchParams(q).get('next')).toBe('/me/matches?vue=matchs');
  });

  it('ne mémorise rien pour la racine (aucune cible utile à restaurer)', () => {
    expect(loginRedirectQuery('/')).toBe('');
    expect(loginRedirectQuery('/', '')).toBe('');
  });
});
