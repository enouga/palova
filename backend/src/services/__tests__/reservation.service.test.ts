import '../../__mocks__/prisma';
import '../../__mocks__/redis';
import { DateTime, Settings } from 'luxon';
import { Prisma } from '@prisma/client';
import { prismaMock } from '../../__mocks__/prisma';
import { redisMock } from '../../__mocks__/redis';
import { ReservationService } from '../reservation.service';
import { stripe } from '../../db/stripe';

jest.mock('../../db/stripe', () => ({
  stripe: {
    paymentIntents: { retrieve: jest.fn() },
    setupIntents:   { retrieve: jest.fn() },
  },
}));

const mockBroadcast = jest.fn();

jest.mock('../sse.service', () => ({
  SSEService: { getInstance: jest.fn(() => ({ broadcast: mockBroadcast })) },
}));

const mockNotifyPartners = jest.fn();
const mockNotifyAssigned = jest.fn();
const mockNotifyRefunded = jest.fn();
const mockNotifyCancelled = jest.fn();
const mockNotifyActivityCancelled = jest.fn();
jest.mock('../../email/notifications', () => ({
  notifyMatchPartnersInvited: (...a: unknown[]) => mockNotifyPartners(...a),
  notifyReservationMemberAssigned: (...a: unknown[]) => mockNotifyAssigned(...a),
  notifyReservationRefunded: (...a: unknown[]) => mockNotifyRefunded(...a),
  notifyReservationCancelled: (...a: unknown[]) => mockNotifyCancelled(...a),
  notifyActivityCancelledByClub: (...a: unknown[]) => mockNotifyActivityCancelled(...a),
}));

const sseBroadcast = () => mockBroadcast;

