/**
 * Cycle de vie complet de la LISTE D'ATTENTE d'un event de club.
 *
 * Couvre, en un seul fichier :
 *   1. Placement à l'inscription (CONFIRMED vs WAITLISTED, capacité, dernière place, réinscription)
 *   2. Promotion automatique à la désinscription (le cas central)
 *   3. Promotion / retrait manuels par le club (admin)
 *   4. Affichage de la file (ordre + compteurs)
 *   5. Concurrence & verrouillage
 *
 * Prisma est mocké (`src/__mocks__/prisma`) → aucun Docker ni base requis.
 * La logique des tournois est un miroir de celle-ci (TournamentService) ;
 * voir `tournament.service.test.ts` pour son équivalent.
 */
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { Prisma } from '@prisma/client';
import { EventService } from '../event.service';
import {
  notifyEventRegistration,
  notifyEventCancellation,
  notifyEventPromotion,
} from '../../email/notifications';

// Aucun email réel pendant les tests : la couche notifications est mockée.
jest.mock('../../email/notifications');

const FUTURE = new Date(Date.now() + 86_400_000); // +24 h
const PAST = new Date(Date.now() - 1_000); // -1 s

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    clubId: 'club-demo',
    status: 'PUBLISHED',
    registrationDeadline: FUTURE,
    capacity: 12,
    memberOnly: true,
    ...overrides,
  };
}

/** Rend `$transaction` transparent (exécute le callback) et le verrou `$queryRaw` inerte. */
function passthroughTransaction() {
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.$queryRaw.mockResolvedValue([] as any);
}

/** Chemin nominal d'inscription : membre ACTIVE, transaction transparente, pas d'inscription existante. */
function mockRegisterHappyPath() {
  prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
  passthroughTransaction();
  prismaMock.eventRegistration.findUnique.mockResolvedValue(null as any);
}

let service: EventService;
beforeEach(() => {
  jest.clearAllMocks(); // remet à zéro les compteurs d'appel des notifications
  service = new EventService();
});

// ---------------------------------------------------------------------------
// 1. Placement à l'inscription
// ---------------------------------------------------------------------------
describe('liste d attente — placement à l inscription', () => {
  it('CONFIRMED tant qu il reste des places', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: 12 }) as any);
    mockRegisterHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(3 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    const result = await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventId: 'e1', userId: 'user-1', status: 'CONFIRMED' }),
      }),
    );
    expect(result.status).toBe('CONFIRMED');
  });

  it('CONFIRMED sur la toute dernière place (confirmés = capacité − 1)', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: 12 }) as any);
    mockRegisterHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(11 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
    );
  });

  it('WAITLISTED dès que les confirmés atteignent la capacité (cas limite)', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: 12 }) as any);
    mockRegisterHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(12 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'WAITLISTED' } as any);

    const result = await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'WAITLISTED' }) }),
    );
    expect(result.status).toBe('WAITLISTED');
  });

  it('jamais de liste d attente quand capacity est null (places illimitées)', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: null }) as any);
    mockRegisterHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(999 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
    );
  });

  it('réinscription après annulation : réutilise la ligne et remet createdAt à maintenant (bout de file)', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    mockRegisterHappyPath();
    prismaMock.eventRegistration.findUnique.mockResolvedValue({ id: 'r-old', status: 'CANCELLED' } as any);
    prismaMock.eventRegistration.count.mockResolvedValue(0 as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r-old', status: 'CONFIRMED' } as any);

    await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).not.toHaveBeenCalled();
    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r-old' },
        data: expect.objectContaining({ status: 'CONFIRMED', cancelledAt: null, createdAt: expect.any(Date) }),
      }),
    );
  });

  it('réinscription quand l event est de nouveau complet : repart en WAITLISTED', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: 12 }) as any);
    mockRegisterHappyPath();
    prismaMock.eventRegistration.findUnique.mockResolvedValue({ id: 'r-old', status: 'CANCELLED' } as any);
    prismaMock.eventRegistration.count.mockResolvedValue(12 as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r-old', status: 'WAITLISTED' } as any);

    await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'WAITLISTED' }) }),
    );
  });

  it('refuse une 2e inscription active (ALREADY_REGISTERED), même depuis la liste d attente', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    mockRegisterHappyPath();
    prismaMock.eventRegistration.findUnique.mockResolvedValue({ id: 'r1', status: 'WAITLISTED' } as any);

    await expect(service.register('e1', 'user-1')).rejects.toThrow('ALREADY_REGISTERED');
  });
});

