import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

jest.mock('../../email/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));
const { sendMail } = require('../../email/mailer') as { sendMail: jest.Mock };

import { EmailTemplateService } from '../emailTemplate.service';

describe('EmailTemplateService (lecture)', () => {
  const service = new EmailTemplateService();

  describe('listForAdmin', () => {
    it('renvoie 17 entrées avec le flag customized', async () => {
      prismaMock.clubEmailTemplate.findMany.mockResolvedValue([{ type: 'payment.refunded' }] as any);
      const items = await service.listForAdmin('club-1');
      expect(items).toHaveLength(17);
      const refunded = items.find((i) => i.type === 'payment.refunded');
      expect(refunded!.customized).toBe(true);
      const confirmed = items.find((i) => i.type === 'registration.confirmed');
      expect(confirmed!.customized).toBe(false);
      expect(confirmed!.group).toBe('inscriptions');
    });
  });

  describe('getForAdmin', () => {
    it('renvoie def + override (null si absent)', async () => {
      prismaMock.clubEmailTemplate.findUnique.mockResolvedValue(null as any);
      const d = await service.getForAdmin('club-1', 'registration.confirmed');
      expect(d.type).toBe('registration.confirmed');
      expect(d.vars.length).toBeGreaterThan(0);
      expect(d.defaults.subject).toContain('{{activite}}');
      expect(d.override).toBeNull();
    });
    it('lève EMAIL_TYPE_UNKNOWN pour un type inexistant', async () => {
      await expect(service.getForAdmin('club-1', 'nope')).rejects.toThrow('EMAIL_TYPE_UNKNOWN');
    });
  });

  describe('getOverride', () => {
    it('renvoie la ligne si présente', async () => {
      prismaMock.clubEmailTemplate.findUnique.mockResolvedValue({ subject: 's' } as any);
      const o = await service.getOverride('club-1', 'registration.confirmed');
      expect(o).toEqual({ subject: 's' });
    });
    it('renvoie null si la requête échoue (résilience)', async () => {
      prismaMock.clubEmailTemplate.findUnique.mockRejectedValue(new Error('db down'));
      const o = await service.getOverride('club-1', 'registration.confirmed');
      expect(o).toBeNull();
    });
  });
});

describe('EmailTemplateService (écriture)', () => {
  const service = new EmailTemplateService();
  const draft = { subject: 'Salut {{prenom}}', heading: 'Hello', bodyHtml: '<p>Yo <script>x</script></p>', ctaLabel: '', footerNote: '' };

  it('upsert assainit le corps et renvoie unknownVars', async () => {
    (prismaMock.clubEmailTemplate.upsert as jest.Mock).mockImplementation(async (args: any) => args.create);
    const res = await service.upsert('club-1', 'registration.confirmed', { ...draft, bodyHtml: '<p>{{prenom}} {{inconnu}}<script>x</script></p>' });
    expect(res.unknownVars).toContain('inconnu');
    const call = prismaMock.clubEmailTemplate.upsert.mock.calls[0][0] as any;
    expect(call.create.bodyHtml).not.toContain('<script');
    expect(call.create.ctaLabel).toBeNull(); // '' → null
  });

  it('upsert refuse un type inconnu', async () => {
    await expect(service.upsert('club-1', 'nope', draft)).rejects.toThrow('EMAIL_TYPE_UNKNOWN');
  });

  it('upsert refuse un champ requis vide', async () => {
    await expect(service.upsert('club-1', 'registration.confirmed', { ...draft, subject: '   ' }))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('remove supprime la surcharge (idempotent)', async () => {
    prismaMock.clubEmailTemplate.deleteMany.mockResolvedValue({ count: 1 } as any);
    await service.remove('club-1', 'registration.confirmed');
    expect(prismaMock.clubEmailTemplate.deleteMany).toHaveBeenCalledWith({
      where: { clubId: 'club-1', type: 'registration.confirmed' },
    });
  });
});

describe('EmailTemplateService (aperçu/test)', () => {
  const service = new EmailTemplateService();
  const club = { name: 'Padel Arena', logoUrl: null, accentColor: '#1a2b3c' };
  const draft = { subject: 'Salut {{prenom}}', heading: 'Hello', bodyHtml: '<p>Yo {{activite}}</p>', ctaLabel: '', footerNote: '' };

  beforeEach(() => sendMail.mockClear());

  it('renderPreview rend avec les valeurs d\'exemple', async () => {
    prismaMock.club.findUniqueOrThrow.mockResolvedValue(club as any);
    const res = await service.renderPreview('club-1', 'registration.confirmed', draft);
    expect(res.subject).toBe('Salut Marie'); // sample prenom = Marie
    expect(res.html).toContain('Yo Tournoi P100 du dimanche');
  });

  it('sendTest envoie au destinataire fourni', async () => {
    prismaMock.club.findUniqueOrThrow.mockResolvedValue(club as any);
    await service.sendTest('club-1', 'registration.confirmed', draft, 'admin@x.fr');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@x.fr', subject: 'Salut Marie' }));
  });
});
