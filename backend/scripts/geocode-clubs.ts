import 'dotenv/config';
// Backfill one-shot : géocode tous les clubs sans latitude. Idempotent (rejouable).
// Usage : npx ts-node backend/scripts/geocode-clubs.ts   (depuis la racine ou backend/)
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { geocodeAddress } from '../src/services/geo.service';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const clubs = await prisma.club.findMany({
    where: { latitude: null },
    select: { id: true, name: true, address: true, city: true },
  });
  console.log(`${clubs.length} club(s) à géocoder.`);
  for (const c of clubs) {
    const geo = await geocodeAddress({ address: c.address, city: c.city });
    if (!geo) { console.log(`  ✗ ${c.name} — non géocodé`); continue; }
    await prisma.club.update({
      where: { id: c.id },
      data: { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, postalCode: geo.postalCode },
    });
    console.log(`  ✓ ${c.name} — ${geo.region ?? '?'} (${geo.latitude.toFixed(3)}, ${geo.longitude.toFixed(3)})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
