import { Router, Response, NextFunction } from 'express';
import { TournamentService } from '../services/tournament.service';
import { StripeService } from '../services/stripe.service';
import { MessagingService } from '../services/messaging.service';
import { prisma } from '../db/prisma';
import { entryFeeCents } from '../services/registrationPayment';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
const service = new TournamentService();
const messaging = new MessagingService();

const ERROR_STATUS: Record<string, number> = {
  TOURNAMENT_NOT_FOUND:         404,
  TOURNAMENT_NOT_OPEN:          409,
  REGISTRATION_CLOSED:          409,
  REGISTRATION_LOCKED:          409,
  REGISTRATION_NOT_FOUND:       404,
  PARTNER_NOT_FOUND:            404,
  PARTNER_IS_SELF:              400,
  USER_NOT_FOUND:               404,
  MEMBERSHIP_REQUIRED:          403,
  MEMBERSHIP_BLOCKED:           403,
  PHONE_REQUIRED:               422,
  LICENSE_REQUIRED:             422,
  SEX_REQUIRED:                 422,
  GENDER_MISMATCH:              422,
  ALREADY_REGISTERED:           409,
  ONLINE_PAYMENT_NOT_ENABLED:   409,
  STRIPE_NOT_CONFIGURED:        409,
  AMOUNT_TOO_SMALL:             400,
  NOT_PAYABLE:                  409,
  VALIDATION_ERROR:             400,
  CGV_NOT_ACCEPTED:             400,
  NOT_REGISTERED:               403,
  TOURNAMENT_NO_REFEREE:        404,
  REFEREE_NOT_CONTACTABLE:      409,
  NOT_CO_MEMBERS:               403,
  USER_BLOCKED:                 409,
  DM_DISABLED:                  409,
  CANNOT_MESSAGE_SELF:          400,
  CONVERSATION_NOT_FOUND:       404,
  RATE_LIMITED:                 429,
};

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

const handleError = (err: unknown, res: Response, next: NextFunction) => {
  const message = (err as Error).message;
  const status  = ERROR_STATUS[message];
  if (status) {
    const subject = (err as { subject?: string }).subject;
    return void res.status(status).json({ error: message, ...(subject ? { subject } : {}) });
  }
  next(err);
};

// Calendrier national : tournois à venir des clubs opt-in (public, pas d'auth).
// DOIT rester avant `/:id` pour ne pas être capturée comme un id.
router.get('/national', async (_req, res, next) => {
  try { res.json(await service.listNationalTournaments()); }
  catch (err) { handleError(err, res, next); }
});

// Détail public d'un tournoi (pas d'auth ; le DRAFT est masqué par le service).
router.get('/:id', async (req, res, next) => {
  try { res.json(await service.getById(asString(req.params.id))); }
  catch (err) { handleError(err, res, next); }
});

// Liste publique des inscrits (noms seuls ; DRAFT masqué par le service).
router.get('/:id/participants', async (req, res, next) => {
  try { res.json(await service.listParticipants(asString(req.params.id))); }
  catch (err) { handleError(err, res, next); }
});

router.post('/:id/register', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partnerUserId } = req.body;
    if (!partnerUserId) return void res.status(400).json({ error: 'partnerUserId requis' });
    res.status(201).json(await service.register(asString(req.params.id), req.user!.id, asString(partnerUserId)));
  } catch (err) { handleError(err, res, next); }
});

router.patch('/:id/registration', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partnerUserId } = req.body;
    if (!partnerUserId) return void res.status(400).json({ error: 'partnerUserId requis' });
    res.json(await service.changePartner(asString(req.params.id), req.user!.id, asString(partnerUserId)));
  } catch (err) { handleError(err, res, next); }
});

router.delete('/:id/registration', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await service.cancelRegistration(asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Contacter le J/A : réservé aux inscrits, politique du J/A re-vérifiée serveur, puis
// délégation intégrale à la messagerie (gardes DM souveraines : blocage, opt-out, rate-limit).
// Le userId du J/A n'est jamais dans le payload public — il ne sort que via la conversation.
router.post('/:id/contact-referee', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { refereeUserId, clubSlug } = await service.assertRefereeContactable(asString(req.params.id), req.user!.id);
    res.json(await messaging.getOrCreateConversation(req.user!.id, refereeUserId, clubSlug));
  } catch (err) { handleError(err, res, next); }
});

// Créer l'intent (paiement ou empreinte) pour une inscription DUE de l'appelant.
router.post('/:id/registrations/:regId/intent', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const regId = asString(req.params.regId);
    const reg = await prisma.tournamentRegistration.findUnique({
      where: { id: regId },
      select: {
        captainUserId: true, status: true, paymentStatus: true, paymentDeadline: true,
        tournament: { select: { clubId: true, entryFee: true, club: { select: { stripeAccountId: true } } } },
      },
    });
    if (!reg) return void res.status(404).json({ error: 'REGISTRATION_NOT_FOUND' });
    if (reg.captainUserId !== req.user!.id) return void res.status(403).json({ error: 'UNAUTHORIZED' });
    if (reg.paymentStatus !== 'DUE') return void res.status(409).json({ error: 'NOT_PAYABLE' });

    // L'acceptation des CGV du club précède tout paiement CB (pattern confirmReservation).
    if (req.body?.cgvAccepted !== true) return void res.status(400).json({ error: 'CGV_NOT_ACCEPTED' });
    await prisma.tournamentRegistration.updateMany({
      where: { id: regId, cgvAcceptedAt: null },
      data: { cgvAcceptedAt: new Date() },
    });

    const svc = new StripeService();
    const clubId = reg.tournament.clubId;
    if (reg.status === 'CONFIRMED') {
      const amountCents = entryFeeCents(reg.tournament.entryFee);
      if (amountCents < 50) return void res.status(400).json({ error: 'AMOUNT_TOO_SMALL' });
      const r = await svc.createRegistrationPaymentIntent({ clubId, userId: req.user!.id, registrationId: regId, kind: 'tournament', amountCents });
      return void res.json({ ...r, type: 'payment', stripeAccountId: reg.tournament.club.stripeAccountId });
    }
    const r = await svc.createRegistrationSetupIntent({ clubId, userId: req.user!.id, registrationId: regId, kind: 'tournament' });
    return void res.json({ ...r, type: 'setup', stripeAccountId: reg.tournament.club.stripeAccountId });
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
