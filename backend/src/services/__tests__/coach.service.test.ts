import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { CoachService } from '../coach.service';

describe('CoachService', () => {
  let service: CoachService;
  beforeEach(() => { service = new CoachService(); });

  it('create normalise name/bio (trim, vide → null) et défauts', async () => {
    prismaMock.coach.create.mockResolvedValue({ id: 'c1' } as any);
    await service.create('club-demo', { name: '  Paul  ', bio: '   ' });
    expect(prismaMock.coach.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clubId: 'club-demo', name: 'Paul', bio: null, isActive: true, sortOrder: 0, photoUrl: null }),
    }));
  });

  it('create rejette VALIDATION_ERROR si name vide', async () => {
    await expect(service.create('club-demo', { name: '   ' })).rejects.toThrow('VALIDATION_ERROR');
    expect(prismaMock.coach.create).not.toHaveBeenCalled();
  });

  it('update ignore les champs non fournis', async () => {
    prismaMock.coach.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
    prismaMock.coach.update.mockResolvedValue({ id: 'c1' } as any);
    await service.update('c1', 'club-demo', { name: 'Paul Pro' });
    expect(prismaMock.coach.update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'Paul Pro' } }));
  });

  it('update rejette COACH_NOT_FOUND si autre club', async () => {
    prismaMock.coach.findUnique.mockResolvedValue({ clubId: 'autre' } as any);
    await expect(service.update('c1', 'club-demo', { name: 'x' })).rejects.toThrow('COACH_NOT_FOUND');
  });

  it('remove = soft delete (isActive=false), garde-fou club', async () => {
    prismaMock.coach.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
    prismaMock.coach.update.mockResolvedValue({ id: 'c1' } as any);
    await service.remove('c1', 'club-demo');
    expect(prismaMock.coach.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isActive: false } });
  });

  it('listAdmin trie actifs d abord puis sortOrder puis nom', async () => {
    prismaMock.coach.findMany.mockResolvedValue([] as any);
    await service.listAdmin('club-demo');
    expect(prismaMock.coach.findMany).toHaveBeenCalledWith({
      where: { clubId: 'club-demo' },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  });
});
