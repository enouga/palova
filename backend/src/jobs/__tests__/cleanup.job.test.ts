import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
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

import { releaseExpiredRegistrations } from '../cleanup.job';

const now = new Date('2026-06-25T10:00:00Z');

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
