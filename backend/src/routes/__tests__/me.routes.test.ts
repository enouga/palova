import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

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

const getDeletionSummary = jest.fn();
const deleteAccount = jest.fn();
jest.mock('../../services/account.service', () => ({
  AccountService: jest.fn().mockImplementation(() => ({ getDeletionSummary, deleteAccount })),
}));

import { AVATARS_DIR } from '../../utils/uploads';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');

const token = (id = 'u1') => jwt.sign({ id, email: 'test@x.fr' }, process.env.JWT_SECRET!);
const PROFILE = {
  id: 'u1', email: 'test@x.fr', firstName: 'Eric', lastName: 'Nougayrede', phone: null, sex: null,
  birthDate: null, avatarUrl: null, locale: 'fr', isSuperAdmin: false, showInLeaderboard: false,
  autoMatchProposals: false, acceptsFriendRequests: false, acceptsDirectMessages: false, pseudo: null,
};

// PNG réel (l'avatar est ré-encodé via sharp — audit pré-MEP §2.3 — donc le contenu
// doit être décodable, un entête tronqué ne suffit plus).
let PNG: Buffer;
beforeAll(async () => {
  PNG = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
});

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

  it('PATCH /api/me accepte acceptsFriendRequests (booléen)', async () => {
    prismaMock.user.update.mockResolvedValue({ ...PROFILE, acceptsFriendRequests: true } as any);
    const res = await request(app).patch('/api/me').send({ acceptsFriendRequests: true }).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { acceptsFriendRequests: true } }));
  });

  it('PATCH /api/me rejette acceptsFriendRequests non booléen', async () => {
    const res = await request(app).patch('/api/me').send({ acceptsFriendRequests: 'oui' }).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(400);
  });

  it('PATCH /api/me accepte acceptsDirectMessages (booléen)', async () => {
    prismaMock.user.update.mockResolvedValue({ ...PROFILE, acceptsDirectMessages: false } as any);
    const res = await request(app).patch('/api/me').send({ acceptsDirectMessages: false }).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { acceptsDirectMessages: false } }));
  });

  it('PATCH /api/me rejette acceptsDirectMessages non booléen', async () => {
    const res = await request(app).patch('/api/me').send({ acceptsDirectMessages: 'non' }).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(400);
  });

  it('PATCH /api/me accepte adresse/CP/ville (trim, vide → null)', async () => {
    prismaMock.user.update.mockResolvedValue({ ...PROFILE, address: '12 rue des Sports', postalCode: '31000', city: null } as any);
    const res = await request(app).patch('/api/me')
      .set('Authorization', `Bearer ${token()}`)
      .send({ address: ' 12 rue des Sports ', postalCode: '31000', city: '' });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ address: '12 rue des Sports', postalCode: '31000', city: null }),
    }));
  });

  it.each(['ab', 'x'.repeat(21), 'jo jo', 'joël', 'a!b'])('rejette un pseudo invalide « %s » (400)', async (pseudo) => {
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo });
    expect(res.status).toBe(400);
  });

  it('rejette un pseudo non-string (400)', async () => {
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo: 42 });
    expect(res.status).toBe(400);
  });

  it('enregistre un pseudo valide (trim)', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.update.mockResolvedValue({ ...PROFILE, pseudo: 'SmashMaster' } as any);
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo: ' SmashMaster ' });
    expect(res.status).toBe(200);
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { pseudo: { equals: 'SmashMaster', mode: 'insensitive' }, NOT: { id: 'u1' } },
    }));
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pseudo: 'SmashMaster' } }));
  });

  it('efface le pseudo avec une chaîne vide (pas de vérif d’unicité)', async () => {
    prismaMock.user.update.mockResolvedValue(PROFILE as any);
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo: '   ' });
    expect(res.status).toBe(200);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pseudo: null } }));
  });

  it('efface le pseudo avec null', async () => {
    prismaMock.user.update.mockResolvedValue(PROFILE as any);
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo: null });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pseudo: null } }));
  });

  it('rejette un pseudo déjà pris, insensible à la casse (409)', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 'other' } as any);
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo: 'smashmaster' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Ce pseudo est déjà pris.');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('filet anti-course : une contrainte unique violée à l’écriture renvoie 409', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['pseudo'] } }),
    );
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo: 'SmashMaster' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Ce pseudo est déjà pris.');
  });
});

