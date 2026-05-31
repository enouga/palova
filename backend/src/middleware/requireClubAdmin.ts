import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

/**
 * À utiliser APRÈS authMiddleware (qui pose req.user).
 * Refuse l'accès si l'utilisateur n'est pas gestionnaire d'un club.
 * Après ce middleware, req.user.clubId est garanti non-null.
 */
export function requireClubAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Token manquant' });
    return;
  }
  if (req.user.role !== 'CLUB_ADMIN' || !req.user.clubId) {
    res.status(403).json({ error: 'FORBIDDEN' });
    return;
  }
  next();
}
