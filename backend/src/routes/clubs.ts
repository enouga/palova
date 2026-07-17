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
import { ModerationService } from '../services/moderation.service';
import { FollowService } from '../services/follow.service';
import { FriendshipService } from '../services/friendship.service';
import { SocialHubService } from '../services/socialHub.service';
import { ReservationService } from '../services/reservation.service';
import { StripeService } from '../services/stripe.service';
import { PaymentMethodService } from '../services/paymentMethod.service';
import { PresentationService } from '../services/presentation.service';
import { OfferService } from '../services/offer.service';
import { MatchAlertService } from '../services/matchAlert.service';
import { ensureActiveMembership } from '../services/membership';
import { entryFeeCents, MIN_STRIPE_CENTS } from '../services/registrationPayment';
import { PaymentHistoryService } from '../services/paymentHistory.service';
import { SSEService } from '../services/sse.service';
import { iconService } from '../services/icon.service';
import { matchCardService } from '../services/matchCard.service';
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
const moderationService = new ModerationService();
const reservationService = new ReservationService();
const subscriptionService = new SubscriptionService();
const paymentMethodService = new PaymentMethodService();
const paymentHistoryService = new PaymentHistoryService();
const followService = new FollowService();
const friendshipService = new FriendshipService();
const socialHubService = new SocialHubService();
const presentationService = new PresentationService();
const offerService = new OfferService();
const matchAlertService = new MatchAlertService();

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
  TEAM_SIDE_FULL:         400,
  TEAM_INVALID:           400,
  TEAM_SLOT_TAKEN:        400,
  CANNOT_REMOVE_ORGANIZER: 409,
  PARTICIPANT_NOT_FOUND: 404,
  SUBSCRIPTION_NOT_FOUND: 404,
  ALREADY_PARTICIPANT:   409,
  CHAT_FORBIDDEN:        403,
  NOT_ALLOWED:           403,
  MESSAGE_NOT_FOUND:     404,
  NOT_A_MEMBER:          404,
  FRIEND_REQUESTS_DISABLED: 409,
  CANNOT_FRIEND_SELF:       400,
  REQUEST_NOT_FOUND:        404,
  OFFER_NOT_FOUND:          404,
  AMOUNT_TOO_SMALL:         400,
  STRIPE_NOT_CONFIGURED:    409,
  NOT_PAYABLE:              409,
  UNAUTHORIZED:             403,
  RATE_LIMITED:             429,
  ALERT_LIMIT_REACHED:      409,
  ALERT_WINDOW_INVALID:     400,
  ALERT_LEVEL_INVALID:      400,
  NOT_A_COACH:           403,
  LESSON_NOT_YOURS:      403,
  LESSON_NOT_FOUND:      404,
  ENROLLMENT_LOCKED:     409,
  ENROLLMENT_NOT_FOUND:  404,
  ALREADY_ENROLLED:      409,
  NOT_A_REFEREE:         403,
  TOURNAMENT_NOT_YOURS:  403,
  TOURNAMENT_NOT_FOUND:  404,
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

