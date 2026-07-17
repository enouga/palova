import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant');
const token = jwt.sign({ id: 'actor-1', email: 'a@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token}` };
const base = '/api/clubs/club-demo/admin';

// La garde requireClubMember lit clubMember.findUnique → on pilote le rôle de l'acteur.
const asRole = (role: 'OWNER' | 'ADMIN' | 'STAFF' | null) =>
  prismaMock.clubMember.findUnique.mockResolvedValue(role ? { role } : null as any);

beforeEach(() => { jest.clearAllMocks(); });

// Chaque entrée : [méthode, chemin, corps éventuel]
type Call = ['get' | 'post' | 'patch' | 'put' | 'delete', string, object?];
const send = (c: Call) => {
  const [m, p, body] = c;
  const r = request(app)[m](`${base}${p}`).set(auth);
  return body ? r.send(body) : r;
};

// Routes qui DOIVENT devenir ADMIN.
const ADMIN_ROUTES: Call[] = [
  ['patch', '/', { name: 'X' }],
  ['post', '/sports', { sportId: 's1' }],
  ['patch', '/sports/cs1', { durationsMin: [60] }],
  ['post', '/resources', { clubSportId: 'cs1' }],
  ['patch', '/resources/reorder', { orderedIds: ['r1'] }],
  ['patch', '/resources/r1', { name: 'Court 1' }],
  ['patch', '/resources/r1/active', { isActive: false }],
  ['delete', '/resources/r1'],
  ['post', '/packages/templates', { name: 'P' }],
  ['patch', '/packages/templates/t1', { name: 'P' }],
  ['post', '/subscription-plans', { name: 'A' }],
  ['patch', '/subscription-plans/p1', { name: 'A' }],
  ['get', '/accounting/export?from=2026-01-01&to=2026-01-31'],
  ['get', '/pages'],
  ['get', '/pages/CGV/template'],
  ['put', '/pages/CGV', { bodyMarkdown: '# x', published: true }],
  ['get', '/faq'],
  ['post', '/faq', { question: 'Q', answer: 'A' }],
  ['patch', '/faq/reorder', { orderedIds: ['f1'] }],
  ['patch', '/faq/f1', { question: 'Q' }],
  ['delete', '/faq/f1'],
];

// Uploads multipart gatés ADMIN (on teste seulement le refus STAFF/non-membre : la garde
// s'exécute AVANT multer, donc pas besoin de pièce jointe).
const ADMIN_UPLOADS: Call[] = [
  ['post', '/club-logo'],
  ['post', '/club-cover'],
  ['post', '/packages/templates/t1/image'],
  ['post', '/subscription-plans/p1/image'],
];

// Lectures qui RESTENT STAFF (non-régression).
const STAFF_READS: Call[] = [
  ['get', '/'],
  ['get', '/resources'],
  ['get', '/sports'],
  ['get', '/packages/templates'],
  ['get', '/packages/active'],
  ['get', '/subscription-plans'],
  ['get', '/accounting/summary?year=2026&month=1'],
];

describe('Gardes de rôle — routes devenues ADMIN', () => {
  it.each([...ADMIN_ROUTES, ...ADMIN_UPLOADS])('STAFF → 403 sur %s %s', async (...c) => {
    asRole('STAFF');
    const res = await send(c as Call);
    expect(res.status).toBe(403);
  });

  it.each([...ADMIN_ROUTES, ...ADMIN_UPLOADS])('non-membre → 403 sur %s %s', async (...c) => {
    asRole(null);
    const res = await send(c as Call);
    expect(res.status).toBe(403);
  });

  it.each(ADMIN_ROUTES)('ADMIN → pas 403 (garde franchie) sur %s %s', async (...c) => {
    asRole('ADMIN');
    const res = await send(c as Call);
    expect(res.status).not.toBe(403);
  });
});

describe('Non-régression — lectures qui restent STAFF', () => {
  it.each(STAFF_READS)('STAFF → pas 403 sur %s %s', async (...c) => {
    asRole('STAFF');
    const res = await send(c as Call);
    expect(res.status).not.toBe(403);
  });
});
