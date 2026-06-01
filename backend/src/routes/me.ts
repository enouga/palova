import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../db/prisma';
import { ReservationService } from '../services/reservation.service';

const router = Router();
const reservationService = new ReservationService();

// Clubs gérés par l'utilisateur connecté (pour le gating UX du back-office).
router.get('/clubs', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const memberships = await prisma.clubMember.findMany({
      where: { userId: req.user!.id },
      select: {
        role: true,
        club: { select: { id: true, slug: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(memberships.map((m) => ({ clubId: m.club.id, slug: m.club.slug, name: m.club.name, role: m.role })));
  } catch (err) { next(err); }
});

// Réservations du joueur connecté.
router.get('/reservations', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await reservationService.listUserReservations(req.user!.id));
  } catch (err) { next(err); }
});

export default router;