// Top du mois : podium 3 joueurs par victoires (public, vide si < 3 joueurs).
router.get('/:slug/top-month', async (req, res, next) => {
  try { res.json(await clubService.clubTopOfMonth(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});

// Présentation publique du club (page « Le club » + teaser Club-house).
router.get('/:slug/presentation', async (req, res, next) => {
  try { res.json(await presentationService.getPublic(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});

// Formules du club (abonnements + carnets) — vide si le club n'a pas opté.
router.get('/:slug/offers', async (req, res, next) => {
  try { res.json(await offerService.listPublicOffers(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});

const offerStripe = new StripeService();

// Achat en ligne d'une formule : PaymentIntent (auth requis, adhésion créée à la volée).
router.post('/:slug/offers/plans/:id/intent', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = asString(req.params.slug);
    const { id: clubId } = await ensureActiveMembership(slug, req.user!.id);
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { showOffersPublicly: true, stripeAccountId: true } });
    if (!club?.showOffersPublicly) return void res.status(404).json({ error: 'OFFER_NOT_FOUND' });
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: asString(req.params.id) } });
    if (!plan || plan.clubId !== clubId || !plan.isActive) return void res.status(404).json({ error: 'OFFER_NOT_FOUND' });
    const amountCents = entryFeeCents(plan.monthlyPrice);
    if (amountCents < MIN_STRIPE_CENTS) return void res.status(400).json({ error: 'AMOUNT_TOO_SMALL' });
    const r = await offerStripe.createOfferPaymentIntent({ clubId, userId: req.user!.id, kind: 'plan', offerId: plan.id, amountCents });
    res.json({ ...r, type: 'payment', stripeAccountId: club.stripeAccountId });
  } catch (err) { handleError(err, res, next); }
});

router.post('/:slug/offers/packages/:id/intent', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = asString(req.params.slug);
    const { id: clubId } = await ensureActiveMembership(slug, req.user!.id);
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { showOffersPublicly: true, stripeAccountId: true } });
    if (!club?.showOffersPublicly) return void res.status(404).json({ error: 'OFFER_NOT_FOUND' });
    const tpl = await prisma.packageTemplate.findUnique({ where: { id: asString(req.params.id) } });
    if (!tpl || tpl.clubId !== clubId || !tpl.isActive) return void res.status(404).json({ error: 'OFFER_NOT_FOUND' });
    const amountCents = entryFeeCents(tpl.price);
    if (amountCents < MIN_STRIPE_CENTS) return void res.status(400).json({ error: 'AMOUNT_TOO_SMALL' });
    const r = await offerStripe.createOfferPaymentIntent({ clubId, userId: req.user!.id, kind: 'package', offerId: tpl.id, amountCents });
    res.json({ ...r, type: 'payment', stripeAccountId: club.stripeAccountId });
  } catch (err) { handleError(err, res, next); }
});

// Confirmation client d'un achat d'offre (le webhook fait le même travail — idempotent).
router.post('/:slug/offers/confirm', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { stripePaymentIntentId } = req.body ?? {};
    if (!stripePaymentIntentId) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    res.json(await offerService.confirmFromClient(asString(req.params.slug), req.user!.id, asString(stripePaymentIntentId)));
  } catch (err) { handleError(err, res, next); }
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

// Signal léger des facettes (coach, J/A) pour les entrées de menu — transverse aux deux espaces
// ci-dessous. Jamais 403 : ne bruite pas le menu. Remplace l'ancien GET /:slug/me/coach —
// deux facettes, un seul aller-retour.
router.get('/:slug/me/facets', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const club = await prisma.club.findUnique({ where: { slug: asString(req.params.slug) }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') return void res.json({ isCoach: false, isReferee: false });
    const [coach, isReferee] = await Promise.all([
      lessonService.resolveCoach(club.id, req.user!.id),
      tournamentService.resolveReferee(club.id, req.user!.id),
    ]);
    res.json({ isCoach: coach != null, isReferee });
  } catch (err) { handleError(err, res, next); }
});

// --- Espace coach : le coach connecté voit et gère SES cours (gate = ligne Coach active, PAS un rôle) ---

// Cours du coach (?scope=upcoming|past). 403 NOT_A_COACH si pas de ligne coach active.
// ensureActiveMembership : le coach devient membre actif (idempotent) → le picker de membres marche.
router.get('/:slug/me/coach/lessons', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    const coach = await lessonService.resolveCoach(clubId, req.user!.id);
    if (!coach) throw new Error('NOT_A_COACH');
    const scope = asString(req.query.scope) === 'past' ? 'past' : 'upcoming';
    res.json(await lessonService.listCoachLessons(clubId, coach.id, scope));
  } catch (err) { handleError(err, res, next); }
});

