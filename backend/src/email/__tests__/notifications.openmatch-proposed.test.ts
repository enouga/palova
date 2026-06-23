import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const dispatchMock = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));

const getLevelsBySportMock = jest.fn();
jest.mock('../../services/rating.service', () => ({
  RatingService: jest.fn().mockImplementation(() => ({ getLevelsBySport: getLevelsBySportMock })),
}));

import { notifyOpenMatchProposed } from '../notifications';

const club = { id: 'club-demo', name: 'Padel Arena', slug: 'arena', logoUrl: null, accentColor: '#d6ff3f', timezone: 'Europe/Paris' };

// Réservation PUBLIC fourchette 2–5, padel, format double (4 joueurs), 1 participant (organisateur)
// → 3 places restantes.
function publicRangedReservation(overrides: Record<string, unknown> = {}) {
  return {
    visibility: 'PUBLIC',
    targetLevelMin: 2,
    targetLevelMax: 5,
    startTime: new Date('2026-07-01T10:00:00Z'),
    endTime: new Date('2026-07-01T11:30:00Z'),
    resource: {
      name: 'Court 1',
      attributes: { format: 'double' },
      club,
      clubSport: { sport: { key: 'padel' } },
    },
    participants: [
      { isOrganizer: true, userId: 'orga', user: { firstName: 'Léa', lastName: 'M', email: 'lea@x.fr' } },
    ],
    ...overrides,
  };
}

describe('notifyOpenMatchProposed → dispatch aux membres opt-in in-range', () => {
  beforeEach(() => {
    dispatchMock.mockReset();
    getLevelsBySportMock.mockReset();
    (prismaMock.clubMembership.findMany as jest.Mock).mockReset();
    (prismaMock.reservation.findUnique as jest.Mock).mockReset();
  });

  it('notifie les membres ACTIVE opt-in in-range ; exclut hors-range et opt-out (filtrés en DB)', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(publicRangedReservation() as any);
    // La requête DB filtre déjà status ACTIVE + autoMatchProposals true.
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { userId: 'in', user: { firstName: 'In', lastName: 'Range', email: 'in@x.fr' } },
      { userId: 'out', user: { firstName: 'Out', lastName: 'Range', email: 'out@x.fr' } },
    ] as any);
    getLevelsBySportMock.mockResolvedValue({
      'in:padel': { level: 3 },   // dans [2,5]
      'out:padel': { level: 7 },  // hors [2,5]
    });

    await notifyOpenMatchProposed('res-1');

    // 'in' notifié, 'out' exclu (hors fourchette).
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'in', category: 'MY_GAMES', type: 'open_match.proposed', clubId: 'club-demo',
      email: expect.objectContaining({ to: 'in@x.fr' }),
    }));
  });

  it('exclut l organisateur et les participants déjà présents', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(
      publicRangedReservation({
        participants: [
          { isOrganizer: true, userId: 'orga', user: { firstName: 'Léa', lastName: 'M', email: 'lea@x.fr' } },
          { isOrganizer: false, userId: 'joined', user: { firstName: 'Jo', lastName: 'In', email: 'jo@x.fr' } },
        ],
      }) as any,
    );
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { userId: 'orga', user: { firstName: 'Léa', lastName: 'M', email: 'lea@x.fr' } },
      { userId: 'joined', user: { firstName: 'Jo', lastName: 'In', email: 'jo@x.fr' } },
      { userId: 'fresh', user: { firstName: 'Fresh', lastName: 'Player', email: 'fresh@x.fr' } },
    ] as any);
    getLevelsBySportMock.mockResolvedValue({
      'orga:padel': { level: 3 }, 'joined:padel': { level: 3 }, 'fresh:padel': { level: 3 },
    });

    await notifyOpenMatchProposed('res-1');

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'fresh' }));
  });

  it('membre non calibré (niveau null) → exclu (non notifié, parité reco front)', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(publicRangedReservation() as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { userId: 'newbie', user: { firstName: 'New', lastName: 'Bie', email: 'newbie@x.fr' } },
    ] as any);
    getLevelsBySportMock.mockResolvedValue({}); // pas de niveau → null

    await notifyOpenMatchProposed('res-1');

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('ne notifie pas si la partie est complète (0 place)', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(
      publicRangedReservation({
        participants: [
          { isOrganizer: true, userId: 'o', user: { firstName: 'A', lastName: 'A', email: 'a@x.fr' } },
          { isOrganizer: false, userId: 'b', user: { firstName: 'B', lastName: 'B', email: 'b@x.fr' } },
          { isOrganizer: false, userId: 'c', user: { firstName: 'C', lastName: 'C', email: 'c@x.fr' } },
          { isOrganizer: false, userId: 'd', user: { firstName: 'D', lastName: 'D', email: 'd@x.fr' } },
        ],
      }) as any,
    );

    await notifyOpenMatchProposed('res-1');

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(prismaMock.clubMembership.findMany).not.toHaveBeenCalled();
  });

  it('ne notifie pas une partie non-PUBLIC', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(
      publicRangedReservation({ visibility: 'PRIVATE' }) as any,
    );
    await notifyOpenMatchProposed('res-1');
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('ne notifie pas une partie sans fourchette de niveau', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(
      publicRangedReservation({ targetLevelMin: null, targetLevelMax: null }) as any,
    );
    await notifyOpenMatchProposed('res-1');
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('ne lève pas si la résa est introuvable', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(null as any);
    await expect(notifyOpenMatchProposed('nope')).resolves.toBeUndefined();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('un échec de dispatch pour un destinataire ne casse pas les autres (best-effort)', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(publicRangedReservation() as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { userId: 'ko', user: { firstName: 'Ko', lastName: 'Fail', email: 'ko@x.fr' } },
      { userId: 'ok', user: { firstName: 'Ok', lastName: 'Good', email: 'ok@x.fr' } },
    ] as any);
    getLevelsBySportMock.mockResolvedValue({ 'ko:padel': { level: 3 }, 'ok:padel': { level: 3 } });
    dispatchMock.mockImplementation((arg: { userId: string }) => {
      if (arg.userId === 'ko') return Promise.reject(new Error('SMTP down'));
      return Promise.resolve();
    });

    await expect(notifyOpenMatchProposed('res-1')).resolves.toBeUndefined();
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'ok' }));
  });
});
