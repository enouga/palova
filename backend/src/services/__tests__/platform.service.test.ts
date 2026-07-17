import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { Prisma } from '@prisma/client';
import { PlatformService } from '../platform.service';

jest.mock('../geo.service', () => ({ ...jest.requireActual('../geo.service'), geocodeAddress: jest.fn() }));
import { geocodeAddress } from '../geo.service';
const geocodeMock = geocodeAddress as jest.Mock;

jest.mock('../siret.service', () => ({
  siretIsValidFormat: jest.fn(),
  checkSiret: jest.fn(),
}));
import { siretIsValidFormat, checkSiret } from '../siret.service';
const siretValidMock = siretIsValidFormat as jest.Mock;
const checkSiretMock = checkSiret as jest.Mock;

describe('PlatformService.getStats', () => {
  const service = new PlatformService();

  it('agrège les compteurs globaux', async () => {
    prismaMock.club.count
      .mockResolvedValueOnce(5)   // total
      .mockResolvedValueOnce(4)   // active
      .mockResolvedValueOnce(1);  // suspended
    prismaMock.user.count.mockResolvedValue(120 as any);
    prismaMock.reservation.count.mockResolvedValue(300 as any);
    prismaMock.tournament.count.mockResolvedValue(8 as any);
    prismaMock.club.findMany.mockResolvedValue([] as any); // clubs billing

    const stats = await service.getStats();
    expect(stats).toEqual({
      clubs: { total: 5, active: 4, suspended: 1 },
      users: 120,
      reservations: 300,
      tournaments: 8,
      billing: { mrrCents: 0, byTier: [0, 0, 0, 0, 0], toRegularize: 0, pastDue: 0 },
    });
  });

  it('agrège MRR, paliers, à-régulariser et impayés', async () => {
    prismaMock.club.count.mockResolvedValue(0 as any);
    prismaMock.user.count.mockResolvedValue(0 as any);
    prismaMock.reservation.count.mockResolvedValue(0 as any);
    prismaMock.tournament.count.mockResolvedValue(0 as any);
    prismaMock.club.findMany.mockResolvedValue([
      // actif t2 mensuel → 5900 au MRR
      { activeMemberCount: 200, billingExempt: false, platformSubscription: { status: 'active', tier: 2, interval: 'month' } },
      // actif t3 annuel → 101000/12 arrondi = 8417
      { activeMemberCount: 500, billingExempt: false, platformSubscription: { status: 'active', tier: 3, interval: 'year' } },
      // à régulariser (t1 sans abonnement)
      { activeMemberCount: 60, billingExempt: false, platformSubscription: null },
      // impayé (compte au MRR : l'abonnement vit encore)
      { activeMemberCount: 200, billingExempt: false, platformSubscription: { status: 'past_due', tier: 2, interval: 'month' } },
      // gratuit
      { activeMemberCount: 10, billingExempt: false, platformSubscription: null },
      // exonéré (gros club) — pas de relance
      { activeMemberCount: 900, billingExempt: true, platformSubscription: null },
    ] as any);

    const stats = await service.getStats();
    expect(stats.billing).toEqual({
      mrrCents: 5900 + Math.round(101000 / 12) + 5900,
      byTier: [1, 1, 2, 1, 1],
      toRegularize: 1,
      pastDue: 1,
    });
  });
});

describe('PlatformService.setBillingExempt', () => {
  const service = new PlatformService();

  it('valide et met à jour', async () => {
    prismaMock.club.update.mockResolvedValue({ id: 'c1', billingExempt: true } as any);
    const out = await service.setBillingExempt('c1', true);
    expect(out).toEqual({ id: 'c1', billingExempt: true });
  });

  it('rejette VALIDATION_ERROR si le flag n est pas booléen', async () => {
    await expect(service.setBillingExempt('c1', 'oui' as any)).rejects.toThrow('VALIDATION_ERROR');
  });

  it('rejette CLUB_NOT_FOUND (P2025)', async () => {
    prismaMock.club.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: 'x' }),
    );
    await expect(service.setBillingExempt('absent', true)).rejects.toThrow('CLUB_NOT_FOUND');
  });
});

