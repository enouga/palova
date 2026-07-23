// Seed de données de démo pour tester la page /decouvrir (parties + tournois + clubs, à
// l'échelle nationale). Crée 9 nouveaux clubs répartis dans toute la France (+ enrichit
// club-demo à Paris), chacun avec des tournois PUBLISHED de catégories/genres variés et des
// parties ouvertes (padel, PUBLIC/CONFIRMED) à des niveaux variés, dans les fenêtres lues par
// GET /api/tournaments/national (6 mois) et GET /api/open-matches/national (14 jours).
//
//   node scripts/seed-decouvrir.mjs         -> crée les données
//   node scripts/seed-decouvrir.mjs clean   -> supprime tout ce que ce script a créé
//
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const RES_TAG = 'DECOUVRIR-SEED-MATCH';
const TOUR_TAG = '[Découvrir seed]';
const CLUB_DEMO_ID = 'club-demo';

const CATEGORY_ORDER = ['P25', 'P50', 'P100', 'P250', 'P500', 'P1000', 'P1500', 'P2000'];
const GENDERS = ['MEN', 'WOMEN', 'MIXED'];
const MAX_TEAMS_CYCLE = [8, 16, 24, 4, null];
const ENTRY_FEE_CYCLE = [20, 25, 30, 35, null];
const LEVEL_BAND_CYCLE = [[null, null], [1, 3], [2, 4], [3, 5], [4, 6], [5, 7], [6, 8]];
const HOUR_CYCLE = [9, 11, 13, 17, 18, 19, 20];

const CITIES = [
  { key: 'lyon', id: 'seed-lyon', name: 'Padel Confluence Lyon', slug: 'padel-confluence-lyon',
    address: '8 quai Rambaud, 69002 Lyon', city: 'Lyon', department: 'Rhône', departmentCode: '69',
    lat: 45.7640, lng: 4.8357, accentColor: '#ff6b6b' },
  { key: 'marseille', id: 'seed-marseille', name: 'Marseille Padel Club', slug: 'marseille-padel-club',
    address: '110 avenue du Prado, 13008 Marseille', city: 'Marseille', department: 'Bouches-du-Rhône', departmentCode: '13',
    lat: 43.2965, lng: 5.3698, accentColor: '#38bdf8' },
  { key: 'toulouse', id: 'seed-toulouse', name: 'Padel Occitanie Toulouse', slug: 'padel-occitanie-toulouse',
    address: '22 route de Blagnac, 31200 Toulouse', city: 'Toulouse', department: 'Haute-Garonne', departmentCode: '31',
    lat: 43.6047, lng: 1.4442, accentColor: '#ffb648' },
  { key: 'bordeaux', id: 'seed-bordeaux', name: 'Bordeaux Padel Attitude', slug: 'bordeaux-padel-attitude',
    address: '5 quai de Paludate, 33800 Bordeaux', city: 'Bordeaux', department: 'Gironde', departmentCode: '33',
    lat: 44.8378, lng: -0.5792, accentColor: '#7c5cff' },
  { key: 'lille', id: 'seed-lille', name: 'Padel Club Lille Métropole', slug: 'padel-lille-metropole',
    address: '40 rue de Wazemmes, 59000 Lille', city: 'Lille', department: 'Nord', departmentCode: '59',
    lat: 50.6292, lng: 3.0573, accentColor: '#29c7ac' },
  { key: 'nantes', id: 'seed-nantes', name: 'Nantes Padel Nation', slug: 'nantes-padel-nation',
    address: '17 boulevard de la Prairie-au-Duc, 44200 Nantes', city: 'Nantes', department: 'Loire-Atlantique', departmentCode: '44',
    lat: 47.2184, lng: -1.5536, accentColor: '#5e93da' },
  { key: 'strasbourg', id: 'seed-strasbourg', name: 'Padel Strasbourg Rhénan', slug: 'padel-strasbourg-rhenan',
    address: '3 rue du Rhin Napoléon, 67000 Strasbourg', city: 'Strasbourg', department: 'Bas-Rhin', departmentCode: '67',
    lat: 48.5734, lng: 7.7521, accentColor: '#f6a13a' },
  { key: 'nice', id: 'seed-nice', name: 'Padel Riviera Nice', slug: 'padel-riviera-nice',
    address: '25 promenade des Anglais, 06000 Nice', city: 'Nice', department: 'Alpes-Maritimes', departmentCode: '06',
    lat: 43.7102, lng: 7.2620, accentColor: '#ff8fb1' },
  { key: 'rennes', id: 'seed-rennes', name: 'Rennes Padel Breizh', slug: 'rennes-padel-breizh',
    address: '12 rue de Redon, 35000 Rennes', city: 'Rennes', department: 'Ille-et-Vilaine', departmentCode: '35',
    lat: 48.1173, lng: -1.6778, accentColor: '#4fd1c5' },
];

