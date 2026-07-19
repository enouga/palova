import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import {
  getAuthIdentity,
  invalidateAuthIdentity,
  _setAuthCacheTtl,
  _clearAuthCache,
} from '../authCache';

// Le TTL est 0 par défaut sous NODE_ENV=test (chaque requête frappe la base, comme
// avant — les suites de routes mockent user.findUnique par requête) ; ces tests
// réactivent le cache explicitement.
describe('authCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    _clearAuthCache();
    _setAuthCacheTtl(30_000);
    prismaMock.user.findUnique.mockReset();
  });

  afterEach(() => {
    _setAuthCacheTtl(0);
    jest.useRealTimers();
  });

  it("sert l'identité en cache pendant le TTL (une seule requête SQL)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ tokenVersion: 2, deletedAt: null } as any);

    const a = await getAuthIdentity('u1');
    const b = await getAuthIdentity('u1');

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ tokenVersion: 2, deleted: false });
    expect(b).toEqual({ tokenVersion: 2, deleted: false });
  });

  it('relit la base après expiration du TTL', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ tokenVersion: 0, deletedAt: null } as any);

    await getAuthIdentity('u1');
    jest.advanceTimersByTime(30_001);
    await getAuthIdentity('u1');

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('invalidateAuthIdentity force une relecture immédiate (reset mot de passe, suppression)', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ tokenVersion: 0, deletedAt: null } as any)
      .mockResolvedValueOnce({ tokenVersion: 1, deletedAt: null } as any);

    await getAuthIdentity('u1');
    invalidateAuthIdentity('u1');
    const after = await getAuthIdentity('u1');

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2);
    expect(after).toEqual({ tokenVersion: 1, deleted: false });
  });

  it('utilisateur introuvable → null, jamais mis en cache', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as any);

    expect(await getAuthIdentity('ghost')).toBeNull();
    expect(await getAuthIdentity('ghost')).toBeNull();

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('compte supprimé → deleted:true (mis en cache comme le reste)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ tokenVersion: 0, deletedAt: new Date() } as any);

    const a = await getAuthIdentity('u1');
    const b = await getAuthIdentity('u1');

    expect(a).toEqual({ tokenVersion: 0, deleted: true });
    expect(b).toEqual({ tokenVersion: 0, deleted: true });
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('tokenVersion absent en base → 0 (fixtures historiques)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ tokenVersion: null, deletedAt: null } as any);

    expect(await getAuthIdentity('u1')).toEqual({ tokenVersion: 0, deleted: false });
  });

  it('TTL 0 : cache désactivé, chaque lecture frappe la base (défaut sous jest)', async () => {
    _setAuthCacheTtl(0);
    prismaMock.user.findUnique.mockResolvedValue({ tokenVersion: 0, deletedAt: null } as any);

    await getAuthIdentity('u1');
    await getAuthIdentity('u1');

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2);
  });
});
