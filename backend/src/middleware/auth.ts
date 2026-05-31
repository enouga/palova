import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type UserRole = 'CLIENT' | 'CLUB_ADMIN';

export interface AuthRequest extends Request {
  user?: { id: string; email: string; role: UserRole; clubId: string | null };
}

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token manquant' });
    return;
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      email: string;
      role?: UserRole;
      clubId?: string | null;
    };
    req.user = {
      id: payload.id,
      email: payload.email,
      // Tokens émis avant l'ajout du rôle n'ont pas ces champs → défauts sûrs.
      role: payload.role ?? 'CLIENT',
      clubId: payload.clubId ?? null,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
}
