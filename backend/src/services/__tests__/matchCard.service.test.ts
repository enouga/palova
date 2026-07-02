import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Uploads dans un tmpdir jetable (même patron que icon.routes.test.ts).
jest.mock('../../utils/uploads', () => {
  const fsm = require('fs') as typeof import('fs');
  const osm = require('os') as typeof import('os');
  const pathm = require('path') as typeof import('path');
  const UPLOADS_DIR = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'palova-ogcards-'));
  const dirs = {
    UPLOADS_DIR,
    AVATARS_DIR: pathm.join(UPLOADS_DIR, 'avatars'),
    ICONS_DIR: pathm.join(UPLOADS_DIR, 'icons'),
    SPONSORS_DIR: pathm.join(UPLOADS_DIR, 'sponsors'),
    LOGOS_DIR: pathm.join(UPLOADS_DIR, 'logos'),
    COVERS_DIR: pathm.join(UPLOADS_DIR, 'covers'),
    OGCARDS_DIR: pathm.join(UPLOADS_DIR, 'ogcards'),
  };
  for (const d of Object.values(dirs)) fsm.mkdirSync(d, { recursive: true });
  return { ...dirs, ensureUploadDirs: () => {}, EXT_BY_MIME: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } };
});

jest.mock('../openMatch.service', () => {
  const getOpenMatch = jest.fn();
  return { OpenMatchService: jest.fn().mockImplementation(() => ({ getOpenMatch })) };
});

import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { OGCARDS_DIR, AVATARS_DIR } from '../../utils/uploads';
import { OpenMatchService } from '../openMatch.service';
import { matchCardService, fallbackCardPath } from '../matchCard.service';

const getOpenMatch = (new (OpenMatchService as any)()).getOpenMatch as jest.Mock;

const clubStub = {
  slug: 'demo', name: 'Padel Arena', status: 'ACTIVE', timezone: 'Europe/Paris',
  accentColor: '#0f6bff', logoUrl: null,
};

const dtoStub = {
  id: 'm1', resourceName: 'Court 2', sport: { key: 'padel', name: 'Padel' },
  startTime: '2026-07-04T16:00:00.000Z', endTime: '2026-07-04T17:30:00.000Z',
  maxPlayers: 4, spotsLeft: 2, full: false,
  viewerIsParticipant: false, viewerIsOrganizer: false,
  targetLevelMin: 6, targetLevelMax: 7,
  players: [
    { userId: 'u1', firstName: 'Éric', lastName: 'N', avatarUrl: null, isOrganizer: true, level: { level: 6.1, tier: 'Confirmé', isProvisional: false, reliability: 1 }, team: 1, slot: 0 },
    { userId: 'u2', firstName: 'Léa', lastName: 'B', avatarUrl: null, isOrganizer: false, level: null, team: 2, slot: 0 },
  ],
  lastMessageAt: null, unreadCount: 0, cardVersion: 'abc123def456',
};

describe('MatchCardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.club.findUnique.mockResolvedValue(clubStub as any);
    getOpenMatch.mockResolvedValue(dtoStub);
    for (const f of fs.readdirSync(OGCARDS_DIR)) fs.unlinkSync(path.join(OGCARDS_DIR, f));
  });

  it('rend un PNG 1200×630 nommé <matchId>-<cardVersion>.png', async () => {
    const p = await matchCardService.getMatchCardPath('demo', 'm1');
    expect(path.basename(p)).toBe('m1-abc123def456.png');
    expect(path.dirname(p)).toBe(OGCARDS_DIR);
    const meta = await sharp(p).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
  });

  it('hit de cache : le fichier existant est servi sans re-rendu', async () => {
    const cached = path.join(OGCARDS_DIR, 'm1-abc123def456.png');
    fs.writeFileSync(cached, 'SENTINEL');
    const p = await matchCardService.getMatchCardPath('demo', 'm1');
    expect(p).toBe(cached);
    expect(fs.readFileSync(cached, 'utf8')).toBe('SENTINEL'); // pas réécrit
  });

  it("purge les anciens états du même match (pas ceux d'autres matchs)", async () => {
    fs.writeFileSync(path.join(OGCARDS_DIR, 'm1-oldhash000000.png'), 'old');
    fs.writeFileSync(path.join(OGCARDS_DIR, 'm2-otherhash0000.png'), 'other');
    await matchCardService.getMatchCardPath('demo', 'm1');
    expect(fs.existsSync(path.join(OGCARDS_DIR, 'm1-oldhash000000.png'))).toBe(false);
    expect(fs.existsSync(path.join(OGCARDS_DIR, 'm2-otherhash0000.png'))).toBe(true);
  });

  it('compose la photo des joueurs qui en ont une (PNG toujours 1200×630)', async () => {
    const avatar = path.join(AVATARS_DIR, 'u1.jpg');
    await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 60, b: 60 } } }).jpeg().toFile(avatar);
    getOpenMatch.mockResolvedValue({
      ...dtoStub,
      cardVersion: 'withavatar12',
      players: [{ ...dtoStub.players[0], avatarUrl: '/uploads/avatars/u1.jpg' }, dtoStub.players[1]],
    });
    const p = await matchCardService.getMatchCardPath('demo', 'm1');
    const meta = await sharp(p).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
  });

  it('match introuvable → PNG de repli (jamais de throw)', async () => {
    getOpenMatch.mockRejectedValue(new Error('RESERVATION_NOT_FOUND'));
    await expect(matchCardService.getMatchCardPath('demo', 'nope')).resolves.toBe(fallbackCardPath());
  });

  it('club inconnu ou suspendu → PNG de repli', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(matchCardService.getMatchCardPath('ghost', 'm1')).resolves.toBe(fallbackCardPath());
    prismaMock.club.findUnique.mockResolvedValue({ ...clubStub, status: 'SUSPENDED' } as any);
    await expect(matchCardService.getMatchCardPath('demo', 'm1')).resolves.toBe(fallbackCardPath());
  });

  it('id non sûr pour un nom de fichier → repli sans requête', async () => {
    await expect(matchCardService.getMatchCardPath('demo', '../../etc/passwd')).resolves.toBe(fallbackCardPath());
    expect(prismaMock.club.findUnique).not.toHaveBeenCalled();
  });
});