describe('POST /api/me/avatar', () => {
  it('refuse sans token (401)', async () => {
    const res = await request(app).post('/api/me/avatar').attach('avatar', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });

  it('refuse un fichier dont le contenu réel n’est pas une image supportée (400)', async () => {
    // Le mimetype déclaré par le client n'est plus source de vérité (sharp décode le
    // contenu réel) : un fichier corrompu/non-image est rejeté quel que soit son en-tête HTTP.
    const res = await request(app).post('/api/me/avatar').set('Authorization', `Bearer ${token()}`)
      .attach('avatar', Buffer.from('pas une image'), { filename: 'a.gif', contentType: 'image/gif' });
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
    expect(res.body.avatarUrl).toMatch(/^\/uploads\/avatars\/[0-9a-f]{32}\.png$/);
    const written = path.join(AVATARS_DIR, path.basename(res.body.avatarUrl));
    expect(fs.existsSync(written)).toBe(true);
    // L'unlink de l'ancienne photo est asynchrone best-effort : on lui laisse un tick.
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(path.join(AVATARS_DIR, oldName))).toBe(false);
  });

  // Fuite d'info : /uploads est servi par express.static et l'avatarUrl est publié
  // par des endpoints PUBLICS et ANONYMES (fiche tournoi). Un nom dérivé du compte
  // y publierait le userId → identifiant stable pour corréler/scraper.
  it('ne met jamais le userId dans le nom du fichier', async () => {
    const userId = 'cmqfcjs0w000fokkk3iujuzlj'; // cuid réaliste (forme du cas constaté)
    prismaMock.user.findUnique.mockResolvedValue({ avatarUrl: null } as any);
    prismaMock.user.update.mockImplementation((args: any) => Promise.resolve({ ...PROFILE, avatarUrl: args.data.avatarUrl }) as any);

    const res = await request(app).post('/api/me/avatar').set('Authorization', `Bearer ${token(userId)}`)
      .attach('avatar', PNG, { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).not.toContain(userId);
    expect(res.body.avatarUrl).toMatch(/^\/uploads\/avatars\/[0-9a-f]{32}\.png$/);
    // Le fichier réellement écrit sur disque ne porte pas non plus le userId.
    const written = path.basename(res.body.avatarUrl);
    expect(written).not.toContain(userId);
    expect(fs.existsSync(path.join(AVATARS_DIR, written))).toBe(true);
  });

  it('donne un nom différent à deux uploads du même compte', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ avatarUrl: null } as any);
    prismaMock.user.update.mockImplementation((args: any) => Promise.resolve({ ...PROFILE, avatarUrl: args.data.avatarUrl }) as any);

    const upload = () => request(app).post('/api/me/avatar').set('Authorization', `Bearer ${token()}`)
      .attach('avatar', PNG, { filename: 'photo.png', contentType: 'image/png' });
    const [a, b] = [await upload(), await upload()];

    expect(a.body.avatarUrl).not.toBe(b.body.avatarUrl);
  });
});

describe('GET /api/me/matches', () => {
  it('renvoie joueurs, club, sport, terrain et isMe', async () => {
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      {
        confirmation: 'PENDING', team: 2, ratingAfter: null,
        match: {
          id: 'm1', status: 'PENDING', sets: [[6, 4], [6, 3]],
          playedAt: new Date('2026-06-20T16:30:00Z'), winningTeam: 1, competitive: false,
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
      competitive: false,
      club: { name: 'Padel Arena Paris' },
      sport: { name: 'Padel' },
      resource: { name: 'Court 2' },
    }));
    expect(res.body[0].players).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'u1', team: 2, firstName: 'Eric', lastName: 'Nougayrede', isMe: true }),
      expect.objectContaining({ userId: 'u2', team: 2, firstName: 'Marie', lastName: 'Durand', isMe: false }),
    ]));
  });

  it('expose confirmDeadline + confirmation par joueur', async () => {
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      {
        confirmation: 'PENDING', team: 2, ratingAfter: null,
        match: {
          id: 'm3', status: 'PENDING', sets: [[6, 4], [6, 3]],
          playedAt: new Date('2026-06-20T16:30:00Z'), winningTeam: 1, competitive: true,
          confirmDeadline: new Date('2026-06-23T16:30:00Z'), reservationId: 'r1',
          club: { name: 'Padel Arena Paris' }, sport: { name: 'Padel' },
          reservation: { resource: { name: 'Court 2' } },
          players: [
            { userId: 'u1', team: 2, confirmation: 'PENDING', user: { firstName: 'Eric', lastName: 'N' } },
            { userId: 'u2', team: 2, confirmation: 'CONFIRMED', user: { firstName: 'Marie', lastName: 'D' } },
            { userId: 'u3', team: 1, confirmation: 'PENDING', user: { firstName: 'Paul', lastName: 'R' } },
            { userId: 'u4', team: 1, confirmation: 'CONFIRMED', user: { firstName: 'Lea', lastName: 'M' } },
          ],
          _count: { comments: 0 },
        },
      },
    ] as any);
    const res = await request(app).get('/api/me/matches').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body[0].confirmDeadline).toBe('2026-06-23T16:30:00.000Z');
    expect(res.body[0].players).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'u2', confirmation: 'CONFIRMED' }),
      expect.objectContaining({ userId: 'u3', confirmation: 'PENDING' }),
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