// ---------------------------------------------------------------------------
// 2. Promotion automatique à la désinscription (le cas central)
// ---------------------------------------------------------------------------
describe('liste d attente — promotion automatique à la désinscription', () => {
  beforeEach(passthroughTransaction);

  it('un CONFIRMED se désinscrit → le 1er en attente est promu CONFIRMED', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any) // ma ligne active
      .mockResolvedValueOnce({ id: 'r-wait' } as any); // 1er en attente
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    const cancelled = await service.cancelRegistration('e1', 'user-1');

    expect(cancelled.status).toBe('CANCELLED');
    // ma ligne passe CANCELLED
    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1' }, data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
    // le 1er en attente passe CONFIRMED
    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r-wait' }, data: { status: 'CONFIRMED' } }),
    );
  });

  it('le promu est choisi par ancienneté (createdAt asc = ordre d arrivée dans la file)', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)
      .mockResolvedValueOnce({ id: 'r-wait' } as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    await service.cancelRegistration('e1', 'user-1');

    // 2e appel à findFirst = recherche du prochain à promouvoir
    const nextQuery = prismaMock.eventRegistration.findFirst.mock.calls[1][0] as any;
    expect(nextQuery).toEqual(
      expect.objectContaining({
        where: { eventId: 'e1', status: 'WAITLISTED' },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });

  it('un WAITLISTED se désinscrit → aucune promotion (une seule écriture)', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst.mockResolvedValueOnce({ id: 'r1', status: 'WAITLISTED' } as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    await service.cancelRegistration('e1', 'user-1');

    expect(prismaMock.eventRegistration.update).toHaveBeenCalledTimes(1);
    // pas de recherche d'un suivant à promouvoir
    expect(prismaMock.eventRegistration.findFirst).toHaveBeenCalledTimes(1);
  });

  it('un CONFIRMED se désinscrit mais la file est vide → aucune promotion', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)
      .mockResolvedValueOnce(null as any); // personne en attente
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    await service.cancelRegistration('e1', 'user-1');

    expect(prismaMock.eventRegistration.update).toHaveBeenCalledTimes(1); // seulement l'annulation
  });

  it('désinscription refusée après la deadline (REGISTRATION_LOCKED)', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ registrationDeadline: PAST }) as any);
    await expect(service.cancelRegistration('e1', 'user-1')).rejects.toThrow('REGISTRATION_LOCKED');
  });

  it('désinscription sans inscription active → REGISTRATION_NOT_FOUND', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst.mockResolvedValue(null as any);
    await expect(service.cancelRegistration('e1', 'user-1')).rejects.toThrow('REGISTRATION_NOT_FOUND');
  });

  it('notifie la désinscription ET la promotion du joueur promu', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)
      .mockResolvedValueOnce({ id: 'r-wait' } as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    await service.cancelRegistration('e1', 'user-1');

    expect(notifyEventCancellation).toHaveBeenCalledWith('r1');
    expect(notifyEventPromotion).toHaveBeenCalledWith('r-wait');
  });

  it('sans promotion, on ne notifie QUE la désinscription', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst.mockResolvedValueOnce({ id: 'r1', status: 'WAITLISTED' } as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    await service.cancelRegistration('e1', 'user-1');

    expect(notifyEventCancellation).toHaveBeenCalledWith('r1');
    expect(notifyEventPromotion).not.toHaveBeenCalled();
  });

  it('un email de promotion en échec ne fait pas échouer la désinscription', async () => {
    (notifyEventPromotion as jest.Mock).mockRejectedValueOnce(new Error('SMTP down'));
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)
      .mockResolvedValueOnce({ id: 'r-wait' } as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    await expect(service.cancelRegistration('e1', 'user-1')).resolves.toMatchObject({ status: 'CANCELLED' });
  });
});

