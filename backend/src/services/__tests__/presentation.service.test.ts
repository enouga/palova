import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { PresentationService } from '../presentation.service';

describe('PresentationService', () => {
  let service: PresentationService;
  beforeEach(() => { service = new PresentationService(); });

  it('getPublic renvoie présentation + photos triées, refuse club inconnu/suspendu', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      id: 'c1', status: 'ACTIVE', presentationText: 'Bienvenue', coverImageUrl: null,
      address: '1 rue', city: 'Paris', latitude: 48.8, longitude: 2.3,
      contactPhone: '01', contactEmail: 'a@b.fr', openingHoursText: '8h-22h',
    } as any);
    prismaMock.clubPhoto.findMany.mockResolvedValue([{ id: 'p1', url: '/uploads/club-photos/x.jpg', caption: null, sortOrder: 0 }] as any);
    const r = await service.getPublic('slug');
    expect(r.presentationText).toBe('Bienvenue');
    expect(r.photos).toHaveLength(1);
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(service.getPublic('nope')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('addPhoto refuse au-delà de 12 photos (PHOTO_LIMIT_REACHED)', async () => {
    prismaMock.clubPhoto.count.mockResolvedValue(12);
    await expect(service.addPhoto('c1', '/uploads/club-photos/y.jpg')).rejects.toThrow('PHOTO_LIMIT_REACHED');
  });

  it('removePhoto scoped club (PHOTO_NOT_FOUND si autre club)', async () => {
    prismaMock.clubPhoto.findUnique.mockResolvedValue({ clubId: 'AUTRE', url: '/uploads/club-photos/z.jpg' } as any);
    await expect(service.removePhoto('c1', 'p1')).rejects.toThrow('PHOTO_NOT_FOUND');
  });
});
