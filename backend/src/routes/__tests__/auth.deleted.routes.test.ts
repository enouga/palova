import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import bcrypt from 'bcrypt';
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
