import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { EventService } from '../event.service';
import {
  notifyEventRegistration,
  notifyEventCancellation,
  notifyEventPromotion,
} from '../../email/notifications';
import { PackageService } from '../package.service';
import { StripeService } from '../stripe.service';
import { RefundService } from '../refund.service';

// Pas d'envoi d'email réel pendant les tests : la couche notifications est mockée.
jest.mock('../../email/notifications');

const FUTURE = new Date(Date.now() + 86_400_000); // +24h

function event(overrides: Record<string, unknown> = {}) {
  return { id: 'e1', clubId: 'club-demo', status: 'PUBLISHED', registrationDeadline: FUTURE, capacity: 12, memberOnly: true, requirePrepayment: false, price: null, ...overrides };
}

/** Chemin nominal : membre ACTIVE, transaction passthrough, pas d'inscription existante. */
function mockHappyPath() {
  prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.$queryRaw.mockResolvedValue([] as any);
  prismaMock.eventRegistration.findUnique.mockResolvedValue(null as any);
}

describe('EventService.register', () => {
  let service: EventService;
  beforeEach(() => { service = new EventService(); });

  it('crée une inscription CONFIRMED quand il reste des places', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: 12 }) as any);
    mockHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(3 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    const result = await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventId: 'e1', userId: 'user-1', status: 'CONFIRMED' }) }),
    );
    expect(result.registration.status).toBe('CONFIRMED');
  });

  it('place en WAITLISTED quand l événement est complet', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: 12 }) as any);
    mockHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(12 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'WAITLISTED' } as any);

    await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'WAITLISTED' }) }),
    );
  });

  it('CONFIRMED sans limite de places (capacity null)', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: null }) as any);
    mockHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(999 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
    );
  });

  it('réinscription après annulation : met à jour la ligne, createdAt repart à maintenant', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    mockHappyPath();
    prismaMock.eventRegistration.findUnique.mockResolvedValue({ id: 'r-old', status: 'CANCELLED' } as any);
    prismaMock.eventRegistration.count.mockResolvedValue(0 as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r-old', status: 'CONFIRMED' } as any);

    await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).not.toHaveBeenCalled();
    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r-old' },
      data: expect.objectContaining({ status: 'CONFIRMED', cancelledAt: null, createdAt: expect.any(Date) }),
    }));
  });

  it('lève ALREADY_REGISTERED si une inscription active existe', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    mockHappyPath();
    prismaMock.eventRegistration.findUnique.mockResolvedValue({ id: 'r1', status: 'WAITLISTED' } as any);
    await expect(service.register('e1', 'user-1')).rejects.toThrow('ALREADY_REGISTERED');
  });

  it('lève EVENT_NOT_OPEN si DRAFT', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ status: 'DRAFT' }) as any);
    await expect(service.register('e1', 'user-1')).rejects.toThrow('EVENT_NOT_OPEN');
  });

  it('lève REGISTRATION_CLOSED après la deadline', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ registrationDeadline: new Date(Date.now() - 1000) }) as any);
    await expect(service.register('e1', 'user-1')).rejects.toThrow('REGISTRATION_CLOSED');
  });

  it('lève EVENT_NOT_FOUND si inconnu', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(null as any);
    await expect(service.register('ghost', 'user-1')).rejects.toThrow('EVENT_NOT_FOUND');
  });

  it('memberOnly : lève MEMBERSHIP_REQUIRED pour un non-membre', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ memberOnly: true }) as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.register('e1', 'user-1')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });

  it('événement ouvert : un non-membre peut s inscrire', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ memberOnly: false }) as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.eventRegistration.findUnique.mockResolvedValue(null as any);
    prismaMock.eventRegistration.count.mockResolvedValue(0 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    await expect(service.register('e1', 'user-1')).resolves.toMatchObject({ registration: { status: 'CONFIRMED' } });
  });

  it('un membre BLOCKED est refusé même sur un événement ouvert', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ memberOnly: false }) as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED' } as any);
    await expect(service.register('e1', 'user-1')).rejects.toThrow('MEMBERSHIP_BLOCKED');
  });
});

