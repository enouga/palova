import 'dotenv/config';
// Test de charge ponctuel : peuple un club avec N faux membres pour observer le
// comportement de /admin/members (liste non paginée) à grande échelle. Idempotent
// (ids déterministes `loadtest-user-N`) et réversible (`cleanup` supprime tout).
//
// Usage (dossier backend/) :
//   npx ts-node scripts/loadtest-members.ts seed 1000 [clubId]
//   npx ts-node scripts/loadtest-members.ts cleanup [clubId]
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const MALE_FIRST = ['Lucas','Hugo','Louis','Gabriel','Jules','Adam','Arthur','Nathan','Leo','Thomas','Maxime','Antoine','Paul','Nicolas','Pierre','Alexandre','Victor','Theo','Romain','Julien'];
const FEMALE_FIRST = ['Emma','Jade','Louise','Alice','Chloe','Lina','Lea','Manon','Camille','Sarah','Ines','Juliette','Charlotte','Clara','Anais','Marie','Julie','Laura','Pauline','Sophie'];
const LAST = ['Martin','Bernard','Dubois','Thomas','Robert','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel'];

const EMAIL_PREFIX = 'loadtest';
const ID_PREFIX = 'loadtest-user-';

async function seed(count: number, clubId: string) {
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { id: true, name: true } });
  if (!club) throw new Error(`Club ${clubId} introuvable`);

  const passwordHash = await bcrypt.hash('loadtest123', 10);

  const users = Array.from({ length: count }, (_, idx) => {
    const i = idx + 1;
    const male = i % 2 === 0;
    const first = (male ? MALE_FIRST : FEMALE_FIRST)[i % MALE_FIRST.length];
    const last = LAST[i % LAST.length];
    return {
      id: `${ID_PREFIX}${i}`,
      email: `${EMAIL_PREFIX}${i}@palova.fr`,
      password: passwordHash,
      firstName: first,
      lastName: `${last} ${i}`,
      sex: (male ? 'MALE' : 'FEMALE') as 'MALE' | 'FEMALE',
      emailVerified: true,
    };
  });

  console.log(`Club: ${club.name} (${club.id})`);
  console.log(`Création de ${users.length} utilisateurs...`);
  await prisma.user.createMany({ data: users, skipDuplicates: true });

  const memberships = users.map((u, idx) => ({
    id: `loadtest-member-${idx + 1}`,
    userId: u.id,
    clubId: club.id,
    status: 'ACTIVE' as const,
    isSubscriber: idx % 5 === 0,
    membershipNo: `LT${String(idx + 1).padStart(5, '0')}`,
  }));

  console.log(`Création de ${memberships.length} adhésions...`);
  await prisma.clubMembership.createMany({ data: memberships, skipDuplicates: true });

  const total = await prisma.clubMembership.count({ where: { clubId: club.id } });
  console.log(`OK — le club compte désormais ${total} membre(s) au total.`);
}

async function cleanup(clubId: string) {
  // onDelete: Cascade sur ClubMembership/ClubMember/etc. → supprimer les users suffit.
  const { count } = await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX }, id: { startsWith: ID_PREFIX } } });
  console.log(`${count} faux utilisateur(s) de test supprimé(s) (club ${clubId} et autres).`);
}

async function main() {
  const [, , cmd, arg1, arg2] = process.argv;
  if (cmd === 'seed') {
    const count = Number(arg1 ?? 1000);
    const clubId = arg2 ?? 'club-demo';
    await seed(count, clubId);
  } else if (cmd === 'cleanup') {
    const clubId = arg1 ?? 'club-demo';
    await cleanup(clubId);
  } else {
    console.log('Usage: ts-node scripts/loadtest-members.ts seed <count> [clubId] | cleanup [clubId]');
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
