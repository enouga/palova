import { Request, Response, NextFunction } from 'express';
import { assertRateLimit } from '../services/rateLimit';

// Une dimension de limitation : par IP (anti-spray) ou par email (anti-brute-force ciblé).
export type RateRule = { bucket: string; by: 'ip' | 'email'; max: number; windowSec: number };

function keyFor(req: Request, by: 'ip' | 'email'): string {
  if (by === 'ip') return req.ip || req.socket.remoteAddress || 'unknown';
  const email = (req.body as { email?: unknown })?.email;
  return typeof email === 'string' ? email.toLowerCase().trim() : '';
}

/**
 * Middleware de limitation de débit pour les routes non authentifiées (auth).
 * Chaque règle est vérifiée indépendamment ; une clé absente (ex. email non fourni)
 * ignore simplement sa dimension. Le dépassement RÉEL renvoie 429 `RATE_LIMITED` ;
 * `assertRateLimit` fail-open si Redis est indisponible (jamais de blocage sur panne).
 */
export function rateLimit(...rules: RateRule[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      for (const r of rules) {
        const key = keyFor(req, r.by);
        if (!key) continue;
        await assertRateLimit(`auth:${r.bucket}:${r.by}`, key, r.max, r.windowSec);
      }
      next();
    } catch (err) {
      if (err instanceof Error && err.message === 'RATE_LIMITED') {
        res.status(429).json({ error: 'RATE_LIMITED' });
        return;
      }
      next(err);
    }
  };
}
