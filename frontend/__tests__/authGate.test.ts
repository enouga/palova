import { isPublicPath, isPlatformPublicPath } from '../lib/authGate';

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
    for (const p of ['/faq', '/cgv', '/mentions-legales', '/confidentialite', '/offres', '/tarifs']) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it('rend /parties public (parties ouvertes visibles sans login)', () => {
    expect(isPublicPath('/parties')).toBe(true);
  });

  it('rend /club public (présentation du club visible sans login)', () => {
    expect(isPublicPath('/club')).toBe(true);
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

  it('n\'altère pas isPublicPath : `/` reste privé pour l\'hôte club', () => {
    expect(isPublicPath('/')).toBe(false);
  });
});
