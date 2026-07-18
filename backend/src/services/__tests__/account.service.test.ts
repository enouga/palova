import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import bcrypt from 'bcrypt';

const cancelFutureReservationsForUser = jest.fn();
jest.mock('../reservation.service', () => ({
  ReservationService: jest.fn().mockImplementation(() => ({ cancelFutureReservationsForUser })),
}));

// La suppression pose deletedAt → tout token existant doit être refusé IMMÉDIATEMENT,
// sans attendre l'expiration du cache d'identité du middleware.
const mockInvalidateAuth = jest.fn();
jest.mock('../../middleware/authCache', () => ({
  ...jest.requireActual('../../middleware/authCache'),
  invalidateAuthIdentity: (...a: unknown[]) => mockInvalidateAuth(...a),
}));

import { AccountService } from '../account.service';

beforeEach(() => { cancelFutureReservationsForUser.mockReset(); mockInvalidateAuth.mockReset(); });

describe('AccountService.getDeletionSummary', () => {
  it('signale les clubs où je suis unique OWNER', async () => {
    prismaMock.clubMember.findMany.mockResolvedValue([
      { clubId: 'c1', club: { name: 'Club A' } },
    ] as any);
    // 1 seul OWNER sur c1 → bloquant
    prismaMock.clubMember.count.mockResolvedValue(1 as any);
    prismaMock.reservation.count.mockResolvedValue(2 as any);
    prismaMock.subscription.count.mockResolvedValue(1 as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);

    const res = await new AccountService().getDeletionSummary('u1');
    expect(res.blockingClubs).toEqual(['Club A']);
    expect(res.futureReservations).toBe(2);
    expect(res.activeSubscriptions).toBe(1);
  });

  it('ne bloque pas si un autre OWNER existe', async () => {
    prismaMock.clubMember.findMany.mockResolvedValue([{ clubId: 'c1', club: { name: 'Club A' } }] as any);
    prismaMock.clubMember.count.mockResolvedValue(2 as any);
    prismaMock.reservation.count.mockResolvedValue(0 as any);
    prismaMock.subscription.count.mockResolvedValue(0 as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    const res = await new AccountService().getDeletionSummary('u1');
    expect(res.blockingClubs).toEqual([]);
  });
});

describe('AccountService.deleteAccount', () => {
  const userRow = async () => ({ id: 'u1', password: await bcrypt.hash('password123', 10), avatarUrl: null });

  it('401 si mot de passe faux', async () => {
    prismaMock.user.findUnique.mockResolvedValue(await userRow() as any);
    await expect(new AccountService().deleteAccount('u1', 'wrong')).rejects.toThrow('INVALID_PASSWORD');
  });

  it('OWNS_CLUB si unique OWNER', async () => {
    prismaMock.user.findUnique.mockResolvedValue(await userRow() as any);
    prismaMock.clubMember.findMany.mockResolvedValue([{ clubId: 'c1', club: { name: 'Club A' } }] as any);
    prismaMock.clubMember.count.mockResolvedValue(1 as any);
    await expect(new AccountService().deleteAccount('u1', 'password123')).rejects.toThrow('OWNS_CLUB');
  });

  it('anonymise : annule les résas futures, scrub PII, deletedAt, push supprimées', async () => {
    prismaMock.user.findUnique.mockResolvedValue(await userRow() as any);
    prismaMock.clubMember.findMany.mockResolvedValue([] as any);
    cancelFutureReservationsForUser.mockResolvedValue(3);
    // $transaction reçoit un callback (tx) → on lui passe prismaMock
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.user.update.mockResolvedValue({} as any);
    prismaMock.pushSubscription.deleteMany.mockResolvedValue({ count: 1 } as any);

    const res = await new AccountService().deleteAccount('u1', 'password123');
    expect(cancelFutureReservationsForUser).toHaveBeenCalledWith('u1');
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: expect.objectContaining({
        firstName: 'Joueur', lastName: 'supprimé', email: 'deleted-u1@deleted.palova.invalid',
        phone: null, avatarUrl: null, birthDate: null, sex: null, locale: null, isSuperAdmin: false,
      }),
    }));
    expect(prismaMock.user.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(res).toEqual({ ok: true });
  });

  it("purge le cache d'identité du middleware après suppression", async () => {
    prismaMock.user.findUnique.mockResolvedValue(await userRow() as any);
    prismaMock.clubMember.findMany.mockResolvedValue([] as any);
    cancelFutureReservationsForUser.mockResolvedValue(0);
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.user.update.mockResolvedValue({} as any);
    prismaMock.pushSubscription.deleteMany.mockResolvedValue({ count: 0 } as any);

    await new AccountService().deleteAccount('u1', 'password123');

    expect(mockInvalidateAuth).toHaveBeenCalledWith('u1');
  });
});
