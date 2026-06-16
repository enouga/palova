import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { MatchService } from '../match.service';

const service = new MatchService();

const RES = {
  id: 'r1', type: 'COURT', startTime: new Date('2026-06-10T10:00:00Z'),
  resource: { clubId: 'c1', clubSport: { sportId: 'sport-padel' } },
  participants: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }],
};
const NOW = new Date('2026-06-11T10:00:00Z');
const teams = { 1: ['u1', 'u2'], 2: ['u3', 'u4'] } as Record<1 | 2, string[]>;
const sets: [number, number][] = [[6, 4], [6, 3]];

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.reservation.findUnique.mockResolvedValue(RES as any);
  prismaMock.match.findFirst.mockResolvedValue(null as any);
  prismaMock.match.create.mockImplementation((args: any) => Promise.resolve({ id: 'm1', ...args.data }) as any);
});

describe('createFromReservation', () => {
  it('crée un Match PENDING + 4 MatchPlayer, auteur confirmé', async () => {
    const m = await service.createFromReservation('r1', 'u1', { teams, sets, now: NOW });
    expect(m.id).toBe('m1');
    const arg = (prismaMock.match.create as jest.Mock).mock.calls[0][0];
    expect(arg.data.status).toBe('PENDING');
    expect(arg.data.clubId).toBe('c1');
    expect(arg.data.sportId).toBe('sport-padel');
    expect(arg.data.winningTeam).toBe(1);
    expect(arg.data.players.create).toHaveLength(4);
    expect(arg.data.players.create.find((p: any) => p.userId === 'u1').confirmation).toBe('CONFIRMED');
    expect(arg.data.players.create.find((p: any) => p.userId === 'u3').confirmation).toBe('PENDING');
  });

  it('refuse si l auteur n est pas participant', async () => {
    await expect(service.createFromReservation('r1', 'uX', { teams, sets, now: NOW }))
      .rejects.toThrow('NOT_A_PARTICIPANT');
  });

  it('refuse si la réservation n est pas dans le passé', async () => {
    await expect(service.createFromReservation('r1', 'u1', { teams, sets, now: new Date('2026-06-09T10:00:00Z') }))
      .rejects.toThrow('MATCH_NOT_PLAYED_YET');
  });

  it('refuse si un Match actif existe déjà', async () => {
    prismaMock.match.findFirst.mockResolvedValue({ id: 'existing' } as any);
    await expect(service.createFromReservation('r1', 'u1', { teams, sets, now: NOW }))
      .rejects.toThrow('MATCH_ALREADY_EXISTS');
  });

  it('refuse une composition d équipes invalide (pas 2+2)', async () => {
    const bad = { 1: ['u1', 'u2', 'u3'], 2: ['u4'] } as Record<1 | 2, string[]>;
    await expect(service.createFromReservation('r1', 'u1', { teams: bad, sets, now: NOW }))
      .rejects.toThrow('VALIDATION_ERROR');
  });
});
