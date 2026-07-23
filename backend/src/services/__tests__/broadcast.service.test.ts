import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

jest.mock('../notification/dispatcher', () => ({ dispatch: jest.fn() }));
const { dispatch } = require('../notification/dispatcher') as { dispatch: jest.Mock };

import { BroadcastService, normalizeBroadcastChannels } from '../broadcast.service';

describe('BroadcastService', () => {
  let service: BroadcastService;

  beforeEach(() => {
    service = new BroadcastService();
    dispatch.mockReset();
    dispatch.mockResolvedValue(undefined);
  });

  const club = {
    name: 'Padel Arena', slug: 'padel-arena', logoUrl: null, accentColor: '#1a2b3c',
  };

  describe('countActiveMembers', () => {
    it('returns the count of ACTIVE memberships', async () => {
      prismaMock.clubMembership.count.mockResolvedValue(7);
      const count = await service.countActiveMembers('club-1');
      expect(count).toBe(7);
      expect(prismaMock.clubMembership.count).toHaveBeenCalledWith({
        where: { clubId: 'club-1', status: 'ACTIVE' },
      });
    });
  });

  describe('history', () => {
    it('calls findMany with clubId, desc order and take 50', async () => {
      prismaMock.clubBroadcast.findMany.mockResolvedValue([]);
      await service.history('club-1');
      expect(prismaMock.clubBroadcast.findMany).toHaveBeenCalledWith({
        where: { clubId: 'club-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });
  });

  describe('send', () => {
    it('throws VALIDATION_ERROR on empty title', async () => {
      await expect(service.send('c1', 'u1', { title: '  ', bodyHtml: '<p>Hello</p>' }))
        .rejects.toThrow('VALIDATION_ERROR');
    });

    it('throws VALIDATION_ERROR when the HTML body has no real content', async () => {
      await expect(service.send('c1', 'u1', { title: 'Hi', bodyHtml: '<p>   </p>' }))
        .rejects.toThrow('VALIDATION_ERROR');
    });

    it('stores plain text in body + rich HTML in bodyHtml, dispatches plain text per member', async () => {
      const members = [
        { user: { id: 'u1', email: 'a@x.fr', firstName: 'Alice', lastName: 'A' } },
        { user: { id: 'u2', email: null, firstName: 'Bob', lastName: 'B' } },
      ];
      prismaMock.club.findUniqueOrThrow.mockResolvedValue(club as any);
      prismaMock.clubMembership.findMany.mockResolvedValue(members as any);
      prismaMock.clubBroadcast.create.mockResolvedValue({ id: 'bc-1' } as any);
      prismaMock.notificationPreference.count.mockResolvedValue(0);

      const result = await service.send('club-1', 'staff-1', {
        title: 'News',
        bodyHtml: '<p>Bonjour <strong>tous</strong></p>',
      });

      expect(result.broadcastId).toBe('bc-1');
      expect(result.recipientCount).toBe(2);

      const data = (prismaMock.clubBroadcast.create.mock.calls[0][0] as any).data;
      expect(data).toMatchObject({ clubId: 'club-1', sentByUserId: 'staff-1', title: 'News', recipientCount: 2 });
      expect(data.body).toBe('Bonjour tous');              // texte brut dérivé (in-app/push/historique)
      expect(data.bodyHtml).toContain('<strong>tous</strong>'); // HTML riche assaini (email)

      expect(dispatch).toHaveBeenCalledTimes(2);
      // La notif in-app / push garde du TEXTE BRUT (jamais de HTML).
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', body: 'Bonjour tous' }));
      // Le membre avec email reçoit l'email riche.
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'u1',
        email: expect.objectContaining({ to: 'a@x.fr', html: expect.stringContaining('<strong>tous</strong>') }),
      }));
      // Le membre sans email : pas de payload email.
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2', email: null }));
    });

    it('sanitizes the HTML body: strips scripts, keeps /uploads images', async () => {
      prismaMock.club.findUniqueOrThrow.mockResolvedValue(club as any);
      prismaMock.clubMembership.findMany.mockResolvedValue([{ user: { id: 'u1', email: 'a@x.fr', firstName: 'A', lastName: 'A' } }] as any);
      prismaMock.clubBroadcast.create.mockResolvedValue({ id: 'bc-2' } as any);
      prismaMock.notificationPreference.count.mockResolvedValue(0);

      await service.send('club-1', 'staff-1', {
        title: 'Promo',
        bodyHtml: '<p>Voir</p><script>alert(1)</script><img src="/uploads/email-images/x.png">',
      });

      const data = (prismaMock.clubBroadcast.create.mock.calls[0][0] as any).data;
      expect(data.bodyHtml).not.toContain('<script');
      expect(data.bodyHtml).toContain('/uploads/email-images/x.png');
    });

    it('email seul : dispatch avec email + plafond email seul, cloche/push coupés', async () => {
      prismaMock.club.findUniqueOrThrow.mockResolvedValue(club as any);
      prismaMock.clubMembership.findMany.mockResolvedValue([{ user: { id: 'u1', email: 'a@x.fr', firstName: 'A', lastName: 'A' } }] as any);
      prismaMock.clubBroadcast.create.mockResolvedValue({ id: 'bc' } as any);
      prismaMock.notificationPreference.count.mockResolvedValue(0);

      await service.send('club-1', 'staff-1', { title: 'N', bodyHtml: '<p>Hi</p>', channels: { email: true, inApp: false, push: false } });

      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        email: expect.objectContaining({ to: 'a@x.fr' }),
        allowChannels: { inapp: false, email: true, push: false },
      }));
    });

    it('cloche seule : aucun email construit (email=null), plafond email false', async () => {
      prismaMock.club.findUniqueOrThrow.mockResolvedValue(club as any);
      prismaMock.clubMembership.findMany.mockResolvedValue([{ user: { id: 'u1', email: 'a@x.fr', firstName: 'A', lastName: 'A' } }] as any);
      prismaMock.clubBroadcast.create.mockResolvedValue({ id: 'bc' } as any);
      prismaMock.notificationPreference.count.mockResolvedValue(0);

      await service.send('club-1', 'staff-1', { title: 'N', bodyHtml: '<p>Hi</p>', channels: { email: false, inApp: true, push: true } });

      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        email: null,
        allowChannels: { inapp: true, email: false, push: true },
      }));
    });

    it('aucun canal (email off + cloche off) → VALIDATION_ERROR', async () => {
      await expect(service.send('c1', 'u1', { title: 'Hi', bodyHtml: '<p>x</p>', channels: { email: false, inApp: false, push: false } }))
        .rejects.toThrow('VALIDATION_ERROR');
    });
  });

  describe('normalizeBroadcastChannels', () => {
    it('défaut = tout activé (rétro-compat)', () => {
      expect(normalizeBroadcastChannels()).toEqual({ email: true, inApp: true, push: true });
      expect(normalizeBroadcastChannels(undefined)).toEqual({ email: true, inApp: true, push: true });
    });
    it('push impossible sans la cloche', () => {
      expect(normalizeBroadcastChannels({ email: true, inApp: false, push: true })).toEqual({ email: true, inApp: false, push: false });
    });
    it('respecte les choix explicites', () => {
      expect(normalizeBroadcastChannels({ email: false, inApp: true, push: false })).toEqual({ email: false, inApp: true, push: false });
    });
  });

  describe('preview', () => {
    it('renders branded HTML without sending or persisting', async () => {
      prismaMock.club.findUniqueOrThrow.mockResolvedValue(club as any);
      const out = await service.preview('club-1', { title: 'Hi', bodyHtml: '<p>Hello <em>world</em></p>' });
      expect(out.html).toContain('world');
      expect(prismaMock.clubBroadcast.create).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});

describe('BroadcastService — envoi ciblé', () => {
  beforeEach(() => {
    dispatch.mockReset();
    dispatch.mockResolvedValue(undefined);
    const club = {
      name: 'Padel Arena', slug: 'padel-arena', logoUrl: null, accentColor: '#1a2b3c',
    };
    prismaMock.club.findUniqueOrThrow.mockResolvedValue(club as any);
    prismaMock.clubBroadcast.create.mockResolvedValue({ id: 'bc-target' } as any);
    prismaMock.notificationPreference.count.mockResolvedValue(0);
    (prismaMock.clubBroadcastRecipient.createMany as jest.Mock).mockResolvedValue({ count: 0 });
    prismaMock.clubMembership.findMany.mockResolvedValue(
      [{ user: { id: 'u1', email: 'a@a.fr', firstName: 'A', lastName: 'A' } }] as any,
    );
  });

  it('recipientUserIds : intersecté avec les adhésions ACTIVES du club', async () => {
    await new BroadcastService().send('club-demo', 'staff-1', {
      title: 'Hello', bodyHtml: '<p>corps</p>', recipientUserIds: ['u1', 'u-hors-club'],
    });
    expect(prismaMock.clubMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clubId: 'club-demo', status: 'ACTIVE', userId: { in: ['u1', 'u-hors-club'] } }),
    }));
  });

  it('liste ciblée vide après intersection → VALIDATION_ERROR', async () => {
    (prismaMock.clubMembership.findMany as jest.Mock).mockResolvedValue([]);
    await expect(new BroadcastService().send('club-demo', 'staff-1', {
      title: 'Hello', bodyHtml: '<p>x</p>', recipientUserIds: ['u-fantome'],
    })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('COMMERCIAL : catégorie CLUB_OFFERS au dispatch + lien de désinscription &cat=offers', async () => {
    await new BroadcastService().send('club-demo', 'staff-1', {
      title: 'Promo', bodyHtml: '<p>-20%</p>', kind: 'COMMERCIAL',
    });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ category: 'CLUB_OFFERS' }));
    const emailArg = (dispatch as jest.Mock).mock.calls[0][0].email;
    expect(emailArg.html).toContain('cat=offers');
  });

  it('INFO (défaut) : catégorie CLUB_MESSAGES inchangée, pas de cat sur le lien', async () => {
    await new BroadcastService().send('club-demo', 'staff-1', { title: 'Info', bodyHtml: '<p>x</p>' });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ category: 'CLUB_MESSAGES' }));
  });

  it('substitue {{prenom}}/{{nom}} par destinataire (titre + corps + notif)', async () => {
    (prismaMock.clubMembership.findMany as jest.Mock).mockResolvedValue([
      { user: { id: 'u1', email: 'a@a.fr', firstName: 'Ines', lastName: 'Andre' } },
    ]);
    await new BroadcastService().send('club-demo', 'staff-1', {
      title: 'Coucou {{prenom}}', bodyHtml: '<p>Bonjour {{prenom}} {{nom}}</p>',
    });
    const call = (dispatch as jest.Mock).mock.calls[0][0];
    expect(call.title).toBe('Coucou Ines');
    expect(call.body).toContain('Bonjour Ines Andre');
    expect(call.email.html).toContain('Ines');
  });

  it('persiste kind + une ligne destinataire par membre visé', async () => {
    (prismaMock.clubMembership.findMany as jest.Mock).mockResolvedValue([
      { user: { id: 'u1', email: 'a@a.fr', firstName: 'A', lastName: 'A' } },
      { user: { id: 'u2', email: 'b@b.fr', firstName: 'B', lastName: 'B' } },
    ]);
    await new BroadcastService().send('club-demo', 'staff-1', { title: 'T', bodyHtml: '<p>x</p>', kind: 'COMMERCIAL' });
    expect(prismaMock.clubBroadcast.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'COMMERCIAL', recipientCount: 2 }),
    }));
    expect(prismaMock.clubBroadcastRecipient.createMany).toHaveBeenCalledWith({
      data: [{ broadcastId: expect.any(String), userId: 'u1' }, { broadcastId: expect.any(String), userId: 'u2' }],
      skipDuplicates: true,
    });
  });
});
