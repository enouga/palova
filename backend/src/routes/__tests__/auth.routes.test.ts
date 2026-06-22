import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../app';

// Pas d'envoi d'email réel pendant les tests.
jest.mock('../../email/mailer', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  emailDevMode: false,
}));
import { sendPasswordResetEmail } from '../../email/mailer';

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

describe('POST /api/auth/register — preferredSportId', () => {
  it('enregistre le preferredSportId fourni si le sport est publié', async () => {
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel', published: true } as any);
    prismaMock.user.findUnique.mockResolvedValue(null as any);
    prismaMock.user.create.mockResolvedValue({ id: 'u2', email: 'pref@x.fr' } as any);
    prismaMock.emailVerification.upsert.mockResolvedValue({} as any);

    await request(app).post('/api/auth/register').send({
      email: 'pref@x.fr', password: 'password123', firstName: 'P', lastName: 'Q',
      preferredSportId: 'sport-padel',
    });

    expect(prismaMock.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ preferredSportId: 'sport-padel' }),
    }));
  });

  it('ignore un preferredSportId inconnu et inscrit quand même', async () => {
    prismaMock.sport.findUnique.mockResolvedValue(null as any);
    prismaMock.user.findUnique.mockResolvedValue(null as any);
    prismaMock.user.create.mockResolvedValue({ id: 'u3', email: 'nopref@x.fr' } as any);
    prismaMock.emailVerification.upsert.mockResolvedValue({} as any);

    const res = await request(app).post('/api/auth/register').send({
      email: 'nopref@x.fr', password: 'password123', firstName: 'N', lastName: 'P',
      preferredSportId: 'sport-inconnu',
    });

    expect(res.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ preferredSportId: 'sport-inconnu' }),
    }));
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

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => (sendPasswordResetEmail as jest.Mock).mockClear());

  it('émet un code pour un compte vérifié (réponse neutre)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@x.fr', emailVerified: true, passwordReset: null } as any);
    prismaMock.passwordReset.upsert.mockResolvedValue({} as any);

    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'a@x.fr' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(prismaMock.passwordReset.upsert).toHaveBeenCalled();
    expect(sendPasswordResetEmail).toHaveBeenCalledWith('a@x.fr', expect.any(String));
  });

  it('réponse neutre (200, ok) sans émettre de code si le compte n\'existe pas', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@x.fr' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(prismaMock.passwordReset.upsert).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('n\'émet pas de code pour un compte non vérifié (réponse neutre)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'unv@x.fr', emailVerified: false, passwordReset: null } as any);
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'unv@x.fr' });
    expect(res.status).toBe(200);
    expect(prismaMock.passwordReset.upsert).not.toHaveBeenCalled();
  });

  it('respecte le cooldown (pas de renvoi si un code vient d\'être envoyé)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@x.fr', emailVerified: true,
      passwordReset: { lastSentAt: new Date() },
    } as any);
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'a@x.fr' });
    expect(res.status).toBe(200);
    expect(prismaMock.passwordReset.upsert).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('exige un email (400)', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('réinitialise avec le bon code et renvoie un token', async () => {
    const codeHash = await bcrypt.hash('123456', 10);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@x.fr', firstName: 'Jean', lastName: 'Test', isSuperAdmin: false,
      passwordReset: { codeHash, expiresAt: new Date(Date.now() + 600000), attempts: 0 },
    } as any);
    prismaMock.$transaction.mockResolvedValue([{}, {}] as any);

    const res = await request(app).post('/api/auth/reset-password').send({ email: 'a@x.fr', code: '123456', newPassword: 'newpass123' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.email).toBe('a@x.fr');
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('rejette un mauvais code (400 CODE_INVALID) et incrémente les essais', async () => {
    const codeHash = await bcrypt.hash('123456', 10);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@x.fr',
      passwordReset: { codeHash, expiresAt: new Date(Date.now() + 600000), attempts: 0 },
    } as any);
    prismaMock.passwordReset.update.mockResolvedValue({} as any);

    const res = await request(app).post('/api/auth/reset-password').send({ email: 'a@x.fr', code: '000000', newPassword: 'newpass123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CODE_INVALID');
    expect(prismaMock.passwordReset.update).toHaveBeenCalled();
  });

  it('rejette un code expiré (410 CODE_EXPIRED)', async () => {
    const codeHash = await bcrypt.hash('123456', 10);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@x.fr',
      passwordReset: { codeHash, expiresAt: new Date(Date.now() - 1000), attempts: 0 },
    } as any);
    const res = await request(app).post('/api/auth/reset-password').send({ email: 'a@x.fr', code: '123456', newPassword: 'newpass123' });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('CODE_EXPIRED');
  });

  it('rejette un nouveau mot de passe trop court (400)', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ email: 'a@x.fr', code: '123456', newPassword: 'court' });
    expect(res.status).toBe(400);
  });

  it('rejette si aucun code en cours (400 CODE_INVALID)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@x.fr', passwordReset: null } as any);
    const res = await request(app).post('/api/auth/reset-password').send({ email: 'a@x.fr', code: '123456', newPassword: 'newpass123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CODE_INVALID');
  });
});
