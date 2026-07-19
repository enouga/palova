import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import fs from 'fs';
import sharp from 'sharp';
import dns from 'dns/promises';

// Les logos de test pointent vers un domaine fictif (logos.example) : la garde SSRF de
// fetchLogo (icon.service.ts) résout le host via dns.lookup AVANT tout fetch (mocké plus
// bas) — sans ce mock, la résolution DNS réelle échoue (ENOTFOUND) et fait silencieusement
// tomber tous les tests dans le repli Palova au lieu du logo mocké.
jest.mock('dns/promises');
(dns.lookup as jest.Mock).mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);

// Les fichiers de cache vont dans un tmpdir (jamais dans le repo pendant les tests).
jest.mock('../../utils/uploads', () => {
  const fsm = require('fs');
  const pathm = require('path');
  const osm = require('os');
  const actual = jest.requireActual('../../utils/uploads');
  const UPLOADS_DIR = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'palova-uploads-'));
  const AVATARS_DIR = pathm.join(UPLOADS_DIR, 'avatars');
  const ICONS_DIR = pathm.join(UPLOADS_DIR, 'icons');
  return {
    ...actual,
    UPLOADS_DIR, AVATARS_DIR, ICONS_DIR,
    ensureUploadDirs: () => { fsm.mkdirSync(AVATARS_DIR, { recursive: true }); fsm.mkdirSync(ICONS_DIR, { recursive: true }); },
  };
});

import { ICONS_DIR, UPLOADS_DIR } from '../../utils/uploads';
import path from 'path';
import app from '../../app';

const CLUB = { id: 'c1', logoUrl: null as string | null, accentColor: '#d6ff3f' };

describe('GET /api/clubs/:slug/icon/:file', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const f of fs.readdirSync(ICONS_DIR)) fs.unlinkSync(`${ICONS_DIR}/${f}`);
  });

  it('404 si club inconnu', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/clubs/nope/icon/192.png');
    expect(res.status).toBe(404);
  });

  it('404 si variante inconnue', async () => {
    prismaMock.club.findUnique.mockResolvedValue(CLUB as any);
    const res = await request(app).get('/api/clubs/demo/icon/999.png');
    expect(res.status).toBe(404);
  });

  it('club sans logo → PNG Palova de repli, cache long', async () => {
    prismaMock.club.findUnique.mockResolvedValue(CLUB as any);
    const res = await request(app).get('/api/clubs/demo/icon/192.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toContain('max-age=86400');
  });

  it('club avec logo → PNG carré généré + cache ; 2e appel sans re-téléchargement', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ ...CLUB, logoUrl: 'https://logos.example/x.png' } as any);
    const logo = await sharp({ create: { width: 60, height: 40, channels: 4, background: '#ff0000' } }).png().toBuffer();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(logo), { status: 200 }) as any);

    const res = await request(app).get('/api/clubs/demo/icon/maskable-192.png');
    expect(res.status).toBe(200);
    const meta = await sharp(res.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([192, 192]);
    expect(fs.readdirSync(ICONS_DIR)).toHaveLength(1);

    await request(app).get('/api/clubs/demo/icon/maskable-192.png');
    expect(fetchMock).toHaveBeenCalledTimes(1); // servi depuis le cache disque
    fetchMock.mockRestore();
  });

  it('icône « any » 192 → fond transparent (coin alpha 0) ; maskable → fond plein (coin opaque)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ ...CLUB, logoUrl: 'https://logos.example/x.png' } as any);
    const logo = await sharp({ create: { width: 60, height: 40, channels: 4, background: '#ff0000' } }).png().toBuffer();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(logo), { status: 200 }) as any);

    const cornerAlpha = async (file: string): Promise<number> => {
      const res = await request(app).get(`/api/clubs/demo/icon/${file}`);
      expect(res.status).toBe(200);
      const { data, info } = await sharp(res.body as Buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return data[info.channels - 1]; // alpha du pixel (0,0)
    };

    expect(await cornerAlpha('192.png')).toBe(0);          // any → transparent
    expect(await cornerAlpha('maskable-192.png')).toBe(255); // maskable → fond plein
    fetchMock.mockRestore();
  });

  it('logo uploadé localement (/uploads/logos/...) → lu sur disque, sans fetch HTTP', async () => {
    const logo = await sharp({ create: { width: 50, height: 50, channels: 4, background: '#00ff00' } }).png().toBuffer();
    const logosDir = path.join(UPLOADS_DIR, 'logos');
    fs.mkdirSync(logosDir, { recursive: true });
    fs.writeFileSync(path.join(logosDir, 'c1-1.png'), logo);
    prismaMock.club.findUnique.mockResolvedValue({ ...CLUB, logoUrl: '/uploads/logos/c1-1.png' } as any);
    const fetchMock = jest.spyOn(global, 'fetch');

    const res = await request(app).get('/api/clubs/demo/icon/192.png');
    expect(res.status).toBe(200);
    const meta = await sharp(res.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([192, 192]);
    expect(fetchMock).not.toHaveBeenCalled(); // lecture disque, pas de fetch
    fetchMock.mockRestore();
  });

  it('logo injoignable → repli Palova silencieux (200)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ ...CLUB, logoUrl: 'https://logos.example/dead.png' } as any);
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/clubs/demo/icon/512.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    fetchMock.mockRestore();
  });

  it('badge-96 : logo transparent → silhouette blanche (coin alpha 0)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ ...CLUB, logoUrl: 'https://logos.example/x.png' } as any);
    const logo = await sharp({ create: { width: 80, height: 80, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
      .extend({ top: 20, bottom: 20, left: 20, right: 20, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(logo), { status: 200 }) as any);
    const res = await request(app).get('/api/clubs/demo/icon/badge-96.png');
    expect(res.status).toBe(200);
    const meta = await sharp(res.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([96, 96]);
    fetchMock.mockRestore();
  });

  it('badge-96 : logo opaque (sans alpha) → repli Palova (200)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ ...CLUB, logoUrl: 'https://logos.example/opaque.png' } as any);
    const opaque = await sharp({ create: { width: 96, height: 96, channels: 3, background: '#123456' } }).png().toBuffer();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(opaque), { status: 200 }) as any);
    const res = await request(app).get('/api/clubs/demo/icon/badge-96.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    fetchMock.mockRestore();
  });

  it('badge-96 : logo opaque NON carré → même repli que le carré opaque (pas un rectangle blanc)', async () => {
    // Régression : le letterboxing `contain` d'une image opaque non carrée introduit du
    // transparent qui faisait passer la garde d'opacité → rectangle blanc plein. Les deux cas
    // opaques doivent servir le MÊME repli Palova (comparaison robuste au transfert HTTP).
    const badgeFor = async (w: number, h: number, url: string): Promise<Buffer> => {
      prismaMock.club.findUnique.mockResolvedValue({ ...CLUB, logoUrl: url } as any);
      const buf = await sharp({ create: { width: w, height: h, channels: 3, background: '#224466' } }).png().toBuffer();
      const fm = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(buf), { status: 200 }) as any);
      const res = await request(app).get('/api/clubs/demo/icon/badge-96.png');
      fm.mockRestore();
      expect(res.status).toBe(200);
      return res.body as Buffer;
    };
    const square = await badgeFor(96, 96, 'https://logos.example/sq-opaque.png');
    const wide = await badgeFor(200, 80, 'https://logos.example/wide-opaque.png');
    expect(Buffer.compare(wide, square)).toBe(0); // les deux → repli identique, aucun rendu blanc
  });
});
