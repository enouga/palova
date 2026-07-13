import 'dotenv/config';
// Peuple /admin/abonnes avec des abonnés variés (plusieurs forfaits, 2 sports,
// échéances proches/lointaines, 1 résilié pour l'historique) afin d'évaluer la page.
// Idempotent (ids `abodemo-N`) et réversible.
//   Usage (dossier backend/) :
//   node -r ts-node/register scripts/seed-subscribers.ts seed [clubId]
//   node -r ts-node/register scripts/seed-subscribers.ts cleanup [clubId]
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const ID = (n: number) => `abodemo-${n}`;
const DAY = 86_400_000;

const PEOPLE = [
  { first: 'Camille', last: 'Rousseau' },
  { first: 'Hugo', last: 'Lefevre' },
  { first: 'Léa', last: 'Girard' },
  { first: 'Thomas', last: 'Mercier' },
  { first: 'Chloé', last: 'Blanc' },
  { first: 'Nathan', last: 'Faure' },
  { first: 'Manon', last: 'Roche' },
  { first: 'Arthur', last: 'Perrin' },
  { first: 'Sarah', last: 'Vidal' },
  { first: 'Louis', last: 'Chevalier' },
];

async function seed(clubId: string) {
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { id: true, name: true } });
  if (!club) throw new Error(`Club ${clubId} introuvable`);
  const plans = await prisma.subscriptionPlan.findMany({ where: { clubId }, orderBy: { createdAt: 'asc' } });
  if (plans.length === 0) throw new Error('Aucun forfait pour ce club — impossible de peupler.');
  console.log(`Forfaits: ${plans.map((p) => `${p.name} [${p.sportKeys.join(',')}]`).join(' · ')}`);

  const passwordHash = await bcrypt.hash('password123', 10);
  const now = Date.now();
  // Échéances variées : proches (coral), lointaines, une résiliée.
  const offsets = [220, 12, 340, 25, 180, 8, 400, 60, -10 /* résilié */, 150];

  for (let i = 0; i < PEOPLE.length; i++) {
    const id = ID(i + 1);
    const p = PEOPLE[i];
    const plan = plans[i % plans.length];
    await prisma.user.upsert({
      where: { id },
      update: { firstName: p.first, lastName: p.last },
      create: { id, email: `${id}@demo.palova.fr`, password: passwordHash, firstName: p.first, lastName: p.last, emailVerified: true },
    });
    await prisma.clubMembership.upsert({
      where: { userId_clubId: { userId: id, clubId } },
      update: {},
      create: { userId: id, clubId, status: 'ACTIVE' },
    });
    // On repart propre : supprime les abos précédents de ce faux membre.
    await prisma.subscription.deleteMany({ where: { userId: id, clubId } });
    const isCancelled = i === 8;
    await prisma.subscription.create({
      data: {
        clubId, userId: id, planId: plan.id,
        status: isCancelled ? 'CANCELLED' : 'ACTIVE',
        startedAt: new Date(now - (30 + i * 5) * DAY),
        expiresAt: new Date(now + offsets[i] * DAY),
        monthlyPriceSnapshot: plan.monthlyPrice,
        sportKeys: plan.sportKeys, offPeakOnly: plan.offPeakOnly, benefit: plan.benefit,
        discountPercent: plan.discountPercent, dailyCap: plan.dailyCap, weeklyCap: plan.weeklyCap,
      },
    });
    console.log(`✓ ${p.first} ${p.last} → ${plan.name} (${isCancelled ? 'résilié' : `J+${offsets[i]}`})`);
  }
  console.log(`\n${PEOPLE.length} abonnés de démo créés sur ${club.name}.`);
}

async function cleanup(clubId: string) {
  const ids = PEOPLE.map((_, i) => ID(i + 1));
  await prisma.subscription.deleteMany({ where: { userId: { in: ids } } });
  await prisma.clubMembership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`Nettoyé ${ids.length} abonnés de démo.`);
}

const [cmd, clubArg] = process.argv.slice(2);
const clubId = clubArg || 'club-demo';
(async () => {
  if (cmd === 'cleanup') await cleanup(clubId);
  else await seed(clubId);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
