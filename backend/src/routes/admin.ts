import { Router, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Prisma, ClubPageKind, ReservationType } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';
import { requireClubMember, ClubScopedRequest } from '../middleware/requireClubMember';
import { prisma } from '../db/prisma';
import { SPONSORS_DIR, LOGOS_DIR, EXT_BY_MIME, ensureUploadDirs } from '../utils/uploads';
import { ResourceService } from '../services/resource.service';
import { ReservationService } from '../services/reservation.service';
import { ClubService } from '../services/club.service';
import { AnnouncementService } from '../services/announcement.service';
import { SponsorService } from '../services/sponsor.service';
import { TournamentService } from '../services/tournament.service';
import { EventService } from '../services/event.service';
import { PackageService } from '../services/package.service';
import { RefundService } from '../services/refund.service';
import { AccountingService } from '../services/accounting.service';
import { StripeService } from '../services/stripe.service';
import { ClubPageService } from '../services/clubPage.service';
import { matchService } from '../services/match.service';
import { CoachService } from '../services/coach.service';
import { lessonService } from '../services/lesson.service';
import { BroadcastService } from '../services/broadcast.service';
import { RatingService } from '../services/rating.service';

// mergeParams pour accéder à :clubId défini sur le point de montage.
const router = Router({ mergeParams: true });
const resourceService = new ResourceService();
const reservationService = new ReservationService();
const clubService = new ClubService();
const announcementService = new AnnouncementService();
const sponsorService = new SponsorService();
const tournamentService = new TournamentService();
const eventService = new EventService();
const packageService = new PackageService();
const refundService = new RefundService();
const accountingService = new AccountingService();
const clubPageService = new ClubPageService();
const coachService = new CoachService();
const broadcastService = new BroadcastService();
const ratingService = new RatingService();

const PAGE_KINDS = new Set<ClubPageKind>(['CGV', 'MENTIONS_LEGALES', 'CONFIDENTIALITE', 'OFFRES']);

// Upload du logo partenaire en mémoire (2 Mo max) ; mêmes formats que l'avatar.
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const ERROR_STATUS: Record<string, number> = {
  FORBIDDEN:             403,
  RESOURCE_NOT_FOUND:    404,
  CLUB_SPORT_NOT_FOUND:  404,
  SPORT_NOT_FOUND:       404,
  VALIDATION_ERROR:      400,
  CLUB_MISMATCH:         403,
  RESERVATION_NOT_FOUND: 404,
  ALREADY_CANCELLED:     409,
  USER_NOT_FOUND:        404,
  MEMBER_NOT_FOUND:      404,
  ANNOUNCEMENT_NOT_FOUND: 404,
  SPONSOR_NOT_FOUND:      404,
  TOURNAMENT_NOT_FOUND:   404,
  EVENT_NOT_FOUND:        404,
  HAS_REGISTRATIONS:      409,
  REGISTRATION_NOT_FOUND: 404,
  SLOT_NOT_AVAILABLE:    409,
  TEMPLATE_NOT_FOUND:     404,
  PACKAGE_NOT_FOUND:      404,
  PAYMENT_NOT_FOUND:      404,
  INSUFFICIENT_BALANCE:   409,
  PAYMENT_EXCEEDS_DUE:    409,
  PARTICIPANT_NOT_FOUND:  404,
  CLUB_NOT_FOUND:         404,
  TOO_MANY_PLAYERS:        409,
  RESERVATION_HAS_NO_MEMBER: 409,
  CANNOT_REMOVE_ORGANIZER: 409,
  PARTNER_DUPLICATE:       409,
  REFUND_EXCEEDS_PAID:    409,
  ALREADY_REFUNDED:       409,
  STRIPE_NOT_CONFIGURED:  422,
  CARD_DECLINED:          402,
  NO_CARD_ON_FILE:        422,
  STRIPE_ERROR:           500,
  PAGE_NOT_FOUND:         404,
  FAQ_ITEM_NOT_FOUND:     404,
  COACH_NOT_FOUND:        404,
  SERIES_NOT_FOUND:       404,
  SERIES_TOO_LONG:        400,
  LESSON_NOT_FOUND:       404,
  ENROLLMENT_NOT_FOUND:   404,
  ALREADY_ENROLLED:       409,
  MEMBERSHIP_BLOCKED:     403,
};

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

async function assertLevelSystem(clubId: string): Promise<void> {
  const c = await prisma.club.findUnique({ where: { id: clubId }, select: { levelSystemEnabled: true } });
  if (!c || !c.levelSystemEnabled) throw new Error('LEVEL_SYSTEM_DISABLED');
}

