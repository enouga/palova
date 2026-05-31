import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { CourtService } from '../court.service';

describe('CourtService', () => {
  let service: CourtService;
  beforeEach(() => { service = new CourtService(); });

  describe('createCourt', () => {
    it('crée un terrain valide avec horaires par défaut', async () => {
      prismaMock.court.create.mockResolvedValue({ id: 'c1' } as any);

      const res = await service.createCourt({ clubId: 'club-demo', name: 'Terrain 4', pricePerHour: 30 });

      expect(prismaMock.court.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          clubId: 'club-demo', name: 'Terrain 4', pricePerHour: 30, openHour: 8, closeHour: 22,
        }),
      }));
      expect(res.id).toBe('c1');
    });

    it('rejette VALIDATION_ERROR si pricePerHour <= 0', async () => {
      await expect(service.createCourt({ clubId: 'club-demo', name: 'T4', pricePerHour: 0 }))
        .rejects.toThrow('VALIDATION_ERROR');
      expect(prismaMock.court.create).not.toHaveBeenCalled();
    });

    it('rejette VALIDATION_ERROR si openHour >= closeHour', async () => {
      await expect(service.createCourt({ clubId: 'club-demo', name: 'T4', pricePerHour: 30, openHour: 22, closeHour: 22 }))
        .rejects.toThrow('VALIDATION_ERROR');
    });

    it('rejette VALIDATION_ERROR si name vide', async () => {
      await expect(service.createCourt({ clubId: 'club-demo', name: '   ', pricePerHour: 30 }))
        .rejects.toThrow('VALIDATION_ERROR');
    });
  });

  describe('updateCourt', () => {
    it('rejette COURT_NOT_FOUND si le terrain appartient à un autre club', async () => {
      prismaMock.court.findUnique.mockResolvedValue({
        id: 'c1', clubId: 'autre-club', openHour: 8, closeHour: 22, pricePerHour: 25,
      } as any);

      await expect(service.updateCourt('c1', 'club-demo', { pricePerHour: 30 }))
        .rejects.toThrow('COURT_NOT_FOUND');
      expect(prismaMock.court.update).not.toHaveBeenCalled();
    });

    it('met à jour le tarif (validation sur horaires existants mergés)', async () => {
      prismaMock.court.findUnique.mockResolvedValue({
        id: 'c1', clubId: 'club-demo', openHour: 8, closeHour: 22, pricePerHour: 25,
      } as any);
      prismaMock.court.update.mockResolvedValue({ id: 'c1', pricePerHour: 28 } as any);

      await service.updateCourt('c1', 'club-demo', { pricePerHour: 28 });

      expect(prismaMock.court.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'c1' }, data: { pricePerHour: 28 },
      }));
    });

    it('rejette VALIDATION_ERROR si openHour effectif >= closeHour existant', async () => {
      prismaMock.court.findUnique.mockResolvedValue({
        id: 'c1', clubId: 'club-demo', openHour: 8, closeHour: 22, pricePerHour: 25,
      } as any);

      await expect(service.updateCourt('c1', 'club-demo', { openHour: 23 }))
        .rejects.toThrow('VALIDATION_ERROR');
    });
  });

  describe('setCourtActive', () => {
    it('désactive un terrain du club', async () => {
      prismaMock.court.findUnique.mockResolvedValue({ id: 'c1', clubId: 'club-demo' } as any);
      prismaMock.court.update.mockResolvedValue({ id: 'c1', isActive: false } as any);

      await service.setCourtActive('c1', 'club-demo', false);

      expect(prismaMock.court.update).toHaveBeenCalledWith({
        where: { id: 'c1' }, data: { isActive: false },
      });
    });

    it('rejette COURT_NOT_FOUND pour un terrain d un autre club', async () => {
      prismaMock.court.findUnique.mockResolvedValue({ id: 'c1', clubId: 'autre' } as any);
      await expect(service.setCourtActive('c1', 'club-demo', false)).rejects.toThrow('COURT_NOT_FOUND');
    });
  });
});
