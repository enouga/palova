import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { redis } from '../redis/client';
import { SSEService } from './sse.service';

interface HoldSlotParams {
  courtId: string;
  userId: string;
  startTime: Date;
  endTime: Date;
}

const HOLD_TTL_SECONDS = 600; // 10 minutes
const HOLD_EXPIRY_MS   = HOLD_TTL_SECONDS * 1000;

export class ReservationService {
  private lockKey(courtId: string, startTime: Date): string {
    return `lock:court:${courtId}:${startTime.toISOString()}`;
  }

  async holdSlot({ courtId, userId, startTime, endTime }: HoldSlotParams) {
    const lockKey = this.lockKey(courtId, startTime);

    const acquired = await redis.set(lockKey, userId, 'EX', HOLD_TTL_SECONDS, 'NX');
    if (!acquired) throw new Error('SLOT_ALREADY_HELD');

    try {
      const tenMinutesAgo = new Date(Date.now() - HOLD_EXPIRY_MS);

      const conflicts = await prisma.reservation.count({
        where: {
          courtId,
          OR: [
            { status: 'CONFIRMED' },
            { status: 'PENDING', createdAt: { gt: tenMinutesAgo } },
          ],
          startTime: { lt: endTime },
          endTime:   { gt: startTime },
        },
      });

      if (conflicts > 0) {
        await redis.del(lockKey);
        throw new Error('SLOT_NOT_AVAILABLE');
      }

      const court = await prisma.court.findUniqueOrThrow({
        where: { id: courtId },
        select: { pricePerHour: true },
      });

      const durationHours = (endTime.getTime() - startTime.getTime()) / 3_600_000;
      const totalPrice    = new Prisma.Decimal(Number(court.pricePerHour) * durationHours);

      const reservation = await prisma.reservation.create({
        data: { courtId, userId, startTime, endTime, status: 'PENDING', totalPrice },
      });

      SSEService.getInstance().broadcast(courtId, {
        type: 'slot_held',
        courtId,
        reservationId: reservation.id,
        startTime: startTime.toISOString(),
        endTime:   endTime.toISOString(),
        expiresAt: new Date(Date.now() + HOLD_EXPIRY_MS).toISOString(),
      });

      return reservation;

    } catch (err) {
      if ((err as Error).message !== 'SLOT_NOT_AVAILABLE') {
        await redis.del(lockKey);
      }
      throw err;
    }
  }

  async confirmReservation(reservationId: string, userId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
    });

    if (!reservation)                     throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)    throw new Error('UNAUTHORIZED');
    if (reservation.status !== 'PENDING') throw new Error('RESERVATION_NOT_PENDING');

    const age = Date.now() - reservation.createdAt.getTime();
    if (age > HOLD_EXPIRY_MS)             throw new Error('RESERVATION_NOT_PENDING');

    const confirmed = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<any[]>`
        SELECT id, status, court_id, start_time, end_time
        FROM reservations WHERE id = ${reservationId} FOR UPDATE
      `;

      if (!locked[0] || locked[0].status !== 'PENDING') {
        throw new Error('RESERVATION_NOT_PENDING');
      }

      const conflicts = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM reservations
        WHERE court_id  = ${locked[0].court_id}
          AND id        != ${reservationId}
          AND status    = 'CONFIRMED'
          AND start_time < ${locked[0].end_time}
          AND end_time   > ${locked[0].start_time}
        FOR UPDATE
      `;

      if (Number(conflicts[0].count) > 0) throw new Error('SLOT_NO_LONGER_AVAILABLE');

      return tx.reservation.update({
        where: { id: reservationId },
        data:  { status: 'CONFIRMED' },
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 10_000,
    });

    await redis.del(this.lockKey(confirmed.courtId, confirmed.startTime));

    SSEService.getInstance().broadcast(confirmed.courtId, {
      type: 'slot_confirmed',
      courtId:       confirmed.courtId,
      reservationId: confirmed.id,
      startTime:     confirmed.startTime.toISOString(),
      endTime:       confirmed.endTime.toISOString(),
    });

    return confirmed;
  }

  async cancelReservation(reservationId: string, userId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { court: { include: { club: true } } },
    });

    if (!reservation)                       throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)      throw new Error('UNAUTHORIZED');
    if (reservation.status === 'CANCELLED') throw new Error('ALREADY_CANCELLED');

    const cancelled = await prisma.reservation.update({
      where: { id: reservationId },
      data:  { status: 'CANCELLED', cancelledAt: new Date() },
    });

    await redis.del(this.lockKey(reservation.courtId, reservation.startTime));

    SSEService.getInstance().broadcast(reservation.courtId, {
      type: 'slot_released',
      courtId:       reservation.courtId,
      reservationId: cancelled.id,
      startTime:     reservation.startTime.toISOString(),
      endTime:       reservation.endTime.toISOString(),
    });

    return cancelled;
  }
}