describe('EventService.register — paiement', () => {
  let service: EventService;
  beforeEach(() => { jest.clearAllMocks(); service = new EventService(); });

  it('épreuve payante + place dispo → CONFIRMED + DUE + paymentDeadline, mode payment, pas de notif', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: 12, requirePrepayment: true, price: 15 }) as any);
    mockHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(3 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'DUE' } as any);

    const res = await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED', paymentStatus: 'DUE', paymentDeadline: expect.any(Date) }) }),
    );
    expect(res.payment).toEqual({ mode: 'payment' });
    expect(notifyEventRegistration).not.toHaveBeenCalled();
  });

  it("épreuve payante + complet → WAITLISTED + DUE (deadline null), mode setup, notif liste d'attente", async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: 12, requirePrepayment: true, price: 15 }) as any);
    mockHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(12 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'WAITLISTED', paymentStatus: 'DUE' } as any);

    const res = await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'WAITLISTED', paymentStatus: 'DUE', paymentDeadline: null }) }),
    );
    expect(res.payment).toEqual({ mode: 'setup' });
    expect(notifyEventRegistration).toHaveBeenCalledWith('r1');
  });

  it('épreuve gratuite → payment null, notif immédiate', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: 12 }) as any);
    mockHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(0 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE' } as any);

    const res = await service.register('e1', 'user-1');
    expect(res.payment).toBeNull();
    expect(notifyEventRegistration).toHaveBeenCalledWith('r1');
  });

  it('réinscription payante CONFIRMED → paymentStatus DUE + paymentDeadline sur l update', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: 12, requirePrepayment: true, price: 10 }) as any);
    mockHappyPath();
    prismaMock.eventRegistration.findUnique.mockResolvedValue({ id: 'r-old', status: 'CANCELLED' } as any);
    prismaMock.eventRegistration.count.mockResolvedValue(0 as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r-old', status: 'CONFIRMED', paymentStatus: 'DUE' } as any);

    const res = await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r-old' },
      data: expect.objectContaining({ paymentStatus: 'DUE', paymentDeadline: expect.any(Date) }),
    }));
    expect(res.payment).toEqual({ mode: 'payment' });
  });
});

describe('EventService.cancelRegistration', () => {
  let service: EventService;
  beforeEach(() => {
    service = new EventService();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
  });

  it('annule une inscription CONFIRMED et promeut le 1er WAITLISTED', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)   // ma ligne active
      .mockResolvedValueOnce({ id: 'r-wait' } as any);                   // 1er en attente
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    await service.cancelRegistration('e1', 'user-1');

    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1' }, data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r-wait' }, data: { status: 'CONFIRMED' },
    }));
  });

  it('annule une WAITLISTED sans promotion', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst.mockResolvedValueOnce({ id: 'r1', status: 'WAITLISTED' } as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    await service.cancelRegistration('e1', 'user-1');

    expect(prismaMock.eventRegistration.update).toHaveBeenCalledTimes(1);
  });

  it('lève REGISTRATION_LOCKED après la deadline', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ registrationDeadline: new Date(Date.now() - 1000) }) as any);
    await expect(service.cancelRegistration('e1', 'user-1')).rejects.toThrow('REGISTRATION_LOCKED');
  });

  it('lève REGISTRATION_NOT_FOUND sans inscription active', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst.mockResolvedValue(null as any);
    await expect(service.cancelRegistration('e1', 'user-1')).rejects.toThrow('REGISTRATION_NOT_FOUND');
  });
});

