import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { MemberNotesService } from '../memberNotes.service';

describe('MemberNotesService', () => {
  let service: MemberNotesService;
  beforeEach(() => { service = new MemberNotesService(); });

  it('liste les commentaires avec auteur, plus récents d\'abord', async () => {
    prismaMock.memberNote.findMany.mockResolvedValue([
      { id: 'n1', body: 'Annule souvent', createdAt: new Date('2026-06-23T14:02:00Z'), author: { firstName: 'Sarah', lastName: 'P' } },
      { id: 'n2', body: 'Impayé réglé', createdAt: new Date('2026-06-10T09:30:00Z'), author: null },
    ] as any);
    const out = await service.list('club-1', 'u1');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'n1', body: 'Annule souvent', author: { firstName: 'Sarah', lastName: 'P' } });
    expect(out[1].author).toBeNull();
    expect(prismaMock.memberNote.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clubId: 'club-1', userId: 'u1' }, orderBy: { createdAt: 'desc' },
    }));
  });

  it('ajoute un commentaire (corps trimé, auteur = staff)', async () => {
    prismaMock.memberNote.create.mockResolvedValue({
      id: 'n9', body: 'Nouveau', createdAt: new Date('2026-06-23T15:00:00Z'), author: { firstName: 'Adam', lastName: 'B' },
    } as any);
    const out = await service.add('club-1', 'u1', 'staff-1', '  Nouveau  ');
    expect(out).toMatchObject({ id: 'n9', body: 'Nouveau' });
    expect(prismaMock.memberNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { clubId: 'club-1', userId: 'u1', authorId: 'staff-1', body: 'Nouveau' },
    }));
  });

  it('refuse un corps vide', async () => {
    await expect(service.add('club-1', 'u1', 'staff-1', '   ')).rejects.toThrow('VALIDATION_ERROR');
    expect(prismaMock.memberNote.create).not.toHaveBeenCalled();
  });

  it('supprime un commentaire scopé (club+membre)', async () => {
    prismaMock.memberNote.deleteMany.mockResolvedValue({ count: 1 } as any);
    await service.remove('club-1', 'u1', 'n1');
    expect(prismaMock.memberNote.deleteMany).toHaveBeenCalledWith({ where: { id: 'n1', clubId: 'club-1', userId: 'u1' } });
  });

  it('suppression d\'un id étranger → NOTE_NOT_FOUND', async () => {
    prismaMock.memberNote.deleteMany.mockResolvedValue({ count: 0 } as any);
    await expect(service.remove('club-1', 'u1', 'autre')).rejects.toThrow('NOTE_NOT_FOUND');
  });
});
