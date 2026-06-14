import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

// Les uploads écrivent dans un tmpdir (jamais dans le dossier du repo pendant les tests).
jest.mock('../../utils/uploads', () => {
  const fsm = require('fs');
  const pathm = require('path');
  const osm = require('os');
  const actual = jest.requireActual('../../utils/uploads');
  const UPLOADS_DIR = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'palova-sponsors-'));
  const SPONSORS_DIR = pathm.join(UPLOADS_DIR, 'sponsors');
  return {
    ...actual,
    UPLOADS_DIR,
    SPONSORS_DIR,
    ensureUploadDirs: () => fsm.mkdirSync(SPONSORS_DIR, { recursive: true }),
  };
});

import { SPONSORS_DIR } from '../../utils/uploads';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');

const token = () => jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!);
// PNG 1x1 minimal (entête valide suffisante : le backend ne décode pas l'image).
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const URL = '/api/clubs/club-demo/admin/sponsors/logo';

describe('POST /api/clubs/:clubId/admin/sponsors/logo', () => {
  // requireClubMember : par défaut, u1 est OWNER de club-demo.
  beforeEach(() => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'OWNER' } as any);
  });

  it('refuse sans token (401)', async () => {
    const res = await request(app).post(URL).attach('logo', PNG, { filename: 'l.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });

  it('refuse un non-membre (403)', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post(URL).set('Authorization', `Bearer ${token()}`)
      .attach('logo', PNG, { filename: 'l.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
  });

  it('refuse un format non supporté (400)', async () => {
    const res = await request(app).post(URL).set('Authorization', `Bearer ${token()}`)
      .attach('logo', PNG, { filename: 'l.gif', contentType: 'image/gif' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Format');
  });

  it('enregistre le logo et renvoie un chemin /uploads/sponsors', async () => {
    const res = await request(app).post(URL).set('Authorization', `Bearer ${token()}`)
      .attach('logo', PNG, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toMatch(/^\/uploads\/sponsors\/club-demo-\d+\.png$/);
    const written = path.join(SPONSORS_DIR, path.basename(res.body.logoUrl));
    expect(fs.existsSync(written)).toBe(true);
  });
});
