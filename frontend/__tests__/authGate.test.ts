import { isPublicPath } from '../lib/authGate';

describe('isPublicPath', () => {
  it('autorise les portes d\'entrée', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/register')).toBe(true);
    expect(isPublicPath('/clubs/new')).toBe(true);
    expect(isPublicPath('/login/whatever')).toBe(true);
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
});
