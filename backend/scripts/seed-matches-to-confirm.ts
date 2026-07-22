import 'dotenv/config';
// Crée des matchs PENDING « à confirmer » pour test@palova.fr (feature « Résultats à
// confirmer » / GET /api/me/matches/to-confirm) — pour tester la carte ResultsToConfirm
// (Mon Palova, Club-house, /parties) sans avoir à jouer + saisir un vrai match.
// Idempotent (ids `to-confirm-demo-N`) et réversible.
//   Usage (dossier backend/) :
//   node -r ts-node/register scripts/seed-matches-to-confirm.ts seed [clubId]
//   node -r ts-node/register scripts/seed-matches-to-confirm.ts cleanup [clubId]
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const ID = (n: number) => `to-confirm-demo-${n}`;

type SetScore = [number, number];

const MATCHES: Array<{ sets: SetScore[]; playedAgo: number }> = [
  { sets: [[6, 4], [6, 3]], playedAgo: 2 * HOUR },
  { sets: [[3, 6], [7, 5], [10, 8]], playedAgo: 1 * DAY },
  { sets: [[6, 2], [4, 6], [6, 4]], playedAgo: 3 * HOUR },
];

function winningTeam(sets: SetScore[]): 1 | 2 {
  let s1 = 0;
  let s2 = 0;
  for (const [a, b] of sets) {
    if (a > b) s1++;
    else if (b > a) s2++;
  }
  return s1 >= s2 ? 1 : 2;
}

async function seed(clubId: string) {
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { id: true, levelSystemEnabled: true } });
  if (!club) throw new Error(`Club ${clubId} introuvable`);
  if (!club.levelSystemEnabled) console.warn('⚠️  levelSystemEnabled est désactivé sur ce club (sans conséquence ici, la saisie de résultat le vérifie mais pas ce script).');

  const sport = await prisma.sport.findUniqueOrThrow({ where: { key: 'padel' } });
  const resource = await prisma.resource.findFirst({
    where: { clubId, isActive: true, clubSport: { sportId: sport.id } },
    select: { id: true, price: true },
  });
  if (!resource) throw new Error('Aucun terrain padel actif sur ce club.');

  const emails = ['test@palova.fr', 'joueur@palova.fr', 'owner@palova.fr', 'admin@palova.fr'];
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
  const byEmail = new Map(users.map((u) => [u.email, u.id]));
  const missing = emails.filter((e) => !byEmail.has(e));
  if (missing.length) {
    throw new Error(`Comptes de démo manquants (lancer "npm run db:seed" d'abord) : ${missing.join(', ')}`);
  }

  const testId = byEmail.get('test@palova.fr')!;
  const authorId = byEmail.get('joueur@palova.fr')!; // crée le match → auto-confirmé, test@palova.fr reste PENDING
  const team1 = [testId, authorId];
  const team2 = [byEmail.get('owner@palova.fr')!, byEmail.get('admin@palova.fr')!];
  const all = [...team1, ...team2];
  const priceCents = Number(resource.price);

  const now = Date.now();
  for (let i = 0; i < MATCHES.length; i++) {
    const id = ID(i + 1);
    const { sets, playedAgo } = MATCHES[i];
    const endTime = new Date(now - playedAgo);
    const startTime = new Date(endTime.getTime() - 90 * 60_000);

    // Repart propre : un ancien match/résa du même id est supprimé avant recréation.
    await prisma.match.deleteMany({ where: { id } });
    await prisma.reservation.deleteMany({ where: { id } });

    const reservation = await prisma.reservation.create({
      data: {
        id,
        resourceId: resource.id,
        userId: authorId,
        startTime,
        endTime,
        status: 'CONFIRMED',
        type: 'COURT',
        visibility: 'PRIVATE',
        competitive: true,
        totalPrice: priceCents,
        participants: {
          create: all.map((userId, idx) => ({
            userId,
            isOrganizer: userId === authorId,
            share: priceCents / 4,
            team: idx < 2 ? 1 : 2,
            slot: idx % 2,
          })),
        },
      },
    });

    await prisma.match.create({
      data: {
        id,
        clubId,
        sportId: sport.id,
        reservationId: reservation.id,
        playedAt: startTime,
        status: 'PENDING',
        createdByUserId: authorId,
        sets: sets as unknown as object,
        winningTeam: winningTeam(sets),
        competitive: true,
        confirmDeadline: new Date(now + 3 * DAY), // loin devant : le cron autoValidateDue (cleanup.job, chaque minute) ne le finalise pas pendant le test
        players: {
          create: all.map((userId) => ({
            userId,
            team: team1.includes(userId) ? 1 : 2,
            confirmation: userId === authorId ? 'CONFIRMED' : 'PENDING',
          })),
        },
      },
    });
    console.log(`✓ Match ${id} créé (${sets.map((s) => s.join('-')).join(' / ')}) — à confirmer pour test@palova.fr`);
  }
  console.log(`\n${MATCHES.length} match(s) « à confirmer » créés sur ${clubId}. Voir /api/me/matches/to-confirm (test@palova.fr).`);
}

async function cleanup(clubId: string) {
  const ids = MATCHES.map((_, i) => ID(i + 1));
  await prisma.match.deleteMany({ where: { id: { in: ids } } });
  await prisma.reservation.deleteMany({ where: { id: { in: ids }, resource: { clubId } } });
  console.log(`Nettoyé ${ids.length} match(s) de démo.`);
}

const [cmd, clubArg] = process.argv.slice(2);
const clubId = clubArg || 'club-demo';
(async () => {
  if (cmd === 'cleanup') await cleanup(clubId);
  else await seed(clubId);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
