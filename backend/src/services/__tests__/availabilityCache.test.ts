import {
  cachedClubAvailability,
  invalidateClubAvailability,
  _setAvailabilityCacheTtl,
  _clearAvailabilityCache,
} from '../availabilityCache';

// Le TTL est 0 par défaut sous NODE_ENV=test (cache coupé pour ne pas fausser les
// suites de routes qui mockent Prisma requête par requête) ; ces tests le réactivent.
describe('availabilityCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    _clearAvailabilityCache();
    _setAvailabilityCacheTtl(2_000);
  });

  afterEach(() => {
    _setAvailabilityCacheTtl(0);
    jest.useRealTimers();
  });

  const value = (clubId: string, payload: unknown) => ({ clubId, payload });

  it('sert la réponse en cache pendant le TTL (un seul calcul)', async () => {
    const compute = jest.fn().mockResolvedValue(value('c1', ['slots']));

    const a = await cachedClubAvailability('k1', compute);
    const b = await cachedClubAvailability('k1', compute);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(a).toEqual(['slots']);
    expect(b).toEqual(['slots']);
  });

  it('single-flight : des appels concurrents partagent le même calcul en vol', async () => {
    let resolve!: (v: { clubId: string; payload: unknown }) => void;
    const compute = jest.fn(() => new Promise<{ clubId: string; payload: unknown }>((r) => { resolve = r; }));

    const p1 = cachedClubAvailability('k1', compute);
    const p2 = cachedClubAvailability('k1', compute);
    resolve(value('c1', 'payload'));

    expect(await p1).toBe('payload');
    expect(await p2).toBe('payload');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('recalcule après expiration du TTL', async () => {
    const compute = jest.fn().mockResolvedValue(value('c1', 1));

    await cachedClubAvailability('k1', compute);
    jest.advanceTimersByTime(2_001);
    await cachedClubAvailability('k1', compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('des clés différentes ne partagent rien', async () => {
    const compute = jest.fn().mockResolvedValue(value('c1', 1));

    await cachedClubAvailability('k1', compute);
    await cachedClubAvailability('k2', compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("une erreur n'est jamais mise en cache", async () => {
    const compute = jest.fn()
      .mockRejectedValueOnce(new Error('CLUB_NOT_FOUND'))
      .mockResolvedValueOnce(value('c1', 'ok'));

    await expect(cachedClubAvailability('k1', compute)).rejects.toThrow('CLUB_NOT_FOUND');
    await expect(cachedClubAvailability('k1', compute)).resolves.toBe('ok');
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('invalidateClubAvailability ne purge que le club visé', async () => {
    const computeA = jest.fn().mockResolvedValue(value('club-a', 'a'));
    const computeB = jest.fn().mockResolvedValue(value('club-b', 'b'));

    await cachedClubAvailability('ka', computeA);
    await cachedClubAvailability('kb', computeB);

    invalidateClubAvailability('club-a');

    await cachedClubAvailability('ka', computeA);
    await cachedClubAvailability('kb', computeB);

    expect(computeA).toHaveBeenCalledTimes(2); // purgé → recalculé
    expect(computeB).toHaveBeenCalledTimes(1); // intact
  });

  it("invalidation pendant un calcul en vol : l'entrée n'est pas conservée", async () => {
    let resolve!: (v: { clubId: string; payload: unknown }) => void;
    const compute = jest.fn(() => new Promise<{ clubId: string; payload: unknown }>((r) => { resolve = r; }));

    const p1 = cachedClubAvailability('k1', compute);
    // Une écriture arrive pendant le calcul : on ne sait pas encore à quel club
    // appartient l'entrée en vol → elle est purgée par prudence.
    invalidateClubAvailability('club-a');
    resolve(value('club-a', 'stale'));
    await p1;

    const compute2 = jest.fn().mockResolvedValue(value('club-a', 'fresh'));
    await expect(cachedClubAvailability('k1', compute2)).resolves.toBe('fresh');
    expect(compute2).toHaveBeenCalledTimes(1);
  });

  it('TTL 0 : cache et single-flight désactivés (défaut sous jest)', async () => {
    _setAvailabilityCacheTtl(0);
    const compute = jest.fn().mockResolvedValue(value('c1', 1));

    await cachedClubAvailability('k1', compute);
    await cachedClubAvailability('k1', compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });
});
