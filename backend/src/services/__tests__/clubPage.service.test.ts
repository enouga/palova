import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { ClubPageService } from '../clubPage.service';

const svc = new ClubPageService();

const activeClub = { id: 'club-1', status: 'ACTIVE' };

const socleClubFields = {
  id: 'club-1', status: 'ACTIVE', name: 'Padel Arena', slug: 'arena',
  publicBookingDays: 7, memberBookingDays: 14,
  cancellationCutoffHours: 24, playerChangeCutoffHours: 0,
  refundOnCancelWithinCutoff: true, requireOnlinePayment: false,
  legalEmail: 'contact@arena.fr', legalPhone: null,
};

const templateClubFields = {
  id: 'club-1', name: 'Padel Arena', legalEntityName: 'Padel Arena SAS', legalForm: 'SAS',
  siret: '123', vatNumber: null, legalRepresentative: 'Camille', legalEmail: 'c@a.fr',
  legalPhone: null, address: '12 rue', city: 'Lyon',
};

describe('ClubPageService.getPublicPage', () => {
  it('CLUB_NOT_FOUND si le club est introuvable / suspendu', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(svc.getPublicPage('arena', 'CGV')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('PAGE_NOT_FOUND si aucune page OFFRES publiée (pas de repli commercial)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(activeClub as any);
    prismaMock.clubPage.findFirst.mockResolvedValue(null as any);
    await expect(svc.getPublicPage('arena', 'OFFRES')).rejects.toThrow('PAGE_NOT_FOUND');
    const arg = (prismaMock.clubPage.findFirst as jest.Mock).mock.calls[0][0];
    expect(arg.where).toMatchObject({ clubId: 'club-1', kind: 'OFFRES', published: true });
  });

  it('renvoie la page publiée (kind, markdown, updatedAt, isFallback false)', async () => {
    const when = new Date('2026-06-16T00:00:00Z');
    prismaMock.club.findUnique.mockResolvedValue(activeClub as any);
    prismaMock.clubPage.findFirst.mockResolvedValue({ kind: 'CGV', bodyMarkdown: '# CGV', published: true, updatedAt: when } as any);
    await expect(svc.getPublicPage('arena', 'CGV')).resolves.toEqual({ kind: 'CGV', bodyMarkdown: '# CGV', updatedAt: when, isFallback: false });
  });
});

describe('ClubPageService.getPublicPage — repli légal', () => {
  const legalClubFields = {
    id: 'c1', status: 'ACTIVE', name: 'Padel Arena',
    legalEntityName: 'Arena SAS', legalForm: 'SAS', siret: '123', vatNumber: null,
    legalRepresentative: null, legalEmail: null, legalPhone: null, address: '12 rue', city: 'Paris',
    mediatorName: null, mediatorUrl: null,
  };

  it('page non publiée + kind légal → modèle rendu avec isFallback', async () => {
    prismaMock.club.findUnique.mockResolvedValue(legalClubFields as any);
    prismaMock.clubPage.findFirst.mockResolvedValue(null as any);
    const p = await svc.getPublicPage('padel-arena', 'CGV');
    expect(p.isFallback).toBe(true);
    expect(p.updatedAt).toBeNull();
    expect(p.bodyMarkdown).toContain('Arena SAS');
  });

  it('page publiée → contenu du club, isFallback false', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      id: 'c1', status: 'ACTIVE', name: 'X',
      legalEntityName: null, legalForm: null, siret: null, vatNumber: null, legalRepresentative: null,
      legalEmail: null, legalPhone: null, address: '', city: null, mediatorName: null, mediatorUrl: null,
    } as any);
    prismaMock.clubPage.findFirst.mockResolvedValue({ kind: 'CGV', bodyMarkdown: '# Mes CGV', updatedAt: new Date() } as any);
    const p = await svc.getPublicPage('x', 'CGV');
    expect(p.isFallback).toBe(false);
    expect(p.bodyMarkdown).toBe('# Mes CGV');
  });

  it('OFFRES non publiée → PAGE_NOT_FOUND (pas de repli commercial)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      id: 'c1', status: 'ACTIVE', name: 'X',
      legalEntityName: null, legalForm: null, siret: null, vatNumber: null, legalRepresentative: null,
      legalEmail: null, legalPhone: null, address: '', city: null, mediatorName: null, mediatorUrl: null,
    } as any);
    prismaMock.clubPage.findFirst.mockResolvedValue(null as any);
    await expect(svc.getPublicPage('x', 'OFFRES')).rejects.toThrow('PAGE_NOT_FOUND');
  });
});

