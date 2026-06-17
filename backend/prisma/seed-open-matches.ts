/**
 * Seed de « parties ouvertes » (réservations PUBLIC rejoignables) pour TOUS les clubs.
 *
 * Pour chaque club en base, crée un éventail de parties ouvertes FUTURES couvrant les
 * cas UI de /parties (et du Club-house) :
 *  - terrain double (cap. 4) : 3 places libres / 2 libres / 1 libre (presque complète) / complète
 *  - terrain single (cap. 2) : 1 place libre
 *  - avec et sans fourchette de niveau cible (targetLevelMin/Max)
 * Organisateur (isOrganizer) + joueurs ayant « rejoint », parts du prix réparties
 * (organisateur = reste au centime, autres = part égale — miroir de OpenMatchService).
 * Les joueurs sont tirés des membres ACTIFS du club (plafonné à l'effectif, sans planter).
 *
 * Rejouable : supprime d'abord les parties ouvertes de CE club portant notre marqueur
 * (notes = 'seed:open-match', cascade sur les participants), puis les recrée. Les parties
 * créées à la main (autre marqueur) ne sont jamais touchées.
 *
 * Lancement (dossier backend/) :  npx ts-node prisma/seed-open-matches.ts
 *                            ou :  npm run db:seed:open-matches
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const SEED_MARKER = 'seed:open-match';
const DURATION_MIN = 90;

// single = 2, sinon double = 4 (miroir de backend/src/utils/courtType.ts:playerCount).
const playerCount = (format?: string): number => (format === 'single' ? 2 : 4);

// Gabarits de parties ouvertes (appliqués à chaque club).
//  - format    : type de terrain visé (double cap.4 / single cap.2)
//  - courtPick : index parmi les terrains de ce format (cyclé si moins de terrains)
//  - startInDays / startHour : créneau futur (créneaux distincts → pas de collision sur un même terrain)
//  - joiners   : joueurs EN PLUS de l'organisateur (total = 1 + joiners, plafonné à la capacité)
//  - level     : fourchette de niveau cible [min, max] (0–8) ou null
const TEMPLATES: Array<{
  format: 'double' | 'single'; courtPick: number;
  startInDays: number; startHour: number; joiners: number;
  level: [number, number] | null;
}> = [
  { format: 'double', courtPick: 0, startInDays: 1, startHour: 18, joiners: 0, level: null },        // 3 places libres
  { format: 'double', courtPick: 1, startInDays: 1, startHour: 20, joiners: 1, level: null },        // 2 places libres
  { format: 'double', courtPick: 2, startInDays: 2, startHour: 18, joiners: 2, level: [4.0, 5.5] },  // 1 place libre (presque complète)
  { format: 'double', courtPick: 0, startInDays: 2, startHour: 20, joiners: 3, level: null },        // complète
  { format: 'single', courtPick: 0, startInDays: 1, startHour: 17, joiners: 0, level: [3.0, 4.5] },  // 1 place libre (single)
  { format: 'double', courtPick: 1, startInDays: 3, startHour: 19, joiners: 1, level: [5.0, 6.5] },  // 2 places libres + niveau
];

/** Date à `days` jours, à l'heure `hour` pile (heure locale du serveur ; le dev tourne en Europe/Paris). */
function slotStart(days: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Parts du prix : organisateur = reste au centime, autres = part égale (miroir OpenMatchService.applyShares). */
function shareFor(isOrganizer: boolean, priceCents: number, n: number): Prisma.Decimal {
  const base = Math.floor(priceCents / n);
  const organizer = priceCents - base * (n - 1);
  return new Prisma.Decimal(isOrganizer ? organizer : base).div(100);
}

async function main() {
  const clubs = await prisma.club.findMany({ select: { id: true, slug: true, name: true } });
  if (clubs.length === 0) {
    console.log('Aucun club en base — lance d’abord le seed (npm run db:seed:demo).');
    return;
  }

  let totalMatches = 0;
  let totalParticipants = 0;

  for (const club of clubs) {
    // Terrains du club, séparés par format, ordre stable.
    const resources = await prisma.resource.findMany({
      where: { clubId: club.id },
      select: { id: true, name: true, price: true, attributes: true },
      orderBy: { id: 'asc' },
    });
    const byFormat = (fmt: 'double' | 'single') =>
      resources.filter((r) => ((r.attributes as { format?: string } | null)?.format ?? 'double') === fmt);
    const doubles = byFormat('double');
    const singles = byFormat('single');

    // Membres actifs du club, ordre stable (= base de rotation des joueurs).
    const memberships = await prisma.clubMembership.findMany({
      where: { clubId: club.id, status: 'ACTIVE' },
      select: { userId: true },
      orderBy: { createdAt: 'asc' },
    });
    const memberIds = memberships.map((m) => m.userId);

    // Rejouable : on efface nos parties ouvertes de CE club (cascade sur les participants).
    const resourceIds = resources.map((r) => r.id);
    await prisma.reservation.deleteMany({
      where: { resourceId: { in: resourceIds }, notes: SEED_MARKER },
    });

    if (resources.length === 0 || memberIds.length < 1) {
      console.log(`• ${club.slug.padEnd(28)} : ignoré (terrains: ${resources.length}, membres: ${memberIds.length})`);
      continue;
    }

    let cursor = 0; // rotation des joueurs d'une partie à l'autre → équipes variées
    let clubMatches = 0;
    let clubParticipants = 0;

    for (const tpl of TEMPLATES) {
      const pool = tpl.format === 'single' ? singles : doubles;
      if (pool.length === 0) continue; // club sans terrain de ce format
      const court = pool[tpl.courtPick % pool.length];
      const cap = playerCount((court.attributes as { format?: string } | null)?.format);

      // total joueurs = organisateur + joiners, borné par la capacité ET l'effectif disponible
      const wanted = 1 + tpl.joiners;
      const n = Math.min(wanted, cap, memberIds.length);
      if (n < 1) continue;

      const start = slotStart(tpl.startInDays, tpl.startHour);
      const end = new Date(start.getTime() + DURATION_MIN * 60 * 1000);
      const priceCents = Math.round(Number(court.price) * 100);

      // Joueurs : on prend n membres consécutifs (organisateur = le 1er).
      const players = Array.from({ length: n }, (_, i) => memberIds[(cursor + i) % memberIds.length]);
      cursor = (cursor + n) % memberIds.length;

      const reservation = await prisma.reservation.create({
        data: {
          resourceId: court.id,
          userId: players[0], // organisateur
          startTime: start,
          endTime: end,
          status: 'CONFIRMED',
          type: 'COURT',
          visibility: 'PUBLIC',
          title: 'Partie ouverte',
          totalPrice: court.price,
          notes: SEED_MARKER,
          targetLevelMin: tpl.level ? tpl.level[0] : null,
          targetLevelMax: tpl.level ? tpl.level[1] : null,
        },
      });
      clubMatches++;
      totalMatches++;

      const joinBase = Date.now() - n * 60000; // joinedAt échelonnés (organisateur en premier)
      for (let i = 0; i < n; i++) {
        const isOrganizer = i === 0;
        await prisma.reservationParticipant.create({
          data: {
            reservationId: reservation.id,
            userId: players[i],
            isOrganizer,
            share: shareFor(isOrganizer, priceCents, n),
            joinedAt: new Date(joinBase + i * 60000),
          },
        });
        clubParticipants++;
        totalParticipants++;
      }
    }

    console.log(`✔ ${club.slug.padEnd(28)} : ${clubMatches} parties ouvertes, ${clubParticipants} participants (${memberIds.length} membres actifs)`);
  }

  console.log(`\nSeed parties ouvertes terminé : ${clubs.length} clubs, ${totalMatches} parties, ${totalParticipants} participants.`);
  console.log('Voir : http://<slug>.localhost:3000/parties  (connecté comme membre du club).');
}

main().finally(() => prisma.$disconnect());