describe('EventService lectures', () => {
  let service: EventService;
  beforeEach(() => { service = new EventService(); });

  it('listPublicByClubSlug : PUBLISHED seulement, avec compteurs', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }] as any);
    (prismaMock.eventRegistration.groupBy as jest.Mock).mockResolvedValue([
      { eventId: 'e1', status: 'CONFIRMED', _count: { _all: 4 } },
      { eventId: 'e1', status: 'WAITLISTED', _count: { _all: 2 } },
    ] as any);

    const out = await service.listPublicByClubSlug('club-demo');

    expect(prismaMock.clubEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clubId: 'club-demo', status: 'PUBLISHED' },
    }));
    expect(out[0]).toMatchObject({ id: 'e1', confirmedCount: 4, waitlistCount: 2 });
    expect(out[1]).toMatchObject({ id: 'e2', confirmedCount: 0, waitlistCount: 0 });
  });

  it('getById : masque les DRAFT', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({ id: 'e1', status: 'DRAFT' } as any);
    await expect(service.getById('e1')).rejects.toThrow('EVENT_NOT_FOUND');
  });

  it('listParticipants : masque les DRAFT', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({ status: 'DRAFT' } as any);
    await expect(service.listParticipants('e1')).rejects.toThrow('EVENT_NOT_FOUND');
  });

  it('listParticipants : inscrits actifs (noms + avatar, jamais l e-mail)', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({ status: 'PUBLISHED', clubSport: null } as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([
      { id: 'r1', status: 'CONFIRMED', userId: 'user-a', user: { firstName: 'A', lastName: 'A', avatarUrl: '/uploads/avatars/a.jpg' } },
    ] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);
    const out = await service.listParticipants('e1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'CONFIRMED', user: { firstName: 'A', avatarUrl: '/uploads/avatars/a.jpg' } });
    const args = (prismaMock.eventRegistration.findMany.mock.calls[0][0] as any);
    expect(args.select.user.select).toEqual({ firstName: true, lastName: true, avatarUrl: true });
    expect(args.orderBy).toEqual([{ status: 'asc' }, { createdAt: 'asc' }]);
  });

  it('listParticipants enrichit les entrées avec level (UserLevel ou null)', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({ status: 'PUBLISHED', clubSport: { sport: { key: 'padel' } } } as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([
      { id: 'r1', status: 'CONFIRMED', userId: 'user-a', user: { firstName: 'A', lastName: 'A', avatarUrl: null } },
      { id: 'r2', status: 'CONFIRMED', userId: 'user-b', user: { firstName: 'B', lastName: 'B', avatarUrl: null } },
    ] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([
      { userId: 'user-a', displayLevel: 5, rd: 350, isProvisional: true },
    ] as any);

    const out = await service.listParticipants('e1');

    expect(out[0].level).toEqual({ level: 5, tier: expect.any(String), isProvisional: true, reliability: 50 });
    expect(out[1].level).toBeNull();
    // userId ne doit pas fuiter dans la réponse
    expect((out[0] as any).userId).toBeUndefined();
  });

  it('listParticipants AVEC sport : niveaux calculés pour le sport de l event', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({ status: 'PUBLISHED', clubSport: { sport: { key: 'tennis' } } } as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([
      { id: 'r1', status: 'CONFIRMED', userId: 'user-a', user: { firstName: 'A', lastName: 'A', avatarUrl: null } },
    ] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-tennis' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([
      { userId: 'user-a', displayLevel: 3, rd: 80, isProvisional: false },
    ] as any);

    const out = await service.listParticipants('e1');

    expect(out[0].level).toEqual({ level: 3, tier: expect.any(String), isProvisional: false, reliability: 93 });
    // doit avoir appelé getLevelsForUsers avec le sport de l event (tennis)
    expect(prismaMock.sport.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ key: 'tennis' }),
    }));
  });

  it('listParticipants SANS sport : aucun niveau, getLevelsForUsers pas appelé', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({ status: 'PUBLISHED', clubSport: null } as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([
      { id: 'r1', status: 'CONFIRMED', userId: 'user-a', user: { firstName: 'A', lastName: 'A', avatarUrl: null } },
    ] as any);

    const out = await service.listParticipants('e1');

    expect(out[0].level).toBeNull();
    // sport.findUnique ne doit PAS être appelé (on ne calcule pas de niveau)
    expect(prismaMock.sport.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.playerRating.findMany).not.toHaveBeenCalled();
  });

  it('listUserRegistrations : inscriptions actives avec event + club', async () => {
    prismaMock.eventRegistration.findMany.mockResolvedValue([{ id: 'r1', status: 'CONFIRMED' }] as any);
    const out = await service.listUserRegistrations('user-1');
    expect(prismaMock.eventRegistration.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', status: { not: 'CANCELLED' } },
    }));
    expect(out).toHaveLength(1);
  });
});

