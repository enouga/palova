import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { RatingService } from '../rating.service';

const service = new RatingService();

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
});

describe('getForDisplay', () => {
  it('renvoie null si le joueur n a pas de niveau', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
    expect(await service.getForDisplay('u1', 'padel')).toBeNull();
  });

  it('mappe la ligne en affichage (niveau, palier, provisoire)', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue({
      displayLevel: 4, isProvisional: true, matchesPlayed: 0, initialSelfLevel: 4,
    } as any);
    const d = await service.getForDisplay('u1', 'padel');
    expect(d).toEqual({ calibrated: true, level: 4, tier: 'Intermédiaire', isProvisional: true, matchesPlayed: 0 });
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
      { userId: 'u1', displayLevel: 4, isProvisional: false },
      { userId: 'u2', displayLevel: 2.4, isProvisional: true },
    ] as any);
    const map = await service.getLevelsForUsers(['u1', 'u2', 'u3'], 'padel');
    expect(map.u1).toEqual({ level: 4, tier: 'Intermédiaire', isProvisional: false });
    expect(map.u2.level).toBeCloseTo(2.4);
    expect(map.u3).toBeUndefined();
  });

  it('liste vide → map vide, sans requête', async () => {
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    const map = await service.getLevelsForUsers([], 'padel');
    expect(map).toEqual({});
  });
});

describe('getLevelsBySport', () => {
  it('getLevelsBySport mappe les niveaux par (userId, sportKey)', async () => {
    prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }, { id: 'sport-tennis', key: 'tennis' }] as any);
    prismaMock.playerRating.findMany.mockResolvedValue([
      { userId: 'u1', sportId: 'sport-padel', displayLevel: 4, isProvisional: false },
      { userId: 'u1', sportId: 'sport-tennis', displayLevel: 6, isProvisional: true },
    ] as any);
    const map = await service.getLevelsBySport([
      { userId: 'u1', sportKey: 'padel' }, { userId: 'u1', sportKey: 'tennis' },
    ]);
    expect(map['u1:padel'].level).toBe(4);
    expect(map['u1:tennis'].level).toBe(6);
    expect(map['u1:tennis'].isProvisional).toBe(true);
  });

  it('getLevelsBySport renvoie {} pour une liste vide', async () => {
    expect(await service.getLevelsBySport([])).toEqual({});
  });
});