const MALES = [
  ['Thomas', 'Girard'], ['Nicolas', 'Perrin'], ['Julien', 'Fontaine'], ['Antoine', 'Rousseau'],
  ['Maxime', 'Lambert'], ['Alexandre', 'Faure'], ['Romain', 'Blanchard'], ['Baptiste', 'Chevalier'],
  ['Kevin', 'Marchand'], ['Florian', 'Robin'], ['Mathieu', 'Gauthier'], ['Guillaume', 'Renard'],
  ['Sebastien', 'Leclerc'], ['Vincent', 'Barbier'], ['Damien', 'Noel'],
];
const FEMALES = [
  ['Camille', 'Dubois'], ['Lea', 'Fournier'], ['Manon', 'Legrand'], ['Chloe', 'Simon'],
  ['Sarah', 'Michel'], ['Julie', 'Roux'], ['Pauline', 'Vidal'], ['Emma', 'Caron'],
  ['Marion', 'Bertrand'], ['Charlotte', 'Fabre'], ['Laura', 'Guerin'], ['Oceane', 'Muller'],
  ['Ines', 'Lemoine'], ['Clara', 'Dumas'], ['Melanie', 'Aubert'],
];

const inDays = (d, h, m = 0) => { const t = new Date(); t.setDate(t.getDate() + d); t.setHours(h, m, 0, 0); return t; };
const money = (n) => n.toFixed(2);

async function ensurePlayers() {
  const hashed = await bcrypt.hash('password123', 10);
  const males = [];
  const females = [];
  for (let i = 0; i < MALES.length; i++) {
    const [firstName, lastName] = MALES[i];
    const email = `joueur.seed.m${i + 1}@palova.fr`;
    const u = await prisma.user.upsert({
      where: { email },
      update: { emailVerified: true, sex: 'MALE' },
      create: { email, password: hashed, firstName, lastName, sex: 'MALE', phone: `+336${(10000000 + i).toString().slice(-8)}`, emailVerified: true },
    });
    males.push(u);
  }
  for (let i = 0; i < FEMALES.length; i++) {
    const [firstName, lastName] = FEMALES[i];
    const email = `joueur.seed.f${i + 1}@palova.fr`;
    const u = await prisma.user.upsert({
      where: { email },
      update: { emailVerified: true, sex: 'FEMALE' },
      create: { email, password: hashed, firstName, lastName, sex: 'FEMALE', phone: `+336${(20000000 + i).toString().slice(-8)}`, emailVerified: true },
    });
    females.push(u);
  }
  return { males, females };
}

async function ensureClub(spec) {
  const club = await prisma.club.upsert({
    where: { id: spec.id },
    update: {
      status: 'ACTIVE', listedInDirectory: true, listTournamentsNationally: true, listOpenMatchesNationally: true,
      department: spec.department, departmentCode: spec.departmentCode, latitude: spec.lat, longitude: spec.lng,
    },
    create: {
      id: spec.id, slug: spec.slug, name: spec.name, address: spec.address, city: spec.city, country: 'FR',
      timezone: 'Europe/Paris', accentColor: spec.accentColor, defaultThemeMode: 'daylight',
      logoUrl: `https://dummyimage.com/160x160/111/fff&text=${encodeURIComponent(spec.city.slice(0, 2).toUpperCase())}`,
      department: spec.department, departmentCode: spec.departmentCode, latitude: spec.lat, longitude: spec.lng,
      listedInDirectory: true, listTournamentsNationally: true, listOpenMatchesNationally: true,
    },
  });
  const padel = await prisma.sport.findUniqueOrThrow({ where: { key: 'padel' } });
  const clubSport = await prisma.clubSport.upsert({
    where: { clubId_sportId: { clubId: club.id, sportId: padel.id } },
    update: {},
    create: { clubId: club.id, sportId: padel.id },
  });
  const resources = [];
  const prices = [22, 26, 24];
  for (let i = 0; i < 3; i++) {
    const rid = `${spec.id}-court-${i + 1}`;
    const r = await prisma.resource.upsert({
      where: { id: rid },
      update: {},
      create: {
        id: rid, clubId: club.id, clubSportId: clubSport.id, name: `Terrain ${i + 1}`,
        attributes: { coverage: i % 2 === 0 ? 'indoor' : 'outdoor', format: 'double', lighting: true },
        price: prices[i],
      },
    });
    resources.push(r);
  }
  return { club, clubSport, resources };
}

