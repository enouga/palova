import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { seedDefaultOffers, seedDefaultSubscriptionPlans, DEFAULT_PACKAGE_OFFERS, DEFAULT_SUBSCRIPTION_PLANS } from './seed-offers';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Catalogue de sports géré par la plateforme.
// Matériaux de surface disponibles pour le padel (utilisés dans Resource.attributes.surface).
const PADEL_SURFACES = ['Béton poreux', 'Résine', 'Gazon synthétique'] as const;
// Matériaux de surface disponibles pour le tennis.
const TENNIS_SURFACES = [
  'Béton poreux', 'Dalles plastiques', 'Enrobé poreux', 'Gazon naturel', 'Gazon synthétique',
  'Moquette', 'Parquet', 'Résine', 'Sable',
  'Tapis caoutchouc / Revêtement caoutchouc', 'Tapis synthétique / Revêtement synthétique',
  'Terre artificielle', 'Terre battue traditionnelle',
] as const;

const SPORTS = [
  { key: 'padel',      name: 'Padel',          resourceNoun: 'terrain', defaultSlotStepMin: 30, defaultDurationsMin: [90], icon: '🎾', surfaces: [...PADEL_SURFACES] },
  { key: 'tennis',     name: 'Tennis',         resourceNoun: 'court',   defaultSlotStepMin: 30, defaultDurationsMin: [60, 90, 120], icon: '🎾', surfaces: [...TENNIS_SURFACES], hasLighting: true },
  { key: 'pickleball', name: 'Pickleball',     resourceNoun: 'court',   defaultSlotStepMin: 30, defaultDurationsMin: [60, 90],      icon: '🥒' },
  { key: 'squash',     name: 'Squash',         resourceNoun: 'court',   defaultSlotStepMin: 30, defaultDurationsMin: [45, 60],      icon: '🟦' },
  { key: 'badminton',  name: 'Badminton',      resourceNoun: 'terrain', defaultSlotStepMin: 30, defaultDurationsMin: [60, 90],      icon: '🏸' },
  { key: 'pingpong',   name: 'Tennis de table', resourceNoun: 'table',  defaultSlotStepMin: 30, defaultDurationsMin: [30, 60],      icon: '🏓' },
];

