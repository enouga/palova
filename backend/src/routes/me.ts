import { Router, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import bcrypt from 'bcrypt';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../db/prisma';
import { ReservationService } from '../services/reservation.service';
import { TournamentService } from '../services/tournament.service';
import { EventService } from '../services/event.service';
import { lessonService } from '../services/lesson.service';
import { RatingService } from '../services/rating.service';
import { resolvePreferredSportKey } from '../services/rating/preferredSport';
import { AVATARS_DIR, EXT_BY_MIME, ensureUploadDirs } from '../utils/uploads';
import { AccountService } from '../services/account.service';
import { FollowService } from '../services/follow.service';
import { FriendshipService } from '../services/friendship.service';

const router = Router();
const reservationService = new ReservationService();
const tournamentService = new TournamentService();
const eventService = new EventService();
const ratingService = new RatingService();
const accountService = new AccountService();
const followService = new FollowService();
const friendshipService = new FriendshipService();

// Champs du profil exposés au joueur (GET /profile, PATCH /, POST /avatar).
const PROFILE_SELECT = {
  id: true, email: true, firstName: true, lastName: true, phone: true, sex: true,
  birthDate: true, avatarUrl: true, locale: true, isSuperAdmin: true, showInLeaderboard: true,
  autoMatchProposals: true, acceptsFriendRequests: true,
  preferredSport: { select: { id: true, key: true, name: true } },
} as const;

const LOCALES = ['fr', 'en', 'es'] as const;
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

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

// Adhésions du joueur connecté (clubs dont il est membre, + statut abonné).
router.get('/memberships', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const memberships = await prisma.clubMembership.findMany({
      where: { userId: req.user!.id },
      orderBy: { club: { name: 'asc' } },
      select: {
        isSubscriber: true,
        status: true,
        club: {
          select: {
            id: true, slug: true, name: true, city: true, description: true,
            accentColor: true, logoUrl: true, status: true,
            clubSports: { select: { sport: { select: { key: true, name: true, icon: true } } } },
            _count: { select: { resources: true } },
          },
        },
      },
    });
    // On expose un objet `club` au format ClubSummary (pour rendre des cartes côté accueil),
    // tout en conservant clubId/slug/isSubscriber/status (consommés par ClubHome + /reserver).
    // Filtre sur club.status ACTIVE (statut DU CLUB) — distinct de `status` (statut d'adhésion).
    res.json(
      memberships
        .filter((m) => m.club.status === 'ACTIVE')
        .map((m) => ({
          clubId: m.club.id,
          slug: m.club.slug,
          isSubscriber: m.isSubscriber,
          status: m.status,
          club: {
            id: m.club.id, slug: m.club.slug, name: m.club.name, city: m.club.city,
            description: m.club.description, accentColor: m.club.accentColor, logoUrl: m.club.logoUrl,
            sports: m.club.clubSports.map((cs) => cs.sport),
            resourceCount: m.club._count.resources,
          },
        })),
    );
  } catch (err) { next(err); }
});

// Réservations du joueur connecté.
router.get('/reservations', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await reservationService.listUserReservations(req.user!.id));
  } catch (err) { next(err); }
});

// Profil du joueur connecté (pour savoir si tél/sexe sont renseignés).
router.get('/profile', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: PROFILE_SELECT });
    res.json(user);
  } catch (err) { next(err); }
});