async function ensureMembership(userId, clubId) {
  await prisma.clubMembership.upsert({
    where: { userId_clubId: { userId, clubId } },
    update: { status: 'ACTIVE' },
    create: { userId, clubId, status: 'ACTIVE' },
  });
}

function pairFrom(pool, seed, i) {
  const offset = (seed * 3) % pool.length;
  const a = pool[(offset + i * 2) % pool.length];
  const b = pool[(offset + i * 2 + 1) % pool.length];
  return [a, b];
}

async function createTournaments(club, clubSportId, cityKey, cityIdx, males, females) {
  let count = 0, regCount = 0;
  for (let i = 0; i < 5; i++) {
    const category = CATEGORY_ORDER[(cityIdx * 2 + i) % CATEGORY_ORDER.length];
    const gender = GENDERS[i % GENDERS.length];
    const maxTeams = MAX_TEAMS_CYCLE[i % MAX_TEAMS_CYCLE.length];
    const entryFee = ENTRY_FEE_CYCLE[i % ENTRY_FEE_CYCLE.length];
    const startOffset = 5 + i * 15 + cityIdx * 2;
    const startTime = inDays(startOffset, 9);
    const endTime = inDays(startOffset, 19);
    const registrationDeadline = inDays(startOffset - 3, 23, 59);
    const genderLabel = gender === 'WOMEN' ? 'Dames' : gender === 'MIXED' ? 'Mixte' : 'Messieurs';
    const t = await prisma.tournament.create({
      data: {
        clubId: club.id, clubSportId, name: `${club.city ?? cityKey} Open ${category} — ${genderLabel}`,
        category, gender, openToWomen: true,
        description: `${TOUR_TAG} Tournoi de démonstration ${category} (${genderLabel}) pour tester la page Où jouer.`,
        startTime, endTime, registrationDeadline,
        maxTeams: maxTeams ?? undefined, entryFee: entryFee != null ? money(entryFee) : undefined,
        status: 'PUBLISHED',
      },
    });
    count++;

    const capacity = maxTeams ?? 99;
    const regsToCreate = [3, 4, 5, 4, 6][i % 5];
    for (let r = 0; r < regsToCreate; r++) {
      let captain, partner;
      if (gender === 'MEN') [captain, partner] = pairFrom(males, cityIdx + i, r);
      else if (gender === 'WOMEN') [captain, partner] = pairFrom(females, cityIdx + i, r);
      else { captain = males[(cityIdx + i + r) % males.length]; partner = females[(cityIdx + i + r) % females.length]; }
      await ensureMembership(captain.id, club.id);
      await ensureMembership(partner.id, club.id);
      await prisma.tournamentRegistration.create({
        data: {
          tournamentId: t.id, captainUserId: captain.id, partnerUserId: partner.id,
          status: r < capacity ? 'CONFIRMED' : 'WAITLISTED',
        },
      });
      regCount++;
    }
  }
  return { count, regCount };
}

async function createOpenMatches(club, resources, cityIdx, males, females) {
  const allPool = [...males, ...females];
  const sizes = [2, 3, 1, 2, 4, 3];
  let count = 0;
  for (let i = 0; i < sizes.length; i++) {
    const resource = resources[i % resources.length];
    const day = 1 + ((i * 2 + cityIdx) % 12);
    const hour = HOUR_CYCLE[(i + cityIdx) % HOUR_CYCLE.length];
    const start = inDays(day, hour);
    const end = new Date(start.getTime() + 90 * 60_000);
    const n = sizes[i];
    const seedOffset = (cityIdx * 5 + i) % allPool.length;
    const picks = Array.from({ length: n }, (_, k) => allPool[(seedOffset + k) % allPool.length]);
    for (const p of picks) await ensureMembership(p.id, club.id);
    const half = Math.ceil(n / 2);
    const t1 = picks.slice(0, half);
    const t2 = picks.slice(half);
    const [lvlMin, lvlMax] = LEVEL_BAND_CYCLE[(cityIdx + i) % LEVEL_BAND_CYCLE.length];
    const price = Number(resource.price);
    const share = money(price / 4);

    await prisma.reservation.create({
      data: {
        resourceId: resource.id, userId: picks[0].id, startTime: start, endTime: end,
        status: 'CONFIRMED', type: 'COURT', visibility: 'PUBLIC', competitive: true,
        targetLevelMin: lvlMin, targetLevelMax: lvlMax,
        totalPrice: money(price), title: RES_TAG,
        participants: {
          create: picks.map((u, idx) => ({
            userId: u.id, isOrganizer: idx === 0, share,
            team: t1.includes(u) ? 1 : 2, slot: (t1.includes(u) ? t1 : t2).indexOf(u),
          })),
        },
      },
    });
    count++;
  }
  return count;
}

