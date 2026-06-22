import { isPublicPath } from '../lib/authGate';

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
});
