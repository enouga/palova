import { Router, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { MessagingService } from '../services/messaging.service';
import { SSEService } from '../services/sse.service';

const messagingService = new MessagingService();

const ERROR_STATUS: Record<string, number> = {
  CONVERSATION_NOT_FOUND: 404,
  MESSAGE_NOT_FOUND:      404,
  NOT_CO_MEMBERS:         403,
  NOT_ALLOWED:            403,
  USER_BLOCKED:           409,
  DM_DISABLED:            409,
  CANNOT_MESSAGE_SELF:    400,
  CANNOT_BLOCK_SELF:      400,
  VALIDATION_ERROR:       400,
};

const handleError = (err: unknown, res: Response, next: NextFunction) => {
  const message = (err as Error).message;
  const status = ERROR_STATUS[message];
  if (status) return void res.status(status).json({ error: message });
  next(err);
};

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

// ---------------------------------------------------------------------------
// Router monté sur /api/me : boîte de réception + blocages (scope « moi »).
// ---------------------------------------------------------------------------
export const meMessagingRouter = Router();

// ⚠️ /unread-count AVANT tout paramètre : sous /api/me il n'y a pas de :id ici, mais on
// garde l'ordre par cohérence avec le pattern open-matches.
meMessagingRouter.get('/conversations/unread-count', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.unreadTotal(req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

meMessagingRouter.get('/conversations', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.listConversations(req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Get-or-create : { otherUserId, clubSlug? } — clubSlug pose le club de contexte (branding).
meMessagingRouter.post('/conversations', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { otherUserId?: unknown; clubSlug?: unknown };
    const otherUserId = typeof body.otherUserId === 'string' ? body.otherUserId : '';
    const clubSlug = typeof body.clubSlug === 'string' ? body.clubSlug : null;
    res.json(await messagingService.getOrCreateConversation(req.user!.id, otherUserId, clubSlug));
  } catch (err) { handleError(err, res, next); }
});

meMessagingRouter.get('/blocks', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.listBlocks(req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});
meMessagingRouter.post('/blocks/:userId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.block(req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});
meMessagingRouter.delete('/blocks/:userId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.unblock(req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});

// ---------------------------------------------------------------------------
// Router monté sur /api/conversations : le fil d'une conversation.
// ---------------------------------------------------------------------------
export const conversationsRouter = Router();

conversationsRouter.get('/:id/messages', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const limit = typeof req.query.limit === 'string' ? req.query.limit : null;
    res.json(await messagingService.listMessages(asString(req.params.id), req.user!.id, before, limit));
  } catch (err) { handleError(err, res, next); }
});

conversationsRouter.post('/:id/messages', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = typeof (req.body as { body?: unknown }).body === 'string' ? (req.body as { body: string }).body : '';
    res.json(await messagingService.postMessage(asString(req.params.id), req.user!.id, body));
  } catch (err) { handleError(err, res, next); }
});

conversationsRouter.delete('/:id/messages/:messageId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.deleteMessage(asString(req.params.id), req.user!.id, asString(req.params.messageId))); }
  catch (err) { handleError(err, res, next); }
});

conversationsRouter.post('/:id/messages/:messageId/reactions', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const emoji = typeof (req.body as { emoji?: unknown }).emoji === 'string' ? (req.body as { emoji: string }).emoji : '';
    res.json(await messagingService.addReaction(asString(req.params.id), req.user!.id, asString(req.params.messageId), emoji));
  } catch (err) { handleError(err, res, next); }
});

conversationsRouter.delete('/:id/messages/:messageId/reactions', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const emoji = typeof req.query.emoji === 'string' ? req.query.emoji : '';
    res.json(await messagingService.removeReaction(asString(req.params.id), req.user!.id, asString(req.params.messageId), emoji));
  } catch (err) { handleError(err, res, next); }
});

conversationsRouter.post('/:id/read', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.markRead(asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

conversationsRouter.post('/:id/typing', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.typing(asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Message photo : multipart { image, body? } — 5 Mo max, JPEG/PNG/WebP.
conversationsRouter.post('/:id/images', authMiddleware, (req: AuthRequest, res: Response, next: NextFunction) => {
  imageUpload.single('image')(req, res, async (err: unknown) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return void res.status(400).json({ error: 'Image trop lourde (5 Mo max)' });
        }
        return next(err as Error);
      }
      if (!req.file) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
      const caption = typeof (req.body as { body?: unknown })?.body === 'string' ? (req.body as { body: string }).body : '';
      res.json(await messagingService.createImageMessage(asString(req.params.id), req.user!.id, req.file, caption));
    } catch (e) { handleError(e, res, next); }
  });
});

// Streaming authentifié de la photo (les <img> ne posent pas d'Authorization → token en query).
conversationsRouter.get('/:id/messages/:messageId/image', async (req: AuthRequest, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  let userId: string;
  try { userId = (jwt.verify(token, process.env.JWT_SECRET!) as { id: string }).id; }
  catch { return void res.status(401).end(); }
  try {
    const { absPath, mime } = await messagingService.imagePathFor(asString(req.params.id), userId, asString(req.params.messageId));
    // dotfiles:'allow' — sinon `send` répond « Not Found » dès qu'un segment du chemin ABSOLU
    // contient un point (ex. dev depuis un worktree sous .claude/) ; imageUrl est déjà validé anti-traversée.
    res.sendFile(absPath, { dotfiles: 'allow', headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=31536000, immutable' } });
  } catch { res.status(404).end(); }
});

// Flux SSE du fil. EventSource ne pose pas d'en-tête Authorization → token en query + garde.
conversationsRouter.get('/:id/stream', async (req: AuthRequest, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  let userId: string;
  try { userId = (jwt.verify(token, process.env.JWT_SECRET!) as { id: string }).id; }
  catch { return void res.status(401).end(); }
  try { await messagingService.assertParticipantPublic(asString(req.params.id), userId); }
  catch { return void res.status(403).end(); }
  SSEService.getInstance().addConversationClient(asString(req.params.id), userId, res);
});
