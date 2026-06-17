import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { ReservationService } from '../reservation.service';

describe('ReservationService.adminCreateSeries', () => {
  let service: ReservationService;
  beforeEach(() => {
    service = new ReservationService();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo', club: { timezone: 'Europe/Paris' } } as any);
    prismaMock.reservationSeries.create.mockResolvedValue({ id: 'ser1' } as any);
    (prismaMock.reservation.create as any).mockImplementation(async (args: any) => ({ id: 'r-' + Math.round(args.data.startTime.getTime() / 1000), ...args.data }));
  });

  it('crée une réservation CONFIRMED par occurrence avec seriesId', async () => {
    prismaMock.reservation.count.mockResolvedValue(0 as any);
    const out = await service.adminCreateSeries({
      clubId: 'club-demo', resourceId: 'res1', type: 'COACHING',
      weekday: 2, startLocal: '18:00', durationMin: 90,
      startDate: '2026-06-02', endDate: '2026-06-16',
    });
    expect(out.created).toBe(3);
    expect(out.skipped).toEqual([]);
    expect(prismaMock.reservation.create).toHaveBeenCalledTimes(3);
    expect(prismaMock.reservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CONFIRMED', type: 'COACHING', seriesId: 'ser1', userId: null }),
    }));
  });

  it('saute les occurrences en conflit et les remonte dans skipped', async () => {
    prismaMock.reservation.count
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValue(0 as any);
    const out = await service.adminCreateSeries({
      clubId: 'club-demo', resourceId: 'res1', type: 'COURT',
      weekday: 2, startLocal: '18:00', durationMin: 90,
      startDate: '2026-06-02', endDate: '2026-06-16',
    });
    expect(out.created).toBe(2);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0].reason).toBe('SLOT_NOT_AVAILABLE');
  });

  it('rejette CLUB_MISMATCH si la ressource est d un autre club', async () => {
    prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'autre', club: { timezone: 'Europe/Paris' } } as any);
    await expect(service.adminCreateSeries({
      clubId: 'club-demo', resourceId: 'res1', type: 'COURT',
      weekday: 2, startLocal: '18:00', durationMin: 90, startDate: '2026-06-02', endDate: '2026-06-16',
    })).rejects.toThrow('CLUB_MISMATCH');
  });

  it('rejette RESOURCE_NOT_FOUND', async () => {
    prismaMock.resource.findUnique.mockResolvedValue(null as any);
    await expect(service.adminCreateSeries({
      clubId: 'club-demo', resourceId: 'res1', type: 'COURT',
      weekday: 2, startLocal: '18:00', durationMin: 90, startDate: '2026-06-02', endDate: '2026-06-16',
    })).rejects.toThrow('RESOURCE_NOT_FOUND');
  });

  it('propage SERIES_TOO_LONG sans rien créer', async () => {
    await expect(service.adminCreateSeries({
      clubId: 'club-demo', resourceId: 'res1', type: 'COURT',
      weekday: 2, startLocal: '18:00', durationMin: 90, startDate: '2026-06-02', endDate: '2027-08-10',
    })).rejects.toThrow('SERIES_TOO_LONG');
    expect(prismaMock.reservationSeries.create).not.toHaveBeenCalled();
  });
});

describe('ReservationService.adminCancelSeries', () => {
  let service: ReservationService;
  beforeEach(() => {
    service = new ReservationService();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  });

  it('annule les occurrences futures et clôt la série', async () => {
    prismaMock.reservationSeries.findUnique.mockResolvedValue({ id: 'ser1', clubId: 'club-demo' } as any);
    prismaMock.reservation.findMany.mockResolvedValue([
      { id: 'r1', resourceId: 'res1', startTime: new Date('2999-01-01T10:00:00Z'), endTime: new Date('2999-01-01T11:00:00Z') },
    ] as any);
    prismaMock.reservation.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.reservationSeries.update.mockResolvedValue({ id: 'ser1' } as any);

    const out = await service.adminCancelSeries('ser1', 'club-demo');
    expect(out.cancelled).toBe(1);
    expect(prismaMock.reservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
    expect(prismaMock.reservationSeries.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ser1' },
      data: expect.objectContaining({ cancelledAt: expect.any(Date) }),
    }));
  });

  it('rejette SERIES_NOT_FOUND', async () => {
    prismaMock.reservationSeries.findUnique.mockResolvedValue(null as any);
    await expect(service.adminCancelSeries('ser1', 'club-demo')).rejects.toThrow('SERIES_NOT_FOUND');
  });

  it('rejette CLUB_MISMATCH', async () => {
    prismaMock.reservationSeries.findUnique.mockResolvedValue({ id: 'ser1', clubId: 'autre' } as any);
    await expect(service.adminCancelSeries('ser1', 'club-demo')).rejects.toThrow('CLUB_MISMATCH');
  });
});
