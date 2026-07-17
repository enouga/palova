import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma';

export interface AuthRequest extends Request {
  user?: { id: string; email: string };
}

interface TokenPayload { id: string; email: string; tokenVersion?: number }

/** Compte supprimé/mot de passe réinitialisé après l'émission du token → révoqué
 *  (cf. audit pré-MEP §2.2 : l'identité n'était jamais revérifiée en base pendant
 *  les 7 j de validité du JWT). Tokens émis avant l'ajout du champ = version 0. */
async function tokenRevoked(payload: TokenPayload): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: payload.id }, select: { tokenVersion: true, deletedAt: true } });
  if (!user || user.deletedAt) return true;
  // ?? 0 des deux côtés : tolère les fixtures de test écrites à la main sans tokenVersion.
  return (payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0);
}

/**
 * Vérifie le JWT et pose req.user = { id, email }.
 * Le rôle/club n'est PLUS dans le token : il se résout par ClubMember
 * (voir requireClubMember), car un utilisateur peut gérer plusieurs clubs.
 */
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token manquant' });
    return;
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as TokenPayload;
    if (await tokenRevoked(payload)) {
      res.status(401).json({ error: 'Token invalide' });
      return;
    }
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
}

/**
 * Authentification facultative : pose req.user si un Bearer valide est présent,
 * sinon laisse passer en anonyme (jamais de 401). Pour les lectures publiques.
 */
export async function optionalAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as TokenPayload;
      if (!(await tokenRevoked(payload))) {
        req.user = { id: payload.id, email: payload.email };
      }
    } catch { /* token invalide → on continue en anonyme */ }
  }
  next();
}