const handleError = (err: unknown, res: Response, next: NextFunction) => {
  const message = (err as Error).message;
  const status  = ERROR_STATUS[message];
  if (status) return void res.status(status).json({ error: message });
  next(err);
};

const STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;
const RESERVATION_TYPES = ['COURT', 'COACHING', 'TOURNAMENT', 'EVENT'] as const;

// Toutes les routes admin : auth puis appartenance au club.
// Lot 1 : tout membre (OWNER/ADMIN/STAFF) a accès au back-office.
// Lot 2 : permissions fines (ex. STAFF en lecture seule sur le branding).
router.use(authMiddleware, requireClubMember('STAFF'));

// --- Profil & branding du club ---

router.get('/', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await clubService.getClubForAdmin(req.membership!.clubId));
  } catch (err) { handleError(err, res, next); }
});

router.patch('/', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const club = await clubService.updateClub(req.membership!.clubId, req.body);
    res.json(club);
  } catch (err) { handleError(err, res, next); }
});

// --- Pages de contenu (CGV, mentions légales, confidentialité, offres) ---

router.get('/pages', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await clubPageService.listAdminPages(req.membership!.clubId)); }
  catch (err) { handleError(err, res, next); }
});

// Modèle Palova pré-rempli pour un type (pré-remplir / réinitialiser l'éditeur).
router.get('/pages/:kind/template', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const kind = asString(req.params.kind).toUpperCase() as ClubPageKind;
    if (!PAGE_KINDS.has(kind)) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    const bodyMarkdown = await clubPageService.renderTemplate(req.membership!.clubId, kind);
    res.json({ bodyMarkdown });
  } catch (err) { handleError(err, res, next); }
});

router.put('/pages/:kind', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const kind = asString(req.params.kind).toUpperCase() as ClubPageKind;
    if (!PAGE_KINDS.has(kind)) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    const { bodyMarkdown, published } = req.body;
    res.json(await clubPageService.upsertPage(req.membership!.clubId, kind, { bodyMarkdown, published }));
  } catch (err) { handleError(err, res, next); }
});

// --- FAQ propre au club ---

router.get('/faq', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await clubPageService.listAdminFaq(req.membership!.clubId)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/faq', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { question, answerMarkdown, category } = req.body;
    res.status(201).json(await clubPageService.createFaqItem(req.membership!.clubId, { question, answerMarkdown, category }));
  } catch (err) { handleError(err, res, next); }
});

// Réordonne — placé AVANT /faq/:id pour ne pas être capturé.
router.patch('/faq/reorder', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || !orderedIds.every((x) => typeof x === 'string')) {
      return void res.status(400).json({ error: 'orderedIds (string[]) requis' });
    }
    await clubPageService.reorderFaq(req.membership!.clubId, orderedIds);
    res.json(await clubPageService.listAdminFaq(req.membership!.clubId));
  } catch (err) { handleError(err, res, next); }
});

router.patch('/faq/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { question, answerMarkdown, category, published } = req.body;
    res.json(await clubPageService.updateFaqItem(asString(req.params.id), req.membership!.clubId, { question, answerMarkdown, category, published }));
  } catch (err) { handleError(err, res, next); }
});

router.delete('/faq/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { await clubPageService.deleteFaqItem(asString(req.params.id), req.membership!.clubId); res.json({ ok: true }); }
  catch (err) { handleError(err, res, next); }
});

// --- Sports activés ---

router.get('/sports', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await clubService.listClubSports(req.membership!.clubId));
  } catch (err) { handleError(err, res, next); }
});

router.post('/sports', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.body.sportId) return void res.status(400).json({ error: 'sportId requis' });
    const cs = await clubService.addClubSport(req.membership!.clubId, req.body.sportId);
    res.status(201).json(cs);
  } catch (err) { handleError(err, res, next); }
});

// Durées proposées pour un sport du club.
router.patch('/sports/:clubSportId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    if (!Array.isArray(req.body.durationsMin)) return void res.status(400).json({ error: 'durationsMin (number[]) requis' });
    const cs = await clubService.updateClubSport(asString(req.params.clubSportId), req.membership!.clubId, req.body.durationsMin.map(Number));
    res.json(cs);
  } catch (err) { handleError(err, res, next); }
});

// --- Ressources ---

router.get('/resources', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await resourceService.listClubResources(req.membership!.clubId));
  } catch (err) { handleError(err, res, next); }
});

