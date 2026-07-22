// Seed de matchs de test pour Jean Dupont (test@palova.fr) sur club-demo.
// Crée plusieurs matchs padel passés dans des états variés pour tester le flux
// « confirmer / contester un résultat » et la carte « Résultats à saisir ».
//
//   node scripts/seed-test-matches.mjs         -> crée les exemples
//   node scripts/seed-test-matches.mjs clean   -> supprime les exemples (tag TEST-MATCH-SEED)
//
// Réplique la logique de MatchService.createFromReservation / disputeMatch (mêmes invariants).
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const TAG = 'TEST-MATCH-SEED';
const CLUB_ID = 'club-demo';

const U = {
  jean:  'cmqfcjs01000bokkk6ybk7syr', // test@palova.fr (Jean Dupont)
  lucas: 'cmqfcwzfe0004ugkkl3709g5l',
  emma:  'cmqfcwzka0006ugkkigh9i8lg',
  hugo:  'cmqfcwzkn0008ugkkbmfyltk2',
  jade:  'cmqfcwzl0000augkk28kl9uyr',
  louis: 'cmqfcwzle000cugkkxcjy14a1',
  louise:'cmqfcwzlq000eugkkv6c14i8j',
};

const winningTeam = (sets) => {
  let a = 0, b = 0;
  for (const [x, y] of sets) { if (x > y) a++; else if (y > x) b++; }
  return a >= b ? 1 : 2;
};
const daysAgo = (d, h, m = 0) => { const t = new Date(); t.setDate(t.getDate() - d); t.setHours(h, m, 0, 0); return t; };

async function sportIdOf(resourceId) {
  const r = await prisma.resource.findUnique({ where: { id: resourceId }, select: { clubSport: { select: { sportId: true } } } });
  return r.clubSport.sportId;
}

/** Crée une résa COURT passée + 4 participants (t1 = 2 joueurs Éq.1, t2 = 2 joueurs Éq.2). */
async function makeReservation(resourceId, start, end, t1, t2) {
  const all = [...t1, ...t2];
  const res = await prisma.reservation.create({
    data: {
      resourceId, userId: all[0], startTime: start, endTime: end,
      status: 'CONFIRMED', type: 'COURT', visibility: 'PRIVATE', competitive: true,
      totalPrice: '25.00', title: TAG,
      participants: {
        create: all.map((userId, i) => ({
          userId, isOrganizer: i === 0, share: '6.25',
          team: t1.includes(userId) ? 1 : 2,
          slot: (t1.includes(userId) ? t1 : t2).indexOf(userId),
        })),
      },
    },
  });
  return res;
}

/** Match PENDING : author confirmé, les 3 autres en attente. Renvoie l'id. */
async function makePendingMatch(res, sportId, t1, t2, sets, authorId, status = 'PENDING') {
  const all = [...t1, ...t2];
  const teamOf = (id) => (t1.includes(id) ? 1 : 2);
  const match = await prisma.match.create({
    data: {
      clubId: CLUB_ID, sportId, reservationId: res.id, playedAt: res.startTime,
      status, createdByUserId: authorId, sets, winningTeam: winningTeam(sets),
      competitive: true, confirmDeadline: new Date(Date.now() + 72 * 3600 * 1000),
      players: { create: all.map((id) => ({ userId: id, team: teamOf(id), confirmation: id === authorId ? 'CONFIRMED' : 'PENDING' })) },
    },
    include: { players: true },
  });
  return match;
}

async function create() {
  const sportPadel = await sportIdOf('court-1');

  // 1) PENDING — Jean DOIT confirmer (auteur = Lucas). Éq. de Jean gagne 2-0.
  const r1 = await makeReservation('court-1', daysAgo(3, 18), daysAgo(3, 19, 30), [U.jean, U.lucas], [U.emma, U.hugo]);
  await makePendingMatch(r1, sportPadel, [U.jean, U.lucas], [U.emma, U.hugo], [[6, 3], [6, 4]], U.lucas);

  // 2) PENDING — Jean DOIT confirmer (auteur = Louis). 3 sets serrés.
  const r2 = await makeReservation('court-2', daysAgo(5, 20), daysAgo(5, 21, 30), [U.jean, U.jade], [U.louis, U.louise]);
  await makePendingMatch(r2, sportPadel, [U.jean, U.jade], [U.louis, U.louise], [[4, 6], [6, 4], [10, 8]], U.louis);

  // 3) DISPUTED — Jean a contesté (auteur = Lucas). Fil de discussion ouvert.
  const r3 = await makeReservation('court-3', daysAgo(4, 19), daysAgo(4, 20, 30), [U.jean, U.emma], [U.lucas, U.jade]);
  const m3 = await makePendingMatch(r3, sportPadel, [U.jean, U.emma], [U.lucas, U.jade], [[6, 2], [6, 1]], U.lucas, 'DISPUTED');
  await prisma.matchPlayer.update({ where: { matchId_userId: { matchId: m3.id, userId: U.jean } }, data: { confirmation: 'DISPUTED' } });
  await prisma.matchComment.create({ data: { matchId: m3.id, userId: U.jean, body: 'Le 2e set était 6-4 pour nous, pas 6-1.' } });

  // 4) À SAISIR — résa padel jouée hier, 4 joueurs, AUCUN résultat (carte « Résultats à saisir »).
  await makeReservation('court-1', daysAgo(1, 18), daysAgo(1, 19, 30), [U.jean, U.emma], [U.hugo, U.jade]);

  const total = await prisma.reservation.count({ where: { title: TAG } });
  console.log(`OK — 3 matchs (2 à confirmer + 1 en litige) + 1 à saisir créés pour test@palova.fr. (${total} résas taguées)`);
}

async function clean() {
  const res = await prisma.reservation.findMany({ where: { title: TAG }, select: { id: true } });
  const ids = res.map((r) => r.id);
  if (!ids.length) { console.log('Rien à nettoyer.'); return; }
  const matches = await prisma.match.findMany({ where: { reservationId: { in: ids } }, select: { id: true } });
  const mIds = matches.map((m) => m.id);
  await prisma.matchComment.deleteMany({ where: { matchId: { in: mIds } } });
  await prisma.matchPlayer.deleteMany({ where: { matchId: { in: mIds } } });
  await prisma.match.deleteMany({ where: { id: { in: mIds } } });
  await prisma.reservationParticipant.deleteMany({ where: { reservationId: { in: ids } } });
  await prisma.reservation.deleteMany({ where: { id: { in: ids } } });
  console.log(`Nettoyé : ${ids.length} résas, ${mIds.length} matchs.`);
}

const mode = process.argv[2];
(mode === 'clean' ? clean() : create())
  .catch((e) => { console.error('ERR', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