describe('PlatformService.listClubs', () => {
  const service = new PlatformService();

  it('renvoie tous les clubs (tous statuts) avec gérants et compteurs', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      {
        id: 'club-demo', slug: 'padel-arena-paris', name: 'Padel Arena Paris',
        city: 'Paris', status: 'SUSPENDED', createdAt: new Date('2026-01-01'),
        members: [{ user: { id: 'u1', email: 'owner@palova.fr', firstName: 'O', lastName: 'M' } }],
        _count: { clubMemberships: 48, resources: 5 },
        slugAliases: [],
        activeMemberCount: 180, billingExempt: false, platformSubscription: null,
      },
    ] as any);

    const clubs = await service.listClubs();
    expect(prismaMock.club.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: 'desc' },
    }));
    expect(clubs[0]).toEqual({
      id: 'club-demo', slug: 'padel-arena-paris', name: 'Padel Arena Paris',
      city: 'Paris', status: 'SUSPENDED', createdAt: new Date('2026-01-01'),
      owners: [{ id: 'u1', email: 'owner@palova.fr', firstName: 'O', lastName: 'M' }],
      counts: { adherents: 48, resources: 5 },
      aliases: [],
      billing: {
        activeMembers: 180, observedTier: 2, state: 'TO_REGULARIZE',
        exempt: false, subscribedTier: null, subscription: null,
      },
    });
  });

  it('expose la subscription détaillée d un club abonné (live)', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      {
        id: 'club-2', slug: 'lyon', name: 'Lyon Padel', city: 'Lyon',
        status: 'ACTIVE', createdAt: new Date('2026-02-01'),
        members: [], _count: { clubMemberships: 300, resources: 8 }, slugAliases: [],
        activeMemberCount: 300, billingExempt: false,
        platformSubscription: {
          status: 'active', tier: 2, interval: 'month',
          currentPeriodEnd: new Date('2026-08-01'), cancelAtPeriodEnd: false,
        },
      },
    ] as any);
    const clubs = await service.listClubs();
    expect(clubs[0].billing.subscribedTier).toBe(2);
    expect(clubs[0].billing.subscription).toEqual({
      status: 'active', tier: 2, interval: 'month',
      currentPeriodEnd: new Date('2026-08-01'), cancelAtPeriodEnd: false,
    });
  });
});

