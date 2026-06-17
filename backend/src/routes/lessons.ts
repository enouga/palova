import { Router, Response, NextFunction } from 'express';
import { lessonService } from '../services/lesson.service';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

const ERROR_STATUS: Record<string, number> = {
  LESSON_NOT_FOUND:      404,
  SELF_ENROLL_DISABLED:  403,
  MEMBERSHIP_BLOCKED:    403,
  ALREADY_ENROLLED:      409,
  ENROLLMENT_NOT_FOUND:  404,
  ENROLLMENT_LOCKED:     409,
  CLUB_NOT_FOUND:        404,
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

// Détail public d'une séance (pas d'auth).
router.get('/:id', async (req, res, next) => {
  try { res.json(await lessonService.getPublicLesson(asString(req.params.id))); }
  catch (err) { handleError(err, res, next); }
});

// Liste publique des inscrits (pas d'auth).
router.get('/:id/participants', async (req, res, next) => {
  try { res.json(await lessonService.listParticipants(asString(req.params.id))); }
  catch (err) { handleError(err, res, next); }
});

// Auto-inscription du joueur connecté à une séance.
router.post('/:id/enrollment', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await lessonService.enroll(asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Annulation de l'inscription du joueur connecté.
router.delete('/:id/enrollment', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await lessonService.cancelEnrollment(asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

export default router;
