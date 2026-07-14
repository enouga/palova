import { redis } from '../redis/client';

/**
 * Fenêtre fixe (pas de sliding window) : clé `rl:{bucket}:{userId}:{floor(now/windowSec)}`.
 * Fail-open sur toute erreur Redis (down, timeout) — le chat ne meurt jamais si Redis est
 * indisponible ; seul le dépassement RÉEL de la limite lève.
 */
export async function assertRateLimit(bucket: string, userId: string, max: number, windowSec: number): Promise<void> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${bucket}:${userId}:${windowStart}`;
  let count: number;
  try {
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
  } catch (err) {
    console.error('[rateLimit] Redis indisponible, fail-open', err);
    return;
  }
  if (count > max) throw new Error('RATE_LIMITED');
}
