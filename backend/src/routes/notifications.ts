import { Router, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../db/prisma';
import { SSEService } from '../services/sse.service';
import { NotificationCategory, NotificationChannel } from '@prisma/client';

const router = Router();
const PAGE = 20;

// Liste paginée (cursor = createdAt ISO de la dernière notif reçue).
router.get('/notifications', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cursor = typeof req.query.cursor === 'string' ? new Date(req.query.cursor) : null;
    const items = await prisma.notification.findMany({
      where: { userId: req.user!.id, ...(cursor && !isNaN(cursor.getTime()) ? { createdAt: { lt: cursor } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: PAGE + 1,
    });
    const hasMore = items.length > PAGE;
    const page = hasMore ? items.slice(0, PAGE) : items;
    res.json({
      items: page,
      nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    });
  } catch (err) { next(err); }
});

router.get('/notifications/unread-count', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const count = await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } });
    res.json({ count });
  } catch (err) { next(err); }
});

router.post('/notifications/read-all', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/notifications/:id/read', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { id: String(req.params.id), userId: req.user!.id },
      data: { readAt: new Date() },
    });
    if (result.count === 0) return void res.status(404).json({ error: 'NOTIFICATION_NOT_FOUND' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Préférences : on renvoie les écarts au défaut (lignes stockées).
router.get('/notification-preferences', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const preferences = await prisma.notificationPreference.findMany({
      where: { userId: req.user!.id },
      select: { category: true, channel: true, enabled: true },
    });
    res.json({ preferences });
  } catch (err) { next(err); }
});

const CATEGORIES = Object.values(NotificationCategory);
const CHANNELS = Object.values(NotificationChannel);

// Remplace l'ensemble des préférences (delete + recréation). Le verrou CLUB_MESSAGES+INAPP
// est filtré (jamais stocké à false : il est forcé ON côté résolution).
router.put('/notification-preferences', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { preferences?: Array<{ category: string; channel: string; enabled: boolean }> };
    const incoming = Array.isArray(body.preferences) ? body.preferences : [];
    const rows = incoming.filter((p) =>
      CATEGORIES.includes(p.category as NotificationCategory) &&
      CHANNELS.includes(p.channel as NotificationChannel) &&
      typeof p.enabled === 'boolean' &&
      !(p.category === 'CLUB_MESSAGES' && p.channel === 'INAPP'),
    );
    await prisma.$transaction([
      prisma.notificationPreference.deleteMany({ where: { userId: req.user!.id } }),
      ...(rows.length
        ? [prisma.notificationPreference.createMany({
            data: rows.map((p) => ({
              userId: req.user!.id,
              category: p.category as NotificationCategory,
              channel: p.channel as NotificationChannel,
              enabled: p.enabled,
            })),
          })]
        : []),
    ]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// SSE : EventSource ne peut pas poser d'en-tête Authorization → token en query.
router.get('/notifications/stream', (req: AuthRequest, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  let userId: string;
  try {
    userId = (jwt.verify(token, process.env.JWT_SECRET!) as { id: string }).id;
  } catch {
    return void res.status(401).end();
  }
  SSEService.getInstance().addUserClient(userId, res);
});

export default router;
