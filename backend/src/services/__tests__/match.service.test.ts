jest.mock('../../email/notifications', () => ({
  __esModule: true,
  notifyMatchPendingConfirmation: jest.fn(),
  notifyNewMatchComment: jest.fn(),
}));

import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { Prisma } from '@prisma/client';
import { MatchService } from '../match.service';
import { recomputeSportRatings } from '../rating/recompute';

const service = new MatchService();

const RES = {
  id: 'r1', type: 'COURT', startTime: new Date('2026-06-10T10:00:00Z'),
  resource: { clubId: 'c1', clubSport: { sportId: 'sport-padel' }, club: { levelSystemEnabled: true } },
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

  it('refuse la saisie si le système de niveau est désactivé pour le club', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      ...RES,
      resource: { clubId: 'c1', clubSport: { sportId: 'sport-padel' }, club: { levelSystemEnabled: false } },
    } as any);
    await expect(service.createFromReservation('r1', 'u1', { teams, sets, now: NOW }))
      .rejects.toThrow('LEVEL_SYSTEM_DISABLED');
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

  it('contester met le match en DISPUTED + crée le 1er message, pas de finalisation', async () => {
    prismaMock.match.findUnique.mockResolvedValue(matchRow() as any);
    const tx = {
      matchPlayer: { update: jest.fn().mockResolvedValue({}) },
      match: { update: jest.fn().mockResolvedValue({}) },
      matchComment: { create: jest.fn().mockResolvedValue({}) },
    };
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    await service.dispute('m1', 'u4', '  Le 2e set était 6-4 pas 6-3  ');
    expect(tx.match.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'DISPUTED' } }));
    expect(tx.matchComment.create).toHaveBeenCalledWith({
      data: { matchId: 'm1', userId: 'u4', body: 'Le 2e set était 6-4 pas 6-3' },
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('contester refuse un motif vide', async () => {
    await expect(service.dispute('m1', 'u4', '   ')).rejects.toThrow('VALIDATION_ERROR');
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

describe('autoValidateDue', () => {
  it('finalise chaque match PENDING périmé', async () => {
    prismaMock.match.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }] as any);
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    const n = await service.autoValidateDue(new Date('2026-06-20T00:00:00Z'));
    expect(n).toBe(2);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('un échec de finalisation n interrompt pas les autres', async () => {
    prismaMock.match.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }] as any);
    const spy = jest.spyOn(service, 'finalize')
      .mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined as any);
    const n = await service.autoValidateDue(new Date());
    expect(n).toBe(1);
    spy.mockRestore();
  });
});

describe('resolveDispute', () => {
  beforeEach(() => {
    prismaMock.match.findUnique.mockResolvedValue({ clubId: 'c1', status: 'DISPUTED' } as any);
    prismaMock.match.update.mockResolvedValue({} as any);
  });

  it('VALIDATE re-PENDING puis finalise', async () => {
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    await service.resolveDispute('m1', 'c1', 'VALIDATE');
    expect(prismaMock.match.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING' }),
    }));
    expect(spy).toHaveBeenCalledWith('m1');
    spy.mockRestore();
  });

  it('CANCEL passe le match CANCELLED sans finaliser', async () => {
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    await service.resolveDispute('m1', 'c1', 'CANCEL');
    expect(prismaMock.match.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CANCELLED' } }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('refuse un match d un autre club (IDOR)', async () => {
    prismaMock.match.findUnique.mockResolvedValue({ clubId: 'AUTRE', status: 'DISPUTED' } as any);
    await expect(service.resolveDispute('m1', 'c1', 'CANCEL')).rejects.toThrow('MATCH_NOT_FOUND');
    expect(prismaMock.match.update).not.toHaveBeenCalled();
  });

  it('refuse un match introuvable', async () => {
    prismaMock.match.findUnique.mockResolvedValue(null as any);
    await expect(service.resolveDispute('m1', 'c1', 'CANCEL')).rejects.toThrow('MATCH_NOT_FOUND');
  });

  it('refuse un match non DISPUTED', async () => {
    prismaMock.match.findUnique.mockResolvedValue({ clubId: 'c1', status: 'CONFIRMED' } as any);
    await expect(service.resolveDispute('m1', 'c1', 'CANCEL')).rejects.toThrow('MATCH_NOT_DISPUTED');
  });
});

