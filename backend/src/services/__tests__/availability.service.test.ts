import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { AvailabilityService } from '../availability.service';

beforeEach(() => { prismaMock.promotion.findMany.mockResolvedValue([] as any); });

// Ressource padel 8h–22h, fuseau du club par défaut Europe/Paris, pas de 30 min.
function mockResource(
  timezone = 'Europe/Paris',
  opts: { price?: number; offPeakPrice?: number | null; offPeakHours?: unknown } = {},
) {
  prismaMock.resource.findUniqueOrThrow.mockResolvedValue({
    openHour: 8,
    closeHour: 22,
    price: opts.price ?? 25,
    offPeakPrice: opts.offPeakPrice ?? null,
    clubId: 'club-1',
    club: { timezone, offPeakHours: opts.offPeakHours ?? null },
    clubSport: { slotStepMin: null, sport: { defaultSlotStepMin: 30 } },
  } as any);
}

describe('AvailabilityService.getAvailableSlots', () => {
  let service: AvailabilityService;

  beforeEach(() => { service = new AvailabilityService(); });

  it('retourne tous les créneaux disponibles quand aucune réservation active', async () => {
    mockResource();
    prismaMock.reservation.findMany.mockResolvedValue([]);

    const slots = await service.getAvailableSlots('court-1', '2025-06-15', 60);

    // 8h -> 22h, créneaux fixes de 60 min → 14 créneaux (8:00, 9:00, ..., 21:00)
    expect(slots).toHaveLength(14);
    expect(slots.every((s) => s.available)).toBe(true);
  });

  it('marque comme indisponible le créneau qui chevauche une réservation CONFIRMED', async () => {
    mockResource();
    prismaMock.reservation.findMany.mockResolvedValue([
      {
        startTime: new Date('2025-06-15T07:00:00.000Z'), // 9h Paris (UTC+2 en été)
        endTime:   new Date('2025-06-15T08:00:00.000Z'), // 10h Paris
        status:    'CONFIRMED',
      } as any,
    ]);

    const slots = await service.getAvailableSlots('court-1', '2025-06-15', 60);

    const blocked = slots.find((s) => s.startTime === '2025-06-15T07:00:00.000Z');
    expect(blocked?.available).toBe(false);

    const after = slots.find((s) => s.startTime === '2025-06-15T08:00:00.000Z');
    expect(after?.available).toBe(true);
  });

  it('inclut un PENDING récent dans le calcul de conflit', async () => {
    mockResource();
    prismaMock.reservation.findMany.mockResolvedValue([
      {
        startTime: new Date('2025-06-15T07:00:00.000Z'),
        endTime:   new Date('2025-06-15T08:00:00.000Z'),
        status:    'PENDING',
      } as any,
    ]);

    const slots = await service.getAvailableSlots('court-1', '2025-06-15', 60);

    const blocked = slots.find((s) => s.startTime === '2025-06-15T07:00:00.000Z');
    expect(blocked?.available).toBe(false);
  });

  it('enchaîne les créneaux de 90 min par tranche de 90 min depuis l\'ouverture', async () => {
    mockResource();
    prismaMock.reservation.findMany.mockResolvedValue([]);

    const slots = await service.getAvailableSlots('court-1', '2025-06-15', 90);

    // 8h Paris = 6h UTC (CEST) ; pas de 90 min → 8h, 9h30, 11h…
    expect(slots[0].startTime).toBe('2025-06-15T06:00:00.000Z');
    expect(slots[1].startTime).toBe('2025-06-15T07:30:00.000Z');
    // 14h d'ouverture non divisibles par 90 min : dernier créneau 20h→21h30 Paris (18h→19h30 UTC)
    const last = slots[slots.length - 1];
    expect(last.startTime).toBe('2025-06-15T18:00:00.000Z');
    expect(last.endTime).toBe('2025-06-15T19:30:00.000Z');
  });

  it('applique le tarif heures creuses dans les plages configurées', async () => {
    // 2025-06-15 = dimanche (weekday Luxon 7). Heures creuses ce jour : 8h–18h.
    mockResource('Europe/Paris', { price: 25, offPeakPrice: 18, offPeakHours: { 7: [{ start: 8, end: 18 }] } });
    prismaMock.reservation.findMany.mockResolvedValue([]);

    const slots = await service.getAvailableSlots('court-1', '2025-06-15', 60);

    const morning = slots.find((s) => s.startTime === '2025-06-15T08:00:00.000Z'); // 10h Paris → creux
    expect(morning?.offPeak).toBe(true);
    expect(morning?.price).toBe('18.00');

    const evening = slots.find((s) => s.startTime === '2025-06-15T17:00:00.000Z'); // 19h Paris → plein
    expect(evening?.offPeak).toBe(false);
    expect(evening?.price).toBe('25.00');
  });

  it('prix du créneau indépendant de la durée ; à cheval creuses/pleines → tarif plein', async () => {
    // Dimanche, creuses 8h–18h, 25 € le créneau plein / 18 € le créneau creux, créneaux de 90 min.
    mockResource('Europe/Paris', { price: 25, offPeakPrice: 18, offPeakHours: { 7: [{ start: 8, end: 18 }] } });
    prismaMock.reservation.findMany.mockResolvedValue([]);

    const slots = await service.getAvailableSlots('court-1', '2025-06-15', 90);

    const full = slots.find((s) => s.startTime === '2025-06-15T06:00:00.000Z'); // 8h-9h30 Paris → tout creux
    expect(full?.price).toBe('18.00'); // tarif creux, même à 1h30
    expect(full?.offPeak).toBe(true);

    const straddle = slots.find((s) => s.startTime === '2025-06-15T15:00:00.000Z'); // 17h-18h30 Paris
    expect(straddle?.price).toBe('25.00'); // à cheval → tarif plein
    expect(straddle?.offPeak).toBe(false);
  });

  it('respecte le fuseau horaire du club (America/New_York)', async () => {
    mockResource('America/New_York');
    prismaMock.reservation.findMany.mockResolvedValue([]);

    const slots = await service.getAvailableSlots('court-1', '2025-06-15', 60);

    // 8h New York le 2025-06-15 (EDT, UTC-4) = 12h UTC
    expect(slots[0].startTime).toBe('2025-06-15T12:00:00.000Z');
  });

  it('applique une promo pourcentage au prix (originalPrice + promoName)', async () => {
    mockResource('Europe/Paris', { price: 25 });
    prismaMock.reservation.findMany.mockResolvedValue([]);
    prismaMock.promotion.findMany.mockResolvedValue([
      { name: 'Promo été', kind: 'PERCENT', percentOff: 20, fixedPrice: null, windowStart: null, windowEnd: null, resources: [] },
    ] as any);

    const slots = await service.getAvailableSlots('court-1', '2025-06-15', 60);

    expect(slots[0].price).toBe('20.00');
    expect(slots[0].originalPrice).toBe('25.00');
    expect(slots[0].promoName).toBe('Promo été');
  });

  it('sans promo → pas de originalPrice/promoName', async () => {
    mockResource('Europe/Paris', { price: 25 });
    prismaMock.reservation.findMany.mockResolvedValue([]);
    const slots = await service.getAvailableSlots('court-1', '2025-06-15', 60);
    expect(slots[0].price).toBe('25.00');
    expect(slots[0].originalPrice).toBeUndefined();
    expect(slots[0].promoName).toBeUndefined();
  });
});

