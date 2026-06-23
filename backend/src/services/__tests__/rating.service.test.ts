import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { RatingService } from '../rating.service';

const service = new RatingService();

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
});

describe('getForDisplay', () => {
  it('joueur sans niveau → état neutre (pas calibré, level null, fiabilité basse)', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
    const d = await service.getForDisplay('u1', 'padel');
    expect(d).toEqual({ calibrated: false, level: null, tier: '', isProvisional: true, reliability: 50, matchesPlayed: 0 });
  });

  it('mappe la ligne en affichage (niveau, palier, provisoire)', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue({
      displayLevel: 4, rd: 350, isProvisional: true, matchesPlayed: 0, initialSelfLevel: 4,
    } as any);
    const d = await service.getForDisplay('u1', 'padel');
    expect(d).toEqual({ calibrated: true, level: 4, tier: 'Intermédiaire', isProvisional: true, reliability: 50, matchesPlayed: 0 });
  });
});

describe('calibrate', () => {
  it('crée un niveau provisoire au palier choisi', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
    prismaMock.playerRating.upsert.mockImplementation((args: any) =>
      Promise.resolve({ ...args.create, matchesPlayed: 0 }) as any);
    const d = await service.calibrate('u1', 'padel', 5);
    expect(d.level).toBeCloseTo(5, 1);
    expect(d.tier).toBe('Confirmé');
    expect(d.isProvisional).toBe(true);
    expect(prismaMock.playerRating.upsert).toHaveBeenCalled();
  });

  it('« passer » (null) → départ neutre niveau 3', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
    prismaMock.playerRating.upsert.mockImplementation((args: any) =>
      Promise.resolve({ ...args.create, matchesPlayed: 0 }) as any);
    const d = await service.calibrate('u1', 'padel', null);
    expect(d.level).toBeCloseTo(3, 1);
    expect(d.calibrated).toBe(false);
  });

  it('ne réécrit pas un niveau déjà rodé par des matchs', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue({
      displayLevel: 6, isProvisional: false, matchesPlayed: 20, initialSelfLevel: null,
    } as any);
    const d = await service.calibrate('u1', 'padel', 2);
    expect(d.level).toBe(6);
    expect(prismaMock.playerRating.upsert).not.toHaveBeenCalled();
  });

  it('palier hors 1–8 → VALIDATION_ERROR', async () => {
    await expect(service.calibrate('u1', 'padel', 9)).rejects.toThrow('VALIDATION_ERROR');
  });

  it('sport inconnu → SPORT_NOT_FOUND', async () => {
    prismaMock.sport.findUnique.mockResolvedValue(null as any);
    await expect(service.getForDisplay('u1', 'inconnu')).rejects.toThrow('SPORT_NOT_FOUND');
  });
});

describe('getLevelsForUsers', () => {
  it('renvoie une map userId → niveau pour les joueurs ayant un rating', async () => {
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([
      { userId: 'u1', displayLevel: 4, rd: 80, isProvisional: false },
      { userId: 'u2', displayLevel: 2.4, rd: 350, isProvisional: true },
    ] as any);
    const map = await service.getLevelsForUsers(['u1', 'u2', 'u3'], 'padel');
    expect(map.u1).toEqual({ level: 4, tier: 'Intermédiaire', isProvisional: false, reliability: 93 });
    expect(map.u2.level).toBeCloseTo(2.4);
    expect(map.u2.reliability).toBe(50);
    expect(map.u3).toBeUndefined();
  });

  it('liste vide → map vide, sans requête', async () => {
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    const map = await service.getLevelsForUsers([], 'padel');
    expect(map).toEqual({});
  });
});