async function create() {
  const already = await prisma.club.count({ where: { id: { startsWith: 'seed-' } } });
  if (already > 0) {
    console.log(`${already} club(s) "seed-*" déjà présents — lancez d'abord "node scripts/seed-decouvrir.mjs clean".`);
    return;
  }

  const { males, females } = await ensurePlayers();
  console.log(`OK — ${males.length + females.length} joueurs de test prêts.`);

  let totalTournaments = 0, totalRegs = 0, totalMatches = 0;

  // Enrichit club-demo (Paris) avec le même département/coordonnées pour la distance/facettes.
  const demo = await prisma.club.update({
    where: { id: CLUB_DEMO_ID },
    data: { department: 'Paris', departmentCode: '75', latitude: 48.8566, longitude: 2.3522 },
  });
  const demoClubSport = await prisma.clubSport.findFirstOrThrow({ where: { clubId: demo.id, sport: { key: 'padel' } } });
  // Seules court-1..court-3 sont en format double (court-4/5 sont single, capacité 2) —
  // on les exclut de la rotation des parties ouvertes pour ne pas dépasser leur capacité.
  const demoResources = (await prisma.resource.findMany({ where: { clubId: demo.id }, orderBy: { id: 'asc' } }))
    .filter((r) => (r.attributes)?.format !== 'single')
    .slice(0, 3);
  {
    const { count, regCount } = await createTournaments(demo, demoClubSport.id, 'Paris', 0, males, females);
    const mCount = await createOpenMatches(demo, demoResources, 0, males, females);
    totalTournaments += count; totalRegs += regCount; totalMatches += mCount;
    console.log(`Paris (club-demo) : ${count} tournois (${regCount} inscriptions), ${mCount} parties ouvertes.`);
  }

  for (let i = 0; i < CITIES.length; i++) {
    const spec = CITIES[i];
    const { club, clubSport, resources } = await ensureClub(spec);
    const { count, regCount } = await createTournaments(club, clubSport.id, spec.key, i + 1, males, females);
    const mCount = await createOpenMatches(club, resources, i + 1, males, females);
    totalTournaments += count; totalRegs += regCount; totalMatches += mCount;
    console.log(`${spec.city} : ${count} tournois (${regCount} inscriptions), ${mCount} parties ouvertes.`);
  }

  console.log(`\nTerminé — ${CITIES.length + 1} clubs, ${totalTournaments} tournois (${totalRegs} inscriptions), ${totalMatches} parties ouvertes.`);
  console.log('Testez : GET /api/tournaments/national et /api/open-matches/national, puis /decouvrir côté front.');
}

async function clean() {
  // 1) Contenu taggé sur club-demo (qui préexiste, on ne touche qu'à ce qu'on a ajouté).
  const demoResources = await prisma.resource.findMany({ where: { clubId: CLUB_DEMO_ID }, select: { id: true } });
  const demoResourceIds = demoResources.map((r) => r.id);
  const demoRes = await prisma.reservation.deleteMany({ where: { resourceId: { in: demoResourceIds }, title: RES_TAG } });
  const demoTours = await prisma.tournament.deleteMany({ where: { clubId: CLUB_DEMO_ID, description: { startsWith: TOUR_TAG } } });

  // 2) Clubs entièrement créés par ce script.
  const clubs = await prisma.club.findMany({ where: { id: { startsWith: 'seed-' } }, select: { id: true } });
  const clubIds = clubs.map((c) => c.id);
  let seedRes = { count: 0 }, seedTours = { count: 0 };
  if (clubIds.length) {
    const resources = await prisma.resource.findMany({ where: { clubId: { in: clubIds } }, select: { id: true } });
    const resourceIds = resources.map((r) => r.id);
    seedRes = resourceIds.length ? await prisma.reservation.deleteMany({ where: { resourceId: { in: resourceIds } } }) : { count: 0 };
    seedTours = await prisma.tournament.deleteMany({ where: { clubId: { in: clubIds } } });
    await prisma.club.deleteMany({ where: { id: { in: clubIds } } }); // cascade clubSport/resource/membership
  }

  console.log(`Nettoyé — club-demo : ${demoRes.count} résas + ${demoTours.count} tournois taggés.`);
  console.log(`Nettoyé — ${clubIds.length} clubs seed-* supprimés (${seedRes.count} résas, ${seedTours.count} tournois).`);
  console.log('Les comptes joueurs de test (joueur.seed.*@palova.fr) sont conservés (réutilisables).');
}

const mode = process.argv[2];
(mode === 'clean' ? clean() : create())
  .catch((e) => { console.error('ERR', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
