import { Router, Request, Response, NextFunction } from 'express';
import { ClubPageKind } from '@prisma/client';
import { authMiddleware, optionalAuth, AuthRequest } from '../middleware/auth';
import { resolvePreferredSportKey } from '../services/rating/preferredSport';
import { ClubService } from '../services/club.service';
import { ClubPageService } from '../services/clubPage.service';
import { AvailabilityService } from '../services/availability.service';
import { AnnouncementService } from '../services/announcement.service';
import { SponsorService } from '../services/sponsor.service';
import { TournamentService } from '../services/tournament.service';
import { EventService } from '../services/event.service';
import { lessonService } from '../services/lesson.service';
import { PackageService } from '../services/package.service';
import { SubscriptionService } from '../services/subscription.service';
import jwt from 'jsonwebtoken';
import { OpenMatchService } from '../services/openMatch.service';
import { OpenMatchChatService } from '../services/openMatchChat.service';
import { ReservationService } from '../services/reservation.service';
import { StripeService } from '../services/stripe.service';
import { PaymentMethodService } from '../services/paymentMethod.service';
import { PaymentHistoryService } from '../services/paymentHistory.service';
import { SSEService } from '../services/sse.service';
import { iconService } from '../services/icon.service';
import { capacityFor } from '../utils/courtType';
import { prisma } from '../db/prisma';

const router = Router();
const clubService = new ClubService();
const clubPageService = new ClubPageService();
const availabilityService = new AvailabilityService();

const PAGE_KINDS = new Set<ClubPageKind>(['CGV', 'MENTIONS_LEGALES', 'CONFIDENTIALITE', 'OFFRES']);
const announcementService = new AnnouncementService();
const sponsorService = new SponsorService();
const tournamentService = new TournamentService();
const eventService = new EventService();
const packageService = new PackageService();
const openMatchService = new OpenMatchService();
const openMatchChatService = new OpenMatchChatService();
const reservationService = new ReservationService();
const subscriptionService = new SubscriptionService();
const paymentMethodService = new PaymentMethodService();
const paymentHistoryService = new PaymentHistoryService();

const ERROR_STATUS: Record<string, number> = {
  VALIDATION_ERROR:      400,
  SLUG_RESERVED:         400,
  SLUG_TAKEN:            409,
  CLUB_NOT_FOUND:        404,
  SPORT_NOT_FOUND:       404,
  PAGE_NOT_FOUND:        404,
  MEMBERSHIP_REQUIRED:   403,
  MEMBERSHIP_BLOCKED:    403,
  LEVEL_SYSTEM_DISABLED: 403,
  RESERVATION_NOT_FOUND: 404,
  CLUB_MISMATCH:         403,
  MATCH_NOT_JOINABLE:    409,
  MATCH_FULL:            409,
  MATCH_IN_PAST:         409,
  ALREADY_JOINED:        409,
  ORGANIZER_CANNOT_LEAVE: 403,
  NOT_ORGANIZER:          403,
  CANNOT_REMOVE_ORGANIZER: 409,
  PARTICIPANT_NOT_FOUND: 404,
  SUBSCRIPTION_NOT_FOUND: 404,
  ALREADY_PARTICIPANT:   409,
  CHAT_FORBIDDEN:        403,
  NOT_ALLOWED:           403,
  MESSAGE_NOT_FOUND:     404,
};

const handleError = (err: unknown, res: Response, next: NextFunction) => {
  const message = (err as Error).message;
  const status  = ERROR_STATUS[message];
  if (status) return void res.status(status).json({ error: message });
  next(err);
};

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

// Résolution d'un libellé de sous-domaine : slug actuel ({moved:false}) ou alias historique ({moved:true}).
// Préfixe `_` : slugify() ne produit jamais d'underscore → aucune collision avec un vrai slug.
// Déclarée en PREMIER pour ne pas être interceptée par les routes /:slug/*.
router.get('/_resolve/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await clubService.resolveSlug(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});

// Auto-inscription : crée un club, l'auteur devient OWNER.
router.post('/', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, slug, address, city, timezone } = req.body;
    const club = await clubService.createClub({ ownerId: req.user!.id, name, slug, address, city, timezone });
    res.status(201).json(club);
  } catch (err) { handleError(err, res, next); }
});

