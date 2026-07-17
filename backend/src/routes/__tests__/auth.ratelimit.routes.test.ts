import '../../__mocks__/prisma';
import '../../__mocks__/redis';
import { prismaMock } from '../../__mocks__/prisma';
import { redisMock } from '../../__mocks__/redis';
import request from 'supertest';
import app from '../../app';

// Pas d'envoi d'email réel.
jest.mock('../../email/mailer', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  emailDevMode: false,
}));

describe('Rate limiting des routes d\'auth', () => {
  it('renvoie 429 RATE_LIMITED quand la limite par IP est dépassée', async () => {
    redisMock.incr.mockResolvedValue(21); // > 20/min (limite IP de /login)
    const res = await request(app).post('/api/auth/login').send({ email: 'a@x.fr', password: 'password123' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('RATE_LIMITED');
    // Le handler ne doit pas s'exécuter : aucune recherche d'utilisateur.
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('renvoie 429 quand c\'est la limite par EMAIL qui est dépassée (IP OK)', async () => {
    // 1er incr = IP (OK, sous la limite), 2e incr = email (dépassé).
    redisMock.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(9); // 9 > 8/min
    const res = await request(app).post('/api/auth/login').send({ email: 'a@x.fr', password: 'password123' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('RATE_LIMITED');
  });

  it('laisse passer la requête sous la limite (comportement normal du handler)', async () => {
    redisMock.incr.mockResolvedValue(1);
    prismaMock.user.findUnique.mockResolvedValue(null as any); // identifiants invalides
    const res = await request(app).post('/api/auth/login').send({ email: 'a@x.fr', password: 'password123' });
    expect(res.status).toBe(401); // pas 429 : le middleware a laissé passer
    expect(prismaMock.user.findUnique).toHaveBeenCalled();
  });

  it('fail-open : si Redis est indisponible, la connexion n\'est jamais bloquée', async () => {
    redisMock.incr.mockRejectedValue(new Error('Redis down'));
    prismaMock.user.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post('/api/auth/login').send({ email: 'a@x.fr', password: 'password123' });
    expect(res.status).toBe(401); // le handler tourne malgré la panne Redis
    expect(res.status).not.toBe(429);
  });
});
