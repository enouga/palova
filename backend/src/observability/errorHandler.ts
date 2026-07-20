import { Request, Response, NextFunction } from 'express';
import { reportError } from './reportError';

/**
 * Gestionnaire d'erreur Express terminal. Remonte l'exception (avec route/méthode/userId,
 * jamais l'email — RGPD) vers GlitchTip, puis rend le 500 générique habituel. Seules les
 * vraies exceptions passent ici : les erreurs métier 4xx sont traduites en amont par les
 * routes et n'atteignent jamais ce middleware (donc ne polluent pas le quota).
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  reportError(err, {
    source: 'express',
    route: req.originalUrl,
    method: req.method,
    userId: (req as { user?: { id?: string } }).user?.id,
  });
  res.status(500).json({ error: 'Erreur interne du serveur' });
}