// Annuaire public — filtres optionnels sport (key), city (ville ou région), q (nom),
// region (exact), lat/lng (tri par distance).
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const latRaw = asString(req.query.lat), lngRaw = asString(req.query.lng);
    const lat = latRaw ? Number(latRaw) : undefined;
    const lng = lngRaw ? Number(lngRaw) : undefined;
    const clubs = await clubService.listClubs({
      sport:  asString(req.query.sport) || undefined,
      city:   asString(req.query.city) || undefined,
      q:      asString(req.query.q) || undefined,
      region: asString(req.query.region) || undefined,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
    });
    res.json(clubs);
  } catch (err) { handleError(err, res, next); }
});

// Disponibilités de tous les terrains du club pour une date+durée (vue planning).
router.get('/:slug/availability', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const date = asString(req.query.date);
    const duration = parseInt(asString(req.query.duration), 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return void res.status(400).json({ error: 'date doit être YYYY-MM-DD' });
    if (isNaN(duration) || duration <= 0 || duration > 240) return void res.status(400).json({ error: 'duration invalide' });

    const club = await prisma.club.findUnique({ where: { slug: asString(req.params.slug) }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') return void res.status(404).json({ error: 'CLUB_NOT_FOUND' });

    const clubSportId = req.query.clubSportId ? asString(req.query.clubSportId) : undefined;
    res.json(await availabilityService.getClubAvailability(club.id, date, duration, clubSportId));
  } catch (err) { handleError(err, res, next); }
});

// Auto-inscription du joueur connecté à un club (adhésion automatique, idempotente).
router.post('/:slug/join', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const club = await prisma.club.findUnique({ where: { slug: asString(req.params.slug) }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') return void res.status(404).json({ error: 'CLUB_NOT_FOUND' });
    await clubService.ensureMembership(req.user!.id, club.id);
    res.status(201).json({ ok: true });
  } catch (err) { handleError(err, res, next); }
});

// NB : l'abonnement (fenêtre élargie) est un attribut de la fiche-membre, géré par
// le club (back-office, /:clubId/admin/members). Pas d'auto-abonnement côté joueur.

// Annonces publiées d'un club (mur d'annonces public).
router.get('/:slug/announcements', async (req, res, next) => {
  try { res.json(await announcementService.listPublic(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});

// Sponsors actifs d'un club (affichage public).
router.get('/:slug/sponsors', async (req, res, next) => {
  try { res.json(await sponsorService.listPublic(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});

// Tournois publiés d'un club (à venir).
router.get('/:slug/tournaments', async (req, res, next) => {
  try { res.json(await tournamentService.listPublicByClubSlug(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});

// Animations publiées d'un club (à venir).
router.get('/:slug/events', async (req, res, next) => {
  try { res.json(await eventService.listPublicByClubSlug(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});

// Séances publiées d'un club (allowSelfEnroll=true, à venir).
router.get('/:slug/lessons', async (req, res, next) => {
  try { res.json(await lessonService.listPublicByClubSlug(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});

// FAQ publique : socle Palova interpolé + items publiés du club.
router.get('/:slug/faq', async (req, res, next) => {
  try { res.json(await clubPageService.getPublicFaq(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});

// Page de contenu publiée (CGV, mentions légales, confidentialité, offres).
router.get('/:slug/pages/:kind', async (req, res, next) => {
  try {
    const kind = asString(req.params.kind).toUpperCase() as ClubPageKind;
    if (!PAGE_KINDS.has(kind)) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    res.json(await clubPageService.getPublicPage(asString(req.params.slug), kind));
  } catch (err) { handleError(err, res, next); }
});

// Recherche de membres du club par nom (réservé aux membres ; pour choisir un coéquipier de tournoi).
router.get('/:slug/members/search', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await clubService.searchMembers(asString(req.params.slug), req.user!.id, asString(req.query.q))); }
  catch (err) { handleError(err, res, next); }
});

// Classement des joueurs du club par niveau (réservé aux membres ; opt-in pour y figurer).
router.get('/:slug/leaderboard', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sport = await resolvePreferredSportKey(req.user!.id, req.query.sport);
    res.json(await clubService.clubLeaderboard(asString(req.params.slug), req.user!.id, sport));
  } catch (err) { handleError(err, res, next); }
});

// Parties ouvertes du club : lecture PUBLIQUE (membre, non-membre ou anonyme).
router.get('/:slug/open-matches', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.listOpenMatches(asString(req.params.slug), req.user?.id ?? null)); }
  catch (err) { handleError(err, res, next); }
});

// Compteur de messages de chat non lus du club (badge de l'onglet « Parties »).
// ⚠️ Déclaré AVANT toute route GET `/:slug/open-matches/:id...` pour ne pas être capturé comme un id.
router.get('/:slug/open-matches/unread-count', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchChatService.unreadCount(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/:slug/open-matches/:id/join', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.joinOpenMatch(asString(req.params.slug), asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

router.delete('/:slug/open-matches/:id/join', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.leaveOpenMatch(asString(req.params.slug), asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

router.delete('/:slug/open-matches/:id/participants/:userId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.removeOpenMatchPlayer(asString(req.params.slug), asString(req.params.id), req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});

router.post('/:slug/open-matches/:id/participants', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.addOpenMatchPlayer(asString(req.params.slug), asString(req.params.id), req.user!.id, asString((req.body as { userId?: unknown }).userId))); }
  catch (err) { handleError(err, res, next); }
});

// « Ça m'intéresse » sur une partie ouverte (n'occupe pas de place, débloque le chat).
router.post('/:slug/open-matches/:id/interest', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.setInterested(asString(req.params.slug), asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});
router.delete('/:slug/open-matches/:id/interest', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.removeInterested(asString(req.params.slug), asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Chat de la partie ouverte (inscrits + intéressés).
router.get('/:slug/open-matches/:id/chat/messages', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchChatService.listMessages(asString(req.params.slug), asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});
router.post('/:slug/open-matches/:id/chat/messages', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = typeof (req.body as { body?: unknown }).body === 'string' ? (req.body as { body: string }).body : '';
    res.json(await openMatchChatService.postMessage(asString(req.params.slug), asString(req.params.id), req.user!.id, body));
  } catch (err) { handleError(err, res, next); }
});
router.delete('/:slug/open-matches/:id/chat/messages/:messageId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchChatService.deleteMessage(asString(req.params.slug), asString(req.params.id), req.user!.id, asString(req.params.messageId))); }
  catch (err) { handleError(err, res, next); }
});

// Marque lus les messages de chat d'une partie pour l'utilisateur.
router.post('/:slug/open-matches/:id/chat/read', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchChatService.markRead(asString(req.params.slug), asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Flux SSE du chat. EventSource ne pose pas d'en-tête Authorization → token en query, puis garde d'accès.
router.get('/:slug/open-matches/:id/chat/stream', async (req: AuthRequest, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  let userId: string;
  try { userId = (jwt.verify(token, process.env.JWT_SECRET!) as { id: string }).id; }
  catch { return void res.status(401).end(); }
  try { await openMatchChatService.assertChatAccessPublic(asString(req.params.slug), asString(req.params.id), userId); }
  catch { return void res.status(403).end(); }
  SSEService.getInstance().addMatchClient(asString(req.params.id), userId, res);
});

// Adhésion du joueur connecté à ce club (licence / statut).
router.get('/:slug/me/membership', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await clubService.getMyMembership(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Le joueur renseigne / corrige sa propre licence (n° adhérent) pour ce club.
router.patch('/:slug/me/membership', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { membershipNo } = req.body;
    res.json(await clubService.setMyMembership(asString(req.params.slug), req.user!.id, asString(membershipNo)));
  } catch (err) { handleError(err, res, next); }
});

// Soldes prépayés (carnets / porte-monnaie) du joueur connecté sur ce club.
router.get('/:slug/me/packages', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await packageService.listMyPackagesBySlug(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Abonnements actifs du joueur connecté sur ce club.
router.get('/:slug/me/subscriptions', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await subscriptionService.listMySubscriptionsBySlug(asString(req.params.slug), req.user!.id)); }
  catch (e) { handleError(e, res, next); }
});

// État des quotas de réservation du joueur connecté sur ce club (compteur « 3/5 »).
router.get('/:slug/me/quota-status', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await reservationService.getMyQuotaStatus(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Le club a-t-il déjà une carte enregistrée pour le joueur (empreinte no-show) ?
router.get('/:slug/me/card-status', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await clubService.getMyCardStatus(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Carte enregistrée du joueur (marque + 4 chiffres + expiration).
router.get('/:slug/me/payment-method', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await paymentMethodService.getMyPaymentMethod(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Retrait de la carte enregistrée du joueur.
router.delete('/:slug/me/payment-method', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await paymentMethodService.removeMyPaymentMethod(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Historique des paiements du joueur sur ce club.
router.get('/:slug/me/payments', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await paymentHistoryService.listMyPaymentsBySlug(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Icône PWA du club (référencée par le manifest) — public, PNG, repli Palova.
router.get('/:slug/icon/:file', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const m = asString(req.params.file).match(/^([a-z0-9-]+)\.png$/);
    const filePath = m ? await iconService.getClubIconPath(asString(req.params.slug), m[1]) : null;
    if (!filePath) { res.status(404).json({ error: 'Icône introuvable' }); return; }
    res.sendFile(filePath, { headers: { 'Cache-Control': 'public, max-age=86400' } });
  } catch (err) { handleError(err, res, next); }
});

// Créer un PaymentIntent ou SetupIntent pour un joueur (paiement/empreinte à la réservation).
router.post('/:slug/stripe/intent', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { reservationId, type, payShare } = req.body;
    if (!reservationId || !['payment', 'setup'].includes(type as string)) {
      return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    }
    const club = await prisma.club.findUnique({ where: { slug: asString(req.params.slug) } });
    if (!club) return void res.status(404).json({ error: 'CLUB_NOT_FOUND' });

    const reservation = await prisma.reservation.findUnique({
      where: { id: asString(reservationId) },
      select: {
        totalPrice: true,
        userId: true,
        resource: {
          select: {
            attributes: true,
            clubSport: { select: { sport: { select: { key: true } } } },
          },
        },
      },
    });
    if (!reservation) return void res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
    if (reservation.userId !== req.user!.id) return void res.status(403).json({ error: 'UNAUTHORIZED' });

    const svc = new StripeService();
    if (type === 'payment') {
      // « Payer ma part » : on n'encaisse en ligne que la part par personne
      // (total ÷ capacité nominale du terrain) ; le reste devient un dû au club.
      const format = (reservation.resource.attributes as { format?: string } | null)?.format;
      const sportKey = reservation.resource.clubSport.sport.key;
      const capacity = capacityFor(sportKey, format);
      const totalCents = Math.round(Number(reservation.totalPrice) * 100);
      const shareCents = Math.round(totalCents / capacity);
      const amountCents = payShare ? shareCents : totalCents;
      if (amountCents < 50) return void res.status(400).json({ error: 'AMOUNT_TOO_SMALL' }); // minimum Stripe : 0,50 €
      const result = await svc.createPaymentIntent({
        clubId: club.id, userId: req.user!.id, reservationId: asString(reservationId), amountCents,
      });
      return void res.json({ ...result, type: 'payment', stripeAccountId: club.stripeAccountId });
    } else {
      const result = await svc.createSetupIntent({
        clubId: club.id, userId: req.user!.id, reservationId: asString(reservationId),
      });
      return void res.json({ ...result, type: 'setup', stripeAccountId: club.stripeAccountId });
    }
  } catch (err) { handleError(err, res, next); }
});

// Détail public d'un club par slug.
router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const club = await clubService.getClubBySlug(asString(req.params.slug));
    res.json(club);
  } catch (err) { handleError(err, res, next); }
});

export default router;
