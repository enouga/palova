jest.mock('../lib/api', () => ({
  api: { getMyClubs: jest.fn(), joinClub: jest.fn().mockResolvedValue({ ok: true }) },
}));
jest.mock('../lib/session', () => ({ setSession: jest.fn() }));
jest.mock('../lib/clubUrl', () => ({ clubUrl: (s: string, p: string) => `https://${s}.test${p}` }));

import { finishAuth, safeNext } from '../lib/postAuth';
import { api } from '../lib/api';

const auth = { token: 't', user: { isSuperAdmin: false } } as never;

describe('safeNext (anti open-redirect)', () => {
  it('accepte un chemin interne', () => { expect(safeNext('/parties')).toBe('/parties'); });
  it('accepte un chemin interne avec query', () => { expect(safeNext('/parties?x=1')).toBe('/parties?x=1'); });
  it('rejette une URL absolue', () => { expect(safeNext('https://evil.example')).toBeUndefined(); });
  it('rejette le protocol-relative //', () => { expect(safeNext('//evil.example')).toBeUndefined(); });
  it('rejette la ruse backslash', () => { expect(safeNext('/\\evil.example')).toBeUndefined(); });
  it('rejette vide ou indéfini', () => { expect(safeNext(undefined)).toBeUndefined(); expect(safeNext('')).toBeUndefined(); });
});

describe('finishAuth — retour next', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hôte club, non-staff, avec next → redirige vers next', async () => {
    (api.getMyClubs as jest.Mock).mockResolvedValue([]); // pas staff de ce club
    const push = jest.fn();
    await finishAuth(auth, 'demo', { push }, '/parties');
    expect(api.joinClub).toHaveBeenCalledWith('demo', 't');
    expect(push).toHaveBeenCalledWith('/parties');
  });

  it('hôte club, non-staff, sans next → redirige vers /', async () => {
    (api.getMyClubs as jest.Mock).mockResolvedValue([]);
    const push = jest.fn();
    await finishAuth(auth, 'demo', { push });
    expect(push).toHaveBeenCalledWith('/');
  });

  it('hôte club, staff → ignore next, va sur /admin', async () => {
    (api.getMyClubs as jest.Mock).mockResolvedValue([{ slug: 'demo', clubId: 'c1', role: 'OWNER' }]);
    const push = jest.fn();
    await finishAuth(auth, 'demo', { push }, '/parties');
    expect(push).toHaveBeenCalledWith('/admin');
  });

  it('hôte club, non-staff, next malveillant → ignoré, redirige vers /', async () => {
    (api.getMyClubs as jest.Mock).mockResolvedValue([]);
    const push = jest.fn();
    await finishAuth(auth, 'demo', { push }, 'https://evil.example');
    expect(push).toHaveBeenCalledWith('/');
  });
});
