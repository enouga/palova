import 'dotenv/config';
// Backfill one-shot : retire le userId du nom de fichier des avatars.
// Les avatars étaient écrits en /uploads/avatars/<userId>-<timestamp>.<ext> et /uploads
// est servi statiquement → tout endpoint exposant avatarUrl (y compris la fiche tournoi
// PUBLIQUE et ANONYME) publiait le userId. On les renomme en jeton opaque.
//
// Idempotent : relançable sans dégât (les avatars déjà migrés sont ignorés).
//
// Usage (depuis backend/) :
//   node -r ts-node/register scripts/migrate-avatar-filenames.ts --dry-run
//   node -r ts-node/register scripts/migrate-avatar-filenames.ts
//
// Prod (conteneur backend, volume backend_uploads monté sur /app/uploads) :
//   docker exec <backend> node -r ts-node/register scripts/migrate-avatar-filenames.ts --dry-run
//   docker exec <backend> node -r ts-node/register scripts/migrate-avatar-filenames.ts
import { prisma } from '../src/db/prisma';
import { migrateAvatarFilenames } from '../src/services/avatarMigration';

const dryRun = process.argv.includes('--dry-run');

migrateAvatarFilenames({ dryRun })
  .then((stats) => { if (stats.errors > 0) process.exitCode = 1; })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