describe('EventService admin', () => {
  let service: EventService;
  beforeEach(() => { service = new EventService(); });

  const validInput = {
    name: 'Mêlée du vendredi', kind: 'MELEE' as const,
    startTime: FUTURE.toISOString(), registrationDeadline: FUTURE.toISOString(),
    capacity: 12, price: 10, memberOnly: true,
  };

  it('createEvent : crée avec les champs normalisés', async () => {
    prismaMock.clubEvent.create.mockResolvedValue({ id: 'e1' } as any);
    await service.createEvent('club-demo', validInput);
    expect(prismaMock.clubEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clubId: 'club-demo', name: 'Mêlée du vendredi', kind: 'MELEE', capacity: 12, memberOnly: true }),
    }));
  });

  it('createEvent : refuse un kind inconnu', async () => {
    await expect(service.createEvent('club-demo', { ...validInput, kind: 'KARAOKE' as never }))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('createEvent : refuse capacity < 1 et price < 0', async () => {
    await expect(service.createEvent('club-demo', { ...validInput, capacity: 0 })).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.createEvent('club-demo', { ...validInput, price: -1 })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('updateEvent : refuse un event d un autre club', async () => {
    prismaMock.clubEvent.findFirst.mockResolvedValue(null as any);
    await expect(service.updateEvent('e1', 'autre-club', { name: 'X' })).rejects.toThrow('EVENT_NOT_FOUND');
  });

  it('deleteEvent : refuse s il reste des inscriptions actives', async () => {
    prismaMock.clubEvent.findFirst.mockResolvedValue({ id: 'e1' } as any);
    prismaMock.eventRegistration.count.mockResolvedValue(3 as any);
    await expect(service.deleteEvent('e1', 'club-demo')).rejects.toThrow('HAS_REGISTRATIONS');
  });

  it('createEvent : accepte clubSportId valide appartenant au club', async () => {
    prismaMock.clubSport.findFirst.mockResolvedValue({ id: 'cs1' } as any);
    prismaMock.clubEvent.create.mockResolvedValue({ id: 'e1' } as any);
    await service.createEvent('club-demo', { ...validInput, clubSportId: 'cs1' });
    expect(prismaMock.clubSport.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'cs1', clubId: 'club-demo' }),
    }));
    expect(prismaMock.clubEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clubSportId: 'cs1' }),
    }));
  });

  it('createEvent : refuse un clubSportId qui n appartient pas au club', async () => {
    prismaMock.clubSport.findFirst.mockResolvedValue(null as any);
    await expect(service.createEvent('club-demo', { ...validInput, clubSportId: 'cs-autre' }))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('createEvent : accepte clubSportId null (pas de sport)', async () => {
    prismaMock.clubEvent.create.mockResolvedValue({ id: 'e1' } as any);
    await service.createEvent('club-demo', { ...validInput, clubSportId: null });
    // pas de vérification clubSport
    expect(prismaMock.clubSport.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.clubEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clubSportId: null }),
    }));
  });

  it('updateEvent : accepte clubSportId valide appartenant au club', async () => {
    prismaMock.clubEvent.findFirst.mockResolvedValue({ id: 'e1', status: 'PUBLISHED', price: null, requirePrepayment: false } as any);
    prismaMock.clubSport.findFirst.mockResolvedValue({ id: 'cs1' } as any);
    prismaMock.clubEvent.update.mockResolvedValue({ id: 'e1' } as any);
    await service.updateEvent('e1', 'club-demo', { clubSportId: 'cs1' });
    expect(prismaMock.clubSport.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'cs1', clubId: 'club-demo' }),
    }));
    expect(prismaMock.clubEvent.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clubSportId: 'cs1' }),
    }));
  });

  it('updateEvent : refuse un clubSportId qui n appartient pas au club', async () => {
    prismaMock.clubEvent.findFirst.mockResolvedValue({ id: 'e1', status: 'PUBLISHED', price: null, requirePrepayment: false } as any);
    prismaMock.clubSport.findFirst.mockResolvedValue(null as any);
    await expect(service.updateEvent('e1', 'club-demo', { clubSportId: 'cs-autre' }))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('updateEvent : accepte clubSportId null pour retirer le sport', async () => {
    prismaMock.clubEvent.findFirst.mockResolvedValue({ id: 'e1', status: 'PUBLISHED', price: null, requirePrepayment: false } as any);
    prismaMock.clubEvent.update.mockResolvedValue({ id: 'e1' } as any);
    await service.updateEvent('e1', 'club-demo', { clubSportId: null });
    expect(prismaMock.clubSport.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.clubEvent.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clubSportId: null }),
    }));
  });

  it('adminRemoveRegistration : annule et promeut sous verrou', async () => {
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)  // appartenance au club
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)  // relecture sous verrou
      .mockResolvedValueOnce(null as any);                              // pas de WAITLISTED
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    const out = await service.adminRemoveRegistration('e1', 'r1', 'club-demo');
    expect(out.status).toBe('CANCELLED');
  });
});