router.post('/resources', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { clubSportId, name, attributes, price, offPeakPrice, openHour, closeHour, slotStepMin } = req.body;
    if (!clubSportId) return void res.status(400).json({ error: 'clubSportId requis' });
    const resource = await resourceService.createResource({
      clubId: req.membership!.clubId, clubSportId, name, attributes, price, offPeakPrice, openHour, closeHour, slotStepMin,
    });
    res.status(201).json(resource);
  } catch (err) { handleError(err, res, next); }
});

// Réordonne les ressources — placé AVANT /resources/:id pour ne pas être capturé.
router.patch('/resources/reorder', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || !orderedIds.every((x) => typeof x === 'string')) {
      return void res.status(400).json({ error: 'orderedIds (string[]) requis' });
    }
    await resourceService.reorderResources(req.membership!.clubId, orderedIds);
    res.json(await resourceService.listClubResources(req.membership!.clubId));
  } catch (err) { handleError(err, res, next); }
});

router.patch('/resources/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { name, attributes, price, offPeakPrice, openHour, closeHour, slotStepMin } = req.body;
    const resource = await resourceService.updateResource(asString(req.params.id), req.membership!.clubId, {
      name, attributes, price, offPeakPrice, openHour, closeHour, slotStepMin,
    });
    res.json(resource);
  } catch (err) { handleError(err, res, next); }
});

router.patch('/resources/:id/active', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    if (typeof req.body.isActive !== 'boolean') {
      return void res.status(400).json({ error: 'isActive (boolean) requis' });
    }
    const resource = await resourceService.setResourceActive(
      asString(req.params.id), req.membership!.clubId, req.body.isActive,
    );
    res.json(resource);
  } catch (err) { handleError(err, res, next); }
});

// --- Membres (fichier-membres du club) ---

router.get('/members', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await clubService.listMembers(req.membership!.clubId));
  } catch (err) { handleError(err, res, next); }
});

// Ajout d'un membre par email (compte joueur existant requis).
router.post('/members', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.body.email) return void res.status(400).json({ error: 'email requis' });
    res.status(201).json(await clubService.addMemberByEmail(req.membership!.clubId, req.body.email));
  } catch (err) { handleError(err, res, next); }
});

// Création directe d'un membre (crée le compte + l'adhésion ; renvoie un mdp temporaire).
router.post('/members/create', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { firstName, lastName, email, phone, membershipNo } = req.body;
    res.status(201).json(await clubService.createMember(req.membership!.clubId, { firstName, lastName, email, phone, membershipNo }));
  } catch (err) { handleError(err, res, next); }
});

router.patch('/members/:id/blocked', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    if (typeof req.body.blocked !== 'boolean') return void res.status(400).json({ error: 'blocked (boolean) requis' });
    res.json(await clubService.setMemberBlocked(req.membership!.clubId, asString(req.params.id), req.body.blocked));
  } catch (err) { handleError(err, res, next); }
});

router.patch('/members/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { isSubscriber, membershipNo, status, note, phone } = req.body;
    res.json(await clubService.updateMembership(req.membership!.clubId, asString(req.params.id), { isSubscriber, membershipNo, status, note, phone }));
  } catch (err) { handleError(err, res, next); }
});

router.delete('/members/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    await clubService.removeMember(req.membership!.clubId, asString(req.params.id));
    res.json({ ok: true });
  } catch (err) { handleError(err, res, next); }
});

// --- Réservations ---

router.get('/reservations', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const date       = asString(req.query.date);
    const resourceId = asString(req.query.resourceId);
    const status     = asString(req.query.status);

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return void res.status(400).json({ error: 'date doit être YYYY-MM-DD' });
    }
    if (status && !STATUSES.includes(status as typeof STATUSES[number])) {
      return void res.status(400).json({ error: 'status invalide' });
    }

    const result = await reservationService.listClubReservations({
      clubId:     req.membership!.clubId,
      date:       date || undefined,
      resourceId: resourceId || undefined,
      status:     (status || undefined) as typeof STATUSES[number] | undefined,
    });
    res.json(result);
  } catch (err) { handleError(err, res, next); }
});

