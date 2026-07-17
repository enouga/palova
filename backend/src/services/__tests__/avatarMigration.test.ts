import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import fs from 'fs';
import path from 'path';

// La migration écrit dans un tmpdir (jamais dans le dossier du repo pendant les tests).
jest.mock('../../utils/uploads', () => {
  const fsm = require('fs');
  const pathm = require('path');
  const osm = require('os');
  const actual = jest.requireActual('../../utils/uploads');
  const UPLOADS_DIR = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'palova-avatar-migration-'));
  const AVATARS_DIR = pathm.join(UPLOADS_DIR, 'avatars');
  return { ...actual, UPLOADS_DIR, AVATARS_DIR };
});

import { AVATARS_DIR } from '../../utils/uploads';
import { migrateAvatarFilenames } from '../avatarMigration';

const LEGACY = 'cmqfcjs0w000fokkk3iujuzlj-1781673806077.jpg';
const silent = () => {};

beforeEach(() => {
  fs.rmSync(AVATARS_DIR, { recursive: true, force: true });
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
});

describe('migrateAvatarFilenames', () => {
  it('copie vers un nom opaque, écrit la base, puis supprime l’ancien fichier', async () => {
    fs.writeFileSync(path.join(AVATARS_DIR, LEGACY), 'photo-bytes');
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'cmqfcjs0w000fokkk3iujuzlj', avatarUrl: `/uploads/avatars/${LEGACY}` },
    ] as any);

    const stats = await migrateAvatarFilenames({ log: silent });

    expect(stats).toMatchObject({ migrated: 1, skipped: 0, missing: 0, errors: 0 });
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const url = (prismaMock.user.update.mock.calls[0][0] as any).data.avatarUrl;
    // Le nouveau chemin ne porte plus le userId.
    expect(url).not.toContain('cmqfcjs0w000fokkk3iujuzlj');
    expect(url).toMatch(/^\/uploads\/avatars\/[0-9a-f]{32}\.jpg$/);
    // Le contenu a bien suivi, et l'ancien fichier est parti.
    expect(fs.readFileSync(path.join(AVATARS_DIR, path.basename(url)), 'utf8')).toBe('photo-bytes');
    expect(fs.existsSync(path.join(AVATARS_DIR, LEGACY))).toBe(false);
  });

  it('ignore un avatar déjà migré (relançable sans dégât)', async () => {
    const already = '0123456789abcdef0123456789abcdef.jpg';
    fs.writeFileSync(path.join(AVATARS_DIR, already), 'x');
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'u1', avatarUrl: `/uploads/avatars/${already}` },
    ] as any);

    const stats = await migrateAvatarFilenames({ log: silent });

    expect(stats).toMatchObject({ migrated: 0, skipped: 1, errors: 0 });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(AVATARS_DIR, already))).toBe(true);
  });

  it('survit à un fichier manquant : logue, laisse avatarUrl intact, continue', async () => {
    const other = 'aaaabbbbccccdddd1111222233334444-1700000000000.png';
    fs.writeFileSync(path.join(AVATARS_DIR, other), 'ok');
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'disparu', avatarUrl: `/uploads/avatars/${LEGACY}` }, // fichier absent du disque
      { id: 'u2', avatarUrl: `/uploads/avatars/${other}` },
    ] as any);
    const lines: string[] = [];

    const stats = await migrateAvatarFilenames({ log: (m) => lines.push(m) });

    expect(stats).toMatchObject({ migrated: 1, missing: 1, errors: 0 });
    expect(lines.join('\n')).toContain('introuvable');
    // On ne réécrit JAMAIS l'avatarUrl d'un fichier disparu : le suivant seul est migré.
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    expect((prismaMock.user.update.mock.calls[0][0] as any).where).toEqual({ id: 'u2' });
  });

  it('--dry-run n’écrit rien : ni fichier, ni base', async () => {
    fs.writeFileSync(path.join(AVATARS_DIR, LEGACY), 'photo-bytes');
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'cmqfcjs0w000fokkk3iujuzlj', avatarUrl: `/uploads/avatars/${LEGACY}` },
    ] as any);

    const stats = await migrateAvatarFilenames({ dryRun: true, log: silent });

    expect(stats).toMatchObject({ migrated: 1, errors: 0 });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(fs.readdirSync(AVATARS_DIR)).toEqual([LEGACY]); // aucun nouveau fichier
  });

  it('ne sélectionne que les avatars locaux', async () => {
    prismaMock.user.findMany.mockResolvedValue([] as any);
    await migrateAvatarFilenames({ log: silent });
    expect((prismaMock.user.findMany.mock.calls[0][0] as any).where).toEqual({
      avatarUrl: { startsWith: '/uploads/avatars/' },
    });
  });
});