describe('adminSetLevel', () => {
  const txWith = (existing: any) => {
    const tx = {
      playerRating: {
        upsert: jest.fn((args: any) => Promise.resolve({ ...args.create, matchesPlayed: existing?.matchesPlayed ?? 0 })),
      },
      playerRatingAdjustment: { create: jest.fn().mockResolvedValue({}) },
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
    return tx;
  };

  it('écrit displayLevel/rating/rd fiabilisé + isProvisional=false et crée la ligne d audit', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue({ displayLevel: 2, matchesPlayed: 8 } as any);
    const tx = txWith({ matchesPlayed: 8 });
    // getForDisplay (relecture) renvoie la nouvelle valeur.
    prismaMock.playerRating.findUnique.mockResolvedValueOnce({ displayLevel: 2, matchesPlayed: 8 } as any)
      .mockResolvedValue({ displayLevel: 6, rd: 110, isProvisional: false, matchesPlayed: 8, initialSelfLevel: null } as any);

    const d = await service.adminSetLevel('u1', 'padel', 6, 'staff1', { reason: 'erreur saisie', clubId: 'club-demo' });

    // upsert écrit les bons champs
    const upsertArg = tx.playerRating.upsert.mock.calls[0][0];
    expect(upsertArg.update.displayLevel).toBe(6);
    expect(upsertArg.update.isProvisional).toBe(false);
    expect(upsertArg.update.rd).toBe(110); // RD_RELIABLE
    expect(upsertArg.update.rating).toBeCloseTo(1000 + (6 / 8) * 1100, 5);
    // audit créé avec previousLevel = ancien displayLevel
    const auditArg = tx.playerRatingAdjustment.create.mock.calls[0][0];
    expect(auditArg.data).toMatchObject({
      userId: 'u1', sportId: 'sport-padel', clubId: 'club-demo',
      staffUserId: 'staff1', previousLevel: 2, newLevel: 6, reason: 'erreur saisie',
    });
    expect(d.level).toBe(6);
    expect(d.isProvisional).toBe(false);
  });

  it('crée la ligne quand elle est absente (previousLevel null)', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValueOnce(null as any)
      .mockResolvedValue({ displayLevel: 4, rd: 110, isProvisional: false, matchesPlayed: 0, initialSelfLevel: null } as any);
    const tx = txWith(null);
    await service.adminSetLevel('u1', 'padel', 4, 'staff1', {});
    const auditArg = tx.playerRatingAdjustment.create.mock.calls[0][0];
    expect(auditArg.data.previousLevel).toBeNull();
    const upsertArg = tx.playerRating.upsert.mock.calls[0][0];
    expect(upsertArg.create.displayLevel).toBe(4);
    expect(upsertArg.create.isProvisional).toBe(false);
  });

  it('met à jour la ligne existante', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValueOnce({ displayLevel: 1, matchesPlayed: 3 } as any)
      .mockResolvedValue({ displayLevel: 7, rd: 110, isProvisional: false, matchesPlayed: 3, initialSelfLevel: null } as any);
    const tx = txWith({ matchesPlayed: 3 });
    const d = await service.adminSetLevel('u1', 'padel', 7, 'staff1', {});
    expect(tx.playerRating.upsert).toHaveBeenCalled();
    expect(d.level).toBe(7);
  });

  it('niveau < 0 → VALIDATION_ERROR (sans toucher la base)', async () => {
    await expect(service.adminSetLevel('u1', 'padel', -1, 'staff1', {})).rejects.toThrow('VALIDATION_ERROR');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('niveau > 8 → VALIDATION_ERROR', async () => {
    await expect(service.adminSetLevel('u1', 'padel', 9, 'staff1', {})).rejects.toThrow('VALIDATION_ERROR');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('accepte les bornes 0 et 8 inclus', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
    txWith(null);
    await expect(service.adminSetLevel('u1', 'padel', 0, 'staff1', {})).resolves.toBeDefined();
    await expect(service.adminSetLevel('u1', 'padel', 8, 'staff1', {})).resolves.toBeDefined();
  });

  it('sport inconnu → SPORT_NOT_FOUND', async () => {
    prismaMock.sport.findUnique.mockResolvedValue(null as any);
    await expect(service.adminSetLevel('u1', 'inconnu', 5, 'staff1', {})).rejects.toThrow('SPORT_NOT_FOUND');
  });
});

describe('getMemberLevelAdmin', () => {
  it('renvoie niveaux courants par sport + historique des corrections (récent d abord)', async () => {
    prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }] as any);
    prismaMock.playerRating.findMany.mockResolvedValue([
      { userId: 'u1', sportId: 'sport-padel', displayLevel: 6, rd: 110, isProvisional: false },
    ] as any);
    prismaMock.playerRatingAdjustment.findMany.mockResolvedValue([
      {
        id: 'adj1', previousLevel: 2, newLevel: 6, reason: 'erreur', createdAt: new Date('2026-06-23'),
        staffUser: { firstName: 'Eve', lastName: 'Admin' },
        sport: { key: 'padel', name: 'Padel' },
      },
    ] as any);

    const res = await service.getMemberLevelAdmin('u1', ['padel']);
    expect(res.levels['padel'].level).toBe(6);
    expect(res.history).toHaveLength(1);
    expect(res.history[0]).toMatchObject({
      id: 'adj1', previousLevel: 2, newLevel: 6, reason: 'erreur',
      staffFirstName: 'Eve', staffLastName: 'Admin', sportKey: 'padel', sportName: 'Padel',
    });
    // historique trié récent d'abord
    const findArg = (prismaMock.playerRatingAdjustment.findMany as jest.Mock).mock.calls[0][0];
    expect(findArg.where.userId).toBe('u1');
    expect(findArg.orderBy.createdAt).toBe('desc');
  });
});

describe('getLevelsBySport', () => {
  it('getLevelsBySport mappe les niveaux par (userId, sportKey)', async () => {
    prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }, { id: 'sport-tennis', key: 'tennis' }] as any);
    prismaMock.playerRating.findMany.mockResolvedValue([
      { userId: 'u1', sportId: 'sport-padel', displayLevel: 4, rd: 80, isProvisional: false },
      { userId: 'u1', sportId: 'sport-tennis', displayLevel: 6, rd: 350, isProvisional: true },
    ] as any);
    const map = await service.getLevelsBySport([
      { userId: 'u1', sportKey: 'padel' }, { userId: 'u1', sportKey: 'tennis' },
    ]);
    expect(map['u1:padel'].level).toBe(4);
    expect(map['u1:padel'].reliability).toBe(93);
    expect(map['u1:tennis'].level).toBe(6);
    expect(map['u1:tennis'].isProvisional).toBe(true);
  });

  it('getLevelsBySport renvoie {} pour une liste vide', async () => {
    expect(await service.getLevelsBySport([])).toEqual({});
  });
});
