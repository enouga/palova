import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');
const token = () => jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!);
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'OWNER' } as any);
});

describe('admin — pages de contenu', () => {
  it('GET /pages sans token → 401', async () => {
    const res = await request(app).get(`${base}/pages`);
    expect(res.status).toBe(401);
  });

  it('GET /pages → 200 liste', async () => {
    prismaMock.clubPage.findMany.mockResolvedValue([] as any);
    const res = await request(app).get(`${base}/pages`).set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('PUT /pages/:kind → 200 (upsert)', async () => {
    prismaMock.clubPage.upsert.mockResolvedValue({ id: 'p1', kind: 'CGV' } as any);
    const res = await request(app).put(`${base}/pages/CGV`).set(auth).send({ bodyMarkdown: '# Mes CGV', published: true });
    expect(res.status).toBe(200);
    const arg = (prismaMock.clubPage.upsert as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ clubId_kind: { clubId: 'club-demo', kind: 'CGV' } });
  });

  it('PUT /pages/:kind type inconnu → 400', async () => {
    const res = await request(app).put(`${base}/pages/BADKIND`).set(auth).send({ bodyMarkdown: '# x' });
    expect(res.status).toBe(400);
  });

  it('PUT /pages/:kind markdown vide → 400', async () => {
    const res = await request(app).put(`${base}/pages/CGV`).set(auth).send({ bodyMarkdown: '   ' });
    expect(res.status).toBe(400);
  });

  it('GET /pages/:kind/template → 200 markdown', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      name: 'Padel Arena', legalEntityName: 'Padel Arena SAS', legalForm: 'SAS', siret: '1', vatNumber: null,
      legalRepresentative: 'C', legalEmail: 'c@a.fr', legalPhone: null, address: '12 rue', city: 'Lyon',
    } as any);
    const res = await request(app).get(`${base}/pages/MENTIONS_LEGALES/template`).set(auth);
    expect(res.status).toBe(200);
    expect(typeof res.body.bodyMarkdown).toBe('string');
    expect(res.body.bodyMarkdown).toContain('Padel Arena SAS');
  });
});

describe('admin — FAQ', () => {
  it('GET /faq → 200 liste', async () => {
    prismaMock.clubFaqItem.findMany.mockResolvedValue([] as any);
    const res = await request(app).get(`${base}/faq`).set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /faq → 201', async () => {
    prismaMock.clubFaqItem.findFirst.mockResolvedValue(null as any);
    prismaMock.clubFaqItem.create.mockResolvedValue({ id: 'f1' } as any);
    const res = await request(app).post(`${base}/faq`).set(auth).send({ question: 'Q ?', answerMarkdown: 'A' });
    expect(res.status).toBe(201);
  });

  it('POST /faq question vide → 400', async () => {
    const res = await request(app).post(`${base}/faq`).set(auth).send({ question: '  ', answerMarkdown: 'A' });
    expect(res.status).toBe(400);
  });

  it('PATCH /faq/reorder → 200', async () => {
    prismaMock.$transaction.mockResolvedValue([] as any);
    const res = await request(app).patch(`${base}/faq/reorder`).set(auth).send({ orderedIds: ['a', 'b'] });
    expect(res.status).toBe(200);
  });

  it('PATCH /faq/reorder sans tableau → 400', async () => {
    const res = await request(app).patch(`${base}/faq/reorder`).set(auth).send({ orderedIds: 'nope' });
    expect(res.status).toBe(400);
  });

  it('DELETE /faq/:id introuvable → 404', async () => {
    prismaMock.clubFaqItem.findUnique.mockResolvedValue(null as any);
    const res = await request(app).delete(`${base}/faq/inconnu`).set(auth);
    expect(res.status).toBe(404);
  });
});
