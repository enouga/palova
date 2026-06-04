import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { Prisma } from '@prisma/client';
import { PlatformService } from '../platform.service';

describe('PlatformService.getStats', () => {
  const service = new PlatformService();

  it('agrège les compteurs globaux', async () => {
    prismaMock.club.count
      .mockResolvedValueOnce(5)   // total
      .mockResolvedValueOnce(4)   // active
      .mockResolvedValueOnce(1);  // suspended
    prismaMock.user.count.mockResolvedValue(120 as any);
    prismaMock.reservation.count.mockResolvedValue(300 as any);
    prismaMock.tournament.count.mockResolvedValue(8 as any);

    const stats = await service.getStats();
    expect(stats).toEqual({
      clubs: { total: 5, active: 4, suspended: 1 },
      users: 120,
      reservations: 300,
      tournaments: 8,
    });
  });
});

describe('PlatformService.listClubs', () => {
  const service = new PlatformService();

  it('renvoie tous les clubs (tous statuts) avec gérants et compteurs', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      {
        id: 'club-demo', slug: 'padel-arena-paris', name: 'Padel Arena Paris',
        city: 'Paris', status: 'SUSPENDED', createdAt: new Date('2026-01-01'),
        members: [{ user: { id: 'u1', email: 'owner@palova.fr', firstName: 'O', lastName: 'M' } }],
        _count: { clubMemberships: 48, resources: 5 },
      },
    ] as any);

    const clubs = await service.listClubs();
    expect(prismaMock.club.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: 'desc' },
    }));
    expect(clubs[0]).toEqual({
      id: 'club-demo', slug: 'padel-arena-paris', name: 'Padel Arena Paris',
      city: 'Paris', status: 'SUSPENDED', createdAt: new Date('2026-01-01'),
      owners: [{ id: 'u1', email: 'owner@palova.fr', firstName: 'O', lastName: 'M' }],
      counts: { adherents: 48, resources: 5 },
    });
  });
});
