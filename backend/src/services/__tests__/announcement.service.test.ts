import fs from 'fs';
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

  describe('annonces enrichies (kind + validUntil)', () => {
    it('create accepte kind + validUntil YYYY-MM-DD stocké fin de journée UTC', async () => {
      prismaMock.announcement.create.mockResolvedValue({ id: 'a1' } as any);
      await service.create('club-1', { title: 'Open P250', body: 'Affiche', kind: 'TOURNAMENT', validUntil: '2026-09-15' });
      expect(prismaMock.announcement.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ kind: 'TOURNAMENT', validUntil: new Date('2026-09-15T23:59:59.999Z') }),
      }));
    });
    it('create refuse un kind inconnu (repli INFO) et une date invalide (VALIDATION_ERROR)', async () => {
      prismaMock.announcement.create.mockResolvedValue({ id: 'a1' } as any);
      await service.create('club-1', { title: 't', body: 'b', kind: 'NIMPORTE' });
      expect(prismaMock.announcement.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ kind: 'INFO' }),
      }));
      await expect(service.create('club-1', { title: 't', body: 'b', validUntil: 'pas-une-date' }))
        .rejects.toThrow('VALIDATION_ERROR');
    });
    it('update supprime le fichier uploadé quand imageUrl est explicitement retirée', async () => {
      const unlink = jest.spyOn(fs.promises, 'unlink').mockResolvedValue();
      prismaMock.announcement.findUnique.mockResolvedValue({ clubId: 'club-1', imageUrl: '/uploads/announcements/a.jpg' } as any);
      prismaMock.announcement.update.mockResolvedValue({ id: 'a1' } as any);
      await service.update('a1', 'club-1', { imageUrl: null });
      expect(unlink).toHaveBeenCalledWith(expect.stringContaining('a.jpg'));
      expect(prismaMock.announcement.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ imageUrl: null }),
      }));
      unlink.mockRestore();
    });

    it('update sans clé imageUrl ne touche pas au fichier existant', async () => {
      const unlink = jest.spyOn(fs.promises, 'unlink').mockResolvedValue();
      prismaMock.announcement.findUnique.mockResolvedValue({ clubId: 'club-1', imageUrl: '/uploads/announcements/a.jpg' } as any);
      prismaMock.announcement.update.mockResolvedValue({ id: 'a1' } as any);
      await service.update('a1', 'club-1', { title: 'nouveau titre' });
      expect(unlink).not.toHaveBeenCalled();
      unlink.mockRestore();
    });

    it('update efface validUntil quand null explicite', async () => {
      prismaMock.announcement.findUnique.mockResolvedValue({ clubId: 'club-1' } as any);
      prismaMock.announcement.update.mockResolvedValue({ id: 'a1' } as any);
      await service.update('a1', 'club-1', { validUntil: null });
      expect(prismaMock.announcement.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ validUntil: null }),
      }));
    });
  });
});
