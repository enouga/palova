import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { AnnouncementService } from '../announcement.service';

describe('AnnouncementService', () => {
  let service: AnnouncementService;
  beforeEach(() => { service = new AnnouncementService(); });

  it('listPublic rejette CLUB_NOT_FOUND si club inconnu/inactif', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(service.listPublic('inconnu')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('listPublic ne renvoie que les annonces publiées, épinglées d abord', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.announcement.findMany.mockResolvedValue([{ id: 'a1' }] as any);
    await service.listPublic('padel-arena-paris');
    expect(prismaMock.announcement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clubId: 'club-demo', isPublished: true },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    }));
  });

  it('update rejette ANNOUNCEMENT_NOT_FOUND si l annonce est d un autre club', async () => {
    prismaMock.announcement.findUnique.mockResolvedValue({ id: 'a1', clubId: 'autre' } as any);
    await expect(service.update('a1', 'club-demo', { title: 'x' })).rejects.toThrow('ANNOUNCEMENT_NOT_FOUND');
    expect(prismaMock.announcement.update).not.toHaveBeenCalled();
  });
});