describe('finalize', () => {
  const playedAt = new Date('2026-06-10T10:00:00Z');

  function txMock() {
    const ratings: Record<string, any> = {};
    return {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'm1', status: 'PENDING', sportId: 'sport-padel', playedAt, ratingsAppliedAt: null,
          players: [
            { userId: 'u1', team: 1 }, { userId: 'u2', team: 1 },
            { userId: 'u3', team: 2 }, { userId: 'u4', team: 2 },
          ],
          sets: [[6, 2], [6, 2]],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      playerRating: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation((a: any) => { ratings[a.create.userId] = a.create; return Promise.resolve(a.create); }),
      },
      matchPlayer: { update: jest.fn().mockResolvedValue({}) },
      _ratings: ratings,
    };
  }

  it('applique les niveaux des 4 joueurs et passe le match CONFIRMED', async () => {
    const tx = txMock();
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await service.finalize('m1');
    expect(tx.match.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CONFIRMED' }),
    }));
    expect(tx.playerRating.upsert).toHaveBeenCalledTimes(4);
    expect(tx.matchPlayer.update).toHaveBeenCalledTimes(4);
  });

  it('idempotent : si ratingsAppliedAt déjà set, ne réapplique pas', async () => {
    const tx = txMock();
    tx.match.findUnique.mockResolvedValue({ id: 'm1', status: 'CONFIRMED', ratingsAppliedAt: new Date(), players: [], sets: [] } as any);
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await service.finalize('m1');
    expect(tx.playerRating.upsert).not.toHaveBeenCalled();
  });
});

describe('recomputeSportRatings', () => {
  function txMock(confirmed: any[], ratingRows: any[]) {
    const updated: Record<string, any> = {};
    return {
      match: { findMany: jest.fn().mockResolvedValue(confirmed) },
      playerRating: {
        findMany: jest.fn().mockResolvedValue(ratingRows),
        update: jest.fn().mockImplementation((a: any) => { updated[a.where.userId_sportId.userId] = a.data; return Promise.resolve(a.data); }),
      },
      matchPlayer: { update: jest.fn().mockResolvedValue({}) },
      _updated: updated,
    };
  }

  it('réinitialise + rejoue les confirmés et persiste chaque joueur concerné', async () => {
    const confirmed = [{
      id: 'm1', playedAt: new Date('2026-06-10T10:00:00Z'), sets: [[6, 2], [6, 2]],
      players: [
        { userId: 'u1', team: 1 }, { userId: 'u2', team: 1 },
        { userId: 'u3', team: 2 }, { userId: 'u4', team: 2 },
      ],
    }];
    const ratingRows = ['u1', 'u2', 'u3', 'u4'].map((userId) => ({ userId, initialSelfLevel: null }));
    const tx = txMock(confirmed, ratingRows);
    await recomputeSportRatings(tx as any, 'sport-padel', []);
    expect(tx.playerRating.update).toHaveBeenCalledTimes(4);
    expect(tx.matchPlayer.update).toHaveBeenCalledTimes(4);
    expect(tx._updated.u1.matchesPlayed).toBe(1);
    expect(tx._updated.u1.displayLevel).toBeGreaterThan(tx._updated.u3.displayLevel);
  });

  it('inclut extraUserIds (joueurs du match annulé, désormais sans match) et les remet à leur calibration', async () => {
    const tx = txMock([], [{ userId: 'solo', initialSelfLevel: 5 }]);
    await recomputeSportRatings(tx as any, 'sport-padel', ['solo']);
    expect(tx.playerRating.update).toHaveBeenCalledTimes(1);
    expect(tx._updated.solo.matchesPlayed).toBe(0);
    expect(tx._updated.solo.lastMatchAt).toBeNull();
  });

  it('ignore les joueurs sans ligne PlayerRating (aucun update fantôme)', async () => {
    // 'ghost' est demandé via extraUserIds mais n'a aucune ligne PlayerRating
    const tx = txMock([], [{ userId: 'solo', initialSelfLevel: 5 }]);
    await recomputeSportRatings(tx as any, 'sport-padel', ['solo', 'ghost']);
    expect(tx.playerRating.update).toHaveBeenCalledTimes(1); // seulement 'solo'
    expect(tx._updated.solo).toBeDefined();
    expect(tx._updated.ghost).toBeUndefined();
  });
});

