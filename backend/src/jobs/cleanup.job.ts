import cron from 'node-cron';
import { prisma } from '../db/prisma';
import { redis } from '../redis/client';
import { SSEService } from '../services/sse.service';
import { MatchService } from '../services/match.service';
import { HOLD_EXPIRY_MINUTES } from '../services/holdWindow';
import { TournamentService } from '../services/tournament.service';
import { EventService } from '../services/event.service';

const matchService = new MatchService();

export async function releaseExpiredRegistrations(now: Date): Promise<void> {
  const tournamentSvc = new TournamentService();
  const eventSvc = new EventService();
  const [tRegs, eRegs] = await Promise.all([
    prisma.tournamentRegistration.findMany({ where: { status: 'CONFIRMED', paymentStatus: 'DUE', paymentDeadline: { lt: now } }, select: { id: true } }),
    prisma.eventRegistration.findMany({ where: { status: 'CONFIRMED', paymentStatus: 'DUE', paymentDeadline: { lt: now } }, select: { id: true } }),
  ]);
  for (const r of tRegs) await tournamentSvc.releaseExpiredRegistration(r.id);
  for (const r of eRegs) await eventSvc.releaseExpiredRegistration(r.id);
  if (tRegs.length + eRegs.length > 0) console.log(`[cleanup] ${tRegs.length + eRegs.length} inscription(s) DUE expirée(s) libérée(s)`);
}

export function startCleanupJob(): void {
  cron.schedule('* * * * *', async () => {
    const expiredBefore = new Date(Date.now() - HOLD_EXPIRY_MINUTES * 60 * 1000);

    try {
      const expired = await prisma.reservation.findMany({
        where: { status: 'PENDING', createdAt: { lt: expiredBefore } },
        select: { id: true, resourceId: true, startTime: true, endTime: true },
      });

      if (expired.length === 0) return;

      await prisma.reservation.updateMany({
        where: { id: { in: expired.map((r) => r.id) } },
        data:  { status: 'CANCELLED', cancelledAt: new Date() },
      });

      await Promise.all(
        expired.map(async (r) => {
          await redis.del(`lock:resource:${r.resourceId}:${r.startTime.toISOString()}`);
          SSEService.getInstance().broadcast(r.resourceId, {
            type:          'slot_released',
            resourceId:    r.resourceId,
            reservationId: r.id,
            startTime:     r.startTime.toISOString(),
            endTime:       r.endTime.toISOString(),
          });
        }),
      );

      console.log(`[cleanup] ${expired.length} réservation(s) PENDING expirée(s) annulées`);
    } catch (err) {
      console.error('[cleanup] Erreur:', (err as Error).message);
    }

    try {
      const finalized = await matchService.autoValidateDue(new Date());
      if (finalized > 0) console.log(`[match] ${finalized} match(s) auto-validé(s)`);
    } catch (err) {
      console.error('[match] auto-validation:', (err as Error).message);
    }

    try {
      await releaseExpiredRegistrations(new Date());
    } catch (err) {
      console.error('[cleanup] inscriptions DUE:', (err as Error).message);
    }
  });

  console.log('[cleanup] Job de nettoyage démarré (toutes les minutes)');
}
