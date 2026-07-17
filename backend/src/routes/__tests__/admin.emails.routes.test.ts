import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import sharp from 'sharp';

let listImpl = jest.fn();
let getImpl = jest.fn();
let upsertImpl = jest.fn();
let removeImpl = jest.fn();
let previewImpl = jest.fn();
let testImpl = jest.fn();

jest.mock('../../services/emailTemplate.service', () => ({
  EmailTemplateService: jest.fn().mockImplementation(() => ({
    listForAdmin: (...a: any[]) => listImpl(...a),
    getForAdmin: (...a: any[]) => getImpl(...a),
    upsert: (...a: any[]) => upsertImpl(...a),
    remove: (...a: any[]) => removeImpl(...a),
    renderPreview: (...a: any[]) => previewImpl(...a),
    sendTest: (...a: any[]) => testImpl(...a),
  })),
}));

import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const auth = { Authorization: `Bearer ${jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!)}` };
const base = '/api/clubs/club-demo/admin/emails';

beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'ADMIN' } as any);
  prismaMock.user.findUnique.mockResolvedValue({ email: 'owner@x.fr' } as any);
  listImpl.mockReset().mockResolvedValue([{ type: 'registration.confirmed', group: 'inscriptions', title: 'X', description: 'd', customized: false }]);
  getImpl.mockReset().mockResolvedValue({ type: 'registration.confirmed', vars: [], defaults: {}, override: null });
  upsertImpl.mockReset().mockResolvedValue({ override: {}, unknownVars: [] });
  removeImpl.mockReset().mockResolvedValue(undefined);
  previewImpl.mockReset().mockResolvedValue({ subject: 's', html: '<html></html>' });
  testImpl.mockReset().mockResolvedValue(undefined);
});

describe('GET /emails', () => {
  it('401 sans token', async () => {
    expect((await request(app).get(base)).status).toBe(401);
  });
  it('200 pour STAFF (accès élargi à toute l\'équipe)', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
    expect((await request(app).get(base).set(auth)).status).toBe(200);
  });
  it('200 items pour ADMIN', async () => {
    const res = await request(app).get(base).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('GET /emails/:type', () => {
  it('404 EMAIL_TYPE_UNKNOWN', async () => {
    getImpl.mockRejectedValue(new Error('EMAIL_TYPE_UNKNOWN'));
    const res = await request(app).get(`${base}/nope`).set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('EMAIL_TYPE_UNKNOWN');
  });
  it('200 detail', async () => {
    const res = await request(app).get(`${base}/registration.confirmed`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('registration.confirmed');
  });
});

describe('PUT /emails/:type', () => {
  it('200 + unknownVars', async () => {
    upsertImpl.mockResolvedValue({ override: { subject: 's' }, unknownVars: ['x'] });
    const res = await request(app).put(`${base}/registration.confirmed`).set(auth)
      .send({ subject: 's', heading: 'h', bodyHtml: '<p>b</p>' });
    expect(res.status).toBe(200);
    expect(res.body.unknownVars).toEqual(['x']);
  });
  it('400 VALIDATION_ERROR', async () => {
    upsertImpl.mockRejectedValue(new Error('VALIDATION_ERROR'));
    const res = await request(app).put(`${base}/registration.confirmed`).set(auth).send({ subject: '' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /emails/:type', () => {
  it('200 ok', async () => {
    const res = await request(app).delete(`${base}/registration.confirmed`).set(auth);
    expect(res.status).toBe(200);
    expect(removeImpl).toHaveBeenCalledWith('club-demo', 'registration.confirmed');
  });
});

describe('POST /emails/:type/preview', () => {
  it('200 subject+html', async () => {
    const res = await request(app).post(`${base}/registration.confirmed/preview`).set(auth)
      .send({ subject: 's', heading: 'h', bodyHtml: '<p>b</p>' });
    expect(res.status).toBe(200);
    expect(res.body.html).toContain('<html');
  });
});

describe('POST /emails/:type/test', () => {
  it('200 ok et envoie à l\'email de l\'admin', async () => {
    const res = await request(app).post(`${base}/registration.confirmed/test`).set(auth)
      .send({ subject: 's', heading: 'h', bodyHtml: '<p>b</p>' });
    expect(res.status).toBe(200);
    expect(testImpl).toHaveBeenCalledWith('club-demo', 'registration.confirmed', expect.any(Object), 'owner@x.fr');
  });
});

describe('POST /emails/images', () => {
  it('200 pour STAFF : écrit le fichier et renvoie une URL /uploads/email-images/', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
    const write = jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as never);
    // Image ré-encodée via sharp (audit pré-MEP §2.3) : un entête PNG tronqué ne suffit plus.
    const realPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const res = await request(app).post(`${base}/images`).set(auth)
      .attach('image', realPng, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/uploads\/email-images\/club-demo-\d+\.png$/);
    expect(write).toHaveBeenCalled();
    write.mockRestore();
  });

  it('400 pour un format non supporté', async () => {
    const res = await request(app).post(`${base}/images`).set(auth)
      .attach('image', Buffer.from('x'), { filename: 'a.gif', contentType: 'image/gif' });
    expect(res.status).toBe(400);
  });

  it('401 sans token', async () => {
    expect((await request(app).post(`${base}/images`)).status).toBe(401);
  });
});
