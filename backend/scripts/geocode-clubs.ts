import 'dotenv/config';
// Backfill one-shot : géocode les clubs sans coordonnées OU sans département. Idempotent.
// Usage : npx ts-node backend/scripts/geocode-clubs.ts   (depuis la racine ou backend/)
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { geocodeAddress } from '../src/services/geo.service';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const clubs = await prisma.club.findMany({
    where: { OR: [{ latitude: null }, { department: null }] },
    select: { id: true, name: true, address: true, city: true },
  });
  console.log(`${clubs.length} club(s) à géocoder.`);
  for (const c of clubs) {
    const geo = await geocodeAddress({ address: c.address, city: c.city });
    if (!geo) { console.log(`  ✗ ${c.name} — non géocodé`); continue; }
    await prisma.club.update({
      where: { id: c.id },
      data: { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, department: geo.department, departmentCode: geo.departmentCode, postalCode: geo.postalCode },
    });
    console.log(`  ✓ ${c.name} — ${geo.department ?? '?'} (${geo.departmentCode ?? '?'})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