// Inscription d'un élève par le coach (sur SON cours).
router.post('/:slug/me/coach/lessons/:lessonId/students', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    const coach = await lessonService.resolveCoach(clubId, req.user!.id);
    if (!coach) throw new Error('NOT_A_COACH');
    const userId = asString(req.body?.userId);
    if (!userId) throw new Error('VALIDATION_ERROR');
    res.status(201).json(await lessonService.coachEnrollStudent(clubId, coach.id, asString(req.params.lessonId), userId));
  } catch (err) { handleError(err, res, next); }
});

// Retrait d'un élève par le coach (sur SON cours).
router.delete('/:slug/me/coach/lessons/:lessonId/students/:enrollId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    const coach = await lessonService.resolveCoach(clubId, req.user!.id);
    if (!coach) throw new Error('NOT_A_COACH');
    res.json(await lessonService.coachRemoveStudent(clubId, coach.id, asString(req.params.lessonId), asString(req.params.enrollId)));
  } catch (err) { handleError(err, res, next); }
});

// --- Espace juge-arbitre : le J/A voit et gère SES tournois (gate = facette + propriété, PAS un rôle) ---

// Tournois du J/A (?scope=upcoming|past). 403 NOT_A_REFEREE sans la facette.
// ensureActiveMembership : le J/A devient membre actif (idempotent), comme côté coach.
router.get('/:slug/me/referee/tournaments', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    const scope = asString(req.query.scope) === 'past' ? 'past' : 'upcoming';
    res.json(await tournamentService.listRefereeTournaments(clubId, req.user!.id, scope));
  } catch (err) { handleError(err, res, next); }
});

// Roster d'un tournoi du J/A.
router.get('/:slug/me/referee/tournaments/:id/registrations', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    res.json(await tournamentService.refereeListRegistrations(clubId, req.user!.id, asString(req.params.id)));
  } catch (err) { handleError(err, res, next); }
});

// Promotion d'un binôme en attente par le J/A.
router.post('/:slug/me/referee/tournaments/:id/registrations/:regId/promote', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    res.json(await tournamentService.refereePromoteRegistration(clubId, req.user!.id, asString(req.params.id), asString(req.params.regId)));
  } catch (err) { handleError(err, res, next); }
});

// Retrait d'un binôme par le J/A.
router.delete('/:slug/me/referee/tournaments/:id/registrations/:regId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    res.json(await tournamentService.refereeRemoveRegistration(clubId, req.user!.id, asString(req.params.id), asString(req.params.regId)));
  } catch (err) { handleError(err, res, next); }
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

// --- Amis / suivi ---
router.get('/:slug/friends', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await followService.listClubFriends(asString(req.params.slug), req.user!.id, asString(req.query.q))); }
  catch (err) { handleError(err, res, next); }
});

router.post('/:slug/follows/:userId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await followService.follow(asString(req.params.slug), req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});

router.delete('/:slug/follows/:userId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await followService.unfollow(asString(req.params.slug), req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});

// --- Amitiés confirmées (demande / réponse / retrait) ---
router.post('/:slug/friends/:userId/request', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await friendshipService.requestFriend(asString(req.params.slug), req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});
router.post('/:slug/friends/:userId/respond', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await friendshipService.respond(asString(req.params.slug), req.user!.id, asString(req.params.userId), req.body?.accept === true)); }
  catch (err) { handleError(err, res, next); }
});
router.delete('/:slug/friends/:userId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await friendshipService.removeFriend(req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});

// --- Hub social : « ça joue bientôt » chez mon cercle + suggestions de joueurs ---
router.get('/:slug/me/friends-agenda', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await socialHubService.friendsAgenda(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});
router.get('/:slug/me/player-suggestions', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await socialHubService.playerSuggestions(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// --- Alertes de parties ouvertes (recherche ponctuelle datée) ---
router.get('/:slug/match-alerts', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await matchAlertService.listMine(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});
router.post('/:slug/match-alerts', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await matchAlertService.create(asString(req.params.slug), req.user!.id, {
      date: asString(req.body?.date), from: asString(req.body?.from), to: asString(req.body?.to),
      targetLevelMin: req.body?.targetLevelMin ?? null, targetLevelMax: req.body?.targetLevelMax ?? null,
    }));
  } catch (err) { handleError(err, res, next); }
});
router.delete('/:slug/match-alerts/:id', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await matchAlertService.remove(asString(req.params.slug), req.user!.id, asString(req.params.id))); }
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