router.post('/reservations', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { resourceId, date, startTime, endTime, title, memberUserId, price } = req.body;
    const type = asString(req.body.type);
    if (typeof resourceId !== 'string' || !resourceId) return void res.status(400).json({ error: 'resourceId requis' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asString(date)))    return void res.status(400).json({ error: 'date doit être YYYY-MM-DD' });
    if (!/^\d{2}:\d{2}$/.test(asString(startTime)) || !/^\d{2}:\d{2}$/.test(asString(endTime))) {
      return void res.status(400).json({ error: 'heures HH:mm requises' });
    }
    if (!RESERVATION_TYPES.includes(type as typeof RESERVATION_TYPES[number])) {
      return void res.status(400).json({ error: 'type invalide' });
    }
    const created = await reservationService.adminCreateReservation({
      clubId:       req.membership!.clubId,
      resourceId, date, startTime, endTime,
      type:         type as typeof RESERVATION_TYPES[number],
      title:        typeof title === 'string' ? title : undefined,
      memberUserId: typeof memberUserId === 'string' && memberUserId ? memberUserId : undefined,
      price:        price !== undefined && price !== null ? Number(price) : undefined,
      lessonParams: (req.body.lessonParams && typeof req.body.lessonParams === 'object')
        ? {
            coachId: asString(req.body.lessonParams.coachId),
            capacity: Number(req.body.lessonParams.capacity),
            lessonKind: req.body.lessonParams.lessonKind,
            allowSelfEnroll: Boolean(req.body.lessonParams.allowSelfEnroll),
          }
        : undefined,
    });
    res.status(201).json(created);
  } catch (err) { handleError(err, res, next); }
});

router.delete('/reservations/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const cancelled = await reservationService.adminCancelReservation(
      asString(req.params.id), req.membership!.clubId,
    );
    res.json(cancelled);
  } catch (err) { handleError(err, res, next); }
});

// Change le type d'une réservation (Terrain/Coaching/Tournoi/Événement).
router.patch('/reservations/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const type = asString(req.body.type);
    if (!RESERVATION_TYPES.includes(type as typeof RESERVATION_TYPES[number])) {
      return void res.status(400).json({ error: 'type invalide' });
    }
    const updated = await reservationService.setReservationType(
      asString(req.params.id), req.membership!.clubId, type as typeof RESERVATION_TYPES[number],
    );
    res.json(updated);
  } catch (err) { handleError(err, res, next); }
});

// (Ré)affecte le joueur d'une réservation (associer un joueur à l'encaissement).
router.patch('/reservations/:id/member', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const memberUserId = asString(req.body.memberUserId);
    if (!memberUserId) return void res.status(400).json({ error: 'memberUserId requis' });
    const updated = await reservationService.assignReservationMember(
      asString(req.params.id), req.membership!.clubId, memberUserId,
    );
    res.json(updated);
  } catch (err) { handleError(err, res, next); }
});

// Ajoute un membre comme participant (répartition du paiement par joueur).
router.post('/reservations/:id/participants', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const memberUserId = asString(req.body.memberUserId);
    if (!memberUserId) return void res.status(400).json({ error: 'memberUserId requis' });
    const updated = await reservationService.addReservationParticipant(
      asString(req.params.id), req.membership!.clubId, memberUserId,
    );
    res.json(updated);
  } catch (err) { handleError(err, res, next); }
});

// Retire un participant d'une réservation (recalcule les parts).
router.delete('/reservations/:id/participants/:participantId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const updated = await reservationService.removeReservationParticipant(
      asString(req.params.id), req.membership!.clubId, asString(req.params.participantId),
    );
    res.json(updated);
  } catch (err) { handleError(err, res, next); }
});

// Encaissement manuel sur une réservation (espèces/carte/ticket CE/carnet/porte-monnaie).
router.post('/reservations/:id/payments', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { amount, method, payerName, note, sourcePackageId, voucherRef, voucherIssuer, participantId } = req.body;
    const payment = await reservationService.addPayment({
      reservationId: asString(req.params.id),
      clubId: req.membership!.clubId,
      amount: Number(amount),
      method, payerName, note,
      sourcePackageId: typeof sourcePackageId === 'string' && sourcePackageId ? sourcePackageId : undefined,
      voucherRef:      typeof voucherRef === 'string' ? voucherRef : undefined,
      voucherIssuer:   typeof voucherIssuer === 'string' ? voucherIssuer : undefined,
      participantId:   typeof participantId === 'string' && participantId ? participantId : undefined,
      createdByUserId: req.user!.id,
    });
    res.status(201).json(payment);
  } catch (err) { handleError(err, res, next); }
});

// Remboursement / correction d'un encaissement (total ou partiel).
router.post('/payments/:paymentId/refunds', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { amount, reason, method } = req.body;
    const refund = await refundService.refund({
      paymentId: asString(req.params.paymentId),
      clubId: req.membership!.clubId,
      amount: Number(amount),
      reason: typeof reason === 'string' ? reason : undefined,
      method: typeof method === 'string' ? method : undefined,
      createdByUserId: req.user!.id,
    });
    res.status(201).json(refund);
  } catch (err) { handleError(err, res, next); }
});

