import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireClubAdmin } from '../middleware/requireClubAdmin';
import { CourtService } from '../services/court.service';
import { ReservationService } from '../services/reservation.service';

const router = Router();
const courtService = new CourtService();
const reservationService = new ReservationService();

const ERROR_STATUS: Record<string, number> = {
  FORBIDDEN:             403,
  COURT_NOT_FOUND:       404,
  VALIDATION_ERROR:      400,
  CLUB_MISMATCH:         403,
  RESERVATION_NOT_FOUND: 404,
  ALREADY_CANCELLED:     409,
};

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

const handleError = (err: unknown, res: Response, next: NextFunction) => {
  const message = (err as Error).message;
  const status  = ERROR_STATUS[message];
  if (status) return void res.status(status).json({ error: message });
  next(err);
};

const STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;

// Toutes les routes admin : authentification puis vérification du rôle club.
router.use(authMiddleware, requireClubAdmin);

// --- Terrains ---

router.get('/courts', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const courts = await courtService.listClubCourts(req.user!.clubId!);
    res.json(courts);
  } catch (err) { handleError(err, res, next); }
});

router.post('/courts', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, surface, pricePerHour, openHour, closeHour } = req.body;
    const court = await courtService.createCourt({
      clubId: req.user!.clubId!,
      name, surface, pricePerHour, openHour, closeHour,
    });
    res.status(201).json(court);
  } catch (err) { handleError(err, res, next); }
});

router.patch('/courts/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, surface, pricePerHour, openHour, closeHour } = req.body;
    const court = await courtService.updateCourt(asString(req.params.id), req.user!.clubId!, {
      name, surface, pricePerHour, openHour, closeHour,
    });
    res.json(court);
  } catch (err) { handleError(err, res, next); }
});

router.patch('/courts/:id/active', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (typeof req.body.isActive !== 'boolean') {
      return void res.status(400).json({ error: 'isActive (boolean) requis' });
    }
    const court = await courtService.setCourtActive(
      asString(req.params.id), req.user!.clubId!, req.body.isActive,
    );
    res.json(court);
  } catch (err) { handleError(err, res, next); }
});

// --- Réservations ---

router.get('/reservations', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const date    = asString(req.query.date);
    const courtId = asString(req.query.courtId);
    const status  = asString(req.query.status);

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return void res.status(400).json({ error: 'date doit être YYYY-MM-DD' });
    }
    if (status && !STATUSES.includes(status as typeof STATUSES[number])) {
      return void res.status(400).json({ error: 'status invalide' });
    }

    const result = await reservationService.listClubReservations({
      clubId:  req.user!.clubId!,
      date:    date || undefined,
      courtId: courtId || undefined,
      status:  (status || undefined) as typeof STATUSES[number] | undefined,
    });
    res.json(result);
  } catch (err) { handleError(err, res, next); }
});

router.delete('/reservations/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cancelled = await reservationService.adminCancelReservation(
      asString(req.params.id), req.user!.clubId!,
    );
    res.json(cancelled);
  } catch (err) { handleError(err, res, next); }
});

export default router;
