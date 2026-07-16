import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import sharp from 'sharp';

jest.mock('../../utils/uploads', () => {
  const fsm = require('fs'); const pathm = require('path'); const osm = require('os');
  const actual = jest.requireActual('../../utils/uploads');
  const UPLOADS_DIR = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'palova-logos-'));
  const LOGOS_DIR = pathm.join(UPLOADS_DIR, 'logos');
  return { ...actual, UPLOADS_DIR, LOGOS_DIR, ensureUploadDirs: () => fsm.mkdirSync(LOGOS_DIR, { recursive: true }) };
});

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { req.user = { id: 'u1' }; next(); },
  optionalAuth: (req: any, _res: any, next: any) => next(),
}));
jest.mock('../../middleware/requireClubMember', () => ({
  requireClubMember: () => (req: any, _res: any, next: any) => { req.membership = { clubId: 'club-1', role: 'ADMIN' }; next(); },
}));

import app from '../../app';

const squarePng = () => sharp({ create: { width: 600, height: 600, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();

describe('POST/DELETE /api/clubs/:clubId/admin/club-logo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.club.findUnique.mockResolvedValue({ logoUrl: null, logoWideUrl: null, logoWideDarkUrl: null } as any);
    prismaMock.club.update.mockResolvedValue({} as any);
  });

  it('POST sans variante → persiste logoUrl (icône) + renvoie warnings', async () => {
    const res = await request(app).post('/api/clubs/club-1/admin/club-logo').attach('logo', await squarePng(), 'l.png');
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toMatch(/^\/uploads\/logos\/club-1-icon-/);
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  it('POST /wide → persiste logoWideUrl', async () => {
    const res = await request(app).post('/api/clubs/club-1/admin/club-logo/wide').attach('logo', await squarePng(), 'l.png');
    expect(res.status).toBe(200);
    expect(res.body.logoWideUrl).toMatch(/^\/uploads\/logos\/club-1-wide-/);
  });

  it('POST variante inconnue → 404', async () => {
    const res = await request(app).post('/api/clubs/club-1/admin/club-logo/bogus').attach('logo', await squarePng(), 'l.png');
    expect(res.status).toBe(404);
  });

  it('POST fichier non-image → 400', async () => {
    const res = await request(app).post('/api/clubs/club-1/admin/club-logo').attach('logo', Buffer.from('nope'), 'x.png');
    expect(res.status).toBe(400);
  });

  it('DELETE /wide → remet logoWideUrl à null', async () => {
    const res = await request(app).delete('/api/clubs/club-1/admin/club-logo/wide');
    expect(res.status).toBe(200);
    expect(prismaMock.club.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ logoWideUrl: null }) }));
  });
});