// --- Annonces ---
router.get('/announcements', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await announcementService.listAdmin(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/announcements', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await announcementService.create(req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.patch('/announcements/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await announcementService.update(asString(req.params.id), req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.delete('/announcements/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { await announcementService.remove(asString(req.params.id), req.membership!.clubId); res.json({ ok: true }); } catch (e) { handleError(e, res, next); }
});

// --- Sponsors ---
// Upload d'un logo (JPEG/PNG/WebP, 2 Mo max) → renvoie le chemin /uploads à stocker dans logoUrl.
router.post('/sponsors/logo', (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  logoUpload.single('logo')(req, res, async (err: unknown) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return void res.status(400).json({ error: 'Image trop lourde (2 Mo max)' });
        }
        return next(err as Error);
      }
      const file = req.file;
      const ext = file && EXT_BY_MIME[file.mimetype];
      if (!file || !ext) {
        return void res.status(400).json({ error: 'Format d’image non supporté (JPEG, PNG ou WebP)' });
      }
      const filename = `${req.membership!.clubId}-${Date.now()}.${ext}`;
      ensureUploadDirs();
      await fs.promises.writeFile(path.join(SPONSORS_DIR, filename), file.buffer);
      res.json({ logoUrl: `/uploads/sponsors/${filename}` });
    } catch (e) { handleError(e, res, next); }
  });
});
// Upload du logo du club (JPEG/PNG/WebP, 2 Mo max) : persiste club.logoUrl immédiatement.
router.post('/club-logo', (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  logoUpload.single('logo')(req, res, async (err: unknown) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return void res.status(400).json({ error: 'Image trop lourde (2 Mo max)' });
        }
        return next(err as Error);
      }
      const file = req.file;
      const ext = file && EXT_BY_MIME[file.mimetype];
      if (!file || !ext) {
        return void res.status(400).json({ error: 'Format d’image non supporté (JPEG, PNG ou WebP)' });
      }
      const clubId = req.membership!.clubId;
      const prev = await prisma.club.findUnique({ where: { id: clubId }, select: { logoUrl: true } });
      const filename = `${clubId}-${Date.now()}.${ext}`;
      ensureUploadDirs();
      await fs.promises.writeFile(path.join(LOGOS_DIR, filename), file.buffer);
      const logoUrl = `/uploads/logos/${filename}`;
      await clubService.updateClub(clubId, { logoUrl });
      // Nettoyage best-effort de l'ancien logo uploadé (jamais bloquant).
      if (prev?.logoUrl?.startsWith('/uploads/logos/')) {
        fs.promises.unlink(path.join(LOGOS_DIR, path.basename(prev.logoUrl))).catch(() => {});
      }
      res.json({ logoUrl });
    } catch (e) { handleError(e, res, next); }
  });
});
router.get('/sponsors', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await sponsorService.listAdmin(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/sponsors', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await sponsorService.create(req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.patch('/sponsors/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await sponsorService.update(asString(req.params.id), req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.delete('/sponsors/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { await sponsorService.remove(asString(req.params.id), req.membership!.clubId); res.json({ ok: true }); } catch (e) { handleError(e, res, next); }
});

// --- Coachs ---
router.get('/coaches', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await coachService.listAdmin(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/coaches', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await coachService.create(req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.patch('/coaches/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await coachService.update(asString(req.params.id), req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.delete('/coaches/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { await coachService.remove(asString(req.params.id), req.membership!.clubId); res.json({ ok: true }); } catch (e) { handleError(e, res, next); }
});

// --- Séries récurrentes (tous types) ---
router.post('/reservation-series', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { resourceId, title, weekday, startLocal, durationMin, startDate, endDate } = req.body;
    const { coachId, capacity, lessonKind, allowSelfEnroll, enrollmentMode } = req.body;
    const type = asString(req.body.type);
    if (typeof resourceId !== 'string' || !resourceId) return void res.status(400).json({ error: 'resourceId requis' });
    if (!RESERVATION_TYPES.includes(type as typeof RESERVATION_TYPES[number])) return void res.status(400).json({ error: 'type invalide' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asString(startDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(asString(endDate))) {
      return void res.status(400).json({ error: 'dates doivent être YYYY-MM-DD' });
    }
    if (!/^\d{2}:\d{2}$/.test(asString(startLocal))) return void res.status(400).json({ error: 'startLocal doit être HH:mm' });
    if (!Number.isInteger(Number(weekday)) || !Number.isInteger(Number(durationMin))) {
      return void res.status(400).json({ error: 'weekday/durationMin invalides' });
    }
    const created = await reservationService.adminCreateSeries({
      clubId: req.membership!.clubId,
      resourceId,
      type: type as ReservationType,
      title: typeof title === 'string' ? title : undefined,
      weekday: Number(weekday),
      startLocal: asString(startLocal),
      durationMin: Number(durationMin),
      startDate: asString(startDate),
      endDate: asString(endDate),
      lessonParams: coachId
        ? {
            coachId: asString(coachId),
            capacity: Number(capacity),
            lessonKind,
            allowSelfEnroll: Boolean(allowSelfEnroll),
            enrollmentMode,
          }
        : undefined,
    });
    res.status(201).json(created);
  } catch (err) { handleError(err, res, next); }
});

router.delete('/reservation-series/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await reservationService.adminCancelSeries(asString(req.params.id), req.membership!.clubId));
  } catch (err) { handleError(err, res, next); }
});

// --- Cours : élèves ---
router.get('/lessons/:id/students', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await lessonService.listStudents(asString(req.params.id), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/lessons/:id/students', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await lessonService.adminEnrollStudent(asString(req.params.id), asString(req.body.userId), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.patch('/lessons/:id/students/:enrollId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await lessonService.adminPromoteStudent(asString(req.params.id), asString(req.params.enrollId), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.delete('/lessons/:id/students/:enrollId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await lessonService.adminRemoveStudent(asString(req.params.id), asString(req.params.enrollId), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});

// --- Tournois ---
router.get('/tournaments', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.listForAdmin(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/tournaments', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await tournamentService.createTournament(req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.get('/tournaments/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.getForAdmin(asString(req.params.id), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.patch('/tournaments/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.updateTournament(asString(req.params.id), req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.delete('/tournaments/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { await tournamentService.deleteTournament(asString(req.params.id), req.membership!.clubId); res.json({ ok: true }); } catch (e) { handleError(e, res, next); }
});
router.patch('/tournaments/:id/registrations/:regId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.adminPromoteRegistration(asString(req.params.id), asString(req.params.regId), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.delete('/tournaments/:id/registrations/:regId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.adminRemoveRegistration(asString(req.params.id), asString(req.params.regId), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});

// --- Events (animations : mêlées, stages, soirées…) ---

router.get('/events', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.listForAdmin(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/events', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await eventService.createEvent(req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.get('/events/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.getForAdmin(asString(req.params.id), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.patch('/events/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.updateEvent(asString(req.params.id), req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.delete('/events/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { await eventService.deleteEvent(asString(req.params.id), req.membership!.clubId); res.json({ ok: true }); } catch (e) { handleError(e, res, next); }
});
router.patch('/events/:id/registrations/:regId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.adminPromoteRegistration(asString(req.params.id), asString(req.params.regId), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.delete('/events/:id/registrations/:regId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.adminRemoveRegistration(asString(req.params.id), asString(req.params.regId), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});

// --- Offres prépayées (carnets / porte-monnaie) ---
router.get('/packages/templates', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await packageService.listTemplates(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/packages/templates', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await packageService.createTemplate(req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.patch('/packages/templates/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await packageService.updateTemplate(asString(req.params.id), req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});

// Soldes d'un membre + vente d'une offre en caisse.
router.get('/members/:userId/packages', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await packageService.listMemberPackages(req.membership!.clubId, asString(req.params.userId))); } catch (e) { handleError(e, res, next); }
});
router.post('/members/:userId/packages', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await packageService.sellPackage(req.membership!.clubId, asString(req.params.userId), { ...req.body, createdByUserId: req.user!.id })); } catch (e) { handleError(e, res, next); }
});

// --- Caisse du jour & tickets CE ---
router.get('/caisse', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const date = asString(req.query.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return void res.status(400).json({ error: 'date doit être YYYY-MM-DD' });
    res.json(await packageService.dailySummary(req.membership!.clubId, date));
  } catch (e) { handleError(e, res, next); }
});
router.get('/caisse/vouchers', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const status = asString(req.query.status);
    if (status && status !== 'PENDING_REIMBURSEMENT' && status !== 'REIMBURSED') {
      return void res.status(400).json({ error: 'status invalide' });
    }
    res.json(await packageService.listVouchers(req.membership!.clubId, (status || undefined) as 'PENDING_REIMBURSEMENT' | 'REIMBURSED' | undefined));
  } catch (e) { handleError(e, res, next); }
});
router.patch('/payments/:id/voucher', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const status = asString(req.body.status);
    if (status !== 'PENDING_REIMBURSEMENT' && status !== 'REIMBURSED') {
      return void res.status(400).json({ error: 'status invalide' });
    }
    res.json(await packageService.setVoucherStatus(asString(req.params.id), req.membership!.clubId, status));
  } catch (e) { handleError(e, res, next); }
});

