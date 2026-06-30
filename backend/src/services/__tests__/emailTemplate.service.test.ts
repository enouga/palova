import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
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
