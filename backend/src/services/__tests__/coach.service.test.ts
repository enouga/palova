import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { CoachService, coachDisplay } from '../coach.service';

describe('coachDisplay', () => {
  it('dérive nom/photo du user lié quand présent', () => {
    expect(coachDisplay({
      name: 'Ancien nom', photoUrl: '/old.jpg',
      user: { firstName: 'Paul', lastName: 'Martin', avatarUrl: '/avatars/paul.jpg' },
    })).toEqual({ name: 'Paul Martin', photoUrl: '/avatars/paul.jpg' });
  });

  it('repli sur les colonnes Coach pour un coach legacy sans user', () => {
    expect(coachDisplay({ name: 'Coach Legacy', photoUrl: '/legacy.jpg' }))
      .toEqual({ name: 'Coach Legacy', photoUrl: '/legacy.jpg' });
  });

  it('user lié sans avatar → photoUrl null (pas le repli sur la colonne Coach)', () => {
    expect(coachDisplay({ name: 'Ancien nom', photoUrl: '/old.jpg', user: { firstName: 'Paul', lastName: 'Martin', avatarUrl: null } }))
      .toEqual({ name: 'Paul Martin', photoUrl: null });
  });
});

describe('CoachService', () => {
  let service: CoachService;
  beforeEach(() => { service = new CoachService(); });

  it('listAdmin trie actifs d abord puis sortOrder puis nom, et dérive nom/photo du user lié', async () => {
    prismaMock.coach.findMany.mockResolvedValue([
      { id: 'c1', clubId: 'club-demo', name: 'Ancien', photoUrl: null, isActive: true, sortOrder: 0,
        user: { firstName: 'Paul', lastName: 'Martin', avatarUrl: '/p.jpg' } },
      { id: 'c2', clubId: 'club-demo', name: 'Coach Legacy', photoUrl: '/legacy.jpg', isActive: true, sortOrder: 1, user: null },
    ] as any);

    const rows = await service.listAdmin('club-demo');

    expect(prismaMock.coach.findMany).toHaveBeenCalledWith({
      where: { clubId: 'club-demo' },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
    });
    expect(rows[0]).toEqual({ id: 'c1', clubId: 'club-demo', isActive: true, sortOrder: 0, name: 'Paul Martin', photoUrl: '/p.jpg' });
    expect(rows[1]).toEqual({ id: 'c2', clubId: 'club-demo', isActive: true, sortOrder: 1, name: 'Coach Legacy', photoUrl: '/legacy.jpg' });
  });

  describe('setMemberCoach', () => {
    it('MEMBER_NOT_FOUND si la cible n est pas membre du club', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
      await expect(service.setMemberCoach('club-demo', 'u1', true)).rejects.toThrow('MEMBER_NOT_FOUND');
      expect(prismaMock.coach.create).not.toHaveBeenCalled();
    });

    it('coche : crée la ligne Coach avec le nom snapshoté depuis le user', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any);
      prismaMock.coach.findUnique.mockResolvedValue(null as any);
      prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Paul', lastName: 'Martin' } as any);
      prismaMock.coach.create.mockResolvedValue({ id: 'c1' } as any);

      const r = await service.setMemberCoach('club-demo', 'u1', true);

      expect(prismaMock.coach.create).toHaveBeenCalledWith({
        data: { clubId: 'club-demo', userId: 'u1', name: 'Paul Martin', isActive: true },
      });
      expect(r).toEqual({ userId: 'u1', isCoach: true });
    });

    it('coche : réactive une ligne Coach désactivée existante (pas de re-création)', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any);
      prismaMock.coach.findUnique.mockResolvedValue({ id: 'c1', isActive: false } as any);

      await service.setMemberCoach('club-demo', 'u1', true);

      expect(prismaMock.coach.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isActive: true } });
      expect(prismaMock.coach.create).not.toHaveBeenCalled();
    });

    it('coche : no-op si déjà coach actif', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any);
      prismaMock.coach.findUnique.mockResolvedValue({ id: 'c1', isActive: true } as any);

      await service.setMemberCoach('club-demo', 'u1', true);

      expect(prismaMock.coach.update).not.toHaveBeenCalled();
      expect(prismaMock.coach.create).not.toHaveBeenCalled();
    });

    it('décoche : soft-disable (idempotent même sans ligne existante)', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any);
      prismaMock.coach.updateMany.mockResolvedValue({ count: 0 } as any);

      const r = await service.setMemberCoach('club-demo', 'u1', false);

      expect(prismaMock.coach.updateMany).toHaveBeenCalledWith({ where: { clubId: 'club-demo', userId: 'u1' }, data: { isActive: false } });
      expect(r).toEqual({ userId: 'u1', isCoach: false });
    });
  });
});