describe('EventService — notifications email', () => {
  let service: EventService;
  beforeEach(() => { jest.clearAllMocks(); service = new EventService(); });

  it('register déclenche la notification d inscription avec l id créé', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    mockHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(0 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r-new', status: 'CONFIRMED' } as any);

    await service.register('e1', 'user-1');

    expect(notifyEventRegistration).toHaveBeenCalledWith('r-new');
  });

  it('cancelRegistration notifie la désinscription ET la promotion du 1er en attente', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)
      .mockResolvedValueOnce({ id: 'r-wait' } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    await service.cancelRegistration('e1', 'user-1');

    expect(notifyEventCancellation).toHaveBeenCalledWith('r1');
    expect(notifyEventPromotion).toHaveBeenCalledWith('r-wait');
  });

  it('une erreur d envoi d email ne fait pas échouer l inscription', async () => {
    (notifyEventRegistration as jest.Mock).mockRejectedValueOnce(new Error('SMTP down'));
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    mockHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(0 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r-new', status: 'CONFIRMED' } as any);

    await expect(service.register('e1', 'user-1')).resolves.toMatchObject({ registration: { id: 'r-new' } });
  });
});

describe('EventService.updateEvent — garde-fou paiement', () => {
  it('refuse requirePrepayment=true si Stripe pas ACTIVE', async () => {
    prismaMock.clubEvent.findFirst.mockResolvedValue({ id: 'e1', status: 'PUBLISHED', price: 15, requirePrepayment: false } as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountStatus: 'NONE' } as any);
    await expect(new EventService().updateEvent('e1', 'club-demo', { requirePrepayment: true }))
      .rejects.toThrow('ONLINE_PAYMENT_NOT_ENABLED');
  });

  it('refuse requirePrepayment=true si price < 0,50 €', async () => {
    prismaMock.clubEvent.findFirst.mockResolvedValue({ id: 'e1', status: 'PUBLISHED', price: 0, requirePrepayment: false } as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' } as any);
    await expect(new EventService().updateEvent('e1', 'club-demo', { requirePrepayment: true }))
      .rejects.toThrow('ONLINE_PAYMENT_NOT_ENABLED');
  });

  it('accepte requirePrepayment=true si Stripe ACTIVE + montant OK', async () => {
    prismaMock.clubEvent.findFirst.mockResolvedValue({ id: 'e1', status: 'PUBLISHED', price: 15, requirePrepayment: false } as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' } as any);
    prismaMock.clubEvent.update.mockResolvedValue({ id: 'e1' } as any);
    await expect(new EventService().updateEvent('e1', 'club-demo', { requirePrepayment: true })).resolves.toBeTruthy();
  });
});

describe('EventService.confirmRegistrationPayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(PackageService, 'nextReceiptNo').mockResolvedValue(1 as any);
  });

  it('DUE → PAID, crée un Payment ONLINE et notifie', async () => {
    prismaMock.eventRegistration.findUnique
      .mockResolvedValueOnce({
        id: 'r1', paymentStatus: 'DUE', userId: 'user-1', event: { clubId: 'club-demo', price: 15 },
      } as any)
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID' } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.eventRegistration.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay1' } as any);

    await new EventService().confirmRegistrationPayment('r1', { stripePaymentIntentId: 'pi_1' });

    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventRegistrationId: 'r1', method: 'ONLINE', status: 'CAPTURED', stripePaymentIntentId: 'pi_1' }) }),
    );
    expect(notifyEventRegistration).toHaveBeenCalledWith('r1');
  });

  it('idempotent : si déjà PAID, ne recrée pas de Payment', async () => {
    prismaMock.eventRegistration.findUnique.mockResolvedValue({
      id: 'r1', paymentStatus: 'PAID', userId: 'user-1', event: { clubId: 'club-demo', price: 15 },
    } as any);
    await new EventService().confirmRegistrationPayment('r1', { stripePaymentIntentId: 'pi_1' });
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });
});

