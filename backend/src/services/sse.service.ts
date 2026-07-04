import { Response } from 'express';

export interface SSEEvent {
  type: 'slot_held' | 'slot_confirmed' | 'slot_released' | 'connected';
  resourceId: string;
  reservationId?: string;
  startTime?: string;
  endTime?: string;
  expiresAt?: string;
}

export class SSEService {
  private static instance: SSEService;
  private clients: Map<string, Set<Response>> = new Map();
  private userClients: Map<string, Set<Response>> = new Map();
  // Clients abonnés au fil d'une partie : reservationId -> (Response -> userId).
  // On garde l'userId pour savoir qui regarde le fil en direct (ciblage des notifs).
  private matchClients: Map<string, Map<Response, string>> = new Map();
  // Clients abonnés au fil d'une conversation privée : conversationId -> (Response -> userId).
  private conversationClients: Map<string, Map<Response, string>> = new Map();

  private constructor() {}

  static getInstance(): SSEService {
    if (!SSEService.instance) SSEService.instance = new SSEService();
    return SSEService.instance;
  }

  addClient(resourceId: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 30_000);

    if (!this.clients.has(resourceId)) this.clients.set(resourceId, new Set());
    this.clients.get(resourceId)!.add(res);

    res.on('close', () => {
      clearInterval(keepAlive);
      this.clients.get(resourceId)?.delete(res);
      if (this.clients.get(resourceId)?.size === 0) this.clients.delete(resourceId);
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', resourceId })}\n\n`);
  }

  broadcast(resourceId: string, event: SSEEvent): void {
    const clients = this.clients.get(resourceId);
    if (!clients?.size) return;

    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const dead: Response[] = [];

    clients.forEach((res) => {
      try {
        res.write(payload);
      } catch {
        dead.push(res);
      }
    });

    dead.forEach((res) => clients.delete(res));
  }

  getClientCount(resourceId: string): number {
    return this.clients.get(resourceId)?.size ?? 0;
  }

  /** Abonne un client au flux de SES propres notifications (cloche en live). */
  addUserClient(userId: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 30_000);

    if (!this.userClients.has(userId)) this.userClients.set(userId, new Set());
    this.userClients.get(userId)!.add(res);

    res.on('close', () => {
      clearInterval(keepAlive);
      this.userClients.get(userId)?.delete(res);
      if (this.userClients.get(userId)?.size === 0) this.userClients.delete(userId);
    });

    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  }

  /** Pousse un évènement aux flux ouverts d'un utilisateur (best-effort). */
  notifyUser(userId: string, data: unknown): void {
    const clients = this.userClients.get(userId);
    if (!clients?.size) return;
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    const dead: Response[] = [];
    clients.forEach((res) => { try { res.write(payload); } catch { dead.push(res); } });
    dead.forEach((res) => clients.delete(res));
  }

  getUserClientCount(userId: string): number {
    return this.userClients.get(userId)?.size ?? 0;
  }

  /** Abonne un client au flux d'une partie ouverte (chat temps réel). */
  addMatchClient(reservationId: string, userId: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 30_000);

    if (!this.matchClients.has(reservationId)) this.matchClients.set(reservationId, new Map());
    this.matchClients.get(reservationId)!.set(res, userId);

    res.on('close', () => {
      clearInterval(keepAlive);
      this.matchClients.get(reservationId)?.delete(res);
      if (this.matchClients.get(reservationId)?.size === 0) this.matchClients.delete(reservationId);
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', reservationId })}\n\n`);
  }

  /** Diffuse un évènement à tous les clients du fil d'une partie (best-effort). */
  broadcastMatch(reservationId: string, event: unknown): void {
    const clients = this.matchClients.get(reservationId);
    if (!clients?.size) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const dead: Response[] = [];
    clients.forEach((_userId, res) => { try { res.write(payload); } catch { dead.push(res); } });
    dead.forEach((res) => clients.delete(res));
  }

  /** Ensemble des userId actuellement connectés au fil d'une partie. */
  getMatchUserIds(reservationId: string): Set<string> {
    return new Set(this.matchClients.get(reservationId)?.values() ?? []);
  }

  /** Abonne un client au flux d'une conversation privée (messagerie temps réel). */
  addConversationClient(conversationId: string, userId: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 30_000);

    if (!this.conversationClients.has(conversationId)) this.conversationClients.set(conversationId, new Map());
    this.conversationClients.get(conversationId)!.set(res, userId);

    res.on('close', () => {
      clearInterval(keepAlive);
      this.conversationClients.get(conversationId)?.delete(res);
      if (this.conversationClients.get(conversationId)?.size === 0) this.conversationClients.delete(conversationId);
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', conversationId })}\n\n`);
  }

  /** Diffuse un évènement à tous les clients du fil d'une conversation (best-effort). */
  broadcastConversation(conversationId: string, event: unknown): void {
    const clients = this.conversationClients.get(conversationId);
    if (!clients?.size) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const dead: Response[] = [];
    clients.forEach((_userId, res) => { try { res.write(payload); } catch { dead.push(res); } });
    dead.forEach((res) => clients.delete(res));
  }

  /** Ensemble des userId actuellement connectés au fil d'une conversation. */
  getConversationUserIds(conversationId: string): Set<string> {
    return new Set(this.conversationClients.get(conversationId)?.values() ?? []);
  }
}
