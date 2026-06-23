import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';

// Les uploads écrivent dans un tmpdir (jamais dans le dossier du repo pendant les tests).
jest.mock('../../utils/uploads', () => {
  const fsm = require('fs');
  const pathm = require('path');
  const osm = require('os');
  const actual = jest.requireActual('../../utils/uploads');
  const UPLOADS_DIR = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'palova-uploads-'));
  const AVATARS_DIR = pathm.join(UPLOADS_DIR, 'avatars');
  return {
    ...actual,
    UPLOADS_DIR,
    AVATARS_DIR,
    ensureUploadDirs: () => fsm.mkdirSync(AVATARS_DIR, { recursive: true }),
  };
});

import { AVATARS_DIR } from '../../utils/uploads';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');

const token = () => jwt.sign({ id: 'u1', email: 'test@x.fr' }, process.env.JWT_SECRET!);
const PROFILE = {
  id: 'u1', email: 'test@x.fr', firstName: 'Eric', lastName: 'Nougayrede', phone: null, sex: null,
  birthDate: null, avatarUrl: null, locale: 'fr', isSuperAdmin: false, showInLeaderboard: false,
  autoMatchProposals: false,
};

// PNG 1x1 minimal (entête valide suffisante : le backend ne décode pas l'image).
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

describe('PATCH /api/me', () => {
  it('rejette un sexe invalide (400)', async () => {
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ sex: 'X' });
    expect(res.status).toBe(400);
  });

  it.each(['31-12-1990', '2026-02-30', '1990-13-01', 'abcd'])('rejette birthDate invalide « %s » (400)', async (birthDate) => {
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ birthDate });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('birthDate invalide');
  });

  it('rejette une locale hors liste (400)', async () => {
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ locale: 'de' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('locale invalide');
  });

  it('met à jour téléphone, date de naissance et locale', async () => {
    prismaMock.user.update.mockResolvedValue({ ...PROFILE, phone: '0609032635', birthDate: new Date('1973-07-08'), locale: 'en' } as any);
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`)
      .send({ phone: ' 0609032635 ', birthDate: '1973-07-08', locale: 'en' });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: { phone: '0609032635', birthDate: new Date('1973-07-08'), locale: 'en' },
    }));
  });

  it('efface la date de naissance avec null', async () => {
    prismaMock.user.update.mockResolvedValue(PROFILE as any);
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ birthDate: null });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { birthDate: null } }));
  });

  it('rejette showInLeaderboard non booléen (400)', async () => {
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ showInLeaderboard: 'oui' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('showInLeaderboard invalide');
  });

  it('met à jour showInLeaderboard', async () => {
    prismaMock.user.update.mockResolvedValue({ ...PROFILE, showInLeaderboard: true } as any);
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ showInLeaderboard: true });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { showInLeaderboard: true } }));
    expect(res.body.showInLeaderboard).toBe(true);
  });

  it('rejette autoMatchProposals non booléen (400)', async () => {
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ autoMatchProposals: 'oui' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('autoMatchProposals invalide');
  });

  it('met à jour autoMatchProposals', async () => {
    prismaMock.user.update.mockResolvedValue({ ...PROFILE, autoMatchProposals: true } as any);
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ autoMatchProposals: true });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { autoMatchProposals: true } }));
    expect(res.body.autoMatchProposals).toBe(true);
  });
});

describe('POST /api/me/avatar', () => {
  it('refuse sans token (401)', async () => {
    const res = await request(app).post('/api/me/avatar').attach('avatar', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });

  it('refuse un format non supporté (400)', async () => {
    const res = await request(app).post('/api/me/avatar').set('Authorization', `Bearer ${token()}`)
      .attach('avatar', PNG, { filename: 'a.gif', contentType: 'image/gif' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Format');
  });

  it('enregistre la photo, met à jour avatarUrl et supprime l\'ancienne', async () => {
    const oldName = 'u1-1000.jpg';
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
    fs.writeFileSync(path.join(AVATARS_DIR, oldName), 'old');
    prismaMock.user.findUnique.mockResolvedValue({ avatarUrl: `/uploads/avatars/${oldName}` } as any);
    prismaMock.user.update.mockImplementation((args: any) => Promise.resolve({ ...PROFILE, avatarUrl: args.data.avatarUrl }) as any);

    const res = await request(app).post('/api/me/avatar').set('Authorization', `Bearer ${token()}`)
      .attach('avatar', PNG, { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toMatch(/^\/uploads\/avatars\/u1-\d+\.png$/);
    const written = path.join(AVATARS_DIR, path.basename(res.body.avatarUrl));
    expect(fs.existsSync(written)).toBe(true);
    // L'unlink de l'ancienne photo est asynchrone best-effort : on lui laisse un tick.
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(path.join(AVATARS_DIR, oldName))).toBe(false);
  });
});

describe('GET /api/me/matches', () => {
  it('renvoie joueurs, club, sport, terrain et isMe', async () => {
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      {
        confirmation: 'PENDING', team: 2, ratingAfter: null,
        match: {
          id: 'm1', status: 'PENDING', sets: [[6, 4], [6, 3]],
          playedAt: new Date('2026-06-20T16:30:00Z'), winningTeam: 1,
          confirmDeadline: new Date('2026-06-23T16:30:00Z'), reservationId: 'r1',
          club: { name: 'Padel Arena Paris' },
          sport: { name: 'Padel' },
          reservation: { resource: { name: 'Court 2' } },
          players: [
            { userId: 'u1', team: 2, user: { firstName: 'Eric', lastName: 'Nougayrede' } },
            { userId: 'u2', team: 2, user: { firstName: 'Marie', lastName: 'Durand' } },
            { userId: 'u3', team: 1, user: { firstName: 'Paul', lastName: 'Roy' } },
            { userId: 'u4', team: 1, user: { firstName: 'Lea', lastName: 'Martin' } },
          ],
          _count: { comments: 0 },
        },
      },
    ] as any);
    const res = await request(app).get('/api/me/matches').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(expect.objectContaining({
      matchId: 'm1',
      club: { name: 'Padel Arena Paris' },
      sport: { name: 'Padel' },
      resource: { name: 'Court 2' },
    }));
    expect(res.body[0].players).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'u1', team: 2, firstName: 'Eric', lastName: 'Nougayrede', isMe: true }),
      expect.objectContaining({ userId: 'u2', team: 2, firstName: 'Marie', lastName: 'Durand', isMe: false }),
    ]));
  });

  it('resource = null si le match n a pas de réservation', async () => {
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      {
        confirmation: 'CONFIRMED', team: 1, ratingAfter: 6.2,
        match: {
          id: 'm2', status: 'CONFIRMED', sets: [[6, 0], [6, 0]],
          playedAt: new Date('2026-06-15T10:00:00Z'), winningTeam: 1,
          confirmDeadline: new Date('2026-06-18T10:00:00Z'), reservationId: null,
          club: { name: 'Padel Arena Paris' }, sport: { name: 'Padel' },
          reservation: null,
          players: [
            { userId: 'u1', team: 1, user: { firstName: 'Eric', lastName: 'N' } },
            { userId: 'u2', team: 1, user: { firstName: 'A', lastName: 'B' } },
            { userId: 'u3', team: 2, user: { firstName: 'C', lastName: 'D' } },
            { userId: 'u4', team: 2, user: { firstName: 'E', lastName: 'F' } },
          ],
          _count: { comments: 3 },
        },
      },
    ] as any);
    const res = await request(app).get('/api/me/matches').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body[0].resource).toBeNull();
    expect(res.body[0].ratingAfter).toBe(6.2);
    expect(res.body[0].commentCount).toBe(3);
  });
});

describe('PATCH /api/me — preferredSportId', () => {
  it('PATCH /api/me enregistre preferredSportId après vérif du sport', async () => {
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel', published: true } as any);
    prismaMock.user.update.mockResolvedValue({ id: 'u1', preferredSport: { id: 'sport-padel', key: 'padel', name: 'Padel' } } as any);
    const res = await request(app).patch('/api/me')
      .set('Authorization', `Bearer ${token()}`).send({ preferredSportId: 'sport-padel' });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ preferredSportId: 'sport-padel' }),
    }));
  });

  it('PATCH /api/me rejette un preferredSportId inconnu', async () => {
    prismaMock.sport.findUnique.mockResolvedValue(null);
    const res = await request(app).patch('/api/me')
      .set('Authorization', `Bearer ${token()}`).send({ preferredSportId: 'sport-xxx' });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/me efface le sport préféré avec null', async () => {
    prismaMock.user.update.mockResolvedValue({ id: 'u1', preferredSport: null } as any);
    const res = await request(app).patch('/api/me')
      .set('Authorization', `Bearer ${token()}`).send({ preferredSportId: null });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ preferredSportId: null }),
    }));
  });
});

describe('POST /api/me/password', () => {
  it('refuse sans token (401)', async () => {
    const res = await request(app).post('/api/me/password').send({ currentPassword: 'a', newPassword: 'b' });
    expect(res.status).toBe(401);
  });

  it('change le mot de passe avec le bon mot de passe actuel', async () => {
    const current = await bcrypt.hash('oldpass123', 10);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', password: current } as any);
    let storedHash = '';
    prismaMock.user.update.mockImplementation((args: any) => { storedHash = args.data.password; return Promise.resolve({}) as any; });

    const res = await request(app).post('/api/me/password').set('Authorization', `Bearer ${token()}`)
      .send({ currentPassword: 'oldpass123', newPassword: 'newpass456' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }));
    // Le nouveau mot de passe est bien stocké hashé (jamais en clair).
    expect(storedHash).not.toBe('newpass456');
    expect(await bcrypt.compare('newpass456', storedHash)).toBe(true);
  });

  it('rejette un mot de passe actuel incorrect (401 INVALID_PASSWORD)', async () => {
    const current = await bcrypt.hash('oldpass123', 10);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', password: current } as any);
    const res = await request(app).post('/api/me/password').set('Authorization', `Bearer ${token()}`)
      .send({ currentPassword: 'wrongpass', newPassword: 'newpass456' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_PASSWORD');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejette un nouveau mot de passe trop court (400)', async () => {
    const current = await bcrypt.hash('oldpass123', 10);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', password: current } as any);
    const res = await request(app).post('/api/me/password').set('Authorization', `Bearer ${token()}`)
      .send({ currentPassword: 'oldpass123', newPassword: 'court' });
    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejette un currentPassword non-string sans planter (400)', async () => {
    const current = await bcrypt.hash('oldpass123', 10);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', password: current } as any);
    const res = await request(app).post('/api/me/password').set('Authorization', `Bearer ${token()}`)
      .send({ currentPassword: 12345, newPassword: 'newpass456' });
    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejette un nouveau mot de passe identique à l\'actuel (400 SAME_PASSWORD)', async () => {
    const current = await bcrypt.hash('oldpass123', 10);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', password: current } as any);
    const res = await request(app).post('/api/me/password').set('Authorization', `Bearer ${token()}`)
      .send({ currentPassword: 'oldpass123', newPassword: 'oldpass123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SAME_PASSWORD');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
