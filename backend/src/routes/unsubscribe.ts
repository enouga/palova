import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { verifyUnsubscribeToken } from '../services/unsubscribeToken';

// Désinscription en un clic depuis un email de diffusion (club.broadcast) — route publique,
// sans login, appelée directement depuis un client mail. Le token est un HMAC signé
// (cf. unsubscribeToken.ts), pas un JWT : pas d'expiration, pas de garde d'auth ici.
const router = Router();

const page = (title: string, body: string, extra = '') =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
  `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#1d2433;">` +
  `<h1 style="font-size:20px;">${title}</h1><p style="line-height:1.6;color:#5d6675;">${body}</p>${extra}</body></html>`;

// Désinscription en un clic depuis un email de diffusion — publique, sans login, idempotente.
// L'opt-out est GLOBAL (catégorie CLUB_MESSAGES, canal EMAIL) : se désinscrire coupe les
// emails d'annonces de tous les clubs (choix v1, la préférence n'est pas par club).
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = verifyUnsubscribeToken(String(req.query.token ?? ''));
    if (!userId) {
      res.status(400).send(page('Lien invalide', 'Ce lien de désinscription est invalide ou incomplet.'));
      return;
    }
    const resub = req.query.action === 'resubscribe';
    try {
      await prisma.notificationPreference.upsert({
        where: { userId_category_channel: { userId, category: 'CLUB_MESSAGES', channel: 'EMAIL' } },
        create: { userId, category: 'CLUB_MESSAGES', channel: 'EMAIL', enabled: resub },
        update: { enabled: resub },
      });
    } catch (e) {
      // Compte supprimé (FK userId) → on affiche quand même la confirmation (pas d'énumération
      // d'existence de compte via un message d'erreur différent).
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003')) throw e;
    }
    if (resub) {
      res.send(page('Réinscription confirmée', "Vous recevrez de nouveau les emails d'annonces des clubs."));
      return;
    }
    const resubUrl = `/api/unsubscribe?token=${encodeURIComponent(String(req.query.token))}&action=resubscribe`;
    res.send(page(
      'Vous êtes désinscrit',
      'Vous ne recevrez plus les emails d\'annonces des clubs. Les emails liés à vos réservations et paiements continuent d\'arriver.',
      `<p><a href="${resubUrl}" style="color:#3866b0;">Se réinscrire</a></p>`,
    ));
  } catch (err) {
    next(err as Error);
  }
});

export default router;