// ---------------------------------------------------------------------------
// 3. Promotion / retrait manuels par le club (admin)
// ---------------------------------------------------------------------------
describe('liste d attente — actions du club (admin)', () => {
  it('adminPromoteRegistration : promeut un WAITLISTED en CONFIRMED (override, sans contrôle de place)', async () => {
    prismaMock.eventRegistration.findFirst.mockResolvedValue({ id: 'r-wait', status: 'WAITLISTED' } as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r-wait', status: 'CONFIRMED' } as any);

    const out = await service.adminPromoteRegistration('e1', 'r-wait', 'club-demo');

    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith({
      where: { id: 'r-wait' },
      data: { status: 'CONFIRMED' },
    });
    expect(out.status).toBe('CONFIRMED');
    expect(notifyEventPromotion).toHaveBeenCalledWith('r-wait');
  });

  it('adminPromoteRegistration : refuse de promouvoir une inscription déjà CONFIRMED (VALIDATION_ERROR)', async () => {
    prismaMock.eventRegistration.findFirst.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);
    await expect(service.adminPromoteRegistration('e1', 'r1', 'club-demo')).rejects.toThrow('VALIDATION_ERROR');
    expect(prismaMock.eventRegistration.update).not.toHaveBeenCalled();
  });

  it('adminPromoteRegistration : inscription d un autre club → REGISTRATION_NOT_FOUND', async () => {
    prismaMock.eventRegistration.findFirst.mockResolvedValue(null as any);
    await expect(service.adminPromoteRegistration('e1', 'r1', 'autre-club')).rejects.toThrow('REGISTRATION_NOT_FOUND');
  });

  it('adminRemoveRegistration : retire un CONFIRMED et promeut le 1er en attente', async () => {
    passthroughTransaction();
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any) // appartenance au club
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any) // relecture sous verrou
      .mockResolvedValueOnce({ id: 'r-wait' } as any); // 1er en attente
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    const out = await service.adminRemoveRegistration('e1', 'r1', 'club-demo');

    expect(out.status).toBe('CANCELLED');
    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r-wait' }, data: { status: 'CONFIRMED' } }),
    );
    expect(notifyEventPromotion).toHaveBeenCalledWith('r-wait');
  });
});

// ---------------------------------------------------------------------------
// 4. Affichage de la file (ordre + compteurs)
// ---------------------------------------------------------------------------
describe('liste d attente — affichage', () => {
  it('listParticipants : confirmés d abord, puis liste d attente, chacun par ordre d arrivée', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({ status: 'PUBLISHED' } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([
      { id: 'r1', status: 'CONFIRMED', userId: 'u1', user: { firstName: 'A', lastName: 'A', avatarUrl: null } },
      { id: 'r2', status: 'WAITLISTED', userId: 'u2', user: { firstName: 'B', lastName: 'B', avatarUrl: null } },
    ] as any);

    await service.listParticipants('e1');

    const args = prismaMock.eventRegistration.findMany.mock.calls[0][0] as any;
    expect(args.where).toEqual({ eventId: 'e1', status: { not: 'CANCELLED' } });
    expect(args.orderBy).toEqual([{ status: 'asc' }, { createdAt: 'asc' }]);
  });

  it('listPublicByClubSlug : expose confirmedCount et waitlistCount par event', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }] as any);
    (prismaMock.eventRegistration.groupBy as jest.Mock).mockResolvedValue([
      { eventId: 'e1', status: 'CONFIRMED', _count: { _all: 12 } },
      { eventId: 'e1', status: 'WAITLISTED', _count: { _all: 4 } },
    ] as any);

    const out = await service.listPublicByClubSlug('club-demo');

    expect(out[0]).toMatchObject({ id: 'e1', confirmedCount: 12, waitlistCount: 4 });
    expect(out[1]).toMatchObject({ id: 'e2', confirmedCount: 0, waitlistCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// 5. Concurrence & verrouillage
// ---------------------------------------------------------------------------
describe('liste d attente — concurrence', () => {
  it('inscription : verrou de l event (SELECT FOR UPDATE) dans une transaction Serializable', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    mockRegisterHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(0 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    await service.register('e1', 'user-1');

    expect(prismaMock.$queryRaw).toHaveBeenCalled(); // verrou ligne event posé
    expect(prismaMock.$transaction.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10_000,
      }),
    );
  });

  it('désinscription : verrou + transaction Serializable autour de la promotion', async () => {
    passthroughTransaction();
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)
      .mockResolvedValueOnce({ id: 'r-wait' } as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    await service.cancelRegistration('e1', 'user-1');

    expect(prismaMock.$queryRaw).toHaveBeenCalled();
    expect(prismaMock.$transaction.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10_000,
      }),
    );
  });
});