// Mise à jour du profil : téléphone, sexe, date de naissance, langue.
router.patch('/', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { phone, sex, birthDate, locale, showInLeaderboard, autoMatchProposals, acceptsFriendRequests, preferredSportId } = req.body;
    const data: { phone?: string | null; sex?: 'MALE' | 'FEMALE' | null; birthDate?: Date | null; locale?: string | null; showInLeaderboard?: boolean; autoMatchProposals?: boolean; acceptsFriendRequests?: boolean; preferredSportId?: string | null } = {};
    if (phone !== undefined) data.phone = typeof phone === 'string' && phone.trim() ? phone.trim() : null;
    if (sex !== undefined) {
      if (sex !== null && sex !== 'MALE' && sex !== 'FEMALE') return void res.status(400).json({ error: 'sex invalide' });
      data.sex = sex;
    }
    if (birthDate !== undefined) {
      if (birthDate === null) data.birthDate = null;
      else {
        const parsed = typeof birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? new Date(birthDate) : null;
        // new Date('2026-02-30') glisse en mars : on revérifie que l'ISO retombe sur la saisie.
        if (!parsed || isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate) {
          return void res.status(400).json({ error: 'birthDate invalide' });
        }
        data.birthDate = parsed;
      }
    }
    if (locale !== undefined) {
      if (locale !== null && !LOCALES.includes(locale)) return void res.status(400).json({ error: 'locale invalide' });
      data.locale = locale;
    }
    if (showInLeaderboard !== undefined) {
      if (typeof showInLeaderboard !== 'boolean') return void res.status(400).json({ error: 'showInLeaderboard invalide' });
      data.showInLeaderboard = showInLeaderboard;
    }
    if (autoMatchProposals !== undefined) {
      if (typeof autoMatchProposals !== 'boolean') return void res.status(400).json({ error: 'autoMatchProposals invalide' });
      data.autoMatchProposals = autoMatchProposals;
    }
    if (acceptsFriendRequests !== undefined) {
      if (typeof acceptsFriendRequests !== 'boolean') return void res.status(400).json({ error: 'acceptsFriendRequests invalide' });
      data.acceptsFriendRequests = acceptsFriendRequests;
    }
    if (preferredSportId !== undefined) {
      if (preferredSportId === null) {
        data.preferredSportId = null;
      } else {
        if (typeof preferredSportId !== 'string') return void res.status(400).json({ error: 'preferredSportId invalide' });
        const sport = await prisma.sport.findUnique({ where: { id: preferredSportId }, select: { id: true, published: true } });
        if (!sport || !sport.published) return void res.status(400).json({ error: 'preferredSportId invalide' });
        data.preferredSportId = preferredSportId;
      }
    }
    const user = await prisma.user.update({ where: { id: req.user!.id }, data, select: PROFILE_SELECT });
    res.json(user);
  } catch (err) { next(err); }
});

// Avatar : upload d'une photo (JPEG/PNG/WebP, 2 Mo max), remplace l'ancienne.
router.post('/avatar', authMiddleware, (req: AuthRequest, res: Response, next: NextFunction) => {
  avatarUpload.single('avatar')(req, res, async (err: unknown) => {
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
      const previous = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { avatarUrl: true } });
      const filename = `${req.user!.id}-${Date.now()}.${ext}`;
      ensureUploadDirs();
      await fs.promises.writeFile(path.join(AVATARS_DIR, filename), file.buffer);
      const user = await prisma.user.update({
        where: { id: req.user!.id },
        data: { avatarUrl: `/uploads/avatars/${filename}` },
        select: PROFILE_SELECT,
      });
      // Nettoyage best-effort de l'ancienne photo (jamais bloquant).
      if (previous?.avatarUrl?.startsWith('/uploads/avatars/')) {
        fs.promises.unlink(path.join(AVATARS_DIR, path.basename(previous.avatarUrl))).catch(() => {});
      }
      res.json(user);
    } catch (e) { next(e as Error); }
  });
});

// Inscriptions tournois du joueur connecté.
router.get('/tournaments', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.listUserRegistrations(req.user!.id)); }
  catch (err) { next(err); }
});

// Joueurs que le joueur connecté suit (amis), filtrables par nom.
router.get('/following', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await followService.listFollowing(req.user!.id, typeof req.query.q === 'string' ? req.query.q : undefined)); }
  catch (err) { next(err); }
});

// Joueurs qui suivent le joueur connecté.
router.get('/followers', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await followService.listFollowers(req.user!.id)); }
  catch (err) { next(err); }
});

// Amitiés confirmées du joueur connecté (filtrables par nom).
router.get('/friendships', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await friendshipService.listFriends(req.user!.id, typeof req.query.q === 'string' ? req.query.q : undefined)); }
  catch (err) { next(err); }
});

// Demandes d'ami en attente (reçues + envoyées).
router.get('/friend-requests', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await friendshipService.listRequests(req.user!.id)); }
  catch (err) { next(err); }
});

// Inscriptions actives du joueur aux animations (tous clubs).
router.get('/events', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.listUserRegistrations(req.user!.id)); }
  catch (err) { next(err); }
});

// Inscriptions du joueur aux séances de cours (tous clubs).
router.get('/lessons', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await lessonService.listUserEnrollments(req.user!.id)); }
  catch (err) { next(err); }
});

// Niveau du joueur connecté pour un sport (défaut = sport préféré du joueur, sinon padel).
router.get('/rating', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sport = await resolvePreferredSportKey(req.user!.id, req.query.sport);
    res.json(await ratingService.getForDisplay(req.user!.id, sport));
  } catch (err) {
    if (err instanceof Error && err.message === 'SPORT_NOT_FOUND') return res.status(404).json({ error: 'SPORT_NOT_FOUND' });
    next(err);
  }
});

