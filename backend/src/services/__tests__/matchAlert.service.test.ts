import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

// Mocks module-scoped STABLES (réutilisés par le describe matchAndNotify de la Task 3) :
// le service fait `new RatingService()` en interne → il FAUT que la factory renvoie
// toujours la même fn, sinon on ne peut pas piloter les niveaux depuis les tests.
const dispatchMock = jest.fn();
const getLevelsBySportMock = jest.fn();
jest.mock('../notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));
jest.mock('../rating.service', () => ({
  RatingService: jest.fn().mockImplementation(() => ({ getLevelsBySport: getLevelsBySportMock })),
}));

import { MatchAlertService } from '../matchAlert.service';

const CLUB = { id: 'club-demo', status: 'ACTIVE' } as any;

describe('MatchAlertService — create/list/remove', () => {
  let service: MatchAlertService;
  beforeEach(() => {
    service = new MatchAlertService();
    prismaMock.club.findUnique.mockResolvedValue(CLUB);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.matchAlert.count.mockResolvedValue(0 as any);
  });

  it('crée une alerte : convertit la fenêtre locale en UTC (fuseau du club)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE', timezone: 'Europe/Paris' } as any);
    prismaMock.matchAlert.create.mockResolvedValue({ id: 'a1', windowStart: new Date('2026-07-16T16:00:00Z'), windowEnd: new Date('2026-07-16T19:00:00Z') } as any);

    const created = await service.create('arena', 'u1', { date: '2026-07-16', from: '18:00', to: '21:00' });

    expect(prismaMock.matchAlert.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'u1', clubId: 'club-demo',
        // 18:00 Europe/Paris (UTC+2 en été) = 16:00 UTC
        windowStart: new Date('2026-07-16T16:00:00.000Z'),
        windowEnd: new Date('2026-07-16T19:00:00.000Z'),
      }),
    }));
    expect(created).toEqual({ id: 'a1', windowStart: '2026-07-16T16:00:00.000Z', windowEnd: '2026-07-16T19:00:00.000Z' });
  });

  it('refuse une fenêtre inversée (to <= from)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE', timezone: 'Europe/Paris' } as any);
    await expect(service.create('arena', 'u1', { date: '2026-07-16', from: '21:00', to: '18:00' }))
      .rejects.toThrow('ALERT_WINDOW_INVALID');
  });

  it('refuse une fenêtre déjà passée', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE', timezone: 'Europe/Paris' } as any);
    await expect(service.create('arena', 'u1', { date: '2020-01-01', from: '18:00', to: '21:00' }))
      .rejects.toThrow('ALERT_WINDOW_INVALID');
  });

  it('refuse au-delà de 5 alertes actives', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE', timezone: 'Europe/Paris' } as any);
    prismaMock.matchAlert.count.mockResolvedValue(5 as any);
    await expect(service.create('arena', 'u1', { date: '2026-07-16', from: '18:00', to: '21:00' }))
      .rejects.toThrow('ALERT_LIMIT_REACHED');
  });

  it('refuse un membre BLOCKED', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE', timezone: 'Europe/Paris' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED' } as any);
    await expect(service.create('arena', 'u1', { date: '2026-07-16', from: '18:00', to: '21:00' }))
      .rejects.toThrow('MEMBERSHIP_BLOCKED');
  });

  it('listMine ne renvoie que les alertes actives, triées', async () => {
    prismaMock.matchAlert.findMany.mockResolvedValue([
      { id: 'a1', windowStart: new Date('2026-07-16T16:00:00Z'), windowEnd: new Date('2026-07-16T19:00:00Z') },
    ] as any);
    const list = await service.listMine('arena', 'u1');
    expect(prismaMock.matchAlert.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clubId: 'club-demo', userId: 'u1', windowEnd: expect.objectContaining({ gt: expect.any(Date) }) }),
      orderBy: { windowStart: 'asc' },
    }));
    expect(list).toEqual([{ id: 'a1', windowStart: '2026-07-16T16:00:00.000Z', windowEnd: '2026-07-16T19:00:00.000Z' }]);
  });

  it('remove ne supprime que sa propre alerte (idempotent)', async () => {
    prismaMock.matchAlert.deleteMany.mockResolvedValue({ count: 1 } as any);
    const r = await service.remove('arena', 'u1', 'a1');
    expect(prismaMock.matchAlert.deleteMany).toHaveBeenCalledWith({ where: { id: 'a1', userId: 'u1', clubId: 'club-demo' } });
    expect(r).toEqual({ ok: true });
  });
});

const CLUB_FULL = {
  id: 'club-demo', name: 'Padel Arena', slug: 'arena', logoUrl: null, accentColor: '#d6ff3f',
  timezone: 'Europe/Paris', address: null, city: null, contactPhone: null, contactEmail: null,
};

// Partie PUBLIC/CONFIRMED padel, format double (4 joueurs), 1 participant → 3 places.
// startTime 18:30, endTime 20:00 (heure du club Europe/Paris = UTC+2 → 16:30/18:00 UTC).
// Le select du matcheur charge resource.name + resource.club (EMAIL_CLUB_SELECT) → fixture complète.
function joinableMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1', status: 'CONFIRMED', visibility: 'PUBLIC',
    startTime: new Date('2026-07-16T16:30:00Z'), endTime: new Date('2026-07-16T18:00:00Z'),
    targetLevelMin: 2, targetLevelMax: 5,
    resource: { clubId: 'club-demo', name: 'Court 1', attributes: { format: 'double' }, club: CLUB_FULL, clubSport: { sport: { key: 'padel' } } },
    participants: [{ userId: 'orga' }],
    ...overrides,
  };
}
// Alerte de u1 couvrant 18:00–21:00 (club) = 16:00–19:00 UTC → contient la partie.
const alertRow = (id: string, userId: string) => ({
  id, userId, windowStart: new Date('2026-07-16T16:00:00Z'), windowEnd: new Date('2026-07-16T19:00:00Z'),
});

