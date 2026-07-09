import cron from 'node-cron';
import { prisma } from '../db/prisma';
import { notifyReservationReminder, notifyMatchResultPrompt } from '../email/notifications';

// Idempotency by design: each reservation falls into a window's narrow [lead−period, lead] slice
// for exactly one 15-min job run, so it's reminded once per window.
// Note: a missed job run (e.g. server restart spanning the slice) may skip that reminder —
// reminders are best-effort. This avoids relying on the Notification row for dedup
// (which wouldn't exist if a user muted the in-app channel for REMINDERS).
//
// Coupling note: REMINDER_PERIOD_MIN drives both the cron cadence and the query slice width.
// They must remain equal: if the cron fires late (event-loop lag, clock skew) the slices
// of consecutive runs won't be contiguous and a reservation could fall through the gap.
// This is an accepted best-effort trade-off — the constant must match the actual cron period.

export const REMINDER_WINDOWS = [
  { key: 'J-1' as const, leadMin: 1440 },
  { key: 'H-2' as const, leadMin: 120 },
];
export const REMINDER_PERIOD_MIN = 15;

// Invitation à saisir le résultat : lead 15 min après la fin du match (le temps de sortir
// du terrain). Tranche = [now − (lead + période), now − lead] = [-30min, -15min].
export const RESULT_PROMPT_LEAD_MIN = 15;

export async function runReminders(now: Date): Promise<void> {
  for (const w of REMINDER_WINDOWS) {
    const from = new Date(now.getTime() + (w.leadMin - REMINDER_PERIOD_MIN) * 60000);
    const to = new Date(now.getTime() + w.leadMin * 60000);
    const resas = await prisma.reservation.findMany({
      where: { status: 'CONFIRMED', startTime: { gt: from, lte: to } },
      select: { id: true },
    });
    for (const r of resas) {
      try {
        await notifyReservationReminder(r.id, w.key);
      } catch (e) {
        console.error('[reminders]', (e as Error).message);
      }
    }
  }

  // Passe post-match : réservations dont la fin tombe dans la tranche écoulée.
  const postFrom = new Date(now.getTime() - (RESULT_PROMPT_LEAD_MIN + REMINDER_PERIOD_MIN) * 60000);
  const postTo = new Date(now.getTime() - RESULT_PROMPT_LEAD_MIN * 60000);
  const played = await prisma.reservation.findMany({
    where: { status: 'CONFIRMED', type: 'COURT', endTime: { gt: postFrom, lte: postTo } },
    select: { id: true },
  });
  for (const r of played) {
    try {
      await notifyMatchResultPrompt(r.id);
    } catch (e) {
      console.error('[reminders:post-match]', (e as Error).message);
    }
  }
}

export function startReminderJob(): void {
  cron.schedule(`*/${REMINDER_PERIOD_MIN} * * * *`, () => {
    runReminders(new Date()).catch((e) => console.error('[reminders]', e));
  });
  console.log('[reminders] Job de rappels démarré (toutes les 15 minutes)');
}
