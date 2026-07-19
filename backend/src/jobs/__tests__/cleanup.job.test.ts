import '../../__mocks__/prisma';
import '../../__mocks__/redis';
import { prismaMock } from '../../__mocks__/prisma';
import { redisMock } from '../../__mocks__/redis';
import { TournamentService } from '../../services/tournament.service';
import { EventService } from '../../services/event.service';

// Mocks nécessaires pour les dépendances des services importés par cleanup.job
jest.mock('../../email/notifications');
jest.mock('../../services/stripe.service', () => ({ StripeService: jest.fn() }));
jest.mock('../../services/refund.service', () => ({ RefundService: jest.fn() }));
jest.mock('../../services/rating.service', () => ({ RatingService: jest.fn() }));
jest.mock('../../services/match.service', () => ({
  MatchService: jest.fn().mockImplementation(() => ({ autoValidateDue: jest.fn().mockResolvedValue(0) })),
}));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

const mockBroadcast = jest.fn();
const mockBroadcastClub = jest.fn();
jest.mock('../../services/sse.service', () => ({
  SSEService: { getInstance: jest.fn(() => ({ broadcast: mockBroadcast, broadcastClub: mockBroadcastClub })) },
}));

const mockInvalidateAvailability = jest.fn();
jest.mock('../../services/availabilityCache', () => ({
  invalidateClubAvailability: (...a: unknown[]) => mockInvalidateAvailability(...a),
}));

import { releaseExpiredRegistrations, releaseExpiredHolds } from '../cleanup.job';

const now = new Date('2026-06-25T10:00:00Z');

describe('releaseExpiredHolds', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('annule les PENDING expirés, libère les verrous, diffuse slot_released et purge le cache de dispo', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      { id: 'r1', resourceId: 'res1', startTime: new Date('2026-06-25T12:00:00Z'), endTime: new Date('2026-06-25T13:00:00Z'), resource: { clubId: 'club-a' } },
      { id: 'r2', resourceId: 'res2', startTime: new Date('2026-06-25T14:00:00Z'), endTime: new Date('2026-06-25T15:00:00Z'), resource: { clubId: 'club-a' } },
    ] as any);
    prismaMock.reservation.updateMany.mockResolvedValue({ count: 2 } as any);
    redisMock.del.mockResolvedValue(1 as any);

    await releaseExpiredHolds(now);

    expect(prismaMock.reservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['r1', 'r2'] } },
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
    expect(redisMock.del).toHaveBeenCalledTimes(2);
    expect(mockBroadcast).toHaveBeenCalledWith('res1', expect.objectContaining({ type: 'slot_released', reservationId: 'r1' }));
    expect(mockBroadcast).toHaveBeenCalledWith('res2', expect.objectContaining({ type: 'slot_released', reservationId: 'r2' }));
    expect(mockBroadcastClub).toHaveBeenCalledWith('club-a', expect.objectContaining({ type: 'slot_released', reservationId: 'r1' }));
    expect(mockBroadcastClub).toHaveBeenCalledWith('club-a', expect.objectContaining({ type: 'slot_released', reservationId: 'r2' }));
    // Les deux holds sont dans le même club → UNE purge (clubs dédupliqués).
    expect(mockInvalidateAvailability).toHaveBeenCalledTimes(1);
    expect(mockInvalidateAvailability).toHaveBeenCalledWith('club-a');
  });

  it('ne fait rien quand aucun hold expiré', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([] as any);

    await releaseExpiredHolds(now);

    expect(prismaMock.reservation.updateMany).not.toHaveBeenCalled();
    expect(redisMock.del).not.toHaveBeenCalled();
    expect(mockInvalidateAvailability).not.toHaveBeenCalled();
  });
});

describe('releaseExpiredRegistrations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('appelle releaseExpiredRegistration sur les inscriptions CONFIRMED+DUE expirées (tournois)', async () => {
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([{ id: 'r1' }] as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([] as any);
    const tSpy = jest.spyOn(TournamentService.prototype, 'releaseExpiredRegistration').mockResolvedValue();
    const eSpy = jest.spyOn(EventService.prototype, 'releaseExpiredRegistration').mockResolvedValue();

    await releaseExpiredRegistrations(now);

    expect(tSpy).toHaveBeenCalledWith('r1');
    expect(eSpy).not.toHaveBeenCalled();
  });

  it('appelle releaseExpiredRegistration sur les inscriptions CONFIRMED+DUE expirées (events)', async () => {
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([] as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([{ id: 'e1' }] as any);
    const tSpy = jest.spyOn(TournamentService.prototype, 'releaseExpiredRegistration').mockResolvedValue();
    const eSpy = jest.spyOn(EventService.prototype, 'releaseExpiredRegistration').mockResolvedValue();

    await releaseExpiredRegistrations(now);

    expect(eSpy).toHaveBeenCalledWith('e1');
    expect(tSpy).not.toHaveBeenCalled();
  });

  it('ne fait rien quand aucune inscription expirée', async () => {
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([] as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([] as any);
    const tSpy = jest.spyOn(TournamentService.prototype, 'releaseExpiredRegistration').mockResolvedValue();
    const eSpy = jest.spyOn(EventService.prototype, 'releaseExpiredRegistration').mockResolvedValue();

    await releaseExpiredRegistrations(now);

    expect(tSpy).not.toHaveBeenCalled();
    expect(eSpy).not.toHaveBeenCalled();
  });

  it('passe paymentDeadline:{lt:now} dans la requête (exclut les null = WAITLISTED+DUE)', async () => {
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([] as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([] as any);

    await releaseExpiredRegistrations(now);

    expect(prismaMock.tournamentRegistration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'CONFIRMED',
          paymentStatus: 'DUE',
          paymentDeadline: { lt: now },
        }),
      }),
    );
    expect(prismaMock.eventRegistration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'CONFIRMED',
          paymentStatus: 'DUE',
          paymentDeadline: { lt: now },
        }),
      }),
    );
  });
});

// Test de service : retour rapide si la registration n'est pas CONFIRMED+DUE
describe('TournamentService.releaseExpiredRegistration — retour anticipé', () => {
  let service: TournamentService;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new TournamentService();
  });

  it('ne fait rien si la registration est introuvable', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue(null as any);
    await expect(service.releaseExpiredRegistration('unknown')).resolves.toBeUndefined();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('ne fait rien si paymentStatus n\'est pas DUE', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID', tournamentId: 't1',
      tournament: { requirePrepayment: true },
    } as any);
    await expect(service.releaseExpiredRegistration('r1')).resolves.toBeUndefined();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('ne fait rien si status n\'est pas CONFIRMED', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      id: 'r1', status: 'WAITLISTED', paymentStatus: 'DUE', tournamentId: 't1',
      tournament: { requirePrepayment: true },
    } as any);
    await expect(service.releaseExpiredRegistration('r1')).resolves.toBeUndefined();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('EventService.releaseExpiredRegistration — retour anticipé', () => {
  let service: EventService;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new EventService();
  });

  it('ne fait rien si la registration est introuvable', async () => {
    prismaMock.eventRegistration.findUnique.mockResolvedValue(null as any);
    await expect(service.releaseExpiredRegistration('unknown')).resolves.toBeUndefined();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('ne fait rien si paymentStatus n\'est pas DUE', async () => {
    prismaMock.eventRegistration.findUnique.mockResolvedValue({
      id: 'e1', status: 'CONFIRMED', paymentStatus: 'PAID', eventId: 'ev1',
      event: { requirePrepayment: true },
    } as any);
    await expect(service.releaseExpiredRegistration('e1')).resolves.toBeUndefined();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