describe('MatchAlertService.matchAndNotify', () => {
  let service: MatchAlertService;
  beforeEach(() => {
    service = new MatchAlertService();
    dispatchMock.mockReset().mockResolvedValue(undefined);
    getLevelsBySportMock.mockReset().mockResolvedValue({});
    prismaMock.reservation.findUnique.mockResolvedValue(joinableMatch() as any);
    prismaMock.matchAlert.findMany.mockResolvedValue([alertRow('a1', 'u1')] as any);
    prismaMock.matchAlertHit.findMany.mockResolvedValue([] as any);
    prismaMock.matchAlertHit.createMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'u1' }] as any);
    // Le matcheur charge firstName/email des destinataires retenus : renvoie un user par id demandé.
    prismaMock.user.findMany.mockImplementation((args: any) =>
      Promise.resolve((args.where.id.in as string[]).map((id) => ({ id, firstName: id, email: `${id}@x.fr` }))) as any);
  });

  it('notifie le titulaire d\'une alerte in-range et crée le hit', async () => {
    getLevelsBySportMock.mockResolvedValue({ 'u1:padel': { level: 3 } }); // dans [2,5]
    const notified = await service.matchAndNotify('res-1');
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', category: 'MY_GAMES', type: 'open_match.alert', clubId: 'club-demo',
    }));
    expect(prismaMock.matchAlertHit.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ alertId: 'a1', reservationId: 'res-1' }], skipDuplicates: true,
    }));
    expect(notified).toEqual(['u1']);
  });

  it('partie sans fourchette (ouverte à tous) → notifie même un joueur non calibré', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(joinableMatch({ targetLevelMin: null, targetLevelMax: null }) as any);
    getLevelsBySportMock.mockResolvedValue({}); // niveau inconnu
    const notified = await service.matchAndNotify('res-1');
    expect(notified).toEqual(['u1']);
  });

  it('partie avec fourchette → exclut le niveau hors fourchette', async () => {
    getLevelsBySportMock.mockResolvedValue({ 'u1:padel': { level: 7 } }); // hors [2,5]
    const notified = await service.matchAndNotify('res-1');
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(notified).toEqual([]);
  });

  it('exclut l\'organisateur / un participant déjà présent', async () => {
    prismaMock.matchAlert.findMany.mockResolvedValue([alertRow('a1', 'orga')] as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'orga' }] as any);
    getLevelsBySportMock.mockResolvedValue({ 'orga:padel': { level: 3 } });
    const notified = await service.matchAndNotify('res-1');
    expect(notified).toEqual([]);
  });

  it('exclut une alerte déjà notifiée (hit existant)', async () => {
    prismaMock.matchAlertHit.findMany.mockResolvedValue([{ alertId: 'a1' }] as any);
    getLevelsBySportMock.mockResolvedValue({ 'u1:padel': { level: 3 } });
    const notified = await service.matchAndNotify('res-1');
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(notified).toEqual([]);
  });

  it('exclut un membre non ACTIVE (BLOCKED / absent de la requête ACTIVE)', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([] as any); // aucun ACTIVE
    getLevelsBySportMock.mockResolvedValue({ 'u1:padel': { level: 3 } });
    const notified = await service.matchAndNotify('res-1');
    expect(notified).toEqual([]);
  });

  it('ne fait rien si la partie est complète', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(joinableMatch({
      participants: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }],
    }) as any);
    const notified = await service.matchAndNotify('res-1');
    expect(prismaMock.matchAlert.findMany).not.toHaveBeenCalled();
    expect(notified).toEqual([]);
  });

  it('ne fait rien pour une partie non joignable (PRIVATE / non-padel / passée)', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(joinableMatch({ visibility: 'PRIVATE' }) as any);
    expect(await service.matchAndNotify('res-1')).toEqual([]);
    prismaMock.reservation.findUnique.mockResolvedValue(joinableMatch({ resource: { clubId: 'club-demo', attributes: { format: 'double' }, clubSport: { sport: { key: 'tennis' } } } }) as any);
    expect(await service.matchAndNotify('res-1')).toEqual([]);
    prismaMock.reservation.findUnique.mockResolvedValue(joinableMatch({ startTime: new Date('2000-01-01T10:00:00Z') }) as any);
    expect(await service.matchAndNotify('res-1')).toEqual([]);
  });

  it('un utilisateur avec 2 alertes couvrantes → notifié une seule fois, 2 hits', async () => {
    prismaMock.matchAlert.findMany.mockResolvedValue([alertRow('a1', 'u1'), alertRow('a2', 'u1')] as any);
    getLevelsBySportMock.mockResolvedValue({ 'u1:padel': { level: 3 } });
    const notified = await service.matchAndNotify('res-1');
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.matchAlertHit.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([{ alertId: 'a1', reservationId: 'res-1' }, { alertId: 'a2', reservationId: 'res-1' }]),
    }));
    expect(notified).toEqual(['u1']);
  });

  it('best-effort : un échec de dispatch pour un destinataire ne casse pas les autres', async () => {
    prismaMock.matchAlert.findMany.mockResolvedValue([alertRow('a1', 'u1'), alertRow('a2', 'u2')] as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }] as any);
    getLevelsBySportMock.mockResolvedValue({ 'u1:padel': { level: 3 }, 'u2:padel': { level: 3 } });
    dispatchMock.mockImplementation((a: { userId: string }) => a.userId === 'u1' ? Promise.reject(new Error('SMTP')) : Promise.resolve());
    const notified = await service.matchAndNotify('res-1');
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(notified).toContain('u2');
  });
});
