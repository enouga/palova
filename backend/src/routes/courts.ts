import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/prisma';
import { AvailabilityService } from '../services/availability.service';
import { SSEService } from '../services/sse.service';

const router = Router();
const availabilityService = new AvailabilityService();

/** Normalize a query param value to a plain string (or '' if not a string). */
function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { clubId } = req.query;
    if (!clubId || typeof clubId !== 'string') {
      return void res.status(400).json({ error: 'clubId requis' });
    }
    const courts = await prisma.court.findMany({
      where: { clubId, isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, surface: true, pricePerHour: true, openHour: true, closeHour: true,
        club: { select: { name: true, timezone: true } },
      },
    });
    res.json(courts);
  } catch (err) { next(err); }
});

router.get('/:id/availability', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const courtId = asString(req.params.id);
    const { date, duration } = req.query;

    if (!date || !duration) {
      return void res.status(400).json({ error: 'date et duration requis' });
    }

    const dateStr     = asString(date);
    const durationStr = asString(duration);

    const durationMinutes = parseInt(durationStr, 10);
    if (![60, 90, 120].includes(durationMinutes)) {
      return void res.status(400).json({ error: 'duration doit être 60, 90 ou 120' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return void res.status(400).json({ error: 'date doit être YYYY-MM-DD' });
    }

    const slots = await availabilityService.getAvailableSlots(courtId, dateStr, durationMinutes);
    res.json(slots);
  } catch (err) { next(err); }
});

router.get('/:id/stream', (req: Request, res: Response) => {
  SSEService.getInstance().addClient(asString(req.params.id), res);
});

export default router;
