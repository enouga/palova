import Redis from 'ioredis';

// Options communes. En prod (Render), on passe par REDIS_URL (avec mot de passe/TLS) ;
// en local, on retombe sur host/port sans auth.
const options = {
  retryStrategy: (times: number) => Math.min(times * 100, 3000),
  enableOfflineQueue: false,
  lazyConnect: true,
};

export const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, options)
  : new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      ...options,
    });

redis.on('error', (err) => console.error('[Redis]', err.message));
redis.on('connect', () => console.log('[Redis] Connected'));
