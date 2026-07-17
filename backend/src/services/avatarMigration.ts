import fs from 'fs';
import path from 'path';
import { prisma } from '../db/prisma';
import { AVATARS_DIR, isLegacyAvatarUrl, randomFileName } from '../utils/uploads';

export type AvatarMigrationStats = {
  migrated: number; // renommés (ou « le seraient », en dry-run)
  skipped: number;  // déjà au nouveau format
  missing: number;  // avatarUrl en base mais fichier absent du disque
  errors: number;
};

export type AvatarMigrationOptions = {
  dryRun?: boolean;
  log?: (message: string) => void;
};

/**
 * Renomme les avatars encore au format historique <userId>-<timestamp>.<ext>
 * vers un jeton opaque, pour retirer le userId des URL publiques.
 *
 * Idempotent : les avatars déjà migrés sont ignorés, le script est relançable.
 */
export async function migrateAvatarFilenames(
  opts: AvatarMigrationOptions = {},
): Promise<AvatarMigrationStats> {
  const { dryRun = false, log = console.log } = opts;
  const stats: AvatarMigrationStats = { migrated: 0, skipped: 0, missing: 0, errors: 0 };

  const users = await prisma.user.findMany({
    where: { avatarUrl: { startsWith: '/uploads/avatars/' } },
    select: { id: true, avatarUrl: true },
  });
  log(`${users.length} avatar(s) local(aux) en base.${dryRun ? ' [DRY-RUN — aucune écriture]' : ''}`);

  for (const user of users) {
    const url = user.avatarUrl!;
    if (!isLegacyAvatarUrl(url)) { stats.skipped++; continue; }

    const oldName = path.basename(url);
    const oldPath = path.join(AVATARS_DIR, oldName);
    const newName = randomFileName(path.extname(oldName).slice(1));
    const newPath = path.join(AVATARS_DIR, newName);

    try {
      if (!fs.existsSync(oldPath)) {
        // Avatar référencé mais disparu du disque : on laisse avatarUrl intact
        // (le réécrire pointerait vers un fichier tout aussi absent, en perdant la trace).
        log(`  ⚠ ${oldName} — fichier introuvable, ignoré`);
        stats.missing++;
        continue;
      }

      if (dryRun) {
        log(`  → ${oldName} deviendrait ${newName}`);
        stats.migrated++;
        continue;
      }

      // Ordre NON négociable : copier → écrire la base → supprimer l'ancien.
      // Un échec laisse au pire un fichier orphelin, jamais une URL morte.
      await fs.promises.copyFile(oldPath, newPath);
      await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: `/uploads/avatars/${newName}` } });
      await fs.promises.unlink(oldPath).catch(() => {}); // nettoyage best-effort
      log(`  ✓ ${oldName} → ${newName}`);
      stats.migrated++;
    } catch (e) {
      log(`  ✗ ${oldName} — ${(e as Error).message}`);
      stats.errors++;
    }
  }

  log(
    `Terminé — ${stats.migrated} ${dryRun ? 'à migrer' : 'migré(s)'}, ` +
    `${stats.skipped} déjà au nouveau format, ${stats.missing} fichier(s) introuvable(s), ${stats.errors} erreur(s).`,
  );
  return stats;
}