describe('PlatformService.getClubDetail', () => {
  const service = new PlatformService();

  it('rejette CLUB_NOT_FOUND si le club n existe pas', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(service.getClubDetail('absent')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('renvoie identité, billing, historique et activité (12 mois bucketés)', async () => {
    const now = new Date();
    prismaMock.club.findUnique.mockResolvedValue({
      id: 'club-1', slug: 'arena', name: 'Arena', city: 'Paris', address: '1 rue X',
      timezone: 'Europe/Paris', status: 'ACTIVE', createdAt: new Date('2026-01-01'),
      siret: '44306184100047', siretLegalName: 'ARENA PADEL SAS', siretVerifiedAt: new Date('2026-01-02'),
      billingExempt: false, activeMemberCount: 200, activeMemberCountAt: new Date('2026-07-01'),
      members: [{ user: { id: 'u1', email: 'o@x.fr', firstName: 'O', lastName: 'M' } }],
      slugAliases: [{ slug: 'ancien-arena' }],
      platformSubscription: {
        status: 'active', tier: 2, interval: 'month',
        currentPeriodEnd: new Date('2026-08-01'), cancelAtPeriodEnd: false,
      },
      _count: { clubMemberships: 48, resources: 5, tournaments: 3, clubEvents: 2 },
    } as any);
    prismaMock.clubMemberSnapshot.findMany.mockResolvedValue([
      { month: '2026-06', activeMembers: 190, observedTier: 2 },
    ] as any);
    prismaMock.platformInvoice.findMany.mockResolvedValue([
      {
        id: 'inv-1', stripeInvoiceId: 'in_1', amountCents: 5900, currency: 'eur', status: 'paid',
        tier: 2, interval: 'month', periodStart: null, periodEnd: null,
        paidAt: new Date('2026-07-01'), hostedInvoiceUrl: 'https://stripe/i', createdAt: new Date('2026-07-01'),
      },
    ] as any);
    prismaMock.reservation.findMany.mockResolvedValue([{ createdAt: now }] as any);
    prismaMock.reservation.count.mockResolvedValue(7 as any);
    prismaMock.reservation.findFirst.mockResolvedValue({ createdAt: now } as any);

    const detail = await service.getClubDetail('club-1');
    expect(detail.name).toBe('Arena');
    expect(detail.siret).toBe('44306184100047');
    expect(detail.siretLegalName).toBe('ARENA PADEL SAS');
    expect(detail.siretVerifiedAt).toEqual(new Date('2026-01-02'));
    expect(detail.aliases).toEqual(['ancien-arena']);
    expect(detail.owners).toEqual([{ id: 'u1', email: 'o@x.fr', firstName: 'O', lastName: 'M' }]);
    expect(detail.counts).toEqual({ adherents: 48, resources: 5, tournaments: 3, events: 2 });
    expect(detail.billing.observedTier).toBe(2);
    expect(detail.billing.subscription).toMatchObject({ tier: 2, interval: 'month', priceCents: 5900 });
    expect(detail.billing.snapshots).toEqual([{ month: '2026-06', activeMembers: 190, tier: 2 }]);
    expect(detail.billing.invoices).toHaveLength(1);
    expect(detail.activity.reservationsByMonth).toHaveLength(12);
    // La résa « now » tombe dans le dernier bucket.
    expect(detail.activity.reservationsByMonth[11].count).toBe(1);
    expect(detail.activity.reservations30d).toBe(7);
  });

  it('subscription null si l abonnement est canceled', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      id: 'club-1', slug: 'arena', name: 'Arena', city: 'Paris', address: '', timezone: 'Europe/Paris',
      status: 'ACTIVE', createdAt: new Date('2026-01-01'), billingExempt: false,
      activeMemberCount: 10, activeMemberCountAt: null, members: [], slugAliases: [],
      platformSubscription: { status: 'canceled', tier: 1, interval: 'month', currentPeriodEnd: null, cancelAtPeriodEnd: false },
      _count: { clubMemberships: 0, resources: 0, tournaments: 0, clubEvents: 0 },
    } as any);
    prismaMock.clubMemberSnapshot.findMany.mockResolvedValue([] as any);
    prismaMock.platformInvoice.findMany.mockResolvedValue([] as any);
    prismaMock.reservation.findMany.mockResolvedValue([] as any);
    prismaMock.reservation.count.mockResolvedValue(0 as any);
    prismaMock.reservation.findFirst.mockResolvedValue(null as any);

    const detail = await service.getClubDetail('club-1');
    expect(detail.billing.subscription).toBeNull();
    expect(detail.billing.state).toBe('FREE');
  });
});

describe('PlatformService.setClubStatus', () => {
  const service = new PlatformService();

  it('met à jour le statut quand il est valide', async () => {
    prismaMock.club.update.mockResolvedValue({ id: 'club-demo', status: 'SUSPENDED' } as any);
    const club = await service.setClubStatus('club-demo', 'SUSPENDED');
    expect(prismaMock.club.update).toHaveBeenCalledWith({
      where: { id: 'club-demo' }, data: { status: 'SUSPENDED' },
    });
    expect(club.status).toBe('SUSPENDED');
  });

  it('rejette VALIDATION_ERROR si le statut est invalide', async () => {
    await expect(service.setClubStatus('club-demo', 'BANNED' as any)).rejects.toThrow('VALIDATION_ERROR');
    expect(prismaMock.club.update).not.toHaveBeenCalled();
  });

  it('rejette CLUB_NOT_FOUND si le club n existe pas (P2025)', async () => {
    prismaMock.club.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: 'x' }),
    );
    await expect(service.setClubStatus('absent', 'ACTIVE')).rejects.toThrow('CLUB_NOT_FOUND');
  });
});

