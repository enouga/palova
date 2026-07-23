import 'dotenv/config';
// Test de charge CONCURRENTIEL du chemin chaud « hold » (rush de minuit) : N joueurs
// distincts qui tentent de bloquer LE MÊME créneau en même temps (le pire cas — tout le
// monde rafraîchit à l'ouverture des réservations), puis N joueurs qui bloquent des
// créneaux TOUS DIFFÉRENTS (pour mesurer le débit global sous charge). Contrairement à
// loadtest-members.ts (qui peuple juste des lignes ClubMembership pour tester l'UI liste),
// celui-ci exécute réellement ReservationService.holdSlot en parallèle contre le vrai
// Postgres + Redis de dev, pour vérifier : (a) exactement UNE réservation créée sur le
// créneau disputé, (b) aucun crash/erreur inattendue, (c) une latence raisonnable.
//
// Idempotent côté données (ids déterministes `loadtest-hold-N`), et se nettoie tout seul
// en fin de run (annule les réservations créées + supprime les faux membres + relâche les
// clés Redis restantes).
//
// Usage (dossier backend/) :
//   npx ts-node scripts/loadtest-hold-concurrency.ts [concurrency] [clubId] [resourceId]
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { DateTime } from 'luxon';
import { redis } from '../src/redis/client';
import { ReservationService } from '../src/services/reservation.service';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const reservationService = new ReservationService();

const ID_PREFIX = 'loadtest-hold-';
const EMAIL_PREFIX = 'loadtest-hold';

async function seedUsers(count: number, clubId: string): Promise<string[]> {
  const passwordHash = await bcrypt.hash('loadtest123', 10);
  const users = Array.from({ length: count }, (_, idx) => ({
    id: `${ID_PREFIX}${idx + 1}`,
    email: `${EMAIL_PREFIX}${idx + 1}@palova.fr`,
    password: passwordHash,
    firstName: 'Test',
    lastName: `Loadtest ${idx + 1}`,
    sex: (idx % 2 === 0 ? 'MALE' : 'FEMALE') as 'MALE' | 'FEMALE',
    emailVerified: true,
  }));
  await prisma.user.createMany({ data: users, skipDuplicates: true });
  const memberships = users.map((u, idx) => ({
    id: `loadtest-hold-member-${idx + 1}`,
    userId: u.id,
    clubId,
    status: 'ACTIVE' as const,
    isSubscriber: false,
  }));
  await prisma.clubMembership.createMany({ data: memberships, skipDuplicates: true });
  return users.map((u) => u.id);
}

async function cleanup(clubId: string) {
  // onDelete cascade sur ClubMembership/Reservation(participant)/etc. → supprimer les
  // users suffit pour les données ; les clés Redis résiduelles sont nettoyées à part.
  const { count } = await prisma.user.deleteMany({
    where: { email: { startsWith: EMAIL_PREFIX }, id: { startsWith: ID_PREFIX } },
  });
  console.log(`Nettoyage : ${count} faux utilisateur(s) supprimé(s).`);
  const keys = await redis.keys('lock:resource:*');
  const loadtestKeys: string[] = [];
  for (const k of keys) {
    const owner = await redis.get(k);
    if (owner && owner.startsWith(ID_PREFIX)) loadtestKeys.push(k);
  }
  if (loadtestKeys.length) {
    await redis.del(...loadtestKeys);
    console.log(`Nettoyage : ${loadtestKeys.length} verrou(s) Redis résiduel(s) supprimé(s).`);
  }
}

function stats(durationsMs: number[]) {
  if (!durationsMs.length) return { min: 0, max: 0, avg: 0, p95: 0 };
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const avg = sorted.reduce((s, x) => s + x, 0) / sorted.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return { min: sorted[0], max: sorted[sorted.length - 1], avg: Math.round(avg), p95 };
}

async function runSameSlotTest(userIds: string[], resourceId: string, startTime: Date, endTime: Date) {
  console.log(`\n=== Scénario A — ${userIds.length} joueurs sur LE MÊME créneau (${resourceId}, ${startTime.toISOString()}) ===`);
  const t0 = Date.now();
  const results = await Promise.allSettled(
    userIds.map(async (userId) => {
      const start = Date.now();
      try {
        await reservationService.holdSlot({ resourceId, userId, startTime, endTime });
        return { ok: true, ms: Date.now() - start };
      } catch (e) {
        return { ok: false, ms: Date.now() - start, err: (e as Error).message };
      }
    }),
  );
  const total = Date.now() - t0;

  const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, ms: 0, err: 'REJECTED' }));
  const wins = outcomes.filter((o) => o.ok);
  const already = outcomes.filter((o) => !o.ok && o.err === 'SLOT_ALREADY_HELD');
  const otherErrors = outcomes.filter((o) => !o.ok && o.err !== 'SLOT_ALREADY_HELD');

  console.log(`Temps total (mur) : ${total} ms`);
  console.log(`Gagnants (hold créé) : ${wins.length}`);
  console.log(`Refusés proprement (SLOT_ALREADY_HELD) : ${already.length}`);
  console.log(`Erreurs INATTENDUES : ${otherErrors.length}`, otherErrors.slice(0, 5).map((o) => o.err));
  console.log('Latence par appel (ms) —', stats(outcomes.map((o) => o.ms)));

  const rows = await prisma.reservation.findMany({
    where: { resourceId, startTime, status: { in: ['PENDING', 'CONFIRMED'] } },
    select: { id: true, userId: true, status: true },
  });
  console.log(`Vérif DB : ${rows.length} réservation(s) réellement créée(s) sur ce créneau (attendu : 1).`);
  if (rows.length !== 1) console.error('!!! ANOMALIE : double-booking ou zéro booking sur un créneau disputé !!!');

  // Nettoyage du créneau pour ne pas polluer le club de dev.
  for (const row of rows) {
    await prisma.reservation.delete({ where: { id: row.id } });
  }
  await redis.del(`lock:resource:${resourceId}:${startTime.toISOString()}`);

  return { wins: wins.length, already: already.length, otherErrors: otherErrors.length, dbRows: rows.length };
}