describe('ReservationService', () => {
  let service: ReservationService;

  beforeEach(() => {
    service = new ReservationService();
    mockBroadcast.mockReset();
    mockNotifyPartners.mockReset().mockResolvedValue(undefined);
    mockNotifyAssigned.mockReset().mockResolvedValue(undefined);
    mockNotifyRefunded.mockReset().mockResolvedValue(undefined);
    mockNotifyCancelled.mockReset().mockResolvedValue(undefined);
    mockNotifyActivityCancelled.mockReset().mockResolvedValue(undefined);
  });

  const baseParams = {
    resourceId: 'court-1',
    userId:     'user-1',
    startTime:  new Date('2025-06-15T08:00:00.000Z'),
    endTime:    new Date('2025-06-15T09:00:00.000Z'),
  };

  describe('holdSlot', () => {
    // holdSlot enveloppe désormais la création résa + participants dans une transaction.
    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.reservationParticipant.createMany.mockResolvedValue({ count: 1 } as any);
    });

    it('crée une PENDING reservation si le lock Redis est libre et le créneau disponible', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      prismaMock.resource.findUniqueOrThrow.mockResolvedValue({ price: 25, clubId: 'club-demo', club: { timezone: 'Europe/Paris', publicBookingDays: 7, memberBookingDays: 14 } } as any);
      prismaMock.reservation.create.mockResolvedValue({
        id: 'res-1', ...baseParams, status: 'PENDING', totalPrice: 25,
        createdAt: new Date(),
      } as any);

      const result = await service.holdSlot(baseParams);

      expect(redisMock.set).toHaveBeenCalledWith(
        expect.stringContaining('lock:resource:court-1:'),
        'user-1', 'EX', 300, 'NX',
      );
      expect(prismaMock.reservation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING', resourceId: 'court-1' }),
        }),
      );
      expect(result.status).toBe('PENDING');
    });

    it('lève SLOT_ALREADY_HELD si Redis NX retourne null', async () => {
      redisMock.set.mockResolvedValue(null);

      await expect(service.holdSlot(baseParams)).rejects.toThrow('SLOT_ALREADY_HELD');
      expect(prismaMock.reservation.count).not.toHaveBeenCalled();
    });

    it('lève SLOT_NOT_AVAILABLE et supprime le lock si conflit DB', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.resource.findUniqueOrThrow.mockResolvedValue({ price: 25, clubId: 'club-demo', club: { timezone: 'Europe/Paris', publicBookingDays: 7, memberBookingDays: 14 } } as any);
      prismaMock.reservation.count.mockResolvedValue(1);

      await expect(service.holdSlot(baseParams)).rejects.toThrow('SLOT_NOT_AVAILABLE');
      expect(redisMock.del).toHaveBeenCalledWith(
        expect.stringContaining('lock:resource:court-1:'),
      );
    });

    it('lève BOOKING_TOO_FAR si la date dépasse la fenêtre publique', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.resource.findUniqueOrThrow.mockResolvedValue({ price: 25, clubId: 'club-demo', club: { timezone: 'Europe/Paris', publicBookingDays: 7, memberBookingDays: 14 } } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);

      const far = new Date(Date.now() + 60 * 24 * 3600 * 1000); // +60 jours
      await expect(service.holdSlot({
        resourceId: 'court-1', userId: 'user-1', startTime: far, endTime: new Date(far.getTime() + 3_600_000),
      })).rejects.toThrow('BOOKING_TOO_FAR');
      expect(prismaMock.reservation.count).not.toHaveBeenCalled();
    });

    it('lève MEMBERSHIP_BLOCKED si le membre est bloqué par le club', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.resource.findUniqueOrThrow.mockResolvedValue({ price: 25, clubId: 'club-demo', club: { timezone: 'Europe/Paris', publicBookingDays: 7, memberBookingDays: 14 } } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED', isSubscriber: false } as any);

      await expect(service.holdSlot(baseParams)).rejects.toThrow('MEMBERSHIP_BLOCKED');
      expect(prismaMock.reservation.count).not.toHaveBeenCalled();
      expect(prismaMock.clubMembership.create).not.toHaveBeenCalled();
    });

    it('crée une adhésion ACTIVE automatiquement au 1er créneau (membre absent)', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      prismaMock.resource.findUniqueOrThrow.mockResolvedValue({ price: 25, clubId: 'club-demo', club: { timezone: 'Europe/Paris', publicBookingDays: 7, memberBookingDays: 14 } } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
      prismaMock.reservation.create.mockResolvedValue({ id: 'res-1', ...baseParams, status: 'PENDING', totalPrice: 25, createdAt: new Date() } as any);

      await service.holdSlot(baseParams);

      expect(prismaMock.clubMembership.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', clubId: 'club-demo' }) }),
      );
    });

    it('broadcast slot_held après création réussie', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      prismaMock.resource.findUniqueOrThrow.mockResolvedValue({ price: 25, clubId: 'club-demo', club: { timezone: 'Europe/Paris', publicBookingDays: 7, memberBookingDays: 14 } } as any);
      prismaMock.reservation.create.mockResolvedValue({
        id: 'res-1', ...baseParams, status: 'PENDING', totalPrice: 25,
        createdAt: new Date(),
      } as any);

      await service.holdSlot(baseParams);

      expect(sseBroadcast()).toHaveBeenCalledWith(
        'court-1',
        expect.objectContaining({ type: 'slot_held', reservationId: 'res-1' }),
      );
    });

    it('applique le tarif heures creuses au total (créneau hors plage pleine)', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      // 2025-06-15 = dimanche, 10h Paris (08:00Z) ; creuses 8h–18h → ce créneau est creux.
      prismaMock.resource.findUniqueOrThrow.mockResolvedValue({
        price: 25, offPeakPrice: 18, clubId: 'club-demo',
        club: { timezone: 'Europe/Paris', offPeakHours: { 7: [{ start: 8, end: 18 }] }, publicBookingDays: 7, memberBookingDays: 14 },
      } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isSubscriber: false } as any);
      prismaMock.reservation.create.mockResolvedValue({ id: 'res-1', ...baseParams, status: 'PENDING', totalPrice: 18, createdAt: new Date() } as any);

      await service.holdSlot(baseParams);

      const arg = (prismaMock.reservation.create as jest.Mock).mock.calls[0][0];
      expect(Number(arg.data.totalPrice)).toBe(18); // prix du créneau creux
    });

    // --- Multi-joueurs : partenaires, visibilité, partage du montant ---

    const mockDoubleResource = (over: Record<string, unknown> = {}) =>
      prismaMock.resource.findUniqueOrThrow.mockResolvedValue({
        price: 25, clubId: 'club-demo', attributes: { format: 'double' },
        club: { timezone: 'Europe/Paris', publicBookingDays: 7, memberBookingDays: 14 },
        ...over,
      } as any);

    it('crée les lignes participant (organisateur + partenaire), parts égales, visibilité PUBLIC', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      mockDoubleResource();
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isSubscriber: false } as any);
      prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'user-2' }] as any);
      prismaMock.reservation.create.mockResolvedValue({ id: 'res-1', ...baseParams, status: 'PENDING', totalPrice: 25, visibility: 'PUBLIC', createdAt: new Date() } as any);

      await service.holdSlot({ ...baseParams, partnerUserIds: ['user-2'], visibility: 'PUBLIC' });

      expect(prismaMock.reservation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING', visibility: 'PUBLIC' }),
      }));
      const rows = (prismaMock.reservationParticipant.createMany as jest.Mock).mock.calls[0][0].data as any[];
      expect(rows).toHaveLength(2);
      const org = rows.find((r) => r.isOrganizer);
      const partner = rows.find((r) => !r.isOrganizer);
      expect(org.userId).toBe('user-1');
      expect(org.reservationId).toBe('res-1');
      expect(partner.userId).toBe('user-2');
      expect(Number(org.share)).toBe(12.5);
      expect(Number(partner.share)).toBe(12.5);
    });

    it('crée un seul participant organisateur (part = total) quand il n y a pas de partenaire', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      mockDoubleResource();
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isSubscriber: false } as any);
      prismaMock.reservation.create.mockResolvedValue({ id: 'res-1', ...baseParams, status: 'PENDING', totalPrice: 25, createdAt: new Date() } as any);

      await service.holdSlot(baseParams);

      const rows = (prismaMock.reservationParticipant.createMany as jest.Mock).mock.calls[0][0].data as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(expect.objectContaining({ userId: 'user-1', isOrganizer: true, reservationId: 'res-1' }));
      expect(Number(rows[0].share)).toBe(25);
      // sans partenaire on n'interroge pas l'annuaire des membres
      expect(prismaMock.clubMembership.findMany).not.toHaveBeenCalled();
    });

    it('répartit le reste au centime à l organisateur (3 joueurs, 25 € → 8.34 / 8.33 / 8.33)', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      mockDoubleResource();
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isSubscriber: false } as any);
      prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'user-2' }, { userId: 'user-3' }] as any);
      prismaMock.reservation.create.mockResolvedValue({ id: 'res-1', ...baseParams, status: 'PENDING', totalPrice: 25, createdAt: new Date() } as any);

      await service.holdSlot({ ...baseParams, partnerUserIds: ['user-2', 'user-3'] });

      const rows = (prismaMock.reservationParticipant.createMany as jest.Mock).mock.calls[0][0].data as any[];
      const org = rows.find((r) => r.isOrganizer);
      const partners = rows.filter((r) => !r.isOrganizer);
      expect(Number(org.share)).toBe(8.34);
      expect(partners.map((p) => Number(p.share))).toEqual([8.33, 8.33]);
      // somme des parts == total
      expect(rows.reduce((s, r) => s + Number(r.share), 0)).toBeCloseTo(25, 2);
    });

    it('lève TOO_MANY_PLAYERS sur un terrain single (max 2 joueurs) et relâche le lock', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      mockDoubleResource({ attributes: { format: 'single' } });
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isSubscriber: false } as any);

      await expect(service.holdSlot({ ...baseParams, partnerUserIds: ['user-2', 'user-3'] }))
        .rejects.toThrow('TOO_MANY_PLAYERS');
      expect(redisMock.del).toHaveBeenCalled();
      expect(prismaMock.reservation.create).not.toHaveBeenCalled();
    });

    it('lève TOO_MANY_PLAYERS au-delà de 4 joueurs sur un double', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      mockDoubleResource();
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isSubscriber: false } as any);

      await expect(service.holdSlot({ ...baseParams, partnerUserIds: ['user-2', 'user-3', 'user-4', 'user-5'] }))
        .rejects.toThrow('TOO_MANY_PLAYERS');
      expect(prismaMock.reservation.create).not.toHaveBeenCalled();
    });

    it('lève PARTNER_NOT_MEMBER si un partenaire n est pas membre actif du club', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      mockDoubleResource();
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isSubscriber: false } as any);
      prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'user-2' }] as any); // user-3 absent

      await expect(service.holdSlot({ ...baseParams, partnerUserIds: ['user-2', 'user-3'] }))
        .rejects.toThrow('PARTNER_NOT_MEMBER');
      expect(prismaMock.reservation.create).not.toHaveBeenCalled();
    });

    it('lève PARTNER_DUPLICATE si l organisateur ou un doublon figure dans les partenaires', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      mockDoubleResource();
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isSubscriber: false } as any);

      await expect(service.holdSlot({ ...baseParams, partnerUserIds: ['user-1'] }))
        .rejects.toThrow('PARTNER_DUPLICATE');
      await expect(service.holdSlot({ ...baseParams, partnerUserIds: ['user-2', 'user-2'] }))
        .rejects.toThrow('PARTNER_DUPLICATE');
      expect(prismaMock.reservation.create).not.toHaveBeenCalled();
    });
  });

  describe('cancelReservation', () => {
    it('annule une réservation CONFIRMED et broadcast slot_released', async () => {
      const future = new Date(Date.now() + 3_600_000);
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', resourceId: 'court-1', userId: 'user-1', status: 'CONFIRMED',
        startTime: future, endTime: new Date(future.getTime() + 3_600_000),
        resource: { clubId: 'club-demo', club: { cancellationCutoffHours: 0, refundOnCancelWithinCutoff: false } },
      } as any);
      prismaMock.reservation.update.mockResolvedValue({
        id: 'res-1', status: 'CANCELLED', resourceId: 'court-1',
        startTime: future, endTime: new Date(future.getTime() + 3_600_000),
      } as any);
      redisMock.del.mockResolvedValue(1);

      await service.cancelReservation('res-1', 'user-1');

      expect(prismaMock.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
      });
      expect(sseBroadcast()).toHaveBeenCalledWith(
        'court-1',
        expect.objectContaining({ type: 'slot_released' }),
      );
    });

    it('lève CANCELLATION_TOO_LATE après le délai du club', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', resourceId: 'court-1', userId: 'user-1', status: 'CONFIRMED',
        startTime: new Date(Date.now() + 3_600_000),       // début dans 1h
        endTime:   new Date(Date.now() + 7_200_000),
        resource: { clubId: 'club-demo', club: { cancellationCutoffHours: 2, refundOnCancelWithinCutoff: false } }, // clôture 2h avant → déjà fermé
      } as any);

      await expect(service.cancelReservation('res-1', 'user-1')).rejects.toThrow('CANCELLATION_TOO_LATE');
    });

    it('libère un hold PENDING même dans la fenêtre d\'annulation (abandon du checkout)', async () => {
      const soon = new Date(Date.now() + 3_600_000); // début dans 1h
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'hold-1', resourceId: 'court-1', userId: 'user-1', status: 'PENDING',
        startTime: soon, endTime: new Date(soon.getTime() + 3_600_000),
        // cutoff 24h → une résa CONFIRMED serait « trop tard », mais un hold PENDING doit toujours se libérer
        resource: { clubId: 'club-demo', club: { cancellationCutoffHours: 24, refundOnCancelWithinCutoff: false } },
      } as any);
      prismaMock.reservation.update.mockResolvedValue({
        id: 'hold-1', status: 'CANCELLED', resourceId: 'court-1',
        startTime: soon, endTime: new Date(soon.getTime() + 3_600_000),
      } as any);
      redisMock.del.mockResolvedValue(1);

      await service.cancelReservation('hold-1', 'user-1');

      expect(prismaMock.reservation.update).toHaveBeenCalledWith({
        where: { id: 'hold-1' },
        data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
      });
      expect(sseBroadcast()).toHaveBeenCalledWith(
        'court-1',
        expect.objectContaining({ type: 'slot_released' }),
      );
    });

    it('lève UNAUTHORIZED si userId ne correspond pas', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', userId: 'user-other', status: 'CONFIRMED',
      } as any);

      await expect(service.cancelReservation('res-1', 'user-1')).rejects.toThrow('UNAUTHORIZED');
    });

    it('lève ALREADY_CANCELLED si déjà annulée', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', userId: 'user-1', status: 'CANCELLED',
      } as any);

      await expect(service.cancelReservation('res-1', 'user-1')).rejects.toThrow('ALREADY_CANCELLED');
    });

    it('lève RESERVATION_NOT_FOUND si inexistante', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(null);

      await expect(service.cancelReservation('res-99', 'user-1')).rejects.toThrow('RESERVATION_NOT_FOUND');
    });
  });

  describe('adminCancelReservation (isolation multi-tenant)', () => {
    it('annule une résa d un AUTRE user du même club + redis.del + broadcast slot_released', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', resourceId: 'court-1', userId: 'autre-user', status: 'CONFIRMED',
        startTime: baseParams.startTime, endTime: baseParams.endTime,
        resource: { clubId: 'club-demo', club: { cancellationCutoffHours: 0, refundOnCancelWithinCutoff: false } },
      } as any);
      prismaMock.reservation.update.mockResolvedValue({
        id: 'res-1', status: 'CANCELLED', resourceId: 'court-1',
        startTime: baseParams.startTime, endTime: baseParams.endTime,
      } as any);
      redisMock.del.mockResolvedValue(1);

      await service.adminCancelReservation('res-1', 'club-demo');

      expect(prismaMock.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
      });
      expect(redisMock.del).toHaveBeenCalled();
      expect(sseBroadcast()).toHaveBeenCalledWith(
        'court-1', expect.objectContaining({ type: 'slot_released' }),
      );
    });

    it('lève CLUB_MISMATCH si la résa appartient à un autre club', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', resourceId: 'court-1', status: 'CONFIRMED', resource: { clubId: 'autre-club' },
      } as any);

      await expect(service.adminCancelReservation('res-1', 'club-demo')).rejects.toThrow('CLUB_MISMATCH');
      expect(prismaMock.reservation.update).not.toHaveBeenCalled();
    });

    it('lève ALREADY_CANCELLED si déjà annulée', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', status: 'CANCELLED', resource: { clubId: 'club-demo' },
      } as any);

      await expect(service.adminCancelReservation('res-1', 'club-demo')).rejects.toThrow('ALREADY_CANCELLED');
    });

    it('lève RESERVATION_NOT_FOUND si inexistante', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(null);

      await expect(service.adminCancelReservation('res-x', 'club-demo')).rejects.toThrow('RESERVATION_NOT_FOUND');
    });
  });

  describe('adminCancelReservation — lesson notification', () => {
    it('appelle notifyActivityCancelledByClub lesson si la résa porte un cours', async () => {
      redisMock.del.mockResolvedValue(1);
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-lesson',
        userId: 'user-1',
        status: 'CONFIRMED',
        resourceId: 'court-1',
        startTime: new Date('2025-07-01T10:00:00Z'),
        endTime:   new Date('2025-07-01T11:00:00Z'),
        totalPrice: new Prisma.Decimal(0),
        resource: { clubId: 'club-demo', club: { cancellationCutoffHours: 0, refundOnCancelWithinCutoff: false } },
        lesson: { id: 'lesson-42' },
      } as any);
      prismaMock.reservation.update.mockResolvedValue({
        id: 'res-lesson', status: 'CANCELLED', resourceId: 'court-1',
        startTime: new Date('2025-07-01T10:00:00Z'), endTime: new Date('2025-07-01T11:00:00Z'),
        cancelledAt: new Date(),
      } as any);

      await service.adminCancelReservation('res-lesson', 'club-demo');

      expect(mockNotifyActivityCancelled).toHaveBeenCalledWith('lesson', 'lesson-42');
    });

    it('n appelle PAS notifyActivityCancelledByClub si la résa n a pas de cours', async () => {
      redisMock.del.mockResolvedValue(1);
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-no-lesson',
        userId: 'user-1',
        status: 'CONFIRMED',
        resourceId: 'court-1',
        startTime: new Date('2025-07-01T10:00:00Z'),
        endTime:   new Date('2025-07-01T11:00:00Z'),
        totalPrice: new Prisma.Decimal(0),
        resource: { clubId: 'club-demo', club: { cancellationCutoffHours: 0, refundOnCancelWithinCutoff: false } },
        lesson: null,
      } as any);
      prismaMock.reservation.update.mockResolvedValue({
        id: 'res-no-lesson', status: 'CANCELLED', resourceId: 'court-1',
        startTime: new Date('2025-07-01T10:00:00Z'), endTime: new Date('2025-07-01T11:00:00Z'),
        cancelledAt: new Date(),
      } as any);

      await service.adminCancelReservation('res-no-lesson', 'club-demo');

      expect(mockNotifyActivityCancelled).not.toHaveBeenCalled();
    });
  });

  describe('adminCreateReservation', () => {
    const base = {
      clubId: 'club-demo', resourceId: 'court-1', date: '2026-06-15',
      startTime: '18:00', endTime: '19:00', type: 'EVENT' as const,
    };
    const mockResource = () => prismaMock.resource.findUnique.mockResolvedValue(
      { clubId: 'club-demo', club: { timezone: 'Europe/Paris' } } as any);

    it('crée un événement CONFIRMED sans membre (userId null) + broadcast slot_confirmed', async () => {
      mockResource();
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.reservation.count.mockResolvedValue(0 as any);
      prismaMock.reservation.create.mockResolvedValue({ id: 'r-new', resourceId: 'court-1', startTime: new Date(), endTime: new Date() } as any);

      const res = await service.adminCreateReservation({ ...base, title: 'Maintenance' });

      expect(prismaMock.reservation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'CONFIRMED', type: 'EVENT', userId: null, title: 'Maintenance', resourceId: 'court-1' }),
      }));
      expect(sseBroadcast()).toHaveBeenCalledWith('court-1', expect.objectContaining({ type: 'slot_confirmed', reservationId: 'r-new' }));
      expect(res.id).toBe('r-new');
    });

    it('rattache le membre quand memberUserId est fourni et membre du club', async () => {
      mockResource();
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'm1', status: 'ACTIVE' } as any);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.reservation.count.mockResolvedValue(0 as any);
      prismaMock.reservation.create.mockResolvedValue({ id: 'r-new', resourceId: 'court-1', startTime: new Date(), endTime: new Date() } as any);

      await service.adminCreateReservation({ ...base, type: 'COURT', memberUserId: 'user-9' });

      expect(prismaMock.reservation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-9', type: 'COURT' }),
      }));
    });

    it('lève VALIDATION_ERROR si le membre n appartient pas au club', async () => {
      mockResource();
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
      await expect(service.adminCreateReservation({ ...base, memberUserId: 'user-x' })).rejects.toThrow('VALIDATION_ERROR');
    });

    it('lève RESOURCE_NOT_FOUND si la ressource n existe pas', async () => {
      prismaMock.resource.findUnique.mockResolvedValue(null as any);
      await expect(service.adminCreateReservation(base)).rejects.toThrow('RESOURCE_NOT_FOUND');
    });

    it('lève CLUB_MISMATCH si la ressource est d un autre club', async () => {
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'autre', club: { timezone: 'Europe/Paris' } } as any);
      await expect(service.adminCreateReservation(base)).rejects.toThrow('CLUB_MISMATCH');
    });

    it('lève VALIDATION_ERROR si fin <= début', async () => {
      mockResource();
      await expect(service.adminCreateReservation({ ...base, startTime: '19:00', endTime: '18:00' })).rejects.toThrow('VALIDATION_ERROR');
    });

    it('lève SLOT_NOT_AVAILABLE si chevauchement', async () => {
      mockResource();
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.reservation.count.mockResolvedValue(1 as any);
      await expect(service.adminCreateReservation(base)).rejects.toThrow('SLOT_NOT_AVAILABLE');
      expect(prismaMock.reservation.create).not.toHaveBeenCalled();
    });

    it('lève VALIDATION_ERROR si le prix est négatif', async () => {
      mockResource();
      await expect(service.adminCreateReservation({ ...base, price: -5 })).rejects.toThrow('VALIDATION_ERROR');
    });

    it('lève VALIDATION_ERROR si début == fin', async () => {
      mockResource();
      await expect(service.adminCreateReservation({ ...base, startTime: '18:00', endTime: '18:00' })).rejects.toThrow('VALIDATION_ERROR');
    });
  });

  describe('quotas de réservation (holdSlot)', () => {
    const tz = 'Europe/Paris';
    // Créneau à venir : J+2 à 10h locale (durée 1h) — dans la fenêtre de résa.
    const futureSlot = (plusDays = 2, hour = 10, minutes = 60) => {
      const start = DateTime.now().setZone(tz).plus({ days: plusDays }).set({ hour, minute: 0, second: 0, millisecond: 0 });
      return { startTime: start.toJSDate(), endTime: start.plus({ minutes }).toJSDate() };
    };
    const mockClub = (bookingQuotas: unknown, offPeakHours: unknown = null) => {
      prismaMock.resource.findUniqueOrThrow.mockResolvedValue({
        price: 25, offPeakPrice: 18, clubId: 'club-demo',
        club: { timezone: tz, offPeakHours, publicBookingDays: 30, memberBookingDays: 60, bookingQuotas },
      } as any);
    };
    const QUOTAS = { model: 'UPCOMING', subscriber: { peak: 3, offPeak: null }, nonSubscriber: { peak: 1, offPeak: null } };

    beforeEach(() => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.reservationParticipant.createMany.mockResolvedValue({ count: 1 } as any);
      prismaMock.reservation.count.mockResolvedValue(0);
      prismaMock.reservation.create.mockResolvedValue({ id: 'res-q', status: 'PENDING', ...futureSlot(), resourceId: 'court-1', createdAt: new Date() } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isSubscriber: false } as any);
    });

    it('UPCOMING : non-abonné à la limite pleine → QUOTA_PEAK_REACHED et lock relâché', async () => {
      mockClub(QUOTAS);
      prismaMock.reservation.findMany.mockResolvedValue([futureSlot(3)] as any); // 1 résa pleine à venir

      await expect(service.holdSlot({ resourceId: 'court-1', userId: 'user-1', ...futureSlot() }))
        .rejects.toThrow('QUOTA_PEAK_REACHED');
      expect(redisMock.del).toHaveBeenCalled();
      expect(prismaMock.reservation.create).not.toHaveBeenCalled();
    });

    it('UPCOMING : l abonné a son propre jeu de limites (3 pleines)', async () => {
      mockClub(QUOTAS);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isSubscriber: true } as any);
      prismaMock.reservation.findMany.mockResolvedValue([futureSlot(3), futureSlot(4)] as any); // 2 < 3

      await service.holdSlot({ resourceId: 'court-1', userId: 'user-1', ...futureSlot() });
      expect(prismaMock.reservation.create).toHaveBeenCalled();
    });

    it('limite 0 → bloqué sans même compter', async () => {
      mockClub({ ...QUOTAS, nonSubscriber: { peak: 0, offPeak: null } });

      await expect(service.holdSlot({ resourceId: 'court-1', userId: 'user-1', ...futureSlot() }))
        .rejects.toThrow('QUOTA_PEAK_REACHED');
      expect(prismaMock.reservation.findMany).not.toHaveBeenCalled();
    });

    it('limite null = illimité : pas de comptage pour la classe creuse', async () => {
      // Tout le jour du créneau en creuses → classe OFF_PEAK, limite offPeak null.
      const wd = DateTime.now().setZone(tz).plus({ days: 2 }).weekday;
      mockClub(QUOTAS, { [wd]: [{ start: 0, end: 24 }] });

      await service.holdSlot({ resourceId: 'court-1', userId: 'user-1', ...futureSlot() });
      expect(prismaMock.reservation.findMany).not.toHaveBeenCalled();
      expect(prismaMock.reservation.create).toHaveBeenCalled();
    });

    it('seules les résas de la même classe comptent (une creuse ne consomme pas le quota plein)', async () => {
      // Créneau demandé J+2 (tout plein) ; résa existante J+3 entièrement creuse.
      const wd3 = DateTime.now().setZone(tz).plus({ days: 3 }).weekday;
      mockClub({ ...QUOTAS, nonSubscriber: { peak: 1, offPeak: null } }, { [wd3]: [{ start: 0, end: 24 }] });
      prismaMock.reservation.findMany.mockResolvedValue([futureSlot(3)] as any); // creuse → ne compte pas

      await service.holdSlot({ resourceId: 'court-1', userId: 'user-1', ...futureSlot(2) });
      expect(prismaMock.reservation.create).toHaveBeenCalled();
    });

    it('WEEKLY : fenêtre = semaine calendaire lun-dim du créneau, fuseau club', async () => {
      mockClub({ ...QUOTAS, model: 'WEEKLY' });
      prismaMock.reservation.findMany.mockResolvedValue([] as any);
      const slot = futureSlot(2);

      await service.holdSlot({ resourceId: 'court-1', userId: 'user-1', ...slot });

      const arg = (prismaMock.reservation.findMany as jest.Mock).mock.calls[0][0];
      const weekStart = DateTime.fromJSDate(slot.startTime).setZone(tz).startOf('week');
      expect(arg.where.startTime.gte).toEqual(weekStart.toJSDate());
      expect(arg.where.startTime.lt).toEqual(weekStart.plus({ days: 7 }).toJSDate());
      expect(arg.where.type).toBe('COURT');
      expect(arg.where.resource).toEqual({ clubId: 'club-demo' });
    });

    it('pas de quotas configurés → aucun comptage', async () => {
      mockClub(null);
      await service.holdSlot({ resourceId: 'court-1', userId: 'user-1', ...futureSlot() });
      expect(prismaMock.reservation.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getMyQuotaStatus', () => {
    const tz = 'Europe/Paris';
    const futureSlot = (plusDays = 2, hour = 10, minutes = 60) => {
      const start = DateTime.now().setZone(tz).plus({ days: plusDays }).set({ hour, minute: 0, second: 0, millisecond: 0 });
      return { startTime: start.toJSDate(), endTime: start.plus({ minutes }).toJSDate() };
    };
    const mockClub = (bookingQuotas: unknown, offPeakHours: unknown = null) => {
      prismaMock.club.findUnique.mockResolvedValue({
        id: 'club-demo', status: 'ACTIVE', timezone: tz, offPeakHours, bookingQuotas,
      } as any);
    };
    const QUOTAS = { model: 'UPCOMING', subscriber: { peak: 5, offPeak: 3 }, nonSubscriber: { peak: 2, offPeak: 1 } };

    beforeEach(() => {
      prismaMock.clubMembership.findUnique.mockResolvedValue({ isSubscriber: false } as any);
      prismaMock.reservation.findMany.mockResolvedValue([] as any);
    });

    it('UPCOMING : compte les résas à venir par classe, jeu non-abonné', async () => {
      mockClub(QUOTAS);
      prismaMock.reservation.findMany.mockResolvedValue([futureSlot(3), futureSlot(4)] as any); // 2 pleines à venir

      const status = await service.getMyQuotaStatus('demo', 'user-1');

      expect(status).toEqual({ model: 'UPCOMING', peak: { used: 2, limit: 2 }, offPeak: { used: 0, limit: 1 } });
      const arg = (prismaMock.reservation.findMany as jest.Mock).mock.calls[0][0];
      expect(arg.where.startTime).toEqual({ gt: expect.any(Date) });
    });

    it('abonné → prend le jeu de limites abonné', async () => {
      mockClub(QUOTAS);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ isSubscriber: true } as any);

      const status = await service.getMyQuotaStatus('demo', 'user-1');
      expect(status).toEqual({ model: 'UPCOMING', peak: { used: 0, limit: 5 }, offPeak: { used: 0, limit: 3 } });
    });

    it('WEEKLY : fenêtre = semaine calendaire courante (fuseau club)', async () => {
      mockClub({ ...QUOTAS, model: 'WEEKLY' });

      await service.getMyQuotaStatus('demo', 'user-1');

      const arg = (prismaMock.reservation.findMany as jest.Mock).mock.calls[0][0];
      const weekStart = DateTime.now().setZone(tz).startOf('week');
      expect(arg.where.startTime.gte).toEqual(weekStart.toJSDate());
      expect(arg.where.startTime.lt).toEqual(weekStart.plus({ days: 7 }).toJSDate());
    });

    it('pas de membership → traité comme non-abonné (pas d erreur)', async () => {
      mockClub(QUOTAS);
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);

      const status = await service.getMyQuotaStatus('demo', 'user-1');
      expect(status).toEqual({ model: 'UPCOMING', peak: { used: 0, limit: 2 }, offPeak: { used: 0, limit: 1 } });
    });

    it('quotas désactivés → null, aucun comptage', async () => {
      mockClub(null);
      const status = await service.getMyQuotaStatus('demo', 'user-1');
      expect(status).toBeNull();
      expect(prismaMock.reservation.findMany).not.toHaveBeenCalled();
    });

    it('classe illimitée masquée ; les deux illimitées → null', async () => {
      // Non-abonné avec peak limité, offPeak illimité → offPeak masqué.
      mockClub({ model: 'UPCOMING', subscriber: { peak: null, offPeak: null }, nonSubscriber: { peak: 2, offPeak: null } });
      expect(await service.getMyQuotaStatus('demo', 'user-1')).toEqual({ model: 'UPCOMING', peak: { used: 0, limit: 2 }, offPeak: null });

      // Abonné : tout illimité → null global, sans comptage.
      jest.clearAllMocks();
      mockClub({ model: 'UPCOMING', subscriber: { peak: null, offPeak: null }, nonSubscriber: { peak: 2, offPeak: null } });
      prismaMock.clubMembership.findUnique.mockResolvedValue({ isSubscriber: true } as any);
      expect(await service.getMyQuotaStatus('demo', 'user-1')).toBeNull();
      expect(prismaMock.reservation.findMany).not.toHaveBeenCalled();
    });

    it('club introuvable / inactif → CLUB_NOT_FOUND', async () => {
      prismaMock.club.findUnique.mockResolvedValue(null as any);
      await expect(service.getMyQuotaStatus('demo', 'user-1')).rejects.toThrow('CLUB_NOT_FOUND');
    });
  });

  describe('listClubReservations', () => {
    beforeEach(() => {
      prismaMock.club.findUniqueOrThrow.mockResolvedValue({ timezone: 'Europe/Paris', offPeakHours: null } as any);
    });

    it('filtre par club/ressource/statut et calcule le résumé (total dû / encaissé / reste)', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        { id: 'r1', status: 'CONFIRMED', totalPrice: 25,   payments: [{ amount: 25 }] },
        { id: 'r2', status: 'PENDING',   totalPrice: 37.5, payments: [] },
        { id: 'r3', status: 'CANCELLED', totalPrice: 20,   payments: [{ amount: 20 }] },
      ] as any);

      const result = await service.listClubReservations({
        clubId: 'club-demo', resourceId: 'court-1', status: 'CONFIRMED',
      });

      expect(prismaMock.reservation.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          resource: { clubId: 'club-demo' }, resourceId: 'court-1', status: 'CONFIRMED',
        }),
      }));
      // Total dû exclut les annulées : 25 + 37.5 = 62.50
      expect(result.summary.total).toBe('62.50');
      // Encaissé = somme des paiements des non-annulées : 25 (r1)
      expect(result.summary.paid).toBe('25.00');
      expect(result.summary.outstanding).toBe('37.50');
      // paidAmount par réservation
      expect(result.reservations[0].paidAmount).toBe('25.00');
    });

    it('applique le filtre de jour quand date est fournie', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([] as any);

      await service.listClubReservations({ clubId: 'club-demo', date: '2026-06-01' });

      const arg = (prismaMock.reservation.findMany as jest.Mock).mock.calls[0][0];
      expect(arg.where.startTime).toBeDefined();
      expect(arg.where.endTime).toBeDefined();
    });

    it('expose la part payée / le reste dû par participant', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        {
          id: 'r1', status: 'CONFIRMED', type: 'COURT', totalPrice: 24,
          startTime: new Date('2026-06-11T14:00:00Z'), endTime: new Date('2026-06-11T15:00:00Z'),
          resource: { id: 'c1', name: 'T1', price: 24, offPeakPrice: null },
          participants: [
            { id: 'pp1', userId: 'u1', share: '12', user: { firstName: 'A', lastName: 'B' } },
            { id: 'pp2', userId: 'u2', share: '12', user: { firstName: 'C', lastName: 'D' } },
          ],
          payments: [
            { id: 'x1', amount: 12, participantId: 'pp1' },
            { id: 'x2', amount: 5, participantId: 'pp2' },
          ],
        },
      ] as any);

      const result = await service.listClubReservations({ clubId: 'club-demo' });

      const parts = result.reservations[0].participants;
      expect(parts).toHaveLength(2);
      expect(parts.find((p: any) => p.id === 'pp1')).toEqual(expect.objectContaining({ paid: '12.00', outstanding: '0.00' }));
      expect(parts.find((p: any) => p.id === 'pp2')).toEqual(expect.objectContaining({ paid: '5.00', outstanding: '7.00' }));
    });

    it('paidAmount net du remboursement (refundedAmount sur le paiement)', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        {
          id: 'r1', status: 'CONFIRMED', type: 'COURT', totalPrice: 20,
          startTime: new Date('2026-06-11T14:00:00Z'), endTime: new Date('2026-06-11T15:00:00Z'),
          resource: { id: 'c1', name: 'T1', price: 20, offPeakPrice: null },
          participants: [],
          payments: [{ id: 'x1', amount: 20, refundedAmount: 8, participantId: null }],
        },
      ] as any);

      const result = await service.listClubReservations({ clubId: 'club-demo' });

      expect(result.reservations[0].paidAmount).toBe('12.00');
    });

    it('dueAmount : repli tarif terrain pour une COURT sans prix, outstanding clampé par résa', async () => {
      // Jeudi 11/06/2026, creuses 8h-17h → 16h-17h locale est creuse (créneau à 30 €).
      prismaMock.club.findUniqueOrThrow.mockResolvedValue({
        timezone: 'Europe/Paris', offPeakHours: { 4: [{ start: 8, end: 17 }] },
      } as any);
      const res = { id: 'c1', name: 'T1', price: 52, offPeakPrice: 30 };
      prismaMock.reservation.findMany.mockResolvedValue([
        { id: 'r1', status: 'CONFIRMED', type: 'COURT', totalPrice: 0,
          startTime: new Date('2026-06-11T14:00:00Z'), endTime: new Date('2026-06-11T15:00:00Z'),
          resource: res, payments: [] },
        // surpayée (due 25, payé 30) : ne doit pas masquer le dû de r1
        { id: 'r2', status: 'CONFIRMED', type: 'COURT', totalPrice: 25,
          startTime: new Date('2026-06-11T16:00:00Z'), endTime: new Date('2026-06-11T17:00:00Z'),
          resource: res, payments: [{ amount: 30 }] },
        { id: 'r3', status: 'CONFIRMED', type: 'EVENT', totalPrice: 0,
          startTime: new Date('2026-06-11T16:00:00Z'), endTime: new Date('2026-06-11T18:00:00Z'),
          resource: res, payments: [] },
      ] as any);

      const result = await service.listClubReservations({ clubId: 'club-demo' });

      expect(result.reservations[0].dueAmount).toBe('30.00'); // tarif creux 1h
      expect(result.reservations[2].dueAmount).toBe('0.00');  // EVENT libre
      expect(result.summary.total).toBe('55.00');             // 30 + 25 + 0
      expect(result.summary.paid).toBe('30.00');
      expect(result.summary.outstanding).toBe('30.00');       // max(0,30-0) + max(0,25-30) + 0
    });
  });

  describe('confirmReservation avec paymentSource', () => {
    const pendingResa = () => ({
      id: 'res-1', userId: 'user-1', status: 'PENDING', createdAt: new Date(),
      resourceId: 'court-1', startTime: new Date(), endTime: new Date(),
      totalPrice: 25, resource: { clubId: 'club-demo' },
    });

    const mockHappyTx = () => {
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ id: 'res-1', status: 'PENDING', resource_id: 'court-1', start_time: new Date(), end_time: new Date() }])
        .mockResolvedValueOnce([{ count: 0n }]);
    };

    it('consomme le package et crée le paiement quand paymentSource est fourni', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResa() as any);
      mockHappyTx();
      prismaMock.memberPackage.findUnique.mockResolvedValue({ id: 'pkg-1', clubId: 'club-demo', userId: 'user-1', kind: 'ENTRIES' } as any);
      prismaMock.memberPackage.updateMany.mockResolvedValue({ count: 1 } as any);
      prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);
      prismaMock.reservation.update.mockResolvedValue({
        id: 'res-1', resourceId: 'court-1', status: 'CONFIRMED',
        startTime: new Date(), endTime: new Date(),
      } as any);

      await service.confirmReservation('res-1', 'user-1', { paymentSource: { packageId: 'pkg-1' } });

      expect(prismaMock.memberPackage.updateMany).toHaveBeenCalled();
      expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ method: 'PACK_CREDIT', sourcePackageId: 'pkg-1', reservationId: 'res-1' }),
      }));
    });

    it('solde insuffisant → INSUFFICIENT_BALANCE et la résa reste PENDING', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResa() as any);
      mockHappyTx();
      prismaMock.memberPackage.findUnique.mockResolvedValue({ id: 'pkg-1', clubId: 'club-demo', userId: 'user-1', kind: 'ENTRIES' } as any);
      prismaMock.memberPackage.updateMany.mockResolvedValue({ count: 0 } as any);

      await expect(service.confirmReservation('res-1', 'user-1', { paymentSource: { packageId: 'pkg-1' } }))
        .rejects.toThrow('INSUFFICIENT_BALANCE');
      expect(prismaMock.reservation.update).not.toHaveBeenCalled();
    });

    it('refuse le package d’un autre joueur ou d’un autre club', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResa() as any);
      mockHappyTx();
      prismaMock.memberPackage.findUnique.mockResolvedValue({ id: 'pkg-1', clubId: 'autre-club', userId: 'user-1', kind: 'ENTRIES' } as any);

      await expect(service.confirmReservation('res-1', 'user-1', { paymentSource: { packageId: 'pkg-1' } }))
        .rejects.toThrow('PACKAGE_NOT_FOUND');
    });

    it('attribue le paiement par carnet au participant organisateur', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResa() as any);
      mockHappyTx();
      prismaMock.reservationParticipant.findFirst.mockResolvedValue({ id: 'org-p' } as any);
      prismaMock.memberPackage.findUnique.mockResolvedValue({ id: 'pkg-1', clubId: 'club-demo', userId: 'user-1', kind: 'ENTRIES' } as any);
      prismaMock.memberPackage.updateMany.mockResolvedValue({ count: 1 } as any);
      prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);
      prismaMock.reservation.update.mockResolvedValue({ id: 'res-1', resourceId: 'court-1', status: 'CONFIRMED', startTime: new Date(), endTime: new Date() } as any);

      await service.confirmReservation('res-1', 'user-1', { paymentSource: { packageId: 'pkg-1' } });

      expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ participantId: 'org-p', sourcePackageId: 'pkg-1' }),
      }));
    });

    it('notifie les partenaires après la confirmation (best-effort)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResa() as any);
      mockHappyTx();
      prismaMock.reservation.update.mockResolvedValue({ id: 'res-1', resourceId: 'court-1', status: 'CONFIRMED', startTime: new Date(), endTime: new Date() } as any);

      await service.confirmReservation('res-1', 'user-1');

      expect(mockNotifyPartners).toHaveBeenCalledWith('res-1');
    });

    it('un échec de notification ne fait pas échouer la confirmation', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResa() as any);
      mockHappyTx();
      prismaMock.reservation.update.mockResolvedValue({ id: 'res-1', resourceId: 'court-1', status: 'CONFIRMED', startTime: new Date(), endTime: new Date() } as any);
      mockNotifyPartners.mockRejectedValue(new Error('SMTP down'));

      const r = await service.confirmReservation('res-1', 'user-1');
      expect(r.status).toBe('CONFIRMED');
    });
  });

  describe('confirmReservation -- verification Stripe', () => {
    const pendingResaWithStripe = (clubOverrides: Record<string, unknown> = {}) => ({
      id: 'res-1', userId: 'user-1', status: 'PENDING', createdAt: new Date(),
      resourceId: 'court-1', startTime: new Date(), endTime: new Date(),
      totalPrice: 25,
      resource: {
        clubId: 'club-demo',
        club: {
          requireOnlinePayment: false,
          requireCardFingerprint: false,
          stripeAccountId: null,
          ...clubOverrides,
        },
      },
    });

    const mockHappyTx = () => {
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
      (prismaMock.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ id: 'res-1', status: 'PENDING', resource_id: 'court-1', start_time: new Date(), end_time: new Date() }])
        .mockResolvedValueOnce([{ count: 0n }]);
      prismaMock.reservation.update.mockResolvedValue({ id: 'res-1', resourceId: 'court-1', status: 'CONFIRMED', startTime: new Date(), endTime: new Date() } as any);
    };

    it('leve ONLINE_PAYMENT_REQUIRED si requireOnlinePayment=true sans stripePaymentIntentId', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe({ requireOnlinePayment: true, stripeAccountId: 'acct_1' }) as any);

      await expect(service.confirmReservation('res-1', 'user-1', {}))
        .rejects.toThrow('ONLINE_PAYMENT_REQUIRED');
    });

    it('leve PAYMENT_NOT_SUCCEEDED si le PI Stripe n est pas succeeded', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe({ requireOnlinePayment: true, stripeAccountId: 'acct_1' }) as any);
      (stripe.paymentIntents.retrieve as jest.Mock).mockResolvedValue({ status: 'requires_payment_method', payment_method: null });

      await expect(service.confirmReservation('res-1', 'user-1', { stripePaymentIntentId: 'pi_xxx', cgvAccepted: true }))
        .rejects.toThrow('PAYMENT_NOT_SUCCEEDED');
    });

    it('confirme avec PI succeeded et cree un Payment ONLINE', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe({ requireOnlinePayment: true, stripeAccountId: 'acct_1' }) as any);
      (stripe.paymentIntents.retrieve as jest.Mock).mockResolvedValue({ status: 'succeeded', payment_method: 'pm_xxx' });
      prismaMock.clubStripeCustomer.updateMany.mockResolvedValue({ count: 1 } as any);
      mockHappyTx();
      prismaMock.reservationParticipant.findFirst.mockResolvedValue({ id: 'org-p' } as any);
      prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-online-1' } as any);

      await service.confirmReservation('res-1', 'user-1', { stripePaymentIntentId: 'pi_xxx', cgvAccepted: true });

      expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ method: 'ONLINE', stripePaymentIntentId: 'pi_xxx' }),
      }));
    });

    it('le Payment ONLINE enregistre le montant RÉELLEMENT encaissé (la part), pas le total', async () => {
      // totalPrice=25 mais le PI n'a encaissé que la part (1000 cents = 10 €).
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe({ requireOnlinePayment: true, stripeAccountId: 'acct_1' }) as any);
      (stripe.paymentIntents.retrieve as jest.Mock).mockResolvedValue({ status: 'succeeded', payment_method: 'pm_xxx', amount_received: 1000, amount: 2500 });
      prismaMock.clubStripeCustomer.updateMany.mockResolvedValue({ count: 1 } as any);
      mockHappyTx();
      prismaMock.reservationParticipant.findFirst.mockResolvedValue({ id: 'org-p' } as any);
      prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-online-1' } as any);

      await service.confirmReservation('res-1', 'user-1', { stripePaymentIntentId: 'pi_xxx', cgvAccepted: true });

      const arg = (prismaMock.payment.create as jest.Mock).mock.calls[0][0];
      expect(arg.data.method).toBe('ONLINE');
      expect(Number(arg.data.amount)).toBe(10); // 1000 cents encaissés, PAS le total 25
    });

    it('Payment ONLINE : repli sur amount si amount_received absent', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe({ requireOnlinePayment: true, stripeAccountId: 'acct_1' }) as any);
      (stripe.paymentIntents.retrieve as jest.Mock).mockResolvedValue({ status: 'succeeded', payment_method: 'pm_xxx', amount: 2500 });
      prismaMock.clubStripeCustomer.updateMany.mockResolvedValue({ count: 1 } as any);
      mockHappyTx();
      prismaMock.reservationParticipant.findFirst.mockResolvedValue({ id: 'org-p' } as any);
      prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-online-1' } as any);

      await service.confirmReservation('res-1', 'user-1', { stripePaymentIntentId: 'pi_xxx', cgvAccepted: true });

      const arg = (prismaMock.payment.create as jest.Mock).mock.calls[0][0];
      expect(Number(arg.data.amount)).toBe(25);
    });

    it('leve CARD_FINGERPRINT_REQUIRED si requireCardFingerprint=true sans stripeSetupIntentId', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe({ requireCardFingerprint: true, stripeAccountId: 'acct_1' }) as any);

      await expect(service.confirmReservation('res-1', 'user-1', {}))
        .rejects.toThrow('CARD_FINGERPRINT_REQUIRED');
    });

    it('leve CARD_FINGERPRINT_REQUIRED si une carte est sur fichier mais defaultPaymentMethodId=null', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe({ requireCardFingerprint: true, stripeAccountId: 'acct_1' }) as any);
      prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: null } as any);

      await expect(service.confirmReservation('res-1', 'user-1', {}))
        .rejects.toThrow('CARD_FINGERPRINT_REQUIRED');
    });

    it('ne lève PAS CARD_FINGERPRINT_REQUIRED si le club a déjà la carte du joueur (defaultPaymentMethodId)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe({ requireCardFingerprint: true, stripeAccountId: 'acct_1' }) as any);
      prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: 'pm_saved' } as any);
      mockHappyTx();

      await service.confirmReservation('res-1', 'user-1', {});

      const arg = (prismaMock.reservation.update as jest.Mock).mock.calls[0][0];
      expect(arg.data.status).toBe('CONFIRMED');
    });

    it('ne lève PAS CARD_FINGERPRINT_REQUIRED si paiement prépayé par carnet (paymentSource) — consomme le package', async () => {
      // Paiement intégral d'avance par carnet = pas de risque de no-show → empreinte non requise.
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe({ requireCardFingerprint: true, stripeAccountId: 'acct_1' }) as any);
      mockHappyTx();
      prismaMock.reservationParticipant.findFirst.mockResolvedValue({ id: 'org-p' } as any);
      prismaMock.memberPackage.findUnique.mockResolvedValue({ id: 'pkg-1', clubId: 'club-demo', userId: 'user-1', kind: 'ENTRIES' } as any);
      prismaMock.memberPackage.updateMany.mockResolvedValue({ count: 1 } as any);
      prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);

      await service.confirmReservation('res-1', 'user-1', { paymentSource: { packageId: 'pkg-1' } });

      expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ method: 'PACK_CREDIT', sourcePackageId: 'pkg-1' }),
      }));
    });

    it('confirme avec PI + cgvAccepted=true et enregistre cgvAcceptedAt', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe({ requireOnlinePayment: true, stripeAccountId: 'acct_1' }) as any);
      (stripe.paymentIntents.retrieve as jest.Mock).mockResolvedValue({ status: 'succeeded', payment_method: 'pm_xxx' });
      prismaMock.clubStripeCustomer.updateMany.mockResolvedValue({ count: 1 } as any);
      mockHappyTx();
      prismaMock.reservationParticipant.findFirst.mockResolvedValue({ id: 'org-p' } as any);
      prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-online-1' } as any);

      await service.confirmReservation('res-1', 'user-1', { stripePaymentIntentId: 'pi_xxx', cgvAccepted: true });

      expect(prismaMock.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'CONFIRMED', cgvAcceptedAt: expect.any(Date) }),
      }));
    });

    it('leve CGV_NOT_ACCEPTED avec un PI mais cgvAccepted absent (ne confirme pas)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe({ requireOnlinePayment: true, stripeAccountId: 'acct_1' }) as any);

      await expect(service.confirmReservation('res-1', 'user-1', { stripePaymentIntentId: 'pi_xxx' }))
        .rejects.toThrow('CGV_NOT_ACCEPTED');
      expect(prismaMock.reservation.update).not.toHaveBeenCalled();
    });

    it('leve CGV_NOT_ACCEPTED avec un PI mais cgvAccepted=false', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe({ requireOnlinePayment: true, stripeAccountId: 'acct_1' }) as any);

      await expect(service.confirmReservation('res-1', 'user-1', { stripePaymentIntentId: 'pi_xxx', cgvAccepted: false }))
        .rejects.toThrow('CGV_NOT_ACCEPTED');
    });

    it('leve CGV_NOT_ACCEPTED avec un SetupIntent sans cgvAccepted (l empreinte exige aussi les CGV)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe({ requireCardFingerprint: true, stripeAccountId: 'acct_1' }) as any);

      await expect(service.confirmReservation('res-1', 'user-1', { stripeSetupIntentId: 'seti_xxx' }))
        .rejects.toThrow('CGV_NOT_ACCEPTED');
    });

    it('« régler au club » (aucun intent, aucun cgvAccepted) confirme sans cgvAcceptedAt', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pendingResaWithStripe() as any);
      mockHappyTx();

      await service.confirmReservation('res-1', 'user-1', {});

      const arg = (prismaMock.reservation.update as jest.Mock).mock.calls[0][0];
      expect(arg.data.status).toBe('CONFIRMED');
      expect(arg.data.cgvAcceptedAt).toBeUndefined();
    });
  });

  describe('addPayment étendu (caisse)', () => {
    const resa = { id: 'res-1', userId: 'user-1', resource: { clubId: 'club-1' } };
    // Résa avec prix et contexte tarifaire complet (jeudi 11/06/2026, 16h-17h à Paris).
    const pricedResa = (over: Record<string, unknown> = {}) => ({
      id: 'res-1', userId: 'user-1', type: 'COURT', totalPrice: '52',
      startTime: new Date('2026-06-11T14:00:00Z'), endTime: new Date('2026-06-11T15:00:00Z'),
      resource: {
        clubId: 'club-1', price: '52', offPeakPrice: null,
        club: { offPeakHours: null, timezone: 'Europe/Paris' },
      },
      ...over,
    });
    const paidSoFar = (amount: number) =>
      prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amount } } as any);

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
      paidSoFar(0);
      prismaMock.refund.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(0) } } as any);
      prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
    });

    it('VOUCHER : référence optionnelle, pose voucherStatus PENDING_REIMBURSEMENT', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-0' } as any);

      await service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 25, method: 'VOUCHER' });
      expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ method: 'VOUCHER', voucherRef: null, voucherStatus: 'PENDING_REIMBURSEMENT' }),
      }));

      prismaMock.payment.create.mockClear();
      await service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 25, method: 'VOUCHER', voucherRef: 'ANCV-42', voucherIssuer: 'ANCV' });
      expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ method: 'VOUCHER', voucherRef: 'ANCV-42', voucherStatus: 'PENDING_REIMBURSEMENT', clubId: 'club-1' }),
      }));
    });

    it('MEMBER : enregistre un encaissement couvert par l’abonnement', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pricedResa() as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-m' } as any);

      await service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 52, method: 'MEMBER' });
      expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ method: 'MEMBER' }),
      }));
    });

    it('refuse un encaissement qui dépasse le prix de la résa', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pricedResa() as any);
      paidSoFar(39);

      await expect(service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 26, method: 'CASH' }))
        .rejects.toThrow('PAYMENT_EXCEEDS_DUE');
      expect(prismaMock.payment.create).not.toHaveBeenCalled();
    });

    it('accepte un encaissement qui complète exactement le prix', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pricedResa() as any);
      paidSoFar(39);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-3' } as any);

      await service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 13, method: 'CASH' });
      expect(prismaMock.payment.create).toHaveBeenCalled();
    });

    it('résa COURT sans prix : plafond = tarif du terrain, heures creuses comprises', async () => {
      // Jeudi (weekday 4), 16h locale : heures creuses 8h–17h → créneau creux à 30 €.
      prismaMock.reservation.findUnique.mockResolvedValue(pricedResa({
        totalPrice: '0',
        resource: {
          clubId: 'club-1', price: '52', offPeakPrice: '30',
          club: { offPeakHours: { 4: [{ start: 8, end: 17 }] }, timezone: 'Europe/Paris' },
        },
      }) as any);

      await expect(service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 40, method: 'CASH' }))
        .rejects.toThrow('PAYMENT_EXCEEDS_DUE');

      prismaMock.payment.create.mockResolvedValue({ id: 'pay-4' } as any);
      await service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 30, method: 'CASH' });
      expect(prismaMock.payment.create).toHaveBeenCalled();
    });

    it('EVENT sans prix : pas de plafond', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pricedResa({ type: 'EVENT', totalPrice: '0' }) as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-5' } as any);

      await service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 999, method: 'CASH' });
      expect(prismaMock.payment.create).toHaveBeenCalled();
    });

    it('PACK_CREDIT : consomme 1 entrée et crée le paiement dans une transaction', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa as any);
      prismaMock.memberPackage.findUnique.mockResolvedValue({ id: 'pkg-1', clubId: 'club-1', userId: 'user-1', kind: 'ENTRIES' } as any);
      prismaMock.memberPackage.updateMany.mockResolvedValue({ count: 1 } as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-2' } as any);

      await service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 25, method: 'PACK_CREDIT', sourcePackageId: 'pkg-1' });

      expect(prismaMock.memberPackage.updateMany).toHaveBeenCalled();
      expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ method: 'PACK_CREDIT', sourcePackageId: 'pkg-1' }),
      }));
    });

    it('WALLET : solde insuffisant → INSUFFICIENT_BALANCE, aucun paiement créé', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa as any);
      prismaMock.memberPackage.findUnique.mockResolvedValue({ id: 'pkg-2', clubId: 'club-1', userId: 'user-1', kind: 'WALLET' } as any);
      prismaMock.memberPackage.updateMany.mockResolvedValue({ count: 0 } as any);

      await expect(service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 25, method: 'WALLET', sourcePackageId: 'pkg-2' }))
        .rejects.toThrow('INSUFFICIENT_BALANCE');
      expect(prismaMock.payment.create).not.toHaveBeenCalled();
    });

    it('refuse un package d’un autre membre que celui de la résa', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa as any);
      prismaMock.memberPackage.findUnique.mockResolvedValue({ id: 'pkg-1', clubId: 'club-1', userId: 'autre-user', kind: 'ENTRIES' } as any);
      await expect(service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 25, method: 'PACK_CREDIT', sourcePackageId: 'pkg-1' }))
        .rejects.toThrow('PACKAGE_NOT_FOUND');
    });

    it('refuse PACK_CREDIT sur un porte-monnaie (kind mismatch)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa as any);
      prismaMock.memberPackage.findUnique.mockResolvedValue({ id: 'pkg-2', clubId: 'club-1', userId: 'user-1', kind: 'WALLET' } as any);
      await expect(service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 25, method: 'PACK_CREDIT', sourcePackageId: 'pkg-2' }))
        .rejects.toThrow('VALIDATION_ERROR');
    });

    it('persiste createdByUserId quand fourni', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'r1', totalPrice: new Prisma.Decimal(20), type: 'COURT',
        startTime: new Date(), endTime: new Date(),
        resource: { clubId: 'club-1', price: new Prisma.Decimal(20), offPeakPrice: null, club: { offPeakHours: null, timezone: 'Europe/Paris' } },
      } as any);
      prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(0) } } as any);
      prismaMock.refund.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(0) } } as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);

      await service.addPayment({ reservationId: 'r1', clubId: 'club-1', amount: 10, method: 'CASH', createdByUserId: 'staff-9' });
      expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ createdByUserId: 'staff-9' }),
      }));
    });

    it('pose receiptNo sur le paiement (non-prépayé)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(pricedResa() as any);
      prismaMock.clubCounter.upsert.mockResolvedValue({ value: 3 } as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-rno' } as any);

      await service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 10, method: 'CASH' });

      expect(prismaMock.clubCounter.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { clubId_kind: { clubId: 'club-1', kind: 'RECEIPT' } },
      }));
      expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ receiptNo: 3 }),
      }));
    });

    it('plafond NET : un remboursement rouvre du dû encaissable', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'r1', totalPrice: new Prisma.Decimal(20), type: 'COURT',
        startTime: new Date(), endTime: new Date(),
        resource: { clubId: 'club-1', price: new Prisma.Decimal(20), offPeakPrice: null, club: { offPeakHours: null, timezone: 'Europe/Paris' } },
      } as any);
      prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(20) } } as any);
      prismaMock.refund.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(8) } } as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-2' } as any);

      await expect(service.addPayment({ reservationId: 'r1', clubId: 'club-1', amount: 8, method: 'CASH' })).resolves.toBeDefined();
      await expect(service.addPayment({ reservationId: 'r1', clubId: 'club-1', amount: 9, method: 'CASH' })).rejects.toThrow('PAYMENT_EXCEEDS_DUE');
    });
  });

  describe('addPayment par participant (Phase 3)', () => {
    const resa = { id: 'res-1', userId: 'user-1', resource: { clubId: 'club-1' } };
    const participant = (over: Record<string, unknown> = {}) =>
      prismaMock.reservationParticipant.findUnique.mockResolvedValue({ id: 'pp1', reservationId: 'res-1', userId: 'user-2', share: '12', ...over } as any);
    const paidByParticipant = (amount: number) =>
      prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amount } } as any);

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
      prismaMock.reservation.findUnique.mockResolvedValue(resa as any);
      paidByParticipant(0);
      prismaMock.refund.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(0) } } as any);
      prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
    });

    it('attribue le paiement au participant et plafonne à SA part', async () => {
      participant();
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-pp' } as any);

      await service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 12, method: 'CASH', participantId: 'pp1' });

      expect(prismaMock.payment.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { participantId: 'pp1' } }));
      expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ participantId: 'pp1', method: 'CASH' }),
      }));
    });

    it('refuse un encaissement qui dépasse la part du participant', async () => {
      participant({ share: '12' });
      paidByParticipant(10);
      await expect(service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 5, method: 'CASH', participantId: 'pp1' }))
        .rejects.toThrow('PAYMENT_EXCEEDS_DUE');
      expect(prismaMock.payment.create).not.toHaveBeenCalled();
    });

    it('lève PARTICIPANT_NOT_FOUND si le participant est d une autre résa', async () => {
      participant({ reservationId: 'autre-res' });
      await expect(service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 12, method: 'CASH', participantId: 'pp1' }))
        .rejects.toThrow('PARTICIPANT_NOT_FOUND');
    });

    it('carnet : le package doit appartenir à l utilisateur du participant', async () => {
      participant({ userId: 'user-2' });
      prismaMock.memberPackage.findUnique.mockResolvedValue({ id: 'pkg-1', clubId: 'club-1', userId: 'autre', kind: 'ENTRIES' } as any);
      await expect(service.addPayment({ reservationId: 'res-1', clubId: 'club-1', amount: 12, method: 'PACK_CREDIT', sourcePackageId: 'pkg-1', participantId: 'pp1' }))
        .rejects.toThrow('PACKAGE_NOT_FOUND');
    });
  });

  describe('assignReservationMember', () => {
    const resa = { id: 'res-1', resource: { clubId: 'club-1' } };

    it('affecte un membre actif à la résa et renvoie la forme enrichie', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({ ...resa, participants: [] } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1', status: 'ACTIVE' } as any);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.reservation.update.mockResolvedValue({ id: 'res-1', userId: 'user-1' } as any);
      const loadSpy = jest.spyOn(service as any, 'loadClubReservation')
        .mockResolvedValue({ id: 'res-1', resource: { name: 'Padel int 1' } } as any);

      const result = await service.assignReservationMember('res-1', 'club-1', 'user-1');

      expect(prismaMock.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'res-1' }, data: { userId: 'user-1' },
      }));
      // Régression : renvoyer la ligne brute (sans `resource`) cassait le rendu caisse/planning.
      expect(loadSpy).toHaveBeenCalledWith('res-1', 'club-1');
      expect(result).toEqual({ id: 'res-1', resource: { name: 'Padel int 1' } });
    });

    it('refuse un joueur non membre (MEMBER_NOT_FOUND)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
      await expect(service.assignReservationMember('res-1', 'club-1', 'user-1')).rejects.toThrow('MEMBER_NOT_FOUND');
    });

    it('refuse un membre bloqué (MEMBER_NOT_FOUND)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1', status: 'BLOCKED' } as any);
      await expect(service.assignReservationMember('res-1', 'club-1', 'user-1')).rejects.toThrow('MEMBER_NOT_FOUND');
    });

    it("refuse une résa d'un autre club (CLUB_MISMATCH)", async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({ id: 'res-1', resource: { clubId: 'autre' } } as any);
      await expect(service.assignReservationMember('res-1', 'club-1', 'user-1')).rejects.toThrow('CLUB_MISMATCH');
    });

    it('refuse une résa inconnue (RESERVATION_NOT_FOUND)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(null as any);
      await expect(service.assignReservationMember('res-1', 'club-1', 'user-1')).rejects.toThrow('RESERVATION_NOT_FOUND');
    });
  });

  describe('addReservationParticipant', () => {
    const resa = (over: any = {}) => ({
      id: 'res-1', userId: 'user-1', type: 'COURT', totalPrice: 25,
      startTime: new Date('2025-06-15T08:00:00.000Z'), endTime: new Date('2025-06-15T09:00:00.000Z'),
      resource: { clubId: 'club-1', attributes: { format: 'double' }, price: 25, offPeakPrice: null, club: { offPeakHours: null, timezone: 'Europe/Paris' } },
      ...over,
    });

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1', status: 'ACTIVE' } as any);
      jest.spyOn(service as any, 'loadClubReservation').mockResolvedValue({ id: 'res-1' } as any);
    });

    it("matérialise l'organisateur quand aucune ligne participant", async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([] as any);

      await service.addReservationParticipant('res-1', 'club-1', 'user-2');

      expect(prismaMock.reservationParticipant.createMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: 'user-1', isOrganizer: true }),
          expect.objectContaining({ userId: 'user-2', isOrganizer: false }),
        ]),
      }));
    });

    it('ajoute un 2e partenaire et recalcule les parts (25,00 / 3 → 8,34 / 8,33 / 8,33)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);

      await service.addReservationParticipant('res-1', 'club-1', 'user-3');

      const u1 = prismaMock.reservationParticipant.update.mock.calls.map((c: any) => c[0]).find((u: any) => u.where.id === 'p1');
      expect(Number(u1.data.share)).toBeCloseTo(8.34, 2);
      const created = prismaMock.reservationParticipant.create.mock.calls[0][0] as any;
      expect(created.data.userId).toBe('user-3');
      expect(Number(created.data.share)).toBeCloseTo(8.33, 2);
    });

    it('no-op si le membre est déjà participant', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);

      await service.addReservationParticipant('res-1', 'club-1', 'user-2');

      expect(prismaMock.reservationParticipant.create).not.toHaveBeenCalled();
      expect(prismaMock.reservationParticipant.createMany).not.toHaveBeenCalled();
    });

    it('refuse au-delà de la capacité (TOO_MANY_PLAYERS, single)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa({
        resource: { clubId: 'club-1', attributes: { format: 'single' }, price: 25, offPeakPrice: null, club: { offPeakHours: null, timezone: 'Europe/Paris' } },
      }) as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);
      await expect(service.addReservationParticipant('res-1', 'club-1', 'user-3')).rejects.toThrow('TOO_MANY_PLAYERS');
    });

    it('refuse un membre bloqué (MEMBER_NOT_FOUND)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1', status: 'BLOCKED' } as any);
      await expect(service.addReservationParticipant('res-1', 'club-1', 'user-3')).rejects.toThrow('MEMBER_NOT_FOUND');
    });

    it('refuse sans membre principal et sans participants (RESERVATION_HAS_NO_MEMBER)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa({ userId: null }) as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([] as any);
      await expect(service.addReservationParticipant('res-1', 'club-1', 'user-2')).rejects.toThrow('RESERVATION_HAS_NO_MEMBER');
    });

    it("refuse une résa d'un autre club (CLUB_MISMATCH)", async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa({ resource: { clubId: 'autre' } }) as any);
      await expect(service.addReservationParticipant('res-1', 'club-1', 'user-2')).rejects.toThrow('CLUB_MISMATCH');
    });
  });

  describe('removeReservationParticipant', () => {
    const resa = (over: any = {}) => ({
      id: 'res-1', userId: 'user-1', type: 'COURT', totalPrice: 25,
      startTime: new Date('2025-06-15T08:00:00.000Z'), endTime: new Date('2025-06-15T09:00:00.000Z'),
      resource: { clubId: 'club-1', price: 25, offPeakPrice: null, club: { offPeakHours: null, timezone: 'Europe/Paris' } },
      ...over,
    });

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      jest.spyOn(service as any, 'loadClubReservation').mockResolvedValue({ id: 'res-1' } as any);
    });

    it('retire un partenaire et recalcule les survivants (25,00 / 2 = 12,50)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
        { id: 'p3', userId: 'user-3', isOrganizer: false },
      ] as any);

      await service.removeReservationParticipant('res-1', 'club-1', 'p3');

      expect(prismaMock.reservationParticipant.delete).toHaveBeenCalledWith({ where: { id: 'p3' } });
      const u1 = prismaMock.reservationParticipant.update.mock.calls.map((c: any) => c[0]).find((u: any) => u.where.id === 'p1');
      expect(Number(u1.data.share)).toBeCloseTo(12.5, 2);
    });

    it('conserve les paiements du joueur retiré (aucun payment.delete)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);

      await service.removeReservationParticipant('res-1', 'club-1', 'p2');

      expect(prismaMock.reservationParticipant.delete).toHaveBeenCalledWith({ where: { id: 'p2' } });
      expect(prismaMock.payment.delete).not.toHaveBeenCalled();
    });

    it("refuse de retirer l'organisateur s'il reste d'autres joueurs (CANNOT_REMOVE_ORGANIZER)", async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);
      await expect(service.removeReservationParticipant('res-1', 'club-1', 'p1')).rejects.toThrow('CANNOT_REMOVE_ORGANIZER');
    });

    it('descendre à 1 participant : il devient organisateur avec le dû complet', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);

      await service.removeReservationParticipant('res-1', 'club-1', 'p2');

      const u1 = prismaMock.reservationParticipant.update.mock.calls.map((c: any) => c[0]).find((u: any) => u.where.id === 'p1');
      expect(u1.data.isOrganizer).toBe(true);
      expect(Number(u1.data.share)).toBeCloseTo(25, 2);
    });

    it('refuse un participant inconnu (PARTICIPANT_NOT_FOUND)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'user-1', isOrganizer: true }] as any);
      await expect(service.removeReservationParticipant('res-1', 'club-1', 'pX')).rejects.toThrow('PARTICIPANT_NOT_FOUND');
    });

    it("refuse une résa d'un autre club (CLUB_MISMATCH)", async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa({ resource: { clubId: 'autre' } }) as any);
      await expect(service.removeReservationParticipant('res-1', 'club-1', 'p1')).rejects.toThrow('CLUB_MISMATCH');
    });
  });

  describe('changeReservationParticipant', () => {
    const resa = (over: any = {}) => ({
      id: 'res-1', userId: 'user-1', type: 'COURT', totalPrice: 25,
      startTime: new Date('2025-06-15T08:00:00.000Z'), endTime: new Date('2025-06-15T09:00:00.000Z'),
      resource: { clubId: 'club-1', attributes: { format: 'double' }, price: 25, offPeakPrice: null, club: { offPeakHours: null, timezone: 'Europe/Paris' } },
      ...over,
    });

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1', status: 'ACTIVE' } as any);
      jest.spyOn(service as any, 'loadClubReservation').mockResolvedValue({ id: 'res-1' } as any);
    });

    it('remplace un partenaire : supprime l\'ancien, crée le nouveau, recalcule les parts (25/2 = 12,50)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);

      await service.changeReservationParticipant('res-1', 'club-1', 'p2', 'user-3');

      expect(prismaMock.reservationParticipant.delete).toHaveBeenCalledWith({ where: { id: 'p2' } });
      const created = prismaMock.reservationParticipant.create.mock.calls[0][0] as any;
      expect(created.data.userId).toBe('user-3');
      expect(Number(created.data.share)).toBeCloseTo(12.5, 2);
      const u1 = prismaMock.reservationParticipant.update.mock.calls.map((c: any) => c[0]).find((u: any) => u.where.id === 'p1');
      expect(Number(u1.data.share)).toBeCloseTo(12.5, 2);
    });

    it("ne supprime pas les paiements de l'ancien joueur (participantId → null via SetNull)", async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);

      await service.changeReservationParticipant('res-1', 'club-1', 'p2', 'user-3');

      expect(prismaMock.payment.delete).not.toHaveBeenCalled();
    });

    it("refuse de remplacer l'organisateur (CANNOT_REMOVE_ORGANIZER)", async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);
      await expect(service.changeReservationParticipant('res-1', 'club-1', 'p1', 'user-3')).rejects.toThrow('CANNOT_REMOVE_ORGANIZER');
    });

    it('refuse un nouveau membre déjà présent (PARTNER_DUPLICATE)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
        { id: 'p3', userId: 'user-3', isOrganizer: false },
      ] as any);
      await expect(service.changeReservationParticipant('res-1', 'club-1', 'p2', 'user-3')).rejects.toThrow('PARTNER_DUPLICATE');
    });

    it('no-op si le nouveau joueur est déjà celui de la ligne', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);

      await service.changeReservationParticipant('res-1', 'club-1', 'p2', 'user-2');

      expect(prismaMock.reservationParticipant.delete).not.toHaveBeenCalled();
      expect(prismaMock.reservationParticipant.create).not.toHaveBeenCalled();
    });

    it('refuse un membre bloqué (MEMBER_NOT_FOUND)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1', status: 'BLOCKED' } as any);
      await expect(service.changeReservationParticipant('res-1', 'club-1', 'p2', 'user-3')).rejects.toThrow('MEMBER_NOT_FOUND');
    });

    it('refuse un participant inconnu (PARTICIPANT_NOT_FOUND)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'user-1', isOrganizer: true }] as any);
      await expect(service.changeReservationParticipant('res-1', 'club-1', 'pX', 'user-3')).rejects.toThrow('PARTICIPANT_NOT_FOUND');
    });

    it("refuse une résa d'un autre club (CLUB_MISMATCH)", async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa({ resource: { clubId: 'autre' } }) as any);
      await expect(service.changeReservationParticipant('res-1', 'club-1', 'p2', 'user-3')).rejects.toThrow('CLUB_MISMATCH');
    });
  });

  describe('getOwnReservationPlayers', () => {
    it('renvoie capacité + joueurs (avec avatarUrl) pour le propriétaire', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', userId: 'user-1',
        resource: { attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
        participants: [
          { id: 'p1', userId: 'user-1', isOrganizer: true,  share: 25, team: null, user: { firstName: 'Eric', lastName: 'N', avatarUrl: '/uploads/avatars/eric.png' } },
          { id: 'p2', userId: 'user-2', isOrganizer: false, share: 0,  team: null, user: { firstName: 'Sam',  lastName: 'P', avatarUrl: null } },
        ],
      } as any);

      const out = await service.getOwnReservationPlayers('res-1', 'user-1');

      expect(out.capacity).toBe(4);
      expect(out.participants).toHaveLength(2);
      expect(out.participants[0]).toMatchObject({ id: 'p1', isOrganizer: true, firstName: 'Eric', share: '25.00', avatarUrl: '/uploads/avatars/eric.png', team: 1 });
      expect(out.participants[1].avatarUrl).toBeNull();
    });

    it('expose la place G/D concrète (slot explicite honoré, les autres comblés)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', userId: 'user-1',
        resource: { attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
        participants: [
          { id: 'p1', userId: 'user-1', isOrganizer: true,  share: 25, team: 1, slot: 1,    user: { firstName: 'Eric', lastName: 'N', avatarUrl: null } },
          { id: 'p2', userId: 'user-2', isOrganizer: false, share: 0,  team: 1, slot: null, user: { firstName: 'Sam',  lastName: 'P', avatarUrl: null } },
        ],
      } as any);

      const out = await service.getOwnReservationPlayers('res-1', 'user-1');

      expect(out.participants[0]).toMatchObject({ id: 'p1', team: 1, slot: 1 });  // D explicite
      expect(out.participants[1]).toMatchObject({ id: 'p2', team: 1, slot: 0 }); // comble G
    });

    it('lève UNAUTHORIZED si ce n est pas le propriétaire', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', userId: 'autre', resource: { attributes: {}, clubSport: { sport: { key: 'padel' } } }, participants: [],
      } as any);
      await expect(service.getOwnReservationPlayers('res-1', 'user-1')).rejects.toThrow('UNAUTHORIZED');
    });

    it('lève RESERVATION_NOT_FOUND si inexistante', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(null);
      await expect(service.getOwnReservationPlayers('res-x', 'user-1')).rejects.toThrow('RESERVATION_NOT_FOUND');
    });
  });

  describe('listUserReservations', () => {
    const baseReservation = () => ({
      id: 'res-1', startTime: new Date('2026-06-16T15:00:00Z'), endTime: new Date('2026-06-16T16:30:00Z'),
      status: 'CONFIRMED', totalPrice: 25, userId: 'user-1', resourceId: 'court-1', type: 'COURT',
      resource: {
        id: 'court-1', name: 'Terrain 2', attributes: { format: 'double' },
        clubSport: { sport: { key: 'padel', name: 'Padel' } },
        club: { name: 'Bordeaux Pala', slug: 'bordeaux-pala', timezone: 'Europe/Paris', playerChangeCutoffHours: null, cancellationCutoffHours: null },
      },
      participants: [
        { id: 'p1', userId: 'user-1', isOrganizer: true,  team: null, user: { firstName: 'Eric', lastName: 'N', avatarUrl: '/uploads/avatars/eric.png' } },
        { id: 'p2', userId: 'user-2', isOrganizer: false, team: null, user: { firstName: 'Sam',  lastName: 'P', avatarUrl: null } },
      ],
    });

    it('mappe participants (avec avatarUrl) + capacity et n expose pas attributes', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([baseReservation()] as any);
      prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }] as any);
      prismaMock.playerRating.findMany.mockResolvedValue([] as any);

      const out = await service.listUserReservations('user-1');

      expect(out).toHaveLength(1);
      expect(out[0].capacity).toBe(4);
      // 2 participants sur 4 places (double) → tous assignés à l'équipe 1 (half=2, aucun dépassement),
      // places G/D comblées dans l'ordre d'arrivée (slot 0 puis 1).
      expect(out[0].participants).toEqual([
        { id: 'p1', userId: 'user-1', isOrganizer: true,  firstName: 'Eric', lastName: 'N', avatarUrl: '/uploads/avatars/eric.png', level: null, team: 1, slot: 0 },
        { id: 'p2', userId: 'user-2', isOrganizer: false, firstName: 'Sam',  lastName: 'P', avatarUrl: null, level: null, team: 1, slot: 1 },
      ]);
      expect(out[0].resource.name).toBe('Terrain 2');
      expect((out[0].resource as any).attributes).toBeUndefined();
      expect((out[0].resource as any).clubSport).toBeUndefined();
      expect((out[0].resource as any).sport).toEqual({ key: 'padel', name: 'Padel' });
    });

    it('expose visibility et la fourchette de niveau (partie ouverte)', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        { ...baseReservation(), visibility: 'PUBLIC', targetLevelMin: 2, targetLevelMax: 5 },
      ] as any);
      prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }] as any);
      prismaMock.playerRating.findMany.mockResolvedValue([] as any);

      const out = await service.listUserReservations('user-1');

      expect((out[0] as any).visibility).toBe('PUBLIC');
      expect((out[0] as any).targetLevelMin).toBe(2);
      expect((out[0] as any).targetLevelMax).toBe(5);
    });

    it('ajoute level sur les participants qui ont un rating', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([baseReservation()] as any);
      prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }] as any);
      prismaMock.playerRating.findMany.mockResolvedValue([
        { userId: 'user-1', sportId: 'sport-padel', displayLevel: 4, rd: 80, isProvisional: false },
      ] as any);

      const out = await service.listUserReservations('user-1');

      expect(out[0].participants[0].level).toEqual({ level: 4, tier: 'Intermédiaire', isProvisional: false, reliability: 93 });
      expect(out[0].participants[1].level).toBeNull();
    });

    it('retourne level null pour tous les participants quand aucun rating', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([baseReservation()] as any);
      prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }] as any);
      prismaMock.playerRating.findMany.mockResolvedValue([] as any);

      const out = await service.listUserReservations('user-1');

      expect(out[0].participants.every((p: any) => p.level === null)).toBe(true);
    });

    it('attribue le niveau au sport de CHAQUE réservation (multi-sport)', async () => {
      const resaPadel = {
        id: 'res-padel', startTime: new Date('2026-06-16T15:00:00Z'), endTime: new Date('2026-06-16T16:30:00Z'),
        status: 'CONFIRMED', totalPrice: 25, userId: 'user-1', resourceId: 'court-padel', type: 'COURT',
        resource: {
          id: 'court-padel', name: 'Court Padel', attributes: { format: 'double' },
          clubSport: { sport: { key: 'padel' } },
          club: { name: 'Club A', slug: 'club-a', timezone: 'Europe/Paris', playerChangeCutoffHours: null, cancellationCutoffHours: null },
        },
        participants: [
          { id: 'pp1', userId: 'user-1', isOrganizer: true, team: null, user: { firstName: 'Eric', lastName: 'N', avatarUrl: null } },
        ],
      };
      const resaTennis = {
        id: 'res-tennis', startTime: new Date('2026-06-17T10:00:00Z'), endTime: new Date('2026-06-17T11:00:00Z'),
        status: 'CONFIRMED', totalPrice: 20, userId: 'user-1', resourceId: 'court-tennis', type: 'COURT',
        resource: {
          id: 'court-tennis', name: 'Court Tennis', attributes: { format: 'single' },
          clubSport: { sport: { key: 'tennis' } },
          club: { name: 'Club B', slug: 'club-b', timezone: 'Europe/Paris', playerChangeCutoffHours: null, cancellationCutoffHours: null },
        },
        participants: [
          { id: 'pt1', userId: 'user-1', isOrganizer: true, team: null, user: { firstName: 'Eric', lastName: 'N', avatarUrl: null } },
        ],
      };

      prismaMock.reservation.findMany.mockResolvedValue([resaPadel, resaTennis] as any);
      prismaMock.sport.findMany.mockResolvedValue([
        { id: 'sport-padel',  key: 'padel' },
        { id: 'sport-tennis', key: 'tennis' },
      ] as any);
      prismaMock.playerRating.findMany.mockResolvedValue([
        { userId: 'user-1', sportId: 'sport-padel',  displayLevel: 5, rd: 80,  isProvisional: false },
        { userId: 'user-1', sportId: 'sport-tennis', displayLevel: 3, rd: 350, isProvisional: true  },
      ] as any);

      const out = await service.listUserReservations('user-1');

      expect(out).toHaveLength(2);
      // Résa padel → niveau padel (5 = Confirmé)
      expect(out[0].participants[0].level).toEqual({ level: 5, tier: 'Confirmé', isProvisional: false, reliability: 93 });
      // Résa tennis → niveau tennis (3 = Élémentaire)
      expect(out[1].participants[0].level).toEqual({ level: 3, tier: 'Élémentaire', isProvisional: true, reliability: 50 });
    });

    it('ne plante pas quand une réservation n a pas de participants', async () => {
      const resaVide = {
        id: 'res-vide', startTime: new Date('2026-06-18T09:00:00Z'), endTime: new Date('2026-06-18T10:00:00Z'),
        status: 'CONFIRMED', totalPrice: 15, userId: 'user-1', resourceId: 'court-1', type: 'COURT',
        resource: {
          id: 'court-1', name: 'Court Solo', attributes: null,
          clubSport: { sport: { key: 'padel' } },
          club: { name: 'Club A', slug: 'club-a', timezone: 'Europe/Paris', playerChangeCutoffHours: null, cancellationCutoffHours: null },
        },
        participants: [],
      };
      prismaMock.reservation.findMany.mockResolvedValue([resaVide] as any);
      prismaMock.sport.findMany.mockResolvedValue([] as any);
      prismaMock.playerRating.findMany.mockResolvedValue([] as any);

      const out = await service.listUserReservations('user-1');

      expect(out).toHaveLength(1);
      expect(out[0].participants).toEqual([]);
    });

    it('attribue une équipe (1/2) aux participants d\'une résa padel, null hors padel', async () => {
      const resaPadel = {
        id: 'res-padel', startTime: new Date('2026-06-20T10:00:00Z'), endTime: new Date('2026-06-20T11:00:00Z'),
        status: 'CONFIRMED', totalPrice: 25, userId: 'user-1', resourceId: 'court-padel', type: 'COURT',
        resource: {
          id: 'court-padel', name: 'Court Padel', attributes: { format: 'double' },
          clubSport: { sport: { key: 'padel', name: 'Padel' } },
          club: { name: 'Club Padel', slug: 'club-padel', timezone: 'Europe/Paris', playerChangeCutoffHours: null, cancellationCutoffHours: null },
        },
        participants: [
          { id: 'tp1', userId: 'user-1', isOrganizer: true,  team: null, user: { firstName: 'Eric', lastName: 'N', avatarUrl: null } },
          { id: 'tp2', userId: 'user-2', isOrganizer: false, team: null, user: { firstName: 'Sam',  lastName: 'P', avatarUrl: null } },
        ],
      };
      const resaTennis = {
        id: 'res-tennis2', startTime: new Date('2026-06-21T10:00:00Z'), endTime: new Date('2026-06-21T11:00:00Z'),
        status: 'CONFIRMED', totalPrice: 20, userId: 'user-1', resourceId: 'court-tennis2', type: 'COURT',
        resource: {
          id: 'court-tennis2', name: 'Court Tennis', attributes: { format: 'single' },
          clubSport: { sport: { key: 'tennis', name: 'Tennis' } },
          club: { name: 'Club Tennis', slug: 'club-tennis', timezone: 'Europe/Paris', playerChangeCutoffHours: null, cancellationCutoffHours: null },
        },
        participants: [
          // slot 0 volontaire : hors padel, la valeur en base est écrasée à null au mapping.
          { id: 'tt1', userId: 'user-1', isOrganizer: true, team: null, slot: 0, user: { firstName: 'Eric', lastName: 'N', avatarUrl: null } },
        ],
      };

      prismaMock.reservation.findMany.mockResolvedValue([resaPadel, resaTennis] as any);
      prismaMock.sport.findMany.mockResolvedValue([
        { id: 'sport-padel',  key: 'padel' },
        { id: 'sport-tennis', key: 'tennis' },
      ] as any);
      prismaMock.playerRating.findMany.mockResolvedValue([] as any);

      const list = await service.listUserReservations('user-1');
      const padel = list.find((r) => (r.resource as any).sport.key === 'padel');
      const tennis = list.find((r) => (r.resource as any).sport.key === 'tennis');

      expect(padel).toBeTruthy();
      for (const p of padel!.participants) {
        expect([1, 2]).toContain(p.team);
        expect([0, 1]).toContain(p.slot); // place G/D concrète en padel
      }
      // hors padel → team ET slot null
      expect(tennis).toBeTruthy();
      for (const p of tennis!.participants) {
        expect(p.team).toBeNull();
        expect(p.slot).toBeNull();
      }
    });
  });

  describe('addOwnReservationParticipant', () => {
    const future = new Date(Date.now() + 24 * 3_600_000);
    const resa = (over: any = {}) => ({
      id: 'res-1', userId: 'user-1', status: 'CONFIRMED', type: 'COURT', totalPrice: 25,
      startTime: future, endTime: new Date(future.getTime() + 3_600_000),
      resource: { clubId: 'club-1', attributes: { format: 'double' }, price: 25, offPeakPrice: null, club: { offPeakHours: null, timezone: 'Europe/Paris', playerChangeCutoffHours: 0 } },
      ...over,
    });

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1', status: 'ACTIVE' } as any);
      jest.spyOn(service as any, 'getOwnReservationPlayers').mockResolvedValue({ id: 'res-1', capacity: 4, participants: [] } as any);
    });

    it('ajoute un joueur pour le propriétaire (organisateur matérialisé)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([] as any);

      await service.addOwnReservationParticipant('res-1', 'user-1', 'user-2');

      expect(prismaMock.reservationParticipant.createMany).toHaveBeenCalled();
    });

    it('lève UNAUTHORIZED si ce n est pas le propriétaire', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa({ userId: 'autre' }) as any);
      await expect(service.addOwnReservationParticipant('res-1', 'user-1', 'user-2')).rejects.toThrow('UNAUTHORIZED');
    });

    it('lève RESERVATION_NOT_ACTIVE si la résa n est pas CONFIRMED', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa({ status: 'PENDING' }) as any);
      await expect(service.addOwnReservationParticipant('res-1', 'user-1', 'user-2')).rejects.toThrow('RESERVATION_NOT_ACTIVE');
    });

    it('lève PLAYER_CHANGE_TOO_LATE après le délai', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(
        resa({ startTime: new Date(Date.now() - 3_600_000) }) as any,
      );
      await expect(service.addOwnReservationParticipant('res-1', 'user-1', 'user-2')).rejects.toThrow('PLAYER_CHANGE_TOO_LATE');
    });
  });

  describe('removeOwnReservationParticipant', () => {
    const future = new Date(Date.now() + 24 * 3_600_000);
    const resa = (over: any = {}) => ({
      id: 'res-1', userId: 'user-1', status: 'CONFIRMED', type: 'COURT', totalPrice: 25,
      startTime: future, endTime: new Date(future.getTime() + 3_600_000),
      resource: { clubId: 'club-1', price: 25, offPeakPrice: null, club: { offPeakHours: null, timezone: 'Europe/Paris', playerChangeCutoffHours: 0 } },
      ...over,
    });

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      jest.spyOn(service as any, 'getOwnReservationPlayers').mockResolvedValue({ id: 'res-1', capacity: 4, participants: [] } as any);
    });

    it('retire un joueur pour le propriétaire', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);

      await service.removeOwnReservationParticipant('res-1', 'user-1', 'p2');

      expect(prismaMock.reservationParticipant.delete).toHaveBeenCalledWith({ where: { id: 'p2' } });
    });

    it('lève UNAUTHORIZED si ce n est pas le propriétaire', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa({ userId: 'autre' }) as any);
      await expect(service.removeOwnReservationParticipant('res-1', 'user-1', 'p2')).rejects.toThrow('UNAUTHORIZED');
    });
  });

  describe('setReservationTeams', () => {
    const reservationId = 'res-1';
    const ownerUserId = 'user-1';
    const p2 = 'user-2';

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      jest.spyOn(service as any, 'getOwnReservationPlayers').mockResolvedValue({ id: reservationId, capacity: 4, participants: [] } as any);
    });

    it('persiste les équipes pour le propriétaire d’une résa padel', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: reservationId, userId: ownerUserId, resource: { attributes: { format: 'double' } },
      } as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: ownerUserId },
        { id: 'p2', userId: p2 },
      ] as any);

      await service.setReservationTeams(reservationId, ownerUserId, { [ownerUserId]: 2, [p2]: 1 });

      const u1 = prismaMock.reservationParticipant.update.mock.calls.map((c: any) => c[0]).find((u: any) => u.where.id === 'p1');
      const u2 = prismaMock.reservationParticipant.update.mock.calls.map((c: any) => c[0]).find((u: any) => u.where.id === 'p2');
      expect(u1.data.team).toBe(2);
      expect(u2.data.team).toBe(1);
    });

    it('persiste aussi les places G/D quand slots est fourni', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: reservationId, userId: ownerUserId, resource: { attributes: { format: 'double' } },
      } as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: ownerUserId },
        { id: 'p2', userId: p2 },
      ] as any);

      await service.setReservationTeams(reservationId, ownerUserId,
        { [ownerUserId]: 2, [p2]: 1 }, { [ownerUserId]: 1, [p2]: 0 });

      const u1 = prismaMock.reservationParticipant.update.mock.calls.map((c: any) => c[0]).find((u: any) => u.where.id === 'p1');
      const u2 = prismaMock.reservationParticipant.update.mock.calls.map((c: any) => c[0]).find((u: any) => u.where.id === 'p2');
      expect(u1.data).toEqual({ team: 2, slot: 1 });
      expect(u2.data).toEqual({ team: 1, slot: 0 });
    });

    it('refuse un non-propriétaire (UNAUTHORIZED)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: reservationId, userId: ownerUserId, resource: { attributes: { format: 'double' } },
      } as any);
      await expect(service.setReservationTeams(reservationId, p2, { [ownerUserId]: 1, [p2]: 2 }))
        .rejects.toThrow('UNAUTHORIZED');
    });
  });

  describe('setReservationVisibility', () => {
    const reservationId = 'res-1';
    const ownerUserId = 'user-1';
    const future = () => new Date(Date.now() + 48 * 3600 * 1000);
    const past = () => new Date(Date.now() - 3600 * 1000);
    const row = (over: any = {}) => ({
      id: reservationId, userId: ownerUserId, status: 'CONFIRMED', startTime: future(),
      resource: { clubSport: { sport: { key: 'padel' } } }, ...over,
    });

    it('ouvre une résa padel confirmée future en PUBLIC avec la fourchette de niveau', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row() as any);
      prismaMock.reservation.update.mockResolvedValue({ id: reservationId, visibility: 'PUBLIC', targetLevelMin: 2, targetLevelMax: 5 } as any);

      const out = await service.setReservationVisibility(reservationId, ownerUserId, { visibility: 'PUBLIC', targetLevelMin: 2, targetLevelMax: 5 });

      expect(prismaMock.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { visibility: 'PUBLIC', targetLevelMin: 2, targetLevelMax: 5 },
      }));
      expect(out.visibility).toBe('PUBLIC');
    });

    it('efface la fourchette de niveau en repassant PRIVATE', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ visibility: 'PUBLIC' }) as any);
      prismaMock.reservation.update.mockResolvedValue({ id: reservationId, visibility: 'PRIVATE', targetLevelMin: null, targetLevelMax: null } as any);

      await service.setReservationVisibility(reservationId, ownerUserId, { visibility: 'PRIVATE' });

      expect(prismaMock.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { visibility: 'PRIVATE', targetLevelMin: null, targetLevelMax: null },
      }));
    });

    it('refuse un non-propriétaire (UNAUTHORIZED)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row() as any);
      await expect(service.setReservationVisibility(reservationId, 'autre', { visibility: 'PUBLIC' }))
        .rejects.toThrow('UNAUTHORIZED');
    });

    it('refuse une résa non confirmée (RESERVATION_NOT_ACTIVE)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ status: 'PENDING' }) as any);
      await expect(service.setReservationVisibility(reservationId, ownerUserId, { visibility: 'PUBLIC' }))
        .rejects.toThrow('RESERVATION_NOT_ACTIVE');
    });

    it('refuse une résa passée (RESERVATION_IN_PAST)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ startTime: past() }) as any);
      await expect(service.setReservationVisibility(reservationId, ownerUserId, { visibility: 'PUBLIC' }))
        .rejects.toThrow('RESERVATION_IN_PAST');
    });

    it('refuse PUBLIC sur un sport non-padel (OPEN_MATCH_PADEL_ONLY)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ resource: { clubSport: { sport: { key: 'tennis' } } } }) as any);
      await expect(service.setReservationVisibility(reservationId, ownerUserId, { visibility: 'PUBLIC' }))
        .rejects.toThrow('OPEN_MATCH_PADEL_ONLY');
    });
  });

  describe('assertMembershipAndWindow — heure d\'ouverture', () => {
    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.reservationParticipant.createMany.mockResolvedValue({ count: 1 } as any);
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
      prismaMock.reservation.create.mockResolvedValue({
        id: 'res-x', status: 'PENDING', totalPrice: 25, createdAt: new Date(),
        startTime: new Date(), endTime: new Date(),
      } as any);
    });
    afterEach(() => { Settings.now = () => Date.now(); });

    const clubWith = (over: Record<string, unknown>) => ({
      price: 25, clubId: 'club-demo',
      club: {
        timezone: 'Europe/Paris', publicBookingDays: 7, memberBookingDays: 14,
        bookingReleaseMode: 'DAY_AT_HOUR', publicReleaseHour: 0, memberReleaseHour: 0, ...over,
      },
    });

    it('DAY_AT_HOUR : refuse la journée lointaine AVANT l\'heure de release', async () => {
      Settings.now = () => new Date('2026-06-15T04:00:00.000Z').getTime(); // 06:00 Paris < 8h
      prismaMock.resource.findUniqueOrThrow.mockResolvedValue(
        clubWith({ bookingReleaseMode: 'DAY_AT_HOUR', publicReleaseHour: 8 }) as any);
      const start = new Date('2026-06-22T09:00:00.000Z'); // J+7
      await expect(service.holdSlot({
        resourceId: 'court-1', userId: 'user-1', startTime: start, endTime: new Date(start.getTime() + 3_600_000),
      })).rejects.toThrow('BOOKING_TOO_FAR');
    });

    it('DAY_AT_HOUR : ouvre la journée lointaine APRÈS l\'heure de release', async () => {
      Settings.now = () => new Date('2026-06-15T07:00:00.000Z').getTime(); // 09:00 Paris ≥ 8h
      prismaMock.resource.findUniqueOrThrow.mockResolvedValue(
        clubWith({ bookingReleaseMode: 'DAY_AT_HOUR', publicReleaseHour: 8 }) as any);
      const start = new Date('2026-06-22T09:00:00.000Z'); // J+7
      const r = await service.holdSlot({
        resourceId: 'court-1', userId: 'user-1', startTime: start, endTime: new Date(start.getTime() + 3_600_000),
      });
      expect(r.status).toBe('PENDING');
    });
  });

  describe('remboursement à l\'annulation (Phase 2)', () => {
    beforeEach(() => {
      prismaMock.payment.findMany.mockResolvedValue([] as any);
      redisMock.del.mockResolvedValue(1);
    });

    it('politique off : refund non appelé, refunded vide', async () => {
      const { RefundService } = require('../refund.service');
      const spy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'ref-x' } as any);
      const future = new Date(Date.now() + 48 * 3_600_000);
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'r1', userId: 'u1', status: 'CONFIRMED',
        startTime: future, endTime: new Date(future.getTime() + 3_600_000), resourceId: 'res-1',
        resource: { clubId: 'club-1', club: { cancellationCutoffHours: 24, refundOnCancelWithinCutoff: false } },
      } as any);
      prismaMock.reservation.update.mockResolvedValue({
        id: 'r1', status: 'CANCELLED', resourceId: 'res-1', startTime: future, endTime: future,
      } as any);

      const out = await service.cancelReservation('r1', 'u1');

      expect(spy).not.toHaveBeenCalled();
      expect(out.refunded).toHaveLength(0);
      spy.mockRestore();
    });

    it('politique on + dans la fenêtre + paiement CASH : rembourse', async () => {
      const { RefundService } = require('../refund.service');
      const spy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'ref-1' } as any);
      const future = new Date(Date.now() + 48 * 3_600_000);
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'r1', userId: 'u1', status: 'CONFIRMED',
        startTime: future, endTime: new Date(future.getTime() + 3_600_000), resourceId: 'res-1',
        resource: { clubId: 'club-1', club: { cancellationCutoffHours: 24, refundOnCancelWithinCutoff: true } },
      } as any);
      prismaMock.reservation.update.mockResolvedValue({
        id: 'r1', status: 'CANCELLED', resourceId: 'res-1', startTime: future, endTime: future,
      } as any);
      prismaMock.payment.findMany.mockResolvedValue([
        { id: 'pay-1', amount: new Prisma.Decimal(20), refundedAmount: new Prisma.Decimal(0), method: 'CASH' },
      ] as any);

      const out = await service.cancelReservation('r1', 'u1');

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay-1', amount: 20, method: 'CASH' }));
      expect(out.refunded).toHaveLength(1);
      expect(out.refunded[0]).toMatchObject({ paymentId: 'pay-1', amount: '20.00', method: 'CASH' });
      spy.mockRestore();
    });

    it('politique on + paiement PACK_CREDIT : rembourse (recrédit géré par RefundService)', async () => {
      const { RefundService } = require('../refund.service');
      const spy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'ref-2' } as any);
      const future = new Date(Date.now() + 48 * 3_600_000);
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'r2', userId: 'u1', status: 'CONFIRMED',
        startTime: future, endTime: new Date(future.getTime() + 3_600_000), resourceId: 'res-1',
        resource: { clubId: 'club-1', club: { cancellationCutoffHours: 24, refundOnCancelWithinCutoff: true } },
      } as any);
      prismaMock.reservation.update.mockResolvedValue({
        id: 'r2', status: 'CANCELLED', resourceId: 'res-1', startTime: future, endTime: future,
      } as any);
      prismaMock.payment.findMany.mockResolvedValue([
        { id: 'pay-2', amount: new Prisma.Decimal(15), refundedAmount: new Prisma.Decimal(0), method: 'PACK_CREDIT' },
      ] as any);

      const out = await service.cancelReservation('r2', 'u1');

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay-2', amount: 15, method: 'PACK_CREDIT' }));
      expect(out.refunded).toHaveLength(1);
      spy.mockRestore();
    });

    it('politique on mais hors fenêtre (adminCancel après délai) : refund non appelé', async () => {
      const { RefundService } = require('../refund.service');
      const spy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'ref-x' } as any);
      const soon = new Date(Date.now() + 1 * 3_600_000);
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'r3', userId: 'u1', status: 'CONFIRMED',
        startTime: soon, endTime: new Date(soon.getTime() + 3_600_000), resourceId: 'res-1',
        resource: { clubId: 'club-1', club: { cancellationCutoffHours: 2, refundOnCancelWithinCutoff: true } },
      } as any);
      prismaMock.reservation.update.mockResolvedValue({
        id: 'r3', status: 'CANCELLED', resourceId: 'res-1', startTime: soon, endTime: soon,
      } as any);
      prismaMock.payment.findMany.mockResolvedValue([
        { id: 'pay-3', amount: new Prisma.Decimal(20), refundedAmount: new Prisma.Decimal(0), method: 'CASH' },
      ] as any);

      const out = await service.adminCancelReservation('r3', 'club-1');

      expect(spy).not.toHaveBeenCalled();
      expect(out.refunded).toHaveLength(0);
      spy.mockRestore();
    });

    it('best-effort : un remboursement qui échoue ne fait pas échouer l\'annulation', async () => {
      const { RefundService } = require('../refund.service');
      const spy = jest.spyOn(RefundService.prototype, 'refund').mockRejectedValue(new Error('ALREADY_REFUNDED'));
      const future = new Date(Date.now() + 48 * 3_600_000);
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'r4', userId: 'u1', status: 'CONFIRMED',
        startTime: future, endTime: new Date(future.getTime() + 3_600_000), resourceId: 'res-1',
        resource: { clubId: 'club-1', club: { cancellationCutoffHours: 24, refundOnCancelWithinCutoff: true } },
      } as any);
      prismaMock.reservation.update.mockResolvedValue({
        id: 'r4', status: 'CANCELLED', resourceId: 'res-1', startTime: future, endTime: future,
      } as any);
      prismaMock.payment.findMany.mockResolvedValue([
        { id: 'pay-4', amount: new Prisma.Decimal(20), refundedAmount: new Prisma.Decimal(0), method: 'CASH' },
      ] as any);

      const out = await service.cancelReservation('r4', 'u1');

      expect(out.status).toBe('CANCELLED');
      expect(out.refunded).toHaveLength(0);
      spy.mockRestore();
    });
  });

  describe('confirmReservation — couverture abonnement', () => {
    let service: ReservationService;
    const baseRes = {
      id: 'res-1', userId: 'user-1', status: 'PENDING', createdAt: new Date(), totalPrice: '13.00',
      startTime: new Date('2026-07-01T08:00:00Z'), endTime: new Date('2026-07-01T09:30:00Z'),
      resource: {
        clubId: 'club-1',
        club: { requireOnlinePayment: false, requireCardFingerprint: false, stripeAccountId: null, offPeakHours: null, timezone: 'Europe/Paris' },
        clubSport: { sport: { key: 'padel' } },
      },
    };
    beforeEach(() => {
      service = new ReservationService();
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
      prismaMock.$queryRaw.mockResolvedValue([{ id: 'res-1', status: 'PENDING', resource_id: 'court-1', start_time: baseRes.startTime, end_time: baseRes.endTime }] as any);
      prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
      prismaMock.reservationParticipant.findFirst.mockResolvedValue({ id: 'part-1' } as any);
      prismaMock.reservation.update.mockResolvedValue({ id: 'res-1', status: 'CONFIRMED', resourceId: 'court-1', startTime: baseRes.startTime, endTime: baseRes.endTime } as any);
      prismaMock.payment.count.mockResolvedValue(0);
    });

    // off=null → tout en heures pleines : on rend le créneau « creux » en passant offPeakHours
    // qui couvre 8h-22h pour ce test d'INCLUDED.
    const offAll = { '3': [{ start: 8, end: 22 }] }; // 2026-07-01 = mercredi (weekday Luxon 3)

    it('créneau creux + abo INCLUDED → Payment SUBSCRIPTION = prix, reste dû 0', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({ ...baseRes, resource: { ...baseRes.resource, club: { ...baseRes.resource.club, offPeakHours: offAll } } } as any);
      prismaMock.subscription.findUnique.mockResolvedValue({
        id: 'sub-1', userId: 'user-1', clubId: 'club-1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 1e9),
        sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null,
      } as any);
      prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);

      await service.confirmReservation('res-1', 'user-1', { paymentSource: { subscriptionId: 'sub-1' } });

      expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ method: 'SUBSCRIPTION', sourceSubscriptionId: 'sub-1', amount: expect.anything() }),
      }));
      const amount = Number((prismaMock.payment.create.mock.calls[0][0].data as any).amount);
      expect(amount).toBe(13);
    });

    it('créneau plein + abo offPeakOnly → SUBSCRIPTION_NOT_APPLICABLE', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(baseRes as any); // offPeakHours null → plein
      prismaMock.subscription.findUnique.mockResolvedValue({
        id: 'sub-1', userId: 'user-1', clubId: 'club-1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 1e9),
        sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null,
      } as any);
      await expect(service.confirmReservation('res-1', 'user-1', { paymentSource: { subscriptionId: 'sub-1' } }))
        .rejects.toThrow('SUBSCRIPTION_NOT_APPLICABLE');
    });

    it('plafond jour atteint → SUBSCRIPTION_CAP_REACHED', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({ ...baseRes, resource: { ...baseRes.resource, club: { ...baseRes.resource.club, offPeakHours: offAll } } } as any);
      prismaMock.subscription.findUnique.mockResolvedValue({
        id: 'sub-1', userId: 'user-1', clubId: 'club-1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 1e9),
        sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: 1, weeklyCap: null,
      } as any);
      prismaMock.payment.count.mockResolvedValue(1); // déjà 1 couverte ce jour
      await expect(service.confirmReservation('res-1', 'user-1', { paymentSource: { subscriptionId: 'sub-1' } }))
        .rejects.toThrow('SUBSCRIPTION_CAP_REACHED');
    });
  });

  describe('applyHoldSetup', () => {
    const baseReservation = {
      id: 'res-1', userId: 'user-1', status: 'PENDING',
      createdAt: new Date(), totalPrice: 20,
      resource: { clubId: 'club-1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
    };

    it('remplace les participants et met à jour visibilité/niveau', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(baseReservation as any);
      prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'user-2' }] as any);
      const tx = {
        reservationParticipant: { deleteMany: jest.fn(), createMany: jest.fn() },
        reservation: { update: jest.fn().mockResolvedValue({ id: 'res-1', status: 'PENDING' }) },
      };
      (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(tx));

      await service.applyHoldSetup('res-1', 'user-1', {
        partnerUserIds: ['user-2'], visibility: 'PUBLIC',
        targetLevelMin: 3, targetLevelMax: 5,
      });

      expect(tx.reservationParticipant.deleteMany).toHaveBeenCalledWith({ where: { reservationId: 'res-1' } });
      expect(tx.reservationParticipant.createMany).toHaveBeenCalled();
      expect(tx.reservationParticipant.createMany.mock.calls[0][0].data).toHaveLength(2);
      expect(tx.reservationParticipant.createMany.mock.calls[0][0].data[0]).toMatchObject({ isOrganizer: true });
      expect(tx.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'res-1' },
        data: expect.objectContaining({ visibility: 'PUBLIC', targetLevelMin: 3, targetLevelMax: 5 }),
      }));
    });

    it('persiste les équipes fournies (padel double)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(baseReservation as any);
      prismaMock.clubMembership.findMany.mockResolvedValue(
        [{ userId: 'user-2' }, { userId: 'user-3' }, { userId: 'user-4' }] as any,
      );
      const tx = {
        reservationParticipant: {
          deleteMany: jest.fn(),
          createMany: jest.fn(),
          findMany: jest.fn().mockResolvedValue([
            { id: 'p-org', userId: 'user-1' },
            { id: 'p-2',   userId: 'user-2' },
            { id: 'p-3',   userId: 'user-3' },
            { id: 'p-4',   userId: 'user-4' },
          ]),
          update: jest.fn(),
        },
        reservation: { update: jest.fn().mockResolvedValue({ id: 'res-1', status: 'PENDING' }) },
      };
      (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(tx));

      await service.applyHoldSetup('res-1', 'user-1', {
        partnerUserIds: ['user-2', 'user-3', 'user-4'], visibility: 'PUBLIC',
        teams: { 'user-1': 1, 'user-2': 2, 'user-3': 1, 'user-4': 2 },
      });

      // best-effort : un update par participant, p-2 (user-2) → équipe 2.
      expect(tx.reservationParticipant.update).toHaveBeenCalledWith({ where: { id: 'p-2' }, data: { team: 2 } });
      expect(tx.reservationParticipant.update).toHaveBeenCalledWith({ where: { id: 'p-3' }, data: { team: 1 } });
    });

    it('persiste les places fournies (slots best-effort : valide gardé, invalide ignoré, jamais d\'échec)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(baseReservation as any);
      prismaMock.clubMembership.findMany.mockResolvedValue(
        [{ userId: 'user-2' }, { userId: 'user-3' }, { userId: 'user-4' }] as any,
      );
      const tx = {
        reservationParticipant: {
          deleteMany: jest.fn(),
          createMany: jest.fn(),
          findMany: jest.fn().mockResolvedValue([
            { id: 'p-org', userId: 'user-1' },
            { id: 'p-2',   userId: 'user-2' },
            { id: 'p-3',   userId: 'user-3' },
            { id: 'p-4',   userId: 'user-4' },
          ]),
          update: jest.fn(),
        },
        reservation: { update: jest.fn().mockResolvedValue({ id: 'res-1', status: 'PENDING' }) },
      };
      (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(tx));

      await service.applyHoldSetup('res-1', 'user-1', {
        partnerUserIds: ['user-2', 'user-3', 'user-4'], visibility: 'PUBLIC',
        teams: { 'user-1': 1, 'user-2': 1, 'user-3': 2, 'user-4': 2 },
        // double → half = 2 : 5 et -1 hors [0, 2[ → ignorés (team seule persistée)
        slots: { 'user-1': 0, 'user-2': 1, 'user-3': 5, 'user-4': -1 },
      });

      expect(tx.reservationParticipant.update).toHaveBeenCalledWith({ where: { id: 'p-org' }, data: { team: 1, slot: 0 } });
      expect(tx.reservationParticipant.update).toHaveBeenCalledWith({ where: { id: 'p-2' }, data: { team: 1, slot: 1 } });
      expect(tx.reservationParticipant.update).toHaveBeenCalledWith({ where: { id: 'p-3' }, data: { team: 2 } });
      expect(tx.reservationParticipant.update).toHaveBeenCalledWith({ where: { id: 'p-4' }, data: { team: 2 } });
    });

    it('hors padel : ignore la fourchette de niveau (targetLevel forcé à null)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        resource: { clubId: 'club-1', attributes: { format: 'double' }, clubSport: { sport: { key: 'tennis' } } },
      } as any);
      prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'user-2' }] as any);
      const tx = {
        reservationParticipant: { deleteMany: jest.fn(), createMany: jest.fn() },
        reservation: { update: jest.fn().mockResolvedValue({ id: 'res-1', status: 'PENDING' }) },
      };
      (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(tx));

      // visibilité PRIVATE : PUBLIC est désormais réservé au padel (OPEN_MATCH_PADEL_ONLY,
      // testé à part) ; ici on isole le comportement « hors padel → niveau forcé à null ».
      await service.applyHoldSetup('res-1', 'user-1', {
        partnerUserIds: ['user-2'], visibility: 'PRIVATE',
        targetLevelMin: 3, targetLevelMax: 5,
      });

      expect(tx.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'res-1' },
        data: expect.objectContaining({ visibility: 'PRIVATE', targetLevelMin: null, targetLevelMax: null }),
      }));
    });

    it('rejette TOO_MANY_PLAYERS au-delà de la capacité du terrain', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(baseReservation as any);
      prismaMock.clubMembership.findMany.mockResolvedValue(
        [{ userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }, { userId: 'u5' }] as any,
      );
      await expect(service.applyHoldSetup('res-1', 'user-1', {
        partnerUserIds: ['u2', 'u3', 'u4', 'u5'],
      })).rejects.toThrow('TOO_MANY_PLAYERS');
    });

    it('refuse si la résa n est pas PENDING', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({ ...baseReservation, status: 'CONFIRMED' } as any);
      await expect(service.applyHoldSetup('res-1', 'user-1', { visibility: 'PRIVATE' }))
        .rejects.toThrow('RESERVATION_NOT_PENDING');
    });

    it('refuse si la résa appartient à un autre joueur', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({ ...baseReservation, userId: 'other' } as any);
      await expect(service.applyHoldSetup('res-1', 'user-1', { visibility: 'PRIVATE' }))
        .rejects.toThrow('UNAUTHORIZED');
    });

    it('refuse si la résa est introuvable', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(null as any);
      await expect(service.applyHoldSetup('res-1', 'user-1', { visibility: 'PRIVATE' }))
        .rejects.toThrow('RESERVATION_NOT_FOUND');
    });

    it('refuse une partie ouverte (PUBLIC) sur un court non-padel', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        resource: { clubId: 'club-1', attributes: { format: 'double' }, clubSport: { sport: { key: 'tennis' } } },
      } as any);
      prismaMock.clubMembership.findMany.mockResolvedValue([] as any);
      await expect(
        service.applyHoldSetup('res-1', 'user-1', { visibility: 'PUBLIC' }),
      ).rejects.toThrow('OPEN_MATCH_PADEL_ONLY');
    });

    it('autorise une partie privée (PRIVATE) sur un court non-padel', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        resource: { clubId: 'club-1', attributes: { format: 'double' }, clubSport: { sport: { key: 'tennis' } } },
      } as any);
      prismaMock.clubMembership.findMany.mockResolvedValue([] as any);
      const tx = {
        reservationParticipant: { deleteMany: jest.fn(), createMany: jest.fn() },
        reservation: { update: jest.fn().mockResolvedValue({ id: 'res-1', status: 'PENDING' }) },
      };
      (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(tx));
      await expect(
        service.applyHoldSetup('res-1', 'user-1', { visibility: 'PRIVATE' }),
      ).resolves.toMatchObject({ id: 'res-1' });
    });
  });
});

describe('cancelFutureReservationsForUser', () => {
  it('annule chaque résa future (CONFIRMED/PENDING) de l organisateur', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      { id: 'r1', resourceId: 'res-1', startTime: new Date(Date.now() + 86400000), endTime: new Date(Date.now() + 90000000) },
      { id: 'r2', resourceId: 'res-2', startTime: new Date(Date.now() + 172800000), endTime: new Date(Date.now() + 176400000) },
    ] as any);
    prismaMock.reservation.update.mockResolvedValue({ id: 'r1' } as any);

    const n = await new ReservationService().cancelFutureReservationsForUser('u1');
    expect(n).toBe(2);
    expect(prismaMock.reservation.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.reservation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'u1', status: { in: ['CONFIRMED', 'PENDING'] } }),
    }));
  });
});