describe('PlatformService.createClubWithOwner', () => {
  const service = new PlatformService();
  const validBody = {
    club: { name: 'Nantes Padel', city: 'Nantes', sportKey: 'padel' },
    owner: { firstName: 'Léa', lastName: 'Roux', email: 'lea@nantes.fr', password: 'password123' },
  };

  it('rejette VALIDATION_ERROR si un champ requis manque', async () => {
    await expect(service.createClubWithOwner({ ...validBody, club: { name: '' } } as any))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('rejette VALIDATION_ERROR si le mot de passe fait moins de 8 caractères', async () => {
    await expect(service.createClubWithOwner({ ...validBody, owner: { ...validBody.owner, password: 'court' } }))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('rejette EMAIL_TAKEN si l email gérant existe déjà', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 'u-exist' } as any);
    await expect(service.createClubWithOwner(validBody)).rejects.toThrow('EMAIL_TAKEN');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejette SLUG_RESERVED si le nom slugifie vers un libellé technique (ex. API)', async () => {
    await expect(service.createClubWithOwner({ ...validBody, club: { name: 'API' } }))
      .rejects.toThrow('SLUG_RESERVED');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejette SLUG_TAKEN si le slug est un alias historique (vérifié dans la transaction)', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null as any);
    const tx = {
      clubSlugAlias: { findUnique: jest.fn().mockResolvedValue({ slug: 'nantes-padel' }) },
      user: { create: jest.fn() },
      club: { create: jest.fn() },
      clubMember: { create: jest.fn() },
      sport: { findUnique: jest.fn() },
      clubSport: { create: jest.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
    await expect(service.createClubWithOwner(validBody)).rejects.toThrow('SLUG_TAKEN');
    expect(tx.club.create).not.toHaveBeenCalled();
  });

  it('rejette SLUG_TAKEN si le slug est déjà pris (P2002 sur slug)', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null as any);
    const tx = {
      clubSlugAlias: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { create: jest.fn().mockResolvedValue({ id: 'u-new', email: 'lea@nantes.fr', firstName: 'Léa', lastName: 'Roux' }) },
      club: { create: jest.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['slug'] } }),
      ) },
      clubMember: { create: jest.fn() },
      sport: { findUnique: jest.fn() },
      clubSport: { create: jest.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
    await expect(service.createClubWithOwner(validBody)).rejects.toThrow('SLUG_TAKEN');
  });

  it('crée le gérant, le club, le ClubMember OWNER et le ClubSport', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null as any);
    const tx = {
      clubSlugAlias: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { create: jest.fn().mockResolvedValue({ id: 'u-new', email: 'lea@nantes.fr', firstName: 'Léa', lastName: 'Roux' }) },
      club: { create: jest.fn().mockResolvedValue({ id: 'club-new', slug: 'nantes-padel', name: 'Nantes Padel', status: 'ACTIVE' }) },
      clubMember: { create: jest.fn().mockResolvedValue({}) },
      sport: { findUnique: jest.fn().mockResolvedValue({ id: 'sport-padel', key: 'padel' }) },
      clubSport: { create: jest.fn().mockResolvedValue({}) },
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const result = await service.createClubWithOwner(validBody);
    expect(tx.user.create).toHaveBeenCalled();
    expect(tx.clubMember.create).toHaveBeenCalledWith({ data: { userId: 'u-new', clubId: 'club-new', role: 'OWNER' } });
    expect(tx.clubSport.create).toHaveBeenCalled();
    expect(result.club.slug).toBe('nantes-padel');
    expect(result.owner.email).toBe('lea@nantes.fr');
  });

  it('géocode l\'adresse du club et persiste les coordonnées', async () => {
    geocodeMock.mockResolvedValue({ latitude: 9, longitude: 8, region: 'Bretagne', postalCode: '35000', city: 'Rennes' });
    prismaMock.user.findFirst.mockResolvedValue(null as any);
    const tx = {
      clubSlugAlias: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { create: jest.fn().mockResolvedValue({ id: 'o', email: 'o@x.fr', firstName: 'A', lastName: 'B' }) },
      club: { create: jest.fn().mockResolvedValue({ id: 'c', slug: 'club-rennes', name: 'Club Rennes', status: 'ACTIVE' }) },
      clubMember: { create: jest.fn().mockResolvedValue({}) },
      sport: { findUnique: jest.fn() },
      clubSport: { create: jest.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.createClubWithOwner({
      club: { name: 'Club Rennes', address: '1 rue Y', city: 'Rennes' },
      owner: { firstName: 'A', lastName: 'B', email: 'o@x.fr', password: 'password123' },
    });

    const data = (tx.club.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ latitude: 9, longitude: 8, region: 'Bretagne', postalCode: '35000' });
  });

  it('persiste department et departmentCode lors du géocodage', async () => {
    geocodeMock.mockResolvedValue({
      latitude: 45.7, longitude: 4.8, region: 'Auvergne-Rhône-Alpes',
      department: 'Rhône', departmentCode: '69', postalCode: '69001', city: 'Lyon',
    });
    prismaMock.user.findFirst.mockResolvedValue(null as any);
    const tx = {
      clubSlugAlias: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { create: jest.fn().mockResolvedValue({ id: 'u-lyon', email: 'g@lyon.fr', firstName: 'G', lastName: 'D' }) },
      club: { create: jest.fn().mockResolvedValue({ id: 'c-lyon', slug: 'lyon-padel', name: 'Lyon Padel', status: 'ACTIVE' }) },
      clubMember: { create: jest.fn().mockResolvedValue({}) },
      sport: { findUnique: jest.fn() },
      clubSport: { create: jest.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.createClubWithOwner({
      club: { name: 'Lyon Padel', address: '1 place Bellecour', city: 'Lyon' },
      owner: { firstName: 'G', lastName: 'D', email: 'g@lyon.fr', password: 'password123' },
    });

    const data = (tx.club.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ department: 'Rhône', departmentCode: '69' });
  });
});

