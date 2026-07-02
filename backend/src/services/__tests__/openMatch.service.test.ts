import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { OpenMatchService } from '../openMatch.service';

const mockNotifyJoin = jest.fn();
const mockNotifyLeft = jest.fn();
const mockNotifyRemoved = jest.fn();
const mockNotifyAdded = jest.fn();
jest.mock('../../email/notifications', () => ({
  notifyOpenMatchJoin: (...args: unknown[]) => mockNotifyJoin(...args),
  notifyOpenMatchLeft: (...args: unknown[]) => mockNotifyLeft(...args),
  notifyOpenMatchRemoved: (...args: unknown[]) => mockNotifyRemoved(...args),
  notifyOpenMatchAdded: (...args: unknown[]) => mockNotifyAdded(...args),
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
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    // Default: sport found (needed by RatingService.getLevelsBySport in listOpenMatches)
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }] as any);
    // Default: no ratings (additive — tests that need specific ratings override this)
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);
    // Default: aucune notification non lue (listOpenMatches l'utilise pour unreadCount)
    prismaMock.notification.findMany.mockResolvedValue([] as any);
  });

  describe('listOpenMatches', () => {
    it('liste les parties PUBLIC/CONFIRMED à venir avec places restantes et appartenance du viewer', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        {
          id: 'm1', startTime: future(48), endTime: future(49),
          resource: { id: 'court-1', name: 'Court 1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
          participants: [
            { userId: 'org', isOrganizer: true, team: null, user: { firstName: 'Org', lastName: 'A', avatarUrl: null } },
            { userId: 'viewer', isOrganizer: false, team: null, user: { firstName: 'V', lastName: 'B', avatarUrl: null } },
          ],          openMatchMessages: [],
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
      // Chaque joueur reçoit un côté concret 1 ou 2 (dérivé), jamais null.
      const match = out[0];
      for (const player of match.players) {
        expect([1, 2]).toContain(player.team);
      }
      // Répartition par défaut (null → 1,1,2,2) : au plus la moitié par côté.
      const side1 = match.players.filter((p: any) => p.team === 1).length;
      expect(side1).toBeLessThanOrEqual(match.maxPlayers / 2);
    });

    it('expose une place G/D concrète (slot) par joueur — slot explicite honoré, les autres comblés', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        {
          id: 'm1', startTime: future(48), endTime: future(49),
          resource: { id: 'court-1', name: 'Court 1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel', name: 'Padel' } } },
          participants: [
            { userId: 'org', isOrganizer: true, team: 1, slot: 1, user: { firstName: 'Org', lastName: 'A', avatarUrl: null } },
            { userId: 'viewer', isOrganizer: false, team: 1, slot: null, user: { firstName: 'V', lastName: 'B', avatarUrl: null } },
          ],          openMatchMessages: [],
        },
      ] as any);

      const out = await service.listOpenMatches('club-demo', 'viewer');

      const byId = Object.fromEntries(out[0].players.map((p: any) => [p.userId, p]));
      expect(byId.org).toMatchObject({ team: 1, slot: 1 });      // slot explicite honoré (D)
      expect(byId.viewer).toMatchObject({ team: 1, slot: 0 });   // non assigné → comble G
    });

    it('expose le sport du terrain sur chaque partie', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        {
          id: 'm1', startTime: future(48), endTime: future(49),
          resource: { id: 'court-1', name: 'Court 1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel', name: 'Padel' } } },
          participants: [], openMatchMessages: [],
        },
      ] as any);

      const [match] = await service.listOpenMatches('club-demo', 'viewer');

      expect(match.sport).toEqual({ key: 'padel', name: 'Padel' });
    });

    it('ne remonte que les parties padel (filtre clubSport.sport.key)', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([] as any);
      await service.listOpenMatches('club-demo', 'viewer');
      const where = (prismaMock.reservation.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.resource.clubSport.sport.key).toBe('padel');
    });

    it('ne requiert PAS d adhésion : un non-membre ou un anonyme voit la liste', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any); // non-membre
      prismaMock.reservation.findMany.mockResolvedValue([] as any);
      await expect(service.listOpenMatches('club-demo', 'viewer')).resolves.toEqual([]);
      await expect(service.listOpenMatches('club-demo', null)).resolves.toEqual([]);
    });

    it('viewer anonyme (null) : tous les flags viewer sont false', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        {
          id: 'm1', startTime: future(48), endTime: future(49),
          resource: { id: 'court-1', name: 'Court 1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
          participants: [{ userId: 'org', isOrganizer: true, user: { firstName: 'O', lastName: 'A', avatarUrl: null } }],
          openMatchMessages: [],
        },
      ] as any);

      const out = await service.listOpenMatches('club-demo', null);

      expect(out[0].viewerIsParticipant).toBe(false);
      expect(out[0].viewerIsOrganizer).toBe(false);
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
          ],          openMatchMessages: [],
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
          ],          openMatchMessages: [],
        },
        {
          id: 'match-tennis', startTime: future(48), endTime: future(49),
          resource: { id: 'court-tennis', name: 'Court Tennis', attributes: { format: 'double' }, clubSport: { sport: { key: 'tennis' } } },
          participants: [
            { userId: 'player-a', isOrganizer: false, user: { firstName: 'Alice', lastName: 'A', avatarUrl: null } },
          ],          openMatchMessages: [],
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

    it('annote chaque partie avec unreadCount issu des notifications non lues', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        {
          id: 'rOpen', startTime: future(48), endTime: future(49),
          resource: { id: 'court-1', name: 'Court 1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
          participants: [{ userId: 'org', isOrganizer: true, user: { firstName: 'Org', lastName: 'A', avatarUrl: null } }],          openMatchMessages: [],
        },
        {
          id: 'rOther', startTime: future(72), endTime: future(73),
          resource: { id: 'court-2', name: 'Court 2', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
          participants: [{ userId: 'org', isOrganizer: true, user: { firstName: 'Org', lastName: 'A', avatarUrl: null } }],          openMatchMessages: [],
        },
      ] as any);

      // 2 notifications non lues pour rOpen, aucune pour rOther
      prismaMock.notification.findMany.mockResolvedValue([
        { data: { matchId: 'rOpen' } },
        { data: { matchId: 'rOpen' } },
      ] as any);

      const out = await service.listOpenMatches('club-demo', 'viewer');

      const open = out.find((m: any) => m.id === 'rOpen');
      const other = out.find((m: any) => m.id === 'rOther');
      expect(open?.unreadCount).toBe(2);
      expect(other?.unreadCount).toBe(0);
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

    it('un non-membre qui rejoint voit son adhésion ACTIVE créée à la volée', async () => {
      happyTx(); lockRow(); resource();
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any); // non-membre
      prismaMock.clubMembership.create.mockResolvedValue({} as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'org', isOrganizer: true }] as any);
      prismaMock.reservationParticipant.create.mockResolvedValue({ id: 'p2' } as any);
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.joinOpenMatch('club-demo', 'm1', 'user-new');

      expect(prismaMock.clubMembership.create).toHaveBeenCalledWith({ data: { userId: 'user-new', clubId: 'club-demo' } });
      expect(prismaMock.reservationParticipant.create).toHaveBeenCalled();
    });

    it('un membre BLOCKED ne peut pas rejoindre (MEMBERSHIP_BLOCKED)', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED' } as any);
      await expect(service.joinOpenMatch('club-demo', 'm1', 'user-3')).rejects.toThrow('MEMBERSHIP_BLOCKED');
      expect(prismaMock.reservationParticipant.create).not.toHaveBeenCalled();
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

  describe('setTeams', () => {
    // FOR UPDATE lock : start_time + resource_id (pas d'autre colonne nécessaire).
    const lockRow = (over: Record<string, unknown> = {}) =>
      (prismaMock.$queryRaw as jest.Mock).mockResolvedValue([{ start_time: future(48), resource_id: 'court-1', ...over }]);
    const happyTx = () => prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    const resource = (over: Record<string, unknown> = {}) =>
      prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo', attributes: { format: 'double' }, ...over } as any);
    // findMany est appelé 2× (acteur puis applyTeams) ; le mock renvoie le même tableau,
    // qui porte id + userId + isOrganizer pour couvrir les deux select.
    const parts = () => prismaMock.reservationParticipant.findMany.mockResolvedValue([
      { id: 'p1', userId: 'org', isOrganizer: true },
      { id: 'p2', userId: 'user-2', isOrganizer: false },
      { id: 'p3', userId: 'user-3', isOrganizer: false },
      { id: 'p4', userId: 'user-4', isOrganizer: false },
    ] as any);

    it('persiste les côtés choisis pour une partie 2v2 (organisateur)', async () => {
      happyTx(); lockRow(); resource(); parts();
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.setTeams('club-demo', 'm1', 'org', {
        org: 2, 'user-2': 2, 'user-3': 1, 'user-4': 1,
      });

      // Reconstruit id → côté depuis les updates persistés (mock prisma : pas de round-trip DB).
      const byId: Record<string, number> = {};
      for (const call of (prismaMock.reservationParticipant.update as jest.Mock).mock.calls) {
        byId[call[0].where.id] = call[0].data.team;
      }
      const team1 = Object.keys(byId).filter((id) => byId[id] === 1).sort();
      const team2 = Object.keys(byId).filter((id) => byId[id] === 2).sort();
      expect(team1).toEqual(['p3', 'p4']); // user-3 + user-4 côté 1
      expect(team2).toEqual(['p1', 'p2']); // org + user-2 côté 2
    });

    it('persiste aussi les places G/D quand slots est fourni', async () => {
      happyTx(); lockRow(); resource(); parts();
      prismaMock.reservationParticipant.update.mockResolvedValue({} as any);

      await service.setTeams('club-demo', 'm1', 'org',
        { org: 1, 'user-2': 1, 'user-3': 2, 'user-4': 2 },
        { org: 1, 'user-2': 0, 'user-3': 0, 'user-4': 1 });

      const byId: Record<string, { team: number; slot?: number }> = {};
      for (const call of (prismaMock.reservationParticipant.update as jest.Mock).mock.calls) {
        byId[call[0].where.id] = call[0].data;
      }
      expect(byId.p1).toEqual({ team: 1, slot: 1 });
      expect(byId.p2).toEqual({ team: 1, slot: 0 });
      expect(byId.p3).toEqual({ team: 2, slot: 0 });
      expect(byId.p4).toEqual({ team: 2, slot: 1 });
    });

    it('refuse deux joueurs sur la même place (TEAM_SLOT_TAKEN)', async () => {
      happyTx(); lockRow(); resource(); parts();
      await expect(service.setTeams('club-demo', 'm1', 'org',
        { org: 1, 'user-2': 1, 'user-3': 2, 'user-4': 2 },
        { org: 0, 'user-2': 0, 'user-3': 0, 'user-4': 1 },
      )).rejects.toThrow('TEAM_SLOT_TAKEN');
    });

    it('refuse un côté sur-rempli (TEAM_SIDE_FULL)', async () => {
      happyTx(); lockRow(); resource(); parts();
      await expect(service.setTeams('club-demo', 'm1', 'org', {
        org: 1, 'user-2': 1, 'user-3': 1, 'user-4': 2,
      })).rejects.toThrow('TEAM_SIDE_FULL');
    });

    it('refuse un non-organisateur (NOT_ORGANIZER)', async () => {
      happyTx(); lockRow(); resource(); parts();
      await expect(service.setTeams('club-demo', 'm1', 'user-2', {
        org: 1, 'user-2': 2, 'user-3': 1, 'user-4': 2,
      })).rejects.toThrow('NOT_ORGANIZER');
    });
  });

  describe('getOpenMatch', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      id: 'm1', startTime: future(48), endTime: future(49),
      visibility: 'PUBLIC', status: 'CONFIRMED',
      targetLevelMin: null, targetLevelMax: null,
      resource: { id: 'court-1', name: 'Court 1', attributes: { format: 'double' }, clubId: 'club-demo', clubSport: { sport: { key: 'padel', name: 'Padel' } } },
      participants: [
        { userId: 'org', isOrganizer: true, team: null, user: { firstName: 'Org', lastName: 'A', avatarUrl: null } },
      ],
      openMatchMessages: [],
      ...over,
    });

    it('renvoie la partie avec les flags du viewer (membre)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row() as any);
      const out = await service.getOpenMatch('club-demo', 'm1', 'org');
      expect(out.id).toBe('m1');
      expect(out.resourceName).toBe('Court 1');
      expect(out.sport).toEqual({ key: 'padel', name: 'Padel' });
      expect(out.maxPlayers).toBe(4);
      expect(out.spotsLeft).toBe(3);
      expect(out.viewerIsOrganizer).toBe(true);
      expect(out.viewerIsParticipant).toBe(true);
      for (const p of out.players) expect([1, 2]).toContain(p.team);
    });

    it('renvoie la partie pour un viewer anonyme (flags à false)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row() as any);
      const out = await service.getOpenMatch('club-demo', 'm1', null);
      expect(out.viewerIsParticipant).toBe(false);
      expect(out.viewerIsOrganizer).toBe(false);
      expect(out.unreadCount).toBe(0);
    });

    it('autorise une partie déjà passée (lien partagé résout toujours)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ startTime: new Date(Date.now() - 3_600_000), endTime: new Date() }) as any);
      const out = await service.getOpenMatch('club-demo', 'm1', null);
      expect(out.id).toBe('m1');
    });

    it('404 RESERVATION_NOT_FOUND si introuvable', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(null as any);
      await expect(service.getOpenMatch('club-demo', 'nope', null)).rejects.toThrow('RESERVATION_NOT_FOUND');
    });

    it('404 si visibilité non PUBLIC', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ visibility: 'PRIVATE' }) as any);
      await expect(service.getOpenMatch('club-demo', 'm1', null)).rejects.toThrow('RESERVATION_NOT_FOUND');
    });

    it('404 si la partie appartient à un autre club', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ resource: { id: 'c', name: 'X', attributes: {}, clubId: 'autre-club', clubSport: { sport: { key: 'padel', name: 'Padel' } } } }) as any);
      await expect(service.getOpenMatch('club-demo', 'm1', null)).rejects.toThrow('RESERVATION_NOT_FOUND');
    });

    it('404 si le sport n’est pas le padel', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({ resource: { id: 'c', name: 'X', attributes: {}, clubId: 'club-demo', clubSport: { sport: { key: 'tennis', name: 'Tennis' } } } }) as any);
      await expect(service.getOpenMatch('club-demo', 'm1', null)).rejects.toThrow('RESERVATION_NOT_FOUND');
    });
  });
});
