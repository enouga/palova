import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { OpenMatchService } from '../openMatch.service';

const mockNotifyJoin = jest.fn();
const mockNotifyLeft = jest.fn();
const mockNotifyRemoved = jest.fn();
const mockNotifyAdded = jest.fn();
const mockNotifyInterest = jest.fn();
jest.mock('../../email/notifications', () => ({
  notifyOpenMatchJoin: (...args: unknown[]) => mockNotifyJoin(...args),
  notifyOpenMatchLeft: (...args: unknown[]) => mockNotifyLeft(...args),
  notifyOpenMatchRemoved: (...args: unknown[]) => mockNotifyRemoved(...args),
  notifyOpenMatchAdded: (...args: unknown[]) => mockNotifyAdded(...args),
  notifyOpenMatchInterest: (...args: unknown[]) => mockNotifyInterest(...args),
}));

const future = (h = 48) => new Date(Date.now() + h * 3_600_000);

describe('OpenMatchService', () => {
  let service: OpenMatchService;
  beforeEach(() => {
    service = new OpenMatchService();
    mockNotifyJoin.mockReset().mockResolvedValue(undefined);
    mockNotifyLeft.mockReset().mockResolvedValue(undefined);
    mockNotifyRemoved.mockReset().mockResolvedValue(undefined);
    mockNotifyAdded.mockReset().mockResolvedValue(undefined);
    mockNotifyInterest.mockReset().mockResolvedValue(undefined);
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    // Default: sport found (needed by RatingService.getLevelsBySport in listOpenMatches)
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }] as any);
    // Default: no ratings (additive — tests that need specific ratings override this)
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);
  });

  describe('listOpenMatches', () => {
    it('liste les parties PUBLIC/CONFIRMED à venir avec places restantes et appartenance du viewer', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        {
          id: 'm1', startTime: future(48), endTime: future(49),
          resource: { id: 'court-1', name: 'Court 1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
          participants: [
            { userId: 'org', isOrganizer: true, user: { firstName: 'Org', lastName: 'A', avatarUrl: null } },
            { userId: 'viewer', isOrganizer: false, user: { firstName: 'V', lastName: 'B', avatarUrl: null } },
          ],
        },
      ] as any);

      const out = await service.listOpenMatches('club-demo', 'viewer');

      const where = (prismaMock.reservation.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({
        visibility: 'PUBLIC', status: 'CONFIRMED',
        resource: { clubId: 'club-demo', clubSport: { sport: { key: 'padel' } } },
      }));
      expect(where.startTime.gt).toBeInstanceOf(Date);
      expect(out[0].maxPlayers).toBe(4);
      expect(out[0].spotsLeft).toBe(2);
      expect(out[0].full).toBe(false);
      expect(out[0].viewerIsParticipant).toBe(true);
      expect(out[0].viewerIsOrganizer).toBe(false); // viewer est partenaire, pas organisateur
      expect(out[0].players).toHaveLength(2);
    });

    it('ne remonte que les parties padel (filtre clubSport.sport.key)', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([] as any);
      await service.listOpenMatches('club-demo', 'viewer');
      const where = (prismaMock.reservation.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.resource.clubSport.sport.key).toBe('padel');
    });

    it('lève MEMBERSHIP_REQUIRED si le viewer n est pas membre actif', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
      await expect(service.listOpenMatches('club-demo', 'viewer')).rejects.toThrow('MEMBERSHIP_REQUIRED');
    });

    it('lève CLUB_NOT_FOUND si le club n existe pas', async () => {
      prismaMock.club.findUnique.mockResolvedValue(null as any);
      await expect(service.listOpenMatches('inconnu', 'viewer')).rejects.toThrow('CLUB_NOT_FOUND');
    });

    it('annote les joueurs avec leur niveau et expose la fourchette cible', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        {
          id: 'm2', startTime: future(48), endTime: future(49),
          targetLevelMin: 3, targetLevelMax: 5,
          resource: { id: 'court-2', name: 'Court 2', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
          participants: [
            { userId: 'player-rated', isOrganizer: true, user: { firstName: 'Alice', lastName: 'A', avatarUrl: null } },
            { userId: 'player-no-rating', isOrganizer: false, user: { firstName: 'Bob', lastName: 'B', avatarUrl: null } },
          ],
        },
      ] as any);

      prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }] as any);
      prismaMock.playerRating.findMany.mockResolvedValue([
        { userId: 'player-rated', sportId: 'sport-padel', displayLevel: 4, rd: 80, isProvisional: false },
      ] as any);

      const out = await service.listOpenMatches('club-demo', 'viewer');

      expect(out[0].targetLevelMin).toBe(3);
      expect(out[0].targetLevelMax).toBe(5);

      const ratedPlayer = out[0].players.find((p: any) => p.userId === 'player-rated');
      expect(ratedPlayer?.level).toEqual({ level: 4, tier: 'Intermédiaire', isProvisional: false, reliability: 93 });

      const unratedPlayer = out[0].players.find((p: any) => p.userId === 'player-no-rating');
      expect(unratedPlayer?.level).toBeNull();
    });

    it('attribue le niveau du sport du terrain (padel vs tennis) à chaque joueur', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        {
          id: 'match-padel', startTime: future(48), endTime: future(49),
          resource: { id: 'court-padel', name: 'Court Padel', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
          participants: [
            { userId: 'player-a', isOrganizer: true, user: { firstName: 'Alice', lastName: 'A', avatarUrl: null } },
          ],
        },
        {
          id: 'match-tennis', startTime: future(48), endTime: future(49),
          resource: { id: 'court-tennis', name: 'Court Tennis', attributes: { format: 'double' }, clubSport: { sport: { key: 'tennis' } } },
          participants: [
            { userId: 'player-a', isOrganizer: false, user: { firstName: 'Alice', lastName: 'A', avatarUrl: null } },
          ],
        },
      ] as any);

      // getLevelsBySport : sport.findMany + playerRating.findMany
      prismaMock.sport.findMany.mockResolvedValue([
        { id: 'sport-padel', key: 'padel' },
        { id: 'sport-tennis', key: 'tennis' },
      ] as any);
      prismaMock.playerRating.findMany.mockResolvedValue([
        { userId: 'player-a', sportId: 'sport-padel', displayLevel: 5, rd: 80, isProvisional: false },
        { userId: 'player-a', sportId: 'sport-tennis', displayLevel: 7, rd: 350, isProvisional: true },
      ] as any);

      const out = await service.listOpenMatches('club-demo', 'viewer');

      // Partie padel : player-a doit avoir niveau padel (5)
      const padelMatch = out.find((m: any) => m.id === 'match-padel');
      expect(padelMatch?.players[0].level).toEqual({ level: 5, tier: expect.any(String), isProvisional: false, reliability: 93 });

      // Partie tennis : player-a doit avoir niveau tennis (7)
      const tennisMatch = out.find((m: any) => m.id === 'match-tennis');
      expect(tennisMatch?.players[0].level).toEqual({ level: 7, tier: expect.any(String), isProvisional: true, reliability: 50 });
    });
  });

  describe('joinOpenMatch', () => {
    const lockRow = (over: Record<string, unknown> = {}) =>
      (prismaMock.$queryRaw as jest.Mock).mockResolvedValue([{
        id: 'm1', status: 'CONFIRMED', visibility: 'PUBLIC', start_time: future(48), resource_id: 'court-1', total_price: '24', ...over,
      }]);
    const happyTx = () => prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    const resource = (over: Record<string, unknown> = {}) =>
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo', attributes: { format: 'double' }, ...over } as any);

    it('ajoute le joueur, re-répartit les parts (24 € / 3 = 8 €) et notifie l organisateur', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);
      prismaMock.reservationParticipant.create.mockResolvedValue({ id: 'p3' } as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.joinOpenMatch('club-demo', 'm1', 'user-3');

      expect(prismaMock.reservationParticipant.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ reservationId: 'm1', userId: 'user-3', isOrganizer: false }),
      }));
      // re-split : 3 joueurs, 8 € chacun → 3 updates de parts
      const updates = (prismaMock.reservationParticipant.update as jest.Mock).mock.calls;
      expect(updates).toHaveLength(3);
      expect(updates.every((c) => Number(c[0].data.share) === 8)).toBe(true);
      expect(mockNotifyJoin).toHaveBeenCalledWith('m1', 'user-3');
    });

    it('un échec d envoi d email ne fait pas échouer le join', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'org', isOrganizer: true }] as any);
      prismaMock.reservationParticipant.create.mockResolvedValue({ id: 'p3' } as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);
      mockNotifyJoin.mockRejectedValue(new Error('SMTP down'));

      await expect(service.joinOpenMatch('club-demo', 'm1', 'user-3')).resolves.toBeDefined();
      expect(mockNotifyJoin).toHaveBeenCalled();
    });

    it('lève MATCH_FULL quand le terrain est complet', async () => {
      happyTx(); lockRow(); resource({ attributes: { format: 'single' } }); // max 2
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);

      await expect(service.joinOpenMatch('club-demo', 'm1', 'user-3')).rejects.toThrow('MATCH_FULL');
      expect(prismaMock.reservationParticipant.create).not.toHaveBeenCalled();
    });

    it('lève ALREADY_JOINED si le joueur est déjà participant', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
        { id: 'p2', userId: 'user-3', isOrganizer: false },
      ] as any);

      await expect(service.joinOpenMatch('club-demo', 'm1', 'user-3')).rejects.toThrow('ALREADY_JOINED');
    });

    it('lève MATCH_NOT_JOINABLE si la partie est privée', async () => {
      happyTx(); lockRow({ visibility: 'PRIVATE' }); resource();
      await expect(service.joinOpenMatch('club-demo', 'm1', 'user-3')).rejects.toThrow('MATCH_NOT_JOINABLE');
    });

    it('lève MATCH_IN_PAST si le créneau est déjà passé', async () => {
      happyTx(); lockRow({ start_time: new Date(Date.now() - 3_600_000) }); resource();
      await expect(service.joinOpenMatch('club-demo', 'm1', 'user-3')).rejects.toThrow('MATCH_IN_PAST');
    });

    it('lève CLUB_MISMATCH si la résa est d un autre club', async () => {
      happyTx(); lockRow(); resource({ clubId: 'autre-club' });
      await expect(service.joinOpenMatch('club-demo', 'm1', 'user-3')).rejects.toThrow('CLUB_MISMATCH');
    });
  });

  describe('leaveOpenMatch', () => {
    const lockRow = () => (prismaMock.$queryRaw as jest.Mock).mockResolvedValue([{ id: 'm1', resource_id: 'court-1', total_price: '24' }]);
    const happyTx = () => prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));

    it('retire le partenaire et re-répartit les parts restantes', async () => {
      happyTx(); lockRow();
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
        { id: 'p2', userId: 'user-3', isOrganizer: false },
        { id: 'p3', userId: 'user-4', isOrganizer: false },
      ] as any);
      prismaMock.reservationParticipant.delete.mockResolvedValue({} as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.leaveOpenMatch('club-demo', 'm1', 'user-3');

      expect(prismaMock.reservationParticipant.delete).toHaveBeenCalledWith({ where: { id: 'p2' } });
      // restants : org + user-4 → 24 € / 2 = 12 € chacun, 2 updates
      const updates = (prismaMock.reservationParticipant.update as jest.Mock).mock.calls;
      expect(updates).toHaveLength(2);
      expect(updates.every((c) => Number(c[0].data.share) === 12)).toBe(true);
    });

    it('lève ORGANIZER_CANNOT_LEAVE si l organisateur tente de quitter', async () => {
      happyTx(); lockRow();
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
      ] as any);

      await expect(service.leaveOpenMatch('club-demo', 'm1', 'org')).rejects.toThrow('ORGANIZER_CANNOT_LEAVE');
      expect(prismaMock.reservationParticipant.delete).not.toHaveBeenCalled();
    });

    it('lève PARTICIPANT_NOT_FOUND si le joueur n est pas dans la partie', async () => {
      happyTx(); lockRow();
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
      ] as any);

      await expect(service.leaveOpenMatch('club-demo', 'm1', 'inconnu')).rejects.toThrow('PARTICIPANT_NOT_FOUND');
    });
  });

  describe('addOpenMatchPlayer', () => {
    const lockRow = (over: Record<string, unknown> = {}) =>
      (prismaMock.$queryRaw as jest.Mock).mockResolvedValue([{
        id: 'm1', status: 'CONFIRMED', visibility: 'PUBLIC', start_time: future(48), resource_id: 'court-1', total_price: '24', ...over,
      }]);
    const happyTx = () => prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    const resource = (over: Record<string, unknown> = {}) =>
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo', attributes: { format: 'double' }, ...over } as any);

    it('l organisateur ajoute un membre actif, re-répartit (24 € / 3 = 8 €) et notifie le joueur ajouté', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);
      prismaMock.reservationParticipant.create.mockResolvedValue({ id: 'p3' } as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3');

      expect(prismaMock.reservationParticipant.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ reservationId: 'm1', userId: 'user-3', isOrganizer: false }),
      }));
      const updates = (prismaMock.reservationParticipant.update as jest.Mock).mock.calls;
      expect(updates).toHaveLength(3);
      expect(updates.every((c) => Number(c[0].data.share) === 8)).toBe(true);
      expect(mockNotifyAdded).toHaveBeenCalledWith('m1', 'user-3');
    });

    it('un non-organisateur ne peut pas ajouter (NOT_ORGANIZER)', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
        { id: 'p2', userId: 'user-3', isOrganizer: false },
      ] as any);
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'user-3', 'user-4')).rejects.toThrow('NOT_ORGANIZER');
      expect(prismaMock.reservationParticipant.create).not.toHaveBeenCalled();
    });

    it('refuse une cible non-membre (MEMBERSHIP_REQUIRED)', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'org', isOrganizer: true }] as any);
      // 1er appel = acteur (resolveActiveMember) ACTIVE ; 2e = cible (dans la tx) null
      (prismaMock.clubMembership.findUnique as jest.Mock).mockReset()
        .mockResolvedValueOnce({ status: 'ACTIVE' } as any)
        .mockResolvedValueOnce(null as any);
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).rejects.toThrow('MEMBERSHIP_REQUIRED');
      expect(prismaMock.reservationParticipant.create).not.toHaveBeenCalled();
    });

    it('refuse une cible bloquée (MEMBERSHIP_BLOCKED)', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'org', isOrganizer: true }] as any);
      (prismaMock.clubMembership.findUnique as jest.Mock).mockReset()
        .mockResolvedValueOnce({ status: 'ACTIVE' } as any)
        .mockResolvedValueOnce({ status: 'BLOCKED' } as any);
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).rejects.toThrow('MEMBERSHIP_BLOCKED');
    });

    it('refuse une cible déjà présente (ALREADY_JOINED)', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
        { id: 'p2', userId: 'user-3', isOrganizer: false },
      ] as any);
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).rejects.toThrow('ALREADY_JOINED');
    });

    it('refuse si la partie est complète (MATCH_FULL)', async () => {
      happyTx(); lockRow(); resource({ attributes: { format: 'single' } }); // max 2
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'org', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).rejects.toThrow('MATCH_FULL');
      expect(prismaMock.reservationParticipant.create).not.toHaveBeenCalled();
    });

    it('refuse une partie passée (MATCH_IN_PAST)', async () => {
      happyTx(); lockRow({ start_time: new Date(Date.now() - 3_600_000) }); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'org', isOrganizer: true }] as any);
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).rejects.toThrow('MATCH_IN_PAST');
    });

    it('un échec d email ne fait pas échouer l ajout', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.reservationParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'org', isOrganizer: true }] as any);
      prismaMock.reservationParticipant.create.mockResolvedValue({ id: 'p3' } as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);
      mockNotifyAdded.mockRejectedValue(new Error('SMTP down'));
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).resolves.toBeDefined();
    });

    it('lève VALIDATION_ERROR si targetUserId est vide ou absent', async () => {
      await expect(service.addOpenMatchPlayer('club-demo', 'm1', 'org', '')).rejects.toThrow('VALIDATION_ERROR');
      expect(prismaMock.reservationParticipant.create).not.toHaveBeenCalled();
    });
  });

  describe('OpenMatchService — intérêt', () => {
    it('setInterested refuse un participant déjà inscrit (ALREADY_PARTICIPANT)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        visibility: 'PUBLIC', status: 'CONFIRMED', startTime: future(),
        resource: { clubId: 'club-demo' },
        participants: [{ userId: 'user-3' }],
      } as any);

      await expect(service.setInterested('club-demo', 'm1', 'user-3')).rejects.toThrow('ALREADY_PARTICIPANT');
    });

    it('setInterested crée la ligne d intérêt (idempotent via upsert)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        visibility: 'PUBLIC', status: 'CONFIRMED', startTime: future(),
        resource: { clubId: 'club-demo' },
        participants: [],
      } as any);
      prismaMock.openMatchInterest.upsert.mockResolvedValue({} as any);

      await service.setInterested('club-demo', 'm1', 'user-3');

      expect(prismaMock.openMatchInterest.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reservationId_userId: { reservationId: 'm1', userId: 'user-3' } },
        }),
      );
    });

    it('removeInterested supprime la ligne (idempotent)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        resource: { clubId: 'club-demo' },
      } as any);
      prismaMock.openMatchInterest.deleteMany.mockResolvedValue({ count: 0 } as any);

      await service.removeInterested('club-demo', 'm1', 'user-3');

      expect(prismaMock.openMatchInterest.deleteMany).toHaveBeenCalledWith({
        where: { reservationId: 'm1', userId: 'user-3' },
      });
    });
  });

  describe('removeOpenMatchPlayer', () => {
    const lockRow = () => (prismaMock.$queryRaw as jest.Mock).mockResolvedValue([{ id: 'm1', start_time: future(48), resource_id: 'court-1', total_price: '24' }]);
    const happyTx = () => prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    const parts = () => prismaMock.reservationParticipant.findMany.mockResolvedValue([
      { id: 'p1', userId: 'org', isOrganizer: true },
      { id: 'p2', userId: 'user-3', isOrganizer: false },
      { id: 'p3', userId: 'user-4', isOrganizer: false },
    ] as any);

    it('l organisateur retire un joueur, re-répartit et notifie le joueur retiré', async () => {
      happyTx(); lockRow(); parts();
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
      prismaMock.reservationParticipant.delete.mockResolvedValue({} as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.removeOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3');

      expect(prismaMock.reservationParticipant.delete).toHaveBeenCalledWith({ where: { id: 'p2' } });
      const updates = (prismaMock.reservationParticipant.update as jest.Mock).mock.calls;
      expect(updates).toHaveLength(2); // org + user-4 → 12 € chacun
      expect(updates.every((c) => Number(c[0].data.share) === 12)).toBe(true);
      expect(mockNotifyRemoved).toHaveBeenCalledWith('m1', 'user-3');
      expect(mockNotifyLeft).not.toHaveBeenCalled();
    });

    it('un non-organisateur ne peut pas retirer un autre joueur (NOT_ORGANIZER)', async () => {
      happyTx(); lockRow(); parts();
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
      await expect(service.removeOpenMatchPlayer('club-demo', 'm1', 'user-3', 'user-4')).rejects.toThrow('NOT_ORGANIZER');
      expect(prismaMock.reservationParticipant.delete).not.toHaveBeenCalled();
    });

    it('on ne peut pas retirer l organisateur (CANNOT_REMOVE_ORGANIZER)', async () => {
      happyTx(); lockRow(); parts();
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
      await expect(service.removeOpenMatchPlayer('club-demo', 'm1', 'org', 'org')).rejects.toThrow('ORGANIZER_CANNOT_LEAVE');
    });

    it('départ volontaire : notifie l organisateur', async () => {
      happyTx(); lockRow(); parts();
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
      prismaMock.reservationParticipant.delete.mockResolvedValue({} as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.removeOpenMatchPlayer('club-demo', 'm1', 'user-3', 'user-3');

      expect(mockNotifyLeft).toHaveBeenCalledWith('m1', 'user-3');
      expect(mockNotifyRemoved).not.toHaveBeenCalled();
    });

    it('un échec d email ne fait pas échouer le retrait', async () => {
      happyTx(); lockRow(); parts();
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
      prismaMock.reservationParticipant.delete.mockResolvedValue({} as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);
      mockNotifyRemoved.mockRejectedValue(new Error('SMTP down'));

      await expect(service.removeOpenMatchPlayer('club-demo', 'm1', 'org', 'user-3')).resolves.toBeDefined();
    });
  });
});