describe('voidMatch', () => {
  function txMock(match: any) {
    return {
      match: { findUnique: jest.fn().mockResolvedValue(match), update: jest.fn().mockResolvedValue({}) },
      matchPlayer: { updateMany: jest.fn().mockResolvedValue({}) },
      playerRating: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
    };
  }

  it('refuse un motif vide (400)', async () => {
    await expect(service.voidMatch('m1', 'c1', 'staff1', '   ')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('refuse un motif trop long (>200)', async () => {
    await expect(service.voidMatch('m1', 'c1', 'staff1', 'x'.repeat(201))).rejects.toThrow('VALIDATION_ERROR');
  });

  it('404 si le match est d un autre club', async () => {
    const tx = txMock({ clubId: 'AUTRE', sportId: 's', status: 'CONFIRMED', ratingsAppliedAt: new Date(), players: [] });
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await expect(service.voidMatch('m1', 'c1', 'staff1', 'erreur de saisie')).rejects.toThrow('MATCH_NOT_FOUND');
  });

  it('409 si déjà annulé', async () => {
    const tx = txMock({ clubId: 'c1', sportId: 's', status: 'CANCELLED', ratingsAppliedAt: null, players: [] });
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await expect(service.voidMatch('m1', 'c1', 'staff1', 'erreur de saisie')).rejects.toThrow('ALREADY_CANCELLED');
  });

  it('PENDING : annule, pose l audit, NE recalcule PAS', async () => {
    const tx: any = txMock({ clubId: 'c1', sportId: 's', status: 'PENDING', ratingsAppliedAt: null, players: [{ userId: 'u1' }] });
    tx.match.findMany = jest.fn().mockResolvedValue([]);
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await service.voidMatch('m1', 'c1', 'staff1', 'doublon');
    expect(tx.match.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED', cancelledByUserId: 'staff1', cancelledReason: 'doublon' }),
    }));
    expect(tx.match.findMany).not.toHaveBeenCalled();
    expect(tx.matchPlayer.updateMany).toHaveBeenCalledWith({ where: { matchId: 'm1' }, data: { ratingBefore: null, ratingAfter: null } });
  });

  it('CONFIRMED : annule ET recalcule (lit l historique confirmé)', async () => {
    const tx: any = txMock({ clubId: 'c1', sportId: 's', status: 'CONFIRMED', ratingsAppliedAt: new Date(), players: [{ userId: 'u1' }] });
    tx.match.findMany = jest.fn().mockResolvedValue([]);
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await service.voidMatch('m1', 'c1', 'staff1', 'score truqué');
    expect(tx.match.findMany).toHaveBeenCalled();
  });
});

describe('commentaires de litige', () => {
  const disputedMatch = {
    id: 'm1', clubId: 'c1', status: 'DISPUTED',
    players: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }],
  };

  it('listComments : joueur autorisé, messages triés + isStaff par auteur', async () => {
    prismaMock.match.findUnique.mockResolvedValue(disputedMatch as any);
    prismaMock.matchComment.findMany.mockResolvedValue([
      { id: 'k1', userId: 'u1', body: 'Le score est faux', createdAt: new Date('2026-06-11T10:00:00Z'),
        user: { firstName: 'Manon', lastName: 'Membre', avatarUrl: null } },
      { id: 'k2', userId: 's1', body: 'On regarde', createdAt: new Date('2026-06-11T11:00:00Z'),
        user: { firstName: 'Sam', lastName: 'Staff', avatarUrl: null } },
    ] as any);
    prismaMock.clubMember.findMany.mockResolvedValue([{ userId: 's1' }] as any);
    const res = await service.listComments('m1', 'u1');
    expect(res.status).toBe('DISPUTED');
    expect(res.comments).toHaveLength(2);
    expect(res.comments[0].isStaff).toBe(false);
    expect(res.comments[1].isStaff).toBe(true);
    expect(res.comments[1].author.firstName).toBe('Sam');
  });

  it('assertMatchAccess : staff (non-joueur) autorisé', async () => {
    prismaMock.match.findUnique.mockResolvedValue(disputedMatch as any);
    prismaMock.clubMember.findUnique.mockResolvedValue({ role: 'ADMIN' } as any);
    prismaMock.matchComment.findMany.mockResolvedValue([] as any);
    prismaMock.clubMember.findMany.mockResolvedValue([{ userId: 's1' }] as any);
    await expect(service.listComments('m1', 's1')).resolves.toBeDefined();
  });

  it('assertMatchAccess : tiers (ni joueur ni staff) → FORBIDDEN', async () => {
    prismaMock.match.findUnique.mockResolvedValue(disputedMatch as any);
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    await expect(service.listComments('m1', 'uX')).rejects.toThrow('FORBIDDEN');
  });

  it('listComments : match inexistant → MATCH_NOT_FOUND', async () => {
    prismaMock.match.findUnique.mockResolvedValue(null as any);
    await expect(service.listComments('mZ', 'u1')).rejects.toThrow('MATCH_NOT_FOUND');
  });

  it('addComment : joueur écrit sur un match DISPUTED', async () => {
    prismaMock.match.findUnique.mockResolvedValue(disputedMatch as any);
    prismaMock.matchComment.create.mockResolvedValue({ id: 'k9' } as any);
    await service.addComment('m1', 'u2', '  Je conteste aussi  ');
    expect(prismaMock.matchComment.create).toHaveBeenCalledWith({
      data: { matchId: 'm1', userId: 'u2', body: 'Je conteste aussi' },
    });
  });

  it('addComment : refusé si le match n est pas en litige (lecture seule)', async () => {
    prismaMock.match.findUnique.mockResolvedValue({ ...disputedMatch, status: 'CONFIRMED' } as any);
    await expect(service.addComment('m1', 'u2', 'trop tard')).rejects.toThrow('MATCH_NOT_DISPUTED');
  });

  it('addComment : refuse un corps vide', async () => {
    await expect(service.addComment('m1', 'u2', '   ')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('addComment : refuse un corps > 1000 caractères', async () => {
    await expect(service.addComment('m1', 'u2', 'x'.repeat(1001))).rejects.toThrow('VALIDATION_ERROR');
  });
});
