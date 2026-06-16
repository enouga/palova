import { Router, Response, NextFunction } from 'express';
import { ReservationService } from '../services/reservation.service';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { MatchService } from '../services/match.service';
import { matchError } from './matches';

const router = Router();
const reservationService = new ReservationService();
const matchService = new MatchService();

const ERROR_STATUS: Record<string, number> = {
  SLOT_ALREADY_HELD:        409,
  SLOT_NOT_AVAILABLE:       409,
  RESERVATION_NOT_FOUND:    404,
  RESERVATION_NOT_PENDING:  409,
  SLOT_NO_LONGER_AVAILABLE: 409,
  UNAUTHORIZED:             403,
  ALREADY_CANCELLED:        409,
  BOOKING_TOO_FAR:          409,
  MEMBERSHIP_BLOCKED:       403,
  RESERVATION_NOT_ACTIVE:   409,
  RESERVATION_IN_PAST:      409,
  OUT_OF_HOURS:             409,
  RESOURCE_NOT_FOUND:       404,
  CLUB_MISMATCH:            403,
  VALIDATION_ERROR:         400,
  INSUFFICIENT_BALANCE:     409,
  PACKAGE_NOT_FOUND:        404,
  ONLINE_PAYMENT_REQUIRED:   402,
  CARD_FINGERPRINT_REQUIRED: 402,
  PAYMENT_NOT_SUCCEEDED:     402,
  SETUP_NOT_SUCCEEDED:       402,
  QUOTA_PEAK_REACHED:       409,
  QUOTA_OFFPEAK_REACHED:    409,
  TOO_MANY_PLAYERS:         409,
  PARTNER_NOT_MEMBER:       403,
  PARTNER_DUPLICATE:        400,
  PLAYER_CHANGE_TOO_LATE:   409,
  CANCELLATION_TOO_LATE:    409,
  MEMBER_NOT_FOUND:         404,
  PARTICIPANT_NOT_FOUND:    404,
  CANNOT_REMOVE_ORGANIZER:  409,
  RESERVATION_HAS_NO_MEMBER: 409,
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

router.post('/hold', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { resourceId, startTime, endTime, partnerUserIds, visibility, targetLevelMin, targetLevelMax } = req.body;
    if (!resourceId || !startTime || !endTime) {
      return void res.status(400).json({ error: 'resourceId, startTime, endTime requis' });
    }
    if (visibility !== undefined && visibility !== 'PRIVATE' && visibility !== 'PUBLIC') {
      return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    }
    if (partnerUserIds !== undefined && (!Array.isArray(partnerUserIds) || partnerUserIds.some((id: unknown) => typeof id !== 'string'))) {
      return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    }
    // Validate optional level range: each must be in [0,8], and min <= max if both provided.
    if (targetLevelMin !== undefined && targetLevelMin !== null) {
      if (typeof targetLevelMin !== 'number' || targetLevelMin < 0 || targetLevelMin > 8) {
        return void res.status(400).json({ error: 'VALIDATION_ERROR' });
      }
    }
    if (targetLevelMax !== undefined && targetLevelMax !== null) {
      if (typeof targetLevelMax !== 'number' || targetLevelMax < 0 || targetLevelMax > 8) {
        return void res.status(400).json({ error: 'VALIDATION_ERROR' });
      }
    }
    if (targetLevelMin !== undefined && targetLevelMin !== null && targetLevelMax !== undefined && targetLevelMax !== null) {
      if (targetLevelMin > targetLevelMax) {
        return void res.status(400).json({ error: 'VALIDATION_ERROR' });
      }
    }
    const reservation = await reservationService.holdSlot({
      resourceId, userId: req.user!.id,
      startTime: new Date(startTime),
      endTime:   new Date(endTime),
      partnerUserIds, visibility,
      targetLevelMin: (targetLevelMin !== undefined && targetLevelMin !== null) ? Number(targetLevelMin) : null,
      targetLevelMax: (targetLevelMax !== undefined && targetLevelMax !== null) ? Number(targetLevelMax) : null,
    });
    res.status(201).json(reservation);
  } catch (err) { handleError(err, res, next); }
});

router.post('/:id/confirm', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const packageId = req.body?.paymentSource?.packageId;
    const confirmed = await reservationService.confirmReservation(
      asString(req.params.id), req.user!.id,
      {
        paymentSource: typeof packageId === 'string' && packageId ? { packageId } : undefined,
        stripePaymentIntentId: typeof req.body?.stripePaymentIntentId === 'string' ? req.body.stripePaymentIntentId : undefined,
        stripeSetupIntentId:   typeof req.body?.stripeSetupIntentId   === 'string' ? req.body.stripeSetupIntentId   : undefined,
      },
    );
    res.json(confirmed);
  } catch (err) { handleError(err, res, next); }
});

router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cancelled = await reservationService.cancelReservation(asString(req.params.id), req.user!.id);
    res.json(cancelled);
  } catch (err) { handleError(err, res, next); }
});

// Joueurs d'une réservation (organisateur uniquement) : lecture.
router.get('/:id/players', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await reservationService.getOwnReservationPlayers(asString(req.params.id), req.user!.id));
  } catch (err) { handleError(err, res, next); }
});

// Ajoute un membre du club à sa partie (répartit les parts).
router.post('/:id/players', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const memberUserId = asString(req.body?.memberUserId);
    if (!memberUserId) return void res.status(400).json({ error: 'memberUserId requis' });
    res.json(await reservationService.addOwnReservationParticipant(asString(req.params.id), req.user!.id, memberUserId));
  } catch (err) { handleError(err, res, next); }
});

// Retire un joueur de sa partie (recalcule les parts).
router.delete('/:id/players/:participantId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await reservationService.removeOwnReservationParticipant(asString(req.params.id), req.user!.id, asString(req.params.participantId)));
  } catch (err) { handleError(err, res, next); }
});

// Saisie du résultat d'un match depuis une réservation de terrain.
router.post('/:id/match', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { teams, sets } = req.body;
    const match = await matchService.createFromReservation(asString(req.params.id), req.user!.id, { teams, sets, now: new Date() });
    res.status(201).json({ id: match.id, status: match.status });
  } catch (err) { matchError(err, res, next); }
});

export default router;
