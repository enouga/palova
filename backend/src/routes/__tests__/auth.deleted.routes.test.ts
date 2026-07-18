import '../../__mocks__/prisma';
import '../../__mocks__/redis';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import app from '../../app';

it('login refuse un compte supprimé (deletedAt non null) → 401', async () => {
  const password = await bcrypt.hash('password123', 10);
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'u1', email: 't@x.fr', password, emailVerified: true, deletedAt: new Date(), isSuperAdmin: false,
    firstName: 'X', lastName: 'Y',
  } as any);
  const res = await request(app).post('/api/auth/login').send({ email: 't@x.fr', password: 'password123' });
  expect(res.status).toBe(401);
});

it('un token deja emis est revoque des que le compte est supprime (deletedAt)', async () => {
  const tokenBeforeDeletion = jwt.sign({ id: 'u1', email: 't@x.fr' }, process.env.JWT_SECRET!);
  // Le compte est supprime APRES l'emission du token : authMiddleware doit le revoquer
  // en le revérifiant en base a chaque requete (audit pré-MEP §2.2).
  prismaMock.user.findUnique.mockResolvedValue({ tokenVersion: 0, deletedAt: new Date() } as never);
  const res = await request(app).get('/api/me/profile').set('Authorization', `Bearer ${tokenBeforeDeletion}`);
  expect(res.status).toBe(401);
});

it('un token signe avant une reinitialisation de mot de passe est revoque (tokenVersion)', async () => {
  const staleToken = jwt.sign({ id: 'u1', email: 't@x.fr', tokenVersion: 0 }, process.env.JWT_SECRET!);
  // Le mot de passe a ete reinitialise depuis : tokenVersion en base a avance.
  prismaMock.user.findUnique.mockResolvedValue({ tokenVersion: 1, deletedAt: null } as never);
  const res = await request(app).get('/api/me/profile').set('Authorization', `Bearer ${staleToken}`);
  expect(res.status).toBe(401);
});

it('un token a jour (meme tokenVersion, compte actif) reste valide', async () => {
  const validToken = jwt.sign({ id: 'u1', email: 't@x.fr', tokenVersion: 2 }, process.env.JWT_SECRET!);
  prismaMock.user.findUnique.mockImplementation(((args: { select?: { tokenVersion?: boolean } }) => (
    args?.select?.tokenVersion
      ? Promise.resolve({ tokenVersion: 2, deletedAt: null })
      : Promise.resolve({ id: 'u1', email: 't@x.fr', firstName: 'X', lastName: 'Y', isSuperAdmin: false })
  )) as never);
  // GET /profile calcule aussi le statut légal (legalService.statusFor) : mocks requis
  // sinon rows/ownsClub valent undefined et le service casse sur undefined.find (cf. me.ts).
  prismaMock.legalAcceptance.findMany.mockResolvedValue([]);
  prismaMock.clubMember.findFirst.mockResolvedValue(null);
  const res = await request(app).get('/api/me/profile').set('Authorization', `Bearer ${validToken}`);
  expect(res.status).toBe(200);
});