describe('PlatformService.createClubWithOwner — SIRET (superadmin souverain)', () => {
  const service = new PlatformService();

  function makeTx(overrides: { clubCreate?: unknown } = {}) {
    return {
      clubSlugAlias: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { create: jest.fn().mockResolvedValue({ id: 'u-new', email: 'a@b.fr', firstName: 'A', lastName: 'B' }) },
      club: { create: jest.fn().mockResolvedValue(
        overrides.clubCreate ?? { id: 'club-new', slug: 'club-test', name: 'Club Test', status: 'ACTIVE' },
      ) },
      clubMember: { create: jest.fn().mockResolvedValue({}) },
      sport: { findUnique: jest.fn() },
      clubSport: { create: jest.fn() },
    };
  }

  const baseBody = {
    club: { name: 'Club Test' },
    owner: { firstName: 'A', lastName: 'B', email: 'a@b.fr', password: 'password123' },
  };

  beforeEach(() => {
    prismaMock.user.findFirst.mockResolvedValue(null as any);
  });

  it('SIRET absent : le club est créé sans vérification', async () => {
    const tx = makeTx();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const result = await service.createClubWithOwner(baseBody);
    expect(result.club.id).toBe('club-new');
    expect(siretValidMock).not.toHaveBeenCalled();
    expect(checkSiretMock).not.toHaveBeenCalled();
  });

  it('SIRET au mauvais format : rejette SIRET_INVALID avant toute transaction', async () => {
    siretValidMock.mockReturnValue(false);
    await expect(service.createClubWithOwner({
      ...baseBody,
      club: { ...baseBody.club, siret: 'bad' },
    })).rejects.toThrow('SIRET_INVALID');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('SIRET valide mais introuvable/inactif à l\'INSEE : créé quand même (best-effort, souverain)', async () => {
    siretValidMock.mockReturnValue(true);
    checkSiretMock.mockResolvedValue({ exists: false, active: false, legalName: null, city: null });
    const tx = makeTx();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const result = await service.createClubWithOwner({
      ...baseBody,
      club: { ...baseBody.club, siret: '44306184100047' },
    });
    expect(result.club.id).toBe('club-new');
  });
});

describe('PlatformService.changeClubSlug', () => {
  const service = new PlatformService();

  function makeTx(overrides: { clubBySlug?: unknown; alias?: unknown } = {}) {
    return {
      club: {
        findUnique: jest.fn().mockResolvedValue(overrides.clubBySlug ?? null),
        update: jest.fn().mockImplementation(async ({ data }: { data: { slug: string } }) =>
          ({ id: 'club-1', slug: data.slug, name: 'Padel Arena' })),
      },
      clubSlugAlias: {
        findUnique: jest.fn().mockResolvedValue(overrides.alias ?? null),
        delete: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
    };
  }

  beforeEach(() => {
    // Club ciblé existant, slug actuel 'old-arena'.
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', slug: 'old-arena', name: 'Padel Arena' } as any);
  });

  it('SLUG_INVALID si le slug normalisé est vide', async () => {
    await expect(service.changeClubSlug('club-1', '!!!')).rejects.toThrow('SLUG_INVALID');
    await expect(service.changeClubSlug('club-1', undefined)).rejects.toThrow('SLUG_INVALID');
  });

  it('SLUG_RESERVED pour les libellés techniques (www, app, api, superadmin)', async () => {
    for (const s of ['www', 'app', 'api', 'superadmin']) {
      await expect(service.changeClubSlug('club-1', s)).rejects.toThrow('SLUG_RESERVED');
    }
  });

  it('CLUB_NOT_FOUND si le club n existe pas', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(service.changeClubSlug('absent', 'nouveau')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('no-op (aucune transaction) si le slug est inchangé', async () => {
    const out = await service.changeClubSlug('club-1', 'Old Arena'); // slugify → 'old-arena'
    expect(out).toEqual({ id: 'club-1', slug: 'old-arena', name: 'Padel Arena' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('SLUG_TAKEN si le slug est le slug actuel d un autre club', async () => {
    const tx = makeTx({ clubBySlug: { id: 'club-2' } });
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
    await expect(service.changeClubSlug('club-1', 'pris')).rejects.toThrow('SLUG_TAKEN');
  });

  it('SLUG_TAKEN si le slug est un alias appartenant à un AUTRE club', async () => {
    const tx = makeTx({ alias: { clubId: 'club-2' } });
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
    await expect(service.changeClubSlug('club-1', 'ancien-d-un-autre')).rejects.toThrow('SLUG_TAKEN');
  });

  it('swap-back : reprendre son propre alias supprime la ligne d alias puis bascule', async () => {
    const tx = makeTx({ alias: { clubId: 'club-1' } });
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
    const out = await service.changeClubSlug('club-1', 'mon-ancien-slug');
    expect(tx.clubSlugAlias.delete).toHaveBeenCalledWith({ where: { slug: 'mon-ancien-slug' } });
    expect(tx.clubSlugAlias.create).toHaveBeenCalledWith({ data: { slug: 'old-arena', clubId: 'club-1' } });
    expect(out.slug).toBe('mon-ancien-slug');
  });

  it('insère l ancien slug en alias et met à jour le club (normalisation slugify)', async () => {
    const tx = makeTx();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
    const out = await service.changeClubSlug('club-1', 'Pâdel Çlub  Paris!');
    expect(tx.clubSlugAlias.create).toHaveBeenCalledWith({ data: { slug: 'old-arena', clubId: 'club-1' } });
    expect(tx.club.update).toHaveBeenCalledWith({
      where: { id: 'club-1' },
      data: { slug: 'padel-club-paris' },
      select: { id: true, slug: true, name: true },
    });
    expect(out).toEqual({ id: 'club-1', slug: 'padel-club-paris', name: 'Padel Arena' });
  });
});
