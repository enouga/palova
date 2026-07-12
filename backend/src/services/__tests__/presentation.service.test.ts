import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { PresentationService, normalizeAmenities } from '../presentation.service';

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

  it('normalizeAmenities filtre les clés inconnues, déduplique, réordonne selon le catalogue', () => {
    expect(normalizeAmenities(['parking', 'bar', 'spa', 'bar'])).toEqual(['bar', 'parking']);
    expect(normalizeAmenities('nope')).toEqual([]);
    expect(normalizeAmenities(undefined)).toEqual([]);
  });

  it('updateText persiste foundedYear + amenities normalisés', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    prismaMock.club.findUniqueOrThrow.mockResolvedValue({ presentationText: null, contactPhone: null, contactEmail: null, openingHoursText: null, coverImageUrl: null, foundedYear: 2021, amenities: ['bar'] } as any);
    prismaMock.clubPhoto.findMany.mockResolvedValue([] as any);
    await service.updateText('c1', { foundedYear: 2021, amenities: ['parking', 'spa', 'bar'] });
    expect(prismaMock.club.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ foundedYear: 2021, amenities: ['bar', 'parking'] }),
    }));
  });

  it('updateText refuse une année hors bornes (VALIDATION_ERROR)', async () => {
    await expect(service.updateText('c1', { foundedYear: 1850 })).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.updateText('c1', { foundedYear: 2.5 as any })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('getPublic expose foundedYear + amenities', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      id: 'c1', status: 'ACTIVE', presentationText: null, coverImageUrl: null,
      address: '1 rue', city: 'Paris', latitude: null, longitude: null,
      contactPhone: null, contactEmail: null, openingHoursText: null,
      foundedYear: 2021, amenities: ['bar'],
    } as any);
    prismaMock.clubPhoto.findMany.mockResolvedValue([] as any);
    const r = await service.getPublic('slug');
    expect(r.foundedYear).toBe(2021);
    expect(r.amenities).toEqual(['bar']);
  });
});