describe('EventService.chargePromotedRegistration', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  const reg = (over: Record<string, unknown> = {}) => ({
    id: 'r1', status: 'CONFIRMED', paymentStatus: 'DUE', userId: 'user-1',
    eventId: 'e1', event: { clubId: 'club-demo', price: 15 }, ...over,
  });

  it('débit OK → PAID + Payment + notif promotion', async () => {
    prismaMock.eventRegistration.findUnique.mockResolvedValue(reg() as any);
    jest.spyOn(StripeService.prototype, 'chargeRegistrationOffSession').mockResolvedValue('pi_ok');
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.eventRegistration.updateMany.mockResolvedValue({ count: 1 } as any);
    jest.spyOn(PackageService, 'nextReceiptNo').mockResolvedValue(1 as any);

    await new EventService().chargePromotedRegistration('r1');

    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventRegistrationId: 'r1', stripePaymentIntentId: 'pi_ok' }) }));
    expect(notifyEventPromotion).toHaveBeenCalledWith('r1');
  });

  it('carte refusée → annule la place (CANCELLED, aucun Payment pour r1) et promeut le suivant', async () => {
    prismaMock.eventRegistration.findUnique
      .mockResolvedValueOnce(reg() as any)            // 1er appel : reg à débiter
      .mockResolvedValueOnce(reg({ id: 'r2' }) as any); // récursion sur le suivant promu
    jest.spyOn(StripeService.prototype, 'chargeRegistrationOffSession')
      .mockRejectedValueOnce(new Error('CARD_DECLINED'))
      .mockResolvedValueOnce('pi_ok');
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    prismaMock.eventRegistration.findFirst.mockResolvedValue({ id: 'r2' } as any); // suivant WAITLISTED
    prismaMock.eventRegistration.updateMany.mockResolvedValue({ count: 1 } as any);
    jest.spyOn(PackageService, 'nextReceiptNo').mockResolvedValue(1 as any);

    await new EventService().chargePromotedRegistration('r1');

    // r1 (carte refusée) est passée CANCELLED…
    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1' }, data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
    // … et aucun Payment n'est persisté pour r1 (seul r2, débité avec succès, en a un).
    expect(prismaMock.payment.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventRegistrationId: 'r1' }) }),
    );
    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventRegistrationId: 'r2', stripePaymentIntentId: 'pi_ok' }) }),
    );
    expect(notifyEventCancellation).toHaveBeenCalledWith('r1');
    // Promotion notifiée exactement une fois (pas de pré-notif avant la récursion).
    expect((notifyEventPromotion as jest.Mock).mock.calls).toEqual([['r2']]);
  });
});

