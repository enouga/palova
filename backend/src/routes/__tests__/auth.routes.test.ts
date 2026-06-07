import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../app';

// Pas d'envoi d'email réel pendant les tests.
jest.mock('../../email/mailer', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  emailDevMode: false,
}));

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');

describe('POST /api/auth/register', () => {
  it('crée un compte non vérifié, envoie un code, ne renvoie PAS de token', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as any);
    prismaMock.user.create.mockResolvedValue({ id: 'u1', email: 'new@x.fr' } as any);
    prismaMock.emailVerification.upsert.mockResolvedValue({} as any);

    const res = await request(app).post('/api/auth/register').send({
      email: 'new@x.fr', password: 'password123', firstName: 'Jean', lastName: 'Test',
    });

    expect(res.status).toBe(201);
    expect(res.body.pendingVerification).toBe(true);
    expect(res.body.email).toBe('new@x.fr');
    expect(res.body.token).toBeUndefined();
    expect(prismaMock.emailVerification.upsert).toHaveBeenCalled();
  });

  it('refuse (409) si l\'email existe déjà ET est vérifié', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'taken@x.fr', emailVerified: true } as any);
    const res = await request(app).post('/api/auth/register').send({
      email: 'taken@x.fr', password: 'password123', firstName: 'Jean', lastName: 'Test',
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/verify-email', () => {
  it('valide le bon code et renvoie un token', async () => {
    const codeHash = await bcrypt.hash('123456', 10);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'new@x.fr', firstName: 'Jean', lastName: 'Test', isSuperAdmin: false,
      emailVerified: false,
      emailVerification: { codeHash, expiresAt: new Date(Date.now() + 600000), attempts: 0 },
    } as any);
    prismaMock.$transaction.mockResolvedValue([{}, {}] as any);

    const res = await request(app).post('/api/auth/verify-email').send({ email: 'new@x.fr', code: '123456' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  it('rejette un mauvais code (400 CODE_INVALID) et incrémente les essais', async () => {
    const codeHash = await bcrypt.hash('123456', 10);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'new@x.fr', emailVerified: false,
      emailVerification: { codeHash, expiresAt: new Date(Date.now() + 600000), attempts: 0 },
    } as any);
    prismaMock.emailVerification.update.mockResolvedValue({} as any);

    const res = await request(app).post('/api/auth/verify-email').send({ email: 'new@x.fr', code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CODE_INVALID');
    expect(prismaMock.emailVerification.update).toHaveBeenCalled();
  });
});

describe('POST /api/auth/login', () => {
  it('bloque un compte non vérifié (403 EMAIL_NOT_VERIFIED)', async () => {
    const password = await bcrypt.hash('password123', 10);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'unv@x.fr', password, emailVerified: false } as any);
    const res = await request(app).post('/api/auth/login').send({ email: 'unv@x.fr', password: 'password123' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('EMAIL_NOT_VERIFIED');
  });
});