// --- Comptabilité mensuelle ---
router.get('/accounting/summary', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const year = Number(asString(req.query.year)); const month = Number(asString(req.query.month));
    res.json(await accountingService.monthlySummary(req.membership!.clubId, year, month));
  } catch (e) { handleError(e, res, next); }
});
router.get('/accounting/export', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const from = asString(req.query.from); const to = asString(req.query.to);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return void res.status(400).json({ error: 'from/to YYYY-MM-DD requis' });
    const csv = await accountingService.exportCsv(req.membership!.clubId, from, to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="caisse_${from}_${to}.csv"`);
    res.send(csv);
  } catch (e) { handleError(e, res, next); }
});

// --- Stripe Connect ---
const stripeService = new StripeService();

router.post('/stripe/connect', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { refreshUrl, returnUrl } = req.body;
    if (!refreshUrl || !returnUrl) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    const url = await stripeService.createConnectedAccount(
      req.membership!.clubId,
      String(refreshUrl),
      String(returnUrl),
    );
    res.status(201).json({ url });
  } catch (err) { handleError(err, res, next); }
});

router.get('/stripe/status', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const stripeAccountStatus = await stripeService.syncAccountStatus(req.membership!.clubId);
    res.json({ stripeAccountStatus });
  } catch (err) { handleError(err, res, next); }
});

router.get('/stripe/login-link', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const url = await stripeService.createLoginLink(req.membership!.clubId);
    res.json({ url });
  } catch (err) { handleError(err, res, next); }
});

router.post('/reservations/:id/no-show-charge', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const reservationId = asString(req.params.id);
    const amount = Number(req.body?.amount);
    if (!amount || amount <= 0) return void res.status(400).json({ error: 'VALIDATION_ERROR' });

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: { select: { clubId: true } },
        participants: { where: { isOrganizer: true }, select: { id: true, userId: true }, take: 1 },
      },
    });
    if (!reservation || reservation.resource.clubId !== req.membership!.clubId) {
      return void res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
    }

    const organizer = reservation.participants[0];
    if (!organizer) return void res.status(422).json({ error: 'NO_CARD_ON_FILE' });

    const amountCents = Math.round(amount * 100);
    const piId = await stripeService.chargeNoShow({
      clubId: req.membership!.clubId,
      userId: organizer.userId,
      reservationId,
      amountCents,
      note: typeof req.body?.note === 'string' ? req.body.note : undefined,
      createdByUserId: req.user?.id,
    });

    const payment = await prisma.payment.create({
      data: {
        reservationId,
        participantId: organizer.id,
        clubId: req.membership!.clubId,
        amount: new Prisma.Decimal(amount),
        method: 'ONLINE',
        status: 'CAPTURED',
        stripePaymentIntentId: piId,
        stripePaymentMethodId: undefined,
        note: typeof req.body?.note === 'string' ? req.body.note : null,
        createdByUserId: req.user?.id ?? null,
      },
    });

    res.status(201).json({ paymentId: payment.id, stripePaymentIntentId: piId });
  } catch (err) { handleError(err, res, next); }
});

// --- File des litiges de matchs ---

router.get('/matches', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    await assertLevelSystem(asString(req.params.clubId));
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const where: { clubId: string; status?: any } = { clubId: asString(req.params.clubId) };
    if (status) where.status = status;
    const matches = await prisma.match.findMany({
      where, orderBy: { playedAt: 'desc' },
      select: {
        id: true, status: true, sets: true, playedAt: true, winningTeam: true, confirmDeadline: true,
        players: { select: { userId: true, team: true, confirmation: true, user: { select: { firstName: true, lastName: true } } } },
        _count: { select: { comments: true } },
      },
    });
    res.json(matches.map((m) => ({
      id: m.id, status: m.status, sets: m.sets, playedAt: m.playedAt,
      winningTeam: m.winningTeam, confirmDeadline: m.confirmDeadline,
      players: m.players, commentCount: m._count.comments,
    })));
  } catch (err) {
    if (err instanceof Error && err.message === 'LEVEL_SYSTEM_DISABLED') { res.status(403).json({ error: 'LEVEL_SYSTEM_DISABLED' }); return; }
    next(err);
  }
});

router.post('/matches/:matchId/resolve', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    await assertLevelSystem(asString(req.params.clubId));
    const { action, sets } = req.body;
    if (action !== 'VALIDATE' && action !== 'CANCEL') { res.status(400).json({ error: 'VALIDATION_ERROR' }); return; }
    await matchService.resolveDispute(asString(req.params.matchId), asString(req.params.clubId), action, sets);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'LEVEL_SYSTEM_DISABLED') { res.status(403).json({ error: 'LEVEL_SYSTEM_DISABLED' }); return; }
    if (err instanceof Error && err.message === 'MATCH_NOT_FOUND') { res.status(404).json({ error: 'MATCH_NOT_FOUND' }); return; }
    if (err instanceof Error && err.message === 'MATCH_NOT_DISPUTED') { res.status(409).json({ error: 'MATCH_NOT_DISPUTED' }); return; }
    next(err as Error);
  }
});

router.post('/matches/:matchId/void', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    await assertLevelSystem(asString(req.params.clubId));
    const reason = typeof req.body.reason === 'string' ? req.body.reason : '';
    await matchService.voidMatch(asString(req.params.matchId), asString(req.params.clubId), req.user!.id, reason);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'LEVEL_SYSTEM_DISABLED') { res.status(403).json({ error: 'LEVEL_SYSTEM_DISABLED' }); return; }
    if (err instanceof Error && err.message === 'VALIDATION_ERROR') { res.status(400).json({ error: 'VALIDATION_ERROR' }); return; }
    if (err instanceof Error && err.message === 'MATCH_NOT_FOUND') { res.status(404).json({ error: 'MATCH_NOT_FOUND' }); return; }
    if (err instanceof Error && err.message === 'ALREADY_CANCELLED') { res.status(409).json({ error: 'ALREADY_CANCELLED' }); return; }
    next(err as Error);
  }
});

// --- Override admin du niveau d'un membre ---
// Réservé OWNER/ADMIN : corrige un niveau (PlayerRating) GLOBAL ; le club n'est qu'un contexte d'audit.

router.post('/members/:userId/level', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const clubId = asString(req.params.clubId);
    await assertLevelSystem(clubId);
    const sportKey = asString(req.body?.sportKey);
    const level = req.body?.level;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const display = await ratingService.adminSetLevel(asString(req.params.userId), sportKey, level, req.user!.id, { reason, clubId });
    res.json(display);
  } catch (err) {
    if (err instanceof Error && err.message === 'LEVEL_SYSTEM_DISABLED') { res.status(403).json({ error: 'LEVEL_SYSTEM_DISABLED' }); return; }
    if (err instanceof Error && err.message === 'VALIDATION_ERROR') { res.status(400).json({ error: 'VALIDATION_ERROR' }); return; }
    if (err instanceof Error && err.message === 'SPORT_NOT_FOUND') { res.status(404).json({ error: 'SPORT_NOT_FOUND' }); return; }
    next(err as Error);
  }
});

router.get('/members/:userId/level', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const clubId = asString(req.params.clubId);
    await assertLevelSystem(clubId);
    // Liste des sports : ceux proposés par le club (fiche admin contextualisée au club).
    const clubSports = await prisma.clubSport.findMany({
      where: { clubId }, select: { sport: { select: { key: true } } },
    });
    const sportKeys = clubSports.map((cs) => cs.sport.key);
    const payload = await ratingService.getMemberLevelAdmin(asString(req.params.userId), sportKeys);
    res.json(payload);
  } catch (err) {
    if (err instanceof Error && err.message === 'LEVEL_SYSTEM_DISABLED') { res.status(403).json({ error: 'LEVEL_SYSTEM_DISABLED' }); return; }
    next(err as Error);
  }
});

// --- Broadcast (message à tous les membres actifs) ---
// Réservé OWNER/ADMIN : action à fort impact (notifie tous les membres).
router.post('/broadcast', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { title, body, url } = req.body;
    const result = await broadcastService.send(
      req.membership!.clubId,
      req.user!.id,
      { title, body, url: typeof url === 'string' ? url : null },
    );
    res.json(result);
  } catch (err) { handleError(err, res, next); }
});

router.get('/broadcasts', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const [recipientCount, items] = await Promise.all([
      broadcastService.countActiveMembers(req.membership!.clubId),
      broadcastService.history(req.membership!.clubId),
    ]);
    res.json({ recipientCount, items });
  } catch (err) { handleError(err, res, next); }
});

export default router;
