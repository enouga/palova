import { Router } from 'express';
import { OpenMatchService } from '../services/openMatch.service';

// Parties ouvertes hors contexte club (les routes club vivent dans clubs.ts).
const router = Router();
const service = new OpenMatchService();

// Vitrine palova.fr : parties ouvertes publiques agrégées tous clubs (pas d'auth).
router.get('/national', async (_req, res, next) => {
  try { res.json(await service.listNationalOpenMatches()); }
  catch (err) { next(err as Error); }
});

export default router;