describe('AvailabilityService.getClubAvailability', () => {
  let service: AvailabilityService;
  beforeEach(() => {
    service = new AvailabilityService();
    prismaMock.club.findUniqueOrThrow.mockResolvedValue({
      timezone: 'Europe/Paris', offPeakHours: null,
    } as any);
  });

  const clubResource = (id: string) => ({
    id, name: `Terrain ${id}`, attributes: null, price: 25, offPeakPrice: null,
    openHour: 8, closeHour: 22,
    clubSport: { id: 'cs-padel', sport: { key: 'padel', name: 'Padel' } },
  });

  it('filtre les terrains par clubSportId quand fourni', async () => {
    prismaMock.resource.findMany.mockResolvedValue([] as any);

    await service.getClubAvailability('club-1', '2025-06-15', 60, 'cs-padel');

    expect(prismaMock.resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clubId: 'club-1', isActive: true, clubSportId: 'cs-padel' }),
      }),
    );
  });

  it('sans clubSportId : aucun filtre de sport', async () => {
    prismaMock.resource.findMany.mockResolvedValue([] as any);

    await service.getClubAvailability('club-1', '2025-06-15', 60);

    const arg = (prismaMock.resource.findMany as jest.Mock).mock.calls.pop()![0];
    expect(arg.where).not.toHaveProperty('clubSportId');
  });

  it('fini le N+1 : UNE requête réservations groupée, aucune relecture par terrain', async () => {
    prismaMock.resource.findMany.mockResolvedValue([clubResource('r1'), clubResource('r2')] as any);
    prismaMock.reservation.findMany.mockResolvedValue([] as any);

    await service.getClubAvailability('club-1', '2025-06-15', 60);

    expect(prismaMock.reservation.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ resourceId: { in: ['r1', 'r2'] } }),
      }),
    );
    expect(prismaMock.resource.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("les réservations d'un terrain ne bloquent pas les créneaux d'un autre", async () => {
    prismaMock.resource.findMany.mockResolvedValue([clubResource('r1'), clubResource('r2')] as any);
    prismaMock.reservation.findMany.mockResolvedValue([
      { resourceId: 'r1',
        startTime: new Date('2025-06-15T07:00:00.000Z'),  // 9h Paris
        endTime:   new Date('2025-06-15T08:00:00.000Z') },
    ] as any);

    const result = await service.getClubAvailability('club-1', '2025-06-15', 60);

    const r1Slot = result[0].slots.find((s) => s.startTime === '2025-06-15T07:00:00.000Z');
    const r2Slot = result[1].slots.find((s) => s.startTime === '2025-06-15T07:00:00.000Z');
    expect(r1Slot?.available).toBe(false);
    expect(r2Slot?.available).toBe(true);
  });

  it('conserve la forme du payload (resource + slots)', async () => {
    prismaMock.resource.findMany.mockResolvedValue([clubResource('r1')] as any);
    prismaMock.reservation.findMany.mockResolvedValue([] as any);

    const result = await service.getClubAvailability('club-1', '2025-06-15', 60);

    expect(result[0].resource).toEqual({
      id: 'r1', name: 'Terrain r1', attributes: null, price: 25, offPeakPrice: null,
      sport: { key: 'padel', name: 'Padel' }, clubSportId: 'cs-padel',
    });
    expect(result[0].slots).toHaveLength(14); // 8h→22h en pas de 60 min
  });

  it('aucun terrain : renvoie [] sans requête de réservations', async () => {
    prismaMock.resource.findMany.mockResolvedValue([] as any);

    const result = await service.getClubAvailability('club-1', '2025-06-15', 60);

    expect(result).toEqual([]);
    expect(prismaMock.reservation.findMany).not.toHaveBeenCalled();
  });
});
