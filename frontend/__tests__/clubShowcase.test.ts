import {
  AMENITIES, amenityList, showcaseKicker, courtsSummary, courtsChipLabel,
  hoursRange, openNowChip, coverUrl, railPhotos, showShowcase,
} from '@/lib/clubShowcase';
import type { ClubPresentation, ClubSportPublic } from '@/lib/api';

const cs = (key: string, resources: { coverage?: string; openHour?: number; closeHour?: number }[]): ClubSportPublic => ({
  id: `cs-${key}`, slotStepMin: null, durationsMin: [],
  sport: { id: `s-${key}`, key, name: key === 'padel' ? 'Padel' : 'Tennis' } as any,
  resources: resources.map((r, i) => ({
    id: `r${i}`, name: `R${i}`, attributes: r.coverage ? { coverage: r.coverage } : {},
    price: '25', openHour: r.openHour ?? 8, closeHour: r.closeHour ?? 22,
  })) as any,
});

const pres = (over: Partial<ClubPresentation> = {}): ClubPresentation => ({
  presentationText: null, coverImageUrl: null, address: '1 rue', city: 'Paris',
  latitude: null, longitude: null, contactPhone: null, contactEmail: null,
  openingHoursText: null, foundedYear: null, amenities: [], photos: [], ...over,
});

const photo = (id: string) => ({ id, url: `/uploads/club-photos/${id}.jpg`, caption: null, sortOrder: 0 });

describe('clubShowcase helpers', () => {
  it('showcaseKicker assemble ville · Depuis année (segments absents omis)', () => {
    expect(showcaseKicker('Paris', 2021)).toBe('Paris · Depuis 2021');
    expect(showcaseKicker(null, 2021)).toBe('Depuis 2021');
    expect(showcaseKicker('Paris', null)).toBe('Paris');
    expect(showcaseKicker(null, null)).toBeNull();
  });

  it('courtsChipLabel : padel « pistes » + indoor, autre sport « terrains », multi-sport total sans indoor', () => {
    expect(courtsChipLabel(courtsSummary([cs('padel', [{ coverage: 'indoor' }, { coverage: 'indoor' }, {}])]))).toBe('3 pistes · 2 indoor');
    expect(courtsChipLabel(courtsSummary([cs('tennis', [{}])]))).toBe('1 terrain');
    expect(courtsChipLabel(courtsSummary([cs('padel', [{}, {}]), cs('tennis', [{}])]))).toBe('3 terrains');
    expect(courtsChipLabel(courtsSummary([]))).toBeNull();
    expect(courtsChipLabel(courtsSummary(undefined))).toBeNull();
  });

  it('hoursRange agrège min open / max close ; null sans ressource', () => {
    expect(hoursRange([cs('padel', [{ openHour: 9, closeHour: 21 }, { openHour: 8, closeHour: 23 }])])).toEqual({ open: 8, close: 23 });
    expect(hoursRange([])).toBeNull();
  });

  it('openNowChip : ouvert/fermé au fuseau du club, null sans horloge', () => {
    const h = { open: 8, close: 22 };
    expect(openNowChip(h, 'Europe/Paris', new Date('2026-07-12T10:00:00Z'))).toEqual({ open: true, label: "Ouvert · jusqu'à 22h" });
    expect(openNowChip(h, 'Europe/Paris', new Date('2026-07-12T03:00:00Z'))).toEqual({ open: false, label: 'Ouvre à 8h' });
    expect(openNowChip(h, 'Europe/Paris', null)).toBeNull();
    expect(openNowChip(null, 'Europe/Paris', new Date())).toBeNull();
  });

  it('coverUrl : coverImageUrl sinon 1re photo sinon null', () => {
    expect(coverUrl(pres({ coverImageUrl: '/uploads/c.jpg', photos: [photo('a')] }))).toBe('/uploads/c.jpg');
    expect(coverUrl(pres({ photos: [photo('a')] }))).toBe('/uploads/club-photos/a.jpg');
    expect(coverUrl(pres())).toBeNull();
  });

  it('railPhotos : ≤ 2 tuiles hors cover + compteur du reste', () => {
    const p = pres({ photos: [photo('a'), photo('b'), photo('c'), photo('d')] }); // a = cover implicite
    expect(railPhotos(p).tiles.map((t) => t.id)).toEqual(['b', 'c']);
    expect(railPhotos(p).more).toBe(1);
    expect(railPhotos(pres({ photos: [photo('a')] }))).toEqual({ tiles: [], more: 0 });
  });

  it("showShowcase : visible dès qu'une info propre existe, sinon masqué", () => {
    expect(showShowcase(null)).toBe(false);
    expect(showShowcase(pres())).toBe(false);
    expect(showShowcase(pres({ presentationText: 'x' }))).toBe(true);
    expect(showShowcase(pres({ photos: [photo('a')] }))).toBe(true);
    expect(showShowcase(pres({ amenities: ['bar'] }))).toBe(true);
    expect(showShowcase(pres({ foundedYear: 2021 }))).toBe(true);
  });

  it('amenityList mappe les clés vers le catalogue (8 entrées, ordre canonique)', () => {
    expect(AMENITIES).toHaveLength(8);
    expect(amenityList(['parking', 'bar']).map((a) => a.key)).toEqual(['bar', 'parking']);
    expect(amenityList(undefined)).toEqual([]);
  });
});