// Historique des matchs du joueur connecté.
router.get('/matches', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const meId = req.user!.id;
    const rows = await prisma.matchPlayer.findMany({
      where: { userId: meId },
      orderBy: { match: { playedAt: 'desc' } },
      select: {
        confirmation: true, team: true, ratingAfter: true,
        match: {
          select: {
            id: true, status: true, sets: true, playedAt: true, winningTeam: true,
            confirmDeadline: true, reservationId: true,
            club: { select: { name: true } },
            sport: { select: { name: true } },
            reservation: { select: { resource: { select: { name: true } } } },
            players: { select: { userId: true, team: true, user: { select: { firstName: true, lastName: true } } } },
            _count: { select: { comments: true } },
          },
        },
      },
    });
    res.json(rows.map((r) => ({
      matchId: r.match.id, status: r.match.status, sets: r.match.sets, playedAt: r.match.playedAt,
      winningTeam: r.match.winningTeam, myTeam: r.team, myConfirmation: r.confirmation,
      ratingAfter: r.ratingAfter,
      needsMyConfirmation: r.match.status === 'PENDING' && r.confirmation === 'PENDING',
      reservationId: r.match.reservationId,
      club: { name: r.match.club.name },
      sport: { name: r.match.sport.name },
      resource: r.match.reservation?.resource ? { name: r.match.reservation.resource.name } : null,
      players: r.match.players.map((p) => ({
        userId: p.userId, team: p.team, firstName: p.user.firstName, lastName: p.user.lastName,
        isMe: p.userId === meId,
      })),
      commentCount: r.match._count.comments,
    })));
  } catch (err) { next(err); }
});

// Historique de progression du niveau (snapshots ratingAfter par match confirmé).
router.get('/rating/history', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sport = await resolvePreferredSportKey(req.user!.id, req.query.sport);
    const rows = await prisma.matchPlayer.findMany({
      where: { userId: req.user!.id, ratingAfter: { not: null }, match: { sport: { key: sport }, status: 'CONFIRMED' } },
      orderBy: { match: { playedAt: 'asc' } },
      select: { ratingAfter: true, match: { select: { playedAt: true } } },
    });
    res.json(rows.map((r) => ({ playedAt: r.match.playedAt, level: r.ratingAfter })));
  } catch (err) { next(err); }
});

// Auto-évaluation du niveau. selfLevel 1–8, ou null pour « passer » (départ neutre).
router.post('/rating/calibrate', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sport = await resolvePreferredSportKey(req.user!.id, req.body.sport);
    const raw = req.body.selfLevel;
    const selfLevel = raw === null || raw === undefined ? null : Number(raw);
    res.json(await ratingService.calibrate(req.user!.id, sport, selfLevel));
  } catch (err) {
    if (err instanceof Error && err.message === 'VALIDATION_ERROR') return res.status(400).json({ error: 'VALIDATION_ERROR' });
    if (err instanceof Error && err.message === 'SPORT_NOT_FOUND') return res.status(404).json({ error: 'SPORT_NOT_FOUND' });
    next(err);
  }
});

// Changement de mot de passe par l'utilisateur connecté (il fournit l'ancien).
router.post('/password', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || typeof currentPassword !== 'string') {
      return void res.status(400).json({ error: 'currentPassword et newPassword requis' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return void res.status(400).json({ error: 'Mot de passe trop court (8 caractères minimum)' });
    }
    if (newPassword === currentPassword) {
      return void res.status(400).json({ error: 'SAME_PASSWORD' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { password: true } });
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return void res.status(401).json({ error: 'INVALID_PASSWORD' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: req.user!.id }, data: { password: hashed } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Résumé avant suppression : blocages (unique OWNER) + avertissements (résas/abos/soldes).
router.get('/account-deletion-summary', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await accountService.getDeletionSummary(req.user!.id)); }
  catch (err) { next(err); }
});

// Suppression (anonymisation) du compte. Re-saisie du mot de passe requise.
router.delete('/', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { password } = req.body;
    if (!password || typeof password !== 'string') {
      return void res.status(400).json({ error: 'password requis' });
    }
    res.json(await accountService.deleteAccount(req.user!.id, password));
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'INVALID_PASSWORD') return void res.status(401).json({ error: 'INVALID_PASSWORD' });
    if (msg === 'OWNS_CLUB') return void res.status(409).json({ error: 'OWNS_CLUB', clubs: (err as Error & { clubs?: string[] }).clubs ?? [] });
    next(err);
  }
});

export default router;
