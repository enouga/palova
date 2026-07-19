import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const dispatchMock = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));

import {
  notifyTournamentDeadlineReminder,
  notifyEventDeadlineReminder,
  notifyTournamentUpcomingReminder,
  notifyEventUpcomingReminder,
} from '../notifications';

const club = {
  id: 'club-1', name: 'Padel Arena', slug: 'arena', logoUrl: null, logoWideUrl: null,
  accentColor: '#d6ff3f', timezone: 'Europe/Paris', address: null, city: null,
  contactPhone: null, contactEmail: null,
};

const captain = { id: 'user-cap', email: 'cap@x.fr', firstName: 'Marie', lastName: 'Dupont' };
const partner = { id: 'user-par', email: 'par@x.fr', firstName: 'Lucas', lastName: 'Martin' };

describe('notifyTournamentDeadlineReminder', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('notifie capitaine ET partenaire d\'un tournoi publié avec des inscriptions confirmées', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', name: 'Tournoi P100', status: 'PUBLISHED',
      startTime: new Date('2026-07-10T12:00:00Z'), endTime: null,
      registrationDeadline: new Date('2026-07-08T21:59:00Z'),
      club,
      registrations: [{ id: 'reg1', status: 'CONFIRMED', captain, partner }],
    } as any);

    await notifyTournamentDeadlineReminder('t1');

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-cap', category: 'MY_REGISTRATIONS', type: 'registration.deadline_reminder',
      email: expect.objectContaining({ to: 'cap@x.fr' }),
    }));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-par', category: 'MY_REGISTRATIONS', type: 'registration.deadline_reminder',
      email: expect.objectContaining({ to: 'par@x.fr' }),
    }));
  });

  it('ne notifie rien si le tournoi est introuvable', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(null as any);
    await notifyTournamentDeadlineReminder('missing');
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('ne notifie rien si le tournoi n\'est pas PUBLISHED', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', name: 'Tournoi P100', status: 'DRAFT',
      startTime: new Date(), endTime: null, registrationDeadline: new Date(),
      club, registrations: [{ id: 'reg1', status: 'CONFIRMED', captain, partner }],
    } as any);
    await notifyTournamentDeadlineReminder('t1');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe('notifyEventDeadlineReminder', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('notifie le joueur inscrit à un event publié', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({
      id: 'e1', name: 'Mêlée du jeudi', status: 'PUBLISHED',
      startTime: new Date('2026-07-10T18:00:00Z'), endTime: null,
      registrationDeadline: new Date('2026-07-08T21:59:00Z'),
      club,
      registrations: [{ id: 'reg1', status: 'CONFIRMED', user: captain }],
    } as any);

    await notifyEventDeadlineReminder('e1');

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-cap', category: 'MY_REGISTRATIONS', type: 'registration.deadline_reminder',
      email: expect.objectContaining({ to: 'cap@x.fr' }),
    }));
  });

  it('ne notifie rien si l\'event est introuvable', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(null as any);
    await notifyEventDeadlineReminder('missing');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe('notifyTournamentUpcomingReminder', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('notifie capitaine et partenaire, fenêtre J-1 → delai "demain"', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', name: 'Tournoi P100', status: 'PUBLISHED',
      startTime: new Date('2026-07-10T12:00:00Z'), endTime: new Date('2026-07-10T18:00:00Z'),
      registrationDeadline: new Date('2026-07-08T21:59:00Z'),
      club,
      registrations: [{ id: 'reg1', status: 'CONFIRMED', captain, partner }],
    } as any);

    await notifyTournamentUpcomingReminder('t1', 'J-1');

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-cap', type: 'registration.upcoming_reminder',
      email: expect.objectContaining({ subject: expect.stringContaining('demain') }),
    }));
  });

  it('fenêtre H-2 → delai "dans 2 heures"', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', name: 'Tournoi P100', status: 'PUBLISHED',
      startTime: new Date('2026-07-10T12:00:00Z'), endTime: new Date('2026-07-10T18:00:00Z'),
      registrationDeadline: new Date('2026-07-08T21:59:00Z'),
      club,
      registrations: [{ id: 'reg1', status: 'CONFIRMED', captain, partner }],
    } as any);

    await notifyTournamentUpcomingReminder('t1', 'H-2');

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      email: expect.objectContaining({ subject: expect.stringContaining('dans 2 heures') }),
    }));
  });

  it('ne notifie rien si le tournoi n\'a aucune inscription confirmée', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', name: 'Tournoi P100', status: 'PUBLISHED',
      startTime: new Date('2026-07-10T12:00:00Z'), endTime: null,
      registrationDeadline: new Date('2026-07-08T21:59:00Z'),
      club,
      registrations: [],
    } as any);

    await notifyTournamentUpcomingReminder('t1', 'J-1');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe('notifyEventUpcomingReminder', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('notifie le joueur inscrit, fenêtre H-2', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({
      id: 'e1', name: 'Mêlée du jeudi', status: 'PUBLISHED',
      startTime: new Date('2026-07-10T18:00:00Z'), endTime: null,
      registrationDeadline: new Date('2026-07-08T21:59:00Z'),
      club,
      registrations: [{ id: 'reg1', status: 'CONFIRMED', user: captain }],
    } as any);

    await notifyEventUpcomingReminder('e1', 'H-2');

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-cap', type: 'registration.upcoming_reminder',
      email: expect.objectContaining({ subject: expect.stringContaining('dans 2 heures') }),
    }));
  });

  it('ne notifie rien si l\'event n\'est pas PUBLISHED', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({
      id: 'e1', name: 'Mêlée du jeudi', status: 'CANCELLED',
      startTime: new Date(), endTime: null, registrationDeadline: new Date(),
      club, registrations: [{ id: 'reg1', status: 'CONFIRMED', user: captain }],
    } as any);

    await notifyEventUpcomingReminder('e1', 'J-1');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
