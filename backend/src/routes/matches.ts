import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { MatchService } from '../services/match.service';

const router = Router();
const matchService = new MatchService();

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

export function matchError(err: unknown, res: Response, next: NextFunction): void {
  const map: Record<string, number> = {
    VALIDATION_ERROR: 400, RESERVATION_NOT_FOUND: 404, NOT_A_COURT_RESERVATION: 400,
    NOT_A_PARTICIPANT: 403, NEEDS_FOUR_PLAYERS: 400, MATCH_NOT_PLAYED_YET: 400,
    MATCH_ALREADY_EXISTS: 409, MATCH_NOT_FOUND: 404, NOT_A_MATCH_PLAYER: 403, MATCH_NOT_PENDING: 409,
    LEVEL_SYSTEM_DISABLED: 403, FORBIDDEN: 403, MATCH_NOT_DISPUTED: 409, RATE_LIMITED: 429,
  };
  if (err instanceof Error && map[err.message]) { res.status(map[err.message]).json({ error: err.message }); return; }
  next(err as Error);
}

router.post('/:id/confirm', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { await matchService.confirm(asString(req.params.id), req.user!.id); res.json({ ok: true }); }
  catch (err) { matchError(err, res, next); }
});

router.post('/:id/dispute', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = req.body as { message?: unknown };
    const message = typeof b.message === 'string' ? b.message : '';
    await matchService.dispute(asString(req.params.id), req.user!.id, message);
    res.json({ ok: true });
  } catch (err) { matchError(err, res, next); }
});

router.post('/:id/remind', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await matchService.remind(asString(req.params.id), req.user!.id)); }
  catch (err) { matchError(err, res, next); }
});

router.get('/:id/comments', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await matchService.listComments(asString(req.params.id), req.user!.id)); }
  catch (err) { matchError(err, res, next); }
});

router.post('/:id/comments', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = req.body as { body?: unknown };
    const body = typeof b.body === 'string' ? b.body : '';
    await matchService.addComment(asString(req.params.id), req.user!.id, body);
    res.json({ ok: true });
  } catch (err) { matchError(err, res, next); }
});

export default router;