// Lecture publique d'une partie ouverte (page /parties/[id]). Déclarée APRÈS /unread-count
// pour que ce segment ne soit pas capturé comme un id.
router.get('/:slug/open-matches/:id', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.getOpenMatch(asString(req.params.slug), asString(req.params.id), req.user?.id ?? null)); }
  catch (err) { handleError(err, res, next); }
});

// Carte Open Graph de la partie (aperçu de lien WhatsApp/réseaux) — publique, PNG,
// repli embarqué : ne renvoie JAMAIS d'erreur à un crawler. L'URL est versionnée par
// ?v=<cardVersion> côté consommateur (pur cache-busting, paramètre ignoré ici).
router.get('/:slug/open-matches/:id/card.png', async (req: Request, res: Response) => {
  const filePath = await matchCardService.getMatchCardPath(asString(req.params.slug), asString(req.params.id));
  res.sendFile(filePath, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' } });
});

router.post('/:slug/open-matches/:id/join', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Body additif { team?, slot? } : place ciblée (tap sur une place libre). Sans team → join historique.
    const body = (req.body ?? {}) as { team?: unknown; slot?: unknown };
    const target = body.team !== undefined && body.team !== null
      ? { team: Number(body.team), slot: body.slot === undefined || body.slot === null ? undefined : Number(body.slot) }
      : undefined;
    res.json(await openMatchService.joinOpenMatch(asString(req.params.slug), asString(req.params.id), req.user!.id, target));
  }
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

// Réorganisation des équipes par l'organisateur (tap-to-swap) — chemin plus spécifique que /:userId (DELETE), pas de collision.
router.post('/:slug/open-matches/:id/participants/teams', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { teams?: Record<string, number>; slots?: Record<string, number> };
    res.json(await openMatchService.setTeams(asString(req.params.slug), asString(req.params.id), req.user!.id, body.teams ?? {}, body.slots));
  }
  catch (err) { handleError(err, res, next); }
});

// Chat de la partie ouverte (tout membre connecté).
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
router.patch('/:slug/open-matches/:id/chat/messages/:messageId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = typeof (req.body as { body?: unknown }).body === 'string' ? (req.body as { body: string }).body : '';
    res.json(await openMatchChatService.editMessage(asString(req.params.slug), asString(req.params.id), req.user!.id, asString(req.params.messageId), body));
  } catch (err) { handleError(err, res, next); }
});
router.delete('/:slug/open-matches/:id/chat/messages/:messageId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchChatService.deleteMessage(asString(req.params.slug), asString(req.params.id), req.user!.id, asString(req.params.messageId))); }
  catch (err) { handleError(err, res, next); }
});

// Signalement d'un message du chat (DSA/LCEN) — jamais son propre message, dédup par signaleur.
router.post('/:slug/open-matches/:id/chat/messages/:messageId/report', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { reason?: unknown; detail?: unknown };
    const r = await moderationService.reportOpenMatchMessage(
      asString(req.params.slug), asString(req.params.id), asString(req.params.messageId), req.user!.id,
      { reason: body.reason, detail: typeof body.detail === 'string' ? body.detail : null },
    );
    res.json(r);
  } catch (err) { handleError(err, res, next); }
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

// Bilan V/D + série du joueur connecté sur ce club (padel par défaut) — pour la carte « Mon niveau ».
router.get('/:slug/me/match-stats', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sport = typeof req.query.sport === 'string' ? req.query.sport : undefined;
    res.json(await clubService.myClubMatchStats(asString(req.params.slug), req.user!.id, sport));
  } catch (err) { handleError(err, res, next); }
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
