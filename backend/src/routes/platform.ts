import { Router, Response, NextFunction } from 'express';
import { PlatformService } from '../services/platform.service';
import { SportCatalogService } from '../services/sport-catalog.service';

const router = Router();
const platform = new PlatformService();
const sportCatalog = new SportCatalogService();

const ERROR_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  SLUG_INVALID:     400,
  SLUG_RESERVED:    400,
  EMAIL_TAKEN:      409,
  SLUG_TAKEN:       409,
  CLUB_NOT_FOUND:   404,
  SPORT_KEY_TAKEN:  409,
  SPORT_IN_USE:     409,
  SPORT_NOT_FOUND:  404,
};

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

router.patch('/clubs/:id', async (req, res, next) => {
  try { res.json(await platform.setClubStatus(req.params.id, req.body?.status)); }
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

export default router;