async function runSpreadTest(userIds: string[], resourceIds: string[], baseDay: DateTime) {
  console.log(`\n=== Scénario B — ${userIds.length} joueurs sur des créneaux TOUS DIFFÉRENTS (débit global) ===`);
  // Grille de créneaux 30 min de 8h à 22h sur `resourceIds` × plusieurs jours, un par joueur
  // (pas de collision voulue) — étale sur autant de jours que nécessaire pour couvrir la
  // concurrence demandée (3 terrains × 28 créneaux/jour = 84/jour sur club-demo).
  const slots: { resourceId: string; start: DateTime; end: DateTime }[] = [];
  for (let dayOffset = 0; slots.length < userIds.length && dayOffset < 30; dayOffset++) {
    const day = baseDay.plus({ days: dayOffset });
    for (const resourceId of resourceIds) {
      for (let h = 8; h < 22; h += 0.5) {
        const start = day.set({ hour: Math.floor(h), minute: (h % 1) * 60, second: 0, millisecond: 0 });
        slots.push({ resourceId, start, end: start.plus({ hours: 1 }) });
        if (slots.length >= userIds.length) break;
      }
      if (slots.length >= userIds.length) break;
    }
  }
  if (slots.length < userIds.length) throw new Error(`Pas assez de créneaux distincts (${slots.length}) pour ${userIds.length} joueurs.`);

  const t0 = Date.now();
  const results = await Promise.allSettled(
    userIds.map(async (userId, i) => {
      const slot = slots[i];
      const start = Date.now();
      try {
        await reservationService.holdSlot({
          resourceId: slot.resourceId, userId,
          startTime: slot.start.toUTC().toJSDate(), endTime: slot.end.toUTC().toJSDate(),
        });
        return { ok: true, ms: Date.now() - start, slot };
      } catch (e) {
        return { ok: false, ms: Date.now() - start, err: (e as Error).message, slot };
      }
    }),
  );
  const total = Date.now() - t0;

  const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, ms: 0, err: 'REJECTED', slot: null }));
  const wins = outcomes.filter((o) => o.ok);
  const errors = outcomes.filter((o) => !o.ok);

  console.log(`Temps total (mur) : ${total} ms pour ${userIds.length} holds concurrents sur des créneaux distincts.`);
  console.log(`Réussis : ${wins.length} / ${userIds.length}`);
  console.log(`Échecs : ${errors.length}`, errors.slice(0, 5).map((o) => o.err));
  console.log('Latence par appel (ms) —', stats(outcomes.map((o) => o.ms)));

  // Nettoyage.
  for (const o of wins) {
    if (!o.slot) continue;
    await prisma.reservation.deleteMany({
      where: { resourceId: o.slot.resourceId, startTime: o.slot.start.toUTC().toJSDate(), status: 'PENDING' },
    });
    await redis.del(`lock:resource:${o.slot.resourceId}:${o.slot.start.toUTC().toJSDate().toISOString()}`);
  }

  return { wins: wins.length, errors: errors.length, total };
}

async function main() {
  const [, , arg1, arg2, arg3] = process.argv;
  const concurrency = Number(arg1 ?? 150);
  const clubId = arg2 ?? 'club-demo';
  const resourceId = arg3 ?? 'court-1';

  // `lazyConnect: true` sur le client Redis partagé : sans ce connect explicite, une rafale
  // de N appels concurrents déclencherait N tentatives de connexion en course (échec réel
  // observé : "Stream isn't writeable" sur toute la première salve) — artefact du lancement
  // du script, pas du comportement réel (le process backend, lui, est déjà connecté avant
  // toute requête).
  await redis.connect();
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { id: true, name: true, timezone: true } });
  if (!club) throw new Error(`Club ${clubId} introuvable`);
  const resources = await prisma.resource.findMany({ where: { clubId }, select: { id: true }, take: 3 });
  if (!resources.length) throw new Error(`Aucun terrain pour ${clubId}`);

  console.log(`Club : ${club.name} — concurrence testée : ${concurrency} joueurs simultanés.`);
  console.log(`Seed de ${concurrency} faux membres...`);
  const userIds = await seedUsers(concurrency, clubId);

  // Créneau disputé : dans 3 jours (dans la fenêtre de réservation par défaut), 18h locale,
  // choisi libre (vérifié manuellement en amont sur club-demo).
  const disputedStart = DateTime.now().setZone(club.timezone).plus({ days: 3 }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  const disputedEnd = disputedStart.plus({ hours: 1 });

  const a = await runSameSlotTest(userIds, resourceId, disputedStart.toUTC().toJSDate(), disputedEnd.toUTC().toJSDate());

  const spreadDay = DateTime.now().setZone(club.timezone).plus({ days: 4 }).set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  const b = await runSpreadTest(userIds, resources.map((r) => r.id), spreadDay);

  console.log('\n=== Nettoyage final ===');
  await cleanup(clubId);

  console.log('\n=== Résumé ===');
  console.log('Scénario A (même créneau) :', a);
  console.log('Scénario B (créneaux distincts) :', b);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); redis.disconnect(); });
