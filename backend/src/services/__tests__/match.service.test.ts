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

describe('confirm / dispute', () => {
  const matchRow = (overrides = {}) => ({
    id: 'm1', status: 'PENDING',
    players: [
      { userId: 'u1', confirmation: 'CONFIRMED' },
      { userId: 'u2', confirmation: 'CONFIRMED' },
      { userId: 'u3', confirmation: 'CONFIRMED' },
      { userId: 'u4', confirmation: 'PENDING' },
    ],
    ...overrides,
  });

  it('confirmer le dernier joueur déclenche la finalisation', async () => {
    prismaMock.match.findUnique.mockResolvedValue(matchRow() as any);
    prismaMock.matchPlayer.update.mockResolvedValue({} as any);
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    await service.confirm('m1', 'u4');
    expect(prismaMock.matchPlayer.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { confirmation: 'CONFIRMED' },
    }));
    expect(spy).toHaveBeenCalledWith('m1');
    spy.mockRestore();
  });

  it('confirmer un joueur non dernier ne finalise pas', async () => {
    prismaMock.match.findUnique.mockResolvedValue(matchRow({
      players: [
        { userId: 'u1', confirmation: 'CONFIRMED' }, { userId: 'u2', confirmation: 'PENDING' },
        { userId: 'u3', confirmation: 'PENDING' }, { userId: 'u4', confirmation: 'PENDING' },
      ],
    }) as any);
    prismaMock.matchPlayer.update.mockResolvedValue({} as any);
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    await service.confirm('m1', 'u2');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('contester met le match en DISPUTED, pas de finalisation', async () => {
    prismaMock.match.findUnique.mockResolvedValue(matchRow() as any);
    prismaMock.matchPlayer.update.mockResolvedValue({} as any);
    prismaMock.match.update.mockResolvedValue({} as any);
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    await service.dispute('m1', 'u4');
    expect(prismaMock.match.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'DISPUTED' } }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('refuse de confirmer un match déjà CONFIRMED', async () => {
    prismaMock.match.findUnique.mockResolvedValue(matchRow({ status: 'CONFIRMED' }) as any);
    await expect(service.confirm('m1', 'u4')).rejects.toThrow('MATCH_NOT_PENDING');
  });

  it('refuse un joueur étranger au match', async () => {
    prismaMock.match.findUnique.mockResolvedValue(matchRow() as any);
    await expect(service.confirm('m1', 'uX')).rejects.toThrow('NOT_A_MATCH_PLAYER');
  });
});