describe('EventService.adminPromoteRegistration — paiement', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('place déjà promue ailleurs (updateMany count 0) → aucun débit Stripe', async () => {
    prismaMock.eventRegistration.findFirst.mockResolvedValue({ id: 'r1', status: 'WAITLISTED' } as any); // findClubRegistration
    prismaMock.clubEvent.findUnique.mockResolvedValue({ requirePrepayment: true } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.eventRegistration.updateMany.mockResolvedValue({ count: 0 } as any); // une autre promotion a gagné
    prismaMock.eventRegistration.findUnique.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'DUE' } as any);
    const chargeSpy = jest.spyOn(StripeService.prototype, 'chargeRegistrationOffSession');

    await new EventService().adminPromoteRegistration('e1', 'r1', 'club-demo');

    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it('promotion payante normale → débit off-session exactement une fois', async () => {
    prismaMock.eventRegistration.findFirst.mockResolvedValue({ id: 'r1', status: 'WAITLISTED' } as any);
    prismaMock.clubEvent.findUnique.mockResolvedValue({ requirePrepayment: true } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.eventRegistration.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.eventRegistration.findUnique
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'DUE', userId: 'user-1', eventId: 'e1', event: { clubId: 'club-demo', price: 15 } } as any)
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID' } as any);
    const chargeSpy = jest.spyOn(StripeService.prototype, 'chargeRegistrationOffSession').mockResolvedValue('pi_ok');
    jest.spyOn(PackageService, 'nextReceiptNo').mockResolvedValue(1 as any);

    await new EventService().adminPromoteRegistration('e1', 'r1', 'club-demo');

    expect(chargeSpy).toHaveBeenCalledTimes(1);
    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventRegistrationId: 'r1', stripePaymentIntentId: 'pi_ok' }) }),
    );
  });
});

describe('EventService.cancelRegistration — promotion payante', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(() => { jest.restoreAllMocks(); });

  function setupPaidCancel() {
    prismaMock.clubEvent.findUnique.mockResolvedValue({ registrationDeadline: FUTURE, clubId: 'club-demo', requirePrepayment: true } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'reg-confirmed', status: 'CONFIRMED', paymentStatus: 'NONE' } as any) // inscription du joueur
      .mockResolvedValueOnce({ id: 'reg-waiting' } as any);                                              // 1er en attente promu
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'reg-confirmed', status: 'CANCELLED' } as any);
  }

  it('notifie la désinscription mais PAS la promotion (déléguée au débit, pas de doublon)', async () => {
    setupPaidCancel();
    const chargeSpy = jest.spyOn(EventService.prototype, 'chargePromotedRegistration').mockResolvedValue(undefined);

    await new EventService().cancelRegistration('e1', 'user-1');

    expect(notifyEventCancellation).toHaveBeenCalledWith('reg-confirmed');
    expect(notifyEventPromotion).not.toHaveBeenCalled(); // la notif promo part du débit réussi
    expect(chargeSpy).toHaveBeenCalledWith('reg-waiting');
  });

  it('un débit qui échoue (post-commit) ne fait pas échouer la désinscription', async () => {
    setupPaidCancel();
    jest.spyOn(EventService.prototype, 'chargePromotedRegistration').mockRejectedValue(new Error('BOOM'));

    await expect(new EventService().cancelRegistration('e1', 'user-1')).resolves.toMatchObject({ id: 'reg-confirmed' });
    expect(notifyEventCancellation).toHaveBeenCalledWith('reg-confirmed');
  });
});

describe('EventService.cancelRegistration — remboursement', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(() => { jest.restoreAllMocks(); });

  it('inscription PAID annulée avant clôture → RefundService.refund appelé + REFUNDED', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({ registrationDeadline: FUTURE, clubId: 'club-demo', requirePrepayment: true } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.eventRegistration.findFirst.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID' } as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'pay1', amount: 15 } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'rf1' } as any);

    await new EventService().cancelRegistration('e1', 'user-1');

    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay1', clubId: 'club-demo', amount: 15 }));
    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'r1' }, data: { paymentStatus: 'REFUNDED' } }));
  });

  it('inscription NONE (gratuite) → pas de remboursement', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({ registrationDeadline: FUTURE, clubId: 'club-demo', requirePrepayment: false } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.eventRegistration.findFirst.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE' } as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund');
    await new EventService().cancelRegistration('e1', 'user-1');
    expect(refundSpy).not.toHaveBeenCalled();
  });
});