describe('ClubPageService.getPublicFaq', () => {
  it('CLUB_NOT_FOUND si club introuvable', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(svc.getPublicFaq('arena')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('fusionne le socle interpolé et les items publiés du club (triés)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(socleClubFields as any);
    prismaMock.clubFaqItem.findMany.mockResolvedValue([
      { id: 'f1', question: 'Parking ?', answerMarkdown: 'Oui, gratuit.', category: 'Accès' },
    ] as any);
    const res = await svc.getPublicFaq('arena');
    expect(res.socle.length).toBeGreaterThan(5);
    expect(res.socle.find((s) => s.id === 'annuler')!.answer).toContain('24'); // interpolé
    expect(res.custom).toEqual([{ id: 'f1', category: 'Accès', question: 'Parking ?', answer: 'Oui, gratuit.' }]);
    const arg = (prismaMock.clubFaqItem.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where).toMatchObject({ clubId: 'club-1', published: true });
    expect(arg.orderBy).toEqual({ sortOrder: 'asc' });
  });
});

describe('ClubPageService.upsertPage', () => {
  it('VALIDATION_ERROR si markdown vide', async () => {
    await expect(svc.upsertPage('club-1', 'CGV', { bodyMarkdown: '   ' })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('upsert avec source CUSTOM et le markdown fourni', async () => {
    prismaMock.clubPage.upsert.mockResolvedValue({ id: 'p1' } as any);
    await svc.upsertPage('club-1', 'CGV', { bodyMarkdown: '# Mes CGV', published: true });
    const arg = (prismaMock.clubPage.upsert as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ clubId_kind: { clubId: 'club-1', kind: 'CGV' } });
    expect(arg.create).toMatchObject({ clubId: 'club-1', kind: 'CGV', bodyMarkdown: '# Mes CGV', published: true, source: 'CUSTOM' });
    expect(arg.update).toMatchObject({ bodyMarkdown: '# Mes CGV', published: true, source: 'CUSTOM' });
  });
});

describe('ClubPageService.renderTemplate', () => {
  it('CLUB_NOT_FOUND si club introuvable', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(svc.renderTemplate('club-1', 'MENTIONS_LEGALES')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('renvoie le markdown du modèle interpolé', async () => {
    prismaMock.club.findUnique.mockResolvedValue(templateClubFields as any);
    const md = await svc.renderTemplate('club-1', 'MENTIONS_LEGALES');
    expect(md).toContain('Padel Arena SAS');
    expect(md).toContain('Mentions légales');
  });
});

describe('ClubPageService — FAQ CRUD', () => {
  it('createFaqItem : VALIDATION_ERROR si question ou réponse vide', async () => {
    await expect(svc.createFaqItem('club-1', { question: '  ', answerMarkdown: 'x' })).rejects.toThrow('VALIDATION_ERROR');
    await expect(svc.createFaqItem('club-1', { question: 'Q', answerMarkdown: '  ' })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('createFaqItem : place l\'item en fin de liste (sortOrder = max+1)', async () => {
    prismaMock.clubFaqItem.findFirst.mockResolvedValue({ sortOrder: 4 } as any);
    prismaMock.clubFaqItem.create.mockResolvedValue({ id: 'f9' } as any);
    await svc.createFaqItem('club-1', { question: 'Q', answerMarkdown: 'A', category: 'Accès' });
    const arg = (prismaMock.clubFaqItem.create as jest.Mock).mock.calls[0][0];
    expect(arg.data).toMatchObject({ clubId: 'club-1', question: 'Q', answerMarkdown: 'A', category: 'Accès', sortOrder: 5 });
  });

  it('updateFaqItem : FAQ_ITEM_NOT_FOUND si l\'item n\'appartient pas au club', async () => {
    prismaMock.clubFaqItem.findUnique.mockResolvedValue({ clubId: 'autre' } as any);
    await expect(svc.updateFaqItem('f1', 'club-1', { question: 'Q' })).rejects.toThrow('FAQ_ITEM_NOT_FOUND');
  });

  it('deleteFaqItem : FAQ_ITEM_NOT_FOUND si introuvable', async () => {
    prismaMock.clubFaqItem.findUnique.mockResolvedValue(null as any);
    await expect(svc.deleteFaqItem('f1', 'club-1')).rejects.toThrow('FAQ_ITEM_NOT_FOUND');
  });

  it('reorderFaq : met à jour sortOrder selon l\'ordre fourni (scopé club)', async () => {
    prismaMock.$transaction.mockImplementation(async (ops: any) => ops);
    await svc.reorderFaq('club-1', ['b', 'a', 'c']);
    const ops = (prismaMock.$transaction as jest.Mock).mock.calls[0][0];
    expect(prismaMock.clubFaqItem.updateMany).toHaveBeenCalledTimes(3);
    const calls = (prismaMock.clubFaqItem.updateMany as jest.Mock).mock.calls;
    expect(calls[0][0]).toEqual({ where: { id: 'b', clubId: 'club-1' }, data: { sortOrder: 0 } });
    expect(calls[1][0]).toEqual({ where: { id: 'a', clubId: 'club-1' }, data: { sortOrder: 1 } });
    expect(calls[2][0]).toEqual({ where: { id: 'c', clubId: 'club-1' }, data: { sortOrder: 2 } });
  });
});
