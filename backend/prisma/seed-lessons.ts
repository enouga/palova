/**
 * Seed de cours de test pour club-demo (individuel, collectif, série hebdo, passé).
 *
 * Couvre les cas UI :
 *  - cours individuel, admin-only (allowSelfEnroll=false), 1 élève inscrit
 *  - cours collectif, auto-inscription ouverte (allowSelfEnroll=true), complet + liste d'attente
 *  - créneau individuel libre avec le coach lié à un compte (auto-inscription possible)
 *  - série hebdomadaire (6 occurrences), inscription au niveau série (enrollmentMode=SERIES)
 *  - cours passé, avec élève inscrit (historique)
 *
 * Deux coachs : un coach « vitrine » (sans compte User) et un coach lié à staff@palova.fr
 * (permet de se connecter avec ce compte et tester l'espace coach /me/coach).
 *
 * Rejouable : supprime d'abord les réservations COACHING de club-demo dont le titre
 * commence par le marqueur de seed (cascade sur lessons + enrollments), puis les séries
 * du même marqueur, avant de tout recréer.
 *
 * Lancement (dossier backend/) : npx ts-node prisma/seed-lessons.ts
 *                            ou : npm run db:seed:lessons
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DateTime } from 'luxon';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const CLUB_ID = 'club-demo';
const MARKER = '[seed-cours] ';

async function main() {
  const club = await prisma.club.findUnique({
    where: { id: CLUB_ID },
    select: { id: true, slug: true, timezone: true },
  });
  if (!club) {
    console.log(`Club ${CLUB_ID} introuvable — lance d'abord le seed de base (npm run db:seed).`);
    return;
  }
  const clubId = club.id;
  const tz = club.timezone;

  const resources = await prisma.resource.findMany({
    where: { clubId: club.id, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 3,
  });
  if (resources.length < 2) {
    console.log(`Pas assez de terrains actifs sur ${club.slug} pour seeder des cours.`);
    return;
  }
  const [courtA, courtB, courtC] = [resources[0], resources[1], resources[2] ?? resources[0]];

  // ── Rejouable : purge des données du run précédent ────────────────────────
  const stale = await prisma.reservation.findMany({
    where: { resource: { clubId: club.id }, type: 'COACHING', title: { startsWith: MARKER } },
    select: { id: true },
  });
  if (stale.length) {
    await prisma.reservation.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } }); // cascade → lessons → enrollments
  }
  await prisma.reservationSeries.deleteMany({ where: { clubId: club.id, title: { startsWith: MARKER } } });

  // ── Coachs ──────────────────────────────────────────────────────────────
  let showcaseCoach = await prisma.coach.findFirst({
    where: { clubId: club.id, userId: null, name: 'Rachid Benali' },
    select: { id: true },
  });
  if (!showcaseCoach) {
    showcaseCoach = await prisma.coach.create({
      data: {
        clubId: club.id,
        userId: null,
        name: 'Rachid Benali',
        bio: "Moniteur diplômé d'État, spécialiste du jeu de fond de court et de la préparation en double.",
        isActive: true,
      },
      select: { id: true },
    });
  }

  const staffUser = await prisma.user.findUnique({ where: { email: 'staff@palova.fr' }, select: { id: true } });
  let linkedCoach: { id: string } | null = null;
  let linkedCoachEmail: string | null = null;
  if (staffUser) {
    await prisma.clubMembership.upsert({
      where: { userId_clubId: { userId: staffUser.id, clubId: club.id } },
      update: { status: 'ACTIVE' },
      create: { userId: staffUser.id, clubId: club.id, status: 'ACTIVE' },
    });
    linkedCoach = await prisma.coach.upsert({
      where: { clubId_userId: { clubId: club.id, userId: staffUser.id } },
      update: { isActive: true },
      create: { clubId: club.id, userId: staffUser.id, name: 'Coach (compte staff)', isActive: true },
      select: { id: true },
    });
    linkedCoachEmail = 'staff@palova.fr';
  }
  const secondCoach = linkedCoach ?? showcaseCoach; // repli si staff@ absent de cette base

  // ── Élèves candidats : membres ACTIFS de club-demo ─────────────────────
  const memberships = await prisma.clubMembership.findMany({
    where: { clubId: club.id, status: 'ACTIVE' },
    select: { userId: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  const studentIds = memberships.map((m) => m.userId);
  const pick = (n: number, offset = 0) =>
    studentIds.length ? Array.from({ length: Math.min(n, studentIds.length) }, (_, i) => studentIds[(offset + i) % studentIds.length]) : [];

  // ── Helpers ─────────────────────────────────────────────────────────────
  function at(daysFromNow: number, hour: number, minute = 0): Date {
    return DateTime.now().setZone(tz).plus({ days: daysFromNow }).set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
  }

  // Évite tout double-booking avec une donnée déjà présente (autre seed, résa de test…) :
  // essaie les terrains candidats dans l'ordre, renvoie le premier libre sur le créneau.
  async function findFreeResource(candidateIds: string[], start: Date, end: Date): Promise<string | null> {
    for (const resourceId of candidateIds) {
      const clash = await prisma.reservation.findFirst({
        where: { resourceId, status: { not: 'CANCELLED' }, startTime: { lt: end }, endTime: { gt: start } },
        select: { id: true },
      });
      if (!clash) return resourceId;
    }
    return null;
  }

  async function createLesson(opts: {
    title: string;
    resourceIds: string[];
    coachId: string;
    capacity: number;
    lessonKind: 'INDIVIDUAL' | 'COLLECTIVE';
    allowSelfEnroll: boolean;
    startTime: Date;
    endTime: Date;
    price: number;
    confirmedStudents: string[];
    waitlistedStudents?: string[];
  }): Promise<{ id: string } | null> {
    const resourceId = await findFreeResource(opts.resourceIds, opts.startTime, opts.endTime);
    if (!resourceId) {
      console.warn(`⚠ Aucun terrain libre pour « ${opts.title} » (${opts.startTime.toISOString()}) — séance ignorée.`);
      return null;
    }
    const reservation = await prisma.reservation.create({
      data: {
        resourceId,
        userId: null,
        startTime: opts.startTime,
        endTime: opts.endTime,
        status: 'CONFIRMED',
        type: 'COACHING',
        title: MARKER + opts.title,
        totalPrice: opts.price,
      },
      select: { id: true },
    });
    const lesson = await prisma.lesson.create({
      data: {
        reservationId: reservation.id,
        clubId,
        coachId: opts.coachId,
        capacity: opts.capacity,
        lessonKind: opts.lessonKind,
        allowSelfEnroll: opts.allowSelfEnroll,
      },
      select: { id: true },
    });
    const base = Date.now();
    let i = 0;
    for (const userId of opts.confirmedStudents) {
      await prisma.lessonEnrollment.create({
        data: { lessonId: lesson.id, userId, status: 'CONFIRMED', createdAt: new Date(base + i * 60000) },
      });
      i++;
    }
    for (const userId of opts.waitlistedStudents ?? []) {
      await prisma.lessonEnrollment.create({
        data: { lessonId: lesson.id, userId, status: 'WAITLISTED', createdAt: new Date(base + i * 60000) },
      });
      i++;
    }
    return lesson;
  }

  let lessonCount = 0;
  let enrollCount = 0;
  const countEnroll = (n: number) => { enrollCount += n; };

  // (1) Individuel, admin-only, 1 élève inscrit
  {
    const students = pick(1, 0);
    const created = await createLesson({
      title: 'Cours individuel — perfectionnement',
      resourceIds: [courtA.id, courtB.id, courtC.id],
      coachId: showcaseCoach.id,
      capacity: 1,
      lessonKind: 'INDIVIDUAL',
      allowSelfEnroll: false,
      startTime: at(2, 9, 0),
      endTime: at(2, 10, 0),
      price: 45,
      confirmedStudents: students,
    });
    if (created) { lessonCount++; countEnroll(students.length); }
  }

  // (2) Collectif, auto-inscription, complet + liste d'attente
  {
    const confirmed = pick(4, 1);
    const wait = pick(1, 5);
    const created = await createLesson({
      title: 'Cours collectif débutants',
      resourceIds: [courtB.id, courtC.id, courtA.id],
      coachId: showcaseCoach.id,
      capacity: 4,
      lessonKind: 'COLLECTIVE',
      allowSelfEnroll: true,
      startTime: at(4, 18, 0),
      endTime: at(4, 19, 0),
      price: 20,
      confirmedStudents: confirmed,
      waitlistedStudents: wait,
    });
    if (created) { lessonCount++; countEnroll(confirmed.length + wait.length); }
  }

  // (3) Créneau individuel libre avec le coach lié (auto-inscription, 0 élève — testable en live)
  {
    const created = await createLesson({
      title: 'Créneau coach — place libre',
      resourceIds: [courtA.id, courtB.id, courtC.id],
      coachId: secondCoach.id,
      capacity: 1,
      lessonKind: 'INDIVIDUAL',
      allowSelfEnroll: true,
      startTime: at(6, 10, 0),
      endTime: at(6, 11, 0),
      price: 45,
      confirmedStudents: [],
    });
    if (created) lessonCount++;
  }

  // (4) Passé, avec élève inscrit (historique)
  {
    const students = pick(1, 2);
    const created = await createLesson({
      title: 'Cours individuel (passé)',
      resourceIds: [courtA.id, courtB.id, courtC.id],
      coachId: showcaseCoach.id,
      capacity: 1,
      lessonKind: 'INDIVIDUAL',
      allowSelfEnroll: false,
      startTime: at(-5, 9, 0),
      endTime: at(-5, 10, 0),
      price: 45,
      confirmedStudents: students,
    });
    if (created) { lessonCount++; countEnroll(students.length); }
  }

  // (5) Série hebdomadaire — collectif du mercredi 19h, 6 occurrences, inscription au niveau série
  {
    const now = DateTime.now().setZone(tz);
    const WEDNESDAY = 3; // Luxon: 1=lundi..7=dimanche
    // Toujours à partir de demain (jamais « aujourd'hui ») : évite toute collision avec
    // un créneau déjà réservé aujourd'hui par une autre donnée de test/démo sur ce terrain.
    let firstWednesday = now.plus({ days: 1 }).set({ hour: 19, minute: 0, second: 0, millisecond: 0 });
    while (firstWednesday.weekday !== WEDNESDAY) {
      firstWednesday = firstWednesday.plus({ days: 1 });
    }
    const startDate = firstWednesday.startOf('day');
    const endDate = startDate.plus({ weeks: 7 }); // couvre 6 occurrences avec marge

    const series = await prisma.reservationSeries.create({
      data: {
        clubId: club.id,
        resourceId: courtC.id,
        type: 'COACHING',
        title: MARKER + 'Cours collectif du mercredi',
        weekday: WEDNESDAY,
        startLocal: '19:00',
        durationMin: 60,
        startDate: startDate.toJSDate(),
        endDate: endDate.toJSDate(),
        coachId: secondCoach.id,
        capacity: 6,
        lessonKind: 'COLLECTIVE',
        allowSelfEnroll: true,
        enrollmentMode: 'SERIES',
      },
      select: { id: true },
    });

    const occurrences = 6;
    for (let w = 0; w < occurrences; w++) {
      const occStart = firstWednesday.plus({ weeks: w });
      const occEnd = occStart.plus({ minutes: 60 });
      const resourceId = await findFreeResource([courtC.id, courtA.id, courtB.id], occStart.toJSDate(), occEnd.toJSDate());
      if (!resourceId) {
        console.warn(`⚠ Aucun terrain libre pour l'occurrence du ${occStart.toISODate()} — ignorée.`);
        continue;
      }
      const reservation = await prisma.reservation.create({
        data: {
          resourceId,
          userId: null,
          startTime: occStart.toJSDate(),
          endTime: occEnd.toJSDate(),
          status: 'CONFIRMED',
          type: 'COACHING',
          title: MARKER + 'Cours collectif du mercredi',
          totalPrice: 18,
          seriesId: series.id,
        },
        select: { id: true },
      });
      await prisma.lesson.create({
        data: {
          reservationId: reservation.id,
          clubId,
          coachId: secondCoach.id,
          capacity: 6,
          lessonKind: 'COLLECTIVE',
          allowSelfEnroll: true,
          seriesId: series.id,
        },
      });
      lessonCount++;
    }

    // Inscriptions au niveau SÉRIE (couvrent toutes les occurrences futures d'un coup)
    const seriesStudents = pick(3, 3);
    const base = Date.now();
    for (let i = 0; i < seriesStudents.length; i++) {
      await prisma.lessonEnrollment.create({
        data: { seriesId: series.id, userId: seriesStudents[i], status: 'CONFIRMED', createdAt: new Date(base + i * 60000) },
      });
    }
    countEnroll(seriesStudents.length);
  }

  console.log(`✔ ${club.slug} : 2 coachs (dont ${linkedCoachEmail ? '1 lié à ' + linkedCoachEmail : 'aucun lié à un compte — staff@palova.fr introuvable'}), ${lessonCount} séances, ${enrollCount} inscriptions (${studentIds.length} membres actifs disponibles).`);
  console.log('Voir : /admin/planning (blocs "Cours"), /me/coach si connecté en staff@palova.fr, page publique de réservation.');
}

main().finally(() => prisma.$disconnect());
