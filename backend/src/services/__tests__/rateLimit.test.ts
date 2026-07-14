import '../../__mocks__/redis';
import { redisMock } from '../../__mocks__/redis';
import { assertRateLimit } from '../rateLimit';

describe('assertRateLimit', () => {
  it('sous la limite → OK, INCR posé, EXPIRE au premier appel (count===1)', async () => {
    redisMock.incr.mockResolvedValue(1);
    redisMock.expire.mockResolvedValue(1);
    await expect(assertRateLimit('test:bucket', 'u1', 5, 60)).resolves.toBeUndefined();
    expect(redisMock.incr).toHaveBeenCalledWith(expect.stringContaining('rl:test:bucket:u1:'));
    expect(redisMock.expire).toHaveBeenCalledWith(expect.stringMatching(/^rl:test:bucket:u1:\d+$/), 60);
  });

  it('un appel suivant (count > 1) ne repose pas EXPIRE', async () => {
    redisMock.incr.mockResolvedValue(3);
    await assertRateLimit('test:bucket', 'u1', 5, 60);
    expect(redisMock.expire).not.toHaveBeenCalled();
  });

  it('au-delà de la limite → throw RATE_LIMITED', async () => {
    redisMock.incr.mockResolvedValue(6);
    await expect(assertRateLimit('test:bucket', 'u1', 5, 60)).rejects.toThrow('RATE_LIMITED');
  });

  it('fenêtre différente → clé différente', async () => {
    redisMock.incr.mockResolvedValue(1);
    const t0 = 1_720_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValueOnce(t0).mockReturnValueOnce(t0 + 61_000);
    await assertRateLimit('test:bucket', 'u1', 5, 60);
    await assertRateLimit('test:bucket', 'u1', 5, 60);
    const keys = redisMock.incr.mock.calls.map((c) => c[0]);
    expect(keys[0]).not.toBe(keys[1]);
    (Date.now as jest.Mock).mockRestore();
  });

  it('Redis indisponible (incr rejette) → fail-open, ne lève pas', async () => {
    redisMock.incr.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(assertRateLimit('test:bucket', 'u1', 5, 60)).resolves.toBeUndefined();
  });

  it('Redis indisponible sur EXPIRE → fail-open aussi', async () => {
    redisMock.incr.mockResolvedValue(1);
    redisMock.expire.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(assertRateLimit('test:bucket', 'u1', 5, 60)).resolves.toBeUndefined();
  });
});