describe('GET /api/me/clubs', () => {
  it('expose accentColor par club géré (carte Gestion de Mon Palova, tuile teintée à la marque du club)', async () => {
    prismaMock.clubMember.findMany.mockResolvedValue([
      { role: 'OWNER', club: { id: 'club-demo', slug: 'padel-arena-paris', name: 'Padel Arena Paris', accentColor: '#5e93da' } },
    ] as any);
    const res = await request(app).get('/api/me/clubs').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { clubId: 'club-demo', slug: 'padel-arena-paris', name: 'Padel Arena Paris', role: 'OWNER', accentColor: '#5e93da' },
    ]);
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

describe('Account deletion routes', () => {
  beforeEach(() => { getDeletionSummary.mockReset(); deleteAccount.mockReset(); });

  it('GET /api/me/account-deletion-summary → 200', async () => {
    getDeletionSummary.mockResolvedValue({ blockingClubs: [], futureReservations: 1, activeSubscriptions: 0, balances: [] });
    const res = await request(app).get('/api/me/account-deletion-summary').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.futureReservations).toBe(1);
    expect(getDeletionSummary).toHaveBeenCalledWith('u1');
  });

  it('DELETE /api/me sans mot de passe → 400', async () => {
    const res = await request(app).delete('/api/me').set('Authorization', `Bearer ${token()}`).send({});
    expect(res.status).toBe(400);
  });

  it('DELETE /api/me mauvais mot de passe → 401', async () => {
    deleteAccount.mockRejectedValue(new Error('INVALID_PASSWORD'));
    const res = await request(app).delete('/api/me').set('Authorization', `Bearer ${token()}`).send({ password: 'x' });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/me unique OWNER → 409 OWNS_CLUB', async () => {
    deleteAccount.mockRejectedValue(Object.assign(new Error('OWNS_CLUB'), { clubs: ['Club A'] }));
    const res = await request(app).delete('/api/me').set('Authorization', `Bearer ${token()}`).send({ password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('OWNS_CLUB');
    expect(res.body.clubs).toEqual(['Club A']);
  });

  it('DELETE /api/me succès → 200 ok:true', async () => {
    deleteAccount.mockResolvedValue({ ok: true });
    const res = await request(app).delete('/api/me').set('Authorization', `Bearer ${token()}`).send({ password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(deleteAccount).toHaveBeenCalledWith('u1', 'password123');
  });
});

describe('GET /api/me/matches/to-record', () => {
  it('401 sans token', async () => {
    const res = await request(app).get('/api/me/matches/to-record');
    expect(res.status).toBe(401);
  });

  it('renvoie la liste des matchs à saisir', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([{
      id: 'r1',
      startTime: new Date('2026-06-10T18:00:00Z'),
      endTime: new Date('2026-06-10T19:30:00Z'),
      resource: {
        name: 'Court 1', attributes: { format: 'DOUBLE' },
        clubSport: { sport: { key: 'padel', name: 'Padel' } },
        club: { slug: 'arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
      },
      participants: [
        { userId: 'u1', isOrganizer: true, team: 1, slot: 0, user: { firstName: 'A', lastName: 'A', avatarUrl: null } },
        { userId: 'u2', isOrganizer: false, team: 1, slot: 1, user: { firstName: 'B', lastName: 'B', avatarUrl: null } },
        { userId: 'u3', isOrganizer: false, team: 2, slot: 0, user: { firstName: 'C', lastName: 'C', avatarUrl: null } },
        { userId: 'u4', isOrganizer: false, team: 2, slot: 1, user: { firstName: 'D', lastName: 'D', avatarUrl: null } },
      ],
      matches: [],
    }] as any);
    const res = await request(app).get('/api/me/matches/to-record').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].reservationId).toBe('r1');
    expect(res.body[0].players).toHaveLength(4);
  });
});

describe('GET /api/me/matches/to-confirm', () => {
  it('401 sans token', async () => {
    const res = await request(app).get('/api/me/matches/to-confirm');
    expect(res.status).toBe(401);
  });

  it('renvoie la liste des matchs en attente de ma confirmation', async () => {
    prismaMock.matchPlayer.findMany.mockResolvedValue([{
      match: {
        id: 'm1', playedAt: new Date('2026-07-20T18:00:00Z'), sets: [[6, 4], [6, 2]],
        competitive: true, confirmDeadline: new Date('2026-07-23T18:00:00Z'),
        club: { slug: 'arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
        reservation: { resource: { name: 'Court 1' } },
        players: [
          { userId: 'u1', team: 1, user: { firstName: 'Lucas', lastName: 'Moreau', avatarUrl: null } },
          { userId: 'u2', team: 1, user: { firstName: 'Jean', lastName: 'Dupont', avatarUrl: null } },
          { userId: 'u3', team: 2, user: { firstName: 'Celine', lastName: 'Barbier', avatarUrl: null } },
          { userId: 'u4', team: 2, user: { firstName: 'Melanie', lastName: 'Bernard', avatarUrl: null } },
        ],
      },
    }] as any);
    const res = await request(app).get('/api/me/matches/to-confirm').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].matchId).toBe('m1');
    expect(res.body[0].players).toHaveLength(4);
  });
});

describe('statut légal', () => {
  it('GET /profile expose legal { accepted, current } par document', async () => {
    prismaMock.user.findUnique.mockResolvedValue(PROFILE as any);
    prismaMock.legalAcceptance.findMany.mockResolvedValue([{ document: 'CGU', version: '2026-07-18' }] as any);
    prismaMock.clubMember.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/me/profile').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.legal.cgu.accepted).toBe('2026-07-18');
    expect(res.body.legal.privacy.accepted).toBeNull();
    expect(res.body.legal.cgvSaas).toBeUndefined();
  });

  it('POST /legal/accept écrit la version courante avec context update_banner', async () => {
    prismaMock.legalAcceptance.create.mockResolvedValue({ id: 'la1' } as any);
    const res = await request(app).post('/api/me/legal/accept')
      .set('Authorization', `Bearer ${token()}`).send({ document: 'CGU' });
    expect(res.status).toBe(200);
    expect(prismaMock.legalAcceptance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', document: 'CGU', context: 'update_banner' }),
    });
  });

  it('POST /legal/accept refuse un document inconnu', async () => {
    const res = await request(app).post('/api/me/legal/accept')
      .set('Authorization', `Bearer ${token()}`).send({ document: 'NIMPORTE' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/me/export', () => {
  it('renvoie un JSON attaché avec les données du demandeur', async () => {
    prismaMock.user.findUnique.mockResolvedValue(PROFILE as any);
    prismaMock.legalAcceptance.findMany.mockResolvedValue([{ document: 'CGU', version: '2026-07-18' }] as any);
    const res = await request(app).get('/api/me/export').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('palova-mes-donnees.json');
    expect(res.body.legalAcceptances).toHaveLength(1);
    expect(res.body.profile.email).toBe('test@x.fr');
  });

  it('429 si un export a déjà été généré dans l\'heure', async () => {
    jest.spyOn(require('../../services/rateLimit'), 'assertRateLimit').mockRejectedValueOnce(new Error('RATE_LIMITED'));
    const res = await request(app).get('/api/me/export').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(429);
  });
});

describe('GET /api/me/wallet', () => {
  it('401 sans token', async () => {
    const res = await request(app).get('/api/me/wallet');
    expect(res.status).toBe(401);
  });

  it("renvoie l'agrégat cross-club du service", async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      { id: 's1', status: 'ACTIVE', expiresAt: new Date('2027-01-01'), plan: { name: 'Illimité' },
        club: { slug: 'padel-arena-paris', name: 'Padel Arena Paris', accentColor: '#5e93da' } },
    ] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);

    const res = await request(app).get('/api/me/wallet').set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].club.slug).toBe('padel-arena-paris');
    expect(res.body[0].subscriptions).toHaveLength(1);
  });
});
