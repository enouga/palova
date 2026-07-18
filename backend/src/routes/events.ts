import { Router, Response, NextFunction } from 'express';
import { EventService } from '../services/event.service';
import { StripeService } from '../services/stripe.service';
import { prisma } from '../db/prisma';
import { entryFeeCents } from '../services/registrationPayment';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
const service = new EventService();

const ERROR_STATUS: Record<string, number> = {
  EVENT_NOT_FOUND:              404,
  EVENT_NOT_OPEN:               409,
  REGISTRATION_CLOSED:          409,
  REGISTRATION_LOCKED:          409,
  REGISTRATION_NOT_FOUND:       404,
  MEMBERSHIP_REQUIRED:          403,
  MEMBERSHIP_BLOCKED:           403,
  ALREADY_REGISTERED:           409,
  ONLINE_PAYMENT_NOT_ENABLED:   409,
  STRIPE_NOT_CONFIGURED:        409,
  AMOUNT_TOO_SMALL:             400,
  NOT_PAYABLE:                  409,
  VALIDATION_ERROR:             400,
  CGV_NOT_ACCEPTED:             400,
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

// Détail public d'un événement (pas d'auth ; le DRAFT est masqué par le service).
router.get('/:id', async (req, res, next) => {
  try { res.json(await service.getById(asString(req.params.id))); }
  catch (err) { handleError(err, res, next); }
});

// Liste publique des inscrits (noms + avatar, jamais l'e-mail).
router.get('/:id/participants', async (req, res, next) => {
  try { res.json(await service.listParticipants(asString(req.params.id))); }
  catch (err) { handleError(err, res, next); }
});

router.post('/:id/register', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await service.register(asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

router.delete('/:id/registration', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await service.cancelRegistration(asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Créer l'intent (paiement ou empreinte) pour une inscription DUE de l'appelant.
router.post('/:id/registrations/:regId/intent', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const regId = asString(req.params.regId);
    const reg = await prisma.eventRegistration.findUnique({
      where: { id: regId },
      select: {
        userId: true, status: true, paymentStatus: true, paymentDeadline: true,
        event: { select: { clubId: true, price: true, club: { select: { stripeAccountId: true } } } },
      },
    });
    if (!reg) return void res.status(404).json({ error: 'REGISTRATION_NOT_FOUND' });
    if (reg.userId !== req.user!.id) return void res.status(403).json({ error: 'UNAUTHORIZED' });
    if (reg.paymentStatus !== 'DUE') return void res.status(409).json({ error: 'NOT_PAYABLE' });

    // L'acceptation des CGV du club précède tout paiement CB (pattern confirmReservation).
    if (req.body?.cgvAccepted !== true) return void res.status(400).json({ error: 'CGV_NOT_ACCEPTED' });
    await prisma.eventRegistration.updateMany({
      where: { id: regId, cgvAcceptedAt: null },
      data: { cgvAcceptedAt: new Date() },
    });

    const svc = new StripeService();
    const clubId = reg.event.clubId;
    if (reg.status === 'CONFIRMED') {
      const amountCents = entryFeeCents(reg.event.price);
      if (amountCents < 50) return void res.status(400).json({ error: 'AMOUNT_TOO_SMALL' });
      const r = await svc.createRegistrationPaymentIntent({ clubId, userId: req.user!.id, registrationId: regId, kind: 'event', amountCents });
      return void res.json({ ...r, type: 'payment', stripeAccountId: reg.event.club.stripeAccountId });
    }
    const r = await svc.createRegistrationSetupIntent({ clubId, userId: req.user!.id, registrationId: regId, kind: 'event' });
    return void res.json({ ...r, type: 'setup', stripeAccountId: reg.event.club.stripeAccountId });
  } catch (err) { handleError(err, res, next); }
});

// Confirmer le paiement côté client (le webhook le fait aussi ; idempotent).
router.post('/:id/registrations/:regId/confirm-payment', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { stripePaymentIntentId } = req.body;
    if (!stripePaymentIntentId) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    res.json(await service.confirmRegistrationPayment(asString(req.params.regId), { stripePaymentIntentId: asString(stripePaymentIntentId) }));
  } catch (err) { handleError(err, res, next); }
});

export default router;
