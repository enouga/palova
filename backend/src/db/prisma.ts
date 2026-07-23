import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Taille du pool pg.Pool sous-jacent (défaut node-postgres = 10, insuffisant sous une
// pointe de centaines de holds concurrents — mesuré : latence ~1.2s p50 sur 150 requêtes
// concurrentes avec le défaut). ⚠️ Avec le driver adapter, `?connection_limit=` dans
// DATABASE_URL est ignoré (c'est une convention du moteur natif Prisma, pas de pg.Pool) —
// la taille se règle ICI via `max`.
const DB_POOL_MAX = 20;

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: DB_POOL_MAX });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