async function main() {
  // 1. Catalogue de sports (idempotent)
  for (const s of SPORTS) {
    await prisma.sport.upsert({
      where: { key: s.key },
      update: { name: s.name, resourceNoun: s.resourceNoun, defaultSlotStepMin: s.defaultSlotStepMin, defaultDurationsMin: s.defaultDurationsMin, icon: s.icon, published: true, ...(s.surfaces ? { surfaces: s.surfaces } : {}), ...('hasLighting' in s ? { hasLighting: (s as any).hasLighting } : {}) },
      create: { ...s, published: true },
    });
  }
  const padel = await prisma.sport.findUniqueOrThrow({ where: { key: 'padel' } });

  // 2. Club de démo
  const club = await prisma.club.upsert({
    where: { id: 'club-demo' },
    // Branding Palova autoritaire pour la démo (bleu + mode clair/paper).
    update: { accentColor: '#5e93da', defaultThemeMode: 'daylight', listTournamentsNationally: true },
    create: {
      id: 'club-demo',
      slug: 'padel-arena-paris',
      name: 'Padel Arena Paris',
      address: '12 rue du Padel, 75011 Paris',
      city: 'Paris',
      country: 'FR',
      timezone: 'Europe/Paris',
      accentColor: '#5e93da',
      defaultThemeMode: 'daylight',
      listTournamentsNationally: true,
    },
  });

  // 3. Le club active le padel
  const clubSport = await prisma.clubSport.upsert({
    where: { clubId_sportId: { clubId: club.id, sportId: padel.id } },
    update: {},
    create: { clubId: club.id, sportId: padel.id },
  });

  // 4. Ressources (anciens "terrains")
  // coverage: 'indoor'|'outdoor'|'semi' ; surface = matériau (doit figurer dans Sport.surfaces)
  const resources = [
    { id: 'court-1', name: 'Terrain 1', attributes: { coverage: 'indoor',  surface: PADEL_SURFACES[0], format: 'double' }, price: 25 },
    { id: 'court-2', name: 'Terrain 2', attributes: { coverage: 'indoor',  surface: PADEL_SURFACES[0], format: 'double' }, price: 25 },
    { id: 'court-3', name: 'Terrain 3', attributes: { coverage: 'outdoor', surface: PADEL_SURFACES[2], format: 'double' }, price: 20 },
    { id: 'court-4', name: 'Terrain 4', attributes: { coverage: 'indoor',  surface: PADEL_SURFACES[0], format: 'single' }, price: 18 },
    { id: 'court-5', name: 'Terrain 5', attributes: { coverage: 'outdoor', surface: PADEL_SURFACES[2], format: 'single' }, price: 16 },
  ];
  for (const r of resources) {
    await prisma.resource.upsert({
      where: { id: r.id },
      update: { name: r.name, attributes: r.attributes, price: r.price },
      create: { id: r.id, clubId: club.id, clubSportId: clubSport.id, name: r.name, attributes: r.attributes, price: r.price },
    });
  }

  // 4b. Annonces & sponsors de démo (idempotent : on repart de zéro pour le club démo)
  await prisma.announcement.deleteMany({ where: { clubId: club.id } });
  await prisma.announcement.createMany({ data: [
    { clubId: club.id, title: 'Tournoi interne samedi', body: 'Inscriptions ouvertes au club-house. Niveau loisir, lots à gagner !', pinned: true },
    { clubId: club.id, title: 'Nouveaux créneaux le matin', body: 'Le club ouvre désormais dès 8h en semaine.' },
  ] });
  await prisma.sponsor.deleteMany({ where: { clubId: club.id } });
  await prisma.sponsor.createMany({ data: [
    { clubId: club.id, name: 'Babolat', logoUrl: 'https://dummyimage.com/120x44/111/fff&text=Babolat', sortOrder: 1 },
    { clubId: club.id, name: 'Decathlon', logoUrl: 'https://dummyimage.com/120x44/111/fff&text=Decathlon', sortOrder: 2 },
  ] });

  // 4c. Offres prépayées par défaut (cartes Padel/Squash) — idempotent.
  await seedDefaultOffers(prisma, club.id);
  await seedDefaultSubscriptionPlans(prisma, club.id);

  // 5. Comptes de démo — un par rôle (mot de passe commun : password123)
  const hashedPassword = await bcrypt.hash('password123', 10);

  // `role` = rôle staff (ClubMember). role = null → pas de back-office (simple joueur CLIENT).
  // Tous les comptes de démo reçoivent en plus une adhésion joueur (ClubMembership) au club :
  // les sections « compte » de /me/profile (portefeuille, méthodes de paiement, licence) sont
  // gardées par `slug && club && membership`, donc invisibles tant qu'on n'a pas d'adhésion —
  // on en crée une dès le seed pour les voir sans avoir à réserver d'abord.
  const demoAccounts: Array<{ email: string; firstName: string; lastName: string; role: 'OWNER' | 'ADMIN' | 'STAFF' | null; isSubscriber?: boolean; membershipNo?: string }> = [
    { email: 'test@palova.fr',    firstName: 'Jean',   lastName: 'Dupont',   role: 'OWNER', isSubscriber: true, membershipNo: 'PAR1001' }, // compte historique
    { email: 'owner@palova.fr',   firstName: 'Olivia', lastName: 'Martin',   role: 'OWNER' },
    { email: 'admin@palova.fr',   firstName: 'Adam',   lastName: 'Bernard',  role: 'ADMIN' },
    { email: 'staff@palova.fr',   firstName: 'Sarah',  lastName: 'Petit',    role: 'STAFF' },
    { email: 'joueur@palova.fr',  firstName: 'Lucas',  lastName: 'Moreau',   role: null,    membershipNo: 'PAR1002' },
  ];

  let testUserId = '';
  for (const acc of demoAccounts) {
    const u = await prisma.user.upsert({
      where: { email: acc.email },
      update: { emailVerified: true },
      create: { email: acc.email, password: hashedPassword, firstName: acc.firstName, lastName: acc.lastName, emailVerified: true },
    });
    if (acc.email === 'test@palova.fr') testUserId = u.id;
    if (acc.role) {
      await prisma.clubMember.upsert({
        where: { userId_clubId: { userId: u.id, clubId: club.id } },
        update: { role: acc.role },
        create: { userId: u.id, clubId: club.id, role: acc.role },
      });
    }
    // Adhésion joueur (ClubMembership) — distincte du rôle staff (ClubMember).
    await prisma.clubMembership.upsert({
      where: { userId_clubId: { userId: u.id, clubId: club.id } },
      update: { status: 'ACTIVE', isSubscriber: acc.isSubscriber ?? false, membershipNo: acc.membershipNo ?? null },
      create: { userId: u.id, clubId: club.id, status: 'ACTIVE', isSubscriber: acc.isSubscriber ?? false, membershipNo: acc.membershipNo ?? null },
    });
  }

  // 5a. Portefeuille de démo pour le compte historique (test@palova.fr) : un abonnement
  // Padel actif + un porte-monnaie partiellement consommé, pour que la section « Portefeuille »
  // de /me/profile affiche du contenu réel dès le seed. Idempotent (find-or-create, jamais de
  // doublon ni de suppression — un MemberPackage vendu est référencé par d'éventuels Payment).
  if (testUserId) {
    const DAY = 24 * 60 * 60 * 1000;
    const now = new Date();

    const walletTpl = await prisma.packageTemplate.findFirst({
      where: { clubId: club.id, name: DEFAULT_PACKAGE_OFFERS[0].name }, // « Carte Padel 10 parties » (WALLET)
    });
    if (walletTpl) {
      const existing = await prisma.memberPackage.findFirst({
        where: { clubId: club.id, userId: testUserId, templateId: walletTpl.id },
      });
      if (!existing) {
        await prisma.memberPackage.create({
          data: {
            clubId: club.id, userId: testUserId, templateId: walletTpl.id, kind: 'WALLET',
            amountTotal: walletTpl.walletAmount, amountRemaining: 104.5, // ~25,50 € déjà consommés
            purchasedAt: new Date(now.getTime() - 20 * DAY),
            expiresAt: new Date(now.getTime() + (walletTpl.validityDays ?? 180) * DAY),
          },
        });
      }
    }

    const padelPlan = await prisma.subscriptionPlan.findFirst({
      where: { clubId: club.id, name: DEFAULT_SUBSCRIPTION_PLANS[0].name }, // « Abonnement Padel — heures creuses »
    });
    if (padelPlan) {
      const existing = await prisma.subscription.findFirst({
        where: { clubId: club.id, userId: testUserId, planId: padelPlan.id, status: 'ACTIVE' },
      });
      if (!existing) {
        await prisma.subscription.create({
          data: {
            clubId: club.id, userId: testUserId, planId: padelPlan.id, status: 'ACTIVE',
            startedAt: new Date(now.getTime() - 30 * DAY),
            expiresAt: new Date(now.getTime() + 330 * DAY), // ~11 mois restants
            monthlyPriceSnapshot: padelPlan.monthlyPrice,
            sportKeys: padelPlan.sportKeys, offPeakOnly: padelPlan.offPeakOnly,
            benefit: padelPlan.benefit, discountPercent: padelPlan.discountPercent,
            dailyCap: padelPlan.dailyCap, weeklyCap: padelPlan.weeklyCap,
          },
        });
      }
    }
  }

  // 5b. Super-admin plateforme (idempotent). Mot de passe via env en prod, défaut dev.
  // En production, refuser le repli sur le mot de passe de dev (sécurité du compte le plus puissant).
  if (process.env.NODE_ENV === 'production' && !process.env.SUPERADMIN_PASSWORD) {
    throw new Error('SUPERADMIN_PASSWORD doit être défini pour seeder en production (compte super-admin).');
  }
  const superPassword = await bcrypt.hash(process.env.SUPERADMIN_PASSWORD ?? 'password123', 10);
  await prisma.user.upsert({
    where: { email: 'super@palova.fr' },
    update: { isSuperAdmin: true, password: superPassword, emailVerified: true },
    create: {
      email: 'super@palova.fr',
      password: superPassword,
      firstName: 'Super',
      lastName: 'Admin',
      isSuperAdmin: true,
      emailVerified: true,
    },
  });

  console.log('Seed terminé.');
}

main().finally(() => prisma.$disconnect());
