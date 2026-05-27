import '../../__mocks__/prisma';
import '../../__mocks__/redis';
import { prismaMock } from '../../__mocks__/prisma';
import { redisMock } from '../../__mocks__/redis';
import { ReservationService } from '../reservation.service';
import { SSEService } from '../sse.service';

const mockBroadcast = jest.fn();

jest.mock('../sse.service', () => ({
  SSEService: { getInstance: jest.fn(() => ({ broadcast: mockBroadcast })) },
}));

const sseBroadcast = () => mockBroadcast;

describe('ReservationService', () => {
  let service: ReservationService;

  beforeEach(() => {
    service = new ReservationService();
    mockBroadcast.mockReset();
  });

  const baseParams = {
    courtId:   'court-1',
    userId:    'user-1',
    startTime: new Date('2025-06-15T08:00:00.000Z'),
    endTime:   new Date('2025-06-15T09:00:00.000Z'),
  };

  describe('holdSlot', () => {
    it('crée une PENDING reservation si le lock Redis est libre et le créneau disponible', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      prismaMock.court.findUniqueOrThrow.mockResolvedValue({ pricePerHour: 25 } as any);
      prismaMock.reservation.create.mockResolvedValue({
        id: 'res-1', ...baseParams, status: 'PENDING', totalPrice: 25,
        createdAt: new Date(),
      } as any);

      const result = await service.holdSlot(baseParams);

      expect(redisMock.set).toHaveBeenCalledWith(
        expect.stringContaining('lock:court:court-1:'),
        'user-1', 'EX', 600, 'NX',
      );
      expect(prismaMock.reservation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING', courtId: 'court-1' }),
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
      prismaMock.reservation.count.mockResolvedValue(1);

      await expect(service.holdSlot(baseParams)).rejects.toThrow('SLOT_NOT_AVAILABLE');
      expect(redisMock.del).toHaveBeenCalledWith(
        expect.stringContaining('lock:court:court-1:'),
      );
    });

    it('broadcast slot_held après création réussie', async () => {
      redisMock.set.mockResolvedValue('OK');
      prismaMock.reservation.count.mockResolvedValue(0);
      prismaMock.court.findUniqueOrThrow.mockResolvedValue({ pricePerHour: 25 } as any);
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
  });

  describe('cancelReservation', () => {
    it('annule une réservation CONFIRMED et broadcast slot_released', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', courtId: 'court-1', userId: 'user-1',
        status: 'CONFIRMED',
        startTime: baseParams.startTime,
        endTime:   baseParams.endTime,
        court: { club: {} },
      } as any);
      prismaMock.reservation.update.mockResolvedValue({
        id: 'res-1', status: 'CANCELLED',
        courtId: 'court-1',
        startTime: baseParams.startTime,
        endTime:   baseParams.endTime,
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
});
