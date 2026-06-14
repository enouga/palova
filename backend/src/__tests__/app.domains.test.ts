import '../__mocks__/prisma';
import request from 'supertest';
import app from '../app';

// Multi-domaines : app.ts lit FRONTEND_ROOT_DOMAINS à CHAQUE requête (CORS + tls-check),
// il suffit donc que la variable soit posée avant l'exécution des tests.
const OLD = process.env.FRONTEND_ROOT_DOMAINS;
process.env.FRONTEND_ROOT_DOMAINS = 'palova.fr,palova.app';

afterAll(() => {
  if (OLD === undefined) delete process.env.FRONTEND_ROOT_DOMAINS;
  else process.env.FRONTEND_ROOT_DOMAINS = OLD;
});

describe('GET /internal/tls-check (multi-domaines)', () => {
  it.each([
    'palova.fr',
    'demo.palova.fr',
    'api.palova.fr',
    'www.palova.fr',
    'palova.app',
    'demo.palova.app',
    'www.palova.app',
  ])('autorise %s (200)', async (domain) => {
    const res = await request(app).get('/internal/tls-check').query({ domain });
    expect(res.status).toBe(200);
  });

  it.each([
    'evil.com',
    'palova.fr.evil.com',
    '',
  ])('refuse %s (403)', async (domain) => {
    const res = await request(app).get('/internal/tls-check').query({ domain });
    expect(res.status).toBe(403);
  });
});

describe('CORS (multi-domaines)', () => {
  it.each([
    'https://palova.app',
    'https://demo.palova.app',
    'https://palova.fr',
    'https://demo.palova.fr',
  ])('reflète l\'origine autorisée %s', async (origin) => {
    const res = await request(app).get('/health').set('Origin', origin);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('n\'autorise pas une origine tierce', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.com');
    expect(res.status).toBe(200); // la requête passe, mais sans en-tête CORS autorisant l'origine
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
