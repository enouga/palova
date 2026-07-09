import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'admin1', email: 'a@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

// clubMember.findUnique sert au(x) middleware(s) requireClubMember (rôle de l'ACTEUR).
const memberRoles = (roles: Record<string, 'OWNER' | 'ADMIN' | 'STAFF'>) =>
  prismaMock.clubMember.findUnique.mockImplementation(((args: any) => {
    const userId = args?.where?.userId_clubId?.userId as string;
    const role = roles[userId];
    return Promise.resolve(role ? { userId, clubId: 'club-demo', role } : null);
  }) as any);

beforeEach(() => {
  jest.clearAllMocks();
  memberRoles({ admin1: 'ADMIN' });
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
  prismaMock.memberPackage.findUnique.mockResolvedValue({
    id: 'pkg-1', clubId: 'club-demo', userId: 'u9', kind: 'ENTRIES',
    creditsRemaining: 3, creditsTotal: 10, amountRemaining: null, amountTotal: null,
    expiresAt: null, template: { name: 'Carnet' },
  } as any);
  prismaMock.memberPackage.update.mockResolvedValue({ id: 'pkg-1' } as any);
  prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);
  prismaMock.memberNote.create.mockResolvedValue({ id: 'note-1' } as any);
});

describe('POST /members/:userId/packages/:packageId/recharge', () => {
  const url = `${base}/members/u9/packages/pkg-1/recharge`;

  it('401 sans token', async () => {
    const res = await request(app).post(url).send({ addEntries: 5, price: 100 });
    expect(res.status).toBe(401);
  });

  it('201 : un STAFF peut recharger un solde', async () => {
    memberRoles({ admin1: 'STAFF' });
    const res = await request(app).post(url).set(auth).send({ addEntries: 5, price: 100, method: 'CARD' });
    expect(res.status).toBe(201);
    expect(prismaMock.payment.create).toHaveBeenCalled();
  });

  it('409 PACKAGE_EXPIRED sur un solde expiré', async () => {
    prismaMock.memberPackage.findUnique.mockResolvedValue({
      id: 'pkg-1', clubId: 'club-demo', userId: 'u9', kind: 'ENTRIES',
      creditsRemaining: 3, creditsTotal: 10, expiresAt: new Date(Date.now() - 86_400_000), template: { name: 'Carnet' },
    } as any);
    const res = await request(app).post(url).set(auth).send({ addEntries: 5, price: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PACKAGE_EXPIRED');
  });

  it('400 VALIDATION_ERROR pour une recharge invalide', async () => {
    const res = await request(app).post(url).set(auth).send({ price: 100 }); // addEntries manquant
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('404 PACKAGE_NOT_FOUND si le solde n’existe pas', async () => {
    prismaMock.memberPackage.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post(url).set(auth).send({ addEntries: 5, price: 100 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('PACKAGE_NOT_FOUND');
  });
});

describe('POST /members/:userId/packages/:packageId/adjust', () => {
  const url = `${base}/members/u9/packages/pkg-1/adjust`;

  it('200 : un STAFF peut corriger un solde', async () => {
    memberRoles({ admin1: 'STAFF' });
    const res = await request(app).post(url).set(auth).send({ newCredits: 8, reason: 'erreur' });
    expect(res.status).toBe(200);
    expect(prismaMock.memberNote.create).toHaveBeenCalled();
  });

  it('200 : un ADMIN corrige un solde', async () => {
    const res = await request(app).post(url).set(auth).send({ newCredits: 8, reason: 'erreur de saisie' });
    expect(res.status).toBe(200);
    expect(prismaMock.memberNote.create).toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_ERROR pour un motif vide', async () => {
    const res = await request(app).post(url).set(auth).send({ newCredits: 8, reason: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});
