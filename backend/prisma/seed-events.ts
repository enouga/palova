/**
 * Seed d'events / animations de test pour TOUS les clubs existants.
 *
 * Pour chaque club en base, crée un éventail d'events couvrant les cas UI :
 *  - complet + liste d'attente, clôture < 48 h (chip coral)   → /events + jauge
 *  - ouvert aux non-membres (memberOnly=false)
 *  - sans capacité (illimité)
 *  - partiellement rempli
 *  - passé, brouillon (DRAFT, non public), annulé (CANCELLED)
 * Les inscriptions sont tirées des membres ACTIFS du club (adapté à l'effectif :
 * un club avec peu de membres reçoit moins d'inscrits, sans planter).
 *
 * Rejouable : supprime d'abord les events de CE club portant les noms du jeu de
 * seed (cascade sur les inscriptions), puis les recrée. Les events créés à la main
 * (autres noms) ne sont jamais touchés.
 *
 * Lancement (dossier backend/) :  npx ts-node prisma/seed-events.ts
 *                            ou :  npm run db:seed:events
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

type Kind = 'MELEE' | 'STAGE' | 'SOIREE' | 'INITIATION' | 'AUTRE';
type EStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
type RStatus = 'CONFIRMED' | 'WAITLISTED';

// Gabarits d'events (appliqués à chaque club).
// startInDays négatif = event passé. deadlineInDays = clôture des inscriptions (jours depuis maintenant).
// confirmed/wait = nb d'inscrits CONFIRMÉS / en liste d'attente souhaités (plafonnés à l'effectif du club).
const EVENTS: Array<{
  name: string; kind: Kind; status: EStatus;
  startInDays: number; deadlineInDays: number;
  capacity: number | null; price: number | null; memberOnly: boolean;
  confirmed: number; wait: number; description: string;
}> = [
  {
    name: 'Mêlée du mardi soir', kind: 'MELEE', status: 'PUBLISHED',
    startInDays: 5, deadlineInDays: 1, capacity: 16, price: 8, memberOnly: true,
    confirmed: 16, wait: 4,
    description: 'Mêlée conviviale (americano) : on tourne les partenaires à chaque manche. Niveau tous publics.',
  },
  {
    name: 'Americano mixte du week-end', kind: 'MELEE', status: 'PUBLISHED',
    startInDays: 12, deadlineInDays: 9, capacity: 24, price: 10, memberOnly: false,
    confirmed: 14, wait: 0,
    description: 'Format americano mixte ouvert aux non-membres. Lots pour les vainqueurs, pot de l’amitié offert.',
  },
  {
    name: 'Stage perfectionnement coup droit', kind: 'STAGE', status: 'PUBLISHED',
    startInDays: 18, deadlineInDays: 14, capacity: 8, price: 45, memberOnly: true,
    confirmed: 5, wait: 0,
    description: 'Stage de 3 h avec un moniteur diplômé : volée, bandeja et sortie de vitre. Petit groupe.',
  },
  {
    name: 'Soirée raclette du club', kind: 'SOIREE', status: 'PUBLISHED',
    startInDays: 9, deadlineInDays: 7, capacity: null, price: 15, memberOnly: true,
    confirmed: 22, wait: 0,
    description: 'La soirée conviviale de l’hiver : raclette à volonté après quelques parties. Inscription libre.',
  },
  {
    name: 'Portes ouvertes découverte padel', kind: 'INITIATION', status: 'PUBLISHED',
    startInDays: 7, deadlineInDays: 6, capacity: 20, price: 0, memberOnly: false,
    confirmed: 6, wait: 0,
    description: 'Vous ne connaissez pas le padel ? Venez essayer gratuitement, raquettes et balles fournies.',
  },
  {
    name: 'Mêlée de fin d’année (passée)', kind: 'MELEE', status: 'PUBLISHED',
    startInDays: -10, deadlineInDays: -12, capacity: 16, price: 8, memberOnly: true,
    confirmed: 16, wait: 0,
    description: 'Dernière mêlée de la saison — édition complète. (Event passé, pour tester l’historique.)',
  },
  {
    name: 'Tournoi interne (brouillon)', kind: 'AUTRE', status: 'DRAFT',
    startInDays: 25, deadlineInDays: 20, capacity: 12, price: 0, memberOnly: true,
    confirmed: 0, wait: 0,
    description: 'En préparation — non publié. Sert à tester l’affichage admin des brouillons.',
  },
  {
    name: 'Soirée annulée', kind: 'SOIREE', status: 'CANCELLED',
    startInDays: 4, deadlineInDays: 1, capacity: 30, price: 12, memberOnly: false,
    confirmed: 0, wait: 0,
    description: 'Soirée annulée faute de participants — pour tester l’état CANCELLED.',
  },
];

const SEEDED_NAMES = EVENTS.map((e) => e.name);

function daysFromNow(d: number): Date {
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000);
}

async function main() {
  const clubs = await prisma.club.findMany({ select: { id: true, slug: true, name: true } });
  if (clubs.length === 0) {
    console.log('Aucun club en base — lance d’abord le seed (npm run db:seed:demo).');
    return;
  }

  let totalEvents = 0;
  let totalRegs = 0;

  for (const club of clubs) {
    // Membres actifs du club, ordre stable (= ordre d'inscription) pour un seed rejouable.
    const memberships = await prisma.clubMembership.findMany({
      where: { clubId: club.id, status: 'ACTIVE' },
      select: { userId: true },
      orderBy: { createdAt: 'asc' },
    });
    const memberIds = memberships.map((m) => m.userId);

    // Rejouable : on efface les events de CE club portant nos noms (cascade sur inscriptions).
    await prisma.clubEvent.deleteMany({ where: { clubId: club.id, name: { in: SEEDED_NAMES } } });

    let cursor = 0; // rotation des membres d'un event à l'autre → participants variés
    let clubEvents = 0;
    let clubRegs = 0;

    for (const def of EVENTS) {
      const start = daysFromNow(def.startInDays);
      const event = await prisma.clubEvent.create({
        data: {
          clubId: club.id,
          name: def.name,
          kind: def.kind,
          description: def.description,
          startTime: start,
          endTime: new Date(start.getTime() + 3 * 60 * 60 * 1000),
          registrationDeadline: daysFromNow(def.deadlineInDays),
          capacity: def.capacity,
          price: def.price,
          memberOnly: def.memberOnly,
          status: def.status,
        },
      });
      clubEvents++;
      totalEvents++;

      // Inscriptions : on plafonne au nombre de membres disponibles dans le club.
      const want = def.confirmed + def.wait;
      if (want > 0 && memberIds.length > 0) {
        const taken = Math.min(want, memberIds.length);
        const confirmedCount = Math.min(def.confirmed, taken);
        const base = Date.now() - taken * 60000; // inscriptions échelonnées → ordre = liste d'attente

        for (let i = 0; i < taken; i++) {
          const userId = memberIds[(cursor + i) % memberIds.length];
          const status: RStatus = i < confirmedCount ? 'CONFIRMED' : 'WAITLISTED';
          await prisma.eventRegistration.create({
            data: {
              eventId: event.id,
              userId,
              status,
              createdAt: new Date(base + i * 60000),
            },
          });
          clubRegs++;
          totalRegs++;
        }
        cursor = (cursor + taken) % memberIds.length;
      }
    }

    console.log(`✔ ${club.slug.padEnd(28)} : ${clubEvents} events, ${clubRegs} inscriptions (${memberIds.length} membres actifs)`);
  }

  console.log(`\nSeed events terminé : ${clubs.length} clubs, ${totalEvents} events, ${totalRegs} inscriptions.`);
  console.log('Voir : http://<slug>.localhost:3000/events  et  /admin/events (brouillon visible côté admin).');
}

main().finally(() => prisma.$disconnect());
