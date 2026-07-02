import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { ensureActiveMembership } from '../membership';

describe('ensureActiveMembership', () => {
  it('CLUB_NOT_FOUND si le club est absent ou suspendu', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(ensureActiveMembership('demo', 'u1')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('MEMBERSHIP_BLOCKED si le membre est BLOCKED', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED' } as any);
    await expect(ensureActiveMembership('demo', 'u1')).rejects.toThrow('MEMBERSHIP_BLOCKED');
  });

  it('crée l adhésion si absente et renvoie { id: clubId }', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    prismaMock.clubMembership.create.mockResolvedValue({ id: 'm1' } as any);
    const out = await ensureActiveMembership('demo', 'u1');
    expect(prismaMock.clubMembership.create).toHaveBeenCalledWith({ data: { userId: 'u1', clubId: 'club-1' } });
    expect(out).toEqual({ id: 'club-1' });
  });

  it('ne crée rien si le membre existe déjà (ACTIVE)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    const out = await ensureActiveMembership('demo', 'u1');
    expect(prismaMock.clubMembership.create).not.toHaveBeenCalled();
    expect(out).toEqual({ id: 'club-1' });
  });
});
