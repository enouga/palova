import { Router, Response, NextFunction } from 'express';
import { PlatformService } from '../services/platform.service';
import { PlatformStatsService } from '../services/platformStats.service';
import { SportCatalogService } from '../services/sport-catalog.service';
import { syncAllInvoices } from '../services/platformBilling/platformInvoices';
import {
  setClubSubscriptionTier, cancelClubSubscription, resumeClubSubscription,
} from '../services/platformBilling/subscriptionAdmin';
import { ModerationService } from '../services/moderation.service';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const platform = new PlatformService();
const platformStats = new PlatformStatsService();
const sportCatalog = new SportCatalogService();
const moderationService = new ModerationService();

const ERROR_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  SIRET_INVALID:    400,
  SLUG_INVALID:     400,
  SLUG_RESERVED:    400,
  TIER_INVALID:     400,
  EMAIL_TAKEN:      409,
  SLUG_TAKEN:       409,
  NO_SUBSCRIPTION:  409,
  CLUB_NOT_FOUND:   404,
  SPORT_KEY_TAKEN:  409,
  SPORT_IN_USE:     409,
  SPORT_NOT_FOUND:  404,
  REPORT_NOT_FOUND: 404,
};

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

const handleError = (err: unknown, res: Response, next: NextFunction) => {
  const message = (err as Error).message;
  const status = ERROR_STATUS[message];
  if (status) return void res.status(status).json({ error: message });
  next(err);
};

// Toutes ces routes sont déjà derrière authMiddleware + requireSuperAdmin (montage app.ts).
router.get('/stats', async (_req, res, next) => {
  try { res.json(await platform.getStats()); } catch (err) { handleError(err, res, next); }
});

router.get('/clubs', async (_req, res, next) => {
  try { res.json(await platform.listClubs()); } catch (err) { handleError(err, res, next); }
});

// Stats plateforme (croissance + activité par club) et facturation (MRR + CA encaissé).
router.get('/stats/usage', async (_req, res, next) => {
  try { res.json(await platformStats.usageStats()); } catch (err) { handleError(err, res, next); }
});

router.get('/billing/overview', async (_req, res, next) => {
  try { res.json(await platformStats.billingOverview()); } catch (err) { handleError(err, res, next); }
});

// Backfill / rattrapage des factures Stripe (webhook raté, historique pré-v2).
router.post('/billing/sync-invoices', async (_req, res, next) => {
  try { res.json(await syncAllInvoices()); } catch (err) { handleError(err, res, next); }
});

// Fiche club détaillée (drill-down superadmin). Déclarée après les routes /clubs/* fixes.
router.get('/clubs/:id', async (req, res, next) => {
  try { res.json(await platform.getClubDetail(req.params.id)); }
  catch (err) { handleError(err, res, next); }
});

// Actions superadmin sur l'abonnement SaaS d'un club.
router.post('/clubs/:id/billing/tier', async (req, res, next) => {
  try { res.json(await setClubSubscriptionTier(req.params.id, req.body?.tier, req.body?.interval)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/clubs/:id/billing/cancel', async (req, res, next) => {
  try { res.json(await cancelClubSubscription(req.params.id)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/clubs/:id/billing/resume', async (req, res, next) => {
  try { res.json(await resumeClubSubscription(req.params.id)); }
  catch (err) { handleError(err, res, next); }
});

router.patch('/clubs/:id', async (req, res, next) => {
  try { res.json(await platform.setClubStatus(req.params.id, req.body?.status)); }
  catch (err) { handleError(err, res, next); }
});

// Exonération de facturation SaaS (clubs partenaires/pilotes).
router.patch('/clubs/:id/billing-exempt', async (req, res, next) => {
  try { res.json(await platform.setBillingExempt(req.params.id, req.body?.exempt)); }
  catch (err) { handleError(err, res, next); }
});

// Changement d'alias (slug / sous-domaine) d'un club. L'ancien slug devient un alias permanent.
router.post('/clubs/:id/slug', async (req, res, next) => {
  try { res.json(await platform.changeClubSlug(req.params.id, req.body?.slug)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/clubs', async (req, res, next) => {
  try { res.status(201).json(await platform.createClubWithOwner(req.body)); }
  catch (err) { handleError(err, res, next); }
});

router.get('/sports', async (_req, res, next) => {
  try { res.json(await sportCatalog.listSports()); }
  catch (err) { handleError(err, res, next); }
});

router.post('/sports', async (req, res, next) => {
  try { res.status(201).json(await sportCatalog.createSport(req.body)); }
  catch (err) { handleError(err, res, next); }
});

router.patch('/sports/:id', async (req, res, next) => {
  try { res.json(await sportCatalog.updateSport(req.params.id, req.body)); }
  catch (err) { handleError(err, res, next); }
});

router.delete('/sports/:id', async (req, res, next) => {
  try { res.json(await sportCatalog.deleteSport(req.params.id)); }
  catch (err) { handleError(err, res, next); }
});

// --- Modération (signalements de messagerie privée — jamais le chat de partie, réservé au staff club) ---

router.get('/moderation/reports', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const items = await moderationService.listPlatformReports({ status });
    res.json({ items });
  } catch (err) { handleError(err, res, next); }
});

router.post('/moderation/reports/:reportId/resolve', async (req: AuthRequest, res, next) => {
  try {
    const action = (req.body as { action?: unknown })?.action;
    if (action !== 'DELETE' && action !== 'REJECT') return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    res.json(await moderationService.resolvePlatformReport(asString(req.params.reportId), req.user!.id, action));
  } catch (err) { handleError(err, res, next); }
});

router.get('/moderation/reports/:id/image', async (req, res) => {
  try {
    const { absPath, mime } = await moderationService.platformReportImagePath(asString(req.params.id));
    res.sendFile(absPath, { dotfiles: 'allow', headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=60' } });
  } catch { res.status(404).end(); }
});

export default router;
