import { Router } from 'express';
import { vapidPublicKey } from '../services/notification/push';

const router = Router();

router.get('/vapid-public-key', (_req, res) => res.json({ publicKey: vapidPublicKey() }));

export default router;
